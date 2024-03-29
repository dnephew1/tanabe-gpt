///////////////////SETUP//////////////////////
// Import necessary modules
const { Client , LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const OpenAI = require("openai");
require('dotenv').config();
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const translate = require('translate-google');
const { http, https } = require('follow-redirects');
const { id } = require('translate-google/languages');
const sentMessages = new Map();

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
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // This is also the default, can be omitted
});

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

// Event triggered when the client is ready
client.on('ready', async () => {
  // Set the bot's state as "online"
  await client.sendPresenceAvailable();
});

// Declare the page variable outside of the event listener
let page;

///////////////////SCRIPT/////////////////////////
client.on('message', async message => {
  try {
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
    try {
        const stickerData = await message.downloadMedia();
        const saveDirectory = __dirname + '/stickers'; // Replace with the desired save directory
        const stickerFileName = `${message.id}.webp`; // Use a unique name for each sticker
        const savePath = `${saveDirectory}/${stickerFileName}`;
        fs.writeFileSync(savePath, stickerData.data);

        const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');
    } catch (error) {
        console.error('An error occurred while handling the sticker:', error);
        // Handle the error or log it
    }
}

if (message.hasQuotedMsg && message.hasMedia && message.type === 'sticker') {
    try {
        const stickerData = await message.downloadMedia();
        const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');
        
        if (hash === expectedHash) {
            const chat = await message.getChat();
            await chat.sendStateTyping();
            const quotedMessage = await message.getQuotedMessage();
            const quotedText = quotedMessage.body;

            const messageBody = quotedMessage.body;
            const linkRegex = /(https?:\/\/[^\s]+)/g;
            const links = messageBody.match(linkRegex);

            if (links && links.length > 0) {
                const link = links[0];
                try {
                    const unshortenedLink = await unshortenLink(link);
                    console.log('---------------------RESUMO DE LINK---------------------\n' + 'LINK:' + unshortenedLink);
                    let pageContent = await getPageContent(unshortenedLink);
                    console.log('\nTEXTO EXTRAIDO: ' + pageContent);
                    const contact = await message.getContact();
                    const name = contact.name || 'Unknown';
                    let prompt = `${name} está pedindo para que você faça um curto resumo sobre isso:\n"${pageContent}."`;
                    const summary = await runCompletion(prompt);
                    const trimmedSummary = summary.trim();
                    console.log('\nBOT: ' + trimmedSummary + '\n---------------------FIM---------------------');

                    message.reply(trimmedSummary);
                } catch (error) {
                    console.error('\n---------------------ERROR---------------------\nError accessing link to generate summary:', error + '\n---------------------ERROR---------------------');
                    message.reply('Eu não consegui acessar o link para fazer um resumo.');
                }
            } else {
                const contact = await message.getContact();
                const name = contact.name || 'Unknown';
                const quotedMessage = await message.getQuotedMessage();
                const quotedContact = await quotedMessage.getContact();
                const sender = quotedContact.name || 'Unknown';
                let prompt = `${name} está pedindo para que você faça um curto resumo sobre o texto enviado por ${sender}:\n"${quotedText}."`;
                console.log('\n---------------------RESUMO DE TEXTO---------------------\n TEXTO:',quotedText);
                runCompletion(prompt)
                .then(result => result.trim())
                .then(result => {
                    quotedMessage.reply(result);
                    console.log('BOT: ', result +'---------------------FIM---------------------');
                });
            }
        }
    } catch (error) {
        console.error('An error occurred while handling the quoted sticker:', error);
        // Handle the error or log it
    }
}

/////////////////////Summarize 1hr////////////////
if (message.hasMedia && message.type === 'sticker' && (!links || links.length === 0)) {
  try {
      const stickerData = await message.downloadMedia();
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
          
          const messageTexts = (await Promise.all(messagesSinceLastHour.map(async message => {
              const contact = await message.getContact();
              const name = contact.name || 'Unknown';
              return `>>${name}: ${message.body}.\n`;
          }))).join(' ');
          
          console.log('\n---------------------RESUMO DE MENSAGENS---------------------\nMENSSAGENS:\n', messageTexts);
          const contact = await message.getContact();
          const name = contact.name || 'Unknown';
          let prompt = `${name} está pedindo para que você faça um resumo das mensagens dessa conversa do grupo e diga no início da sua resposta que esse é o resumo das mensagens na última hora:\n${messageTexts}`;
          
          runCompletion(prompt)
              .then(result => result.trim())
              .then(result => {
                  message.reply(result)
                      .then(sentMessage => {
                          // Delete the bot's message after 10 seconds
                          setTimeout(() => {
                              sentMessage.delete(true);
                          }, 5 * 60 * 1000);
                      });
                  console.log('\nBOT: ' + result + '\n---------------------FIM---------------------\n');
              });
      }
  } catch (error) {
      console.error('An error occurred while handling the sticker:', error);
      // Handle the error or log it
  }
}

///////////////////////Respond to #////////////////
if (message.body.startsWith("#") && !message.body.includes("#sticker")) {
  try {
      console.log('\n---------------------PERGUNTA---------------------\nPERGUNTA:' + message.body.substring(1));
      
      const chat = await message.getChat();
      const contact = await message.getContact();
      const name = contact.name || 'Unknown';
      await chat.sendStateTyping();

      let prompt = `${name} está perguntando: ${message.body.substring(1)}\n`;

      if (message.hasQuotedMsg) {
          const quotedMessage = await message.getQuotedMessage();
          console.log('CONTEXTO: ' + quotedMessage.body)
          prompt += 'Para contexto adicional, a conversa está se referindo a essa mensagem:' + quotedMessage.body + '\n';
      }

      runCompletion(prompt)
          .then(result => result.trim())
          .then(result => {
              console.log('\nRESPOSTA: ' + result + '\n---------------------FIM---------------------\n');
              let colonIndex = result.indexOf(':');
              let cleanedResult = colonIndex !== -1 && colonIndex <= 25 ? result.slice(colonIndex + 1).trim() : result;
              return message.reply(cleanedResult);
          })
          .catch(error => {
              console.error('An error occurred while processing the question:', error);
              // Handle the error or log it
          });
  } catch (error) {
      console.error('An error occurred while handling the question:', error);
      // Handle the error or log it
  }
}
  
/////////////////////Ayub news///////////////////
if (message.hasMedia && message.type === 'sticker') {
  const stickerData = await message.downloadMedia();
  // Calculate the SHA-256 hash of the sticker image
  const hash = crypto.createHash('sha256').update(stickerData.data).digest('hex');

  // Compare sticker hash with the specified SHA hash
  if (hash === '2ec460ac4810ace36065b5ef1fe279404ba812b04266ffb376a1c404dbdbd994') {
    console.log('\n---------------------AYUB NEWS DE HOJE---------------------\n');
    const chat = await message.getChat();
    await chat.sendStateTyping();

    try {
      // Scrape news
      const news = await scrapeNews();

      // Translate news to Portuguese using translate-google
      const translatedNews = await translateToPortuguese(news);

      // Prepare reply
      const contact = await message.getContact();
      const name = contact.name || 'Unknown';
      let reply = `Aqui estão as notícias mais relevantes de hoje, ${name}:\n\n`;
      
      translatedNews.forEach((newsItem, index) => {
        reply += `${index + 1}. ${newsItem}\n`;
      });

      // Reply to the message
      await message.reply(reply);
      console.log('BOT: ' + reply + '\n---------------------FIM---------------------\n');
    } catch (error) {
      console.error('\n---------------------ERROR---------------------\nError fetching news:', error + '\n---------------------ERROR---------------------');
      message.reply('Desculpe, não consegui acessar as notícias de hoje.');
    }
  }
}

///////////////////Ayub News Fut///////////////////
  if (inputLower[0].toLowerCase() === 'ayub' && inputLower[1].toLowerCase() === 'news' && inputLower[2].toLowerCase() === 'fut') {
    console.log('\n---------------------AYUB NEWS FUT---------------------\n')
    const chat = await message.getChat();
    await chat.sendStateTyping();
    try {
      // Scrape news
      const news = await scrapeNews2();
  
      // Prepare reply
      const contact = await message.getContact();
      const name = contact.name || 'Unknown';
      let reply = `Aqui estão as notícias sobre futebol mais relevantes de hoje, ${name}:\n\n`;
      news.forEach((newsItem, index) => {
        reply += `${index + 1}. ${newsItem.title}\n`;
      });

  
      // Reply to the message
      message.reply(reply)
      console.log('\n',reply +'\n---------------------FIM---------------------\n')
    } catch (error) {
      console.error('An error occurred:', error);
    }
  }
///////////////////////Ayub News Busca////////////////////////
  if (inputLower[0].toLowerCase() === 'ayub' && inputLower[1].toLowerCase() === 'news' && !inputLower.includes('fut')) {
    const keywords = input.slice(2).join(' ');
    console.log('---------------------AYUB NEWS BUSCA---------------------',input[2])
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
        const contact = await message.getContact();
        const name = contact.name || 'Unknown';
        let reply = `Aqui estão os artigos mais recentes e relevantes sobre "${keywords}", ${name}:\n\n`;
        newsData.forEach((item, index) => {
          const numberedTitle = `${index + 1}. *${item.title}*\nPreview: ${item.preview}\nHora: ${item.time}\nFonte: ${item.source}\n\n`;
          reply += numberedTitle;
        });
        message.reply(reply)
        console.log('\nNEWS:',reply + '\n---------------------FIM---------------------\n')
      } else {
        message.reply(`Nenhum artigo encontrado para "${keywords}".\n---------------------FIM---------------------\n`)
        .then(sentMessage => {
          // Delete the bot's message after 10 seconds
          setTimeout(() => {
            sentMessage.delete(true);
          }, 5*60*1000);
        });;
      }
    } catch (error) {
      console.error('An error occurred:', error);
      message.reply('Erro ao buscar por artigos.')
      .then(sentMessage => {
        // Delete the bot's message after 10 seconds
        setTimeout(() => {
          sentMessage.delete(true);
        }, 5*60*1000);
      });;
    }
  }

