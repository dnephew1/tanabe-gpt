const logger = require('../utils/logger');
const { handleAutoDelete } = require('../utils/messageUtils');

async function handleTag(message, command, input) {
    try {
        const chat = await message.getChat();
        if (!chat.isGroup) {
            logger.debug('Tag command ignored: not a group chat');
            return;
        }

        // Extract the tag from the message or input
        // If input is provided and starts with @, use it (from NLP or valid tag detection)
        // Otherwise, get the first word from the message
        let tag;
        if (input && input.trim().startsWith('@')) {
            // For NLP input or valid tag detection, use the input as the tag
            tag = input.trim().split(/\s+/)[0]; // Get just the tag part
            logger.debug('Using tag from input', { tag, fullInput: input });
        } else {
            // For direct messages, extract the first word as the tag
            tag = message.body.trim().split(/\s+/)[0]; // Get the first word from message
            logger.debug('Extracted tag from message', { tag, fullMessage: message.body });
        }
        
        if (!tag.startsWith('@')) {
            logger.debug('Not a valid tag command');
            return;
        }

        // Get any additional text after the tag
        const additionalText = input ? 
            input.trim().substring(tag.length).trim() : 
            message.body.trim().substring(tag.length).trim();

        logger.debug('Processing tag command', {
            tag,
            additionalText,
            groupName: chat.name,
            specialTags: Object.keys(command.specialTags),
            groupTags: chat.name in command.groupTags ? Object.keys(command.groupTags[chat.name]) : []
        });

        const participants = await chat.participants;
        let mentions = [];
        let tagFound = false;
        let tagDescription = '';
        let tagType = '';

        // Handle special tags (case insensitive)
        const lowerTag = tag.toLowerCase();
        const specialTagKeys = Object.keys(command.specialTags).map(t => t.toLowerCase());
        const specialTagMatch = specialTagKeys.find(t => t === lowerTag);
        
        if (specialTagMatch) {
            const originalTag = Object.keys(command.specialTags).find(t => t.toLowerCase() === lowerTag);
            const tagConfig = command.specialTags[originalTag];
            logger.debug('Processing special tag', { tag: originalTag, type: tagConfig.type });
            tagFound = true;
            tagType = tagConfig.type;
            
            // Get the tag description from config
            tagDescription = tagConfig.description || '';
            
            if (tagConfig.type === 'all_members') {
                mentions = participants.map(p => p.id._serialized);
            } else if (tagConfig.type === 'admin_only') {
                mentions = participants
                    .filter(p => p.isAdmin)
                    .map(p => p.id._serialized);
            }
        }
        // Handle group-specific tags (case insensitive)
        else if (command.groupTags[chat.name]) {
            const groupTagKeys = Object.keys(command.groupTags[chat.name]).map(t => t.toLowerCase());
            const groupTagMatch = groupTagKeys.find(t => t === lowerTag);
            
            if (groupTagMatch) {
                const originalTag = Object.keys(command.groupTags[chat.name]).find(t => t.toLowerCase() === lowerTag);
                const tagConfig = command.groupTags[chat.name][originalTag];
                logger.debug('Processing group-specific tag', { tag: originalTag, groupName: chat.name });
                tagFound = true;
                tagType = 'group_specific';
                
                // Get the tag description from config
                tagDescription = tagConfig.description || '';
                
                for (const participant of participants) {
                    const contact = await global.client.getContactById(participant.id._serialized);
                    const contactName = contact.name || contact.pushname || '';
                    if (tagConfig.members.some(filter => 
                        contactName.toLowerCase().includes(filter.toLowerCase()))) {
                        mentions.push(participant.id._serialized);
                    }
                }
            }
        }
        
        if (!tagFound) {
            logger.debug('Tag not found in configuration', {
                tag,
                groupName: chat.name,
                availableSpecialTags: Object.keys(command.specialTags),
                availableGroupTags: chat.name in command.groupTags ? Object.keys(command.groupTags[chat.name]) : []
            });
            
            // Group available tags by type for a more helpful message
            const specialTags = Object.keys(command.specialTags);
            const groupTags = command.groupTags[chat.name] ? Object.keys(command.groupTags[chat.name]) : [];
            
            let helpMessage = `Tag "${tag}" não encontrada.\n\n`;
            
            if (specialTags.length > 0) {
                // Group special tags by type
                const allMembersTags = specialTags.filter(t => command.specialTags[t].type === 'all_members');
                const adminTags = specialTags.filter(t => command.specialTags[t].type === 'admin_only');
                
                if (allMembersTags.length > 0) {
                    helpMessage += `*Tags para todos:* ${allMembersTags.join(', ')}\n`;
                }
                
                if (adminTags.length > 0) {
                    helpMessage += `*Tags para admins:* ${adminTags.join(', ')}\n`;
                }
            }
            
            if (groupTags.length > 0) {
                helpMessage += `*Tags do grupo:* ${groupTags.join(', ')}`;
            }
            
            const errorMessage = await message.reply(helpMessage);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        if (mentions.length > 0) {
            logger.debug('Sending tag message', {
                tag,
                groupName: chat.name,
                mentionCount: mentions.length,
                additionalText
            });
            
            // Create a descriptive message
            let text = '';
            
            // Add any additional text from the message
            if (additionalText) {
                text += additionalText;
            }
            
            // Add the mentions
            if (text) {
                text += '\n\n';
            }
            text += mentions.map(id => `@${id.split('@')[0]}`).join(' ');
            
            await chat.sendMessage(text, {
                mentions,
                quotedMessageId: message.id._serialized
            });
        } else {
            logger.debug('No matches found for tag', {
                tag,
                groupName: chat.name
            });
            const errorMessage = await message.reply(command.errorMessages.noMatches);
            await handleAutoDelete(errorMessage, command, true);
        }
    } catch (error) {
        logger.error('Error in TAG command:', error);
        const errorMessage = await message.reply(command.errorMessages.error || 'An error occurred while processing the tag.');
        await handleAutoDelete(errorMessage, command, true);
    }
}

module.exports = {
    handleTag
}; 