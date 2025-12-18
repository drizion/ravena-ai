// src/functions/FishingGame.js
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const Logger = require('../utils/Logger');
const Command = require('../models/Command');
const Database = require('../utils/Database');
const AdminUtils = require('../utils/AdminUtils');
const sdModule = require('./ComfyUICommands');
const ReturnMessage = require('../models/ReturnMessage');

const logger = new Logger('fishing-game');

const database = Database.getInstance();
const adminUtils = AdminUtils.getInstance();
const dbName = 'fishing';

// Initialize Database
database.getSQLiteDb(dbName, `
    CREATE TABLE IF NOT EXISTS fishing_users (
        user_id TEXT PRIMARY KEY,
        name TEXT,
        baits INTEGER DEFAULT 7,
        last_bait_regen INTEGER,
        total_weight REAL DEFAULT 0,
        inventory_weight REAL DEFAULT 0,
        total_catches INTEGER DEFAULT 0,
        total_baits_used INTEGER DEFAULT 0,
        total_trash_caught INTEGER DEFAULT 0,
        biggest_fish_json TEXT
    );
    CREATE TABLE IF NOT EXISTS fishing_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        name TEXT,
        weight REAL,
        is_rare INTEGER,
        timestamp INTEGER,
        emoji TEXT,
        data_json TEXT
    );
    CREATE TABLE IF NOT EXISTS fishing_group_stats (
        group_id TEXT,
        user_id TEXT,
        name TEXT,
        total_weight REAL DEFAULT 0,
        total_catches INTEGER DEFAULT 0,
        biggest_fish_json TEXT,
        PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS fishing_legendary_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fish_name TEXT,
        weight REAL,
        user_id TEXT,
        user_name TEXT,
        group_id TEXT,
        group_name TEXT,
        timestamp INTEGER,
        image_name TEXT
    );
    CREATE TABLE IF NOT EXISTS fishing_buffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        effect_type TEXT,
        is_debuff INTEGER DEFAULT 0,
        value REAL,
        min_value REAL,
        max_value REAL,
        remaining_uses INTEGER,
        original_name TEXT
    );
`);

// --- CONSTANTES DO JOGO ---
const MAX_FISH_PER_USER = 25;
const MIN_FISH_WEIGHT = 1;
const MAX_FISH_WEIGHT = 180; // Aumentado para 180kg
const DIFFICULTY_THRESHOLD = 80; 
const FISHING_COOLDOWN = 5;
const MAX_BAITS = 7; // Aumentado para 7 iscas
const BAIT_REGEN_TIME = 60 * 60; // Reduzido para 1 hora (60 min * 60 seg)

// Armazena os cooldowns de pesca (Cache em memória é aceitável para cooldowns de curto prazo)
const fishingCooldowns = {};
// Ajustado escala de mensagens para o novo peso máximo
const weightScaleMsgs = [180, 150, 120, 100, 80, 60];

// --- CONFIGURAÇÕES DE PEIXES E ITENS ---

// Peixes raríssimos e seus pesos adicionais
const RARE_FISH = [
  { name: "Dai Gum Loong", chance: 0.000008, weightBonus: 10000, emoji: "🐲" },
  { name: "Leviathan", chance: 0.00001, weightBonus: 8000, emoji: "🐉" },
  { name: "Megalodon", chance: 0.000015, weightBonus: 6000, emoji: "🦈" },
  { name: "Kraken", chance: 0.00002, weightBonus: 7500, emoji: "🦑" },
  { name: "Moby Dick", chance: 0.00003, weightBonus: 5000, emoji: "🐳" },
  { name: "Baleia", chance: 0.00005, weightBonus: 1000, emoji: "🐋" },
  { name: "Cthulhu", chance: 0.000005, weightBonus: 66666, emoji: "🐙" },
  { name: "Hydra", chance: 0.000012, weightBonus: 5500, emoji: "🐍" },
  { name: "Nessie", chance: 0.000025, weightBonus: 4500, emoji: "🦕" },
  { name: "Godzilla", chance: 0.000009, weightBonus: 9000, emoji: "🦖" }
];

// Itens de lixo que podem ser pescados
const TRASH_ITEMS = [
  { name: "Bota velha", emoji: "👢" },
  { name: "Sacola plástica", emoji: "🛍️" },
  { name: "Latinha", emoji: "🥫" },
  { name: "Mochila rasgada", emoji: "🎒" },
  { name: "Saco de lixo", emoji: "🧹" },
  { name: "Pneu furado", emoji: "🛞" },
  { name: "Garrafa vazia", emoji: "🍾" },
  { name: "Chapéu de pirata", emoji: "👒" },
  { name: "Celular quebrado", emoji: "📱" },
  { name: "Relógio parado", emoji: "⌚" },
  { name: "Bebê Reborn", emoji: "👶" },
  { name: "Faca Velha", emoji: "🔪" },
  { name: "Tesoura Enferrujada", emoji: "✂" },
  { name: "Cadeado Sem Chave", emoji: "🔒" },
  { name: "Botão de salvar?", emoji: "💾" },
  { name: "Hétero", emoji: "🔝" },
  { name: "Microscópio Sujo", emoji: "🔬" },
  { name: "Extintor Velho", emoji: "🧯" },
  { name: "Camisinha Furada", emoji: "🎈" },
  { name: "Conta de Energia", emoji: "📜" },
  { name: "Conta de Água", emoji: "📜" },
  { name: "Boleto do Condomínio", emoji: "📜" },
  { name: "Siso Cariado", emoji: "🦷" },
  { name: "Maiô Rasgado", emoji: "🩱"},
  { name: "Biquíni", emoji: "👙"},
  { name: "Anel de Plástico", emoji: "💍"},
  { name: "Fita Mimosa", emoji: "🎗"},
  { name: "Boia Seca", emoji: "🛟"},
  { name: "Relógio Enferrujado", emoji: "⏲"},
  { name: "Imã", emoji: "🧲"},
  { name: "Tijolo 6 Furo", emoji: "🧱"},
  { name: "Chapa de Raio X", emoji: "🩻"},
  { name: "Fita Fofinha", emoji: "🎀"},
  { name: "CD do Araketu", emoji: "💿" },
  { name: "Vinil da Xuxa", emoji: "💽" },
  { name: "Tamagotchi sem bateria", emoji: "🤖" },
  { name: "Cartucho de Polystation", emoji: "🕹️" },
  { name: "Nota de 3 reais", emoji: "💸" },
  { name: "Meia furada", emoji: "🧦" },
  { name: "Cigarro de paieiro apagado", emoji: "🚬" },
  { name: "Panela de pressão sem pino", emoji: "🥘" },
  { name: "Controle remoto universal que não funciona", emoji: "📺" },
  { name: "Convite de casamento de 2005", emoji: "💌" },
  { name: "Resto de marmita", emoji: "🥡" },
  { name: "Espelho quebrado", emoji: "🪞" },
  { name: "Baralho faltando carta", emoji: "🃏" },
  { name: "Pente sem dente", emoji: "🪮" },
  { name: "Óculos sem lente", emoji: "👓" },
  { name: "Pacote da Shopee", emoji: "📦"},
  { name: "Pacote da OLX", emoji: "📦"},
  { name: "Pacote do Mercado Livre", emoji: "📦"},
  { name: "Pacote do AliExpress", emoji: "📦"},
  { name: "Pacote da Amazon", emoji: "📦"},
  { name: "Chinelo Havaiana (só o pé esquerdo)", emoji: "🩴" },
  { name: "Chinelo Havaiana (só o pé direito)", emoji: "🩴" },
  { name: "Bola 8 de Bilhar", emoji: "🎱" },
  { name: "Ursinho de Pelúcia Encharcado", emoji: "🧸" },
  { name: "Semáforo (Como isso veio parar aqui?)", emoji: "🚦" },
  { name: "Caixão de Vampiro (miniatura)", emoji: "🧛" },
  { name: "DVD Pirata do Shrek", emoji: "📀" },
  { name: "Estátua da Liberdade de Plástico", emoji: "🗽" },
  { name: "Cérebro em Formol (Credo!)", emoji: "🧠" },
  { name: "Remo Quebrado", emoji: "🛶" },
  { name: "Skate sem Rodas", emoji: "🛹" },
  { name: "Assento Sanitário", emoji: "🚽" },
  { name: "Escudo Medieval de Isopor", emoji: "🛡️" },
  { name: "Cabeça da Ilha de Páscoa (Peso de papel)", emoji: "🗿" },
  { name: "Teste de DNA (Negativo)", emoji: "🧬" },
  { name: "Peruca de Sereia", emoji: "🧜‍♀️" },
  { name: "Múmia de Gato", emoji: "🐈‍⬛" },
  { name: "Cabo USB que não conecta", emoji: "🔌" },
  { name: "Pizza de Ontem (Molhada)", emoji: "🍕" }
];

