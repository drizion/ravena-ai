const path = require("path");
const Logger = require("../utils/Logger");
const Database = require("../utils/Database");
const Status = require("../utils/Status");
const LLMService = require("../services/LLMService");
const Command = require("../models/Command");
const ReturnMessage = require("../models/ReturnMessage");
const fs = require("fs").promises;
const { extractFrames } = require("../utils/Conversions");

const logger = new Logger("summary-commands");
const database = Database.getInstance();
const llmService = LLMService.getInstance();
const DB_NAME = "summaries";

// Initialize Database
database.getSQLiteDb(
	DB_NAME,
	`
  CREATE TABLE IF NOT EXISTS conversations (
    group_id TEXT PRIMARY KEY,
    json_data TEXT
  );
`,
	true
);

const mediaAnalysisSchema = {
	type: "json_schema",
	json_schema: {
		name: "media_analysis",
		schema: {
			type: "object",
			properties: {
				description: {
					type: "string"
				},
				type: {
					type: "string",
					enum: ["vida-real", "anime", "desenho", "jogo", "ia-generated", "documento", "outros"]
				},
				nsfw: {
					type: "boolean"
				}
			},
			required: ["description", "type", "nsfw"]
		}
	}
};

/**
 * Analisa um vídeo e retorna uma descrição
 * @param {Object} message - A mensagem contendo o vídeo
 * @returns {Promise<string|boolean>} - Descrição do vídeo ou false
 */
async function analyzeVideo(message) {
	const tempDirBase = path.join(__dirname, "../../temp");
	const tempDir = path.join(tempDirBase, `video_analysis_${Date.now()}`);
	const videoPath = path.join(tempDirBase, `video_${Date.now()}.mp4`);

	try {
		// Garante diretórios
		await fs.mkdir(tempDirBase, { recursive: true });

		// Baixa a mídia
		if (!message.downloadMedia) {
			return false;
		}

		const media = await message.downloadMedia();
		if (!media || !media.data) {
			return false;
		}

		await fs.writeFile(videoPath, Buffer.from(media.data, "base64"));

		// Extrai frames usando a função utilitária
		const framePaths = await extractFrames(videoPath, tempDir, 30);

		// Lê os frames
		const frames = [];
		for (const filePath of framePaths) {
			const data = await fs.readFile(filePath, "base64");
			frames.push(data);
		}

		if (frames.length === 0) return false;

		// Chama LLM
		const completionOptions = {
			prompt:
				"Analyze the video frames provided and return a brief description ((in pt-BR, portuguese brazil)). Describe the main actions and events in the video. Also classify the type (real life, anime, game, etc) and if it contains NSFW content.",
			systemContext: `You are an expert bot in video processing and analysis`,
			images: frames,
			response_format: mediaAnalysisSchema,
			debugPrompt: false,
			timeout: 60000,
			priority: 0
		};

		const response = await llmService.getCompletion(completionOptions);
		try {
			const parsed = JSON.parse(response);
			const nsfwTag = parsed.nsfw ? "nsfw" : "sfw";
			return `Video[${parsed.type}|${nsfwTag}|${parsed.description}]`;
		} catch (e) {
			logger.warn("Falha ao analisar JSON do vídeo, retornando cru:", response);
			return `Video[outros|sfw|${response}]`;
		}
	} catch (error) {
		logger.error("Erro ao analisar vídeo:", error);
		return false;
	} finally {
		// Limpeza
		try {
			await fs.unlink(videoPath).catch(() => {});
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
		} catch (e) {
			logger.error("Erro na limpeza de análise de vídeo:", e);
		}
	}
}

/**
 * Resume conversa de grupo
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage|Array<ReturnMessage>>} - ReturnMessage com o resumo
 */
