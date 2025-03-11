// utils/group_manager.js
// Utility for managing groups and their configurations

const envMapper = require('./env_mapper');
const periodicSummary = require('../configs/periodic_summary_config');

// Avoid circular dependency with logger
let logger;
setTimeout(() => {
    logger = require('./logger');
}, 0);

/**
 * Add a new group to the system with all necessary configurations
 * @param {string} groupName - The name of the group
 * @param {Object} options - Configuration options
 * @param {string} options.abbreviation - Custom abbreviation (default: generated from group name)
 * @param {boolean} options.enableSummary - Whether to enable periodic summaries (default: false)
 * @param {Object} options.summaryConfig - Configuration for periodic summaries
 * @returns {Object} - Result of the operation
 */
function addNewGroup(groupName, options = {}) {
    try {
        // Handle dm. prefix
        let baseGroupName = groupName;
        if (groupName.startsWith('dm.')) {
            baseGroupName = groupName.substring(3);
        }
        
        // Generate abbreviation if not provided
        const abbreviation = options.abbreviation || 
            baseGroupName.split(/\s+/).map(word => word[0].toUpperCase()).join('');
        
        // Add to environment variables
        const envKey = envMapper.addNewGroup(baseGroupName, abbreviation);
        
        if (!envKey) {
            return {
                success: false,
                message: `Failed to add group ${baseGroupName} to environment variables`
            };
        }
        
        // Add to periodic summary if enabled
        if (options.enableSummary) {
            periodicSummary.addGroup(baseGroupName, options.summaryConfig || {});
        }
        
        if (logger) {
            logger.info(`Successfully added new group: ${baseGroupName} (${envKey})`);
        } else {
            console.log(`Successfully added new group: ${baseGroupName} (${envKey})`);
        }
        
        return {
            success: true,
            message: `Successfully added group ${baseGroupName}`,
            envKey
        };
    } catch (error) {
        if (logger) {
            logger.error(`Error adding new group ${groupName}: ${error.message}`);
        } else {
            console.error(`Error adding new group ${groupName}: ${error.message}`);
        }
        return {
            success: false,
            message: `Error adding group: ${error.message}`
        };
    }
}

/**
 * Remove a group from the system and all its configurations
 * @param {string} groupName - The name of the group to remove
 * @returns {Object} - Result of the operation
 */
function removeGroup(groupName) {
    try {
        // Handle dm. prefix
        let baseGroupName = groupName;
        if (groupName.startsWith('dm.')) {
            baseGroupName = groupName.substring(3);
        }
        
        // Remove from periodic summary if it exists
        if (periodicSummary.groups && periodicSummary.groups[baseGroupName]) {
            delete periodicSummary.groups[baseGroupName];
        }
        
        // Remove from environment variables
        const envRemoved = envMapper.removeGroup(baseGroupName);
        
        if (!envRemoved) {
            return {
                success: false,
                message: `Failed to remove group ${baseGroupName} from environment variables`
            };
        }
        
        if (logger) {
            logger.info(`Successfully removed group: ${baseGroupName}`);
        } else {
            console.log(`Successfully removed group: ${baseGroupName}`);
        }
        
        return {
            success: true,
            message: `Successfully removed group ${baseGroupName}`
        };
    } catch (error) {
        if (logger) {
            logger.error(`Error removing group ${groupName}: ${error.message}`);
        } else {
            console.error(`Error removing group ${groupName}: ${error.message}`);
        }
        return {
            success: false,
            message: `Error removing group: ${error.message}`
        };
    }
}

/**
 * Add a new phone number to the system
 * @param {string} phoneNumber - The phone number (with @c.us suffix)
 * @param {string} abbreviation - Custom abbreviation
 * @returns {Object} - Result of the operation
 */
function addNewPhone(phoneNumber, abbreviation) {
    try {
        // Add to environment variables
        const envKey = envMapper.addNewGroup(phoneNumber, abbreviation, 'PHONE');
        
        if (!envKey) {
            return {
                success: false,
                message: `Failed to add phone ${phoneNumber} to environment variables`
            };
        }
        
        if (logger) {
            logger.info(`Successfully added new phone: ${phoneNumber} (${envKey})`);
        } else {
            console.log(`Successfully added new phone: ${phoneNumber} (${envKey})`);
        }
        
        return {
            success: true,
            message: `Successfully added phone ${phoneNumber}`,
            envKey
        };
    } catch (error) {
        if (logger) {
            logger.error(`Error adding new phone ${phoneNumber}: ${error.message}`);
        } else {
            console.error(`Error adding new phone ${phoneNumber}: ${error.message}`);
        }
        return {
            success: false,
            message: `Error adding phone: ${error.message}`
        };
    }
}

module.exports = {
    addNewGroup,
    removeGroup,
    addNewPhone
}; 