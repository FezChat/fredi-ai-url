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

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
let socket = null;
let isConnected = false;
let qrCode = null;

// Database for storing contacts (in-memory for example)
const contactsDB = {
  channels: {},
  groups: {}
};

// File upload handling
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// Parse various contact formats
async function parseContactFile(filePath, fileType) {
  const contacts = [];
  
  switch (fileType) {
    case 'vcf':
      const vcardContent = fs.readFileSync(filePath, 'utf8');
      const cards = vcards.fromString(vcardContent);
      cards.forEach(card => {
        if (card.cellPhone) contacts.push(card.cellPhone.replace(/\D/g, ''));
      });
      break;
      
    case 'json':
      const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      jsonData.forEach(item => {
        if (item.phone) contacts.push(item.phone.replace(/\D/g, ''));
      });
      break;
      
    case 'csv':
      await new Promise((resolve) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            if (row.phone) contacts.push(row.phone.replace(/\D/g, ''));
          })
          .on('end', resolve);
      });
      break;
      
    case 'txt':
      const textContent = fs.readFileSync(filePath, 'utf8');
      const lines = textContent.split('\n');
      lines.forEach(line => {
        const phone = line.trim().replace(/\D/g, '');
        if (phone) contacts.push(phone);
      });
      break;
  }
  
  return contacts.filter(phone => phone.length >= 10);
}

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

// Start server and WhatsApp connection
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
  connectToWhatsApp();
});