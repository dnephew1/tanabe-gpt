const config = require('./config');

// Log levels
const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG',
    SUMMARY: 'SUMMARY'
};

// Function to notify admin
async function notifyAdmin(message) {
    try {
        if (!global.client) {
            if (!global.pendingAdminNotifications) {
                global.pendingAdminNotifications = [];
            }
            global.pendingAdminNotifications.push(message);
            return;
        }

        const adminContact = `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`;
        
        try {
            await global.client.sendMessage(adminContact, message);
        } catch (error) {
            if (!global.pendingAdminNotifications) {
                global.pendingAdminNotifications = [];
            }
            global.pendingAdminNotifications.push(message);
        }
    } catch (error) {
        console.error(`Failed to process admin notification:`, error);
    }
}

// Formats the log message
function formatLog(level, message, error = null) {
    let logMessage = `[${level}] ${message}`;
    
    if (error) {
        logMessage += `\n${error.stack || error.message || error}`;
    }
    
    return logMessage;
}

// Core logging function
async function log(level, message, error = null, shouldNotifyAdmin = false) {
    // Check if this log level is enabled
    if (config.SYSTEM?.LOG_LEVELS?.[level] === false) {
        return;
    }

    const formattedMessage = formatLog(level, message, error);
    console.log(formattedMessage);

    if (shouldNotifyAdmin && config.NOTIFY_ADMIN_EVENTS?.[level]) {
        await notifyAdmin(formattedMessage);
    }
}

// Convenience methods for different log levels
const logger = {
    error: (message, error = null) => log(LOG_LEVELS.ERROR, message, error, true),
    warn: (message) => log(LOG_LEVELS.WARN, message),
    info: (message) => log(LOG_LEVELS.INFO, message),
    debug: (message) => log(LOG_LEVELS.DEBUG, message),
    summary: (message) => log(LOG_LEVELS.SUMMARY, message, null, true),
    
    // Specific event loggers
    startup: (message) => log('STARTUP', message, null, true),
    shutdown: (message) => log('SHUTDOWN', message, null, true),
    command: (command, user) => log(LOG_LEVELS.INFO, `Command: ${command} by ${user}`),
    
    // Export notifyAdmin for external use
    notifyAdmin
};

module.exports = logger; 