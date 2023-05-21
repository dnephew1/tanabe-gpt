///////////////////Setup//////////////////////
// Import necessary modules
const { Client , LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const translate = require('translate-google');
const { http, https } = require('follow-redirects');

// Path where the session data will be stored
const SESSION_FILE_PATH = './session.json';

// Load the session data if it has been previously saved
let sessionData;
if(fs.existsSync(SESSION_FILE_PATH)) {
    sessionData = require(SESSION_FILE_PATH);
}

// Use the saved values
const client = new Client({
    session: sessionData,
    puppeteer: {
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox'],},
    authStrategy: new LocalAuth(),
});

// Create a new OpenAI API client
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Show QR code for authentication
client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

// Initialize client
client.initialize();

// Confirm client is ready
client.on('ready', () => {
  console.log('Client is ready!');
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

// Declare the page variable outside of the event listener
let page;

///////////////////Script/////////////////////////
client.on('message', async message => {
  const messageBody = message.body;
  const linkRegex = /(https?:\/\/[^\s]+)/g;
  const links = messageBody.match(linkRegex);
  const contactName = (await message.getContact()).name;
  console.log(contactName,':',message.body);
  const input = message.body.split(' ');
  const inputLower = input.map(item => item.toLowerCase());
  const expectedHash = 'ca1b990a37591cf4abe221eedf9800e20df8554000b972fb3c5a474f2112cbaa';
  const ayubnews = '2ec460ac4810ace36065b5ef1fe279404ba812b04266ffb376a1c404dbdbd994';

  if (message.hasMedia && message.type === 'sticker') {
    const stickerData = await message.downloadMedia();

    // Save the sticker image file
    const saveDirectory = __dirname + '/stickers'; // Replace with the desired save directory
    const stickerFileName = `${message.id}.webp`; // Use a unique name for each sticker
    const savePath = `${saveDirectory}/${stickerFileName}`;

    fs.writeFileSync(savePath, stickerData.data);

    console.log(`Sticker saved to: ${savePath}`);

    // Calculate the SHA-256 hash of the saved sticker image
    const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');
    console.log('SHA-256 hash:', hash);
  }

  if (message.hasQuotedMsg && message.hasMedia && message.type === 'sticker') {
    const stickerData = await message.downloadMedia();
    // Calculate the SHA-256 hash of the sticker image
    const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');
    if (hash === expectedHash) {
      const chat = await message.getChat();
      await chat.sendStateTyping();
      const quotedMessage = await message.getQuotedMessage();
      const quotedText = quotedMessage.body;
      console.log('QUOTE:',quotedMessage.body);

      // Check for links in the quoted message
      const messageBody = quotedMessage.body;
      const linkRegex = /(https?:\/\/[^\s]+)/g;
      const links = messageBody.match(linkRegex);

      // If links are found, stop execution
      if (links && links.length > 0) {
        console.log('RESUMO DE LINK')
        const link = links[0];
        console.log(link);
        try {
          const unshortenedLink = await unshortenLink(link);
          console.log(unshortenedLink);
          let pageContent = await getPageContent(unshortenedLink);
          console.log(pageContent);

          const prompt = `Faça um curto resumo desse texto:\n\n${pageContent}.`;
          console.log(prompt);

          const summary = await runCompletion(prompt);
          console.log(summary);

          message.reply(summary);
          console.log('LINK:',summary)
        } catch (error) {
          console.error('Error accessing link to generate summary:', error);
          message.reply('Eu não consegui acessar o link para fazer um resumo.');
        }
      } else {
        const prompt = `Faça um resumo desse texto: ${quotedText}.`;
        console.log('PROMPT:',prompt);
        runCompletion(prompt).then(result => {
          message.reply(result);
          console.log('REPLY:', result);
        });
      }
      return;
    }
  }

  //////Summarize 1hr////////////////
    if (message.hasMedia && message.type === 'sticker' && (!links || links.length === 0)) {
      const stickerData = await message.downloadMedia();
  
      // Calculate the SHA-256 hash of the sticker image
      const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');
  
      if (hash === expectedHash) {
      const chat = await message.getChat();
      await chat.sendStateTyping();
      const messages = await chat.fetchMessages({ limit: 500 });
      const lastMessage = messages[messages.length - 2];
      const lastMessageTimestamp = lastMessage.timestamp;
      const oneHourBeforeLastMessageTimestamp = lastMessageTimestamp - 3600;
      const messagesSinceLastHour = messages.slice(0, -1).filter(message => (
        message.timestamp > oneHourBeforeLastMessageTimestamp &&
        message.fromMe === false &&
        message.body.trim() !== ''
      ));
      console.log('MESSAGES:', messagesSinceLastHour);
      const messageTexts = (await Promise.all(messagesSinceLastHour.map(async message => {
        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        return `>>${name}: ${message.body}`;
      }))).join(' ');
      
      
      console.log('MESSAGES:',messageTexts)
      const prompt = `Faça um resumo das mensagens dessa conversa do grupo diga no início da sua resposta que esse é o resumo das mensagens na última hora: ${messageTexts}.`;
      console.log('PROMPT:',prompt);
      runCompletion(prompt).then(result => message.reply(result));
    }  
    //////////Summarize X messages/////////////////
    const limit = parseInt(input[2]);
    } else if (inputLower[0] === 'resumo' && inputLower[1] === 'pf') { 
      const limit = parseInt(input[2]);
      if (isNaN(limit)) {
        const chat = await message.getChat();
        await chat.sendStateTyping();
        message.reply('Por favor, forneça um número válido após "Resumo pf" para definir o limite de mensagens.');
        return;
      }
      if (input.length >= 2 && input.length <= 501) {
        const chat = await message.getChat();
        await chat.sendStateTyping();
        const messages = await chat.fetchMessages({ limit: limit });
        const messageswithoutme = messages.slice(0, -1).filter(message => (
          message.fromMe === false &&
          message.body.trim() !== ''
        ));
        const messageTexts = (await Promise.all(messageswithoutme.map(async message => {
          const contact = await message.getContact();
          const name = contact.name || 'Unknown';
          
          return `>>${name}: ${message.body}`;
        }))).join(' ');
        console.log('MESSAGES:',messageTexts)
        const prompt = `Faça um resumo das últimas ${limit} mensagens dessa conversa do grupo: ${messageTexts}.`;
        console.log('PROMPT:',prompt);
        runCompletion(prompt).then(result => message.reply(result));
      }
  }
  ////////////////Respond to #////////////////
  if(message.body.startsWith("#")) {
    const chat = await message.getChat();
    await chat.sendStateTyping();
    runCompletion(message.body.substring(1)).then(result => message.reply(result));
  }
  ////////////////Ayub news///////////////////
  if (message.hasMedia && message.type === 'sticker') {
    console.log('AYUB NEWS')
    const stickerData = await message.downloadMedia();
    // Calculate the SHA-256 hash of the sticker image
    const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');
    // Compare sticker hash with the specified SHA hash
    if (message.hasMedia && message.type === 'sticker' && hash === '2ec460ac4810ace36065b5ef1fe279404ba812b04266ffb376a1c404dbdbd994') {
      const chat = await message.getChat();
      await chat.sendStateTyping();
      try {
        // Scrape news
        const news = await scrapeNews();
        // Translate news to Portuguese using translate-google
        const translatedNews = await translateToPortuguese(news);
  
        // Prepare reply
        let reply = 'Aqui estão as notícias mais relevantes de hoje:\n\n';
        translatedNews.forEach((newsItem, index) => {
          reply += `${index + 1}. ${newsItem}\n\n`;
        });
  
        // Reply to the message
        message.reply(reply);
        console.log('NEWS:',reply)
      } catch (error) {
        console.error('An error occurred:', error);
      }
    }
  }
  if (inputLower[0].toLowerCase() === 'ayub' && inputLower[1].toLowerCase() === 'news' && inputLower[2].toLowerCase() === 'fut') {
    console.log('AYUB NEWS FUT')
    const chat = await message.getChat();
    await chat.sendStateTyping();
    try {
      // Scrape news
      const news = await scrapeNews2();
  
      // Prepare reply
      let reply = 'Aqui estão as notícias sobre futebol mais relevantes de hoje:\n\n';
      news.forEach((newsItem, index) => {
        reply += `${index + 1}. ${newsItem.title}\n\n`;
      });
  
      // Reply to the message
      message.reply(reply);
      console('NEWS FUT:',reply)
    } catch (error) {
      console.error('An error occurred:', error);
    }
  }
  if (inputLower[0].toLowerCase() === 'ayub' && inputLower[1].toLowerCase() === 'news' && !inputLower.includes('fut')) {
    const keywords = input.slice(2).join(' ');
    console.log('AYUB NEWS',input[2])
    const chat = await message.getChat();
    await chat.sendStateTyping();
  
    const query = `${keywords}`;
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=news&df=w&ia=news&kl=br-pt`;
  
    try {
      const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.goto(searchUrl);
      await page.waitForSelector('.result__body');
      const newsElements = await page.$$('.result__body');
  
      let newsData = [];
      for (let i = 0; i < 5 && i < newsElements.length; i++) {
        const titleElement = await newsElements[i].$('.result__a[rel="noopener"]');
        const title = await (await titleElement.getProperty('textContent')).jsonValue();
        const sourceElement = await newsElements[i].$('.result__url');
        const source = await (await sourceElement.getProperty('textContent')).jsonValue();
        const timeElement = await newsElements[i].$('.result__timestamp');
        const time = await (await timeElement.getProperty('textContent')).jsonValue();
        const previewElement = await newsElements[i].$('.result__snippet');
        const preview = await (await previewElement.getProperty('textContent')).jsonValue();

  
        const newsItem = {
          title,
          preview,
          source,
          time
        };
        newsData.push(newsItem);
      }
  
      await browser.close();
  
      if (newsData.length > 0) {
        let reply = `Aqui estão os artigos mais recentes e relevantes sobre "${keywords}":\n\n`;
        newsData.forEach((item, index) => {
          const numberedTitle = `${index + 1}. *${item.title}*\nPreview: ${item.preview}\nHora: ${item.time}\nFonte: ${item.source}\n\n`;
          reply += numberedTitle;
        });
        message.reply(reply);
        console.log('NEWS:',reply)
      } else {
        message.reply(`Nenhum artigo encontrado para "${keywords}".`);
      }
    } catch (error) {
      console.error('An error occurred:', error);
      message.reply('Erro ao buscar por artigos.');
    }
  }
  
  if (contactName === 'Rodrigo "News" Ayub' && links && links.length > 0) {
    console.log('AYUB NEWS')
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const link = links[0];
    console.log(link);
    try {
      const unshortenedLink = await unshortenLink(link);
      console.log(unshortenedLink);
      let pageContent = await getPageContent(unshortenedLink);
      console.log(pageContent);
  
      const prompt = `Faça um curto resumo desse texto:\n\n${pageContent}.`;
      console.log(prompt);
  
      const summary = await runCompletion(prompt);
      console.log(summary);
  
      message.reply(summary);
      console.log('NEWS:',summary)
    } catch (error) {
      console.error('Error accessing link to generate summary:', error);
      message.reply('Eu não consegui acessar o link para fazer um resumo.');
    }
  }
//////////////////////TAGS/////////////////////////////
  if (message.body.toLowerCase().includes('@all') && !message.hasQuotedMsg) {
    let chat = await message.getChat();

    // Make sure this is a group chat
    if(chat.isGroup) {
        let text = '';
        let mentions = [];

        for(let participant of chat.participants) {
            let contact = await client.getContactById(participant.id._serialized);
            mentions.push(contact);
            text += `@${contact.number} `;
        }

        chat.sendMessage(text, {
            mentions,
            quotedMessageId: message.id._serialized // This will quote the message that includes "@all"
        });
    }
}

if (message.hasQuotedMsg && message.body.toLowerCase().includes('@all')) {
  const quotedMessage = await message.getQuotedMessage();
  const chat = await message.getChat();

  // Make sure this is a group chat
  if(chat.isGroup) {
    let text = '';
    let mentions = [];

    for(let participant of chat.participants) {
        let contact = await client.getContactById(participant.id._serialized);
        mentions.push(contact);
        text += `@${contact.number} `;
    }

      chat.sendMessage(text, {
          mentions,
          quotedMessageId: quotedMessage.id._serialized // This will quote the originally quoted message
      });
  }
}


if (message.body.toLowerCase().includes('@admin') && !message.hasQuotedMsg) {
  let chat = await message.getChat();

  // Make sure this is a group chat
  if(chat.isGroup) {
      let mentions = [];

      for(let participant of chat.participants) {
        let contact = await client.getContactById(participant.id._serialized);
        if(participant.isAdmin) {
            mentions.push(contact);
        }
    }

    let text = mentions.map(contact => `@${contact.number}`).join(' ');

      chat.sendMessage(text, {
          mentions,
          quotedMessageId: message.id._serialized // This will quote the message that includes "@all"
      });
    }
  }

  if (message.hasQuotedMsg && message.body.toLowerCase().includes('@admin')) {
  const quotedMessage = await message.getQuotedMessage();
  const chat = await message.getChat();

    // Make sure this is a group chat
    if(chat.isGroup) {
      let mentions = [];

      for(let participant of chat.participants) {
        let contact = await client.getContactById(participant.id._serialized);
        if(participant.isAdmin) {
            mentions.push(contact);
        }
    }

    let text = mentions.map(contact => `@${contact.number}`).join(' ');

        chat.sendMessage(text, {
            mentions,
            quotedMessageId: quotedMessage.id._serialized // This will quote the originally quoted message
        });
    }
  }
  
  if (message.body.toLowerCase().includes('@medicos') && !message.hasQuotedMsg) {
    let chat = await message.getChat();
  
    // Make sure this is a group chat
    if(chat.isGroup) {
        let mentions = [];
  
        for(let participant of chat.participants) {
          let contact = await client.getContactById(participant.id._serialized);

          if(contact.name.includes('Maddi') || contact.name.includes('Costa')) {
              mentions.push(contact);
          }
      }
  
      let text = mentions.map(contact => `@${contact.number}`).join(' ');
  
        chat.sendMessage(text, {
            mentions,
            quotedMessageId: message.id._serialized // This will quote the message that includes "@all"
        });
    }
  }
  
    if (message.hasQuotedMsg && message.body.toLowerCase().includes('@medicos')) {
    const quotedMessage = await message.getQuotedMessage();
    const chat = await message.getChat();
  
      // Make sure this is a group chat
      if(chat.isGroup) {
        let mentions = [];
  
        for(let participant of chat.participants) {
          let contact = await client.getContactById(participant.id._serialized);

          if(contact.name.includes('Maddi') || contact.name.includes('Costa')) {
              mentions.push(contact);
          }
      }
  
      let text = mentions.map(contact => `@${contact.number}`).join(' ');
  
          chat.sendMessage(text, {
              mentions,
              quotedMessageId: quotedMessage.id._serialized // This will quote the originally quoted message
          });
    }
  }
  if (message.body.toLowerCase().includes('@médicos') && !message.hasQuotedMsg) {
    let chat = await message.getChat();
  
    // Make sure this is a group chat
    if(chat.isGroup) {
        let mentions = [];
  
        for(let participant of chat.participants) {
          let contact = await client.getContactById(participant.id._serialized);

          if(contact.name.includes('Maddi') || contact.name.includes('Costa')) {
              mentions.push(contact);
          }
      }
  
      let text = mentions.map(contact => `@${contact.number}`).join(' ');
  
        chat.sendMessage(text, {
            mentions,
            quotedMessageId: message.id._serialized // This will quote the message that includes "@all"
        });
    }
  }
  
    if (message.hasQuotedMsg && message.body.toLowerCase().includes('@médicos')) {
    const quotedMessage = await message.getQuotedMessage();
    const chat = await message.getChat();
  
      // Make sure this is a group chat
      if(chat.isGroup) {
        let mentions = [];
  
        for(let participant of chat.participants) {
          let contact = await client.getContactById(participant.id._serialized);

          if(contact.name.includes('Maddi') || contact.name.includes('Costa')) {
              mentions.push(contact);
          }
      }
  
      let text = mentions.map(contact => `@${contact.number}`).join(' ');
  
          chat.sendMessage(text, {
              mentions,
              quotedMessageId: quotedMessage.id._serialized // This will quote the originally quoted message
          });
    }
  }

  if (message.body.toLowerCase().includes('@engenheiros') && !message.hasQuotedMsg) {
    let chat = await message.getChat();
  
    // Make sure this is a group chat
    if(chat.isGroup) {
        let mentions = [];
  
        for(let participant of chat.participants) {
          let contact = await client.getContactById(participant.id._serialized);

          if(contact.name.includes('Ormundo') || contact.name.includes('João')|| contact.name.includes('Parolin')|| contact.name.includes('Boacnin')) {
              mentions.push(contact);
          }
      }
  
      let text = mentions.map(contact => `@${contact.number}`).join(' ');
  
        chat.sendMessage(text, {
            mentions,
            quotedMessageId: message.id._serialized // This will quote the message that includes "@all"
        });
    }
  }
  
    if (message.hasQuotedMsg && message.body.toLowerCase().includes('@engenheiros') ) {
    const quotedMessage = await message.getQuotedMessage();
    const chat = await message.getChat();
  
      // Make sure this is a group chat
      if(chat.isGroup) {
        let mentions = [];
  
        for(let participant of chat.participants) {
          let contact = await client.getContactById(participant.id._serialized);

          if(contact.name.includes('Ormundo') || contact.name.includes('João')|| contact.name.includes('Parolin')|| contact.name.includes('Boacnin')) {
              mentions.push(contact);
          }
      }
  
      let text = mentions.map(contact => `@${contact.number}`).join(' ');
  
          chat.sendMessage(text, {
              mentions,
              quotedMessageId: quotedMessage.id._serialized // This will quote the originally quoted message
          });
    }
  }
  if (message.body.toLowerCase().includes('@cartola') && !message.hasQuotedMsg) {
    let chat = await message.getChat();
  
    // Make sure this is a group chat
    if(chat.isGroup) {
        let mentions = [];
  
        for(let participant of chat.participants) {
          let contact = await client.getContactById(participant.id._serialized);

          if(contact.name.includes('Mdasi') || contact.name.includes('Boacnin')|| contact.name.includes('Costa')|| contact.name.includes('Dybwad')|| contact.name.includes('Ricardo')|| contact.name.includes('Parolin')) {
              mentions.push(contact);
          }
      }
  
      let text = mentions.map(contact => `@${contact.number}`).join(' ');
  
        chat.sendMessage(text, {
            mentions,
            quotedMessageId: message.id._serialized // This will quote the message that includes "@all"
        });
    }
  }
  
    if (message.hasQuotedMsg && message.body.toLowerCase().includes('@cartola') ) {
    const quotedMessage = await message.getQuotedMessage();
    const chat = await message.getChat();
  
      // Make sure this is a group chat
      if(chat.isGroup) {
        let mentions = [];
  
        for(let participant of chat.participants) {
          let contact = await client.getContactById(participant.id._serialized);

          if(contact.name.includes('Mdasi') || contact.name.includes('Boacnin')|| contact.name.includes('Costa')|| contact.name.includes('Dybwad')|| contact.name.includes('Ricardo')|| contact.name.includes('Parolin')) {
              mentions.push(contact);
          }
      }
  
      let text = mentions.map(contact => `@${contact.number}`).join(' ');
  
          chat.sendMessage(text, {
              mentions,
              quotedMessageId: quotedMessage.id._serialized // This will quote the originally quoted message
          });
    }
  }
});
/////////////////////FUNCTIONS/////////////////////////
// Function to scrape news from the website (fetches only the first 5 news)
async function scrapeNews() {
  const url = 'https://www.newsminimalist.com/';
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);
  const newsElements = $('.inline-flex.w-full.items-baseline.rounded.py-4');

  const news = [];
  newsElements.each((index, element) => {
    if (index < 5) {
      const newsText = $(element).find('div').text().trim();
      news.push(newsText);
    }
  });

  return news;
}
// Function to translate the news to Portuguese using translate-google
async function translateToPortuguese(news) {
  const translatedNews = await Promise.all(news.map(async (newsItem) => {
    try {
      const translation = await translate(newsItem, { to: 'pt' });
      return translation;
    } catch (error) {
      console.error(`Translation failed for: ${newsItem}`, error);
      return newsItem; // If translation fails, use the original text
    }
  }));

  return translatedNews;
}
// Function to scrape news from the website
async function scrapeNews2() {
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

      const newsItem = {
        title,
        summary,
        link,
      };

      news.push(newsItem);
    }
  });

  return news;
}
async function runCompletion(prompt) {
  const completion = await openai.createCompletion({
      model: "text-davinci-003",
      prompt: prompt,
      max_tokens: 1000,
  });
  return completion.data.choices[0].text;
  console.log('REPLY:',result)          
}


// Helper function to extract the link from a message text
function extractLink(messageText) {
  const regex = /(https?:\/\/[^\s]+)/g;
  const match = messageText.match(regex);
  return match ? match[0] : '';
}

// Helper function to unshorten a shortened link
async function unshortenLink(link) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'HEAD',
      timeout: 5000, // Adjust the timeout value as needed
    };

    const client = link.startsWith('https') ? https : http;
    const request = client.request(link, options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
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
}

// Helper function to retrieve the content of a web page
async function getPageContent(url) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.goto(url);

  const textContent = await page.evaluate(() => {
    // Extract text content from the page
    const bodyElement = document.querySelector('body');
    let content = bodyElement.innerText;
    content = content.substring(0, 5000); // Grab the first 5000 characters
    content = content.replace(/\n/g, ""); // Remove line breaks
    return content;
  });

  await browser.close();
  return textContent;
}
