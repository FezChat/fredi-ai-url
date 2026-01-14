// server/utils/file-parser.js
const fs = require('fs');
const vcf = require('vcf');

async function parseContactsFile(filePath, mimeType) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        let phoneNumbers = [];

        if (mimeType === 'text/vcard' || filePath.endsWith('.vcf')) {
            // Parse VCF file
            const cards = vcf.parse(fileContent);
            phoneNumbers = cards
                .map(card => card.get('tel'))
                .filter(tel => tel)
                .map(tel => {
                    // Extract phone number and clean it
                    const number = tel.valueOf().replace(/\D/g, '');
                    return number.startsWith('+') ? number : `+${number}`;
                });
        } else if (filePath.endsWith('.json')) {
            // Parse JSON file
            const data = JSON.parse(fileContent);
            if (Array.isArray(data)) {
                phoneNumbers = data
                    .filter(item => item.phone || item.number)
                    .map(item => {
                        const number = (item.phone || item.number).replace(/\D/g, '');
                        return number.startsWith('+') ? number : `+${number}`;
                    });
            }
        } else if (filePath.endsWith('.txt')) {
            // Parse TXT file
            phoneNumbers = fileContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line)
                .map(number => {
                    const cleanNumber = number.replace(/\D/g, '');
                    return cleanNumber.startsWith('+') ? cleanNumber : `+${cleanNumber}`;
                });
        }

        // Remove duplicates
        const uniqueNumbers = [...new Set(phoneNumbers)];
        
        // Clean up file
        fs.unlinkSync(filePath);
        
        return uniqueNumbers;
    } catch (error) {
        throw new Error(`Failed to parse contacts file: ${error.message}`);
    }
}

module.exports = { parseContactsFile };