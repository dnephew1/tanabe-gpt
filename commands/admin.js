const config = require('../configs');
const { runCompletion } = require('../utils/openaiUtils');
const { performCacheClearing } = require('./cacheManagement');
const logger = require('../utils/logger');
const { getNextSummaryInfo, scheduleNextSummary } = require('../utils/periodicSummaryUtils');
const { runPeriodicSummary } = require('./periodicSummary');
const { debugTwitterFunctionality, debugRssFunctionality, newsMonitorStatus, getCurrentTwitterApiKey } = require('./newsMonitor');
const axios = require('axios');

// Runtime configuration that can be modified during execution
const runtimeConfig = {
    nlpEnabled: true // NLP processing is enabled by default
};

// Helper function to check if message is from admin chat
async function isAdminChat(message) {
    const chat = await message.getChat();
    const contact = await message.getContact();
    return contact.id._serialized === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us` && chat.isGroup === false;
}

// Helper function to check if user is admin or moderator
async function isAdminOrModerator(message) {
    try {
        // Check if direct message from admin
        const contact = await message.getContact();
        if (contact.id._serialized === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`) {
            return true;
        }
        
        // Check if group message from admin or moderator
        const chat = await message.getChat();
        if (chat.isGroup) {
            // Get participant info
            const participant = chat.participants.find(p => p.id._serialized === contact.id._serialized);
            if (participant && (participant.isAdmin || participant.isSuperAdmin)) {
                return true;
            }
            
            // Check if user is in moderators list (if configured)
            if (config.MODERATORS && Array.isArray(config.MODERATORS)) {
                return config.MODERATORS.includes(contact.id.user);
            }
        }
        
        return false;
    } catch (error) {
        logger.error('Error checking admin/moderator status:', error);
        return false;
    }
}

async function handleCacheClear(message) {
    logger.debug('Cache clear command activated');
    
    // Check if message is from admin chat
    if (!await isAdminChat(message)) {
        logger.debug('Cache clear command rejected: not admin chat');
        return;
    }
    
    try {
        await performCacheClearing();
        await message.reply('Cache cleared successfully');
    } catch (error) {
        logger.error('Error clearing cache', error);
        await message.reply(`Error clearing cache: ${error.message}`);
    }
}

async function handleForceSummary(message) {
    logger.debug('Force summary command activated');
    
    // Check if message is from admin chat
    if (!await isAdminChat(message)) {
        logger.debug('Force summary command rejected: not admin chat');
        return;
    }
    
    try {
        const nextSummary = getNextSummaryInfo();
        if (!nextSummary) {
            await message.reply('No groups configured for periodic summaries.');
            return;
        }

        const { group } = nextSummary;
        
        // Schedule the summary to run in 30 seconds
        await message.reply(`Scheduling summary for ${group} to run in 10 seconds...`);
        
        setTimeout(async () => {
            try {
                logger.summary(`Running forced summary for group ${group}`);
                const result = await runPeriodicSummary(group);
                if (result) {
                    logger.summary(`Successfully completed forced summary for group ${group}`);
                    await message.reply(`Summary completed for ${group}`);
                } else {
                    logger.warn(`Forced summary for group ${group} completed but may have had issues`);
                    await message.reply(`Summary completed for ${group} but may have had issues`);
                }
            } catch (error) {
                logger.error(`Error running forced summary for group ${group}:`, error);
                await message.reply(`Error running summary for ${group}: ${error.message}`);
            } finally {
                // Reschedule the next regular summary
                scheduleNextSummary();
            }
        }, 10000); // 10 seconds

    } catch (error) {
        logger.error('Error in force summary command:', error);
        await message.reply(`Error: ${error.message}`);
    }
}

