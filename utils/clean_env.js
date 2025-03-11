// utils/clean_env.js
// Utility script to clean up duplicate entries in the .env file

const fs = require('fs');
const path = require('path');

/**
 * Clean up duplicate entries in the .env file
 */
function cleanEnvFile() {
    try {
        const envPath = path.resolve('./configs/.env');
        const envContent = fs.readFileSync(envPath, 'utf8');
        
        // Split the content into lines
        const lines = envContent.split('\n');
        
        // Keep track of seen keys
        const seenKeys = new Set();
        
        // Filter out duplicate entries
        const uniqueLines = lines.filter(line => {
            // Skip empty lines and comments
            if (!line.trim() || line.trim().startsWith('#')) {
                return true;
            }
            
            // Extract the key
            const key = line.split('=')[0].trim();
            
            // If we've seen this key before, skip it
            if (seenKeys.has(key)) {
                console.log(`Removing duplicate entry: ${key}`);
                return false;
            }
            
            // Otherwise, add it to the set and keep it
            seenKeys.add(key);
            return true;
        });
        
        // Join the lines back together
        const cleanedContent = uniqueLines.join('\n');
        
        // Write the cleaned content back to the file
        fs.writeFileSync(envPath, cleanedContent);
        
        console.log(`Cleaned up .env file: ${envPath}`);
        console.log(`Removed ${lines.length - uniqueLines.length} duplicate entries`);
    } catch (error) {
        console.error(`Error cleaning .env file: ${error.message}`);
    }
}

// Run the cleanup function
cleanEnvFile(); 