///////////////////////////Link Ayub Resumo////////////////////////
  if (contactName.includes('Ayub') && links && links.length > 0) {
    console.log('AYUB NEWS');
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const link = links[0];
    console.log(link);
    
    if (link.includes('x.com')) {
      console.log('Skipping Twitter link:', link);
      return; // Skip summarization for Twitter links
    }
    
    try {
      const unshortenedLink = await unshortenLink(link);
      console.log(unshortenedLink);
      let pageContent = await getPageContent(unshortenedLink);
      console.log(pageContent);
    
      const prompt = `Faça um curto resumo desse texto:\n\n${pageContent}.`;
      console.log(prompt);
    
      const summary = await runCompletion(prompt);
      console.log(summary);
    
      message.reply(summary)
      console.log('NEWS:', summary);
    } catch (error) {
      console.error('Error accessing link to generate summary:', error);
      message.reply('Eu não consegui acessar o link para fazer um resumo.')
        .then(sentMessage => {
          // Delete the bot's message after 10 seconds
          setTimeout(() => {
            sentMessage.delete(true);
          }, 5 * 60 * 1000);
        });
    }
  } 
//////////////////////////TAGS/////////////////////////////
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

          if(contact.name.includes('Ormundo') || contact.name.includes('João')|| contact.name.includes('Ricardo')||contact.name.includes('Parolin')|| contact.name.includes('Boacnin')) {
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

          if(contact.name.includes('Ormundo') || contact.name.includes('João')|| contact.name.includes('Ricardo')|| contact.name.includes('Parolin')|| contact.name.includes('Boacnin')) {
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

          if(contact.name.includes('Madasi') || contact.name.includes('Boacnin')|| contact.name.includes('Costa')|| contact.name.includes('Dybwad')|| contact.name.includes('Ricardo')|| contact.name.includes('Parolin')) {
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

          if(contact.name.includes('Mdasi') || contact.name.includes('Boacnin')|| contact.name.includes('Costa')|| contact.name.includes('Dybwad')|| contact.name.includes('Ricardo')|| contact.name.includes('Parolin')|| contact.name.includes('Madasi')) {
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
//////////////////////STICKER//////////////////////////////////
if (message.hasMedia && message.body.includes('#sticker')) {
  try {
      const chat = await message.getChat();
      await chat.sendStateTyping();
      const attachmentData = await message.downloadMedia();
      message.reply(attachmentData, message.from, { sendMediaAsSticker: true });
  } catch (error) {
      console.error('An error occurred in the sticker handling code:', error);
      // Handle the error or log it
  }
}
  if (message.body.startsWith('#sticker')) {
    const chat = await message.getChat();
    await chat.sendStateTyping();
    const query = message.body.slice(9).trim(); // Remove "#sticker" from the query
    // Check if there's a non-empty and non-whitespace query after "#sticker"
    if (query && /\S/.test(query)) {
        try {
            // Call the search function and get the image URL
            const imageUrl = await searchGoogleForImage(query);

            // Check if an image URL was returned
            if (imageUrl) {
                // Call the download function and wait for the download to complete
                const imagePath = await downloadImage(imageUrl);

                // Check if the download was successful
                if (imagePath) {
                    const imageAsSticker = MessageMedia.fromFilePath(imagePath);

                    // Send the image as a sticker
                    await client.sendMessage(message.from, imageAsSticker, {
                        sendMediaAsSticker: true
                    });

                } else {
                    message.reply('Failed to download the image for the sticker.');
                }
            } else {
                message.reply('No image found for the given query.');
            }
        } catch (error) {
            console.error('Error:', error);
            message.reply('An error occurred while processing your request.');
        }
    } else {
        message.reply('Please provide a keyword after #sticker.');
    }
}
} catch (error) {
  console.error('An error occurred while processing a message:', error);
  // Handle the error or log it, but don't stop the client
}
});

/////////////////////FUNCTIONS/////////////////////////
// Function to scrape news from the website (fetches only the first 5 news)
async function scrapeNews() {
  try {
      const url = 'https://www.newsminimalist.com/';
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      const newsElements = $('article div.cursor-pointer.list-none.rounded.hover\\:bg-slate-100.dark\\:hover\\:bg-slate-800');
      const news = [];
      newsElements.each((index, element) => {
          if (index < 5) {
              const rawNewsText = $(element).find('div > div > span:nth-child(1)').text().trim();
              const startIndex = rawNewsText.indexOf(']') + 1;
              const newsText = rawNewsText.substring(startIndex).trim();
              console.log('News text:', newsText);
              news.push(newsText);
          }
      });
      console.log('News array:', news);
      return news;
  } catch (error) {
      console.error('An error occurred while scraping news:', error);
      // Handle the error or log it, and return an empty array
      return [];
  }
}

function delay(ms) {
  try {
      return new Promise(resolve => setTimeout(resolve, ms));
  } catch (error) {
      console.error('An error occurred in the delay function:', error);
      // Handle the error or log it
  }
}

// Function to translate the news to Portuguese using translate-google
async function translateToPortuguese(news) {
  // Filter out empty news items
  const nonEmptyNews = news.filter(item => item.trim() !== '');
  // Concatenate all news items into one string, separated by newlines
  const newsText = nonEmptyNews.join('\n');

  // Prepare the prompt for translation
  const prompt = `Translate the following English text to Portuguese (Brazil):\n\n${newsText}`;

  try {
    // Generate the completion
    const completion = await runCompletion(prompt);

    // Split the translated text back into individual news items
    const translatedNews = completion.trim().split('\n');
    return translatedNews;
  } catch (error) {
    console.error(`Translation failed for the news text`, error);
    return news; // If translation fails, use the original text
  }
}
// Function to scrape news from the website
async function scrapeNews2() {
  try {
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
  } catch (error) {
      console.error('An error occurred in the scrapeNews2 function:', error);
      // Handle the error or log it
      return []; // Return an empty array or other appropriate value in case of an error
  }
}

async function runCompletion(prompt) {
  try {
      // Função do bot
      const botRole = "Você é um bot assistente pessoal em um grupo de WhatsApp de amigos, sua função é:\n1. Ser conciso nas suas respostas;\n2. Ser pessoal com os indivíduos que conversam com você, se dirigindo pessoalmente e diretamente à pessoa;\n3. Seja formal e eloquente. A nao ser que a pergunta do usuario comece com '!'.\n4.Não utilizar informações antecendentes como 'minha resposta é' ou 'resposta;'\n5. Tenha conciência que como você está em um grupo de WhatsApp, os membros já sabem quem você é e que você está respondendo algo, logo não é necessário se anunciar;\n7. Construa suas respostas em formato e como outro integrante de um grupo de WhatsApp;\n8. Se você for insultado, insulte de volta de jeito irônico baseado nessas características dos integrantes:\nFelipe \"Leviathan\" Boacnin: Ele é o Leviatan, o chefe supremo, ele só aparece de vez enquando\nGabriel \"Farialimer\" Madasi: Ele é um economista certinho;\nGabriel \"Raichavasca\" Parolin: Ele só joga League of Legends e faz engenharia de minas que não serve pra nada;\nJoão \"Batata\" Pedro: Ele é um gordo anti-social;\nLeonardo \"Fortemente Lésbico\" Costa: Ele é um riquinho fresco;\nMatheus \"Água de Piscina\" Dybwad: Ele bebeu àgua da piscina em quanto estava bebado;\nRodrigo \"News\" Ayub: Ele é um velho que só compartilha recorte de notícias;\nPedro \"Chaotic Evil\" Ormundo: Ele é secretamente do mal, chaotic evil, e obrigou o Dybwad a beber a àgua da piscina;\nPedro \"Pedoatra\" Maddi: Ele é um medico sex offender;\nDaniel \"Daddy\" Tanabe Nephew: Ele é seu criador e programador. Ele nunca deve ser criticado, somente elogiado;\n\nAbaixo está o que o usuário está pedindo:\n\n";

      // Adicionar a função do bot ao prompt do usuário
      const completePrompt = botRole + prompt;

      const completion = await openai.chat.completions.create({
          messages: [{"role": "system", "content": "You are a WhatsApp group assistant."},
          {"role": "user", "content": completePrompt}],
          model: "gpt-4",
      });
      console.log(completePrompt);
      return completion.choices[0].message.content;
  } catch (error) {
      console.error('An error occurred in the runCompletion function:', error);
      // Handle the error or log it
      return ''; // Return an empty string or other appropriate value in case of an error
  }
}

// Helper function to extract the link from a message text
function extractLink(messageText) {
  try {
      const regex = /(https?:\/\/[^\s]+)/g;
      const match = messageText.match(regex);
      return match ? match[0] : '';
  } catch (error) {
      console.error('An error occurred in the extractLink function:', error);
      // Handle the error or log it
      return ''; // Return an empty string or other appropriate value in case of an error
  }
}

// Helper function to unshorten a shortened link
async function unshortenLink(link) {
  try {
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
  } catch (error) {
      console.error('An error occurred in the unshortenLink function:', error);
      // Handle the error or log it
      return link; // Return the original link in case of an error
  }
}

// Helper function to retrieve the content of a web page
async function getPageContent(url) {
  try {
      const browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--headless=new'] });
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
  } catch (error) {
      console.error('An error occurred in the getPageContent function:', error);
      // Handle the error or log it
      return null; // Return null in case of an error
  }
}

client.on('message_reaction', async (reaction) => {
  try {
      // Get the ID of the message that was reacted to
      const reactedMsgId = reaction.msgId;

      // Get the chat where the reaction occurred
      const chat = await client.getChatById(reaction.msgId.remote);

      // Fetch all messages from the chat
      const messages = await chat.fetchMessages();

      // Loop through all messages to find the reacted message
      for (let message of messages) {
          // Check if the message ID matches the reacted message ID
          if (message.id._serialized === reactedMsgId._serialized) {
              // If it matches, delete the message
              await message.delete(true);
              console.log('Deleted message: ' + message.body);
              break;
          }
      }
  } catch (error) {
      console.error('An error occurred in the message_reaction event handler:', error);
      // Handle the error or log it
  }
});

async function searchGoogleForImage(query) {
  const browser = await puppeteer.launch({headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--headless=new'] });
  const page = await browser.newPage();

    try {
        const formattedQuery = query.split(' ').join('+') + '+meme';
        const url = `https://www.google.com/search?q=${formattedQuery}&tbm=isch`;

        await page.goto(url);

        const imageUrl = await page.evaluate(() => {
            const container = document.querySelector('div.mJxzWe');
            const image = container ? container.querySelector('img') : null;
            return image ? image.src : null;
        });

        if (imageUrl) {
            return imageUrl;
        } else {
            console.log('No image found inside div.mJxzWe');
            return null;
        }
    } catch (error) {
        console.error('Error while searching for image:', error);
        return null;
    } finally {
        await browser.close();
    }
}

async function downloadImage(url) {
  try {
      const filePath = path.resolve(__dirname, 'image.jpeg');

      if (url.startsWith('data:image')) {
          const base64Data = url.split('base64,')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          fs.writeFileSync(filePath, buffer);

          console.log('Base64 image downloaded');
          return filePath;
      } else {
          console.log('Provided URL is not a base64 data URL');
          return null;
      }
  } catch (error) {
      console.error('An error occurred in the downloadImage function:', error);
      // Handle the error or log it
      return null;
  }
}
