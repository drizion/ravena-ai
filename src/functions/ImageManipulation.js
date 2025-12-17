const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const imagemagick = require('imagemagick');
const util = require('util');
const Logger = require('../utils/Logger');
const Command = require('../models/Command');
const ReturnMessage = require('../models/ReturnMessage');

const execPromise = util.promisify(exec);
const logger = new Logger('image-commands');

// Encapsule os comandos do imagemagick em promessas
const convertPromise = util.promisify(imagemagick.convert);
const identifyPromise = util.promisify(imagemagick.identify);

// Diretório temporário para processamento
const tempDir = path.join(__dirname, '../../temp', 'whatsapp-bot-images');


// Garante que o diretório temporário exista
fs.mkdir(tempDir, { recursive: true })
  .then(() => {
    logger.info(`Diretório temporário criado: ${tempDir}`);
  })
  .catch(error => {
    logger.error('Erro ao criar diretório temporário:', error);
  });

// Auxiliar para obter mídia da mensagem
function getMediaFromMessage(message) {
  return new Promise((resolve, reject) => {
    // Se a mensagem tem mídia direta
    if (message.type !== 'text') {
      resolve(message.content);
      return;
    }
    
    // Tenta obter mídia da mensagem citada
    message.origin.getQuotedMessage()
      .then(quotedMsg => {
        if (quotedMsg && quotedMsg.hasMedia) {
          return quotedMsg.downloadMedia();
        }
        resolve(null);
      })
      .then(media => {
        if (media) resolve(media);
      })
      .catch(error => {
        logger.error('Erro ao obter mídia da mensagem citada:', error);
        resolve(null);
      });
  });
}

// Auxiliar para salvar mídia em arquivo temporário
function saveMediaToTemp(media, extension = 'png') {
  const filename = `${uuidv4()}.${extension}`;
  const filepath = path.join(tempDir, filename);
  
  return fs.writeFile(filepath, Buffer.from(media.data, 'base64'))
    .then(() => filepath)
    .catch(error => {
      logger.error('Erro ao salvar mídia em arquivo temporário:', error);
      throw error;
    });
}

// Auxiliar para remover fundo usando backgroundremover
function removeBackground(inputPath) {
  const outputPath = inputPath.replace(/\.[^/.]+$/, '') + '_nobg.png';
  
  // Executa backgroundremover usando Python com Promise
  return execPromise(`backgroundremover -i "${inputPath}" -o "${outputPath}"`)
    .then(() => outputPath)
    .catch(error => {
      logger.error('Erro ao remover fundo:', error);
      throw error;
    });
}

// Auxiliar para recortar imagem usando sharp
function trimImage(inputPath) {
  const outputPath = inputPath.replace(/\.[^/.]+$/, '') + '_trimmed.png';
  
  return sharp(inputPath)
    .trim()
    .toFile(outputPath)
    .then(() => outputPath)
    .catch(error => {
      logger.error('Erro ao recortar imagem:', error);
      throw error;
    });
}

// Auxiliar para aplicar distorção usando ImageMagick
function distortImage(inputPath, intensity = 50) {
  // Limita intensidade entre 30 e 70
  intensity = Math.max(30, Math.min(70, intensity));
  
  const outputPath = inputPath.replace(/\.[^/.]+$/, '') + '_distorted.png';
  
  // Aplica efeito de redimensionamento líquido
  return convertPromise([
    inputPath,
    '-liquid-rescale', `${intensity}x${intensity}%!`,
    '-resize', '200%',
    outputPath
  ])
    .then(() => outputPath)
    .catch(error => {
      logger.error('Erro ao distorcer imagem:', error);
      throw error;
    });
}

