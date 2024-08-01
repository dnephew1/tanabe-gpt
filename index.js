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
function startPeriodicSummary() {
    console.log('Starting periodic summary...');
    setInterval(async () => {
        try {
            const now = new Date();
            const currentHour = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

            // Check if it's outside the "do not disturb" period
            if (currentHour >= config.GROUP2_DO_NOT_DISTURB_END && currentHour < config.GROUP2_DO_NOT_DISTURB_START) {
                const chat = await global.client.getChatById(config.GROUP2_NAME);
                if (chat) {
                    if (chat.unreadCount > 0) {
                        console.log("Generating periodic summary for Group 2");
                        const messages = await chat.fetchMessages({ limit: chat.unreadCount });
                        const messageTexts = (await Promise.all(messages.map(async message => {
                            const contact = await message.getContact();
                            const name = contact.pushname || contact.name || contact.number;
                            return `>>${name}: ${message.body}.\n`;
                        }))).join(' ');

                        if (messageTexts) {
                            const summary = await handleCorrenteResumoCommand({ chat: chat, reply: chat.sendMessage.bind(chat) }, ['#resumo']);
                            
                            if (summary && summary.trim() !== "Não houve doações ou pedidos nas últimas 3 horas.") {
                                await chat.sendMessage(summary);
                                await notifyAdmin(`Periodic summary sent to Group 2:\n\n${summary}`);
                            } else {
                                await notifyAdmin("No periodic summary was sent to Group 2 (no content to summarize).");
                            }
                        }

                        // Mark messages as read
                        await chat.sendSeen();
                    } else {
                        await notifyAdmin("No unread messages in Group 2, summary not sent");
                    }
                } else {
                    console.log("Group 2 chat not found");
                    await notifyAdmin("Periodic summary not sent: Group 2 chat not found.");
                }
            } else {
                await notifyAdmin(`Periodic summary skipped due to do not disturb period: ${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
            }
        } catch (error) {
            console.error('Error during periodic summary:', error);
            await notifyAdmin(`Error during periodic summary: ${error.message}`);
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
