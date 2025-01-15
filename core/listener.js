// listener.js

const config = require('../config');
const logger = require('../utils/logger');
const commandManager = require('./CommandManager');
const { registerCommands } = require('./CommandRegistry');
const { handleAyubLinkSummary } = require('../commands/ayub');
const { initializeTwitterMonitor } = require('../commands/twitterMonitor');
const { getUserState, handleWizard } = require('../commands/wizard');
const nlpProcessor = require('../commands/nlpProcessor');

let startupTime = null;

function setupListeners(client) {
    try {
        // Register commands first
        registerCommands();

        // Set startup time when initializing
        startupTime = Date.now();
        
        // Set up message event handler
        client.on('message', async (message) => {
            // Skip messages from before bot startup
            if (message.timestamp * 1000 < startupTime) {
                logger.debug('Skipping message from before bot startup', {
                    messageTime: new Date(message.timestamp * 1000).toISOString(),
                    startupTime: new Date(startupTime).toISOString()
                });
                return;
            }

            let chat;
            try {
                // Get chat first
                chat = await message.getChat();
                const contact = await message.getContact();
                
                logger.debug('Message received', {
                    chatName: chat.name,
                    chatId: chat.id._serialized,
                    messageType: message.type,
                    hasMedia: message.hasMedia,
                    messageBody: message.body,
                    isGroup: chat.isGroup,
                    fromMe: message.fromMe,
                    hasQuoted: message.hasQuotedMsg,
                    mentions: message.mentionedIds || []
                });

                // Skip messages from the bot itself
                if (message.fromMe) {
                    logger.debug('Skipping message from bot');
                    return;
                }
                
                // Check for wizard state first
                const userId = contact.id._serialized;
                const userState = getUserState(userId);
                if (userState && userState.state !== 'INITIAL') {
                    logger.debug('User in wizard mode, handling wizard', { userId, state: userState.state });
                    await handleWizard(message);
                    return;
                }

                // Check for traditional command syntax first (messages starting with # or !)
                if (message.body.startsWith('#') || message.body.startsWith('!')) {
                    logger.debug('Processing traditional command', { 
                        prefix: message.body[0],
                        command: message.body 
                    });
                    const result = await commandManager.processCommand(message);
                    if (!result) {
                        logger.debug('Command processing failed or command not found');
                    }
                    return;
                }

                // Try NLP processing
                try {
                    logger.debug('Attempting NLP processing');
                    const nlpResult = await nlpProcessor.processNaturalLanguage(message);
                    if (nlpResult) {
                        logger.debug('NLP produced a command', { nlpResult });
                        // Create a new message object while preserving the original message's properties and methods
                        const nlpMessage = Object.create(
                            Object.getPrototypeOf(message),
                            Object.getOwnPropertyDescriptors(message)
                        );
                        nlpMessage.body = nlpResult;
                        await commandManager.processCommand(nlpMessage);
                        return;
                    } else {
                        logger.debug('NLP processing skipped or produced no result');
                    }
                } catch (error) {
                    logger.error('Error in NLP processing:', error);
                }
                
                // Check for links last
                await handleAyubLinkSummary(message);
                
            } catch (error) {
                logger.error('Error processing message:', error);
            }
        });

        // Handle message reactions for message deletion
        client.on('message_reaction', async (reaction) => {
            logger.debug('Received message_reaction event', {
                emoji: reaction.reaction,
                messageId: reaction.msgId._serialized,
                senderId: reaction.senderId,
                fromMe: reaction.msgId.fromMe,
                chatId: reaction.msgId.remote
            });
            
            try {
                // If the reacted message was from the bot, delete it
                if (reaction.msgId.fromMe) {
                    logger.debug('Message was from bot, getting chat');
                    
                    // Get chat using the message's remote (chat) ID instead of sender ID
                    const chat = await client.getChatById(reaction.msgId.remote);
                    logger.debug('Got chat', { 
                        chatName: chat.name,
                        chatId: chat.id._serialized,
                        isGroup: chat.isGroup
                    });
                    
                    // Fetch messages with increased limit
                    const messages = await chat.fetchMessages({
                        limit: 200  // Increased limit to find older messages
                    });
                    
                    logger.debug('Fetched messages', { count: messages.length });
                    
                    // Find our message
                    const message = messages.find(msg => msg.id._serialized === reaction.msgId._serialized);
                    logger.debug('Found message in history', { 
                        found: !!message,
                        messageId: message?.id?._serialized,
                        messageBody: message?.body
                    });
                    
                    if (message) {
                        logger.debug('Attempting to delete message');
                        await message.delete(true);
                        logger.info('Successfully deleted message after reaction');
                    } else {
                        logger.warn('Could not find message to delete', {
                            searchedId: reaction.msgId._serialized,
                            chatId: chat.id._serialized
                        });
                    }
                } else {
                    logger.debug('Message was not from bot, ignoring');
                }
            } catch (error) {
                logger.error('Failed to handle message reaction', error);
            }
        });

        client.on('message_create', async (message) => {
            // Handle message creation events if needed
            // This is typically used for messages sent by the bot itself
            logger.debug('Message created by bot');
        });

        client.on('disconnected', (reason) => {
            logger.warn('Client was disconnected:', reason);
        });

        client.on('change_state', state => {
            logger.debug('Client state changed', {
                newState: state,
                timestamp: new Date().toISOString()
            });
        });

        client.on('loading_screen', (percent, message) => {
            if (percent === 0 || percent === 100) {
                logger.debug('Loading screen:', percent, message);
            }
        });

        // Initialize Twitter monitor when client is ready
        client.on('ready', async () => {
            if (config.TWITTER.enabled) {
                logger.debug('Initializing Twitter monitor...');
                try {
                    await initializeTwitterMonitor(client);
                } catch (error) {
                    logger.error('Failed to initialize Twitter monitor:', error);
                }
            }
        });

        logger.debug('All listeners set up successfully');
    } catch (error) {
        logger.error('Error setting up listeners:', error);
        throw error;
    }
}

module.exports = {
    setupListeners
};