// Auxiliar para aplicar efeitos artísticos usando ImageMagick
function applyArtistic(inputPath, effect) {
  const outputPath = inputPath.replace(/\.[^/.]+$/, '') + `_${effect}.png`;
  
  let convertArgs;
  
  switch (effect) {
    case 'sketch':
      convertArgs = [
        inputPath,
        '-colorspace', 'gray',
        '-sketch', '0x20+120',
        outputPath
      ];
      break;
    
    case 'oil':
      convertArgs = [
        inputPath,
        '-paint', '6',
        outputPath
      ];
      break;
    
    case 'neon':
      convertArgs = [
        inputPath,
        '-negate',
        '-edge', '2',
        '-negate',
        '-normalize',
        '-channel', 'RGB',
        '-blur', '0x.5',
        '-colorspace', 'sRGB',
        outputPath
      ];
      break;
      
    case 'pixelate':
      convertArgs = [
        inputPath,
        '-scale', '10%',
        '-scale', '1000%',
        outputPath
      ];
      break;
    
    default:
      return Promise.reject(new Error(`Efeito desconhecido: ${effect}`));
  }
  
  return convertPromise(convertArgs)
    .then(() => outputPath)
    .catch(error => {
      logger.error(`Erro ao aplicar efeito ${effect}:`, error);
      throw error;
    });
}

// Limpa arquivos temporários
function cleanupTempFiles(files) {
  return Promise.all(
    files.map(file => 
      fs.unlink(file).catch(error => {
        logger.error(`Erro ao excluir arquivo temporário ${file}:`, error);
      })
    )
  );
}

/**
 * Remove o fundo de uma imagem
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage|Array<ReturnMessage>>} - ReturnMessage ou array de ReturnMessage
 */
async function handleRemoveBg(bot, message, args, group) {
  const chatId = message.group ?? message.author;
  const returnMessages = [];
  
  // Cadeia de promessas sem bloqueio
  try {
    const media = await getMediaFromMessage(message);
    if (!media) {
      // Aplica reação de erro
      try {
        await message.origin.react("❌");
      } catch (reactError) {
        logger.error('Erro ao aplicar reação de erro:', reactError);
      }
      
      return new ReturnMessage({
        chatId: chatId,
        content: 'Por favor, forneça uma imagem ou responda a uma imagem com este comando.'
      });
    }
    
    const inputPath = await saveMediaToTemp(media);
    logger.debug(`Imagem de entrada salva em ${inputPath}`);
    
    // Armazena caminhos para limpeza
    const filePaths = [inputPath];
    
    // Processa imagem com cadeia de promessas
    const noBgPath = await removeBackground(inputPath);
    logger.debug(`Fundo removido, salvo em ${noBgPath}`);
    filePaths.push(noBgPath);
    
    const trimmedPath = await trimImage(noBgPath);
    logger.debug(`Imagem recortada, salva em ${trimmedPath}`);
    filePaths.push(trimmedPath);
    
    const resultMedia = await bot.createMedia(trimmedPath);
    
    // Limpa arquivos após envio
    cleanupTempFiles(filePaths).catch(error => {
      logger.error('Erro ao limpar arquivos temporários:', error);
    });
    
    return new ReturnMessage({
      chatId: chatId,
      content: resultMedia,
      options: {
        caption: 'Fundo removido e salvo como arquivo',
        sendMediaAsDocument: true, // Envia como arquivo em vez de imagem
        quotedMessageId: message.origin.id._serialized,
        evoReply: message.origin
      }
    });
  } catch (error) {
    logger.error('Erro no comando removebg:', error);
    
    // Aplica reação de erro
    try {
      await message.origin.react("❌");
    } catch (reactError) {
      logger.error('Erro ao aplicar reação de erro:', reactError);
    }
    
    return new ReturnMessage({
      chatId: chatId,
      content: 'Erro ao processar imagem. Certifique-se de que a imagem é válida e tente novamente.'
    });
  }
}

/**
 * Aplica efeito de distorção a uma imagem
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage|Array<ReturnMessage>>} - ReturnMessage ou array de ReturnMessage
 */
