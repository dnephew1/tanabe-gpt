// prompts/index.js

const CHAT_GPT = require('./chat_gpt');
const RESUMO = require('./resumo');
const AYUB_NEWS = require('./ayub_news');
const DESENHO = require('./desenho');
const RESUMO_CONFIG = require('./resumo_config');
const PERIODIC_SUMMARY = require('./periodic_summary');
const TWITTER = require('./twitter');
const GROUP_PERSONALITIES = require('./personalities');

const PROMPTS = {
    CHAT_GPT,
    RESUMO,
    AYUB_NEWS,
    DESENHO,
    RESUMO_CONFIG,
    PERIODIC_SUMMARY,
    TWITTER,
    GROUP_PERSONALITIES
};

module.exports = PROMPTS; 