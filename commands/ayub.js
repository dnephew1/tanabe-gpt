const config = require('../config');
const logger = require('../utils/logger');
const { handleAutoDelete } = require('../utils/messageUtils');
const { runCompletion } = require('../utils/openaiUtils');
const { extractLinks, unshortenLink, getPageContent } = require('../utils/linkUtils');
const { scrapeNews, searchNews, translateToPortuguese } = require('../utils/newsUtils');

// Define the link summary prompt template
const LINK_SUMMARY_PROMPT = `Você é um assistente especializado em resumir conteúdo. Por favor, resuma o seguinte texto em português de forma clara e concisa, mantendo os pontos principais:

{pageContent}

Forneça um resumo que capture a essência do conteúdo.`;

async function handleAyubLinkSummary(message) {
    logger.debug('handleAyubLinkSummary activated');
    const chat = await message.getChat();
    const contact = await message.getContact();
    
    // Check if it's either admin chat or Ayub in the target group
    const adminNumber = config.CREDENTIALS.ADMIN_NUMBER;
    const contactNumber = contact.id.user; // This gets just the number without @c.us
    const isAdminChat = contactNumber === adminNumber || 
                       contact.id._serialized === `${adminNumber}@c.us`;
    const isAyubInTargetGroup = chat.name === 'Leorogeriocosta facebook' && contact.name === 'Ayub';
    
    logger.debug('Link summary check', {
        isAdminChat,
        isAyubInTargetGroup,
        chatName: chat.name,
        contactName: contact.name,
        contactId: contact.id._serialized,
        contactNumber,
        adminNumber,
        messageBody: message.body
    });

    if (!isAdminChat && !isAyubInTargetGroup) {
        logger.debug('Message not from admin or Ayub in target group, skipping');
        return;
    }

    const links = extractLinks(message.body);
    if (!links || links.length === 0) {
        logger.debug('No links found in message');
        return;
    }

    logger.info(`Processing link summary for ${isAdminChat ? 'admin' : 'Ayub'}`);
    const link = links[0];
    try {
        logger.debug(`Unshortening link: ${link}`);
        const unshortenedLink = await unshortenLink(link);
        logger.debug(`Getting content from: ${unshortenedLink}`);
        let pageContent = await getPageContent(unshortenedLink);
        
        const charLimit = config.LINK_SUMMARY_CHAR_LIMIT || 3000;
        if (pageContent.length > charLimit) {
            logger.debug(`Content length ${pageContent.length} exceeds limit ${charLimit}, truncating`);
            pageContent = pageContent.substring(0, charLimit);
        }
        
        logger.debug('Generating summary with ChatGPT');
        const prompt = LINK_SUMMARY_PROMPT.replace('{pageContent}', pageContent);
        const summary = await runCompletion(prompt, 1);
        
        if (!summary || summary.trim().length === 0) {
            logger.error('Received empty summary from ChatGPT');
            const errorMessage = await message.reply('Não consegui gerar um resumo do conteúdo.');
            await handleAutoDelete(errorMessage, true);
            return;
        }

        logger.debug('Sending summary response');
        const sentMessage = await message.reply(summary);
        if (summary.trim() === 'Não consegui acessar o link para gerar um resumo.') {
            await handleAutoDelete(sentMessage, true);
        }
    } catch (error) {
        logger.error(`Error accessing link to generate summary:`, error);
        const errorMessage = await message.reply(`Não consegui acessar o link ${link} para gerar um resumo.`);
        await handleAutoDelete(errorMessage, true);
        logger.error(`Link summary error: ${error.message}`);
    }
}

async function handleAyubNewsSticker(message, command) {
    try {
        const news = await scrapeNews();
        if (!news || news.length === 0) {
            const errorMessage = await message.reply(command.errorMessages.noArticles);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const translatedNews = await translateToPortuguese(news);
        if (!translatedNews || translatedNews.length === 0) {
            const errorMessage = await message.reply(command.errorMessages.error);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        let reply = `Aqui estão as notícias mais relevantes de hoje, ${name}:\n\n`;
        translatedNews.forEach((newsItem, index) => {
            reply += `${index + 1}. ${newsItem}\n`;
        });

        const response = await message.reply(reply);
        await handleAutoDelete(response, command);
    } catch (error) {
        console.error('[ERROR] Error in handleAyubNewsSticker:', error.message);
        const errorMessage = await message.reply(command.errorMessages.error);
        await handleAutoDelete(errorMessage, command, true);
    }
}

async function handleAyubNewsSearch(message, command, searchTerm) {
    try {
        if (!searchTerm) {
            const errorMessage = await message.reply(command.errorMessages.noArticles);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const news = await searchNews(searchTerm);
        
        if (!news || news.length === 0) {
            const errorMessage = await message.reply(command.errorMessages.noArticles);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const translatedNews = await translateToPortuguese(news);
        if (!translatedNews || translatedNews.length === 0) {
            const errorMessage = await message.reply(command.errorMessages.error);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        let reply = `Aqui estão as notícias sobre "${searchTerm}", ${name}:\n\n`;
        translatedNews.forEach((newsItem, index) => {
            reply += `${index + 1}. ${newsItem}\n`;
        });

        const response = await message.reply(reply);
        await handleAutoDelete(response, command);
    } catch (error) {
        console.error('[ERROR] Error in handleAyubNewsSearch:', error.message);
        const errorMessage = await message.reply(command.errorMessages.error);
        await handleAutoDelete(errorMessage, command, true);
    }
}

const handleAyub = async (message, command, input) => {
    // Convert input string to array if it's not already
    const inputArray = typeof input === 'string' ? input.split(' ') : input;
    
    logger.debug('Processing Ayub command', {
        input,
        inputArray,
        hasMedia: message.hasMedia,
        type: message.type
    });

    // If no input or empty input, show latest news
    if (!input || input.trim() === '') {
        return await handleAyubNewsSticker(message, command);
    }

    // If there's any input, treat it as a search term
    return await handleAyubNewsSearch(message, command, input.trim());
};

module.exports = {
    handleAyub,
    handleAyubLinkSummary
}; 