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
            console.log(`[LOG] [${new Date().toISOString()}] Client not ready, waiting...`);
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
        console.error(`[LOG] [${new Date().toISOString()}] Failed to notify admin:`, error);
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
        console.error(`[LOG] [${new Date().toISOString()}] An error occurred in the runCompletion function:`, error);
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
            console.error(`[LOG] [${new Date().toISOString()}] Error unshortening URL:`, error);
            resolve(link);
        });

        request.end();
    });
}

async function getPageContent(url) {
    try {
        const unshortenedLink = await unshortenLink(url);
        const maxRetries = 3;

        if (unshortenedLink.includes('x.com') || unshortenedLink.includes('twitter.com')) {
            const browser = global.client.pupBrowser;
            
            if (!browser) {
                throw new Error('Browser instance not available');
            }
            
            const page = await browser.newPage();
            
            try {
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
                console.error(`[LOG] [${new Date().toISOString()}] Error accessing Twitter content:`, error);
                // Take screenshot for debugging
                try {
                    await page.screenshot({ 
                        path: 'debug.png',
                        fullPage: true 
                    });
                    console.log(`[LOG] [${new Date().toISOString()}] Debug screenshot saved`);
                } catch (screenshotError) {
                    console.error(`[LOG] [${new Date().toISOString()}] Failed to take debug screenshot:`, screenshotError);
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
        console.error(`[LOG] [${new Date().toISOString()}] An error occurred in the getPageContent function:`, error);
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
        console.error(`[LOG] [${new Date().toISOString()}] Error while searching for image:`, error);
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
        console.error(`[LOG] [${new Date().toISOString()}] An error occurred in the downloadImage function:`, error);
        return null;
    }
}

// Function to delete a file
async function deleteFile(filePath) {
    try {
        await fsPromises.unlink(filePath);
        console.log(`[LOG] [${new Date().toISOString()}] File deleted successfully`);
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Error deleting file:`, error);
    }
}

// Function to scrape news
async function scrapeNews() {
    try {
        console.log(`[LOG] [${new Date().toISOString()}] --scrapeNews`);
        const url = 'https://www.newsminimalist.com/';
        const response = await axios.get(url);

        if (response.status !== 200) {
            console.error(`[LOG] [${new Date().toISOString()}] Failed to load page`);
            return [];
        }

        const $ = cheerio.load(response.data);
        const newsElements = $('div.mr-auto');

        if (!newsElements.length) {
            console.log(`[LOG] [${new Date().toISOString()}] No news elements found`);
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
        console.error(`[LOG] [${new Date().toISOString()}] An error occurred while scraping news:`, error);
        return [];
    }
}

// Function to translate news to Portuguese
async function translateToPortuguese(news) {
    console.log(`[LOG] [${new Date().toISOString()}] --translateToPortuguese`);
    const nonEmptyNews = news.filter(item => item.trim() !== '');
    const newsText = nonEmptyNews.join('\n');
    const prompt = config.PROMPTS.TRANSLATE_NEWS.replace('{newsText}', newsText);

    try {
        const completion = await runCompletion(prompt, 1);
        const translatedNews = completion.trim().split('\n');
        return translatedNews;
    } catch (error) {
        console.error(`[LOG] [${new Date().toISOString()}] Translation failed for the news text`, error);
        return news;
    }
}

// Function to scrape football news
async function scrapeNews2() {
    try {
        console.log(`[LOG] [${new Date().toISOString()}] --scrapeNews2`);
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
        console.error(`[LOG] [${new Date().toISOString()}] An error occurred in the scrapeNews2 function:`, error);
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
        console.error(`[LOG] [${new Date().toISOString()}] Error generating image:`, error.response ? error.response.data : error.message);
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
            console.error(`[LOG] [${new Date().toISOString()}] Attempt ${i + 1} failed:`, error);
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
        console.error(`[LOG] [${new Date().toISOString()}] Error transcribing audio:`, error);
        throw error;
    }
}

async function getTweetCount(username) {
    let page = null;
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 5000; // 5 seconds

    while (retryCount < maxRetries) {
        try {
            const url = `https://socialblade.com/twitter/user/${username}`;
            const browser = global.client.pupBrowser;
            
            if (!browser) {
                throw new Error('Browser instance not available');
            }
            
            // Create new page with minimal resources
            page = await browser.newPage();
            
            // Set a custom user agent to look more like a regular browser
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Minimize memory usage
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                if (['image', 'stylesheet', 'font', 'media', 'script'].includes(request.resourceType())) {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            // Minimize memory usage
            await page.setJavaScriptEnabled(false);
            
            // Navigate with increased timeout
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 // 30 seconds
            });

            // Add a delay that varies with each retry
            await new Promise(resolve => setTimeout(resolve, 2000 + (retryCount * 1000)));

            // Get tweet count using XPath for more precise selection
            const tweetCount = await page.evaluate(() => {
                const elements = document.querySelectorAll('.YouTubeUserTopInfo');
                for (const element of elements) {
                    if (element.textContent.includes('Tweets')) {
                        const countElement = element.querySelector('span[style="font-weight: bold;"]');
                        if (countElement) {
                            return parseInt(countElement.textContent.replace(/,/g, ''));
                        }
                    }
                }
                return null;
            });

            if (!tweetCount) {
                throw new Error('Failed to find tweet count element');
            }
            
            return tweetCount;
        } catch (error) {
            retryCount++;
            console.log(`[LOG] [${new Date().toISOString()}] Attempt ${retryCount} failed for ${username}:`, error.message);
            
            // Close the page before retrying
            if (page) {
                try {
                    await page.close();
                } catch (closeError) {
                    // Ignore close errors
                }
                page = null;
            }

            // If we've exhausted all retries, fall back to stored count
            if (retryCount === maxRetries) {
                console.log(`[LOG] [${new Date().toISOString()}] All attempts failed for ${username}, falling back to stored count`);
                const account = config.TWITTER_ACCOUNTS.find(acc => acc.username === username);
                return account ? account.lastTweetCount : null;
            }

            // Wait before retrying with exponential backoff
            await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, retryCount - 1)));
        } finally {
            // Ensure page is always closed
            if (page) {
                try {
                    await page.close();
                } catch (closeError) {
                    // Ignore close errors
                }
            }
        }
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
    transcribeAudio,
    getTweetCount
};
