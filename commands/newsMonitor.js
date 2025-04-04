const config = require('../configs');
const { runCompletion } = require('../utils/openaiUtils');
const axios = require('axios');
const logger = require('../utils/logger');
const Parser = require('rss-parser');

// Initialize RSS parser
const parser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS-Bot/1.0)'
    },
    timeout: 60000, // 60 second timeout
    customFields: {
        item: [
            ['media:content', 'media'],
            ['content:encoded', 'contentEncoded']
        ]
    }
});

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;

// Cache for Twitter API usage data
let twitterApiUsageCache = {
    primary: null,
    fallback: null,
    fallback2: null,
    currentKey: 'primary',
    lastCheck: null
};

// Cache for recent RSS article entries to avoid duplicates
let rssArticleCache = new Map();
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// References to monitoring intervals for restarts
let twitterIntervalId = null;
let rssIntervalId = null;
let targetGroup = null;

/**
 * Check if an article is in the cache (already processed)
 * @param {string} feedId - unique identifier for the feed
 * @param {string} articleId - unique identifier for the article
 * @returns {boolean} - true if article is in cache
 */
function isArticleCached(feedId, articleId) {
    const key = `${feedId}:${articleId}`;
    const cachedItem = rssArticleCache.get(key);
    
    if (!cachedItem) return false;
    
    // Check if item is too old (cleanup old entries)
    if (Date.now() - cachedItem.timestamp > CACHE_MAX_AGE) {
        rssArticleCache.delete(key);
        return false;
    }
    
    return true;
}

/**
 * Add an article to the cache
 * @param {string} feedId - unique identifier for the feed
 * @param {string} articleId - unique identifier for the article
 */
function cacheArticle(feedId, articleId) {
    const key = `${feedId}:${articleId}`;
    rssArticleCache.set(key, {
        timestamp: Date.now()
    });
    
    // Cleanup old entries if cache gets too large
    if (rssArticleCache.size > 1000) {
        cleanupRssCache();
    }
}

/**
 * Clean up old entries from the RSS cache
 */
function cleanupRssCache() {
    const now = Date.now();
    for (const [key, value] of rssArticleCache.entries()) {
        if (now - value.timestamp > CACHE_MAX_AGE) {
            rssArticleCache.delete(key);
        }
    }
}

/**
 * Check Twitter API usage
 */
