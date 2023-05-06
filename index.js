const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const client = new Client({
    authStrategy: new LocalAuth()
});
 const qrcode = require('qrcode-terminal');
const { Configuration, OpenAIApi } = require("openai");
const { before } = require('node:test');
require('dotenv').config()
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
client.on('qr', (qr) => {
    qrcode.generate(qr, {small: true});
});
client.initialize();
client.on('ready', () => {
    console.log('Client is ready!');
});
client.on('message', async message => {
    if (message.body === 'Resumo pf') {
      try {
        const chat = await message.getChat();
        const messages = await chat.fetchMessages({limit: 50});
        const messageTexts = messages.map(message => `${message.from}: ${message.body}`).join(' ');
        const prompt = `Faça um resumo das ùltimas 50 messages dessa conversa do grupo: ${messageTexts}`;
        runCompletion(prompt).then(result => message.reply(result));
        async function runCompletion (message) {
          const completion = await openai.createCompletion({
            model: "text-davinci-003",
            prompt: prompt,
            max_tokens: 200,
          });
          return completion.data.choices[0].text;      
        }  
      } catch (error) {
        console.error(error);
      }
    }
  });
  client.on('message', message => {
    console.log(message.body);

    if(message.body.startsWith("#")) {
        runCompletion(message.body.substring(1)).then(result => message.reply(result));
    }
});
async function runCompletion (message) {
    const completion = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: message,
        max_tokens: 200,
    });
    return completion.data.choices[0].text;
}