async function handleDistort(bot, message, args, group) {
  const chatId = message.group ?? message.author;
  
  // Obtém intensidade dos args se fornecida
  let intensity = 50; // Padrão
  if (args.length > 0 && !isNaN(args[0])) {
    intensity = Math.max(30, Math.min(70, parseInt(args[0])));
  }
  
  try {
    const media = await getMediaFromMessage(message);
    if (!media) {
      // Aplica reação de erro
      try {
        await message.origin.react("❌");
      } catch (reactError) {
        logger.error('Erro ao aplicar reação de erro:', reactError);
      }
      
      return new ReturnMessage({
        chatId: chatId,
        content: 'Por favor, forneça uma imagem ou responda a uma imagem com este comando.'
      });
    }
    
    const inputPath = await saveMediaToTemp(media);
    logger.debug(`Imagem de entrada salva em ${inputPath}`);
    
    // Armazena caminhos para limpeza
    const filePaths = [inputPath];
    
    // Processa imagem com distorção
    const distortedPath = await distortImage(inputPath, intensity);
    logger.debug(`Distorção aplicada, salva em ${distortedPath}`);
    filePaths.push(distortedPath);
    
    const resultMedia = await bot.createMedia(distortedPath);
    
    // Limpa arquivos após obter a mídia processada
    cleanupTempFiles(filePaths).catch(error => {
      logger.error('Erro ao limpar arquivos temporários:', error);
    });
    
    return new ReturnMessage({
      chatId: chatId,
      content: resultMedia,
      options: {
        caption: `Distorção aplicada (intensidade: ${intensity}%)`,
        quotedMessageId: message.origin.id._serialized,
        evoReply: message.origin
      }
    });
  } catch (error) {
    logger.error('Erro no comando distort:', error);
    
    // Aplica reação de erro
    try {
      await message.origin.react("❌");
    } catch (reactError) {
      logger.error('Erro ao aplicar reação de erro:', reactError);
    }
    
    return new ReturnMessage({
      chatId: chatId,
      content: 'Erro ao processar imagem. Certifique-se de que a imagem é válida e tente novamente.'
    });
  }
}

/**
 * Cria um sticker após remover o fundo
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage|Array<ReturnMessage>>} - ReturnMessage ou array de ReturnMessage
 */
async function handleStickerBg(bot, message, args, group) {
  const chatId = message.group ?? message.author;
  
  try {
    const media = await getMediaFromMessage(message);
    if (!media) {
      // Aplica reação de erro
      try {
        await message.origin.react("❌");
      } catch (reactError) {
        logger.error('Erro ao aplicar reação de erro:', reactError);
      }
      
      return new ReturnMessage({
        chatId: chatId,
        content: 'Por favor, forneça uma imagem ou responda a uma imagem com este comando.'
      });
    }
    
    const inputPath = await saveMediaToTemp(media);
    logger.debug(`Imagem de entrada salva em ${inputPath}`);
    
    // Armazena caminhos para limpeza
    const filePaths = [inputPath];
    
    // Processa imagem com remoção de fundo e recorte
    const noBgPath = await removeBackground(inputPath);
    logger.debug(`Fundo removido, salvo em ${noBgPath}`);
    filePaths.push(noBgPath);
    
    const trimmedPath = await trimImage(noBgPath);
    logger.debug(`Imagem recortada, salva em ${trimmedPath}`);
    filePaths.push(trimmedPath);
    
    const resultMedia = await bot.createMedia(trimmedPath);
    
    // Extrai nome do sticker dos args ou usa nome do grupo
    const stickerName = args.length > 0 ? args.join(' ') : (group ? group.name : 'sticker');
    
    // Limpa arquivos temporários
    cleanupTempFiles(filePaths).catch(error => {
      logger.error('Erro ao limpar arquivos temporários:', error);
    });
    
    return new ReturnMessage({
      chatId: chatId,
      content: resultMedia,
      options: {
        sendMediaAsSticker: true,
        stickerAuthor: "ravena",
        stickerName: stickerName,
        quotedMessageId: message.origin.id._serialized,
        evoReply: message.origin
      }
    });
  } catch (error) {
    logger.error('Erro no comando stickerbg:', error);
    
    // Aplica reação de erro
    try {
      await message.origin.react("❌");
    } catch (reactError) {
      logger.error('Erro ao aplicar reação de erro:', reactError);
    }
    
    return new ReturnMessage({
      chatId: chatId,
      content: 'Erro ao processar imagem. Certifique-se de que a imagem é válida e tente novamente.'
    });
  }
}

/**
 * Aplica um efeito artístico a uma imagem
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @param {string} effect - Nome do efeito a ser aplicado
 * @returns {Promise<ReturnMessage|Array<ReturnMessage>>} - ReturnMessage ou array de ReturnMessage
 */
