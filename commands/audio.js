const { MessageMedia } = require('whatsapp-web.js');
const config = require('../config');
const logger = require('../utils/logger');
const { handleAutoDelete } = require('../utils/messageUtils');
const { transcribeAudio } = require('../utils/audioUtils');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function handleAudio(message, command) {
    let audioPath = null;
    try {
        // Check if message has media and is audio/voice
        if (!message.hasMedia || !['audio', 'ptt'].includes(message.type)) {
            logger.debug('Invalid audio message type', { type: message.type });
            const errorMessage = await message.reply(command.errorMessages.invalidFormat);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        // Download the audio
        const media = await message.downloadMedia();
        if (!media || !media.data) {
            logger.error('Failed to download audio');
            const errorMessage = await message.reply(command.errorMessages.error);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        logger.debug('Audio media info:', { 
            mimetype: media.mimetype,
            filename: media.filename
        });

        // Save audio to temp file
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Always use .ogg extension as it's supported by Whisper
        const randomName = crypto.randomBytes(16).toString('hex');
        audioPath = path.join(tempDir, `${randomName}.ogg`);
        
        // Write audio data to file
        fs.writeFileSync(audioPath, Buffer.from(media.data, 'base64'));
        
        logger.debug('Saved audio file:', { path: audioPath });

        // Get transcription using Whisper
        const transcription = await transcribeAudio(audioPath);
        if (!transcription) {
            logger.error('Empty transcription received');
            const errorMessage = await message.reply(command.errorMessages.error);
            await handleAutoDelete(errorMessage, command, true);
            return;
        }

        // Send the transcription with formatting
        const formattedResponse = `Transcrição:\n_${transcription}_`;
        const response = await message.reply(formattedResponse);
        await handleAutoDelete(response, command);

    } catch (error) {
        logger.error('Error in AUDIO command:', error, {
            mediaType: message.type,
            hasMedia: message.hasMedia
        });
        const errorMessage = await message.reply(command.errorMessages.error);
        await handleAutoDelete(errorMessage, command, true);
    } finally {
        // Clean up temp file
        if (audioPath && fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
            logger.debug('Cleaned up audio file:', { path: audioPath });
        }
    }
}

module.exports = {
    handleAudio
}; 