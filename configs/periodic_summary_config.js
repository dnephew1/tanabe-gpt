// periodic_summary_config.js
require('dotenv').config({ path: './configs/.env' });

// Avoid circular dependency with env_mapper
let envMapper;
setTimeout(() => {
    envMapper = require('../utils/env_mapper');
}, 0);

const PERIODIC_SUMMARY = {
    defaults: {
        intervalHours: 3,
        quietTime: {
            start: '21:00',
            end: '09:00'
        },
        deleteAfter: null,
        promptPath: './prompts/periodic_summary.js'
    },
    groups: {
        [process.env.GROUP_AG]: {
            enabled: false,
            intervalHours: 1,
            quietTime: {
                start: '01:00',
                end: '01:30'
            }
        }
    }
};

/**
 * Add a new group to the periodic summary configuration
 * @param {string} groupName - The name of the group
 * @param {Object} config - The configuration for the group
 * @returns {boolean} - Whether the group was added successfully
 */
function addGroupToPeriodicSummary(groupName, config = {}) {
    // Handle dm. prefix
    let baseGroupName = groupName;
    if (groupName.startsWith('dm.')) {
        baseGroupName = groupName.substring(3);
    }
    
    // Check if group already exists
    if (PERIODIC_SUMMARY.groups[baseGroupName]) {
        return false;
    }
    
    // Add group with default config merged with provided config
    PERIODIC_SUMMARY.groups[baseGroupName] = {
        enabled: config.enabled ?? true,
        intervalHours: config.intervalHours ?? PERIODIC_SUMMARY.defaults.intervalHours,
        quietTime: {
            start: config.quietTime?.start ?? PERIODIC_SUMMARY.defaults.quietTime.start,
            end: config.quietTime?.end ?? PERIODIC_SUMMARY.defaults.quietTime.end
        },
        deleteAfter: config.deleteAfter ?? PERIODIC_SUMMARY.defaults.deleteAfter,
        promptPath: config.promptPath ?? PERIODIC_SUMMARY.defaults.promptPath
    };
    
    // If this is a new group, add it to the environment variables
    if (envMapper && !envMapper.getGroupKey(baseGroupName)) {
        // Generate abbreviation from first letters of words in group name
        const abbreviation = baseGroupName
            .split(/s+/)
            .map(word => word[0].toUpperCase())
            .join('');
        
        envMapper.addNewGroup(baseGroupName, abbreviation);
    }
    
    return true;
}

// Add the addGroupToPeriodicSummary function to the exported object
PERIODIC_SUMMARY.addGroup = addGroupToPeriodicSummary;

module.exports = PERIODIC_SUMMARY;