// server/whatsapp/whatsapp-client.js
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');

class WhatsAppClient {
    constructor() {
        this.sock = null;
        this.authState = null;
        this.isConnected = false;
        this.boostQueue = [];
        this.isProcessing = false;
    }

    async initialize() {
        try {
            const authDir = path.join(__dirname, 'auth');
            const { state, saveCreds } = await useMultiFileAuthState(authDir);

            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
                browser: ['FEE-XMD Booster', 'Chrome', '1.0.0']
            });

            this.sock.ev.on('creds.update', saveCreds);
            this.sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'close') {
                    this.isConnected = false;
                    console.log('Connection closed, reconnecting...');
                    this.initialize();
                } else if (connection === 'open') {
                    this.isConnected = true;
                    console.log('WhatsApp connected successfully!');
                }
            });

            return this.sock;
        } catch (error) {
            console.error('Failed to initialize WhatsApp:', error);
            throw error;
        }
    }

    async followNewsletter(channelLink, phoneNumbers) {
        if (!this.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const results = {
            success: [],
            failed: [],
            total: phoneNumbers.length
        };

        for (const phoneNumber of phoneNumbers) {
            try {
                // Extract newsletter ID from channel link
                const newsletterId = this.extractNewsletterId(channelLink);
                
                // Follow the newsletter
                await this.sock.newsletterFollow({
                    newsletterId: newsletterId,
                    phone: phoneNumber
                });
                
                results.success.push(phoneNumber);
                await this.delay(2000); // Prevent rate limiting
            } catch (error) {
                results.failed.push({
                    number: phoneNumber,
                    error: error.message
                });
            }
        }

        return results;
    }

    async acceptGroupInvite(inviteCode, phoneNumbers) {
        if (!this.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        const results = {
            success: [],
            failed: [],
            total: phoneNumbers.length
        };

        for (const phoneNumber of phoneNumbers) {
            try {
                // Accept group invite
                await this.sock.acceptGroupInvite(inviteCode, {
                    phone: phoneNumber
                });
                
                results.success.push(phoneNumber);
                await this.delay(2000); // Prevent rate limiting
            } catch (error) {
                if (error.message.includes('full') || error.message.includes('maximum')) {
                    throw new Error('Group is full. Cannot add more members.');
                }
                results.failed.push({
                    number: phoneNumber,
                    error: error.message
                });
            }
        }

        return results;
    }

    async getGroupInfo(groupId) {
        if (!this.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        try {
            const groupInfo = await this.sock.groupMetadata(groupId);
            return {
                id: groupInfo.id,
                subject: groupInfo.subject,
                size: groupInfo.size,
                participants: groupInfo.participants.length,
                isFull: groupInfo.participants.length >= 1024, // WhatsApp group limit
                creation: groupInfo.creation
            };
        } catch (error) {
            throw new Error(`Failed to get group info: ${error.message}`);
        }
    }

    async getChannelInfo(channelLink) {
        if (!this.isConnected) {
            throw new Error('WhatsApp not connected');
        }

        try {
            const newsletterId = this.extractNewsletterId(channelLink);
            const channelInfo = await this.sock.getNewsletterMetadata({
                newsletterId: newsletterId
            });

            return {
                id: channelInfo.id,
                name: channelInfo.name,
                description: channelInfo.description,
                followers: channelInfo.subscribers,
                createdAt: channelInfo.creation
            };
        } catch (error) {
            throw new Error(`Failed to get channel info: ${error.message}`);
        }
    }

    extractNewsletterId(channelLink) {
        // Extract newsletter ID from WhatsApp channel link
        const match = channelLink.match(/whatsapp\.com\/channel\/([A-Z0-9]+)/i);
        if (!match) {
            throw new Error('Invalid channel link format');
        }
        return match[1];
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    disconnect() {
        if (this.sock) {
            this.sock.end();
            this.isConnected = false;
        }
    }
}

module.exports = WhatsAppClient;