const fs = require('fs').promises;
const path = require('path');
const config = require('./config');

const LOG_FILE = path.join(__dirname, 'group1_messages.json');

async function initializeMessageLog() {
    try {
        try {
            await fs.access(LOG_FILE);
            const content = await fs.readFile(LOG_FILE, 'utf8');
            JSON.parse(content);
        } catch {
            console.log('Creating new message log file...');
            await fs.writeFile(LOG_FILE, '[]');
        }

        if (!global.client?.isReady) {
            console.log('Client not ready, waiting for initialization...');
            return;
        }
        
        const chats = await global.client.getChats();
        const group1 = chats.find(chat => chat.name === config.GROUP1_NAME);
        
        if (group1) {
            console.log('Fetching messages for initial log...');
            
            // First fetch to count valid messages ratio
            const sampleMessages = await group1.fetchMessages({ limit: 100 });
            const validCount = sampleMessages.filter(msg => !msg.fromMe && msg.body.trim()).length;
            const validRatio = validCount / sampleMessages.length;
            
            // Calculate how many messages we need to fetch to get our target
            const estimatedTotal = Math.ceil(config.MAX_LOG_MESSAGES / validRatio);
            console.log(`Estimated total messages needed: ${estimatedTotal}`);
            
            // Fetch the estimated amount
            const messages = await group1.fetchMessages({ limit: estimatedTotal });
            
            const validMessages = messages
                .filter(msg => !msg.fromMe && msg.body.trim())
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, config.MAX_LOG_MESSAGES);

            const formattedMessages = await Promise.all(validMessages.map(async msg => {
                const contact = await msg.getContact();
                return {
                    sender: contact.name || contact.pushname || contact.number,
                    message: msg.body,
                    timestamp: msg.timestamp
                };
            }));

            await fs.writeFile(LOG_FILE, JSON.stringify(formattedMessages, null, 2));
            console.log(`Initialized message log with ${formattedMessages.length} messages`);
        }
    } catch (error) {
        console.error('Error initializing message log:', error);
    }
}

async function logMessage(message) {
    try {
        const chat = await message.getChat();
        if (chat.name !== config.GROUP1_NAME) return;

        const contact = await message.getContact();
        const newMessage = {
            sender: contact.name || contact.pushname || contact.number,
            message: message.body,
            timestamp: message.timestamp
        };

        // Read existing messages
        let messageLog;
        try {
            messageLog = JSON.parse(await fs.readFile(LOG_FILE, 'utf8'));
        } catch {
            messageLog = [];
        }

        // Add new message at the beginning (newest first)
        messageLog.unshift(newMessage);
        
        // Keep only last MAX_LOG_MESSAGES messages
        if (messageLog.length > config.MAX_LOG_MESSAGES) {
            messageLog = messageLog.slice(0, config.MAX_LOG_MESSAGES);
        }

        await fs.writeFile(LOG_FILE, JSON.stringify(messageLog, null, 2));
    } catch (error) {
        console.error('Error logging message:', error);
    }
}

async function getMessageHistory() {
    try {
        const messageLog = JSON.parse(await fs.readFile(LOG_FILE, 'utf8'));
        const validMessages = messageLog
            .slice(-config.MAX_LOG_MESSAGES)
            .map(msg => {
                const date = new Date(msg.timestamp * 1000);
                const formattedDate = date.toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                return `[${formattedDate}] >>${msg.sender}: ${msg.message}`;
            });
            
        return validMessages.join('\n');
    } catch (error) {
        console.error('Error in getMessageHistory:', error);
        return '';
    }
}

module.exports = {
    initializeMessageLog,
    logMessage,
    getMessageHistory
};