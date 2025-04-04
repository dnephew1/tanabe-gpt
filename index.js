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
const config = require('./configs');
const { setupListeners } = require('./core/listener');
const { runPeriodicSummary } = require('./commands/periodicSummary');
const { initializeMessageLog } = require('./utils/messageLogger');
const { initializeTwitterMonitor } = require('./commands/twitterMonitor');
const commandManager = require('./core/CommandManager');
const logger = require('./utils/logger');
const path = require('path');
const fs = require('fs');

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
        logger.debug('Starting WhatsApp client initialization...');
        
        // Determine auth path and client ID
        const authPath = process.env.USE_AUTH_DIR || path.join(__dirname, '.wwebjs_auth_main');
        const clientId = process.env.USE_CLIENT_ID || 'tanabe-gpt-client';
        logger.debug(`Using authentication path: ${authPath} with client ID: ${clientId}`);
        
        // Check if the session folder exists
        const sessionFolder = path.join(authPath, `session-${clientId}`);
        if (fs.existsSync(sessionFolder)) {
            logger.debug(`Found existing session folder: ${sessionFolder}`);
        } else {
            logger.warn(`Session folder not found: ${sessionFolder}. A new one will be created.`);
        }
        
        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: clientId,
                dataPath: authPath
            }),
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
                ]
            },
            restartOnAuthFail: true,
            qrMaxRetries: 5,
            qrTimeoutMs: 60000,
            authTimeoutMs: 60000,
            takeoverOnConflict: true,
            takeoverTimeoutMs: 60000
        });

        // Store client globally for use in other modules
        global.client = client;
        logger.debug('Storing client globally...');

        // Set up QR code handling
        let qrAttempts = 0;
        client.on('qr', (qr) => {
            qrAttempts++;
            logger.info(`QR Code received (attempt ${qrAttempts}/5), scan to authenticate:`);
            qrcode.generate(qr, { small: true });
            
            // Log additional instructions
            if (qrAttempts === 1) {
                logger.info('To authenticate: Open WhatsApp on your phone, go to Settings > Linked Devices > Link a Device');
            }
        });

        // Set up detailed event logging
        client.on('loading_screen', (percent, message) => {
            logger.debug('WhatsApp loading screen:', {
                percent,
                message
            });
        });

        client.on('authenticated', () => {
            logger.debug('Client authenticated successfully');
            qrAttempts = 0;
            logger.info('WhatsApp authentication successful! Session will be saved for future use.');
        });

        client.on('auth_failure', (msg) => {
            logger.error('Authentication failed:', msg);
            logger.info('Please try again. If the problem persists, delete the .wwebjs_auth directory and restart.');
            throw new Error(`Authentication failed: ${msg}`);
        });

        client.on('disconnected', (reason) => {
            logger.error('Client was disconnected:', reason);
            throw new Error(`WhatsApp disconnected: ${reason}`);
        });

        // Create a promise that resolves when the client is ready
        const readyPromise = new Promise((resolve, reject) => {
            // Set a timeout to reject the promise if it takes too long
            const timeout = setTimeout(() => {
                reject(new Error('WhatsApp client initialization timed out after 2 minutes'));
            }, 120000); // 2 minutes timeout
            
            client.on('ready', () => {
                logger.debug('WhatsApp client is ready and authenticated!');
                clearTimeout(timeout); // Clear the timeout
                resolve(); // Resolve the promise
            });
        });

        // Start the client initialization
        logger.debug('Starting WhatsApp client and waiting for authentication...');
        
        // Initialize the client (this starts the authentication process)
        await client.initialize().catch(error => {
            logger.error('Error initializing WhatsApp client:', error);
            throw error;
        });
        
        // Wait for the client to be ready (fully authenticated)
        logger.debug('Waiting for WhatsApp client to be fully ready...');
        await readyPromise;
        
        logger.debug('WhatsApp client authenticated and initialized successfully!');

        // Now that we're authenticated and ready, set up the rest of the components
        logger.debug('Setting up command handlers and listeners...');
        
        // Register command handlers
        logger.debug('Registering command handlers...');
        setupListeners(client);
        logger.debug('Command handlers registered successfully');
        logger.debug('All listeners set up successfully');

        // Initialize message logging
        logger.debug('Initializing message logging...');
        initializeMessageLog();
        logger.debug('Message logging initialized successfully');

        // Initialize Twitter monitor if enabled
        try {
            logger.debug('Initializing Twitter monitor...');
            await initializeTwitterMonitor();
        } catch (error) {
            logger.error('Failed to initialize Twitter monitor:', error);
            // Continue even if Twitter monitor fails
        }
        
        // Notify admin of startup
        try {
            logger.debug('Notifying admin of startup...');
            const adminNumber = config.CREDENTIALS.ADMIN_NUMBER;
            if (adminNumber) {
                const adminChat = await client.getChatById(`${adminNumber}@c.us`);
                await adminChat.sendMessage('🤖 Bot has been started successfully!');
                logger.debug('Admin notified of bot startup');
            }
        } catch (error) {
            logger.error('Failed to notify admin of startup:', error);
            // Continue even if admin notification fails
        }

        logger.info('Bot initialization completed successfully!');
        return client;

    } catch (error) {
        logger.error('Error during bot initialization:', error);
        throw error;
    }
}

// Main function
async function main() {
    try {
        logger.debug('Starting bot...');
        
        // Perform git pull if running in production
        if (process.env.NODE_ENV === 'production') {
            logger.info('Performing git pull...');
            try {
                const { execSync } = require('child_process');
                const output = execSync('git pull').toString().trim();
                
                if (output === '') {
                    logger.info('Git pull completed: No changes detected (already up to date)');
                } else {
                    logger.info('Git pull result:', output);
                }
            } catch (error) {
                logger.error('Error performing git pull:', error.message);
                // Continue even if git pull fails
            }
        }

        logger.debug('Initializing bot...');
        // Initialize the bot
        await initializeBot();
        logger.debug('Bot initialization completed.');
    } catch (error) {
        logger.error('Error in main function:', error);
        
        // Provide specific guidance based on the error
        if (error.message && error.message.includes('auth')) {
            logger.error('Authentication error detected. Try the following:');
            logger.error('1. Delete the .wwebjs_auth directory: rm -rf .wwebjs_auth');
            logger.error('2. Restart the bot: node index.js');
            logger.error('3. Scan the QR code with your WhatsApp');
            logger.info('Authentication error detected. Try deleting the .wwebjs_auth directory and restarting the bot.');
        } else if (error.message && error.message.includes('timeout')) {
            logger.error('Timeout error detected. Try the following:');
            logger.error('1. Check your internet connection');
            logger.error('2. Delete the .wwebjs_auth directory: rm -rf .wwebjs_auth');
            logger.error('3. Restart the bot: node index.js');
        } else if (error.message && error.message.includes('disconnected')) {
            logger.error('WhatsApp disconnected. Try the following:');
            logger.error('1. Check your internet connection');
            logger.error('2. Make sure WhatsApp is running on your phone');
            logger.error('3. Restart the bot: node index.js');
        }
        
        // Keep the process alive to see the error
        logger.error('Press Ctrl+C to exit.');
    }
}

// Start the bot
main().catch(error => {
    logger.error('UNHANDLED ERROR IN MAIN:', error);
});

