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
const fsPromises = require('fs').promises;
const fs = require('fs');
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

let twitterLoggedIn = false;

async function loginToTwitter(page) {
    if (twitterLoggedIn) return true;
    
    try {
        // First try to access x.com/login to check if we're already logged in
        await page.goto('https://x.com/login', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        // Wait a moment for potential redirect
        await page.waitForTimeout(2000);
        // Check if we were redirected to home (meaning we're logged in)
        const currentUrl = page.url();
        if (currentUrl.includes('x.com/home')) {
            console.log('Already logged into Twitter');
            twitterLoggedIn = true;
            return true;
        }

        // If we're not logged in, proceed with login
        await page.goto('https://twitter.com/i/flow/login', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        // Wait for and fill username
        await page.waitForSelector('input[autocomplete="username"]');
        await page.type('input[autocomplete="username"]', config.TWITTER_CREDENTIALS.username);
        await page.keyboard.press('Enter');

        // Wait for and fill password
        await page.waitForSelector('input[name="password"]');
        await page.type('input[name="password"]', config.TWITTER_CREDENTIALS.password);
        await page.keyboard.press('Enter');

        // Wait for login to complete
        await page.waitForSelector('[data-testid="primaryColumn"]', { timeout: 30000 });
        
        twitterLoggedIn = true;
        return true;
    } catch (error) {
        console.error('Twitter login failed:', error);
        return false;
    }
}

async function getPageContent(url) {
    try {
        const unshortenedLink = await unshortenLink(url);
        const maxRetries = 3;

        if (/^https?:\/\/(www\.)?(x|twitter)\.com\/[^\/]+\/?$/.test(unshortenedLink)) {
            const browser = global.client.pupBrowser;
            
            if (!browser) {
                throw new Error('Browser instance not available');
            }
            
            let lastError;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                const page = await browser.newPage();
                
                try {
                    console.log(`Profile check attempt ${attempt}/${maxRetries}`);
                    
                    // Handle login first if not already logged in
                    const loginSuccess = await loginToTwitter(page);
                    if (!loginSuccess) {
                        throw new Error('Failed to login to Twitter');
                    }

                    // Configure longer timeout and better request handling
                    await page.setDefaultNavigationTimeout(120000);
                    await page.setRequestInterception(true);
                    page.on('request', (request) => {
                        if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
                            request.abort();
                        } else {
                            request.continue();
                        }
                    });

                    // Navigate to profile with better load handling
                    await page.goto(unshortenedLink, {
                        waitUntil: 'domcontentloaded',
                        timeout: 60000
                    });
                    
                    // Wait for content to load with multiple fallback selectors
                    await Promise.race([
                        page.waitForSelector('article[data-testid="tweet"]'),
                        page.waitForSelector('[data-testid="cellInnerDiv"]'),
                        page.waitForSelector('[data-testid="tweetText"]')
                    ]);

                    // Additional wait to ensure dynamic content loads
                    await page.waitForFunction(() => {
                        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
                        return tweets.length > 0;
                    }, { timeout: 30000 });

                    // Extract tweet content and ID with better error handling
                    const result = await page.evaluate(() => {
                        const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
                        if (!tweets.length) return null;

                        // Find the first non-pinned tweet
                        const firstNonPinnedTweet = tweets.find(tweet => {
                            // Check for pinned tweet indicator
                            const isPinned = tweet.querySelector('[data-testid="socialContext"]')?.textContent?.includes('Pinned');
                            return !isPinned;
                        });

                        if (!firstNonPinnedTweet) return null;

                        const tweetText = firstNonPinnedTweet.querySelector('[data-testid="tweetText"]')?.textContent;
                        const tweetLink = firstNonPinnedTweet.querySelector('a[href*="/status/"]')?.href;
                        const tweetId = tweetLink?.match(/\/status\/(\d+)/)?.[1];

                        return {
                            content: tweetText || 'No tweet text found',
                            tweetId: tweetId || null
                        };
                    });

                    await page.close();
                    if (result && result.content && result.tweetId) {
                        return result;
                    }
                    throw new Error('Failed to extract tweet content or ID');

                } catch (error) {
                    lastError = error;
                    console.log(`Profile check attempt ${attempt} failed:`, error.message);
                    
                    try {
                        await page.screenshot({ 
                            path: 'debug.png',
                            fullPage: true 
                        });
                        console.log('Debug screenshot saved');
                    } catch (screenshotError) {
                        console.error('Failed to take debug screenshot:', screenshotError);
                    }
                    
                    await page.close();
                    
                    if (attempt === maxRetries) {
                        console.error('All profile check attempts failed');
                        throw lastError;
                    }
                    
                    // Wait before retry with exponential backoff
                    const delay = Math.pow(2, attempt) * 1000;
                    console.log(`Waiting ${delay}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        if (unshortenedLink.includes('x.com') || unshortenedLink.includes('twitter.com')) {
            const browser = global.client.pupBrowser;
            
            if (!browser) {
                throw new Error('Browser instance not available');
            }
            
            const page = await browser.newPage();
            
            try {
                // Handle login first if not already logged in
                const loginSuccess = await loginToTwitter(page);
                if (!loginSuccess) {
                    throw new Error('Failed to login to Twitter');
                }

                // Configure longer timeout and better request handling
                await page.setDefaultNavigationTimeout(60000); // Increased to 60 seconds
                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
                        request.abort();
                    } else {
                        request.continue();
                    }
                });

                // Navigate to URL with less strict waiting condition
                await page.goto(unshortenedLink, { 
                    waitUntil: 'domcontentloaded', // Changed from networkidle0 to domcontentloaded
                    timeout: 60000 
                });

                // Wait specifically for tweet text to be available
                await page.waitForSelector('[data-testid="tweetText"]', { timeout: 30000 });

                // Extract tweet content focusing on text
                const content = await page.evaluate(() => {
                    const tweetTextElement = document.querySelector('[data-testid="tweetText"]');
                    if (tweetTextElement) {
                        return tweetTextElement.innerText;
                    }
                    return 'Tweet content not found';
                });

                await page.close();
                return content;

            } catch (error) {
                console.error('Error accessing Twitter content:', error);
                // Take screenshot for debugging
                try {
                    await page.screenshot({ 
                        path: 'debug.png',
                        fullPage: true 
                    });
                    console.log('Debug screenshot saved');
                } catch (screenshotError) {
                    console.error('Failed to take debug screenshot:', screenshotError);
                }
                await page.close();
                throw error;
            }
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
        await fsPromises.unlink(filePath);
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

async function getPageContentWithRetry(url, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const content = await getPageContent(url);
            if (content) return content;
            
            // Wait between retries with exponential backoff
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error);
            if (i === maxRetries - 1) throw error;
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
    return null;
}

// Function to transcribe audio using OpenAI's Whisper model
async function transcribeAudio(audioPath) {
    try {
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
            language: "pt"
        });
        return transcription.text;
    } catch (error) {
        console.error('Error transcribing audio:', error);
        throw error;
    }
}

module.exports = {
    Client,
    LocalAuth,
    MessageMedia,
    fsPromises,
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
    improvePrompt,
    getPageContentWithRetry,
    transcribeAudio
};
