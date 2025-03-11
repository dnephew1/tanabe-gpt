const path = require('path');
const fsPromises = require('fs').promises;
const config = require('../configs');

// Avoid circular dependencies
let logger, groupManager, envMapper;
setTimeout(() => {
    logger = require('./logger');
    groupManager = require('./group_manager');
    envMapper = require('./env_mapper');
}, 0);

async function savePeriodicSummaryConfig(periodicSummaryConfig) {
    try {
        const configPath = path.join(__dirname, '..', 'configs', 'periodic_summary_config.js');
        
        // Format the groups configuration with proper indentation
        const groupsConfig = Object.entries(periodicSummaryConfig.groups || {})
            .map(([name, settings]) => {
                const defaults = periodicSummaryConfig.defaults;
                const customConfig = {};

                // Only include enabled if it's false (since default is true)
                if (settings.enabled === false) {
                    customConfig.enabled = false;
                }

                // Only include intervalHours if different from default
                if (settings.intervalHours !== undefined && settings.intervalHours !== defaults.intervalHours) {
                    customConfig.intervalHours = settings.intervalHours;
                }

                // Only include quietTime if different from default
                if (settings.quietTime) {
                    const quietTimeConfig = {};
                    if (settings.quietTime.start !== defaults.quietTime.start) {
                        quietTimeConfig.start = settings.quietTime.start;
                    }
                    if (settings.quietTime.end !== defaults.quietTime.end) {
                        quietTimeConfig.end = settings.quietTime.end;
                    }
                    if (Object.keys(quietTimeConfig).length > 0) {
                        customConfig.quietTime = quietTimeConfig;
                    }
                }

                // Only include deleteAfter if different from default
                if (settings.deleteAfter !== undefined && settings.deleteAfter !== defaults.deleteAfter) {
                    customConfig.deleteAfter = settings.deleteAfter;
                }

                // Only include prompt if it exists and is different from default
                if (settings.prompt) {
                    customConfig.prompt = settings.prompt;
                }

                // If there are no custom configs, just save enabled: true
                const configToSave = Object.keys(customConfig).length > 0 ? customConfig : { enabled: true };

                // Format the configuration
                const configLines = Object.entries(configToSave)
                    .map(([key, value]) => {
                        if (key === 'quietTime') {
                            return `            quietTime: {
                start: '${value.start}',
                end: '${value.end}'
            }`;
                        }
                        if (key === 'prompt') {
                            return `            prompt: \`${value}\``;
                        }
                        return `            ${key}: ${JSON.stringify(value)}`;
                    })
                    .join(',\n');

                // Check if the group name is in the environment variables
                // If not, add it using the group manager
                if (envMapper && !envMapper.getGroupKey(name)) {
                    // Handle dm. prefix
                    let baseGroupName = name;
                    if (name.startsWith('dm.')) {
                        baseGroupName = name.substring(3);
                    }
                    
                    // Generate abbreviation from first letters of words in group name
                    const abbreviation = baseGroupName
                        .split(/\s+/)
                        .map(word => word[0].toUpperCase())
                        .join('');
                    
                    // Add the group to environment variables
                    envMapper.addNewGroup(baseGroupName, abbreviation);
                }

                // Get the environment variable key for the group
                const groupKey = envMapper ? envMapper.getGroupKey(name) : null;
                
                // Use the environment variable in the configuration if available
                if (groupKey) {
                    return `        [process.env.${groupKey}]: {\n${configLines}\n        }`;
                } else {
                    return `        '${name}': {\n${configLines}\n        }`;
                }
            })
            .join(',\n');

        const periodicSummaryContent = `// periodic_summary_config.js
require('dotenv').config({ path: './configs/.env' });

// Avoid circular dependency with env_mapper
let envMapper;
setTimeout(() => {
    envMapper = require('../utils/env_mapper');
}, 0);

const PERIODIC_SUMMARY = {
    defaults: {
        intervalHours: ${periodicSummaryConfig.defaults.intervalHours},
        quietTime: {
            start: '${periodicSummaryConfig.defaults.quietTime.start}',
            end: '${periodicSummaryConfig.defaults.quietTime.end}'
        },
        deleteAfter: ${periodicSummaryConfig.defaults.deleteAfter === null ? 'null' : periodicSummaryConfig.defaults.deleteAfter},
        promptPath: '${periodicSummaryConfig.defaults.promptPath}'
    },
    groups: {
${groupsConfig}
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
            .split(/\s+/)
            .map(word => word[0].toUpperCase())
            .join('');
        
        envMapper.addNewGroup(baseGroupName, abbreviation);
    }
    
    return true;
}

// Add the addGroupToPeriodicSummary function to the exported object
PERIODIC_SUMMARY.addGroup = addGroupToPeriodicSummary;

module.exports = PERIODIC_SUMMARY;`;

        await fsPromises.writeFile(configPath, periodicSummaryContent, 'utf8');
        if (logger) {
            logger.debug('Periodic summary configuration saved successfully');
        } else {
            console.log('Periodic summary configuration saved successfully');
        }
    } catch (error) {
        if (logger) {
            logger.error('Error saving periodic summary configuration:', error);
        } else {
            console.error('Error saving periodic summary configuration:', error);
        }
        throw error;
    }
}

async function saveConfig() {
    try {
        // If we're saving periodic summary configuration, use the dedicated function
        if (config.PERIODIC_SUMMARY) {
            await savePeriodicSummaryConfig(config.PERIODIC_SUMMARY);
            return;
        }

        // For other changes, use the default JSON.stringify approach
        const configPath = path.join(__dirname, '..', 'config.js');
        const configContent = `// config.js - Generated ${new Date().toISOString()}

module.exports = ${JSON.stringify(config, null, 2)};`;

        await fsPromises.writeFile(configPath, configContent, 'utf8');
        if (logger) {
            logger.debug('Configuration saved successfully');
        } else {
            console.log('Configuration saved successfully');
        }
    } catch (error) {
        if (logger) {
            logger.error('Error saving configuration:', error);
        } else {
            console.error('Error saving configuration:', error);
        }
        throw error;
    }
}

module.exports = {
    saveConfig
}; 