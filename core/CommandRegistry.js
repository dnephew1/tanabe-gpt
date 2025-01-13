const commandManager = require('./CommandManager');
const { handleResumo } = require('../commands/resumo');
const { handleAyub } = require('../commands/ayub');
const { handleSticker } = require('../commands/sticker');
const handleDesenho = require('../commands/desenho');
const { handleCacheClear, handleTwitterDebug, handleForceSummary } = require('../commands/admin');
const { handleChat } = require('../commands/chat');
const { handleTag } = require('../commands/tag');
const { handleAudio } = require('../commands/audio');
const { startWizard } = require('../commands/wizard');
const { handleCommandList } = require('../commands/commandList');
const logger = require('../utils/logger');

// Register all command handlers
function registerCommands() {
    logger.debug('Registering command handlers...');

    // Register each command handler
    commandManager.registerHandler('CHAT_GPT', handleChat);
    commandManager.registerHandler('RESUMO', handleResumo);
    commandManager.registerHandler('AYUB_NEWS', handleAyub);
    commandManager.registerHandler('STICKER', handleSticker);
    commandManager.registerHandler('DESENHO', handleDesenho);
    commandManager.registerHandler('CACHE_CLEAR', handleCacheClear);
    commandManager.registerHandler('TWITTER_DEBUG', handleTwitterDebug);
    commandManager.registerHandler('FORCE_SUMMARY', handleForceSummary);
    commandManager.registerHandler('AUDIO', handleAudio);
    commandManager.registerHandler('RESUMO_CONFIG', startWizard);
    commandManager.registerHandler('TAG', handleTag);
    commandManager.registerHandler('COMMAND_LIST', handleCommandList);

    logger.debug('Command handlers registered successfully');
}

module.exports = {
    registerCommands,
    commandManager
}; 