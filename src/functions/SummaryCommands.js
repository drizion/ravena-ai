const fs = require('fs').promises;
const path = require('path');
const Logger = require('../utils/Logger');
const Database = require('../utils/Database');
const LLMService = require('../services/LLMService');
const Command = require('../models/Command');
const ReturnMessage = require('../models/ReturnMessage');

const logger = new Logger('summary-commands');
const database = Database.getInstance();
const llmService = new LLMService({});

// Diretório para armazenar mensagens recentes
const dataDir = path.join(database.databasePath, 'conversations');

// Garante que o diretório exista
fs.mkdir(dataDir, { recursive: true })
  .then(() => {
    logger.info(`Diretório de conversas criado: ${dataDir}`);
  })
  .catch(error => {
    logger.error('Erro ao criar diretório de conversas:', error);
  });

//logger.info('Módulo SummaryCommands carregado');

/**
 * Resume conversa de grupo
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage|Array<ReturnMessage>>} - ReturnMessage com o resumo
 */
async function summarizeConversation(bot, message, args, group) {
  try {
    if (!message.group) {
      return new ReturnMessage({
        chatId: message.author,
        content: 'Este comando só pode ser usado em grupos.'
      });
    }
    
    logger.info(`[${group.id}] Resumindo conversa para o grupo ${message.group}`);
    
    let recentMessages;
    try {
      // Recorre a mensagens armazenadas
      recentMessages = await getRecentMessages(message.group);
    } catch (fetchError) {
      logger.error('Erro ao buscar mensagens do chat:', fetchError);
      recentMessages = [];
    }
    
    if (!recentMessages || recentMessages.length === 0) {
      return new ReturnMessage({
        chatId: message.group,
        content: 'Nenhuma mensagem recente para resumir.'
      });
    }
    
    // Formata mensagens para prompt
    const formattedMessages = formatMessagesForPrompt(recentMessages);
      
    const customPersonalidade = (group.customAIPrompt && group.customAIPrompt.length > 0) ? `\n\n((Sua personalidade: '${group.customAIPrompt}'))\n\n` : "";

    // Cria prompt para LLM
    const prompt = `Abaixo está uma conversa recente de um grupo de WhatsApp. ${customPersonalidade}. Por favor, resuma os principais pontos discutidos de forma concisa:
${formattedMessages}

Resumo:`;
    

    
    // Obtém resumo do LLM
    const summary = await llmService.getCompletion({ prompt: prompt });
    
    if (!summary) {
      return new ReturnMessage({
        chatId: message.group,
        content: 'Falha ao gerar resumo. Por favor, tente novamente.'
      });
    }
    
    // Já que deu certo, limpa o historico
    clearRecentMessages(message.group);

    // Envia o resumo
    return new ReturnMessage({
      chatId: message.group,
      content: `📋 *Resumo da conversa:*\n\n${summary}`
    });
    
    logger.info(`[${group.id}]Resumo de conversa enviado com sucesso para ${message.group}`);
  } catch (error) {
    logger.error('Erro ao resumir conversa:', error);
    return new ReturnMessage({
      chatId: message.group || message.author,
      content: 'Erro ao gerar resumo. Por favor, tente novamente.'
    });
  }
}

/**
 * Gera mensagem interativa baseada na conversa
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage>} - ReturnMessage com a interação gerada
 */
