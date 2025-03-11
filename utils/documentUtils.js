const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);
const logger = require('./logger');
const config = require('../configs');
const pdf = require('pdf-parse');

// Ensure we have the required configuration
const DEFAULT_SETTINGS = {
    maxCharacters: 5000,
    supportedFormats: ['.pdf', '.docx', '.doc', '.txt', '.rtf'],
    tempDir: '.'
};

// MIME type to extension mapping
const MIME_TO_EXT = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/msword': '.doc',
    'text/plain': '.txt',
    'application/rtf': '.rtf'
};

function getDocumentSettings() {
    return config.RESUMO?.documentSettings || DEFAULT_SETTINGS;
}

async function extractTextFromPDF(filePath) {
    try {
        // Temporarily redirect console.warn to suppress PDF warnings
        const originalWarn = console.warn;
        console.warn = function(msg) {
            // Only suppress TT warnings from pdf-parse
            if (!msg.includes('TT: undefined function')) {
                originalWarn.apply(console, arguments);
            }
        };
        
        // Read file as buffer
        const dataBuffer = await fs.promises.readFile(filePath);
        
        try {
            // Parse PDF using pdf-parse
            const data = await pdf(dataBuffer);
            
            // Get text content
            let text = data.text || '';
            
            // Clean up text
            text = text.replace(/\s+/g, ' ').trim();
            
            return text || 'No readable text found in PDF';
        } finally {
            // Restore original console.warn
            console.warn = originalWarn;
        }
    } catch (error) {
        logger.error('Error extracting text from PDF:', error);
        throw new Error('Failed to extract text from PDF');
    }
}

async function extractTextFromDOCX(filePath) {
    try {
        // Extract document.xml directly to current directory
        const docxmlPath = path.join(path.dirname(filePath), 'document.xml');
        await execAsync(`unzip -p "${filePath}" word/document.xml > "${docxmlPath}"`);
        
        // Read the XML and extract text content
        const xmlContent = await fs.promises.readFile(docxmlPath, 'utf8');
        const textContent = xmlContent
            .replace(/<[^>]+>/g, '') // Remove XML tags
            .replace(/\s+/g, ' ')    // Normalize whitespace
            .trim();
        
        // Clean up the temporary XML file
        await fs.promises.unlink(docxmlPath).catch(() => {});
        
        return textContent;
    } catch (error) {
        logger.error('Error extracting text from DOCX:', error);
        throw new Error('Failed to extract text from DOCX');
    }
}

async function extractTextFromDocument(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const settings = getDocumentSettings();
    
    try {
        let text;
        switch (ext) {
            case '.pdf':
                text = await extractTextFromPDF(filePath);
                break;
            case '.docx':
            case '.doc':
                text = await extractTextFromDOCX(filePath);
                break;
            case '.txt':
            case '.rtf':
                text = await fs.promises.readFile(filePath, 'utf8');
                break;
            default:
                throw new Error('Unsupported file format');
        }
        
        // Limit text to maxCharacters
        if (text.length > settings.maxCharacters) {
            text = text.substring(0, settings.maxCharacters);
        }
        
        return text;
    } catch (error) {
        logger.error('Error processing document:', error);
        throw error;
    }
}

async function downloadAndProcessDocument(message) {
    const settings = getDocumentSettings();
    logger.debug('Document settings:', settings);

    const media = await message.downloadMedia();
    if (!media) {
        throw new Error('Failed to download document');
    }
    
    // Determine file extension from MIME type or filename
    let ext = '';
    if (media.mimetype && MIME_TO_EXT[media.mimetype]) {
        ext = MIME_TO_EXT[media.mimetype];
    } else if (media.filename) {
        ext = path.extname(media.filename).toLowerCase();
    }

    logger.debug('Processing document:', { 
        filename: media.filename,
        mimetype: media.mimetype,
        determinedExtension: ext
    });
    
    if (!settings.supportedFormats.includes(ext)) {
        logger.error('Unsupported file format:', ext);
        throw new Error('Unsupported file format');
    }
    
    // Save file to parent directory
    const filePath = path.join('.', `doc_${Date.now()}${ext}`);
    await fs.promises.writeFile(filePath, media.data, 'base64');
    
    try {
        // Extract text
        const text = await extractTextFromDocument(filePath);
        
        // Clean up
        await fs.promises.unlink(filePath);
        
        return text;
    } catch (error) {
        // Clean up on error
        await fs.promises.unlink(filePath).catch(() => {});
        throw error;
    }
}

module.exports = {
    downloadAndProcessDocument
}; 