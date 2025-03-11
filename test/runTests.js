#!/usr/bin/env node

/**
 * Test Runner Script
 * 
 * This script provides a simple CLI interface to run the bot tests.
 * Usage: node runTests.js [category1,category2,...]
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Parse command line arguments
const args = process.argv.slice(2);
let categories = null;

if (args.length > 0) {
    categories = args[0].split(',');
    
    // Validate categories
    const validCategories = Object.keys(config.TEST_CATEGORIES);
    const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
    
    if (invalidCategories.length > 0) {
        console.error(`Invalid categories: ${invalidCategories.join(', ')}`);
        console.error(`Valid categories are: ${validCategories.join(', ')}`);
        process.exit(1);
    }
    
    // Update config to only run specified categories
    validCategories.forEach(cat => {
        config.TEST_CATEGORIES[cat] = categories.includes(cat);
    });
}

// Check for sample files
const samplesDir = path.join(__dirname, 'samples');
if (!fs.existsSync(samplesDir)) {
    console.log('Creating samples directory...');
    fs.mkdirSync(samplesDir, { recursive: true });
}

const requiredSamples = [
    { name: config.SAMPLES.IMAGE, type: 'image' },
    { name: config.SAMPLES.PDF, type: 'document' },
    { name: config.SAMPLES.AUDIO, type: 'audio' }
];

const missingSamples = requiredSamples.filter(sample => 
    !fs.existsSync(path.join(samplesDir, sample.name))
);

if (missingSamples.length > 0) {
    console.warn('Warning: The following sample files are missing:');
    missingSamples.forEach(sample => {
        console.warn(`  - ${sample.name} (${sample.type})`);
    });
    console.warn(`Please add these files to the ${samplesDir} directory before running tests.`);
    
    // Ask if user wants to continue
    if (missingSamples.length === requiredSamples.length) {
        console.error('All sample files are missing. Tests will likely fail.');
        process.exit(1);
    }
}

// Run the tests
console.log('Starting bot tests...');
if (categories) {
    console.log(`Running tests for categories: ${categories.join(', ')}`);
} else {
    console.log('Running all tests');
}

// Run the bot tester
const tester = spawn('node', [path.join(__dirname, 'botTester.js')], {
    stdio: 'inherit'
});

tester.on('close', (code) => {
    if (code === 0) {
        console.log('Tests completed successfully');
    } else {
        console.error(`Tests failed with code ${code}`);
    }
});

// Handle interrupts
process.on('SIGINT', () => {
    console.log('Interrupting tests...');
    tester.kill('SIGINT');
});

process.on('SIGTERM', () => {
    console.log('Terminating tests...');
    tester.kill('SIGTERM');
}); 