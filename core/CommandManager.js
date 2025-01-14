const config = require('../config');
const logger = require('../utils/logger');
const crypto = require('crypto');
const nlpProcessor = require('../commands/nlpProcessor');

class CommandManager {
    constructor() {
        this.commandHandlers = new Map();
        this.messageQueue = [];
        this.setupAutoDelete();
    }

    // Register a command handler
    registerHandler(commandName, handler) {
        this.commandHandlers.set(commandName, handler);
    }

    // Parse command from message
    async parseCommand(messageBody, mentions = []) {
        if (!messageBody) return { command: null, input: '' };

        const trimmedBody = messageBody.trim();
        
        // Check if the bot was mentioned
        if (mentions && mentions.length > 0) {
            try {
                const botNumber = config.CREDENTIALS.BOT_NUMBER;
                const isBotMentioned = mentions.some(id => id === `${botNumber}@c.us`);
                
                if (isBotMentioned) {
                    logger.debug('Bot was mentioned, processing with NLP');
                    const nlpResult = await nlpProcessor.processNaturalLanguage({ 
                        body: trimmedBody,
                        hasQuotedMsg: false,
                        mentionedIds: mentions,
                        getChat: async () => ({ isGroup: true }),
                        getContact: async () => ({ id: { _serialized: 'unknown' } })
                    });
                    
                    if (nlpResult && nlpResult.startsWith('#')) {
                        const processedCommand = nlpResult.slice(1).trim();
                        const [commandName, ...inputParts] = processedCommand.split(' ');
                        const command = config.COMMANDS[commandName.toUpperCase()];
                        
                        if (command) {
                            return {
                                command: { ...command, name: commandName.toUpperCase() },
                                input: inputParts.join(' ')
                            };
                        }
                    }
                }
            } catch (error) {
                logger.error('Error processing NLP command:', error);
            }
        }

        // Check each command's prefixes
        for (const [commandName, command] of Object.entries(config.COMMANDS)) {
            if (!command.prefixes || !Array.isArray(command.prefixes)) continue;
            
            for (const prefix of command.prefixes) {
                // Check for exact match first
                if (trimmedBody.toLowerCase() === prefix.toLowerCase()) {
                    return { command: { ...command, name: commandName }, input: '' };
                }
                
                // Then check for prefix with additional content
                if (trimmedBody.toLowerCase().startsWith(prefix.toLowerCase() + ' ')) {
                    const input = trimmedBody.slice(prefix.length).trim();
                    logger.debug('Command parsed with input', {
                        command: commandName,
                        input: input
                    });
                    return { command: { ...command, name: commandName }, input };
                }
            }
        }

        // If message starts with # and no exact command match found, treat as ChatGPT
        if (trimmedBody.startsWith('#')) {
            const chatGptCommand = config.COMMANDS.CHAT_GPT;
            if (this.validateCommand('CHAT_GPT', chatGptCommand)) {
                return { 
                    command: { ...chatGptCommand, name: 'CHAT_GPT' }, 
                    input: trimmedBody.slice(1).trim() 
                };
            }
        }

        return { command: null, input: '' };
    }

    // Validate command configuration
    validateCommand(commandName, commandConfig) {
        if (!commandConfig) {
            logger.error(`Invalid command configuration for ${commandName}: configuration is missing`);
            return false;
        }

        // Check required properties
        if (!commandConfig.errorMessages || typeof commandConfig.errorMessages !== 'object') {
            logger.error(`Invalid command configuration for ${commandName}: errorMessages is missing or invalid`);
            return false;
        }

        // Check permissions if defined
        if (commandConfig.permissions) {
            if (commandConfig.permissions.allowedIn !== 'all' && !Array.isArray(commandConfig.permissions.allowedIn)) {
                logger.error(`Invalid command configuration for ${commandName}: permissions.allowedIn must be 'all' or an array`);
                return false;
            }
        }

        return true;
    }

