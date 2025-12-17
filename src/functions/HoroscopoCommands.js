const fs = require('fs').promises;
const path = require('path');
const Logger = require('../utils/Logger');
const Command = require('../models/Command');
const ReturnMessage = require('../models/ReturnMessage');
const chrono = require('chrono-node');
const Database = require('../utils/Database');

const database = Database.getInstance();
const logger = new Logger('horoscopo-commands');

let horoscopoWriteQueue = {};
let writeTimeout = null;
const WRITE_DEBOUNCE_MS = 2000; // 2 segundos

/**
 * Escreve a fila de horóscopos em disco de forma assíncrona.
 * Agrupa múltiplas escritas rápidas em uma única operação.
 */
async function flushHoroscopoToFile() {
    const dates = Object.keys(horoscopoWriteQueue);
    if (dates.length === 0) return;

    logger.info(`Iniciando escrita de horóscopos em disco para as datas: ${dates.join(', ')}`);

    // Copia e limpa a fila imediatamente para não perder dados que cheguem durante a escrita
    const queueToProcess = horoscopoWriteQueue;
    horoscopoWriteQueue = {};
    clearTimeout(writeTimeout);
    writeTimeout = null;

    for (const date of dates) {
        const dataToWrite = queueToProcess[date];
        if (!dataToWrite || Object.keys(dataToWrite).length === 0) continue;

        const filePath = path.join(horoscopoDir, `${date}.json`);

        try {
            await fs.mkdir(horoscopoDir, { recursive: true });
            let existingData = {};
            try {
                const currentContent = await fs.readFile(filePath, 'utf8');
                existingData = JSON.parse(currentContent);
            } catch (error) {
                // Arquivo não existe ou é inválido, será sobrescrito
            }

            const mergedData = { ...existingData, ...dataToWrite };

            await fs.writeFile(filePath, JSON.stringify(mergedData, null, 2));
            logger.info(`Sucesso ao escrever ${Object.keys(dataToWrite).length} horóscopo(s) para ${date}`);

        } catch (error) {
            logger.error(`Falha ao escrever horóscopos para a data ${date}:`, error);
            // Opcional: Adicionar lógica para tentar novamente depois
        }
    }
}


const horoscopoDir = path.join(database.databasePath, 'horoscopo');

const signos = {
  'áries': { emoji: '♈', nome: 'Áries' },
  'aries': { emoji: '♈', nome: 'Áries' },
  'touro': { emoji: '♉', nome: 'Touro' },
  'gêmeos': { emoji: '♊', nome: 'Gêmeos' },
  'gemeos': { emoji: '♊', nome: 'Gêmeos' },
  'câncer': { emoji: '♋', nome: 'Câncer' },
  'cancer': { emoji: '♋', nome: 'Câncer' },
  'leão': { emoji: '♌', nome: 'Leão' },
  'leao': { emoji: '♌', nome: 'Leão' },
  'virgem': { emoji: '♍', nome: 'Virgem' },
  'libra': { emoji: '♎', nome: 'Libra' },
  'escorpião': { emoji: '♏', nome: 'Escorpião' },
  'escorpiao': { emoji: '♏', nome: 'Escorpião' },
  'sagitário': { emoji: '♐', nome: 'Sagitário' },
  'sagitario': { emoji: '♐', nome: 'Sagitário' },
  'capricórnio': { emoji: '♑', nome: 'Capricórnio' },
  'capricornio': { emoji: '♑', nome: 'Capricórnio' },
  'aquário': { emoji: '♒', nome: 'Aquário' },
  'aquario': { emoji: '♒', nome: 'Aquário' },
  'peixes': { emoji: '♓', nome: 'Peixes' }
};

const orderedSignos = [
  'áries', 'touro', 'gêmeos', 'câncer', 'leão', 'virgem', 'libra', 'escorpião', 'sagitário', 'capricórnio', 'aquário', 'peixes'
];

/**
 * Normaliza o nome de um signo para uma chave consistente
 * @param {string} signo - Nome do signo a ser normalizado
 * @returns {string|null} - Nome do signo normalizado em minúsculas ou null
 */
function normalizeSigno(signo) {
    if (!signo) return null;
    const normalized = signo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return signos[normalized] ? signos[normalized].nome.toLowerCase() : null;
}

/**
 * Detecta e salva o horóscopo de uma mensagem
 * @param {string} msgBody - Corpo da mensagem
 * @param {string} groupId - ID do grupo
 * @returns {Promise<boolean>} - Se a mensagem foi detectada e salva
 */
