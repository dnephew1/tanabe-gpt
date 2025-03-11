// ayub.config.js
// Configuration for the ayub news commands

const RESUMO_PROMPT = require('../../prompts/resumo');

// Main AYUB_NEWS configuration
const AYUB_CONFIG = {
    prefixes: ['#ayubnews', '#ayub news'],
    description: 'Busca e resume notícias. Use #ayubnews para últimas notícias, #ayubnews [tema] para buscar sobre um assunto específico, ou envie o sticker de notícias. Links compartilhados são automaticamente resumidos.',
    stickerHash: '2ec460ac4810ace36065b5ef1fe279404ba812b04266ffb376a1c404dbdbd994',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        noArticles: 'Nenhum artigo encontrado.',
        error: 'Erro ao buscar artigos. Por favor, tente novamente mais tarde.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: true,
    model: '',
    prompt: RESUMO_PROMPT
};

// Football news configuration
const AYUB_FUT_CONFIG = {
    prefixes: ['#ayubnews fut', '#ayub news fut'],
    description: 'Busca as últimas notícias de futebol do ge.globo.com.',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        noArticles: 'Nenhuma notícia de futebol encontrada.',
        error: 'Erro ao buscar notícias de futebol. Por favor, tente novamente mais tarde.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: true,
    model: ''
};

module.exports = {
    AYUB_CONFIG,
    AYUB_FUT_CONFIG
}; 