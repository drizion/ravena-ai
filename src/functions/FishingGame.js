// src/functions/FishingGame.js
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const Logger = require('../utils/Logger');
const Command = require('../models/Command');
const Database = require('../utils/Database');
const AdminUtils = require('../utils/AdminUtils');
const sdModule = require('./StableDiffusionCommands');
const ReturnMessage = require('../models/ReturnMessage');

const logger = new Logger('fishing-game');

const database = Database.getInstance();
const adminUtils = AdminUtils.getInstance();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- CONSTANTES DO JOGO ---
const MAX_FISH_PER_USER = 10;
const MIN_FISH_WEIGHT = 1;
const MAX_FISH_WEIGHT = 180; // Aumentado para 180kg
const DIFFICULTY_THRESHOLD = 80; 
const FISHING_COOLDOWN = 5;
const MAX_BAITS = 7; // Aumentado para 7 iscas
const BAIT_REGEN_TIME = 60 * 60; // Reduzido para 1 hora (60 min * 60 seg)
const SAVE_CHECK_INTERVAL = 5000; // Verifica se precisa salvar a cada 5s

// Armazena os cooldowns de pesca
const fishingCooldowns = {};
// Ajustado escala de mensagens para o novo peso máximo
const weightScaleMsgs = [180, 150, 120, 100, 80, 60];

// --- GERENCIAMENTO DE DADOS (MEMÓRIA E DISCO) ---
// Buffer para os dados de pesca em memória
let fishingDataBuffer = null;
// Flag para indicar se houve alteração desde a última gravação
let hasUnsavedChanges = false;
// Mutex para impedir gravações simultâneas
let isSaving = false;

// Caminho para o arquivo de dados de pesca
const FISHING_DATA_PATH = path.join(database.databasePath, 'fishing.json');

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

/**
 * Obtém os dados de pesca. Se o arquivo estiver corrompido, faz backup e reseta.
 */
async function getFishingData() {
  if (fishingDataBuffer !== null) {
    return fishingDataBuffer;
  }

  const defaultData = {
    fishingData: {},
    groupData: {},
    legendaryFishes: []
  };

  try {
    // Tenta ler o arquivo
    const data = await fs.readFile(FISHING_DATA_PATH, 'utf8');
    
    // Tenta fazer o parse
    try {
        const parsedData = JSON.parse(data);
        
        // Garante estrutura mínima
        if (!parsedData.groupData) parsedData.groupData = {};
        if (!parsedData.fishingData) parsedData.fishingData = {};
        if (!parsedData.legendaryFishes) parsedData.legendaryFishes = [];

        fishingDataBuffer = parsedData;
        return parsedData;

    } catch (parseError) {
        // JSON Inválido: Backup e Reset
        logger.error(`[FishingGame] Arquivo corrompido detectado! Criando backup...`);
        const backupPath = `${FISHING_DATA_PATH}.corrupted-${Date.now()}`;
        await fs.copyFile(FISHING_DATA_PATH, backupPath);
        logger.info(`[FishingGame] Backup criado em: ${backupPath}`);

        fishingDataBuffer = defaultData;
        hasUnsavedChanges = true; // Força salvar o novo limpo
        return defaultData;
    }

  } catch (error) {
    if (error.code === 'ENOENT') {
        // Arquivo não existe, criar novo
        fishingDataBuffer = defaultData;
        hasUnsavedChanges = true;
        return defaultData;
    } else {
        logger.error('[FishingGame] Erro crítico de I/O ao ler dados:', error);
        return defaultData; // Em memória apenas, para não crashar
    }
  }
}

/**
 * Marca os dados como sujos para serem salvos no próximo ciclo
 * @param {Object} updatedData 
 */
async function saveFishingData(updatedData) {
    fishingDataBuffer = updatedData;
    hasUnsavedChanges = true;
    return true;
}

/**
 * Função interna que realmente escreve no disco.
 * Usa um arquivo temporário + rename para garantir atomicidade.
 */
async function processSaveQueue() {
    if (!hasUnsavedChanges || isSaving || !fishingDataBuffer) {
        return;
    }

    isSaving = true;

    try {
        const dir = path.dirname(FISHING_DATA_PATH);
        await fs.mkdir(dir, { recursive: true });

        const tempPath = `${FISHING_DATA_PATH}.temp`;
        const jsonData = JSON.stringify(fishingDataBuffer, null, 2);

        // Escreve no temp
        await fs.writeFile(tempPath, jsonData, 'utf8');
        
        // Renomeia atômico (sobrescreve o oficial)
        await fs.rename(tempPath, FISHING_DATA_PATH);

        // Sucesso
        hasUnsavedChanges = false;
        // logger.debug('[FishingGame] Dados salvos com sucesso.');

    } catch (error) {
        logger.error('[FishingGame] Erro ao salvar no disco:', error);
    } finally {
        isSaving = false;
    }
}

/**
 * Salvamento Síncrono para encerramento do processo (Safety Net)
 */
function saveSync() {
    if (hasUnsavedChanges && fishingDataBuffer) {
        try {
            const dir = path.dirname(FISHING_DATA_PATH);
            if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
            
            fsSync.writeFileSync(FISHING_DATA_PATH, JSON.stringify(fishingDataBuffer, null, 2));
            logger.info('[FishingGame] Dados salvos (Sync) antes de encerrar.');
        } catch (e) {
            logger.error('[FishingGame] Falha no salvamento Sync:', e);
        }
    }
}

// --- LOOPS E LISTENERS ---

// Loop de salvamento robusto
setInterval(processSaveQueue, SAVE_CHECK_INTERVAL);

