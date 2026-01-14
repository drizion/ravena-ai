// src/functions/PintoGame.js
const path = require("path");
const Logger = require("../utils/Logger");
const ReturnMessage = require("../models/ReturnMessage");
const Command = require("../models/Command");
const Database = require("../utils/Database");

const logger = new Logger("pinto-game");
const database = Database.getInstance();
const dbName = "pinto";

// Initialize database
database.getSQLiteDb(
	dbName,
	`
    CREATE TABLE IF NOT EXISTS pinto_scores (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      flaccid REAL,
      erect REAL,
      girth REAL,
      score INTEGER,
      last_updated INTEGER,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS pinto_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT,
      user_id TEXT,
      user_name TEXT,
      flaccid REAL,
      erect REAL,
      girth REAL,
      score INTEGER,
      timestamp INTEGER
    );
`
);

// Constantes do jogo
const MIN_FLACCID = 0.5;
const MAX_FLACCID = 15.0;
const MIN_ERECT = 0.5;
const MAX_ERECT = 40.0;
const MIN_GIRTH = 6.0;
const MAX_GIRTH = 20.0;
const MAX_SCORE = 1000;
const COOLDOWN_DAYS = 7; // 7 dias de cooldown

/**
 * Gera um valor aleatório entre min e max com 1 casa decimal
 * @param {number} min - Valor mínimo
 * @param {number} max - Valor máximo
 * @returns {number} - Valor aleatório com 1 casa decimal
 */
function generateRandomValue(min, max) {
	const value = Math.random() * (max - min) + min;
	return Math.round(value * 10) / 10; // Arredonda para 1 casa decimal
}

/**
 * Calcula o score com base nos valores
 * @param {number} flaccid - Comprimento flácido
 * @param {number} erect - Comprimento ereto
 * @param {number} girth - Circunferência
 * @returns {number} - Score calculado
 */
function calculateScore(flaccid, erect, girth) {
	// Normaliza os valores (0 a 1)
	const normFlaccid = (flaccid - MIN_FLACCID) / (MAX_FLACCID - MIN_FLACCID);
	const normErect = (erect - MIN_ERECT) / (MAX_ERECT - MIN_ERECT);
	const normGirth = (girth - MIN_GIRTH) / (MAX_GIRTH - MIN_GIRTH);

	// Calcula a média ponderada (dando mais peso para o comprimento ereto)
	const weightedAvg = normFlaccid * 0.3 + normErect * 0.5 + normGirth * 0.2;

	// Converte para o score final
	return Math.round(weightedAvg * MAX_SCORE);
}

/**
 * Gera um comentário com base no score
 * @param {number} score - Score calculado
 * @returns {string} - Comentário engraçado
 */
function getComment(score) {
	if (score >= 900) {
		return "🔥 Impressionante! Você está no nível lendário!";
	} else if (score >= 800) {
		return "🏆 Excepcional! Um verdadeiro campeão!";
	} else if (score >= 700) {
		return "🌟 Incrível! Sem palavras para descrever!";
	} else if (score >= 600) {
		return "👏 Muito bem! Acima da média!";
	} else if (score >= 500) {
		return "👍 Bom resultado. Na média superior!";
	} else if (score >= 400) {
		return "😊 Resultado decente! Na média!";
	} else if (score >= 300) {
		return "🙂 Resultado aceitável. Um pouco abaixo da média.";
	} else if (score >= 200) {
		return "😐 Humm... Não é o melhor resultado, mas tudo bem.";
	} else if (score >= 100) {
		return "😬 Eita... Pelo menos você tem personalidade, certo?";
	} else {
		return "💀 F no chat... Mas tamanho não é documento!";
	}
}

/**
 * Formata data para exibição
 * @param {number} timestamp - Timestamp em milissegundos
 * @returns {string} - Data formatada
 */
function formatDate(timestamp) {
	const date = new Date(timestamp);
	return date.toLocaleDateString("pt-BR", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit"
	});
}

/**
 * Verifica se o usuário está em cooldown com base no lastUpdated salvo no banco
 * @param {string} groupId - ID do grupo
 * @param {string} userId - ID do usuário
 * @returns {Promise<Object>} - Status do cooldown e próxima data disponível
 */
async function checkCooldown(groupId, userId) {
	try {
		const row = await database.dbGet(
			dbName,
			`
      SELECT last_updated FROM pinto_scores
      WHERE group_id = ? AND user_id = ?
    `,
			[groupId, userId]
		);

		if (row && row.last_updated) {
			const now = Date.now();
			const lastUsed = row.last_updated;
			const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

			if (now - lastUsed < cooldownMs) {
				const nextAvailable = new Date(lastUsed + cooldownMs);
				const timeUntil = nextAvailable - now;
				const daysUntil = Math.ceil(timeUntil / (24 * 60 * 60 * 1000));

				return {
					inCooldown: true,
					nextAvailable,
					daysUntil
				};
			}
		}
	} catch (error) {
		logger.error("Erro ao verificar cooldown:", error);
	}

	// Sem cooldown ativo
	return {
		inCooldown: false
	};
}

