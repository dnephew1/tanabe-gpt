// commandList.config.js
// Configuration for the command_list command

const COMMAND_LIST_CONFIG = {
    prefixes: ['#?'],
    description: 'Mostra esta lista de comandos disponíveis no grupo atual.',
    autoDelete: {
        errorMessages: true,
        commandMessages: true,
        deleteTimeout: 300000, // 5 minutes
    },
    errorMessages: {
        error: 'Ocorreu um erro ao listar os comandos.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: false,
    marketingMessage: `🤖 *Bem-vindo ao TanabeGPT!*

Somos um bot avançado que integra ChatGPT ao WhatsApp, oferecendo diversas funcionalidades personalizadas:

• 💬 Conversas inteligentes com ChatGPT
• 📝 Resumo automático de mensagens
• 🎨 Geração de imagens com IA
• 📰 Monitoramento e resumo de notícias
• 🎯 Stickers personalizados
• 🎤 Transcrição de áudio
• E muito mais!

Interessado em ter estas funcionalidades em seu grupo? Entre em contato conosco respondendo esta mensagem! Nossa equipe terá prazer em ajudar. 🚀`,
};

module.exports = COMMAND_LIST_CONFIG; 