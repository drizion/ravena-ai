const Logger = require("../utils/Logger");
const Command = require("../models/Command");
const ReturnMessage = require("../models/ReturnMessage");
const Database = require("../utils/Database");
const axios = require("axios");
const cron = require("node-cron");

const logger = new Logger("correios-commands");
const database = Database.getInstance();
const DB_NAME = "correios";

/**
 * Initializes the Correios tracking database and background task
 */
async function inicializarRastreio(bot) {
	try {
		await database.getSQLiteDb(
			DB_NAME,
			`
			CREATE TABLE IF NOT EXISTS tracks (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT,
				chat_id TEXT,
				code TEXT,
				description TEXT,
				last_event_text TEXT,
				last_event_date TEXT,
				last_check INTEGER,
				UNIQUE(chat_id, code)
			);
			`,
			true
		);

		// Start cron job: every 6 hours
		// 0 */6 * * *
		cron.schedule("0 */6 * * *", async () => {
			logger.info("[CorreiosCron] Iniciando verificação de pacotes...");
			await checkAllPackages(bot);
		});

		logger.info("[Correios] Sistema de rastreio inicializado com sucesso.");
	} catch (error) {
		logger.error("[Correios] Erro ao inicializar sistema:", error);
	}
}

/**
 * Checks all registered packages for updates
 */
async function checkAllPackages(bot) {
	try {
		const tracks = await database.dbAll(DB_NAME, "SELECT * FROM tracks");
		logger.debug(`[CorreiosCron] Verificando ${tracks.length} pacotes.`);

		for (const track of tracks) {
			try {
				const result = await trackCode(track.code);
				if (!result || !result.eventos || result.eventos.length === 0) continue;

				const lastEvent = result.eventos[0];
				const currentText = lastEvent.status || lastEvent.mensagem;
				const currentDate = lastEvent.data + " " + (lastEvent.hora || "");

				// If status changed
				if (currentText !== track.last_event_text || currentDate !== track.last_event_date) {
					logger.info(
						`[CorreiosCron] Atualização encontrada para ${track.code} (${track.description})`
					);

					// Update DB
					await database.dbRun(
						DB_NAME,
						"UPDATE tracks SET last_event_text = ?, last_event_date = ?, last_check = ? WHERE id = ?",
						[currentText, currentDate, Date.now(), track.id]
					);

					// Notify user
					const msg = `📦 *Atualização de Rastreio!*\n\n*Pacote:* ${track.description}\n*Código:* \`${track.code}\`\n\n*Status:* ${currentText}\n*Local:* ${lastEvent.local || "Não informado"}\n*Data:* ${currentDate}`;

					bot
						.sendMessage(track.chat_id, msg)
						.catch((e) => logger.error(`Erro ao notificar ${track.chat_id}:`, e));
				} else {
					// Just update last check
					await database.dbRun(DB_NAME, "UPDATE tracks SET last_check = ? WHERE id = ?", [
						Date.now(),
						track.id
					]);
				}

				// Sleep a bit between requests to avoid rate limit
				await new Promise((r) => setTimeout(r, 2000));
			} catch (e) {
				logger.error(`[CorreiosCron] Erro ao verificar código ${track.code}:`, e.message);
			}
		}
	} catch (error) {
		logger.error("[CorreiosCron] Erro geral na verificação:", error);
	}
}

/**
 * Tracks a code using Link&Track API (Public)
 */
async function trackCode(code) {
	try {
		// Using a well-known public test user/token for Link&Track
		const user = "test";
		const token = "1abcd00b2731640e886fb4b8d3a1s5a46x32p1d2";
		const url = `https://api.linketrack.com/track/json?user=${user}&token=${token}&codigo=${code}`;

		const response = await axios.get(url, { timeout: 10000 });
		return response.data;
	} catch (error) {
		logger.error(`[CorreiosAPI] Erro ao rastrear ${code}:`, error.message);
		return null;
	}
}

/**
 * Command: !correios [code] [description]
 */
