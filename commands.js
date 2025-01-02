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
    getRelativeTime,
    generateImage,
    improvePrompt,
    transcribeAudio,
    fsPromises,
    getTweetCount
} = require('./dependencies');
const { performCacheClearing } = require('./cacheManagement');
const crypto = require('crypto');
const path = require('path');
const { getMessageHistory } = require('./messageLogger');

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
                console.log(`[LOG] [${new Date().toISOString()}] Deleted message:`, messageToDelete.body);
            }
        } catch (error) {
            console.error(`[LOG] [${new Date().toISOString()}] Failed to delete message:`, error);
            await notifyAdmin(`Failed to delete message: ${error.message}`);
        }
    }
}, 60000); // Check every minute

// Command Handlers

async function handleResumoCommand(message, input) {
    console.log(`[LOG] [${new Date().toISOString()}] handleResumoCommand activated`);
    const chat = await message.getChat();
    
    const limit = parseInt(input[1]);

    if (isNaN(limit)) {
        message.reply('Por favor, forneça um número válido após "#resumo" para definir o limite de mensagens.')
            .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
        return;
    }

    const messages = await chat.fetchMessages({ limit: limit });
    const messagesWithoutMe = messages.slice(0, -1).filter(msg => !msg.fromMe && msg.body.trim() !== '');

    if (messagesWithoutMe.length === 0) {
        message.reply('Não há mensagens suficientes para gerar um resumo')
            .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
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
        .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
}

async function handleStickerMessage(message) {
    const stickerData = await message.downloadMedia();
    const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');
    const chat = await message.getChat();

    if (hash === config.STICKER_HASHES.RESUMO || hash === config.STICKER_HASHES.AYUB) {
        await chat.sendStateTyping();
        
        if (hash === config.STICKER_HASHES.RESUMO) {
            await handleResumoSticker(message);
        } else if (hash === config.STICKER_HASHES.AYUB) {
            await handleAyubNewsSticker(message);
        }
    } else {
        console.log(`[LOG] [${new Date().toISOString()}] Sticker hash does not match any expected hash`);
    }
}

async function handleAyubNewsCommand(message, input) {
    console.log(`[LOG] [${new Date().toISOString()}] handleAyubNewsCommand activated`);
    const chat = await message.getChat();
    

    if (input[1] && input[1].toLowerCase() === 'fut') {
        await handleAyubNewsFut(message);
    } else {
        await handleAyubNewsSearch(message, input);
    }
}

async function handleAyubLinkSummary(message, links) {
    console.log(`[LOG] [${new Date().toISOString()}] handleAyubLinkSummary activated`);
    const chat = await message.getChat();
    
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
        console.error(`[LOG] [${new Date().toISOString()}] Error accessing link to generate summary:`, error);
        const errorMessage = await message.reply(`Não consegui acessar o link ${link} para gerar um resumo.`);
        await deleteMessageAfterTimeout(errorMessage, true);
        await notifyAdmin(`Error accessing link to generate summary: ${error.message}`);
    }
}

