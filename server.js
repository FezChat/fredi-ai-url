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

// Create necessary directories
const uploadDir = 'uploads';
const publicDir = 'public';

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Configure multer
const upload = multer({
  dest: uploadDir + '/',
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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
let socket = null;
let isConnected = false;
let qrCode = null;

const contactsDB = {
  channels: {},
  groups: {}
};

// Function to parse contact files
async function parseContactFile(filePath, fileType) {
  const contacts = [];

  try {
    switch (fileType) {
      case 'vcf':
        const vcardContent = fs.readFileSync(filePath, 'utf8');
        // Simple VCF parser
        const vcardLines = vcardContent.split('\n');
        let currentPhone = '';
        for (const line of vcardLines) {
          if (line.startsWith('TEL;')) {
            const phoneMatch = line.match(/TEL[^:]*:(.+)/);
            if (phoneMatch) {
              const phone = phoneMatch[1].replace(/\D/g, '');
              if (phone.length >= 10) contacts.push(phone);
            }
          }
        }
        break;

      case 'json':
        const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(jsonData)) {
          jsonData.forEach(item => {
            if (item.phone || item.mobile || item.tel) {
              const phone = (item.phone || item.mobile || item.tel).toString().replace(/\D/g, '');
              if (phone.length >= 10) contacts.push(phone);
            }
          });
        }
        break;

      case 'csv':
        await new Promise((resolve, reject) => {
          fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
              // Try common column names for phone numbers
              const phoneKey = Object.keys(row).find(key => 
                key.toLowerCase().includes('phone') || 
                key.toLowerCase().includes('mobile') ||
                key.toLowerCase().includes('tel')
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
        
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  } catch (error) {
    console.error('Error parsing file:', error);
    throw new Error(`Failed to parse ${fileType} file: ${error.message}`);
  }

  // Remove duplicates and empty values
  return [...new Set(contacts.filter(phone => phone.length >= 10))];
}

// WhatsApp Connection Handler
async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: ['FEE-XMD Booster', 'Chrome', '1.0.0']
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          qrCode = await QRCode.toDataURL(qr);
          console.log('QR Code generated');
        } catch (error) {
          console.error('Error generating QR code:', error);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = 
          new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          setTimeout(() => connectToWhatsApp(), 3000);
        }
        isConnected = false;
        console.log('❌ WhatsApp disconnected');
      } else if (connection === 'open') {
        isConnected = true;
        console.log('✅ Connected to WhatsApp!');
        qrCode = null;
      }
    });

    socket.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('Error connecting to WhatsApp:', error);
  }
}

// Boost Channel Function
async function boostChannel(channelId, contacts) {
  if (!isConnected || !socket) {
    throw new Error('WhatsApp not connected');
  }

  const results = {
    success: 0,
    failed: 0,
    details: []
  };

  console.log(`Starting channel boost for ${contacts.length} contacts...`);

  for (const contact of contacts) {
    try {
      // Follow newsletter/channel
      await socket.newsletterFollow(channelId);
      
      results.success++;
      results.details.push({
        contact,
        status: 'success',
        message: `Followed channel ${channelId}`
      });

      console.log(`✅ Contact ${contact} followed channel`);

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      results.failed++;
      results.details.push({
        contact,
        status: 'failed',
        message: error.message
      });
      
      console.log(`❌ Failed for contact ${contact}: ${error.message}`);
    }
  }

  return results;
}

// Boost Group Function
async function boostGroup(groupInviteCode, contacts) {
  if (!isConnected || !socket) {
    throw new Error('WhatsApp not connected');
  }

  const results = {
    success: 0,
    failed: 0,
    details: []
  };

  console.log(`Starting group boost for ${contacts.length} contacts...`);

  let groupJid = null;
  
  try {
    // First accept group invite
    groupJid = await socket.groupAcceptInvite(groupInviteCode);
    console.log(`✅ Joined group: ${groupJid}`);
  } catch (error) {
    console.error(`❌ Failed to join group: ${error.message}`);
    throw new Error(`Failed to join group: ${error.message}`);
  }

  for (const contact of contacts) {
    try {
      const jid = `${contact}@s.whatsapp.net`;
      
      // Add contact to group
      await socket.groupParticipantsUpdate(
        groupJid,
        [jid],
        'add'
      );

      results.success++;
      results.details.push({
        contact,
        status: 'success',
        message: `Added to group`
      });

      console.log(`✅ Added contact ${contact} to group`);

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      results.failed++;
      results.details.push({
        contact,
        status: 'failed',
        message: error.message
      });
      
      console.log(`❌ Failed to add contact ${contact}: ${error.message}`);
    }
  }

  return results;
}

// API Routes

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    connected: isConnected,
    hasQR: !!qrCode,
    qrCode: qrCode
  });
});

