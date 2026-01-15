const path = require("path");
const fs = require("fs").promises;
const Logger = require("../utils/Logger");
const { getRecentMessages, formatMessagesForPrompt, storeMessage } = require("./SummaryCommands");
const LLMService = require("../services/LLMService");
const ReturnMessage = require("../models/ReturnMessage");
const Command = require("../models/Command");
const Database = require("../utils/Database");
const { extractFrames } = require("../utils/Conversions");

const logger = new Logger("ai-commands");

const llmService = new LLMService({});
const database = Database.getInstance();

const classifyQuestionSchema = {
	type: "json_schema",
	json_schema: {
		name: "classify_schema",
		schema: {
			type: "object",
			properties: {
				classification: {
					type: "string",
					enum: ["general", "group", "bot", "command"]
				},
				command: {
					type: "string"
				},
				args: {
					type: "string"
				}
			},
			required: ["classification"]
		}
	}
};

/**
 * Helper to get command lists formatted for the prompt
 */
function getCommandLists(bot) {
	const fixedCommands = bot.eventHandler.commandHandler.fixedCommands.getAllCommands();
	const managementCommands = bot.eventHandler.commandHandler.management.getManagementCommands();

	let cmdSimpleList = "";
	let cmdGerenciaSimplesList = "";

	for (const cmd of fixedCommands) {
		if (
			cmd.description &&
			cmd.description.length > 0 &&
			!cmd.description.toLowerCase().includes("alias") &&
			!cmd.hidden
		) {
			const usage = cmd.usage ? ` | Uso: ${cmd.usage}` : "";
			cmdSimpleList += `- ${bot.prefix}${cmd.name}: ${cmd.description}${usage}\n`;
		}
	}
	for (const cmd in managementCommands) {
		const desc = managementCommands[cmd].description;
		cmdGerenciaSimplesList += `- ${bot.prefix}g-${cmd}: ${desc}\n`;
	}

	return { cmdSimpleList, cmdGerenciaSimplesList };
}

/**
 * Classifies the user's request using LLM
 */
async function classifyRequest(question, commandList, ctxContent, hasMedia) {
	let mediaContext = "";
	if (hasMedia) {
		mediaContext =
			"\n\n[IMPORTANT]: The user HAS ATTACHED an image or video to this message.\nIf the user is asking to modify, stickerize, or perform an action ON the image, classify as 'command' and identify the appropriate command (e.g., sticker).\nIf the user is asking a question ABOUT the image content (e.g., 'what is in this image?'), classify as 'bot' or 'general' so it can be analyzed.";
	}

	const prompt = `Classify the following user request/question based on the available commands and context.
    
User Request: "${question}"
${mediaContext}

Available Commands:
${commandList}

Context Info:
${ctxContent.substring(0, 1000)}...

Return a JSON with "classification" as one of:
- "general": General knowledge question (e.g., "what is the capital of France?", "recipe for cake").
- "bot": Question about the bot itself, how to use a command, OR a request to ANALYZE the attached image content (e.g., "how do I make a sticker?", "who are you?", "describe this image").
- "group": Question about the group or members (e.g., "who is @123?", "what do you think of this group?").
- "command": The user is explicitly trying to invoke a command or asking for an action that maps directly to a command (e.g., "make a sticker of this", "weather in London").

If "command", also provide "command" (the command name without prefix) and "args" (arguments string).
`;

	try {
		const response = await llmService.getCompletion({
			prompt,
			response_format: classifyQuestionSchema,
			temperature: 0.1,
			systemContext: "You are an intent classifier for a WhatsApp bot."
		});

		try {
			return JSON.parse(response);
		} catch (e) {
			logger.warn("[classifyRequest] Failed to parse JSON, defaulting to bot", response);
			return { classification: "bot" };
		}
	} catch (e) {
		logger.error("[classifyRequest] Error classifying", e);
		return { classification: "bot" };
	}
}

/**
 * Handles the "command" classification
 */
