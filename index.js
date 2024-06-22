// Import necessary modules
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
require('dotenv').config();
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { http, https } = require('follow-redirects');

// Setup variables and constants
const adminPhoneNumber = '000000000000';
const SESSION_FILE_PATH = './session.json';
let sessionData;

// Load session data if it exists
if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionData = require(SESSION_FILE_PATH);
}

// Create a new WhatsApp client instance
const client = new Client({
    session: sessionData,
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    },
    authStrategy: new LocalAuth(),
});

// Create a new OpenAI API client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Show QR code for authentication
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

// Initialize the client
client.initialize();

// Confirm client is ready
client.on('ready', async () => {
    console.log('Client is ready!');
    const adminContact = `${adminPhoneNumber}@c.us`;
    try {
        await client.sendMessage(adminContact, "Estou vivo!");
    } catch (error) {
        console.error(`Failed to send "Estou vivo!" message: ${error}`);
    }
});

// Reconnect on disconnection
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

function reconnectClient() {
    if (reconnectAttempts < maxReconnectAttempts) {
        console.log('Attempting to reconnect...');
        client.initialize();
        reconnectAttempts++;
    } else {
        console.log(`Failed to reconnect after ${maxReconnectAttempts} attempts. Exiting...`);
        process.exit(1);
    }
}

client.on('disconnected', (reason) => {
    console.log('Client disconnected: ' + reason);
    reconnectClient();
});

// Handle incoming messages
client.on('message', async message => {
    try {
        const messageBody = message.body;
        const linkRegex = /(https?:\/\/[^\s]+)/g;
        const links = messageBody.match(linkRegex);
        const contactName = (await message.getContact()).name;
        console.log(contactName, ':', message.body);
        const input = message.body.split(' ');
        const inputLower = input.map(item => item.toLowerCase());

        let commandHandled = false;

        // Check for media stickers and handle them
        if (message.hasMedia && message.type === 'sticker') {
            await handleStickerMessage(message);
            commandHandled = true;
        } else if (inputLower[0].startsWith('#sticker')) {
            await handleStickerCreation(message);
            commandHandled = true;
        } else if (inputLower[0].startsWith('#resumo')) {
            await handleResumoCommand(message, input);
            commandHandled = true;
        } else if (inputLower[0].startsWith('#ayubnews')) {
            await handleAyubNewsCommand(message, input);
            commandHandled = true;
        } else if (inputLower[0] === '#?') {
            await handleCommandList(message);
            commandHandled = true;
        } else if (message.body.startsWith('#')) {
            await handleHashTagCommand(message);
            commandHandled = true;
        }

        if (contactName.includes('Ayub') && links && links.length > 0) {
            await handleAyubLinkSummary(message, links);
            commandHandled = true;
        }

        // Call handleTags if no other command was handled and message contains '@' sign
        if (!commandHandled && message.body.includes('@')) {
            await handleTags(message);
        }
    } catch (error) {
        console.error('An error occurred while processing a message:', error);
    }
});



// Event handler for message reactions
client.on('message_reaction', async (reaction) => {
    console.log('Reaction detected');
    try {
        const reactedMsgId = reaction.msgId;
        const chat = await client.getChatById(reaction.msgId.remote);
        const messages = await chat.fetchMessages();

        for (let message of messages) {
            if (message.id._serialized === reactedMsgId._serialized) {
                await message.delete(true);
                console.log('Deleted message: ' + message.body);
                break;
            }
        }
    } catch (error) {
        console.error('An error occurred in the message_reaction event handler:', error);
    }
});

// Functions for specific commands and actions

