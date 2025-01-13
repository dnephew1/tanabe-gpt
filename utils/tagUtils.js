// tagUtils.js

/**
 * Get all available tags for a specific group
 * @param {Object} config - The application configuration
 * @param {string} groupName - The name of the group
 * @returns {string[]} Array of available tags
 */
function getAvailableTagsForGroup(config, groupName) {
    const tagCommand = config.COMMANDS.TAG;
    const tags = [...Object.keys(tagCommand.specialTags)];
    
    if (tagCommand.groupTags[groupName]) {
        tags.push(...Object.keys(tagCommand.groupTags[groupName]));
    }
    
    return tags;
}

module.exports = {
    getAvailableTagsForGroup
}; 