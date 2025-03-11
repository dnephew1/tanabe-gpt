// utils/envUtils.js
// Utility functions for handling environment variables

/**
 * Parse a string with escape sequences like \n into actual line breaks
 * @param {string} str - The string to parse
 * @returns {string} - The parsed string with actual line breaks
 */
function parseEscapeSequences(str) {
    if (!str) return '';
    
    // Remove quotes if present
    let parsedStr = str;
    if ((parsedStr.startsWith('"') && parsedStr.endsWith('"')) || 
        (parsedStr.startsWith("'") && parsedStr.endsWith("'"))) {
        parsedStr = parsedStr.substring(1, parsedStr.length - 1);
    }
    
    // Replace literal \n with actual line breaks
    return parsedStr.replace(/\\n/g, '\n')
                   .replace(/\\t/g, '\t')
                   .replace(/\\r/g, '\r')
                   .replace(/\\'/g, "'")
                   .replace(/\\"/g, '"')
                   .replace(/\\\\/g, '\\');
}

/**
 * Get an environment variable and parse any escape sequences
 * @param {string} key - The environment variable key
 * @param {string} defaultValue - Default value if the environment variable is not set
 * @returns {string} - The parsed environment variable value
 */
function getEnvWithEscapes(key, defaultValue = '') {
    const value = process.env[key];
    if (!value && defaultValue) {
        return defaultValue;
    }
    return parseEscapeSequences(value || '');
}

/**
 * Get the welcome message for whitelisted phone numbers
 * @returns {string} - The formatted welcome message
 */
function getWizardWelcomeMessage() {
    // Hardcoded fallback in case the environment variable is not set or not parsed correctly
    const fallbackMessage = "Olá, Mamãe querida!\n\nPara configurar um novo grupo para fazer resumos, envie *#ferramentaresumo*.\n\nTe amo!";
    
    // Try to get from environment variable first
    const envMessage = getEnvWithEscapes('WIZARD_WELCOME_MESSAGE');
    
    // If the environment variable is empty or doesn't contain line breaks, use the fallback
    if (!envMessage || !envMessage.includes('\n')) {
        return parseEscapeSequences(fallbackMessage);
    }
    
    return envMessage;
}

module.exports = {
    parseEscapeSequences,
    getEnvWithEscapes,
    getWizardWelcomeMessage
}; 