// Upload contacts endpoint
app.post('/api/upload-contacts', upload.single('file'), async (req, res) => {
  console.log('\n📥 Upload request received');
  console.log('Body:', req.body);
  console.log('File:', req.file ? {
    name: req.file.originalname,
    size: req.file.size,
    path: req.file.path
  } : 'No file');

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
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: type and targetId' 
      });
    }

    // Validate type
    if (type !== 'channel' && type !== 'group') {
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid type. Must be "channel" or "group"' 
      });
    }

    const fileExt = path.extname(file.originalname).toLowerCase().substring(1);
    console.log(`Processing ${fileExt} file: ${file.originalname}`);

    const contacts = await parseContactFile(file.path, fileExt);
    console.log(`Parsed ${contacts.length} contacts`);

    // Store contacts
    if (type === 'channel') {
      contactsDB.channels[targetId] = contacts;
      console.log(`Stored ${contacts.length} contacts for channel: ${targetId}`);
    } else if (type === 'group') {
      contactsDB.groups[targetId] = contacts;
      console.log(`Stored ${contacts.length} contacts for group: ${targetId}`);
    }

    // Clean up uploaded file
    if (file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    res.json({
      success: true,
      count: contacts.length,
      contacts: contacts.slice(0, 10),
      message: `Successfully parsed ${contacts.length} contacts`
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    
    // Clean up file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Please ensure the file format is correct and try again.'
    });
  }
});

// Boost endpoint
app.post('/api/boost', async (req, res) => {
  console.log('\n🚀 Boost request received:', req.body);
  
  try {
    const { type, targetId } = req.body;

    if (!type || !targetId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing type or targetId' 
      });
    }

    if (!isConnected || !socket) {
      return res.status(400).json({ 
        success: false,
        error: 'WhatsApp not connected. Please scan QR code first.' 
      });
    }

    let contacts = [];
    if (type === 'channel') {
      contacts = contactsDB.channels[targetId] || [];
      console.log(`Found ${contacts.length} contacts for channel: ${targetId}`);
    } else if (type === 'group') {
      contacts = contactsDB.groups[targetId] || [];
      console.log(`Found ${contacts.length} contacts for group: ${targetId}`);
    } else {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid type. Must be "channel" or "group"' 
      });
    }

    if (contacts.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No contacts uploaded for this target. Please upload contacts first.' 
      });
    }

    let results;
    if (type === 'channel') {
      console.log(`Starting channel boost for: ${targetId}`);
      results = await boostChannel(targetId, contacts);
    } else if (type === 'group') {
      console.log(`Starting group boost for: ${targetId}`);
      results = await boostGroup(targetId, contacts);
    }

    console.log(`Boost completed: ${results.success} success, ${results.failed} failed`);

    res.json({
      success: true,
      type,
      targetId,
      results: {
        success: results.success,
        failed: results.failed,
        details: results.details.slice(0, 50) // Limit response size
      }
    });

  } catch (error) {
    console.error('❌ Boost error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Test endpoint for quick checks
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Server is working!',
    timestamp: new Date().toISOString(),
    contactsDB: {
      channels: Object.keys(contactsDB.channels),
      groups: Object.keys(contactsDB.groups)
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'Server is running',
    port: PORT,
    uploadDir: uploadDir,
    whatsapp: isConnected ? 'connected' : 'disconnected',
    time: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err);
    return res.status(400).json({
      success: false,
      error: `File upload error: ${err.message}`
    });
  }
  
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// Serve the HTML file - UPDATED TO SERVE DIRECTLY
app.get('/', (req, res) => {
  // Check if HTML file exists in current directory
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    // Fallback to public directory
    const publicHtmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(publicHtmlPath)) {
      res.sendFile(publicHtmlPath);
    } else {
      // Create a simple default page
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>FEE-XMD WhatsApp Booster</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
            h1 { color: #667eea; }
            .status { padding: 20px; background: #f0f0f0; border-radius: 10px; margin: 20px; }
          </style>
        </head>
        <body>
          <h1>FEE-XMD WhatsApp Booster</h1>
          <div class="status">
            <p>✅ Server is running on port ${PORT}</p>
            <p>📁 Upload directory: ${uploadDir}</p>
            <p>📱 WhatsApp: ${isConnected ? '✅ Connected' : '❌ Disconnected'}</p>
            <p><a href="/api/status">Check API Status</a></p>
            <p><a href="/api/test">Test API</a></p>
            <p><a href="/health">Health Check</a></p>
          </div>
          <p>Please place your index.html file in the server directory or public folder.</p>
        </body>
        </html>
      `);
    }
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📁 Upload directory: ${uploadDir}`);
  console.log(`📂 Public directory: ${publicDir}`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
  console.log(`🔧 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 API Status: http://localhost:${PORT}/api/status`);
  console.log(`🧪 API Test: http://localhost:${PORT}/api/test`);
  
  // Initialize WhatsApp connection (comment/uncomment as needed)
  // connectToWhatsApp();
});

// Export for testing
module.exports = app;