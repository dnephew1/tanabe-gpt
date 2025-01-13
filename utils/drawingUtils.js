const axios = require('axios');
const config = require('../config');
const { getOpenAIClient } = require('./openaiUtils');

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
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: config.SYSTEM.OPENAI_MODEL || "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error('OpenAI API Error:', error.message);
        throw error;
    }
}

module.exports = {
    generateImage,
    improvePrompt
}; 