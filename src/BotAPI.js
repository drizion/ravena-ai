const express = require('express');
const bodyParser = require('body-parser');
const Logger = require('./utils/Logger');
const Database = require('./utils/Database');
const path = require('path');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const fs = require('fs').promises;
const qrcode = require("qr-base64");
const { exec, spawn } = require('child_process');

/**
 * Servidor API para o bot WhatsApp
 */
class BotAPI {
  /**
   * Cria um novo servidor API
   * @param {Object} options - Opções de configuração
   * @param {number} options.port - Porta para escutar
   * @param {Array} options.bots - Array de instâncias de WhatsAppBot
   */
  constructor(options = {}) {
    this.port = options.port ?? process.env.API_PORT ?? 5000;
    this.bots = options.bots ?? [];
    this.eventHandler = options.eventHandler ?? false;
    this.logger = new Logger('bot-api');
    this.database = Database.getInstance();
    this.app = express();

    // Credenciais de autenticação para endpoints protegidos
    this.apiUser = process.env.BOTAPI_USER ?? 'admin';
    this.apiPassword = process.env.BOTAPI_PASSWORD ?? 'senha12345';

    // Cache para os dados analíticos processados
    this.analyticsCache = {
      lastUpdate: 0,         // Timestamp da última atualização
      cacheTime: 10 * 60000, // Tempo de cache (10 minutos)
      daily: {},             // Dados diários por bot
      weekly: {},            // Dados semanais por bot
      monthly: {},           // Dados mensais por bot
      yearly: {}             // Dados anuais por bot
    };

    // Cache para estatísticas gerais dos bots (tabela)
    this.botStatsCache = {
      lastUpdate: 0,
      cacheTime: 30 * 60000, // 30 minutos
      data: []
    };

    // Configura middlewares
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // Configura rotas
    this.setupRoutes();

    this.app.use(express.static(path.join(__dirname, '../public')));

    // Carrega dados analíticos em cache ao iniciar
    this.updateAnalyticsCache();

    // Configura atualização periódica do cache (a cada 10 minutos)
    this.cacheUpdateInterval = setInterval(() => this.updateAnalyticsCache(), this.analyticsCache.cacheTime);
  }


  // Helper function to read tokens
  async readWebManagementToken(token) {
    const dbPath = path.join(this.database.databasePath, 'webmanagement.json');

    try {
      const data = await fs.readFile(dbPath, 'utf8');
      const webManagement = JSON.parse(data);

      return webManagement.find(item => item.token === token);
    } catch (error) {
      this.logger.error('Error reading webmanagement.json:', error);
      return null;
    }
  }

  /**
   * Configura rotas da API
   */
  setupRoutes() {
    // Endpoint de verificação de saúde
    this.app.get('/health', async (req, res) => {
      try {
        // Obtém timestamp de 30 minutos atrás
        const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);

        // Obtém relatórios de carga mais recentes
        const recentReports = await this.database.getLoadReports(thirtyMinutesAgo);

        // Mapeia resultados por bot
        const botReports = {};
        if (recentReports && Array.isArray(recentReports)) {
          recentReports.forEach(report => {
            // Se não existir um relatório para este bot ou se for mais recente
            if (!botReports[report.botId] ||
              report.timestamp > botReports[report.botId].timestamp) {
              botReports[report.botId] = report;
            }
          });
        }

        // Prepara resposta com dados adicionais
        res.json({
          status: 'ok',
          timestamp: Date.now(),
          bots: this.bots.filter(bot => !bot.privado && !bot.useTelegram && !bot.useDiscord).map(bot => {
            // Busca relatório mais recente para este bot
            const report = botReports[bot.id] ?? null;
            const messagesPerHour = report && report.messages ?
              report.messages.messagesPerHour ?? 0 : 0;

            // Adiciona informações de tempo de resposta
            const avgResponseTime = report && report.responseTime ?
              parseFloat(report.responseTime.average) ?? 0 : 0;
            const maxResponseTime = report && report.responseTime ?
              report.responseTime.max ?? 0 : 0;

            return {
              id: bot.id,
              phoneNumber: bot.phoneNumber,
              supportNumber: bot.supportNumber,
              connected: bot.isConnected,
              lastMessageReceived: bot.lastMessageReceived ?? null,
              msgsHr: messagesPerHour,
              responseTime: {
                avg: avgResponseTime,
                max: maxResponseTime
              },
              semPV: bot.ignorePV ?? false,
              semConvites: bot.ignoreInvites ?? false,
              banido: bot.banido ?? false,
              comunitario: bot.comunitario ?? false,
              numeroResponsavel: bot.numeroResponsavel ?? false,
              banido: bot.banido ?? false,
              supportMsg: bot.supportMsg ?? false,
              vip: bot.vip ?? false
            };
          })
        });
      } catch (error) {
        this.logger.error('Erro ao processar dados de health:', error);
        res.json({
          status: 'error',
          timestamp: Date.now(),
          message: 'Erro ao processar dados',
          bots: this.bots.map(bot => ({
            id: bot.id,
            phoneNumber: bot.phoneNumber,
            connected: bot.isConnected,
            lastMessageReceived: bot.lastMessageReceived ?? null,
            msgsHr: 0,
            responseTime: {
              avg: 0,
              max: 0
            },
            semPV: bot.ignorePV ?? false,
            semConvites: bot.ignoreInvites ?? false,
            banido: bot.banido ?? false,
            comunitario: bot.comunitario ?? false,
            numeroResponsavel: bot.numeroResponsavel ?? false,
            banido: bot.banido ?? false,
            supportMsg: bot.supportMsg ?? false,
            vip: bot.vip ?? false
          }))
        });
      }
    });

    // Middleware de autenticação básica
    const authenticateBasic = (req, res, next) => {
      const { botId } = req.params;
      let user = this.apiUser;
      let pass = this.apiPassword;

      if (botId) {
        const bot = this.bots.find(b => b.id === botId);
        if (bot && bot.managementUser && bot.managementPW) {
          user = bot.managementUser;
          pass = bot.managementPW;
          this.logger.debug(`[authenticateBasic] Using credentials for bot '${botId}'`);
        }
      }

      // Verifica se os cabeçalhos de autenticação existem
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.set('WWW-Authenticate', 'Basic realm="RavenaBot API"');
        return res.status(401).json({
          status: 'error',
          message: 'Autenticação requerida'
        });
      }