// Function to handle #resumo command
async function handleResumoCommand(message, input) {
    console.log('handleResumoCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const limit = parseInt(input[1]);

    if (isNaN(limit)) {
        message.reply('Por favor, forneça um número válido após "#resumo" para definir o limite de mensagens.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
        return;
    }

    const messages = await chat.fetchMessages({ limit: limit });
    const messagesWithoutMe = messages.slice(0, -1).filter(msg => msg.fromMe === false && msg.body.trim() !== '');

    if (messagesWithoutMe.length === 0) {
        message.reply('Não há mensagens suficientes para gerar um resumo.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
        return;
    }

    const messageTexts = (await Promise.all(messagesWithoutMe.map(async msg => {
        const contact = await msg.getContact();
        const name = contact.name || 'Unknown';
        return `>>${name}: ${msg.body}.\n`;
    }))).join(' ');

    const contact = await message.getContact();
    const name = contact.name || 'Unknown';
    const prompt = `${name} está pedindo para que você resuma as últimas ${limit} mensagens desta conversa de grupo:\n\nINÍCIO DAS MENSAGENS:\n\n${messageTexts}\nFIM DAS MENSAGENS.\n\nSe não houver mensagens suficientes, responda com: "Não há mensagens suficientes para gerar um resumo."`;
    const result = await runCompletion(prompt);
    message.reply(result.trim())
        .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
}

// Function to handle sticker messages
async function handleStickerMessage(message) {
    const stickerData = await message.downloadMedia();
    const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');

    const expectedHashResumo = 'ca1b990a37591cf4abe221eedf9800e20df8554000b972fb3c5a474f2112cbaa';
    const expectedHashAyub = '2ec460ac4810ace36065b5ef1fe279404ba812b04266ffb376a1c404dbdbd994';

    if (hash === expectedHashResumo) {
        await handleResumoSticker(message);
    } else if (hash === expectedHashAyub) {
        await handleAyubNewsSticker(message);
    } else {
        console.log('Sticker hash does not match any expected hash');
    }
}

// Function to handle #ayubnews command
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

// Function to handle Ayub link summary
async function handleAyubLinkSummary(message, links) {
    console.log('handleAyubLinkSummary activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const link = links[0];

    if (link.includes('x.com')) {
        console.log('Skipping Twitter link:', link);
        return;
    }

    try {
        const unshortenedLink = await unshortenLink(link);
        const pageContent = await getPageContent(unshortenedLink);
        const prompt = `Faça um resumo deste texto:\n\n${pageContent}.`;
        const summary = await runCompletion(prompt);
        message.reply(summary.trim())
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
    } catch (error) {
        console.error('Error accessing link to generate summary:', error);
        message.reply('Não consegui acessar o link para gerar um resumo.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
    }
}

// Function to handle hashtag commands
async function handleHashTagCommand(message) {
    console.log('handleHashTagCommand activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const contact = await message.getContact();
    const name = contact.name || 'Unknown';

    let prompt = `${name} está perguntando: ${message.body.substring(1)}\n`;

    if (message.hasQuotedMsg) {
        const quotedMessage = await message.getQuotedMessage();
        prompt += '\n\nPara contexto adicional, a conversa se refere a esta mensagem:' + quotedMessage.body + '\n';
    }

    const result = await runCompletion(prompt);
    message.reply(result.trim())
        .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
}

// Function to handle command list
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
    `;

    message.reply(commandList)
        .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
}

// Function to handle mentions/tags
async function handleTags(message) {
    console.log('handleTags activated');
    const chat = await message.getChat();

    if (chat.isGroup) {
        let mentions = [];
        if (message.body.toLowerCase().includes('@all') && !message.hasQuotedMsg) {
            for (let participant of chat.participants) {
                let contact = await client.getContactById(participant.id._serialized);
                mentions.push(contact);
            }
            sendTagMessage(chat, mentions, message.id._serialized);
        }

        if (message.hasQuotedMsg && message.body.toLowerCase().includes('@all')) {
            const quotedMessage = await message.getQuotedMessage();
            for (let participant of chat.participants) {
                let contact = await client.getContactById(participant.id._serialized);
                mentions.push(contact);
            }
            sendTagMessage(chat, mentions, quotedMessage.id._serialized);
        }

        if (message.body.toLowerCase().includes('@admin') && !message.hasQuotedMsg) {
            for (let participant of chat.participants) {
                let contact = await client.getContactById(participant.id._serialized);
                if (participant.isAdmin) {
                    mentions.push(contact);
                }
            }
            sendTagMessage(chat, mentions, message.id._serialized);
        }

        if (message.hasQuotedMsg && message.body.toLowerCase().includes('@admin')) {
            const quotedMessage = await message.getQuotedMessage();
            for (let participant of chat.participants) {
                let contact = await client.getContactById(participant.id._serialized);
                if (participant.isAdmin) {
                    mentions.push(contact);
                }
            }
            sendTagMessage(chat, mentions, quotedMessage.id._serialized);
        }

        if (message.body.toLowerCase().includes('@medicos') && !message.hasQuotedMsg) {
            for (let participant of chat.participants) {
                let contact = await client.getContactById(participant.id._serialized);
                if (contact.name.includes('Maddi') || contact.name.includes('Costa')) {
                    mentions.push(contact);
                }
            }
            sendTagMessage(chat, mentions, message.id._serialized);
        }

        if (message.hasQuotedMsg && message.body.toLowerCase().includes('@medicos')) {
            const quotedMessage = await message.getQuotedMessage();
            for (let participant of chat.participants) {
                let contact = await client.getContactById(participant.id._serialized);
                if (contact.name.includes('Maddi') || contact.name.includes('Costa')) {
                    mentions.push(contact);
                }
            }
            sendTagMessage(chat, mentions, quotedMessage.id._serialized);
        }

        if (message.body.toLowerCase().includes('@engenheiros') && !message.hasQuotedMsg) {
            for (let participant of chat.participants) {
                let contact = await client.getContactById(participant.id._serialized);
                if (contact.name.includes('Ormundo') || contact.name.includes('João') || contact.name.includes('Ricardo') || contact.name.includes('Parolin') || contact.name.includes('Boacnin')) {
                    mentions.push(contact);
                }
            }
            sendTagMessage(chat, mentions, message.id._serialized);
        }

        if (message.hasQuotedMsg && message.body.toLowerCase().includes('@engenheiros')) {
            const quotedMessage = await message.getQuotedMessage();
            for (let participant of chat.participants) {
                let contact = await client.getContactById(participant.id._serialized);
                if (contact.name.includes('Ormundo') || contact.name.includes('João') || contact.name.includes('Ricardo') || contact.name.includes('Parolin') || contact.name.includes('Boacnin')) {
                    mentions.push(contact);
                }
            }
            sendTagMessage(chat, mentions, quotedMessage.id._serialized);
        }

        if (message.hasQuotedMsg && message.body.toLowerCase().includes('@cartola')) {
            const quotedMessage = await message.getQuotedMessage();
            for (let participant of chat.participants) {
                let contact = await client.getContactById(participant.id._serialized);
                if (contact.name.includes('Madasi') || contact.name.includes('Boacnin') || contact.name.includes('Costa') || contact.name.includes('Dybwad') || contact.name.includes('Ricardo') || contact.name.includes('Parolin')) {
                    mentions.push(contact);
                }
            }
            sendTagMessage(chat, mentions, quotedMessage.id._serialized);
        }
    }
}

// Function to send tag message
function sendTagMessage(chat, mentions, quotedMessageId) {
    let text = mentions.map(contact => `@${contact.number}`).join(' ');
    chat.sendMessage(text, {
        mentions,
        quotedMessageId
    });
}

// Function to handle sticker creation
async function handleStickerCreation(message) {
    console.log('handleStickerCreation activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    const query = message.body.slice(9).trim();
    if (query && /\S/.test(query)) {
        try {
            const imageUrl = await searchGoogleForImage(query);
            if (imageUrl) {
                const imagePath = await downloadImage(imageUrl);
                if (imagePath) {
                    const imageAsSticker = MessageMedia.fromFilePath(imagePath);
                    await client.sendMessage(message.from, imageAsSticker, {
                        sendMediaAsSticker: true
                    });
                } else {
                    message.reply('Falha ao baixar a imagem para o sticker.');
                }
            } else {
                message.reply('Nenhuma imagem encontrada para a consulta fornecida.');
            }
        } catch (error) {
            console.error('Error:', error);
            message.reply('Ocorreu um erro ao processar sua solicitação.');
        }
    } else {
        message.reply('Por favor, forneça uma palavra-chave após #sticker.');
    }
}

// Helper functions for various tasks

// Function to interact with OpenAI API
async function runCompletion(prompt) {
    try {
        const botRole = "DIRETRIZES:\n\nVocê é um bot assistente pessoal em um grupo de WhatsApp de amigos, sua função é:\n1. Ser conciso nas suas respostas;\n2. Ser pessoal com os indivíduos que conversam com você, se dirigindo pessoalmente e diretamente à pessoa;\n3. Seja formal e eloquente. A nao ser que a pergunta do usuario comece com '!'.\n4.Não utilizar informações antecendentes como 'minha resposta é' ou 'resposta;'\n5. Tenha conciência que como você está em um grupo de WhatsApp, os membros já sabem quem você é e que você está respondendo algo, logo não é necessário se anunciar;\n7. Construa suas respostas em formato e como outro integrante de um grupo de WhatsApp;\n8. Se você for insultado, insulte de volta de jeito irônico baseado nessas características dos integrantes:\nFelipe \"Leviathan\" Boacnin: Ele é o Leviatan, o chefe supremo, ele só aparece de vez enquando\nGabriel \"Farialimer\" Madasi: Ele é um economista certinho;\nGabriel \"Raichavasca\" Parolin: Ele só joga League of Legends e faz engenharia de minas que não serve pra nada;\nJoão \"Batata\" Pedro: Ele é um gordo anti-social;\nLeonardo \"Fortemente Lésbico\" Costa: Ele é um riquinho fresco;\nMatheus \"Água de Piscina\" Dybwad: Ele bebeu àgua da piscina em quanto estava bebado;\nRodrigo \"News\" Ayub: Ele é um velho que só compartilha recorte de notícias;\nPedro \"Chaotic Evil\" Ormundo: Ele é secretamente do mal, chaotic evil, e obrigou o Dybwad a beber a àgua da piscina;\nPedro \"Pedoatra\" Maddi: Ele é um medico sex offender;\nDaniel \"Daddy\" Tanabe Nephew: Ele é seu criador e programador. Ele nunca deve ser criticado, somente elogiado;\n\nFIM DAS DIRETRIZES.\n\n";

        const completePrompt = botRole + prompt;
        const completion = await openai.chat.completions.create({
            messages: [{ role: 'system', content: 'You are a WhatsApp group assistant.' },
            { role: 'user', content: completePrompt }],
            model: 'gpt-4o',
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error('An error occurred in the runCompletion function:', error);
        return '';
    }
}

// Function to handle Ayub News sticker
async function handleAyubNewsSticker(message) {
    console.log('handleAyubNewsSticker activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    try {
        const news = await scrapeNews();
        if (news.length === 0) {
            message.reply('Não há notícias disponíveis no momento.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
            return;
        }

        const translatedNews = await translateToPortuguese(news);
        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        let reply = `Aqui estão as notícias mais relevantes de hoje, ${name}:\n\n`;
        translatedNews.forEach((newsItem, index) => {
            reply += `${index + 1}. ${newsItem}\n`;
        });

        message.reply(reply);
    } catch (error) {
        console.error('Error accessing news:', error);
        message.reply('Não consegui acessar as notícias de hoje.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
    }
}

// Function to handle Ayub News football
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

            message.reply(reply);
        } else {
            message.reply('Nenhum artigo de futebol encontrado.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
        }
    } catch (error) {
        console.error('Error accessing football news:', error);
        message.reply('Erro ao buscar artigos de futebol.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
    }
}

// Function to handle Ayub News search
async function handleAyubNewsSearch(message, input) {
    console.log('handleAyubNewsSearch activated');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    const keywords = input.slice(1).join(' ');
    const query = `${keywords}`;
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=news&df=w&ia=news&kl=br-pt`;

    const browser = await puppeteer.launch({
        args: ['--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu']
    });
    const page = await browser.newPage();

    try {
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('.result__body', { timeout: 60000 });

        const newsElements = await page.$$('.result__body');
        let newsData = [];

        if (newsElements.length > 0) {
            for (let i = 0; i < 5 && i < newsElements.length; i++) {
                const titleElement = await newsElements[i].$('.result__a[rel="noopener"]');
                const title = await (await titleElement.getProperty('textContent')).jsonValue();
                const sourceElement = await newsElements[i].$('.result__url');
                const source = await (await sourceElement.getProperty('textContent')).jsonValue();
                const timeElement = await newsElements[i].$('.result__timestamp');
                const time = await (await timeElement.getProperty('textContent')).jsonValue();
                const previewElement = await newsElements[i].$('.result__snippet');
                const preview = await (await previewElement.getProperty('textContent')).jsonValue();

                newsData.push({ title, preview, source, time });
            }
        } else {
            console.log('No news elements found with selector .result__body');
        }

        await browser.close();

        if (newsData.length > 0) {
            const contact = await message.getContact();
            const name = contact.name || 'Unknown';
            let reply = `Aqui estão os artigos mais recentes e relevantes sobre "${keywords}", ${name}:\n\n`;
            newsData.forEach((item, index) => {
                reply += `${index + 1}. *${item.title}*\nPrévia: ${item.preview}\nHora: ${item.time}\nFonte: ${item.source}\n\n`;
            });
            message.reply(reply);
        } else {
            message.reply(`Nenhum artigo encontrado para "${keywords}".`)
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
        }
    } catch (error) {
        console.error('An error occurred:', error);
        message.reply('Erro ao buscar artigos.')
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
    } finally {
        await browser.close();
    }
}

// Function to scrape news from the website
async function scrapeNews() {
    try {
        console.log('--scrapeNews')
        const url = 'https://www.newsminimalist.com/';
        const response = await axios.get(url);

        if (response.status !== 200) {
            console.error('Failed to load page');
            return [];
        }

        const $ = cheerio.load(response.data);
        const newsElements = $('div.mr-auto');

        if (!newsElements.length) {
            console.log('No news elements found');
            return [];
        }

        const news = [];
        newsElements.each((index, element) => {
            if (index < 5) {
                const headline = $(element).find('span').first().text().trim();
                const source = $(element).find('span.text-xs.text-slate-400').text().trim();
                news.push(`${headline} ${source}`);
            }
        });

        return news;
    } catch (error) {
        console.error('An error occurred while scraping news:', error);
        return [];
    }
}

// Function to translate news to Portuguese
async function translateToPortuguese(news) {
    console.log('--translateToPortuguese')
    const nonEmptyNews = news.filter(item => item.trim() !== '');
    const newsText = nonEmptyNews.join('\n');
    const prompt = `Translate the following English text to Portuguese (Brazil):\n\n${newsText}`;

    try {
        const completion = await runCompletion(prompt);
        const translatedNews = completion.trim().split('\n');
        return translatedNews;
    } catch (error) {
        console.error(`Translation failed for the news text`, error);
        return news;
    }
}

// Function to scrape football news
async function scrapeNews2() {
    try {
        console.log('--scrapeNews2')
        const url = 'https://ge.globo.com/futebol/';
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const newsElements = $('.feed-post-body');

        const news = [];
        newsElements.each((index, element) => {
            if (index < 5) {
                const title = $(element).find('.feed-post-body-title a').text().trim();
                const summary = $(element).find('.feed-post-body-resumo').text().trim();
                const link = $(element).find('.feed-post-body-title a').attr('href');
                news.push({ title, summary, link });
            }
        });

        return news;
    } catch (error) {
        console.error('An error occurred in the scrapeNews2 function:', error);
        return [];
    }
}

// Function to extract link from message
function extractLink(messageText) {
    console.log('--extractLink')
    const linkRegex = /(https?:\/\/[^\s]+)/g;
    const match = messageText.match(linkRegex);
    return match ? match[0] : null;
}

// Function to unshorten a shortened link
async function unshortenLink(link) {
    console.log('--unshortenLink')
    try {
        return new Promise((resolve, reject) => {
            const options = {
                method: 'HEAD',
                timeout: 5000,
            };

            const client = link.startsWith('https') ? https : http;
            const request = client.request(link, options, (response) => {
                if (response.statusCode >= 300 && response.headers.location) {
                    resolve(response.headers.location);
                } else {
                    resolve(link);
                }
            });

            request.on('error', (error) => {
                console.error('Error unshortening URL:', error);
                resolve(link);
            });

            request.end();
        });
    } catch (error) {
        console.error('An error occurred in the unshortenLink function:', error);
        return link;
    }
}

// Function to retrieve page content
async function getPageContent(url) {
    try {
        console.log('--getPageContent')
        const unshortenedLink = await unshortenLink(url);
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });
        const page = await browser.newPage();
        await page.goto(unshortenedLink, { waitUntil: 'networkidle2', timeout: 60000 });

        const textContent = await page.evaluate(() => {
            const bodyElement = document.querySelector('body');
            let content = bodyElement.innerText;
            content = content.substring(0, 5000); // Grab the first 5000 characters
            content = content.replace(/\n/g, ""); // Remove line breaks
            return content;
        });

        await browser.close();
        return textContent;
    } catch (error) {
        console.error('An error occurred in the getPageContent function:', error);
        return null;
    }
}

// Function to search Google for an image
async function searchGoogleForImage(query) {
    console.log('--searchGoogleForImage')
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu']
    });
    const page = await browser.newPage();

    try {
        const formattedQuery = query.split(' ').join('+') + '+meme';
        const url = `https://www.google.com/search?q=${formattedQuery}&sca_esv=adfface043f3fd58&gbv=1&tbm=isch`;

        await page.goto(url, { waitUntil: 'networkidle2' });
        await page.waitForSelector('div.kCmkOe', { visible: true });

        const imageUrl = await page.evaluate(() => {
            const container = document.querySelector('div.kCmkOe');
            const image = container ? container.querySelector('img') : null;
            return image ? image.src : null;
        });

        return imageUrl;
    } catch (error) {
        console.error('Error while searching for image:', error);
        return null;
    } finally {
        await browser.close();
    }
}

// Function to download an image
async function downloadImage(url) {
    const filePath = path.resolve(__dirname, 'image.jpeg');
    console.log('--downloadImage')
    try {
        if (url.startsWith('data:image')) {
            const base64Data = url.split('base64,')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filePath, buffer);
        } else {
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'arraybuffer'
            });
            const buffer = Buffer.from(response.data, 'binary');
            fs.writeFileSync(filePath, buffer);
        }
        return filePath;
    } catch (error) {
        console.error('An error occurred in the downloadImage function:', error);
        return null;
    }
}

