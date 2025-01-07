const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

let config;
setTimeout(() => {
    config = require('./config');
}, 0);

async function initializeMessageLog() {
    try {
        // Initialize message logging for configured groups
        if (config?.SYSTEM?.MESSAGE_LOGGING?.enabled) {
            for (const groupName of Object.keys(config.SYSTEM.MESSAGE_LOGGING.groups)) {
                const messages = await getMessageHistory(groupName);
                const messageCount = messages.split('\n').length;
                logger.info(`Message logging initialized for ${groupName} with ${messageCount} messages`);
            }
        }
    } catch (error) {
        logger.error('Error initializing message log:', error);
    }
}

async function getMessageHistory(groupName = null) {
    try {
        // For admin chat or when groupName is the first logged group, use Leorogeriocosta facebook messages
        if (!groupName || groupName === config?.CREDENTIALS?.ADMIN_NUMBER + '@c.us') {
            groupName = "Leorogeriocosta facebook";
        }

        const client = global.client;
        if (!client) {
            logger.error('Client not available for message fetching');
            return '';
        }

        const chats = await client.getChats();
        const chat = chats.find(c => c.name === groupName);
        
        if (!chat) {
            logger.warn(`Chat ${groupName} not found`);
            return '';
        }

        const maxMessages = config?.COMMANDS?.CHAT_GPT?.maxMessageFetch || 1000;
        // Fetch messages with increased limit to account for invalid messages
        const messages = await chat.fetchMessages({ limit: Math.ceil(maxMessages * 1.5) }); // Fetch 50% more to ensure we get enough valid messages
        
        // Filter and get valid messages
        const validMessages = messages
            .filter(msg => !msg.fromMe && msg.body.trim())
            .slice(0, maxMessages); // Keep only first maxMessages valid messages

        // Format messages
        const formattedMessages = await Promise.all(validMessages.map(async msg => {
            const contact = await msg.getContact();
            const date = new Date(msg.timestamp * 1000);
            const formattedDate = date.toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            return `[${formattedDate}] >>${contact.name || contact.pushname || contact.number}: ${msg.body}`;
        }));

        return formattedMessages.join('\n');
    } catch (error) {
        logger.error('Error in getMessageHistory:', error);
        return '';
    }
}

module.exports = {
    getMessageHistory,
    initializeMessageLog
};