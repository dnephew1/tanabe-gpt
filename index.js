// index.js 

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { config, notifyAdmin } = require('./dependencies');
const { setupListeners } = require('./listener');
const { performCacheClearing, handleCorrenteResumoCommand } = require('./commands');
const { scheduleSummary } = require('./periodicSummary');

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

// Schedule cache clearing
function scheduleCacheClearing() {
    const now = new Date();
    let nextClearTime = new Date(now);
    nextClearTime.setHours(config.CACHE_CLEAR_HOUR, config.CACHE_CLEAR_MINUTE, 0, 0);
    
    // If the scheduled time has already passed today, schedule for tomorrow
    if (nextClearTime <= now) {
        nextClearTime.setDate(nextClearTime.getDate() + 1);
    }

    const timeUntilNextClear = nextClearTime.getTime() - now.getTime();

    setTimeout(async () => {
        await performCacheClearing();
        scheduleCacheClearing(); // Schedule the next cache clearing
    }, timeUntilNextClear);

    console.log(`Next cache clearing scheduled for ${nextClearTime.toLocaleString()} (Local Time)`);
}

// Client ready event handler
client.on('ready', async () => {
    console.log('Client is ready!');
    global.client.isReady = true;
    global.client.pupBrowser = client.pupPage.browser();

    try {
        await notifyAdmin("Bot is online and ready!");
    } catch (error) {
        console.error("Failed to notify admin:", error);
    }

    try {
        await performCacheClearing();
    } catch (error) {
        console.error("Failed to clear cache:", error);
        await notifyAdmin("Failed to clear cache: " + error.message).catch(console.error);
    }

    scheduleCacheClearing();
    scheduleNextSummary(); // Schedule the periodic summary

    console.log("Bot initialization completed");
});

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
    console.log(`Next summary scheduled for ${console.log(brasiliaTime.getHours())}:00 (Brasilia Time)`);
    notifyAdmin(`Next summary scheduled for ${console.log(brasiliaTime.getHours())}:00 (Brasilia Time)`).catch(console.error);
}

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
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    notifyAdmin(`Unhandled Rejection: ${reason}`).catch(console.error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    notifyAdmin(`Uncaught Exception: ${error.message}`).catch(console.error);
    process.exit(1);
});

// Initialize the client
client.initialize();