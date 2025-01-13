// listener.js

const config = require('../config');
const logger = require('../utils/logger');
const commandManager = require('./CommandManager');
const { registerCommands } = require('./CommandRegistry');
const { handleAyubLinkSummary } = require('../commands/ayub');
const { initializeTwitterMonitor } = require('../commands/twitterMonitor');
const { getUserState, handleWizard } = require('../commands/wizard');

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
                logger.debug('Processing message', {
                    chatName: chat.name,
                    chatId: chat.id._serialized,
                    messageType: message.type,
                    hasMedia: message.hasMedia
                });
                
                // Check for links first
                await handleAyubLinkSummary(message);
                
                // Handle audio messages next
                if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {
                    const command = config.COMMANDS.AUDIO;
                    if (command) {
                        try {
                            await chat.sendStateTyping();
                            const contact = await message.getContact();
                            const user = contact.name || contact.pushname || contact.number;
                            const chatType = chat.isGroup ? chat.name : 'DM';
                            logger.info(`Audio Transcription by ${user} in ${chatType}`);
                            await commandManager.processCommand(message);
                        } catch (error) {
                            logger.error('Error processing audio command:', error);
                            await message.reply(command.errorMessages?.error || 'An error occurred while processing the audio.');
                        }
                        return;
                    }
                }

                // Process other commands
                const isCommand = await commandManager.processCommand(message);
                if (isCommand) {
                    await chat.sendStateTyping();
                } else {
                    // Check for active wizard session
                    const userState = getUserState(message.author || message.from);
                    if (userState && userState.state !== 'INITIAL') {
                        await chat.sendStateTyping();
                        await handleWizard(message);
                    }
                }

            } catch (error) {
                logger.error('Error in message handler:', error);
                try {
                    await message.reply('An error occurred while processing your message.');
                } catch (replyError) {
                    logger.error('Error sending error reply:', replyError);
                }
            } finally {
                if (chat) {
                    try {
                        await chat.clearState();
                    } catch (error) {
                        logger.error('Error clearing chat state:', error);
                    }
                }
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
            logger.info('Client state changed to:', state);
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
