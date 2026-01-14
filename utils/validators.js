// server/utils/validators.js
class Validators {
    static validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    static validatePassword(password) {
        // At least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special character
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        return passwordRegex.test(password);
    }

    static validatePhoneNumber(phone) {
        // Basic phone number validation - can be adjusted based on country
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        return phoneRegex.test(phone.replace(/\s/g, ''));
    }

    static validateWhatsAppChannelLink(link) {
        const patterns = [
            /^https:\/\/whatsapp\.com\/channel\/[A-Z0-9]+$/i,
            /^whatsapp\.com\/channel\/[A-Z0-9]+$/i,
            /^https:\/\/www\.whatsapp\.com\/channel\/[A-Z0-9]+$/i
        ];
        return patterns.some(pattern => pattern.test(link.trim()));
    }

    static validateWhatsAppGroupLink(link) {
        const patterns = [
            /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/i,
            /^chat\.whatsapp\.com\/[A-Za-z0-9]+$/i,
            /^https:\/\/www\.chat\.whatsapp\.com\/[A-Za-z0-9]+$/i
        ];
        return patterns.some(pattern => pattern.test(link.trim()));
    }

    static extractNewsletterId(channelLink) {
        const match = channelLink.match(/whatsapp\.com\/channel\/([A-Z0-9]+)/i);
        return match ? match[1] : null;
    }

    static extractGroupInviteCode(groupLink) {
        const match = groupLink.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i);
        return match ? match[1] : null;
    }

    static validateFileType(file, allowedTypes = ['vcf', 'json', 'txt']) {
        const extension = file.name.toLowerCase().split('.').pop();
        const mimeTypes = {
            'vcf': 'text/vcard',
            'json': 'application/json',
            'txt': 'text/plain'
        };

        return allowedTypes.includes(extension) || 
               Object.values(mimeTypes).includes(file.type);
    }

    static validateFileSize(file, maxSizeMB = 10) {
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        return file.size <= maxSizeBytes;
    }

    static sanitizePhoneNumber(phone) {
        // Remove all non-numeric characters except leading +
        let sanitized = phone.replace(/[^\d+]/g, '');
        
        // Ensure it starts with +
        if (!sanitized.startsWith('+')) {
            sanitized = '+' + sanitized;
        }
        
        return sanitized;
    }

    static validateContactsArray(contacts) {
        if (!Array.isArray(contacts)) {
            return { valid: false, error: 'Contacts must be an array' };
        }

        if (contacts.length === 0) {
            return { valid: false, error: 'Contacts array is empty' };
        }

        if (contacts.length > 1000) {
            return { valid: false, error: 'Maximum 1000 contacts allowed per operation' };
        }

        const validContacts = [];
        const invalidContacts = [];

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            
            if (typeof contact === 'string') {
                const sanitized = this.sanitizePhoneNumber(contact);
                if (this.validatePhoneNumber(sanitized)) {
                    validContacts.push(sanitized);
                } else {
                    invalidContacts.push({
                        index: i,
                        value: contact,
                        error: 'Invalid phone number format'
                    });
                }
            } else if (typeof contact === 'object' && contact !== null) {
                const phone = contact.phone || contact.number || contact.tel;
                if (phone) {
                    const sanitized = this.sanitizePhoneNumber(String(phone));
                    if (this.validatePhoneNumber(sanitized)) {
                        validContacts.push(sanitized);
                    } else {
                        invalidContacts.push({
                            index: i,
                            value: phone,
                            error: 'Invalid phone number format'
                        });
                    }
                } else {
                    invalidContacts.push({
                        index: i,
                        value: contact,
                        error: 'No phone number found'
                    });
                }
            } else {
                invalidContacts.push({
                    index: i,
                    value: contact,
                    error: 'Invalid contact format'
                });
            }
        }

        return {
            valid: validContacts.length > 0,
            validContacts,
            invalidContacts,
            validCount: validContacts.length,
            invalidCount: invalidContacts.length
        };
    }

    static validateBoostRequest(data) {
        const errors = [];

        if (!data.channelLink && !data.groupLink) {
            errors.push('Either channelLink or groupLink is required');
        }

        if (data.channelLink && !this.validateWhatsAppChannelLink(data.channelLink)) {
            errors.push('Invalid WhatsApp channel link format');
        }

        if (data.groupLink && !this.validateWhatsAppGroupLink(data.groupLink)) {
            errors.push('Invalid WhatsApp group link format');
        }

        if (!data.contacts || !Array.isArray(data.contacts) || data.contacts.length === 0) {
            errors.push('Contacts array is required and must not be empty');
        } else {
            const contactValidation = this.validateContactsArray(data.contacts);
            if (!contactValidation.valid) {
                errors.push(`Invalid contacts: ${contactValidation.error}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    static generateOperationId() {
        return 'op_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    static validateSessionId(sessionId) {
        return typeof sessionId === 'string' && sessionId.trim().length > 0;
    }
}

module.exports = Validators;