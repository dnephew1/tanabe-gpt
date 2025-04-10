const OpenAI = require('openai');
const config = require('../configs');
const COMMAND_PROCESSOR = require('../prompts/command_processor');
const logger = require('../utils/logger');
const whitelist = require('../configs/whitelist');
const { runtimeConfig } = require('./admin');

class NLPProcessor {
    constructor() {
        this.openai = new OpenAI({
            apiKey: config.CREDENTIALS.OPENAI_API_KEY
        });
        this.wizardStates = new Map(); // Track wizard states per user
        this.welcomeMessageSent = new Map(); // Track when users received the welcome message
        logger.debug('NLP Processor initialized');
    }

    setWizardState(userId, isActive) {
        if (isActive) {
            this.wizardStates.set(userId, true);
            logger.debug('Wizard activated for user', { userId });
        } else {
            this.wizardStates.delete(userId);
            logger.debug('Wizard deactivated for user', { userId });
        }
    }

    /**
     * Checks if a welcome/marketing message should be sent to a user
     * @param {string} userId - The user ID to check
     * @returns {boolean} - True if a welcome message should be sent (hasn't been sent in the last 3 hours)
     */
    shouldSendWelcomeMessage(userId) {
        const lastWelcomeTime = this.welcomeMessageSent.get(userId);
        
        // If no welcome message has been sent or it was sent more than 3 hours ago
        if (!lastWelcomeTime || (Date.now() - lastWelcomeTime > 3 * 60 * 60 * 1000)) {
            // Update the timestamp to current time
            this.welcomeMessageSent.set(userId, Date.now());
            return true;
        }
        
        return false;
    }
    
    /**
     * Sends a marketing message to users in direct chats if they haven't received one recently
     * @param {Object} message - The message object
     * @param {Object} chat - The chat object
     * @param {string} userId - The user ID
     * @param {boolean} isCommandAttempt - Whether this is being called after a command attempt
     * @returns {boolean} - True if a message was sent
     */
    async sendWelcomeMessageIfNeeded(message, chat, userId, isCommandAttempt = false) {
        if (!chat.isGroup) {
            const lastWelcomeTime = this.welcomeMessageSent.get(userId);
            const isFirstContact = !lastWelcomeTime;
            const isExpiredContact = lastWelcomeTime && (Date.now() - lastWelcomeTime > 3 * 60 * 60 * 1000);
            
            // Only send if this is a first contact or contact after 3-hour window
            if (isFirstContact || isExpiredContact) {
                try {
                    // Format user info consistently
                    const userPhone = userId.endsWith('@c.us') ? userId.split('@')[0] : userId;
                    const contact = await message.getContact();
                    const userName = contact.pushname || contact.name || userPhone;
                    const userIdentifier = `${userName} (${userPhone})`;
                    
                    // Single consolidated log entry for first contact
                    if (isFirstContact) {
                        logger.warn(`First contact from unknown user ${userIdentifier}${isCommandAttempt ? ' - command attempt: ' + message.body : ''}`);
                    } else {
                        // For contacts after the 3-hour window
                        const lastContactTime = new Date(lastWelcomeTime).toISOString();
                        logger.info(`Contact from unauthorized user ${userIdentifier} after 3-hour window (last: ${lastContactTime})${isCommandAttempt ? ' - command attempt: ' + message.body : ''}`);
                    }
                    
                    // Update timestamp before sending the message
                    this.welcomeMessageSent.set(userId, Date.now());
                    await message.reply(config.COMMANDS.COMMAND_LIST.marketingMessage);
                    return true;
                } catch (error) {
                    logger.error('Error sending welcome message:', error);
                    return false;
                }
            }
        }
        return false;
    }

