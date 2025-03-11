const config = require('../configs');
const { runCompletion } = require('../utils/openaiUtils');
const axios = require('axios');
const logger = require('../utils/logger');

// Cache for API usage data
let apiUsageCache = {
    primary: null,
    fallback: null,
    fallback2: null,
    currentKey: 'primary',
    lastCheck: null
};

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;

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
            fallback2: apiUsageCache.fallback2,
            currentKey: apiUsageCache.currentKey
        };
    }

    try {
        const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
        
        // Get usage for all keys
        const primaryUsage = await getKeyUsage(primary, 'primary');
        const fallbackUsage = await getKeyUsage(fallback, 'fallback');
        const fallback2Usage = await getKeyUsage(fallback2, 'fallback2');
        
        // Determine which key to use (prioritize primary, then fallback, then fallback2)
        let currentKey = 'fallback2';
        if (primaryUsage.usage < 100) {
            currentKey = 'primary';
        } else if (fallbackUsage.usage < 100) {
            currentKey = 'fallback';
        }
        
        // Update cache
        apiUsageCache = {
            primary: primaryUsage,
            fallback: fallbackUsage,
            fallback2: fallback2Usage,
            currentKey,
            lastCheck: now
        };
        
        logger.debug('Twitter API usage response', {
            current_key: currentKey,
            primary_usage: `${primaryUsage.usage}/${primaryUsage.limit}`,
            fallback_usage: `${fallbackUsage.usage}/${fallbackUsage.limit}`,
            fallback2_usage: `${fallback2Usage.usage}/${fallback2Usage.limit}`
        });
        
        return {
            primary: primaryUsage,
            fallback: fallbackUsage,
            fallback2: fallback2Usage,
            currentKey
        };
    } catch (error) {
        // If we have cached data, use it even if it's old
        if (apiUsageCache.lastCheck) {
            logger.warn('Failed to check API usage, using cached data');
            return {
                primary: apiUsageCache.primary,
                fallback: apiUsageCache.fallback,
                fallback2: apiUsageCache.fallback2,
                currentKey: apiUsageCache.currentKey
            };
        }
        throw error;
    }
}

function getCurrentApiKey() {
    const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
    const key = apiUsageCache.currentKey === 'primary' ? primary : 
                apiUsageCache.currentKey === 'fallback' ? fallback : 
                fallback2;
    return {
        key,
        name: apiUsageCache.currentKey,
        usage: {
            primary: apiUsageCache.primary,
            fallback: apiUsageCache.fallback,
            fallback2: apiUsageCache.fallback2
        }
    };
}

async function evaluateTweet(latestTweet, previousTweets) {
    const prompt = config.TWITTER.PROMPTS.EVALUATE_NEWS
        .replace('{post}', latestTweet)
        .replace('{previous_posts}', previousTweets.join('\n\n'));

    logger.prompt('Twitter news evaluation prompt', prompt);
    const result = await runCompletion(prompt, 0.3);
    const isRelevant = result.trim().toLowerCase() === 'relevant';
    
    logger.info('Tweet evaluation decision', {
        tweet: latestTweet.substring(0, 100) + (latestTweet.length > 100 ? '...' : ''),
        decision: isRelevant ? 'RELEVANT - Will send to group' : 'NOT RELEVANT - Will skip',
        raw_response: result.trim()
    });
    
    return isRelevant;
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
        logger.error('Error fetching tweets:', error);
        throw error;
    }
}

async function initializeTwitterMonitor() {
    let attempts = 0;
    const maxAttempts = 3;
    const waitTimes = [0, 6 * 60 * 1000, 10 * 60 * 1000]; // 0, 6 mins, 10 mins

    while (attempts < maxAttempts) {
        try {
            // Get target group
            const chats = await global.client.getChats();
            const targetGroup = chats.find(chat => chat.name === config.TWITTER.TARGET_GROUP);
            
            if (!targetGroup) {
                logger.error(`Target group "${config.TWITTER.TARGET_GROUP}" not found, skipping Twitter monitor initialization`);
                return;
            }

            // Initial API usage check
            const usage = await checkTwitterAPIUsage(true);
            
            // Check if all keys are over limit
            if (usage.primary.usage >= 100 && usage.fallback.usage >= 100 && usage.fallback2.usage >= 100) {
                const message = `⚠️ Twitter Monitor Disabled: All API keys are over rate limit.\nPrimary: ${usage.primary.usage}/${usage.primary.limit}\nFallback: ${usage.fallback.usage}/${usage.fallback.limit}\nFallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}`;
                logger.warn(message);
                
                // Notify admin via WhatsApp
                const adminChat = await global.client.getChatById(config.CREDENTIALS.ADMIN_NUMBER + '@c.us');
                if (adminChat) {
                    await adminChat.sendMessage(message);
                }
                
                return; // Exit without setting up the monitor interval
            }

            logger.info(`Twitter monitor initialized (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, Fallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}, using ${usage.currentKey} key)`);

            // Set up monitoring interval
            const monitorInterval = setInterval(async () => {
                try {
                    // Check API usage before processing (will use cache if check was recent)
                    const usage = await checkTwitterAPIUsage();
                    logger.debug(`Twitter monitor check (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, Fallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}, using ${usage.currentKey} key)`);
                    
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
                    logger.error('Error in Twitter monitor interval:', error);
                }
            }, config.TWITTER.CHECK_INTERVAL);

            // If we get here, initialization was successful
            return;

        } catch (error) {
            attempts++;
            
            if (error.response && error.response.status === 429) {
                if (attempts === maxAttempts) {
                    logger.error('Twitter monitor initialization failed after 3 attempts due to rate limiting');
                    return;
                }
                
                const waitTime = waitTimes[attempts];
                // Only notify admin on the last attempt
                const isLastAttempt = attempts === maxAttempts - 1;
                
                if (isLastAttempt) {
                    // Use error to ensure admin notification
                    logger.error(`Twitter API rate limit reached (final attempt ${attempts+1}/${maxAttempts}). Waiting ${waitTime/60000} minutes before final retry...`);
                } else {
                    // Use custom warn function that doesn't notify admin
                    logger.warn(`Twitter API rate limit reached (attempt ${attempts+1}/${maxAttempts}). Waiting ${waitTime/60000} minutes before retry...`, null, false);
                }
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                // If it's not a rate limit error, log and return
                logger.error('Twitter monitor initialization failed:', error.message);
                return;
            }
        }
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
- Fallback2 Key Usage: ${usage.fallback2.usage}/${usage.fallback2.limit}
- Currently Using: ${usage.currentKey} key

Latest Tweet ID: ${latestTweet.id}
Stored Tweet ID: ${account.lastTweetId}
Would Send to Group: ${latestTweet.id !== account.lastTweetId ? 'Yes' : 'No (Already Sent)'}
Latest Tweet Text: ${latestTweet.text}
Evaluation Result: ${isRelevant ? 'RELEVANT' : 'NOT RELEVANT'}`;
        
        await message.reply(debugInfo);
    } catch (error) {
        logger.error('Error in Twitter debug:', error);
        await message.reply('Error testing Twitter functionality: ' + error.message);
    }
}

module.exports = {
    initializeTwitterMonitor,
    debugTwitterFunctionality,
    getCurrentApiKey
};