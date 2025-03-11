// commands/config/index.js
// Export all command configurations

const TAG_CONFIG = require('./tag.config');
const CHAT_CONFIG = require('./chat.config');
const RESUMO_CONFIG = require('./resumo.config');
const STICKER_CONFIG = require('./sticker.config');
const DESENHO_CONFIG = require('./desenho.config');
const COMMAND_LIST_CONFIG = require('./commandList.config');
const AUDIO_CONFIG = require('./audio.config');
const { AYUB_CONFIG, AYUB_FUT_CONFIG } = require('./ayub.config');
const WIZARD_CONFIG = require('./wizard.config');
const { TWITTER_DEBUG_CONFIG, FORCE_SUMMARY_CONFIG, CACHE_CLEAR_CONFIG, CONFIG_CONFIG } = require('./admin.config');

// Export all command configurations
const COMMANDS = {
    TAG: TAG_CONFIG,
    CHAT_GPT: CHAT_CONFIG,
    RESUMO: RESUMO_CONFIG,
    STICKER: STICKER_CONFIG,
    DESENHO: DESENHO_CONFIG,
    COMMAND_LIST: COMMAND_LIST_CONFIG,
    AUDIO: AUDIO_CONFIG,
    AYUB_NEWS: AYUB_CONFIG,
    AYUB_NEWS_FUT: AYUB_FUT_CONFIG,
    RESUMO_CONFIG: WIZARD_CONFIG,
    TWITTER_DEBUG: TWITTER_DEBUG_CONFIG,
    FORCE_SUMMARY: FORCE_SUMMARY_CONFIG,
    CACHE_CLEAR: CACHE_CLEAR_CONFIG,
    CONFIG: CONFIG_CONFIG
};

module.exports = COMMANDS; 