    async isAllowedChat(chat) {
        try {
            // Handle cases where chat.id might be undefined or have a different structure
            let chatId;
            if (chat.id && chat.id._serialized) {
                chatId = chat.id._serialized;
            } else if (chat.id && typeof chat.id === 'string') {
                chatId = chat.id;
            } else if (chat._serialized) {
                chatId = chat._serialized;
            } else {
                logger.error('Invalid chat object structure:', { chat });
                return false;
            }
            
            // Format location string consistently
            const locationStr = chat.isGroup ? `in ${chat.name}` : "in DM";
            
            // Check if this is a direct message from the admin
            if (chatId === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`) {
                const adminPhone = config.CREDENTIALS.ADMIN_NUMBER;
                logger.debug(`Admin access granted for NLP to user (${adminPhone}) in DM`);
                return true;
            }

            // For group chats, check against group name
            if (chat.isGroup) {
                const isAllowed = await whitelist.hasPermission('CHAT_GPT', chat.name);
                logger.debug('Checking group chat NLP permissions', {
                    chatLocation: locationStr,
                    isAllowed
                });
                return isAllowed;
            }
            
            // For DM chats, check against chat ID or special DM format
            const dmChatId = `dm.${chat.name}`;
            const isAllowed = await whitelist.hasPermission('CHAT_GPT', chat.name) || 
                            await whitelist.hasPermission('CHAT_GPT', dmChatId);
            
            // Format chat ID consistently
            const userPhone = chatId.endsWith('@c.us') ? chatId.split('@')[0] : chatId;
            
            logger.debug('Checking DM chat NLP permissions', {
                user: `User (${userPhone})`,
                chatLocation: locationStr,
                isAllowed
            });
            return isAllowed;
        } catch (error) {
            logger.error('Error checking chat permissions:', error);
            return false;
        }
    }

    async shouldProcessMessage(message) {
        try {
            // Skip processing for messages from the bot itself
            if (message.fromMe) {
                logger.debug('Skipping NLP - message from bot');
                return false;
            }
            
            // Skip processing for media messages without text
            if (message.hasMedia && (!message.body || message.body.trim() === '')) {
                logger.debug('Skipping NLP - media message without text');
                return false;
            }
            
            // Get chat information
            const chat = await message.getChat();
            const contact = await message.getContact();
            const userId = contact.id._serialized;
            const isAdmin = userId === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`;
            
            // Format user identifier consistently for logs
            const userPhone = userId.endsWith('@c.us') ? userId.split('@')[0] : userId;
            const userName = contact.pushname || contact.name || userPhone;
            const userIdentifier = `${userName} (${userPhone})`;
            
            // Admin always has access in direct messages
            if (isAdmin && !chat.isGroup) {
                logger.debug(`Processing message - admin user ${userIdentifier} in direct message`);
                return true;
            }
            
            // For group chats, only process if the bot is mentioned
            if (chat.isGroup) {
                const botNumber = config.CREDENTIALS.BOT_NUMBER;
                const isBotMentioned = message.mentionedIds && 
                                      message.mentionedIds.some(id => id === `${botNumber}@c.us`);
                
                if (!isBotMentioned) {
                    logger.debug('Skipping NLP - bot not mentioned in group chat', { 
                        chatName: chat.name,
                        messageBody: message.body
                    });
                    return false;
                }
                
                logger.debug('Bot mentioned in group chat, processing with NLP', {
                    chatName: chat.name,
                    messageBody: message.body
                });
            }
            
            // Check if NLP is allowed in this chat
            const isAllowed = await this.isAllowedChat(chat);
            
            // Generate location string consistently
            const locationStr = chat.isGroup ? `in ${chat.name}` : "in DM"; 
            
            logger.debug('NLP permission check', {
                chatLocation: locationStr,
                isAllowed,
                userIdentifier
            });

            if (!isAllowed) {
                // Send welcome message to unauthorized users in direct chats
                await this.sendWelcomeMessageIfNeeded(message, chat, userId);
                return false;
            }

            return true;
        } catch (error) {
            logger.error('Error in shouldProcessMessage:', error);
            return false;
        }
    }

    async processNaturalLanguage(message) {
        try {
            logger.debug('Starting NLP processing attempt');
            
            // Check if NLP processing is enabled
            if (!runtimeConfig.nlpEnabled) {
                logger.debug('NLP processing is disabled by configuration');
                return null;
            }
            
            // First check if we should process this message
            const shouldProcess = await this.shouldProcessMessage(message);
            logger.debug('NLP processing decision', { shouldProcess });
            
            if (!shouldProcess) {
                return null;
            }

            // Clean the message body if the bot is mentioned
            let messageBody = message.body;
            const botNumber = config.CREDENTIALS.BOT_NUMBER;
            const isBotMentioned = message.mentionedIds && 
                                  message.mentionedIds.some(id => id === `${botNumber}@c.us`);
            
            if (isBotMentioned) {
                // Remove the bot mention from the message
                messageBody = messageBody.replace(new RegExp(`@${botNumber}\\s*`, 'i'), '').trim();
                logger.debug('Cleaned message body after bot mention', {
                    original: message.body,
                    cleaned: messageBody
                });
            }
            
            // Check for common command patterns before using the API
            const lowerBody = messageBody.toLowerCase();
            
            // Check for command list requests
            if (lowerBody.includes('comandos') || 
                lowerBody.includes('o que você pode fazer') || 
                lowerBody.includes('o que voce pode fazer') ||
                lowerBody.includes('quais são seus comandos') ||
                lowerBody.includes('quais sao seus comandos') ||
                lowerBody.includes('me ajude') ||
                lowerBody.includes('help') ||
                lowerBody.includes('ajuda')) {
                logger.debug('Detected command list request via pattern matching');
                return '#COMMAND_LIST';
            }
            
            // Check for wizard mode activation
            if (lowerBody.includes('ferramentaresumo') || lowerBody.includes('ferramenta resumo')) {
                logger.debug('Detected resumo_config command via pattern matching');
                return '#ferramentaresumo';
            }
            
            // Get chat information for tag-specific commands (needed for the command list)
            const chat = await message.getChat();
            const chatName = chat.name;

            logger.debug('Processing natural language message', {
                messageId: message.id?._serialized,
                text: messageBody,
                hasQuoted: message.hasQuotedMsg,
                hasMedia: message.hasMedia,
                type: message.type
            });

            // Get list of available commands with their descriptions and prefixes
            const commandList = Object.entries(config.COMMANDS)
                .filter(([_, cmd]) => cmd.description) // Only include commands with descriptions
                .map(([name, cmd]) => {
                    const prefixes = cmd.prefixes ? cmd.prefixes.join(' or ') : 'No prefix';
                    const capabilities = this.getCommandCapabilities(cmd);
                    logger.debug('Command capability check', { command: name, capabilities });
                    
                    // Add tag information for the TAG command
                    if (name === 'TAG' && chat.isGroup) {
                        let tagInfo = '';
                        
                        // Add special tags
                        if (cmd.specialTags && Object.keys(cmd.specialTags).length > 0) {
                            tagInfo += '\n    Special Tags: ' + Object.keys(cmd.specialTags).join(', ');
                            
                            // Add descriptions for special tags
                            tagInfo += '\n    Special Tag Descriptions:';
                            for (const [tag, tagConfig] of Object.entries(cmd.specialTags)) {
                                tagInfo += `\n      ${tag}: ${tagConfig.description || 'No description'}`;
                            }
                        }
                        
                        // Add group-specific tags
                        if (cmd.groupTags && cmd.groupTags[chatName] && Object.keys(cmd.groupTags[chatName]).length > 0) {
                            tagInfo += '\n    Group Tags: ' + Object.keys(cmd.groupTags[chatName]).join(', ');
                            
                            // Add details about each group tag
                            tagInfo += '\n    Tag Details:';
                            for (const [tag, tagConfig] of Object.entries(cmd.groupTags[chatName])) {
                                // Get description and members from config
                                const description = tagConfig.description || 'No description';
                                const members = Array.isArray(tagConfig.members) ? tagConfig.members.join(', ') : 'No members';
                                tagInfo += `\n      ${tag}: ${description} (${members})`;
                            }
                        }
                        
                        return `${name}:
    Description: ${cmd.description}
    Usage: No prefix (use @tagname)
    Supports: ${capabilities}${tagInfo}`;
                    }
                    
                    return `${name}:
    Description: ${cmd.description}
    Usage: ${prefixes}
    Supports: ${capabilities}`;
                })
                .join('\n\n');

            logger.debug('Built command list for NLP');

            // Prepare message context
            const messageContext = await this.buildMessageContext(message);
            logger.debug('Built message context', { context: messageContext });

            // Prepare the prompt
            const prompt = COMMAND_PROCESSOR.ANALYZE
                .replace('{commandList}', commandList)
                .replace('{messageContext}', messageContext);

            // Log the prompt only if PROMPT logging is enabled
            if (config.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT === true) {
                logger.prompt('[PROMPT] Sending prompt to OpenAI:', prompt);
            }

            // Call OpenAI API
            const completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: prompt }
                ]
            });

            // Get the command from the response
            const processedCommand = completion.choices[0].message.content.trim();
            
            // Log the response only if PROMPT logging is enabled
            if (config.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT === true) {
                logger.prompt('[RESPONSE] Received from OpenAI:', processedCommand);
            }
            
            // Parse the command
            if (processedCommand.startsWith('#')) {
                // Extract command name and input - modified to handle whitespace after #
                // First remove the # and any whitespace after it
                const cleanedCommand = processedCommand.replace(/^#\s*/, '').trim();
                const commandParts = cleanedCommand.split(/\s+/);
                let commandName = commandParts[0].toUpperCase();
                const commandInput = commandParts.slice(1).join(' ');
                
                // Map command names to their actual command prefixes
                const commandMap = {
                    'AYUB_NEWS': 'ayubnews',
                    'CHAT_GPT': '',  // Default command
                    'RESUMO': 'resumo',
                    'STICKER': 'sticker',
                    'DESENHO': 'desenho',
                    'COMMAND_LIST': '?',
                    'AUDIO': 'audio',
                    'RESUMO_CONFIG': 'ferramentaresumo',
                    'TWITTER_DEBUG': 'twitterdebug',
                    'RSS_DEBUG': 'rssdebug',
                    'FORCE_SUMMARY': 'forcesummary',
                    'CACHE_CLEAR': 'clearcache'
                };
                
                // Get the actual command prefix
                const actualCommand = commandMap[commandName] || commandName.toLowerCase();
                
                logger.info(`NLP detected command: ${commandName} with input: ${commandInput}`);
                logger.debug(`Mapped to actual command: #${actualCommand}`);
                
                // Return the properly formatted command
                return `#${actualCommand} ${commandInput}`.trim();
            } else if (processedCommand.startsWith('@')) {
                logger.info(`NLP detected tag command: ${processedCommand}`);
                return processedCommand;
            }
            
            // Special handling for resumo_config command
            if (processedCommand.toLowerCase().startsWith('#ferramentaresumo')) {
                const contact = await message.getContact();
                this.setWizardState(contact.id._serialized, true);
                logger.debug('Wizard mode activated from NLP command');
            }
            
            return processedCommand;
        } catch (error) {
            logger.error('Error processing natural language command:', error);
            throw error;
        }
    }

    getCommandCapabilities(cmd) {
        logger.debug('Getting command capabilities for command description');
        const capabilities = [];
        
        // Check if command supports quoted messages
        if (cmd.description.toLowerCase().includes('cite uma mensagem') || 
            cmd.description.toLowerCase().includes('mensagem citada')) {
            capabilities.push('quoted_messages');
        }
        
        // Check if command supports media
        if (cmd.description.toLowerCase().includes('imagem') || 
            cmd.description.toLowerCase().includes('documento') ||
            cmd.description.toLowerCase().includes('áudio') ||
            cmd.description.toLowerCase().includes('sticker')) {
            capabilities.push('media');
        }
        
        // Check if command supports links
        if (cmd.description.toLowerCase().includes('link')) {
            capabilities.push('links');
        }

        logger.debug('Command capabilities determined', { capabilities });
        return capabilities.length > 0 ? capabilities.join(', ') : 'text_only';
    }

    async buildMessageContext(message) {
        try {
            // Clean the message body if the bot is mentioned
            let messageBody = message.body;
            const botNumber = config.CREDENTIALS.BOT_NUMBER;
            const isBotMentioned = message.mentionedIds && 
                                  message.mentionedIds.some(id => id === `${botNumber}@c.us`);
            
            if (isBotMentioned) {
                // Remove the bot mention from the message
                messageBody = messageBody.replace(new RegExp(`@${botNumber}\\s*`, 'i'), '').trim();
            }
            
            const context = {
                text: messageBody,
                hasQuotedMsg: message.hasQuotedMsg || false,
                hasMedia: message.hasMedia || false
            };

            // Add quoted message info if available
            if (message.hasQuotedMsg) {
                try {
                    const quotedMsg = await message.getQuotedMessage();
                    context.quotedMsgId = quotedMsg.id._serialized;
                    context.quotedText = quotedMsg.body;
                    
                    // Add media info for quoted message
                    if (quotedMsg.hasMedia) {
                        context.quotedMediaType = quotedMsg.type;
                        context.quotedMediaId = quotedMsg.id._serialized;
                    }
                } catch (error) {
                    logger.error('Error getting quoted message:', error);
                }
            }

            // Add media info if available
            if (message.hasMedia) {
                context.mediaType = message.type;
                context.mediaId = message.id._serialized;
            }

            return JSON.stringify(context);
        } catch (error) {
            logger.error('Error building message context:', error);
            return JSON.stringify({ text: message.body });
        }
    }
}

module.exports = new NLPProcessor(); 