async function summarizeConversation(bot, message, args, group) {
	try {
		if (!message.group) {
			return new ReturnMessage({
				chatId: message.author,
				content: "Este comando só pode ser usado em grupos."
			});
		}

		logger.info(`[${group.id}] Resumindo conversa para o grupo ${message.group}`);

		let recentMessages;
		try {
			// Recorre a mensagens armazenadas
			recentMessages = await getRecentMessages(message.group);
		} catch (fetchError) {
			logger.error("Erro ao buscar mensagens do chat:", fetchError);
			recentMessages = [];
		}

		if (!recentMessages || recentMessages.length === 0) {
			return new ReturnMessage({
				chatId: message.group,
				content: "Nenhuma mensagem recente para resumir."
			});
		}

		// Formata mensagens para prompt
		const formattedMessages = formatMessagesForPrompt(recentMessages);

		const customPersonalidade =
			group.customAIPrompt && group.customAIPrompt.length > 0
				? `\n\n((Sua personalidade: '${group.customAIPrompt}'))\n\n`
				: "";

		// Cria prompt para LLM
		const prompt = `Abaixo está uma conversa recente de um grupo de WhatsApp. ${customPersonalidade}. Por favor, resuma os principais pontos discutidos de forma concisa:
${formattedMessages}

Resumo:`;

		// Obtém resumo do LLM
		const summary = await llmService.getCompletion({ prompt, priority: 4 });

		if (!summary) {
			return new ReturnMessage({
				chatId: message.group,
				content: "Falha ao gerar resumo. Por favor, tente novamente."
			});
		}

		// Já que deu certo, limpa o historico
		await clearRecentMessages(message.group);

		logger.info(`[${group.id}]Resumo de conversa enviado com sucesso para ${message.group}`);

		// Envia o resumo
		return new ReturnMessage({
			chatId: message.group,
			content: `📋 *Resumo da conversa:*

${summary}`
		});
	} catch (error) {
		logger.error("Erro ao resumir conversa:", error);
		return new ReturnMessage({
			chatId: message.group ?? message.author,
			content: "Erro ao gerar resumo. Por favor, tente novamente."
		});
	}
}

/**
 * Gera mensagem interativa baseada na conversa
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage>} - ReturnMessage com a interação gerada
 */
async function interactWithConversation(bot, message, args, group) {
	const retornarErro = args[0] ?? true;
	try {
		if (!message.group) {
			return new ReturnMessage({
				chatId: message.author,
				content: "Este comando só pode ser usado em grupos."
			});
		}

		logger.info(
			`[${group.id}][interactWithConversation] Gerando interação para o grupo ${message.group}`
		);

		let recentMessages;

		try {
			// Recorre a mensagens armazenadas
			recentMessages = await getRecentMessages(message.group);
		} catch (fetchError) {
			logger.error(
				`[${group.id}][interactWithConversation] Erro ao buscar mensagens do chat:`,
				fetchError
			);
			// Recorre a mensagens armazenadas
			recentMessages = [];
		}

		logger.info(
			`[${group.id}][interactWithConversation] Mensagens recentes: ${recentMessages.length}`
		);

		if (!recentMessages || recentMessages.length === 0) {
			if (retornarErro) {
				return new ReturnMessage({
					chatId: message.group,
					content: "Nenhuma mensagem recente para interagir."
				});
			} else {
				return [];
			}
		}

		// Formata mensagens para prompt
		const formattedMessages = formatMessagesForPrompt(recentMessages);

		const customPersonalidade =
			group.customAIPrompt && group.customAIPrompt.length > 0
				? `\n\n((Sua personalidade: '${group.customAIPrompt}'))\n\n`
				: "";
		// Cria prompt para LLM
		const prompt = `Responda apenas em português do brasil. A seguir anexei uma conversa recente de um grupo de WhatsApp. Crie uma única mensagem curta para interagir com o grupo de forma natural, como se você entendesse o assunto e quisesse participar da conversa com algo relevante. Tente usar o mesmo tom e estilo informal que as pessoas estão usando. A mensagem deve ser curta e natural. ${customPersonalidade}

${formattedMessages}`;

		logger.info(
			`[${group.id}][interactWithConversation] Enviando prompt: ${prompt.substring(0, 500)}`
		);

		// Obtém interação do LLM
		const interaction = await llmService.getCompletion({ prompt, priority: 5 });

		if (!interaction) {
			if (retornarErro) {
				return new ReturnMessage({
					chatId: message.group,
					content: "Falha ao gerar mensagem. Por favor, tente novamente."
				});
			} else {
				return [];
			}
		}

		// Verifica se teve mentions
		const llmMentions = interaction.match(/@(\d{8,})/g)?.map((m) => m.slice(1)) || [];

		// Envia a mensagem de interação
		if (interaction.includes("Não foi poss") && !retornarErro) {
			logger.info(
				`[${group.id}] Mensagem de interação ignorada pois ocorreu um erro na hora de gerar (${message.group}/'${interaction}')`
			);
			return [];
		} else {
			const resultado = new ReturnMessage({
				chatId: message.group,
				content: interaction,
				mentions: llmMentions
			});
			logger.info(`[${group.id}] Mensagem de interação gerada com sucesso para '${message.group}'`);

			// Já que deu certo, limpa o historico
			await clearRecentMessages(message.group);

			//logger.info(`[${group.id}] Limpas mensagens recentes de  '${message.group}'`);
			return resultado;
		}
	} catch (error) {
		logger.error(`[${group.id}] Erro ao gerar interação:`, error);
		if (retornarErro) {
			return new ReturnMessage({
				chatId: message.group ?? message.author,
				content: "Erro ao gerar mensagem. Por favor, tente novamente."
			});
		} else {
			return [];
		}
	}
}

