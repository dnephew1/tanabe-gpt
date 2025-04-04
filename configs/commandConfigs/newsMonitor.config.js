const { EVALUATE_TWEET, EVALUATE_ARTICLE, SUMMARIZE_CONTENT } = require('../../prompts/newsMonitor');

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;

// Unified News Monitor configuration
const NEWS_MONITOR_CONFIG = {
    enabled: true,  // Master toggle for news monitoring
    TARGET_GROUP: GROUP_LF,  // Group to send news updates to
    
    // Twitter-specific configuration
    TWITTER_ENABLED: false,   // Toggle for Twitter source
    TWITTER_CHECK_INTERVAL: 960000,  // 16 minutes in milliseconds (API rate limit consideration)
    TWITTER_ACCOUNTS: [
        {
            username: 'BreakingNews',
            userId: '6017542',
            lastTweetId: '1874590993955123330'
        }
    ],
    
    // RSS-specific configuration
    RSS_ENABLED: true,       // Toggle for RSS source
    RSS_CHECK_INTERVAL: 3600000,  // 1 hour in milliseconds (batch processing window)
    TWO_STAGE_EVALUATION: true,  // Enable two-stage evaluation to optimize token usage
    FEEDS: [
        {
            id: 'g1',
            name: 'G1',
            url: 'https://g1.globo.com/rss/g1/',
            language: 'pt'
        }
    ],
    
    // Prompts for content evaluation and summarization
    PROMPTS: {
        EVALUATE_TWEET,
        EVALUATE_ARTICLE,
        EVALUATE_ARTICLE_TITLE: `
Título do Artigo para Avaliação Preliminar:
{title}

Instruções:
Avalie apenas o título acima para determinar se a notícia tem potencial de ser relevante globalmente.

Retorne apenas a palavra "irrelevant" se o título claramente indicar alguma das condições abaixo:
- Notícia local com impacto mínimo
- Celebridades (exceto mortes ou impacto global)
- Política de EUA (exceto eventos críticos)
- Esportes não significativos

Retorne a palavra "relevant" se o título sugerir:
- Notícia global crítica
- Relacionada ao Brasil
- Eventos de impacto global
- Descobertas científicas importantes
- Eventos esportivos significativos

Esta é apenas uma avaliação preliminar para filtrar conteúdo obviamente irrelevante. Não analise em detalhes, apenas faça um julgamento rápido baseado no título.
        `,
        BATCH_EVALUATE_TITLES: `
Lista de Títulos de Artigos para Avaliação em Lote:
{titles}

Instruções:
Avalie cada título acima para determinar quais têm potencial de serem relevantes globalmente.

Um título deve ser considerado potencialmente irrelevante se claramente indicar alguma das condições abaixo:
- Notícia local com impacto mínimo
- Celebridades (exceto mortes ou impacto global)
- Política de EUA (exceto eventos críticos)
- Esportes não significativos

Um título deve ser considerado potencialmente relevante se sugerir:
- Notícia global crítica
- Relacionada ao Brasil
- Eventos de impacto global
- Descobertas científicas importantes
- Eventos esportivos significativos

Esta é apenas uma avaliação preliminar para filtrar conteúdo obviamente irrelevante.
Responda apenas com os números dos títulos que você considera RELEVANTES, separados por vírgula. 
Por exemplo: "1, 3, 5" (se os títulos 1, 3 e 5 forem relevantes).
Se nenhum título for relevante, responda com "0".
        `,
        BATCH_EVALUATE_FULL_CONTENT: `
Lote de Artigos para Avaliação Final:

{articles}

Instruções:
Avalie todos os artigos acima e determine quais são realmente relevantes e devem ser compartilhados com o grupo.

Um artigo deve ser considerado RELEVANTE se atender a algum dos critérios abaixo:
- Trata-se de uma notícia global crítica
- Está relacionada ao Brasil ou impacta diretamente o Brasil
- Envolve eventos de grande impacto global
- Destaca descobertas científicas ou avanços importantes
- Discute eventos esportivos significativos
- É um escândalo político, econômico ou social importante

Um artigo deve ser considerado IRRELEVANTE se:
- For uma notícia local com impacto mínimo
- For sobre celebridades (exceto mortes ou impacto global)
- For sobre política dos EUA (exceto eventos críticos)
- For sobre esportes não significativos ou resultados rotineiros
- For duplicado ou muito similar a outro artigo no lote

IMPORTANTE:
1. Liste apenas os números dos artigos RELEVANTES em ordem de importância (do mais relevante para o menos)
2. Se houver mais de 2 artigos relevantes, selecione apenas os 2 mais importantes para compartilhar
3. Para cada artigo relevante selecionado, inclua uma breve justificativa (1-2 frases) explicando por que ele é relevante
4. Seu formato de resposta deve ser:

SELECIONADOS:
1. [número do artigo mais relevante]: [justificativa]
2. [número do segundo artigo mais relevante]: [justificativa]

Se nenhum artigo for relevante, responda apenas com "NENHUM RELEVANTE".
        `,
        SUMMARIZE_CONTENT
    }
};

module.exports = NEWS_MONITOR_CONFIG; 