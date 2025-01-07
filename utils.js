const { config } = require('./dependencies');
const logger = require('./logger');

async function getPromptWithContext(commandName, promptName, message, variables = {}) {
    const chat = await message.getChat();
    const groupName = chat.isGroup ? chat.name : null;

    logger.debug('Getting prompt with context', {
        command: commandName,
        promptType: promptName,
        groupName,
        variables: Object.keys(variables)
    });

    let prompt = config.getPrompt(commandName, promptName, groupName);

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

async function handleAutoDelete(message, command, isError = false) {
    if (!command.autoDelete) return;

    const shouldDelete = isError ? 
        command.autoDelete.errorMessages : 
        command.autoDelete.commandMessages;

    if (shouldDelete) {
        const timeout = command.autoDelete.deleteTimeout || config.SYSTEM.MESSAGE_DELETE_TIMEOUT;
        setTimeout(async () => {
            try {
                await message.delete(true);
            } catch (error) {
                console.error('Error deleting message:', error);
            }
        }, timeout);
    }
}

module.exports = {
    getPromptWithContext,
    handleAutoDelete
}; 