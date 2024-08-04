// commands.js
const { MessageMedia } = require('whatsapp-web.js');
const {
    config,
    axios,
    runCompletion,
    extractLinks,
    unshortenLink,
    getPageContent,
    searchGoogleForImage,
    downloadImage,
    deleteFile,
    notifyAdmin,
    scrapeNews,
    translateToPortuguese,
    scrapeNews2,
    parseXML,
    getRelativeTime
} = require('./dependencies');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Helper function to delete messages after a timeout
const messageQueue = [];

async function deleteMessageAfterTimeout(sentMessage, isErrorOrCommandList) {
    if (isErrorOrCommandList) {
        messageQueue.push({ sentMessage, timeout: config.MESSAGE_DELETE_TIMEOUT, timestamp: Date.now() });
    }
}

// Process message queue
setInterval(async () => {
    const now = Date.now();
    while (messageQueue.length > 0 && now - messageQueue[0].timestamp >= messageQueue[0].timeout) {
        const { sentMessage } = messageQueue.shift();
        try {
            const chat = await sentMessage.getChat();
            const messages = await chat.fetchMessages({ limit: 50 });
            const messageToDelete = messages.find(msg => msg.id._serialized === sentMessage.id._serialized);
            if (messageToDelete) {
                await messageToDelete.delete(true);
                console.log('Deleted message:', messageToDelete.body);
            }
        } catch (error) {
            console.error('Failed to delete message:', error);
            await notifyAdmin(`Failed to delete message: ${error.message}`);
        }
    }
}, 60000); // Check every minute

// Command Handlers

