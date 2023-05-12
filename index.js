///////////////////Setup//////////////////////
// Import necessary modules
const { Client , LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

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
///////////////////Script/////////////////////////
client.on('message', async message => {
  console.log('MESSAGE:',message.body);
  const input = message.body.split(' ');
  if (message.hasQuotedMsg && message.body.includes('Resumo pf')) {
    const quotedMessage = await message.getQuotedMessage();
    const quotedText = quotedMessage.body;
    console.log('QUOTE:',quotedMessage.body);
    const prompt1 = `Faça um resumo desse texto: ${quotedText}`;
    console.log('PROMPT:',prompt1);
    runCompletion(prompt1).then(result => {
      message.reply(result);
      console.log('REPLY:', result);
    });
    async function summarizeText(prompt1) {
      const response = await openai.completions.create({
        engine: 'text-davinci-003',
        prompt: prompt1,
        max_tokens: 1000,
        n: 1,
      });
      return completion.data.choices[0].text;      
    }
    return;
  }  
  //////Summarize 1hr////////////////
  if (input[0] === 'Resumo' && input[1] === 'pf') {
    if (!input[2]) {
      const chat = await message.getChat();
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
      const prompt2 = `Faça um resumo das mensagens dessa conversa do grupo diga no início da sua resposta que esse é o resumo das mensagens na última hora: ${messageTexts}`;
      console.log('PROMPT:',prompt2);
      runCompletion(prompt2).then(result => message.reply(result));
      async function summarizeText(prompt2) {
        const response = await openai.completions.create({
          engine: 'text-davinci-003',
          prompt: prompt2,
          max_tokens: 1000,
          n: 1,
        });
        return completion.data.choices[0].text; 
        console.log('REPLY:',result)     
      }  
    } else if (input.length >= 2 && input.length <= 501) {
      //////////Summarize X messages/////////////////
      const limit = parseInt(input[2]);
      if (isNaN(limit)) {
        message.reply('Por favor, forneça um número válido após "Resumo pf" para definir o limite de mensagens.');
        return;
      }
      const chat = await message.getChat();
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
      const prompt3 = `Faça um resumo das últimas ${limit} mensagens dessa conversa do grupo: ${messageTexts}`;
      console.log('PROMPT:',prompt3);
      runCompletion(prompt3).then(result => message.reply(result));
      async function summarizeText(prompt3) {
        const response = await openai.completions.create({
          engine: 'text-davinci-003',
          prompt: prompt3,
          max_tokens: 1000,
          n: 1,
        });
        return completion.data.choices[0].text; 
        console.log('REPLY:',result)          
      }
    } else {
      message.reply('Comando inválido. Digite "Resumo pf" para obter um resumo das últimas 100 mensagens ou "Resumo pf [10-500]" para obter um resumo das últimas X mensagens.');
    }
  }
  ////////////////Respond to #////////////////
  if(message.body.startsWith("#")) {
      runCompletion(message.body.substring(1)).then(result => message.reply(result));
      console.log('REQUEST:',message.body)     
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
});

