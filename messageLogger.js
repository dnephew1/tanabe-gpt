const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const logger = require('./logger');

// Cache for message logs
const messageLogCache = new Map();

function getLogFileName(groupName) {
    // Replace any characters that might be invalid in filenames with underscores
    const sanitizedName = groupName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    return `messages_${sanitizedName}.json`;
}

async function getLogFile(groupName) {
    if (!groupName) return null;
    return path.join(__dirname, getLogFileName(groupName));
}

async function readMessageLog(logFile) {
    try {
        const content = await fs.readFile(logFile, 'utf8');
        return JSON.parse(content);
    } catch {
        return [];
    }
}

async function initializeMessageLog(client) {
    if (!client) {
        logger.error('Client not provided to initializeMessageLog');
        return;
    }

    if (!config.SYSTEM.MESSAGE_LOGGING.enabled) {
        logger.info('Message logging is disabled');
        return;
    }

    try {
        const chats = await client.getChats();
        const enabledGroups = Object.keys(config.SYSTEM.MESSAGE_LOGGING.groups);
        
        for (const groupName of enabledGroups) {
            const logFile = await getLogFile(groupName);
            if (!logFile) continue;

            // Initialize or validate log file
            try {
                const messages = await readMessageLog(logFile);
                messageLogCache.set(groupName, messages);
            } catch (error) {
                await fs.writeFile(logFile, '[]');
                messageLogCache.set(groupName, []);
            }

            // Find the group chat
            const group = chats.find(chat => chat.name === groupName);
            if (!group) {
                logger.warn(`Group ${groupName} not found, skipping message fetch`);
                continue;
            }

            // Fetch and process messages
            try {
                const maxMessages = config.SYSTEM.MESSAGE_LOGGING.groups[groupName].maxMessages;
                let validMessages = [];
                let fetchSize = maxMessages;
                let attempts = 0;
                const maxAttempts = 3; // Prevent infinite loops

                // Keep fetching until we have enough valid messages or hit max attempts
                while (validMessages.length < maxMessages && attempts < maxAttempts) {
                    const messages = await group.fetchMessages({ limit: fetchSize });
                    if (!messages || messages.length === 0) break;

                    const newValidMessages = messages
                        .filter(msg => !msg.fromMe && msg.body.trim())
                        .sort((a, b) => b.timestamp - a.timestamp);

                    validMessages = [...validMessages, ...newValidMessages];
                    validMessages = validMessages.slice(0, maxMessages); // Keep only what we need

                    // If we don't have enough, fetch more next time
                    if (validMessages.length < maxMessages) {
                        fetchSize = Math.ceil((maxMessages - validMessages.length) * 1.5); // Fetch extra to account for invalid messages
                        attempts++;
                    } else {
                        break;
                    }
                }

                const formattedMessages = await Promise.all(validMessages.map(async msg => {
                    const contact = await msg.getContact();
                    return {
                        sender: contact.name || contact.pushname || contact.number,
                        message: msg.body,
                        timestamp: msg.timestamp
                    };
                }));

                await fs.writeFile(logFile, JSON.stringify(formattedMessages, null, 2));
                messageLogCache.set(groupName, formattedMessages);
                logger.info(`Message logging initialized for ${groupName} with ${formattedMessages.length} messages`);
            } catch (error) {
                logger.error(`Error fetching messages for ${groupName}:`, error);
            }
        }
    } catch (error) {
        logger.error('Error initializing message logs:', error);
    }
}

async function logMessage(message) {
    try {
        const chat = await message.getChat();
        const groupConfig = config.SYSTEM.MESSAGE_LOGGING.groups[chat.name];
        if (!groupConfig) return;

        const logFile = await getLogFile(chat.name);
        if (!logFile) return;

        const contact = await message.getContact();
        const newMessage = {
            sender: contact.name || contact.pushname || contact.number,
            message: message.body,
            timestamp: message.timestamp
        };

        // Update cache and file
        let messages = messageLogCache.get(chat.name) || await readMessageLog(logFile);
        messages.unshift(newMessage);
        
        if (messages.length > groupConfig.maxMessages) {
            messages = messages.slice(0, groupConfig.maxMessages);
        }

        messageLogCache.set(chat.name, messages);
        await fs.writeFile(logFile, JSON.stringify(messages, null, 2));
        logger.debug(`Logged new message in ${chat.name}`);
    } catch (error) {
        logger.error('Error logging message:', error);
    }
}

async function getMessageHistory(groupName = null) {
    try {
        // For admin chat or when groupName is the first logged group, always return first group's messages
        if (!groupName || groupName === config.CREDENTIALS.ADMIN_NUMBER + '@c.us') {
            const firstGroup = Object.keys(config.SYSTEM.MESSAGE_LOGGING.groups)[0];
            const firstGroupLogFile = await getLogFile(firstGroup);
            const messages = messageLogCache.get(firstGroup) || await readMessageLog(firstGroupLogFile);
            return formatMessages(messages);
        }

        // For other groups, return their specific messages if logging is enabled
        const groupConfig = config.SYSTEM.MESSAGE_LOGGING.groups[groupName];
        if (!groupConfig) return '';

        const logFile = await getLogFile(groupName);
        const messages = messageLogCache.get(groupName) || await readMessageLog(logFile);
        return formatMessages(messages);
    } catch (error) {
        logger.error('Error in getMessageHistory:', error);
        return '';
    }
}

function formatMessages(messages) {
    return messages
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
        })
        .join('\n');
}

module.exports = {
    initializeMessageLog,
    logMessage,
    getMessageHistory
};