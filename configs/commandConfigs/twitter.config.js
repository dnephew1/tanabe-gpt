// configs/commandConfigs/twitter.config.js
require('dotenv').config({ path: './configs/.env' });

const { EVALUATE_NEWS } = require('../../prompts/twitter');

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;

// Twitter configuration
const TWITTER_CONFIG = {
    enabled: true,  // Enable Twitter monitor by default
    TARGET_GROUP: GROUP_LF,  // Group to send Twitter updates to
    CHECK_INTERVAL: 960000,  // 16 minutes in milliseconds
    ACCOUNTS: [
        {
            username: 'BreakingNews',
            userId: '6017542',
            lastTweetId: '1874590993955123330'
        }
    ],
    PROMPTS: {
        EVALUATE_NEWS
    }
};

module.exports = TWITTER_CONFIG; 