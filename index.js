// index.js

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { config, notifyAdmin } = require('./dependencies');
const { setupListeners } = require('./listener');
const { performCacheClearing, handleCorrenteResumoCommand } = require('./commands');

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
    startPeriodicSummary();

    console.log("Bot initialization completed");
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

// Start periodic summary
// Replace the existing startPeriodicSummary function in index.js with this:

function startPeriodicSummary() {
    setInterval(async () => {
        const now = new Date();
        const currentHour = now.getHours();

        // Check if it's outside the "do not disturb" period
        if (currentHour >= config.GROUP2_DO_NOT_DISTURB_END && currentHour < config.GROUP2_DO_NOT_DISTURB_START) {
            try {
                const chat = await global.client.getChatById(config.GROUP2_NAME);
                if (chat) {
                    console.log("Generating periodic summary for Group 2");
                    const summary = await handleCorrenteResumoCommand({ chat: chat, reply: chat.sendMessage.bind(chat) }, ['#resumo']);
                    
                    if (summary) {
                        // Notify admin that a summary was sent and include the summary
                        await notifyAdmin(`Periodic summary sent to Group 2:\n\n${summary}`);
                    } else {
                        // Notify admin that no summary was sent
                        await notifyAdmin("No periodic summary was sent to Group 2 (no content to summarize).");
                    }
                } else {
                    console.log("Group 2 chat not found");
                    await notifyAdmin("Periodic summary not sent: Group 2 chat not found.");
                }
            } catch (error) {
                console.error('Error generating periodic summary:', error);
                await notifyAdmin(`Error generating periodic summary: ${error.message}`);
            }
        } else {
            // Notify admin that summary was skipped due to do not disturb
            await notifyAdmin("Periodic summary skipped due to do not disturb period.");
        }
    }, config.GROUP2_SUMMARY_INTERVAL);

    console.log("Periodic summary started");
}

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