/**
 * Armazena uma mensagem no histórico de conversas do grupo
 * @param {Object} message - Os dados da mensagem
 * @param {Object} chatId - Id do grupo
 */
async function storeMessage(message, chatId) {
	try {
		// Carrega mensagens existentes
		let messages = await getRecentMessages(chatId);

		// Adiciona nova mensagem
		let textContent = message.type === "text" ? message.content : message.caption;

		// Mensagens de áudio são interpretadas também, usando transcrição do whisper, mas ficam no EventHandler - pra poder usar msg de voz no pv também!

		let llmUp = false;
		try {
			const servicesData = await Status.getServicesStatus();
			if (servicesData.llm === "up") {
				llmUp = true;
			}
		} catch (e) {
			// Ignore error, assume down
		}

		if (message.type === "image" && llmUp) {
			// Tenta interpretar a imagem usando Vision AI, menos se for pedido de sticker pra aliviar  a GPU
			if (
				message.content &&
				!message.caption?.startsWith("!s") &&
				!message.caption?.startsWith("!ia")
			) {
				const completionOptions = {
					prompt:
						"Analyze the picture and return a brief description ((in pt-BR, portuguese brazil)) ((try to stay below 200 characters)). Also classify the type (real life, anime, game, etc) and if it contains NSFW content.",
					systemContext: `You are an expert bot in image processing and analysis`,
					image: message.content.data,
					response_format: mediaAnalysisSchema,
					debugPrompt: false,
					priority: 1
				};

				//logger.info(`[storeMessage] Prompt: `, completionOptions);
				const response = await llmService.getCompletion(completionOptions);

				if (
					response &&
					!response.includes("Não foi poss") &&
					!response.includes("Ocorreu um erro")
				) {
					try {
						const parsed = JSON.parse(response);
						const nsfwTag = parsed.nsfw ? "nsfw" : "sfw";
						const finalString = `Imagem[${parsed.type}|${nsfwTag}|${parsed.description}]`;
						textContent = message.caption
							? `${finalString}\nLegenda: ${message.caption}`
							: finalString;
						logger.info(`[${chatId}][storeMessage] Imagem interpretada: ${textContent}`);
					} catch (e) {
						logger.warn("Falha ao analisar JSON da imagem, retornando cru:", response);
						// Fallback if not JSON
						textContent = message.caption ? `${response}\nLegenda: ${message.caption}` : response;
					}
				}
			}
		} else if (message.type === "video" && llmUp) {
			// Tenta interpretar o video usando Vision AI
			if (message.content && !message.caption?.startsWith("!s")) {
				const response = await analyzeVideo(message);

				if (
					response &&
					!response.includes("Não foi poss") &&
					!response.includes("Ocorreu um erro")
				) {
					textContent = message.caption ? `${response}\nLegenda: ${message.caption}` : response;
					logger.info(`[${chatId}][storeMessage] Vídeo interpretado: ${textContent}`);
				}
			}
		}

		if (textContent) {
			// Zap/libs mudam tanto que pode vir de qualquer lugar, é foda, haja fallbacks
			const fromMe =
				message.evoMessageData?.key?.fromMe ??
				message.key?.fromMe ??
				message.fromMe ??
				message.origin?.fromMe ??
				false;
			const authorName = fromMe
				? "Você (bot)"
				: (message.evoMessageData?.pushName ??
					message.origin?.pushName ??
					message.name ??
					message.authorName ??
					message.pushname ??
					"Desconhecido");

			//logger.info(`[storeMessage] ${authorName}: ${textContent}`);
			messages.push({
				author: authorName,
				text: textContent,
				timestamp: Date.now()
			});

			// Mantém apenas as últimas 30 mensagens
			if (messages.length > 30) {
				messages = messages.slice(messages.length - 30);
			}

			// Salva mensagens atualizadas
			await database.dbRun(
				DB_NAME,
				"INSERT OR REPLACE INTO conversations (group_id, json_data) VALUES (?, ?)",
				[chatId, JSON.stringify(messages, null, 2)]
			);

			//logger.debug(`Mensagem armazenada no arquivo de conversa para ${chatId}`);
		}
	} catch (error) {
		logger.error("Erro ao armazenar mensagem:", error);
	}
}

