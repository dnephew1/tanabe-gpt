// desenho.config.js
// Configuration for the desenho command

const DESENHO_PROMPT = require('../../prompts/desenho');

const DESENHO_CONFIG = {
    prefixes: ['#desenho'],
    description: 'Gera imagens com IA. Use #desenho [descrição] para criar uma imagem. A descrição é aprimorada automaticamente para gerar melhores resultados.',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        noPrompt: 'Por favor, forneça uma descrição após #desenho.',
        generateError: 'Não foi possível gerar as imagens. Tente novamente.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: false,
    model: '',
    prompt: DESENHO_PROMPT
};

module.exports = DESENHO_CONFIG; 