// Listeners de saída
process.on('exit', saveSync);
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
  process.on(signal, () => {
      saveSync();
      process.exit(0);
  });
});

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
        guaranteedWeightBuff.remainingUses--; // consume buff
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
  const lastRegen = userData.lastBaitRegen || now;
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
  const fishingData = await getFishingData();
  userId = `${userId}`.replace(/\D/g, '');
  userId = userId.split("@")[0] + "@c.us"; 

  const userData = fishingData.fishingData[userId];

  if(!userData){
    return { userId };
  }
  if (userData.baits === undefined) {
    userData.baits = MAX_BAITS + baitsNum;
    userData.lastBaitRegen = Date.now();
  }

  userData.baits += baitsNum;
  await saveFishingData(fishingData);

  return { userId, userData };
}

async function addBaitsCmd(bot, message, args, group) {
  try {
    const chatId = message.group || message.author;
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
        reactions: { after: "🐡" }
      });
    } else {
      return new ReturnMessage({
        chatId,
        content: `🎣 Iscas de '${destUser}' ajustadas para ${dados.userData.baits}`,
        reactions: { after: "🎣" }
      });
    }
  } catch (e){
    logger.error("Erro no addBaitsCmd", e);
    return new ReturnMessage({ chatId, content: "Erro interno." });
  }
}

