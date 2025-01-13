const config = require('../config');
const logger = require('../utils/logger');
const { handleAutoDelete } = require('../utils/messageUtils');

async function handleTag(message, command) {
    try {
        const chat = await message.getChat();
        if (!chat.isGroup) {
            logger.debug('Tag command ignored: not a group chat');
            return;
        }

        // Extract the tag from the message
        const tag = message.body.trim().split(/\s+/)[0]; // Get the first word (the tag)
        if (!tag.startsWith('@')) {
            logger.debug('Message is not a tag command');
            return;
        }

        logger.debug('Processing tag command', {
            tag,
            groupName: chat.name,
            specialTags: Object.keys(command.specialTags),
            groupTags: chat.name in command.groupTags ? Object.keys(command.groupTags[chat.name]) : []
        });

        const participants = await chat.participants;
        let mentions = [];

        // Handle special tags
        if (tag in command.specialTags) {
            logger.debug('Processing special tag', { tag, type: command.specialTags[tag] });
            if (command.specialTags[tag] === 'all_members') {
                mentions = participants.map(p => p.id._serialized);
            } else if (command.specialTags[tag] === 'admin_only') {
                mentions = participants
                    .filter(p => p.isAdmin)
                    .map(p => p.id._serialized);
            }
        }
        // Handle group-specific tags
        else if (command.groupTags[chat.name] && tag in command.groupTags[chat.name]) {
            logger.debug('Processing group-specific tag', { tag, groupName: chat.name });
            const nameFilters = command.groupTags[chat.name][tag];
            for (const participant of participants) {
                const contact = await global.client.getContactById(participant.id._serialized);
                const contactName = contact.name || contact.pushname || '';
                if (nameFilters.some(filter => contactName.toLowerCase().includes(filter.toLowerCase()))) {
                    mentions.push(participant.id._serialized);
                }
            }
        } else {
            logger.debug('Tag not found in configuration', {
                tag,
                groupName: chat.name,
                availableSpecialTags: Object.keys(command.specialTags),
                availableGroupTags: chat.name in command.groupTags ? Object.keys(command.groupTags[chat.name]) : []
            });
            return;
        }

        if (mentions.length > 0) {
            logger.debug('Sending tag message', {
                tag,
                groupName: chat.name,
                mentionCount: mentions.length
            });
            const text = mentions.map(id => `@${id.split('@')[0]}`).join(' ');
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