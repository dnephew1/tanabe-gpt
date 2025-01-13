const fsPromises = require('fs').promises;

// Function to delete a file
async function deleteFile(filePath) {
    try {
        await fsPromises.unlink(filePath);
    } catch (error) {
        console.error(`Error deleting file:`, error.message);
    }
}

module.exports = {
    deleteFile
}; 