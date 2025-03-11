// chat.config.js
// Configuration for the chat command

const CHAT_PROMPT = require('../../prompts/chat_gpt');

const CHAT_CONFIG = {
    prefixes: ['#', '#!'],
    description: 'Conversa com o ChatGPT. Mantém histórico de conversa, personalidades por grupo, e pode responder mensagens citadas. Use # para respostas normais ou #! para respostas com humor.',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        invalidFormat: 'Por favor, forneça uma pergunta após #.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: true,
    model: '',
    maxMessageFetch: 1000,
    prompt: CHAT_PROMPT
};

module.exports = CHAT_CONFIG; 