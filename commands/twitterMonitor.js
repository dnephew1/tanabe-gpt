const config = require('../config');
const { runCompletion } = require('../utils/openaiUtils');
const axios = require('axios');
const logger = require('../utils/logger');

function formatError(error) {
    const location = error.stack?.split('\n')[1]?.trim()?.split('at ')[1] || 'unknown location';
    return `${error.message} (at ${location})`;
}

async function checkTwitterAPIUsage() {
    try {
        const url = 'https://api.twitter.com/2/usage/tweets';
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${config.CREDENTIALS.TWITTER_BEARER_TOKEN}`
            },
            params: {
                'usage.fields': 'cap_reset_day,project_usage'
            }
        });
        
        if (response.data && response.data.data) {
            const usage = response.data.data;
            logger.debug('Twitter API usage response:', {
                project_cap: usage.project_cap,
                project_usage: usage.project_usage,
                remaining: usage.project_cap - usage.project_usage
            });
            return {
                remaining: usage.project_cap - usage.project_usage,
                total: usage.project_cap
            };
        }
        throw new Error('Invalid response format from Twitter API');
    } catch (error) {
        logger.error('Error checking Twitter API usage:', formatError(error));
        throw error;
    }
}

async function evaluateTweet(latestTweet, previousTweets) {
    const prompt = config.TWITTER.PROMPTS.EVALUATE_NEWS
        .replace('{post}', latestTweet)
        .replace('{previous_posts}', previousTweets.join('\n\n'));

    logger.prompt('Twitter news evaluation prompt', prompt);
    const result = await runCompletion(prompt, 0.3);
    return result.trim().toLowerCase() === 'relevant';
}

async function fetchLatestTweets(userId) {
    try {
        // Fetch last 5 tweets
        const url = `https://api.twitter.com/2/users/${userId}/tweets?tweet.fields=created_at&max_results=5`;
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${config.CREDENTIALS.TWITTER_BEARER_TOKEN}`
            }
        });
        
        if (!response.data.data) return [];
        return response.data.data;
    } catch (error) {
        logger.error('Error fetching tweets:', formatError(error));
        return [];
    }
}

async function initializeTwitterMonitor() {
    try {
        // Get target group
        const chats = await global.client.getChats();
        const targetGroup = chats.find(chat => chat.name === config.TWITTER.TARGET_GROUP);
        
        if (!targetGroup) {
            logger.error('Target group not found, skipping Twitter monitor initialization');
            return;
        }

        // Check API usage before starting
        try {
            const usage = await checkTwitterAPIUsage();
            logger.info(`Twitter monitor initialized (API Usage: ${usage.total - usage.remaining}/${usage.total} requests remaining)`);
        } catch (error) {
            logger.warn('Twitter monitor initialized with unknown API usage status');
        }

        // Set up monitoring interval
        const monitorInterval = setInterval(async () => {
            try {
                for (const account of config.TWITTER.ACCOUNTS) {
                    const tweets = await fetchLatestTweets(account.userId);
                    if (tweets.length === 0) continue;

                    // Get the latest tweet and previous tweets
                    const [latestTweet, ...previousTweets] = tweets;
                    
                    // Skip if we've already processed this tweet
                    if (latestTweet.id === account.lastTweetId) continue;

                    // Evaluate if tweet should be shared
                    const isRelevant = await evaluateTweet(latestTweet.text, previousTweets.map(t => t.text));
                    
                    if (isRelevant) {
                        const message = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nSource: @${account.username}`;
                        await targetGroup.sendMessage(message);
                        logger.info(`Sent tweet from ${account.username}: ${latestTweet.text.substring(0, 50)}...`);
                    }

                    // Update last tweet ID in memory
                    account.lastTweetId = latestTweet.id;
                }
            } catch (error) {
                logger.error('Error in Twitter monitor interval:', formatError(error));
            }
        }, config.TWITTER.CHECK_INTERVAL);

    } catch (error) {
        logger.error('Error during Twitter monitor initialization:', formatError(error));
    }
}

// Debug function for admin testing
async function debugTwitterFunctionality(message) {
    try {
        const account = config.TWITTER.ACCOUNTS[0];
        const tweets = await fetchLatestTweets(account.userId);
        
        if (tweets.length === 0) {
            await message.reply('No tweets found');
            return;
        }

        const [latestTweet, ...previousTweets] = tweets;
        const isRelevant = await evaluateTweet(latestTweet.text, previousTweets.map(t => t.text));
        
        const debugInfo = `Latest Tweet:\n${latestTweet.text}\n\nPrevious Tweets:\n${previousTweets.map(t => t.text).join('\n\n')}\n\nEvaluation Result: ${isRelevant ? 'RELEVANT' : 'NOT RELEVANT'}`;
        
        await message.reply(debugInfo);
    } catch (error) {
        logger.error('Error in Twitter debug:', formatError(error));
        await message.reply('Error testing Twitter functionality: ' + formatError(error));
    }
}

module.exports = {
    initializeTwitterMonitor,
    debugTwitterFunctionality
};