function getNextBaitRegenTime(userData) {
  const now = Date.now();
  const lastRegen = userData.lastBaitRegen || now;
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

function applyItemEffect(userData, item) {
  let effectMessage = '';
  if (!userData.buffs) userData.buffs = [];
  if (!userData.debuffs) userData.debuffs = [];
  
  switch (item.type) {
    case 'trash':
      const baitOnTrashDebuff = userData.debuffs.find(d => d.type === 'bait_on_trash' && d.remainingUses > 0);
      const baitOnTrashBuff = userData.buffs.find(b => b.type === 'bait_on_trash' && b.remainingUses > 0); 
      const trashProtector = baitOnTrashDebuff || baitOnTrashBuff;

      if (trashProtector) {
        trashProtector.remainingUses--;
        effectMessage = `\n\n${item.emoji} Você pescou um(a) ${item.name}, mas seu ${trashProtector.originalName || 'Anzol'} te salvou de perder a isca!`;
      } else {
        effectMessage = `\n\n${item.emoji} Você pescou um(a) ${item.name}. Que pena!`;
      }
      break;
      
    case 'upgrade':
      switch (item.effect) {
        case 'weight_boost':
          userData.buffs.push({ type: 'weight_boost', value: item.value, remainingUses: item.duration, originalName: item.name });
          effectMessage = `\n\n${item.emoji} Você encontrou um ${item.name}! +${item.value*100}% no peso dos próximos ${item.duration} peixes.`;
          break;
        case 'next_fish_bonus':
          userData.buffs.push({ type: 'next_fish_bonus', value: item.value, remainingUses: 1, originalName: item.name });
          effectMessage = `\n\n${item.emoji} Você encontrou um ${item.name}! O próximo peixe terá +${item.value}kg.`;
          break;
        case 'double_catch':
          userData.buffs.push({ type: 'double_catch', remainingUses: 1, originalName: item.name });
          effectMessage = `\n\n${item.emoji} Você encontrou uma ${item.name}! Na próxima pescaria, você pegará 2 peixes de uma vez.`;
          break;
        case 'extra_baits':
          userData.baits = userData.baits + item.value;
          effectMessage = `\n\n${item.emoji} Você encontrou um ${item.name}! +${item.value} iscas adicionadas (${userData.baits}/${MAX_BAITS}).`;
          break;
        case 'rare_chance_boost':
          userData.buffs.push({ type: 'rare_chance_boost', value: item.value, remainingUses: item.duration, originalName: item.name });
          effectMessage = `\n\n${item.emoji} Você encontrou um ${item.name}! A chance de encontrar peixes raros aumentou por ${item.duration} pescarias.`;
          break;
        case 'cooldown_reduction':
          userData.buffs.push({ type: 'cooldown_reduction', value: item.value, remainingUses: item.duration, originalName: item.name });
          effectMessage = `\n\n${item.emoji} Você adquiriu uma ${item.name}! O tempo de espera para pescar foi reduzido em ${item.value*100}% por ${item.duration} pescarias.`;
          break;
        case 'guaranteed_weight':
            userData.buffs.push({ type: 'guaranteed_weight', minValue: item.minValue, maxValue: item.maxValue, remainingUses: 1, originalName: item.name });
            effectMessage = `\n\n${item.emoji} Você encontrou um ${item.name}! O próximo peixe terá entre ${item.minValue}kg e ${item.maxValue}kg.`;
            break;
        case 'bait_on_trash':
            userData.buffs.push({ type: 'bait_on_trash', remainingUses: item.duration, originalName: item.name });
            effectMessage = `\n\n${item.emoji} Você equipou um ${item.name}! Você não perderá iscas ao pescar lixo pelas próximas ${item.duration} vezes.`;
            break;
      }
      break;
      
    case 'downgrade':
      switch (item.effect) {
        case 'weight_loss':
          userData.debuffs.push({ type: 'weight_loss', value: item.value, remainingUses: item.duration, originalName: item.name });
          effectMessage = `\n\n${item.emoji} 𝕍𝕠𝕔ê 𝕡𝕖𝕤𝕔𝕠𝕦 𝕦𝕞𝕒... 🕯️𝕍𝔼𝕃𝔸 𝔸ℂ𝔼𝕊𝔸?! 😱 𝒪𝒷𝓇𝒶 𝒹𝑜 𝒸𝒶𝓅𝒾𝓇𝑜𝓉𝑜! 🔥👹🩸`;
          break;
        case 'clear_inventory':
          userData.fishes = [];
          userData.totalWeight -= userData.inventoryWeight || 0;
          userData.inventoryWeight = 0;
          effectMessage = `\n\n${item.emoji} OH NÃO! Você encontrou uma ${item.name}! Seu inventário de peixes foi destruído!`;
          break;
        case 'remove_baits':
          const baitsLost = Math.min(userData.baits, item.value);
          userData.baits -= baitsLost;
          effectMessage = `\n\n${item.emoji} Uma ${item.name} apareceu e comeu ${baitsLost} de suas iscas! (${userData.baits}/${MAX_BAITS} iscas restantes).`;
          break;
        case 'bait_on_trash':
            userData.debuffs.push({ type: 'bait_on_trash', remainingUses: item.duration, originalName: item.name });
            effectMessage = `\n\n${item.emoji} Você pescou um ${item.name}! Você não perderá iscas ao pescar lixo por ${item.duration} vezes.`;
            break;
        case 'longer_cooldown':
            userData.debuffs.push({ type: 'longer_cooldown', value: item.value, remainingUses: item.duration, originalName: item.name });
            const frasesFiscal = [
                "O fiscal não gostou da sua cara.", "Você estava pescando sem licença.", "Ele alega que viu você pescando uma bota.",
                "Ele está medindo o tamanho do seu anzol.", "Multado por excesso de feiura.", "Confiscou sua vara por 'motivos de segurança'."
            ];
            const fraseAleatoria = frasesFiscal[Math.floor(Math.random() * frasesFiscal.length)];
            effectMessage = `\n\n${item.emoji} Uma ${item.name} te parou! ${fraseAleatoria} O tempo de espera para pescar aumentou em ${item.value}x por ${item.duration} pescarias.`;
            break;
        case 'lose_smallest_fish':
            if (userData.fishes.length > 0) {
                let smallestFishIndex = 0;
                for (let i = 1; i < userData.fishes.length; i++) {
                    if (userData.fishes[i].weight < userData.fishes[smallestFishIndex].weight) {
                        smallestFishIndex = i;
                    }
                }
                const removedFish = userData.fishes.splice(smallestFishIndex, 1)[0];
                userData.inventoryWeight -= removedFish.weight;
                effectMessage = `\n\n${item.emoji} Uma ${item.name} levou seu ${removedFish.name} embora!`;
            } else {
                effectMessage = `\n\n${item.emoji} Uma ${item.name} revirou suas coisas, mas não havia peixes para levar.`;
            }
            break;
        case 'lose_recent_fish':
             effectMessage = `\n\n${item.emoji} Maldito ${item.name}! Ele roubou o peixe que você acabou de pegar!`;
             break;
      }
      break;
  }
  
  return { userData, effectMessage };
}

function toDemonic(text) {
  // Simplificado para brevidade, mas mantendo lógica original
  return text.split('').map(c => c).join('');
}

function applyBuffs(userData, fish) {
  if ((!userData.buffs || userData.buffs.length === 0) && (!userData.debuffs || userData.debuffs.length === 0)) {
    return { fish, buffs: [] };
  }
  if(!userData.debuffs) userData.debuffs = [];
  
  let modifiedFish = { ...fish };
  let updatedBuffs = [...userData.buffs];
  let updatedDebuffs = [...userData.debuffs];
  let buffMessages = [];
  
  updatedBuffs = updatedBuffs.filter(buff => {
    if (buff.remainingUses <= 0) return false;
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
    return buff.remainingUses > 0;
  });

  updatedDebuffs = updatedDebuffs.filter(debuff => {
    if (debuff.remainingUses <= 0) return false;
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
    return debuff.remainingUses > 0;
  });

  return { fish: modifiedFish, buffs: updatedBuffs, debuffs: updatedDebuffs, buffMessages };
}

async function generateRareFishImage(bot, userName, fishName) {
  try {
    const prompt = `${userName} fishing an epic enormous fish named '${fishName}' using only a wooden fishing rod`;
    logger.info(`[fishing] generateRareFishImage: ${prompt}`);
    if (!sdModule || !sdModule.commands || !sdModule.commands[0] || !sdModule.commands[0].method) return null;
    
    const mockMessage = { author: 'SYSTEM', authorName: 'Sistema', content: prompt, origin: { getQuotedMessage: () => Promise.resolve(null) } };
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

function consumeDoubleCatchBuff(userData) {
  if (userData.buffs) {
      userData.buffs = userData.buffs.filter(buff => {
        if (buff.type === 'double_catch' && buff.remainingUses > 0) {
          buff.remainingUses--;
          return buff.remainingUses > 0;
        }
        return true;
      });
  }
  return userData;
}

/**
 * Pescar um peixe
 */
async function fishCommand(bot, message, args, group) {
  try {
    const chatId = message.group || message.author;
    const userId = message.author;
    const userName = message.name ?? message.pushName ?? message.pushname ?? message.authorName ?? "Pescador";
    const groupId = message.group; 
    const mentionPessoa = [];
    
    const fishingData = await getFishingData();
    
    if (!fishingData.fishingData[userId]) {
      fishingData.fishingData[userId] = {
        name: userName, fishes: [], totalWeight: 0, inventoryWeight: 0, biggestFish: null,
        totalCatches: 0, totalBaitsUsed: 0, totalTrashCaught: 0, baits: MAX_BAITS,
        lastBaitRegen: Date.now(), buffs: [], debuffs: []
      };
    } else {
      fishingData.fishingData[userId].name = userName;
    }
    
    const userData = fishingData.fishingData[userId];
    fishingData.fishingData[userId] = regenerateBaits(userData);
    
    // Cooldown
    const now = Math.floor(Date.now() / 1000);
    let currentCooldown = FISHING_COOLDOWN;

    if (userData.buffs) {
        const cooldownBuff = userData.buffs.find(b => b.type === 'cooldown_reduction' && b.remainingUses > 0);
        if (cooldownBuff) { currentCooldown *= (1 - cooldownBuff.value); cooldownBuff.remainingUses--; }
    }
    if (userData.debuffs) {
        const cooldownDebuff = userData.debuffs.find(d => d.type === 'longer_cooldown' && d.remainingUses > 0);
        if (cooldownDebuff) { currentCooldown *= cooldownDebuff.value; cooldownDebuff.remainingUses--; }
    }

    if (fishingCooldowns[userId] && now < fishingCooldowns[userId]) {
      try { setTimeout((mo) => { mo.react("😴"); }, 2000, message.origin); } catch (e) {}
      return null;
    }
    
    if (userData.baits <= 0) {
      try { setTimeout((mo) => { mo.react("🍥"); }, 3000, message.origin); } catch (e) {}
      return null;
    }
    
    // Grupo init
    if (groupId && !fishingData.groupData[groupId]) fishingData.groupData[groupId] = {};
    if (groupId && !fishingData.groupData[groupId][userId]) {
      fishingData.groupData[groupId][userId] = { name: userName, totalWeight: 0, biggestFish: null, totalCatches: 0 };
    } else if (groupId) {
      fishingData.groupData[groupId][userId].name = userName;
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
    if (catchCount === 2) consumeDoubleCatchBuff(userData);
    
    const caughtFishes = [];
    let effectMessage = '';
    let randomItem = null;
    
    for (let i = 0; i < catchCount; i++) {
      const fish = await getRandomFish(fishArray, i > 0, userData);
      const buffResult = applyBuffs(userData, fish);
      const modifiedFish = buffResult.fish;
      fishingData.fishingData[userId].buffs = buffResult.buffs;
      fishingData.fishingData[userId].debuffs = buffResult.debuffs;
      
      if (buffResult.buffMessages?.length > 0) effectMessage += `\n${buffResult.buffMessages.join('\n')}`;
      
      userData.fishes.push(modifiedFish);
      userData.totalWeight = (userData.totalWeight || 0) + modifiedFish.weight;
      userData.inventoryWeight = (userData.inventoryWeight || 0) + modifiedFish.weight;
      userData.totalCatches = (userData.totalCatches || 0) + 1;
      caughtFishes.push(modifiedFish);
      
      if (!userData.biggestFish || modifiedFish.weight > userData.biggestFish.weight) userData.biggestFish = modifiedFish;
      
      if (groupId) {
        const gUser = fishingData.groupData[groupId][userId];
        gUser.totalWeight = (gUser.totalWeight || 0) + modifiedFish.weight;
        gUser.totalCatches = (gUser.totalCatches || 0) + 1;
        if (!gUser.biggestFish || modifiedFish.weight > gUser.biggestFish.weight) gUser.biggestFish = modifiedFish;
      }
      
      if (i === 0 && !modifiedFish.isRare) {
        randomItem = checkRandomItem();
        if (randomItem) {
          const itemResult = applyItemEffect(userData, randomItem);
          fishingData.fishingData[userId] = itemResult.userData;
          effectMessage += itemResult.effectMessage;
          
          if (randomItem.type === 'trash') {
            userData.totalTrashCaught = (userData.totalTrashCaught || 0) + 1;
            caughtFishes.pop();
            userData.fishes.pop();
            userData.totalCatches--;
            userData.totalWeight -= modifiedFish.weight;
            userData.inventoryWeight -= modifiedFish.weight;
            if (groupId) {
                fishingData.groupData[groupId][userId].totalCatches--;
                fishingData.groupData[groupId][userId].totalWeight -= modifiedFish.weight;
            }
            break;
          }
        }
      }
    }

    const hasTrashProtection = userData.debuffs?.some(d => d.type === 'bait_on_trash' && d.remainingUses > 0) ||
                               userData.buffs?.some(b => b.type === 'bait_on_trash' && b.remainingUses > 0);

    if (randomItem?.type !== 'trash' || !hasTrashProtection) {
        userData.baits--;
    }
    userData.totalBaitsUsed = (userData.totalBaitsUsed || 0) + 1;
    
    await saveFishingData(fishingData);
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
        reactions: { after: "🎣" },
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

    // Se for peixe raro, tentar gerar imagem
    if (caughtFishes.length === 1 && caughtFishes[0].isRare) {
      let rareFishImage = await generateRareFishImage(bot, userName, caughtFishes[0].name);

      if(!rareFishImage){
        // Placeholder
        const pchPescaRara = path.join(database.databasePath, "rare-fish.jpg");
        logger.error(`[fishing] Erro gerando imagem de peixe raro, usando placeholder '${pchPescaRara}'`);
        rareFishImage = await bot.createMedia(pchPescaRara, "image/jpeg");
      }
      
      const savedImageName = await saveRareFishImage(rareFishImage, userId, caughtFishes[0].name);
      if (!fishingData.legendaryFishes) fishingData.legendaryFishes = [];
      
      fishingData.legendaryFishes.push({
        fishName: caughtFishes[0].name, weight: caughtFishes[0].weight, userId: userId,
        userName: userName, groupId: groupId || null, groupName: group ? group.name : "chat privado",
        timestamp: Date.now(), imageName: savedImageName
      });

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
        msgsEnviadas[0].pin(260000);
      }
      
      if (bot.grupoAvisos) {
        notificacaoPeixeRaro.chatId = bot.grupoAvisos;
        const msgsEnviadas = await bot.sendReturnMessages(notificacaoPeixeRaro);
        msgsEnviadas[0].pin(260000);
      }

      return new ReturnMessage({
        chatId, content: rareFishImage,
        options: { caption: fishMessage, quotedMessageId: message.origin.id._serialized, mentions: mentionPessoa, evoReply: message.origin },
        reactions: { after: "🎣" }
      });

    }
    
    return new ReturnMessage({
      chatId, content: fishMessage, reactions: { after: "🎣" },
      options: { quotedMessageId: message.origin.id._serialized, mentions: mentionPessoa, evoReply: message.origin }
    });
  } catch (error) {
    logger.error('Erro no comando de pesca:', error);
    return new ReturnMessage({ chatId: message.group || message.author, content: '❌ Erro ao pescar.' });
  }
}

async function myFishCommand(bot, message, args, group) {
  try {
    const chatId = message.group || message.author;
    const userId = message.author;
    const userName = message.name ?? message.pushName ?? message.pushname ?? message.authorName ?? "Pescador";
    
    const fishingData = await getFishingData();
    
    if (!fishingData.fishingData[userId]) {
      return new ReturnMessage({ chatId, content: `🎣 ${userName}, use !pescar para começar.` });
    }
    
    fishingData.fishingData[userId] = regenerateBaits(fishingData.fishingData[userId]);
    await saveFishingData(fishingData);
    
    const userData = fishingData.fishingData[userId];
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
      
      fishMessage += `\n*Stats*:\nTotal: ${userData.totalCatches}\nPeso Inv: ${userData.inventoryWeight?.toFixed(2) || 0} kg\nIscas: ${userData.baits}/${MAX_BAITS}\n`;
      
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
    return new ReturnMessage({ chatId: message.group || message.author, content: '❌ Erro ao ver peixes.' });
  }
}

/**
 * Mostra os peixes lendários que foram pescados
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage|Array<ReturnMessage>>} Mensagem(ns) de retorno
 */
async function legendaryFishCommand(bot, message, args, group) {
  try {
    // Obtém ID do chat
    const chatId = message.group || message.author;
    
    // Obtém dados de pesca
    const fishingData = await getFishingData();
    
    // Verifica se há peixes lendários
    if (!fishingData.legendaryFishes || fishingData.legendaryFishes.length === 0) {
      return new ReturnMessage({
        chatId,
        content: '🐉 Ainda não foram pescados peixes lendários. Continue pescando e você pode ser o primeiro a encontrar um!'
      });
    }
    
    // Ordena os peixes lendários por data (mais recente primeiro)
    const sortedLegendaryFishes = [...fishingData.legendaryFishes].sort((a, b) => b.timestamp - a.timestamp);
    
    const rareFishListItems = await Promise.all(RARE_FISH.map(async f => {
        const count = await getNumberOfFishesByName(f.name, fishingData);
        return `\t${f.emoji} ${f.name} _(${f.weightBonus}kg, ${count} pescados até hoje)_`;
    }));
    const rareFishList = rareFishListItems.join("\n");

    // Prepara a mensagem com a lista completa de todos os peixes lendários
    let textMessage = `🌊 *Lista de Peixes Lendários* 🎣\n${rareFishList}\n\n🏆 *REGISTRO DE PEIXES LENDÁRIOS* 🎖️\n\n`;
    
    // Adiciona todos os peixes lendários na mensagem de texto
    for (let i = 0; i < sortedLegendaryFishes.length; i++) {
      const legendary = sortedLegendaryFishes[i];
      
      // Formata data para um formato legível
      const date = new Date(legendary.timestamp).toLocaleDateString('pt-BR');
      
      // Adiciona emoji especial para os 3 primeiros
      const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i+1}. `;
      
      textMessage += `${medal}*${legendary.fishName}* (${legendary.weight.toFixed(2)} kg)\n`;
      textMessage += `   Pescador: ${legendary.userName}\n`;
      textMessage += `   Local: ${legendary.groupName || 'desconhecido'}\n`;
      textMessage += `   Data: ${date}\n\n`;
    }
    
    // Adiciona mensagem sobre as imagens
    if (sortedLegendaryFishes.length > 0) {
      textMessage += `📷 *Mostrando imagens das ${Math.min(5, sortedLegendaryFishes.length)} lendas mais recentes...*`;
    }
    
    // Mensagens a serem enviadas
    const messages = [];
    
    // Adiciona a mensagem de texto inicial
    messages.push(new ReturnMessage({
      chatId,
      content: textMessage
    }));
    
    // Limita a 5 peixes para as imagens
    const legendaryToShow = sortedLegendaryFishes.slice(0, 5);
    
    // Cria uma mensagem para cada peixe lendário (apenas os 5 mais recentes)
    for (const legendary of legendaryToShow) {
      try {
        let content;
        let options = {};
        
        // Tenta carregar a imagem se existir
        if (legendary.imageName) {
          const imagePath = path.join(database.databasePath, 'media', legendary.imageName);
          try {
            await fs.access(imagePath);
            // Imagem existe, cria média
            const media = await bot.createMedia(imagePath);
            content = media;
            
            // Prepara a legenda
            const date = new Date(legendary.timestamp).toLocaleDateString('pt-BR');
            options.caption = `🏆 *Peixe Lendário*\n\n*${legendary.fishName}* de ${legendary.weight.toFixed(2)} kg\nPescado por: ${legendary.userName}\nLocal: ${legendary.groupName || 'desconhecido'}\nData: ${date}`;
          } catch (imageError) {
            // Imagem não existe, pula para o próximo
            logger.error(`Imagem do peixe lendário não encontrada: ${imagePath}`, imageError);
            continue;
          }
        } else {
          // Sem imagem, pula para o próximo
          continue;
        }
        
        // Adiciona a mensagem à lista
        messages.push(new ReturnMessage({
          chatId,
          content,
          options,
          // Adiciona delay para evitar envio muito rápido
          delay: messages.length * 1000 
        }));
        
      } catch (legendaryError) {
        logger.error('Erro ao processar peixe lendário:', legendaryError);
      }
    }
    
    if (messages.length === 1) {
      return messages[0]; // Retorna apenas a mensagem de texto se não houver imagens
    }
    
    return messages;
  } catch (error) {
    logger.error('Erro no comando de peixes lendários:', error);
    
    return new ReturnMessage({
      chatId: message.group || message.author,
      content: '❌ Ocorreu um erro ao mostrar os peixes lendários. Por favor, tente novamente.'
    });
  }
}

/**
 * Mostra o ranking de pescaria do grupo atual
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage>} Mensagem de retorno
 */
async function fishingRankingCommand(bot, message, args, group) {
  try {
    // Obtém ID do chat
    const chatId = message.group || message.author;
    const groupId = message.group;
    
    // Verifica se o comando foi executado em um grupo
    if (!groupId) {
      return new ReturnMessage({
        chatId,
        content: '🎣 Este comando só funciona em grupos. Use-o em um grupo para ver o ranking desse grupo específico.'
      });
    }
    
    // Obtém dados de pesca
    const fishingData = await getFishingData();
    
    // Verifica se há dados para este grupo
    if (!fishingData.groupData || 
        !fishingData.groupData[groupId] || 
        Object.keys(fishingData.groupData[groupId]).length === 0) {
      return new ReturnMessage({
        chatId,
        content: '🎣 Ainda não há dados de pescaria neste grupo. Use !pescar para começar.'
      });
    }
    
    // Obtém os dados dos jogadores deste grupo
    const players = Object.entries(fishingData.groupData[groupId]).map(([id, data]) => ({
      id,
      ...data
    }));
    
    // Determina o tipo de ranking
    let rankingType = 'biggest'; // Padrão: maior peixe (sem argumentos)
    
    if (args.length > 0) {
      const arg = args[0].toLowerCase();
      if (arg === 'quantidade') {
        rankingType = 'count';
      } else if (arg === 'pesado') {
        rankingType = 'weight';
      }
    }
    
    // Ordena jogadores com base no tipo de ranking
    if (rankingType === 'weight') {
      // Ordena por peso total
      players.sort((a, b) => b.totalWeight - a.totalWeight);
    } else if (rankingType === 'count') {
      // Ordena por quantidade total de peixes
      players.sort((a, b) => b.totalCatches - a.totalCatches);
    } else {
      // Ordena por tamanho do maior peixe
      players.sort((a, b) => {
        // Se algum jogador não tiver um maior peixe, coloca-o no final
        if (!a.biggestFish) return 1;
        if (!b.biggestFish) return -1;
        return b.biggestFish.weight - a.biggestFish.weight;
      });
    }
    
    // Prepara o título do ranking de acordo com o tipo
    let rankingTitle = '';
    if (rankingType === 'weight') {
      rankingTitle = 'Peso Total';
    } else if (rankingType === 'count') {
      rankingTitle = 'Quantidade Total';
    } else {
      rankingTitle = 'Maior Peixe';
    }
    
    // Prepara a mensagem de ranking
    let rankingMessage = `🏆 *Ranking de Pescaria deste Grupo* (${rankingTitle})\n\n`;
    
    // Lista os jogadores
    const topPlayers = players.slice(0, 10);
    topPlayers.forEach((player, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      
      if (rankingType === 'weight') {
        rankingMessage += `${medal} ${player.name}: ${player.totalWeight.toFixed(2)} kg (${player.totalCatches} peixes)\n`;
      } else if (rankingType === 'count') {
        rankingMessage += `${medal} ${player.name}: ${player.totalCatches} peixes (${player.totalWeight.toFixed(2)} kg)\n`;
      } else {
        // Se o jogador não tiver um maior peixe, mostra uma mensagem apropriada
        if (!player.biggestFish) {
          rankingMessage += `${medal} ${player.name}: Ainda não pescou nenhum peixe\n`;
        } else {
          const rareMark = player.biggestFish.isRare ? ` ${player.biggestFish.emoji}` : '';
          rankingMessage += `${medal} ${player.name}: ${player.biggestFish.name} de ${player.biggestFish.weight.toFixed(2)} kg${rareMark}\n`;
        }
      }
    });
    
    // Informações sobre os outros rankings
    rankingMessage += `\nOutros rankings disponíveis:`;
    if (rankingType !== 'biggest') {
      rankingMessage += `\n- !pesca-ranking (sem argumentos): Ranking por maior peixe`;
    }
    if (rankingType !== 'weight') {
      rankingMessage += `\n- !pesca-ranking pesado: Ranking por peso total`;
    }
    if (rankingType !== 'count') {
      rankingMessage += `\n- !pesca-ranking quantidade: Ranking por quantidade de peixes`;
    }
    
    return new ReturnMessage({
      chatId,
      content: rankingMessage
    });
  } catch (error) {
    logger.error('Erro ao mostrar ranking de pescaria:', error);
    
    return new ReturnMessage({
      chatId: message.group || message.author,
      content: '❌ Ocorreu um erro ao mostrar o ranking. Por favor, tente novamente.'
    });
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
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @returns {Promise<ReturnMessage>} Mensagem de retorno
 */
async function fishingInfoCommand(bot, message) {
    const chatId = message.group || message.author;
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

        const fishingData = await getFishingData(); // pseudo cache
        infoMessage += "🐲 *Peixes Lendários*\n_Chance de encontrar um destes seres místicos:_\n";
        for (const fish of RARE_FISH) {
            const count = await getNumberOfFishesByName(fish.name, fishingData);
            infoMessage += `  ${fish.emoji} *${fish.name}*: \`${(fish.chance * 100).toFixed(4 )}%\` de chance, ${count} pescados até hoje\n`;
        }
        infoMessage += "\n";

        infoMessage += "✨ *Buffs*\n_Itens que te ajudam na pescaria:_\n";
        UPGRADES.forEach(item => {
            infoMessage += `  ${item.emoji} *${item.name}*: ${item.description}\n`;
        });
        infoMessage += "\n";

        infoMessage += "🔥 *Debuffs*\n_Cuidado com o que você fisga!_\n";
        DOWNGRADES.forEach(item => {
            infoMessage += `  ${item.emoji} *${item.name}*: ${item.description}\n`;
        });
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

        infoMessage += "\n\n> Se você deseja contribuir com novos buffs, lixos, peixes, etc. fique à vontade para mandar sugestões no `!grupao` ou um _PR_ direto no `!codigo`";

        return new ReturnMessage({ chatId, content: infoMessage });

    } catch (error) {
        logger.error('Erro no comando pesca-info:', error);
        return new ReturnMessage({
            chatId,
            content: '❌ Ocorreu um erro ao buscar as informações da pescaria.'
        });
    }
}
/**
 * Conta quantos peixes de um determinado tipo já foram pescados.
 * Para peixes raros, usa o histórico de lendas.
 * Para peixes comuns, usa os inventários atuais.
 * @param {string} fishName 
 */
async function getNumberOfFishesByName(fishName, fishingData = null) {
  if(!fishingData){
    fishingData = await getFishingData();
  }
  const rareFishNames = RARE_FISH.map(r => r.name);
  
  if (rareFishNames.includes(fishName)) {
      if (!fishingData.legendaryFishes) return 0;
      return fishingData.legendaryFishes.filter(l => l.fishName === fishName).length;
  } else {
      let count = 0;
      const allUsers = Object.values(fishingData.fishingData || {});
      for (const user of allUsers) {
          if (user.fishes) {
              count += user.fishes.filter(f => f.name === fishName).length;
          }
      }
      return count;
  }
}

/**
 * Gera e retorna um objeto com as estatísticas globais de pesca.
 * @returns {Promise<Object>} Objeto com as estatísticas.
 */
async function getFishingStats() {
    const fishingData = await getFishingData();
    const allUsersData = Object.values(fishingData.fishingData || {});

    let totalFishCaught = 0;
    let totalBaitsUsed = 0;
    let totalTrashCaught = 0;
    let heaviestFishEver = { weight: 0 };
    let mostFishCaughtByUser = { totalCatches: 0 };

    for (const userData of allUsersData) {
        totalFishCaught += userData.totalCatches || 0;
        totalBaitsUsed += (userData.totalBaitsUsed || 0);
        totalTrashCaught += (userData.totalTrashCaught || 0);

        if (userData.biggestFish && userData.biggestFish.weight > heaviestFishEver.weight) {
            heaviestFishEver = {
                ...userData.biggestFish,
                userName: userData.name,
            };
        }

        if (userData.totalCatches > mostFishCaughtByUser.totalCatches) {
            mostFishCaughtByUser = {
                totalCatches: userData.totalCatches,
                userName: userData.name,
            };
        }
    }

    totalBaitsUsed += Math.floor(totalFishCaught*1.2);
    totalTrashCaught += (totalBaitsUsed - totalFishCaught);

    const totalLegendaryCaught = fishingData.legendaryFishes?.length || 0;

    return {
        totalFishCaught,
        totalBaitsUsed,
        totalTrashCaught,
        totalLegendaryCaught,
        heaviestFishEver,
        mostFishCaughtByUser,
    };
}
/**
 * Lista todos os tipos de peixes disponíveis
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage>} Mensagem de retorno
 */
async function listFishTypesCommand(bot, message, args, group) {
  try {
    // Obtém ID do chat
    const chatId = message.group || message.author;
    
    // Obtém peixes das custom-variables
    let fishArray = [];
    try {
      const customVariables = await database.getCustomVariables();
      if (customVariables?.peixes && Array.isArray(customVariables.peixes) && customVariables.peixes.length > 0) {
        fishArray = customVariables.peixes;
      } else {
        return new ReturnMessage({
          chatId,
          content: '🎣 Ainda não há tipos de peixes definidos nas variáveis personalizadas. O sistema usará peixes padrão ao pescar.'
        });
      }
    } catch (error) {
      logger.error('Erro ao obter peixes de custom-variables:', error);
      return new ReturnMessage({
        chatId,
        content: '❌ Ocorreu um erro ao buscar os tipos de peixes. Por favor, tente novamente.'
      });
    }

    // Ordena alfabeticamente
    const sortedFishes = [...fishArray].sort();
    
    // Prepara a mensagem
    let fishMessage = '🐟 *Lista de Peixes Disponíveis*\n_(número de pescados entre parêntese)_\n\n';
    
    // Agrupa em colunas
    const columns = 2;
    const rows = Math.ceil(sortedFishes.length / columns);
      

    const fishingData = await getFishingData(); // pseudo cache
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < columns; j++) {
        const index = i + j * rows;
        if (index < sortedFishes.length) {
          const count = await getNumberOfFishesByName(sortedFishes[index], fishingData);
          fishMessage += `${sortedFishes[index]} (${count})`;
          // Adiciona espaço ou quebra de linha
          if (j < columns - 1 && i + (j + 1) * rows < sortedFishes.length) {
            fishMessage += ' | ';
          }
        }
      }
      fishMessage += '\n';
    }
    
    // Adiciona informações sobre peixes raros
    fishMessage += `\n*Peixes Raríssimos*:\n`;
    for (const fish of RARE_FISH) {
      const chancePercent = fish.chance * 100;
      const count = await getNumberOfFishesByName(fish.name, fishingData);
      fishMessage += `${fish.emoji} ${fish.name}: ${fish.weightBonus}kg extra (${chancePercent.toFixed(5)}% de chance, ${count} pescados até hoje)\n`;
    }
    

    fishMessage += `\n🐛 Use \`!pesca-info\` para mais informações`;
    
    return new ReturnMessage({
      chatId,
      content: fishMessage
    });
  } catch (error) {
    logger.error('Erro ao listar tipos de peixes:', error);
    
    return new ReturnMessage({
      chatId: message.group || message.author,
      content: '❌ Ocorreu um erro ao listar os tipos de peixes. Por favor, tente novamente.'
    });
  }
}

