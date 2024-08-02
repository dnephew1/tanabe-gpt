const { config, notifyAdmin } = require('./dependencies');
const { performCacheClearing } = require('./commands');

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

module.exports = {
    scheduleCacheClearing,
    startupCacheClearing
};