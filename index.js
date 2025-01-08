// index.js 

process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return;
  }
  console.warn(warning.name, warning.message);
});

console.log('STARTING TANABE-GPT...');

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { config } = require('./dependencies');
const setupListeners = require('./listener');
const { runPeriodicSummary } = require('./periodicSummary');
const { initializeMessageLog } = require('./messageLogger');
const { initializeTwitterMonitor } = require('./twitterMonitor');
const { processCommand } = require('./commandHandler');
const logger = require('./logger');

let cacheManagement;
if (config.ENABLE_STARTUP_CACHE_CLEARING) {
    cacheManagement = require('./cacheManagement');
}

// Initialize global client
global.client = null;

// Create a new WhatsApp client instance with optimized settings
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

// Assign the client to global.client after creation
global.client = client;

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

// Helper function to check if it's quiet time for any enabled group
function isQuietTimeForAnyGroup() {
    if (!config.PERIODIC_SUMMARY?.enabled) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 100 + currentMinute;

    for (const groupConfig of Object.values(config.PERIODIC_SUMMARY.groups)) {
        if (!groupConfig.enabled || !groupConfig.quietTime) continue;

        const [startHour, startMinute] = groupConfig.quietTime.start.split(':').map(Number);
        const [endHour, endMinute] = groupConfig.quietTime.end.split(':').map(Number);
        const startTime = startHour * 100 + startMinute;
        const endTime = endHour * 100 + endMinute;

        // Handle cases where quiet time spans across midnight
        if (startTime > endTime) {
            if (currentTime >= startTime || currentTime <= endTime) {
                return true;
            }
        } else if (currentTime >= startTime && currentTime <= endTime) {
            return true;
        }
    }
    return false;
}

// Get the shortest interval from all enabled groups
function getShortestInterval() {
    if (!config.PERIODIC_SUMMARY?.enabled) return null;

    let shortestInterval = Infinity;
    for (const groupConfig of Object.values(config.PERIODIC_SUMMARY.groups)) {
        if (groupConfig.enabled && groupConfig.intervalHours) {
            shortestInterval = Math.min(shortestInterval, groupConfig.intervalHours);
        }
    }
    return shortestInterval === Infinity ? null : shortestInterval;
}

function scheduleNextSummary() {
    try {
        if (!config.PERIODIC_SUMMARY?.enabled) {
            logger.info('Periodic summaries are disabled');
            return;
        }

        const nextSummaryInfo = getNextSummaryInfo();
        if (!nextSummaryInfo) {
            logger.info('No groups configured for periodic summaries');
            return;
        }

        const { group, interval, nextValidTime } = nextSummaryInfo;
        const intervalMs = interval * 60 * 60 * 1000;

        // Schedule next run
        setTimeout(() => {
            runPeriodicSummary().then(summaryResult => {
                const { success, reason, nextGroup, nextTime } = summaryResult;
                const statusMessage = success 
                    ? `Summary sent for ${group}`
                    : `Summary not sent for ${group}: ${reason}`;
                
                const nextSummaryMessage = `Next summary: ${nextGroup} at ${nextTime.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (BRT)`;
                
                // Log summary status and next summary info
                logger.summary(`${statusMessage}. ${nextSummaryMessage}`);
            }).catch(error => {
                logger.error('Failed to run periodic summary', error);
            });
            
            // Schedule next run regardless
            scheduleNextSummary();
        }, intervalMs);

        // Log next run time with group info
        const summaryTimeMessage = isQuietTimeForGroup(group, nextValidTime)
            ? `Summary for ${group} scheduled for ${nextValidTime.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (BRT) - Note: This is during quiet hours`
            : `Next summary: ${group} at ${nextValidTime.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (BRT)`;
            
        logger.summary(summaryTimeMessage);
    } catch (error) {
        logger.error('Error scheduling next summary', error);
        // Try to reschedule in 5 minutes if there's an error
        setTimeout(scheduleNextSummary, 5 * 60 * 1000);
    }
}

