const { config, notifyAdmin } = require('./dependencies');
const path = require('path');
const fs = require('fs').promises;

const TWITTER_COOKIES_DIR = path.join(__dirname, '.twitter_cookies');

// Function to ensure Twitter cookies directory exists
async function ensureTwitterCookiesDir() {
    try {
        await fs.access(TWITTER_COOKIES_DIR);
    } catch {
        await fs.mkdir(TWITTER_COOKIES_DIR, { recursive: true });
    }
}

// Function to save Twitter cookies
async function saveTwitterCookies(cookies) {
    await ensureTwitterCookiesDir();
    await fs.writeFile(
        path.join(TWITTER_COOKIES_DIR, 'cookies.json'),
        JSON.stringify(cookies, null, 2)
    );
}

// Function to load Twitter cookies
async function loadTwitterCookies() {
    try {
        const cookiesFile = path.join(TWITTER_COOKIES_DIR, 'cookies.json');
        const data = await fs.readFile(cookiesFile, 'utf8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

async function startupCacheClearing() {
    if (!config.ENABLE_STARTUP_CACHE_CLEARING) {
        console.log(`[LOG] [${new Date().toISOString()}] Startup cache clearing is disabled`);
        return;
    }

    try {
        await performCacheClearing();
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Failed to clear cache:`, error);
        await notifyAdmin("Failed to clear cache: " + error.message).catch(console.error);
    }
}

// Function to perform cache clearing
async function performCacheClearing() {
    // Save Twitter cookies before clearing cache
    if (global.client && global.client.pupBrowser) {
        try {
            const page = (await global.client.pupBrowser.pages())[0];
            if (page) {
                const cookies = await page.cookies();
                const twitterCookies = cookies.filter(cookie => 
                    cookie.domain.includes('twitter.com') || 
                    cookie.domain.includes('x.com')
                );
                if (twitterCookies.length > 0) {
                    await saveTwitterCookies(twitterCookies);
                }
            }
        } catch (error) {
            console.error(`[LOG] [${new Date().toISOString()}] Error saving Twitter cookies:`, error);
        }
    }

    await clearWhatsAppCache();
    await clearPuppeteerCache();
    console.log(`[LOG] [${new Date().toISOString()}] Cache clearing process completed`);

    // Restore Twitter cookies after clearing cache
    if (global.client && global.client.pupBrowser) {
        try {
            const cookies = await loadTwitterCookies();
            if (cookies) {
                const page = (await global.client.pupBrowser.pages())[0];
                if (page) {
                    await page.setCookie(...cookies);
                    console.log(`[LOG] [${new Date().toISOString()}] Twitter cookies restored successfully`);
                }
            }
        } catch (error) {
            console.error(`[LOG] [${new Date().toISOString()}] Error restoring Twitter cookies:`, error);
        }
    }
}

// Function to clear WhatsApp Web cache
async function clearWhatsAppCache() {
    const cacheDir = path.join(__dirname, '.wwebjs_cache');
    
    if (await fs.access(cacheDir).then(() => true).catch(() => false)) {
        try {
            await fs.rm(cacheDir, { recursive: true, force: true });
        } catch (err) {
            console.error(`[LOG] [${new Date().toISOString()}] Error clearing WhatsApp Web cache:`, err);
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
        } catch (error) {
            console.error(`[LOG] [${new Date().toISOString()}] Error clearing Puppeteer cache:`, error);
        }
    }
}

module.exports = {
    startupCacheClearing,
    performCacheClearing,
    saveTwitterCookies,
    loadTwitterCookies
};