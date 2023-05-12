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
      args: ['--no-sandbox'],},
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
  console.log('MESSAGE:',message.body);
  const input = message.body.split(' ');
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
      const prompt = `Faça um resumo desse texto: ${quotedText}`;
      console.log('PROMPT:',prompt);
      runCompletion(prompt).then(result => {
        message.reply(result);
        console.log('REPLY:', result);
      });
    return;
    }
  }  
  //////Summarize 1hr////////////////
    if (message.hasMedia && message.type === 'sticker') {
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
      const messagesSinceLastHour = messages.filter(message => (
        message.timestamp > oneHourBeforeLastMessageTimestamp &&
        message.fromMe === false
      ));
      console.log('MESSAGES:', messagesSinceLastHour);
      const messageTexts = (await Promise.all(messagesSinceLastHour.map(async message => {
        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        return `>>${name}: ${message.body}`;
      }))).join(' ');
      
      
      console.log('MESSAGES:',messageTexts)
      const prompt = `Faça um resumo das mensagens dessa conversa do grupo diga no início da sua resposta que esse é o resumo das mensagens na última hora: ${messageTexts}`;
      console.log('PROMPT:',prompt);
      runCompletion(prompt).then(result => message.reply(result));
    }  
    //////////Summarize X messages/////////////////
    const limit = parseInt(input[2]);
    } else if (input[0] === 'Resumo' && input[1] === 'pf') { 
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
        const messageswithoutme = messages.filter(message => (
          message.fromMe === false
        ));
        const messageTexts = (await Promise.all(messageswithoutme.map(async message => {
          const contact = await message.getContact();
          const name = contact.name || 'Unknown';
          
          return `>>${name}: ${message.body}`;
        }))).join(' ');
        console.log('MESSAGES:',messageTexts)
        const prompt = `Faça um resumo das últimas ${limit} mensagens dessa conversa do grupo: ${messageTexts}`;
        console.log('PROMPT:',prompt);
        runCompletion(prompt).then(result => message.reply(result));
      }
  }
  ////////////////Respond to #////////////////
  if(message.body.startsWith("#")) {
    const chat = await message.getChat();
    await chat.sendStateTyping();
    runCompletion(message.body.substring(1)).then(result => message.reply(result));
    console.log('REQUEST:',message.body)     
  }
  ////////////////Ayub news///////////////////
  if (message.hasMedia && message.type === 'sticker') {
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
        console.log(news)
        // Translate news to Portuguese using translate-google
        const translatedNews = await translateToPortuguese(news);
        // Reply to the message
        const reply = `Aqui estão as notícias mais relevantes de hoje:\n\n${translatedNews.join('\n\n')}`;
        message.reply(reply);
      } catch (error) {
        console.error('An error occurred:', error);
      }
    }
  }
  if (input[0] === 'Ayub' && input[1] === 'news' && input[2] === 'fut') {
    const chat = await message.getChat();
    await chat.sendStateTyping();
    try {
      // Scrape news
      const news = await scrapeNews2();

      // Prepare reply
      let reply = 'Aqui estão as notícias sobre futebol mais relevantes de hoje:\n\n';
      news.forEach((newsItem, index) => {
        reply += `${newsItem.title}\n\n`;
      });

      // Reply to the message
      message.reply(reply);
    } catch (error) {
      console.error('An error occurred:', error);
    }
  }
  if (input[0] === 'Ayub' && input[1] === 'news') {
    const keywords = input.slice(2).join(' ');
    const chat = await message.getChat();
    await chat.sendStateTyping();
  
    const query = `site:news.google.com ${keywords}`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&lr=lang_pt&hl=pt-BR&gl=BR`;
  
    try {
      const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.goto(searchUrl);
      await page.waitForSelector('.g');
      const newsElements = await page.$$('.g');
  
      let newsTitles = [];
      for (let i = 0; i < 5 && i < newsElements.length; i++) {
        const titleElement = await newsElements[i].$('h3');
        const title = await (await titleElement.getProperty('textContent')).jsonValue();
        const numberedTitle = `${i + 1}. ${title}`; // Add the number to the title
        newsTitles.push(numberedTitle);
      }
  
      await browser.close();
  
      if (newsTitles.length > 0) {
        const reply = `Aqui estão os artigos mais recentes e relevantes sobre "${keywords}":\n\n${newsTitles.join('\n\n')}`;
        message.reply(reply);
      } else {
        message.reply(`Nenhum artigo encontrado para "${keywords}".`);
      }
    } catch (error) {
      console.error('An error occurred:', error);
      message.reply('Erro ao buscar por artigos.');
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
async function runCompletion (message) {
  const completion = await openai.createCompletion({
      model: "text-davinci-003",
      prompt: message,
      max_tokens: 1000,
  });
  return completion.data.choices[0].text;
  console.log('REPLY:',result)          
}
async function summarizeText(prompt) {
  const response = await openai.completions.create({
    engine: 'text-davinci-003',
    prompt: prompt,
    max_tokens: 1000,
    n: 1,
  });
  return completion.data.choices[0].text;      
}