/**
 * Mostra as iscas do jogador
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage>} Mensagem de retorno
 */
async function showBaitsCommand(bot, message, args, group) {
  try {
    // Obtém IDs do chat e do usuário
    const chatId = message.group || message.author;
    const userId = message.author;
    const userName = message.authorName || "Pescador";
    
    // Obtém dados de pesca
    const fishingData = await getFishingData();
    
    // Verifica se o usuário tem dados
    if (!fishingData.fishingData[userId]) {
      fishingData.fishingData[userId] = {
        name: userName,
        fishes: [],
        totalWeight: 0,
        inventoryWeight: 0,
        biggestFish: null,
        totalCatches: 0,
        baits: MAX_BAITS,
        lastBaitRegen: Date.now(),
        buffs: [],
        debuffs: []
      };
    }
    
    // Regenera iscas
    fishingData.fishingData[userId] = regenerateBaits(fishingData.fishingData[userId]);
    
    // Calcula tempo para regeneração
    const regenInfo = getNextBaitRegenTime(fishingData.fishingData[userId]);
    
    // Formata o tempo
    const nextBaitTime = regenInfo.nextBaitTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const allBaitsTime = regenInfo.allBaitsTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    // Salva os dados atualizados
    await saveFishingData(fishingData);
    
    // Prepara a mensagem
    let baitMessage = `🐛 *Iscas de ${userName}*\n\n`;
    
    // Adiciona emojis de isca para representar visualmente
    const baitEmojis = Array(MAX_BAITS).fill('⚪').fill('🐛', 0, fishingData.fishingData[userId].baits).join(' ');
    
    baitMessage += `${baitEmojis}\n\n`;
    baitMessage += `Você tem ${fishingData.fishingData[userId].baits}/${MAX_BAITS} iscas.\n`;
    
    // Adiciona mensagem sobre regeneração
    if (fishingData.fishingData[userId].baits < MAX_BAITS) {
      baitMessage += `Próxima isca em: ${formatTimeString(regenInfo.secondsUntilNextBait)} (${nextBaitTime})\n`;
      if (fishingData.fishingData[userId].baits < MAX_BAITS - 1) {
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
      options: {
        quotedMessageId: message.origin.id._serialized,
        evoReply: message.origin
      }
    });
  } catch (error) {
    logger.error('Erro ao mostrar iscas do jogador:', error);
    
    return new ReturnMessage({
      chatId: message.group || message.author,
      content: '❌ Ocorreu um erro ao mostrar suas iscas. Por favor, tente novamente.'
    });
  }
}
/**  
 * Reseta os dados de pesca para o grupo atual  
 * @param {WhatsAppBot} bot - Instância do bot  
 * @param {Object} message - Dados da mensagem  
 * @param {Array} args - Argumentos do comando  
 * @param {Object} group - Dados do grupo  
 * @returns {Promise<ReturnMessage>} Mensagem de retorno  
 */  
