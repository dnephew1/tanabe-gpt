// dependencies.js
    // notifyAdmin,
    // runCompletion,
    // extractLinks,
    // unshortenLink,
    // getPageContent,
    // searchGoogleForImage,
    // downloadImage,
    // deleteFile,
    // scrapeNews,
    // translateToPortuguese,
    // scrapeNews2

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs').promises;
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { http, https } = require('follow-redirects');
const config = require('./config');

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: config.OPENAI_API_KEY
});

// Function to notify admin
async function notifyAdmin(message) {
    const adminContact = `${config.ADMIN_NUMBER}@c.us`;
    try {
        if (!global.client || !global.client.isReady) {
            console.log('Client not ready, waiting...');
            await new Promise((resolve, reject) => {
                if (global.client && global.client.isReady) {
                    resolve();
                } else if (global.client) {
                    global.client.once('ready', resolve);
                    setTimeout(() => reject(new Error('Timeout waiting for client to be ready')), 30000);
                } else {
                    reject(new Error('Global client does not exist'));
                }
            });
        }
        
        const sent = await global.client.sendMessage(adminContact, message);
        return sent;
    } catch (error) {
        console.error('Failed to notify admin:', error);
        throw error;
    }
}

// Function to run ChatGPT completion
async function runCompletion(prompt, group) {
    try {
        const completePrompt = config.PROMPTS[group === 1 ? 'GROUP1' : 'GROUP2'] + prompt;
        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'system', content: 'You are a WhatsApp group assistant.' },
                { role: 'user', content: completePrompt }
            ],
            model: 'gpt-4o-mini',
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error('An error occurred in the runCompletion function:', error);
        return '';
    }
}

// Function to extract links from message
function extractLinks(messageText) {
    const linkRegex = /(https?:\/\/[^\s]+)/g;
    return messageText.match(linkRegex) || [];
}

// Function to unshorten a link
async function unshortenLink(link) {
    return new Promise((resolve) => {
        const options = {
            method: 'HEAD',
            timeout: 5000,
        };

        const client = link.startsWith('https') ? https : http;
        const request = client.request(link, options, (response) => {
            if (response.statusCode >= 300 && response.headers.location) {
                resolve(response.headers.location);
            } else {
                resolve(link);
            }
        });

        request.on('error', (error) => {
            console.error('Error unshortening URL:', error);
            resolve(link);
        });

        request.end();
    });
}

// Function to get page content
async function getPageContent(url) {
    try {
        const unshortenedLink = await unshortenLink(url);
        
        if (unshortenedLink.includes('x.com') || unshortenedLink.includes('twitter.com')) {
            const browser = global.client.pupBrowser;
            
            if (!browser) {
                throw new Error('Browser instance not available');
            }
            
            const page = await browser.newPage();
            
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            await page.goto(unshortenedLink, { waitUntil: 'networkidle0', timeout: 30000 });
            await page.waitForSelector('article[data-testid="tweet"]', { timeout: 5000 });

            const content = await page.evaluate(() => {
                const tweetElement = document.querySelector('article[data-testid="tweet"]');
                if (tweetElement) {
                    const tweetTextElement = tweetElement.querySelector('div[data-testid="tweetText"]');
                    return tweetTextElement ? tweetTextElement.innerText : 'No tweet text found';
                }
                return 'Tweet not found';
            });

            await page.close();
            return content;
        } else {
            const response = await axios.get(unshortenedLink);
            const $ = cheerio.load(response.data);

            $('script, style, iframe').remove();

            let contentElement = $('article, main, .article, .content, .entry-content, .post-content');
            if (contentElement.length === 0) {
                contentElement = $('body');
            }

            let content = contentElement.text().trim();
            content = content.substring(0, 50000).trim();
            content = content.replace(/\s+/g, ' ');

            return content;
        }
    } catch (error) {
        console.error('An error occurred in the getPageContent function:', error);
        return null;
    }
}

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
        console.error('Error while searching for image:', error);
        return null;
    }
}

