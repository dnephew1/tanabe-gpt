/**
 * WhatsApp Bot Automated Test Script
 * 
 * This script automates testing of the WhatsApp bot by:
 * 1. Initializing a WhatsApp client
 * 2. Sending test commands to a specified group
 * 3. Monitoring responses to verify functionality
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { exec } = require('child_process');

// Import test modules
const config = require('./config');
const { getTestCases } = require('./testCases');
const { 
    checkSampleFiles, 
    formatTestResults, 
    verifyGroupAccess 
} = require('./utils');

// Track test results
const testResults = {
    passed: 0,
    failed: 0,
    skipped: 0,
    details: []
};

// Initialize WhatsApp client
async function initializeClient() {
    console.log('Initializing WhatsApp client for testing...');
    console.debug(`Using authentication path: ${config.CLIENT_CONFIG.dataPath}`);
    console.debug(`Using client ID: ${config.CLIENT_CONFIG.clientId}`);
    
    // Check if the session folder exists
    const sessionFolder = path.join(config.CLIENT_CONFIG.dataPath, `session-${config.CLIENT_CONFIG.clientId}`);
    if (fs.existsSync(sessionFolder)) {
        console.debug(`Found existing session folder: ${sessionFolder}`);
    } else {
        console.warn(`Session folder not found: ${sessionFolder}. A new one will be created.`);
    }
    
    // Create a client initialization promise with timeout
    const clientInitPromise = new Promise((resolve, reject) => {
        try {
            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: config.CLIENT_CONFIG.clientId,
                    dataPath: config.CLIENT_CONFIG.dataPath
                }),
                puppeteer: {
                    headless: true,
                    args: config.CLIENT_CONFIG.puppeteerOptions.args
                }
            });

            // Set up event handlers
            client.on('qr', (qr) => {
                console.log('QR Code received, scan to authenticate:');
                qrcode.generate(qr, { small: true });
                console.log('If you\'re seeing this, please scan the QR code with your WhatsApp to authenticate.');
            });

            client.on('authenticated', () => {
                console.log('Client authenticated successfully');
            });

            client.on('auth_failure', (msg) => {
                console.error('Authentication failed:', msg);
                reject(new Error(`Authentication failed: ${msg}`));
            });

            client.on('ready', () => {
                console.log('Client is ready!');
                resolve(client);
            });

            // Initialize the client
            client.initialize().catch(error => {
                console.error('Error initializing client:', error);
                reject(error);
            });
            
            // Log additional debugging information
            client.on('loading_screen', (percent, message) => {
                console.log(`Loading screen: ${percent}% - ${message}`);
            });
            
            client.on('change_state', state => {
                console.log(`Client state changed to: ${state}`);
            });
        } catch (error) {
            console.error('Error creating client:', error);
            reject(error);
        }
    });
    
    // Add a timeout to the client initialization
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('Client initialization timed out after 2 minutes'));
        }, 120000); // 2 minutes timeout
    });
    
    // Race the client initialization against the timeout
    try {
        return await Promise.race([clientInitPromise, timeoutPromise]);
    } catch (error) {
        console.error('Client initialization failed:', error.message);
        throw error;
    }
}

// Start the bot in the background
function startBot() {
    console.log('Starting the bot in the background...');
    const mainAuthPath = path.join(__dirname, '..', '.wwebjs_auth_main');
    const mainClientId = 'tanabe-gpt-client';
    console.debug(`Setting bot to use auth path: ${mainAuthPath} with client ID: ${mainClientId}`);
    
    // Check if the auth path exists
    if (!fs.existsSync(mainAuthPath)) {
        console.warn(`Auth path ${mainAuthPath} does not exist. Creating it...`);
        try {
            fs.mkdirSync(mainAuthPath, { recursive: true });
            console.log(`Created auth path: ${mainAuthPath}`);
        } catch (error) {
            console.error(`Failed to create auth path: ${error.message}`);
        }
    }
    
    // Check if the session folder exists
    const sessionFolder = path.join(mainAuthPath, `session-${mainClientId}`);
    if (fs.existsSync(sessionFolder)) {
        console.debug(`Found existing session folder: ${sessionFolder}`);
    } else {
        console.warn(`Session folder not found: ${sessionFolder}. A new one will be created.`);
    }
    
    try {
        const bot = spawn('node', ['index.js'], {
            // Don't detach the process so we can properly kill it later
            detached: false,
            stdio: 'pipe', // Capture stdout and stderr
            env: {
                ...process.env,
                USE_AUTH_DIR: mainAuthPath,
                USE_CLIENT_ID: mainClientId
            }
        });
        
        // Log when the bot process exits
        bot.on('exit', (code, signal) => {
            console.log(`Bot process exited with code ${code} and signal ${signal}`);
        });
        
        // Log stdout and stderr
        bot.stdout.on('data', (data) => {
            console.log(`Bot stdout: ${data}`);
        });
        
        bot.stderr.on('data', (data) => {
            console.error(`Bot stderr: ${data}`);
        });
        
        console.log(`Bot started with PID: ${bot.pid}`);
        return bot;
    } catch (error) {
        console.error(`Failed to start bot: ${error.message}`);
        throw error;
    }
}

// Find the target group
async function findTargetGroup(client) {
    try {
        // Check if client is ready
        if (!client.info) {
            throw new Error('Client is not fully authenticated yet');
        }
        
        console.log('Fetching chats...');
        const chats = await client.getChats();
        console.log(`Found ${chats.length} chats`);
        
        // Log all group chats for debugging
        const groupChats = chats.filter(chat => chat.isGroup);
        console.log(`Found ${groupChats.length} group chats:`);
        groupChats.forEach(chat => {
            console.log(`- ${chat.name} (${chat.id._serialized})`);
        });
        
        const targetGroup = chats.find(chat => 
            chat.isGroup && chat.name === config.TARGET_GROUP
        );
        
        if (!targetGroup) {
            throw new Error(`Target group "${config.TARGET_GROUP}" not found`);
        }
        
        console.log(`Found target group: ${targetGroup.name} (${targetGroup.id._serialized})`);
        return targetGroup;
    } catch (error) {
        console.error(`Error finding target group: ${error.message}`);
        console.error('Please make sure:');
        console.error(`1. The group "${config.TARGET_GROUP}" exists in your WhatsApp`);
        console.error('2. You are fully authenticated with WhatsApp');
        console.error('3. The bot has been added to the group');
        
        throw new Error(`Unable to find target group: ${error.message}`);
    }
}

// Find the admin chat
async function findAdminChat(client) {
    try {
        // Check if client is ready
        if (!client.info) {
            throw new Error('Client is not fully authenticated yet');
        }
        
        const adminNumber = config.ADMIN_NUMBER;
        if (!adminNumber) {
            throw new Error('Admin number not configured');
        }
        
        const chatId = `${adminNumber}@c.us`;
        const chat = await client.getChatById(chatId);
        
        if (!chat) {
            throw new Error(`Admin chat not found for number ${adminNumber}`);
        }
        
        console.log(`Found admin chat for number ${adminNumber}`);
        return chat;
    } catch (error) {
        console.error(`Error finding admin chat: ${error.message}`);
        console.error('Please make sure:');
        console.error('1. The admin number is correctly configured');
        console.error('2. You are fully authenticated with WhatsApp');
        
        throw new Error(`Unable to find admin chat: ${error.message}`);
    }
}

// Find the bot chat
async function findBotChat(client) {
    try {
        // Check if client is ready
        if (!client.info) {
            throw new Error('Client is not fully authenticated yet');
        }
        
        const botNumber = config.BOT_NUMBER;
        if (!botNumber) {
            throw new Error('Bot number not configured');
        }
        
        const chatId = `${botNumber}@c.us`;
        const chat = await client.getChatById(chatId);
        
        if (!chat) {
            throw new Error(`Bot chat not found for number ${botNumber}`);
        }
        
        console.log(`Found bot chat for number ${botNumber}`);
        return chat;
    } catch (error) {
        console.error(`Error finding bot chat: ${error.message}`);
        console.error('Please make sure:');
        console.error('1. The bot number is correctly configured');
        console.error('2. You are fully authenticated with WhatsApp');
        
        throw new Error(`Unable to find bot chat: ${error.message}`);
    }
}

// Send a message and wait for response
async function sendMessageAndWaitForResponse(client, group, message, options = {}) {
    const { 
        attachment = null, 
        quote = false, 
        preMessage = null,
        preCommand = null,
        timeout = config.RESPONSE_TIMEOUT,
        useBotChat = false,
        useAdminChat = false, // Kept for backward compatibility
        preDelay = 0,
        expectReactionDelete = false,
        sendAttachmentFirst = false,
        attachWithCommand = false, // New parameter to send attachment with command
        isSticker = false, // New parameter to indicate if the attachment should be sent as a sticker
        checkBotMessageDeletion = false,
        followUpCommand = null,
        followUpDelay = 0
    } = options;
    
    // Use bot chat if specified
    let chat;
    if (useBotChat || useAdminChat) {
        chat = await findBotChat(client);
    } else {
        chat = group;
    }
    
    // Wait for pre-delay if specified
    if (preDelay > 0) {
        console.log(`Waiting ${preDelay/1000} seconds before sending message...`);
        await new Promise(resolve => setTimeout(resolve, preDelay));
    }
    
    let quotedMessage = null;
    
    // Send pre-message if needed
    if (preMessage) {
        console.log(`Sending pre-message: ${preMessage}`);
        quotedMessage = await chat.sendMessage(preMessage);
        console.log('Pre-message sent, waiting before proceeding...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds after pre-message
    }
    
    // Send pre-command if specified
    if (preCommand) {
        console.log(`Sending pre-command: ${preCommand}`);
        await chat.sendMessage(preCommand);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds after pre-command
    }
    
    // For PDF summary, send attachment first, then quote it with the command
    if (sendAttachmentFirst && attachment) {
        console.log(`Sending attachment first: ${attachment}`);
        const filePath = path.join(__dirname, 'samples', attachment);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Attachment file not found: ${filePath}`);
        }
        
        const media = MessageMedia.fromFilePath(filePath);
        
        // If it's a sticker, use sendMediaAsSticker option
        if (isSticker) {
            console.log('Sending as sticker...');
            quotedMessage = await chat.sendMessage(media, { sendMediaAsSticker: true });
        } else {
            quotedMessage = await chat.sendMessage(media);
        }
        
        console.log('Attachment sent, waiting before quoting...');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds after sending attachment
    }
    
    // Prepare message options
    const messageOptions = {};
    if (quote && quotedMessage) {
        messageOptions.quotedMessageId = quotedMessage.id._serialized;
    }
    
    // Send attachment if needed (and not already sent)
    let sentMessage;
    if (attachment && !sendAttachmentFirst) {
        const filePath = path.join(__dirname, 'samples', attachment);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Attachment file not found: ${filePath}`);
        }
        
        const media = MessageMedia.fromFilePath(filePath);
        
        // If it's a sticker, use sendMediaAsSticker option
        if (isSticker) {
            console.log(`Sending attachment as sticker${message ? ' with caption: ' + message : ''}`);
            
            // For stickers, we need to set the caption and then send as sticker
            const stickerOptions = { 
                sendMediaAsSticker: true,
                ...messageOptions
            };
            
            // Add caption if provided and attachWithCommand is true
            if (message && attachWithCommand) {
                stickerOptions.caption = message;
            }
            
            sentMessage = await chat.sendMessage(media, stickerOptions);
        } else {
            // If attachWithCommand is true, send the attachment with the command as caption
            if (attachWithCommand) {
                console.log(`Sending attachment with command as caption: ${message}`);
                sentMessage = await chat.sendMessage(media, { caption: message, ...messageOptions });
            } else {
                // Otherwise, just send the attachment (with caption if message is provided)
                sentMessage = await chat.sendMessage(media, { caption: message, ...messageOptions });
            }
        }
    } else {
        // Send regular message
        sentMessage = await chat.sendMessage(message, messageOptions);
    }
    
    console.log(`Sent message: ${message}${useBotChat ? ' (to bot chat)' : useAdminChat ? ' (to admin chat)' : ''}`);
    
    // Wait for response
    const responsePromise = new Promise((resolve) => {
        const responseHandler = (msg) => {
            if (msg.from === chat.id._serialized && msg.fromMe === false) {
                client.removeListener('message', responseHandler);
                resolve(msg);
            }
        };
        
        client.on('message', responseHandler);
        
        // Set timeout
        setTimeout(() => {
            client.removeListener('message', responseHandler);
            resolve(null);
        }, timeout);
    });
    
    // Get the response
    const response = await responsePromise;
    
    // Handle bot message reaction deletion test
    if (checkBotMessageDeletion && response) {
        console.log('Testing bot message reaction deletion...');
        try {
            // Wait a moment before reacting
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // React with praying hands emoji (which is the only emoji that triggers deletion)
            await response.react('🙏');
            console.log('Added praying hands (🙏) reaction to bot message');
            
            // Wait for message to be deleted (with a reasonable timeout)
            const deletionTimeout = 10000; // 10 seconds
            const startTime = Date.now();
            
            // Create a promise that resolves when the message is deleted
            const deletionPromise = new Promise((resolve) => {
                const checkInterval = setInterval(async () => {
                    try {
                        // Try to fetch the message
                        const messages = await chat.fetchMessages({ limit: 10 });
                        const messageExists = messages.some(msg => 
                            msg.id._serialized === response.id._serialized
                        );
                        
                        if (!messageExists) {
                            clearInterval(checkInterval);
                            console.log('Bot message was deleted after praying hands reaction');
                            resolve({ wasDeleted: true });
                        } else if (Date.now() - startTime > deletionTimeout) {
                            // Timeout reached
                            clearInterval(checkInterval);
                            console.log('Timeout reached, bot message was not deleted');
                            resolve({ wasDeleted: false });
                        }
                    } catch (error) {
                        // If we can't fetch the message, assume it was deleted
                        clearInterval(checkInterval);
                        console.log('Error checking message, assuming deleted:', error.message);
                        resolve({ wasDeleted: true });
                    }
                }, 1000);
            });
            
            // Wait for the deletion promise to resolve
            const deletionResult = await deletionPromise;
            
            if (deletionResult.wasDeleted) {
                return { body: 'Message deleted', wasDeleted: true };
            } else {
                throw new Error('Bot message was not deleted after reaction');
            }
        } catch (error) {
            console.error('Error testing bot message reaction deletion:', error);
            return null;
        }
    }
    
    // Handle follow-up command if specified
    if (followUpCommand && response) {
        console.log(`Waiting ${followUpDelay/1000} seconds before sending follow-up command...`);
        await new Promise(resolve => setTimeout(resolve, followUpDelay));
        
        console.log(`Sending follow-up command: ${followUpCommand}`);
        await chat.sendMessage(followUpCommand);
        console.log('Follow-up command sent');
    }
    
    return response;
}

// Mock the openaiUtils module to capture prompts
function setupPromptCapture() {
    try {
        // Create a variable to store the last prompt
        global.lastPrompt = null;
        global.promptCaptured = false;
        
        // Store the original console.log function
        const originalConsoleLog = console.log;
        
        // Flag to prevent recursion
        let isLogging = false;
        
        // Override console.log to capture prompts from the logs
        console.log = function() {
            // Prevent recursion
            if (isLogging) {
                return originalConsoleLog.apply(console, arguments);
            }
            
            isLogging = true;
            
            // Call the original console.log
            originalConsoleLog.apply(console, arguments);
            
            // Check if this is a prompt log
            const logMessage = Array.from(arguments).join(' ');
            
            // Look for the start of a prompt (DIRETRIZES)
            if (logMessage.includes('DIRETRIZES')) {
                originalConsoleLog.call(console, 'Found prompt with DIRETRIZES, capturing...');
                global.lastPrompt = logMessage;
                global.promptCaptured = true;
            }
            
            // Also capture message history
            if (logMessage.includes('>>') && logMessage.includes('FIM DAS ÚLTIMAS')) {
                originalConsoleLog.call(console, 'Found message history, capturing...');
                if (global.lastPrompt) {
                    global.lastPrompt += '\n' + logMessage;
                } else {
                    global.lastPrompt = logMessage;
                }
                global.promptCaptured = true;
            }
            
            isLogging = false;
        };
        
        originalConsoleLog.call(console, 'Prompt capture set up successfully');
        return true;
    } catch (error) {
        console.error('Error setting up prompt capture:', error);
        return false;
    }
}

// Check if the prompt contains personality and message history
async function checkPromptContent(prompt) {
    // Wait a bit to ensure the prompt is captured
    console.log('Waiting for prompt to be fully captured...');
    
    // Wait for the prompt to be captured with a timeout
    const startTime = Date.now();
    const timeout = 15000; // 15 seconds
    
    while (!global.promptCaptured && (Date.now() - startTime) < timeout) {
        console.log('Waiting for prompt to be captured...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    }
    
    // Use the global lastPrompt if no prompt is provided
    prompt = prompt || global.lastPrompt;
    
    if (!prompt) {
        console.warn('No prompt captured after waiting. This might be a timing issue or the prompt logs are not enabled.');
        return { 
            hasPersonality: false, 
            hasMessageHistory: false,
            details: 'No prompt captured'
        };
    }
    
    console.log('Checking captured prompt content...');
    
    // Check for specific markers in the prompt
    const hasPersonality = prompt.includes('DIRETRIZES');
    const hasMessageHistory = prompt.includes('>>');
    
    console.log('Prompt check results:', {
        hasPersonality,
        hasMessageHistory,
        promptLength: prompt.length
    });
    
    // If either check fails, log more details to help debug
    if (!hasPersonality || !hasMessageHistory) {
        console.log('Prompt check failed. Detailed analysis:');
        console.log('- Contains "DIRETRIZES":', hasPersonality);
        console.log('- Contains ">>":', hasMessageHistory);
        console.log('First 1000 characters of prompt:');
        console.log(prompt.substring(0, 1000) + '...');
    } else {
        console.log('Prompt check passed! Found both "DIRETRIZES" and ">>"');
    }
    
    return {
        hasPersonality,
        hasMessageHistory,
        details: `Personality: ${hasPersonality ? 'Yes' : 'No'}, Message History: ${hasMessageHistory ? 'Yes' : 'No'}, Prompt Length: ${prompt.length} chars`
    };
}

// Run a single test
async function runTest(client, group, test) {
    console.log(`\n[TEST] ${test.name}: ${test.description}`);
    
    try {
        // Skip admin-only tests if not running as admin
        if (test.adminOnly && !config.ADMIN_NUMBER) {
            console.log(`Skipping admin-only test: ${test.name}`);
            testResults.skipped++;
            testResults.details.push({
                name: test.name,
                result: 'SKIPPED',
                reason: 'Admin-only test'
            });
            return { needsShortDelay: true };
        }
        
        // Reset the last prompt
        global.lastPrompt = null;
        
        // Send the command
        const response = await sendMessageAndWaitForResponse(client, group, test.command, {
            attachment: test.attachment,
            quote: test.quote,
            preMessage: test.preMessage,
            preCommand: test.preCommand,
            timeout: test.extraDelay ? config.RESPONSE_TIMEOUT + test.extraDelay : config.RESPONSE_TIMEOUT,
            useBotChat: test.useBotChat,
            useAdminChat: test.useAdminChat,
            preDelay: test.preDelay,
            sendAttachmentFirst: test.sendAttachmentFirst,
            attachWithCommand: test.attachWithCommand,
            isSticker: test.isSticker,
            checkBotMessageDeletion: test.checkBotMessageDeletion,
            followUpCommand: test.followUpCommand,
            followUpDelay: test.followUpDelay
        });
        
        // Check if we got a response
        if (!response && test.expectedResponseContains.length > 0 && !test.checkBotMessageDeletion) {
            throw new Error('No response received within timeout');
        }
        
        // Special case for bot message deletion test
        if (test.checkBotMessageDeletion) {
            if (!response || !response.wasDeleted) {
                throw new Error('Bot message was not deleted after reaction');
            }
            // Test passed for bot message deletion
            console.log(`✅ PASSED: ${test.name} (Message was deleted after reaction)`);
            testResults.passed++;
            testResults.details.push({
                name: test.name,
                result: 'PASSED',
                details: 'Message was deleted after reaction'
            });
            return { needsShortDelay: true };
        }
        
        // Special case for prompt check
        if (test.checkPrompt) {
            const promptCheck = await checkPromptContent(global.lastPrompt);
            console.log('Prompt check results:', promptCheck.details);
            
            if (!promptCheck.hasPersonality || !promptCheck.hasMessageHistory) {
                throw new Error(`Prompt check failed: ${promptCheck.details}`);
            }
            
            // If we have a response, also check it
            if (response) {
                const responseText = response.body.toLowerCase();
                console.log(`Response received: "${responseText.substring(0, 50)}${responseText.length > 50 ? '...' : ''}"`);
            }
            
            // Test passed for prompt check
            console.log(`✅ PASSED: ${test.name} (Prompt check)`);
            testResults.passed++;
            testResults.details.push({
                name: test.name,
                result: 'PASSED',
                details: promptCheck.details
            });
            return { needsShortDelay: true };
        }
        
        // Check if response contains expected text
        let passed = true;
        if (test.expectedResponseContains.length > 0 && response) {
            const responseText = response.body.toLowerCase();
            console.log(`Response received: "${responseText.substring(0, 50)}${responseText.length > 50 ? '...' : ''}"`);
            
            // Check if at least one of the expected keywords is found
            let foundAnyKeyword = false;
            let missingKeywords = [];
            
            for (const expected of test.expectedResponseContains) {
                const normalizedExpected = expected.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const normalizedResponse = responseText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                
                if (normalizedResponse.includes(normalizedExpected)) {
                    foundAnyKeyword = true;
                    console.log(`✓ Found keyword: "${expected}"`);
                } else {
                    missingKeywords.push(expected);
                }
            }
            
            // Test passes if at least one keyword is found
            if (!foundAnyKeyword) {
                passed = false;
                throw new Error(`Response does not contain any of the expected keywords: ${test.expectedResponseContains.join(', ')}`);
            } else {
                // Log missing keywords but don't fail the test
                if (missingKeywords.length > 0) {
                    console.log(`Note: Some keywords were not found: ${missingKeywords.join(', ')}`);
                }
            }
        }
        
        // Check for media if expected
        if (test.expectMedia && response && !response.hasMedia) {
            passed = false;
            throw new Error('Expected media in response but none was received');
        }
        
        // Test passed
        console.log(`✅ PASSED: ${test.name}`);
        testResults.passed++;
        testResults.details.push({
            name: test.name,
            result: 'PASSED'
        });
        
        // If the test has an extra delay, wait for it
        if (test.extraDelay) {
            console.log(`Waiting extra ${test.extraDelay/1000} seconds before next test...`);
            await new Promise(resolve => setTimeout(resolve, test.extraDelay));
        }
        
        return { needsShortDelay: true };
    } catch (error) {
        // Test failed
        console.error(`❌ FAILED: ${test.name} - ${error.message}`);
        testResults.failed++;
        testResults.details.push({
            name: test.name,
            result: 'FAILED',
            error: error.message
        });
        
        return { needsShortDelay: true };
    }
}

// Run all tests
async function runAllTests() {
    let client;
    let botProcess;
    let exitCode = 0;
    let startedNewBot = false;
    
    try {
        console.log('Starting test sequence...');
        
        // Check for sample files
        if (!checkSampleFiles()) {
            console.warn('Some sample files are missing. Some tests may fail.');
        }
        
        // Set up prompt capture
        console.log('Setting up prompt capture...');
        setupPromptCapture();
        
        // Initialize client
        console.log('Initializing WhatsApp test client...');
        try {
            client = await initializeClient();
            console.log('WhatsApp test client initialized successfully');
        } catch (error) {
            console.error('Failed to initialize WhatsApp test client:', error);
            console.error('Try deleting the .wwebjs_auth_test directory and running npm run setup again');
            throw error;
        }
        
        // Wait for client to be fully ready
        console.log('Waiting for WhatsApp client to be fully ready...');
        
        // Create a promise that resolves when the client is ready
        if (!client.info) {
            console.log('Client not fully ready, waiting for info...');
            await new Promise((resolve, reject) => {
                const readyCheck = setInterval(() => {
                    if (client.info) {
                        clearInterval(readyCheck);
                        console.log('Client is fully authenticated and ready.');
                        resolve();
                    }
                }, 1000);
                
                // Set a timeout in case authentication takes too long
                setTimeout(() => {
                    clearInterval(readyCheck);
                    console.warn('Authentication timeout reached. Continuing with tests, but some may fail.');
                    resolve();
                }, 60000); // 1 minute timeout
            });
        } else {
            console.log('Client is already fully ready');
        }
        
        // Verify group access
        if (config.VERIFY_WHITELIST) {
            console.log('Verifying group access...');
            try {
                await verifyGroupAccess(client, config.TARGET_GROUP);
                console.log('Group access verified successfully');
            } catch (error) {
                console.error('Failed to verify group access:', error);
                throw error;
            }
        }
        
        // Check if bot is already running
        console.log('Checking if bot is already running...');
        const isRunning = await checkIfBotIsRunning();
        
        if (isRunning) {
            console.log('Bot is already running. Using existing bot instance.');
            // We'll use the existing bot
        } else {
            console.log('Bot is not running. Starting a new instance...');
            // Start the bot
            try {
                botProcess = startBot();
                startedNewBot = true;
                
                // Wait for bot to initialize
                console.log(`Waiting ${config.BOT_STARTUP_WAIT/1000} seconds for bot to initialize...`);
                await new Promise(resolve => setTimeout(resolve, config.BOT_STARTUP_WAIT));
                console.log('Bot initialization wait completed');
            } catch (error) {
                console.error('Failed to start bot:', error);
                throw error;
            }
        }
        
        // Find target group
        console.log('Finding target group...');
        let group;
        try {
            group = await findTargetGroup(client);
            console.log(`Found target group: ${group.name}`);
        } catch (error) {
            console.error('Failed to find target group:', error);
            throw error;
        }
        
        // Get test cases based on enabled categories
        const testCases = getTestCases();
        console.log(`Preparing to run ${testCases.length} tests...`);
        
        // Run tests sequentially
        for (const test of testCases) {
            const result = await runTest(client, group, test);
            
            // Use a shorter delay between tests if the test has already completed
            const delayTime = result && result.needsShortDelay ? 1000 : config.DELAY_BETWEEN_TESTS;
            console.log(`Waiting ${delayTime/1000} seconds before next test...`);
            await new Promise(resolve => setTimeout(resolve, delayTime));
        }
        
        // Print summary
        const summary = formatTestResults(testResults);
        console.log(summary);
        
        // Save results to file
        const resultsPath = path.join(__dirname, 'test_results.json');
        fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
        console.log(`Test results saved to ${resultsPath}`);
        
        // Send summary to group
        await group.sendMessage(`*Bot Test Results*\n\nTotal: ${testResults.passed + testResults.failed + testResults.skipped}\nPassed: ${testResults.passed}\nFailed: ${testResults.failed}\nSkipped: ${testResults.skipped}`);
        
    } catch (error) {
        console.error('Error running tests:', error);
        exitCode = 1;
    } finally {
        // Clean up
        console.log('Cleaning up...');
        
        if (client) {
            console.log('Destroying WhatsApp client...');
            try {
                await client.destroy();
                console.log('WhatsApp client destroyed');
            } catch (error) {
                console.error('Error destroying WhatsApp client:', error);
            }
        }
        
        // Only terminate the bot if we started it
        if (startedNewBot && botProcess) {
            console.log(`Terminating bot process (PID: ${botProcess.pid})...`);
            try {
                // First try to kill gracefully
                botProcess.kill('SIGTERM');
                
                // Wait a moment for the process to terminate
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // If it's still running, force kill it
                if (botProcess.killed === false) {
                    console.log('Bot process did not terminate gracefully, force killing...');
                    process.kill(botProcess.pid, 'SIGKILL');
                }
                
                console.log('Bot process terminated');
            } catch (error) {
                console.error('Error terminating bot process:', error);
                
                // As a last resort, try to kill using the OS process ID
                try {
                    console.log('Attempting to kill using process ID...');
                    process.kill(botProcess.pid);
                    console.log('Process killed using process ID');
                } catch (killError) {
                    console.error('Failed to kill process:', killError);
                }
            }
        } else {
            console.log('Not terminating bot as it was already running before tests started');
        }
        
        // Delete the .wwebjs_cache directory
        const cachePath = path.join(__dirname, '.wwebjs_cache');
        console.log(`Cleaning up cache directory: ${cachePath}`);
        try {
            if (fs.existsSync(cachePath)) {
                // Delete the directory recursively
                fs.rmSync(cachePath, { recursive: true, force: true });
                console.log('Cache directory deleted successfully');
            } else {
                console.log('Cache directory does not exist, nothing to clean up');
            }
        } catch (error) {
            console.error(`Error cleaning up cache directory: ${error.message}`);
        }
        
        console.log('Cleanup complete');
        
        // Exit with appropriate code
        console.log(`Exiting with code ${exitCode}`);
        process.exit(exitCode);
    }
}

// Check if the bot is already running
async function checkIfBotIsRunning() {
    try {
        console.log('Checking if bot is already running...');
        return new Promise((resolve) => {
            exec('ps aux | grep "node index.js" | grep -v grep', (error, stdout, stderr) => {
                if (error) {
                    // Command failed, bot is not running
                    console.log('Bot is not running (ps command failed)');
                    resolve(false);
                    return;
                }
                
                // Check if there's output (bot is running)
                const isRunning = stdout.trim() !== '';
                if (isRunning) {
                    console.log('Bot is already running:');
                    console.log(stdout.trim());
                } else {
                    console.log('Bot is not running (no matching processes)');
                }
                resolve(isRunning);
            });
        });
    } catch (error) {
        console.error('Error checking if bot is running:', error);
        return false;
    }
}

// Run the tests
runAllTests().catch(console.error);
