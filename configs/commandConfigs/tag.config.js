// configs/commandConfigs/tag.config.js
require('dotenv').config({ path: './configs/.env' });

// Get group names from environment variables
const GROUP_LF = process.env.GROUP_LF;
const GROUP_AG = process.env.GROUP_AG;

// Helper function to get all member names for a specific group prefix
function getMembersByPrefix(prefix) {
    const members = {};
    Object.keys(process.env).forEach(key => {
        if (key.startsWith(`MEMBER_${prefix}`)) {
            const memberKey = key;
            members[memberKey] = process.env[key];
        }
    });
    return members;
}

// Get member values by group
const LF_MEMBERS = getMembersByPrefix('LF');
const AG_MEMBERS = getMembersByPrefix('AG');

// Tag command configuration
const TAG_CONFIG = {
    description: 'Sistema de tags para mencionar grupos específicos de pessoas.',
    autoDelete: {
        errorMessages: false,
        commandMessages: false,
        deleteTimeout: 60000,
    },
    errorMessages: {
        notAllowed: 'Você não tem permissão para usar este comando.',
        noMatches: 'Nenhum membro encontrado para esta tag.',
    },
    useGroupPersonality: false,
    // Define tags per group
    groupTags: {
        [GROUP_LF]: {
            '@medicos': {
                members: [
                    process.env.MEMBER_LF1, 
                    process.env.MEMBER_LF2
                ].filter(Boolean),
                description: 'Médicos do grupo'
            },
            '@engenheiros': {
                members: [
                    process.env.MEMBER_LF3, 
                    process.env.MEMBER_LF4, 
                    process.env.MEMBER_LF5, 
                    process.env.MEMBER_LF6, 
                    process.env.MEMBER_LF7
                ].filter(Boolean),
                description: 'Engenheiros do grupo'
            },
            '@cartola': {
                members: [
                    process.env.MEMBER_LF8, 
                    process.env.MEMBER_LF7, 
                    process.env.MEMBER_LF2, 
                    process.env.MEMBER_LF9, 
                    process.env.MEMBER_LF5, 
                    process.env.MEMBER_LF6
                ].filter(Boolean),
                description: 'Jogadores de Cartola FC'
            }
        },
        [GROUP_AG]: {
            '@team1': {
                members: [
                    process.env.MEMBER_AG1, 
                    process.env.MEMBER_AG2, 
                    process.env.MEMBER_AG3
                ].filter(Boolean),
                description: 'Team 1 members'
            },
            '@team2': {
                members: [
                    process.env.MEMBER_AG4, 
                    process.env.MEMBER_AG5, 
                    process.env.MEMBER_AG6
                ].filter(Boolean),
                description: 'Team 2 members'
            },
            '@managers': {
                members: [
                    process.env.MEMBER_AG7, 
                    process.env.MEMBER_AG8
                ].filter(Boolean),
                description: 'Management team'
            }
        }
    },
    // Special tags that work the same in all groups
    specialTags: {
        '@all': {
            type: 'all_members',
            description: 'Todos os membros do grupo'
        },
        '@everyone': {
            type: 'all_members',
            description: 'Todos os membros do grupo'
        },
        '@todos': {
            type: 'all_members',
            description: 'Todos os membros do grupo'
        },
        '@admin': {
            type: 'admin_only',
            description: 'Apenas administradores do grupo'
        },
        '@admins': {
            type: 'admin_only',
            description: 'Apenas administradores do grupo'
        }
    }
};

module.exports = TAG_CONFIG; 