async function detectHoroscopo(msgBody, groupId) {
  try {
    const gruposHoroscopo = (process.env.GRUPOS_HOROSCOPOS ?? '').split(',');
    if (gruposHoroscopo.includes(groupId) && gruposHoroscopo.length > 0) {
      logger.info(`Horoscopo detectado em grupo oficial`);
    }

    const horoscopoRegex = /\*.*?\s(?:♈|♉|♊|♋|♌|♍|♎|♏|♐|♑|♒|♓)\s+(Áries|Touro|Gêmeos|Câncer|Leão|Virgem|Libra|Escorpião|Sagitário|Capricórnio|Aquário|Peixes):\*\s+([\s\S]*?)(?:\n\n|$)/i;
    const match = msgBody?.match(horoscopoRegex);

    if (match) {
      const signoNome = match[1];
      const texto = match[2].trim();
      const signoNormalizado = normalizeSigno(signoNome);

      if (signoNormalizado) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const date = `${year}-${month}-${day}`;

        // Adiciona na fila de escrita
        if (!horoscopoWriteQueue[date]) {
          horoscopoWriteQueue[date] = {};
        }
        horoscopoWriteQueue[date][signoNormalizado] = texto;

        // Agenda a escrita em disco
        if (writeTimeout) clearTimeout(writeTimeout);
        writeTimeout = setTimeout(flushHoroscopoToFile, WRITE_DEBOUNCE_MS);

        logger.info(`Horóscopo de ${signoNormalizado} para ${date} adicionado à fila de escrita.`);
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.error('Erro ao detectar horóscopo:', error);
    return false;
  }
}

/**
 * Obtém o horóscopo para um signo e/ou data
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Mensagem recebida
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Objeto do grupo
 * @returns {Promise<ReturnMessage>} - Mensagem de retorno
 */
async function horoscopoCommand(bot, message, args, group) {
  const chatId = message.group ?? message.author;

  try {
    let signoQuery = null;
    let dateExpression = 'hoje';

    if (args.length === 1) {
      // Tenta interpretar o único argumento como data. Se falhar, é um signo.
      const parsedDateAsDate = chrono.pt.parse(args[0], new Date(), { forwardDate: false });
      if (parsedDateAsDate && parsedDateAsDate.length > 0) {
        dateExpression = args[0];
      } else {
        signoQuery = args[0];
      }
    } else if (args.length > 1) {
      signoQuery = args[0];
      dateExpression = args.slice(1).join(' ');
    }

    const parsedDate = chrono.pt.parse(dateExpression, new Date(), { forwardDate: false });
    if (!parsedDate || parsedDate.length === 0) {
      return new ReturnMessage({
        chatId: chatId,
        content: `❌ Data não reconhecida. Tente usar formatos como "hoje", "ontem", "31/10/2025".`,
        options: { quotedMessageId: message.origin.id._serialized, evoReply: message.origin }
      });
    }

    const resultDate = parsedDate[0].start.date();
    const year = resultDate.getFullYear();
    const month = String(resultDate.getMonth() + 1).padStart(2, '0');
    const day = String(resultDate.getDate()).padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    const formattedDate = `${day}/${month}/${year}`;

    const filePath = path.join(horoscopoDir, `${date}.json`);
    let horoscoposDoDia;

    try {
      const data = await fs.readFile(filePath, 'utf8');
      horoscoposDoDia = JSON.parse(data);
    } catch (error) {
      return new ReturnMessage({
        chatId: chatId,
        content: `😴 Nenhum horóscopo encontrado para ${formattedDate}.`,
        options: { quotedMessageId: message.origin.id._serialized, evoReply: message.origin }
      });
    }

    let signoAlvo = normalizeSigno(signoQuery);
    let responseText = `🔮 *Horóscopo para ${formattedDate}*\n\n`;
    let showAll = false;

    if (signoAlvo) {
      const texto = horoscoposDoDia[signoAlvo];
      if (texto) {
        const signoInfo = signos[signoAlvo];
        responseText += `${signoInfo.emoji} *${signoInfo.nome}:* ${texto}`;
      } else {
        responseText += `Não encontrei o horóscopo para *${signoQuery}* nesta data. Mostrando todos os disponíveis:\n\n`;
        showAll = true;
      }
    } else {
      showAll = true;
    }
    
    if (showAll) {
      let foundAny = false;
      for (const nome of orderedSignos) {
        const texto = horoscoposDoDia[nome];
        if (texto) {
          foundAny = true;
          const signoInfo = signos[nome];
          responseText += `${signoInfo.emoji} *${signoInfo.nome}:* ${texto}\n\n`;
        }
      }
      if (!foundAny) {
         return new ReturnMessage({
            chatId: chatId,
            content: `😴 Nenhum horóscopo encontrado para ${formattedDate}.`,
            options: { quotedMessageId: message.origin.id._serialized, evoReply: message.origin }
        });
      }
    }

    return new ReturnMessage({
      chatId: chatId,
      content: responseText.trim(),
      options: { quotedMessageId: message.origin.id._serialized, evoReply: message.origin }
    });

  } catch (error) {
    logger.error('Erro ao executar comando horoscopo:', error);
    return new ReturnMessage({
      chatId: chatId,
      content: '❌ Ocorreu um erro ao buscar o horóscopo.',
      reaction:  "❌"
    });
  }
}

const commands = [
  new Command({
    name: 'horoscopo',
    description: 'Exibe o horóscopo para um signo e/ou data específica.',
    usage: '!horoscopo [signo] [data]',
    category: "utilidades",
    reactions: {
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "✨",
      error: "❌"
    },
    method: horoscopoCommand
  }),
  new Command({
    name: 'horóscopo',
    hidden: true,
    description: 'Exibe o horóscopo para um signo e/ou data específica.',
    usage: '!horoscopo [signo] [data]',
    category: "utilidades",
    reactions: {
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "✨",
      error: "❌"
    },
    method: horoscopoCommand
  }),
  new Command({
    name: 'signo',
    hidden: true,
    description: 'Exibe o horóscopo para um signo e/ou data específica.',
    usage: '!horoscopo [signo] [data]',
    category: "utilidades",
    reactions: {
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "✨",
      error: "❌"
    },
    method: horoscopoCommand
  })
];

module.exports = {
  commands,
  detectHoroscopo
};
