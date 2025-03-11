// sticker.config.js
// Configuration for the sticker command

const STICKER_CONFIG = {
    prefixes: ['#sticker'],
    description: 'Cria stickers de várias formas: cite uma mensagem com imagem, envie uma imagem com #sticker, ou use #sticker [palavra-chave] para buscar e criar um sticker.',
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        noImage: 'A mensagem citada não contém uma imagem.',
        noKeyword: 'Para criar um sticker, você pode:\n1. Enviar uma imagem com #sticker\n2. Citar uma mensagem com imagem usando #sticker\n3. Usar #sticker [palavra-chave] para buscar uma imagem',
        downloadError: 'Não foi possível baixar a imagem. Tente novamente.',
        noResults: 'Nenhuma imagem encontrada para a palavra-chave fornecida.',
        error: 'Ocorreu um erro ao criar o sticker. Tente novamente.',
        notAllowed: 'Você não tem permissão para usar este comando.',
    },
    useGroupPersonality: false,
};

module.exports = STICKER_CONFIG; 