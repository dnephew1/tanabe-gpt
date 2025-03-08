const OpenAI = require('openai');
const config = require('../config');
const COMMAND_PROCESSOR = require('../prompts/command_processor');
const logger = require('../utils/logger');

class NLPProcessor {
    constructor() {
        this.openai = new OpenAI({
            apiKey: config.CREDENTIALS.OPENAI_API_KEY
        });
        this.wizardStates = new Map(); // Track wizard states per user
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

    async isAllowedChat(chat) {
        try {
            // Check if chat is allowed to use ChatGPT (which means it can use NLP)
            const chatGptCommand = config.COMMANDS.CHAT_GPT;
            if (!chatGptCommand || !chatGptCommand.permissions) return false;

            const chatId = chat.id._serialized;
            const isAdmin = chatId === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`;

            // Admin always has access
            if (isAdmin) {
                logger.debug('Admin access granted for NLP');
                return true;
            }

            // Check if allowed in all chats
            if (chatGptCommand.permissions.allowedIn === 'all') {
                logger.debug('NLP allowed in all chats');
                return true;
            }

            // Check specific chat permissions
            if (Array.isArray(chatGptCommand.permissions.allowedIn)) {
                // For group chats, check against group name
                if (chat.isGroup) {
                    const isAllowed = chatGptCommand.permissions.allowedIn.includes(chat.name);
                    logger.debug('Checking group chat NLP permissions', {
                        groupName: chat.name,
                        isAllowed
                    });
                    return isAllowed;
                }
                
                // For DM chats, check against chat ID
                const isAllowed = chatGptCommand.permissions.allowedIn.includes(chatId);
                logger.debug('Checking DM chat NLP permissions', {
                    chatId,
                    isAllowed
                });
                return isAllowed;
            }

            return false;
        } catch (error) {
            logger.error('Error checking chat permissions:', error);
            return false;
        }
    }

    async shouldProcessMessage(message) {
        try {
            // Skip if message starts with any command prefix (use traditional command processing)
            if (message.body.startsWith('#') || message.body.startsWith('!')) {
                logger.debug('Skipping NLP - message uses command prefix', { 
                    prefix: message.body[0],
                    body: message.body 
                });
                return false;
            }

            // Check if the bot is mentioned
            const botNumber = config.CREDENTIALS.BOT_NUMBER;
            const isBotMentioned = message.mentionedIds && 
                                  message.mentionedIds.some(id => id === `${botNumber}@c.us`);
            
            // If the bot is mentioned, always process with NLP
            if (isBotMentioned) {
                logger.debug('Processing with NLP - bot was mentioned', {
                    messageBody: message.body
                });
                return true;
            }

            // Skip if message is a direct tag command (handled by tag.js)
            if (message.body.startsWith('@') && message.body.split(' ')[0].length > 1) {
                logger.debug('Skipping NLP - direct tag command detected', {
                    tag: message.body.split(' ')[0]
                });
                return false;
            }

            // Skip audio messages - let them be handled by audio transcription
            if (message.type === 'audio' || message.type === 'ptt') {
                logger.debug('Skipping NLP - audio message will be handled by transcription', { 
                    type: message.type,
                    hasMedia: message.hasMedia 
                });
                return false;
            }

            const chat = await message.getChat();
            const contact = await message.getContact();
            const userId = contact.id._serialized;
            const isAdminDM = !chat.isGroup && userId === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`;

            // Skip if message starts with "/" in admin DM
            if (isAdminDM && message.body.startsWith('/')) {
                logger.debug('Skipping NLP - admin debug message', { 
                    userId,
                    messageBody: message.body 
                });
                return false;
            }

            logger.debug('NLP pre-processing check', {
                isGroup: chat.isGroup,
                userId,
                chatId: chat.id._serialized,
                messageBody: message.body,
                hasQuoted: message.hasQuotedMsg,
                hasMedia: message.hasMedia,
                fromMe: message.fromMe,
                mentions: message.mentionedIds || []
            });

            // Check if user is in wizard mode
            if (this.wizardStates.has(userId)) {
                logger.debug('Skipping NLP - user in wizard mode', { userId });
                return false;
            }

            // Check if chat is allowed to use NLP
            const isAllowed = await this.isAllowedChat(chat);
            logger.debug('NLP permission check', {
                chatId: chat.id._serialized,
                chatName: chat.name,
                isGroup: chat.isGroup,
                isAllowed
            });

            if (!isAllowed) {
                logger.debug('Skipping NLP - chat not allowed', { 
                    chatId: chat.id._serialized,
                    chatName: chat.name
                });
                return false;
            }

            // For group chats, check for bot mention
            if (chat.isGroup) {
                // Check if message mentions the bot
                const mentions = message.mentionedIds || [];
                const botId = `${botNumber}@c.us`;
                
                logger.debug('Checking bot mention', {
                    mentions,
                    botNumber,
                    botId,
                    messageBody: message.body
                });
                
                const isBotMentioned = mentions.includes(botId);
                
                logger.debug('Group chat mention check result', { 
                    isGroup: true, 
                    isBotMentioned,
                    mentions,
                    botId,
                    messageBody: message.body
                });

                if (!isBotMentioned) {
                    logger.debug('Skipping NLP - bot not mentioned in group');
                    return false;
                }
                
                logger.debug('Processing group message with NLP - bot mentioned');
                return true;
            }

            // For DM chats, process all non-command messages except when in wizard mode
            logger.debug('Processing DM message with NLP', {
                chatId: chat.id._serialized,
                messageBody: message.body
            });
            return true;
        } catch (error) {
            logger.error('Error checking if message should be processed:', error);
            return false;
        }
    }

    async processNaturalLanguage(message) {
        try {
            logger.debug('Starting NLP processing attempt');
            
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
                                const members = tagConfig.members.join(', ');
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

            logger.prompt('[PROMPT] Sending prompt to OpenAI:\n------- PROMPT START -------\n' + prompt + '\n-------- PROMPT END --------');

            // Call OpenAI API
            const completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: prompt }
                ]
            });

            // Get the command from the response
            const processedCommand = completion.choices[0].message.content.trim();
            logger.prompt('[RESPONSE] Received from OpenAI:\n------- RESPONSE START -------\n' + processedCommand + '\n-------- RESPONSE END --------');
            
            if (processedCommand.startsWith('#')) {
                const commandParts = processedCommand.slice(1).trim().split(' ');
                const commandName = commandParts[0].toUpperCase();
                const commandInput = commandParts.slice(1).join(' ');
                logger.info(`NLP detected command: ${commandName} with input: ${commandInput}`);
            } else if (processedCommand.startsWith('@')) {
                logger.info(`NLP detected tag command: ${processedCommand}`);
            }
            
            // Special handling for resumo_config command
            if (processedCommand.startsWith('#ferramentaresumo')) {
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