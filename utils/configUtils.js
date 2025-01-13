const path = require('path');
const fsPromises = require('fs').promises;
const config = require('../config');

async function saveConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'config.js');
        
        // Special handling for PERIODIC_SUMMARY section
        if (config.PERIODIC_SUMMARY) {
            // Format the groups configuration with proper indentation, only including non-default values
            const groupsConfig = Object.entries(config.PERIODIC_SUMMARY.groups || {})
                .map(([name, settings]) => {
                    const defaults = config.PERIODIC_SUMMARY.defaults;
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
                                return `                        quietTime: {
                            ${Object.entries(value).map(([k, v]) => `${k}: '${v}'`).join(',\n                            ')}
                        }`;
                            }
                            if (key === 'prompt') {
                                return `                        prompt: \`${value}\``;
                            }
                            return `                        ${key}: ${JSON.stringify(value)}`;
                        })
                        .join(',\n');

                    return `        '${name}': {\n${configLines}\n                    }`;
                })
                .join(',\n');

            const periodicSummarySection = `const PERIODIC_SUMMARY = {
    defaults: {
        intervalHours: ${config.PERIODIC_SUMMARY.defaults.intervalHours},
        quietTime: {
            start: '${config.PERIODIC_SUMMARY.defaults.quietTime.start}',
            end: '${config.PERIODIC_SUMMARY.defaults.quietTime.end}'
        },
        deleteAfter: ${config.PERIODIC_SUMMARY.defaults.deleteAfter === null ? 'null' : config.PERIODIC_SUMMARY.defaults.deleteAfter},
        promptPath: '${config.PERIODIC_SUMMARY.defaults.promptPath}'
    },
    groups: {
${groupsConfig}
    }
};`;

            // Read the current file content
            const currentContent = await fsPromises.readFile(configPath, 'utf8');
            
            // Replace the PERIODIC_SUMMARY section
            const updatedContent = currentContent.replace(
                /const\s+PERIODIC_SUMMARY\s*=\s*{[^]*?};/s,
                periodicSummarySection
            );
            
            // Write the updated content back to the file
            await fsPromises.writeFile(configPath, updatedContent, 'utf8');
            console.log('Configuration saved successfully');
            return;
        }

        // For other changes, use the default JSON.stringify approach
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