    // Check if command is allowed in chat
    async isCommandAllowedInChat(command, chatId) {
        logger.debug('Checking command permissions', {
            command: command.name,
            chatId,
            permissions: command.permissions,
            isAdmin: chatId === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`
        });

        // Admin always has access to all commands
        if (chatId === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`) {
            logger.debug('Admin access granted');
            return true;
        }
        
        // Check if command allows all chats
        if (!command.permissions) {
            logger.debug('No permissions defined, allowing access');
            return true;
        }
        if (command.permissions.allowedIn === 'all') {
            logger.debug('Command allows all chats');
            return true;
        }
        
        // Check specific permissions
        if (Array.isArray(command.permissions.allowedIn)) {
            // Get chat name for group chats
            let chatName = chatId;
            if (chatId.endsWith('@g.us')) {
                try {
                    const chat = await global.client.getChatById(chatId);
                    chatName = chat.name;
                } catch (error) {
                    logger.error('Error getting chat name:', error);
                }
            }

            const isAllowed = command.permissions.allowedIn.includes(chatName);
            logger.debug('Checking specific permissions', {
                allowedChats: command.permissions.allowedIn,
                chatName,
                isAllowed
            });
            return isAllowed;
        }
        
        logger.debug('No matching permission rules, denying access');
        return false;
    }

    // Handle auto-deletion of messages
    async handleAutoDelete(message, commandConfig, isError = false) {
        const shouldDelete = isError ? 
            commandConfig.autoDelete?.errorMessages : 
            commandConfig.autoDelete?.commandMessages;

        if (shouldDelete) {
            this.messageQueue.push({ 
                message, 
                timeout: config.MESSAGE_DELETE_TIMEOUT, 
                timestamp: Date.now() 
            });
        }
    }

    // Setup auto-delete interval
    setupAutoDelete() {
        setInterval(async () => {
            const now = Date.now();
            while (this.messageQueue.length > 0 && 
                   now - this.messageQueue[0].timestamp >= this.messageQueue[0].timeout) {
                const { message } = this.messageQueue.shift();
                try {
                    const chat = await message.getChat();
                    const messages = await chat.fetchMessages({ limit: 50 });
                    const messageToDelete = messages.find(msg => 
                        msg.id._serialized === message.id._serialized
                    );
                    if (messageToDelete) {
                        await messageToDelete.delete(true);
                        logger.debug(`Deleted message:`, messageToDelete.body);
                    }
                } catch (error) {
                    logger.error(`Failed to delete message:`, error);
                }
            }
        }, 60000);
    }

    // Main command processing function
    async processCommand(message) {
        try {
            // Parse the command from the message
            const mentions = message.mentionedIds || [];
            const { command, input } = await this.parseCommand(message.body, mentions);
            
            if (!command) return false;

            logger.debug('Processing command', {
                command: command.name,
                input,
                chatId: message.chat?.id?._serialized,
                hasQuoted: message.hasQuotedMsg,
                hasMedia: message.hasMedia
            });

            // Validate the command
            if (!this.validateCommand(command.name, command)) {
                logger.warn(`Invalid command configuration for ${command.name}`);
                return false;
            }

            // Get chat ID and name
            const chat = await message.getChat();
            const chatId = chat.id._serialized;

            // Check if command is allowed in this chat
            const isAllowed = await this.isCommandAllowedInChat(command, chatId);
            if (!isAllowed) {
                logger.warn(`Command ${command.name} not allowed in chat ${chatId}`);
                if (command.errorMessages?.notAllowed) {
                    await message.reply(command.errorMessages.notAllowed);
                }
                return false;
            }

            // Get the handler for this command
            const handler = this.commandHandlers.get(command.name);
            if (!handler) {
                logger.warn(`No handler registered for command ${command.name}`);
                return false;
            }

            try {
                // Execute the command
                await handler(message, command, input);
                return true;
            } catch (error) {
                logger.error(`Error executing command ${command.name}:`, error);
                if (command.errorMessages?.error) {
                    await message.reply(command.errorMessages.error);
                }
                return false;
            }
        } catch (error) {
            logger.error('Error processing command:', error);
            return false;
        }
    }
}

module.exports = new CommandManager(); 