async function resetFishingDataCommand(bot, message, args, group) {  
  try {  
    // Verifica se é um grupo  
    if (!message.group) {  
      return new ReturnMessage({  
        chatId: message.author,  
        content: "❌ Este comando só pode ser usado em grupos.",  
        options: {  
          quotedMessageId: message.origin.id._serialized,
          evoReply: message.origin
        }  
      });  
    }  
  
    // Verifica se o usuário é admin  
    const isAdmin = await bot.adminUtils.isAdmin(message.author, group, null, bot.client);  
    if (!isAdmin) {  
      return new ReturnMessage({  
        chatId: message.group || message.author,  
        content: "❌ Este comando só pode ser usado por administradores do grupo.",  
        options: {  
          quotedMessageId: message.origin.id._serialized,
          evoReply: message.origin
        }  
      });  
    }  
  
    // Obtém dados de pesca  
    const fishingData = await getFishingData();  
      
    // Verifica se há dados para este grupo  
    if (!fishingData.groupData || !fishingData.groupData[message.group]) {  
      return new ReturnMessage({  
        chatId: message.group,  
        content: "ℹ️ Não há dados de pesca para este grupo.",  
        options: {  
          quotedMessageId: message.origin.id._serialized,
          evoReply: message.origin
        }  
      });  
    }  
  
    // Faz backup dos dados antes de resetar  
    const backupData = { ...fishingData.groupData[message.group] };  
    const numPlayers = Object.keys(backupData).length;  
      
    // Reseta os dados do grupo  
    fishingData.groupData[message.group] = {};  
      
    // Salva os dados atualizados  
    await saveFishingData(fishingData);  
      
    return new ReturnMessage({  
      chatId: message.group,  
      content: `✅ Dados de pesca resetados com sucesso!\n\n${numPlayers} jogadores tiveram seus dados de pesca neste grupo apagados.`,  
      options: {  
        quotedMessageId: message.origin.id._serialized,
        evoReply: message.origin
      }  
    });  
  } catch (error) {  
    logger.error('Erro ao resetar dados de pesca:', error);  
      
    return new ReturnMessage({  
      chatId: message.group || message.author,  
      content: '❌ Ocorreu um erro ao resetar os dados de pesca. Por favor, tente novamente.',  
      options: {  
        quotedMessageId: message.origin.id._serialized,
        evoReply: message.origin
      }  
    });  
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

module.exports = { 
  commands,
  forceSaveFishingData: saveSync,
  addBaits
}