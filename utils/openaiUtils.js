const OpenAI = require('openai');
const logger = require('./logger');

let config;
setTimeout(() => {
    config = require('../config');
}, 0);

// Initialize OpenAI with a getter function
function getOpenAIClient() {
    if (!config) {
        throw new Error('Configuration not yet loaded');
    }
    return new OpenAI({
        apiKey: config.CREDENTIALS.OPENAI_API_KEY
    });
}

// Function to run ChatGPT completion
const runCompletion = async (prompt, temperature = 1, model = null) => {
    try {
        // Log the prompt using the logger's prompt function
        if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            logger.prompt('ChatGPT Prompt', prompt);
        }

        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: model || config.SYSTEM.OPENAI_MODELS.DEFAULT,
            messages: [{ role: 'user', content: prompt }],
            temperature: temperature
        });

        const result = completion.choices[0].message.content;

        // Log the response using the logger's prompt function
        if (config?.SYSTEM?.CONSOLE_LOG_LEVELS?.PROMPT) {
            logger.prompt('ChatGPT Response', result);
        }

        return result;
    } catch (error) {
        logger.error('Error in runCompletion:', error);
        throw error;
    }
};

module.exports = {
    getOpenAIClient,
    runCompletion
}; 