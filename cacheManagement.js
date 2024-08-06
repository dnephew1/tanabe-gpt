const { config, notifyAdmin } = require('./dependencies');
const path = require('path');
const fs = require('fs').promises;

function scheduleCacheClearing() {
    if (!config.ENABLE_AUTOMATED_CACHE_CLEARING) {
        console.log('Automated cache clearing is disabled');
        return;
    }

    const now = new Date();
    let nextClearTime = new Date(now);
    nextClearTime.setHours(config.CACHE_CLEAR_HOUR, config.CACHE_CLEAR_MINUTE, 0, 0);
    
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

async function startupCacheClearing() {
    if (!config.ENABLE_STARTUP_CACHE_CLEARING) {
        console.log('Startup cache clearing is disabled');
        return;
    }

    try {
        await performCacheClearing();
    } catch (error) {
        console.error("Failed to clear cache:", error);
        await notifyAdmin("Failed to clear cache: " + error.message).catch(console.error);
    }
}

// Function to perform cache clearing
async function performCacheClearing() {
    console.log('Starting cache clearing process...');
    await clearWhatsAppCache();
    await clearPuppeteerCache();
    console.log('Cache clearing process completed');
    await notifyAdmin("Cache clearing process completed");
}

// Function to clear WhatsApp Web cache
async function clearWhatsAppCache() {
    const cacheDir = path.join(__dirname, '.wwebjs_cache');
    
    if (await fs.access(cacheDir).then(() => true).catch(() => false)) {
        try {
            await fs.rm(cacheDir, { recursive: true, force: true });
            console.log('WhatsApp Web cache cleared successfully');
        } catch (err) {
            console.error('Error clearing WhatsApp Web cache:', err);
        }
    }
}

// Function to clear Puppeteer's cache
async function clearPuppeteerCache() {
    if (global.client && global.client.pupBrowser) {
        try {
            const pages = await global.client.pupBrowser.pages();
            for (let i = 1; i < pages.length; i++) {
                await pages[i].close();
            }
            console.log('Puppeteer cache cleared successfully');
        } catch (error) {
            console.error('Error clearing Puppeteer cache:', error);
        }
    }
}

module.exports = {
    performCacheClearing,
    scheduleCacheClearing,
    startupCacheClearing
};