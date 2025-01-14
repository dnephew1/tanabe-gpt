const config = require('../config');
const { runCompletion } = require('../utils/openaiUtils');
const { extractLinks, unshortenLink, getPageContent } = require('../utils/linkUtils');
const { getPromptWithContext } = require('../utils/promptUtils');
const logger = require('../utils/logger');
const { handleAutoDelete } = require('../utils/messageUtils');
const { downloadAndProcessDocument } = require('../utils/documentUtils');

async function handleQuotedMessage(message, command) {
    try {
        const quotedMsg = await message.getQuotedMessage();
        
        // Check if quoted message has a document
        if (quotedMsg.hasMedia && quotedMsg.type === 'document') {
            logger.debug('Processing quoted document');
            try {
                const text = await downloadAndProcessDocument(quotedMsg);
                
                // Get prompt template for document summarization
                const prompt = await getPromptWithContext(message, config, 'RESUMO', 'DOCUMENT_SUMMARY', {
                    text
                });
                
                const summary = await runCompletion(prompt, 0.7);
                const response = await quotedMsg.reply(summary);
                
                // Handle auto-deletion if configured
                await handleAutoDelete(response, command);
                await handleAutoDelete(message, command);
                return;
            } catch (error) {
                logger.error('Error processing document:', error);
                const errorMessage = await message.reply(command.errorMessages.documentError);
                await handleAutoDelete(errorMessage, command, true);
                throw error;
            }
        }
        
        // Handle other quoted message types (links, text, etc.)
        const quotedText = quotedMsg.body;
        const links = extractLinks(quotedText);

        logger.debug('Processing quoted message', {
            hasLinks: links.length > 0,
            quotedTextLength: quotedText.length
        });

        if (links.length > 0) {
            try {
                logger.debug('Found link in quoted message, processing');
                const unshortenedLink = await unshortenLink(links[0]);
                const pageContent = await getPageContent(unshortenedLink);
                const prompt = await getPromptWithContext(message, config, 'RESUMO', 'LINK_SUMMARY', {
                    pageContent
                });
                const summary = await runCompletion(prompt, 1);
                const response = await quotedMsg.reply(summary);
                await handleAutoDelete(response, command);
            } catch (error) {
                logger.error('Error processing link:', error);
                const errorMessage = await message.reply(command.errorMessages.linkError);
                await handleAutoDelete(errorMessage, command, true);
            }
        } else {
            logger.debug('No links found, summarizing quoted text');
            const contact = await message.getContact();
            const name = contact.name || 'Unknown';
            const prompt = await getPromptWithContext(message, config, 'RESUMO', 'QUOTED_MESSAGE', {
                name,
                quotedText
            });
            const result = await runCompletion(prompt, 1);
            const response = await quotedMsg.reply(result.trim());
            await handleAutoDelete(response, command);
        }
    } catch (error) {
        logger.error('Error handling quoted message:', error);
        throw error;
    }
}

async function handleLastThreeHours(message) {
    const chat = await message.getChat();
    const messages = await chat.fetchMessages({ limit: 1000 });
    const threeHoursAgo = Date.now() - 3 * 3600 * 1000;
    const messagesLastThreeHours = messages.filter(m => 
        m.timestamp * 1000 > threeHoursAgo && 
        !m.fromMe && 
        m.body.trim() !== ''
    );

    if (messagesLastThreeHours.length === 0) {
        return await message.reply('Não há mensagens suficientes para gerar um resumo.');
    }

    const messageTexts = await Promise.all(messagesLastThreeHours.map(async msg => {
        const contact = await msg.getContact();
        const name = contact.name || 'Unknown';
        return `>>${name}: ${msg.body}.\n`;
    }));

    const contact = await message.getContact();
    const name = contact.name || 'Unknown';
    const prompt = await getPromptWithContext(message, config, 'RESUMO', 'HOUR_SUMMARY', {
        name,
        messageTexts: messageTexts.join(' ')
    });
    const result = await runCompletion(prompt, 1);
    return await message.reply(result.trim());
}

