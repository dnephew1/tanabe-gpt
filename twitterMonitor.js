const { config, getTweetCount, notifyAdmin } = require('./dependencies');
const axios = require('axios');

let isInitialized = false;

async function initializeTwitterMonitor() {
    if (isInitialized) return;
    
    // Initialize tweet counts for all accounts
    try {
        for (const account of config.TWITTER_ACCOUNTS) {
            try {
                const tweetCount = await getTweetCount(account.username);
                account.lastTweetCount = tweetCount;
                
                // Update config file
                updateConfigFile(account.username, account.lastTweetId, tweetCount);
                
                console.log(`Initialized tweet count for ${account.username}: ${tweetCount}`);
            } catch (error) {
                console.error(`Failed to initialize tweet count for ${account.username}:`, error);
            }
        }
    } catch (error) {
        console.error('Error during Twitter monitor initialization:', error);
    }

    // Start monitoring loop
    setInterval(checkTwitterUpdates, config.TWITTER_CHECK_INTERVAL);
    isInitialized = true;
}

async function checkTwitterUpdates() {
    try {
        const chats = await global.client.getChats();
        const group1 = chats.find(chat => chat.name === config.GROUP1_NAME);
        
        if (!group1) {
            console.log('Group1 not found');
            return;
        }

        for (const account of config.TWITTER_ACCOUNTS) {
            try {
                // Get current tweet count from SocialBlade
                const currentTweetCount = await getTweetCount(account.username);
                console.log(`Checking ${account.username} - Current count: ${currentTweetCount}, Stored count: ${account.lastTweetCount}`);
                
                // If tweet count increased, fetch the latest tweet
                if (currentTweetCount > account.lastTweetCount) {
                    console.log(`New tweets detected for ${account.username} (Count: ${currentTweetCount}, Previous: ${account.lastTweetCount})`);
                    
                    // Use Twitter API to get only the latest tweet
                    const twitterApiUrl = `https://api.twitter.com/2/users/by/username/${account.username}/tweets?tweet.fields=text&max_results=1`;
                    const response = await axios.get(twitterApiUrl, {
                        headers: {
                            'Authorization': `Bearer ${config.TWITTER_BEARER_TOKEN}`
                        }
                    });

                    if (response.data && response.data.data && response.data.data.length > 0) {
                        const latestTweet = response.data.data[0];
                        
                        // Check if this is actually a new tweet
                        if (latestTweet.id !== account.lastTweetId) {
                            console.log(`New tweet found for ${account.username} - ID: ${latestTweet.id}`);
                            
                            // Send message to group
                            const message = `@${account.username}:\n${latestTweet.text}`;
                            await group1.sendMessage(message);
                            
                            // Update stored values and config file
                            account.lastTweetCount = currentTweetCount;
                            account.lastTweetId = latestTweet.id;
                            updateConfigFile(account.username, latestTweet.id, currentTweetCount);
                            
                            console.log(`Updated stored data for ${account.username}:
                                Tweet count: ${currentTweetCount}
                                Tweet ID: ${latestTweet.id}`);
                        } else {
                            console.log(`Tweet ${latestTweet.id} already processed for ${account.username}`);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error checking Twitter for ${account.username}:`, error);
                await notifyAdmin(`Error checking Twitter for ${account.username}: ${error.message}`);
            }
        }
    } catch (error) {
        console.error('Error in checkTwitterUpdates:', error);
        await notifyAdmin(`Error in checkTwitterUpdates: ${error.message}`);
    }
}

function updateConfigFile(username, tweetId, tweetCount) {
    try {
        const fs = require('fs');
        const configPath = require.resolve('./config.js');
        let configContent = fs.readFileSync(configPath, 'utf8');
        
        // Update both lastTweetId and lastTweetCount
        const accountRegex = new RegExp(
            `username: '${username}',[\\s\\n]*lastTweetId: [^\\n]*,[\\s\\n]*lastTweetCount: [^\\n]*`
        );
        configContent = configContent.replace(
            accountRegex,
            `username: '${username}',\n            lastTweetId: '${tweetId}',\n            lastTweetCount: ${tweetCount}`
        );
        
        fs.writeFileSync(configPath, configContent);
    } catch (error) {
        console.error('Error updating config file:', error);
    }
}

module.exports = {
    initializeTwitterMonitor
};