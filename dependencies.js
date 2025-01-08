// dependencies.js
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
    apiKey: config.CREDENTIALS.OPENAI_API_KEY
});

// Function to run ChatGPT completion
const runCompletion = async (prompt, temperature = 1, model = null) => {
    try {
        const completion = await openai.chat.completions.create({
            model: model || config.SYSTEM.OPENAI_MODELS.DEFAULT,
            messages: [{ role: 'user', content: prompt }],
            temperature: temperature
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Error in runCompletion:', error);
        throw error;
    }
};

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
            console.error(`Error unshortening URL:`, error.message);
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
                console.error(`Error accessing Twitter content:`, error.message);
                // Take screenshot for debugging
                try {
                    await page.screenshot({ 
                        path: 'debug.png',
                        fullPage: true 
                    });
                    console.log(`Debug screenshot saved`);
                } catch (screenshotError) {
                    console.error(`Failed to take debug screenshot:`, screenshotError.message);
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
        console.error(`An error occurred in the getPageContent function:`, error.message);
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
        console.error(`Error while searching for image:`, error.message);
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

// Function to delete a file
async function deleteFile(filePath) {
    try {
        await fsPromises.unlink(filePath);
    } catch (error) {
        console.error(`Error deleting file:`, error.message);
    }
}

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

// Function to scrape news with search term
async function scrapeNews2(searchTerm) {
    try {
        const query = encodeURIComponent(searchTerm);
        const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
        const response = await axios.get(url);
        const xmlString = response.data;
        const newsItems = parseXML(xmlString).slice(0, 5);
        
        return newsItems.map(item => `${item.title} (${item.source})`);
    } catch (error) {
        console.error(`[ERROR] An error occurred in the scrapeNews2 function:`, error.message);
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
                'Authorization': `Bearer ${config.CREDENTIALS.GETIMG_AI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.image;
    } catch (error) {
        console.error('[ERROR] Error generating image:', error.response ? error.response.data : error.message);
        return null;
    }
}

async function improvePrompt(prompt) {
    try {
        const completion = await openai.chat.completions.create({
            model: config.SYSTEM.OPENAI_MODEL || "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error('OpenAI API Error:', error.message);
        throw error;
    }
}

async function getPageContentWithRetry(url, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const content = await getPageContent(url);
            if (content) return content;
            
            // Wait between retries with exponential backoff
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        } catch (error) {
            console.error(`Attempt ${i + 1} failed:`, error.message);
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
        console.error(`Error transcribing audio:`, error.message);
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
            console.log(`Attempt ${retryCount} failed for ${username}:`, error.message);
            
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
                console.log(`All attempts failed for ${username}, falling back to stored count`);
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

// Function to save configuration changes to file
async function saveConfig() {
    try {
        const configPath = path.join(__dirname, 'config.js');
        
        // Special handling for PERIODIC_SUMMARY section
        if (config.PERIODIC_SUMMARY) {
            // Format the groups configuration with proper indentation
            const groupsConfig = Object.entries(config.PERIODIC_SUMMARY.groups || {})
                .map(([name, settings]) => {
                    const prompt = settings.prompt || config.PERIODIC_SUMMARY.defaults.prompt;
                    // Properly escape backticks and quotes in the prompt
                    const escapedPrompt = prompt.replace(/`/g, '\\`').replace(/\$/g, '\\$');
                    
                    return `        '${name}': {
            enabled: ${settings.enabled !== false},
            intervalHours: ${settings.intervalHours || config.PERIODIC_SUMMARY.defaults.intervalHours},
            quietTime: {
                start: '${settings.quietTime?.start || config.PERIODIC_SUMMARY.defaults.quietTime.start}',
                end: '${settings.quietTime?.end || config.PERIODIC_SUMMARY.defaults.quietTime.end}'
            },
            deleteAfter: ${settings.deleteAfter === null ? 'null' : settings.deleteAfter},
            model: "${settings.model || config.PERIODIC_SUMMARY.defaults.model}",
            prompt: \`${escapedPrompt}\`
        }`
                })
                .join(',\n');

            const periodicSummarySection = `const PERIODIC_SUMMARY = {
    enabled: ${config.PERIODIC_SUMMARY.enabled},
    defaults: {
        intervalHours: ${config.PERIODIC_SUMMARY.defaults.intervalHours},
        quietTime: {
            start: '${config.PERIODIC_SUMMARY.defaults.quietTime.start}',
            end: '${config.PERIODIC_SUMMARY.defaults.quietTime.end}'
        },
        deleteAfter: ${config.PERIODIC_SUMMARY.defaults.deleteAfter === null ? 'null' : config.PERIODIC_SUMMARY.defaults.deleteAfter},
        model: "${config.PERIODIC_SUMMARY.defaults.model}",
        prompt: \`${config.PERIODIC_SUMMARY.defaults.prompt.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`
    },
    groups: {
${groupsConfig}
    }
};`;

            // Read the current file content
            const currentContent = await fsPromises.readFile(configPath, 'utf8');
            
            // Replace the PERIODIC_SUMMARY section
            const updatedContent = currentContent.replace(
                /const\s+PERIODIC_SUMMARY\s*=\s*{[^]*?};/s,
                periodicSummarySection
            );
            
            // Write the updated content back to the file
            await fsPromises.writeFile(configPath, updatedContent, 'utf8');
            console.log('Configuration saved successfully');
            return;
        }

        // For other changes, use the default JSON.stringify approach
        const configContent = `// config.js - Generated ${new Date().toISOString()}

module.exports = ${JSON.stringify(config, null, 2)};`;

        await fsPromises.writeFile(configPath, configContent, 'utf8');
        console.log('Configuration saved successfully');
    } catch (error) {
        console.error('Error saving configuration:', error);
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
    getTweetCount,
    saveConfig
};