function getNextSummaryInfo() {
    const groups = Object.entries(config.PERIODIC_SUMMARY.groups)
        .filter(([_, config]) => config.enabled);
    
    if (groups.length === 0) return null;

    let nextSummaryTime = Infinity;
    let selectedGroup = null;
    let selectedInterval = null;

    for (const [group, groupConfig] of groups) {
        const interval = groupConfig.intervalHours || config.PERIODIC_SUMMARY.defaults.intervalHours;
        const now = new Date();
        let nextTime = new Date(now.getTime() + interval * 60 * 60 * 1000);
        
        // If it's during quiet hours, find the next valid time
        while (isQuietTimeForGroup(group, nextTime)) {
            nextTime = new Date(nextTime.getTime() + interval * 60 * 60 * 1000);
        }

        if (nextTime.getTime() < nextSummaryTime) {
            nextSummaryTime = nextTime.getTime();
            selectedGroup = group;
            selectedInterval = interval;
        }
    }

    return selectedGroup ? {
        group: selectedGroup,
        interval: selectedInterval,
        nextValidTime: new Date(nextSummaryTime)
    } : null;
}

function isQuietTimeForGroup(groupName, time) {
    const groupConfig = config.PERIODIC_SUMMARY.groups[groupName];
    const quietTime = groupConfig?.quietTime || config.PERIODIC_SUMMARY.defaults.quietTime;
    
    const timeStr = time.toLocaleTimeString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    return isTimeBetween(timeStr, quietTime.start, quietTime.end);
}

// Initialize bot components
async function initializeBot() {
    try {
        // Clear cache if enabled
        if (config.SYSTEM.ENABLE_STARTUP_CACHE_CLEARING) {
            const { performCacheClearing } = require('./cacheManagement');
            const { clearedFiles } = await performCacheClearing();
            if (clearedFiles > 0) {
                logger.info(`Cache cleared successfully: ${clearedFiles} files removed`);
            }
        }

        // Initialize WhatsApp client
        const client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                args: ['--no-sandbox']
            }
        });

        // Set up error handling
        client.on('auth_failure', () => {
            logger.error('Authentication failed');
            process.exit(1);
        });

        client.on('disconnected', (reason) => {
            logger.error('Client was disconnected', reason);
            process.exit(1);
        });

        // Initialize the client
        await client.initialize();

        // Store client globally for admin notifications
        global.client = client;

        await new Promise((resolve, reject) => {
            let isInitialized = false;

            client.on('ready', async () => {
                isInitialized = true;

                try {
                    // Process any pending admin notifications
                    if (global.pendingAdminNotifications?.length > 0) {
                        logger.info('Processing pending admin notifications...');
                        for (const message of global.pendingAdminNotifications) {
                            await logger.notifyAdmin(message);
                        }
                        global.pendingAdminNotifications = [];
                    }

                    // Initialize components only after client is ready
                    await initializeMessageLog(client);
                    
                    // Set up all message listeners
                    await setupListeners(client);
                    
                    if (config.PERIODIC_SUMMARY?.enabled) {
                        scheduleNextSummary();
                    }

                    if (config.TWITTER?.enabled) {
                        await initializeTwitterMonitor(client);
                    }

                    const startupMessage = `Bot is now online and ready`;
                    await logger.startup(startupMessage);

                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            // Set a timeout for initialization
            setTimeout(() => {
                if (!isInitialized) {
                    reject(new Error('Client initialization timed out'));
                }
            }, 30000);
        });
    } catch (error) {
        logger.error('Failed to initialize bot', error);
        process.exit(1);
    }
}

// Reconnect on disconnection
let reconnectAttempts = 0;

async function reconnectClient() {
    if (reconnectAttempts < config.MAX_RECONNECT_ATTEMPTS) {
        logger.info(`Attempting to reconnect (attempt ${reconnectAttempts + 1}/${config.MAX_RECONNECT_ATTEMPTS})`);
        client.initialize();
        reconnectAttempts++;
    } else {
        logger.shutdown(`Failed to reconnect after ${config.MAX_RECONNECT_ATTEMPTS} attempts. Shutting down...`);
        process.exit(1);
    }
}

// Error handling for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', error);
    process.exit(1);
});

// Start initialization
initializeBot().catch(error => {
    logger.error('Failed to initialize bot', error);
    process.exit(1);
});
