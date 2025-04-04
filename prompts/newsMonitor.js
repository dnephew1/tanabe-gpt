// newsMonitor.js - Prompts for news monitoring system

const NEWS_MONITOR = {
    EVALUATE_TWEET: `
Tweet para Avaliação:
{post}

Instruções:
Avalie o tweet acima com base nos seguintes critérios. Seja extremamente seletivo, já que esses artigos serão enviados para um grupo de WhatsApp no qual não deve conter muito spam de mensagens.

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
    `,
    
    EVALUATE_ARTICLE: `
Artigo para Avaliação:
{article}

Instruções:
Avalie o artigo acima com base nos seguintes critérios. Seja extremamente seletivo, já que esses artigos serão enviados para um grupo de WhatsApp no qual não deve conter muito spam de mensagens.

Retorne apenas a palavra "null" se qualquer uma das condições abaixo se aplicar:

- Não se trata de um evento crítico ou relevante globalmente ou ao Brasil ou a cidade deSão Paulo.
- A notícia já foi mencionada nos artigos anteriores (duplicada ou atualização, veja os artigos anteriores após as instruções).
- É apenas uma atualização de uma notícia previamente mencionada, sem introduzir novas informações substanciais.
- É uma notícia local com impacto mínimo no cenário global.

Retorne a palavra "relevant" se o artigo atender a algum dos critérios abaixo:

- Trata-se de uma notícia global crítica.
- rata-se de uma notícia crítica relacionada ao Brasil ou impacta diretamente o Brasil.
- Trata-se de uma notícia crítica sobre a cidade de São Paulo.
- Envolve eventos de grande impacto global.
- Destaca descobertas científicas ou avanços importantes.
- Discute eventos esportivos significativos com relevância internacional ou ao Brasil.
- Escandalos políticos, econômicos ou de outra natureza.

Notas Adicionais:

- Marque "relevant" apenas se o artigo apresentar implicações significativas ou efeitos de grande alcance.
- Para mudanças regulatórias, marque como "relevant" somente se a mudança gerar ampla controvérsia ou discussão global.
- Evite marcar atualizações como "relevant" a menos que adicionem informações substanciais à notícia original.

Artigos Analisados Anteriormente (para Contexto):
{previous_articles}
    `,
    
    SUMMARIZE_CONTENT: `
Título: {title}

Conteúdo:
{content}

Instruções:
Gere um resumo conciso deste conteúdo em 3 pontos de destaque (formato bullet point). 
Cada ponto deve comunicar uma informação factual essencial contida no artigo.

Requisitos:
1. Use 3 pontos apenas (bullet points) com o símbolo "•" no início de cada ponto
2. Cada ponto deve ter no máximo 10-15 palavras (curto e objetivo)
3. Mantenha a informação puramente factual (evite opiniões ou especulações)
4. Inclua apenas os fatos mais importantes e impactantes
5. Ordene os pontos do mais para o menos importante

Exemplos de formato:
• Primeiro ponto importante e factual do artigo.
• Segundo ponto importante comunicando outro aspecto essencial.
• Terceiro ponto com informação complementar relevante.
    `
};

module.exports = NEWS_MONITOR; 