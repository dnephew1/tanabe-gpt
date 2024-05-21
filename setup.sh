#!/bin/bash

# Create index.js and .env files if they don't exist
touch index.js .env

# Prompt the user to enter the OpenAI API key
read -p "Enter your OpenAI API key: " openai_api_key

# Check if OPENAI_API_KEY already exists in .env
if grep -q "OPENAI_API_KEY" .env; then
    # Update the existing key
    sed -i "s/^OPENAI_API_KEY=.*/OPENAI_API_KEY=$openai_api_key/" .env
else
    # Add the key to the .env file
    echo "OPENAI_API_KEY=$openai_api_key" >> .env
fi

# Install npm packages without auditing
npm install --no-audit

# Update global npm packages without auditing
npm update -g --no-audit

# Provide feedback to the user
echo "Setup complete. index.js and .env files created if they didn't exist, npm packages installed, global npm packages updated, and .env file populated with the OpenAI API key."
