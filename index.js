// index.js 

process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return;
  }
  console.warn(warning.name, warning.message);
});

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const { setupListeners } = require('./core/listener');
const { runPeriodicSummary } = require('./commands/periodicSummary');
const { initializeMessageLog } = require('./utils/messageLogger');
const { initializeTwitterMonitor } = require('./commands/twitterMonitor');
const commandManager = require('./core/CommandManager');
const logger = require('./utils/logger');

// Add global error handlers
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Initialize global client
global.client = null;

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 seconds

async function reconnectClient() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        logger.warn(`Attempting to reconnect (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
        try {
            reconnectAttempts++;
            await initializeBot();
        } catch (error) {
            logger.error('Reconnection attempt failed:', error);
            // Wait before trying again
            setTimeout(reconnectClient, RECONNECT_DELAY);
        }
    } else {
        logger.error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts. Shutting down...`);
        process.exit(1);
    }
}

function getNextSummaryInfo() {
    // If PERIODIC_SUMMARY exists and is explicitly disabled, return null
    if (config.PERIODIC_SUMMARY?.enabled === false) {
        return null;
    }

    // Get groups and apply defaults
    const groups = Object.entries(config.PERIODIC_SUMMARY?.groups || {})
        .map(([groupName, groupConfig]) => {
            // Use defaults for any missing settings
            const defaults = config.PERIODIC_SUMMARY?.defaults || {};
            const groupSettings = {
                name: groupName,
                config: {
                    enabled: groupConfig?.enabled !== false, // enabled by default unless explicitly false
                    intervalHours: groupConfig?.intervalHours || defaults.intervalHours,
                    quietTime: groupConfig?.quietTime || defaults.quietTime,
                    promptPath: groupConfig?.promptPath || defaults.promptPath
                }
            };
            return groupSettings;
        })
        .filter(group => group.config.enabled);
    
    if (groups.length === 0) {
        return null;
    }

    let nextSummaryTime = Infinity;
    let selectedGroup = null;
    let selectedInterval = null;

    const now = new Date();
    
    // Helper function to check if a time is between two times
    function isTimeBetween(time, start, end) {
        // Convert times to comparable format (minutes since midnight)
        const getMinutes = (timeStr) => {
            const [hours, minutes] = timeStr.split(':').map(Number);
            return hours * 60 + minutes;
        };

        const timeMinutes = getMinutes(time);
        const startMinutes = getMinutes(start);
        const endMinutes = getMinutes(end);

        // Handle cases where quiet time spans across midnight
        if (startMinutes > endMinutes) {
            return timeMinutes >= startMinutes || timeMinutes <= endMinutes;
        }
        return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
    }

    // Helper function to check if a time is during quiet hours for a group
    function isQuietTimeForGroup(groupName, time) {
        const groupConfig = config.PERIODIC_SUMMARY.groups[groupName];
        const defaults = config.PERIODIC_SUMMARY.defaults || {};
        const quietTime = groupConfig?.quietTime || defaults.quietTime;
        
        if (!quietTime?.start || !quietTime?.end) {
            return false;
        }

        const timeStr = time.toLocaleTimeString('pt-BR', { 
            timeZone: 'America/Sao_Paulo',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        return isTimeBetween(timeStr, quietTime.start, quietTime.end);
    }
    
    for (const group of groups) {
        // Calculate initial next time
        let nextTime = new Date(now.getTime() + group.config.intervalHours * 60 * 60 * 1000);
        
        // If current time is in quiet hours, adjust the next time
        while (isQuietTimeForGroup(group.name, nextTime)) {
            nextTime = new Date(nextTime.getTime() + 60 * 60 * 1000); // Add 1 hour and check again
        }

        if (nextTime.getTime() < nextSummaryTime) {
            nextSummaryTime = nextTime.getTime();
            selectedGroup = group.name;
            selectedInterval = group.config.intervalHours;
        }
    }

    if (!selectedGroup) {
        return null;
    }

    const nextTime = new Date(nextSummaryTime);
    return {
        group: selectedGroup,
        interval: selectedInterval,
        nextValidTime: nextTime
    };
}

async function scheduleNextSummary() {
    logger.debug('Checking periodic summary configuration:', {
        enabled: config.PERIODIC_SUMMARY?.enabled,
        groups: Object.keys(config.PERIODIC_SUMMARY?.groups || {})
    });
    
    const nextSummaryInfo = getNextSummaryInfo();
    if (!nextSummaryInfo) {
        // Try again in 1 hour if we couldn't schedule now
        setTimeout(scheduleNextSummary, 60 * 60 * 1000);
        return;
    }

    const { group, interval, nextValidTime } = nextSummaryInfo;
    const now = new Date();
    const delayMs = nextValidTime.getTime() - now.getTime();

    // Log summary schedule without sending to chat
    logger.summary(`Next summary scheduled for ${group} at ${nextValidTime.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (interval: ${interval}h)`);

    // Schedule the next summary
    setTimeout(async () => {
        try {
            logger.summary(`Running scheduled summary for group ${group}`);
            const result = await runPeriodicSummary(group);
            if (result) {
                logger.summary(`Successfully completed summary for group ${group}`);
            } else {
                logger.warn(`Summary for group ${group} completed but may have had issues`);
            }
        } catch (error) {
            logger.error(`Error running periodic summary for group ${group}:`, error);
        } finally {
            // Schedule the next summary regardless of whether this one succeeded
            scheduleNextSummary();
        }
    }, delayMs);
}

// Initialize bot components
async function initializeBot() {
    try {
        logger.info('Starting bot initialization...');

        // Clear cache if enabled
        if (config.SYSTEM?.ENABLE_STARTUP_CACHE_CLEARING) {
            logger.debug('Cache clearing is enabled, performing cleanup...');
            const { performCacheClearing } = require('./commands/cacheManagement');
            const { clearedFiles } = await performCacheClearing();
            if (clearedFiles > 0) {
                logger.info(`Cache cleared successfully: ${clearedFiles} files removed`);
            }
        }

        // Initialize WhatsApp client
        logger.debug('Creating WhatsApp client instance...');
        const client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ],
            }
        });

        // Set up detailed event logging
        client.on('auth_failure', (msg) => {
            logger.error('Authentication failed:', msg);
            process.exit(1);
        });

        client.on('disconnected', async (reason) => {
            logger.error('Client was disconnected:', reason);
            await reconnectClient();
        });

        client.on('ready', async () => {
            logger.debug('WhatsApp client is ready and authenticated!');
            reconnectAttempts = 0;

            // Initialize components after client is ready
            try {
                // Set up message logging
                logger.debug('Initializing message logging...');
                await initializeMessageLog();

                // Initialize Twitter monitor if configured
                if (config.TWITTER_MONITOR?.enabled) {
                    logger.debug('Initializing Twitter monitor...');
                    await initializeTwitterMonitor();
                }

                // Schedule periodic summaries if enabled
                if (config.PERIODIC_SUMMARY?.enabled) {
                    logger.debug('Scheduling periodic summaries...');
                    await scheduleNextSummary();
                }

                // Notify admin
                const adminChat = await client.getChatById(`${config.CREDENTIALS.ADMIN_NUMBER}@c.us`);
                if (adminChat) {
                    await adminChat.sendMessage('🤖 Bot is now online and ready!');
                    logger.debug('Admin notified of bot startup');
                }

                logger.info('Bot initialization completed successfully!');
            } catch (error) {
                logger.error('Error initializing components after client ready:', error);
            }
        });

        client.on('qr', (qr) => {
            logger.info('QR Code received, scan to authenticate:');
            qrcode.generate(qr, { small: true });
        });

        client.on('loading_screen', (percent, message) => {
            logger.debug('WhatsApp loading screen:', { percent, message });
        });

        client.on('authenticated', () => {
            logger.debug('Client authenticated successfully');
        });

        // Initialize the client with detailed error handling
        logger.debug('Starting WhatsApp client initialization...');
        try {
            await Promise.race([
                client.initialize(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('WhatsApp client initialization timed out after 60 seconds')), 60000)
                )
            ]);
            logger.debug('WhatsApp client initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize WhatsApp client:', error);
            throw error;
        }

        // Store client globally for admin notifications
        logger.debug('Storing client globally...');
        global.client = client;

        // Set up event listeners
        logger.debug('Setting up event listeners...');
        setupListeners(client);

        return true;

    } catch (error) {
        logger.error('Error during bot initialization:', error);
        throw error;
    }
}

// Start the bot
initializeBot().catch(error => {
    logger.error('Failed to initialize bot:', error);
    process.exit(1);
});