async function handleHashTagCommand(message) {
    console.log(`[LOG] [${new Date().toISOString()}] handleHashTagCommand activated`);
    const chat = await message.getChat();
    
    const contact = await message.getContact();
    const name = contact.name || 'Unknown';

    let prompt;
    if (message.hasQuotedMsg) {
        // If there's a quoted message, use a simpler prompt without message history
        prompt = `{name} está perguntando: {question}`
            .replace('{name}', name)
            .replace('{question}', message.body.substring(1));
    } else {
        // If no quoted message, include the message history
        const messageHistory = await getMessageHistory();
        prompt = config.PROMPTS.HASHTAG_COMMAND(config.MAX_LOG_MESSAGES)
            .replace('{name}', name)
            .replace('{question}', message.body.substring(1))
            .replace('{messageHistory}', messageHistory);
    }

    let finalPrompt = prompt;
    if (message.hasQuotedMsg) {
        const quotedMessage = await message.getQuotedMessage();
        const quotedText = quotedMessage.body;
        const link = extractLinks(quotedText)[0];

        if (link && typeof link === 'string') {
            try {
                const unshortenedLink = await unshortenLink(link);
                const pageContent = await getPageContent(unshortenedLink);
                finalPrompt += config.PROMPTS.HASHTAG_COMMAND_CONTEXT.replace('{pageContent}', pageContent);
            } catch (error) {
                console.error(`[LOG] [${new Date().toISOString()}] Error accessing link for context:`, error);
                message.reply('Não consegui acessar o link para fornecer contexto adicional.')
                    .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
                return;
            }
        } else {
            finalPrompt += config.PROMPTS.HASHTAG_COMMAND_QUOTED.replace('{quotedText}', quotedText);
        }
    }

    try {
        const result = await runCompletion(finalPrompt, 1);
        await message.reply(result.trim());
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Error in handleHashTagCommand:`, error);
        await message.reply('Desculpe, ocorreu um erro ao processar sua pergunta.');
    }
}

async function handleCommandList(message) {
    console.log(`[LOG] [${new Date().toISOString()}] handleCommandList activated`);
    const chat = await message.getChat();
    

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
*#desenho [descrição]* - Gera uma imagem com base na descrição fornecida
*!clearcache* - (Apenas para admin) Limpa o cache do bot
*Mensagens de Áudio* - Transcreve automaticamente mensagens de áudio para texto
*#?* - Lista de comandos disponíveis
    `;

    try {
        const sentMessage = await message.reply(commandList);
        await deleteMessageAfterTimeout(sentMessage, true);
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Failed to send command list:`, error);
        await notifyAdmin(`Failed to send command list: ${error.message}`);
    }
}

async function handleStickerCreation(message) {
    console.log(`[LOG] [${new Date().toISOString()}] handleStickerCreation activated`);
    const chat = await message.getChat();
    

    if (message.hasMedia) {
        const attachmentData = await message.downloadMedia();
        message.reply(attachmentData, message.from, { sendMediaAsSticker: true });
    } else if (message.hasQuotedMsg) {
        const quotedMsg = await message.getQuotedMessage();
        if (quotedMsg.hasMedia) {
            const attachmentData = await quotedMsg.downloadMedia();
            const imagePath = path.join(__dirname, `quoted_image_${Date.now()}.jpg`);
            
            try {
                await fsPromises.writeFile(imagePath, attachmentData.data, 'base64');
                const imageAsSticker = MessageMedia.fromFilePath(imagePath);
                await message.reply(imageAsSticker, message.from, { sendMediaAsSticker: true });
            } catch (error) {
                console.error(`[LOG] [${new Date().toISOString()}] Error processing quoted image:`, error);
                message.reply('Ocorreu um erro ao processar a imagem citada.')
                    .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                    .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send error message:`, error));
            } finally {
                // Delete the file after sending or if an error occurred
                await deleteFile(imagePath);
            }
        } else {
            message.reply('A mensagem citada não contém uma imagem.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
        }
    } else {
        const query = message.body.slice(9).trim();
        if (query && /\S/.test(query)) {
            try {
                const imageUrl = await searchGoogleForImage(query);
                if (imageUrl) {
                    const imagePath = await downloadImage(imageUrl);
                    if (imagePath) {
                        const imageAsSticker = MessageMedia.fromFilePath(imagePath);
                        await message.reply(imageAsSticker, message.from, { sendMediaAsSticker: true });
                        await deleteFile(imagePath);
                    } else {
                        message.reply('Falha ao baixar a imagem para o sticker.')
                            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                            .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
                    }
                } else {
                    message.reply('Nenhuma imagem encontrada para a consulta fornecida.')
                        .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                        .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
                }
            } catch (error) {
                console.error(`[LOG] [${new Date().toISOString()}] Error:`, error);
                message.reply('Ocorreu um erro ao processar sua solicitação.')
                    .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                    .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
            }
        } else {
            message.reply('Por favor, forneça uma palavra-chave após #sticker ou cite uma mensagem com uma imagem.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
        }
    }
}

// Helper function to check if message is from admin chat
async function isAdminChat(message) {
    const chat = await message.getChat();
    const contact = await message.getContact();
    return contact.id._serialized === `${config.ADMIN_NUMBER}@c.us` && chat.isGroup === false;
}

