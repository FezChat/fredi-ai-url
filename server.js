require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Boom } = require('@hapi/boom');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const csv = require('csv-parser');
const vcards = require('vcards-js');
const QRCode = require('qrcode');
const multer = require('multer');

const app = express();

// Create uploads directory if it doesn't exist
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer with better error handling
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.vcf', '.csv', '.txt', '.json'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only VCF, CSV, TXT, and JSON files are allowed.'));
    }
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
let socket = null;
let isConnected = false;
let qrCode = null;

const contactsDB = {
  channels: {},
  groups: {}
};

async function parseContactFile(filePath, fileType) {
  const contacts = [];
  
  try {
    switch (fileType) {
      case 'vcf':
        const vcardContent = fs.readFileSync(filePath, 'utf8');
        const cards = vcards().parse(vcardContent);
        cards.forEach(card => {
          if (card.cellPhone) {
            const phone = card.cellPhone.replace(/\D/g, '');
            if (phone.length >= 10) contacts.push(phone);
          }
        });
        break;
        
      case 'json':
        const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        jsonData.forEach(item => {
          if (item.phone) {
            const phone = item.phone.toString().replace(/\D/g, '');
            if (phone.length >= 10) contacts.push(phone);
          }
        });
        break;
        
      case 'csv':
        await new Promise((resolve, reject) => {
          fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
              // Try common column names for phone numbers
              const phoneKey = Object.keys(row).find(key => 
                key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile')
              );
              if (phoneKey && row[phoneKey]) {
                const phone = row[phoneKey].toString().replace(/\D/g, '');
                if (phone.length >= 10) contacts.push(phone);
              }
            })
            .on('end', resolve)
            .on('error', reject);
        });
        break;
        
      case 'txt':
        const textContent = fs.readFileSync(filePath, 'utf8');
        const lines = textContent.split('\n');
        lines.forEach(line => {
          const phone = line.trim().replace(/\D/g, '');
          if (phone.length >= 10) contacts.push(phone);
        });
        break;
    }
  } catch (error) {
    console.error('Error parsing file:', error);
    throw new Error(`Failed to parse ${fileType} file: ${error.message}`);
  }
  
  return [...new Set(contacts)]; // Remove duplicates
}

// API Routes with better error handling
app.post('/api/upload-contacts', upload.single('file'), async (req, res) => {
  try {
    const { type, targetId } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded. Please select a file.' 
      });
    }
    
    if (!type || !targetId) {
      // Clean up uploaded file
      if (file.path) fs.unlinkSync(file.path);
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: type and targetId' 
      });
    }
    
    const fileExt = path.extname(file.originalname).toLowerCase().substring(1);
    console.log(`Processing ${fileExt} file: ${file.originalname}`);
    
    const contacts = await parseContactFile(file.path, fileExt);
    
    // Store contacts
    if (type === 'channel') {
      contactsDB.channels[targetId] = contacts;
    } else if (type === 'group') {
      contactsDB.groups[targetId] = contacts;
    }
    
    // Clean up uploaded file
    fs.unlinkSync(file.path);
    
    res.json({
      success: true,
      count: contacts.length,
      contacts: contacts.slice(0, 10),
      message: `Successfully parsed ${contacts.length} contacts`
    });
    
  } catch (error) {
    // Clean up file if it exists
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error('Upload error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Please ensure the file format is correct and try again.'
    });
  }
});

// Add error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: `File upload error: ${err.message}`
    });
  }
  next(err);
});


// WhatsApp Connection Handler
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  socket = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['FEE-XMD Booster', 'Chrome', '1.0.0']
  });

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = await QRCode.toDataURL(qr);
      console.log('QR Code generated');
    }

    if (connection === 'close') {
      const shouldReconnect = 
        new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        connectToWhatsApp();
      }
      isConnected = false;
    } else if (connection === 'open') {
      isConnected = true;
      console.log('✅ Connected to WhatsApp!');
      qrCode = null;
    }
  });

  socket.ev.on('creds.update', saveCreds);
}

// Boost Channel Function
async function boostChannel(channelId, contacts) {
  if (!isConnected) throw new Error('WhatsApp not connected');

  const results = {
    success: 0,
    failed: 0,
    details: []
  };

  for (const contact of contacts) {
    try {
      const jid = `${contact}@s.whatsapp.net`;

      // Follow newsletter/channel
      await socket.newsletterFollow(channelId);

      results.success++;
      results.details.push({
        contact,
        status: 'success',
        message: `Followed channel ${channelId}`
      });

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      results.failed++;
      results.details.push({
        contact,
        status: 'failed',
        message: error.message
      });
    }
  }

  return results;
}

// Boost Group Function
async function boostGroup(groupInviteCode, contacts) {
  if (!isConnected) throw new Error('WhatsApp not connected');

  const results = {
    success: 0,
    failed: 0,
    details: []
  };

  try {
    // First accept group invite
    await socket.groupAcceptInvite(groupInviteCode);
  } catch (error) {
    throw new Error(`Failed to join group: ${error.message}`);
  }

  for (const contact of contacts) {
    try {
      const jid = `${contact}@s.whatsapp.net`;

      // Add contact to group (you need to be admin)
      await socket.groupParticipantsUpdate(
        `${groupInviteCode}@g.us`,
        [jid],
        'add'
      );

      results.success++;
      results.details.push({
        contact,
        status: 'success',
        message: `Added to group`
      });

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      results.failed++;
      results.details.push({
        contact,
        status: 'failed',
        message: error.message
      });
    }
  }

  return results;
}

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    connected: isConnected,
    hasQR: !!qrCode,
    qrCode: qrCode
  });
});

app.post('/api/upload-contacts', upload.single('file'), async (req, res) => {
  try {
    const { type, targetId } = req.body; // 'channel' or 'group'
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileExt = path.extname(file.originalname).toLowerCase().substring(1);
    const contacts = await parseContactFile(file.path, fileExt);

    // Store contacts in database
    if (type === 'channel') {
      contactsDB.channels[targetId] = contacts;
    } else if (type === 'group') {
      contactsDB.groups[targetId] = contacts;
    }

    // Clean up uploaded file
    fs.unlinkSync(file.path);

    res.json({
      success: true,
      count: contacts.length,
      contacts: contacts.slice(0, 10) // Return first 10 for preview
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/boost', async (req, res) => {
  try {
    const { type, targetId } = req.body;

    if (!isConnected) {
      return res.status(400).json({ error: 'WhatsApp not connected. Please scan QR code first.' });
    }

    let contacts = [];
    if (type === 'channel') {
      contacts = contactsDB.channels[targetId] || [];
    } else if (type === 'group') {
      contacts = contactsDB.groups[targetId] || [];
    }

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No contacts uploaded for this target' });
    }

    let results;
    if (type === 'channel') {
      results = await boostChannel(targetId, contacts);
    } else if (type === 'group') {
      results = await boostGroup(targetId, contacts);
    }

    res.json({
      success: true,
      type,
      targetId,
      results
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Upload directory: ${uploadDir}`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
  // connectToWhatsApp(); // Uncomment when ready
});