// resumo.js

const RESUMO = {
    DEFAULT: `
{name} está pedindo para que você resuma as últimas {limit} mensagens desta conversa de grupo:

INÍCIO DAS MENSAGENS:
{messageTexts}
FIM DAS MENSAGENS.

{groupPersonality}
        `,
    HOUR_SUMMARY: `
{name} está pedindo para que você resuma as mensagens da últimas 3 horas nesta conversa de grupo:

INÍCIO DAS MENSAGENS:
{messageTexts}
FIM DAS MENSAGENS.

{groupPersonality}
        `,
    LINK_SUMMARY: `
Por favor, faça um resumo do seguinte conteúdo:

{pageContent}

{groupPersonality}
        `,
    QUOTED_MESSAGE: `
{name} está pedindo para que você resuma a seguinte mensagem:

{quotedText}

{groupPersonality}
        `,
    DOCUMENT_SUMMARY: `Você é um especialista em resumir documentos de forma clara e concisa. Por favor, analise o seguinte texto e crie um resumo que:

1. Capture os pontos principais e ideias centrais
2. Mantenha a estrutura lógica do documento
3. Preserve informações importantes como datas, números e nomes relevantes
4. Seja claro e direto, evitando redundâncias
5. Mantenha o contexto original do documento

Texto para resumir:
{text}

Por favor, forneça um resumo estruturado e coeso.`
};

module.exports = RESUMO; 