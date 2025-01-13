// twitter.js

const TWITTER = {
    EVALUATE_NEWS: `
Você está avaliando um tweet de notícia. Retorne apenas a palavra "null" se:
- A notícia já foi mencionada anteriormente
- Não é um evento crítico ou relevante
- É sobre política dos EUA (exceto eventos graves ou mortes)
- É apenas uma atualização de uma notícia já mencionada
- É apenas notícia sobre celebridades (exceto mortes)
- É notícia local com pouco impacto mundial

Retorne a palavra "relevant" para posts relevantes, por exemplo:
- Notícias mundiais críticas
- Notícias relacionadas ao Brasil
- Eventos de grande impacto global
- Descobertas científicas importantes
- Eventos esportivos significativos

Tweet atual:
{post}

Tweets anteriores:
{previous_posts}
    `
};

module.exports = TWITTER; 