const path = require('path');
const Logger = require('../utils/Logger');
const ReturnMessage = require('../models/ReturnMessage');
const Command = require('../models/Command');
const Database = require('../utils/Database');
const fs = require('fs');

const logger = new Logger('anonymous-message');
const database = Database.getInstance();

const LLMService = require('../services/LLMService');
const llmService = new LLMService({});

// Constantes
const COOLDOWN_HOURS = 2;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000; // Cooldown em milissegundos

// Caminho para o arquivo de mensagens anônimas
const ANON_MSGS_PATH = path.join(database.databasePath, 'anon-msgs.json');

/**
 * Obtém as mensagens anônimas armazenadas
 * @returns {Array} - Lista de mensagens anônimas
 */
function getAnonMessages() {
  try {
    if (!fs.existsSync(ANON_MSGS_PATH)) {
      // Se o arquivo não existir, cria com um array vazio
      fs.writeFileSync(ANON_MSGS_PATH, JSON.stringify([], null, 2), 'utf8');
      return [];
    }
    
    const data = fs.readFileSync(ANON_MSGS_PATH, 'utf8');
    return JSON.parse(data ?? '[]');
  } catch (error) {
    logger.error('Erro ao carregar mensagens anônimas:', error);
    return [];
  }
}

/**
 * Salva as mensagens anônimas no arquivo
 * @param {Array} messages - Lista de mensagens anônimas
 * @returns {boolean} - Status de sucesso
 */
