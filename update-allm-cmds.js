const fs = require('fs').promises;
const path = require('path');

// Mocking some parts to avoid side effects and errors
process.env.SUPPRESS_LOGS = 'true';

const FixedCommands = require('./src/commands/FixedCommands');
const Management = require('./src/commands/Management');
const SuperAdmin = require('./src/commands/SuperAdmin');

async function generateDocs() {
    console.log('🚀 Iniciando geração de documentação para AnythingLLM...');

    const fixedCmds = new FixedCommands();
    await fixedCmds.loadCommands();

    const management = new Management();
    const superAdmin = new SuperAdmin();

    const outputDir = path.join(__dirname, 'anythingllm');
    await fs.mkdir(outputDir, { recursive: true });

    // --- Generate Command List ---
    let cmdListMd = '# Lista Completa de Comandos - Ravena\n\n';
    cmdListMd += 'Este arquivo contém a lista de todos os comandos disponíveis no bot Ravena, separados por categoria e tipo.\n\n';

    // 1. Fixed Commands (Comuns)
    cmdListMd += '## 🛠️ Comandos Comuns (Fixed Commands)\n';
    cmdListMd += 'Estes comandos podem ser usados por qualquer membro, a menos que especificado o contrário.\n\n';

    const allFixed = fixedCmds.getAllCommands();
    const categorized = {};

    for (const cmd of allFixed) {
        if (cmd.hidden) continue;
        const cat = cmd.category || 'Geral';
        if (!categorized[cat]) categorized[cat] = [];
        categorized[cat].push(cmd);
    }

    for (const [cat, cmds] of Object.entries(categorized)) {
        cmdListMd += `### Categoria: ${cat}\n`;
        for (const cmd of cmds) {
            cmdListMd += `#### !${cmd.name}\n`;
            cmdListMd += `**Descrição:** ${cmd.description || 'Sem descrição.'}\n\n`;
            if (cmd.usage) {
                cmdListMd += `**Uso:** \`!${cmd.name} ${cmd.usage}\`\n\n`;
            }
            if (cmd.example) {
                cmdListMd += `**Exemplo:** \`!${cmd.name} ${cmd.example}\`\n\n`;
            } else if (cmd.usage) {
                // Se tiver usage mas não example, mostra o usage como exemplo simplificado
                cmdListMd += `**Exemplo de utilização:** \`!${cmd.name} ${cmd.usage.split('|')[0].trim()}\`\n\n`;
            }
            cmdListMd += '---\n\n';
        }
    }

    // 2. Management Commands (Gerência)
    cmdListMd += '## ⚙️ Comandos de Gerenciamento (Admins de Grupo)\n';
    cmdListMd += 'Estes comandos começam com o prefixo `g-` e são restritos a administradores de grupo.\n\n';

    const manageCmdMap = management.commandMap;
    for (const [cmdName, cmdData] of Object.entries(manageCmdMap)) {
        cmdListMd += `#### !g-${cmdName}\n`;
        cmdListMd += `**Descrição:** ${cmdData.description || 'Sem descrição.'}\n\n`;
        cmdListMd += '---\n\n';
    }

    // 3. SuperAdmin Commands (Dono do Bot)
    cmdListMd += '## 👑 Comandos de Super Admin (Dono do Bot)\n';
    cmdListMd += 'Estes comandos começam com o prefixo `sa-` e são exclusivos do desenvolvedor/dono do bot.\n\n';

    const saCmdMap = superAdmin.commandMap;
    for (const [cmdName, cmdData] of Object.entries(saCmdMap)) {
        cmdListMd += `#### !sa-${cmdName}\n`;
        cmdListMd += `**Descrição:** ${cmdData.description || 'Sem descrição.'}\n\n`;
        cmdListMd += '---\n\n';
    }

    await fs.writeFile(path.join(outputDir, 'cmd_list.md'), cmdListMd);
    console.log('✅ Arquivo anythingllm/cmd_list.md gerado com sucesso.');

    // --- Generate Variable List ---
    let varListMd = '# Variáveis para Comandos Personalizados\n\n';
    varListMd += 'As variáveis abaixo podem ser usadas em comandos personalizados (`!g-addCmd`) e em mensagens de boas-vindas/despedida.\n\n';

    // We can't easily call listVariables because it's async and depends on DB/Bot
    // So we'll extract the same lists defined in that method
    const sections = {
        "🚪 Boas vindas/despedidas": [
            { name: "{pessoa}", description: "Nome(s) da(s) pessoa(s) adicionada(s) no grupo" },
            { name: "{tituloGrupo}", description: "Título do grupo no whatsApp" },
            { name: "{nomeGrupo}", description: "ID do grupo na ravena" }
        ],
        "🕐 Variáveis de Sistema": [
            { name: "{day}", description: "Nome do dia atual (ex: Segunda-feira)" },
            { name: "{date}", description: "Data atual" },
            { name: "{time}", description: "Hora atual" },
            { name: "{data-hora}", description: "Hora atual (apenas o número)" },
            { name: "{data-minuto}", description: "Minuto atual (apenas o número)" },
            { name: "{data-segundo}", description: "Segundo atual (apenas o número)" },
            { name: "{data-dia}", description: "Dia atual (apenas o número)" },
            { name: "{data-mes}", description: "Mês atual (apenas o número)" },
            { name: "{data-ano}", description: "Ano atual (apenas o número)" }
        ],
        "🎲 Variáveis de Números Aleatórios": [
            { name: "{randomPequeno}", description: "Número aleatório de 1 a 10" },
            { name: "{randomMedio}", description: "Número aleatório de 1 a 100" },
            { name: "{randomGrande}", description: "Número aleatório de 1 a 1000" },
            { name: "{randomMuitoGrande}", description: "Número aleatório de 1 a 10000" },
            { name: "{rndDado-X}", description: "Simula dado de X lados (substitua X pelo número)" },
            { name: "{rndDadoRange-X-Y}", description: "Número aleatório entre X e Y (substitua X e Y)" },
            { name: "{somaRandoms}", description: "Soma dos números aleatórios anteriores na mensagem" }
        ],
        "👤 Variáveis de Contexto": [
            { name: "{pessoa}", description: "Nome do autor da mensagem" },
            { name: "{nomeAutor}", description: "Nome do autor da mensagem (mesmo que {pessoa})" },
            { name: "{group}", description: "Nome do grupo" },
            { name: "{nomeCanal}", description: "Nome do grupo (mesmo que {group})" },
            { name: "{nomeGrupo}", description: "Nome do grupo (mesmo que {group})" },
            { name: "{contador}", description: "Número de vezes que o comando foi executado" },
            { name: "{mention}", description: "Marca a pessoa mencionada (na própria mensage, na mensagem resposta ou alguém aleatório). A cada ocorrência pega um mention diferente" },
            { name: "{singleMention}", description: "Igual ao {mention}, mas troca todas as ocorrências da variável pra mesma ao invés de escolher outro membro aleatório" },
            { name: "{mentionOuEu}", description: "Igual ao {singleMention}, mas ao invés de escolher um membro aleatório caso não exista mention, marca quem enviou a mensagem" },
            { name: "{mention-5511999999999@c.us}", description: "Menciona usuário específico" }
        ],
        "🌐 Variáveis de API": [
            { name: "{reddit-XXXX}", description: "Busca mídia em um subreddit" },
            { name: "{API#GET#TEXT#url}", description: "Faz uma requisição GET e retorna o texto" },
            { name: "{API#GET#JSON#url\\ntemplate}", description: "Faz uma requisição GET e formata o JSON" },
            { name: "{API#POST#TEXT#url?param=valor}", description: "Faz uma requisição POST com parâmetros" }
        ],
        "📁 Variáveis de Arquivo": [
            { name: "{file-nomeArquivo}", description: "Envia arquivo da pasta 'data/media/'" },
            { name: "{file-pasta/}", description: "Envia até 5 arquivos da pasta 'data/media/pasta/'" }
        ],
        "🔗 Variáveis de Comando": [
            { name: "{cmd-comando arg1 arg2}", description: "Executa outro comando (criando um alias)" }
        ]
    };

    for (const [sectionName, vars] of Object.entries(sections)) {
        varListMd += `### ${sectionName}\n`;
        for (const v of vars) {
            varListMd += `- \`${v.name}\`: ${v.description}\n`;
        }
        varListMd += '\n';
    }

    await fs.writeFile(path.join(outputDir, 'cmd_variables.md'), varListMd);
    console.log('✅ Arquivo anythingllm/cmd_variables.md gerado com sucesso.');

    console.log('\n✨ Geração de documentação concluída!');
}

generateDocs().catch(err => {
    console.error('❌ Erro durante a geração:', err);
    process.exit(1);
});
