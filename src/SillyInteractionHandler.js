const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const Logger = require("./utils/Logger");
const LLMService = require("./services/LLMService");
const ReturnMessage = require("./models/ReturnMessage");
const { MessageMedia } = require("whatsapp-web.js");
const Database = require("./utils/Database");

const logger = new Logger("silly-interaction-handler");
const llmService = LLMService.getInstance();
const database = Database.getInstance();

const xingamentos = [
	"bot lixo",
	"bot podre",
	"bot inutil",
	"bot inútil",
	"bot imprestável",
	"bot imprestavel",
	"bot ruim",
	"bot burro",
	"bot merda",
	"boot lixo",
	"boot podre",
	"boot ruim",
	"boot merda",
	"boot burro",
	"odiei o bot",
	"ninguém gosta do bot",
	"ninguem gosta do bot",
	"cala boca bot",
	"cala a boca bot",
	"bot lento"
];

const elogios = ["bot lindo", "bot maravilhso", "bot bom", "bot gostoso", "amei o bot"];

class SillyInteractionHandler {
	constructor() {
		this.dataDir = path.join(__dirname, "../data/sillies");
		this.dbName = "sillies";
		this.ensureDirectories();
		this.initializeDatabase();
		this.cooldowns = {};
	}

	initializeDatabase() {
		const schema = `CREATE TABLE IF NOT EXISTS stats (category TEXT PRIMARY KEY, count INTEGER DEFAULT 0)`;
		database.getSQLiteDb(this.dbName, schema);
	}

	async ensureDirectories() {
		try {
			await fs.mkdir(path.join(this.dataDir, "elogios"), { recursive: true });
			await fs.mkdir(path.join(this.dataDir, "xingamentos"), { recursive: true });
		} catch (error) {
			logger.error("Erro ao criar diretórios de sillies:", error);
		}
	}

	normalize(text) {
		if (typeof text !== "string") return "";
		return text
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "");
	}

	async handle(bot, message, group) {
		const chatId = message.group ?? message.author;
		const now = Date.now();
		const COOLDOWN_MS = 30000;

		if (this.cooldowns[chatId] && now - this.cooldowns[chatId] < COOLDOWN_MS) {
			return false;
		}

		const text = message.content || message.caption;
		if (!text) return false;

		const normalizedText = this.normalize(text);

		let category = null;
		if (xingamentos.some((x) => normalizedText.includes(this.normalize(x)))) {
			category = "xingamentos";
		} else if (elogios.some((e) => normalizedText.includes(this.normalize(e)))) {
			category = "elogios";
		}

		if (!category) return false;

		// Update tracking
		await database.dbRun(
			this.dbName,
			`INSERT INTO stats (category, count) VALUES (?, 1)
			 ON CONFLICT(category) DO UPDATE SET count = count + 1`,
			[category]
		);

		// Update cooldown early to avoid spam if generation takes time
		this.cooldowns[chatId] = now;

		logger.info(`Silly interaction detected (${category}) from ${message.author}`);

		// 25% LLM, 75% Sticker
		if (Math.random() < 0.25) {
			return await this.handleLLM(bot, message, category);
		} else {
			return await this.handleSticker(bot, message, category);
		}
	}

	async handleLLM(bot, message, category) {
		const nomePessoa = message.name || message.pushName || message.authorName || "usuário";
		const msgRecebida = message.content || message.caption;

		let prompt = "";
		if (category === "xingamentos") {
			prompt = `Usuário ${nomePessoa} te xingou falando '${msgRecebida}'. Responda xingando ele de volta, mandando ele respeitar e ficar quieto no canto dele`;
		} else {
			prompt = `Usuário ${nomePessoa} te elogiou falando '${msgRecebida}'. Responda de forma fofa, agradecendo e sendo gentil como a ravena.`;
		}

		try {
			const response = await llmService.getCompletion({
				prompt,
				priority: 5,
				systemContext:
					"Sua personalidade: Atrevida se for xingada, fofa e gentil se for elogiada. Não use muitas emojis."
			});

			const returnMsg = new ReturnMessage({
				chatId: message.group ?? message.author,
				content: response,
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});

			await bot.sendReturnMessages(returnMsg);
			return true;
		} catch (error) {
			logger.error("Erro ao gerar resposta LLM silly:", error);
			return await this.handleSticker(bot, message, category);
		}
	}

	async handleSticker(bot, message, category) {
		const folder = path.join(this.dataDir, category);
		try {
			const files = await fs.readdir(folder);
			const stickerFiles = files.filter((f) => /\.(webp|png|jpg|jpeg|gif)$/i.test(f));

			if (stickerFiles.length === 0) {
				logger.warn(`Nenhum sticker encontrado em ${folder}`);
				// Se for elogio e não tiver sticker, talvez responder com texto simples?
				return false;
			}

			const randomFile = stickerFiles[Math.floor(Math.random() * stickerFiles.length)];
			const filePath = path.join(folder, randomFile);

			const media = await MessageMedia.fromFilePath(filePath);

			const returnMsg = new ReturnMessage({
				chatId: message.group ?? message.author,
				content: media,
				options: {
					sendMediaAsSticker: true,
					stickerAuthor: "Ravena",
					stickerName: "Silly",
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});

			await bot.sendReturnMessages(returnMsg);
			return true;
		} catch (error) {
			logger.error(`Erro ao enviar sticker silly de ${folder}:`, error);
			return false;
		}
	}
}

module.exports = new SillyInteractionHandler();
