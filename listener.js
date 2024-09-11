// listener.js

const { config, extractLinks, notifyAdmin } = require('./dependencies');
const {
    handleResumoCommand,
    handleAyubNewsCommand,
    handleCommandList,
    handleHashTagCommand,
    handleDesenhoCommand,
    handleStickerMessage,
    handleAyubLinkSummary,
    handleCacheClearCommand,
    handleStickerCreation
} = require('./commands');
const { handleCorrenteResumoCommand } = require('./periodicSummary');

function setupListeners(client) {
    // Handle incoming messages
    client.on('message', async message => {
        try {
            const chat = await message.getChat();
            const messageBody = message.body.trim();
            const contact = await message.getContact();
            const contactName = contact.pushname || contact.name || contact.number;
            const input = messageBody.split(' ');
            const inputLower = input.map(item => item.toLowerCase());
            const isGroup1 = chat.name === config.GROUP1_NAME;
            const isGroup2 = chat.name === config.GROUP2_NAME;
            const isAdminChat = message.from === `${config.ADMIN_NUMBER}@c.us`;
            
            let commandHandled = false;

            console.log(`Received message from ${contactName} in ${chat.name || 'private chat'}: ${messageBody}`);

            // Handle commands
            if (messageBody === '!clearcache' && isAdminChat) {
                await handleCacheClearCommand(message);
                commandHandled = true;
            } else if (isGroup1 || isAdminChat || !chat.isGroup) {
                commandHandled = await handleCommonCommands(message, inputLower, input);
                if (!commandHandled && (isGroup1 || isAdminChat)) {
                    commandHandled = await handleGroup1Commands(message, inputLower, input, contactName, isGroup1);
                }
////////////////////////////////////////////////////////////////////////////////////////////////////////
            } else if (isGroup2) {
                commandHandled = await handleGroup2Commands(message, inputLower, input);
            }
////////////////////////////////////////////////////////////////////////////////////////////////////////
            // Handle mentions/tags
            if (!commandHandled && message.body.includes('@')) {
                await handleTags(message, chat);
            }
        } catch (error) {
            console.error('An error occurred while processing a message:', error);
            await notifyAdmin(`Error processing message: ${error.message}`);
        }
    });

    // Handle message reactions
    client.on('message_reaction', handleMessageReaction);
}

//Commands allowed universally
async function handleCommonCommands(message, inputLower, input) {
    if (message.hasMedia && message.type === 'sticker') {
        await handleStickerMessage(message);
        return true;
    } else if (inputLower[0] === '#sticker') {
        return await handleStickerCreation(message);
    }
    return false;
}

//Group1 commands
async function handleGroup1Commands(message, inputLower, input, contactName, isGroup1) {
    if (await handleCommonCommands(message, inputLower, input)) {
        return true;
    }

    // Rest of the Group 1 specific commands
    if (inputLower[0].startsWith('#resumo')) {
        await handleResumoCommand(message, input);
        return true;
    } else if (inputLower[0].startsWith('#ayubnews')) {
        await handleAyubNewsCommand(message, input);
        return true;
    } else if (inputLower[0] === '#?') {
        await handleCommandList(message);
        return true;
    } else if (inputLower[0] === '#desenho' || inputLower[0] === '#desenho!') {
        await handleDesenhoCommand(message, inputLower[0], input.slice(1).join(' '));
        return true;
    } else if (message.body.startsWith('#')) {
        await handleHashTagCommand(message);
        return true;
    }

    // Auto-summarize links sent by Ayub or admin
    if ((contactName.includes('Rodrigo') && isGroup1) || message.from === `${config.ADMIN_NUMBER}@c.us`) {
        const links = extractLinks(message.body);
        if (links && links.length > 0) {
            for (const link of links) {
                await handleAyubLinkSummary(message, [link]);
            }
            return true;
        }
    }

    return false;
}

async function handleMessageReaction(reaction) {
    console.log('Reaction detected');
    try {
        const reactedMsgId = reaction.msgId;
        const chat = await global.client.getChatById(reaction.msgId.remote);
        const messages = await chat.fetchMessages();

        for (let message of messages) {
            if (message.id._serialized === reactedMsgId._serialized) {
                await message.delete(true);
                console.log('Deleted message:', message.body);
                break;
            }
        }
    } catch (error) {
        console.error('An error occurred in the message_reaction event handler:', error);
        await notifyAdmin(`Error handling message reaction: ${error.message}`);
    }
}

// Function to handle mentions/tags
async function handleTags(message, chat) {
    if (chat.isGroup) {
        const tagHandlers = {
            '@all': handleAllTag,
            '@admin': handleAdminTag,
            '@medicos': handleMedicosTag,
            '@engenheiros': handleEngenheirosTag,
            '@cartola': handleCartolaTag
        };

        for (const [tag, handler] of Object.entries(tagHandlers)) {
            if (message.body.toLowerCase().includes(tag)) {
                await handler(message, chat);
            }
        }
    }
}

async function handleAllTag(message, chat) {
    const mentions = await Promise.all(chat.participants.map(async (participant) => {
        return await global.client.getContactById(participant.id._serialized);
    }));
    sendTagMessage(chat, mentions, message.id._serialized);
}

async function handleAdminTag(message, chat) {
    const mentions = await Promise.all(chat.participants.map(async (participant) => {
        const contact = await global.client.getContactById(participant.id._serialized);
        return participant.isAdmin ? contact : null;
    }));
    sendTagMessage(chat, mentions.filter(Boolean), message.id._serialized);
}

async function handleMedicosTag(message, chat) {
    const mentions = await Promise.all(chat.participants.map(async (participant) => {
        const contact = await global.client.getContactById(participant.id._serialized);
        return (contact.name.includes('Maddi') || contact.name.includes('Costa')) ? contact : null;
    }));
    sendTagMessage(chat, mentions.filter(Boolean), message.id._serialized);
}

async function handleEngenheirosTag(message, chat) {
    const mentions = await Promise.all(chat.participants.map(async (participant) => {
        const contact = await global.client.getContactById(participant.id._serialized);
        return (contact.name.includes('Ormundo') || contact.name.includes('João') || contact.name.includes('Ricardo') || contact.name.includes('Parolin') || contact.name.includes('Boacnin')) ? contact : null;
    }));
    sendTagMessage(chat, mentions.filter(Boolean), message.id._serialized);
}

async function handleCartolaTag(message, chat) {
    const mentions = await Promise.all(chat.participants.map(async (participant) => {
        const contact = await global.client.getContactById(participant.id._serialized);
        return (contact.name.includes('Madasi') || contact.name.includes('Boacnin') || contact.name.includes('Costa') || contact.name.includes('Dybwad') || contact.name.includes('Ricardo') || contact.name.includes('Parolin')) ? contact : null;
    }));
    sendTagMessage(chat, mentions.filter(Boolean), message.id._serialized);
}

// Function to send tag message
function sendTagMessage(chat, mentions, quotedMessageId) {
    let text = mentions.map(contact => `@${contact.number}`).join(' ');
    chat.sendMessage(text, {
        mentions,
        quotedMessageId
    });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
async function handleGroup2Commands(message, inputLower, input) {
    if (inputLower[0].startsWith('#resumo')) {
        await handleCorrenteResumoCommand(message, input);
        return true;
    }
    return false;
}
////////////////////////////////////////////////////////////////////////////////////////////////////////

module.exports = {
    setupListeners
};
