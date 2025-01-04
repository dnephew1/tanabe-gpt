const { notifyAdmin } = require('./dependencies');

// Log levels
const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

// Configuration for which events to notify admin about
const NOTIFY_ADMIN_EVENTS = {
    ERROR: true,
    STARTUP: true,
    SHUTDOWN: true,
    COMMAND: false
};

// Formats the log message
function formatLog(level, message, error = null) {
    let logMessage = `[${level}] ${message}`;
    
    if (error) {
        logMessage += `\n${error.stack || error.message || error}`;
    }
    
    return logMessage;
}

// Core logging function
async function log(level, message, error = null, notifyAdmin = false) {
    const formattedMessage = formatLog(level, message, error);
    console.log(formattedMessage);

    if (notifyAdmin && NOTIFY_ADMIN_EVENTS[level]) {
        try {
            await notifyAdmin(message);
        } catch (err) {
            console.error('Failed to notify admin:', err);
        }
    }
}

// Convenience methods for different log levels
const logger = {
    error: (message, error = null) => log(LOG_LEVELS.ERROR, message, error, true),
    warn: (message) => log(LOG_LEVELS.WARN, message),
    info: (message) => log(LOG_LEVELS.INFO, message),
    debug: (message) => log(LOG_LEVELS.DEBUG, message),
    
    // Specific event loggers
    startup: (message) => log(LOG_LEVELS.INFO, message, null, true),
    shutdown: (message) => log(LOG_LEVELS.INFO, message, null, true),
    command: (command, user) => log(LOG_LEVELS.INFO, `Command: ${command} by ${user}`),
    
    // Twitter specific loggers
    twitterEvent: (message) => log(LOG_LEVELS.INFO, `Twitter: ${message}`),
};

module.exports = logger; 