async function handleArtisticEffect(bot, message, args, group, effect) {
  const chatId = message.group ?? message.author;
  
  try {
    const media = await getMediaFromMessage(message);
    if (!media) {
      // Aplica reação de erro
      try {
        await message.origin.react("❌");
      } catch (reactError) {
        logger.error('Erro ao aplicar reação de erro:', reactError);
      }
      
      return new ReturnMessage({
        chatId: chatId,
        content: 'Por favor, forneça uma imagem ou responda a uma imagem com este comando.'
      });
    }
    
    const inputPath = await saveMediaToTemp(media);
    logger.debug(`Imagem de entrada salva em ${inputPath}`);
    
    // Armazena caminhos para limpeza
    const filePaths = [inputPath];
    
    // Aplica efeito artístico
    const effectPath = await applyArtistic(inputPath, effect);
    logger.debug(`Efeito ${effect} aplicado, salvo em ${effectPath}`);
    filePaths.push(effectPath);
    
    const resultMedia = await bot.createMedia(effectPath);
    
    // Limpa arquivos temporários
    cleanupTempFiles(filePaths).catch(error => {
      logger.error('Erro ao limpar arquivos temporários:', error);
    });
    
    return new ReturnMessage({
      chatId: chatId,
      content: resultMedia,
      options: {
        caption: `Efeito ${effect} aplicado`,
        quotedMessageId: message.origin.id._serialized,
        evoReply: message.origin
      }
    });
  } catch (error) {
    logger.error(`Erro no comando ${effect}:`, error);
    
    // Aplica reação de erro
    try {
      await message.origin.react("❌");
    } catch (reactError) {
      logger.error('Erro ao aplicar reação de erro:', reactError);
    }
    
    return new ReturnMessage({
      chatId: chatId,
      content: 'Erro ao processar imagem. Certifique-se de que a imagem é válida e tente novamente.'
    });
  }
}

// Comandos usando a classe Command
const commands = [
  new Command({
    name: 'removebg',
    description: 'Remove o fundo de uma imagem',
    category: "midia",
    group: "rremovebg",
    needsMedia: true,
    reactions: {
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "🔪",
      error: "❌"
    },
    method: handleRemoveBg
  }),
  
  new Command({
    name: 'distort',
    description: 'Aplica efeito de distorção a uma imagem',
    category: "midia",
    group: "imageEffect",
    needsMedia: true,
    reactions: {
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "🌀",
      error: "❌"
    },
    method: handleDistort
  }),
  
  new Command({
    name: 'stickerbg',
    description: 'Cria um sticker após remover o fundo',
    category: "midia",
    group: "stickerbg",
    aliases: ['sbg'],
    needsMedia: true,
    reactions: {
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "🔪",
      error: "❌"
    },
    method: handleStickerBg
  }),
  new Command({
    name: 'sbg',
    description: 'Envia sticker sem fundo',
    category: "midia",
    group: "stickerbg",
    needsMedia: true,
    reactions: {
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "🔪",
      error: "❌"
    },
    method: handleStickerBg
  }),
  new Command({
    name: 'rbg',
    description: 'Remove fundo de imagem e envia o PNG',
    category: "midia",
    group: "rremovebg",
    needsMedia: true,
    reactions: {
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "🔪",
      error: "❌"
    },
    method: handleRemoveBg
  })
];

// Adiciona comandos para efeitos artísticos
['sketch', 'oil', 'neon', 'pixelate'].forEach(effect => {
  commands.push(
    new Command({
      name: effect,
      description: `Aplica efeito ${effect} a uma imagem`,
      category: "midia",
      group: "imageEffect",
      needsMedia: true,
      reactions: {
        before: process.env.LOADING_EMOJI ?? "🌀",
        after: "🎨",
        error: "❌"
      },
      method: async (bot, message, args, group) => {
        return await handleArtisticEffect(bot, message, args, group, effect);
      }
    })
  );
});

// Adiciona alias para stickerbg -> sbg

// Registra os comandos sendo exportados
logger.info(`Módulo ImageManipulation carregado. Exportados ${commands.length} comandos.`);

module.exports = { commands };