async function interactWithConversation(bot, message, args, group) {
  try {
    if (!message.group) {
      return new ReturnMessage({
        chatId: message.author,
        content: 'Este comando só pode ser usado em grupos.'
      });
    }

    const retornarErro = args[0] ?? true;
    
    logger.info(`[${group.id}][interactWithConversation] Gerando interação para o grupo ${message.group}`);
    
    let recentMessages;
  
    try {
      // Recorre a mensagens armazenadas
      recentMessages = await getRecentMessages(message.group);
    } catch (fetchError) {
      logger.error(`[${group.id}][interactWithConversation] Erro ao buscar mensagens do chat:`, fetchError);
      // Recorre a mensagens armazenadas
      recentMessages = [];
    }

    logger.info(`[${group.id}][interactWithConversation] Mensagens recentes: ${recentMessages.length}`);
    
    if (!recentMessages || recentMessages.length === 0) {
      if(retornarErro){
        return new ReturnMessage({
          chatId: message.group,
          content: 'Nenhuma mensagem recente para interagir.'
        });
      } else {
        return [];

      }
    } 
    
    // Formata mensagens para prompt
    const formattedMessages = formatMessagesForPrompt(recentMessages);

    const customPersonalidade = (group.customAIPrompt && group.customAIPrompt.length > 0) ? `\n\n((Sua personalidade: '${group.customAIPrompt}'))\n\n` : "";
    // Cria prompt para LLM
    const prompt = `Responda apenas em português do brasil. A seguir anexei uma conversa recente de um grupo de WhatsApp. Crie uma única mensagem curta para interagir com o grupo de forma natural, como se você entendesse o assunto e quisesse participar da conversa com algo relevante. Tente usar o mesmo tom e estilo informal que as pessoas estão usando. A mensagem deve ser curta e natural. ${customPersonalidade}

${formattedMessages}`;
    
    logger.info(`[${group.id}][interactWithConversation] Enviando prompt: ${prompt.substring(0, 500)}`);

    // Obtém interação do LLM
    const interaction = await llmService.getCompletion({prompt: prompt});
    
    if (!interaction) {
      if(retornarErro){
        return new ReturnMessage({
          chatId: message.group,
          content: 'Falha ao gerar mensagem. Por favor, tente novamente.'
        });
      } else {
        return [];
      }
    } 
    
    // Verifica se teve mentions
    const llmMentions = interaction.match(/@(\d{8,})/g)?.map(m => m.slice(1)) || [];

    // Envia a mensagem de interação
    if(interaction.includes("Não foi poss") && !retornarErro){
      logger.info(`[${group.id}]Mensagem de interação ignorada pois ocorreu um erro na hora de gerar (${message.group}/'${interaction}')`);
      return [];
    } else {
      logger.info(`[${group.id}]Mensagem de interação enviada com sucesso para ${message.group}`);

      // Já que deu certo, limpa o historico
      clearRecentMessages(message.group);
      
      return new ReturnMessage({
        chatId: message.group,
        content: interaction,
        mentions: llmMentions
      });
    }
    
  } catch (error) {
    logger.error(`[${group.id}] Erro ao gerar interação:`, error);
    if(retornarErro){
      return new ReturnMessage({
        chatId: message.group || message.author,
        content: 'Erro ao gerar mensagem. Por favor, tente novamente.'
      });
    } else {
      return [];
    }
  }
}

/**
 * Armazena uma mensagem no histórico de conversas do grupo
 * @param {Object} message - Os dados da mensagem
 * @param {Object} chatId - Id do grupo
 */
