const logger = require('./logger');
const CHAT_GPT = require('../prompts/chat_gpt');
const GROUP_PERSONALITIES = require('../prompts/personalities');
const RESUMO = require('../prompts/resumo');
const DESENHO = require('../prompts/desenho');

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;

/**
 * Get a prompt template with group personality
 * @param {Object} config - The application configuration
 * @param {string} commandName - The name of the command
 * @param {string} promptName - The name of the prompt template
 * @param {string|null} groupName - The name of the group, or null for DMs
 * @returns {string} The prompt template with personality applied
 */
function getPrompt(config, commandName, promptName, groupName = null) {
    let prompt;
    switch (commandName) {
        case 'CHAT_GPT':
            prompt = CHAT_GPT[promptName];
            break;
        case 'RESUMO':
            prompt = RESUMO[promptName];
            break;
        case 'DESENHO':
            prompt = DESENHO[promptName];
            break;
        default:
            throw new Error(`Unknown command: ${commandName}`);
    }

    const command = config.COMMANDS[commandName];
    let personality = '';
    
    // Check if this is the admin chat
    const adminNumber = config.CREDENTIALS.ADMIN_NUMBER;
    const isAdminChat = groupName === null || 
                       groupName === `${adminNumber}@c.us` || 
                       (typeof groupName === 'string' && groupName.includes(adminNumber));
    
    // For admin chat, always use GROUP_LF personality
    if (isAdminChat) {
        logger.debug(`Using ${GROUP_LF} personality for admin chat`);
        if (command.useGroupPersonality && GROUP_PERSONALITIES[GROUP_LF]) {
            personality = GROUP_PERSONALITIES[GROUP_LF];
        }
    } else if (command.useGroupPersonality && groupName && GROUP_PERSONALITIES[groupName]) {
        // Handle regular group personality
        personality = GROUP_PERSONALITIES[groupName];
    }
    
    // Replace the personality placeholder
    prompt = prompt.replace('{groupPersonality}', personality);
    
    return prompt;
}

/**
 * Get a prompt template with context and variables replaced
 * @param {Object} message - The message object
 * @param {Object} config - The application configuration
 * @param {string} commandName - The name of the command
 * @param {string} promptName - The name of the prompt template
 * @param {Object} variables - Variables to replace in the prompt
 * @returns {Promise<string>} The prompt with context and variables replaced
 */
async function getPromptWithContext(message, config, commandName, promptName, variables = {}) {
    const chat = await message.getChat();
    const groupName = chat.isGroup ? chat.name : null;

    logger.debug('Getting prompt with context', {
        command: commandName,
        promptType: promptName,
        groupName,
        variables: Object.keys(variables)
    });

    let prompt = getPrompt(config, commandName, promptName, groupName);

    logger.debug('Initial prompt template', {
        length: prompt.length,
        firstChars: prompt.substring(0, 100) + '...'
    });

    // If we have messageHistory in variables, check if it's empty
    if ('messageHistory' in variables) {
        const messageHistoryStr = variables.messageHistory?.toString() || '';
        if (!messageHistoryStr.trim()) {
            // If messageHistory is empty, remove the entire message history section from the prompt
            prompt = prompt.replace(/Para o seu contexto, abaixo estão as últimas \{maxMessages\} mensagens enviadas no chat, caso seja necessário para a sua resposta:\n\nCOMEÇO DAS ÚLTIMAS \{maxMessages\} MENSAGENS:\n\{messageHistory\}\nFIM DAS ÚLTIMAS \{maxMessages\} MENSAGENS\.\n\n/g, '');
        }
    }

    // Replace all variables in the prompt
    for (const [key, value] of Object.entries(variables)) {
        const stringValue = value?.toString() || '';
        logger.debug(`Replacing variable {${key}}`, {
            valueLength: stringValue.length,
            valueSample: stringValue.substring(0, 50) + (stringValue.length > 50 ? '...' : '')
        });
        
        // Create a regex that matches the exact variable pattern
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        prompt = prompt.replace(regex, stringValue);
    }

    logger.debug('Final prompt after replacements', {
        length: prompt.length,
        firstChars: prompt.substring(0, 100) + '...'
    });

    return prompt;
}

module.exports = {
    getPrompt,
    getPromptWithContext
}; 