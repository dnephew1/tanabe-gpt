//Integrated into index.js, listener.js, runCompletion in dependencies.js
const { config, runCompletion } = require('./dependencies');
const logger = require('./logger');

// Helper function to get group config with defaults
function getGroupConfig(groupName, groupConfig) {
    const defaults = config.PERIODIC_SUMMARY.defaults;
    return {
        enabled: groupConfig?.enabled ?? true,
        intervalHours: groupConfig?.intervalHours ?? defaults.intervalHours,
        quietTime: groupConfig?.quietTime ?? defaults.quietTime,
        deleteAfter: groupConfig?.deleteAfter ?? defaults.deleteAfter,
        prompt: groupConfig?.prompt ?? defaults.prompt,
        model: groupConfig?.model ?? defaults.model
    };
}

// Helper function to check if current time is within quiet hours
function isQuietTime(quietTime) {
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 100 + currentMinute;

    const [startHour, startMinute] = quietTime.start.split(':').map(Number);
    const [endHour, endMinute] = quietTime.end.split(':').map(Number);
    const startTime = startHour * 100 + startMinute;
    const endTime = endHour * 100 + endMinute;

    // Handle cases where quiet time spans across midnight
    if (startTime > endTime) {
        return currentTime >= startTime || currentTime <= endTime;
    }
    return currentTime >= startTime && currentTime <= endTime;
}

// Main periodic summary function
async function runPeriodicSummary() {
    if (!config.PERIODIC_SUMMARY?.enabled) {
        return;
    }

    console.log('[INFO] Running periodic summary check...');
    const chats = await global.client.getChats();

    for (const [groupName, rawGroupConfig] of Object.entries(config.PERIODIC_SUMMARY.groups)) {
        const groupConfig = getGroupConfig(groupName, rawGroupConfig);
        
        if (!groupConfig.enabled) {
            continue;
        }

        const chat = chats.find(c => c.name === groupName);
        if (!chat || !chat.isGroup) {
            continue;
        }

        // Check if it's quiet time
        if (groupConfig.quietTime && isQuietTime(groupConfig.quietTime)) {
            console.log(`[INFO] Skipping summary for ${groupName} - currently in quiet time`);
            continue;
        }

        try {
            // Check for unread messages
            if (chat.unreadCount > 0) {
                // Get unread messages
                const messages = await chat.fetchMessages({ limit: chat.unreadCount });
                const validMessages = messages.filter(message => !message.fromMe && message.body.trim() !== '');

                if (validMessages.length === 0) {
                    console.log(`[INFO] No valid messages to summarize for ${groupName}`);
                    await chat.sendSeen();
                    continue;
                }

                // Format messages for the summary
                const messageTexts = await Promise.all(validMessages.map(async message => {
                    const contact = await message.getContact();
                    const name = contact.pushname || contact.name || contact.number;
                    return `>>${name}: ${message.body}.\n`;
                }));

                // Generate summary using the configured prompt and model
                const summary = await runCompletion(groupConfig.prompt + '\n\n' + messageTexts.join(' '), 1, groupConfig.model);
                
                if (summary.trim()) {
                    const response = await chat.sendMessage(summary.trim());
                    
                    // Handle auto-deletion if configured
                    if (groupConfig.deleteAfter) {
                        setTimeout(async () => {
                            try {
                                await response.delete(true);
                            } catch (error) {
                                console.error(`[ERROR] Failed to delete summary message in ${groupName}:`, error.message);
                            }
                        }, groupConfig.deleteAfter * 1000);
                    }

                    console.log(`[INFO] Summary sent to ${groupName}`);
                    await notifyAdmin(`Summary sent to ${groupName}:\n\n${summary.trim()}`);
                }

                // Mark messages as read
                await chat.sendSeen();
            } else {
                console.log(`[INFO] No unread messages in ${groupName}`);
            }
        } catch (error) {
            console.error(`[ERROR] Failed to generate summary for ${groupName}:`, error.message);
            await notifyAdmin(`Failed to generate summary for ${groupName}: ${error.message}`);
        }
    }
}

// Export the functions
module.exports = { runPeriodicSummary };