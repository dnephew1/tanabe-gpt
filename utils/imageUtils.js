const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fsPromises = require('fs').promises;
const logger = require('./logger');

// Function to search Google for an image
async function searchGoogleForImage(query) {
    try {
        const formattedQuery = query.split(' ').join('+') + '+meme';
        const url = `https://www.google.com/search?q=${formattedQuery}&sca_esv=adfface043f3fd58&gbv=1&tbm=isch`;

        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const imageUrl = $('div.kCmkOe img').attr('src');

        return imageUrl || null;
    } catch (error) {
        console.error(`Error while searching for image:`, error.message);
        return null;
    }
}

// Function to download an image
async function downloadImage(url) {
    const filePath = path.join(__dirname, '..', `image_${Date.now()}.jpeg`);
    
    try {
        if (url.startsWith('data:image')) {
            const base64Data = url.split('base64,')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            await fsPromises.writeFile(filePath, buffer);
        } else {
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'arraybuffer'
            });
            const buffer = Buffer.from(response.data, 'binary');
            await fsPromises.writeFile(filePath, buffer);
        }
        return filePath;
    } catch (error) {
        console.error(`Error downloading image:`, error.message);
        return null;
    }
}

module.exports = {
    searchGoogleForImage,
    downloadImage
}; 