async function handleCommandInvocation(classification, bot, message, group) {
	const cmdName = classification.command?.replace(/!/g, "").trim();
	const argsStr = classification.args || "";
	const args = argsStr.split(" ").filter((a) => a.length > 0);

	// Try to find the command
	const fixedCmd = bot.eventHandler.commandHandler.fixedCommands.getCommand(cmdName);

	if (fixedCmd) {
		try {
			logger.info(`[AICommand] Auto-invoking command: ${cmdName} with args: ${args}`);

			// Hijack the message object
			const fullCommandString = `!${cmdName} ${argsStr}`;

			// We need to be careful not to mutate the original message permanently if it's used elsewhere,
			// but for this flow it's likely fine.
			// Check if it's a media message to decide where to put the command string
			if (message.type === "image" || message.type === "video" || message.hasMedia) {
				message.caption = fullCommandString;
			} else {
				message.body = fullCommandString;
				message.content = fullCommandString;
			}

			const result = await fixedCmd.execute(bot, message, args, group);

			let content = `> 🤖 Usando comando !${cmdName} ${argsStr}\n\n`;
			if (result instanceof ReturnMessage) {
				content += result.content;
				result.content = content;
				return result;
			} else if (typeof result === "string") {
				return new ReturnMessage({
					chatId: message.group ?? message.author,
					content: content + result,
					options: { quotedMessageId: message.origin.id._serialized }
				});
			}
		} catch (e) {
			logger.error(`[AICommand] Error auto-invoking command ${cmdName}`, e);
			return new ReturnMessage({
				chatId: message.group ?? message.author,
				content: `Tentei executar o comando !${cmdName}, mas ocorreu um erro: ${e.message}`,
				options: { quotedMessageId: message.origin.id._serialized }
			});
		}
	}

	return new ReturnMessage({
		chatId: message.group ?? message.author,
		content: `Entendi que você quer usar o comando "${cmdName}", mas não consegui encontrá-lo ou executá-lo.`,
		options: { quotedMessageId: message.origin.id._serialized }
	});
}

/**
 * Main AI Command function
 */
