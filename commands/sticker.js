const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const { handleAutoDelete } = require('../utils/messageUtils');
const logger = require('../utils/logger');
const { MessageMedia } = require('whatsapp-web.js');
const { searchGoogleForImage, downloadImage } = require('../utils/imageUtils');
const { deleteFile } = require('../utils/fileUtils');

async function handleSticker(message, command, input = []) {
    // Case 1: Message has media - convert to sticker
    if (message.hasMedia) {
        logger.debug('Converting media to sticker');
        const attachmentData = await message.downloadMedia();
        const response = await message.reply(attachmentData, message.from, { sendMediaAsSticker: true });
        await handleAutoDelete(response, command);
        return;
    }

    // Case 2: Message quotes another message with media
    if (message.hasQuotedMsg) {
        logger.debug('Processing quoted message for sticker');
        const quotedMsg = await message.getQuotedMessage();
        if (quotedMsg.hasMedia) {
            const attachmentData = await quotedMsg.downloadMedia();
            const imagePath = path.join(__dirname, `quoted_image_${Date.now()}.jpg`);
            
            try {
                await fsPromises.writeFile(imagePath, attachmentData.data, 'base64');
                const imageAsSticker = MessageMedia.fromFilePath(imagePath);
                const response = await message.reply(imageAsSticker, message.from, { sendMediaAsSticker: true });
                await handleAutoDelete(response, command);
            } catch (error) {
                logger.error('Error processing quoted image:', error);
                const errorMessage = await message.reply(command.errorMessages.downloadError);
                await handleAutoDelete(errorMessage, command, true);
            } finally {
                await deleteFile(imagePath);
            }
            return;
        } else {
            const errorMessage = await message.reply(command.errorMessages.noImage);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }
    }

    // Case 3: Command has keyword - search and create sticker
    const query = Array.isArray(input) ? input.slice(1).join(' ') : message.body.split(' ').slice(1).join(' ');
    if (query && /\S/.test(query)) {
        logger.debug(`Searching for image with query: ${query}`);
        try {
            const imageUrl = await searchGoogleForImage(query);
            if (!imageUrl) {
                const errorMessage = await message.reply(command.errorMessages.noResults);
                await handleAutoDelete(errorMessage, command, true);
                return;
            }

            const imagePath = await downloadImage(imageUrl);
            if (!imagePath) {
                const errorMessage = await message.reply(command.errorMessages.downloadError);
                await handleAutoDelete(errorMessage, command, true);
                return;
            }

            try {
                const imageAsSticker = MessageMedia.fromFilePath(imagePath);
                const response = await message.reply(imageAsSticker, message.from, { sendMediaAsSticker: true });
                await handleAutoDelete(response, command);
            } finally {
                await deleteFile(imagePath);
            }
        } catch (error) {
            logger.error('Error creating sticker from search:', error);
            const errorMessage = await message.reply(command.errorMessages.error);
            await handleAutoDelete(errorMessage, command, true);
        }
        return;
    }

    // Case 4: No media, no quoted message, no keyword
    const errorMessage = await message.reply(command.errorMessages.noKeyword);
    await handleAutoDelete(errorMessage, command, true);
}

module.exports = {
    handleSticker
}; 