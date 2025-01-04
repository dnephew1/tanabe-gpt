const { config, runCompletion, axios } = require('./dependencies');
const fs = require('fs').promises;
const path = require('path');

let previousTweets = new Set();
const TWEET_CACHE_FILE = path.join(__dirname, 'tweetCache.json');

async function loadTweetCache() {
    try {
        const data = await fs.readFile(TWEET_CACHE_FILE, 'utf8');
        const cache = JSON.parse(data);
        previousTweets = new Set(cache.tweets);
        return cache.lastTweetIds || {};
    } catch (error) {
        return {};
    }
}

async function saveTweetCache(lastTweetIds) {
    try {
        const cache = {
            tweets: Array.from(previousTweets),
            lastTweetIds
        };
        await fs.writeFile(TWEET_CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (error) {
        console.error('[ERROR] Error saving tweet cache:', error.message);
    }
}

async function evaluateTweet(tweet, previousTweets) {
    const prompt = config.TWITTER.PROMPTS.EVALUATE_NEWS
        .replace('{post}', tweet)
        .replace('{previous_posts}', Array.from(previousTweets).slice(-5).join('\n'));

    const result = await runCompletion(prompt, 0.3);
    return result.trim().toLowerCase() === 'relevant';
}

async function initializeTwitterMonitor() {
    try {
        // Get target group
        const chats = await global.client.getChats();
        const targetGroup = chats.find(chat => chat.name === config.TWITTER.TARGET_GROUP);
        
        if (!targetGroup) {
            console.log('[ERROR] Target group not found, skipping Twitter monitor initialization');
            return;
        }

        // Load cached tweet IDs
        const lastTweetIds = await loadTweetCache();
        
        // Set up monitoring interval
        setInterval(async () => {
            try {
                for (const account of config.TWITTER.ACCOUNTS) {
                    const tweets = await fetchLatestTweets(account.userId, lastTweetIds[account.userId]);
                    
                    for (const tweet of tweets.reverse()) {
                        // Skip if we've seen this tweet
                        if (previousTweets.has(tweet.text)) continue;

                        // Evaluate if tweet should be shared
                        const isRelevant = await evaluateTweet(tweet.text, previousTweets);
                        
                        if (isRelevant) {
                            const message = `*Breaking News* 🗞️\n\n${tweet.text}\n\nSource: @${account.username}`;
                            await targetGroup.sendMessage(message);
                            console.log(`Sent tweet from ${account.username}: ${tweet.text.substring(0, 50)}...`);
                        }

                        // Update tracking
                        previousTweets.add(tweet.text);
                        lastTweetIds[account.userId] = tweet.id;
                    }
                }

                // Save updated cache
                await saveTweetCache(lastTweetIds);

                // Keep cache size manageable
                if (previousTweets.size > 100) {
                    previousTweets = new Set(Array.from(previousTweets).slice(-50));
                }

            } catch (error) {
                console.error('[ERROR] Error in Twitter monitor interval:', error.message);
            }
        }, config.TWITTER.CHECK_INTERVAL);

        console.log('Twitter monitor initialized successfully');
    } catch (error) {
        console.error('[ERROR] Error during Twitter monitor initialization:', error.message);
    }
}

async function fetchLatestTweets(userId, sinceId) {
    try {
        const url = `https://api.twitter.com/2/users/${userId}/tweets?tweet.fields=created_at&max_results=10${sinceId ? `&since_id=${sinceId}` : ''}`;
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${config.CREDENTIALS.TWITTER_BEARER_TOKEN}`
            }
        });
        
        if (!response.data.data) return [];
        
        return response.data.data.map(tweet => ({
            id: tweet.id,
            text: tweet.text,
            created_at: tweet.created_at
        }));
    } catch (error) {
        console.error('[ERROR] Error fetching tweets:', error.message);
        return [];
    }
}

module.exports = {
    initializeTwitterMonitor
};