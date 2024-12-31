const { config, getPageContent, notifyAdmin } = require('./dependencies');

let isInitialized = false;

async function initializeTwitterMonitor() {
    if (isInitialized) return;
    
    // Start monitoring loop
    setInterval(checkTwitterUpdates, config.TWITTER_CHECK_INTERVAL);
    isInitialized = true;
    console.log('Twitter monitor initialized');
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
                const twitterUrl = `https://x.com/${account.username}`;
                const result = await getPageContent(twitterUrl);
                
                if (!result || !result.content || !result.tweetId) {
                    console.log(`No valid content found for ${account.username}`);
                    continue;
                }

                // If this is a new tweet
                if (result.tweetId !== account.lastTweetId) {
                    // Update lastTweetId in both memory and file
                    account.lastTweetId = result.tweetId;
                    
                    // Update config file
                    const fs = require('fs');
                    const configPath = require.resolve('./config.js');
                    let configContent = fs.readFileSync(configPath, 'utf8');
                    
                    // Update the lastTweetId in the config content
                    const accountRegex = new RegExp(`username: '${account.username}',[\\s\\n]*lastTweetId: [^\\n]*`);
                    configContent = configContent.replace(
                        accountRegex,
                        `username: '${account.username}',\n            lastTweetId: '${result.tweetId}'`
                    );
                    
                    // Write back to config file
                    fs.writeFileSync(configPath, configContent);

                    let message = `@${account.username}:\n${result.content}`;
                    
                    await group1.sendMessage(message);
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

module.exports = {
    initializeTwitterMonitor
};