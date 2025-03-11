/**
 * Test Configuration
 */

const path = require('path');

// Client IDs
const TEST_CLIENT_ID = 'test-client';

// Try to load admin number from credentials
let adminNumber, botNumber;
try {
    const credentials = require('../configs/credentials');
    adminNumber = credentials.ADMIN_NUMBER;
    botNumber = credentials.BOT_NUMBER;
} catch (error) {
    console.warn('Could not load credentials:', error.message);
    adminNumber = process.env.ADMIN_NUMBER || '5511999999999'; // Fallback
    botNumber = process.env.BOT_NUMBER || '5511999999999'; // Fallback
}

module.exports = {
    // Target group for testing
    TARGET_GROUP: 'Another Group',
    
    // Admin number for admin-only tests (should match your WhatsApp number)
    ADMIN_NUMBER: adminNumber,
    
    // Bot number for direct messaging
    BOT_NUMBER: botNumber,
    
    // Test timing settings
    DELAY_BETWEEN_TESTS: 8000, // 8 seconds between tests
    RESPONSE_TIMEOUT: 60000, // 60 seconds to wait for a response
    BOT_STARTUP_WAIT: 15000, // 15 seconds to wait for bot to start
    
    // WhatsApp client settings
    CLIENT_CONFIG: {
        clientId: TEST_CLIENT_ID,
        dataPath: path.join(__dirname, '..', '.wwebjs_auth_test'),
        puppeteerOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    },
    
    // Test categories
    TEST_CATEGORIES: {
        SUMMARY: true,      // Test summary commands
        NEWS: true,         // Test news commands
        CHAT: true,         // Test chat commands
        MEDIA: true,        // Test media commands
        ADMIN: true,        // Test admin commands
        MISC: true          // Test miscellaneous commands
    },
    
    // Whitelist verification
    VERIFY_WHITELIST: true,
    
    // Sample files
    SAMPLES: {
        IMAGE: 'sample.jpg',
        PDF: 'sample.pdf',
        AUDIO: 'sample.ogg',
        RESUMO_STICKER: 'resumo.webp',
        AYUB_STICKER: 'ayub.webp'
    },
    
    // Language settings
    LANGUAGE: 'pt-BR',
    
    // Text normalization for Portuguese
    NORMALIZE_TEXT: true,
    
    // Test result messages
    RESULT_MESSAGES: {
        SUMMARY: {
            PASSED: 'Testes concluídos com sucesso',
            FAILED: 'Alguns testes falharam',
            SKIPPED: 'Alguns testes foram ignorados'
        }
    }
}; 