// commandImplementations.js

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
} = require('./dependencies');
const { getPromptWithContext, handleAutoDelete } = require('./utils');
const { performCacheClearing } = require('./cacheManagement');
const path = require('path');
const { handleResumoConfig } = require('./resumoConfig');

// Command implementations
const commandHandlers = {
    CHAT_GPT: async (message, command, input) => {
        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        const question = message.body.substring(1);
        
        let prompt;
        if (message.hasQuotedMsg) {
            const quotedMessage = await message.getQuotedMessage();
            const quotedText = quotedMessage.body;
            const link = extractLinks(quotedText)[0];

            if (link) {
                try {
                    const unshortenedLink = await unshortenLink(link);
                    const pageContent = await getPageContent(unshortenedLink);
                    prompt = await getPromptWithContext('CHAT_GPT', 'WITH_CONTEXT', message, {
                        name,
                        question,
                        context: pageContent
                    });
                } catch (error) {
                    const errorMessage = await message.reply('Não consegui acessar o link para fornecer contexto adicional.');
                    await handleAutoDelete(errorMessage, command, true);
                    return;
                }
            } else {
                prompt = await getPromptWithContext('CHAT_GPT', 'WITH_CONTEXT', message, {
                    name,
                    question,
                    context: quotedText
                });
            }
        } else {
            prompt = await getPromptWithContext('CHAT_GPT', 'DEFAULT', message, {
                name,
                question
            });
        }

        const result = await runCompletion(prompt, 1, command.model);
        const response = await message.reply(result.trim());
        await handleAutoDelete(response, command);
    },

    RESUMO: async (message, command, input) => {
        // Handle sticker case
        if (message.hasMedia && message.type === 'sticker') {
            if (message.hasQuotedMsg) {
                const quotedMessage = await message.getQuotedMessage();
                const quotedText = quotedMessage.body;
                const links = extractLinks(quotedText);

                if (links.length > 0) {
                    try {
                        const unshortenedLink = await unshortenLink(links[0]);
                        const pageContent = await getPageContent(unshortenedLink);
                        const prompt = await getPromptWithContext('RESUMO', 'LINK_SUMMARY', message, {
                            pageContent
                        });
                        const summary = await runCompletion(prompt, 1);
                        const response = await quotedMessage.reply(summary);
                        await handleAutoDelete(response, command);
                    } catch (error) {
                        const errorMessage = await quotedMessage.reply(command.errorMessages.linkError);
                        await handleAutoDelete(errorMessage, command, true);
                    }
                } else {
                    const contact = await quotedMessage.getContact();
                    const name = contact.name || 'Unknown';
                    const prompt = await getPromptWithContext('RESUMO', 'QUOTED_MESSAGE', message, {
                        name,
                        quotedText
                    });
                    const result = await runCompletion(prompt, 1);
                    const response = await quotedMessage.reply(result.trim());
                    await handleAutoDelete(response, command);
                }
            } else {
                const chat = await message.getChat();
                const messages = await chat.fetchMessages({ limit: 1000 });
                const hoursAgo = Date.now() - (command.defaultSummaryHours * 3600 * 1000);
                const messagesLastHours = messages.filter(m => 
                    m.timestamp * 1000 > hoursAgo && 
                    !m.fromMe && 
                    m.body.trim() !== ''
                );

                if (messagesLastHours.length === 0) {
                    const errorMessage = await message.reply(command.errorMessages.noMessages);
                    await handleAutoDelete(errorMessage, command, true);
                    return;
                }

                const messageTexts = await Promise.all(messagesLastHours.map(async msg => {
                    const contact = await msg.getContact();
                    const name = contact.name || 'Unknown';
                    return `>>${name}: ${msg.body}.\n`;
                }));

                const contact = await message.getContact();
                const name = contact.name || 'Unknown';
                const prompt = await getPromptWithContext('RESUMO', 'HOUR_SUMMARY', message, {
                    name,
                    messageTexts: messageTexts.join(' ')
                });
                const result = await runCompletion(prompt, 1);
                const response = await message.reply(result.trim());
                await handleAutoDelete(response, command);
            }
            return;
        }

        // Handle normal command case
        const limit = parseInt(input[1]);
        if (isNaN(limit)) {
            // Use default hours if no number provided
            const chat = await message.getChat();
            const messages = await chat.fetchMessages({ limit: 1000 });
            const hoursAgo = Date.now() - (command.defaultSummaryHours * 3600 * 1000);
            const messagesLastHours = messages.filter(m => 
                m.timestamp * 1000 > hoursAgo && 
                !m.fromMe && 
                m.body.trim() !== ''
            );

            if (messagesLastHours.length === 0) {
                const errorMessage = await message.reply(command.errorMessages.noMessages);
                await handleAutoDelete(errorMessage, command, true);
                return;
            }

            const messageTexts = await Promise.all(messagesLastHours.map(async msg => {
                const contact = await msg.getContact();
                const name = contact.name || 'Unknown';
                return `>>${name}: ${msg.body}.\n`;
            }));

            const contact = await message.getContact();
            const name = contact.name || 'Unknown';
            const prompt = await getPromptWithContext('RESUMO', 'HOUR_SUMMARY', message, {
                name,
                messageTexts: messageTexts.join(' ')
            });

            const result = await runCompletion(prompt, 1, command.model);
            const response = await message.reply(result.trim());
            await handleAutoDelete(response, command);
            return;
        }

        const chat = await message.getChat();
        const messages = await chat.fetchMessages({ limit: limit });
        const messagesWithoutMe = messages.slice(0, -1).filter(msg => !msg.fromMe && msg.body.trim() !== '');

        if (messagesWithoutMe.length === 0) {
            const errorMessage = await message.reply(command.errorMessages.noMessages);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        const messageTexts = await Promise.all(messagesWithoutMe.map(async msg => {
            const contact = await msg.getContact();
            const name = contact.name || 'Unknown';
            return `>>${name}: ${msg.body}.\n`;
        }));

        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        const prompt = await getPromptWithContext('RESUMO', 'DEFAULT', message, {
            name,
            limit,
            messageTexts: messageTexts.join(' ')
        });

        const result = await runCompletion(prompt, 1, command.model);
        const response = await message.reply(result.trim());
        await handleAutoDelete(response, command);
    },

    AYUB_NEWS: async (message, command, input) => {
        // Handle sticker case or no keyword case
        if ((message.hasMedia && message.type === 'sticker') || input.length <= 1 || (input.length === 2 && input[0].toLowerCase() === 'ayub')) {
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
                return;
            } catch (error) {
                console.error('[ERROR] Error in AYUB_NEWS command:', error.message);
                const errorMessage = await message.reply(command.errorMessages.error);
                await handleAutoDelete(errorMessage, command, true);
                return;
            }
        }

        // Handle keyword search case
        try {
            // Remove the command prefix from input
            const searchTerm = input[0].toLowerCase() === 'ayub' ? 
                input.slice(2).join(' ') : 
                input.slice(1).join(' ');

            if (!searchTerm) {
                const errorMessage = await message.reply(command.errorMessages.noArticles);
                await handleAutoDelete(errorMessage, command, true);
                return;
            }

            const news = await scrapeNews2(searchTerm);
            
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
            console.error('[ERROR] Error in AYUB_NEWS command:', error.message);
            const errorMessage = await message.reply(command.errorMessages.error);
            await handleAutoDelete(errorMessage, command, true);
        }
    },

    STICKER: async (message, command, input) => {
        // Case 1: Message has media - convert to sticker
        if (message.hasMedia) {
            const attachmentData = await message.downloadMedia();
            const response = await message.reply(attachmentData, message.from, { sendMediaAsSticker: true });
            await handleAutoDelete(response, command);
            return;
        }

        // Case 2: Message quotes another message with media
        if (message.hasQuotedMsg) {
            const quotedMsg = await message.getQuotedMessage();
            if (quotedMsg.hasMedia) {
                const attachmentData = await quotedMsg.downloadMedia();
                const imagePath = path.join(__dirname, `quoted_image_${Date.now()}.jpg`);
                
                try {
                    await fsPromises.writeFile(imagePath, attachmentData.data, 'base64');
                    const imageAsSticker = MessageMedia.fromFilePath(imagePath);
                    const response = await message.reply(imageAsSticker, message.from, { sendMediaAsSticker: true });
                    await handleAutoDelete(response, command);
                } catch (error) {
                    const errorMessage = await message.reply(command.errorMessages.downloadError);
                    await handleAutoDelete(errorMessage, command, true);
                } finally {
                    await deleteFile(imagePath);
                }
                return;
            } else {
                const errorMessage = await message.reply(command.errorMessages.noImage);
                await handleAutoDelete(errorMessage, command, true);
                return;
            }
        }

        // Case 3: Command has keyword - search and create sticker
        const query = input.slice(1).join(' ');
        if (query && /\S/.test(query)) {
            try {
                const imageUrl = await searchGoogleForImage(query);
                if (!imageUrl) {
                    const errorMessage = await message.reply(command.errorMessages.noResults);
                    await handleAutoDelete(errorMessage, command, true);
                    return;
                }

                const imagePath = await downloadImage(imageUrl);
                if (!imagePath) {
                    const errorMessage = await message.reply(command.errorMessages.downloadError);
                    await handleAutoDelete(errorMessage, command, true);
                    return;
                }

                try {
                    const imageAsSticker = MessageMedia.fromFilePath(imagePath);
                    const response = await message.reply(imageAsSticker, message.from, { sendMediaAsSticker: true });
                    await handleAutoDelete(response, command);
                } finally {
                    await deleteFile(imagePath);
                }
            } catch (error) {
                console.error('Error creating sticker from search:', error);
                const errorMessage = await message.reply(command.errorMessages.error);
                await handleAutoDelete(errorMessage, command, true);
            }
            return;
        }

        // Case 4: No media, no quoted message, no keyword
        const errorMessage = await message.reply(command.errorMessages.noKeyword);
        await handleAutoDelete(errorMessage, command, true);
    },

    DESENHO: async (message, command, input) => {
        const promptInput = input.slice(1).join(' ');
        if (!promptInput) {
            const errorMessage = await message.reply(command.errorMessages.noPrompt);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        try {
            const prompt = await getPromptWithContext('DESENHO', 'IMPROVE_PROMPT', message, {
                prompt: promptInput
            });
            const improvedPrompt = await runCompletion(prompt, 0.7, command.model);

            const originalImageBase64 = await generateImage(promptInput);
            const improvedImageBase64 = await generateImage(improvedPrompt);

            if (originalImageBase64 && improvedImageBase64) {
                const originalMedia = new MessageMedia('image/png', originalImageBase64, 'original_image.png');
                const improvedMedia = new MessageMedia('image/png', improvedImageBase64, 'improved_image.png');

                const response1 = await message.reply(originalMedia);
                const response2 = await message.reply(improvedMedia);
                await handleAutoDelete(response1, command);
                await handleAutoDelete(response2, command);
            } else {
                const errorMessage = await message.reply(command.errorMessages.generateError);
                await handleAutoDelete(errorMessage, command, true);
            }
        } catch (error) {
            console.error('[ERROR] Error in DESENHO command:', error.message);
            const errorMessage = await message.reply(command.errorMessages.generateError);
            await handleAutoDelete(errorMessage, command, true);
        }
    },

    COMMAND_LIST: async (message, command) => {
        const { getCommandListContent } = require('./commandHandler');
        const content = await getCommandListContent(message);
        const response = await message.reply(content);
        await handleAutoDelete(response, command);
    },

    AUDIO: async (message, command) => {
        if (!message.hasMedia || (message.type !== 'audio' && message.type !== 'ptt')) {
            return;
        }

        try {
            const audioData = await message.downloadMedia();
            const audioPath = path.join(__dirname, `audio_${Date.now()}.ogg`);
            
            try {
                await fsPromises.writeFile(audioPath, audioData.data, 'base64');
                const transcription = await transcribeAudio(audioPath);
                const response = await message.reply(`Transcrição:\n_${transcription}_`);
                await handleAutoDelete(response, command);
            } catch (error) {
                const errorMessage = await message.reply(command.errorMessages.transcriptionError);
                await handleAutoDelete(errorMessage, command, true);
            } finally {
                await deleteFile(audioPath);
            }
        } catch (error) {
            const errorMessage = await message.reply(command.errorMessages.downloadError);
            await handleAutoDelete(errorMessage, command, true);
        }
    },

    CACHE_CLEAR: async (message, command) => {
        try {
            await performCacheClearing();
            const response = await message.reply('Cache cleared successfully');
            await handleAutoDelete(response, command);
        } catch (error) {
            const errorMessage = await message.reply(command.errorMessages.error);
            await handleAutoDelete(errorMessage, command, true);
        }
    },

    TAG: async (message, command, input) => {
        const chat = await message.getChat();
        if (!chat.isGroup || !command.groupTags[chat.name]) {
            return;
        }

        const tag = command.tag;
        const participants = await chat.participants;
        let mentions = [];

        // Handle special tags
        if (command.specialTags[tag]) {
            if (command.specialTags[tag] === 'all_members') {
                mentions = participants.map(p => p.id._serialized);
            } else if (command.specialTags[tag] === 'admin_only') {
                mentions = participants
                    .filter(p => p.isAdmin)
                    .map(p => p.id._serialized);
            }
        }
        // Handle group-specific tags
        else if (command.groupTags[chat.name][tag]) {
            const nameFilters = command.groupTags[chat.name][tag];
            for (const participant of participants) {
                const contact = await global.client.getContactById(participant.id._serialized);
                const contactName = contact.name || contact.pushname || '';
                if (nameFilters.some(filter => contactName.toLowerCase().includes(filter.toLowerCase()))) {
                    mentions.push(participant.id._serialized);
                }
            }
        }

        if (mentions.length > 0) {
            const text = mentions.map(id => `@${id.split('@')[0]}`).join(' ');
            await chat.sendMessage(text, {
                mentions,
                quotedMessageId: message.id._serialized
            });
        } else {
            const errorMessage = await message.reply(command.errorMessages.noMatches);
            await handleAutoDelete(errorMessage, command, true);
        }
    },

    RESUMO_CONFIG: async (message, command, input) => {
        await handleResumoConfig(message);
    },
};

// Main command handler
async function handleCommand(message, command, input) {
    const handler = commandHandlers[command.name];
    if (!handler) {
        console.error(`Handler not found for command: ${command.name}`);
        const errorMessage = await message.reply(command.errorMessages?.error || 'Command not implemented.');
        await handleAutoDelete(errorMessage, command, true);
        return;
    }

    try {
        await handler(message, command, input);
    } catch (error) {
        const contact = await message.getContact();
        const chat = await message.getChat();
        const chatName = chat.name || 'DM';
        console.error(`Error in ${command.name} handler for ${contact.name || 'Unknown'} in ${chatName}:`, error.message);
        const errorMessage = await message.reply(command.errorMessages?.error || 'An error occurred while processing your command.');
        await handleAutoDelete(errorMessage, command, true);
        await notifyAdmin(`Error in ${command.name} handler: ${error.message}`);
    }
}

module.exports = {
    handleCommand
}; 