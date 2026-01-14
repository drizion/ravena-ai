const path = require("path");
const fs = require("fs").promises;
const Logger = require("../utils/Logger");
const Database = require("../utils/Database");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class UserGreetingManager {
	constructor() {
		this.logger = new Logger("user-greeting");
		this.database = Database.getInstance();
		this.DB_NAME = "greeted_users";

		// Initialize Database
		this.database.getSQLiteDb(
			this.DB_NAME,
			`
      CREATE TABLE IF NOT EXISTS greeted_users (
        user_id TEXT,
        bot_id TEXT,
        timestamp INTEGER,
        PRIMARY KEY (user_id, bot_id)
      );
    `
		);

		this.greetingTextPath = path.join(this.database.databasePath, "textos", "bot-greeting.txt");
	}

	/**
	 * Verifica se um usuário já foi saudado recentemente por um bot específico
	 * @param {string} userId - ID do usuário
	 * @param {string} botId - ID do bot
	 * @returns {Promise<boolean>} - True se o usuário já foi saudado recentemente por este bot
	 */
	async wasGreetedRecently(userId, botId) {
		try {
			const row = await this.database.dbGet(
				this.DB_NAME,
				"SELECT timestamp FROM greeted_users WHERE user_id = ? AND bot_id = ?",
				[userId, botId]
			);

			if (!row) return false;

			const lastGreeted = row.timestamp;
			const now = Date.now();
			const oneWeekMs = 7 * 24 * 60 * 60 * 1000; // Uma semana em milissegundos

			return now - lastGreeted < oneWeekMs;
		} catch (error) {
			this.logger.error("Erro ao verificar saudação:", error);
			return false;
		}
	}

	/**
	 * Marca um usuário como saudado por um bot específico
	 * @param {string} userId - ID do usuário
	 * @param {string} botId - ID do bot
	 */
	async markAsGreeted(userId, botId) {
		try {
			await this.database.dbRun(
				this.DB_NAME,
				"INSERT OR REPLACE INTO greeted_users (user_id, bot_id, timestamp) VALUES (?, ?, ?)",
				[userId, botId, Date.now()]
			);
		} catch (error) {
			this.logger.error("Erro ao marcar saudação:", error);
		}
	}

	/**
	 * Lê o texto de saudação do arquivo
	 * @returns {Promise<string>} - O texto de saudação
	 */
	async getGreetingText() {
		try {
			// Criar o diretório 'textos' se não existir
			const textosDir = path.join(this.database.databasePath, "textos");
			await fs.mkdir(textosDir, { recursive: true }).catch(() => {});

			// Verificar se o arquivo de saudação existe
			try {
				await fs.access(this.greetingTextPath);
			} catch (error) {
				// Se o arquivo não existir, cria com um texto padrão
				const defaultGreeting = `🦇 *Olá! Eu sou a Ravena!* 🦇\n\nSou uma bot de WhatsApp com várias funções úteis!\n\nDigite *!cmd* para ver todos os comandos disponíveis. Aqui no privado, você pode:\n\n• Enviar áudios e eu farei a transcrição automaticamente\n• Enviar imagens/vídeos e eu crio figurinhas pra você\n• Utilizar comandos de texto para voz como *!tts* seguido do texto\n\nÉ possível também me adicionar em grupos! 😉`;

				await fs.writeFile(this.greetingTextPath, defaultGreeting);
				this.logger.info("Arquivo de saudação criado com texto padrão");
				return defaultGreeting;
			}

			// Ler o arquivo de saudação
			const greeting = await fs.readFile(this.greetingTextPath, "utf8");
			return greeting;
		} catch (error) {
			this.logger.error("Erro ao obter texto de saudação:", error);
			return "🦇 Olá! Eu sou a Ravena, um bot de WhatsApp. Digite !cmd para ver os comandos disponíveis.";
		}
	}

	/**
	 * Processa a saudação para um usuário
	 * @param {WhatsAppBot} bot - Instância do bot
	 * @param {Object} message - A mensagem do usuário
	 * @returns {Promise<boolean>} - Se a saudação foi enviada
	 */
	async processGreeting(bot, message) {
		try {
			// Verificar se a mensagem é de chat privado
			if (message.group) {
				return false;
			}

			const userId = message.author;
			const botId = bot.id;

			// Verificar se o usuário já foi saudado recentemente por este bot
			if (await this.wasGreetedRecently(userId, botId)) {
				this.logger.debug(`Usuário ${userId} já foi saudado recentemente pelo bot ${botId}`);
				return false;
			} else {
				this.logger.debug(`Usuário ${userId} será saudado pelo bot ${botId}!`);
			}

			// Obter o texto de saudação
			const greetingText = await this.getGreetingText();

			// Enviar a saudação
			await bot.sendMessage(userId, greetingText);

			// Marcar o usuário como saudado por este bot
			await this.markAsGreeted(userId, botId);

			this.logger.info(`Saudação enviada para ${userId} pelo bot ${botId}`);
			await sleep(3000);
			return true;
		} catch (error) {
			this.logger.error("Erro ao processar saudação:", error);
			return false;
		}
	}
}

// Instância única
let instance = null;

module.exports = {
	getInstance: () => {
		if (!instance) {
			instance = new UserGreetingManager();
		}
		return instance;
	}
};
