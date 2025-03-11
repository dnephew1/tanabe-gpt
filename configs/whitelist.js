// configs/whitelist.js
// Centralized whitelist configuration for command permissions

// Import credentials for admin ID
const CREDENTIALS = require('./credentials');
const PERIODIC_SUMMARY = require('./periodic_summary_config');
const envMapper = require('../utils/env_mapper');

// Avoid circular dependency with logger
let logger;
setTimeout(() => {
    logger = require('../utils/logger');
}, 0);

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;
const GROUP_AG = process.env.GROUP_AG;
const PHONE_DS1 = process.env.PHONE_DS1;
const PHONE_DS2 = process.env.PHONE_DS2;

// Command-specific whitelists
const COMMAND_WHITELIST = {
    // Chat command whitelist
    CHAT_GPT: [
        GROUP_LF,
        `dm.${GROUP_LF}`,
        GROUP_AG
    ],
    
    // Resumo command whitelist
    RESUMO: [
        GROUP_LF,
        `dm.${GROUP_LF}`,
        GROUP_AG
    ],
    
    // Ayub news command whitelist
    AYUB_NEWS: [
        GROUP_LF,
        `dm.${GROUP_LF}`,
        GROUP_AG
    ],
    
    // Sticker command whitelist
    STICKER: [
        GROUP_LF,
        `dm.${GROUP_LF}`,
        GROUP_AG
    ],
    
    // Desenho command whitelist
    DESENHO: [
        GROUP_LF,
        `dm.${GROUP_LF}`,
        GROUP_AG
    ],
    
    // Command list whitelist
    COMMAND_LIST: 'all',
    
    // Audio command whitelist
    AUDIO: [
        GROUP_LF,
        GROUP_AG
    ],
    
    // Tag command whitelist (group only)
    TAG: [
        GROUP_LF,
        GROUP_AG
    ],
    
    // Resumo config command whitelist (wizard) - only specific phone numbers
    RESUMO_CONFIG: [
        PHONE_DS1,
        PHONE_DS2,
        GROUP_AG
    ],
    
    // Admin commands whitelist (only admin has access)
    TWITTER_DEBUG: [],
    FORCE_SUMMARY: [],
    CACHE_CLEAR: []
};

// List of admin-only commands
const ADMIN_ONLY_COMMANDS = [
    'TWITTER_DEBUG',
    'FORCE_SUMMARY',
    'CACHE_CLEAR'
];

/**
 * Check if a group is configured for periodic summaries
 * @param {string} groupName - The name of the group
 * @returns {boolean} - Whether the group is configured for periodic summaries
 */
function isGroupConfiguredForSummary(groupName) {
    return !!PERIODIC_SUMMARY.groups[groupName];
}

/**
 * Check if a user or group has permission to use a command
 * @param {string} commandName - The name of the command
 * @param {string} chatId - The chat ID (group name or user ID)
 * @param {string} userId - The user ID
 * @returns {boolean} - Whether the user has permission
 */
function hasPermission(commandName, chatId, userId) {
    // Check if the user is an admin
    const isAdmin = userId === `${CREDENTIALS.ADMIN_NUMBER}@c.us` || 
                   userId === CREDENTIALS.ADMIN_NUMBER;
    
    // Admin always has access to all commands
    if (isAdmin) {
        if (logger) {
            logger.debug(`Admin access granted for command ${commandName}`);
        }
        return true;
    }
    
    // Special case for test group - allow all commands for testing
    if (chatId === GROUP_AG) {
        return true;
    }
    
    // Admin-only commands are restricted to admin regardless of whitelist
    if (ADMIN_ONLY_COMMANDS.includes(commandName)) {
        return false; // Already checked if user is admin above
    }
    
    // Special case for RESUMO_CONFIG command - check user ID directly
    if (commandName === 'RESUMO_CONFIG') {
        return COMMAND_WHITELIST.RESUMO_CONFIG.includes(userId);
    }
    
    // Special case for periodic summary - groups configured for periodic summaries
    // don't need to be whitelisted for receiving summaries
    if (commandName === 'PERIODIC_SUMMARY' && isGroupConfiguredForSummary(chatId)) {
        return true;
    }
    
    // Check command-specific whitelist
    const whitelist = COMMAND_WHITELIST[commandName];
    
    // If whitelist doesn't exist, deny access
    if (!whitelist) {
        if (logger) {
            logger.debug(`No whitelist found for command ${commandName}`);
        }
        return false;
    }
    
    // If whitelist is 'all', allow access
    if (whitelist === 'all') {
        return true;
    }
    
    // Check if the chat ID is in the whitelist
    const isAllowed = whitelist.includes(chatId);
    if (!isAllowed && logger) {
        // Only log at debug level to avoid spamming the admin
        logger.debug(`Chat ${chatId} not in whitelist for command ${commandName}`);
    }
    return isAllowed;
}

module.exports = {
    COMMAND_WHITELIST,
    hasPermission,
    ADMIN_ONLY_COMMANDS,
    isGroupConfiguredForSummary
}; 