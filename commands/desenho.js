const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const { handleAutoDelete } = require('../utils/messageUtils');
const { MessageMedia } = require('whatsapp-web.js');
const { generateImage, improvePrompt } = require('../utils/desenhoUtils');
const logger = require('../utils/logger');

async function handleDesenho(message, command, input = []) {
    // Ensure input is an array
    const inputArray = Array.isArray(input) ? input : message.body.split(' ');
    const promptInput = inputArray.slice(1).join(' ');
    
    if (!promptInput) {
        const errorMessage = await message.reply(command.errorMessages.noPrompt);
        await handleAutoDelete(errorMessage, command, true);
        return;
    }

    try {
        logger.debug('Generating improved prompt for drawing');
        const improvedPrompt = await improvePrompt(promptInput);

        logger.debug('Generating image with improved prompt');
        const imageBase64 = await generateImage(improvedPrompt);

        if (imageBase64) {
            const media = new MessageMedia('image/png', imageBase64, 'generated_image.png');
            logger.debug('Sending generated image');
            const response = await message.reply(media);
            await handleAutoDelete(response, command);
        } else {
            logger.error('Failed to generate image');
            const errorMessage = await message.reply(command.errorMessages.generateError);
            await handleAutoDelete(errorMessage, command, true);
        }
    } catch (error) {
        logger.error('Error in DESENHO command:', error);
        const errorMessage = await message.reply(command.errorMessages.generateError);
        await handleAutoDelete(errorMessage, command, true);
    }
}

module.exports = handleDesenho; 