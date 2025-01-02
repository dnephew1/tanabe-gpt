const { config, notifyAdmin, runCompletion } = require('./dependencies');
const axios = require('axios');

let isInitialized = false;

async function makeTwitterApiCall() {
    const account = config.TWITTER_ACCOUNTS[0]; // Only use the first account
    const twitterApiUrl = `https://api.twitter.com/2/users/${account.userId}/tweets?tweet.fields=text&max_results=5`;
    const response = await axios.get(twitterApiUrl, {
        headers: {
            'Authorization': `Bearer ${config.TWITTER_BEARER_TOKEN}`
        }
    });
    return { data: response.data, account };
}

async function initializeTwitterMonitor() {
    if (isInitialized) return;
    
    try {
        const { data, account } = await makeTwitterApiCall();
        if (data && data.data && data.data.length > 0) {
            const latestTweet = data.data[0];
            account.lastTweetId = latestTweet.id;
            updateConfigFile(account.username, latestTweet.id);
            console.log(`Initialized last tweet ID for ${account.username}: ${latestTweet.id}`);
        }
    } catch (error) {
        console.error('Error during Twitter monitor initialization:', error);
    }

    // Start monitoring loop - every 15 minutes
    setInterval(checkTwitterUpdates, 15 * 60 * 1000);
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

        const { data, account } = await makeTwitterApiCall();
        
        if (data && data.data && data.data.length > 0) {
            const tweets = data.data;
            const latestTweet = tweets[0];
            const olderTweets = tweets.slice(1);
            
            // Check if this is actually a new tweet
            if (latestTweet.id !== account.lastTweetId) {
                // Prepare the evaluation prompt
                const prompt = config.PROMPTS.EVALUATE_NEWS
                    .replace('{post}', latestTweet.text)
                    .replace('{previous_posts}', olderTweets.map(t => t.text).join('\n\n'));

                // Evaluate the news using ChatGPT
                const evaluation = await runCompletion(prompt, 1);
                
                // Only send if the news is deemed relevant
                if (evaluation.trim().toLowerCase() === 'relevant') {
                    // Send message to group
                    const message = `@${account.username}:\n${latestTweet.text}`;
                    await group1.sendMessage(message);
                    console.log(`Sent new tweet to group from ${account.username} - ID: ${latestTweet.id}`);
                } else {
                    console.log(`Tweet from ${account.username} was not deemed relevant - ID: ${latestTweet.id}`);
                }
                
                // Update stored values and config file
                account.lastTweetId = latestTweet.id;
                updateConfigFile(account.username, latestTweet.id);
            }
        }
    } catch (error) {
        console.error('Error in checkTwitterUpdates:', error);
        await notifyAdmin(`Error in checkTwitterUpdates: ${error.message}`);
    }
}

function updateConfigFile(username, tweetId) {
    try {
        const fs = require('fs');
        const configPath = require.resolve('./config.js');
        let configContent = fs.readFileSync(configPath, 'utf8');
        
        // Update lastTweetId
        const accountRegex = new RegExp(
            `username: '${username}',[\\s\\n]*lastTweetId: [^\\n]*`
        );
        configContent = configContent.replace(
            accountRegex,
            `username: '${username}',\n            lastTweetId: '${tweetId}'`
        );
        
        fs.writeFileSync(configPath, configContent);
    } catch (error) {
        console.error('Error updating config file:', error);
    }
}

module.exports = {
    initializeTwitterMonitor
};