const path = require("path");
const Logger = require("../utils/Logger");
const Database = require("../utils/Database");
const ReturnMessage = require("../models/ReturnMessage");
const Command = require("../models/Command");
const LLMService = require("../services/LLMService");
const { MessageMedia } = require("whatsapp-web.js");

const logger = new Logger("food-tracker");
const database = Database.getInstance();
const llmService = new LLMService({});
const dbName = "food_tracker";

// --- Database Setup ---
database.getSQLiteDb(
	dbName,
	`
    CREATE TABLE IF NOT EXISTS food_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        group_id TEXT,
        timestamp INTEGER NOT NULL,
        total_calories INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS food_ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        quantity TEXT,
        calories INTEGER DEFAULT 0,
        FOREIGN KEY (entry_id) REFERENCES food_entries(id) ON DELETE CASCADE
    );
    `
);

// --- LLM Schema ---
const foodAnalysisSchema = {
	type: "json_schema",
	json_schema: {
		name: "food_analysis",
		schema: {
			type: "object",
			properties: {
				is_food: {
					type: "boolean",
					description: "True if the image contains food, false otherwise."
				},
				ingredients: {
					type: "array",
					items: {
						type: "object",
						properties: {
							name: { type: "string", description: "Name of the ingredient in Portuguese." },
							quantity: {
								type: "string",
								description: "Approximate quantity (e.g., '100g', '1 unidade')."
							},
							calories: { type: "integer", description: "Approximate calories for this portion." }
						},
						required: ["name", "quantity", "calories"]
					}
				},
				total_calories: {
					type: "integer",
					description: "Total calories of the meal."
				}
			},
			required: ["is_food", "ingredients", "total_calories"]
		}
	}
};

// --- Helper Functions ---

async function getMediaFromMessage(message) {
	if (message.type === "image") {
		return message.content || (message.downloadMedia ? await message.downloadMedia() : null);
	}

	try {
		const quotedMsg = await message.origin.getQuotedMessage();
		if (quotedMsg && quotedMsg.type === "image") {
			return await quotedMsg.downloadMedia();
		}
	} catch (error) {
		logger.error("Error getting quoted message media:", error);
	}
	return null;
}

function classifyMeal(date) {
	const hour = date.getHours();
	if (hour >= 5 && hour < 10) return "Café da Manhã";
	if (hour >= 10 && hour < 12) return "Lanche da Manhã";
	if (hour >= 12 && hour < 15) return "Almoço";
	if (hour >= 15 && hour < 19) return "Lanche da Tarde";
	if (hour >= 19 && hour < 23) return "Janta";
	return "Ceia";
}

// --- Commands ---

