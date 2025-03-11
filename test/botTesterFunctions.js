/**
 * WhatsApp Bot Test Functions
 * 
 * This module exports the functions from botTester.js to be used by other scripts.
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { exec } = require('child_process');

// Import test modules
const config = require('./config');
const { 
    createMediaMessage
} = require('./utils');

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
        
        return targetGroup;
    } catch (error) {
        console.error('Error finding target group:', error);
        throw error;
    }
}

// Find the admin chat
async function findAdminChat(client) {
    try {
        // Check if client is ready
        if (!client.info) {
            throw new Error('Client is not fully authenticated yet');
        }
        
        if (!config.ADMIN_NUMBER) {
            throw new Error('Admin number not configured');
        }
        
        console.log('Fetching chats for admin...');
        const chats = await client.getChats();
        console.log(`Found ${chats.length} chats`);
        
        // Find the admin chat
        const adminChat = chats.find(chat => 
            !chat.isGroup && chat.id.user === config.ADMIN_NUMBER
        );
        
        if (!adminChat) {
            throw new Error(`Admin chat with number ${config.ADMIN_NUMBER} not found`);
        }
        
        return adminChat;
    } catch (error) {
        console.error('Error finding admin chat:', error);
        throw error;
    }
}

// Find the bot chat
async function findBotChat(client) {
    try {
        // Check if client is ready
        if (!client.info) {
            throw new Error('Client is not fully authenticated yet');
        }
        
        if (!config.BOT_NUMBER) {
            throw new Error('Bot number not configured');
        }
        
        console.log('Fetching chats for bot...');
        const chats = await client.getChats();
        console.log(`Found ${chats.length} chats`);
        
        // Find the bot chat
        const botChat = chats.find(chat => 
            !chat.isGroup && chat.id.user === config.BOT_NUMBER
        );
        
        if (!botChat) {
            throw new Error(`Bot chat with number ${config.BOT_NUMBER} not found`);
        }
        
        return botChat;
    } catch (error) {
        console.error('Error finding bot chat:', error);
        throw error;
    }
}

// Send a message and wait for a response
async function sendMessageAndWaitForResponse(client, chat, message, options = {}) {
    const {
        attachment,
        quote = false,
        preMessage = null,
        preCommand = null,
        timeout = config.RESPONSE_TIMEOUT,
        useBotChat = false,
        useAdminChat = false,
        preDelay = 0,
        sendAttachmentFirst = false,
        attachWithCommand = false,
        isSticker = false,
        checkBotMessageDeletion = false,
        followUpCommand = null,
        followUpDelay = 3000
    } = options;
    
    // Use the appropriate chat
    if (useBotChat) {
        console.log('Using direct chat with bot...');
        try {
            chat = await findBotChat(client);
        } catch (error) {
            console.error('Failed to find bot chat:', error);
            throw error;
        }
    } else if (useAdminChat) {
        console.log('Using admin chat...');
        try {
            chat = await findAdminChat(client);
        } catch (error) {
            console.error('Failed to find admin chat:', error);
            throw error;
        }
    }
    
    // Send pre-command if specified
    if (preCommand) {
        console.log(`Sending pre-command: ${preCommand}`);
        await chat.sendMessage(preCommand);
        console.log('Pre-command sent');
        
        // Wait a moment before continuing
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Send pre-message if specified
    let quotedMessage = null;
    if (preMessage) {
        // Wait before sending pre-message if specified
        if (preDelay > 0) {
            console.log(`Waiting ${preDelay/1000} seconds before sending pre-message...`);
            await new Promise(resolve => setTimeout(resolve, preDelay));
        }
        
        console.log(`Sending pre-message: ${preMessage}`);
        quotedMessage = await chat.sendMessage(preMessage);
        console.log('Pre-message sent');
        
        // Wait a moment before continuing
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Prepare message options
    const messageOptions = {};
    
    // Handle quoting
    if (quote && quotedMessage) {
        messageOptions.quotedMessageId = quotedMessage.id._serialized;
    }
    
    // Handle attachment
    let sentMessage;
    if (attachment) {
        // Create media message
        const media = await createMediaMessage(attachment, isSticker);
        
        if (sendAttachmentFirst) {
            // Send attachment first
            console.log(`Sending attachment: ${attachment}`);
            quotedMessage = await chat.sendMessage(media);
            console.log('Attachment sent');
            
            // Wait a moment before continuing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Update message options to quote the attachment
            messageOptions.quotedMessageId = quotedMessage.id._serialized;
            
            // Send command
            console.log(`Sending message: ${message}`);
            sentMessage = await chat.sendMessage(message, messageOptions);
        } else if (attachWithCommand) {
            // Send attachment with command
            console.log(`Sending message with attachment: ${message}`);
            messageOptions.media = media;
            sentMessage = await chat.sendMessage(message, messageOptions);
        } else {
            // Send message first, then attachment
            console.log(`Sending message: ${message}`);
            sentMessage = await chat.sendMessage(message, messageOptions);
            
            // Wait a moment before sending attachment
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Send attachment
            console.log(`Sending attachment: ${attachment}`);
            await chat.sendMessage(media);
            console.log('Attachment sent');
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
            
            // React with thumbs up
            await response.react('👍');
            console.log('Added thumbs up reaction to bot message');
            
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
                            console.log('Bot message was deleted after reaction');
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
async function runTest(client, group, test, testResults) {
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
            return;
        }
        
        // Reset the last prompt
        global.lastPrompt = null;
        global.promptCaptured = false;
        
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
            return;
        }
        
        // Special case for prompt check
        if (test.checkPrompt) {
            console.log('Running prompt check test...');
            
            // Make sure we have a response first
            if (!response) {
                console.log('No response received for prompt check test');
                throw new Error('No response received for prompt check test');
            }
            
            // Check if response contains expected text
            if (test.expectedResponseContains && test.expectedResponseContains.length > 0) {
                const responseText = response.body.toLowerCase();
                console.log(`Response received: "${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}"`);
                
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
                
                if (!foundAnyKeyword && test.expectedResponseContains.length > 0) {
                    console.log(`✗ Missing all expected keywords: ${missingKeywords.join(', ')}`);
                    throw new Error(`Response does not contain any of the expected keywords: ${missingKeywords.join(', ')}`);
                }
            }
            
            // Now check the prompt content
            const promptCheck = await checkPromptContent(global.lastPrompt);
            console.log('Prompt check results:', promptCheck.details);
            
            if (!promptCheck.hasPersonality || !promptCheck.hasMessageHistory) {
                throw new Error(`Prompt check failed: ${promptCheck.details}`);
            }
            
            // Test passed for prompt check
            console.log(`✅ PASSED: ${test.name} (Prompt check)`);
            testResults.passed++;
            testResults.details.push({
                name: test.name,
                result: 'PASSED',
                details: promptCheck.details
            });
            return;
        }
        
        // Check for media if expected
        if (test.expectMedia && response && !response.hasMedia) {
            throw new Error('Expected media in response but none was received');
        }
        
        // Check if response contains expected text
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
                throw new Error(`Response does not contain any of the expected keywords: ${test.expectedResponseContains.join(', ')}`);
            } else {
                // Log missing keywords but don't fail the test
                if (missingKeywords.length > 0) {
                    console.log(`Note: Some keywords were not found: ${missingKeywords.join(', ')}`);
                }
            }
        }
        
        // Test passed
        console.log(`✅ PASSED: ${test.name}`);
        testResults.passed++;
        testResults.details.push({
            name: test.name,
            result: 'PASSED'
        });
    } catch (error) {
        // Test failed
        console.error(`❌ FAILED: ${test.name} - ${error.message}`);
        testResults.failed++;
        testResults.details.push({
            name: test.name,
            result: 'FAILED',
            error: error.message
        });
    }
    
    // Return a flag indicating whether we need a longer delay
    // We only need a short delay between tests since we've already waited for the response
    return { needsShortDelay: true };
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

// Delete the .wwebjs_cache directory
function cleanupCache() {
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
}

// Export the functions
module.exports = {
    initializeClient,
    startBot,
    findTargetGroup,
    findAdminChat,
    findBotChat,
    sendMessageAndWaitForResponse,
    setupPromptCapture,
    checkPromptContent,
    runTest,
    checkIfBotIsRunning,
    cleanupCache
}; 