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
                const botNumber = config.CREDENTIALS.BOT_NUMBER;
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

            logger.debug('Processing natural language message', {
                messageId: message.id?._serialized,
                text: message.body,
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
                logger.info(`NLP detected command: ${commandName} with input: ${commandParts.slice(1).join(' ')}`);
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
        logger.debug('Building message context');
        const context = {
            text: message.body,
            hasQuotedMsg: message.hasQuotedMsg,
            quotedMsgId: null,
            quotedText: null,
            hasMedia: message.hasMedia,
            mediaType: message.type,
            mediaId: null
        };

        // Get quoted message details if exists
        if (message.hasQuotedMsg) {
            try {
                const quotedMsg = await message.getQuotedMessage();
                context.quotedMsgId = quotedMsg.id._serialized;
                context.quotedText = quotedMsg.body;
                logger.debug('Retrieved quoted message details', {
                    quotedMsgId: context.quotedMsgId,
                    quotedText: context.quotedText
                });
            } catch (error) {
                logger.error('Error getting quoted message:', error);
            }
        }

        // Get media details if exists
        if (message.hasMedia) {
            try {
                const media = await message.downloadMedia();
                context.mediaId = message.id._serialized;
                logger.debug('Retrieved media details', {
                    mediaId: context.mediaId,
                    mediaType: context.mediaType
                });
            } catch (error) {
                logger.error('Error getting media:', error);
            }
        }

        return JSON.stringify(context);
    }
}

module.exports = new NLPProcessor(); 