/**
 * Obtém mensagens recentes para um grupo
 * @param {string} chatId - O ID do grupo
 * @returns {Promise<Array>} - Array de objetos de mensagem
 */
async function getRecentMessages(chatId) {
	try {
		const row = await database.dbGet(
			DB_NAME,
			"SELECT json_data FROM conversations WHERE group_id = ?",
			[chatId]
		);
		return row ? JSON.parse(row.json_data) : [];
	} catch (error) {
		logger.error("Erro ao obter mensagens recentes:", error);
		return [];
	}
}

/**
 * Limpar as mensagens recentes para um grupo
 * @param {string} chatId - O ID do grupo
 * @returns {Promise<Bool>} - Se deu certo ou não
 */
async function clearRecentMessages(chatId) {
	try {
		await database.dbRun(
			DB_NAME,
			"INSERT OR REPLACE INTO conversations (group_id, json_data) VALUES (?, ?)",
			[chatId, "[]"]
		);
		return true;
	} catch (error) {
		logger.error("Erro ao limpar mensagens recentes:", error);
		return false;
	}
}

/**
 * Formata mensagens para prompt do LLM
 * @param {Array} messages - Array de objetos de mensagem
 * @returns {string} - String de mensagens formatada
 */
function formatMessagesForPrompt(messages) {
	return messages.map((msg) => `${msg.author}: ${msg.text}`).join("\n");
}

// Lista de comandos usando a classe Command
const commands = [
	new Command({
		name: "resumo",
		description: "Resume conversas recentes do grupo",
		category: "ia",
		reactions: {
			before: process.env.LOADING_EMOJI ?? "🌀",
			after: "📋"
		},
		cooldown: 300,
		method: summarizeConversation
	}),

	new Command({
		name: "interagir",
		description: "Gera uma mensagem interativa baseada na conversa",
		category: "ia",
		reactions: {
			trigger: "🦜",
			before: process.env.LOADING_EMOJI ?? "🌀",
			after: "💬"
		},
		cooldown: 150,
		method: interactWithConversation
	})
];

// Exporta as funções de histórico de conversa para serem usadas no EventHandler e outros
module.exports.storeMessage = storeMessage;
module.exports.getRecentMessages = getRecentMessages;
module.exports.clearRecentMessages = clearRecentMessages;
module.exports.formatMessagesForPrompt = formatMessagesForPrompt;

// Exporta comandos
module.exports.commands = commands;
