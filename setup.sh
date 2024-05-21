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

sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget libgbm-dev

mkdir stickers

# Provide feedback to the user
echo "Setup complete. index.js and .env files created if they didn't exist, npm packages installed, global npm packages updated, and .env file populated with the OpenAI API key."