async function storeMessage(message, chatId) {
  try {  
    const conversationFile = path.join(dataDir, `latest-messages-${chatId}.json`);
    
    // Carrega mensagens existentes
    let messages = [];
    try {
      const data = await fs.readFile(conversationFile, 'utf8');
      messages = JSON.parse(data);
    } catch (error) {
      // Arquivo provavelmente não existe ainda, tudo bem
      logger.debug(`Nenhum arquivo de conversa existente para ${chatId}`);
    }
    
    // Adiciona nova mensagem
    let textContent = message.type === 'text' ? message.content : message.caption;

    if(message.type === 'image'){
      // Tenta interpretar a imagem usando Vision AI
      if(message.content){
        const completionOptions = {
          prompt: "Analise a foto e retorne apenas uma sucinta descrição (em pt-BR) do que vê na imagem no formato, máximo 200 caracteres: Imagem[xxxx xxxx xxx]",
          systemContext: `Você é um bot especialista em interpretação de imagens.`,
          image: message.content.data,
          debugPrompt: false
        };

        //logger.info(`[storeMessage] Prompt: `, completionOptions);
        const response = await llmService.getCompletion(completionOptions);


        if(response && !response.includes("Não foi poss") && !response.includes("Ocorreu um erro")){
          textContent = message.caption ? `${response}\nLegenda: ${message.caption}` : response;
          logger.info(`[${chatId}][storeMessage] Imagem interpretada: ${textContent}`);
        }
      }
    }

    if (textContent) {
      // Zap/libs mudam tanto que pode vir de qualquer lugar, é foda, haja fallbacks
      const fromMe = message.evoMessageData?.key?.fromMe ?? message.key?.fromMe ??message.fromMe ??message.origin?.fromMe ?? false;
      const authorName = fromMe ? "Você (bot)" : message.evoMessageData?.pushName ?? message.origin?.pushName ?? message.name ?? message.authorName ?? message.pushname ?? "Desconhecido";

      //logger.info(`[storeMessage] ${authorName}: ${textContent}`);
      messages.push({
        author: authorName,
        text: textContent,
        timestamp: Date.now()
      });
      
      // Mantém apenas as últimas 30 mensagens
      if (messages.length > 30) {
        messages = messages.slice(messages.length - 30);
      }
      
      // Salva mensagens atualizadas
      await fs.writeFile(conversationFile, JSON.stringify(messages, null, 2), 'utf8');
      //logger.debug(`Mensagem armazenada no arquivo de conversa para ${chatId}`);
    }
  } catch (error) {
    logger.error('Erro ao armazenar mensagem:', error);
  }
}

/**
 * Obtém mensagens recentes para um grupo
 * @param {string} chatId - O ID do grupo
 * @returns {Promise<Array>} - Array de objetos de mensagem
 */
async function getRecentMessages(chatId) {
  try {
    const conversationFile = path.join(dataDir, `latest-messages-${chatId}.json`);
    
    // Carrega mensagens existentes
    try {
      const data = await fs.readFile(conversationFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.debug(`Nenhum arquivo de conversa existente para ${chatId}`);
      return [];
    }
  } catch (error) {
    logger.error('Erro ao obter mensagens recentes:', error);
    return [];
  }
}

/**
 * Limpar as mensagens recentes para um grupo
 * @param {string} chatId - O ID do grupo
 * @returns {Promise<Bool>} - Se deu certo ou não
 */
async function clearRecentMessages(chatId) {
  try {
    const conversationFile = path.join(dataDir, `latest-messages-${chatId}.json`);
    
    // Carrega mensagens existentes
    try {
      await fs.writeFile(conversationFile, "[]", 'utf8');
      return true;
    } catch (error) {
      logger.debug(`Nenhum arquivo de conversa existente para ${chatId}`);
      return true;
    }
  } catch (error) {
    logger.error('Erro ao limpar mensagens recentes:', error);
    returnfalse;
  }
}

/**
 * Formata mensagens para prompt do LLM
 * @param {Array} messages - Array de objetos de mensagem
 * @returns {string} - String de mensagens formatada
 */
function formatMessagesForPrompt(messages) {
  return messages.map(msg => `${msg.author}: ${msg.text}`).join('\n');
}


// Lista de comandos usando a classe Command
const commands = [
  new Command({
    name: 'resumo',
    description: 'Resume conversas recentes do grupo',
    category: 'ia',
    reactions: {
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "📋"
    },
    method: summarizeConversation
  }),
  
  new Command({
    name: 'interagir',
    description: 'Gera uma mensagem interativa baseada na conversa',
    category: 'ia',
    reactions: {
      trigger: "🦜",
      before: process.env.LOADING_EMOJI ?? "🌀",
      after: "💬"
    },
    method: interactWithConversation
  })
];

// Exporta as funções de histórico de conversa para serem usadas no EventHandler e outros
module.exports.storeMessage = storeMessage;
module.exports.getRecentMessages = getRecentMessages;
module.exports.clearRecentMessages = clearRecentMessages;
module.exports.formatMessagesForPrompt = formatMessagesForPrompt;

// Exporta comandos
module.exports.commands = commands