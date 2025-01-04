// commandHandler.js

const { config, saveConfig, runCompletion } = require('./dependencies');
const { getMessageHistory } = require('./messageLogger');
const { handleCommand } = require('./commandImplementations');
const { deleteMessageAfterTimeout } = require('./commands');

// Validate config initialization
if (!config || !config.COMMANDS || !config.COMMANDS.RESUMO_CONFIG) {
    throw new Error('Configuration not properly initialized');
}

// Initialize activeSessions if it doesn't exist
if (!config.COMMANDS.RESUMO_CONFIG.activeSessions) {
    config.COMMANDS.RESUMO_CONFIG.activeSessions = {};
}

// Main command processing function
async function processCommand(message) {
    const contact = await message.getContact();
    const userId = contact.id._serialized;
    const messageBody = message.body.trim();

    // Check for active wizard session first
    if (config.COMMANDS.RESUMO_CONFIG.activeSessions[userId]) {
        const activeSession = config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];
        
        // Check for timeout (30 minutes)
        const now = Date.now();
        if (activeSession.lastActivity && (now - activeSession.lastActivity) > 30 * 60 * 1000) {
            delete config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];
            await message.reply('A sessão de configuração expirou. Por favor, inicie novamente com #ferramentaresumo');
            return true;
        }

        try {
            // Update last activity time and process response
            activeSession.lastActivity = now;
            await handleWizardResponse(message, activeSession);
            return true;
        } catch (error) {
            console.error(`Error in wizard:`, error);
            const errorMessage = await message.reply(config.COMMANDS.RESUMO_CONFIG.errorMessages.error);
            await handleAutoDelete(errorMessage, config.COMMANDS.RESUMO_CONFIG, true);
            delete config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];
            return true;
        }
    }

    // If message doesn't start with a command prefix and there's no active session, return false
    if (!messageBody.startsWith('#') && !messageBody.startsWith('@')) {
        return false;
    }

    // Check if starting a new wizard session
    if (messageBody.startsWith('#ferramentaresumo')) {
        console.log('[RESUMO_CONFIG] Starting new wizard session');
        const existingGroups = config.PERIODIC_SUMMARY?.groups && typeof config.PERIODIC_SUMMARY.groups === 'object' ? Object.keys(config.PERIODIC_SUMMARY.groups) : [];
        console.log('[RESUMO_CONFIG] Found existing groups:', existingGroups);

        config.COMMANDS.RESUMO_CONFIG.activeSessions[userId] = {
            state: config.COMMANDS.RESUMO_CONFIG.states.AWAITING_GROUP_NAME,
            data: {},
            lastActivity: Date.now()
        };

        let welcomeMessage = 'Bem-vindo ao assistente de configuração de resumos automáticos!\n\n';
        
        if (existingGroups.length > 0) {
            welcomeMessage += '*Grupos Configurados:*\n';
            existingGroups.forEach((group, index) => {
                const groupConfig = config.PERIODIC_SUMMARY.groups[group];
                const status = groupConfig.enabled !== false ? '✅' : '❌';
                welcomeMessage += `${index + 1}. ${status} ${group}\n`;
            });
            welcomeMessage += '\nSelecione um número para editar um grupo existente ou digite um novo nome de grupo para criar:';
        } else {
            welcomeMessage += 'Nenhum grupo configurado. Digite o nome *exato* do grupo que você deseja configurar:';
        }

        await message.reply(welcomeMessage);
        return true;
    }

    // Process regular commands
    const command = await findCommand(message);
    if (!command) {
        return false;
    }

    try {
        await handleCommand(message, command, messageBody.split(' '));
        return true;
    } catch (error) {
        console.error(`[ERROR] Error processing command ${command.name}:`, error.message);
        const errorMessage = await message.reply(command.errorMessages.error || 'An error occurred while processing your command.');
        await handleAutoDelete(errorMessage, command, true);
        return true;
    }
}

// Helper function to handle auto-deletion of messages
async function handleAutoDelete(message, commandConfig, isError = false) {
    const shouldDelete = isError ? 
        commandConfig.autoDelete.errorMessages : 
        commandConfig.autoDelete.commandMessages;

    if (shouldDelete) {
        await deleteMessageAfterTimeout(message, true);
    }
}