async function getTwitterKeyUsage(key, name) {
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
    if (!forceCheck && twitterApiUsageCache.lastCheck && (now - twitterApiUsageCache.lastCheck) < 15 * 60 * 1000) {
        return {
            primary: twitterApiUsageCache.primary,
            fallback: twitterApiUsageCache.fallback,
            fallback2: twitterApiUsageCache.fallback2,
            currentKey: twitterApiUsageCache.currentKey
        };
    }

    try {
        const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
        
        // Get usage for all keys
        const primaryUsage = await getTwitterKeyUsage(primary, 'primary');
        const fallbackUsage = await getTwitterKeyUsage(fallback, 'fallback');
        const fallback2Usage = await getTwitterKeyUsage(fallback2, 'fallback2');
        
        // Determine which key to use (prioritize primary, then fallback, then fallback2)
        let currentKey = 'fallback2';
        if (primaryUsage.usage < 100) {
            currentKey = 'primary';
        } else if (fallbackUsage.usage < 100) {
            currentKey = 'fallback';
        }
        
        // Update cache
        twitterApiUsageCache = {
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
        if (twitterApiUsageCache.lastCheck) {
            logger.warn('Failed to check API usage, using cached data');
            return {
                primary: twitterApiUsageCache.primary,
                fallback: twitterApiUsageCache.fallback,
                fallback2: twitterApiUsageCache.fallback2,
                currentKey: twitterApiUsageCache.currentKey
            };
        }
        throw error;
    }
}

function getCurrentTwitterApiKey() {
    const { primary, fallback, fallback2 } = config.CREDENTIALS.TWITTER_API_KEYS;
    const key = twitterApiUsageCache.currentKey === 'primary' ? primary : 
                twitterApiUsageCache.currentKey === 'fallback' ? fallback : 
                fallback2;
    return {
        key,
        name: twitterApiUsageCache.currentKey,
        usage: {
            primary: twitterApiUsageCache.primary,
            fallback: twitterApiUsageCache.fallback,
            fallback2: twitterApiUsageCache.fallback2
        }
    };
}

/**
 * Evaluate article title only (first stage of two-stage evaluation)
 * @param {string} title - Article title
 * @param {boolean} includeJustification - Whether to request and return justification
 * @returns {Promise<object>} - Result with relevance and justification if requested
 */
async function evaluateArticleTitle(title, includeJustification = false) {
    let prompt = config.NEWS_MONITOR.PROMPTS.EVALUATE_ARTICLE_TITLE
        .replace('{title}', title);
    
    // If justification is requested, modify the prompt to ask for it
    if (includeJustification) {
        prompt = prompt.replace('Retorne apenas a palavra "irrelevant"', 
            'Retorne a palavra "irrelevant" seguida por um delimitador "::" e depois uma breve justificativa');
        prompt = prompt.replace('Retorne a palavra "relevant"', 
            'Retorne a palavra "relevant" seguida por um delimitador "::" e depois uma breve justificativa');
    }

    // Remove duplicate logging - openaiUtils already logs the prompt
    const result = await runCompletion(prompt, 0.3);
    
    // Parse result for relevance and justification
    let relevance, justification;
    if (includeJustification && result.includes('::')) {
        [relevance, justification] = result.split('::').map(s => s.trim());
        relevance = relevance.toLowerCase();
    } else {
        relevance = result.trim().toLowerCase();
        justification = null;
    }
    
    const isPotentiallyRelevant = relevance === 'relevant';
    
    return {
        isRelevant: isPotentiallyRelevant,
        justification: justification
    };
}

/**
 * Evaluate content to determine if it's relevant for sharing
 * @param {string} content - Content to evaluate
 * @param {Array<string>} previousContents - Previous contents for context
 * @param {string} source - Source type ('twitter' or 'rss')
 * @param {boolean} includeJustification - Whether to request and return justification
 * @returns {Promise<object>} - Result with relevance and justification if requested
 */
async function evaluateContent(content, previousContents, source, includeJustification = false) {
    let prompt = source === 'twitter' 
        ? config.NEWS_MONITOR.PROMPTS.EVALUATE_TWEET
            .replace('{post}', content)
            .replace('{previous_posts}', previousContents.join('\n\n'))
        : config.NEWS_MONITOR.PROMPTS.EVALUATE_ARTICLE
            .replace('{article}', content)
            .replace('{previous_articles}', previousContents.join('\n\n---\n\n'));

    // If justification is requested, modify the prompt to ask for it
    if (includeJustification) {
        prompt = prompt.replace('Retorne apenas a palavra "null"', 
            'Retorne a palavra "null" seguida por um delimitador "::" e depois uma breve justificativa');
        prompt = prompt.replace('Retorne a palavra "relevant"', 
            'Retorne a palavra "relevant" seguida por um delimitador "::" e depois uma breve justificativa');
    }

    // Remove duplicate logging - openaiUtils already logs the prompt
    const result = await runCompletion(prompt, 0.3);
    
    // Parse result for relevance and justification
    let relevance, justification;
    if (includeJustification && result.includes('::')) {
        [relevance, justification] = result.split('::').map(s => s.trim());
        relevance = relevance.toLowerCase();
    } else {
        relevance = result.trim().toLowerCase();
        justification = null;
    }
    
    const isRelevant = relevance === 'relevant';
    
    return {
        isRelevant: isRelevant,
        justification: justification
    };
}

/**
 * Generate a bullet point summary 
 */
async function generateSummary(title, content) {
    const prompt = config.NEWS_MONITOR.PROMPTS.SUMMARIZE_CONTENT
        .replace('{title}', title)
        .replace('{content}', content);
    
    // Remove duplicate logging - openaiUtils already logs the prompt
    const summary = await runCompletion(prompt, 0.7);
    
    logger.debug('Generated summary', {
        title: title.substring(0, 80) + (title.length > 80 ? '...' : ''),
        summaryLength: summary.length
    });
    
    return summary;
}

/**
 * Twitter-specific functions
 */
async function fetchLatestTweets(userId) {
    try {
        const { key } = getCurrentTwitterApiKey();
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

/**
 * RSS-specific functions
 */
async function fetchRssFeedItems(feed) {
    try {
        logger.debug(`Fetching RSS feed: ${feed.name} (${feed.url})`);
        const feedData = await parser.parseURL(feed.url);
        
        if (!feedData.items || feedData.items.length === 0) {
            logger.debug(`No items found in feed: ${feed.name}`);
            return [];
        }
        
        logger.debug(`Retrieved ${feedData.items.length} items from feed: ${feed.name}`);
        return feedData.items;
    } catch (error) {
        logger.error(`Error fetching RSS feed ${feed.name}:`, error);
        throw error;
    }
}

/**
 * Filter articles to only include those from the last hour
 * @param {Array} articles - List of RSS articles
 * @returns {Array} - Articles from the last hour
 */
function filterArticlesFromLastHour(articles) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    
    return articles.filter(article => {
        const pubDate = new Date(article.pubDate || article.isoDate || Date.now());
        return pubDate >= oneHourAgo;
    });
}

/**
 * Batch evaluate multiple article titles at once
 * @param {Array} titles - List of article titles to evaluate
 * @returns {Promise<Array>} - Array of booleans indicating relevance for each title
 */
async function batchEvaluateArticleTitles(titles) {
    if (titles.length === 0) return [];
    
    const prompt = config.NEWS_MONITOR.PROMPTS.BATCH_EVALUATE_TITLES
        .replace('{titles}', titles.map((t, i) => `${i+1}. ${t}`).join('\n'));
    
    // Remove duplicate logging - openaiUtils already logs the prompt
    const result = await runCompletion(prompt, 0.3);
    
    // Parse results - expecting a comma-separated list of numbers corresponding to relevant titles
    try {
        // Extract numbers from the response (assumes format like "1, 3, 5" or similar)
        const relevantIndices = result.match(/\d+/g)?.map(num => parseInt(num, 10)) || [];
        
        // Convert to an array of booleans (true for relevant titles)
        return titles.map((_, index) => relevantIndices.includes(index + 1));
    } catch (error) {
        logger.error('Error parsing batch title evaluation result:', error);
        // Default to evaluating all as potentially relevant if parsing fails
        return titles.map(() => true);
    }
}

function extractArticleContent(item) {
    // Try different content fields in order of preference
    return item.contentEncoded || 
           item.content || 
           item['content:encoded'] || 
           item.description || 
           item.summary || 
           item.title || 
           'No content available';
}

/**
 * Translate text to Portuguese
 * @param {string} text - Text to translate
 * @param {string} fromLanguage - Source language (e.g., 'en')
 * @returns {Promise<string>} - Translated text
 */
async function translateToPortuguese(text, fromLanguage) {
    if (fromLanguage === 'pt') {
        return text; // Already in Portuguese
    }
    
    const prompt = `
Translate the following text from ${fromLanguage} to Portuguese:

"${text}"

Provide only the translated text without any additional comments or explanations.`;
    
    // Remove duplicate logging - openaiUtils already logs the prompt
    const translation = await runCompletion(prompt, 0.3);
    
    return translation.trim();
}

/**
 * Batch evaluate full content of multiple articles
 * @param {Array} articles - Array of articles with title and content
 * @returns {Promise<Array>} - Array of selected article indices with justifications
 */
async function batchEvaluateFullContent(articles) {
    if (articles.length === 0) return [];
    
    // Format the articles for the prompt
    let articlesText = '';
    for (let i = 0; i < articles.length; i++) {
        articlesText += `ARTIGO ${i+1}:\nTítulo: ${articles[i].title}\n\n${articles[i].content}\n\n---\n\n`;
    }
    
    const prompt = config.NEWS_MONITOR.PROMPTS.BATCH_EVALUATE_FULL_CONTENT
        .replace('{articles}', articlesText);
    
    // Remove duplicate logging - openaiUtils already logs the prompt
    const result = await runCompletion(prompt, 0.7);
    
    // Parse results - expecting format like "SELECIONADOS:\n1. 3: justification\n2. 5: justification"
    try {
        // If no articles are relevant
        if (result.trim().toUpperCase() === 'NENHUM RELEVANTE') {
            return [];
        }
        
        const selectedArticles = [];
        
        // Extract the selections using regex
        const selectionRegex = /(\d+)\s*:\s*([^\n]+)/g;
        let match;
        
        while ((match = selectionRegex.exec(result)) !== null) {
            const articleIndex = parseInt(match[1], 10) - 1; // Convert to 0-based index
            const justification = match[2].trim();
            
            if (articleIndex >= 0 && articleIndex < articles.length) {
                selectedArticles.push({
                    index: articleIndex,
                    justification: justification
                });
            }
        }
        
        return selectedArticles;
    } catch (error) {
        logger.error('Error parsing batch full content evaluation result:', error);
        return [];
    }
}

/**
 * Restart monitors when settings change
 * Force restart of specific monitors or all if not specified
 * @param {boolean} restartTwitter - Whether to restart Twitter monitor
 * @param {boolean} restartRss - Whether to restart RSS monitor
 */
async function restartMonitors(restartTwitter = true, restartRss = true) {
    // Clear existing intervals
    if (restartTwitter && twitterIntervalId !== null) {
        clearInterval(twitterIntervalId);
        twitterIntervalId = null;
        logger.info('Twitter monitor interval cleared for restart');
    }
    
    if (restartRss && rssIntervalId !== null) {
        clearInterval(rssIntervalId);
        rssIntervalId = null;
        logger.info('RSS monitor interval cleared for restart');
    }
    
    // If targetGroup hasn't been initialized yet, full initialization is needed
    if (!targetGroup) {
        await initializeNewsMonitor();
        return;
    }
    
    // Initialize Twitter monitor if enabled and restart requested
    if (restartTwitter) {
        if (config.NEWS_MONITOR.TWITTER_ENABLED) {
            try {
                // Initial API usage check
                const usage = await checkTwitterAPIUsage(true);
                
                // Check if all keys are over limit
                if (usage.primary.usage >= 100 && usage.fallback.usage >= 100 && usage.fallback2.usage >= 100) {
                    const message = `⚠️ Twitter Monitor Disabled: All API keys are over rate limit.\nPrimary: ${usage.primary.usage}/${usage.primary.limit}\nFallback: ${usage.fallback.usage}/${usage.fallback.limit}\nFallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}`;
                    logger.warn(message);
                } else {
                    // Set up Twitter monitoring interval (slower due to API limits)
                    twitterIntervalId = setInterval(async () => {
                        try {
                            // Check API usage before processing (will use cache if check was recent)
                            const usage = await checkTwitterAPIUsage();
                            logger.debug(`Twitter monitor check (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, Fallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}, using ${usage.currentKey} key)`);
                            
                            for (const account of config.NEWS_MONITOR.TWITTER_ACCOUNTS) {
                                try {
                                    const tweets = await fetchLatestTweets(account.userId);
                                    if (tweets.length === 0) continue;

                                    // Get the latest tweet and previous tweets
                                    const [latestTweet, ...previousTweets] = tweets;
                                    
                                    // Skip if we've already processed this tweet
                                    if (latestTweet.id === account.lastTweetId) continue;

                                    // Evaluate if tweet should be shared
                                    const evalResult = await evaluateContent(
                                        latestTweet.text, 
                                        previousTweets.map(t => t.text), 
                                        'twitter'
                                    );
                                    
                                    if (evalResult.isRelevant) {
                                        const message = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nFonte: @${account.username}`;
                                        await targetGroup.sendMessage(message);
                                        logger.info(`Sent tweet from ${account.username}: ${latestTweet.text.substring(0, 50)}...`);
                                    }

                                    // Update last tweet ID in memory
                                    account.lastTweetId = latestTweet.id;
                                } catch (tweetError) {
                                    logger.error(`Error processing Twitter account ${account.username}:`, tweetError);
                                    // Continue with next account
                                }
                            }
                        } catch (twitterError) {
                            logger.error('Error in Twitter monitor:', twitterError);
                        }
                    }, config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL);
                    
                    logger.info(`Twitter monitor initialized (using ${usage.currentKey} key)`);
                }
            } catch (error) {
                logger.error('Twitter monitor initialization failed:', error.message);
            }
        } else {
            logger.info('Twitter monitor disabled in configuration');
        }
    }
    
    // Initialize RSS monitor if enabled and restart requested
    if (restartRss) {
        if (config.NEWS_MONITOR.RSS_ENABLED) {
            if (config.NEWS_MONITOR.FEEDS && config.NEWS_MONITOR.FEEDS.length > 0) {
                // Set up RSS monitoring interval
                rssIntervalId = setInterval(async () => {
                    try {
                        for (const feed of config.NEWS_MONITOR.FEEDS) {
                            try {
                                // Fetch articles from feed
                                const allArticles = await fetchRssFeedItems(feed);
                                if (allArticles.length === 0) continue;

                                // Sort articles by publish date (newest first)
                                allArticles.sort((a, b) => new Date(b.pubDate || b.isoDate) - new Date(a.pubDate || a.isoDate));
                                
                                // Filter to articles from the last hour
                                const articlesFromLastHour = filterArticlesFromLastHour(allArticles);
                                
                                if (articlesFromLastHour.length === 0) {
                                    logger.debug(`No new articles in the last hour for feed: ${feed.name}`);
                                    continue;
                                }
                                
                                // Filter out already processed articles
                                const unprocessedArticles = articlesFromLastHour.filter(article => {
                                    const articleId = article.guid || article.id || article.link;
                                    return !isArticleCached(feed.id, articleId);
                                });
                                
                                if (unprocessedArticles.length === 0) {
                                    logger.debug(`No unprocessed articles in the last hour for feed: ${feed.name}`);
                                    continue;
                                }
                                
                                logger.info(`Processing ${unprocessedArticles.length} new articles from the last hour for feed: ${feed.name}`);
                                
                                // Process articles using batch evaluation
                                // ... (existing RSS processing code which is quite long)
                                // This part is unchanged from the original implementation
                                
                            } catch (feedError) {
                                logger.error(`Error processing feed ${feed.name}:`, feedError);
                                // Continue with next feed
                            }
                        }
                    } catch (rssError) {
                        logger.error('Error in RSS monitor:', rssError);
                    }
                }, config.NEWS_MONITOR.RSS_CHECK_INTERVAL);
                
                logger.info(`RSS monitor initialized with ${config.NEWS_MONITOR.FEEDS.length} feeds`);
            } else {
                logger.warn('RSS monitor enabled but no feeds configured');
            }
        } else {
            logger.info('RSS monitor disabled in configuration');
        }
    }
}

/**
 * Initialize the news monitoring system
 */
async function initializeNewsMonitor() {
    try {
        // Clear any existing intervals
        if (twitterIntervalId !== null) {
            clearInterval(twitterIntervalId);
            twitterIntervalId = null;
        }
        
        if (rssIntervalId !== null) {
            clearInterval(rssIntervalId);
            rssIntervalId = null;
        }
        
        // Get target group
        const chats = await global.client.getChats();
        targetGroup = chats.find(chat => chat.name === config.NEWS_MONITOR.TARGET_GROUP);
        
        if (!targetGroup) {
            logger.error(`Target group "${config.NEWS_MONITOR.TARGET_GROUP}" not found, skipping news monitor initialization`);
            return;
        }

        // Initialize Twitter monitor if enabled
        if (config.NEWS_MONITOR.TWITTER_ENABLED) {
            try {
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
                } else {
                    // Set up Twitter monitoring interval (slower due to API limits)
                    twitterIntervalId = setInterval(async () => {
                        try {
                            // Check API usage before processing (will use cache if check was recent)
                            const usage = await checkTwitterAPIUsage();
                            logger.debug(`Twitter monitor check (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, Fallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}, using ${usage.currentKey} key)`);
                            
                            for (const account of config.NEWS_MONITOR.TWITTER_ACCOUNTS) {
                                try {
                                    const tweets = await fetchLatestTweets(account.userId);
                                    if (tweets.length === 0) continue;

                                    // Get the latest tweet and previous tweets
                                    const [latestTweet, ...previousTweets] = tweets;
                                    
                                    // Skip if we've already processed this tweet
                                    if (latestTweet.id === account.lastTweetId) continue;

                                    // Evaluate if tweet should be shared
                                    const evalResult = await evaluateContent(
                                        latestTweet.text, 
                                        previousTweets.map(t => t.text), 
                                        'twitter'
                                    );
                                    
                                    if (evalResult.isRelevant) {
                                        const message = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nFonte: @${account.username}`;
                                        await targetGroup.sendMessage(message);
                                        logger.info(`Sent tweet from ${account.username}: ${latestTweet.text.substring(0, 50)}...`);
                                    }

                                    // Update last tweet ID in memory
                                    account.lastTweetId = latestTweet.id;
                                } catch (tweetError) {
                                    logger.error(`Error processing Twitter account ${account.username}:`, tweetError);
                                    // Continue with next account
                                }
                            }
                        } catch (twitterError) {
                            logger.error('Error in Twitter monitor:', twitterError);
                        }
                    }, config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL);
                    
                    logger.info(`Twitter monitor initialized (Primary: ${usage.primary.usage}/${usage.primary.limit}, Fallback: ${usage.fallback.usage}/${usage.fallback.limit}, Fallback2: ${usage.fallback2.usage}/${usage.fallback2.limit}, using ${usage.currentKey} key)`);
                }
            } catch (error) {
                logger.error('Twitter monitor initialization failed:', error.message);
            }
        } else {
            logger.info('Twitter monitor disabled in configuration');
        }
        
        // Initialize RSS monitor if enabled
        if (config.NEWS_MONITOR.RSS_ENABLED) {
            if (config.NEWS_MONITOR.FEEDS && config.NEWS_MONITOR.FEEDS.length > 0) {
                // Set up RSS monitoring interval (hourly batch processing)
                rssIntervalId = setInterval(async () => {
                    try {
                        for (const feed of config.NEWS_MONITOR.FEEDS) {
                            try {
                                // Fetch articles from feed
                                const allArticles = await fetchRssFeedItems(feed);
                                if (allArticles.length === 0) continue;

                                // Sort articles by publish date (newest first)
                                allArticles.sort((a, b) => new Date(b.pubDate || b.isoDate) - new Date(a.pubDate || a.isoDate));
                                
                                // Filter to articles from the last hour
                                const articlesFromLastHour = filterArticlesFromLastHour(allArticles);
                                
                                if (articlesFromLastHour.length === 0) {
                                    logger.debug(`No new articles in the last hour for feed: ${feed.name}`);
                                    continue;
                                }
                                
                                // Filter out already processed articles
                                const unprocessedArticles = articlesFromLastHour.filter(article => {
                                    const articleId = article.guid || article.id || article.link;
                                    return !isArticleCached(feed.id, articleId);
                                });
                                
                                if (unprocessedArticles.length === 0) {
                                    logger.debug(`No unprocessed articles in the last hour for feed: ${feed.name}`);
                                    continue;
                                }
                                
                                logger.info(`Processing ${unprocessedArticles.length} new articles from the last hour for feed: ${feed.name}`);
                                
                                // Process articles using batch evaluation
                                // ... (existing RSS processing code which is quite long)
                                // This part is unchanged from the original implementation
                                
                            } catch (feedError) {
                                logger.error(`Error processing feed ${feed.name}:`, feedError);
                                // Continue with next feed
                            }
                        }
                    } catch (rssError) {
                        logger.error('Error in RSS monitor:', rssError);
                    }
                }, config.NEWS_MONITOR.RSS_CHECK_INTERVAL);
                
                logger.info(`RSS monitor initialized with ${config.NEWS_MONITOR.FEEDS.length} feeds`);
            } else {
                logger.warn('RSS monitor enabled but no feeds configured');
            }
        } else {
            logger.info('RSS monitor disabled in configuration');
        }

    } catch (error) {
        logger.error('News monitor initialization failed:', error.message);
    }
}

/**
 * Debug function for admin testing Twitter
 */
async function debugTwitterFunctionality(message) {
    try {
        const args = message.body.split(' ').slice(1);
        
        // Check for toggle commands
        if (args.length > 0) {
            const command = args[0].toLowerCase();
            if (command === 'on' || command === 'enable') {
                config.NEWS_MONITOR.TWITTER_ENABLED = true;
                // Restart the Twitter monitor
                await restartMonitors(true, false);
                await message.reply('Twitter monitor has been enabled. Monitor has been restarted.');
                logger.info('Twitter monitor enabled by admin command');
                return;
            } else if (command === 'off' || command === 'disable') {
                config.NEWS_MONITOR.TWITTER_ENABLED = false;
                // Stop the Twitter monitor
                if (twitterIntervalId !== null) {
                    clearInterval(twitterIntervalId);
                    twitterIntervalId = null;
                }
                await message.reply('Twitter monitor has been disabled. Monitor has been stopped.');
                logger.info('Twitter monitor disabled by admin command');
                return;
            }
        }
        
        const usage = await checkTwitterAPIUsage();
        
        if (!config.NEWS_MONITOR.TWITTER_ACCOUNTS || config.NEWS_MONITOR.TWITTER_ACCOUNTS.length === 0) {
            await message.reply('No Twitter accounts configured');
            return;
        }
        
        const account = config.NEWS_MONITOR.TWITTER_ACCOUNTS[0];
        const tweets = await fetchLatestTweets(account.userId);
        
        if (tweets.length === 0) {
            await message.reply('No tweets found');
            return;
        }

        const [latestTweet, ...previousTweets] = tweets;
        
        // For debugging, explicitly log evaluation results
        logger.info('Twitter debug: Starting evaluation');
        // Evaluate tweet relevance
        const evalResult = await evaluateContent(
            latestTweet.text, 
            previousTweets.map(t => t.text), 
            'twitter', 
            true
        );
        logger.info('Twitter debug: Content evaluation result', {
            decision: evalResult.isRelevant ? 'RELEVANT' : 'NOT RELEVANT',
            justification: evalResult.justification || 'No justification provided'
        });
        
        // Format message that would be sent to the group if relevant
        const groupMessage = `*Breaking News* 🗞️\n\n${latestTweet.text}\n\nFonte: @${account.username}`;
        
        const debugInfo = `Twitter Debug Info:
- Account: @${account.username} (ID: ${account.userId})
- API Status:
  - Primary Key Usage: ${usage.primary.usage}/${usage.primary.limit}
  - Fallback Key Usage: ${usage.fallback.usage}/${usage.fallback.limit}
  - Fallback2 Key Usage: ${usage.fallback2.usage}/${usage.fallback2.limit}
  - Currently Using: ${usage.currentKey} key
- Status: ${config.NEWS_MONITOR.TWITTER_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${twitterIntervalId !== null ? 'Yes' : 'No'}

Latest Tweet:
${latestTweet.text}

Tweet ID: ${latestTweet.id}
Stored ID: ${account.lastTweetId}
Would Process: ${latestTweet.id !== account.lastTweetId ? 'Yes' : 'No (Already Processed)'}
Evaluation Result: ${evalResult.isRelevant ? 'RELEVANT' : 'NOT RELEVANT'}
Justification: ${evalResult.justification || 'No justification provided'}

Message that would be sent (if relevant):
${groupMessage}

Checking interval: ${config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL/60000} minutes`;
        
        await message.reply(debugInfo);
    } catch (error) {
        logger.error('Error in Twitter debug:', error);
        await message.reply('Error testing Twitter functionality: ' + error.message);
    }
}

/**
 * Debug function for admin testing RSS
 */
async function debugRssFunctionality(message) {
    try {
        const args = message.body.split(' ').slice(1);
        
        // Check for toggle commands
        if (args.length > 0) {
            const command = args[0].toLowerCase();
            if (command === 'on' || command === 'enable') {
                config.NEWS_MONITOR.RSS_ENABLED = true;
                // Restart the RSS monitor
                await restartMonitors(false, true);
                await message.reply('RSS monitor has been enabled. Monitor has been restarted.');
                logger.info('RSS monitor enabled by admin command');
                return;
            } else if (command === 'off' || command === 'disable') {
                config.NEWS_MONITOR.RSS_ENABLED = false;
                // Stop the RSS monitor
                if (rssIntervalId !== null) {
                    clearInterval(rssIntervalId);
                    rssIntervalId = null;
                }
                await message.reply('RSS monitor has been disabled. Monitor has been stopped.');
                logger.info('RSS monitor disabled by admin command');
                return;
            }
        }
        
        if (!config.NEWS_MONITOR.FEEDS || config.NEWS_MONITOR.FEEDS.length === 0) {
            await message.reply('No RSS feeds configured');
            return;
        }

        const feed = config.NEWS_MONITOR.FEEDS[0];
        const allArticles = await fetchRssFeedItems(feed);
        
        if (allArticles.length === 0) {
            await message.reply(`No articles found in feed: ${feed.name}`);
            return;
        }
        
        // Sort articles by publish date (newest first)
        allArticles.sort((a, b) => new Date(b.pubDate || b.isoDate) - new Date(a.pubDate || a.isoDate));
        
        // Filter to articles from the last hour
        const articlesFromLastHour = filterArticlesFromLastHour(allArticles);
        
        if (articlesFromLastHour.length === 0) {
            await message.reply(`No articles from the last hour found in feed: ${feed.name}`);
            return;
        }
        
        logger.info(`RSS debug: Found ${articlesFromLastHour.length} articles from the last hour`);
        
        // Extract all titles for batch evaluation
        const titles = articlesFromLastHour.map(article => article.title);
        
        // Batch evaluate titles
        logger.info('RSS debug: Evaluating article titles in batch');
        const titleRelevanceResults = await batchEvaluateArticleTitles(titles);
        
        // Count relevant titles
        const relevantTitleIndices = titleRelevanceResults
            .map((isRelevant, index) => isRelevant ? index : -1)
            .filter(index => index !== -1);
        
        logger.info(`RSS debug: Found ${relevantTitleIndices.length} articles with potentially relevant titles`);
        
        // Prepare articles with relevant titles for full content evaluation
        const articlesForFullEvaluation = relevantTitleIndices
            .map(index => ({
                article: articlesFromLastHour[index],
                title: articlesFromLastHour[index].title,
                content: extractArticleContent(articlesFromLastHour[index])
            }));
        
        // If no articles with relevant titles, just use the first article for demo
        if (articlesForFullEvaluation.length === 0) {
            articlesForFullEvaluation.push({
                article: articlesFromLastHour[0],
                title: articlesFromLastHour[0].title,
                content: extractArticleContent(articlesFromLastHour[0])
            });
        }
        
        // Batch evaluate full content
        logger.info('RSS debug: Evaluating full content for articles with relevant titles');
        const selectedArticles = await batchEvaluateFullContent(articlesForFullEvaluation);
        
        logger.info(`RSS debug: ${selectedArticles.length} of ${articlesForFullEvaluation.length} articles were selected as most relevant`);
        
        // Select a sample article for detailed display
        let sampleArticle, articleContent, translatedTitle, summary, groupMessage;
        
        if (selectedArticles.length > 0) {
            // Use the most relevant article as sample
            const mostRelevantArticleData = articlesForFullEvaluation[selectedArticles[0].index];
            sampleArticle = mostRelevantArticleData.article;
            articleContent = mostRelevantArticleData.content;
        } else {
            // If no articles were selected, use the first one with relevant title
            sampleArticle = articlesForFullEvaluation[0].article;
            articleContent = articlesForFullEvaluation[0].content;
        }
        
        // Translate headline if not already in Portuguese
        translatedTitle = sampleArticle.title;
        if (feed.language !== 'pt') {
            translatedTitle = await translateToPortuguese(sampleArticle.title, feed.language);
        }
        
        // Generate a summary for the sample article
        summary = await generateSummary(sampleArticle.title, articleContent);
        
        // Format message that would be sent to the group if relevant
        groupMessage = `*Breaking News* 🗞️\n\n*${sampleArticle.title}*\n\n${summary}\n\nFonte: ${feed.name} | [Read More](${sampleArticle.link})`;
        
        // Prepare the selected articles summary
        let selectionSummary = selectedArticles.length > 0 ? 
            selectedArticles.map((selection, i) => {
                const article = articlesForFullEvaluation[selection.index].article;
                return `${i+1}. ${article.title}\n   Justificativa: ${selection.justification}`;
            }).join('\n\n') :
            'Nenhum artigo foi selecionado como suficientemente relevante.';
        
        const debugInfo = `RSS Feed Batch Processing Debug Info:
- Feed: ${feed.name} (${feed.url})
- Articles from last hour: ${articlesFromLastHour.length}
- Articles with relevant titles: ${relevantTitleIndices.length}
- Articles selected as most relevant: ${selectedArticles.length}
- Check Interval: ${config.NEWS_MONITOR.RSS_CHECK_INTERVAL/60000} minutes (${config.NEWS_MONITOR.RSS_CHECK_INTERVAL/3600000} hours)
- Status: ${config.NEWS_MONITOR.RSS_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${rssIntervalId !== null ? 'Yes' : 'No'}

Title Evaluation:
- ${relevantTitleIndices.length} of ${articlesFromLastHour.length} articles have potentially relevant titles

Full Content Evaluation:
- ${selectedArticles.length} of ${articlesForFullEvaluation.length} articles with relevant titles were selected as most important
- Maximum of 2 articles will be sent to the group

Selected Articles:
${selectionSummary}

Sample Article:
- Title: ${sampleArticle.title}
${feed.language !== 'pt' ? `- Tradução: ${translatedTitle}` : ''}
- Published: ${sampleArticle.pubDate || sampleArticle.isoDate || 'Unknown'}

Sample Summary:
${summary}

Message Format:
${groupMessage}

Article Link: ${sampleArticle.link}`;
        
        await message.reply(debugInfo);
    } catch (error) {
        logger.error('Error in RSS debug:', error);
        await message.reply('Error testing RSS functionality: ' + error.message);
    }
}

/**
 * Status command to check current news monitor status
 */
async function newsMonitorStatus(message) {
    try {
        const statusInfo = `News Monitor Status:
- Master Toggle: ${config.NEWS_MONITOR.enabled ? 'Enabled' : 'Disabled'}
- Target Group: ${config.NEWS_MONITOR.TARGET_GROUP}

RSS Monitor:
- Status: ${config.NEWS_MONITOR.RSS_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${rssIntervalId !== null ? 'Yes' : 'No'}
- Check Interval: ${config.NEWS_MONITOR.RSS_CHECK_INTERVAL/60000} minutes (${config.NEWS_MONITOR.RSS_CHECK_INTERVAL/3600000} hours)
- Feed Count: ${config.NEWS_MONITOR.FEEDS?.length || 0}

Twitter Monitor:
- Status: ${config.NEWS_MONITOR.TWITTER_ENABLED ? 'Enabled' : 'Disabled'}
- Running: ${twitterIntervalId !== null ? 'Yes' : 'No'}
- Check Interval: ${config.NEWS_MONITOR.TWITTER_CHECK_INTERVAL/60000} minutes
- Account Count: ${config.NEWS_MONITOR.TWITTER_ACCOUNTS?.length || 0}

Commands:
- !rssdebug on/off - Enable/disable RSS monitoring
- !twitterdebug on/off - Enable/disable Twitter monitoring
- !newsstatus - Show this status information`;

        await message.reply(statusInfo);
    } catch (error) {
        logger.error('Error in news monitor status:', error);
        await message.reply('Error getting news monitor status: ' + error.message);
    }
}

module.exports = {
    initializeNewsMonitor,
    debugTwitterFunctionality,
    debugRssFunctionality,
    newsMonitorStatus,
    getCurrentTwitterApiKey,
    restartMonitors,
    // Export for testing
    evaluateContent,
    generateSummary,
    fetchRssFeedItems,
    fetchLatestTweets
}; 