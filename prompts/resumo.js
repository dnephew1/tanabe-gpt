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
};

module.exports = RESUMO; 