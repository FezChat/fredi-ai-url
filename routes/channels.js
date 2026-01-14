// server/routes/channels.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const WhatsAppClient = require('../whatsapp/whatsapp-client');
const { parseContactsFile } = require('../utils/file-parser');

const upload = multer({ dest: 'uploads/' });
const whatsappClient = new WhatsAppClient();

// Initialize WhatsApp connection
router.post('/initialize', async (req, res) => {
    try {
        await whatsappClient.initialize();
        res.json({ success: true, message: 'WhatsApp client initialized' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get channel info
router.post('/channel-info', async (req, res) => {
    try {
        const { channelLink } = req.body;
        
        if (!channelLink) {
            return res.status(400).json({ 
                success: false, 
                message: 'Channel link is required' 
            });
        }

        const channelInfo = await whatsappClient.getChannelInfo(channelLink);
        res.json({ success: true, data: channelInfo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Upload contacts and boost followers
router.post('/boost-followers', upload.single('contacts'), async (req, res) => {
    try {
        const { channelLink } = req.body;
        
        if (!channelLink || !req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'Channel link and contacts file are required' 
            });
        }

        // Parse contacts file
        const phoneNumbers = await parseContactsFile(req.file.path, req.file.mimetype);
        
        // Follow newsletter with all numbers
        const results = await whatsappClient.followNewsletter(channelLink, phoneNumbers);
        
        // Get updated channel info
        const updatedInfo = await whatsappClient.getChannelInfo(channelLink);
        
        res.json({ 
            success: true, 
            message: `Boost completed. ${results.success.length}/${results.total} successful`,
            results: results,
            channelInfo: updatedInfo
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check boosting progress
router.get('/progress/:taskId', (req, res) => {
    // Implementation for tracking progress
    res.json({ progress: 75, status: 'processing' });
});

module.exports = router;