/**
 * Gera os resultados do comando !pinto
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage>} Mensagem de retorno
 */
async function pintoCommand(bot, message, args, group) {
	try {
		// Verifica se está em um grupo
		if (!message.group) {
			return new ReturnMessage({
				chatId: message.author,
				content: "Este jogo só pode ser jogado em grupos.",
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});
		}

		// Obtém IDs e nome
		const groupId = message.group;
		const userId = message.author ?? message.authorAlt;
		const userName =
			message.name ?? message.pushName ?? message.pushname ?? message.authorName ?? "Fulano";

		// Verifica o cooldown baseado no lastUpdated salvo no banco
		const cooldownStatus = await checkCooldown(groupId, userId);

		if (cooldownStatus.inCooldown) {
			return new ReturnMessage({
				chatId: groupId,
				content: `🌀 ${userName}, você já realizou sua avaliação recentemente.\n\nPróxima avaliação disponível em ${cooldownStatus.daysUntil} dia(s), dia ${formatDate(cooldownStatus.nextAvailable)}.`,
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});
		}

		// Gera os valores aleatórios
		const flaccid = generateRandomValue(MIN_FLACCID, MAX_FLACCID);
		const erect = generateRandomValue(Math.max(flaccid, MIN_ERECT), MAX_ERECT); // Ereto é no mínimo igual ao flácido
		const girth = generateRandomValue(MIN_GIRTH, MAX_GIRTH);

		// Calcula o score
		const score = calculateScore(flaccid, erect, girth);

		// Obtém um comentário baseado no score
		const comment = getComment(score);

		// Timestamp atual
		const currentTimestamp = Date.now();

		// Salva os resultados no banco de dados
		try {
			// Salva ou atualiza os dados do jogador para este grupo
			await database.dbRun(
				dbName,
				`
        INSERT INTO pinto_scores (group_id, user_id, user_name, flaccid, erect, girth, score, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(group_id, user_id) DO UPDATE SET
          user_name = excluded.user_name,
          flaccid = excluded.flaccid,
          erect = excluded.erect,
          girth = excluded.girth,
          score = excluded.score,
          last_updated = excluded.last_updated
      `,
				[groupId, userId, userName, flaccid, erect, girth, score, currentTimestamp]
			);

			// Adiciona ao histórico geral
			await database.dbRun(
				dbName,
				`
        INSERT INTO pinto_history (group_id, user_id, user_name, flaccid, erect, girth, score, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
				[groupId, userId, userName, flaccid, erect, girth, score, currentTimestamp]
			);
		} catch (dbError) {
			logger.error("Erro ao salvar dados do jogo:", dbError);
			throw dbError; // Re-throw para cair no catch principal se falhar o banco
		}

		// Prepara a mensagem de resposta
		const response =
			`${userName}, fiz a análise completa de seu membro e cheguei nos seguintes resultados:\n\n` +
			`• *Comprimento Flácido:* ${flaccid.toFixed(1)} cm\n` +
			`• *Comprimento Ereto:* ${erect.toFixed(1)} cm\n` +
			`• *Circunferência:* ${girth.toFixed(1)} cm\n` +
			`• *Score:* _${score} pontos_\n\n` +
			`${comment}\n\n` +
			`> Você pode voltar daqui a 1 semana para refazermos sua avaliação.`;

		return new ReturnMessage({
			chatId: groupId,
			content: response,
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	} catch (error) {
		logger.error("Erro no comando de pinto:", error);

		return new ReturnMessage({
			chatId: message.group ?? message.author,
			content: "❌ Erro ao processar o comando. Por favor, tente novamente.",
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	}
}

/**
 * Mostra o ranking do jogo Pinto
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage>} Mensagem de retorno
 */
async function pintoRankingCommand(bot, message, args, group) {
	try {
		// Verifica se está em um grupo
		if (!message.group) {
			return new ReturnMessage({
				chatId: message.author,
				content: "🏆 O ranking do jogo só pode ser visualizado em grupos."
			});
		}

		const groupId = message.group;

		// Obtém o ranking do banco de dados
		const topPlayers = await database.dbAll(
			dbName,
			`
      SELECT user_id, user_name, score
      FROM pinto_scores
      WHERE group_id = ?
      ORDER BY score DESC
      LIMIT 10
    `,
			[groupId]
		);

		if (topPlayers.length === 0) {
			return new ReturnMessage({
				chatId: groupId,
				content: "🏆 Ainda não há dados para o ranking neste grupo. Use !pinto para participar!"
			});
		}

		// Prepara a mensagem de ranking
		let rankingMessage = `🍆 *Ranking do Tamanho - ${group.name || "Grupo"}*

`;

		topPlayers.forEach((player, index) => {
			const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
			rankingMessage += `${medal} ${player.user_name}: ${player.score} pontos\n`;
		});

		// Verifica a posição do usuário se ele não estiver no top 10
		const userId = message.author ?? message.authorAlt;
		const userInTop10 = topPlayers.some((p) => p.user_id === userId);

		if (!userInTop10) {
			const userScore = await database.dbGet(
				dbName,
				`
        SELECT score FROM pinto_scores
        WHERE group_id = ? AND user_id = ?
      `,
				[groupId, userId]
			);

			if (userScore) {
				const betterPlayers = await database.dbGet(
					dbName,
					`
          SELECT COUNT(*) as count FROM pinto_scores
          WHERE group_id = ? AND score > ?
        `,
					[groupId, userScore.score]
				);

				const rank = betterPlayers.count + 1;
				rankingMessage += `
...

`;
				rankingMessage += `${rank}. Você: ${userScore.score} pontos`;
			}
		}

		return new ReturnMessage({
			chatId: groupId,
			content: rankingMessage
		});
	} catch (error) {
		logger.error("Erro ao mostrar ranking do jogo:", error);

		return new ReturnMessage({
			chatId: message.group ?? message.author,
			content: "❌ Erro ao mostrar ranking. Por favor, tente novamente."
		});
	}
}

/**
 * Reseta os dados do jogo Pinto para um grupo específico
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage[]>} Array de mensagens de retorno
 */
async function pintoResetCommand(bot, message, args, group) {
	try {
		// Verifica se está em um grupo
		if (!message.group) {
			return [
				new ReturnMessage({
					chatId: message.author,
					content: "O reset do jogo só pode ser executado em grupos."
				})
			];
		}

		const groupId = message.group;
		const userId = message.author;

		// Verifica se o usuário é admin
		const isAdmin = await bot.isUserAdminInGroup(userId, groupId);
		if (!isAdmin) {
			return [
				new ReturnMessage({
					chatId: groupId,
					content: "⛔ Apenas administradores podem resetar os dados do jogo.",
					options: {
						quotedMessageId: message.origin.id._serialized,
						evoReply: message.origin
					}
				})
			];
		}

		// Verifica quantos jogadores existem antes de deletar
		const countResult = await database.dbGet(
			dbName,
			`
      SELECT COUNT(*) as count FROM pinto_scores WHERE group_id = ?
    `,
			[groupId]
		);

		const numJogadores = countResult ? countResult.count : 0;

		// Verifica se há dados para este grupo
		if (numJogadores === 0) {
			return [
				new ReturnMessage({
					chatId: groupId,
					content: "⚠️ Não há dados do jogo para este grupo.",
					options: {
						quotedMessageId: message.origin.id._serialized,
						evoReply: message.origin
					}
				})
			];
		}

		// Obtém o ranking atual antes de resetar
		const rankingMessage = await pintoRankingCommand(bot, message, args, group);

		// Reseta os dados do grupo (Scores)
		await database.dbRun(
			dbName,
			`
      DELETE FROM pinto_scores WHERE group_id = ?
    `,
			[groupId]
		);

		// Retorna mensagens
		return [
			rankingMessage,
			new ReturnMessage({
				chatId: groupId,
				content: `🔄 *Dados do Jogo Pinto Resetados*\n\nForam removidos dados de ${numJogadores} jogadores deste grupo.\n\nO ranking acima mostra como estava antes do reset.`,
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			})
		];
	} catch (error) {
		logger.error("Erro ao resetar dados do jogo:", error);

		return [
			new ReturnMessage({
				chatId: message.group ?? message.author,
				content: "Erro ao resetar dados do jogo. Por favor, tente novamente."
			})
		];
	}
}

// Criar array de comandos usando a classe Command
const commands = [
	new Command({
		name: "pinto",
		description: "Gera uma avaliação de tamanho aleatória",
		category: "jogos",
		cooldown: 0, // O cooldown é controlado internamente pelo lastUpdated
		reactions: {
			before: "📏",
			after: "🍆",
			error: "❌"
		},
		method: pintoCommand
	}),

	new Command({
		name: "pinto-ranking",
		description: "Mostra o ranking do jogo",
		category: "jogos",
		cooldown: 30,
		reactions: {
			after: "🏆",
			error: "❌"
		},
		method: pintoRankingCommand
	}),

	new Command({
		name: "pinto-reset",
		description: "Reseta os dados do jogo para este grupo",
		category: "jogos",
		adminOnly: true,
		cooldown: 60,
		reactions: {
			after: "🔄",
			error: "❌"
		},
		method: pintoResetCommand
	})
];

module.exports = { commands };
