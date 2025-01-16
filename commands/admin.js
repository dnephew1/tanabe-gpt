const config = require('../config');
const { runCompletion } = require('../utils/openaiUtils');
const { performCacheClearing } = require('./cacheManagement');
const logger = require('../utils/logger');
const { getNextSummaryInfo, scheduleNextSummary } = require('../utils/periodicSummaryUtils');
const { runPeriodicSummary } = require('./periodicSummary');
const { getCurrentApiKey } = require('./twitterMonitor');
const axios = require('axios');

function formatError(error) {
    const location = error.stack?.split('\n')[1]?.trim()?.split('at ')[1] || 'unknown location';
    return `${error.message} (at ${location})`;
}

// Helper function to check if message is from admin chat
async function isAdminChat(message) {
    const chat = await message.getChat();
    const contact = await message.getContact();
    return contact.id._serialized === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us` && chat.isGroup === false;
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
        logger.error('Error clearing cache:', error);
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

        // Check if Twitter accounts are configured
        if (!config.TWITTER || !config.TWITTER.ACCOUNTS || !config.TWITTER.ACCOUNTS.length) {
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

        const account = config.TWITTER.ACCOUNTS[0]; // Only use the first account
        try {
            logger.debug('Making Twitter API request', {
                userId: account.userId,
                username: account.username
            });

            // Get current API key
            const { key, name, usage } = await getCurrentApiKey();
            
            // Get latest 5 tweets using Twitter API
            const twitterApiUrl = `https://api.twitter.com/2/users/${account.userId}/tweets?tweet.fields=text&max_results=5`;
            const response = await axios.get(twitterApiUrl, {
                headers: {
                    'Authorization': `Bearer ${key.bearer_token.trim()}`,
                    'Content-Type': 'application/json'
                }
            });
            
            let debugInfo = 'No tweets found';
            if (response.data && response.data.data && response.data.data.length > 0) {
                const tweets = response.data.data;
                const latestTweet = tweets[0];
                const olderTweets = tweets.slice(1);

                logger.debug('Retrieved tweets successfully', {
                    tweetCount: tweets.length,
                    latestTweetId: latestTweet.id
                });

                // Prepare the evaluation prompt
                const prompt = config.TWITTER.PROMPTS.EVALUATE_NEWS
                    .replace('{post}', latestTweet.text)
                    .replace('{previous_posts}', olderTweets.map(t => t.text).join('\n\n'));

                // Evaluate the news using ChatGPT
                const evaluation = await runCompletion(prompt, 1);
                
                debugInfo = `
API Status:
- Primary Key Usage: ${usage.primary.usage}/${usage.primary.limit}
- Fallback Key Usage: ${usage.fallback.usage}/${usage.fallback.limit}
- Currently Using: ${name} key

Latest Tweet ID: ${latestTweet.id}

Stored Tweet ID: ${account.lastTweetId}

Would Send to Group: ${latestTweet.id !== account.lastTweetId ? 'Yes' : 'No (Already Sent)'}

Latest Tweet Text: ${latestTweet.text}

Evaluation Result: ${evaluation.trim()}`;
            }
            
            await message.reply(`@${account.username}:\n${debugInfo}\n\nNote: Checking for new tweets every ${config.TWITTER.CHECK_INTERVAL/60000} minutes.`);
        } catch (error) {
            logger.error('Twitter API error:', formatError(error));
            
            let errorMessage = `Error checking @${account.username}: ${formatError(error)}`;
            if (error.response?.status === 401) {
                errorMessage += '\nThe Twitter API token appears to be invalid or expired.';
            }
            await message.reply(errorMessage);
        }
    } catch (error) {
        logger.error('Error in Twitter debug command:', formatError(error));
        await message.reply(`Debug error: ${formatError(error)}`);
    }
}

module.exports = {
    handleCacheClear,
    handleTwitterDebug,
    handleForceSummary
}; 