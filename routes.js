const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const whatsapp = require('./whatsapp');

// Configure multer
const uploadDir = 'uploads';
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

// In-memory storage
const contactsDB = {
  channels: {},
  groups: {}
};

// Load saved contacts
function loadContacts() {
  try {
    const dataPath = path.join('data', 'contacts.json');
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      Object.assign(contactsDB, data);
      console.log(`📁 Loaded ${Object.keys(contactsDB.channels).length} channels and ${Object.keys(contactsDB.groups).length} groups`);
    }
  } catch (error) {
    console.error('Error loading contacts:', error);
  }
}

// Save contacts
function saveContacts() {
  try {
    const dataPath = path.join('data', 'contacts.json');
    fs.writeFileSync(dataPath, JSON.stringify(contactsDB, null, 2));
  } catch (error) {
    console.error('Error saving contacts:', error);
  }
}

// Parse contact file
async function parseContactFile(filePath, fileType) {
  const contacts = [];

  try {
    switch (fileType) {
      case 'vcf':
        const vcardContent = fs.readFileSync(filePath, 'utf8');
        const vcardLines = vcardContent.split('\n');
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

// Load contacts on startup
loadContacts();

// ============ API ROUTES ============

// Get WhatsApp status
router.get('/status', (req, res) => {
  res.json({
    success: true,
    ...whatsapp.getStatus()
  });
});

// Upload contacts
router.post('/upload-contacts', upload.single('file'), async (req, res) => {
  console.log('\n📥 Upload request received:', req.body);

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
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: type and targetId' 
      });
    }

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
    console.log(`✅ Parsed ${contacts.length} contacts`);

    // Store contacts
    if (type === 'channel') {
      contactsDB.channels[targetId] = {
        contacts: contacts,
        uploadedAt: new Date().toISOString(),
        count: contacts.length
      };
    } else {
      contactsDB.groups[targetId] = {
        contacts: contacts,
        uploadedAt: new Date().toISOString(),
        count: contacts.length
      };
    }

    // Save to file
    saveContacts();

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
    
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// Verify channel
router.get('/verify/channel/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    
    if (!whatsapp.getStatus().connected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp not connected. Check terminal for QR code.'
      });
    }

    const info = await whatsapp.getChannelInfo(channelId);
    res.json(info);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Verify group
router.get('/verify/group/:inviteCode', async (req, res) => {
  try {
    const { inviteCode } = req.params;
    
    if (!whatsapp.getStatus().connected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp not connected. Check terminal for QR code.'
      });
    }

    // First join to get group JID
    const joinResult = await whatsapp.joinGroup(inviteCode);
    
    if (!joinResult.success) {
      return res.json({
        success: false,
        error: joinResult.error
      });
    }

    // Get group info
    const info = await whatsapp.getGroupInfo(joinResult.groupJid);
    
    res.json({
      success: true,
      inviteCode,
      groupJid: joinResult.groupJid,
      ...info
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Boost channel
router.post('/boost/channel', async (req, res) => {
  try {
    const { channelId } = req.body;
    
    if (!whatsapp.getStatus().connected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp not connected'
      });
    }

    const channelData = contactsDB.channels[channelId];
    if (!channelData) {
      return res.status(400).json({
        success: false,
        error: 'No contacts uploaded for this channel'
      });
    }

    const contacts = channelData.contacts;
    console.log(`🚀 Starting channel boost for ${contacts.length} contacts to ${channelId}`);

    const results = {
      success: 0,
      failed: 0,
      total: contacts.length,
      details: []
    };

    // Verify channel first
    const channelInfo = await whatsapp.getChannelInfo(channelId);
    if (!channelInfo.success) {
      return res.json({
        success: false,
        error: `Invalid channel: ${channelInfo.error}`
      });
    }

    for (const contact of contacts) {
      try {
        // Check if number exists on WhatsApp
        const numberCheck = await whatsapp.checkNumberExists(contact);
        
        if (numberCheck.exists) {
          // Follow channel
          const followResult = await whatsapp.followNewsletter(channelId);
          
          if (followResult.success) {
            results.success++;
            results.details.push({
              contact,
              status: 'success',
              message: `Followed channel "${channelInfo.name}"`
            });
          } else {
            results.failed++;
            results.details.push({
              contact,
              status: 'failed',
              message: followResult.error
            });
          }
        } else {
          results.failed++;
          results.details.push({
            contact,
            status: 'failed',
            message: 'Number not on WhatsApp'
          });
        }

        // Delay between requests
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

    console.log(`✅ Channel boost completed: ${results.success}/${results.total} successful`);

    res.json({
      success: true,
      channelId,
      channelInfo: channelInfo,
      results
    });

  } catch (error) {
    console.error('Boost error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Boost group
router.post('/boost/group', async (req, res) => {
  try {
    const { inviteCode } = req.body;
    
    if (!whatsapp.getStatus().connected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp not connected'
      });
    }

    const groupData = contactsDB.groups[inviteCode];
    if (!groupData) {
      return res.status(400).json({
        success: false,
        error: 'No contacts uploaded for this group'
      });
    }

    const contacts = groupData.contacts;
    console.log(`🚀 Starting group boost for ${contacts.length} contacts to group ${inviteCode}`);

    const results = {
      success: 0,
      failed: 0,
      total: contacts.length,
      details: []
    };

    // Join group first
    const joinResult = await whatsapp.joinGroup(inviteCode);
    if (!joinResult.success) {
      return res.json({
        success: false,
        error: `Failed to join group: ${joinResult.error}`
      });
    }

    // Get group info
    const groupInfo = await whatsapp.getGroupInfo(joinResult.groupJid);

    for (const contact of contacts) {
      try {
        // Check if number exists on WhatsApp
        const numberCheck = await whatsapp.checkNumberExists(contact);
        
        if (numberCheck.exists) {
          // Add to group
          const addResult = await whatsapp.addToGroup(joinResult.groupJid, contact);
          
          if (addResult.success) {
            results.success++;
            results.details.push({
              contact,
              status: 'success',
              message: `Added to group "${groupInfo.subject}"`
            });
          } else {
            results.failed++;
            results.details.push({
              contact,
              status: 'failed',
              message: addResult.error
            });
          }
        } else {
          results.failed++;
          results.details.push({
            contact,
            status: 'failed',
            message: 'Number not on WhatsApp'
          });
        }

        // Delay between requests
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

    console.log(`✅ Group boost completed: ${results.success}/${results.total} successful`);

    res.json({
      success: true,
      inviteCode,
      groupJid: joinResult.groupJid,
      groupInfo: groupInfo,
      results
    });

  } catch (error) {
    console.error('Boost error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get stored data
router.get('/data', (req, res) => {
  res.json({
    success: true,
    channels: Object.keys(contactsDB.channels).map(id => ({
      id,
      count: contactsDB.channels[id]?.count || 0,
      uploadedAt: contactsDB.channels[id]?.uploadedAt
    })),
    groups: Object.keys(contactsDB.groups).map(id => ({
      id,
      count: contactsDB.groups[id]?.count || 0,
      uploadedAt: contactsDB.groups[id]?.uploadedAt
    }))
  });
});

module.exports = router;