require('dotenv').config();
const { Boom } = require('@hapi/boom');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const express = require('express');
const multer = require('multer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Setup directories
const uploadsDir = 'uploads';
const dataDir = 'data';

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// WhatsApp connection
let socket = null;
let isConnected = false;
let boostQueue = {
    groups: [],
    channels: []
};

// WhatsApp connection handler
async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        
        socket = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['FEE-XMD Booster', 'Chrome', '1.0.0']
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.clear();
                console.log('✅ WhatsApp Connected! Starting automatic boosts...');
                isConnected = true;
                
                // Process queued boosts
                await processBoostQueue();
            }

            if (connection === 'close') {
                const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                
                console.log('Connection closed. Reconnecting...');
                isConnected = false;
                
                if (shouldReconnect) {
                    setTimeout(() => connectToWhatsApp(), 5000);
                }
            }
        });

        socket.ev.on('creds.update', saveCreds);
    } catch (error) {
        console.error('Connection error:', error);
        setTimeout(() => connectToWhatsApp(), 10000);
    }
}

// Process boost queue
async function processBoostQueue() {
    console.log('Processing boost queue...');
    
    // Process groups
    for (const group of boostQueue.groups) {
        try {
            console.log(`Joining group: ${group.inviteCode}`);
            await socket.groupAcceptInvite(group.inviteCode);
            console.log(`✅ Successfully joined group`);
            
            // Add contacts to group
            for (const contact of group.contacts) {
                try {
                    const jid = `${contact}@s.whatsapp.net`;
                    await socket.groupParticipantsUpdate(
                        `${group.inviteCode}@g.us`,
                        [jid],
                        'add'
                    );
                    console.log(`✅ Added ${contact} to group`);
                    await delay(2000);
                } catch (err) {
                    console.log(`❌ Failed to add ${contact}: ${err.message}`);
                }
            }
        } catch (error) {
            console.log(`❌ Failed to join group ${group.inviteCode}: ${error.message}`);
        }
        await delay(1000);
    }
    
    // Process channels
    for (const channel of boostQueue.channels) {
        try {
            console.log(`Following channel: ${channel.id}`);
            await socket.newsletterFollow(channel.id);
            console.log(`✅ Successfully followed channel`);
            
            // Add followers (if needed)
            for (const contact of channel.contacts) {
                try {
                    // Check if contact exists on WhatsApp
                    const [result] = await socket.onWhatsApp(`${contact}@s.whatsapp.net`);
                    if (result?.exists) {
                        console.log(`✅ ${contact} is on WhatsApp`);
                    }
                    await delay(1000);
                } catch (err) {
                    console.log(`❌ Error checking ${contact}: ${err.message}`);
                }
            }
        } catch (error) {
            console.log(`❌ Failed to follow channel ${channel.id}: ${error.message}`);
        }
        await delay(1000);
    }
    
    // Clear queue after processing
    boostQueue.groups = [];
    boostQueue.channels = [];
}

// Helper function
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse contact files
async function parseContactFile(filePath, fileType) {
    const contacts = [];
    
    try {
        switch (fileType) {
            case 'txt':
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.split('\n');
                for (const line of lines) {
                    const phone = line.trim().replace(/\D/g, '');
                    if (phone.length >= 10) {
                        contacts.push(phone);
                    }
                }
                break;
                
            case 'csv':
                await new Promise((resolve) => {
                    fs.createReadStream(filePath)
                        .pipe(csv())
                        .on('data', (row) => {
                            const phoneKey = Object.keys(row).find(key => 
                                key.toLowerCase().includes('phone') || 
                                key.toLowerCase().includes('mobile')
                            );
                            if (phoneKey && row[phoneKey]) {
                                const phone = row[phoneKey].toString().replace(/\D/g, '');
                                if (phone.length >= 10) {
                                    contacts.push(phone);
                                }
                            }
                        })
                        .on('end', resolve);
                });
                break;
                
            case 'json':
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (Array.isArray(data)) {
                    data.forEach(item => {
                        if (item.phone || item.mobile) {
                            const phone = (item.phone || item.mobile).toString().replace(/\D/g, '');
                            if (phone.length >= 10) {
                                contacts.push(phone);
                            }
                        }
                    });
                }
                break;
        }
    } catch (error) {
        console.error('Parse error:', error);
        throw error;
    }
    
    return [...new Set(contacts)]; // Remove duplicates
}

// Multer setup
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.txt', '.csv', '.json'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only TXT, CSV, JSON allowed.'));
        }
    }
});

// API Routes
app.get('/api/status', (req, res) => {
    res.json({
        connected: isConnected,
        queue: {
            groups: boostQueue.groups.length,
            channels: boostQueue.channels.length
        }
    });
});

app.post('/api/upload-group', upload.single('file'), async (req, res) => {
    try {
        const { inviteCode } = req.body;
        
        if (!inviteCode) {
            return res.status(400).json({ error: 'Group invite code required' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const contacts = await parseContactFile(req.file.path, path.extname(req.file.originalname).substring(1));
        
        // Add to boost queue
        boostQueue.groups.push({
            inviteCode: inviteCode.trim(),
            contacts: contacts,
            file: req.file.filename,
            uploadedAt: new Date().toISOString()
        });
        
        // Clean up file
        fs.unlinkSync(req.file.path);
        
        res.json({
            success: true,
            message: `Added ${contacts.length} contacts for group boost`,
            inviteCode,
            count: contacts.length,
            contacts: contacts.slice(0, 5)
        });
        
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/upload-channel', upload.single('file'), async (req, res) => {
    try {
        const { channelId } = req.body;
        
        if (!channelId) {
            return res.status(400).json({ error: 'Channel ID required' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const contacts = await parseContactFile(req.file.path, path.extname(req.file.originalname).substring(1));
        
        // Add to boost queue
        boostQueue.channels.push({
            id: channelId.trim(),
            contacts: contacts,
            file: req.file.filename,
            uploadedAt: new Date().toISOString()
        });
        
        // Clean up file
        fs.unlinkSync(req.file.path);
        
        res.json({
            success: true,
            message: `Added ${contacts.length} contacts for channel boost`,
            channelId,
            count: contacts.length,
            contacts: contacts.slice(0, 5)
        });
        
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/queue', (req, res) => {
    res.json({
        groups: boostQueue.groups.map(g => ({
            inviteCode: g.inviteCode,
            count: g.contacts.length,
            uploadedAt: g.uploadedAt
        })),
        channels: boostQueue.channels.map(c => ({
            id: c.id,
            count: c.contacts.length,
            uploadedAt: c.uploadedAt
        }))
    });
});

app.post('/api/clear-queue', (req, res) => {
    boostQueue.groups = [];
    boostQueue.channels = [];
    res.json({ success: true, message: 'Queue cleared' });
});

// Serve static files
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Upload directory: ${uploadsDir}`);
    console.log(`💾 Data directory: ${dataDir}`);
    console.log(`\n=== WHATSAPP BOOSTER ===`);
    console.log('Waiting for WhatsApp connection...');
    console.log('Check terminal for QR code');
    
    // Start WhatsApp connection
    connectToWhatsApp();
});