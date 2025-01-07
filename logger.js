const config = require('./config');

// Log levels
const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG',
    SUMMARY: 'SUMMARY',
    PROMPT: 'PROMPT'
};

// Function to format error objects
function formatError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    
    const location = error.stack?.split('\n')[1]?.trim()?.split('at ')[1] || 'unknown location';
    return `${error.message} (at ${location})`;
}

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
        console.error(`Failed to process admin notification: ${formatError(error)}`);
    }
}

// Formats the log message
function formatLog(level, message, error = null) {
    let logMessage = `[${level}] ${message}`;
    
    if (error) {
        logMessage += `: ${formatError(error)}`;
    }
    
    return logMessage;
}

// Core logging function
async function log(level, message, error = null, shouldNotifyAdmin = false) {
    // Check if this log level is enabled in console settings
    if (!config.SYSTEM?.CONSOLE_LOG_LEVELS?.[level]) {
        return;
    }

    // Format the message
    const formattedMessage = formatLog(level, message, error);
    
    // Use appropriate console method based on level
    switch(level) {
        case LOG_LEVELS.ERROR:
            console.error(formattedMessage);
            break;
        case LOG_LEVELS.WARN:
            console.warn(formattedMessage);
            break;
        case LOG_LEVELS.DEBUG:
            // For debug messages, handle objects properly
            if (typeof message === 'object') {
                console.log(formatLog(level, JSON.stringify(message, null, 2)));
            } else {
                console.log(formattedMessage);
            }
            if (error) {
                console.log(formatLog(level, `Error: ${formatError(error)}`));
            }
            break;
        default:
            console.log(formattedMessage);
    }

    // Check if this log level should be sent to admin
    if (shouldNotifyAdmin && config.SYSTEM?.ADMIN_NOTIFICATION_LEVELS?.[level]) {
        await notifyAdmin(formattedMessage);
    }
}

// Convenience methods for different log levels
const logger = {
    error: (message, error = null) => log(LOG_LEVELS.ERROR, message, error, true),
    warn: (message) => log(LOG_LEVELS.WARN, message, null, true),
    info: (message) => log(LOG_LEVELS.INFO, message, null, true),
    debug: (message, obj = null) => {
        if (!config.SYSTEM?.CONSOLE_LOG_LEVELS?.DEBUG) {
            return;
        }
        if (obj) {
            // If an object is provided, log both the message and the object
            log(LOG_LEVELS.DEBUG, message);
            log(LOG_LEVELS.DEBUG, `Data: ${JSON.stringify(obj, null, 2)}`);
        } else if (typeof message === 'object') {
            // If message is an object, stringify it
            log(LOG_LEVELS.DEBUG, JSON.stringify(message, null, 2));
        } else {
            // Otherwise just log the message
            log(LOG_LEVELS.DEBUG, message);
        }
    },
    summary: (message) => log(LOG_LEVELS.SUMMARY, message, null, true),
    prompt: (message, promptText) => {
        if (config.SYSTEM?.CONSOLE_LOG_LEVELS?.[LOG_LEVELS.PROMPT]) {
            console.log('\n[PROMPT]', message);
            console.log('------- PROMPT START -------');
            console.log(promptText);
            console.log('-------- PROMPT END --------\n');
        }
        if (config.SYSTEM?.ADMIN_NOTIFICATION_LEVELS?.[LOG_LEVELS.PROMPT]) {
            notifyAdmin(`[PROMPT] ${message}\n\n${promptText}`).catch(error => 
                console.error('Failed to notify admin of prompt:', error)
            );
        }
    },
    
    // Specific event loggers
    startup: (message) => log('STARTUP', message, null, true),
    shutdown: (message) => log('SHUTDOWN', message, null, true),
    command: (command, user) => log(LOG_LEVELS.INFO, `Command: ${command} by ${user}`, null, true),
    
    // Export notifyAdmin for external use
    notifyAdmin
};

module.exports = logger; 