// Upgrades para pesca
const UPGRADES = [
  { name: "Chapéu de Pescador", chance: 0.05, emoji: "👒", effect: "weight_boost", value: 0.2, duration: 3, description: "Aumenta o peso dos próximos 3 peixes em 20%." },
  { name: "Minhocão", chance: 0.05, emoji: "🐛", effect: "next_fish_bonus", minValue: 10, maxValue: 80, description: "Adiciona um bônus de 10 a 80kg ao próximo peixe." },
  { name: "Carretel", chance: 0.02, emoji: "🧵", effect: "weight_boost", value: 0.75, duration: 3, description: "Aumenta o peso dos próximos 3 peixes em 75%." },
  { name: "Pacote de Iscas", chance: 0.1, emoji: "🎁", effect: "extra_baits", minValue: 1, maxValue: 3, description: "Ganha de 1 a 3 iscas extras." },
  { name: "Amuleto do Pescador", chance: 0.01, emoji: "🧿", effect: "rare_chance_boost", value: 0.0005, duration: 10, description: "Aumenta a chance de encontrar peixes raros nas próximas 10 pescarias." },
  //{ name: "Licença de Pesca Premium", chance: 0.03, emoji: "📜", effect: "cooldown_reduction", value: 0.5, duration: 5, description: "Reduz o tempo de espera para pescar em 50% nas próximas 5 pescarias." },
  { name: "Sonar Portátil", chance: 0.02, emoji: "📡", effect: "guaranteed_weight", minValue: 40, maxValue: 100, description: "Garante que o próximo peixe tenha entre 40kg e 70kg." },
  { name: "Balança Adulterada", chance: 0.01, emoji: "⚖️", effect: "weight_boost", value: 1.5, duration: 1, description: "Aumenta o peso do próximo peixe em 150%!" },
  { name: "Isca de Diamante", chance: 0.005, emoji: "💎", effect: "rare_chance_boost", value: 0.002, duration: 5, description: "Aumenta drasticamente a chance de raros por 5 pescarias." },
  //{ name: "Energético de Pescador", chance: 0.02, emoji: "⚡", effect: "cooldown_reduction", value: 0.9, duration: 2, description: "Reduz o tempo de espera em 90% nas próximas 2 pescarias." },
  { name: "Anzol de Titânio", chance: 0.025, emoji: "🔩", effect: "bait_on_trash", duration: 10, description: "Evita a perda de isca ao pescar lixo pelas próximas 10 vezes. Mais durável que o enferrujado!" }
];

// Downgrades para pesca
const DOWNGRADES = [
  { name: "Mina Aquática", chance: 0.0003, emoji: "💣", effect: "clear_inventory", description: "Esvazia seu inventário de peixes." },
  { name: "Vela Acesa do 𝒸𝒶𝓅𝒾𝓇𝑜𝓉𝑜", chance: 0.006, emoji: "🕯", effect: "weight_loss", value: -0.4, duration: 3, description: "sǝxᴉǝd Ɛ soɯᴉxóɹd sop osǝd o znpǝɹ" },
  { name: "Tartaruga Gulosa", chance: 0.015, emoji: "🐢", effect: "remove_baits", minValue: 1, maxValue: 3, description: "Remove de 1 a 3 iscas." },
  { name: "Anzol Enferrujado", chance: 0.02, emoji: "🪝", effect: "bait_on_trash", duration: 3, description: "Você não perde a isca ao pescar lixo nas próximas 3 vezes que isso acontecer." },
  { name: "Fiscalização Ambiental", chance: 0.005, emoji: "👮", effect: "longer_cooldown", value: 3, duration: 3, description: "Aumenta o tempo de espera para pescar em 3x nas próximas 3 pescarias." },
  { name: "Enchente Súbita", chance: 0.01, emoji: "🌊", effect: "lose_smallest_fish", description: "A correnteza levou seu peixe mais leve embora." },
  { name: "Gato Ladrão", chance: 0.01, emoji: "🐈", effect: "lose_recent_fish", description: "Um gato pulou e roubou o peixe que você acabou de pegar!" },
  { name: "Balde Furado", chance: 0.02, emoji: "🗑️", effect: "remove_baits", minValue: 2, maxValue: 4, description: "Seu balde furou! Você perdeu entre 2 e 4 iscas." },
  { name: "Olho Gordo", chance: 0.03, emoji: "🧿", effect: "weight_loss", value: -0.8, duration: 2, description: "O olho gordo dos invejosos reduziu 80% do peso dos seus próximos 2 peixes." }
];

// --- HELPER FUNCTIONS FOR DB ---

async function getUserData(userId) {
    const row = await database.dbGet(dbName, "SELECT * FROM fishing_users WHERE user_id = ?", [userId]);
    if (!row) return null;

    // Load inventory
    const fishes = await database.dbAll(dbName, "SELECT * FROM fishing_inventory WHERE user_id = ?", [userId]);
    const parsedFishes = fishes.map(f => {
        const data = JSON.parse(f.data_json || '{}');
        return { ...data, name: f.name, weight: f.weight, isRare: !!f.is_rare, emoji: f.emoji, timestamp: f.timestamp, dbId: f.id };
    });

    // Load buffs
    const buffs = await database.dbAll(dbName, "SELECT * FROM fishing_buffs WHERE user_id = ? AND is_debuff = 0", [userId]);
    const parsedBuffs = buffs.map(b => ({
        type: b.effect_type, value: b.value, minValue: b.min_value, maxValue: b.max_value, 
        remainingUses: b.remaining_uses, originalName: b.original_name, dbId: b.id
    }));

    // Load debuffs
    const debuffs = await database.dbAll(dbName, "SELECT * FROM fishing_buffs WHERE user_id = ? AND is_debuff = 1", [userId]);
    const parsedDebuffs = debuffs.map(b => ({
        type: b.effect_type, value: b.value, minValue: b.min_value, maxValue: b.max_value, 
        remainingUses: b.remaining_uses, originalName: b.original_name, dbId: b.id
    }));

    return {
        userId: row.user_id,
        name: row.name,
        baits: row.baits,
        lastBaitRegen: row.last_bait_regen,
        totalWeight: row.total_weight,
        inventoryWeight: row.inventory_weight,
        totalCatches: row.total_catches,
        totalBaitsUsed: row.total_baits_used,
        totalTrashCaught: row.total_trash_caught,
        biggestFish: JSON.parse(row.biggest_fish_json || 'null'),
        fishes: parsedFishes,
        buffs: parsedBuffs,
        debuffs: parsedDebuffs
    };
}

async function saveUserData(userData) {
    // Note: Inventory and Buffs should be handled by specific insert/delete queries during gameplay for performance.
    // This function updates the main user stats.
    await database.dbRun(dbName, `INSERT OR REPLACE INTO fishing_users 
        (user_id, name, baits, last_bait_regen, total_weight, inventory_weight, total_catches, total_baits_used, total_trash_caught, biggest_fish_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [
            userData.userId, 
            userData.name, 
            userData.baits, 
            userData.lastBaitRegen, 
            userData.totalWeight, 
            userData.inventoryWeight, 
            userData.totalCatches, 
            userData.totalBaitsUsed, 
            userData.totalTrashCaught, 
            JSON.stringify(userData.biggestFish)
        ]);
}

async function updateGroupStats(groupId, userId, userName, weightToAdd, isCatch, biggestFish) {
    const row = await database.dbGet(dbName, "SELECT * FROM fishing_group_stats WHERE group_id = ? AND user_id = ?", [groupId, userId]);
    let totalWeight = row ? row.total_weight : 0;
    let totalCatches = row ? row.total_catches : 0;
    let currentBiggest = row ? JSON.parse(row.biggest_fish_json || 'null') : null;

    if (isCatch) {
        totalWeight += weightToAdd;
        totalCatches += 1;
        if (!currentBiggest || (biggestFish && biggestFish.weight > currentBiggest.weight)) {
            currentBiggest = biggestFish;
        }
    } else {
        // Removed fish or trash
        totalWeight -= weightToAdd;
        totalCatches -= 1;
    }

    await database.dbRun(dbName, `INSERT OR REPLACE INTO fishing_group_stats 
        (group_id, user_id, name, total_weight, total_catches, biggest_fish_json)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [groupId, userId, userName, totalWeight, totalCatches, JSON.stringify(currentBiggest)]);
}

async function addBuff(userId, buff, isDebuff) {
    await database.dbRun(dbName, `INSERT INTO fishing_buffs 
        (user_id, effect_type, is_debuff, value, min_value, max_value, remaining_uses, original_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, buff.type, isDebuff ? 1 : 0, buff.value, buff.minValue, buff.maxValue, buff.remainingUses, buff.originalName]);
}

async function updateBuffUses(buffId, remainingUses) {
    if (remainingUses <= 0) {
        await database.dbRun(dbName, "DELETE FROM fishing_buffs WHERE id = ?", [buffId]);
    } else {
        await database.dbRun(dbName, "UPDATE fishing_buffs SET remaining_uses = ? WHERE id = ?", [remainingUses, buffId]);
    }
}

async function addFishToInventory(userId, fish) {
    await database.dbRun(dbName, `INSERT INTO fishing_inventory 
        (user_id, name, weight, is_rare, timestamp, emoji, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, fish.name, fish.weight, fish.isRare ? 1 : 0, fish.timestamp, fish.emoji, JSON.stringify(fish)]);
}

