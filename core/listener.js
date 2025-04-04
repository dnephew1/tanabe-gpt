// listener.js

const config = require('../configs');
const logger = require('../utils/logger');
const commandManager = require('./CommandManager');
const { registerCommands } = require('./CommandRegistry');
const { handleAyubLinkSummary } = require('../commands/ayub');
const { initializeNewsMonitor } = require('../commands/newsMonitor');
const { getUserState, handleWizard } = require('../commands/wizard');
const nlpProcessor = require('../commands/nlpProcessor');
const crypto = require('crypto');
const { handleTag } = require('../commands/tag');
const { getWizardWelcomeMessage } = require('../utils/envUtils');

// Get phone numbers from environment variables
const PHONE_DS1 = process.env.PHONE_DS1;
const PHONE_DS2 = process.env.PHONE_DS2;

// Track bot startup time - use let instead of const to allow reassignment
let startupTime = null;

// Helper function to handle sticker messages
async function handleStickerMessage(message) {
    try {
        // Skip if message doesn't have media or isn't a sticker
        if (!message.hasMedia || message.type !== 'sticker') {
            return false;
        }
        
        logger.debug('Processing sticker message');
        
        // Download the sticker media
        const stickerData = await message.downloadMedia();
        if (!stickerData || !stickerData.data) {
            logger.debug('Failed to download sticker data');
            return false;
        }
        
        // Calculate the sticker hash
        const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');
        logger.debug('Calculated sticker hash', { hash });
        
        // Check for matching sticker hashes in command configs
        let matchedCommand = null;
        let commandName = null;
        
        // Check each command for a matching sticker hash
        for (const [name, cmd] of Object.entries(config.COMMANDS)) {
            if (cmd.stickerHash && cmd.stickerHash === hash) {
                matchedCommand = cmd;
                commandName = name;
                break;
            }
        }
        
        if (!matchedCommand) {
            logger.debug('No matching command found for sticker hash', { hash });
            return false;
        }
        
        logger.info(`Sticker matched command: ${commandName}`, { hash });
        
        // Create a new message object with the command prefix
        const commandMessage = Object.create(
            Object.getPrototypeOf(message),
            Object.getOwnPropertyDescriptors(message)
        );
        
        // Set the message body to the command prefix
        if (matchedCommand.prefixes && matchedCommand.prefixes.length > 0) {
            commandMessage.body = matchedCommand.prefixes[0];
        } else {
            // For commands without prefixes (like TAG)
            commandMessage.body = `#${commandName.toLowerCase()}`;
        }
        
        // Process the command
        const chat = await message.getChat();
        await chat.sendStateTyping();
        const result = await commandManager.processCommand(commandMessage);
        
        return result;
    } catch (error) {
        logger.error('Error processing sticker message:', error);
        return false;
    }
}

/**
 * Check if a welcome message was sent to a user in the last hour
 * @param {Object} chat - The chat object
 * @param {string} contactId - The contact ID
 * @returns {Promise<boolean>} - Whether a welcome message was sent in the last hour
 */