async function comidaCommand(bot, message, args, group) {
	const chatId = message.group ?? message.author;
	const media = await getMediaFromMessage(message);

	if (!media) {
		const warningMsg = new ReturnMessage({
			chatId,
			content:
				"⚠️ *Atenção:* Para analisar uma refeição, envie uma foto com a legenda `!comida` ou responda a uma foto com esse comando.\n\n👇 *Abaixo estão suas estatísticas atuais:*",
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
		const infoMsg = await comidaInfoCommand(bot, message, args, group);
		return [warningMsg, infoMsg];
	}

	try {
		let promptText =
			"Analise esta imagem e identifique os alimentos. Retorne os ingredientes, quantidades aproximadas e calorias.";

		if (args.length > 0) {
			promptText += `\n\nContexto adicional fornecido pelo usuário: ${args.join(" ")}`;
		}

		const response = await llmService.getCompletion({
			prompt: promptText,
			systemContext:
				"Você é um nutricionista especialista. Analise a imagem e identifique se há comida. Se houver, liste os ingredientes em Português do Brasil, estime a quantidade e as calorias. Retorne APENAS o JSON conforme o schema.",
			image: media.data, // Assumes media.data is base64
			response_format: foodAnalysisSchema
		});

		let analysis;
		try {
			analysis = JSON.parse(response);
		} catch (e) {
			logger.error("Failed to parse LLM response:", e);
			return new ReturnMessage({
				chatId,
				content: "❌ Ocorreu um erro ao processar a resposta da IA. Tente novamente.",
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});
		}

		if (!analysis.is_food) {
			return new ReturnMessage({
				chatId,
				content:
					"❌ Não consegui identificar comida nesta imagem. Certifique-se de que a foto esteja clara e contenha alimentos.",
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});
		}

		// Save to Database
		const timestamp = Date.now();
		const result = await database.dbRun(
			dbName,
			"INSERT INTO food_entries (user_id, group_id, timestamp, total_calories) VALUES (?, ?, ?, ?)",
			[message.author, message.group || null, timestamp, analysis.total_calories]
		);
		const entryId = result.lastID;

		const ingredientInserts = analysis.ingredients.map((ing) =>
			database.dbRun(
				dbName,
				"INSERT INTO food_ingredients (entry_id, name, quantity, calories) VALUES (?, ?, ?, ?)",
				[entryId, ing.name, ing.quantity, ing.calories]
			)
		);
		await Promise.all(ingredientInserts);

		// Format Response
		const dateStr = new Date(timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
		let responseText = `🍽️ *Análise de Comida*\n📅 ${dateStr}\n\n`;

		analysis.ingredients.forEach((ing) => {
			responseText += `▫️ *${ing.name}*: ${ing.quantity} (~${ing.calories} kcal)\n`;
		});

		responseText += `\n🔥 *Total Calórico Estimado:* ${analysis.total_calories} kcal\n`;
		responseText += `\n✅ _Dados salvos com sucesso! Use !comida-info para ver suas estatísticas._`;

		return new ReturnMessage({
			chatId,
			content: responseText,
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	} catch (error) {
		logger.error("Error in comida command:", error);
		return new ReturnMessage({
			chatId,
			content: "❌ Erro ao analisar a imagem.",
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	}
}

async function comidaInfoCommand(bot, message, args, group) {
	const chatId = message.group ?? message.author;
	const userId = message.author;

	try {
		const entries = await database.dbAll(
			dbName,
			"SELECT * FROM food_entries WHERE user_id = ? ORDER BY timestamp DESC",
			[userId]
		);

		if (entries.length === 0) {
			return new ReturnMessage({
				chatId,
				content:
					"📊 Você ainda não tem registros de comida. Use `!comida` enviando uma foto para começar!",
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});
		}

		const now = new Date();
		const oneDay = 24 * 60 * 60 * 1000;

		let todayCals = 0;
		let weekCals = 0;
		let monthCals = 0;
		let yearCals = 0;

		const mealStats = {};

		entries.forEach((entry) => {
			const date = new Date(entry.timestamp);
			const diffTime = now - date;
			const diffDays = Math.ceil(diffTime / oneDay);

			if (diffDays <= 1 && date.getDate() === now.getDate()) todayCals += entry.total_calories;
			if (diffDays <= 7) weekCals += entry.total_calories;
			if (diffDays <= 30) monthCals += entry.total_calories;
			if (diffDays <= 365) yearCals += entry.total_calories;

			const mealType = classifyMeal(date);
			if (!mealStats[mealType]) mealStats[mealType] = { count: 0, total: 0 };
			mealStats[mealType].count++;
			mealStats[mealType].total += entry.total_calories;
		});

		let msg = `📊 *Suas Estatísticas de Alimentação*\n\n`;
		msg += `🔥 *Hoje:* ${todayCals} kcal\n`;
		msg += `📅 *Esta Semana:* ${weekCals} kcal (Média: ${Math.round(weekCals / 7)}/dia)\n`;
		msg += `🗓️ *Este Mês:* ${monthCals} kcal (Média: ${Math.round(monthCals / 30)}/dia)\n`;
		msg += `📈 *Este Ano:* ${yearCals} kcal\n\n`;

		msg += `🥘 *Médias por Refeição:*
`;
		for (const [meal, stats] of Object.entries(mealStats)) {
			msg += `▫️ ${meal}: ~${Math.round(stats.total / stats.count)} kcal (${stats.count}x)\n`;
		}

		return new ReturnMessage({
			chatId,
			content: msg,
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	} catch (error) {
		logger.error("Error in comida-info command:", error);
		return new ReturnMessage({
			chatId,
			content: "❌ Erro ao buscar estatísticas.",
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	}
}

async function comidaListaCommand(bot, message, args, group) {
	const chatId = message.group ?? message.author;
	const userId = message.author;

	// Check if requesting specific entry
	if (args.length > 0 && !isNaN(args[0])) {
		const index = parseInt(args[0]) - 1; // User uses 1-based index

		// Fetch all entries to map index to ID (or we could try to select by rowid/limit/offset logic, but array map is safer for consistency with list)
		// Ideally we would fetch just the one, but IDs might not be sequential for the user.
		// Let's re-fetch the list logic to find the correct ID.
		const entries = await database.dbAll(
			dbName,
			"SELECT * FROM food_entries WHERE user_id = ? ORDER BY timestamp DESC",
			[userId]
		);

		if (index < 0 || index >= entries.length) {
			return new ReturnMessage({
				chatId,
				content: "❌ Índice inválido.",
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});
		}

		const entry = entries[index];

		// DELETE COMMAND
		if (args[1] && args[1].toLowerCase() === "deletar") {
			try {
				await database.dbRun(dbName, "DELETE FROM food_entries WHERE id = ?", [entry.id]);
				return new ReturnMessage({
					chatId,
					content: `✅ Refeição [${args[0]}] deletada com sucesso!`,
					options: {
						quotedMessageId: message.origin.id._serialized,
						evoReply: message.origin
					}
				});
			} catch (error) {
				logger.error("Error deleting food entry:", error);
				return new ReturnMessage({
					chatId,
					content: "❌ Erro ao deletar refeição.",
					options: {
						quotedMessageId: message.origin.id._serialized,
						evoReply: message.origin
					}
				});
			}
		}

		const ingredients = await database.dbAll(
			dbName,
			"SELECT * FROM food_ingredients WHERE entry_id = ?",
			[entry.id]
		);

		const dateStr = new Date(entry.timestamp).toLocaleString("pt-BR", {
			timeZone: "America/Sao_Paulo"
		});
		let details = `🍽️ *Detalhes da Refeição [${index + 1}]*\n📅 ${dateStr}\n\n`;
		ingredients.forEach((ing) => {
			details += `▫️ *${ing.name}*: ${ing.quantity} (~${ing.calories} kcal)\n`;
		});
		details += `\n🔥 *Total:* ${entry.total_calories} kcal`;

		return new ReturnMessage({
			chatId,
			content: details,
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	}

	// List View
	try {
		const entries = await database.dbAll(
			dbName,
			`SELECT e.*, COUNT(i.id) as ingredient_count 
             FROM food_entries e 
             LEFT JOIN food_ingredients i ON e.id = i.entry_id 
             WHERE e.user_id = ? 
             GROUP BY e.id 
             ORDER BY e.timestamp DESC 
             LIMIT 20`,
			[userId]
		);

		if (entries.length === 0) {
			return new ReturnMessage({
				chatId,
				content: "📭 Nenhuma refeição registrada.",
				options: {
					quotedMessageId: message.origin.id._serialized,
					evoReply: message.origin
				}
			});
		}

		let listMsg = `📋 *Seu Histórico de Alimentação (Últimos 20)*\n\n`;
		listMsg += `> _Para ver detalhes, digite \`!comida-lista <número>\`_\n`;
		listMsg += `> _Para remover uma refeição, digite \`!comida-lista <número> deletar\`_\n\n`;

		entries.forEach((entry, idx) => {
			const date = new Date(entry.timestamp);
			const dateStr = date.toLocaleDateString("pt-BR");
			const timeStr = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
			listMsg += `[${idx + 1}] ${timeStr} ${dateStr}: ${entry.ingredient_count} itens, ${entry.total_calories} kcal\n`;
		});

		return new ReturnMessage({
			chatId,
			content: listMsg,
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	} catch (error) {
		logger.error("Error in comida-lista command:", error);
		return new ReturnMessage({
			chatId,
			content: "❌ Erro ao listar refeições.",
			options: {
				quotedMessageId: message.origin.id._serialized,
				evoReply: message.origin
			}
		});
	}
}

const commands = [
	new Command({
		name: "comida",
		description: "Analisa uma foto de comida e registra ingredientes e calorias.",
		category: "saude",
		cooldown: 10,
		method: comidaCommand,
		needsMedia: true,
		reactions: {
			trigger: "🍽️",
			before: "🥘",
			after: "😋",
			error: "❌"
		}
	}),
	new Command({
		name: "comida-info",
		description: "Mostra estatísticas da sua alimentação.",
		category: "saude",
		cooldown: 5,
		method: comidaInfoCommand,
		reactions: {
			after: "🍽️"
		}
	}),
	new Command({
		name: "comida-lista",
		description: "Lista seu histórico de alimentação.",
		category: "saude",
		cooldown: 5,
		method: comidaListaCommand,
		reactions: {
			after: "🥦"
		}
	})
];

module.exports = { commands };
