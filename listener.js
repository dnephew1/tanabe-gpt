// listener.js

const { config } = require('./dependencies');
const logger = require('./logger');
const { processCommand } = require('./commandHandler');
const { handleCommand } = require('./commandImplementations');

function setupListeners(client) {
    // Handle incoming messages
    client.on('message', async (message) => {
        let chat;
        try {
            // Get chat first
            chat = await message.getChat();
            
            // Send typing state
            await chat.sendStateTyping();

            // Handle audio messages first
            if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {
                const command = config.COMMANDS.AUDIO;
                if (command) {
                    try {
                        const contact = await message.getContact();
                        const user = contact.name || contact.pushname || contact.number;
                        const chatType = chat.isGroup ? chat.name : 'DM';
                        logger.info(`Audio Transcription by ${user} in ${chatType}`);
                        await handleCommand(message, { ...command, name: 'AUDIO' }, []);
                    } catch (error) {
                        logger.error('Error processing audio command:', error);
                        await message.reply(command.errorMessages?.error || 'An error occurred while processing the audio.');
                    }
                    return;
                }
            }

            // Process other commands
            await processCommand(message);

        } catch (error) {
            logger.error('Error processing message:', error);
        } finally {
            // Clear typing state only if chat was successfully retrieved
            if (chat) {
                await chat.clearState();
            }
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
                    messageBody: message?.body
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
}

module.exports = setupListeners;