// Helper function to get prompt with group personality
async function getPromptWithContext(commandName, promptName, message, replacements = {}) {
    const chat = await message.getChat();
    const command = config.COMMANDS[commandName];
    
    // Check if the command and prompt exist
    if (!config.PROMPTS[commandName] || !config.PROMPTS[commandName][promptName]) {
        console.error(`Prompt not found: ${commandName}.${promptName}`);
        throw new Error('Prompt template not found');
    }
    
    let prompt = config.PROMPTS[commandName][promptName];

    // Add message history if command has maxLogMessages
    if (command.maxLogMessages) {
        const messageHistory = await getMessageHistory(command.maxLogMessages);
        replacements.messageHistory = messageHistory;
        replacements.maxMessages = command.maxLogMessages;
    }

    // Add group personality if enabled
    if (command.useGroupPersonality && chat.name && config.GROUP_PERSONALITIES[chat.name]) {
        replacements.groupPersonality = config.GROUP_PERSONALITIES[chat.name];
    } else {
        replacements.groupPersonality = '';
    }

    // Replace all placeholders
    for (const [key, value] of Object.entries(replacements)) {
        prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), value);
    }

    return prompt;
}

// Helper function to validate command configuration
function validateCommand(commandName, commandConfig) {
    if (!commandConfig) {
        console.error(`Invalid command configuration for ${commandName}: configuration is missing`);
        return false;
    }

    // Check required properties
    if (!commandConfig.errorMessages || typeof commandConfig.errorMessages !== 'object') {
        console.error(`[ERROR] Invalid command configuration for ${commandName}: errorMessages is missing or invalid`);
        return false;
    }

    // Check permissions if defined
    if (commandConfig.permissions) {
        if (!Array.isArray(commandConfig.permissions.allowedIn)) {
            console.error(`[ERROR] Invalid command configuration for ${commandName}: permissions.allowedIn must be an array`);
            return false;
        }
    }

    // Check prefixes if defined
    if (commandConfig.prefixes && !Array.isArray(commandConfig.prefixes)) {
        console.error(`[ERROR] Invalid command configuration for ${commandName}: prefixes must be an array`);
        return false;
    }

    // Check autoDelete if defined
    if (commandConfig.autoDelete) {
        if (typeof commandConfig.autoDelete.commandMessages !== 'boolean' || 
            typeof commandConfig.autoDelete.errorMessages !== 'boolean') {
            console.error(`[ERROR] Invalid command configuration for ${commandName}: autoDelete properties must be boolean`);
            return false;
        }
    }

    return true;
}

// Helper function to find the matching command configuration
async function findCommand(message) {
    // Handle sticker commands first
    if (message.hasMedia && message.type === 'sticker') {
        try {
            const stickerHash = message.mediaData?.fileSha256?.toString('hex') || message.stickerHash;
            if (stickerHash) {
                // Find command by sticker hash
                for (const [commandName, command] of Object.entries(config.COMMANDS)) {
                    if (command.stickerHash === stickerHash && validateCommand(commandName, command)) {
                        return { ...command, name: commandName };
                    }
                }
            }
        } catch (error) {
            console.error('[ERROR] Error processing sticker:', error);
        }
        return null;
    }

    // Handle text commands
    const messageBody = message.body;
    if (!messageBody) return null;

    // Handle tag commands
    if (messageBody.startsWith('@')) {
        const tag = messageBody.split(' ')[0].toLowerCase();
        const chat = await message.getChat();
        if (!chat.isGroup) return null;

        const tagCommand = config.COMMANDS.TAG;
        if (!tagCommand.groupTags[chat.name]) return null;

        // Check if it's a special tag or group-specific tag
        if (tagCommand.specialTags[tag] || tagCommand.groupTags[chat.name][tag]) {
            return { ...tagCommand, name: 'TAG', tag: tag };
        }
        return null;
    }

    // Handle regular commands
    if (messageBody.startsWith('#')) {
        const input = messageBody.slice(1).split(' ');
        const commandText = input[0].toLowerCase();
        const secondWord = input[1]?.toLowerCase();

        // Special case for '#ayub news'
        if (commandText === 'ayub' && secondWord === 'news') {
            const ayubNewsCommand = config.COMMANDS.AYUB_NEWS;
            return { ...ayubNewsCommand, name: 'AYUB_NEWS' };
        }

        // Check for specific command prefixes first
        for (const [commandName, command] of Object.entries(config.COMMANDS)) {
            if (command.prefixes && command.prefixes.some(prefix => {
                // Remove the # from the prefix for comparison
                const cleanPrefix = prefix.startsWith('#') ? prefix.slice(1) : prefix;
                return cleanPrefix.toLowerCase() === messageBody.slice(1).toLowerCase().split(' ')[0];
            }) && validateCommand(commandName, command)) {
                return { ...command, name: commandName };
            }
        }

        // If no specific command prefix matched, treat as CHAT_GPT
        const chatGptCommand = config.COMMANDS.CHAT_GPT;
        return { ...chatGptCommand, name: 'CHAT_GPT' };
    }

    // Handle audio messages
    if (message.hasMedia && (message.type === 'audio' || message.type === 'ptt')) {
        return { ...config.COMMANDS.AUDIO, name: 'AUDIO' };
    }

    return null;
}

