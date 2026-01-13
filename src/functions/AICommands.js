const path = require('path');
const fs = require('fs').promises;
const Logger = require('../utils/Logger');
const { getRecentMessages, formatMessagesForPrompt, storeMessage } = require('./SummaryCommands');
const LLMService = require('../services/LLMService');
const ReturnMessage = require('../models/ReturnMessage');
const Command = require('../models/Command');
const Database = require('../utils/Database');
const { extractFrames } = require('../utils/Conversions');


const logger = new Logger('ai-commands');

const llmService = new LLMService({});
const database = Database.getInstance();

async function aiCommand(bot, message, args, group) {
  const chatId = message.group ?? message.author;

  // Contexto e descrição do bot
  const ctxPath = path.join(database.databasePath, 'textos', 'llm_context.txt');
  let ctxContent = await fs.readFile(ctxPath, 'utf8');

  const fixedCommands = bot.eventHandler.commandHandler.fixedCommands.getAllCommands();
  const managementCommands = bot.eventHandler.commandHandler.management.getManagementCommands();

  let cmdSimpleList = "";
  let cmdGerenciaSimplesList = "";

  for(let cmd of fixedCommands){
    if(cmd.description && cmd.description.length > 0 && !cmd.description.toLowerCase().includes("alias") && !cmd.hidden){
      const usage = cmd.usage ? ` | Uso: ${cmd.usage}`: "";
      cmdSimpleList += `- ${bot.prefix}${cmd.name}: ${cmd.description}${usage}\n`;
    }
  }
  for(let cmd in managementCommands){
    const desc = managementCommands[cmd].description;
    cmdGerenciaSimplesList += `- ${bot.prefix}g-${cmd}: ${desc}\n`;
  }

  const variaveisReturn = await bot.eventHandler.commandHandler.management.listVariables(bot, message, args, group);
  const variaveisList = variaveisReturn.content;


  let historicoCtx = "";
  const msgsRecentes = (await getRecentMessages(chatId)).slice(0,15);

  logger.debug(`[aiCommand] ${msgsRecentes.length} msgs recentes com ${chatId}`);
  if(msgsRecentes.length > 0){
    historicoCtx = `\n\nContexto das últimas mensagens deste chat: ---------------\n${formatMessagesForPrompt(msgsRecentes)}\n---------------\n`;
  }
  ctxContent += `\n\n## Comandos que você pode processar:\n\n${cmdSimpleList}\n\nPara os comandos personalizados criados com g-addCmd, você pode usar variáveis:\n${variaveisList}\n\nEstes são os comandos usados apenas por administradores para gerenciarem seus grupos: ${cmdGerenciaSimplesList}\n\nSempre que for informar uma variável em um comando, use {} para encapsular ela, como {titulo}, {pessoa}. Quando o comando de gerencia pedir mídia, o comando deve ser enviado na legenda da foto/vídeo ou em resposta (reply) à mensagem que contém midia.\n\n**IMPORTANTE: Lembre o usuário que com o comando !g-painel algumas configurações do gerenciar são ((muito)) mais fáceis de fazer, como mensagem de boas vindas e canais da twitch/youtube**\n\n${historicoCtx}`;
  
  const customPersonalidade = (group?.customAIPrompt && group?.customAIPrompt?.length > 0) ? `\n\n((Sua personalidade: '${group.customAIPrompt}'))\n\n` : "";

  if(customPersonalidade.length > 0){
    logger.info(`[aiCommand][${group.name}] Personalidade custom: ${group.customAIPrompt}`);
    ctxContent += customPersonalidade;
  }

  ctxContent += "\n((Não se apresente, a não ser que o usuário solicite informações sobre você))";
  
  let question = (args.length > 0) ? args.join(" ") : (message.caption ?? message.content);
  const quotedMsg = await message.origin.getQuotedMessage();
  if(quotedMsg){
    // Tem mensagem marcada, junta o conteudo (menos que tenha vindo de reação)
    if(!message.originReaction){
      const quotedText = quotedMsg.caption ?? quotedMsg.content ?? quotedMsg.body;

      if(quotedText.length > 10){
        question += `\n\n${quotedText}`;
      }
    }
  }

  const media = await getMediaFromMessage(message);
  if (!media && question.length < 5) {
    // Envia o greeting se o PV estiver com IA habilitado
    if(bot.pvAI){
      const greetingPath = path.join(database.databasePath, 'textos', 'bot-greeting.txt');
      let greetingContent = await fs.readFile(greetingPath, 'utf8') ?? "Oi, eu sou a ravenabot!";
      
      return new ReturnMessage({
        chatId: chatId,
        content: greetingContent,
        reaction: "👋",
        options: {
          quotedMessageId: message.origin.id._serialized,
          evoReply: message.origin
        }
      });
    } else {
      return new ReturnMessage({
        chatId: chatId,
        content: 'Por favor, forneça uma pergunta ou uma imagem com uma pergunta. Exemplo: !ai Qual é a capital da França?',
        options: {
          quotedMessageId: message.origin.id._serialized,
          evoReply: message.origin
        }
      });
    }
  }
  

  const completionOptions = {
    prompt: question,
    systemContext: ctxContent
  };

  let tempPathsToRemove = [];
  let tipoMedia = false;
  if (media && media.data) {
    logger.debug(`[aiCommand] Comando AI com mídia detectada: ${media.mimetype}`);
    if(media.mimetype.includes("image")){
      tipoMedia = "Imagem";

      if(completionOptions.prompt.length < 4){
        completionOptions.prompt = "Analise esta imagem e entregue um resumo detalhado"
      }

      //completionOptions.provider = 'lmstudio';
      completionOptions.image = media.data;
      
      // Quando interpretar imagens, usar um contexto diferente
      const ctxPath = path.join(database.databasePath, 'textos', 'llm_context_images.txt');
      completionOptions.systemContext = await fs.readFile(ctxPath, 'utf8') ?? "Você se chama ravenabot e deve inter esta imagem enviada no WhatsApp";
      completionOptions.systemContext += customPersonalidade;
    } else if (media.mimetype.includes("video")) {
      tipoMedia = "Video";
      if(completionOptions.prompt.length < 4){
        completionOptions.prompt = "Analise este vídeo e entregue um resumo detalhado do que acontece nele"
      }

      try {
        const tempDirBase = path.join(__dirname, '../../temp');
        const tempDir = path.join(tempDirBase, `ai_video_${Date.now()}`);
        const videoPath = path.join(tempDirBase, `ai_video_${Date.now()}.mp4`);
        
        await fs.mkdir(tempDirBase, { recursive: true });
        await fs.writeFile(videoPath, Buffer.from(media.data, 'base64'));
        
        tempPathsToRemove.push(videoPath);
        tempPathsToRemove.push(tempDir);

        const framePaths = await extractFrames(videoPath, tempDir, 75);
        const frames = [];
        for (const filePath of framePaths) {
          const data = await fs.readFile(filePath, 'base64');
          frames.push(data);
        }

        completionOptions.images = frames;
        completionOptions.timeout = 60000;
        
        // Contexto para vídeo (pode ser o mesmo de imagem ou adaptado)
        const ctxPath = path.join(database.databasePath, 'textos', 'llm_context_videos.txt'); // Reutilizando contexto de imagens por enquanto
        completionOptions.systemContext = await fs.readFile(ctxPath, 'utf8') ?? "Você se chama ravenabot e deve interpretar este vídeo enviado no WhatsApp";
        completionOptions.systemContext += customPersonalidade;

      } catch (videoError) {
        logger.error('[aiCommand] Erro ao processar vídeo:', videoError);
        return new ReturnMessage({
          chatId: chatId,
          content: `Ocorreu um erro ao processar o vídeo: ${videoError.message}`,
          options: { quotedMessageId: message.origin.id._serialized, evoReply: message.origin }
        });
      }

    } else {
      return new ReturnMessage({
        chatId: chatId,
        content: `Ainda não processo este tipo de arquivo (${media.mimetype}) 😟 Consigo apenas analisar imagens e vídeos!`,
        options: {
          quotedMessageId: message.origin.id._serialized,
          evoReply: message.origin
        }
      });
    }
  }

  const promptAutor = message?.evoMessageData?.key?.pushName ?? message?.name ?? message?.authorName ?? message?.pushname;
  if(promptAutor){
    completionOptions.systemContext = `Nome de quem enviou o prompt: ${promptAutor}\n\n`+ completionOptions.systemContext;
  }
  

  // Obtém resposta da IA
  try {
    logger.debug('[aiCommand] Tentando obter resposta do LLM', JSON.stringify(completionOptions).substring(0, 150));
    const response = await llmService.getCompletion(completionOptions);
    
    logger.debug('[aiCommand] Resposta LLM obtida, processando variaveis', response);


    // Guarda também no historico
    if(tipoMedia){
      message.content = `${tipoMedia}[${response}]`;
      message.caption = `${tipoMedia}[${response}]`;
      storeMessage(message, message.author);
    }


    let processedResponse;
    try{
      processedResponse = await bot.eventHandler.commandHandler.variableProcessor.process(response, {message, group, command: false, options: {}, bot });
    } catch(e){
      processedResponse = response;
    }
    
    // Retorna a resposta da IA
    return new ReturnMessage({
      chatId: chatId,
      content: processedResponse,
      options: {
        quotedMessageId: message.origin.id._serialized,
        evoReply: message.origin
      }
    });
  } catch (error) {
    logger.error('[aiCommand] Erro ao obter completação LLM:', error);
    return new ReturnMessage({
      chatId: chatId,
      content: 'Desculpe, encontrei um erro ao processar sua solicitação.',
      options: {
        quotedMessageId: message.origin.id._serialized,
        evoReply: message.origin
      }
    });
  } finally {
    // Limpeza de arquivos temporários de vídeo
    for (const pathToRemove of tempPathsToRemove) {
      try {
        const stats = await fs.stat(pathToRemove);
        if (stats.isDirectory()) {
          await fs.rm(pathToRemove, { recursive: true, force: true });
        } else {
          await fs.unlink(pathToRemove);
        }
      } catch (cleanupError) {
        logger.error(`[aiCommand] Erro ao limpar arquivo temporário ${pathToRemove}:`, cleanupError);
      }
    }
  }
}

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

const commands = [
  new Command({
    name: 'ai',
    description: 'Pergunte algo à IA',
    category: "ia",
    group: "askia",
    reactions: {
      trigger: "🤖",
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "🤖"
    },
    cooldown: 5,
    method: aiCommand
  }),
  new Command({
    name: 'ia',
    description: 'Alias para AI',
    category: "ia",
    group: "askia",
    reactions: {
      trigger: "🤖",
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "🤖"
    },
    cooldown: 5,
    method: aiCommand
  }), 
  new Command({
    name: 'gpt',
    hidden: true,
    description: 'Alias para AI',
    category: "ia",
    group: "askia",
    reactions: {
      trigger: "🤖",
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "🤖"
    },
    cooldown: 5,
    method: aiCommand
  }), 
  new Command({
    name: 'gemini',
    hidden: true,
    description: 'Alias para AI',
    category: "ia",
    group: "askia",
    reactions: {
      trigger: "🤖",
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "🤖"
    },
    cooldown: 5,
    method: aiCommand
  })
];

module.exports = { commands, aiCommand };