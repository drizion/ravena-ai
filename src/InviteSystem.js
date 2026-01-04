const Logger = require('./utils/Logger');
const Database = require('./utils/Database');
const path = require('path');
const fs = require('fs').promises;

/**
 * Gerencia o sistema de convites para o bot
 * * Fluxo de trabalho:
 * 1. Usuário envia um link de convite para o bot em um chat privado
 * 2. Bot pergunta o motivo para adicionar o bot ao grupo
 * 3. Usuário responde com um motivo ou ocorre timeout
 * 4. Bot encaminha os detalhes do convite para um grupo designado para aprovação
 * 5. Admins podem usar um comando para entrar no grupo
 */
class InviteSystem {
  /**
   * Cria uma nova instância do InviteSystem
   * @param {WhatsAppBot} bot - A instância do bot
   */
  constructor(bot) {
    this.bot = bot;
    this.logger = new Logger(`invite-system-${bot.id}`);
    this.database = Database.getInstance();
    this.pendingRequests = new Map(); // Mapa de autor -> { inviteLink, timeout }
    this.inviteCooldown = 60; // Padrão 60 minutos (para o cooldown de convite por usuário)
    this.userCooldowns = new Map(); // Mapa de autor -> timestamp do último convite de usuário
    this.groupInviteCooldowns = new Map(); // Mapa de inviteCode -> timestamp do último convite do grupo
  }

  rndString(){
    return (Math.random() + 1).toString(36).substring(7);
  }



  /**
   * Processa uma mensagem privada que pode conter um link de convite
   * @param {Object} message - O objeto da mensagem
   * @returns {Promise<boolean>} - Se a mensagem foi tratada como um convite
   */
  async processMessage(message) {
    try {
      // Processa apenas mensagens privadas
      if (message.group) return false;
      
      const text = message.type === 'text' ? message.content : message.caption;
      if (!text) return false;
      
      // Verifica se a mensagem contém um link de convite do WhatsApp
      const inviteMatch = text.match(/chat.whatsapp.com\/([a-zA-Z0-9]{10,50})/i);
      if (!inviteMatch) return false;

      const isBlocked = await this.database.isUserInviteBlocked(message.author.split('@')[0]);
      if (isBlocked) {
        this.logger.info(`Ignorando convite de usuário bloqueado: ${message.author}`);
        message.origin.react("🫷");
        return true;
      }

      // Verifica o cooldown do usuário
      const lastUserInviteTime = this.userCooldowns.get(message.author);
      const currentTime = Date.now();
      const userCooldownDurationMs = this.inviteCooldown * 60 * 1000; // Cooldown do usuário em milissegundos

      if (lastUserInviteTime && (currentTime - lastUserInviteTime < userCooldownDurationMs)) {
        this.logger.info(`Usuário ${message.author} está em cooldown para convites. Ignorando.`);
        return false;
      }
      
      const inviteLink = inviteMatch[0];
      const inviteCode = inviteMatch[1];

      // Verifica o cooldown do grupo (inviteCode)
      const lastGroupInviteTime = this.groupInviteCooldowns.get(inviteCode);
      const groupCooldownDurationMs = this.inviteCooldown * 60 * 1000; // Cooldown do grupo em milissegundos

      if (lastGroupInviteTime && (currentTime - lastGroupInviteTime < groupCooldownDurationMs)) {
        this.logger.info(`Convite para o grupo ${inviteCode} está em cooldown. Ignorando.`);
        return false;
      }
      
      this.logger.info(`Recebido convite de grupo de ${message.author}: ${inviteLink}`, {message});
      
      // Verifica se o usuário já tem uma solicitação pendente
      if (this.pendingRequests.has(message.author)) {
        // Limpa o timeout anterior
        clearTimeout(this.pendingRequests.get(message.author).timeout);
        this.pendingRequests.delete(message.author);
      }
      
      const invitesPrePath = path.join(this.database.databasePath, 'textos', 'invites_pre.txt');
      const preConvite = await fs.readFile(invitesPrePath, 'utf8');

      // Gera código de verificação
      const verificationCode = this.rndString();

      // Pergunta o motivo para adicionar o bot
      await this.bot.sendMessage(message.author, `${preConvite}\n\`${verificationCode}\``);
      
      // Define um timeout para tratar o convite mesmo se o usuário não responder
      const timeoutId = setTimeout(() => {
        this.handleInviteRequest(message.author, inviteCode, inviteLink, "Nenhum motivo fornecido", message);
      }, 5 * 60 * 1000); // 5 minutos
      
      // Armazena a solicitação pendente
      this.pendingRequests.set(message.author, {
        inviteLink,
        inviteCode,
        timeout: timeoutId,
        verificationCode
      });

      // Define o timestamp do último convite para o usuário (inicia o cooldown de usuário)
      this.userCooldowns.set(message.author, currentTime);
      // Define o timestamp do último convite para o grupo (inicia o cooldown de grupo)
      this.groupInviteCooldowns.set(inviteCode, currentTime);
      
      return true;
    } catch (error) {
      this.logger.error('Erro ao processar potencial convite:', error);
      return false;
    }
  }

