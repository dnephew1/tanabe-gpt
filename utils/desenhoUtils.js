const axios = require('axios');
const config = require('../config');
const logger = require('./logger');
const { runCompletion } = require('./openaiUtils');
const DESENHO = require('../prompts/desenho');

async function generateImage(prompt, cfg_scale = 7) {
    try {
        logger.debug('Generating image with GetImg.ai', { promptLength: prompt.length });
        const response = await axios.post('https://api.getimg.ai/v1/essential-v2/text-to-image', {
            prompt: prompt,
            style: 'photorealism',
            aspect_ratio: '1:1',
            output_format: 'png',
            cfg_scale: cfg_scale
        }, {
            headers: {
                'Authorization': `Bearer ${config.CREDENTIALS.GETIMG_AI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.data && response.data.image) {
            logger.debug('Successfully generated image');
            return response.data.image;
        }
        
        logger.error('No image data in response', response.data);
        return null;
    } catch (error) {
        logger.error('Error generating image:', error.response ? error.response.data : error.message);
        return null;
    }
}

async function improvePrompt(prompt) {
    try {
        const promptTemplate = DESENHO.IMPROVE_PROMPT.replace('{prompt}', prompt);
        return await runCompletion(promptTemplate, 0.7);
    } catch (error) {
        logger.error('Error improving prompt:', error);
        throw error;
    }
}

module.exports = {
    generateImage,
    improvePrompt
}; 