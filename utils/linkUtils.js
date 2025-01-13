const axios = require('axios');
const logger = require('./logger');
const config = require('../config');

function extractLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
}

async function unshortenLink(url) {
    try {
        const response = await axios.head(url, {
            maxRedirects: 5,
            timeout: config.RESUMO?.linkSettings?.timeout || 10000
        });
        return response.request.res.responseUrl || url;
    } catch (error) {
        logger.error('Error unshortening link:', error);
        return url;
    }
}

async function getPageContent(url) {
    try {
        const settings = config.RESUMO?.linkSettings || { maxCharacters: 5000, timeout: 10000 };
        logger.debug('Link settings:', settings);

        const response = await axios.get(url, {
            timeout: settings.timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // Extract text content from HTML
        let content = response.data
            .toString()
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Limit content length
        if (content.length > settings.maxCharacters) {
            logger.debug(`Trimming content from ${content.length} to ${settings.maxCharacters} characters`);
            content = content.substring(0, settings.maxCharacters);
        }

        return content;
    } catch (error) {
        logger.error('Error fetching page content:', error);
        throw error;
    }
}

module.exports = {
    extractLinks,
    unshortenLink,
    getPageContent
}; 