  /**
   * Processa uma mensagem de acompanhamento (motivo do convite)
   * @param {Object} message - O objeto da mensagem
   * @returns {Promise<boolean>} - Se a mensagem foi tratada como um motivo de convite
   */
  async processFollowUpMessage(message) {
    try {
      // Processa apenas mensagens privadas
      if (message.group) return false;
      
      // Verifica se o usuário tem uma solicitação pendente
      if (!this.pendingRequests.has(message.author)) return false;
      
      const text = message.type === 'text' ? message.content : message.caption;
      if (!text) return false;
      
      const { inviteCode, inviteLink, timeout, verificationCode } = this.pendingRequests.get(message.author);
      
      // Limpa o timeout
      clearTimeout(timeout);
      this.pendingRequests.delete(message.author);
      
      // Trata o convite com o motivo fornecido
      await this.handleInviteRequest(message.author, inviteCode, inviteLink, text, message, verificationCode);
      
      return true;
    } catch (error) {
      this.logger.error('Erro ao processar mensagem de acompanhamento de convite:', error);
      return false;
    }
  }

  /**
   * Trata uma solicitação de convite
   * @param {string} authorId - ID do usuário que enviou o convite
   * @param {string} inviteCode - O código de convite
   * @param {string} inviteLink - O link de convite completo
   * @param {string} reason - Motivo do convite
   * @param {Object} message - Objeto da mensagem original
   * @param {string} [verificationCode] - Código de verificação enviado ao usuário
   */
  async handleInviteRequest(authorId, inviteCode, inviteLink, reason, message, verificationCode) {
    try {
      this.logger.info(`Processando solicitação de convite de ${authorId} para o código ${inviteCode}`);
      
      // Verifica se o usuário enviou o código de verificação como motivo
      if (verificationCode && reason && reason.trim().toLowerCase() === verificationCode.toLowerCase()) {
        this.logger.info(`Usuário ${authorId} enviou o código de verificação como motivo (${verificationCode}). Ignorando convite.`);

        this.bot.sendMessage(this.bot.grupoInvites, `Usuário ${authorId} enviou o código de verificação como motivo (${verificationCode}). Ignorando convite.`);

        try {
          const ignoredPath = path.join(this.database.databasePath, 'textos', 'invite_ignorado.txt');
          const ignoredText = await fs.readFile(ignoredPath, 'utf8').catch(() => "Leitura não é o seu forte, né? _Convite ignorado._");
          await this.bot.sendMessage(authorId, ignoredText);
        } catch (err) {
          this.bot.sendMessage(authorId, "Leitura não é o seu forte, né? _Convite ignorado._");
        }
        
        const punishDuration = (10 * this.inviteCooldown * 60 * 1000);
        const normalDuration = (this.inviteCooldown * 60 * 1000);

        const futureTime = Date.now() + punishDuration - normalDuration;
        this.userCooldowns.set(authorId, futureTime);
        
        return;
      }
      
      // Obtém informações do usuário
      const userName = message.name ?? message.pushName ?? message.pushname ?? message.authorName ?? "Pessoa";
      
      // Salva o convite pendente no banco de dados
      const invite = {
        code: inviteCode,
        link: inviteLink,
        author: {
          id: authorId,
          name: userName
        },
        reason: reason,
        timestamp: Date.now()
      };
      
      // Alteração: usar savePendingJoin em vez de addPendingInvite
      await this.database.savePendingJoin(inviteCode, {
        authorId: authorId, 
        authorName: userName
      });
      
      // Envia notificação para o usuário
      const invitesPosPath = path.join(this.database.databasePath, 'textos', 'invites_pos.txt');
      const posConvite = await fs.readFile(invitesPosPath, 'utf8');

      await this.bot.sendMessage(authorId, "Seu convite foi recebido e será analisado."+posConvite);
      
      // Envia notificações para o grupoInvites se configurado
      if (this.bot.grupoInvites) {
        try {
          const inviteInfo = await this.bot.client.getInviteInfo(inviteCode);
          this.logger.debug(`[inviteInfo] `, {inviteInfo});
        } catch(ivInfoError){
          this.logger.error('Erro buscando inviteInfo', ivInfoError);
        }
        
        try {
          // Verifica se o autor está na lista de doadores
          let isDonator = false;
          let infoMessage = "";
          let donateValue = 0;
          
          try {
            // Obtém todas as doações
            const donations = await this.database.getDonations();
            
            if (donations && donations.length > 0) {
              // Remove caracteres especiais e espaços do número do autor para comparação
              const cleanAuthorId = authorId.replace(/[^0-9]/g, "");
              
              // Verifica se o autor está na lista de doadores
              isDonator = donations.some(donation => {
                // Se o doador tem um número de telefone
                if (donation.numero) {
                  // Remove caracteres especiais e espaços do número do doador
                  const cleanDonorNumber = donation.numero.replace(/[^0-9]/g, "");
                  //this.logger.debug(`[donate-invite] ${cleanDonorNumber} vs ${cleanAuthorId} =  ${cleanDonorNumber.includes(cleanAuthorId)} || ${ cleanAuthorId.includes(cleanDonorNumber)}`);
                  if(cleanDonorNumber.length > 10){
                    if(cleanDonorNumber.includes(cleanAuthorId) || cleanAuthorId.includes(cleanDonorNumber)){
                      donateValue = donation.valor;
                      return true;
                    }
                  }
                }
                return false;
              });
            }
          } catch (donationError) {
            this.logger.error('Erro ao verificar se o autor é doador:', donationError);
          }
          
          // Constrói a mensagem de informações, adicionando emojis de dinheiro se for doador
          if (isDonator) {
            infoMessage = 
              `💸💸 R$${donateValue} 💸💸\n` +
              `📩 *Nova Solicitação de Convite de Grupo*\n\n` +
              `🔗 *Link*: chat.whatsapp.com/${inviteCode}\n`+
              `👤 *De:* ${userName} (${authorId.split("@")[0]}) 💰\n\n` +
              `💬 *Motivo:*\n${reason}\n` +
              `💸💸${this.rndString()}💸💸`;
          } else {
            infoMessage = 
              `📩 *Nova Solicitação de Convite de Grupo*\n\n` +
              `🔗 *Link*: chat.whatsapp.com/${inviteCode}\n`+
              `👤 *De:* ${userName} (${authorId.split("@")[0]})\n\n` +
              `💬 *Motivo:*\n${reason}\n\n${this.rndString()}`;
          }
          
          await this.bot.sendMessage(this.bot.grupoInvites, infoMessage);
          
          // Envia segunda mensagem com comando para aceitar
          const commandMessage = `!sa-joinGrupo ${inviteCode} ${authorId} ${userName}`;
          
          await this.bot.sendMessage(this.bot.grupoInvites, commandMessage);
        } catch (error) {
          this.logger.error('Erro ao enviar notificação de convite para grupoInvites:', error);
    
        }
      } else {
        this.logger.warn('Nenhum grupoInvites configurado, o convite não será encaminhado');
        
        // Notifica o usuário
        //await this.bot.sendMessage(authorId, "Este bot não recebe convites.");
      }
    } catch (error) {
      this.logger.error('Erro ao tratar solicitação de convite:', error);
    }
  }
    
  /**
   * Limpa recursos
   */
  destroy() {
    // Limpa todos os timeouts pendentes
    for (const { timeout } of this.pendingRequests.values()) {
      clearTimeout(timeout);
    }
    this.pendingRequests.clear();
    this.userCooldowns.clear(); // Limpa também o mapa de cooldowns de usuário
    this.groupInviteCooldowns.clear(); // Limpa também o mapa de cooldowns de grupo
  }
}

module.exports = InviteSystem;
