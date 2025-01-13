const config = require('../config');
const logger = require('../utils/logger');
const crypto = require('crypto');

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
    parseCommand(messageBody) {
        if (!messageBody) return { command: null, input: '' };

        const trimmedBody = messageBody.trim();
        
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
            isAdmin: chatId === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us` || chatId === config.CREDENTIALS.ADMIN_NUMBER
        });

        // Admin always has access to all commands
        if (chatId === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us` || 
            chatId === config.CREDENTIALS.ADMIN_NUMBER) {
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
            const isAllowed = command.permissions.allowedIn.includes(chatId);
            logger.debug('Checking specific permissions', {
                allowedChats: command.permissions.allowedIn,
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
        const contact = await message.getContact();
        const userId = contact.id._serialized;
        const chat = await message.getChat();
        const chatId = chat.isGroup ? chat.name : message.from;

        let command = null;
        let input = '';

        // Check for tag commands first
        if (message.body.trim().startsWith('@')) {
            const tagCommand = config.COMMANDS.TAG;
            if (tagCommand) {
                command = { ...tagCommand, name: 'TAG' };
            }
        }

        // If no tag command found, check for sticker-based commands
        if (!command && message.hasMedia && message.type === 'sticker') {
            try {
                const media = await message.downloadMedia();
                if (media && media.data) {
                    // Calculate SHA-256 hash of the sticker data
                    const stickerHash = crypto.createHash('sha256')
                        .update(media.data)
                        .digest('hex');
                    
                    logger.debug('Checking sticker hash', { stickerHash });

                    // Find command with matching sticker hash
                    for (const [cmdName, cmdConfig] of Object.entries(config.COMMANDS)) {
                        if (cmdConfig.stickerHash === stickerHash) {
                            command = { ...cmdConfig, name: cmdName };
                            break;
                        }
                    }
                }
            } catch (error) {
                logger.error('Error processing sticker:', error);
            }
        }
        
        // Check for audio commands
        if (!command && message.hasMedia && ['audio', 'ptt'].includes(message.type)) {
            logger.debug('Processing audio message', {
                type: message.type,
                hasMedia: message.hasMedia
            });
            
            // Find audio command configuration
            const audioCommand = config.COMMANDS.AUDIO;
            if (audioCommand) {
                command = { ...audioCommand, name: 'AUDIO' };
            }
        }

        // If no media command found, try text-based command
        if (!command) {
            const parsed = this.parseCommand(message.body);
            command = parsed.command;
            input = parsed.input;
        }

        // Process the command if found
        if (command) {
            logger.debug('Processing command', {
                command: command.name,
                user: message.author || 'Unknown',
                chat: chat.name || 'DM',
                chatId,
                permissions: command.permissions
            });
            
            // Check permissions
            if (!await this.isCommandAllowedInChat(command, chatId)) {
                logger.warn(`Command ${command.name} not allowed in chat ${chatId}`);
                const errorMessage = await message.reply(command.errorMessages.notAllowed);
                await this.handleAutoDelete(errorMessage, command, true);
                return true;
            }

            // Log successful command after permission check
            logger.info(`${command.name} by ${message.author || 'Unknown'} in ${chat.name || 'DM'}`);

            try {
                await chat.sendStateTyping();
                const handler = this.commandHandlers.get(command.name);
                if (handler) {
                    await handler(message, command, input);
                } else {
                    logger.error(`No handler found for command: ${command.name}`);
                }
            } catch (error) {
                logger.error(`Error handling command ${command.name}:`, error);
                if (command.errorMessages?.error) {
                    const errorMessage = await message.reply(command.errorMessages.error);
                    await this.handleAutoDelete(errorMessage, command, true);
                }
            }
            return true;
        }

        return false;
    }
}

module.exports = new CommandManager(); 