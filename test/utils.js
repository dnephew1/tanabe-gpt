/**
 * Test Utilities
 */

const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');

// Sample files paths
const SAMPLES_DIR = path.join(__dirname, 'samples');

// Ensure sample files exist
function checkSampleFiles() {
    const requiredSamples = ['sample.jpg', 'sample.pdf', 'sample.ogg'];
    const missingFiles = [];
    
    for (const file of requiredSamples) {
        const filePath = path.join(SAMPLES_DIR, file);
        if (!fs.existsSync(filePath)) {
            missingFiles.push(file);
        }
    }
    
    if (missingFiles.length > 0) {
        console.warn(`Warning: The following sample files are missing: ${missingFiles.join(', ')}`);
        console.warn(`Please add these files to the ${SAMPLES_DIR} directory before running tests.`);
        return false;
    }
    
    return true;
}

// Create a media message from a sample file
function createMediaMessage(filename) {
    const filePath = path.join(SAMPLES_DIR, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Sample file not found: ${filePath}`);
    }
    
    return MessageMedia.fromFilePath(filePath);
}

// Format test results for display
function formatTestResults(results) {
    const { passed, failed, skipped, details } = results;
    const total = passed + failed + skipped;
    
    let output = '\n===== TEST RESULTS =====\n';
    output += `Total: ${total} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}\n\n`;
    
    // Group by result
    const passedTests = details.filter(d => d.result === 'PASSED');
    const failedTests = details.filter(d => d.result === 'FAILED');
    const skippedTests = details.filter(d => d.result === 'SKIPPED');
    
    if (passedTests.length > 0) {
        output += '✅ PASSED TESTS:\n';
        passedTests.forEach(test => {
            output += `  - ${test.name}\n`;
        });
        output += '\n';
    }
    
    if (failedTests.length > 0) {
        output += '❌ FAILED TESTS:\n';
        failedTests.forEach(test => {
            output += `  - ${test.name}: ${test.error}\n`;
        });
        output += '\n';
    }
    
    if (skippedTests.length > 0) {
        output += '⏭️ SKIPPED TESTS:\n';
        skippedTests.forEach(test => {
            output += `  - ${test.name}: ${test.reason}\n`;
        });
        output += '\n';
    }
    
    output += '========================\n';
    return output;
}

// Verify group access to commands
async function verifyGroupAccess(client, groupName) {
    try {
        // Check if client is ready
        if (!client.info) {
            console.warn('Client is not fully authenticated yet. Skipping group access verification.');
            return true;
        }
        
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup && chat.name === groupName);
        
        if (!group) {
            console.error(`Group "${groupName}" not found`);
            return false;
        }
        
        // We can't directly check permissions, but we can log a warning
        console.log(`Found group "${groupName}". Please ensure this group has access to all commands in the whitelist.`);
        return true;
    } catch (error) {
        console.warn(`Unable to verify group access: ${error.message}`);
        console.warn('Continuing with tests, but some tests may fail if the group does not have proper permissions.');
        return true;
    }
}

module.exports = {
    checkSampleFiles,
    createMediaMessage,
    formatTestResults,
    verifyGroupAccess
}; 