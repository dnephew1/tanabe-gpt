// listener.js

const { config, extractLinks, crypto } = require('./dependencies');
const logger = require('./logger');
const { processCommand } = require('./commandHandler');

function setupListeners(client) {
    logger.info('[SETUP] Setting up message listeners...');

    // Handle incoming messages
    client.on('message', async (message) => {
        logger.debug('Received message', {
            from: message.from,
            body: message.body,
            hasMedia: message.hasMedia,
            type: message.type,
            fromMe: message.fromMe
        });

        try {
            const userId = message.from;
            const isCommand = message.body.startsWith('#') || message.body.startsWith('@') || message.body.startsWith('!');
            const hasActiveSession = config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];

            if (isCommand || hasActiveSession) {
                const contact = await message.getContact();
                const user = contact.name || contact.pushname || contact.number;
                logger.command(message.body, user);
                await processCommand(message);
            }
        } catch (error) {
            logger.error('Error processing message', error);
        }
    });

    // Handle message reactions
    client.on('message_reaction', async (reaction) => {
        logger.debug('Received message_reaction event', {
            emoji: reaction.reaction,
            messageId: reaction.msgId._serialized,
            senderId: reaction.senderId,
            fromMe: reaction.msgId.fromMe,
            chatId: reaction.msgId.remote
        });
        
        try {
            // If the reacted message was from the bot, delete it
            if (reaction.msgId.fromMe) {
                logger.debug('Message was from bot, getting chat');
                
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
                    messageBody: message?.body // Log entire message body
                });
                
                if (message) {
                    logger.debug('Attempting to delete message');
                    await message.delete(true);
                    logger.info('Successfully deleted message after reaction');
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

    // Set up other event handlers
    client.on('group-join', async (notification) => {
        logger.debug('[GROUP] Group join notification received');
    });

    client.on('group-leave', async (notification) => {
        logger.debug('[GROUP] Group leave notification received');
    });

    logger.info('[SETUP] All listeners setup successfully');
}

module.exports = setupListeners;
