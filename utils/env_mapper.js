// utils/env_mapper.js
// Utility for mapping between environment variables and their values
require('dotenv').config({ path: './configs/.env' });
const fs = require('fs');
const path = require('path');

// Avoid circular dependency with logger
let logger;
setTimeout(() => {
    logger = require('./logger');
}, 0);

// Map of environment variable keys to their values
const groupMap = {
    'GROUP_LF': process.env.GROUP_LF,
    'GROUP_AG': process.env.GROUP_AG,
    'PHONE_DS1': process.env.PHONE_DS1,
    'PHONE_DS2': process.env.PHONE_DS2
};

// Reverse map for looking up keys by values
const reverseGroupMap = {};
Object.entries(groupMap).forEach(([key, value]) => {
    if (value) {
        reverseGroupMap[value] = key;
        // Also add dm. prefixed version
        if (key.startsWith('GROUP_')) {
            reverseGroupMap[`dm.${value}`] = key;
        }
    }
});

/**
 * Get the actual group name from its environment variable key
 * @param {string} envKey - The environment variable key (e.g., 'GROUP_LF')
 * @returns {string|null} - The actual group name or null if not found
 */
function getGroupName(envKey) {
    return groupMap[envKey] || null;
}

/**
 * Get the environment variable key for a group name
 * @param {string} groupName - The actual group name
 * @returns {string|null} - The environment variable key or null if not found
 */
function getGroupKey(groupName) {
    // Check if it's a direct message group
    if (groupName.startsWith('dm.')) {
        const baseGroupName = groupName.substring(3);
        const baseKey = reverseGroupMap[baseGroupName];
        return baseKey || null;
    }
    return reverseGroupMap[groupName] || null;
}

/**
 * Add a new group mapping to the environment
 * @param {string} groupName - The actual group name
 * @param {string} abbreviation - The abbreviation to use (e.g., 'LF' for 'GROUP_LF')
 * @param {string} type - The type of group ('GROUP' or 'PHONE')
 * @returns {string} - The new environment variable key
 */
function addNewGroup(groupName, abbreviation, type = 'GROUP') {
    // Check if it's a direct message group
    let baseGroupName = groupName;
    if (groupName.startsWith('dm.')) {
        baseGroupName = groupName.substring(3);
    }
    
    // Check if group already exists
    if (getGroupKey(baseGroupName)) {
        return getGroupKey(baseGroupName);
    }

    // Create new key
    const newKey = `${type}_${abbreviation}`;
    
    // Update maps
    groupMap[newKey] = baseGroupName;
    reverseGroupMap[baseGroupName] = newKey;
    // Also add dm. prefixed version if it's a GROUP
    if (type === 'GROUP') {
        reverseGroupMap[`dm.${baseGroupName}`] = newKey;
    }
    
    // Update .env file
    try {
        const envPath = path.resolve('./configs/.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        // Add new line if it doesn't end with a newline
        if (!envContent.endsWith('\n')) {
            envContent += '\n';
        }
        
        // Add new environment variable
        envContent += `${newKey}=${baseGroupName}\n`;
        
        // Write back to file
        fs.writeFileSync(envPath, envContent);
        
        // Update process.env
        process.env[newKey] = baseGroupName;
        
        if (logger) {
            logger.info(`Added new ${type} mapping: ${newKey}=${baseGroupName}`);
        } else {
            console.log(`Added new ${type} mapping: ${newKey}=${baseGroupName}`);
        }
        return newKey;
    } catch (error) {
        if (logger) {
            logger.error(`Failed to update .env file: ${error.message}`);
        } else {
            console.error(`Failed to update .env file: ${error.message}`);
        }
        return null;
    }
}

/**
 * Remove a group and its related environment variables
 * @param {string} groupName - The name of the group to remove
 * @returns {boolean} - Whether the removal was successful
 */
function removeGroup(groupName) {
    try {
        // Handle dm. prefix
        let baseGroupName = groupName;
        if (groupName.startsWith('dm.')) {
            baseGroupName = groupName.substring(3);
        }
        
        // Get the environment variable key for the group
        const groupKey = getGroupKey(baseGroupName);
        if (!groupKey) {
            if (logger) {
                logger.warn(`Group ${baseGroupName} not found in environment variables`);
            } else {
                console.warn(`Group ${baseGroupName} not found in environment variables`);
            }
            return false;
        }
        
        // Get the abbreviation from the key (e.g., 'LF' from 'GROUP_LF')
        const abbreviation = groupKey.split('_')[1];
        
        // Find all related environment variables (group, members, etc.)
        const relatedKeys = [];
        
        // Add the group key itself
        relatedKeys.push(groupKey);
        
        // Add member keys (MEMBER_XX1, MEMBER_XX2, etc.)
        Object.keys(process.env).forEach(key => {
            if (key.startsWith(`MEMBER_${abbreviation}`)) {
                relatedKeys.push(key);
            }
        });
        
        // Add personality key if it exists
        if (process.env[`${groupKey}_PERSONALITY`]) {
            relatedKeys.push(`${groupKey}_PERSONALITY`);
        }
        
        // Update the .env file
        const envPath = path.resolve('./configs/.env');
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        // Remove each related key from the .env file
        relatedKeys.forEach(key => {
            const regex = new RegExp(`^${key}=.*$\\n?`, 'm');
            envContent = envContent.replace(regex, '');
            
            // Also remove from process.env and our maps
            delete process.env[key];
            delete groupMap[key];
        });
        
        // Remove from reverseGroupMap
        delete reverseGroupMap[baseGroupName];
        if (baseGroupName !== groupName) {
            delete reverseGroupMap[groupName]; // Remove dm. version if it exists
        }
        
        // Write back to file
        fs.writeFileSync(envPath, envContent);
        
        if (logger) {
            logger.info(`Removed group ${baseGroupName} and ${relatedKeys.length} related environment variables`);
        } else {
            console.log(`Removed group ${baseGroupName} and ${relatedKeys.length} related environment variables`);
        }
        
        return true;
    } catch (error) {
        if (logger) {
            logger.error(`Failed to remove group ${groupName}: ${error.message}`);
        } else {
            console.error(`Failed to remove group ${groupName}: ${error.message}`);
        }
        return false;
    }
}

/**
 * Get all group names from a specific type
 * @param {string} type - The type prefix ('GROUP' or 'PHONE')
 * @returns {string[]} - Array of actual group names
 */
function getAllGroupsByType(type) {
    return Object.entries(groupMap)
        .filter(([key]) => key.startsWith(type))
        .map(([_, value]) => value);
}

module.exports = {
    getGroupName,
    getGroupKey,
    addNewGroup,
    removeGroup,
    getAllGroupsByType
}; 