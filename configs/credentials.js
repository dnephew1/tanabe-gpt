// credentials.js
require('dotenv').config({ path: './configs/.env' });

const CREDENTIALS = {
    ADMIN_NUMBER: process.env.ADMIN_NUMBER,
    BOT_NUMBER: process.env.BOT_NUMBER,
    ADMIN_WHATSAPP_ID: `${process.env.ADMIN_NUMBER}@c.us`,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GETIMG_AI_API_KEY: process.env.GETIMG_AI_API_KEY,
    TWITTER_API_KEYS: {
        primary: {
            bearer_token: process.env.TWITTER_PRIMARY_BEARER_TOKEN
        },
        fallback: {
            bearer_token: process.env.TWITTER_FALLBACK_BEARER_TOKEN
        },
        fallback2: {
            bearer_token: process.env.TWITTER_FALLBACK2_BEARER_TOKEN
        }
    }
};

// Validate that all required environment variables are present
const validateCredentials = () => {
    const requiredVars = [
        'ADMIN_NUMBER',
        'BOT_NUMBER',
        'OPENAI_API_KEY',
        'GETIMG_AI_API_KEY',
        'TWITTER_PRIMARY_BEARER_TOKEN',
        'TWITTER_FALLBACK_BEARER_TOKEN',
        'TWITTER_FALLBACK2_BEARER_TOKEN'
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
};

// Run validation on module import
validateCredentials();

module.exports = CREDENTIALS; 