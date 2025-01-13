const fs = require('fs');
const { getOpenAIClient } = require('./openaiUtils');
const logger = require('./logger');

// Function to transcribe audio using OpenAI's Whisper model
async function transcribeAudio(audioPath) {
    try {
        logger.debug('Starting audio transcription', { audioPath });
        const openai = getOpenAIClient();
        
        // Verify file exists and is readable
        if (!fs.existsSync(audioPath)) {
            throw new Error(`Audio file not found at path: ${audioPath}`);
        }

        const fileStream = fs.createReadStream(audioPath);
        logger.debug('Created file stream for audio');

        const transcription = await openai.audio.transcriptions.create({
            file: fileStream,
            model: "whisper-1",
            language: "pt"
        });

        logger.debug('Transcription completed', {
            textLength: transcription.text.length,
            sampleText: transcription.text.substring(0, 50) + '...'
        });

        return transcription.text;
    } catch (error) {
        logger.error('Error transcribing audio:', error, { audioPath });
        throw error;
    }
}

module.exports = {
    transcribeAudio
}; 