async function aiCommand(bot, message, args, group) {
	const chatId = message.group ?? message.author;
	const database = Database.getInstance();

	// 1. Get Base Context and Lists
	const ctxPath = path.join(database.databasePath, "textos", "llm_context.txt");
	const baseCtxContent = (await fs.readFile(ctxPath, "utf8")) || "";

	const { cmdSimpleList, cmdGerenciaSimplesList } = getCommandLists(bot);

	// 2. Prepare Question/Prompt
	let question = args.length > 0 ? args.join(" ") : (message.caption ?? message.content);
	const quotedMsg = await message.origin.getQuotedMessage();
	if (quotedMsg && !message.originReaction) {
		const quotedText = quotedMsg.caption ?? quotedMsg.content ?? quotedMsg.body;
		if (quotedText && quotedText.length > 10) {
			question += `\n\nContexto da mensagem respondida: ${quotedText}`;
		}
	}

	// 3. Check for Media
	const media = await getMediaFromMessage(message);

	// Validation: No media and short question
	if (!media && question.length < 5) {
		if (bot.pvAI) {
			const greetingPath = path.join(database.databasePath, "textos", "bot-greeting.txt");
			const greetingContent =
				(await fs.readFile(greetingPath, "utf8")) ?? "Oi, eu sou a ravenabot!";
			return new ReturnMessage({
				chatId,
				content: greetingContent,
				reaction: "👋",
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});
		} else {
			return new ReturnMessage({
				chatId,
				content:
					"Por favor, forneça uma pergunta ou uma imagem com uma pergunta. Exemplo: !ai Qual é a capital da França?",
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});
		}
	}

	// 4. Classification
	// Now we classify FIRST, telling the LLM if there is media attached.
	logger.debug(`[aiCommand] Classifying request: ${question} (Has Media: ${!!media})`);
	const classificationResult = await classifyRequest(
		question,
		cmdSimpleList,
		baseCtxContent,
		!!media
	);
	logger.info(
		`[aiCommand] Classification result: ${classificationResult.classification} (${classificationResult.command})`
	);

	// 5. Handle Classification Results

	// CASE A: Command Invocation (e.g. "make sticker", "weather in paris")
	if (classificationResult.classification === "command" && classificationResult.command) {
		// Even if it has media, if it classified as a command (like !sticker), we hand it off to the command handler.
		return handleCommandInvocation(classificationResult, bot, message, group);
	}

	// CASE B: Analysis/Bot Question WITH Media (e.g. "what is this?", "summarize this video")
	if (media && media.data) {
		// If it's NOT a command, but HAS media, we treat it as an analysis request.
		return handleMediaRequest(
			bot,
			message,
			media,
			question,
			baseCtxContent,
			group,
			chatId,
			database
		);
	}

	// CASE C: Text-Only Response (General, Group, Bot-chat)
	// Build Context based on Classification
	let systemContext = "";
	const customPersonalidade =
		group?.customAIPrompt && group?.customAIPrompt?.length > 0
			? `\n\n((Sua personalidade: '${group.customAIPrompt}'))\n\n`
			: "";

	if (classificationResult.classification === "general") {
		// Minimal context
		systemContext = `Você é ravenabot, um assistente virtual. Responda de forma útil e direta.${customPersonalidade}`;
	} else if (classificationResult.classification === "group") {
		// Group context + History
		const msgsRecentes = (await getRecentMessages(chatId)).slice(0, 15);
		let historicoCtx = "";
		if (msgsRecentes.length > 0) {
			historicoCtx = `\n\nContexto das últimas mensagens deste chat: ---------------${formatMessagesForPrompt(msgsRecentes)}
---------------\n`;
		}
		systemContext = `${baseCtxContent}\n${customPersonalidade}\n${historicoCtx}`;
	} else {
		// Bot related (default) - Full context
		const variaveisReturn = await bot.eventHandler.commandHandler.management.listVariables(
			bot,
			message,
			args,
			group
		);
		const variaveisList = variaveisReturn.content;

		systemContext = `${baseCtxContent}\n\n## Comandos que você pode processar:\n\n${cmdSimpleList}\n\nPara os comandos personalizados criados com g-addCmd, você pode usar variáveis:\n${variaveisList}\n\nEstes são os comandos usados apenas por administradores: ${cmdGerenciaSimplesList}\n\n${customPersonalidade}`;
	}

	systemContext +=
		"\n((Não se apresente, a não ser que o usuário solicite informações sobre você))";

	// Add user name context
	const promptAutor =
		message?.evoMessageData?.key?.pushName ??
		message?.name ??
		message?.authorName ??
		message?.pushname;
	if (promptAutor) {
		systemContext = `Nome de quem enviou o prompt: ${promptAutor}\n\n` + systemContext;
	}

	// Execute LLM Request
	const completionOptions = {
		prompt: question,
		systemContext
	};

	try {
		logger.debug("[aiCommand] Requesting LLM completion");
		const response = await llmService.getCompletion(completionOptions);

		// Process variables
		let processedResponse;
		try {
			processedResponse = await bot.eventHandler.commandHandler.variableProcessor.process(
				response,
				{ message, group, command: false, options: {}, bot }
			);
		} catch (e) {
			processedResponse = response;
		}

		return new ReturnMessage({
			chatId,
			content: processedResponse,
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	} catch (error) {
		logger.error("[aiCommand] Error in LLM completion:", error);
		return new ReturnMessage({
			chatId,
			content: "Desculpe, encontrei um erro ao processar sua solicitação.",
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	}
}

/**
 * Separated Logic for Media Processing
 */
async function handleMediaRequest(
	bot,
	message,
	media,
	question,
	baseCtxContent,
	group,
	chatId,
	database
) {
	const completionOptions = {
		prompt: question,
		systemContext: baseCtxContent
	};
	const customPersonalidade =
		group?.customAIPrompt && group?.customAIPrompt?.length > 0
			? `\n\n((Sua personalidade: '${group.customAIPrompt}'))\n\n`
			: "";

	let tipoMedia = "";
	const tempPathsToRemove = [];

	if (media.mimetype.includes("image")) {
		tipoMedia = "Imagem";
		if (completionOptions.prompt.length < 4) {
			completionOptions.prompt = "Analise esta imagem e entregue um resumo detalhado";
		}
		completionOptions.image = media.data;

		const ctxPath = path.join(database.databasePath, "textos", "llm_context_images.txt");
		completionOptions.systemContext =
			(await fs.readFile(ctxPath, "utf8")) ??
			"Você se chama ravenabot e deve interpretar esta imagem enviada no WhatsApp";
		completionOptions.systemContext += customPersonalidade;
	} else if (media.mimetype.includes("video")) {
		tipoMedia = "Video";
		if (completionOptions.prompt.length < 4) {
			completionOptions.prompt =
				"Analise este vídeo e entregue um resumo detalhado do que acontece nele";
		}

		try {
			const tempDirBase = path.join(__dirname, "../../temp");
			const tempDir = path.join(tempDirBase, `ai_video_${Date.now()}`);
			const videoPath = path.join(tempDirBase, `ai_video_${Date.now()}.mp4`);

			await fs.mkdir(tempDirBase, { recursive: true });
			await fs.writeFile(videoPath, Buffer.from(media.data, "base64"));

			tempPathsToRemove.push(videoPath);
			tempPathsToRemove.push(tempDir);

			const framePaths = await extractFrames(videoPath, tempDir, 75);
			const frames = [];
			for (const filePath of framePaths) {
				const data = await fs.readFile(filePath, "base64");
				frames.push(data);
			}

			completionOptions.images = frames;
			completionOptions.timeout = 60000;

			const ctxPath = path.join(database.databasePath, "textos", "llm_context_videos.txt");
			completionOptions.systemContext =
				(await fs.readFile(ctxPath, "utf8")) ??
				"Você se chama ravenabot e deve interpretar este vídeo enviado no WhatsApp";
			completionOptions.systemContext += customPersonalidade;
		} catch (videoError) {
			logger.error("[aiCommand] Error processing video:", videoError);
			return new ReturnMessage({
				chatId,
				content: `Ocorreu um erro ao processar o vídeo: ${videoError.message}`,
				options: { quotedMessageId: message.origin.id._serialized, evoReply: message.origin }
			});
		}
	} else {
		return new ReturnMessage({
			chatId,
			content: `Ainda não processo este tipo de arquivo (${media.mimetype}) 😟 Consigo apenas analisar imagens e vídeos!`,
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	}

	const promptAutor =
		message?.evoMessageData?.key?.pushName ??
		message?.name ??
		message?.authorName ??
		message?.pushname;
	if (promptAutor) {
		completionOptions.systemContext =
			`Nome de quem enviou o prompt: ${promptAutor}\n\n` + completionOptions.systemContext;
	}

	try {
		logger.debug("[aiCommand] Requesting LLM completion for media");
		const response = await llmService.getCompletion(completionOptions);

		// Store in history
		message.content = `${tipoMedia}[${response}]`;
		message.caption = `${tipoMedia}[${response}]`;
		storeMessage(message, message.author);

		let processedResponse;
		try {
			processedResponse = await bot.eventHandler.commandHandler.variableProcessor.process(
				response,
				{ message, group, command: false, options: {}, bot }
			);
		} catch (e) {
			processedResponse = response;
		}

		return new ReturnMessage({
			chatId,
			content: processedResponse,
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	} catch (error) {
		logger.error("[aiCommand] Error in Media LLM completion:", error);
		return new ReturnMessage({
			chatId,
			content: "Desculpe, encontrei um erro ao processar sua solicitação de mídia.",
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	} finally {
		// Cleanup
		for (const pathToRemove of tempPathsToRemove) {
			try {
				const stats = await fs.stat(pathToRemove);
				if (stats.isDirectory()) {
					await fs.rm(pathToRemove, { recursive: true, force: true });
				} else {
					await fs.unlink(pathToRemove);
				}
			} catch (cleanupError) {
				logger.error(`[aiCommand] Error cleaning temp file ${pathToRemove}:`, cleanupError);
			}
		}
	}
}

// Auxiliar para obter mídia da mensagem
function getMediaFromMessage(message) {
	return new Promise((resolve, reject) => {
		// Se a mensagem tem mídia direta
		if (message.type !== "text") {
			resolve(message.content);
			return;
		}

		// Tenta obter mídia da mensagem citada
		message.origin
			.getQuotedMessage()
			.then((quotedMsg) => {
				if (quotedMsg && quotedMsg.hasMedia) {
					return quotedMsg.downloadMedia();
				}
				resolve(null);
			})
			.then((media) => {
				if (media) resolve(media);
			})
			.catch((error) => {
				logger.error("Erro ao obter mídia da mensagem citada:", error);
				resolve(null);
			});
	});
}

const commands = [
	new Command({
		name: "ai",
		description: "Pergunte algo à IA",
		category: "ia",
		group: "askia",
		reactions: {
			trigger: "🤖",
			before: process.env.LOADING_EMOJI ?? "🌀",
			after: "🤖"
		},
		cooldown: 5,
		method: aiCommand
	}),
	new Command({
		name: "ia",
		description: "Alias para AI",
		category: "ia",
		group: "askia",
		reactions: {
			trigger: "🤖",
			before: process.env.LOADING_EMOJI ?? "🌀",
			after: "🤖"
		},
		cooldown: 5,
		method: aiCommand
	}),
	new Command({
		name: "gpt",
		hidden: true,
		description: "Alias para AI",
		category: "ia",
		group: "askia",
		reactions: {
			trigger: "🤖",
			before: process.env.LOADING_EMOJI ?? "🌀",
			after: "🤖"
		},
		cooldown: 5,
		method: aiCommand
	}),
	new Command({
		name: "gemini",
		hidden: true,
		description: "Alias para AI",
		category: "ia",
		group: "askia",
		reactions: {
			trigger: "🤖",
			before: process.env.LOADING_EMOJI ?? "🌀",
			after: "🤖"
		},
		cooldown: 5,
		method: aiCommand
	})
];

module.exports = { commands, aiCommand };
