const path = require('path');
const fsPromises = require('fs').promises;
const config = require('../config');

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

                return `        '${name}': {\n${configLines}\n        }`;
            })
            .join(',\n');

        const periodicSummaryContent = `// periodic_summary_config.js

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

module.exports = PERIODIC_SUMMARY;`;

        await fsPromises.writeFile(configPath, periodicSummaryContent, 'utf8');
        console.log('Periodic summary configuration saved successfully');
    } catch (error) {
        console.error('Error saving periodic summary configuration:', error);
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
        console.log('Configuration saved successfully');
    } catch (error) {
        console.error('Error saving configuration:', error);
        throw error;
    }
}

module.exports = {
    saveConfig
}; 