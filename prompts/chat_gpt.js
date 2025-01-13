// chat_gpt.js

const CHAT_GPT = {
    DEFAULT: `
{name} está perguntando: {question}

Para o seu contexto, abaixo estão as últimas {maxMessages} mensagens enviadas no chat, caso seja necessário para a sua resposta:

COMEÇO DAS ÚLTIMAS {maxMessages} MENSAGENS:
{messageHistory}
FIM DAS ÚLTIMAS {maxMessages} MENSAGENS.

{groupPersonality}
        `,
    WITH_CONTEXT: `
{name} está perguntando: {question}

Para contexto adicional: {context}

Para o seu contexto, abaixo estão as últimas {maxMessages} mensagens enviadas no chat, caso seja necessário para a sua resposta:

COMEÇO DAS ÚLTIMAS {maxMessages} MENSAGENS:
{messageHistory}
FIM DAS ÚLTIMAS {maxMessages} MENSAGENS.

{groupPersonality}
        `,
};

module.exports = CHAT_GPT; 