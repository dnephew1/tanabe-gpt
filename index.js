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
const { config, notifyAdmin } = require('./dependencies');
const { setupListeners } = require('./listener');
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

        const interval = getShortestInterval();
        if (!interval) {
            logger.info('No groups configured for periodic summaries');
            return;
        }

        // Convert interval to milliseconds
        const intervalMs = interval * 60 * 60 * 1000;

        // Schedule next run
        setTimeout(() => {
            // Only run if it's not quiet time
            if (!isQuietTimeForAnyGroup()) {
                runPeriodicSummary().catch(error => {
                    logger.error('Failed to run periodic summary', error);
                });
            } else {
                logger.info('Skipping summary - currently in quiet time');
            }
            // Schedule next run regardless
            scheduleNextSummary();
        }, intervalMs);

        // Log next run time
        const nextRunTime = new Date(Date.now() + intervalMs);
        logger.info(`Next summary scheduled for ${nextRunTime.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (BRT)`);
    } catch (error) {
        logger.error('Error scheduling next summary', error);
        // Try to reschedule in 5 minutes if there's an error
        setTimeout(scheduleNextSummary, 5 * 60 * 1000);
    }
}

// Initialize bot components
async function initializeBot() {
    try {
        logger.startup('Bot starting...');

        // Set up event listeners before initialization
        client.on('qr', qr => {
            logger.info('Scan QR code to authenticate');
            qrcode.generate(qr, { small: true });
        });

        client.on('auth_failure', (msg) => {
            logger.error('Authentication failed', msg);
        });

        // Set up disconnection handler
        client.on('disconnected', (reason) => {
            logger.warn(`Client disconnected: ${reason}`);
            reconnectClient();
        });

        // Wait for client to be ready
        await new Promise((resolve, reject) => {
            let isInitialized = false;

            client.on('ready', async () => {
                isInitialized = true;

                try {
                    // Initialize components only after client is ready
                    await initializeMessageLog();
                    
                    if (config.PERIODIC_SUMMARY?.enabled) {
                        scheduleNextSummary();
                    }

                    if (config.TWITTER?.enabled) {
                        await initializeTwitterMonitor(client);
                    }

                    // Set up message handler
                    client.on('message', async (message) => {
                        try {
                            const userId = message.from;
                            const isCommand = message.body.startsWith('#') || message.body.startsWith('@');
                            const hasActiveSession = config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];

                            if (isCommand || hasActiveSession) {
                                const contact = await message.getContact();
                                const user = contact.name || contact.pushname || contact.number;
                                logger.command(message.body, user);
                                await processCommand(message);
                            }
                        } catch (error) {
                            logger.error('Error processing message', error);
                        }
                    });

                    logger.startup('Bot ready');
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            // Initialize the client
            client.initialize().catch(reject);

            // Add timeout
            setTimeout(() => {
                if (!isInitialized) {
                    reject(new Error('Client initialization timed out'));
                }
            }, 60000);
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