async function removeFishFromInventory(userId, fishDbId) {
    if(fishDbId){
        await database.dbRun(dbName, "DELETE FROM fishing_inventory WHERE id = ?", [fishDbId]);
    } else {
        // Fallback if we don't have ID (should not happen in new logic, but for safety)
        // This is risky, so we better ensure we always have DB IDs.
        // For now, if no ID, we might delete the wrong fish if duplicates exist. 
        // We will assume logic always reloads data so IDs are present.
    }
}

async function clearInventory(userId) {
    await database.dbRun(dbName, "DELETE FROM fishing_inventory WHERE user_id = ?", [userId]);
}

// --- LÓGICA DO JOGO ---

/**
 * Obtém peixe aleatório do array de peixes com escala de dificuldade
 */
async function getRandomFish(fishArray, isMultiCatch = false, userData = null) {
  // Verifica se o array tem peixes
  if (!fishArray || !Array.isArray(fishArray) || fishArray.length === 0) {
    const customVariables = await database.getCustomVariables();
    fishArray = customVariables.peixes ?? ["Lambari", "Traira"];
  }
  
  // Se for pescaria múltipla, não permite peixes raros
  if (!isMultiCatch) {
    // Sorteia peixe raro com chances muito baixas
    for (const rareFish of RARE_FISH) {
        let currentChance = rareFish.chance;
        if(userData && userData.buffs){
            const rareChanceBuff = userData.buffs.find(b => b.type === 'rare_chance_boost' && b.remainingUses > 0);
            if(rareChanceBuff){
                currentChance += rareChanceBuff.value;
            }
        }

      if (Math.random() < currentChance) {
        const baseWeight = parseFloat((Math.random() * (MAX_FISH_WEIGHT - MIN_FISH_WEIGHT) + MIN_FISH_WEIGHT).toFixed(2));
        const totalWeight = baseWeight + rareFish.weightBonus;
        
        return {
          name: rareFish.name,
          weight: totalWeight,
          timestamp: Date.now(),
          chance: rareFish.chance,
          isRare: true,
          emoji: rareFish.emoji,
          baseWeight: baseWeight,
          bonusWeight: rareFish.weightBonus
        };
      }
    }
  }
  
  // Peixe normal
  const fishIndex = Math.floor(Math.random() * fishArray.length);
  const fishName = fishArray[fishIndex];
  let weight;

  if (userData && userData.buffs) {
    const guaranteedWeightBuff = userData.buffs.find(b => b.type === 'guaranteed_weight' && b.remainingUses > 0);
    if (guaranteedWeightBuff) {
        weight = parseFloat((Math.random() * (guaranteedWeightBuff.maxValue - guaranteedWeightBuff.minValue) + guaranteedWeightBuff.minValue).toFixed(2));
        guaranteedWeightBuff.remainingUses--; // consume buff object, update DB later
        if(guaranteedWeightBuff.dbId) await updateBuffUses(guaranteedWeightBuff.dbId, guaranteedWeightBuff.remainingUses);
        return { name: fishName, weight, timestamp: Date.now() };
    }
  }
  
  if (Math.random() < 0.8) {
    // 80% de chance de pegar um peixe normal
    weight = parseFloat((Math.random() * (DIFFICULTY_THRESHOLD - MIN_FISH_WEIGHT) + MIN_FISH_WEIGHT).toFixed(2));
  } else {
    // 20% de chance de dificuldade progressiva
    const difficultyRange = MAX_FISH_WEIGHT - DIFFICULTY_THRESHOLD;
    const randomValue = Math.random();
    const exponent = 3; 
    const difficultyFactor = 1 - Math.pow(randomValue, exponent);
    weight = parseFloat((DIFFICULTY_THRESHOLD + (difficultyFactor * difficultyRange)).toFixed(2));
  }
  
  return {
    name: fishName,
    weight,
    timestamp: Date.now()
  };
}

/**
 * Verifica e regenera iscas para um jogador
 */
function regenerateBaits(userData) {
  if (userData.baits === undefined) {
    userData.baits = MAX_BAITS;
    userData.lastBaitRegen = Date.now();
    return userData;
  }
  
  if (userData.baits >= MAX_BAITS) {
    userData.lastBaitRegen = Date.now();
    return userData;
  }
  
  const now = Date.now();
  const lastRegen = userData.lastBaitRegen ?? now;
  const elapsedSeconds = Math.floor((now - lastRegen) / 1000);
  const regensCount = Math.floor(elapsedSeconds / BAIT_REGEN_TIME);
  
  if (regensCount > 0) {
    userData.baits = Math.min(userData.baits + regensCount, MAX_BAITS);
    userData.lastBaitRegen = now - (elapsedSeconds % BAIT_REGEN_TIME) * 1000;
  }
  
  return userData;
}

/**
 * Comando restrito que permite adicionar iscas
 */
async function addBaits(userId, baitsNum) {
  userId = `${userId}`.replace(/\D/g, '');
  userId = userId.split("@")[0] + "@c.us"; 

  let userData = await getUserData(userId);

  if(!userData){
     // Create basic user if not exists
     userData = {
         userId,
         name: "User",
         baits: MAX_BAITS,
         lastBaitRegen: Date.now(),
         totalWeight: 0, inventoryWeight: 0, totalCatches: 0, totalBaitsUsed: 0, totalTrashCaught: 0, biggestFish: null
     };
  }

  userData.baits += baitsNum;
  userData.lastBaitRegen = Date.now(); // Reset regeneration timer when modified manually? Or keep it? Keeping it simple.
  
  await saveUserData(userData);

  return { userId, userData };
}

async function addBaitsCmd(bot, message, args, group) {
  try {
    const chatId = message.group ?? message.author;
    if(!adminUtils.isSuperAdmin(message.author)){
      return;
    }

    const destUser = args[0];
    const baitsNum = parseInt(args[1]);
    const dados = await addBaits(destUser, baitsNum);

    if(!dados.userData){
      return new ReturnMessage({
        chatId,
        content: `🐡 Erro: usuário não encontrado.`,
        reaction: "🐡"
      });
    } else {
      return new ReturnMessage({
        chatId,
        content: `🎣 Iscas de '${destUser}' ajustadas para ${dados.userData.baits}`,
        reaction: "🎣" 
      });
    }
  } catch (e){
    logger.error("Erro no addBaitsCmd", e);
    return new ReturnMessage({ chatId, content: "Erro interno." });
  }
}

function getNextBaitRegenTime(userData) {
  const now = Date.now();
  const lastRegen = userData.lastBaitRegen ?? now;
  const elapsedSeconds = Math.floor((now - lastRegen) / 1000);
  const secondsUntilNextBait = BAIT_REGEN_TIME - (elapsedSeconds % BAIT_REGEN_TIME);
  const missingBaits = MAX_BAITS - userData.baits;
  const secondsUntilAllBaits = secondsUntilNextBait + ((missingBaits - 1) * BAIT_REGEN_TIME);
  
  return {
    secondsUntilNextBait,
    secondsUntilAllBaits,
    nextBaitTime: new Date(now + (secondsUntilNextBait * 1000)),
    allBaitsTime: new Date(now + (secondsUntilAllBaits * 1000))
  };
}

function formatTimeString(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  let timeString = '';
  if (hours > 0) timeString += `${hours}h `;
  if (minutes > 0 || hours > 0) timeString += `${minutes}m `;
  timeString += `${remainingSeconds}s`;
  return timeString;
}

function checkRandomItem() {
  if (Math.random() < 0.15) {
    const trashIndex = Math.floor(Math.random() * TRASH_ITEMS.length);
    return { type: 'trash', ...TRASH_ITEMS[trashIndex] };
  }
  
  for (const upgrade of UPGRADES) {
    if (Math.random() < upgrade.chance) {
      let itemData = { ...upgrade, type: 'upgrade' };
      if (upgrade.effect === 'extra_baits' || upgrade.effect === 'next_fish_bonus') {
        itemData.value = Math.floor(Math.random() * (upgrade.maxValue - upgrade.minValue + 1)) + upgrade.minValue;
      }
      return itemData;
    }
  }
  
  for (const downgrade of DOWNGRADES) {
    if (Math.random() < downgrade.chance) {
      let itemData = { ...downgrade, type: 'downgrade' };
      if (downgrade.effect === 'remove_baits') {
        itemData.value = Math.floor(Math.random() * (downgrade.maxValue - downgrade.minValue + 1)) + downgrade.minValue;
      }
      return itemData;
    }
  }
  return null;
}