async function wasWelcomeMessageSentRecently(chat, contactId) {
    try {
        // Calculate timestamp for 1 hour ago
        const oneHourAgo = new Date();
        oneHourAgo.setHours(oneHourAgo.getHours() - 1);
        
        // Fetch messages from the last hour (increase limit to ensure we get enough history)
        const messages = await chat.fetchMessages({ limit: 30 });
        
        // Check if any of the messages is a welcome message from the bot
        for (const msg of messages) {
            // Only check messages from the bot
            if (!msg.fromMe) continue;
            
            // Check if the message was sent in the last hour
            const msgTime = new Date(msg.timestamp * 1000);
            if (msgTime < oneHourAgo) continue;
            
            // Check if the message contains unique parts of the welcome message
            // Using multiple checks to be more robust
            const uniquePhrases = [
                "Olá, Mamãe querida",
                "#ferramentaresumo",
                "configurar um novo grupo"
            ];
            
            // If any of these phrases are found, consider it a welcome message
            if (uniquePhrases.some(phrase => msg.body.includes(phrase))) {
                logger.debug('Found recent welcome message', {
                    time: msgTime.toISOString(),
                    body: msg.body.substring(0, 30) + '...'
                });
                return true;
            }
        }
        
        logger.debug('No recent welcome message found');
        return false;
    } catch (error) {
        logger.error('Error checking for recent welcome message:', error);
        // If there's an error, assume no message was sent to be safe
        return false;
    }
}

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
            try {
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
                    
                    // Check if this is a whitelisted phone number for the wizard
                    const contactId = contact.id._serialized;
                    const isWhitelistedPhone = contactId === PHONE_DS1 || contactId === PHONE_DS2;
                    
                    if (isWhitelistedPhone && !chat.isGroup) {
                        logger.debug('Message from whitelisted phone number', { contactId });
                        
                        // First, check if this is a non-prefixed command for the wizard
                        // This ensures wizard commands work even without the #ferramentaresumo prefix
                        const userState = getUserState(contactId);
                        if (userState && userState.state !== 'INITIAL') {
                            logger.debug('Whitelisted user in wizard mode, handling wizard without prefix', { contactId, state: userState.state });
                            await handleWizard(message);
                            return;
                        }
                        
                        // Check if the message is a valid wizard command with prefix
                        if (message.body.toLowerCase().includes('#ferramentaresumo')) {
                            logger.debug('Valid wizard command detected, proceeding to wizard');
                            await handleWizard(message);
                            return;
                        }
                        
                        // If not a valid command, check if we've sent a welcome message recently
                        const recentlySent = await wasWelcomeMessageSentRecently(chat, contactId);
                        
                        if (!recentlySent) {
                            logger.debug('Sending welcome message to whitelisted phone number');
                            const welcomeMessage = getWizardWelcomeMessage();
                            await message.reply(welcomeMessage);
                            return;
                        } else {
                            logger.debug('Welcome message already sent recently, skipping');
                            return;
                        }
                    }
                    
                    // Check if this is the admin in a DM chat with a link
                    const isAdminDM = !chat.isGroup && 
                                     contact.id.user === config.CREDENTIALS.ADMIN_NUMBER && 
                                     message.body.match(/https?:\/\/[^\s]+/);
                    
                    if (isAdminDM) {
                        logger.debug('Admin DM with link detected, skipping NLP and running auto-link summary directly');
                        await handleAyubLinkSummary(message);
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
                    
                    // Check for sticker commands
                    if (message.hasMedia && message.type === 'sticker') {
                        logger.debug('Detected sticker message, checking for command mapping');
                        const result = await handleStickerMessage(message);
                        if (result) {
                            logger.debug('Sticker command processed successfully');
                            return;
                        }
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
                            
                            // Extract command name for logging
                            let commandName = "unknown";
                            if (nlpResult.startsWith('#')) {
                                const parts = nlpResult.slice(1).trim().split(/\s+/);
                                commandName = parts[0];
                            }
                            
                            logger.debug(`Executing NLP command: ${commandName}`, { 
                                originalMessage: message.body,
                                nlpCommand: nlpResult 
                            });
                            
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
                // Only delete messages reacted with praying hands emoji (🙏)
                const PRAYER_EMOJI = '🙏';
                
                // If the reaction is not the praying hands emoji, ignore it
                if (reaction.reaction !== PRAYER_EMOJI) {
                    logger.debug(`Ignoring reaction with emoji ${reaction.reaction} - only ${PRAYER_EMOJI} triggers deletion`);
                    return;
                }
                
                // If the reacted message was from the bot, delete it
                if (reaction.msgId.fromMe) {
                    logger.debug('Message was from bot and has prayer emoji reaction, getting chat');
                    
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
                        logger.info(`Successfully deleted message after reaction`);
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

        // Initialize news monitor when client is ready
        client.on('ready', async () => {
            if (config.NEWS_MONITOR.enabled) {
                logger.debug('Initializing news monitor...');
                try {
                    await initializeNewsMonitor(client);
                } catch (error) {
                    logger.error('Failed to initialize news monitor:', error);
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
