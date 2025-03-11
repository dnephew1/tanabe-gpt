// resumo.config.js
// Configuration for the resumo command

const RESUMO_PROMPT = require('../../prompts/resumo');

const RESUMO_CONFIG = {
    prefixes: ['#resumo'],
    description: 'Resume mensagens do grupo. Use #resumo [número] para resumir X mensagens, cite uma mensagem para resumi-la, envie um link para resumir seu conteúdo, ou cite uma mensagem com documento (PDF/DOCX) para resumir seu conteúdo. Também pode ser ativado com o sticker de resumo.',
    stickerHash: 'ca1b990a37591cf4abe221eedf9800e20df8554000b972fb3c5a474f2112cbaa',
    defaultSummaryHours: 3,
    documentSettings: {
        maxCharacters: 5000,
        supportedFormats: ['.pdf', '.docx', '.doc', '.txt', '.rtf'],
        tempDir: '.'
    },
    linkSettings: {
        maxCharacters: 5000,
        timeout: 10000  // Timeout for fetching links in milliseconds
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        invalidFormat: 'Por favor, forneça um número válido após #resumo.',
        noMessages: 'Não há mensagens suficientes para gerar um resumo.',
        notAllowed: 'Você não tem permissão para usar este comando.',
        linkError: 'Não consegui acessar o link para gerar um resumo.',
        documentError: 'Não consegui processar o documento para gerar um resumo.',
        documentUnsupported: 'Formato de documento não suportado. Formatos suportados: PDF, DOCX, DOC, TXT, RTF.',
        documentTooLarge: 'O documento é muito grande para ser processado.',
        error: 'Ocorreu um erro ao gerar o resumo.'
    },
    useGroupPersonality: true,
    model: '',
    prompt: RESUMO_PROMPT
};

module.exports = RESUMO_CONFIG; 