// server/routes/groups.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const WhatsAppClient = require('../whatsapp/whatsapp-client');
const { parseContactsFile } = require('../utils/file-parser');

const upload = multer({ dest: 'uploads/' });
const whatsappClient = new WhatsAppClient();

// Get group info
router.post('/group-info', async (req, res) => {
    try {
        const { groupLink } = req.body;
        
        if (!groupLink) {
            return res.status(400).json({ 
                success: false, 
                message: 'Group link is required' 
            });
        }

        const groupInfo = await whatsappClient.getGroupInfo(groupLink);
        
        if (groupInfo.isFull) {
            return res.json({ 
                success: false, 
                message: 'Group is full. Cannot add more members.',
                isFull: true
            });
        }

        res.json({ success: true, data: groupInfo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Boost group members
router.post('/boost-members', upload.single('contacts'), async (req, res) => {
    try {
        const { groupLink } = req.body;
        
        if (!groupLink || !req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'Group link and contacts file are required' 
            });
        }

        // Parse contacts file
        const phoneNumbers = await parseContactsFile(req.file.path, req.file.mimetype);
        
        // Check if group is full before starting
        const groupInfo = await whatsappClient.getGroupInfo(groupLink);
        if (groupInfo.isFull) {
            return res.status(400).json({ 
                success: false, 
                message: 'Group is full. Cannot add more members.' 
            });
        }

        // Accept group invites for all numbers
        const results = await whatsappClient.acceptGroupInvite(groupLink, phoneNumbers);
        
        // Get updated group info
        const updatedInfo = await whatsappClient.getGroupInfo(groupLink);
        
        res.json({ 
            success: true, 
            message: `Group boost completed. ${results.success.length}/${results.total} successful`,
            results: results,
            groupInfo: updatedInfo
        });
    } catch (error) {
        if (error.message.includes('full')) {
            return res.status(400).json({ 
                success: false, 
                message: 'Group became full during processing. Operation stopped.' 
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;