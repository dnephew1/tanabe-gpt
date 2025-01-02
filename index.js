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

// Show QR code for authentication
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

// Client ready event handler
client.on('ready', async () => {
    console.log('Client is ready!');
    global.client.isReady = true;
    global.client.pupBrowser = client.pupPage.browser();
    await initializeMessageLog();

    try {
        await notifyAdmin("Bot is online and ready!");
    } catch (error) {
        console.error('Failed to notify admin:', error.message);
    }

    if (cacheManagement) {
        if (config.ENABLE_STARTUP_CACHE_CLEARING) {
            await cacheManagement.startupCacheClearing();
        }
    }
    scheduleNextSummary(); // Schedule the periodic summary

    console.log('Bot initialization completed');

    await initializeTwitterMonitor();
});

// Reconnect on disconnection
let reconnectAttempts = 0;

function reconnectClient() {
    if (reconnectAttempts < config.MAX_RECONNECT_ATTEMPTS) {
        console.log('Attempting to reconnect...');
        client.initialize();
        reconnectAttempts++;
    } else {
        console.log(`Failed to reconnect after ${config.MAX_RECONNECT_ATTEMPTS} attempts. Exiting...`);
        notifyAdmin("Bot failed to reconnect and is shutting down.").catch(console.error);
        process.exit(1);
    }
}

client.on('disconnected', (reason) => {
    console.log('Client disconnected:', reason);
    notifyAdmin(`Bot disconnected: ${reason}`).catch(console.error);
    reconnectClient();
});

// Setup message listeners
setupListeners(client);

// Error handling for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason?.message || reason);
    notifyAdmin(`Unhandled Rejection: ${reason?.message || reason}`).catch(console.error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message);
    notifyAdmin(`Uncaught Exception: ${error.message}`).catch(console.error);
    process.exit(1);
});

////////////////////////////////////////////////////////////////////////////////////////////////////////
function scheduleNextSummary() {
    // Get current time in Brasilia
    const brasiliaTime = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    brasiliaTime.setSeconds(0, 0);
    const currentHour = brasiliaTime.getHours();

    // Find next run time in Brasilia time
    let nextRunTime = new Date(brasiliaTime);
    const nextHour = config.SUMMARY_TIMES.find(hour => hour > currentHour) || config.SUMMARY_TIMES[0];
    nextRunTime.setHours(nextHour, 0, 0, 0);

    if (nextHour <= currentHour) {
        nextRunTime.setDate(nextRunTime.getDate() + 1);
    }

    // Calculate delay in milliseconds
    const now = new Date();
    const delay = nextRunTime.getTime() - brasiliaTime.getTime();

    setTimeout(() => {
        runPeriodicSummary().finally(scheduleNextSummary);
    }, delay);
    console.log(`Next summary scheduled for ${nextRunTime.getHours()}:00 (Brasilia Time)`);
}
////////////////////////////////////////////////////////////////////////////////////////////////////////

// Initialize the client
client.initialize();
