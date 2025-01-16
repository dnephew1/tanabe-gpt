// twitter.js

const TWITTER = {
    EVALUATE_NEWS: `
Tweet para Avaliação:
{post}

Instruções:
Avalie o tweet acima com base nos seguintes critérios.

Retorne apenas a palavra "null" se qualquer uma das condições abaixo se aplicar:

- A notícia já foi mencionada nos tweets anteriores (duplicada ou atualização, veja os tweets anteriores após as instruções).
- Não se trata de um evento crítico ou relevante globalmente.
- É sobre política dos EUA (a menos que envolva eventos significativos, controvérsias ou mortes).
- É apenas uma atualização de uma notícia previamente mencionada, sem introduzir novas informações substanciais (veja os tweets anteriores após as instruções)).
- Diz respeito a celebridades (a menos que envolva morte ou impacto global).
- É uma notícia local com impacto mínimo no cenário global.

Retorne a palavra "relevant" se o tweet atender a algum dos critérios abaixo:

- Trata-se de uma notícia global crítica.
- Está relacionada ao Brasil ou impacta diretamente o Brasil.
- Envolve eventos de grande impacto global.
- Destaca descobertas científicas ou avanços importantes.
- Discute eventos esportivos significativos com relevância internacional.

Notas Adicionais:

- Marque "relevant" apenas se o tweet apresentar implicações significativas ou efeitos de grande alcance.
- Para mudanças regulatórias, marque como "relevant" somente se a mudança gerar ampla controvérsia ou discussão global.
- Evite marcar atualizações como "relevant" a menos que adicionem informações substanciais à notícia original.

Tweets Analisados Anteriormente (para Contexto):
{previous_posts}
    `
};

module.exports = TWITTER; 