const { config, notifyAdmin } = require('./dependencies');
const { handleCorrenteResumoCommand } = require('./commands');

async function runPeriodicSummary() {
    console.log('Running periodic summary...');
    try {
        const chats = await global.client.getChats();
        let chat;
        for (const c of chats) {
            if (c.isGroup && c.name === config.GROUP2_NAME) {
                chat = c;
                break;
            }
        }

        if (chat) {
            if (chat.unreadCount > 0) {
                console.log("Generating periodic summary for Group 2");
                const summary = await handleCorrenteResumoCommand({ chat: chat, reply: chat.sendMessage.bind(chat) }, ['#resumo']);
                
                if (summary && summary.trim() !== "Não houve doações ou pedidos nas últimas 3 horas.") {
                    await chat.sendMessage(summary);
                    await notifyAdmin(`Periodic summary sent to Group 2:\n\n${summary}`);
                } else {
                    await notifyAdmin("No periodic summary was sent to Group 2 (no content to summarize).");
                }

                // Mark messages as read
                await chat.sendSeen();
            } else {
                await notifyAdmin("No unread messages in Group 2, summary not sent");
            }
        } else {
            console.log("Group 2 chat not found");
            await notifyAdmin("Periodic summary not sent: Group 2 chat not found.");
        }
    } catch (error) {
        console.error('Error during periodic summary:', error);
        await notifyAdmin(`Error during periodic summary: ${error.message}`);
    }
}

module.exports = { runPeriodicSummary };