// src/functions/SlotsGame.js
const Logger = require("../utils/Logger");
const Database = require("../utils/Database");
const Command = require("../models/Command");
const ReturnMessage = require("../models/ReturnMessage");
const FishingGame = require("./FishingGame");

const logger = new Logger("slots-game");
const database = Database.getInstance();
const dbName = "slots";

// Initialize database
database.getSQLiteDb(
	dbName,
	`
    CREATE TABLE IF NOT EXISTS slots_users (
        user_id TEXT PRIMARY KEY,
        total_plays INTEGER DEFAULT 0,
        total_wins INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS slots_prizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        prize_name TEXT,
        prize_type TEXT,
        timestamp INTEGER
    );
`
);

const SLOT_EMOJIS = ["🍎", "🍋", "🍒", "🍇", "🍉", "🍓", "🍑", "🍍", "🥭", "💎"];

const JUNK_PRIZES = [
	"Meia furada",
	"Papel de bala mascado",
	"Garrafa pet vazia",
	"Guarda-chuva quebrado",
	"Pilha estourada",
	"Chinelo de cor diferente",
	"Fio dental usado",
	"CD arranhado da Xuxa",
	"Controle remoto sem tampa",
	"Carregador com mau contato",
	"Pente faltando dente",
	"Tupperware sem tampa",
	"Pregador de roupa quebrado",
	"Caneta sem carga",
	"Bateria de 9V lambida"
];

const WIN_MESSAGES = [
	"INACREDITÁVEL! Você limpou a banca! 🎰💰",
	"Hoje é seu dia de sorte! O jackpot é seu! ✨",
	"A sorte sorriu para você! Parabéns! 🎉",
	"Você nasceu virado pra lua! Ganhou! 🌕",
	"Os deuses do azar tiraram folga hoje! 🏆"
];

const LOSE_MESSAGES = [
	"Não foi dessa vez... A casa sempre vence! 💸",
	"Quase! Só que não. Tente de novo daqui a pouco! 🤡",
	"O azar é seu sobrenome? Que triste... 🙊",
	"Mais sorte na próxima (ou não). 📉",
	"Seu dinheiro foi pro ralo! Literalmente. 🚽",
	"Talvez você devesse tentar algo menos arriscado, tipo... atravessar a rua de olhos fechados? 🚶‍♂️",
	"A banca agradece a sua doação generosa! 🤑",
	"Sinto cheiro de derrota... e é você. 👃",
	"Seu saldo de sorte está negativo. Favor recarregar. 🔋"
];

/**
 * Obtém dados do usuário
 */
async function getUserData(userId) {
	let user = await database.dbGet(dbName, "SELECT * FROM slots_users WHERE user_id = ?", [userId]);
	if (!user) {
		await database.dbRun(
			dbName,
			"INSERT INTO slots_users (user_id, total_plays, total_wins) VALUES (?, 0, 0)",
			[userId]
		);
		user = { user_id: userId, total_plays: 0, total_wins: 0 };
	}
	return user;
}

/**
 * Salva estatísticas do usuário
 */
async function saveUserStats(userId, win = false) {
	await database.dbRun(
		dbName,
		`UPDATE slots_users 
         SET total_plays = total_plays + 1, 
             total_wins = total_wins + ? 
         WHERE user_id = ?`,
		[win ? 1 : 0, userId]
	);
}

/**
 * Salva um prêmio ganho
 */
async function savePrize(userId, prizeName, prizeType) {
	await database.dbRun(
		dbName,
		"INSERT INTO slots_prizes (user_id, prize_name, prize_type, timestamp) VALUES (?, ?, ?, ?)",
		[userId, prizeName, prizeType, Date.now()]
	);
}

/**
 * Comando principal do slots
 */
