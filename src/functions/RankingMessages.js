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
 * Remove usuário do ranking
 * @param {string} chatId - ID do chat
 * @param {string} userId - ID do usuário
 */
async function removeUserFromRanking(chatId, userId) {
	try {
		await database.dbRun(dbName, `DELETE FROM ranking WHERE chat_id = ? AND user_id = ?`, [
			chatId,
			userId
		]);
	} catch (error) {
		logger.error("Erro ao remover usuário do ranking:", error);
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
			logger.error("Erro ao obter nome da pessoa que enviou msg:", {
				error,
				message
			});
		}

		// Atualiza contagem de mensagens
		await updateMessageCount(chatId, userId, userName);
	} catch (error) {
		logger.error("Erro ao processar mensagem para ranking:", error);
	}
}

/**
 * Helper to strip domain from JID
 */
function normalizeId(id) {
	if (!id) return "";
	return id.replace(/@.*/, "");
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

		const isCompleto = args[0]?.toLowerCase() === "completo";

		// Obtém ranking
		const ranking = await getMessageRanking(chatId);

		// Get participants
		const participants =
			message.origin?.groupData?.Participants ??
			message.evoMessageData?.groupData?.Participants ??
			[];

		// Identify missing
		const missingParticipants = [];

		if (participants.length > 0) {
			const rankedIds = new Set(ranking.map((r) => normalizeId(r.numero)));

			for (const p of participants) {
				// Try to find the ID
				const pIds = [p.PhoneNumber, p.LID, p.JID].map((id) => normalizeId(id)).filter((id) => id); // normalize and filter empty

				// Check if any of these IDs are in the rankedIds
				const isRanked = pIds.some((id) => rankedIds.has(id));

				if (!isRanked) {
					missingParticipants.push({
						name: p.DisplayName || "Pessoa", // Try to get a name if available, otherwise 'Pessoa'
						id: p.PhoneNumber // Use PhoneNumber as display ID reference
					});
				}
			}
		}

		if (ranking.length === 0 && missingParticipants.length === 0) {
			return new ReturnMessage({
				chatId,
				content: "Ainda não há estatísticas de mensagens para este grupo."
			});
		}

		// Formata a resposta
		let response = "*🏆 Ranking de faladores do grupo 🗣*\n\n";

		// Emojis para os 3 primeiros lugares
		const medals = ["🥇", "🥈", "🥉"];

		// Determine list to show
		const limit = isCompleto ? ranking.length : 10;
		const displayList = ranking.slice(0, limit);

		displayList.forEach((item, index) => {
			const position = index < 3 ? medals[index] : `${index + 1}º`;
			let line = `${position} *${item.nome}*: ${item.qtdMsgs} mensagens`;
			if (isCompleto) {
				line += ` (${normalizeId(item.numero)})`;
			}
			response += `${line}\n`;
		});

		if (!isCompleto && ranking.length > 10) {
			response += `... e mais ${ranking.length - 10} membros (use '${bot.prefix}faladores completo' para ver todos)\n`;
		}

		// Add "Nunca vi" section
		if (missingParticipants.length > 0) {
			response += `\n🙊 *Nunca vi*:\n> Nenhuma mensagem registrada destes membros\n`;

			const resolvedMissing = await Promise.all(
				missingParticipants.map(async (p) => {
					let displayName = p.name;
					const pId = p.id;

					if (!displayName || displayName === "Pessoa") {
						try {
							const contact = await bot.client.getContactById(pId);
							displayName =
								contact.name?.pushName ??
								contact.name ??
								contact.pushName ??
								contact.pushname ??
								contact.number ??
								`Alguém (${normalizeId(pId)})`;
						} catch (e) {
							displayName = `Alguém (${normalizeId(pId)})`;
						}
					}
					return { name: displayName, id: pId };
				})
			);

			resolvedMissing.forEach((p) => {
				const pName = p.name;

				let line = `- ${pName}`;
				if (isCompleto) {
					line += ` (${normalizeId(p.id)})`;
				}
				response += `${line}\n`;
			});
		}
		// Adiciona estatísticas gerais
		const totalMessages = ranking.reduce((sum, item) => sum + item.qtdMsgs, 0);
		const totalUsers = ranking.length;

		response += `\n📊 *Estatísticas:*
`;
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

/**
 * Limpa do ranking membros que não estão mais no grupo
 */
async function faladoresLimpezaCommand(bot, message, args, group) {
	try {
		const userId = message.author || message.authorAlt;
		const chatId = message.group ?? userId;

		if (!message.group) {
			return new ReturnMessage({
				chatId,
				content: "Comando apenas para grupos."
			});
		}

		const participants =
			message.origin?.groupData?.Participants ?? message.evoMessageData?.groupData?.Participants;

		if (!participants || participants.length === 0) {
			return new ReturnMessage({
				chatId,
				content:
					"Não foi possível obter a lista de participantes do grupo para verificar a limpeza."
			});
		}

		const ranking = await getMessageRanking(chatId);
		let removedCount = 0;

		// Build set of current participant IDs (normalized)
		const currentMemberIds = new Set();
		participants.forEach((p) => {
			if (p.PhoneNumber) currentMemberIds.add(normalizeId(p.PhoneNumber));
			if (p.LID) currentMemberIds.add(normalizeId(p.LID));
			if (p.JID) currentMemberIds.add(normalizeId(p.JID));
		});

		for (const item of ranking) {
			const dbId = normalizeId(item.numero);
			if (!currentMemberIds.has(dbId)) {
				// User in ranking but not in current participants
				await removeUserFromRanking(chatId, item.numero);
				removedCount++;
			}
		}

		return new ReturnMessage({
			chatId,
			content: `Limpeza concluída! 🧹\n${removedCount} membros antigos foram removidos do ranking.`
		});
	} catch (error) {
		logger.error("Erro em faladores-limpeza:", error);
		return new ReturnMessage({
			chatId: message.group ?? message.author,
			content: "Erro ao realizar limpeza do ranking."
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
	}),
	new Command({
		name: "faladores-limpeza",
		description: "Remove do ranking membros que saíram do grupo",
		category: "grupo",
		method: faladoresLimpezaCommand,
		reactions: { after: "🧹", error: "❌" }
	})
];

module.exports = {
	commands,
	processMessage
};