// Helper function to generate command list content for a group
async function getCommandListContent(message) {
    const chat = await message.getChat();
    const contact = await message.getContact();
    const userId = contact.id._serialized;
    const isAdmin = userId === `${config.CREDENTIALS.ADMIN_NUMBER}@c.us`;
    let content = `*Comandos Disponíveis:*\n`;

    // Helper function to check if a command is available
    const isCommandAvailable = (commandConfig) => {
        if (isAdmin) return true;  // Admin has access to all commands
        if (!commandConfig.permissions) return true;
        if (commandConfig.permissions.allowedIn.includes('all')) return true;
        if (commandConfig.permissions.allowedIn.includes(userId)) return true;
        if (chat.isGroup && commandConfig.permissions.allowedIn.includes(chat.name)) return true;
        if (!chat.isGroup) {
            return commandConfig.permissions.allowedIn.some(allowedIn => 
                allowedIn.startsWith('dm.') && allowedIn.substring(3) === chat.name
            );
        }
        // Special case for RESUMO command
        if (commandConfig.name === 'RESUMO' && config.PERIODIC_SUMMARY?.enabled) {
            const periodicSummaryGroups = config.getPeriodicSummaryGroups();
            if (chat.isGroup && periodicSummaryGroups.includes(chat.name)) {
                return true;
            }
        }
        return false;
    };

    // Add available commands
    for (const [commandName, command] of Object.entries(config.COMMANDS)) {
        if (command.description && isCommandAvailable(command)) {
            const prefix = command.prefixes?.[0] || '';
            if (prefix) {
                content += `\n• ${prefix} - ${command.description}`;
            }
        }
    }

    // Add group-specific tags if in a group
    const tagCommand = config.COMMANDS.TAG;
    if (chat.isGroup && tagCommand.groupTags[chat.name]) {
        content += `\n\n*Tags Disponíveis:*`;
        
        // Add special tags
        for (const tag of Object.keys(tagCommand.specialTags)) {
            content += `\n• ${tag}`;
        }
        
        // Add group-specific tags
        for (const tag of Object.keys(tagCommand.groupTags[chat.name])) {
            content += `\n• ${tag}`;
        }
    }

    return content;
}