      // Decodifica e verifica credenciais
      try {
        // O formato é 'Basic <base64 encoded username:password>'
        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
        const [username, password] = credentials.split(':');

        if (username === user && password === pass) {
          return next();
        }
      } catch (error) {
        this.logger.error('Erro ao processar autenticação básica:', error);
      }

      // Credenciais inválidas
      res.set('WWW-Authenticate', 'Basic realm="RavenaBot API"');
      return res.status(401).json({
        status: 'error',
        message: 'Credenciais inválidas'
      });
    };

    // Novo endpoint para reiniciar um bot específico (requer autenticação)
    this.app.get('/restart/:botId', authenticateBasic, async (req, res) => {
      try {
        // Obter parâmetros
        const { botId } = req.params;
        const { reason } = req.body ?? {};

        // Validar parâmetros
        if (!botId) {
          return res.status(400).json({
            status: 'error',
            message: 'ID do bot não especificado'
          });
        }

        // Encontrar o bot solicitado
        const bot = this.bots.find(b => b.id === botId);
        if (!bot) {
          return res.status(404).json({
            status: 'error',
            message: `Bot com ID '${botId}' não encontrado`
          });
        }

        // Verificar se o método de reinicialização está disponível
        if (typeof bot.restartBot !== 'function') {
          return res.status(400).json({
            status: 'error',
            message: `Bot '${botId}' não suporta reinicialização`
          });
        }

        // Iniciar reinicialização em modo assíncrono
        const restartReason = reason ?? `Reinicialização via API em ${new Date().toLocaleString("pt-BR")}`;


        try {
          this.logger.info(`Reiniciando bot ${botId} via endpoint API`);
          const resp = await bot.restartBot(restartReason);
          res.json({
            status: 'ok',
            message: resp,
            timestamp: Date.now()
          });
          this.logger.info(`Bot ${botId} reiniciado com sucesso via API`);
        } catch (error) {
          this.logger.error(`Erro ao reiniciar bot ${botId} via API:`, error);
          res.json({
            status: 'error',
            message: error,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        this.logger.error('Erro no endpoint de reinicialização:', error);
        res.status(500).json({
          status: 'error',
          message: 'Erro interno do servidor'
        });
      }
    });

    this.app.get('/logout/:botId', authenticateBasic, async (req, res) => {
      const { botId } = req.params;
      const bot = this.bots.find(b => b.id === botId);
      if (!bot) {
        return res.status(404).json({ status: 'error', message: `Bot com ID '${botId}' não encontrado` });
      }
      try {
        this.logger.info(`[API] Executing logout for bot '${botId}'`);
        const result = await bot.logout();
        res.json({ status: 'ok', message: 'Logout successful', details: result });
      } catch (e) {
        this.logger.error(`[API] Error during logout for bot '${botId}':`, e);
        res.status(500).json({ status: 'error', message: e.message, details: e.stack });
      }
    });

    this.app.get('/recreate/:botId', authenticateBasic, async (req, res) => {
      const { botId } = req.params;
      const bot = this.bots.find(b => b.id === botId);
      if (!bot) {
        return res.status(404).json({ status: 'error', message: `Bot com ID '${botId}' não encontrado` });
      }
      try {
        this.logger.info(`[API] Executing recreate for bot '${botId}'`);
        const result = await bot.recreateInstance();
        res.json({ status: 'ok', message: 'Recreation process finished.', details: result });
      } catch (e) {
        this.logger.error(`[API] Error during recreate for bot '${botId}':`, e);
        res.status(500).json({ status: 'error', message: e.message, details: e.stack });
      }
    });

    // Webhook de doação do Tipa.ai
    this.app.post('/donate_tipa', async (req, res) => {
      try {
        this.logger.info('Recebido webhook de doação do Tipa.ai');

        // Registra a requisição completa para depuração
        const donateData = {
          headers: req.headers,
          body: req.body
        };

        this.logger.debug('Dados da doação:', donateData);

        // Verifica o segredo do webhook
        const headerTipa = req.headers["x-tipa-webhook-secret-token"] ?? false;
        const expectedToken = process.env.TIPA_TOKEN;

        if (!headerTipa || headerTipa !== expectedToken) {
          this.logger.warn('Token webhook inválido:', headerTipa);
          return res.status(403).send('-');
        }

        // Extrai detalhes da doação
        let nome = req.body.payload.tip.name ?? "Alguém";
        const valor = parseFloat(req.body.payload.tip.amount) ?? 0;
        const msg = req.body.payload.tip.message ?? "";

        nome = nome.trim();

        if (valor <= 0) {
          this.logger.warn(`Valor de doação inválido: ${valor}`);
          return res.send('ok');
        }

        // Adiciona doação ao banco de dados
        const donationTotal = await this.database.addDonation(nome, valor);

        // Notifica grupos sobre a doação
        await this.notifyGroupsAboutDonation(nome, valor, msg, donationTotal);

        res.send('ok');
      } catch (error) {
        this.logger.error('Erro ao processar webhook de doação:', error);
        res.status(500).send('error');
      }
    });

    // Endpoint para obter relatórios de carga
    this.app.post('/getLoad', async (req, res) => {
      try {
        const { timestamp } = req.body;

        if (!timestamp || isNaN(parseInt(timestamp))) {
          return res.status(400).json({
            status: 'error',
            message: 'Timestamp inválido ou ausente'
          });
        }

        // Obtém relatórios de carga após o timestamp especificado
        const reports = await this.database.getLoadReports(parseInt(timestamp));

        res.json({
          status: 'ok',
          timestamp: Date.now(),
          reports
        });
      } catch (error) {
        this.logger.error('Erro ao obter relatórios de carga:', error);
        res.status(500).json({
          status: 'error',
          message: 'Erro interno do servidor'
        });
      }
    });

    // Novo endpoint para obter dados analíticos
    this.app.get('/analytics', (req, res) => {
      try {
        // Obtém parâmetros da requisição
        const period = req.query.period ?? 'today';
        let selectedBots = req.query['bots[]'];

        // Converte para array se não for
        if (!Array.isArray(selectedBots)) {
          selectedBots = selectedBots ? [selectedBots] : [];
        }

        // Se não há bots selecionados, usa todos
        if (selectedBots.length === 0) {
          selectedBots = Object.keys(this.analyticsCache.daily);
        }

        // Verifica se o cache está atualizado
        const now = Date.now();
        if (now - this.analyticsCache.lastUpdate > this.analyticsCache.cacheTime) {
          // Se o cache está desatualizado, atualiza-o
          this.updateAnalyticsCache()
            .then(() => {
              // Após atualizar, envia os dados filtrados
              res.json(this.filterAnalyticsData(period, selectedBots));
            })
            .catch(error => {
              this.logger.error('Erro ao atualizar cache para análise:', error);
              res.status(500).json({
                status: 'error',
                message: 'Erro ao processar dados analíticos'
              });
            });
        } else {
          // Se o cache está atualizado, envia os dados filtrados diretamente
          res.json(this.filterAnalyticsData(period, selectedBots));
        }
      } catch (error) {
        this.logger.error('Erro no endpoint de análise:', error);
        res.status(500).json({
          status: 'error',
          message: 'Erro interno do servidor'
        });
      }
    });

    // Endpoint para estatísticas detalhadas dos bots (tabela)
    this.app.get('/api/bot-stats', async (req, res) => {
      try {
        const now = Date.now();
        // Verifica se o cache é válido
        if (this.botStatsCache.data.length > 0 && (now - this.botStatsCache.lastUpdate < this.botStatsCache.cacheTime)) {
          return res.json(this.botStatsCache.data);
        }

        await this.updateBotStatsCache();
        res.json(this.botStatsCache.data);
      } catch (error) {
        this.logger.error('Erro ao buscar estatísticas dos bots:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
      }
    });

    // Endpoint para Top Donates
    this.app.get('/top-donates', async (req, res) => {
      const donationsPath = path.join(this.database.databasePath, 'donations.json');

      try {
        await fs.access(donationsPath);

        // Se a linha acima não lançar um erro, o arquivo existe.
        const donationsData = await fs.readFile(donationsPath, 'utf8');
        const donations = JSON.parse(donationsData);

        // Mapeia para remover o campo 'numero' por privacidade
        const publicDonations = donations.map(({ nome, valor }) => ({ nome, valor }));

        res.json(publicDonations);

      } catch (error) {
        // O bloco catch lida com qualquer erro, seja o arquivo não encontrado ou um erro de processamento.
        if (error.code === 'ENOENT') {
          // Se o erro for 'ENOENT', o arquivo não foi encontrado.
          res.status(404).json({ error: 'Arquivo de doações não encontrado' });
        } else {
          // Para outros erros, como falha ao ler ou processar o JSON.
          this.logger.error('Erro ao ler ou processar o arquivo de doações:', error);
          res.status(500).json({ error: 'Erro ao processar doações' });
        }
      }
    });


    // Serve management page
    this.app.get('/manage/:token', (req, res) => {
      const { token } = req.params;
      const filePath = path.join(__dirname, '../public/management.html');
      this.logger.info(`[management] => '${token}'`);
      res.sendFile(filePath);
    });

    // Validate token endpoint
    this.app.get('/api/validate-token', async (req, res) => {
      const token = req.query.token;

      if (!token) {
        return res.status(400).json({ valid: false, message: 'Token not provided' });
      }

      try {
        const webManagementData = await this.readWebManagementToken(token);

        if (!webManagementData) {
          return res.status(401).json({ valid: false, message: 'Invalid token' });
        }

        // Check expiration
        const expiresAt = new Date(webManagementData.expiresAt);
        const now = new Date();

        if (now > expiresAt) {
          return res.status(401).json({ valid: false, message: 'Token expired' });
        }

        return res.json({
          valid: true,
          requestNumber: webManagementData.requestNumber,
          authorName: webManagementData.authorName,
          groupId: webManagementData.groupId,
          groupName: webManagementData.groupName,
          expiresAt: webManagementData.expiresAt
        });
      } catch (error) {
        this.logger.error('Error validating token:', error);
        return res.status(500).json({ valid: false, message: 'Server error' });
      }
    });

    // Get group data endpoint
    this.app.get('/api/group', async (req, res) => {
      const { id, token } = req.query;

      if (!id || !token) {
        return res.status(400).json({ message: 'Missing required parameters' });
      }

      try {
        const webManagementData = await this.readWebManagementToken(token);

        if (!webManagementData || webManagementData.groupId !== id) {
          return res.status(401).json({ message: 'Unauthorized' });
        }

        if (new Date() > new Date(webManagementData.expiresAt)) {
          return res.status(401).json({ message: 'Token expired' });
        }

        // Get database instance  
        const groupData = await this.database.getGroup(id);

        if (!groupData) {
          return res.status(404).json({ message: 'Group not found' });
        }

        this.logger.info(`[management][${token}][${id}] Group ${groupData.name}`);
        return res.json(groupData);
      } catch (error) {
        this.logger.error('Error getting group data:', error);
        return res.status(500).json({ message: 'Server error' });
      }
    });

    // Update the group data endpoint to use the correct methods
    this.app.post('/api/update-group', async (req, res) => {
      const { token, groupId, changes } = req.body;

      if (!token || !groupId || !changes) {
        return res.status(400).json({ success: false, message: 'Missing required parameters' });
      }

      try {
        const webManagementData = await this.readWebManagementToken(token);

        if (!webManagementData || webManagementData.groupId !== groupId) {
          return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (new Date() > new Date(webManagementData.expiresAt)) {
          return res.status(401).json({ success: false, message: 'Token expired' });
        }

        // Get database instance - assuming it's exported from a central location          
        const groupData = await this.database.getGroup(groupId);

        if (!groupData) {
          return res.status(404).json({ success: false, message: 'Group not found' });
        }

        this.logger.info(`[management][${token}][${groupId}] UPDATED Group data:\n${JSON.stringify(changes, null, 2)}`);

        // Apply changes
        Object.entries(changes).forEach(([key, value]) => {
          groupData[key] = value;
        });

        // Add update timestamp
        groupData.lastUpdated = new Date().toISOString();

        // Save the updated group
        await this.database.saveGroup(groupData);

        // Signal bots to reload the group config
        const updatesPath = path.join(this.database.databasePath, 'group_updates.json');
        let updates = {};

        try {
          const updatesData = await fs.readFile(updatesPath, 'utf8');
          updates = JSON.parse(updatesData);
        } catch (error) {
          // File might not exist, continue with empty object
        }

        updates[groupId] = {
          timestamp: groupData.lastUpdated,
          updatedBy: 'webmanagement'
        };

        await fs.writeFile(updatesPath, JSON.stringify(updates, null, 2), 'utf8');

        this.eventHandler.loadGroups(); // Recarrega os grupos em memória

        return res.json({ success: true });
      } catch (error) {
        this.logger.error('Error updating group:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
      }
    });

    // Upload media endpoint
    this.app.post('/api/upload-media', upload.single('file'), async (req, res) => {
      const { token, groupId, type, name } = req.body;
      const file = req.file;

      if (!token || !groupId || !type || !name || !file) {
        return res.status(400).json({ success: false, message: 'Missing required parameters' });
      }

      try {
        const webManagementData = await this.readWebManagementToken(token);

        if (!webManagementData || webManagementData.groupId !== groupId) {
          return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (new Date() > new Date(webManagementData.expiresAt)) {
          return res.status(401).json({ success: false, message: 'Token expired' });
        }

        // Get database instance              
        const groupData = await this.database.getGroup(groupId);

        if (!groupData) {
          return res.status(404).json({ success: false, message: 'Group not found' });
        }

        // Save file  
        const fileName = `${Date.now()}-${file.originalname}`;
        const mediaPath = path.join(this.database.databasePath, "media");

        await fs.mkdir(mediaPath, { recursive: true }).catch(() => { });

        const filePath = path.join(mediaPath, fileName);
        await fs.copyFile(file.path, filePath);

        // Update group data  
        if (!groupData[type]) {
          groupData[type] = {};
        }

        groupData[type][name] = {
          file: fileName,
          uploadedAt: new Date().toISOString(),
          uploadedBy: webManagementData.requestNumber
        };

        // Add update timestamp  
        groupData.lastUpdated = new Date().toISOString();

        // Save the updated group  
        await this.database.saveGroup(groupData);

        // Signal bots to reload the group config  
        const updatesPath = path.join(this.database.databasePath, 'group_updates.json');
        let updates = {};

        try {
          const updatesData = await fs.readFile(updatesPath, 'utf8');
          updates = JSON.parse(updatesData);
        } catch (error) {
          // File might not exist, continue with empty object  
        }

        updates[groupId] = {
          timestamp: groupData.lastUpdated,
          updatedBy: 'webmanagement'
        };

        this.logger.info(`[management][${token}][${groupId}] Media '${type}' uplodaded: ${fileName}`);

        await fs.writeFile(updatesPath, JSON.stringify(updates, null, 2), 'utf8');

        return res.json({ success: true, fileName });
      } catch (error) {
        this.logger.error('Error uploading media:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
      } finally {
        // Remove temp file  
        if (req.file) {
          fs.unlink(req.file.path).catch(error => {
            this.logger.error('Error removing temp file:', error);
          });
        }
      }
    });


    // Serve media files
    // Ciclo da vida da ravena
    this.app.get('/ciclo-ravena', async (req, res) => {
      res.redirect('https://gemini.google.com/share/a03e1fe297de');
    });


    // Serve media files
    this.app.get('/qrimg/:botId', authenticateBasic, async (req, res) => {
      const { botId } = req.params;
      const filePath = path.join(this.database.databasePath, `qrcode_${botId}.png`);

      await fs.access(filePath).catch(() => {
        return res.status(404).send(`QRCode para '${botId}' não disponível.`);
      });

      res.setHeader("Content-Type", "image/png");
      res.sendFile(filePath);
    });

    this.app.get('/qrcode/:botId', authenticateBasic, async (req, res) => {
      const { botId } = req.params;

      const bot = this.bots.find(b => b.id === botId);
      if (!bot) {
        return res.status(404).json({
          status: 'error',
          message: `Bot com ID '${botId}' não encontrado`
        });
      }

      let formattedDate = new Date().toLocaleString('en-US', {
        timeZone: 'America/Sao_Paulo',
        hour12: false,
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });

      const instanceStatus = await bot._checkInstanceStatusAndConnect(true, true); // no retry
      const version = instanceStatus.instanceDetails.version ?? "?";
      const tipo = instanceStatus.instanceDetails.tipo ?? "?";

      const buttons = `
        <div style="margin: 1rem 0; display: flex; justify-content: center; gap: 10px;">
          <button onclick="window.location.reload()">Atualizar</button>
          <button onclick="fetchAndShow('/restart/${botId}', 'restart')">Reiniciar</button> <br>
          <button onclick="fetchAndShow('/logout/${botId}', 'reload')">Logout</button>
          <button onclick="fetchAndShow('/recreate/${botId}', 'recriar')">Recriar</button>
        </div>
      `;

      const statusPre = `<h2>Raw Instance Status</h2><pre id="status-box">${JSON.stringify(instanceStatus, null, "\t")}</pre>`;

      let pageContent = '';

      if (instanceStatus.extra?.ok) {
        pageContent = `
          <h2 style='color: green'>Conectado</h2>
          ${buttons}
          ${statusPre}
        `;
      } else {
        const pairingCodeContent = instanceStatus.extra?.connectData?.pairingCode ?? "xxx xxx";
        const codigoGerar = instanceStatus.extra?.connectData?.code ?? "";

        // Só gera se for um QRCode válido
        let qrCodeBase64 = "";
        let descQrCode = "Nenhum QRCode disponível";

        if (codigoGerar.length > 200 && !codigoGerar.includes("undefined")) {
          qrCodeBase64 = qrcode(codigoGerar);
          descQrCode = codigoGerar;
        }

        pageContent = `
          <h2>QR Code</h2>
          <img src="${qrCodeBase64}" alt="${descQrCode}">
          <h2>Pairing Code</h2>
          <pre style="text-align: center;font-size: 35pt;">${pairingCodeContent.split("] ").join("]")}</pre>
          ${buttons}
          ${statusPre}
        `;
      }

      const htmlResponse = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${botId} - ${formattedDate}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; background-color: #f7fafc; padding-top: 2rem; color: #2d3748; }
            .container { max-width: 400px; margin: 0 auto; padding: 1.5rem; background-color: white; border-radius: 0.75rem; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
            h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
            h2 { font-size: 1.25rem; font-weight: 500; margin-bottom: 0.5rem; }
            img { max-width: 100%; height: auto; margin: 1.5rem 0; border-radius: 0.5rem; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08); }
            pre { background-color: #e2e8f0; padding: 1rem; border-radius: 0.5rem; white-space: pre-wrap; word-wrap: break-word; font-family: monospace; color: #2d3748; text-align: left; }
            button { padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; background-color: #4299e1; color: white; font-weight: 600; cursor: pointer; transition: background-color 0.2s; }
            button:hover { background-color: #3182ce; }
            .container div { margin: 1rem 0; display: flex; justify-content: center; gap: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>${botId} - ${bot.phoneNumber}</h1>
            <h2>${formattedDate} - ${tipo} ${version}</h2>
            ${pageContent}
          </div>
          <script>
            const statusBox = document.getElementById('status-box');
            async function fetchAndShow(url, action) {
              if (!statusBox) return;
              if (!confirm('Tem certeza que deseja '+action+'?')) return;
              statusBox.textContent = 'Executando... Por favor, aguarde.';
              try {
                const response = await fetch(url); // Browser should send auth header
                const result = await response.json();
                statusBox.textContent = JSON.stringify(result, null, 2);
                if (action === 'reload' && response.ok) {
                  statusBox.textContent += \`\n\nAção concluída. Recarregando em 2 segundos...\`;
                  setTimeout(() => window.location.reload(), 2000);
                }
              } catch (error) {
                statusBox.textContent = \`Erro: \${error?.message}\n\${error?.stack}\`;
              }
            }
          </script>
        </body>
        </html>
      `;
      res.send(htmlResponse);
    });

    // Ciclo da vida da ravena
    this.app.get('/ciclo-ravena', async (req, res) => {
      res.redirect('https://gemini.google.com/share/a03e1fe297de');
    });


    // Groups !enviar public data
    this.app.get('/getData/:groupId/:variable', (req, res) => {
      const { groupId, variable } = req.params;

      res.setHeader('Content-Type', 'application/json');

      this.logger.info(`[getData] => '${variable}'@'${groupId}'`);

      if (groupId.length > 10 && groupId.endsWith("@g.us")) {
        const filePath = path.join(this.database.databasePath, `data-share`, `${groupId}.json`);

        fs.access(filePath).then(async () => {
          fs.readFile(filePath, 'utf8').then(data => {
            const groupDataShare = JSON.parse(data);

            if (groupDataShare[variable]) {
              const dados = groupDataShare[variable][0];

              if (dados) {
                // Remove daqui a 30 segundos
                setTimeout((gds, vari, fP) => {
                  gds[vari].shift();
                  if (gds[vari].length == 0) {
                    delete gds[vari];
                  }

                  fs.writeFile(fP, JSON.stringify(gds ?? {}, null, "\t"), "utf8");
                }, 30000, groupDataShare, variable, filePath);

                return res.status(200).send(JSON.stringify({ restantes: groupDataShare[variable]?.length ?? 0, dados }));
              } else {
                return res.status(200).send(JSON.stringify({ restantes: 0, dados: null }));
              }
            } else {
              return res.status(404).send(JSON.stringify({ erro: `'${variable}' indisponivel para '${groupId}'` }));
            }
          });
        }).catch(() => {
          return res.status(404).send(JSON.stringify({ erro: `Nenhum dado disponível para '${groupId}'` }));
        });
      } else {
        return res.status(400).send(JSON.stringify({ erro: `'${groupId}' não é válido` }));
      }
    });



    this.app.get('/media/:platform/:channel/:event/:type', async (req, res) => {
      const { platform, channel, event, type } = req.params;
      const token = req.query.token;

      if (!token) {
        return res.status(400).send('Token not provided');
      }

      try {
        const webManagementData = await this.readWebManagementToken(token);

        if (!webManagementData) {
          return res.status(401).send('Unauthorized');
        }

        if (new Date() > new Date(webManagementData.expiresAt)) {
          return res.status(401).send('Token expired');
        }

        // Get database instance                 
        const groupData = await this.database.getGroup(webManagementData.groupId);

        if (!groupData || !groupData[platform]) {
          return res.status(404).send('Platform not set');
        }

        const allPlatformData = groupData[platform].find(plt => plt.channel == channel);
        if (!allPlatformData) {
          return res.status(404).send('Channel not set');
        }

        let mediaFound = allPlatformData.onConfig?.media?.find(m => m.type == type);
        if (event == "off") {
          mediaFound = allPlatformData.offConfig?.media.find(m => m.type == type);
        }

        if (!mediaFound) {
          return res.status(404).send(`${type}@${event} not found`);
        }

        this.logger.info(mediaFound);

        const fileName = mediaFound.content;
        const filePath = path.join(this.database.databasePath, "media", fileName);
        this.logger.info(filePath);

        // Verify file exists  
        await fs.access(filePath).catch(() => {
          return res.status(404).send('File not found');
        });

        // Set content type  
        const ext = path.extname(fileName).toLowerCase();
        let contentType = 'application/octet-stream';

        switch (ext) {
          case '.jpg':
          case '.jpeg': contentType = 'image/jpeg'; break;
          case '.png': contentType = 'image/png'; break;
          case '.gif': contentType = 'image/gif'; break;
          case '.mp4': contentType = 'video/mp4'; break;
          case '.mp3': contentType = 'audio/mpeg'; break;
          case '.wav': contentType = 'audio/wav'; break;
        }

        res.setHeader('Content-Type', contentType);
        res.sendFile(filePath);
      } catch (error) {
        this.logger.error('Error serving media:', error);
        return res.status(500).send('Server error');
      }
    });

    // Dashboard: Get bots configuration
    this.app.get('/api/bots', authenticateBasic, async (req, res) => {
      try {
        const botsJsonPath = path.join(__dirname, '../bots.json');
        const data = await fs.readFile(botsJsonPath, 'utf8');
        res.json(JSON.parse(data));
      } catch (error) {
        if (error.code === 'ENOENT') {
          this.logger.warn('bots.json not found, returning empty array.');
          return res.json([]);
        }
        this.logger.error('Error reading bots.json:', error);
        res.status(500).json({ status: 'error', message: 'Failed to read bots configuration.' });
      }
    });

    // Dashboard: Save bots configuration
    this.app.post('/api/bots', authenticateBasic, async (req, res) => {
      const botsData = req.body;
      if (!Array.isArray(botsData)) {
        return res.status(400).json({ status: 'error', message: 'Invalid data format. Expected an array.' });
      }

      // Validation
      for (const bot of botsData) {
        if (typeof bot.enabled !== 'boolean' || !bot.nome || !bot.numero) {
          return res.status(400).json({ status: 'error', message: `Invalid entry: 'enabled' must be a boolean, 'nome' and 'numero' are required. Problematic entry: ${JSON.stringify(bot)}` });
        }
      }

      try {
        const botsJsonPath = path.join(__dirname, '../bots.json');
        await fs.writeFile(botsJsonPath, JSON.stringify(botsData, null, 2), 'utf8');
        res.json({ status: 'ok', message: 'Configuration saved successfully.' });
      } catch (error) {
        this.logger.error('Error writing to bots.json:', error);
        res.status(500).json({ status: 'error', message: 'Failed to save bots configuration.' });
      }
    });

    // Dashboard: Restart bot process
    this.app.post('/api/restart-bot', authenticateBasic, (req, res) => {
      this.logger.info('Received request to restart bot via API.');
      exec('pm2 restart ravena-ai', (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Error restarting bot: ${error.message}`);
          return res.status(500).json({ status: 'error', message: `Failed to restart bot: ${error.message}` });
        }
        if (stderr) {
          this.logger.warn(`Restart command stderr: ${stderr}`);
        }
        this.logger.info(`Restart command stdout: ${stdout}`);
        res.json({ status: 'ok', message: 'Bot restart command issued.', output: stdout });
      });
    });

    // Dashboard: Restart Evolution API
    this.app.post('/api/restart-evo', authenticateBasic, (req, res) => {
      this.logger.info('Received request to restart Evolution API via API.');
      exec('/home/moothz/daily-evo-restart.sh', (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Error restarting Evolution API: ${error.message}`);
          return res.status(500).json({ status: 'error', message: `Failed to restart Evolution API: ${error.message}` });
        }
        if (stderr) {
          this.logger.warn(`Evolution API restart command stderr: ${stderr}`);
        }
        this.logger.info(`Evolution API restart command stdout: ${stdout}`);
        res.json({ status: 'ok', message: 'Evolution API restart command issued.', output: stdout });
      });
    });

    // Dashboard: Stream logs
    this.app.get('/api/logs', authenticateBasic, (req, res) => {
      this.logger.info('Starting log stream to dashboard.');
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const logStream = spawn('pm2', ['logs', 'ravena-ai', '--raw']);

      logStream.stdout.on('data', (data) => {
        res.write(`data: ${data.toString()}\n\n`);
      });

      logStream.stderr.on('data', (data) => {
        res.write(`data: [ERROR] ${data.toString()}\n\n`);
      });

      req.on('close', () => {
        this.logger.info('Closing log stream to dashboard.');
        logStream.kill();
      });
    });
  }

  /**
   * Atualiza o cache de estatísticas detalhadas dos bots
   */
  async updateBotStatsCache() {
    this.logger.info('Atualizando cache de estatísticas detalhadas dos bots...');
    const now = Date.now();
    const periods = {
      year: now - 365 * 24 * 60 * 60 * 1000,
      month: now - 30 * 24 * 60 * 60 * 1000,
      week: now - 7 * 24 * 60 * 60 * 1000,
      day: now - 24 * 60 * 60 * 1000,
      hour: now - 60 * 60 * 1000
    };

    const statsData = [];
    const botsAtivos = this.bots.filter(b => !b.privado && !b.useTelegram && !b.useDiscord);

    // Totais gerais
    const totalStats = {
      id: 'TOTAL',
      groupsCount: 0,
      year: 0,
      month: 0,
      week: 0,
      day: 0,
      hour: 0
    };

    for (const bot of botsAtivos) {
      try {
        const groups = await bot.listGroups(); // Assume que retorna array de grupos
        const groupsCount = groups ? groups.length : 0;

        // Busca stats para cada período
        const periodPromises = Object.entries(periods).map(async ([key, startDate]) => {
          const stats = await bot.loadReport.getStatistics({
            startDate,
            endDate: now,
            botId: bot.id
          });
          return { key, total: stats.totalMessages };
        });

        const results = await Promise.all(periodPromises);
        const botStats = {
          id: bot.id,
          groupsCount,
          year: 0,
          month: 0,
          week: 0,
          day: 0,
          hour: 0
        };

        results.forEach(({ key, total }) => {
          botStats[key] = total;
          totalStats[key] += total;
        });

        totalStats.groupsCount += groupsCount;
        statsData.push(botStats);

      } catch (error) {
        this.logger.error(`Erro ao processar stats para bot ${bot.id}:`, error);
        statsData.push({
          id: bot.id,
          groupsCount: 0,
          year: 0, month: 0, week: 0, day: 0, hour: 0
        });
      }
    }

    // Adiciona o total ao final
    statsData.push(totalStats);

    this.botStatsCache = {
      lastUpdate: now,
      cacheTime: 30 * 60000,
      data: statsData
    };
    
    this.logger.info('Cache de estatísticas detalhadas atualizado.');
  }

  /**
   * Atualiza o cache de dados analíticos
   * @returns {Promise<void>}
   */
  async updateAnalyticsCache() {
    try {
      this.logger.info('Atualizando cache de dados analíticos...');

      // Obtém todos os relatórios de carga
      // Pegamos dados dos últimos 365 dias para análise anual
      const yearStart = new Date();
      yearStart.setDate(yearStart.getDate() - 365);

      const reports = await this.database.getLoadReports(yearStart.getTime());

      if (!reports || !Array.isArray(reports) || reports.length === 0) {
        this.logger.warn('Nenhum relatório de carga encontrado para processamento analítico');
        this.analyticsCache.lastUpdate = Date.now();
        return;
      }

      // Agrupa relatórios por bot
      const botReports = {};
      reports.forEach(report => {
        if (!botReports[report.botId]) {
          botReports[report.botId] = [];
        }
        botReports[report.botId].push(report);
      });

      // Processa dados para cada bot
      Object.keys(botReports).forEach(botId => {
        // Processa dados diários (por hora)
        this.analyticsCache.daily[botId] = this.processDailyData(botReports[botId]);

        // Processa dados semanais (por dia da semana)
        this.analyticsCache.weekly[botId] = this.processWeeklyData(botReports[botId]);

        // Processa dados mensais (por dia do mês)
        this.analyticsCache.monthly[botId] = this.processMonthlyData(botReports[botId]);

        // Processa dados anuais (por dia)
        this.analyticsCache.yearly[botId] = this.processYearlyData(botReports[botId]);
      });

      // Salva datas comuns para o gráfico anual
      const yearlyDates = new Set();
      Object.values(this.analyticsCache.yearly).forEach(data => {
        if (data && data.dates) {
          data.dates.forEach(date => yearlyDates.add(date));
        }
      });

      // Ordena as datas
      const sortedDates = Array.from(yearlyDates).sort();

      // Atualiza os dados de cada bot para usar as mesmas datas
      Object.keys(this.analyticsCache.yearly).forEach(botId => {
        const botData = this.analyticsCache.yearly[botId];
        if (botData) {
          // Cria novo array de valores baseado nas datas ordenadas
          const newValues = [];
          const dateValueMap = {};

          // Cria um mapa de data para valor
          if (botData.dates && botData.values) {
            for (let i = 0; i < botData.dates.length; i++) {
              dateValueMap[botData.dates[i]] = botData.values[i] ?? 0;
            }
          }

          // Preenche o novo array de valores com base nas datas ordenadas
          sortedDates.forEach(date => {
            newValues.push(dateValueMap[date] ?? 0);
          });

          // Atualiza o objeto de dados do bot
          this.analyticsCache.yearly[botId] = {
            dates: sortedDates,
            values: newValues
          };
        }
      });

      // Atualiza o timestamp da última atualização
      this.analyticsCache.lastUpdate = Date.now();
      this.logger.info('Cache de dados analíticos atualizado com sucesso');
    } catch (error) {
      this.logger.error('Erro ao atualizar cache de dados analíticos:', error);
    }
  }

  /**
   * Processa dados diários (por hora)
   * @param {Array} reports - Relatórios de carga
   * @returns {Object} - Dados processados
   */
  processDailyData(reports) {
    try {
      // Inicializa array de 24 posições para contagem por hora
      const hourCounts = Array(24).fill(0);
      const hourTotals = Array(24).fill(0);

      // Processa cada relatório
      reports.forEach(report => {
        if (report.period && report.period.start && report.messages) {
          const date = new Date(report.period.start);
          const hour = date.getHours();

          // Soma mensagens totais deste relatório
          const totalMsgs = (report.messages.totalReceived ?? 0) + (report.messages.totalSent ?? 0);

          // Adiciona ao contador de horas e totais
          hourCounts[hour]++;
          hourTotals[hour] += totalMsgs;
        }
      });

      // Calcula média por hora
      const hourlyAverages = hourTotals.map((total, index) => {
        const count = hourCounts[index];
        return count > 0 ? Math.round(total / count) : 0;
      });

      return {
        values: hourlyAverages
      };
    } catch (error) {
      this.logger.error('Erro ao processar dados diários:', error);
      return { values: Array(24).fill(0) };
    }
  }

  /**
   * Processa dados semanais (por dia da semana)
   * @param {Array} reports - Relatórios de carga
   * @returns {Object} - Dados processados
   */
  processWeeklyData(reports) {
    try {
      // Inicializa arrays para os 7 dias da semana
      const dayCounts = Array(7).fill(0);
      const dayTotals = Array(7).fill(0);

      // Processa cada relatório
      reports.forEach(report => {
        if (report.period && report.period.start && report.messages) {
          const date = new Date(report.period.start);
          const day = date.getDay(); // 0-6 (Domingo-Sábado)

          // Soma mensagens totais deste relatório
          const totalMsgs = (report.messages.totalReceived ?? 0) + (report.messages.totalSent ?? 0);

          // Adiciona ao contador de dias e totais
          dayCounts[day]++;
          dayTotals[day] += totalMsgs;
        }
      });

      // Calcula média por dia da semana
      const dailyAverages = dayTotals.map((total, index) => {
        const count = dayCounts[index];
        return count > 0 ? Math.round(total / count) : 0;
      });

      return {
        values: dailyAverages
      };
    } catch (error) {
      this.logger.error('Erro ao processar dados semanais:', error);
      return { values: Array(7).fill(0) };
    }
  }

  /**
   * Processa dados mensais (por dia do mês)
   * @param {Array} reports - Relatórios de carga
   * @returns {Object} - Dados processados
   */
  processMonthlyData(reports) {
    try {
      // Inicializa arrays para os 31 dias do mês
      const dayCounts = Array(31).fill(0);
      const dayTotals = Array(31).fill(0);

      // Processa cada relatório
      reports.forEach(report => {
        if (report.period && report.period.start && report.messages) {
          const date = new Date(report.period.start);
          const day = date.getDate() - 1; // 0-30

          // Soma mensagens totais deste relatório
          const totalMsgs = (report.messages.totalReceived ?? 0) + (report.messages.totalSent ?? 0);

          // Adiciona ao contador de dias e totais
          dayCounts[day]++;
          dayTotals[day] += totalMsgs;
        }
      });

      // Calcula média por dia do mês
      const monthlyAverages = dayTotals.map((total, index) => {
        const count = dayCounts[index];
        return count > 0 ? Math.round(total / count) : 0;
      });

      return {
        values: monthlyAverages
      };
    } catch (error) {
      this.logger.error('Erro ao processar dados mensais:', error);
      return { values: Array(31).fill(0) };
    }
  }

  /**
   * Processa dados anuais (por dia)
   * @param {Array} reports - Relatórios de carga
   * @returns {Object} - Dados processados
   */
  processYearlyData(reports) {
    try {
      // Mapeia totais diários
      const dailyTotals = {};

      // Processa cada relatório
      reports.forEach(report => {
        if (report.period && report.period.start && report.messages) {
          const date = new Date(report.period.start);
          const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD

          // Soma mensagens totais deste relatório
          const totalMsgs = (report.messages.totalReceived ?? 0) + (report.messages.totalSent ?? 0);

          // Adiciona ao total diário
          if (!dailyTotals[dateString]) {
            dailyTotals[dateString] = 0;
          }
          dailyTotals[dateString] += totalMsgs;
        }
      });

      // Converte para arrays ordenados por data
      const dates = Object.keys(dailyTotals).sort();
      const values = dates.map(date => dailyTotals[date] ?? 0);

      return {
        dates,
        values
      };
    } catch (error) {
      this.logger.error('Erro ao processar dados anuais:', error);
      return { dates: [], values: [] };
    }
  }

  /**
   * Filtra dados analíticos do cache com base no período e bots selecionados
   * @param {string} period - Período (today, week, month, year)
   * @param {Array} selectedBots - IDs dos bots selecionados
   * @returns {Object} - Dados filtrados
   */
  filterAnalyticsData(period, selectedBots) {
    try {
      // Prepara resultado
      const result = {
        status: 'ok',
        timestamp: Date.now(),
        daily: {},
        weekly: {},
        monthly: {},
        yearly: {}
      };

      // Função auxiliar para processar dados por período
      const processData = (periodKey) => {
        const periodData = this.analyticsCache[periodKey];
        const seriesData = [];

        // Para cada bot selecionado, adiciona uma série de dados
        selectedBots.forEach(botId => {
          if (periodData[botId]) {
            seriesData.push({
              name: botId,
              data: periodData[botId].values
            });
          }
        });

        // Retorna os dados formatados para o período
        return {
          hours: periodKey === 'daily' ? Array.from({ length: 24 }, (_, i) => i) : null,
          days: periodKey === 'weekly' ? ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] :
            periodKey === 'monthly' ? Array.from({ length: 31 }, (_, i) => i + 1) : null,
          dates: periodKey === 'yearly' ? (periodData.dates ?? []) : null,
          values: periodKey === 'daily' ?
            (selectedBots.length === 1 ? periodData[selectedBots[0]]?.values ?? [] : []) : null,
          series: seriesData
        };
      };

      // Processa dados para cada período
      result.daily = processData('daily');
      result.weekly = processData('weekly');
      result.monthly = processData('monthly');
      result.yearly = processData('yearly');

      return result;
    } catch (error) {
      this.logger.error('Erro ao filtrar dados analíticos:', error);
      return {
        status: 'error',
        message: 'Erro ao filtrar dados analíticos',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Notifica grupos sobre uma doação
   * @param {string} name - Nome do doador
   * @param {number} amount - Valor da doação
   * @param {string} message - Mensagem da doação
   */
  async notifyGroupsAboutDonation(name, amount, message, donationTotal = 0) {
    try {

      const ignorar = message.includes("#ravprivate") ?? false;

      // Prepara a mensagem de notificação
      const totalMsg = (donationTotal > 0) ? `> _${name}_ já doou um total de R$${donationTotal.toFixed(2)}\n\n` : "";

      const donationMsg =
        `💸 Recebemos um DONATE no tipa.ai! 🥳\n\n` +
        `*MUITO obrigado* pelos R$${amount.toFixed(2)}, ${name}! 🥰\n` +
        `Compartilho aqui com todos sua mensagem:\n` +
        `💬 ${message}\n\n${totalMsg}` +
        `\`\`\`!doar ou !donate pra conhecer os outros apoiadores e doar também\`\`\``;

      // Calcula tempo extra de fixação com base no valor da doação (300 segundos por 1 unidade de moeda)
      const extraPinTime = Math.floor(amount * 300);
      const pinDuration = 600 + extraPinTime; // Base de 10 minutos + tempo extra

      // Apenas um dos bots devem enviar msg sobre donate
      const bot = this.bots.find(b => b.notificarDonate) ?? this.bots[Math.floor(Math.random() * this.bots.length)];

      // Primeiro notifica o grupo de logs
      if (bot.grupoLogs) {
        try {
          await bot.sendMessage(bot.grupoLogs, donationMsg, { marcarTodos: true });
        } catch (error) {
          this.logger.error(`Erro ao enviar notificação de doação para grupoLogs (${bot.grupoLogs}):`, error);
        }
      }

      // Notifica o grupo de avisos
      if (bot.grupoAvisos && !ignorar) {
        try {
          const sentMsg = await bot.sendMessage(bot.grupoAvisos, donationMsg, { marcarTodos: true });

          // Tenta fixar a mensagem
          try {
            if (sentMsg && sentMsg.pin) {
              await sentMsg.pin(pinDuration);
            }
          } catch (pinError) {
            this.logger.error('Erro ao fixar mensagem no grupoAvisos:', pinError);
          }
        } catch (error) {
          this.logger.error(`Erro ao enviar notificação de doação para grupoAvisos (${bot.grupoAvisos}):`, error);
        }


        // Notifica o grupo de interação
        if (bot.grupoInteracao && !ignorar) {
          try {
            const sentMsg = await bot.sendMessage(bot.grupoInteracao, donationMsg, { marcarTodos: true });

            // Tenta fixar a mensagem
            try {
              if (sentMsg && sentMsg.pin) {
                await sentMsg.pin(pinDuration);
              }
            } catch (pinError) {
              this.logger.error('Erro ao fixar mensagem no grupoInteracao:', pinError);
            }
          } catch (error) {
            this.logger.error(`Erro ao enviar notificação de doação para grupoInteracao (${bot.grupoInteracao}):`, error);
          }
        }
      }
    } catch (error) {
      this.logger.error('Erro ao notificar grupos sobre doação:', error);
    }
  }

  /**
   * Limpa recursos antes de fechar
   */
  destroy() {
    // Para a atualização periódica do cache
    if (this.cacheUpdateInterval) {
      clearInterval(this.cacheUpdateInterval);
      this.cacheUpdateInterval = null;
    }
  }

  /**
   * Inicia o servidor API
   */
  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          this.logger.info(`Servidor API escutando na porta ${this.port}`);
          resolve();
        });
      } catch (error) {
        this.logger.error('Erro ao iniciar servidor API:', error);
        reject(error);
      }
    });
  }

  /**
   * Para o servidor API
   */
  stop() {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      // Limpa recursos
      this.destroy();

      try {
        this.server.close(() => {
          this.logger.info('Servidor API parado');
          this.server = null;
          resolve();
        });
      } catch (error) {
        this.logger.error('Erro ao parar servidor API:', error);
        reject(error);
      }
    });
  }

  /**
     * Adiciona uma instância de bot à API
     * @param {WhatsAppBot} bot - A instância do bot a adicionar
     */
  addBot(bot) {
    if (!this.bots.includes(bot)) {
      this.bots.push(bot);
    }
  }

  /**
   * Remove uma instância de bot da API
   * @param {WhatsAppBot} bot - A instância do bot a remover
   */
  removeBot(bot) {
    const index = this.bots.indexOf(bot);
    if (index !== -1) {
      this.bots.splice(index, 1);
    }
  }
}

module.exports = BotAPI;