async function handleResumoCommand(message, input) {
    console.log('handleResumoCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const limit = parseInt(input[1]);

    if (isNaN(limit)) {
        message.reply('Por favor, forneça um número válido após "#resumo" para definir o limite de mensagens.')
            .catch(error => console.error('Failed to send message:', error));
        return;
    }

    const messages = await chat.fetchMessages({ limit: limit });
    const messagesWithoutMe = messages.slice(0, -1).filter(msg => !msg.fromMe && msg.body.trim() !== '');

    if (messagesWithoutMe.length === 0) {
        message.reply('Não há mensagens suficientes para gerar um resumo')
            .catch(error => console.error('Failed to send message:', error));
        return;
    }

    const messageTexts = await Promise.all(messagesWithoutMe.map(async msg => {
        const contact = await msg.getContact();
        const name = contact.name || 'Unknown';
        return `>>${name}: ${msg.body}.\n`;
    }));

    const contact = await message.getContact();
    const name = contact.name || 'Unknown';
    const prompt = config.PROMPTS.RESUMO_COMMAND
        .replace('{name}', name)
        .replace('{limit}', limit)
        .replace('{messageTexts}', messageTexts.join(' '));

    const result = await runCompletion(prompt, 1);
    message.reply(result.trim())
        .catch(error => console.error('Failed to send message:', error));
}

// handleCorrenteResumoCommand function
async function handleCorrenteResumoCommand(message, input) {
    console.log('handleCorrenteResumoCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    const parts = message.body ? message.body.split(' ') : input;
    let limit = parseInt(parts[1]) || 0;

    let messages;
    if (isNaN(limit) || limit <= 0) {
        messages = await chat.fetchMessages({ limit: 500 });
        const lastMessage = messages[messages.length - 2];
        const lastMessageTimestamp = lastMessage.timestamp;
        const threeHoursBeforeLastMessageTimestamp = lastMessageTimestamp - 10800;
        messages = messages.slice(0, -1).filter(message => (
            message.timestamp > threeHoursBeforeLastMessageTimestamp &&
            !message.fromMe &&
            message.body.trim() !== ''
        ));
    } else {
        messages = await chat.fetchMessages({ limit: limit + 1 });
        messages = messages.slice(0, -1).filter(message => (
            !message.fromMe &&
            message.body.trim() !== ''
        ));
    }

    const messageTexts = await Promise.all(messages.map(async message => {
        const contact = await message.getContact();
        const name = contact.pushname || contact.name || contact.number;
        return `>>${name}: ${message.body}.\n`;
    }));

    const result = await runCompletion(messageTexts.join(' '), 2);
    
    if (result.trim()) {
        await message.reply(result.trim());
        
        // Notify admin about the summary
        if (message.getContact) {
            const contact = await message.getContact();
            const userName = contact.pushname || contact.name || contact.number;
            await notifyAdmin(`Summary generated for ${userName} in ${chat.name}. Summary:\n\n${result.trim()}`);
        } else {
            await notifyAdmin(`Periodic summary generated for ${chat.name}. Summary:\n\n${result.trim()}`);
        }
        
        return result.trim(); // Return the summary
    } else {
        // Notify admin that no summary was generated
        await notifyAdmin(`No summary was generated for ${chat.name} (no content to summarize).`);
    }
    
    return null; // Return null if no summary was generated
}

async function handleStickerMessage(message) {
    const stickerData = await message.downloadMedia();
    const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');

    if (hash === config.STICKER_HASHES.RESUMO) {
        await handleResumoSticker(message);
    } else if (hash === config.STICKER_HASHES.AYUB) {
        await handleAyubNewsSticker(message);
    } else {
        console.log('Sticker hash does not match any expected hash');
    }
}

async function handleAyubNewsCommand(message, input) {
    console.log('handleAyubNewsCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    if (input[1] && input[1].toLowerCase() === 'fut') {
        await handleAyubNewsFut(message);
    } else {
        await handleAyubNewsSearch(message, input);
    }
}

async function handleAyubLinkSummary(message, links) {
    console.log('handleAyubLinkSummary activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const link = links[0];

    try {
        const unshortenedLink = await unshortenLink(link);
        let pageContent = await getPageContent(unshortenedLink);
        
        // Use the character limit from the config file
        const charLimit = config.LINK_SUMMARY_CHAR_LIMIT || 3000;
        
        // Limit the page content to the specified number of characters
        if (pageContent.length > charLimit) {
            pageContent = pageContent.substring(0, charLimit);
        }
        
        const prompt = config.PROMPTS.LINK_SUMMARY.replace('{pageContent}', pageContent);
        const summary = await runCompletion(prompt, 1);
        const sentMessage = await message.reply(summary);
        if (summary.trim() === 'Não consegui acessar o link para gerar um resumo.') {
            await deleteMessageAfterTimeout(sentMessage, true);
        }
    } catch (error) {
        console.error('Error accessing link to generate summary:', error);
        const errorMessage = await message.reply(`Não consegui acessar o link ${link} para gerar um resumo.`);
        await deleteMessageAfterTimeout(errorMessage, true);
        await notifyAdmin(`Error accessing link to generate summary: ${error.message}`);
    }
}

async function handleHashTagCommand(message) {
    console.log('handleHashTagCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const contact = await message.getContact();
    const name = contact.name || 'Unknown';

    let prompt = config.PROMPTS.HASHTAG_COMMAND
        .replace('{name}', name)
        .replace('{question}', message.body.substring(1));

    if (message.hasQuotedMsg) {
        const quotedMessage = await message.getQuotedMessage();
        const quotedText = quotedMessage.body;
        const link = extractLinks(quotedText)[0];

        if (link && typeof link === 'string') {
            try {
                const unshortenedLink = await unshortenLink(link);
                const pageContent = await getPageContent(unshortenedLink);
                prompt += config.PROMPTS.HASHTAG_COMMAND_CONTEXT.replace('{pageContent}', pageContent);
            } catch (error) {
                console.error('Error accessing link for context:', error);
                message.reply('Não consegui acessar o link para fornecer contexto adicional.')
                    .catch(error => console.error('Failed to send message:', error));
                return;
            }
        } else {
            prompt += config.PROMPTS.HASHTAG_COMMAND_QUOTED.replace('{quotedText}', quotedText);
        }
    }

    const result = await runCompletion(prompt, 1);
    message.reply(result.trim())
        .catch(error => console.error('Failed to send message:', error));
}

async function handleCommandList(message) {
    console.log('handleCommandList activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    const commandList = `
Comandos disponíveis:
*# [pergunta]* - ChatGPT irá responder sua pergunta. (Se adicionar '!' após '#' ChatGPT irá adicionar humor em sua resposta)
*Sticker Resumo* - Resume a última hora de mensagens (pode ser usado para resumir mensagens e links se enviado como resposta à mensagem a ser resumida)
*#resumo [número]* - Resume as últimas [número] mensagens
*Sticker Ayub News* - Notícias relevantes do dia
*#ayubnews [palavra-chave]* - Notícias sobre a palavra-chave
*#ayubnews fut* - Notícias sobre futebol
*#sticker [palavra-chave]* - Pesquisa uma imagem e transforma em sticker
*@all* - Menciona todos os membros do grupo
*@admin* - Menciona todos os administradores do grupo
*@medicos* - Menciona os médicos no grupo
*@engenheiros* - Menciona os engenheiros no grupo
*@cartola* - Menciona os jogadores de Cartola do grupo
*#?* - Lista de comandos disponíveis
*!clearcache* - (Apenas para admin) Limpa o cache do bot
    `;

    try {
        const sentMessage = await message.reply(commandList);
        await deleteMessageAfterTimeout(sentMessage, true);
    } catch (error) {
        console.error('Failed to send command list:', error);
        await notifyAdmin(`Failed to send command list: ${error.message}`);
    }
}

async function handleStickerCreation(message) {
    console.log('handleStickerCreation activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    if (message.hasMedia) {
        const attachmentData = await message.downloadMedia();
        message.reply(attachmentData, message.from, { sendMediaAsSticker: true });
    } else {
        const query = message.body.slice(9).trim();
        if (query && /\S/.test(query)) {
            try {
                const imageUrl = await searchGoogleForImage(query);
                if (imageUrl) {
                    const imagePath = await downloadImage(imageUrl);
                    if (imagePath) {
                        const imageAsSticker = MessageMedia.fromFilePath(imagePath);
                        await global.client.sendMessage(message.from, imageAsSticker, {
                            sendMediaAsSticker: true
                        });
                        // Delete the file after sending
                        await deleteFile(imagePath);
                    } else {
                        message.reply('Falha ao baixar a imagem para o sticker.')
                            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                            .catch(error => console.error('Failed to send message:', error));
                    }
                } else {
                    message.reply('Nenhuma imagem encontrada para a consulta fornecida.')
                        .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                        .catch(error => console.error('Failed to send message:', error));
                }
            } catch (error) {
                console.error('Error:', error);
                message.reply('Ocorreu um erro ao processar sua solicitação.')
                    .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                    .catch(error => console.error('Failed to send message:', error));
            }
        } else {
            message.reply('Por favor, forneça uma palavra-chave após #sticker.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error('Failed to send message:', error));
        }
    }
}

// Function to clear WhatsApp Web cache
async function clearWhatsAppCache() {
    const cacheDir = path.join(__dirname, '.wwebjs_cache');
    
    if (await fs.access(cacheDir).then(() => true).catch(() => false)) {
        try {
            await fs.rm(cacheDir, { recursive: true, force: true });
            console.log('WhatsApp Web cache cleared successfully');
        } catch (err) {
            console.error('Error clearing WhatsApp Web cache:', err);
        }
    }
}

// Function to clear Puppeteer's cache
async function clearPuppeteerCache() {
    if (global.client && global.client.pupBrowser) {
        try {
            const pages = await global.client.pupBrowser.pages();
            for (let i = 1; i < pages.length; i++) {
                await pages[i].close();
            }
            console.log('Puppeteer cache cleared successfully');
        } catch (error) {
            console.error('Error clearing Puppeteer cache:', error);
        }
    }
}

// Function to perform cache clearing
async function performCacheClearing() {
    console.log('Starting cache clearing process...');
    await clearWhatsAppCache();
    await clearPuppeteerCache();
    console.log('Cache clearing process completed');
    await notifyAdmin("Cache clearing process completed");
}

// Handle manual cache clear command
async function handleCacheClearCommand(message) {
    if (message.from === `${config.ADMIN_NUMBER}@c.us`) {
        await message.reply('Starting manual cache clearing process...');
        await performCacheClearing();
        await message.reply('Manual cache clearing process completed.');
    } else {
        await message.reply('You are not authorized to use this command.');
    }
}

async function handleResumoSticker(message) {
    const chat = await message.getChat();
    await chat.sendStateTyping();

    let quotedMessage = null;
    let linkToSummarize = null;

    if (message.hasQuotedMsg) {
        quotedMessage = await message.getQuotedMessage();
        const quotedText = quotedMessage.body;
        const links = extractLinks(quotedText);

        if (links.length > 0) {
            linkToSummarize = links[0];
        }
    }

    if (linkToSummarize) {
        // Summarize the link
        try {
            console.log('linkSummary activated');
            const unshortenedLink = await unshortenLink(linkToSummarize);
            const pageContent = await getPageContent(unshortenedLink);
            const prompt = config.PROMPTS.LINK_SUMMARY.replace('{pageContent}', pageContent);
            const summary = await runCompletion(prompt, 1);
            
            await message.reply(summary);
        } catch (error) {
            console.error('Error accessing link to generate summary:', error);
            await message.reply('Não consegui acessar o link para gerar um resumo.');
        }
    } else if (quotedMessage) {
        // Summarize the quoted message
        const prompt = config.PROMPTS.HOUR_SUMMARY
            .replace('{name}', 'User')
            .replace('{messageTexts}', quotedMessage.body);
        const result = await runCompletion(prompt, 1);
        await message.reply(result.trim());
    } else {
        // Summarize the last hour of messages
        console.log('hourSummary activated');
        const messages = await chat.fetchMessages({ limit: 500 });
        const oneHourAgo = Date.now() - 3600 * 1000;
        const messagesLastHour = messages.filter(m => m.timestamp * 1000 > oneHourAgo && !m.fromMe && m.body.trim() !== '');

        if (messagesLastHour.length === 0) {
            await message.reply('Não há mensagens suficientes para gerar um resumo.');
            return;
        }

        const messageTexts = await Promise.all(messagesLastHour.map(async msg => {
            const contact = await msg.getContact();
            const name = contact.name || 'Unknown';
            return `>>${name}: ${msg.body}.\n`;
        }));

        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        const prompt = config.PROMPTS.HOUR_SUMMARY
            .replace('{name}', name)
            .replace('{messageTexts}', messageTexts.join(' '));
        const result = await runCompletion(prompt, 1);
        await message.reply(result.trim());
    }
}

async function handleAyubNewsSticker(message) {
    console.log('handleAyubNewsSticker activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    try {
        const news = await scrapeNews();
        if (news.length === 0) {
            message.reply('Não há notícias disponíveis no momento.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error('Failed to send message:', error));
            return;
        }

        const translatedNews = await translateToPortuguese(news);
        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        let reply = `Aqui estão as notícias mais relevantes de hoje, ${name}:\n\n`;
        translatedNews.forEach((newsItem, index) => {
            reply += `${index + 1}. ${newsItem}\n`;
        });

        message.reply(reply)
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
            .catch(error => console.error('Failed to send message:', error));
    } catch (error) {
        console.error('Error accessing news:', error);
        message.reply('Não consegui acessar as notícias de hoje.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
            .catch(error => console.error('Failed to send message:', error));
    }
}

async function handleAyubNewsFut(message) {
    console.log('handleAyubNewsFut activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    try {
        const news = await scrapeNews2();
        if (news.length > 0) {
            const contact = await message.getContact();
            const name = contact.name || 'Unknown';
            let reply = `Aqui estão as notícias de futebol mais relevantes de hoje, ${name}:\n\n`;
            news.forEach((newsItem, index) => {
                reply += `${index + 1}. ${newsItem.title}\n`;
            });

            message.reply(reply)
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error('Failed to send message:', error));
        } else {
            message.reply('Nenhum artigo de futebol encontrado.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error('Failed to send message:', error));
        }
    } catch (error) {
        console.error('Error accessing football news:', error);
        message.reply('Erro ao buscar artigos de futebol.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
            .catch(error => console.error('Failed to send message:', error));
    }
}

async function handleAyubNewsSearch(message, input) {
    console.log('handleAyubNewsSearch activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    const keywords = input.slice(1).join(' ');
    const query = encodeURIComponent(keywords);
    const searchUrl = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419&sort=date&dedupe=1`;

    try {
        const response = await axios.get(searchUrl);
        const xmlString = response.data;

        const newsData = parseXML(xmlString).slice(0, 5);

        if (newsData.length > 0) {
            const contact = await message.getContact();
            const name = contact.name || 'Unknown';
            let reply = `Aqui estão os artigos mais recentes e relevantes sobre "${keywords}", ${name}:\n\n`;
            newsData.forEach((item, index) => {
                reply += `${index + 1}. *${item.title}*\nFonte: ${item.source}\nData: ${getRelativeTime(new Date(item.pubDate))}\n\n`;
            });
            await message.reply(reply);
        } else {
            await message.reply(`Nenhum artigo encontrado para "${keywords}".`);
        }
    } catch (error) {
        console.error('An error occurred:', error);
        await message.reply('Erro ao buscar artigos. Por favor, tente novamente mais tarde.');
    }
}

module.exports = {
    handleResumoCommand,
    handleCorrenteResumoCommand,
    handleStickerMessage,
    handleAyubNewsCommand,
    handleAyubLinkSummary,
    handleHashTagCommand,
    handleCommandList,
    handleStickerCreation,
    deleteMessageAfterTimeout,
    performCacheClearing,
    handleCacheClearCommand,
    handleResumoSticker,
    handleAyubNewsSticker,
    handleAyubNewsFut,
    handleAyubNewsSearch
};