// Helper function to handle wizard responses
async function handleWizardResponse(message, session) {
    const userId = message.from;
    const response = message.body.toLowerCase();

    // Handle cancel option at any point
    if (['cancelar', 'cancel'].includes(response)) {
        delete config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];
        await message.reply('❌ Configuração cancelada.');
        return null;
    }

    // Handle back option at any point (except first state)
    if (['voltar', 'back'].includes(response) && session.state !== 'AWAITING_GROUP_NAME') {
        switch (session.state) {
            case 'AWAITING_CONFIG_TYPE':
                session.state = 'AWAITING_GROUP_NAME';
                await message.reply('Ok, vamos voltar.\n\nQual é o nome exato do grupo que você quer configurar?');
                break;
            case 'AWAITING_INTERVAL':
                session.state = 'AWAITING_CONFIG_TYPE';
                await message.reply('Ok, vamos voltar.\n\nComo você deseja configurar o resumo?\n\n' +
                    '1️⃣ - Usar configurações padrão\n' +
                    '2️⃣ - Personalizar configurações\n\n' +
                    'Responda com 1 ou 2.');
                break;
            case 'AWAITING_QUIET_START':
                session.state = 'AWAITING_INTERVAL';
                await message.reply('Ok, vamos voltar.\n\nDe quantas em quantas horas você quer que eu faça o resumo?\n' +
                    'Responda apenas com o número de horas (ex: 3).');
                break;
            case 'AWAITING_QUIET_END':
                session.state = 'AWAITING_QUIET_START';
                await message.reply('Ok, vamos voltar.\n\nQual o horário de início do período silencioso? (quando não deve enviar resumos)\n' +
                    'Responda no formato HH:MM (ex: 22:00).');
                break;
            case 'AWAITING_GROUP_INFO':
                session.state = 'AWAITING_QUIET_END';
                await message.reply('Ok, vamos voltar.\n\nQual o horário de fim do período silencioso?\n' +
                    'Responda no formato HH:MM (ex: 07:00).');
                break;
            case 'AWAITING_PROMPT_APPROVAL':
                session.state = 'AWAITING_GROUP_INFO';
                await message.reply('Ok, vamos voltar.\n\nDescreva os objetivos e características do grupo para eu gerar um prompt personalizado.\n' +
                    'Por exemplo: "Grupo de estudos de medicina focado em compartilhar artigos e discutir casos clínicos"');
                break;
            case 'AWAITING_CUSTOM_PROMPT':
                session.state = 'AWAITING_PROMPT_APPROVAL';
                // Re-generate and show the prompt again
                const prompt = await getPromptWithContext('RESUMO_CONFIG', 'GENERATE_TEMPLATE', message, { groupInfo: session.data.groupInfo });
                session.data.prompt = prompt;
                await message.reply('Ok, vamos voltar.\n\nEste é o prompt sugerido para o resumo:\n\n' +
                    `"${prompt}"\n\n` +
                    '1️⃣ - Usar este prompt\n' +
                    '2️⃣ - Criar meu próprio prompt\n\n' +
                    'Responda com 1 ou 2.');
                break;
        }
        session.lastActivity = Date.now();
        return session;
    }

    try {
        switch (session.state) {
            case 'AWAITING_GROUP_NAME':
                // Check if the response is a number (selecting existing group)
                const existingGroups = config.PERIODIC_SUMMARY?.groups && typeof config.PERIODIC_SUMMARY.groups === 'object' ? Object.keys(config.PERIODIC_SUMMARY.groups) : [];
                const selectedIndex = parseInt(response) - 1;
                
                if (!isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex < existingGroups.length) {
                    // User selected an existing group
                    const selectedGroup = existingGroups[selectedIndex];
                    const groupConfig = config.PERIODIC_SUMMARY.groups[selectedGroup];
                    
                    session.data.groupName = selectedGroup;
                    session.state = 'AWAITING_EDIT_OPTION';
                    session.lastActivity = Date.now();

                    await message.reply(
                        `*Grupo selecionado:* ${selectedGroup}\n\n` +
                        '*Configurações atuais:*\n' +
                        `1. Status: ${groupConfig.enabled !== false ? '✅ Ativado' : '❌ Desativado'}\n` +
                        `2. Intervalo: ${groupConfig.intervalHours || config.PERIODIC_SUMMARY.defaults.intervalHours} horas\n` +
                        `3. Período silencioso: ${groupConfig.quietTime?.start || config.PERIODIC_SUMMARY.defaults.quietTime.start} até ${groupConfig.quietTime?.end || config.PERIODIC_SUMMARY.defaults.quietTime.end}\n` +
                        `4. Prompt:\n${groupConfig.prompt || config.PERIODIC_SUMMARY.defaults.prompt}\n\n` +
                        '*Escolha uma opção para editar ou 5 para excluir o grupo.*\n\n' +
                        'Responda com o número da opção desejada.'
                    );
                    return session;
                }

                // Don't accept responses that start with command prefixes
                if (response.startsWith('#') || response.startsWith('@')) {
                    await message.reply('❌ Por favor, envie apenas o nome do grupo, sem prefixos de comando (#, @).\n\n' +
                        'Digite "cancelar" para cancelar a configuração.');
                    return session;
                }

                // Store the group name and move to next state
                session.data.groupName = response;
                session.state = 'AWAITING_CONFIG_TYPE';
                session.lastActivity = Date.now();

                // Send options for configuration
                await message.reply(`✅ Grupo selecionado: "${response}"\n\n` +
                    'Como você deseja configurar o resumo?\n\n' +
                    '1️⃣ - Usar configurações padrão\n' +
                    '2️⃣ - Personalizar configurações\n\n' +
                    'Responda com 1 ou 2.\n\n' +
                    'Digite "voltar" para selecionar outro grupo ou "cancelar" para cancelar a configuração.');
                break;

            case 'AWAITING_EDIT_OPTION':
                const option = parseInt(response);
                if (isNaN(option) || option < 1 || option > 5) {
                    await message.reply('❌ Por favor, escolha uma opção válida (1-5).');
                    return session;
                }

                const currentConfig = config.PERIODIC_SUMMARY.groups[session.data.groupName] || {};

                switch (option) {
                    case 1: // Toggle enable/disable
                        currentConfig.enabled = !currentConfig.enabled;
                        config.PERIODIC_SUMMARY.groups[session.data.groupName] = currentConfig;
                        await saveConfig();
                        await message.reply(`✅ Grupo ${currentConfig.enabled ? 'ativado' : 'desativado'} com sucesso!`);
                        delete config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];
                        break;
                    case 2: // Edit interval
                        session.state = 'AWAITING_INTERVAL';
                        session.data.editing = true;
                        await message.reply(
                            'Digite o novo intervalo em horas (1-24):\n\n' +
                            'Digite "voltar" para retornar ao menu anterior ou "cancelar" para cancelar.'
                        );
                        break;
                    case 3: // Edit quiet time
                        session.state = 'AWAITING_QUIET_START';
                        session.data.editing = true;
                        await message.reply(
                            'Digite o novo horário de início do período silencioso (formato HH:MM, exemplo: 21:00):\n\n' +
                            'Digite "voltar" para retornar ao menu anterior ou "cancelar" para cancelar.'
                        );
                        break;
                    case 4: // Edit prompt
                        session.state = 'AWAITING_GROUP_INFO';
                        session.data.editing = true;
                        await message.reply(
                            'Descreva o objetivo e contexto do grupo para gerar um novo prompt:\n\n' +
                            'Digite "voltar" para retornar ao menu anterior ou "cancelar" para cancelar.'
                        );
                        break;
                    case 5: // Delete group
                        session.state = 'AWAITING_DELETE_CONFIRM';
                        await message.reply(
                            `⚠️ Tem certeza que deseja excluir a configuração do grupo "${session.data.groupName}"?\n\n` +
                            'Digite *sim* para confirmar ou *não* para cancelar.'
                        );
                        break;
                }
                break;

            case 'AWAITING_DELETE_CONFIRM':
                if (['sim', 'yes', 's', 'y'].includes(response)) {
                    delete config.PERIODIC_SUMMARY.groups[session.data.groupName];
                    await saveConfig();
                    await message.reply('✅ Grupo excluído com sucesso!');
                } else {
                    await message.reply('❌ Exclusão cancelada.');
                }
                delete config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];
                break;

            case 'AWAITING_INTERVAL':
                const interval = parseInt(response);
                if (isNaN(interval) || interval < 1 || interval > 24) {
                    await message.reply('❌ Por favor, envie um número válido entre 1 e 24.\n\n' +
                        'Digite "voltar" para mudar a configuração ou "cancelar" para cancelar.');
                    return session;
                }

                session.data.intervalHours = interval;
                session.state = 'AWAITING_QUIET_START';
                session.lastActivity = Date.now();

                await message.reply(
                    'Qual o horário de início do período silencioso? (quando não deve enviar resumos)\n' +
                    'Responda no formato HH:MM (ex: 22:00).\n\n' +
                    'Digite "voltar" para mudar o intervalo ou "cancelar" para cancelar.'
                );
                break;

            case 'AWAITING_QUIET_START':
                if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(response)) {
                    await message.reply('❌ Por favor, envie um horário válido no formato HH:MM (ex: 22:00).\n\n' +
                        'Digite "voltar" para mudar o intervalo ou "cancelar" para cancelar.');
                    return session;
                }

                session.data.quietTime = { start: response };
                session.state = 'AWAITING_QUIET_END';
                session.lastActivity = Date.now();

                await message.reply(
                    'Qual o horário de fim do período silencioso?\n' +
                    'Responda no formato HH:MM (ex: 07:00).\n\n' +
                    'Digite "voltar" para mudar o horário de início ou "cancelar" para cancelar.'
                );
                break;

            case 'AWAITING_QUIET_END':
                if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(response)) {
                    await message.reply('❌ Por favor, envie um horário válido no formato HH:MM (ex: 07:00).\n\n' +
                        'Digite "voltar" para mudar o horário de início ou "cancelar" para cancelar.');
                    return session;
                }

                session.data.quietTime.end = response;
                session.state = 'AWAITING_AUTO_DELETE_CHOICE';
                session.lastActivity = Date.now();

                await message.reply(
                    'Você deseja que os resumos sejam automaticamente excluídos após um determinado tempo?\n\n' +
                    'Responda com *sim* ou *não*.\n\n' +
                    'Digite "voltar" para mudar o horário silencioso ou "cancelar" para cancelar.'
                );
                break;

            case 'AWAITING_AUTO_DELETE_CHOICE':
                if (!['sim', 'yes', 's', 'y', 'nao', 'não', 'no', 'n'].includes(response.toLowerCase())) {
                    await message.reply('❌ Por favor, responda apenas com *sim* ou *não*.\n\n' +
                        'Digite "voltar" para mudar o horário silencioso ou "cancelar" para cancelar.');
                    return session;
                }

                if (['sim', 'yes', 's', 'y'].includes(response.toLowerCase())) {
                    session.state = 'AWAITING_DELETE_AFTER';
                    session.lastActivity = Date.now();

                    await message.reply(
                        'Digite após quantos minutos os resumos devem ser excluídos:\n\n' +
                        'Digite "voltar" para mudar sua escolha ou "cancelar" para cancelar.'
                    );
                } else {
                    session.data.deleteAfter = null;
                    session.state = 'AWAITING_GROUP_INFO';
                    session.lastActivity = Date.now();

                    await message.reply(
                        'Descreva os objetivos e características do grupo para eu gerar um prompt personalizado.\n' +
                        'Por exemplo: "Grupo de estudos de medicina focado em compartilhar artigos e discutir casos clínicos"\n\n' +
                        'Digite "voltar" para mudar sua escolha ou "cancelar" para cancelar.'
                    );
                }
                break;

            case 'AWAITING_DELETE_AFTER':
                const deleteAfter = parseInt(response);
                if (isNaN(deleteAfter) || deleteAfter < 1) {
                    await message.reply('❌ Por favor, envie um número válido de minutos.\n\n' +
                        'Digite "voltar" para mudar sua escolha ou "cancelar" para cancelar.');
                    return session;
                }

                session.data.deleteAfter = deleteAfter;
                session.state = 'AWAITING_GROUP_INFO';
                session.lastActivity = Date.now();

                await message.reply(
                    'Descreva os objetivos e características do grupo para eu gerar um prompt personalizado.\n' +
                    'Por exemplo: "Grupo de estudos de medicina focado em compartilhar artigos e discutir casos clínicos"\n\n' +
                    'Digite "voltar" para mudar o tempo de auto-exclusão ou "cancelar" para cancelar.'
                );
                break;

            case 'AWAITING_GROUP_INFO':
                session.data.groupInfo = response;
                // Generate prompt based on group info using ChatGPT
                const templatePrompt = await getPromptWithContext('RESUMO_CONFIG', 'GENERATE_TEMPLATE', message, { groupInfo: response });
                const generatedPrompt = await runCompletion(templatePrompt, 0.7);
                session.data.prompt = generatedPrompt;
                session.state = 'AWAITING_PROMPT_APPROVAL';
                session.lastActivity = Date.now();

                await message.reply(
                    'Este é o prompt sugerido para o resumo:\n\n' +
                    `"${generatedPrompt}"\n\n` +
                    '1️⃣ - Usar este prompt\n' +
                    '2️⃣ - Criar meu próprio prompt\n\n' +
                    'Responda com 1 ou 2.\n\n' +
                    'Digite "voltar" para mudar a descrição do grupo ou "cancelar" para cancelar.'
                );
                break;

            case 'AWAITING_PROMPT_APPROVAL':
                if (!['1', '2'].includes(response)) {
                    await message.reply('❌ Por favor, responda apenas com 1 (usar prompt sugerido) ou 2 (criar próprio).\n\n' +
                        'Digite "voltar" para mudar a descrição do grupo ou "cancelar" para cancelar.');
                    return session;
                }

                if (response === '1') {
                    session.state = 'AWAITING_CONFIRMATION';
                    session.lastActivity = Date.now();

                    // Show final summary
                    if (session.data.useDefaults) {
                        const defaultSettings = config.PERIODIC_SUMMARY.defaults;
                        await message.reply(
                            '📋 *Resumo das configurações:*\n\n' +
                            `• Grupo: ${session.data.groupName}\n` +
                            `• Intervalo: ${defaultSettings.intervalHours} horas\n` +
                            `• Horário silencioso: ${defaultSettings.quietTime.start} até ${defaultSettings.quietTime.end}\n` +
                            `• Modelo: ${defaultSettings.model}\n` +
                            `• Prompt: "${session.data.prompt}"\n\n` +
                            'Confirma estas configurações?\n' +
                            'Responda com *sim* ou *não*.\n\n' +
                            'Digite "voltar" para mudar o prompt ou "cancelar" para cancelar.'
                        );
                    } else {
                        await message.reply(
                            '📋 *Resumo das configurações:*\n\n' +
                            `• Grupo: ${session.data.groupName}\n` +
                            `• Intervalo: ${session.data.intervalHours} horas\n` +
                            `• Horário silencioso: ${session.data.quietTime.start} até ${session.data.quietTime.end}\n` +
                            `• Modelo: ${config.PERIODIC_SUMMARY.defaults.model}\n` +
                            `• Prompt: "${session.data.prompt}"\n\n` +
                            'Confirma estas configurações?\n' +
                            'Responda com *sim* ou *não*.\n\n' +
                            'Digite "voltar" para mudar o prompt ou "cancelar" para cancelar.'
                        );
                    }
                } else {
                    session.state = 'AWAITING_CUSTOM_PROMPT';
                    session.lastActivity = Date.now();

                    await message.reply(
                        'Digite o prompt personalizado que você quer usar para os resumos.\n\n' +
                        'Digite "voltar" para usar o prompt sugerido ou "cancelar" para cancelar.'
                    );
                }
                break;

            case 'AWAITING_CUSTOM_PROMPT':
                session.data.prompt = response;
                session.state = 'AWAITING_CONFIRMATION';
                session.lastActivity = Date.now();

                // Show final summary with custom prompt
                if (session.data.useDefaults) {
                    const defaultSettings = config.PERIODIC_SUMMARY.defaults;
                    const autoDeleteText = defaultSettings.deleteAfter === null ? 
                        'Não' : 
                        `Sim, após ${defaultSettings.deleteAfter} minutos`;

                    await message.reply(
                        '📋 *Resumo das configurações:*\n\n' +
                        `• Grupo: ${session.data.groupName}\n` +
                        `• Intervalo: ${defaultSettings.intervalHours} horas\n` +
                        `• Horário silencioso: ${defaultSettings.quietTime.start} até ${defaultSettings.quietTime.end}\n` +
                        `• Auto-exclusão: ${autoDeleteText}\n` +
                        `• Prompt: "${session.data.prompt}"\n\n` +
                        'Confirma estas configurações?\n' +
                        'Responda com *sim* ou *não*.\n\n' +
                        'Digite "voltar" para editar o prompt ou "cancelar" para cancelar.'
                    );
                } else {
                    const autoDeleteText = session.data.deleteAfter === null ? 
                        'Não' : 
                        `Sim, após ${session.data.deleteAfter} minutos`;

                    await message.reply(
                        '📋 *Resumo das configurações:*\n\n' +
                        `• Grupo: ${session.data.groupName}\n` +
                        `• Intervalo: ${session.data.intervalHours} horas\n` +
                        `• Horário silencioso: ${session.data.quietTime.start} até ${session.data.quietTime.end}\n` +
                        `• Auto-exclusão: ${autoDeleteText}\n` +
                        `• Prompt: "${session.data.prompt}"\n\n` +
                        'Confirma estas configurações?\n' +
                        'Responda com *sim* ou *não*.\n\n' +
                        'Digite "voltar" para editar o prompt ou "cancelar" para cancelar.'
                    );
                }
                break;

            case 'AWAITING_CONFIRMATION':
                if (['sim', 'yes', 's', 'y'].includes(response)) {
                    // Enable periodic summaries if not already enabled
                    if (!config.PERIODIC_SUMMARY.enabled) {
                        config.PERIODIC_SUMMARY.enabled = true;
                    }

                    // Save configuration
                    if (session.data.useDefaults) {
                        config.PERIODIC_SUMMARY.groups[session.data.groupName] = {
                            enabled: true,
                            intervalHours: config.PERIODIC_SUMMARY.defaults.intervalHours,
                            quietTime: {
                                start: config.PERIODIC_SUMMARY.defaults.quietTime.start,
                                end: config.PERIODIC_SUMMARY.defaults.quietTime.end
                            },
                            deleteAfter: config.PERIODIC_SUMMARY.defaults.deleteAfter,
                            prompt: config.PERIODIC_SUMMARY.defaults.prompt
                        };
                    } else {
                        config.PERIODIC_SUMMARY.groups[session.data.groupName] = {
                            enabled: true,
                            intervalHours: session.data.intervalHours,
                            quietTime: session.data.quietTime,
                            deleteAfter: session.data.deleteAfter,
                            prompt: session.data.prompt
                        };
                    }
                    
                    // Save configuration to file
                    await saveConfig();
                    
                    // Clean up session
                    delete config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];
                    
                    await message.reply('✅ Configuração salva com sucesso! O resumo periódico está ativado para este grupo.');
                } else if (['nao', 'não', 'no', 'n'].includes(response)) {
                    // Cancel configuration
                    delete config.COMMANDS.RESUMO_CONFIG.activeSessions[userId];
                    await message.reply('❌ Configuração cancelada.');
                } else {
                    await message.reply('❌ Por favor, responda apenas com *sim* ou *não*.\n\n' +
                        'Digite "voltar" para revisar as configurações ou "cancelar" para cancelar.');
                }
                break;

            case 'AWAITING_CONFIG_TYPE':
                if (!['1', '2'].includes(response)) {
                    await message.reply('❌ Por favor, responda apenas com 1 (configurações padrão) ou 2 (personalizar).\n\n' +
                        'Digite "voltar" para mudar o grupo ou "cancelar" para cancelar.');
                    return session;
                }

                if (response === '1') {
                    // Use default settings
                    session.data.useDefaults = true;
                    session.state = 'AWAITING_CONFIRMATION';
                    session.lastActivity = Date.now();
                    session.data.prompt = config.PERIODIC_SUMMARY.defaults.prompt;

                    const autoDeleteText = config.PERIODIC_SUMMARY.defaults.deleteAfter === null ? 
                        'Não' : 
                        `Sim, após ${config.PERIODIC_SUMMARY.defaults.deleteAfter} minutos`;

                    await message.reply(
                        '📋 *Resumo das configurações padrão:*\n\n' +
                        `• Grupo: ${session.data.groupName}\n` +
                        `• Intervalo: ${config.PERIODIC_SUMMARY.defaults.intervalHours} horas\n` +
                        `• Horário silencioso: ${config.PERIODIC_SUMMARY.defaults.quietTime.start} até ${config.PERIODIC_SUMMARY.defaults.quietTime.end}\n` +
                        `• Auto-exclusão: ${autoDeleteText}\n` +
                        `• Prompt: "${config.PERIODIC_SUMMARY.defaults.prompt}"\n\n` +
                        'Confirma estas configurações?\n' +
                        'Responda com *sim* ou *não*.\n\n' +
                        'Digite "voltar" para mudar a configuração ou "cancelar" para cancelar.'
                    );
                } else {
                    // Custom settings
                    session.data.useDefaults = false;
                    session.state = 'AWAITING_INTERVAL';
                    session.lastActivity = Date.now();

                    await message.reply(
                        'Digite o intervalo desejado entre os resumos (em horas, entre 1 e 24):\n\n' +
                        'Digite "voltar" para mudar a configuração ou "cancelar" para cancelar.'
                    );
                }
                break;
        }
    } catch (error) {
        console.error('Error handling wizard response:', error);
        await message.reply('❌ Ocorreu um erro ao processar sua resposta. Por favor, tente novamente.\n\n' +
            'Digite "cancelar" para cancelar a configuração.');
    }

    return session;
}

// Export the functions
module.exports = {
    processCommand,
    getPromptWithContext,
    handleAutoDelete,
    getCommandListContent,
}; 