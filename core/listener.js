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
        
        // Make sure NLP processor is available globally
        if (!global.nlpProcessor) {
            logger.debug('Initializing NLP processor');
            global.nlpProcessor = nlpProcessor;
        }
        
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

                // Check if the bot is mentioned
                const botNumber = config.CREDENTIALS.BOT_NUMBER;
                const isBotMentioned = message.mentionedIds && 
                                      message.mentionedIds.some(id => id === `${botNumber}@c.us`);
                
                if (isBotMentioned) {
                    logger.debug('Bot was mentioned, processing with command manager', {
                        messageBody: message.body,
                        mentions: message.mentionedIds
                    });
                    await chat.sendStateTyping();
                    const result = await commandManager.processCommand(message);
                    if (!result) {
                        logger.debug('Command processing failed for bot mention');
                    }
                    return;
                }

                // Check for traditional command syntax (messages starting with # or !)
                if (message.body.startsWith('#') || message.body.startsWith('!')) {
                    logger.debug('Processing traditional command', { 
                        prefix: message.body[0],
                        command: message.body 
                    });
                    await chat.sendStateTyping();
                    const result = await commandManager.processCommand(message);
                    if (!result) {
                        logger.debug('Command processing failed or command not found');
                    }
                    return;
                }
                
                // Check for tag commands (messages containing @tag)
                // First check if the message contains an @ symbol
                if (message.body.includes('@')) {
                    // Extract all potential tags from the message (words starting with @)
                    const potentialTags = message.body.split(/\s+/).filter(word => word.startsWith('@') && word.length > 1);
                    
                    if (potentialTags.length > 0) {
                        logger.debug('Found potential tag(s) in message', { potentialTags });
                        
                        // Check if any of the potential tags are valid before showing typing indicator
                        const { isValidTag, validTag } = await commandManager.checkValidTag(potentialTags, chat);
                        
                        if (isValidTag) {
                            logger.debug('Processing valid tag command', { 
                                tag: validTag,
                                command: message.body 
                            });
                            await chat.sendStateTyping();
                            const result = await commandManager.processCommand(message, validTag);
                            if (!result) {
                                logger.debug('Tag command processing failed');
                            }
                            return;
                        } else {
                            // If no valid tags found, just log and continue to NLP processing
                            logger.debug('No valid tags found in message, continuing to NLP processing');
                        }
                    }
                }

                // Try NLP processing
                try {
                    logger.debug('Attempting NLP processing');
                    const nlpResult = await nlpProcessor.processNaturalLanguage(message);
                    if (nlpResult) {
                        logger.debug('NLP produced a command', { nlpResult });
                        await chat.sendStateTyping();
                        
                        // Special handling for tag commands from NLP
                        if (nlpResult.startsWith('@')) {
                            logger.debug('NLP produced a tag command', { tag: nlpResult });
                            // Extract just the tag part (first word) from the NLP result
                            const tagOnly = nlpResult.split(/\s+/)[0];
                            logger.debug('Extracted tag from NLP result', { 
                                originalResult: nlpResult, 
                                extractedTag: tagOnly 
                            });
                            
                            // Create a new message object with the tag as the body
                            const tagMessage = Object.create(
                                Object.getPrototypeOf(message),
                                Object.getOwnPropertyDescriptors(message)
                            );
                            // Pass only the tag as the input parameter to the command
                            await commandManager.processCommand(tagMessage, tagOnly);
                            return;
                        }
                        
                        // For other commands, create a new message with the NLP result as the body
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
                
                // Handle audio messages
                if (['audio', 'ptt'].includes(message.type) && message.hasMedia) {
                    logger.debug('Processing audio message for transcription');
                    try {
                        const audioCommand = config.COMMANDS.AUDIO;
                        if (audioCommand) {
                            await chat.sendStateTyping();
                            // Create a new message object that preserves all methods
                            const audioMessage = Object.create(
                                Object.getPrototypeOf(message),
                                Object.getOwnPropertyDescriptors(message)
                            );
                            audioMessage.body = '#audio';
                            await commandManager.processCommand(audioMessage);
                            return;
                        }
                    } catch (error) {
                        logger.error('Error processing audio message:', error);
                    }
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