// Function to delete a message after a timeout
async function deleteMessageAfterTimeout(sentMessage, timeout) {
    try {
        setTimeout(async () => {
            console.log('--messageTimeout')
            try {
                if (!sentMessage) {
                    console.error('sentMessage is undefined or null');
                    return;
                }

                const chat = await sentMessage.getChat();

                if (!chat) {
                    console.error('Failed to find the chat to delete the message');
                    return;
                }

                const messages = await chat.fetchMessages({ limit: 50 });
                const messageToDelete = messages.find(msg => msg.id._serialized === sentMessage.id._serialized);
                if (messageToDelete) {
                    await messageToDelete.delete(true);
                } else {
                    console.error('Failed to find the message to delete');
                }
            } catch (error) {
                console.error('Failed to delete message:', error);
            }
        }, timeout);
    } catch (error) {
        console.error('An error occurred in deleteMessageAfterTimeout:', error);
    }
}

async function handleResumoSticker(message) {
    const chat = await message.getChat();
    await chat.sendStateTyping();

    if (message.hasQuotedMsg) {
        const quotedMessage = await message.getQuotedMessage();
        const quotedText = quotedMessage.body;
        const link = extractLink(quotedText);

        if (link && typeof link === 'string') {
            try {
                console.log('linkSummary activated');
                const unshortenedLink = await unshortenLink(link);
                const pageContent = await getPageContent(unshortenedLink);
                const prompt = `Faça um resumo deste texto:\n\n${pageContent}.`;
                const summary = await runCompletion(prompt);
                message.reply(summary.trim())
                    .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
            } catch (error) {
                console.error('Error accessing link to generate summary:', error);
                message.reply('Não consegui acessar o link para gerar um resumo.')
                    .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
            }
        } else {
            console.log('MessageSummary activated');
            const contact = await message.getContact();
            const name = contact.name || 'Unknown';
            const sender = (await quotedMessage.getContact()).name || 'Unknown';
            const prompt = `${name} está pedindo para que você resuma esta mensagem de ${sender}:\n"${quotedText}".`;
            const result = await runCompletion(prompt);
            quotedMessage.reply(result.trim())
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
        }

    } else {
        console.log('hourSummary activated');
        const messages = await chat.fetchMessages({ limit: 500 });
        const oneHourAgo = Date.now() - 3600 * 1000;
        const messagesLastHour = messages.filter(m => m.timestamp * 1000 > oneHourAgo && !m.fromMe && m.body.trim() !== '');

        if (messagesLastHour.length === 0) {
            message.reply('Não há mensagens suficientes para gerar um resumo.')
                .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
            return;
        }

        const messageTexts = (await Promise.all(messagesLastHour.map(async msg => {
            const contact = await msg.getContact();
            const name = contact.name || 'Unknown';
            return `>>${name}: ${msg.body}.\n`;
        }))).join(' ');

        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        const prompt = `${name} está pedindo para que você resuma as mensagens da última hora nesta conversa de grupo:\n\nINÍCIO DAS MENSAGENS:\n\n${messageTexts}\nFIM DAS MENSAGENS.\n\nSe não houver mensagens suficientes, responda com: "Não há mensagens suficientes para gerar um resumo."`;
        const result = await runCompletion(prompt);
        message.reply(result.trim())
            .then(sentMessage => deleteMessageAfterTimeout(sentMessage, 5 * 60 * 1000));
    }
}

module.exports = {
    scrapeNews,
    downloadImage
};
