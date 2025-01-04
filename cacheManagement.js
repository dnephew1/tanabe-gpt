const fs = require('fs').promises;
const path = require('path');
const { config } = require('./dependencies');

// Cache directories to clear
const CACHE_DIRS = [
    'temp',
    'cache',
    'downloads'
];

/**
 * Clears all cache directories
 */
async function performCacheClearing() {
    for (const dir of CACHE_DIRS) {
        const dirPath = path.join(__dirname, dir);
        try {
            const files = await fs.readdir(dirPath);
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                try {
                    const stats = await fs.stat(filePath);
                    if (stats.isFile()) {
                        await fs.unlink(filePath);
                    }
                } catch (error) {
                    console.error(`Error deleting file ${filePath}:`, error.message);
                }
            }
            console.log(`Cleared cache directory: ${dir}`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`Error clearing cache directory ${dir}:`, error.message);
            }
        }
    }
}

module.exports = {
    performCacheClearing
};