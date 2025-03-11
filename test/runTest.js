/**
 * Test Runner Script for WhatsApp Bot
 * 
 * This script allows running individual tests or multiple tests by name
 * Usage: node runTest.js <test-name1> <test-name2> ...
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Import test modules
const config = require('./config');
const { getTestCases } = require('./testCases');
const { 
    checkSampleFiles, 
    formatTestResults, 
    verifyGroupAccess 
} = require('./utils');

// Import the test functions from botTester.js
const {
    initializeClient,
    startBot,
    findTargetGroup,
    setupPromptCapture,
    runTest,
    checkIfBotIsRunning
} = require('./botTesterFunctions');

// Track test results
const testResults = {
    passed: 0,
    failed: 0,
    skipped: 0,
    details: []
};

// Get test names from command line arguments
const testNames = process.argv.slice(2);

// Main function to run specified tests
async function runSpecifiedTests() {
    console.log(`Running tests: ${testNames.length > 0 ? testNames.join(', ') : 'ALL'}`);
    
    let client;
    let botProcess;
    let startedNewBot = false;
    let exitCode = 0;
    
    try {
        // Check sample files
        console.log('Checking sample files...');
        checkSampleFiles();
        
        // Initialize client
        console.log('Initializing WhatsApp client...');
        client = await initializeClient();
        
        // Wait for client to be fully ready
        if (!client.info) {
            console.log('Waiting for client to be fully ready...');
            await new Promise((resolve) => {
                const readyCheck = setInterval(() => {
                    if (client.info) {
                        clearInterval(readyCheck);
                        console.log('Client is now fully ready');
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
        
        // Set up prompt capture
        setupPromptCapture();
        
        // Get all test cases
        const allTestCases = getTestCases(null, true); // Get all tests including optional ones
        
        // Filter test cases by name if specified
        let testCasesToRun = allTestCases;
        if (testNames.length > 0) {
            testCasesToRun = allTestCases.filter(test => {
                // Match by exact name or by partial name (case insensitive)
                return testNames.some(name => 
                    test.name.toLowerCase() === name.toLowerCase() || 
                    test.name.toLowerCase().includes(name.toLowerCase())
                );
            });
            
            console.log(`Found ${testCasesToRun.length} matching tests out of ${allTestCases.length} total tests`);
            
            if (testCasesToRun.length === 0) {
                console.error('No matching tests found. Available tests:');
                allTestCases.forEach(test => console.log(`- ${test.name}`));
                throw new Error('No matching tests found');
            }
        }
        
        console.log(`Preparing to run ${testCasesToRun.length} tests...`);
        
        // Run tests sequentially
        for (const test of testCasesToRun) {
            const result = await runTest(client, group, test, testResults);
            
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

// Run the specified tests
runSpecifiedTests().catch(console.error); 