async function correiosCommand(bot, message, args, group) {
	const chatId = message.group ?? message.author;
	const userId = message.author;

	if (args.length === 0) {
		return new ReturnMessage({
			chatId,
			content:
				"📦 *Rastreio de Objetos (Correios)*\n\nUso: !correios [CÓDIGO] [DESCRIÇÃO]\nExemplo: !correios NA123456789BR Monitor Novo\n\nComandos extras:\n!correios-lista\n!correios-del [CÓDIGO]",
			options: { quotedMessageId: message.origin.id._serialized }
		});
	}

	const code = args[0].toUpperCase();
	const description = args.slice(1).join(" ") || "Meu Pacote";

	if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code)) {
		return "❌ Formato de código inválido. Use o padrão (ex: AA123456789BR).";
	}

	try {
		// Check if already tracking in this chat
		const existing = await database.dbGet(
			DB_NAME,
			"SELECT * FROM tracks WHERE chat_id = ? AND code = ?",
			[chatId, code]
		);
		if (existing) {
			return `⚠️ Você já está rastreando o código \`${code}\` neste chat.`;
		}

		// Initial lookup
		const result = await trackCode(code);
		let lastText = "Aguardando postagem";
		let lastDate = "-";

		if (result && result.eventos && result.eventos.length > 0) {
			const lastEvent = result.eventos[0];
			lastText = lastEvent.status || lastEvent.mensagem;
			lastDate = lastEvent.data + " " + (lastEvent.hora || "");
		}

		await database.dbRun(
			DB_NAME,
			"INSERT INTO tracks (user_id, chat_id, code, description, last_event_text, last_event_date, last_check) VALUES (?, ?, ?, ?, ?, ?, ?)",
			[userId, chatId, code, description, lastText, lastDate, Date.now()]
		);

		return new ReturnMessage({
			chatId,
			content: `✅ *Rastreio Adicionado!*\n\n*Pacote:* ${description}\n*Código:* \`${code}\`\n*Status Atual:* ${lastText}\n\nVocê será notificado aqui sempre que o status mudar (verificação a cada 6 horas).`,
			options: { quotedMessageId: message.origin.id._serialized }
		});
	} catch (error) {
		logger.error("Error in correiosCommand:", error);
		return "❌ Erro ao adicionar rastreio.";
	}
}

/**
 * Command: !correios-lista
 */
async function correiosListaCommand(bot, message, args, group) {
	const chatId = message.group ?? message.author;

	try {
		const tracks = await database.dbAll(DB_NAME, "SELECT * FROM tracks WHERE chat_id = ?", [
			chatId
		]);

		if (tracks.length === 0) {
			return "📭 Nenhum pacote sendo rastreado neste chat.";
		}

		let list = `📦 *Pacotes em Rastreio (${tracks.length}):*\n\n`;
		for (const track of tracks) {
			list += `• \`${track.code}\` - *${track.description}*\n`;
			list += `  └ _${track.last_event_text}_ (${track.last_event_date})\n\n`;
		}

		return list;
	} catch (error) {
		logger.error("Error in correiosListaCommand:", error);
		return "❌ Erro ao listar pacotes.";
	}
}

/**
 * Command: !correios-del [code]
 */
async function correiosDelCommand(bot, message, args, group) {
	const chatId = message.group ?? message.author;

	if (args.length === 0) {
		return "❌ Informe o código que deseja remover. Ex: !correios-del NA123456789BR";
	}

	const code = args[0].toUpperCase();

	try {
		const result = await database.dbRun(
			DB_NAME,
			"DELETE FROM tracks WHERE chat_id = ? AND code = ?",
			[chatId, code]
		);

		// result.changes tells how many rows were affected
		if (result && result.changes > 0) {
			return `✅ Rastreio do código \`${code}\` removido com sucesso.`;
		} else {
			return `⚠️ Código \`${code}\` não encontrado no rastreio deste chat.`;
		}
	} catch (error) {
		logger.error("Error in correiosDelCommand:", error);
		return "❌ Erro ao remover rastreio.";
	}
}

const commands = [
	new Command({
		name: "correios",
		description: "Rastreia uma encomenda dos Correios",
		category: "utilidades",
		reactions: {
			before: "📦",
			after: "✅"
		},
		method: correiosCommand
	}),
	new Command({
		name: "correios-lista",
		description: "Lista encomendas sendo rastreadas no chat",
		category: "utilidades",
		reactions: {
			before: "📋"
		},
		method: correiosListaCommand
	}),
	new Command({
		name: "correios-del",
		description: "Para de rastrear uma encomenda",
		category: "utilidades",
		reactions: {
			before: "🗑️",
			after: "✅"
		},
		method: correiosDelCommand
	})
];

module.exports = { commands, inicializarRastreio };
