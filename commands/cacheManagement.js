const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

// Cache directories to clear
const CACHE_DIRS = [
    '.wwebjs_cache'
];

/**
 * Clears WhatsApp Web.js and Puppeteer caches while preserving authentication
 */
async function performCacheClearing() {
    let clearedFiles = 0;

    for (const dir of CACHE_DIRS) {
        const dirPath = path.join(__dirname, '..', dir);
        try {
            const files = await fs.readdir(dirPath);
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                try {
                    const stats = await fs.stat(filePath);
                    // Skip auth files
                    if (file.includes('session') || file.includes('auth')) {
                        continue;
                    }
                    if (stats.isFile()) {
                        await fs.unlink(filePath);
                        clearedFiles++;
                    }
                } catch (error) {
                    logger.error(`Error deleting cache file ${filePath}:`, error);
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`Error accessing cache directory ${dir}:`, error);
            }
        }
    }

    return { clearedFiles };
}

module.exports = {
    performCacheClearing
}; 