// Function to download an image
async function downloadImage(url) {
    const filePath = path.join(__dirname, `image_${Date.now()}.jpeg`);
    
    try {
        if (url.startsWith('data:image')) {
            const base64Data = url.split('base64,')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            await fs.writeFile(filePath, buffer);
        } else {
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'arraybuffer'
            });
            const buffer = Buffer.from(response.data, 'binary');
            await fs.writeFile(filePath, buffer);
        }
        return filePath;
    } catch (error) {
        console.error('An error occurred in the downloadImage function:', error);
        return null;
    }
}

// Function to delete a file
async function deleteFile(filePath) {
    try {
        await fs.unlink(filePath);
        console.log('File deleted successfully');
    } catch (error) {
        console.error('Error deleting file:', error);
    }
}

// Function to scrape news
async function scrapeNews() {
    try {
        console.log('--scrapeNews')
        const url = 'https://www.newsminimalist.com/';
        const response = await axios.get(url);

        if (response.status !== 200) {
            console.error('Failed to load page');
            return [];
        }

        const $ = cheerio.load(response.data);
        const newsElements = $('div.mr-auto');

        if (!newsElements.length) {
            console.log('No news elements found');
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
        console.error('An error occurred while scraping news:', error);
        return [];
    }
}

// Function to translate news to Portuguese
async function translateToPortuguese(news) {
    console.log('--translateToPortuguese')
    const nonEmptyNews = news.filter(item => item.trim() !== '');
    const newsText = nonEmptyNews.join('\n');
    const prompt = config.PROMPTS.TRANSLATE_NEWS.replace('{newsText}', newsText);

    try {
        const completion = await runCompletion(prompt, 1);
        const translatedNews = completion.trim().split('\n');
        return translatedNews;
    } catch (error) {
        console.error('Translation failed for the news text', error);
        return news;
    }
}

// Function to scrape football news
async function scrapeNews2() {
    try {
        console.log('--scrapeNews2')
        const url = 'https://ge.globo.com/futebol/';
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const newsElements = $('.feed-post-body');

        const news = [];
        newsElements.each((index, element) => {
            if (index < 5) {
                const title = $(element).find('.feed-post-body-title a').text().trim();
                const summary = $(element).find('.feed-post-body-resumo').text().trim();
                const link = $(element).find('.feed-post-body-title a').attr('href');
                news.push({ title, summary, link });
            }
        });

        return news;
    } catch (error) {
        console.error('An error occurred in the scrapeNews2 function:', error);
        return [];
    }
}

function parseXML(xmlString) {
    const items = xmlString.match(/<item>([\s\S]*?)<\/item>/g) || [];
    return items.map(item => {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
        const source = item.match(/<source.*?>(.*?)<\/source>/)?.[1] || '';
        return { title, pubDate, source };
    });
}

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

async function generateImage(prompt, cfg_scale = 7) {
    try {
        const response = await axios.post('https://api.getimg.ai/v1/essential-v2/text-to-image', {
            prompt: prompt,
            style: 'photorealism',
            aspect_ratio: '1:1',
            output_format: 'png',
            cfg_scale: cfg_scale
        }, {
            headers: {
                'Authorization': `Bearer ${config.GETIMG_AI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.image;
    } catch (error) {
        console.error('Error generating image:', error.response ? error.response.data : error.message);
        return null;
    }
}

async function improvePrompt(prompt) {
    const improvePromptTemplate = config.PROMPTS.IMPROVE_IMAGE_PROMPT;
    const improvedPrompt = await runCompletion(improvePromptTemplate.replace('{prompt}', prompt), 1);
    return improvedPrompt.trim();
}

module.exports = {
    Client,
    LocalAuth,
    MessageMedia,
    fs,
    qrcode,
    OpenAI,
    puppeteer,
    crypto,
    path,
    axios,
    cheerio,
    http,
    https,
    config,
    openai,
    notifyAdmin,
    runCompletion,
    extractLinks,
    unshortenLink,
    getPageContent,
    searchGoogleForImage,
    downloadImage,
    deleteFile,
    scrapeNews,
    translateToPortuguese,
    scrapeNews2,
    parseXML,
    getRelativeTime,
    generateImage,
    improvePrompt
};
