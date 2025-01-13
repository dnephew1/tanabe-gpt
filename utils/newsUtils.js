const axios = require('axios');
const cheerio = require('cheerio');
const { runCompletion } = require('./openaiUtils');

// Function to scrape news
async function scrapeNews() {
    try {
        const url = 'https://www.newsminimalist.com/';
        const response = await axios.get(url);

        if (response.status !== 200) {
            console.error(`Failed to load page`);
            return [];
        }

        const $ = cheerio.load(response.data);
        const newsElements = $('div.mr-auto');

        if (!newsElements.length) {
            console.log(`No news elements found`);
            return [];
        }

        const news = [];
        newsElements.each((index, element) => {
            if (index < 5) {
                const headline = $(element).find('span').first().text().trim();
                const source = $(element).find('span.text-xs.text-slate-400').text().trim();
                news.push(`${headline} ${source}`);
            }
        });

        return news;
    } catch (error) {
        console.error(`An error occurred while scraping news:`, error.message);
        return [];
    }
}

// Function to search for specific news
async function searchNews(searchTerm) {
    try {
        const query = encodeURIComponent(searchTerm);
        const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
        const response = await axios.get(url);
        const xmlString = response.data;
        const newsItems = parseXML(xmlString).slice(0, 5);
        
        return newsItems.map(item => `${item.title} (${item.source})`);
    } catch (error) {
        console.error(`[ERROR] An error occurred in the searchNews function:`, error.message);
        return [];
    }
}

// Function to translate news to Portuguese
async function translateToPortuguese(news) {
    if (!Array.isArray(news) || news.length === 0) {
        return [];
    }

    try {
        const newsText = news.join('\n');
        const prompt = `Translate the following news to Portuguese. Keep the format and any source information in parentheses:\n\n${newsText}`;
        const completion = await runCompletion(prompt, 1);
        return completion.trim().split('\n').filter(item => item.trim() !== '');
    } catch (error) {
        console.error(`[ERROR] Translation failed:`, error.message);
        return news;
    }
}

// Helper function to parse XML from Google News
function parseXML(xmlString) {
    const items = xmlString.match(/<item>([\s\S]*?)<\/item>/g) || [];
    return items.map(item => {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
        const source = item.match(/<source.*?>(.*?)<\/source>/)?.[1] || '';
        return { title, pubDate, source };
    });
}

// Helper function to get relative time
function getRelativeTime(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    const diffInHours = Math.floor(diffInMinutes / 60);
    const diffInDays = Math.floor(diffInHours / 24);

    if (diffInSeconds < 60) return `${diffInSeconds} segundos atrás`;
    if (diffInMinutes < 60) return `${diffInMinutes} minutos atrás`;
    if (diffInHours < 24) return `${diffInHours} horas atrás`;
    if (diffInDays === 1) return `1 dia atrás`;
    return `${diffInDays} dias atrás`;
}

module.exports = {
    scrapeNews,
    searchNews,
    translateToPortuguese,
    parseXML,
    getRelativeTime
}; 