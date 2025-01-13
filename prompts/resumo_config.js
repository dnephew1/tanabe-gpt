// resumo_config.js

const RESUMO_CONFIG = {
    GENERATE_TEMPLATE: 
`Create a concise prompt template in Portuguese for summarizing WhatsApp group messages. The group's context is: "{groupInfo}".
The prompt should:
1. Ask for a summary of unread messages
2. Include specific aspects to consider based on the group's context
3. Request a concise and informative summary
4. Be written in a formal tone
5. Not exceed 5 bullet points
6. Focus on the most relevant information for this specific group type

Format the response as a direct prompt template, without any explanations or metadata.`
};

module.exports = RESUMO_CONFIG; 