function saveAnonMessages(messages) {
  try {
    // Limita o histórico a 100 mensagens, mantendo as mais recentes
    if (messages.length > 100) {
      messages = messages.slice(-100);
    }
    
    // Cria diretório se não existir
    const dir = path.dirname(ANON_MSGS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Use sistema de escrita segura
    const tempFilePath = `${ANON_MSGS_PATH}.temp`;
    fs.writeFileSync(tempFilePath, JSON.stringify(messages, null, 2), 'utf8');
    
    // Verifica se a escrita foi bem-sucedida
    try {
      const testRead = fs.readFileSync(tempFilePath, 'utf8');
      JSON.parse(testRead); // Verifica se é JSON válido
    } catch (readError) {
      logger.error(`Erro na verificação do arquivo temporário:`, readError);
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      return false;
    }
    
    // Renomeia o arquivo temporário para o arquivo final
    if (fs.existsSync(ANON_MSGS_PATH)) {
      fs.unlinkSync(ANON_MSGS_PATH);
    }
    fs.renameSync(tempFilePath, ANON_MSGS_PATH);
    
    return true;
  } catch (error) {
    logger.error('Erro ao salvar mensagens anônimas:', error);
    return false;
  }
}

/**
 * Verifica o cooldown de um usuário
 * @param {string} userId - ID do usuário
 * @returns {object} - Objeto com status e tempo restante em horas
 */
function checkUserCooldown(userId, targetGroup) {
  const messages = getAnonMessages();
  const now = Date.now();
  
  // Encontra a mensagem mais recente do usuário
  const lastMessage = messages
    .filter(msg => msg.senderId === userId && msg.targetGroupName.toLowerCase() === targetGroup.toLowerCase())
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  
  if (!lastMessage) {
    return { onCooldown: false, timeLeft: 0 };
  }
  
  const timeSinceLastMessage = now - lastMessage.timestamp;
  
  if (timeSinceLastMessage < COOLDOWN_MS) {
    const timeLeft = Math.ceil((COOLDOWN_MS - timeSinceLastMessage) / (1000 * 60 * 60));
    return { onCooldown: true, timeLeft };
  }
  
  return { onCooldown: false, timeLeft: 0 };
}

function cleanId(id){
  return id.split('@')[0].split(':')[0];
}

/**
 * Envia uma mensagem anônima para um grupo
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @param {Object} group - Dados do grupo
 * @returns {Promise<ReturnMessage>} Mensagem de retorno
 */
async function anonymousMessage(bot, message, args, group) {
  try {
    //logger.debug(`[anonymousMessage] `, {message, group, args});
    // Verifica o ID do remetente
    const senderIds = [cleanId(message.author), cleanId(message?.origin?.key?.remoteJidAlt ?? "-"), cleanId(message?.origin?.key?.remoteJid ?? "-"), cleanId(message?.origin?.Info?.SenderAlt ?? "-"), cleanId(message?.origin?.Info?.Sender ?? "-")];
    
    // Verifica se há argumentos suficientes
    if (args.length < 2) {
      return new ReturnMessage({
        chatId: senderIds[0],
        content: `⚠️ Formato incorreto. Use: !anonimo ${group?.name ?? "nomegrupo"} mensagem\n\nExemplo: !anonimo ${group?.name ?? "nomegrupo"} Olá, esta é uma mensagem anônima!\n\nOpcionalmente, você pode colocar a palavra 'original' no início da sua frase para que o bot não anonimize a mensagem.\nExemplo: !anonimo ${group?.name ?? "nomegrupo"} original Minha mensagem anônima na íntegra`
      });
    }
    
    // Obtém o ID do grupo alvo
    const targetGroupName = args[0].toLowerCase();

    
    // Verifica cooldown
    const cooldownCheck = checkUserCooldown(senderIds[0], targetGroupName);
    if (cooldownCheck.onCooldown) {
      return new ReturnMessage({
        chatId: senderIds[0],
        content: `🌀 Você precisa esperar ${cooldownCheck.timeLeft} hora(s) para enviar outra mensagem anônima.`
      });
    }
    
    // Obtém a mensagem a ser enviada
    let anonymousText = args.slice(1).join(' ');
    let anonimize = false; // Muito ruim
    if(args[1].toLowerCase() === "original"){ // Se a primeira palavra for 'original', não anonimiza com LLM
      anonimize = false;
      anonymousText = args.slice(2).join(' ');
    }


    
    // Verifica se a mensagem é muito curta
    if (anonymousText.length < 5) {
      return new ReturnMessage({
        chatId: senderIds[0],
        content: '⚠️ A mensagem é muito curta. Por favor, escreva algo mais substancial.'
      });
    }
    
    // Obtém todos os grupos para verificar o alvo
    const groups = await database.getGroups();
    
    // Encontra o grupo pelo nome ou ID
    const targetGroup = groups.find(g => 
      (g.name && g.name.toLowerCase() === targetGroupName) || 
      (g.id && g.id.toLowerCase().includes(targetGroupName))
    );
    
    if (!targetGroup) {
      return new ReturnMessage({
        chatId: senderIds[0],
        content: `❌ Grupo "${targetGroupName}" não encontrado. Verifique o nome e tente novamente.`
      });
    }
    
    // Verifica se o grupo existe e se o bot está no grupo
    try {
      const chat = await bot.client.getChatById(targetGroup.id);
      
      // Verifica se o usuário está no grupo (OBRIGATÓRIO)
      const participants = await chat.participants;
      const isUserInGroup = participants.some(p => senderIds.some(sI => p.id._serialized.startsWith(sI) || p.phoneNumber?.startsWith(sI)));
      
      //logger.debug(`[anonimo] `,{message, participants, senderIds, isUserInGroup});

      if (!isUserInGroup) {
        return new ReturnMessage({
          chatId: senderIds[0],
          content: `❌ Você não é membro do grupo "${targetGroup.name}". Apenas membros podem enviar mensagens anônimas para este grupo.`
        });
      }
    } catch (error) {
      logger.error('Erro ao verificar grupo ou participantes:', error);
      return new ReturnMessage({
        chatId: senderIds[0],
        content: `❌ Não foi possível acessar o grupo. O bot pode não estar mais nele ou o grupo foi excluído.`
      });
    }
    
    // Registra a mensagem anônima
    const now = Date.now();
    const anonMessages = getAnonMessages();
    
    let anonimizedMessage = null;
    try {
      if(anonimize){
        anonimizedMessage = await llmService.getCompletion({ prompt: `Reescreva esta frase em portugues adequado, removendo vícios de linguagens, gírias e idiomas. A mensagem deve ser anonimizada, não sendo possível identificar a pessoa que enviou a mesma. ((Retorne APENAS a frase solicitada. Se não for possível, retorne o texto original, ((nunca)) retorne mensagens de erro e otros detalhes)). Texto para processar:\n"${anonymousText}"` });
        if(anonimizedMessage.includes("original não pode ser")){
          anonimizedMessage = anonymousText;
        }
      } else {
        anonimizedMessage = anonymousText;
      }
    } catch(e){
      logger.error(`[anonymousMessage] Não consegui deixar a mensagem anonima, usando a original.`);
      anonimizedMessage = anonymousText;
    }

    // Adiciona nova mensagem ao registro
    anonMessages.push({
      senderId: senderIds[0],
      targetGroupId: targetGroup.id,
      targetGroupName: targetGroup.name,
      message: anonymousText,
      anonimizedMessage: anonimizedMessage,
      timestamp: now
    });
    
    // Salva as mensagens atualizadas
    saveAnonMessages(anonMessages);
    
    // Envia a mensagem para o grupo alvo
    try {
      // Formata a mensagem anônima
      const formattedMessage = `👻 *Um membro anônimo enviou:*\n\n> ${anonimizedMessage ?? anonymousText}`;
      
      // Envia para o grupo alvo
      await bot.sendMessage(targetGroup.id, formattedMessage);
      
      // Confirma o envio para o remetente
      return new ReturnMessage({
        chatId: senderIds[0],
        content: `✅ Sua mensagem anônima foi enviada com sucesso para o grupo "${targetGroup.name}".\n\nVocê poderá enviar outra mensagem anônima em ${COOLDOWN_HOURS} horas.`
      });
    } catch (error) {
      logger.error('Erro ao enviar mensagem anônima:', error);
      
      return new ReturnMessage({
        chatId: senderIds[0],
        content: `❌ Erro ao enviar mensagem anônima: ${error.message}`
      });
    }
  } catch (error) {
    logger.error('Erro no comando de mensagem anônima:', error);
    
    return new ReturnMessage({
      chatId: message.author,
      content: '❌ Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente.'
    });
  }
}

/**
 * Adiciona comandos administrativos para gerenciar mensagens anônimas
 * @param {WhatsAppBot} bot - Instância do bot
 * @param {Object} message - Dados da mensagem
 * @param {Array} args - Argumentos do comando
 * @returns {Promise<ReturnMessage>} Mensagem de retorno
 */
async function adminAnonMessages(bot, message, args) {
  try {
    // Verifica se é um administrador do bot
    const isAdmin = await bot.isAdmin(message.author);
    if (!isAdmin) {
      return new ReturnMessage({
        chatId: message.author,
        content: `⛔ Apenas administradores podem usar este comando.`
      });
    }
    
    // Obtém as mensagens anônimas
    const anonMessages = getAnonMessages();
    
    if (args.length === 0 || args[0] === 'list') {
      // Lista as últimas 10 mensagens anônimas
      if (anonMessages.length === 0) {
        return new ReturnMessage({
          chatId: message.author,
          content: `📝 Não há mensagens anônimas registradas.`
        });
      }
      
      const lastMessages = anonMessages
        .slice(-10)
        .map((msg, index) => {
          const date = new Date(msg.timestamp).toLocaleString('pt-BR');
          return `*${index + 1}.* De: ${msg.senderId}\nPara: ${msg.targetGroupName}\nData: ${date}\nMensagem: "${msg.message}"`;
        })
        .join('\n\n');
      
      return new ReturnMessage({
        chatId: message.author,
        content: `📝 *Últimas mensagens anônimas:*\n\n${lastMessages}`
      });
    } else if (args[0] === 'clear') {
      // Limpa todas as mensagens anônimas
      saveAnonMessages([]);
      
      return new ReturnMessage({
        chatId: message.author,
        content: `🧹 Todas as mensagens anônimas foram removidas.`
      });
    } else if (args[0] === 'find' && args.length > 1) {
      // Busca mensagens por ID do usuário
      const userId = args[1];
      const userMessages = anonMessages.filter(msg => msg.senderId.includes(userId));
      
      if (userMessages.length === 0) {
        return new ReturnMessage({
          chatId: message.author,
          content: `🔍 Nenhuma mensagem encontrada para o usuário ${userId}.`
        });
      }
      
      const formattedMessages = userMessages
        .slice(-5) // Apenas as 5 mais recentes
        .map((msg, index) => {
          const date = new Date(msg.timestamp).toLocaleString('pt-BR');
          return `*${index + 1}.* Para: ${msg.targetGroupName}\nData: ${date}\nMensagem: "${msg.message}"`;
        })
        .join('\n\n');
      
      return new ReturnMessage({
        chatId: message.author,
        content: `🔍 *Mensagens do usuário ${userId}:*\n\n${formattedMessages}`
      });
    }
    
    // Instruções para o comando
    return new ReturnMessage({
      chatId: message.author,
      content: `📋 *Comandos disponíveis:*\n\n` +
        `!adminanon list - Lista as últimas mensagens anônimas\n` +
        `!adminanon find [id] - Busca mensagens por ID do usuário\n` +
        `!adminanon clear - Remove todas as mensagens anônimas`
    });
  } catch (error) {
    logger.error('Erro no comando adminAnon:', error);
    
    return new ReturnMessage({
      chatId: message.author,
      content: '❌ Ocorreu um erro ao processar sua solicitação.'
    });
  }
}

// Criar comandos
const commands = [
  new Command({
    name: 'anonimo',
    description: 'Envia uma mensagem anônima para um grupo',
    category: "jogos",
    cooldown: 0, // O cooldown é gerenciado internamente
    reactions: {
      before: "👻",
      after: "📨",
      error: "❌"
    },
    method: anonymousMessage
  }),
  new Command({
    name: 'anônimo',
    description: 'Envia uma mensagem anônima para um grupo',
    category: "jogos",
    hidden: true,
    cooldown: 0, // O cooldown é gerenciado internamente
    reactions: {
      before: "👻",
      after: "📨",
      error: "❌"
    },
    method: anonymousMessage
  }),
  new Command({
    name: 'adminanon',
    description: 'Gerencia mensagens anônimas (apenas admin)',
    category: "admin",
    hidden: true,
    cooldown: 0,
    reactions: {
      before: "🔍",
      after: "📋",
      error: "❌"
    },
    method: adminAnonMessages
  })
];

module.exports = { commands };
