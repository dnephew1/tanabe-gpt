//Integrated into index.js, listener.js, runCompletion in dependencies.js
const { config, notifyAdmin, runCompletion } = require('./dependencies');

async function runPeriodicSummary() {
    console.log('Running periodic summary...');
    const chats = await client.getChats();
    for (const chat of chats) {
        if (chat.isGroup && chat.name === config.GROUP2_NAME) {
            if (chat.unreadCount > 0) {
                const messages = await chat.fetchMessages({ limit: chat.unreadCount });
                const messageTexts = (await Promise.all(messages.map(async message => {
                    const contact = await message.getContact();
                    const name = contact.pushname || contact.name || contact.number;
                    return `>>${name}: ${message.body}.\n`;
                }))).join(' ');

                if (messageTexts) {
                    const summary = await runCompletion(messageTexts, 2);
                    if (summary.trim() !== "Não houve doações ou pedidos nas últimas 3 horas.") {
                        await chat.sendMessage(summary);
                        await notifyAdmin(`Summary sent to Group 2: ${summary}`);
                    } else {
                        await notifyAdmin("No summary sent to Group 2 (no donations or requests)");
                    }
                }

                // Mark messages as read
                await chat.sendSeen();
            } else {
                await notifyAdmin("No unread messages in Group 2, summary not sent");
            }
        }
    }
}

// handleCorrenteResumoCommand function
async function handleCorrenteResumoCommand(message, input) {
    console.log('handleCorrenteResumoCommand activated');
    const chat = await message.getChat();

    const parts = message.body ? message.body.split(' ') : input;
    let limit = parseInt(parts[1]) || 0;

    let messages;
    if (isNaN(limit) || limit <= 0) {
        messages = await chat.fetchMessages({ limit: 500 });
        const lastMessage = messages[messages.length - 2];
        const lastMessageTimestamp = lastMessage.timestamp;
        const threeHoursBeforeLastMessageTimestamp = lastMessageTimestamp - 10800;
        messages = messages.slice(0, -1).filter(message => (
            message.timestamp > threeHoursBeforeLastMessageTimestamp &&
            !message.fromMe &&
            message.body.trim() !== ''
        ));
    } else {
        messages = await chat.fetchMessages({ limit: limit + 1 });
        messages = messages.slice(0, -1).filter(message => (
            !message.fromMe &&
            message.body.trim() !== ''
        ));
    }

    const messageTexts = await Promise.all(messages.map(async message => {
        const contact = await message.getContact();
        const name = contact.pushname || contact.name || contact.number;
        return `>>${name}: ${message.body}.\n`;
    }));

    const result = await runCompletion(messageTexts.join(' '), 2);
    
    if (result.trim()) {
        await message.reply(result.trim());
        
        // Notify admin about the summary
        if (message.getContact) {
            const contact = await message.getContact();
            const userName = contact.pushname || contact.name || contact.number;
            await notifyAdmin(`Summary generated for ${userName} in ${chat.name}. Summary:\n\n${result.trim()}`);
        } else {
            await notifyAdmin(`Periodic summary generated for ${chat.name}. Summary:\n\n${result.trim()}`);
        }
        
        return result.trim(); // Return the summary
    } else {
        // Notify admin that no summary was generated
        await notifyAdmin(`No summary was generated for ${chat.name} (no content to summarize).`);
    }
    
    return null; // Return null if no summary was generated
}

module.exports = { runPeriodicSummary, handleCorrenteResumoCommand };