async function slotsCommand(bot, message, args, group) {
	const userId = message.author;
	const chatId = message.group ?? message.author;
	const userData = await getUserData(userId);

	// Rola os números
	const roll1 = Math.floor(Math.random() * SLOT_EMOJIS.length);
	const roll2 = Math.floor(Math.random() * SLOT_EMOJIS.length);
	const roll3 = Math.floor(Math.random() * SLOT_EMOJIS.length);

	const emoji1 = SLOT_EMOJIS[roll1];
	const emoji2 = SLOT_EMOJIS[roll2];
	const emoji3 = SLOT_EMOJIS[roll3];

	const isWin = roll1 === roll2 && roll2 === roll3;

	let resultMessage = `🎰 *CAÇA-NÍQUEIS* 🎰\n`;
	resultMessage += `___________________________________________________\n`;
	resultMessage += `|  [ ${emoji1} ] [ ${emoji2} ] [ ${emoji3} ]  |\n`;
	resultMessage += `¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯\n\n`;

	if (isWin) {
		const winMsg = WIN_MESSAGES[Math.floor(Math.random() * WIN_MESSAGES.length)];
		resultMessage += `🎊 *${winMsg}* 🎊\n\n`;

		// Determina o prêmio (70% normal, 30% bom)
		const prizeRand = Math.random();
		if (prizeRand < 0.7) {
			// Prêmio Normal (Lixo)
			const prize = JUNK_PRIZES[Math.floor(Math.random() * JUNK_PRIZES.length)];
			resultMessage += `🎁 Você ganhou: *${prize}*!\n`;
			resultMessage += `_Incrível como você tem sorte pra ganhar porcaria._ 🙄`;
			await savePrize(userId, prize, "normal");
		} else {
			// Prêmio Bom (Pesca)
			const goodRand = Math.random();
			if (goodRand < 0.7) {
				// Iscas (1-10)
				const baits = Math.floor(Math.random() * 10) + 1;
				resultMessage += `🎁 VOCÊ GANHOU: *${baits} Iscas de Pesca*! 🎣\n`;
				resultMessage += `_Vão direto pro seu balde de pesca._`;
				await FishingGame.addBaits(userId, baits);
				await savePrize(userId, `${baits} Iscas`, "bom");
			} else {
				// Upgrade
				const upgrade =
					FishingGame.UPGRADES[Math.floor(Math.random() * FishingGame.UPGRADES.length)];
				resultMessage += `🎁 VOCÊ GANHOU: *${upgrade.emoji} ${upgrade.name}*! 🛠️\n`;
				resultMessage += `_Um item de elite para sua pescaria!_`;

				const buff = {
					type: upgrade.effect,
					value: upgrade.value || 0,
					minValue: upgrade.minValue || 0,
					maxValue: upgrade.maxValue || 0,
					remainingUses: upgrade.duration || 1,
					originalName: upgrade.name
				};

				// Handle randomization if needed for some effects
				if (upgrade.effect === "extra_baits" || upgrade.effect === "next_fish_bonus") {
					buff.value =
						Math.floor(Math.random() * (upgrade.maxValue - upgrade.minValue + 1)) +
						upgrade.minValue;
				}

				await FishingGame.addBuff(userId, buff, false);
				await savePrize(userId, upgrade.name, "bom");
			}
		}
		await saveUserStats(userId, true);
	} else {
		const loseMsg = LOSE_MESSAGES[Math.floor(Math.random() * LOSE_MESSAGES.length)];
		resultMessage += `❌ ${loseMsg}`;
		await saveUserStats(userId, false);
	}

	return new ReturnMessage({
		chatId,
		content: resultMessage
	});
}

/**
 * Lista prêmios ganhos
 */
async function slotsPrizesCommand(bot, message, args, group) {
	const userId = message.author;
	const chatId = message.group ?? message.author;

	const prizes = await database.dbAll(
		dbName,
		"SELECT * FROM slots_prizes WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20",
		[userId]
	);

	if (!prizes || prizes.length === 0) {
		return new ReturnMessage({
			chatId,
			content: "🎰 Você ainda não ganhou nenhum prêmio no caça-níqueis. Tente a sorte com !slots!"
		});
	}

	let msg = `🏆 *SEUS PRÊMIOS* 🏆\n\n`;
	prizes.forEach((p) => {
		const date = new Date(p.timestamp).toLocaleString("pt-BR");
		const emoji = p.prize_type === "bom" ? "🌟" : "🗑️";
		msg += `${emoji} *${p.prize_name}* - _${date}_\n`;
	});

	return new ReturnMessage({
		chatId,
		content: msg
	});
}

const commands = [
	new Command({
		name: "slots",
		description: "Joga o caça-níqueis",
		category: "jogos",
		cooldown: 15,
		reactions: { after: "🎰", error: "❌" },
		method: slotsCommand
	}),
	new Command({
		name: "slots-premios",
		description: "Lista seus prêmios do caça-níqueis",
		category: "jogos",
		cooldown: 10,
		reactions: { after: "🏆", error: "❌" },
		method: slotsPrizesCommand
	})
];

module.exports = { commands };
