const config = require('../configs');
const logger = require('../utils/logger');
const { handleAutoDelete } = require('../utils/messageUtils');
const commandManager = require('../core/CommandManager');
const whitelist = require('../configs/whitelist');

async function handleCommandList(message, command) {
    try {
        logger.debug('Processing command list request');
        const chat = await message.getChat();
        const contact = await message.getContact();
        const userId = contact.id._serialized;
        const chatId = chat.isGroup ? chat.name : message.from;

        logger.debug('Building command list for chat', {
            chatId,
            userId,
            isGroup: chat.isGroup
        });

        // First, check each command's permission
        const commandEntries = Object.entries(config.COMMANDS);
        const commandChecks = await Promise.all(commandEntries.map(async ([name, cmd]) => {
            // Skip commands without prefixes (like TAG)
            if (name === 'TAG') return { name, cmd, allowed: chat.isGroup };
            if (!cmd.prefixes || !cmd.prefixes.length) return { name, cmd, allowed: false };
            
            // Check if user has permission using the whitelist
            const allowed = await whitelist.hasPermission(name, chatId, userId);
            return { name, cmd, allowed };
        }));
        
        // Filter allowed commands and build the list
        const availableCommands = await Promise.all(
            commandChecks
                .filter(item => item.allowed)
                .map(async ({ name, cmd }) => {
                    // Double check with CommandManager's permission check
                    const isAllowed = await commandManager.isCommandAllowedInChat({ ...cmd, name }, chatId, userId);
                    if (!isAllowed) return null;

                    if (name === 'TAG') {
                        // Build tag list
                        let tagList = [];
                        
                        // Add special tags
                        if (cmd.specialTags) {
                            Object.entries(cmd.specialTags).forEach(([tag]) => {
                                tagList.push(tag);
                            });
                        }
                        
                        // Add group-specific tags
                        if (cmd.groupTags && cmd.groupTags[chatId]) {
                            Object.keys(cmd.groupTags[chatId]).forEach(tag => {
                                tagList.push(tag);
                            });
                        }
                        
                        if (tagList.length > 0) {
                            return `Tags disponíveis:\n${tagList.join('\n')}`;
                        }
                        return null;
                    }

                    const prefix = cmd.prefixes[0]; // Use first prefix as example
                    return `*${prefix}* - ${cmd.description}`;
                })
        );

        // Filter out null entries and join
        const commandList = availableCommands.filter(cmd => cmd !== null).join('\n\n');

        logger.debug('Sending command list', {
            commandCount: commandList.split('\n').length
        });

        const response = await message.reply(
            '📋 *Lista de Comandos Disponíveis*\n\n' + commandList
        );
        
        await handleAutoDelete(response, command);
    } catch (error) {
        logger.error('Error in command list handler:', error);
        const errorMessage = await message.reply(command.errorMessages.error);
        await handleAutoDelete(errorMessage, command, true);
    }
}

module.exports = {
    handleCommandList
}; 