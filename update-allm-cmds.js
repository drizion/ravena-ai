const fs = require("fs").promises;
const path = require("path");

// Mocking some parts to avoid side effects and errors
process.env.SUPPRESS_LOGS = "true";

const FixedCommands = require("./src/commands/FixedCommands");
const Management = require("./src/commands/Management");
const SuperAdmin = require("./src/commands/SuperAdmin");

async function generateDocs() {
	console.log("🚀 Iniciando geração de documentação consolidada para AnythingLLM...");

	const fixedCmds = new FixedCommands();
	await fixedCmds.loadCommands();

	const management = new Management();
	const superAdmin = new SuperAdmin();

	const outputDir = path.join(__dirname, "anythingllm");
	await fs.mkdir(outputDir, { recursive: true });

	// 1. Load Base Information
	let finalMd = "";
	try {
		finalMd = await fs.readFile(path.join(outputDir, "base_info.md"), "utf-8");
		finalMd += "\n\n---\n\n";
	} catch (err) {
		console.warn("⚠️ Arquivo base_info.md não encontrado. Usando cabeçalho padrão.");
		finalMd = "# Documentação Ravena (Gerada)\n\n";
	}

	// --- 2. Generate Command List ---
	finalMd += "# 📚 Referência de Comandos\n\n";
	finalMd += "Abaixo está a lista de todos os comandos que você pode sugerir aos usuários.\n\n";

	// 2.1 Fixed Commands (Comuns)
	finalMd += "## 🛠️ Comandos Comuns (Fixed Commands)\n";
	finalMd += "Estes comandos podem ser usados por qualquer membro.\n\n";

	const allFixed = fixedCmds.getAllCommands();
	const categorized = {};

	for (const cmd of allFixed) {
		if (cmd.hidden) continue;
		const cat = cmd.category || "Geral";
		if (!categorized[cat]) categorized[cat] = [];
		categorized[cat].push(cmd);
	}

	for (const [cat, cmds] of Object.entries(categorized)) {
		finalMd += `### Categoria: ${cat}\n`;
		for (const cmd of cmds) {
			finalMd += `#### !${cmd.name}\n`;
			finalMd += `**Descrição:** ${cmd.description || "Sem descrição."}\n\n`;
			if (cmd.usage) {
				finalMd += `**Uso:** \`!${cmd.name} ${cmd.usage}\`\n\n`;
			}
			if (cmd.example) {
				finalMd += `**Exemplo:** \`!${cmd.name} ${cmd.example}\`\n\n`;
			} else if (cmd.usage) {
				finalMd += `**Exemplo:** \`!${cmd.name} ${cmd.usage.split("|")[0].trim()}\`\n\n`;
			}
			finalMd += "---\n\n";
		}
	}

	// 2.2 Management Commands (Gerência)
	finalMd += "## ⚙️ Comandos de Gerenciamento\n";
	finalMd += "Começam com `!g-` e são restritos a administradores.\n\n";

	const manageCmdMap = management.commandMap;
	for (const [cmdName, cmdData] of Object.entries(manageCmdMap)) {
		finalMd += `#### !g-${cmdName}\n`;
		finalMd += `**Descrição:** ${cmdData.description || "Sem descrição."}\n\n`;
		finalMd += "---\n\n";
	}

	// 2.3 SuperAdmin Commands
	finalMd += "## 👑 Comandos de Super Admin\n";
	finalMd += "Começam com `!sa-` e são exclusivos do dono do bot.\n\n";

	const saCmdMap = superAdmin.commandMap;
	for (const [cmdName, cmdData] of Object.entries(saCmdMap)) {
		finalMd += `#### !sa-${cmdName}\n`;
		finalMd += `**Descrição:** ${cmdData.description || "Sem descrição."}\n\n`;
		finalMd += "---\n\n";
	}

	// --- 3. Generate Variable List ---
	finalMd += "# 🎲 Variáveis para Comandos Personalizados\n\n";
	finalMd += "Use estas variáveis ao sugerir a criação de comandos com `!g-addCmd`.\n\n";

	const sections = {
		"🚪 Boas vindas/despedidas": [
			{ name: "{pessoa}", description: "Nome da pessoa" },
			{ name: "{tituloGrupo}", description: "Título do grupo" }
		],
		"🕐 Variáveis de Sistema": [
			{ name: "{day}", description: "Nome do dia (ex: Segunda-feira)" },
			{ name: "{date}", description: "Data atual" },
			{ name: "{time}", description: "Hora atual" },
			{ name: "{data-hora}", description: "Hora (HH)" },
			{ name: "{data-dia}", description: "Dia (DD)" },
			{ name: "{data-mes}", description: "Mês (MM)" },
			{ name: "{data-ano}", description: "Ano (YYYY)" }
		],
		"🎲 Números Aleatórios": [
			{ name: "{randomPequeno}", description: "1 a 10" },
			{ name: "{randomMedio}", description: "1 a 100" },
			{ name: "{randomGrande}", description: "1 a 1000" },
			{ name: "{rndDado-X}", description: "Dado de X lados" },
			{ name: "{rndDadoRange-X-Y}", description: "Aleatório entre X e Y" }
		],
		"👤 Contexto e Menções": [
			{ name: "{pessoa}", description: "Nome do autor" },
			{ name: "{group}", description: "Nome do grupo" },
			{ name: "{contador}", description: "Contagem de execuções" },
			{ name: "{mention}", description: "Marca alguém (mencionado ou aleatório)" },
			{ name: "{singleMention}", description: "Marca a mesma pessoa em todas as ocorrências" },
			{ name: "{mentionOuEu}", description: "Marca alguém ou o autor se não houver menção" },
			{ name: "{membroRandom}", description: "Nome de um membro aleatório" }
		],
		"🌐 APIs e Web": [
			{ name: "{weather:cidade}", description: "Clima atual na cidade" },
			{ name: "{reddit-subreddit}", description: "Mídia aleatória de um subreddit" },
			{ name: "{API#GET#TEXT#url}", description: "Resultado de texto de uma API" }
		],
		"📁 Outros": [
			{ name: "{file-nome}", description: "Envia arquivo de 'data/media/'" },
			{ name: "{cmd-comando}", description: "Executa outro comando (alias)" }
		]
	};

	for (const [sectionName, vars] of Object.entries(sections)) {
		finalMd += `### ${sectionName}\n`;
		for (const v of vars) {
			finalMd += `- \`${v.name}\`: ${v.description}\n`;
		}
		finalMd += "\n";
	}

	// --- 4. Extra: Random Variables from JSON ---
	try {
		const customVarsData = JSON.parse(
			await fs.readFile(path.join(__dirname, "data", "custom-variables.json"), "utf-8")
		);
		const randomKeys = Object.keys(customVarsData);
		if (randomKeys.length > 0) {
			finalMd += "### 🎭 Variáveis de Sorteio (Aleatórias)\n";
			finalMd +=
				"Estas variáveis escolhem um item aleatório de uma lista pré-definida. Sugira-as para comandos divertidos.\n\n";
			for (const key of randomKeys) {
				finalMd += `- \`{${key}}\`\n`;
			}
			finalMd += "\n";
		}
	} catch (err) {
		console.warn(
			"⚠️ Não foi possível carregar custom-variables.json para a lista de variáveis aleatórias."
		);
	}

	await fs.writeFile(path.join(outputDir, "ravena-anythingllm.md"), finalMd);
	console.log("✅ Arquivo anythingllm/ravena-anythingllm.md gerado com sucesso!");

	console.log("\n✨ Processo concluído!");
}

generateDocs().catch((err) => {
	console.error("❌ Erro durante a geração:", err);
	process.exit(1);
});