async function handleCacheClearCommand(message) {
    try {
        console.log(`[LOG] [${new Date().toISOString()}] handleCacheClearCommand activated`);
        
        // Check if message is from admin chat
        if (!await isAdminChat(message)) {
            console.log(`[LOG] [${new Date().toISOString()}] Cache clear command rejected: not admin chat`);
            return;
        }
        
        await performCacheClearing();
        await message.reply('Cache cleared successfully');
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Error clearing cache:`, error);
        await message.reply(`Error clearing cache: ${error.message}`);
    }
}

async function handleResumoSticker(message) {
    const chat = await message.getChat();
    
    if (message.hasQuotedMsg) {
        // Case 1: Handle quoted message
        const quotedMessage = await message.getQuotedMessage();
        const quotedText = quotedMessage.body;
        const links = extractLinks(quotedText);

        if (links.length > 0) {
            // Case 1a: Quoted message contains a link - summarize link content
            try {
                const unshortenedLink = await unshortenLink(links[0]);
                const pageContent = await getPageContent(unshortenedLink);
                const prompt = config.PROMPTS.LINK_SUMMARY.replace('{pageContent}', pageContent);
                const summary = await runCompletion(prompt, 1);
                await quotedMessage.reply(summary);
            } catch (error) {
                await quotedMessage.reply('Não consegui acessar o link para gerar um resumo.');
            }
        } else {
            // Case 1b: Quoted message without link - summarize quoted message only
            const contact = await quotedMessage.getContact();
            const name = contact.name || 'Unknown';
            const prompt = `Por favor, resuma esta mensagem de ${name}:\n\n${quotedText}`;
            const result = await runCompletion(prompt, 1);
            await quotedMessage.reply(result.trim());
        }
    } else {
        // Case 2: No quoted message - summarize last 3 hours
        const messages = await chat.fetchMessages({ limit: 1000 });
        const threeHoursAgo = Date.now() - 3 * 3600 * 1000;
        const messagesLastThreeHours = messages.filter(m => 
            m.timestamp * 1000 > threeHoursAgo && 
            !m.fromMe && 
            m.body.trim() !== ''
        );

        if (messagesLastThreeHours.length === 0) {
            await message.reply('Não há mensagens suficientes para gerar um resumo.');
            return;
        }

        const messageTexts = await Promise.all(messagesLastThreeHours.map(async msg => {
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
    console.log(`[LOG] [${new Date().toISOString()}] handleAyubNewsSticker activated`);
    const chat = await message.getChat();
    

    try {
        const news = await scrapeNews();
        if (news.length === 0) {
            message.reply('Não há notícias disponíveis no momento.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
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
            .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
    } catch (error) {
        console.error('Error accessing news:', error);
        message.reply('Não consegui acessar as notícias de hoje.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
            .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
    }
}

async function handleAyubNewsFut(message) {
    console.log(`[LOG] [${new Date().toISOString()}] handleAyubNewsFut activated`);
    const chat = await message.getChat();
    

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
                .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
        } else {
            message.reply('Nenhum artigo de futebol encontrado.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
        }
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Error accessing football news:`, error);
        message.reply('Erro ao buscar artigos de futebol.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
            .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
    }
}

async function handleAyubNewsSearch(message, input) {
    console.log(`[LOG] [${new Date().toISOString()}] handleAyubNewsSearch activated`);

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
        console.error(`[LOG] [${new Date().toISOString()}] An error occurred:`, error);
        await message.reply('Erro ao buscar artigos. Por favor, tente novamente mais tarde.');
    }
}

async function handleDesenhoCommand(message, command, promptInput) {
    console.log(`[LOG] [${new Date().toISOString()}] handleDesenhoCommand activated`);
    const chat = await message.getChat();
    

    if (!promptInput) {
        message.reply('Por favor, forneça uma descrição após #desenho.')
            .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
        return;
    }

    try {
        const improvedPrompt = await improvePrompt(promptInput);

        const originalImageBase64 = await generateImage(promptInput);
        const improvedImageBase64 = await generateImage(improvedPrompt);

        if (originalImageBase64 && improvedImageBase64) {
            const originalMedia = new MessageMedia('image/png', originalImageBase64, 'original_image.png');
            const improvedMedia = new MessageMedia('image/png', improvedImageBase64, 'improved_image.png');

            await message.reply(originalMedia);
            await message.reply(improvedMedia);

            // Delete the images after sending
            await deleteFile('original_image.png');
            await deleteFile('improved_image.png');
        } else {
            message.reply('Não foi possível gerar as imagens. Tente novamente.')
                .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
        }
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Error in handleDesenhoCommand:`, error);
        message.reply('Ocorreu um erro ao gerar as imagens. Tente novamente mais tarde.')
            .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send message:`, error));
    }
}

