/**
 * Setup Authentication Directories
 * 
 * This script ensures that the authentication directories exist and have the correct permissions.
 * It also cleans up any incorrect directory structures.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Client IDs
const MAIN_CLIENT_ID = 'tanabe-gpt-client';
const TEST_CLIENT_ID = 'test-client';

// Authentication directories (using absolute paths)
const AUTH_DIRS = [
    {
        path: path.join(__dirname, '..', '.wwebjs_auth_main'),
        clientId: MAIN_CLIENT_ID
    },
    {
        path: path.join(__dirname, '..', '.wwebjs_auth_test'),
        clientId: TEST_CLIENT_ID
    }
];

console.log('Setting up authentication directories...');
console.log(`Main auth directory: ${AUTH_DIRS[0].path}`);
console.log(`Test auth directory: ${AUTH_DIRS[1].path}`);

// Clean up incorrect directory structures
console.log('Cleaning up incorrect directory structures...');
AUTH_DIRS.forEach(dir => {
    const basePath = dir.path;
    const oldSessionPath = path.join(basePath, 'session');
    
    // Remove the incorrect session directory if it exists
    if (fs.existsSync(oldSessionPath)) {
        console.log(`Removing incorrect session directory: ${oldSessionPath}`);
        try {
            execSync(`rm -rf "${oldSessionPath}"`);
            console.log(`Successfully removed: ${oldSessionPath}`);
        } catch (error) {
            console.error(`Error removing directory: ${error.message}`);
        }
    } else {
        console.log(`No incorrect session directory found at: ${oldSessionPath}`);
    }
});

// Create directories if they don't exist
AUTH_DIRS.forEach(dir => {
    const basePath = dir.path;
    const sessionPath = path.join(basePath, `session-${dir.clientId}`);
    
    // Create base directory
    if (!fs.existsSync(basePath)) {
        console.log(`Creating directory: ${basePath}`);
        try {
            fs.mkdirSync(basePath, { recursive: true });
            console.log(`Successfully created: ${basePath}`);
        } catch (error) {
            console.error(`Error creating directory ${basePath}:`, error);
        }
    } else {
        console.log(`Directory already exists: ${basePath}`);
    }
    
    // Create session directory with correct naming
    if (!fs.existsSync(sessionPath)) {
        console.log(`Creating session directory: ${sessionPath}`);
        try {
            fs.mkdirSync(sessionPath, { recursive: true });
            console.log(`Successfully created: ${sessionPath}`);
            
            // Create Default directory inside session directory
            const defaultPath = path.join(sessionPath, 'Default');
            if (!fs.existsSync(defaultPath)) {
                console.log(`Creating Default directory: ${defaultPath}`);
                fs.mkdirSync(defaultPath, { recursive: true });
                console.log(`Successfully created: ${defaultPath}`);
            }
        } catch (error) {
            console.error(`Error creating session directory ${sessionPath}:`, error);
        }
    } else {
        console.log(`Session directory already exists: ${sessionPath}`);
        
        // Check if Default directory exists
        const defaultPath = path.join(sessionPath, 'Default');
        if (!fs.existsSync(defaultPath)) {
            console.log(`Creating missing Default directory: ${defaultPath}`);
            try {
                fs.mkdirSync(defaultPath, { recursive: true });
                console.log(`Successfully created: ${defaultPath}`);
            } catch (error) {
                console.error(`Error creating Default directory ${defaultPath}:`, error);
            }
        } else {
            console.log(`Default directory already exists: ${defaultPath}`);
        }
    }
    
    // Set permissions
    try {
        console.log(`Setting permissions for: ${basePath}`);
        fs.chmodSync(basePath, 0o755);
        if (fs.existsSync(sessionPath)) {
            fs.chmodSync(sessionPath, 0o755);
            
            // Set permissions for Default directory
            const defaultPath = path.join(sessionPath, 'Default');
            if (fs.existsSync(defaultPath)) {
                fs.chmodSync(defaultPath, 0o755);
            }
        }
        console.log(`Successfully set permissions for: ${basePath}`);
    } catch (error) {
        console.error(`Error setting permissions for ${basePath}:`, error);
    }
});

console.log('Authentication directories setup complete.');
console.log('You can now run the tests with: npm test'); 