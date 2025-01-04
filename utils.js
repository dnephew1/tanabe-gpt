const { config } = require('./dependencies');

async function getPromptWithContext(commandName, promptName, message, variables = {}) {
    const chat = await message.getChat();
    const groupName = chat.isGroup ? chat.name : null;
    let prompt = config.getPrompt(commandName, promptName, groupName);

    // Replace all variables in the prompt
    for (const [key, value] of Object.entries(variables)) {
        prompt = prompt.replace(`{${key}}`, value);
    }

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