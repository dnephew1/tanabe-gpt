const config = require('../config');
const { runCompletion } = require('../utils/openaiUtils');
const axios = require('axios');
const logger = require('../utils/logger');

// Cache for API usage data
let apiUsageCache = {
    primary: null,
    fallback: null,
    currentKey: 'primary',
    lastCheck: null
};

function formatError(error) {
    const location = error.stack?.split('\n')[1]?.trim()?.split('at ')[1] || 'unknown location';
    return `${error.message} (at ${location})`;
}

async function getKeyUsage(key, name) {
    try {
        const url = 'https://api.twitter.com/2/usage/tweets';
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${key.bearer_token}`
            },
            params: {
                'usage.fields': 'cap_reset_day,project_usage,project_cap'
            }
        });
        
        if (response.data && response.data.data) {
            const usage = response.data.data;
            return {
                usage: usage.project_usage,
                limit: usage.project_cap
            };
        }
        throw new Error('Invalid response format from Twitter API');
    } catch (error) {
        logger.error(`Error checking ${name} key usage:`, formatError(error));
        throw error;
    }
}

async function checkTwitterAPIUsage(forceCheck = false) {
    // If we have cached data and it's less than 15 minutes old, use it
    const now = Date.now();
    if (!forceCheck && apiUsageCache.lastCheck && (now - apiUsageCache.lastCheck) < 15 * 60 * 1000) {
        return {
            primary: apiUsageCache.primary,
            fallback: apiUsageCache.fallback,
            currentKey: apiUsageCache.currentKey
        };
    }

    try {
        const { primary, fallback } = config.CREDENTIALS.TWITTER_API_KEYS;
        
        // Get usage for both keys
        const primaryUsage = await getKeyUsage(primary, 'primary');
        const fallbackUsage = await getKeyUsage(fallback, 'fallback');
        
        // Determine which key to use
        const currentKey = primaryUsage.usage >= 100 ? 'fallback' : 'primary';
        
        // Update cache
        apiUsageCache = {
            primary: primaryUsage,
            fallback: fallbackUsage,
            currentKey,
            lastCheck: now
        };
        
        logger.debug('Twitter API usage response:', {
            current_key: currentKey,
            primary_usage: `${primaryUsage.usage}/${primaryUsage.limit}`,
            fallback_usage: `${fallbackUsage.usage}/${fallbackUsage.limit}`
        });
        
        return {
            primary: primaryUsage,
            fallback: fallbackUsage,
            currentKey
        };
    } catch (error) {
        // If we have cached data, use it even if it's old
        if (apiUsageCache.lastCheck) {
            logger.warn('Failed to check API usage, using cached data:', formatError(error));
            return {
                primary: apiUsageCache.primary,
                fallback: apiUsageCache.fallback,
                currentKey: apiUsageCache.currentKey
            };
        }
        logger.error('Error checking Twitter API usage:', formatError(error));
        throw error;
    }
}

function getCurrentApiKey() {
    const { primary, fallback } = config.CREDENTIALS.TWITTER_API_KEYS;
    return {
        key: apiUsageCache.currentKey === 'primary' ? primary : fallback,
        name: apiUsageCache.currentKey,
        usage: {
            primary: apiUsageCache.primary,
            fallback: apiUsageCache.fallback
        }
    };
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
        const { key } = getCurrentApiKey();
        // Fetch last 5 tweets
        const url = `https://api.twitter.com/2/users/${userId}/tweets?tweet.fields=created_at&max_results=5`;
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${key.bearer_token}`
            }
        });
        
        if (!response.data.data) return [];
        return response.data.data;
    } catch (error) {
        logger.error('Error fetching tweets:', formatError(error));
        throw error;
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

        // Initial API usage check
        try {
            const usage = await checkTwitterAPIUsage(true);
            logger.info(`Twitter monitor initialized (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, using ${usage.currentKey} key)`);
        } catch (error) {
            logger.warn('Twitter monitor initialized with unknown API usage status:', formatError(error));
        }

        // Set up monitoring interval
        const monitorInterval = setInterval(async () => {
            try {
                // Check API usage before processing (will use cache if check was recent)
                const usage = await checkTwitterAPIUsage();
                logger.debug(`Twitter monitor check (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, using ${usage.currentKey} key)`);
                
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
        const usage = await checkTwitterAPIUsage();
        const account = config.TWITTER.ACCOUNTS[0];
        const tweets = await fetchLatestTweets(account.userId);
        
        if (tweets.length === 0) {
            await message.reply('No tweets found');
            return;
        }

        const [latestTweet, ...previousTweets] = tweets;
        const isRelevant = await evaluateTweet(latestTweet.text, previousTweets.map(t => t.text));
        
        const debugInfo = `API Status:
- Primary Key Usage: ${usage.primary.usage}/${usage.primary.limit}
- Fallback Key Usage: ${usage.fallback.usage}/${usage.fallback.limit}
- Currently Using: ${usage.currentKey} key

Latest Tweet ID: ${latestTweet.id}
Stored Tweet ID: ${account.lastTweetId}
Would Send to Group: ${latestTweet.id !== account.lastTweetId ? 'Yes' : 'No (Already Sent)'}
Latest Tweet Text: ${latestTweet.text}
Evaluation Result: ${isRelevant ? 'RELEVANT' : 'NOT RELEVANT'}`;
        
        await message.reply(debugInfo);
    } catch (error) {
        logger.error('Error in Twitter debug:', formatError(error));
        await message.reply('Error testing Twitter functionality: ' + formatError(error));
    }
}

module.exports = {
    initializeTwitterMonitor,
    debugTwitterFunctionality,
    getCurrentApiKey
};