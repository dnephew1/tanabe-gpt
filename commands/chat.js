const { Client, MessageMedia } = require('whatsapp-web.js');
const config = require('../config');
const logger = require('../utils/logger');
const { handleAutoDelete } = require('../utils/messageUtils');
const { runCompletion } = require('../utils/openaiUtils');
const { extractLinks, unshortenLink, getPageContent } = require('../utils/linkUtils');
const { getPromptWithContext } = require('../utils/promptUtils');
const { getMessageHistory } = require('../utils/messageLogger');

async function handleChat(message, command, input) {
    let name, groupName;
    try {
        const contact = await message.getContact();
        name = contact.name || 'Unknown';
        const question = message.body.substring(1);
        const chat = await message.getChat();
        groupName = chat.isGroup ? chat.name : null;
        
        // Format current timestamp in Portuguese
        const timestamp = new Date().toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        logger.debug('Processing ChatGPT command', {
            name,
            question,
            hasQuoted: message.hasQuotedMsg,
            groupName,
            timestamp
        });

        let prompt;
        if (message.hasQuotedMsg) {
            const quotedMessage = await message.getQuotedMessage();
            const quotedText = quotedMessage.body;
            const link = extractLinks(quotedText)[0];

            if (link) {
                try {
                    const unshortenedLink = await unshortenLink(link);
                    const pageContent = await getPageContent(unshortenedLink);
                    logger.debug('Got context from link', {
                        link: unshortenedLink,
                        contentLength: pageContent.length
                    });
                    prompt = await getPromptWithContext(message, config, 'CHAT_GPT', 'WITH_CONTEXT', {
                        name,
                        question,
                        context: pageContent,
                        maxMessages: config.SYSTEM.MAX_LOG_MESSAGES,
                        messageHistory: await getMessageHistory(groupName),
                        timestamp
                    });
                } catch (error) {
                    const errorMessage = await message.reply('Não consegui acessar o link para fornecer contexto adicional.');
                    await handleAutoDelete(errorMessage, command, true);
                    return;
                }
            } else {
                logger.debug('Using quoted message as context', {
                    quotedLength: quotedText.length
                });
                prompt = await getPromptWithContext(message, config, 'CHAT_GPT', 'WITH_CONTEXT', {
                    name,
                    question,
                    context: quotedText,
                    maxMessages: config.SYSTEM.MAX_LOG_MESSAGES,
                    messageHistory: await getMessageHistory(groupName),
                    timestamp
                });
            }
        } else {
            const messageHistory = await getMessageHistory(groupName);
            logger.debug('Using default prompt without context', {
                messageHistoryLength: messageHistory?.length || 0,
                groupName
            });
            prompt = await getPromptWithContext(message, config, 'CHAT_GPT', 'DEFAULT', {
                name,
                question,
                maxMessages: config.SYSTEM.MAX_LOG_MESSAGES,
                messageHistory: messageHistory,
                timestamp
            });
        }

        // Log the complete prompt
        logger.prompt(`ChatGPT prompt for ${name} in ${groupName || 'DM'}`, prompt);

        const result = await runCompletion(prompt, 1, command.model);
        const response = await message.reply(result.trim());
        await handleAutoDelete(response, command);
    } catch (error) {
        logger.error(`Error in CHAT_GPT handler for ${name || 'Unknown'} in ${groupName || 'DM'}:`, error);
        const errorMessage = await message.reply(command.errorMessages.error || 'An error occurred while processing your request.');
        await handleAutoDelete(errorMessage, command);
    }
}

module.exports = {
    handleChat
}; 