async function applyItemEffect(userData, item) {
  let effectMessage = '';
  // Note: Buffs/Debuffs are added to DB here
  
  switch (item.type) {
    case 'trash':
      const baitOnTrashDebuff = userData.debuffs.find(d => d.type === 'bait_on_trash' && d.remainingUses > 0);
      const baitOnTrashBuff = userData.buffs.find(b => b.type === 'bait_on_trash' && b.remainingUses > 0); 
      const trashProtector = baitOnTrashDebuff ?? baitOnTrashBuff;

      if (trashProtector) {
        trashProtector.remainingUses--;
        await updateBuffUses(trashProtector.dbId, trashProtector.remainingUses);
        effectMessage = `\n\n${item.emoji} Você pescou um(a) ${item.name}, mas seu ${trashProtector.originalName ?? 'Anzol'} te salvou de perder a isca!`;
      } else {
        effectMessage = `\n\n${item.emoji} Você pescou um(a) ${item.name}. Que pena!`;
      }
      break;
      
    case 'upgrade':
      switch (item.effect) {
        case 'weight_boost':
        case 'next_fish_bonus':
        case 'double_catch':
        case 'rare_chance_boost':
        case 'cooldown_reduction':
        case 'guaranteed_weight':
        case 'bait_on_trash':
          const buff = { type: item.effect, value: item.value, minValue: item.minValue, maxValue: item.maxValue, remainingUses: item.duration || 1, originalName: item.name };
          await addBuff(userData.userId, buff, false);
          effectMessage = `\n\n${item.emoji} Você encontrou um ${item.name}! ${item.description}`;
          break;
        case 'extra_baits':
          userData.baits = userData.baits + item.value;
          effectMessage = `\n\n${item.emoji} Você encontrou um ${item.name}! +${item.value} iscas adicionadas (${userData.baits}/${MAX_BAITS}).`;
          break;
      }
      break;
      
    case 'downgrade':
      switch (item.effect) {
        case 'weight_loss':
          await addBuff(userData.userId, { type: item.effect, value: item.value, remainingUses: item.duration, originalName: item.name }, true);
          effectMessage = `\n\n${item.emoji} 𝕍𝕠𝕔ê 𝕡𝕖𝕤𝕔𝕠𝕦 𝕦𝕞𝕒... 🕯️𝕍𝔼𝕃𝔸 𝔸ℂ𝔼𝕊𝔸?! 😱 𝒪𝒷𝓇𝒶 𝒹𝑜 𝒸𝒶𝓅𝒾𝓇𝑜𝓉𝑜! 🔥👹🩸`;
          break;
        case 'clear_inventory':
          await clearInventory(userData.userId);
          userData.fishes = [];
          userData.totalWeight -= userData.inventoryWeight ?? 0;
          userData.inventoryWeight = 0;
          effectMessage = `\n\n${item.emoji} OH NÃO! Você encontrou uma ${item.name}! Seu inventário de peixes foi destruído!`;
          break;
        case 'remove_baits':
          const baitsLost = Math.min(userData.baits, item.value);
          userData.baits -= baitsLost;
          effectMessage = `\n\n${item.emoji} Uma ${item.name} apareceu e comeu ${baitsLost} de suas iscas! (${userData.baits}/${MAX_BAITS} iscas restantes).`;
          break;
        case 'bait_on_trash':
        case 'longer_cooldown':
            await addBuff(userData.userId, { type: item.effect, value: item.value, remainingUses: item.duration, originalName: item.name }, true);
            const msg = item.effect === 'longer_cooldown' ? "Aumenta o tempo de espera." : "Proteção contra lixo (estranhamente).";
            effectMessage = `\n\n${item.emoji} Você pescou um ${item.name}! ${msg}`;
            break;
        case 'lose_smallest_fish':
            if (userData.fishes.length > 0) {
                let smallestFishIndex = 0;
                for (let i = 1; i < userData.fishes.length; i++) {
                    if (userData.fishes[i].weight < userData.fishes[smallestFishIndex].weight) {
                        smallestFishIndex = i;
                    }
                }
                const removedFish = userData.fishes[smallestFishIndex];
                await removeFishFromInventory(userData.userId, removedFish.dbId);
                userData.fishes.splice(smallestFishIndex, 1);
                userData.inventoryWeight -= removedFish.weight;
                effectMessage = `\n\n${item.emoji} Uma ${item.name} levou seu ${removedFish.name} embora!`;
            } else {
                effectMessage = `\n\n${item.emoji} Uma ${item.name} revirou suas coisas, mas não havia peixes para levar.`;
            }
            break;
        case 'lose_recent_fish':
             // Handled in main loop
             effectMessage = `\n\n${item.emoji} Maldito ${item.name}! Ele roubou o peixe que você acabou de pegar!`;
             break;
      }
      break;
  }
  
  return { userData, effectMessage };
}

function toDemonic(text) {
  return text.split('').map(c => c).join('');
}

async function applyBuffs(userData, fish) {
  if ((!userData.buffs || userData.buffs.length === 0) && (!userData.debuffs || userData.debuffs.length === 0)) {
    return { fish, buffs: [], debuffs: [] };
  }
  
  let modifiedFish = { ...fish };
  let buffMessages = [];
  
  // Apply and decrement buffs
  if(userData.buffs){
      for(const buff of userData.buffs){
        if (buff.remainingUses <= 0) continue;
        switch (buff.type) {
            case 'weight_boost':
                const originalWeight = modifiedFish.weight;
                modifiedFish.weight *= (1 + buff.value);
                modifiedFish.weight = parseFloat(modifiedFish.weight.toFixed(2));
                buffMessages.push(`🎯 Buff do ${buff.originalName || 'item'}: +${buff.value*100}% de peso (${originalWeight}kg → ${modifiedFish.weight}kg)`);
                break;
            case 'next_fish_bonus':
                const beforeBonus = modifiedFish.weight;
                modifiedFish.weight += buff.value;
                modifiedFish.weight = parseFloat(modifiedFish.weight.toFixed(2));
                buffMessages.push(`🎯 Buff do ${buff.originalName || 'Minhocão'}: +${buff.value}kg (${beforeBonus}kg → ${modifiedFish.weight}kg)`);
                break;
        }
        buff.remainingUses--;
        await updateBuffUses(buff.dbId, buff.remainingUses);
      }
  }

  // Apply and decrement debuffs
  if(userData.debuffs){
      for(const debuff of userData.debuffs){
        if (debuff.remainingUses <= 0) continue;
        switch (debuff.type) {
            case 'weight_loss':
                const originalWeightDebuff = modifiedFish.weight;
                modifiedFish.weight *= (1 + debuff.value);
                modifiedFish.weight = parseFloat(modifiedFish.weight.toFixed(2));
                modifiedFish.name = toDemonic(modifiedFish.name);
                buffMessages.push(`⬇️ Peixe magro... (${originalWeightDebuff}kg → ${modifiedFish.weight}kg)`);
                break;
        }
        debuff.remainingUses--;
        await updateBuffUses(debuff.dbId, debuff.remainingUses);
      }
  }

  return { fish: modifiedFish, buffMessages };
}

function getCurrentDateTime() {
  const now = new Date();

  // options define the format requirements
  const options = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false // Ensures 24-hour format
  };

  return new Intl.DateTimeFormat('en-GB', options).format(now).replace(',', '');
}

async function generateRareFishImage(bot, userName, fishName, fishWeight = 10000) {
  try {

    const dateString = getCurrentDateTime();

    const prompt = `Close-up portrait of a normal everyday person named "${userName}"" fishing an epically rare monstrous creature (fantasy) fish known as "${fishName}"" using only a wooden fishing rod. Sweat and tears.
Epic scenario, storm, huge boats, fish is extremely large, mythical. Fantastic.
Lightly blurred background, bokeh. Water splashing
Dynamic, action-ready close-up composition, medium depth-of-field, hyper-detailed photorealistic-anime hybrid style, epic survival and exploration atmosphere.
Gothic, purple-ish atmosphere, cartoony

((Write text in bottom of image centered, bold font, fantasy: ${fishName}, ${fishWeight.toFixed(2)}kg @ ${dateString}))`;

    if (!sdModule || !sdModule.commands || !sdModule.commands[0] || !sdModule.commands[0].method) return null;
    
    const mockMessage = { 
      author: 'SYSTEM', 
      authorName: 'Sistema', 
      content: prompt, 
      origin: { 
        getQuotedMessage: () => Promise.resolve(null),
        react: async () => {}
      } 
    };
    const result = await sdModule.commands[0].method(bot, mockMessage, prompt.split(' '), {filters: {nsfw: false}}, true);
    return (result && result.content && result.content.mimetype) ? result.content : null;
  } catch (error) {
    logger.error('Erro ao gerar imagem para peixe raro:', error);
    return null;
  }
}

function hasDoubleCatchBuff(userData) {
  return userData.buffs && userData.buffs.some(buff => buff.type === 'double_catch' && buff.remainingUses > 0);
}

async function consumeDoubleCatchBuff(userData) {
  if (userData.buffs) {
      const buff = userData.buffs.find(b => b.type === 'double_catch' && b.remainingUses > 0);
      if(buff){
          buff.remainingUses--;
          await updateBuffUses(buff.dbId, buff.remainingUses);
      }
  }
  return userData;
}

/**
 * Pescar um peixe
 */
