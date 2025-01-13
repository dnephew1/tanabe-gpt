const config = require('../config');
const logger = require('./logger');

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
    handleAutoDelete
}; 