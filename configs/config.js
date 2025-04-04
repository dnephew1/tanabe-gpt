// config.js

// Import configurations
const CREDENTIALS = require('./credentials');
const COMMANDS = require('./commandConfigs');
const TWITTER = require('./commandConfigs/twitter.config');

// Avoid circular dependency with periodic_summary_config
let PERIODIC_SUMMARY;
setTimeout(() => {
    PERIODIC_SUMMARY = require('./periodic_summary_config');
}, 0);

// System settings
const SYSTEM = {
    MAX_LOG_MESSAGES: 1000,
    MESSAGE_DELETE_TIMEOUT: 60000,
    ENABLE_STARTUP_CACHE_CLEARING: true,
    MAX_RECONNECT_ATTEMPTS: 5,
    OPENAI_MODELS: {
        DEFAULT: "gpt-4o-mini",
        VOICE: "whisper-1",  // Model for voice transcription
    },
    // Logging and notification settings
    CONSOLE_LOG_LEVELS: {
        ERROR: true,
        WARN: true,
        INFO: true,
        DEBUG: false,
        SUMMARY: true,
        STARTUP: true,
        SHUTDOWN: true,
        PROMPT: false,
        COMMAND: true
    },
    NOTIFICATION_LEVELS: {
        ERROR: true,
        WARN: true,
        INFO: false,
        DEBUG: false,
        SUMMARY: true,
        STARTUP: true,
        SHUTDOWN: true,
        PROMPT: false,
        COMMAND: false
    },
    ADMIN_NOTIFICATION_CHAT: CREDENTIALS.ADMIN_WHATSAPP_ID,
};

// Export all configurations
module.exports = {
    SYSTEM,
    TWITTER,
    COMMANDS,
    get PERIODIC_SUMMARY() {
        return PERIODIC_SUMMARY;
    },
    CREDENTIALS
};