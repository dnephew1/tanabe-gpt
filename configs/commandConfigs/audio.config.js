// audio.config.js
// Configuration for the audio command

const AUDIO_CONFIG = {
    prefixes: ['#audio'],
    description: 'Transcreve mensagens de áudio automaticamente.',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        transcriptionError: 'Desculpe, não consegui transcrever o áudio.',
        downloadError: 'Desculpe, não consegui baixar o áudio.',
        notAllowed: 'Você não tem permissão para usar este comando.',
        invalidFormat: 'Formato de áudio inválido.',
    },
    useGroupPersonality: false,
    model: '',  // Using specific model for voice transcription
};

module.exports = AUDIO_CONFIG; 