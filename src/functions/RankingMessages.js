const Logger = require("../utils/Logger");
const ReturnMessage = require("../models/ReturnMessage");
const Command = require("../models/Command");
const Database = require("../utils/Database");
const database = Database.getInstance();

const logger = new Logger("ranking-messages");
const dbName = "msgranking";

// Initialize database
database.getSQLiteDb(
	dbName,
	`
    CREATE TABLE IF NOT EXISTS ranking (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      message_count INTEGER DEFAULT 0,
      PRIMARY KEY (chat_id, user_id)
    )`
);

/**
 * Atualiza o ranking de mensagens para um usuário
 * @param {string} chatId - ID do chat (grupo ou PV)
 * @param {string} userId - ID do usuário
 * @param {string} userName - Nome do usuário
 */
async function updateMessageCount(chatId, userId, userName) {
	try {
		await database.dbRun(
			dbName,
			`
      INSERT INTO ranking (chat_id, user_id, user_name, message_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(chat_id, user_id) DO UPDATE SET
        message_count = message_count + 1,
        user_name = excluded.user_name
    `,
			[chatId, userId, userName]
		);
	} catch (error) {
		logger.error("Erro ao atualizar contagem de mensagens (SQLite):", error);
	}
}

/**
 * Obtém o ranking de mensagens para um chat
 * @param {string} chatId - ID do chat
 * @returns {Array} - Array de objetos de ranking ordenados por quantidade de mensagens
 */
async function getMessageRanking(chatId) {
	try {
		const rows = await database.dbAll(
			dbName,
			`
      SELECT user_name as nome, user_id as numero, message_count as qtdMsgs
      FROM ranking
      WHERE chat_id = ?
      ORDER BY message_count DESC
    `,
			[chatId]
		);

		return rows;
	} catch (error) {
		logger.error("Erro ao obter ranking de mensagens (SQLite):", error);
		return [];
	}
}

/**
 * Processa uma mensagem recebida para atualizar o ranking
 * @param {Object} message - Mensagem formatada
 */
async function processMessage(message) {
	try {
		if (!message) return;

		// Define userId trying author first, then authorAlt
		const userId = message.author || message.authorAlt;

		// If no user ID found, we can't track
		if (!userId) return;

		// Obtém ID do chat (grupo ou PV)
		// Se message.group existir, é um grupo. Se não, é PV (usa userId como chat)
		const chatId = message.group ?? userId;

		// Obtém nome do usuário
		let userName = userId;
		try {
			userName =
				message.name ?? message.pushName ?? message.pushname ?? message.authorName ?? "Fulano";
		} catch (error) {
			logger.error("Erro ao obter nome da pessoa que enviou msg:", { error, message });
		}

		// Atualiza contagem de mensagens
		await updateMessageCount(chatId, userId, userName);
	} catch (error) {
		logger.error("Erro ao processar mensagem para ranking:", error);
	}
}

/**
 * Exibe o ranking de faladores do grupo
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Mensagem formatada
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage>} - Mensagem de retorno
 */
async function faladoresCommand(bot, message, args, group) {
	try {
		const userId = message.author || message.authorAlt;
		const chatId = message.group ?? userId;

		// Verifica se está em um grupo
		if (!message.group) {
			return new ReturnMessage({
				chatId,
				content: "Este comando só funciona em grupos."
			});
		}

		// Obtém ranking
		const ranking = await getMessageRanking(chatId);

		if (ranking.length === 0) {
			return new ReturnMessage({
				chatId,
				content: "Ainda não há estatísticas de mensagens para este grupo."
			});
		}

		// Formata a resposta
		let response = "*🏆 Ranking de faladores do grupo 🗣*\n\n";

		// Adiciona até os 10 primeiros do ranking
		const topTen = ranking.slice(0, 10);

		// Emojis para os 3 primeiros lugares
		const medals = ["🥇", "🥈", "🥉"];

		topTen.forEach((item, index) => {
			const position = index < 3 ? medals[index] : `${index + 1}º`;
			response += `${position} *${item.nome}*: ${item.qtdMsgs} mensagens\n`;
		});

		// Adiciona estatísticas gerais
		const totalMessages = ranking.reduce((sum, item) => sum + item.qtdMsgs, 0);
		const totalUsers = ranking.length;

		response += `\n📊 *Estatísticas:*\n`;
		response += `Total de ${totalMessages} mensagens enviadas por ${totalUsers} participantes`;

		return new ReturnMessage({
			chatId,
			content: response
		});
	} catch (error) {
		logger.error("Erro ao executar comando de ranking de faladores:", error);

		return new ReturnMessage({
			chatId: message.group ?? message.author,
			content: "Ocorreu um erro ao obter o ranking de faladores."
		});
	}
}

// Comando para exibir o ranking de faladores
const commands = [
	new Command({
		name: "faladores",
		description: "Mostra o ranking de quem mais fala no grupo",
		category: "grupo",
		method: faladoresCommand,
		reactions: { after: "🗣", error: "❌" }
	})
];

module.exports = {
	commands,
	processMessage
};
