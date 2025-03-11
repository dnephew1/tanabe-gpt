const fs = require('fs').promises;
const config = require('../configs');

// Log levels
const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG',
    SUMMARY: 'SUMMARY',
    PROMPT: 'PROMPT'
};

// Log file configuration
const LOG_FILE = 'tanabe-gpt.log';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const BACKUP_LOG_FILE = 'tanabe-gpt.old.log';

// ANSI color codes
const COLORS = {
    RED: '\x1b[31m',
    YELLOW: '\x1b[33m',
    RESET: '\x1b[0m'
};

// Function to format error objects
function formatError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    
    // Get the first line of the stack trace that isn't from node_modules
    const stackLine = error.stack?.split('\n')
        .find(line => line.includes('at') && !line.includes('node_modules'))
        ?.trim()
        ?.split('at ')[1] || 'unknown location';
    
    // Extract just the file name and line number
    const match = stackLine.match(/[^/]*\.js:\d+/);
    const location = match ? match[0] : stackLine;
    
    return `${error.message} (${location})`;
}

// Function to format the log message with timestamp
function formatLogWithTimestamp(level, message, error = null) {
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    
    let prefix = `[${timestamp}] [${level}]`;
    if (level === LOG_LEVELS.ERROR) {
        prefix = `[${timestamp}] ${COLORS.RED}[${level}]${COLORS.RESET}`;
    } else if (level === LOG_LEVELS.WARN) {
        prefix = `[${timestamp}] ${COLORS.YELLOW}[${level}]${COLORS.RESET}`;
    }
    
    let logMessage = `${prefix} ${message}`;
    
    if (error) {
        logMessage += `: ${formatError(error)}`;
    }
    
    return logMessage;
}

// Function to format admin notification message
function formatAdminMessage(level, message, error = null) {
    // Skip the log level prefix entirely
    let logMessage = message;
    
    if (error) {
        const errorMsg = formatError(error);
        // Only include the error message if it's not already part of the message
        if (!message.includes(errorMsg)) {
            logMessage += `: ${errorMsg}`;
        }
    }
    
    // Remove any double colons that might appear from error formatting
    return logMessage.replace(/:+/g, ':');
}

// Function to check log file size and rotate if needed
async function checkAndRotateLog() {
    try {
        const stats = await fs.stat(LOG_FILE).catch(() => ({ size: 0 }));
        
        if (stats.size >= MAX_LOG_SIZE) {
            // Backup existing log file
            await fs.rename(LOG_FILE, BACKUP_LOG_FILE).catch(() => {});
            // Create new empty log file
            await fs.writeFile(LOG_FILE, '');
        }
    } catch (error) {
        console.error('Error rotating log file:', error);
    }
}

// Function to write to log file
async function writeToLogFile(message) {
    try {
        await checkAndRotateLog();
        await fs.appendFile(LOG_FILE, message + '\n');
    } catch (error) {
        console.error('Error writing to log file:', error);
    }
}

// Functionto notify admin
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

// Core logging function
async function log(level, message, error = null, shouldNotifyAdmin = false) {
    // Check if this log level is enabled in console settings
    // Only proceed if the log level is explicitly set to true
    if (!config.SYSTEM?.CONSOLE_LOG_LEVELS || 
        config.SYSTEM.CONSOLE_LOG_LEVELS[level] !== true) {
        // Skip logging for this level
        return;
    }

    // Format the message for console/file
    const formattedMessage = formatLogWithTimestamp(level, message, error);
    
    // Write to log file
    await writeToLogFile(formattedMessage);
    
    // Use appropriate console method based on level
    switch(level) {
        case LOG_LEVELS.ERROR:
            console.error(formattedMessage);
            break;
        case LOG_LEVELS.WARN:
            console.warn(formattedMessage);
            break;
        case LOG_LEVELS.DEBUG:
            if (typeof message === 'object') {
                console.log(formatLogWithTimestamp(level, JSON.stringify(message, null, 2)));
            } else {
                console.log(formattedMessage);
            }
            if (error) {
                console.log(formatLogWithTimestamp(level, `Error: ${formatError(error)}`));
            }
            break;
        default:
            console.log(formattedMessage);
    }

    // Check if this log level should be sent to admin
    if (shouldNotifyAdmin && config.SYSTEM?.NOTIFICATION_LEVELS && 
        config.SYSTEM.NOTIFICATION_LEVELS[level] === true) {
        // Use simplified format for admin notifications
        const adminMessage = formatAdminMessage(level, message, error);
        await notifyAdmin(adminMessage);
    }
}

// Convenience methods for different log levels
const logger = {
    error: (message, error = null) => log(LOG_LEVELS.ERROR, message, error, true),
    warn: (message, error = null, shouldNotifyAdmin = true) => log(LOG_LEVELS.WARN, message, error, shouldNotifyAdmin),
    info: (message) => log(LOG_LEVELS.INFO, message, null, true),
    debug: (message, obj = null) => {
        // Only proceed if DEBUG is explicitly set to true
        if (!config.SYSTEM?.CONSOLE_LOG_LEVELS || 
            config.SYSTEM.CONSOLE_LOG_LEVELS.DEBUG !== true) {
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
        // Only proceed if PROMPT is explicitly set to true
        if (!config.SYSTEM?.CONSOLE_LOG_LEVELS || 
            config.SYSTEM.CONSOLE_LOG_LEVELS.PROMPT !== true) {
            return;
        }
        
        // Handle undefined promptText
        if (promptText === undefined) {
            console.warn(formatLogWithTimestamp('WARN', 'Undefined prompt text received'));
            promptText = 'UNDEFINED PROMPT';
        }
        
        const promptHeader = formatLogWithTimestamp(LOG_LEVELS.PROMPT, message);
        console.log(promptHeader);
        console.log(promptText);
        
        // Also write to log file
        writeToLogFile(promptHeader)
            .then(() => writeToLogFile(promptText))
            .catch(err => console.error('Error writing prompt to log file:', err));
        
        if (config.SYSTEM?.NOTIFICATION_LEVELS && 
            config.SYSTEM.NOTIFICATION_LEVELS.PROMPT === true) {
            notifyAdmin(`[PROMPT] ${message}\n\n${promptText}`).catch(error => 
                console.error('Failed to notify admin of prompt:', formatError(error))
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