async function handleSpecificMessageCount(message, limit) {
    const chat = await message.getChat();
    
    if (isNaN(limit)) {
        return await message.reply('Por favor, forneça um número válido após "#resumo" para definir o limite de mensagens.')
            .catch(error => console.error('Failed to send message:', error.message));
    }

    let allValidMessages = [];
    let lastMessageId = null;
    const batchSize = Math.min(limit * 2, 100); // Fetch in smaller batches to avoid memory issues

    // Keep fetching until we have enough valid messages
    while (allValidMessages.length < limit) {
        logger.debug('Fetching messages batch', {
            currentValidCount: allValidMessages.length,
            targetCount: limit,
            batchSize,
            hasLastMessageId: !!lastMessageId
        });

        // Fetch next batch of messages
        const options = { limit: batchSize };
        if (lastMessageId) {
            options.before = lastMessageId;
        }
        const messages = await chat.fetchMessages(options);

        // If no more messages available, break
        if (!messages || messages.length === 0) {
            break;
        }

        // Filter valid messages from this batch
        const validMessagesInBatch = messages.filter(msg => 
            !msg.fromMe && 
            msg.body.trim() !== '' &&
            !msg._data.isDeleted // Skip deleted messages
        );

        // Add valid messages to our collection
        allValidMessages = allValidMessages.concat(validMessagesInBatch);

        // Update lastMessageId for next iteration
        lastMessageId = messages[messages.length - 1].id._serialized;

        // If we've fetched all available messages and still don't have enough, break
        if (messages.length < batchSize) {
            break;
        }
    }

    // Take exactly the number of messages requested or all available if less
    const messagesToSummarize = allValidMessages.slice(0, limit);

    if (messagesToSummarize.length === 0) {
        return await message.reply('Não há mensagens suficientes para gerar um resumo')
            .catch(error => console.error('Failed to send message:', error.message));
    }

    // Log if we couldn't get enough messages
    if (messagesToSummarize.length < limit) {
        logger.debug('Could not find enough valid messages', {
            requested: limit,
            found: messagesToSummarize.length
        });
    }

    const messageTexts = await Promise.all(messagesToSummarize.map(async msg => {
        const contact = await msg.getContact();
        const name = contact.name || 'Unknown';
        return `>>${name}: ${msg.body}.\n`;
    }));

    const contact = await message.getContact();
    const name = contact.name || 'Unknown';
    const prompt = await getPromptWithContext(message, config, 'RESUMO', 'DEFAULT', {
        name,
        limit,
        messageTexts: messageTexts.join(' ')
    });

    const result = await runCompletion(prompt, 1);
    return await message.reply(result.trim())
        .catch(error => console.error('Failed to send message:', error.message));
}

async function handleResumo(message, command, input) {
    logger.debug('handleResumo activated', {
        hasInput: !!input,
        input: input,
        hasQuoted: message.hasQuotedMsg
    });

    try {
        // If there's a quoted message, handle that first
        if (message.hasQuotedMsg) {
            logger.debug('Processing quoted message');
            return await handleQuotedMessage(message, command);
        }

        // If there's input after #resumo, try to parse it as a number first
        if (input) {
            const trimmedInput = input.trim();
            if (trimmedInput) {
                const limit = parseInt(trimmedInput);
                if (!isNaN(limit)) {
                    logger.debug('Processing specific message count:', limit);
                    return await handleSpecificMessageCount(message, limit);
                } else {
                    logger.debug('Invalid number format:', trimmedInput);
                    const errorMessage = await message.reply(command.errorMessages.invalidFormat);
                    await handleAutoDelete(errorMessage, command, true);
                    return;
                }
            }
        }

        // Default case: no input and no quoted message - show last 3 hours
        logger.debug('No input or quoted message, showing last 3 hours');
        return await handleLastThreeHours(message);
    } catch (error) {
        logger.error('Error in handleResumo:', error);
        const errorMessage = await message.reply(command.errorMessages.error);
        await handleAutoDelete(errorMessage, command, true);
    }
}

module.exports = {
    handleResumo
}; 