async function handleTwitterDebug(message) {
    try {
        console.log(`[LOG] [${new Date().toISOString()}] handleTwitterDebug activated`);
        
        // Check if message is from admin chat
        if (!await isAdminChat(message)) {
            console.log(`[LOG] [${new Date().toISOString()}] Twitter debug command rejected: not admin chat`);
            return;
        }
        
        const chat = await message.getChat();
        await chat.sendStateTyping();
        
        const results = [];
        for (const account of config.TWITTER_ACCOUNTS) {
            try {
                // Get current tweet count from SocialBlade
                const currentTweetCount = await getTweetCount(account.username);
                
                // Get latest tweets using the user ID directly
                const twitterApiUrl = `https://api.twitter.com/2/users/${account.userId}/tweets?tweet.fields=text&max_results=5`;
                const response = await axios.get(twitterApiUrl, {
                    headers: {
                        'Authorization': `Bearer ${config.TWITTER_BEARER_TOKEN}`
                    }
                });
                
                let tweetInfo = 'No tweets found';
                if (response.data && response.data.data && response.data.data.length > 0) {
                    const tweets = response.data.data;
                    const latestTweet = tweets[0];
                    const olderTweets = tweets.slice(1);

                    // Prepare the evaluation prompt
                    const prompt = config.PROMPTS.EVALUATE_NEWS
                        .replace('{post}', latestTweet.text)
                        .replace('{previous_posts}', olderTweets.map(t => t.text).join('\n\n'));

                    // Evaluate the news using ChatGPT
                    const evaluation = await runCompletion(prompt, 1);
                    
                    tweetInfo = `Latest Tweet Text: ${latestTweet.text}\nEvaluation Result: ${evaluation.trim()}`;
                }
                
                results.push(`@${account.username}:
                Last Tweet ID: ${account.lastTweetId}
                Stored Tweet Count: ${account.lastTweetCount}
                Current Tweet Count: ${currentTweetCount}
                ${tweetInfo}`);

                // Add delay between accounts to avoid rate limits
                if (config.TWITTER_ACCOUNTS.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                results.push(`Error checking @${account.username}: ${error.message}`);
                console.error(`[LOG] [${new Date().toISOString()}] Detailed error for ${account.username}:`, error.response?.data || error);
            }
        }
        
        // Send debug info to admin
        const debugInfo = results.join('\n\n');
        await message.reply(debugInfo);
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Error in handleTwitterDebug:`, error);
        await message.reply(`Debug error: ${error.message}`);
    }
}

async function handleAudioMessage(message) {
    console.log(`[LOG] [${new Date().toISOString()}] handleAudioMessage activated`);
    const chat = await message.getChat();
    
    try {
        // Download the audio
        const audioData = await message.downloadMedia();
        const audioPath = path.join(__dirname, `audio_${Date.now()}.ogg`);
        
        try {
            // Save audio temporarily
            await fsPromises.writeFile(audioPath, audioData.data, 'base64');
            
            // Transcribe the audio
            const transcription = await transcribeAudio(audioPath);
            
            // Reply with formatted transcription
            await message.reply(`Transcrição:\n_${transcription}_`);
            
        } catch (error) {
            console.error(`[LOG] [${new Date().toISOString()}] Error processing audio:`, error);
            message.reply('Desculpe, não consegui transcrever o áudio.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
                .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send error message:`, error));
        } finally {
            // Delete the temporary audio file
            await deleteFile(audioPath);
        }
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Error downloading audio:`, error);
        message.reply('Desculpe, não consegui baixar o áudio.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, true))
            .catch(error => console.error(`[LOG] [${new Date().toISOString()}] Failed to send error message:`, error));
    }
}

module.exports = {
    handleResumoCommand,
    handleStickerMessage,
    handleAyubNewsCommand,
    handleAyubLinkSummary,
    handleHashTagCommand,
    handleCommandList,
    handleStickerCreation,
    deleteMessageAfterTimeout,
    handleCacheClearCommand,
    handleResumoSticker,
    handleAyubNewsSticker,
    handleAyubNewsFut,
    handleAyubNewsSearch,
    handleDesenhoCommand,
    handleTwitterDebug,
    handleAudioMessage
};
