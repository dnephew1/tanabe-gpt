const { config, runCompletion, saveConfig } = require('./dependencies');
const fs = require('fs').promises;
const path = require('path');

// Store user states
const userStates = new Map();

// Helper function to validate time format
function isValidTimeFormat(time) {
    const regex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return regex.test(time);
}

// Helper function to validate interval
function isValidInterval(interval) {
    const num = parseInt(interval);
    return !isNaN(num) && num >= 1 && num <= 24;
}

// Helper function to sanitize prompt text
function sanitizePrompt(text) {
    return text
        .replace(/`/g, "'")
        .replace(/\\/g, "\\\\")
        .replace(/\$/g, "\\$")
        .replace(/"/g, '\\"')
        .trim();
}

// Helper function to generate prompt template
async function generatePromptTemplate(groupInfo) {
    try {
        const prompt = config.PROMPTS.RESUMO_CONFIG.GENERATE_TEMPLATE.replace('{groupInfo}', groupInfo);
        const template = await runCompletion(prompt, 0.7, "gpt-4o-mini");
        return sanitizePrompt(template);
    } catch (error) {
        console.error('[ERROR] Failed to generate prompt template:', error);
        return config.PERIODIC_SUMMARY.defaults.prompt;
    }
}

// Helper function to get user state
function getUserState(userId) {
    return userStates.get(userId) || { state: config.COMMANDS.RESUMO_CONFIG.states.INITIAL };
}

// Helper function to set user state
function setUserState(userId, state, data = {}) {
    userStates.set(userId, { state, ...data });
}

// Helper function to clear user state
function clearUserState(userId) {
    userStates.delete(userId);
}

// Helper function to format group config for display
function formatGroupConfig(groupName, groupConfig) {
    const config = groupConfig || {};
    return `*Configuração do Grupo:* ${groupName}
• Status: ${config.enabled !== false ? 'Ativado' : 'Desativado'}
• Intervalo: ${config.intervalHours || 'Padrão (3)'} horas
• Horário Silencioso: ${config.quietTime ? `${config.quietTime.start} - ${config.quietTime.end}` : 'Padrão (21:00 - 09:00)'}
• Modelo: ${config.model || 'Padrão (gpt-4o-mini)'}
• Deletar Após: ${config.deleteAfter ? `${config.deleteAfter / 60} minutos` : 'Nunca'}`;
}

// Main handler function
async function handleResumoConfig(message) {
    const userId = message.author || message.from;
    const userState = getUserState(userId);
    const messageText = message.body.trim();
    const command = config.COMMANDS.RESUMO_CONFIG;

    try {
        switch (userState.state) {
            case command.states.INITIAL:
                if (config.PERIODIC_SUMMARY.groups && Object.keys(config.PERIODIC_SUMMARY.groups).length > 0) {
                    const groups = Object.entries(config.PERIODIC_SUMMARY.groups)
                        .map(([name, config], index) => `${index + 1}. ${name} (${config.enabled !== false ? 'Ativado' : 'Desativado'})`)
                        .join('\\n');

                    await message.reply(`*Grupos Configurados:*\\n${groups}\\n\\nEscolha uma opção:\\n1. Editar grupo existente\\n2. Criar novo grupo\\n3. Excluir grupo\\n\\nResponda com o número da opção desejada.`);
                    setUserState(userId, command.states.AWAITING_CONFIG_TYPE);
                } else {
                    await message.reply('Digite o nome *exato* do grupo que deseja configurar (incluindo maiúsculas e minúsculas):');
                    setUserState(userId, command.states.AWAITING_GROUP_NAME);
                }
                break;

            case command.states.AWAITING_CONFIG_TYPE:
                if (userState.groupName) {
                    // Handle yes/no for default config
                    if (messageText.toLowerCase() === 'sim') {
                        // Use default config
                        config.PERIODIC_SUMMARY.groups[userState.groupName] = {
                            enabled: true
                        };
                        await saveConfig();
                        await message.reply(`Configuração padrão aplicada com sucesso!\\n\\n${formatGroupConfig(userState.groupName, config.PERIODIC_SUMMARY.groups[userState.groupName])}`);
                        clearUserState(userId);
                    } else if (messageText.toLowerCase() === 'não') {
                        // Start custom config
                        await message.reply('Digite o intervalo em horas entre os resumos (1-24):');
                        setUserState(userId, command.states.AWAITING_INTERVAL, { 
                            groupName: userState.groupName,
                            config: {}
                        });
                    } else {
                        await message.reply(command.errorMessages.invalidFormat);
                    }
                } else {
                    // Handle initial menu options
                    switch (messageText) {
                        case '1': // Edit
                            await message.reply('Digite o número do grupo que deseja editar:');
                            setUserState(userId, command.states.AWAITING_EDIT_CHOICE, { groups: Object.keys(config.PERIODIC_SUMMARY.groups) });
                            break;
                        case '2': // Create
                            await message.reply('Digite o nome *exato* do novo grupo (incluindo maiúsculas e minúsculas):');
                            setUserState(userId, command.states.AWAITING_GROUP_NAME);
                            break;
                        case '3': // Delete
                            await message.reply('Digite o número do grupo que deseja excluir:');
                            setUserState(userId, command.states.AWAITING_EDIT_CHOICE, { groups: Object.keys(config.PERIODIC_SUMMARY.groups), action: 'delete' });
                            break;
                        default:
                            await message.reply(command.errorMessages.invalidFormat);
                    }
                }
                break;

            case command.states.AWAITING_GROUP_NAME:
                const chat = await message.getChat();
                const chats = await global.client.getChats();
                const groupExists = chats.some(c => c.name === messageText);

                if (!groupExists) {
                    await message.reply(command.errorMessages.invalidGroupName);
                    return;
                }

                await message.reply(`Deseja usar as configurações padrão?\\n\\n*Configurações Padrão:*\\n• Intervalo: 3 horas\\n• Horário Silencioso: 21:00 - 09:00\\n• Modelo: gpt-4o-mini\\n\\nResponda com 'sim' ou 'não':`);
                setUserState(userId, command.states.AWAITING_CONFIG_TYPE, { groupName: messageText });
                break;

            case command.states.AWAITING_INTERVAL:
                if (!isValidInterval(messageText)) {
                    await message.reply(command.errorMessages.invalidInterval);
                    return;
                }

                const interval = parseInt(messageText);
                await message.reply('Digite o horário de início do período silencioso (formato HH:MM, exemplo: 21:00):');
                setUserState(userId, command.states.AWAITING_QUIET_START, { 
                    ...userState,
                    config: { ...userState.config, intervalHours: interval }
                });
                break;

            case command.states.AWAITING_QUIET_START:
                if (!isValidTimeFormat(messageText)) {
                    await message.reply(command.errorMessages.invalidTime);
                    return;
                }

                await message.reply('Digite o horário de fim do período silencioso (formato HH:MM, exemplo: 09:00):');
                setUserState(userId, command.states.AWAITING_QUIET_END, {
                    ...userState,
                    config: { 
                        ...userState.config,
                        quietTime: { ...userState.config?.quietTime, start: messageText }
                    }
                });
                break;

            case command.states.AWAITING_QUIET_END:
                if (!isValidTimeFormat(messageText)) {
                    await message.reply(command.errorMessages.invalidTime);
                    return;
                }

                await message.reply('Descreva o objetivo e contexto do grupo para que eu possa gerar um prompt personalizado:');
                setUserState(userId, command.states.AWAITING_GROUP_INFO, {
                    ...userState,
                    config: { 
                        ...userState.config,
                        quietTime: { 
                            ...userState.config?.quietTime,
                            end: messageText
                        }
                    }
                });
                break;

            case command.states.AWAITING_GROUP_INFO:
                const generatedPrompt = await generatePromptTemplate(messageText);
                await message.reply(`*Prompt Gerado:*\\n\\n${generatedPrompt}\\n\\nEscolha uma opção:\\n1. Aceitar\\n2. Editar\\n3. Usar prompt padrão`);
                setUserState(userId, command.states.AWAITING_PROMPT_APPROVAL, {
                    ...userState,
                    generatedPrompt
                });
                break;

            case command.states.AWAITING_PROMPT_APPROVAL:
                let finalPrompt;
                switch (messageText) {
                    case '1': // Accept
                        finalPrompt = userState.generatedPrompt;
                        break;
                    case '2': // Edit
                        await message.reply('Digite o novo prompt:');
                        setUserState(userId, command.states.AWAITING_CUSTOM_PROMPT, userState);
                        return;
                    case '3': // Use default
                        finalPrompt = config.PERIODIC_SUMMARY.defaults.prompt;
                        break;
                    default:
                        await message.reply(command.errorMessages.invalidFormat);
                        return;
                }

                // Save configuration
                config.PERIODIC_SUMMARY.groups[userState.groupName] = {
                    enabled: true,
                    ...userState.config,
                    prompt: sanitizePrompt(finalPrompt)
                };

                await saveConfig();
                await message.reply(`Configuração salva com sucesso!\\n\\n${formatGroupConfig(userState.groupName, config.PERIODIC_SUMMARY.groups[userState.groupName])}`);
                clearUserState(userId);
                break;

            case command.states.AWAITING_CUSTOM_PROMPT:
                config.PERIODIC_SUMMARY.groups[userState.groupName] = {
                    enabled: true,
                    ...userState.config,
                    prompt: sanitizePrompt(messageText)
                };

                await saveConfig();
                await message.reply(`Configuração salva com sucesso!\\n\\n${formatGroupConfig(userState.groupName, config.PERIODIC_SUMMARY.groups[userState.groupName])}`);
                clearUserState(userId);
                break;

            case command.states.AWAITING_EDIT_CHOICE:
                const groups = userState.groups;
                const groupIndex = parseInt(messageText) - 1;

                if (isNaN(groupIndex) || groupIndex < 0 || groupIndex >= groups.length) {
                    await message.reply(command.errorMessages.invalidFormat);
                    return;
                }

                const selectedGroup = groups[groupIndex];

                if (userState.action === 'delete') {
                    delete config.PERIODIC_SUMMARY.groups[selectedGroup];
                    await saveConfig();
                    await message.reply(`Grupo "${selectedGroup}" removido com sucesso!`);
                    clearUserState(userId);
                } else {
                    await message.reply(`*Opções de Edição:*\\n1. Ativar/Desativar\\n2. Alterar intervalo\\n3. Alterar horário silencioso\\n4. Alterar prompt\\n\\nResponda com o número da opção:`);
                    setUserState(userId, command.states.AWAITING_EDIT_OPTION, { ...userState, selectedGroup });
                }
                break;

            case command.states.AWAITING_EDIT_OPTION:
                const groupConfig = config.PERIODIC_SUMMARY.groups[userState.selectedGroup] || {};
                
                switch (messageText) {
                    case '1': // Toggle enable/disable
                        await message.reply(`O grupo está atualmente ${groupConfig.enabled !== false ? 'ativado' : 'desativado'}.\\nDeseja ${groupConfig.enabled !== false ? 'desativar' : 'ativar'}? (sim/não)`);
                        setUserState(userId, command.states.AWAITING_ENABLE_CHOICE, userState);
                        break;
                    case '2': // Change interval
                        await message.reply('Digite o novo intervalo em horas (1-24):');
                        setUserState(userId, command.states.AWAITING_INTERVAL, { 
                            ...userState,
                            config: groupConfig
                        });
                        break;
                    case '3': // Change quiet time
                        await message.reply('Digite o novo horário de início do período silencioso (formato HH:MM):');
                        setUserState(userId, command.states.AWAITING_QUIET_START, {
                            ...userState,
                            config: groupConfig
                        });
                        break;
                    case '4': // Change prompt
                        await message.reply('Descreva o objetivo e contexto do grupo para que eu possa gerar um novo prompt:');
                        setUserState(userId, command.states.AWAITING_GROUP_INFO, {
                            ...userState,
                            config: groupConfig
                        });
                        break;
                    default:
                        await message.reply(command.errorMessages.invalidFormat);
                }
                break;

            case command.states.AWAITING_ENABLE_CHOICE:
                if (messageText.toLowerCase() === 'sim') {
                    const currentConfig = config.PERIODIC_SUMMARY.groups[userState.selectedGroup] || {};
                    config.PERIODIC_SUMMARY.groups[userState.selectedGroup] = {
                        ...currentConfig,
                        enabled: !currentConfig.enabled
                    };
                    await saveConfig();
                    await message.reply(`Grupo "${userState.selectedGroup}" ${currentConfig.enabled ? 'desativado' : 'ativado'} com sucesso!`);
                }
                clearUserState(userId);
                break;

            default:
                await message.reply(command.errorMessages.error);
                clearUserState(userId);
        }
    } catch (error) {
        console.error('[ERROR] Error in resumo config handler:', error);
        await message.reply(command.errorMessages.error);
        clearUserState(userId);
    }
}

module.exports = {
    handleResumoConfig
}; 