async function fishCommand(bot, message, args, group) {
  try {
    const chatId = message.group ?? message.author;
    const userId = message.author;
    const userName = message.name ?? message.pushName ?? message.pushname ?? message.authorName ?? "Pescador";
    const groupId = message.group; 
    const mentionPessoa = [];
    
    let userData = await getUserData(userId);
    
    if (!userData) {
      userData = {
        userId: userId,
        name: userName, fishes: [], totalWeight: 0, inventoryWeight: 0, biggestFish: null,
        totalCatches: 0, totalBaitsUsed: 0, totalTrashCaught: 0, baits: MAX_BAITS,
        lastBaitRegen: Date.now(), buffs: [], debuffs: []
      };
      await saveUserData(userData);
    } else {
      userData.name = userName;
    }
    
    userData = regenerateBaits(userData);
    
    // Cooldown logic
    const now = Math.floor(Date.now() / 1000);
    let currentCooldown = FISHING_COOLDOWN;

    if (userData.buffs) {
        const cooldownBuff = userData.buffs.find(b => b.type === 'cooldown_reduction' && b.remainingUses > 0);
        if (cooldownBuff) { currentCooldown *= (1 - cooldownBuff.value); 
            cooldownBuff.remainingUses--; 
            await updateBuffUses(cooldownBuff.dbId, cooldownBuff.remainingUses);
        }
    }
    if (userData.debuffs) {
        const cooldownDebuff = userData.debuffs.find(d => d.type === 'longer_cooldown' && d.remainingUses > 0);
        if (cooldownDebuff) { currentCooldown *= cooldownDebuff.value; 
            cooldownDebuff.remainingUses--;
            await updateBuffUses(cooldownDebuff.dbId, cooldownDebuff.remainingUses);
        }
    }

    if (fishingCooldowns[userId] && now < fishingCooldowns[userId]) {
      try { setTimeout((mo) => { mo.react("😴"); }, 2000, message.origin); } catch (e) {}
      return null;
    }
    
    if (userData.baits <= 0) {
      try { setTimeout((mo) => { mo.react("🍥"); }, 3000, message.origin); } catch (e) {}
      return null;
    }

    // Obter peixes
    let fishArray = ["Lambari", "Tilápia"];
    try {
      const customVariables = await database.getCustomVariables();
      if (customVariables?.peixes && Array.isArray(customVariables.peixes) && customVariables.peixes.length > 0) {
        fishArray = customVariables.peixes;
      }
    } catch (error) {}

    let catchCount = hasDoubleCatchBuff(userData) ? 2 : 1;
    if (catchCount === 2) await consumeDoubleCatchBuff(userData);
    
    const caughtFishes = [];
    let effectMessage = '';
    let randomItem = null;
    
    for (let i = 0; i < catchCount; i++) {
      const fish = await getRandomFish(fishArray, i > 0, userData);
      const buffResult = await applyBuffs(userData, fish);
      const modifiedFish = buffResult.fish;
      
      if (buffResult.buffMessages?.length > 0) effectMessage += `\n${buffResult.buffMessages.join('\n')}`;
      
      await addFishToInventory(userId, modifiedFish);
      userData.fishes.push(modifiedFish);
      userData.totalWeight = (userData.totalWeight || 0) + modifiedFish.weight;
      userData.inventoryWeight = (userData.inventoryWeight || 0) + modifiedFish.weight;
      userData.totalCatches = (userData.totalCatches ?? 0) + 1;
      caughtFishes.push(modifiedFish);
      
      if (!userData.biggestFish || modifiedFish.weight > userData.biggestFish.weight) userData.biggestFish = modifiedFish;
      
      if (groupId) {
        await updateGroupStats(groupId, userId, userName, modifiedFish.weight, true, modifiedFish);
      }
      
      if (i === 0 && !modifiedFish.isRare) {
        randomItem = checkRandomItem();
        if (randomItem) {
          const itemResult = await applyItemEffect(userData, randomItem);
          userData = itemResult.userData;
          effectMessage += itemResult.effectMessage;
          
          if (randomItem.type === 'trash') {
            userData.totalTrashCaught = (userData.totalTrashCaught ?? 0) + 1;
            const trashedFish = caughtFishes.pop();
            // Need to remove from DB inventory since we added it above
            // We need to fetch the last inserted ID or assume
            const lastFish = userData.fishes.pop(); 
            // In a real scenario we need the ID. 
            // For now let's assume `addFishToInventory` works. 
            // Better strategy: Don't add to DB until end of loop? No, item effect can clear inventory.
            // Let's get the DB ID of the fish we just added. 
            // Since we don't have it easily without a return from insert, 
            // we will query the last fish added by user.
            const fishRow = await database.dbGet(dbName, "SELECT id FROM fishing_inventory WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userId]);
            if(fishRow) await removeFishFromInventory(userId, fishRow.id);

            userData.totalCatches--;
            userData.totalWeight -= modifiedFish.weight;
            userData.inventoryWeight -= modifiedFish.weight;
            if (groupId) {
                await updateGroupStats(groupId, userId, userName, modifiedFish.weight, false, null);
            }
            break;
          }
          if(randomItem.effect === 'lose_recent_fish'){
             // Similar logic to trash, remove the fish we just caught
             const stolenFish = caughtFishes.pop();
             const lastFish = userData.fishes.pop();
             const fishRow = await database.dbGet(dbName, "SELECT id FROM fishing_inventory WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userId]);
             if(fishRow) await removeFishFromInventory(userId, fishRow.id);
             
             userData.totalCatches--;
             userData.totalWeight -= modifiedFish.weight;
             userData.inventoryWeight -= modifiedFish.weight;
             if (groupId) {
                await updateGroupStats(groupId, userId, userName, modifiedFish.weight, false, null);
             }
          }
        }
      }
    }

    const hasTrashProtection = userData.debuffs?.some(d => d.type === 'bait_on_trash' && d.remainingUses > 0) ||
                               userData.buffs?.some(b => b.type === 'bait_on_trash' && b.remainingUses > 0);

    if (randomItem?.type !== 'trash' || !hasTrashProtection) {
        userData.baits--;
    }
    userData.totalBaitsUsed = (userData.totalBaitsUsed ?? 0) + 1;
    
    // Check inventory limit
    if(userData.fishes.length > MAX_FISH_PER_USER){
        // Find smallest fish
        let smallestIndex = 0;
        let smallestWeight = userData.fishes[0].weight;
        
        for(let i=1; i<userData.fishes.length; i++){
            if(userData.fishes[i].weight < smallestWeight){
                smallestWeight = userData.fishes[i].weight;
                smallestIndex = i;
            }
        }
        
        const removed = userData.fishes[smallestIndex];
        // Ensure we have dbId. Reload if necessary or use what we have.
        // getUserData populates dbId. New fishes might not have it in local array unless we reload.
        // Quick fix: Remove by timestamp/name fallback or reload.
        // Reloading is safest.
        if(!removed.dbId){
             // Try to find it in DB.
             const fishRow = await database.dbGet(dbName, "SELECT id FROM fishing_inventory WHERE user_id = ? AND weight = ? AND name = ? LIMIT 1", [userId, removed.weight, removed.name]);
             if(fishRow) removed.dbId = fishRow.id;
        }

        if(removed.dbId) {
            await removeFishFromInventory(userId, removed.dbId);
            userData.fishes.splice(smallestIndex, 1);
            userData.inventoryWeight -= removed.weight;
            effectMessage += `\n\n⚠️ Inventário cheio! O peixe *${removed.name}* (${removed.weight}kg) foi solto.`;
        }
    }

    await saveUserData(userData);
    fishingCooldowns[userId] = now + currentCooldown;
    
    // Montar mensagem
    let extraMsg = "";
    if(args[0]?.match(/^@\d\d/g)){ 
      mentionPessoa.push(args[0].replace("@",""));
      extraMsg = `, segurando firme na vara de ${args[0]}, `;
    }
  
    if (caughtFishes.length === 0) {
      return new ReturnMessage({
        chatId,
        content: `🎣 ${userName} jogou a linha ${extraMsg}e... ${effectMessage}\n\n> 🐛 Iscas restantes: ${userData.baits}/${MAX_BAITS}`,
        reaction: "🎣" ,
        options: { quotedMessageId: message.origin.id._serialized, mentions: mentionPessoa, evoReply: message.origin }
      });
    }
    
    let fishMessage;
    if (caughtFishes.length > 1) {
      const fishDetails = caughtFishes.map(fish => `*${fish.name}* (_${fish.weight.toFixed(2)} kg_)`).join(" e ");
      fishMessage = `🎣 ${userName} pescou ${fishDetails}!`;
    } else {
      const fish = caughtFishes[0];
      if (fish.isRare) {
        fishMessage = `🏆 INCRÍVEL! _${userName}_ capturou um(a) _raríssimo_ *${fish.name}* de _${fish.weight.toFixed(2)} kg_! (${fish.emoji} ${fish.chance*100}% de chance)`;
      } else {
        fishMessage = `🎣 ${userName} ${extraMsg}pescou um *${fish.name}* de _${fish.weight.toFixed(2)} kg_!`;
      }
    }
    
    if (caughtFishes.length === 1) {
      const weight = caughtFishes[0].weight;
      if (weight > weightScaleMsgs[0]) effectMessage = '\n\n👏 *UM MONSTRO!*' + effectMessage;
      else if (weight > weightScaleMsgs[2]) effectMessage = '\n\n👏 *ENORME!*' + effectMessage;
    }
    
    fishMessage += `\n\n> 🐳 Seu maior peixe: ${userData.biggestFish.name} (${userData.biggestFish.weight.toFixed(2)} kg)`;
    fishMessage += `\n> 🐛 Iscas restantes: ${userData.baits}/${MAX_BAITS}`;
    fishMessage += effectMessage;

    // Se for peixe raro, tentar gerar imagem e salvar no histórico
    if (caughtFishes.length === 1 && caughtFishes[0].isRare) {
      let rareFishImage = await generateRareFishImage(bot, userName, caughtFishes[0].name, caughtFishes[0].weight);

      if(!rareFishImage){
        // Placeholder
        const pchPescaRara = path.join(database.databasePath, "rare-fish.jpg");
        rareFishImage = await bot.createMedia(pchPescaRara, "image/jpeg");
      }
      
      const savedImageName = await saveRareFishImage(rareFishImage, userId, caughtFishes[0].name);
      
      // Save Legendary to DB
      await database.dbRun(dbName, `INSERT INTO fishing_legendary_history 
        (fish_name, weight, user_id, user_name, group_id, group_name, timestamp, image_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [caughtFishes[0].name, caughtFishes[0].weight, userId, userName, groupId || null, group ? group.name : "chat privado", Date.now(), savedImageName]);

      const groupName = group ? group.name : "chat privado";
      const notificacaoPeixeRaro = new ReturnMessage({
        content: rareFishImage,
        options: {
          caption: `🏆 ${userName} capturou um(a) *${caughtFishes[0].name}* LENDÁRIO(A) de *${caughtFishes[0].weight.toFixed(2)} kg* no grupo "${groupName}"!`
        }
      });

      if (bot.grupoInteracao) {
        notificacaoPeixeRaro.chatId = bot.grupoInteracao;
        const msgsEnviadas = await bot.sendReturnMessages(notificacaoPeixeRaro);
        if(msgsEnviadas[0] && msgsEnviadas[0].pin) msgsEnviadas[0].pin(260000);
      }
      
      if (bot.grupoAvisos) {
        notificacaoPeixeRaro.chatId = bot.grupoAvisos;
        const msgsEnviadas = await bot.sendReturnMessages(notificacaoPeixeRaro);
        if(msgsEnviadas[0] && msgsEnviadas[0].pin) msgsEnviadas[0].pin(260000);
      }

      return new ReturnMessage({
        chatId, content: rareFishImage,
        options: { caption: fishMessage, quotedMessageId: message.origin.id._serialized, mentions: mentionPessoa, evoReply: message.origin },
        reaction: "🎣"
      });

    }
    
    return new ReturnMessage({
      chatId, content: fishMessage, reaction: "🎣" ,
      options: { quotedMessageId: message.origin.id._serialized, mentions: mentionPessoa, evoReply: message.origin }
    });
  } catch (error) {
    logger.error('Erro no comando de pesca:', error);
    return new ReturnMessage({ chatId: message.group ?? message.author, content: '❌ Erro ao pescar.' });
  }
}

async function myFishCommand(bot, message, args, group) {
  try {
    const chatId = message.group ?? message.author;
    const userId = message.author;
    const userName = message.name ?? message.pushName ?? message.pushname ?? message.authorName ?? "Pescador";
    
    let userData = await getUserData(userId);
    
    if (!userData) {
      return new ReturnMessage({ chatId, content: `🎣 ${userName}, use !pescar para começar.` });
    }
    
    userData = regenerateBaits(userData);
    await saveUserData(userData);
    
    const fishes = userData.fishes;
    
    let fishMessage = `🎣 *Peixes de ${userName}*\n\n`;
    if (fishes.length === 0) {
      fishMessage += 'Nenhum peixe no inventário.';
    } else {
      const sortedFishes = [...fishes].sort((a, b) => b.weight - a.weight);
      sortedFishes.forEach((fish, index) => {
        const rareMark = fish.isRare ? ` ${fish.emoji} RARO!` : '';
        fishMessage += `${index + 1}. ${fish.name}: ${fish.weight.toFixed(2)} kg${rareMark}\n`;
      });
      
      fishMessage += `\n*Stats*:\nTotal: ${userData.totalCatches}\nPeso Inv: ${userData.inventoryWeight?.toFixed(2) ?? 0} kg\nIscas: ${userData.baits}/${MAX_BAITS}\n`;
      
      if (userData.baits < MAX_BAITS) {
        const regenInfo = getNextBaitRegenTime(userData);
        fishMessage += `Prox isca: ${formatTimeString(regenInfo.secondsUntilNextBait)}\n`;
      }

      if (userData.buffs?.length > 0) {
        fishMessage += `\n*Buffs*: ${userData.buffs.length} ativos\n`;
      }
      if (userData.debuffs?.length > 0) {
        fishMessage += `\n*Debuffs*: ${userData.debuffs.length} ativos\n`;
      }
      
      if (fishes.length >= MAX_FISH_PER_USER) {
        fishMessage += `\n⚠️ Inventário cheio! O menor peixe será solto na próxima pescaria.`;
      }
    }
    
    return new ReturnMessage({ chatId, content: fishMessage, options: { quotedMessageId: message.origin.id._serialized, evoReply: message.origin } });
  } catch (error) {
    logger.error('Erro myFish:', error);
    return new ReturnMessage({ chatId: message.group ?? message.author, content: '❌ Erro ao ver peixes.' });
  }
}

/**
 * Mostra os peixes lendários que foram pescados
 */
async function legendaryFishCommand(bot, message, args, group) {
  try {
    const chatId = message.group ?? message.author;
    
    const legendaryFishes = await database.dbAll(dbName, "SELECT * FROM fishing_legendary_history ORDER BY timestamp DESC");
    
    if (legendaryFishes.length === 0) {
      return new ReturnMessage({
        chatId,
        content: '🐉 Ainda não foram pescados peixes lendários. Continue pescando e você pode ser o primeiro a encontrar um!'
      });
    }
    
    const rareFishListItems = await Promise.all(RARE_FISH.map(async f => {
        const count = legendaryFishes.filter(l => l.fish_name === f.name).length;
        return `\t${f.emoji} ${f.name} _(${f.weightBonus}kg, ${count} pescados até hoje)_`;
    }));
    const rareFishList = rareFishListItems.join("\n");

    let textMessage = `🌊 *Lista de Peixes Lendários* 🎣\n${rareFishList}\n\n🏆 *REGISTRO DE PEIXES LENDÁRIOS* 🎖️\n\n`;
    
    for (let i = 0; i < legendaryFishes.length; i++) {
      const legendary = legendaryFishes[i];
      const date = new Date(legendary.timestamp).toLocaleDateString('pt-BR');
      const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i+1}. `;
      
      textMessage += `${medal}*${legendary.fish_name}* (${legendary.weight.toFixed(2)} kg)\n`;
      textMessage += `   Pescador: ${legendary.user_name}\n`;
      textMessage += `   Local: ${legendary.group_name ?? 'misterioso'}\n`;
      textMessage += `   Data: ${date}\n\n`;
    }
    
    if (legendaryFishes.length > 0) {
      textMessage += `📷 *Mostrando imagens das ${Math.min(5, legendaryFishes.length)} lendas mais recentes...*`;
    }
    
    const messages = [];
    messages.push(new ReturnMessage({ chatId, content: textMessage }));
    
    const legendaryToShow = legendaryFishes.slice(0, 5);
    
    for (const legendary of legendaryToShow) {
      try {
        if (legendary.image_name) {
          const imagePath = path.join(database.databasePath, 'media', legendary.image_name);
          try {
            await fs.access(imagePath);
            const media = await bot.createMedia(imagePath);
            const date = new Date(legendary.timestamp).toLocaleDateString('pt-BR');
            messages.push(new ReturnMessage({
              chatId,
              content: media,
              options: { caption: `🏆 *Peixe Lendário*\n\n*${legendary.fish_name}* de ${legendary.weight.toFixed(2)} kg\nPescado por: ${legendary.user_name}\nLocal: ${legendary.group_name ?? 'misterioso'}\nData: ${date}` },
              delay: messages.length * 1000 
            }));
          } catch (imageError) { continue; }
        }
      } catch (e) {}
    }
    
    if (messages.length === 1) return messages[0];
    return messages;
  } catch (error) {
    logger.error('Erro no comando de peixes lendários:', error);
    return new ReturnMessage({ chatId: message.group ?? message.author, content: '❌ Erro ao mostrar lendas.' });
  }
}

/**
 * Mostra o ranking de pescaria do grupo atual
 */
async function fishingRankingCommand(bot, message, args, group) {
  try {
    const chatId = message.group ?? message.author;
    const groupId = message.group;
    
    if (!groupId) {
      return new ReturnMessage({ chatId, content: '🎣 Este comando só funciona em grupos.' });
    }
    
    const groupStats = await database.dbAll(dbName, "SELECT * FROM fishing_group_stats WHERE group_id = ?", [groupId]);
    
    if (groupStats.length === 0) {
      return new ReturnMessage({ chatId, content: '🎣 Ainda não há dados de pescaria neste grupo.' });
    }
    
    const players = groupStats.map(s => ({
        id: s.user_id,
        name: s.name,
        totalWeight: s.total_weight,
        totalCatches: s.total_catches,
        biggestFish: JSON.parse(s.biggest_fish_json || 'null')
    }));
    
    let rankingType = 'biggest'; 
    if (args.length > 0) {
      const arg = args[0].toLowerCase();
      if (arg === 'quantidade') rankingType = 'count';
      else if (arg === 'pesado') rankingType = 'weight';
    }
    
    if (rankingType === 'weight') players.sort((a, b) => b.totalWeight - a.totalWeight);
    else if (rankingType === 'count') players.sort((a, b) => b.totalCatches - a.totalCatches);
    else players.sort((a, b) => {
        if (!a.biggestFish) return 1;
        if (!b.biggestFish) return -1;
        return b.biggestFish.weight - a.biggestFish.weight;
      });
    
    let rankingTitle = rankingType === 'weight' ? 'Peso Total' : (rankingType === 'count' ? 'Quantidade Total' : 'Maior Peixe');
    let rankingMessage = `🏆 *Ranking de Pescaria deste Grupo* (${rankingTitle})\n\n`;
    
    const topPlayers = players.slice(0, 10);
    topPlayers.forEach((player, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      
      if (rankingType === 'weight') {
        rankingMessage += `${medal} ${player.name}: ${player.totalWeight.toFixed(2)} kg (${player.totalCatches} peixes)\n`;
      } else if (rankingType === 'count') {
        rankingMessage += `${medal} ${player.name}: ${player.totalCatches} peixes (${player.totalWeight.toFixed(2)} kg)\n`;
      } else {
        if (!player.biggestFish) {
          rankingMessage += `${medal} ${player.name}: Ainda não pescou nenhum peixe\n`;
        } else {
          const rareMark = player.biggestFish.isRare ? ` ${player.biggestFish.emoji}` : '';
          rankingMessage += `${medal} ${player.name}: ${player.biggestFish.name} de ${player.biggestFish.weight.toFixed(2)} kg${rareMark}\n`;
        }
      }
    });
    
    rankingMessage += `\nOutros rankings disponíveis:`;
    if (rankingType !== 'biggest') rankingMessage += `\n- !pesca-ranking (sem argumentos)`;
    if (rankingType !== 'weight') rankingMessage += `\n- !pesca-ranking pesado`;
    if (rankingType !== 'count') rankingMessage += `\n- !pesca-ranking quantidade`;
    
    return new ReturnMessage({ chatId, content: rankingMessage });
  } catch (error) {
    logger.error('Erro ao mostrar ranking de pescaria:', error);
    return new ReturnMessage({ chatId: message.group ?? message.author, content: '❌ Erro ao mostrar ranking.' });
  }
}

async function saveRareFishImage(mediaContent, userId, fishName) {
  try {
    const mediaDir = path.join(database.databasePath, 'media');
    try { await fs.access(mediaDir); } catch (e) { await fs.mkdir(mediaDir, { recursive: true }); }
    const fileName = `peixe_raro_${fishName.replace(/\s+/g, '_')}_${userId.split('@')[0]}_${Date.now()}.jpg`;
    await fs.writeFile(path.join(mediaDir, fileName), Buffer.from(mediaContent.data, 'base64'));
    return fileName;
  } catch (e) { return null; }
}

/**
 * Mostra todas as informações sobre o jogo de pescaria.
 */
async function fishingInfoCommand(bot, message) {
    const chatId = message.group ?? message.author;
    try {
        const stats = await getFishingStats();
        const customVariables = await database.getCustomVariables();
        const fishVariety = customVariables.peixes?.length || 0;

        let infoMessage = "🎣 *Informações & Estatísticas do Jogo da Pesca* 🎣\n\n";

        infoMessage += "📜 *Regras e Informações Gerais*\n";
        infoMessage += `- *Iscas Máximas:* \`${MAX_BAITS}\`\n`;
        infoMessage += `- *Recarga de Isca:* 1 a cada ${BAIT_REGEN_TIME / 60} minutos. _(Não é possível alterar este tempo)_\n`;
        infoMessage += `-  *Peso dos Peixes:* de \`${MIN_FISH_WEIGHT}kg\` a \`${MAX_FISH_WEIGHT}kg\`\n`;
        infoMessage += `- *Peixes:* \`${fishVariety}\` tipos (\`!pesca-peixes\` para ver)\n\n`;

        // Legendary counts
        infoMessage += "🐲 *Peixes Lendários*\n_Chance de encontrar um destes seres místicos:_\n";
        for (const fish of RARE_FISH) {
            // Count from DB
            const countRow = await database.dbGet(dbName, "SELECT COUNT(*) as c FROM fishing_legendary_history WHERE fish_name = ?", [fish.name]);
            infoMessage += `  ${fish.emoji} *${fish.name}*: \`${(fish.chance * 100).toFixed(4 )}%\` de chance, ${countRow?.c || 0} pescados até hoje\n`;
        }
        infoMessage += "\n";

        infoMessage += "✨ *Buffs*\n_Itens que te ajudam na pescaria:_\n";
        UPGRADES.forEach(item => { infoMessage += `  ${item.emoji} *${item.name}*: ${item.description}\n`; });
        infoMessage += "\n";

        infoMessage += "🔥 *Debuffs*\n_Cuidado com o que você fisga!_\n";
        DOWNGRADES.forEach(item => { infoMessage += `  ${item.emoji} *${item.name}*: ${item.description}\n`; });
        infoMessage += "\n";

        infoMessage += "🧹 *Lixos Pescáveis*\n_Nem tudo que reluz é peixe..._\n";
        infoMessage += `\`${TRASH_ITEMS.map(item => item.emoji + " " + item.name).join(', ')}\`\n\n`;

        infoMessage += "📊 *Estatísticas Globais de Pesca*\n";
        infoMessage += `🐟 *Total de Peixes Pescados:* ${stats.totalFishCaught}\n`;
        infoMessage += `🐛 *Total de Iscas Usadas:* ${stats.totalBaitsUsed}\n`;
        infoMessage += `🧹 *Total de Lixo Coletado:* ${stats.totalTrashCaught}\n`;
        infoMessage += `🐲 *Total de Lendas Encontradas:* ${stats.totalLegendaryCaught}\n`;
        if (stats.heaviestFishEver.weight > 0) {
            infoMessage += `🏆 *Maior Peixe da História:* ${stats.heaviestFishEver.name} com \`${stats.heaviestFishEver.weight.toFixed(2)} kg\`, pescado por _${stats.heaviestFishEver.userName}_\n`;
        }
        if (stats.mostFishCaughtByUser.totalCatches > 0) {
            infoMessage += `🥇 *Pescador Mais Dedicado:* _${stats.mostFishCaughtByUser.userName}_ com \`${stats.mostFishCaughtByUser.totalCatches}\` peixes pescados\n`;
        }

        return new ReturnMessage({ chatId, content: infoMessage });

    } catch (error) {
        logger.error('Erro no comando pesca-info:', error);
        return new ReturnMessage({ chatId, content: '❌ Ocorreu um erro ao buscar as informações da pescaria.' });
    }
}

/**
 * Gera e retorna um objeto com as estatísticas globais de pesca.
 */
async function getFishingStats() {
    const totals = await database.dbGet(dbName, 
        `SELECT 
            SUM(total_catches) as totalFishCaught,
            SUM(total_baits_used) as totalBaitsUsed,
            SUM(total_trash_caught) as totalTrashCaught
        FROM fishing_users`);
    
    const legendaries = await database.dbGet(dbName, "SELECT COUNT(*) as c FROM fishing_legendary_history");
    
    // Heaviest fish logic: Iterate users and check their biggest_fish_json
    // Or just store heaviest globally? No, querying JSON is hard in basic SQLite without extension.
    // We will select all users with non-null biggest_fish_json and parse.
    // Optimization: Store weight in a separate column in users table? No, let's keep it simple for now as per migration.
    // Actually, migration didn't extract weight. We'll have to parse.
    
    // Alternative: We have fishing_inventory which has ALL fishes. We can just query max weight there.
    // BUT fishing_inventory might be cleared. 'biggest_fish_json' in users table persists even if inventory cleared.
    
    const allUsers = await database.dbAll(dbName, "SELECT name, biggest_fish_json, total_catches FROM fishing_users");
    
    let heaviestFishEver = { weight: 0 };
    let mostFishCaughtByUser = { totalCatches: 0 };
    
    for (const u of allUsers) {
        if (u.biggest_fish_json) {
            const bf = JSON.parse(u.biggest_fish_json);
            if (bf && bf.weight > heaviestFishEver.weight) {
                heaviestFishEver = { ...bf, userName: u.name };
            }
        }
        if (u.total_catches > mostFishCaughtByUser.totalCatches) {
            mostFishCaughtByUser = { totalCatches: u.total_catches, userName: u.name };
        }
    }

    return {
        totalFishCaught: totals?.totalFishCaught || 0,
        totalBaitsUsed: totals?.totalBaitsUsed || 0,
        totalTrashCaught: totals?.totalTrashCaught || 0,
        totalLegendaryCaught: legendaries?.c || 0,
        heaviestFishEver,
        mostFishCaughtByUser,
    };
}

/**
 * Lista todos os tipos de peixes disponíveis
 */
async function listFishTypesCommand(bot, message, args, group) {
  try {
    const chatId = message.group ?? message.author;
    
    let fishArray = [];
    try {
      const customVariables = await database.getCustomVariables();
      if (customVariables?.peixes && Array.isArray(customVariables.peixes) && customVariables.peixes.length > 0) {
        fishArray = customVariables.peixes;
      } else {
        return new ReturnMessage({ chatId, content: '🎣 Ainda não há tipos de peixes definidos.' });
      }
    } catch (error) {
      return new ReturnMessage({ chatId, content: '❌ Erro ao buscar tipos de peixes.' });
    }

    const sortedFishes = [...fishArray].sort();
    let fishMessage = '🐟 *Lista de Peixes Disponíveis*\n_(número de pescados entre parêntese)_\n\n';
    
    const columns = 2;
    const rows = Math.ceil(sortedFishes.length / columns);
      
    // Count fishes
    // We can query fishing_inventory for counts.
    // Note: Inventory gets cleared. So this is "currently in inventories". 
    // Original code did: "getFishingData... user.fishes.filter...". So it was also based on current inventory.
    // To match original behavior, we query fishing_inventory.
    
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < columns; j++) {
        const index = i + j * rows;
        if (index < sortedFishes.length) {
          const fishName = sortedFishes[index];
          const countRow = await database.dbGet(dbName, "SELECT COUNT(*) as c FROM fishing_inventory WHERE name = ?", [fishName]);
          
          fishMessage += `${fishName} (${countRow?.c || 0})`;
          if (j < columns - 1 && i + (j + 1) * rows < sortedFishes.length) {
            fishMessage += ' | ';
          }
        }
      }
      fishMessage += '\n';
    }
    
    fishMessage += `\n*Peixes Raríssimos*:\n`;
    for (const fish of RARE_FISH) {
      const chancePercent = fish.chance * 100;
      const countRow = await database.dbGet(dbName, "SELECT COUNT(*) as c FROM fishing_legendary_history WHERE fish_name = ?", [fish.name]);
      fishMessage += `${fish.emoji} ${fish.name}: ${fish.weightBonus}kg extra (${chancePercent.toFixed(5)}% de chance, ${countRow?.c || 0} pescados até hoje)\n`;
    }

    fishMessage += `\n🐛 Use \`!pesca-info\` para mais informações`;
    
    return new ReturnMessage({ chatId, content: fishMessage });
  } catch (error) {
    logger.error('Erro ao listar tipos de peixes:', error);
    return new ReturnMessage({ chatId: message.group ?? message.author, content: '❌ Erro ao listar peixes.' });
  }
}

/**
 * Mostra as iscas do jogador
 */
async function showBaitsCommand(bot, message, args, group) {
  try {
    const chatId = message.group ?? message.author;
    const userId = message.author;
    const userName = message.name ?? message.pushName ?? message.pushname ?? message.authorName ?? "Pescador";
    
    let userData = await getUserData(userId);
    
    if (!userData) {
      userData = {
         userId, name: userName, baits: MAX_BAITS, lastBaitRegen: Date.now(),
         totalWeight: 0, inventoryWeight: 0, totalCatches: 0, totalBaitsUsed: 0, totalTrashCaught: 0, biggestFish: null
      };
      await saveUserData(userData);
    }
    
    userData = regenerateBaits(userData);
    const regenInfo = getNextBaitRegenTime(userData);
    
    // Salva atualização de regen
    await saveUserData(userData);
    
    const nextBaitTime = regenInfo.nextBaitTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const allBaitsTime = regenInfo.allBaitsTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    let baitMessage = `🐛 *Iscas de ${userName}*\n\n`;
    const baitEmojis = Array(MAX_BAITS).fill('⚪').fill('🐛', 0, userData.baits).join(' ');
    
    baitMessage += `${baitEmojis}\n\n`;
    baitMessage += `Você tem ${userData.baits}/${MAX_BAITS} iscas.\n`;
    
    if (userData.baits < MAX_BAITS) {
      baitMessage += `Próxima isca em: ${formatTimeString(regenInfo.secondsUntilNextBait)} (${nextBaitTime})\n`;
      if (userData.baits < MAX_BAITS - 1) {
        baitMessage += `Todas as iscas em: ${formatTimeString(regenInfo.secondsUntilAllBaits)} (${allBaitsTime})\n`;
      }
    } else {
      baitMessage += `Suas iscas estão no máximo!\n`;
    }

    baitMessage += `\n*Sobre Iscas*:\n`;
    baitMessage += `• Você precisa de iscas para pescar\n`;
    baitMessage += `• Regenera 1 isca a cada ${Math.floor(BAIT_REGEN_TIME/60)} minutos (${Math.floor(BAIT_REGEN_TIME/60/60)} hora e ${Math.floor((BAIT_REGEN_TIME/60) % 60)} minutos)\n`;
    baitMessage += `• Máximo de ${MAX_BAITS} iscas\n`;
    baitMessage += `• Você pode encontrar pacotes de iscas enquanto pesca\n`;
    
    return new ReturnMessage({
      chatId,
      content: baitMessage,
      options: { quotedMessageId: message.origin.id._serialized, evoReply: message.origin }
    });
  } catch (error) {
    logger.error('Erro ao mostrar iscas do jogador:', error);
    return new ReturnMessage({ chatId: message.group ?? message.author, content: '❌ Erro ao mostrar iscas.' });
  }
}

/**  
 * Reseta os dados de pesca para o grupo atual  
 */  
async function resetFishingDataCommand(bot, message, args, group) {  
  try {  
    if (!message.group) return new ReturnMessage({ chatId: message.author, content: "❌ Este comando só pode ser usado em grupos." });  
  
    const isAdmin = await bot.adminUtils.isAdmin(message.author, group, null, bot.client);  
    if (!isAdmin) return new ReturnMessage({ chatId: message.group, content: "❌ Apenas admins podem usar isso." });  
  
    const groupId = message.group;
    
    const stats = await database.dbAll(dbName, "SELECT * FROM fishing_group_stats WHERE group_id = ?", [groupId]);
    if(stats.length === 0) return new ReturnMessage({ chatId: groupId, content: "ℹ️ Não há dados de pesca para este grupo." });

    const numPlayers = stats.length;
    
    await database.dbRun(dbName, "DELETE FROM fishing_group_stats WHERE group_id = ?", [groupId]);
      
    return new ReturnMessage({  
      chatId: message.group,  
      content: `✅ Dados de pesca resetados com sucesso!\n\n${numPlayers} jogadores tiveram seus dados de pesca neste grupo apagados.`  
    });  
  } catch (error) {  
    logger.error('Erro ao resetar dados de pesca:', error);  
    return new ReturnMessage({ chatId: message.group, content: '❌ Erro ao resetar dados.' });  
  }  
}

// Exportação
const commands = [
  new Command({name: 'pescar', description: 'Pesque um peixe', category: "jogos", cooldown: 0, reactions: { before: "🎣", after: "🐟", error: "❌" }, method: fishCommand }),
  new Command({name: 'pesca', hidden: true, description: 'Pesque um peixe', category: "jogos", cooldown: 0, reactions: { before: "🎣", after: "🐟", error: "❌" }, method: fishCommand }),
  new Command({name: 'meus-pescados', description: 'Seus peixes', category: "jogos", cooldown: 5, reactions: { after: "🐠", error: "❌" }, method: myFishCommand }),
  new Command({name: 'pesca-ranking',description: 'Mostra o ranking de pescaria do grupo atual',category: "jogos",group: "pescrank",cooldown: 5,reactions: {after: "🏆",error: "❌"},method: fishingRankingCommand}),
  new Command({name: 'pescados',hidden: true, description: 'Mostra o ranking de pescaria do grupo atual',category: "jogos",group: "pescrank",cooldown: 5,reactions: {after: "🐋",error: "❌"},method: fishingRankingCommand}),
  new Command({name: 'pesca-info',  description: 'Informações do jogo',  category: "jogos",  adminOnly: true,  cooldown: 60,  reactions: {  after: "📕",  error: "❌"  },  method: fishingInfoCommand  }),
  new Command({name: 'pesca-reset',  description: 'Reseta os dados de pesca para o grupo atual',  category: "jogos",  adminOnly: true,  cooldown: 10,  reactions: {  before: process.env.LOADING_EMOJI ?? "🌀",  after: "✅",  error: "❌"  },  method: resetFishingDataCommand  }),
  new Command({name: 'pesca-lendas',description: 'Mostra os peixes lendários que foram pescados',category: "jogos",cooldown: 10,reactions: {after: "🐉",error: "❌"},method: legendaryFishCommand}),
  new Command({name: 'pesca-peixes',description: 'Lista todos os tipos de peixes disponíveis',category: "jogos",cooldown: 5,reactions: {after: "📋",error: "❌"},method: listFishTypesCommand}),
  new Command({name: 'pesca-iscas',description: 'Mostra suas iscas de pesca',category: "jogos",cooldown: 5,reactions: {after: "🐛",error: "❌"},method: showBaitsCommand}),
  new Command({name: 'psc-addBaits', description: 'Add Iscas', category: "jogos", adminOnly: true, hidden: true, cooldown: 0, reactions: { after: "➕", error: "❌" }, method: addBaitsCmd })
];

// No longer need saveSync for SQLite (it's atomic) but keeping stub if external calls exist
function saveSync() {} 

module.exports = { 
  commands,
  forceSaveFishingData: saveSync,
  addBaits
}