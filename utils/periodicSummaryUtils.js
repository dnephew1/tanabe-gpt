// periodicSummaryUtils.js

let config;
setTimeout(() => {
    config = require('../configs');
}, 0);

// Helper function to get all groups with periodic summaries enabled
function getPeriodicSummaryGroups(configObj) {
    if (!configObj?.PERIODIC_SUMMARY?.groups) return [];
    return Object.entries(configObj.PERIODIC_SUMMARY.groups)
        .filter(([_, groupConfig]) => groupConfig?.enabled !== false)
        .map(([name]) => name);
}

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
    if (!config) return false;
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

function getNextSummaryInfo() {
    if (!config) return null;
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
    if (!config) return;
    const logger = require('../logger');
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

    logger.summary(`Next summary scheduled for ${group} at ${nextValidTime.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (interval: ${interval}h)`);

    // Schedule the next summary
    setTimeout(async () => {
        try {
            logger.summary(`Running scheduled summary for group ${group}`);
            const { runPeriodicSummary } = require('../commands/periodicSummary');
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

module.exports = {
    getPeriodicSummaryGroups,
    getNextSummaryInfo,
    scheduleNextSummary
}; 