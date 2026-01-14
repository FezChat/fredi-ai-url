const { Boom } = require('@hapi/boom');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');

class WhatsAppHandler {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.qrCode = null;
    this.isConnecting = false;
  }

  async connect() {
    if (this.isConnecting) return;
    
    this.isConnecting = true;
    console.log('🔗 Connecting to WhatsApp...');
    
    try {
      const { state, saveCreds } = await useMultiFileAuthState('auth_info');

      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['FEE-XMD Booster', 'Chrome', '1.0.0'],
        logger: {
          level: 'warn' // Reduce noise in console
        }
      });

      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCode = await QRCode.toDataURL(qr);
            console.log('📱 QR Code generated in terminal - Scan with WhatsApp');
          } catch (error) {
            console.error('❌ Error generating QR code:', error);
          }
        }

        if (connection === 'close') {
          const shouldReconnect = 
            new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

          console.log('❌ WhatsApp disconnected');
          this.isConnected = false;
          this.qrCode = null;
          this.isConnecting = false;

          if (shouldReconnect) {
            console.log('🔄 Reconnecting in 5 seconds...');
            setTimeout(() => this.connect(), 5000);
          }
        } else if (connection === 'open') {
          this.isConnected = true;
          this.qrCode = null;
          this.isConnecting = false;
          console.log('✅ Connected to WhatsApp!');
        }
      });

      this.socket.ev.on('creds.update', saveCreds);

    } catch (error) {
      console.error('❌ Error connecting to WhatsApp:', error);
      this.isConnecting = false;
      setTimeout(() => this.connect(), 5000);
    }
  }

  // Get WhatsApp status
  getStatus() {
    return {
      connected: this.isConnected,
      hasQR: !!this.qrCode,
      qrCode: this.qrCode,
      isConnecting: this.isConnecting
    };
  }

  // Check if number exists on WhatsApp
  async checkNumberExists(phoneNumber) {
    if (!this.isConnected || !this.socket) {
      throw new Error('WhatsApp not connected');
    }

    try {
      const jid = `${phoneNumber}@s.whatsapp.net`;
      const [result] = await this.socket.onWhatsApp(jid);
      
      return {
        exists: !!result?.exists,
        jid: result?.jid,
        isBusiness: result?.isBusiness
      };
    } catch (error) {
      console.error('Error checking number:', error);
      return { exists: false, error: error.message };
    }
  }

  // Follow a newsletter/channel
  async followNewsletter(channelId) {
    if (!this.isConnected || !this.socket) {
      throw new Error('WhatsApp not connected');
    }

    try {
      await this.socket.newsletterFollow(channelId);
      return { success: true, message: `Successfully followed channel ${channelId}` };
    } catch (error) {
      console.error('Error following newsletter:', error);
      return { success: false, error: error.message };
    }
  }

  // Get channel info
  async getChannelInfo(channelId) {
    if (!this.isConnected || !this.socket) {
      throw new Error('WhatsApp not connected');
    }

    try {
      const metadata = await this.socket.newsletterMetadata(channelId);
      return {
        success: true,
        name: metadata.name,
        description: metadata.description,
        subscribers: metadata.subscribers,
        createdAt: metadata.createdAt,
        creator: metadata.creator
      };
    } catch (error) {
      console.error('Error getting channel info:', error);
      return { success: false, error: error.message };
    }
  }

  // Join group by invite code
  async joinGroup(inviteCode) {
    if (!this.isConnected || !this.socket) {
      throw new Error('WhatsApp not connected');
    }

    try {
      const groupJid = await this.socket.groupAcceptInvite(inviteCode);
      return { success: true, groupJid, message: `Successfully joined group` };
    } catch (error) {
      console.error('Error joining group:', error);
      return { success: false, error: error.message };
    }
  }

  // Get group info
  async getGroupInfo(groupJid) {
    if (!this.isConnected || !this.socket) {
      throw new Error('WhatsApp not connected');
    }

    try {
      const metadata = await this.socket.groupMetadata(groupJid);
      return {
        success: true,
        id: metadata.id,
        subject: metadata.subject,
        description: metadata.desc,
        creation: metadata.creation,
        owner: metadata.owner,
        participants: metadata.participants.length,
        isAnnouncement: metadata.announce,
        isLocked: metadata.restrict,
        isMembershipApprovalRequired: metadata.memberAddMode === 'admin_add'
      };
    } catch (error) {
      console.error('Error getting group info:', error);
      return { success: false, error: error.message };
    }
  }

  // Add participant to group
  async addToGroup(groupJid, phoneNumber) {
    if (!this.isConnected || !this.socket) {
      throw new Error('WhatsApp not connected');
    }

    try {
      const jid = `${phoneNumber}@s.whatsapp.net`;
      await this.socket.groupParticipantsUpdate(groupJid, [jid], 'add');
      return { success: true, message: `Added ${phoneNumber} to group` };
    } catch (error) {
      console.error('Error adding to group:', error);
      return { success: false, error: error.message };
    }
  }
}

// Create singleton instance
const whatsapp = new WhatsAppHandler();

// Start connection automatically
whatsapp.connect();

module.exports = whatsapp;