async function handleTwitterDebug(message) {
    logger.debug('Twitter debug command activated');
    
    // Check if message is from admin chat
    if (!await isAdminChat(message)) {
        logger.debug('Twitter debug command rejected: not admin chat');
        return;
    }
    
    try {
        const chat = await message.getChat();
        await chat.sendStateTyping();

        // Parse the input to check for on/off commands
        const args = message.body.split(' ').slice(1);
        const isToggleCommand = args.length > 0 && 
            (args[0].toLowerCase() === 'on' || 
             args[0].toLowerCase() === 'off' || 
             args[0].toLowerCase() === 'enable' || 
             args[0].toLowerCase() === 'disable');

        // Skip the enabled check if it's a toggle command
        if (!isToggleCommand && !config.NEWS_MONITOR.TWITTER_ENABLED) {
            logger.error('Twitter monitoring is disabled in configuration');
            await message.reply('Twitter monitoring is disabled in configuration. Use "!twitterdebug on" to enable it.');
            return;
        }

        // Check if Twitter accounts are configured
        if (!config.NEWS_MONITOR.TWITTER_ACCOUNTS || !config.NEWS_MONITOR.TWITTER_ACCOUNTS.length) {
            logger.error('No Twitter accounts configured');
            await message.reply('No Twitter accounts configured in the system.');
            return;
        }

        // Check if API keys are configured
        if (!config.CREDENTIALS.TWITTER_API_KEYS?.primary?.bearer_token || !config.CREDENTIALS.TWITTER_API_KEYS?.fallback?.bearer_token) {
            logger.error('Twitter API keys not configured');
            await message.reply('Twitter API keys not properly configured in the system.');
            return;
        }

        // Call the Twitter debug function
        await debugTwitterFunctionality(message);
        
    } catch (error) {
        logger.error('Error in Twitter debug command', error);
        await message.reply(`Debug error: ${error.message}`);
    }
}

async function handleRssDebug(message) {
    logger.debug('RSS debug command activated');
    
    // Check if message is from admin chat
    if (!await isAdminChat(message)) {
        logger.debug('RSS debug command rejected: not admin chat');
        return;
    }
    
    try {
        const chat = await message.getChat();
        await chat.sendStateTyping();

        // Parse the input to check for on/off commands
        const args = message.body.split(' ').slice(1);
        const isToggleCommand = args.length > 0 && 
            (args[0].toLowerCase() === 'on' || 
             args[0].toLowerCase() === 'off' || 
             args[0].toLowerCase() === 'enable' || 
             args[0].toLowerCase() === 'disable');

        // Skip the enabled check if it's a toggle command
        if (!isToggleCommand && !config.NEWS_MONITOR.RSS_ENABLED) {
            logger.error('RSS monitoring is disabled in configuration');
            await message.reply('RSS monitoring is disabled in configuration. Use "!rssdebug on" to enable it.');
            return;
        }

        // Check if RSS feeds are configured
        if (!config.NEWS_MONITOR.FEEDS || !config.NEWS_MONITOR.FEEDS.length) {
            logger.error('No RSS feeds configured');
            await message.reply('No RSS feeds configured in the system.');
            return;
        }

        // Call the RSS debug function
        await debugRssFunctionality(message);
        
    } catch (error) {
        logger.error('Error in RSS debug:', error);
        await message.reply('Error testing RSS functionality: ' + error.message);
    }
}

// Handle configuration commands
async function handleConfig(message, command, input) {
    logger.debug('Config command activated', { input });
    
    // Check if user is admin or moderator
    if (!await isAdminOrModerator(message)) {
        logger.debug('Config command rejected: not admin or moderator');
        return;
    }
    
    // Parse the input to get the configuration option and value
    const parts = input.trim().split(/\s+/);
    if (parts.length < 2) {
        await message.reply('Usage: #config [option] [value]\nAvailable options: nlp');
        return;
    }
    
    const option = parts[0].toLowerCase();
    const value = parts[1].toLowerCase();
    
    // Handle different configuration options
    switch (option) {
        case 'nlp':
            // Toggle NLP processing
            if (value === 'on' || value === 'true' || value === 'enable') {
                runtimeConfig.nlpEnabled = true;
                await message.reply('NLP processing enabled');
                logger.info('NLP processing enabled by admin command');
            } else if (value === 'off' || value === 'false' || value === 'disable') {
                runtimeConfig.nlpEnabled = false;
                await message.reply('NLP processing disabled');
                logger.info('NLP processing disabled by admin command');
            } else {
                await message.reply('Invalid value for nlp. Use "on" or "off"');
            }
            break;
            
        default:
            await message.reply(`Unknown configuration option: ${option}\nAvailable options: nlp`);
    }
}

/**
 * Handle the news monitor status command
 */
async function handleNewsStatus(message) {
    logger.debug('News status command activated');
    
    // Check if message is from admin chat
    if (!await isAdminChat(message)) {
        logger.debug('News status command rejected: not admin chat');
        return;
    }
    
    try {
        const chat = await message.getChat();
        await chat.sendStateTyping();
        
        // Call the news monitor status function
        await newsMonitorStatus(message);
        
    } catch (error) {
        logger.error('Error in news status command', error);
        await message.reply(`Error retrieving news monitor status: ${error.message}`);
    }
}

module.exports = {
    handleCacheClear,
    handleTwitterDebug,
    handleForceSummary,
    handleRssDebug,
    handleConfig,
    handleNewsStatus,
    runtimeConfig
}; 