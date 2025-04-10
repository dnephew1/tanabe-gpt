// admin.config.js
// Configuration for admin commands

// Cache clear command
const CACHE_CLEAR_CONFIG = {
    prefixes: ['!cacheclear', '!clearcache'],
    description: 'Limpa o cache do bot (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao limpar o cache.'
    }
};

// Twitter debug command
const TWITTER_DEBUG_CONFIG = {
    prefixes: ['!twitterdebug', '!debugtwitter'],
    description: 'Mostra informações de debug do Twitter (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao obter informações de debug do Twitter.'
    }
};

// RSS debug command
const RSS_DEBUG_CONFIG = {
    prefixes: ['!rssdebug', '!debugrss'],
    description: 'Mostra informações de debug dos feeds RSS (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao obter informações de debug dos feeds RSS.'
    }
};

// News Status command
const NEWS_STATUS_CONFIG = {
    prefixes: ['!newsstatus'],
    description: 'Mostra o status atual do monitoramento de notícias (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao obter status do monitoramento de notícias.'
    }
};

// Force summary command
const FORCE_SUMMARY_CONFIG = {
    prefixes: ['!forcesummary'],
    description: 'Força a geração de um resumo periódico (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao forçar resumo.'
    }
};

// Config command
const CONFIG_CONFIG = {
    prefixes: ['!config'],
    description: 'Configura opções do bot (apenas admin/moderadores)',
    permissions: {
        allowedIn: 'all',
        adminOnly: false
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao configurar o bot.'
    }
};

// Check Relevance command
const CHECK_RELEVANCE_CONFIG = {
    prefixes: ['!checkrelevance'],
    description: 'Verifica por que artigos não estão sendo considerados relevantes (apenas admin)',
    permissions: {
        allowedIn: 'all',
        adminOnly: true
    },
    autoDelete: {
        errorMessages: true,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        error: 'Erro ao verificar relevância de artigos.'
    }
};

module.exports = {
    CACHE_CLEAR_CONFIG,
    TWITTER_DEBUG_CONFIG,
    RSS_DEBUG_CONFIG,
    NEWS_STATUS_CONFIG,
    FORCE_SUMMARY_CONFIG,
    CONFIG_CONFIG,
    CHECK_RELEVANCE_CONFIG
}; 