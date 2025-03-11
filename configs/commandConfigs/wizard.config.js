// wizard.config.js
// Configuration for the resumo_config (wizard) command

// Import the resumo config
const RESUMO_CONFIG = require('../periodic_summary_config');
const RESUMO_CONFIG_PROMPT = require('../../prompts/resumo_config');

const WIZARD_CONFIG = {
    // Use the configuration from the periodic summary config
    ...RESUMO_CONFIG,
    prefixes: ['#ferramentaresumo'],
    description: 'Configura o resumo periódico do grupo (apenas admin).',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        error: 'Erro ao configurar o resumo periódico.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: false,
    prompt: RESUMO_CONFIG_PROMPT
};

module.exports = WIZARD_CONFIG; 