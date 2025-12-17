const fs = require('fs');
const path = require('path');
const Logger = require('./Logger');
const sqlite3 = require('sqlite3').verbose();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Classe Singleton Database para lidar com persistência baseada em JSON
 */
class Database {
  constructor() {
    this.logger = new Logger('database');
    this.databasePath = path.join(__dirname, '../../data');
    this.backupPath = path.join(__dirname, '../../data/backups');
    this.sqlite = sqlite3;
    this.sqlites = {};

    // Configurações de backup
    this.maxBackups = parseInt(process.env.MAX_BACKUPS) || 120; // 4 backups por dia por 30 dias
    this.scheduledBackupHours = [0, 6, 12, 18]; // Horários de backup agendados
    this.backupRetentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
    
    // Pastas a serem excluídas do backup
    this.excludedDirs = [
      this.backupPath,
      path.join(this.databasePath, 'media'),
      path.join(this.databasePath, 'lembretes-media')
    ];
    
    // Configuração para persistência em cache
    this.saveInterval = parseInt(process.env.SAVE_INTERVAL) || 60000; // 60 segundos
    this.dirtyFlags = {
      groups: false,
      commands: {},
      loadReports: false,
      donations: false,
      pendingJoins: false,
      softblocks: false
    };
    
    // Cache para objetos de banco de dados
    this.cache = {
      groups: null,
      commands: {},
      loadReports: null,
      donations: null,
      pendingJoins: null,
      softblocks: null
    };
    
    // Cria diretórios de banco de dados e backup se não existirem
    this.ensureDirectories();
    
    // Inicia o temporizador para salvar periodicamente os dados em cache
    this.startSaveTimer();
    
    // Configura backup programado
    this.setupScheduledBackups();
    
    // Flag para rastrear o backup mais recente
    this.lastScheduledBackup = this.getLastScheduledBackupTime();

    this.botInstances = [];
  }

  /**
   * Obtém a instância singleton
   * @returns {Database} A instância do banco de dados
   */
  static getInstance() {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  registerBotInstance(bot){
    this.logger.info(`[registerBotInstance] Registed: ${bot.id}`);
    this.botInstances.push(bot);
  }

  /**
   * Garante que os diretórios do banco de dados existam
   */
  ensureDirectories() {
    try {
      // Cria diretório de dados se não existir
      if (!fs.existsSync(this.databasePath)) {
        fs.mkdirSync(this.databasePath, { recursive: true });
      }
      
      // Cria diretório de backups se não existir
      if (!fs.existsSync(this.backupPath)) {
        fs.mkdirSync(this.backupPath, { recursive: true });
      }
      
      // Cria diretório custom-cmd se não existir
      const customCmdPath = path.join(this.databasePath, 'custom-cmd');
      if (!fs.existsSync(customCmdPath)) {
        fs.mkdirSync(customCmdPath, { recursive: true });
      }
    } catch (error) {
      this.logger.error('Erro ao garantir diretórios de banco de dados:', error);
    }
  }

  /**
   * Inicia o temporizador para salvar periodicamente os dados modificados
   */
  startSaveTimer() {
    setInterval(() => {
      this.persistCachedData();
    }, this.saveInterval);
    
    // Garantir que os dados sejam salvos quando o programa for encerrado
    process.on('SIGINT', () => {
      this.logger.info('Encerrando (int), salvando dados...');
      for(let bI of this.botInstances){
        this.logger.info(`[SIGINT] Destruindo bot '${bI.id}'`);
        bI.destroy();
      }

      this.persistCachedData(true);
    });
    
    process.on('SIGTERM', () => {
      this.logger.info('Encerrando (term), salvando dados...');
      for(let bI of this.botInstances){
        this.logger.info(`[SIGTERM] Destruindo bot '${bI.id}'`);
        bI.destroy();
      }
      this.persistCachedData(true);
    });
  }

  /**
   * Configura backups programados
   */
  setupScheduledBackups() {
    // Verificar a cada hora se devemos fazer um backup programado
    setInterval(() => {
      const now = new Date();
      const currentHour = now.getHours();
      
      // Verificar se estamos em uma hora de backup programado
      if (this.scheduledBackupHours.includes(currentHour)) {
        const lastBackupDate = new Date(this.lastScheduledBackup);
        
        // Verificar se já fizemos um backup nesta hora hoje
        if (
          lastBackupDate.getDate() !== now.getDate() ||
          lastBackupDate.getMonth() !== now.getMonth() ||
          lastBackupDate.getFullYear() !== now.getFullYear() ||
          lastBackupDate.getHours() !== currentHour
        ) {
          this.createScheduledBackup();
          this.lastScheduledBackup = now.getTime();
        }
      }
    }, 60000); // Verificar a cada minuto
  }

  /**
   * Obtém o timestamp do último backup programado
   * @returns {number} - Timestamp do último backup programado
   */
  getLastScheduledBackupTime() {
    try {
      const backupInfoPath = path.join(this.backupPath, 'backup-info.json');
      if (fs.existsSync(backupInfoPath)) {
        const backupInfo = JSON.parse(fs.readFileSync(backupInfoPath, 'utf8'));
        return backupInfo.lastScheduledBackup || 0;
      }
    } catch (error) {
      this.logger.error('Erro ao obter informações do último backup:', error);
    }
    return 0;
  }

  /**
   * Salva o timestamp do último backup programado
   * @param {number} timestamp - Timestamp a salvar
   */
  saveLastScheduledBackupTime(timestamp) {
    try {
      const backupInfoPath = path.join(this.backupPath, 'backup-info.json');
      const backupInfo = fs.existsSync(backupInfoPath)
        ? JSON.parse(fs.readFileSync(backupInfoPath, 'utf8'))
        : {};
      
      backupInfo.lastScheduledBackup = timestamp;
      fs.writeFileSync(backupInfoPath, JSON.stringify(backupInfo, null, 2), 'utf8');
    } catch (error) {
      this.logger.error('Erro ao salvar informações de backup:', error);
    }
  }

  /**
   * Cria um backup programado de todos os arquivos de dados
   */
  createScheduledBackup() {
    try {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(this.backupPath, timestamp);
      
      // Criar diretório para este backup
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      // Salvar todos os dados em cache primeiro
      this.persistCachedData(true);
      
      // Fazer backup de todos os arquivos na pasta data
      this.backupDirectory(this.databasePath, backupDir, this.excludedDirs);
      
      this.logger.info(`Backup programado criado: ${backupDir}`);
      
      // Atualizar o timestamp do último backup
      this.saveLastScheduledBackupTime(now.getTime());
      
      // Limpar backups antigos
      this.cleanupOldScheduledBackups();
    } catch (error) {
      this.logger.error('Erro ao criar backup programado:', error);
    }
  }

  /**
   * Faz backup de um diretório para outro
   * @param {string} sourceDir - Diretório de origem
   * @param {string} targetDir - Diretório de destino
   * @param {Array<string>} excludeDirs - Diretórios a serem excluídos
   */
  backupDirectory(sourceDir, targetDir, excludeDirs = []) {
    try {
      const items = fs.readdirSync(sourceDir);
      
      for (const item of items) {
        const sourcePath = path.join(sourceDir, item);
        const targetPath = path.join(targetDir, item);
        
        // Verificar se o item deve ser excluído
        if (excludeDirs.some(dir => sourcePath.startsWith(dir))) {
          this.logger.debug(`Diretório excluído do backup: ${sourcePath}`);
          continue;
        }
        
        const stats = fs.statSync(sourcePath);
        
        if (stats.isDirectory()) {
          // Criar o diretório no destino se não existir
          if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
          }
          
          // Recursivamente fazer backup do diretório
          this.backupDirectory(sourcePath, targetPath, excludeDirs);
        } else if (stats.isFile()) {
          // Fazer backup do arquivo
          fs.copyFileSync(sourcePath, targetPath);
        }
      }
    } catch (error) {
      this.logger.error(`Erro ao fazer backup do diretório ${sourceDir}:`, error);
    }
  }

  /**
   * Limpa backups programados antigos
   */
  cleanupOldScheduledBackups() {
    try {
      const now = Date.now();
      const retentionPeriod = this.backupRetentionDays * 24 * 60 * 60 * 1000;
      
      // Obter todos os diretórios de backup
      const backupDirs = fs.readdirSync(this.backupPath)
        .filter(item => {
          const fullPath = path.join(this.backupPath, item);
          return fs.statSync(fullPath).isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(item);
        })
        .map(dir => ({
          name: dir,
          path: path.join(this.backupPath, dir),
          // Extrai a data da string do ISO
          date: new Date(dir.replace(/-/g, (m, i) => i <= 10 ? m : i === 11 ? ':' : i === 14 ? ':' : '.')).getTime()
        }))
        .sort((a, b) => b.date - a.date); // mais recente primeiro
      
      // Manter os backups recentes e remover os antigos
      if (backupDirs.length > this.maxBackups) {
        const dirsToDelete = backupDirs.slice(this.maxBackups);
        
        for (const dir of dirsToDelete) {
          // Verificar também se o backup é mais antigo que o período de retenção
          if (now - dir.date > retentionPeriod) {
            this.deleteDirectory(dir.path);
            this.logger.info(`Backup antigo removido: ${dir.name}`);
          }
        }
      }
    } catch (error) {
      this.logger.error('Erro ao limpar backups antigos:', error);
    }
  }

  /**
   * Exclui um diretório e seu conteúdo
   * @param {string} dirPath - Caminho do diretório a excluir
   */
  deleteDirectory(dirPath) {
    try {
      if (fs.existsSync(dirPath)) {
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
          const itemPath = path.join(dirPath, item);
          
          if (fs.statSync(itemPath).isDirectory()) {
            this.deleteDirectory(itemPath);
          } else {
            fs.unlinkSync(itemPath);
          }
        }
        
        fs.rmdirSync(dirPath);
      }
    } catch (error) {
      this.logger.error(`Erro ao excluir diretório ${dirPath}:`, error);
    }
  }

  /**
   * Cria um backup de um arquivo individual
   * @param {string} filePath - Caminho para o arquivo a ser copiado
   */
  createBackup(filePath) {
    try {
      if (!fs.existsSync(filePath)) return;
      
      // Verificar se o arquivo está em um diretório excluído
      if (this.excludedDirs.some(dir => filePath.startsWith(dir))) {
        this.logger.debug(`Arquivo excluído do backup: ${filePath}`);
        return;
      }
      
      const fileName = path.basename(filePath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `${fileName}.${timestamp}.bak`;
      const backupFilePath = path.join(this.backupPath, backupFileName);
      
      fs.copyFileSync(filePath, backupFilePath);
      this.logger.debug(`Backup criado: ${backupFilePath}`);
      
      // Limpa backups antigos se maxBackups estiver definido
      this.cleanupOldBackups(fileName);
    } catch (error) {
      this.logger.error(`Erro ao criar backup para ${filePath}:`, error);
    }
  }
  
  /**
   * Limpa backups antigos de um arquivo
   * @param {string} fileName - Nome do arquivo base
   */
  cleanupOldBackups(fileName) {
    // Limpa apenas se maxBackups estiver definido para um número positivo
    if (!this.maxBackups || this.maxBackups <= 0) return;
    
    try {
      // Obtém todos os backups para este arquivo
      const backupFiles = fs.readdirSync(this.backupPath)
        .filter(file => file.startsWith(`${fileName}.`) && file.endsWith('.bak'))
        .sort()
        .reverse(); // mais recente primeiro
      
      // Se tivermos mais backups que maxBackups, exclui os mais antigos
      if (backupFiles.length > this.maxBackups) {
        const filesToDelete = backupFiles.slice(this.maxBackups);
        
        for (const file of filesToDelete) {
          const filePath = path.join(this.backupPath, file);
          fs.unlinkSync(filePath);
          this.logger.debug(`Backup antigo excluído: ${filePath}`);
        }
      }
    } catch (error) {
      this.logger.error(`Erro ao limpar backups antigos para ${fileName}:`, error);
    }
  }

  /**
   * Persiste todos os dados modificados em cache para os arquivos
   * @param {boolean} [force=false] - Forçar persistência mesmo se não estiver marcado como modificado
   */
  persistCachedData(force = false) {
    try {
      // Grupos
      if ((this.dirtyFlags.groups || force) && this.cache.groups) {
        const groupsPath = path.join(this.databasePath, 'groups.json');
        this.saveJSONToFile(groupsPath, this.cache.groups);
        this.dirtyFlags.groups = false;
        this.logger.info('Dados de grupos persistidos no arquivo');
      }
      
      // Comandos personalizados para cada grupo
      for (const groupId in this.dirtyFlags.commands) {
        if ((this.dirtyFlags.commands[groupId] || force) && this.cache.commands[groupId]) {
          const customCmdPath = path.join(this.databasePath, 'custom-cmd', `${groupId}.json`);
          this.saveJSONToFile(customCmdPath, this.cache.commands[groupId]);
          this.dirtyFlags.commands[groupId] = false;
          this.logger.info(`Comandos personalizados para o grupo ${groupId} persistidos no arquivo`);
        }
      }
      
      // Relatórios de carga
      if ((this.dirtyFlags.loadReports || force) && this.cache.loadReports) {
        const reportsPath = path.join(this.databasePath, 'load-reports.json');
        this.saveJSONToFile(reportsPath, this.cache.loadReports);
        this.dirtyFlags.loadReports = false;
        this.logger.info('Relatórios de carga persistidos no arquivo');
      }
      
      // Doações
      if ((this.dirtyFlags.donations || force) && this.cache.donations) {
        const donationsPath = path.join(this.databasePath, 'donations.json');
        this.saveJSONToFile(donationsPath, this.cache.donations);
        this.dirtyFlags.donations = false;
        this.logger.info('Doações persistidas no arquivo');
      }
      
      // Joins pendentes
      if ((this.dirtyFlags.pendingJoins || force) && this.cache.pendingJoins) {
        const joinsPath = path.join(this.databasePath, 'pending-joins.json');
        this.saveJSONToFile(joinsPath, this.cache.pendingJoins);
        this.dirtyFlags.pendingJoins = false;
        this.logger.info('Joins pendentes persistidos no arquivo');
      }

      // Softblocks
      if ((this.dirtyFlags.softblocks || force) && this.cache.softblocks) {
        const softblocksPath = path.join(this.databasePath, 'soft-blocks.json');
        this.saveJSONToFile(softblocksPath, this.cache.softblocks);
        this.dirtyFlags.softblocks = false;
        this.logger.info('Softblocks persistidos no arquivo');
      }
    } catch (error) {
      this.logger.error('Erro ao persistir dados em cache:', error);
    }
  }

  /**
   * Salva dados JSON em um arquivo com backup
   * @param {string} filePath - Caminho para salvar o arquivo JSON
   * @param {Object|Array} data - Os dados a serem salvos
   * @returns {boolean} - Status de sucesso
   */
  saveJSONToFile(filePath, data) {
    try {
      // Cria backup do arquivo existente
      this.createBackup(filePath);
      
      // Garante que o diretório exista
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Clona os dados para evitar modificações por referência
      const dataToSave = JSON.parse(JSON.stringify(data));
      
      // Use sistema de escrita segura para evitar corrupção
      const tempFilePath = `${filePath}.temp`;
      
      // Escreve em um arquivo temporário primeiro
      fs.writeFileSync(tempFilePath, JSON.stringify(dataToSave, null, 2), 'utf8');
      
      // Verifica se a escrita foi bem-sucedida tentando ler de volta
      try {
        const testRead = fs.readFileSync(tempFilePath, 'utf8');
        JSON.parse(testRead); // Verifica se é JSON válido
      } catch (readError) {
        this.logger.error(`Erro na verificação do arquivo temporário ${tempFilePath}:`, readError);
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        return false;
      }
      
      // Renomeia o arquivo temporário para o arquivo final
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      fs.renameSync(tempFilePath, filePath);
      
      return true;
    } catch (error) {
      this.logger.error(`Erro ao salvar JSON em ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Carrega dados JSON de um arquivo
   * @param {string} filePath - Caminho para o arquivo JSON
   * @returns {Object|Array|null} - Os dados JSON analisados ou null em caso de erro
   */
  loadJSON(filePath, debug = true) {
    try {
      if (!fs.existsSync(filePath)) {
        if(debug){
          this.logger.debug(`Arquivo não existe: ${filePath}`);
        }
        return null;
      }
      
      const data = fs.readFileSync(filePath, 'utf8');
      if (!data || data.trim() === '') {
        if(debug){
          this.logger.warn(`Arquivo está vazio: ${filePath}`);
        }
        return null;
      }
      
      try {
        return JSON.parse(data);
      } catch (parseError) {
        if(debug){
          this.logger.error(`Erro ao analisar JSON de ${filePath}:`, parseError);
        }
        // Tenta carregar do backup se disponível
        return this.loadLatestBackup(filePath);
      }
    } catch (error) {
      if(debug){
        this.logger.error(`Erro ao carregar JSON de ${filePath}:`, error);
      }
      
      // Tenta carregar do backup se disponível
      return this.loadLatestBackup(filePath);
    }
  }

  /**
   * Carrega o backup mais recente de um arquivo
   * @param {string} originalFilePath - Caminho do arquivo original
   * @returns {Object|Array|null} - Os dados JSON analisados ou null em caso de erro
   */
  loadLatestBackup(originalFilePath) {
    try {
      const fileName = path.basename(originalFilePath);
      const backupFiles = fs.readdirSync(this.backupPath)
        .filter(file => file.startsWith(`${fileName}.`) && file.endsWith('.bak'))
        .sort()
        .reverse();
      
      if (backupFiles.length === 0) {
        // Verificar se há um backup programado
        return this.loadFromScheduledBackup(originalFilePath);
      }
      
      // Carrega backup mais recente
      for (const backupFile of backupFiles) {
        try {
          const backupPath = path.join(this.backupPath, backupFile);
          this.logger.info(`Tentando carregar do backup: ${backupPath}`);
          
          const data = fs.readFileSync(backupPath, 'utf8');
          const parsed = JSON.parse(data);
          this.logger.info(`Backup carregado com sucesso: ${backupPath}`);
          return parsed;
        } catch (backupError) {
          this.logger.error(`Erro ao carregar backup ${backupFile}:`, backupError);
          // Continua tentando o próximo backup
        }
      }
      
      // Se todos os backups falharem, tenta restaurar de um backup programado
      return this.loadFromScheduledBackup(originalFilePath);
    } catch (error) {
      this.logger.error(`Erro ao carregar backup para ${originalFilePath}:`, error);
      return null;
    }
  }

  /**
   * Carrega um arquivo do backup programado mais recente
   * @param {string} originalFilePath - Caminho do arquivo original
   * @returns {Object|Array|null} - Os dados JSON analisados ou null em caso de erro
   */
  loadFromScheduledBackup(originalFilePath) {
    try {
      // Obter todos os diretórios de backup programado
      const backupDirs = fs.readdirSync(this.backupPath)
        .filter(item => {
          const fullPath = path.join(this.backupPath, item);
          return fs.statSync(fullPath).isDirectory() && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(item);
        })
        .map(dir => ({
          name: dir,
          path: path.join(this.backupPath, dir),
          date: new Date(dir.replace(/-/g, (m, i) => i <= 10 ? m : i === 11 ? ':' : i === 14 ? ':' : '.')).getTime()
        }))
        .sort((a, b) => b.date - a.date); // mais recente primeiro
      
      if (backupDirs.length === 0) {
        this.logger.error(`Nenhum backup programado encontrado para ${originalFilePath}`);
        return null;
      }
      
      // Caminho relativo ao diretório de dados
      const relativeFilePath = path.relative(this.databasePath, originalFilePath);
      
      // Tentar cada diretório de backup até encontrar o arquivo
      for (const backupDir of backupDirs) {
        const backupFilePath = path.join(backupDir.path, relativeFilePath);
        
        if (fs.existsSync(backupFilePath)) {
          try {
            this.logger.info(`Tentando carregar do backup programado: ${backupFilePath}`);
            const data = fs.readFileSync(backupFilePath, 'utf8');
            const parsed = JSON.parse(data);
            this.logger.info(`Backup programado carregado com sucesso: ${backupFilePath}`);
            
            // Restaurar o arquivo do backup
            const dir = path.dirname(originalFilePath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.copyFileSync(backupFilePath, originalFilePath);
            this.logger.info(`Arquivo restaurado do backup programado: ${originalFilePath}`);
            
            return parsed;
          } catch (backupError) {
            this.logger.error(`Erro ao carregar backup programado ${backupFilePath}:`, backupError);
            // Continua tentando o próximo backup
          }
        }
      }
      
      this.logger.error(`Nenhum backup programado válido encontrado para ${originalFilePath}`);
      return null;
    } catch (error) {
      this.logger.error(`Erro ao carregar do backup programado para ${originalFilePath}:`, error);
      return null;
    }
  }

  // Métodos para trabalhar com objetos de banco de dados específicos
  // Todos estes métodos foram modificados para usar o sistema de cache
  
  /**
   * Obtém todos os grupos
   * @returns {Array} - Array de objetos de grupo
   */
  async getGroups() {
    try {
      // Retorna do cache se disponível
      if (this.cache.groups) {
        return this.cache.groups;
      }
      
      const groupsPath = path.join(this.databasePath, 'groups.json');
      let groups = this.loadJSON(groupsPath);
      
      // Garante que groups seja um array
      if (!groups || !Array.isArray(groups)) {
        this.logger.warn('Arquivo de grupos ausente ou inválido, criando array vazio');
        groups = [];
        // Cria arquivo de grupos vazio se não existir
        this.saveJSONToFile(groupsPath, groups);
      }
      
      // Atualiza cache
      this.cache.groups = groups;
      
      return groups;
    } catch (error) {
      this.logger.error('Erro em getGroups:', error);
      return [];
    }
  }

  /**
   * Obtém um grupo específico por ID
   * @param {string} groupId - O ID do grupo
   * @returns {Object|null} - O objeto do grupo ou null se não encontrado
   */
  async getGroup(groupId) {
    const groups = await this.getGroups();
    return groups.find(group => group.id === groupId) || null;
  }

  /**
   * Obtém um grupo específico por nome
   * @param {string} groupId - O ID do grupo
   * @returns {Object|null} - O objeto do grupo ou null se não encontrado
   */
  async getGroupByName(groupName) {
    const groups = await this.getGroups();
    return groups.find(group => group.name === groupName) || null;
  }

  /**
   * Salva um grupo (apenas em cache)
   * @param {Object} group - O objeto do grupo a ser salvo
   * @returns {boolean} - Status de sucesso
   */
  async saveGroup(group) {
    try {
      // Obtém todos os grupos
      const groups = await this.getGroups();
      
      if (!Array.isArray(groups)) {
        this.logger.error('Groups não é um array em saveGroup:', groups);
        // Inicializa como array vazio se não for um array
        this.cache.groups = [];
        this.dirtyFlags.groups = true;
        return true;
      }
      
      // Encontra índice do grupo existente
      const index = groups.findIndex(g => g.id === group.id);
      
      if (index !== -1) {
        // Atualiza grupo existente
        groups[index] = { ...group };
        this.logger.debug(`[saveGroup] Grupo atualizado no índice ${index}`);
      } else {
        // Adiciona novo grupo
        groups.push({ ...group });
        this.logger.debug(`[saveGroup] Novo grupo adicionado ao array`);
      }
      
      
      // Marca como modificado
      this.dirtyFlags.groups = true;
      
      return true;
    } catch (error) {
      this.logger.error('Erro ao salvar grupo:', error);
      return false;
    }
  }
  
  /**
   * Verifica se um caminho está em um diretório excluído do backup
   * @param {string} filePath - Caminho do arquivo a verificar
   * @returns {boolean} - Verdadeiro se o caminho estiver em um diretório excluído
   */
  isInExcludedDirectory(filePath) {
    return this.excludedDirs.some(dir => filePath.startsWith(dir));
  }
  
  /**
   * Obtém comandos personalizados para um grupo
   * @param {string} groupId - O ID do grupo
   * @returns {Array} - Array de objetos de comando personalizado
   */
  async getCustomCommands(groupId) {
    // Retorna do cache se disponível
    if (this.cache.commands[groupId]) {
      return this.cache.commands[groupId];
    }
    
    const customCmdPath = path.join(this.databasePath, 'custom-cmd', `${groupId}.json`);
    const commands = this.loadJSON(customCmdPath, false) || [];
    
    // Atualiza cache
    this.cache.commands[groupId] = commands;
    
    return commands;
  }

  /**
   * Salva um comando personalizado para um grupo (apenas em cache)
   * @param {string} groupId - O ID do grupo
   * @param {Object} command - O objeto de comando a ser salvo
   * @returns {boolean} - Status de sucesso
   */
  async saveCustomCommand(groupId, command) {
    // Obtém todos os comandos personalizados para este grupo
    const commands = await this.getCustomCommands(groupId);
    
    // Encontra índice do comando existente
    const index = commands.findIndex(c => c.startsWith === command.startsWith);
    
    if (index !== -1) {
      // Atualiza comando existente
      commands[index] = command;
    } else {
      // Adiciona novo comando
      commands.push(command);
    }
    
    // Atualiza cache
    this.cache.commands[groupId] = commands;
    
    // Marca como modificado
    this.dirtyFlags.commands[groupId] = true;
    
    return true;
  }

  /**
   * Atualiza um comando personalizado existente (apenas em cache)
   * @param {string} groupId - O ID do grupo
   * @param {Object} command - O objeto de comando a atualizar
   * @returns {boolean} - Status de sucesso
   */
  async updateCustomCommand(groupId, command) {
    // Obtém todos os comandos personalizados para este grupo
    const commands = await this.getCustomCommands(groupId);
    
    // Encontra índice do comando existente
    const index = commands.findIndex(c => c.startsWith === command.startsWith);
    
    if (index !== -1) {
      // Atualiza comando existente
      commands[index] = command;
      
      // Atualiza cache
      this.cache.commands[groupId] = commands;
      
      // Marca como modificado
      this.dirtyFlags.commands[groupId] = true;
      
      return true;
    }
    
    return false;
  }

  /**
   * Exclui um comando personalizado (apenas em cache)
   * @param {string} groupId - O ID do grupo
   * @param {string} commandStart - O valor startsWith do comando
   * @returns {boolean} - Status de sucesso
   */
  async deleteCustomCommand(groupId, commandStart) {
    // Obtém todos os comandos personalizados para este grupo
    const commands = await this.getCustomCommands(groupId);
    
    // Encontra índice do comando existente
    const index = commands.findIndex(c => c.startsWith === commandStart);
    
    if (index !== -1) {
      // Marca comando como excluído
      commands[index].deleted = true;
      commands[index].active = false;
      
      // Atualiza cache
      this.cache.commands[groupId] = commands;
      
      // Marca como modificado
      this.dirtyFlags.commands[groupId] = true;
      
      return true;
    }
    
    return false;
  }

  /**
   * Obtém variáveis personalizadas
   * @returns {Object} - Objeto de variáveis personalizadas
   */
  async getCustomVariables() {
    // Retorna do cache se disponível
    if (this.cache.variables) {
      return this.cache.variables;
    }
    
    const variablesPath = path.join(this.databasePath, 'custom-variables.json');
    const variables = this.loadJSON(variablesPath) || {};
    
    // Atualiza cache
    this.cache.variables = variables;
    
    return variables;
  }

  /**
   * Salva variáveis personalizadas (apenas em cache)
   * @param {Object} variables - Objeto de variáveis personalizadas
   * @returns {boolean} - Status de sucesso
   */
  async saveCustomVariables(variables) {
    // Atualiza cache
    this.cache.variables = variables;
    
    // Marca como modificado
    this.dirtyFlags.variables = true;
    
    return true;
  }

  /**
   * Limpa cache para uma chave específica ou todo o cache se nenhuma chave for fornecida
   * @param {string} [key] - Chave de cache para limpar
   */
  clearCache(key) {
    if (key) {
      this.cache[key] = null;
    } else {
      this.cache = {
        groups: null,
        commands: {},
        loadReports: null,
        donations: null,
        pendingJoins: null
      };
    }
  }

  /**
   * Obtém relatórios de carga
   * @param {number} [since] - Obtém relatórios após este timestamp
   * @returns {Array} - Array de objetos de relatório de carga
   */
  async getLoadReports(since = 0) {
    try {
      // Retorna do cache se disponível
      if (this.cache.loadReports) {
        let reports = this.cache.loadReports;
        
        // Filtra relatórios por timestamp se 'since' for fornecido
        if (since > 0) {
          reports = reports.filter(report => report.period.end > since);
        }
        
        return reports;
      }
      
      const reportsPath = path.join(this.databasePath, 'load-reports.json');
      let reports = this.loadJSON(reportsPath) || [];
      
      // Atualiza cache
      this.cache.loadReports = reports;
      
      // Filtra relatórios por timestamp se 'since' for fornecido
      if (since > 0) {
        reports = reports.filter(report => report.period.end > since);
      }
      
      return reports;
    } catch (error) {
      this.logger.error('Erro ao obter relatórios de carga:', error);
      return [];
    }
  }

  /**
   * Salva relatórios de carga (apenas em cache)
   * @param {Array} reports - Array de objetos de relatório de carga
   * @returns {boolean} - Status de sucesso
   */
  async saveLoadReports(reports) {
    try {
      // Atualiza cache
      this.cache.loadReports = reports;
      
      // Marca como modificado
      this.dirtyFlags.loadReports = true;
      
      return true;
    } catch (error) {
      this.logger.error('Erro ao salvar relatórios de carga:', error);
      return false;
    }
  }

  /**
   * Obtém doações
   * @returns {Array} - Array de objetos de doação
   */
  async getDonations() {
    try {
      // Retorna do cache se disponível
      if (this.cache.donations) {
        return this.cache.donations;
      }
      
      const donationsPath = path.join(this.databasePath, 'donations.json');
      const donations = this.loadJSON(donationsPath) || [];
      
      // Atualiza cache
      this.cache.donations = donations;
      
      return donations;
    } catch (error) {
      this.logger.error('Erro ao obter doações:', error);
      return [];
    }
  }

  /**
   * Salva doações (apenas em cache)
   * @param {Array} donations - Array de objetos de doação
   * @returns {boolean} - Status de sucesso
   */
  async saveDonations(donations) {
    try {
      // Atualiza cache
      this.cache.donations = donations;
      
      // Marca como modificado
      this.dirtyFlags.donations = true;
      
      return true;
    } catch (error) {
      this.logger.error('Erro ao salvar doações:', error);
      return false;
    }
  }

  /**
   * Adiciona uma doação (apenas em cache)
   * @param {string} name - Nome do doador
   * @param {number} amount - Valor da doação
   * @param {string} [numero] - Número do WhatsApp (opcional)
   * @returns {boolean} - Status de sucesso
   */
  async addDonation(name, amount, numero = undefined) {
    try {
        const donations = await this.getDonations();
        const existingIndex = donations.findIndex(d => d.nome.toLowerCase() === name.toLowerCase());
        const now = Date.now();
        const historyEntry = { ts: now, valor: amount };

        let donationTotal;
        if (existingIndex !== -1) {
            const donor = donations[existingIndex];
            donor.valor += amount;
            donor.timestamp = now;
            
            if (!donor.historico || !Array.isArray(donor.historico)) {
                donor.historico = [];
            }
            donor.historico.push(historyEntry);

            if (numero) {
                donor.numero = numero;
            }
            donationTotal = donor.valor;
        } else {
            donations.push({
                nome: name,
                valor: amount,
                numero,
                timestamp: now,
                historico: [historyEntry]
            });
            donationTotal = amount;
        }

        this.cache.donations = donations;
        this.dirtyFlags.donations = true;

        return donationTotal === 0 ? true : donationTotal;
    } catch (error) {
        this.logger.error('Erro ao adicionar doação:', error);
        return false;
    }
  }

  /**
   * Atualiza número do doador (apenas em cache)
   * @param {string} name - Nome do doador
   * @param {string} numero - Número do WhatsApp
   * @returns {boolean} - Status de sucesso
   */
  async updateDonorNumber(name, numero) {
    try {
      // Obtém doações existentes
      const donations = await this.getDonations();
      
      // Encontra doador
      const donor = donations.find(d => d.nome.toLowerCase() === name.toLowerCase());
      
      if (!donor) {
        this.logger.warn(`Doador "${name}" não encontrado`);
        return false;
      }
      
      // Atualiza número
      donor.numero = numero;
      
      // Atualiza cache
      this.cache.donations = donations;
      
      // Marca como modificado
      this.dirtyFlags.donations = true;
      
      return true;
    } catch (error) {
      this.logger.error('Erro ao atualizar número do doador:', error);
      return false;
    }
  }

  /**
   * Atualiza valor da doação (apenas em cache)
   * @param {string} name - Nome do doador
   * @param {number} amount - Valor a adicionar (pode ser negativo)
   * @returns {boolean} - Status de sucesso
   */
  async updateDonationAmount(name, amount) {
    try {
        const donations = await this.getDonations();
        let donor = donations.find(d => d.nome.toLowerCase() === name.toLowerCase());
        const now = Date.now();
        const historyEntry = { ts: now, valor: amount };

        if (!donor) {
            if (amount > 0) {
                this.logger.warn(`Doador "${name}" não encontrado, criando...`);
                donor = {
                    nome: name,
                    valor: amount,
                    timestamp: now,
                    historico: [historyEntry]
                };
                donations.push(donor);
            } else {
                this.logger.warn(`Doador "${name}" não encontrado, não é possível adicionar valor negativo.`);
                return false;
            }
        } else {
            donor.valor += amount;
            donor.timestamp = now;
            if (!donor.historico || !Array.isArray(donor.historico)) {
                donor.historico = [];
            }
            donor.historico.push(historyEntry);
        }

        if (donor.valor <= 0) {
            const donorIndex = donations.findIndex(d => d.nome.toLowerCase() === name.toLowerCase());
            if (donorIndex > -1) {
                donations.splice(donorIndex, 1);
            }
            this.logger.warn(`Doador "${name}" foi removido da lista.`);
        }
        
        this.cache.donations = donations;
        this.dirtyFlags.donations = true;
        
        return true;
    } catch (error) {
        this.logger.error('Erro ao atualizar valor da doação:', error);
        return false;
    }
  }

  /**
   * Une dois doadores (apenas em cache)
   * @param {string} targetName - Nome do doador a manter
   * @param {string} sourceName - Nome do doador a fundir
   * @returns {boolean} - Status de sucesso
   */
  async mergeDonors(targetName, sourceName) {
    try {
        const donations = await this.getDonations();
        const targetIndex = donations.findIndex(d => d.nome.toLowerCase() === targetName.toLowerCase());
        const sourceIndex = donations.findIndex(d => d.nome.toLowerCase() === sourceName.toLowerCase());

        if (targetIndex === -1 || sourceIndex === -1) {
            this.logger.warn(`Um ou ambos os doadores não encontrados para união: "${targetName}", "${sourceName}"`);
            return false;
        }

        const targetDonor = donations[targetIndex];
        const sourceDonor = donations[sourceIndex];

        // Une valores
        targetDonor.valor += sourceDonor.valor;

        // Une históricos e ordena por data
        const sourceHistory = sourceDonor.historico || [];
        const targetHistory = targetDonor.historico || [];
        targetDonor.historico = [...targetHistory, ...sourceHistory].sort((a, b) => a.ts - b.ts);
        
        // Mantém número de origem se o alvo não tiver um
        if (!targetDonor.numero && sourceDonor.numero) {
            targetDonor.numero = sourceDonor.numero;
        }

        // Atualiza para o timestamp mais recente do histórico combinado
        if (targetDonor.historico.length > 0) {
            targetDonor.timestamp = targetDonor.historico[targetDonor.historico.length - 1].ts;
        } else if (sourceDonor.timestamp && (!targetDonor.timestamp || sourceDonor.timestamp > targetDonor.timestamp)) {
             // Fallback para dados antigos sem histórico
            targetDonor.timestamp = sourceDonor.timestamp;
        }
        
        // Remove doador de origem
        donations.splice(sourceIndex, 1);
        
        this.cache.donations = donations;
        this.dirtyFlags.donations = true;
        
        return true;
    } catch (error) {
        this.logger.error('Erro ao unir doadores:', error);
        return false;
    }
  }

  /**
   * Obtém joins pendentes
   * @returns {Array} - Array de objetos de join pendente
   */
  async getPendingJoins() {
    try {
      // Retorna do cache se disponível
      if (this.cache.pendingJoins) {
        return this.cache.pendingJoins;
      }
      
      const joinsPath = path.join(this.databasePath, 'pending-joins.json');
      const joins = this.loadJSON(joinsPath) || [];
      
      // Atualiza cache
      this.cache.pendingJoins = joins;
      
      return joins;
    } catch (error) {
      this.logger.error('Erro ao obter joins pendentes:', error);
      return [];
    }
  }

  /**
   * Salva joins pendentes (apenas em cache)
   * @param {Array} joins - Array de objetos de join pendente
   * @returns {boolean} - Status de sucesso
   */
  async savePendingJoins(joins) {
    try {
      // Atualiza cache
      this.cache.pendingJoins = joins;
      
      // Marca como modificado
      this.dirtyFlags.pendingJoins = true;
      
      return true;
    } catch (error) {
      this.logger.error('Erro ao salvar joins pendentes:', error);
      return false;
    }
  }

  /**
   * Salva um join pendente (apenas em cache)
   * @param {string} inviteCode - Código do convite
   * @param {Object} data - Dados do join (authorId, authorName)
   * @returns {boolean} - Status de sucesso
   */
  async savePendingJoin(inviteCode, data) {
    try {
      // Obtém joins pendentes existentes
      const joins = await this.getPendingJoins();
      
      // Adiciona ou atualiza o join pendente
      const existingIndex = joins.findIndex(join => join.code === inviteCode);
      
      if (existingIndex !== -1) {
        // Atualiza existente
        joins[existingIndex] = { 
          code: inviteCode,
          authorId: data.authorId,
          authorName: data.authorName,
          timestamp: Date.now()
        };
      } else {
        // Adiciona novo
        joins.push({
          code: inviteCode,
          authorId: data.authorId,
          authorName: data.authorName,
          timestamp: Date.now()
        });
      }
      
      // Atualiza cache
      this.cache.pendingJoins = joins;
      
      // Marca como modificado
      this.dirtyFlags.pendingJoins = true;
      
      return true;
    } catch (error) {
      this.logger.error('Erro ao salvar join pendente:', error);
      return false;
    }
  }

  /**
   * Remove um join pendente (apenas em cache)
   * @param {string} inviteCode - Código do convite
   * @returns {boolean} - Status de sucesso
   */
  async removePendingJoin(inviteCode) {
    try {
      // Obtém joins existentes
      let joins = await this.getPendingJoins();
      
      // Filtra o join
      joins = joins.filter(join => join.code !== inviteCode);
      
      // Atualiza cache
      this.cache.pendingJoins = joins;
      
      // Marca como modificado
      this.dirtyFlags.pendingJoins = true;
      
      return true;
    } catch (error) {
      this.logger.error('Erro ao remover join pendente:', error);
      return false;
    }
  }

  async getSoftblocks() {
    try {
      if (this.cache.softblocks) {
        return this.cache.softblocks;
      }
      
      const softblocksPath = path.join(this.databasePath, 'soft-blocks.json');
      const softblocks = this.loadJSON(softblocksPath) || [];
      
      this.cache.softblocks = softblocks;
      
      return softblocks;
    } catch (error) {
      this.logger.error('Erro ao obter softblocks:', error);
      return [];
    }
  }

  async toggleUserInvites(phoneNumber, block) {
    try {
      const softblocks = await this.getSoftblocks();
      const userIndex = softblocks.findIndex(u => u.numero === phoneNumber);

      if (block) {
        if (userIndex === -1) {
          softblocks.push({ numero: phoneNumber, invites: true });
        } else {
          softblocks[userIndex].invites = true;
        }
      } else {
        if (userIndex !== -1) {
          softblocks.splice(userIndex, 1);
        }
      }

      this.cache.softblocks = softblocks;
      this.dirtyFlags.softblocks = true;

      return true;
    } catch (error) {
      this.logger.error('Erro ao alternar bloqueio de convites do usuário:', error);
      return false;
    }
  }

  async isUserInviteBlocked(phoneNumber) {
    try {
      const softblocks = await this.getSoftblocks();
      const user = softblocks.find(u => u.numero === phoneNumber);
      return user ? user.invites : false;
    } catch (error) {
      this.logger.error('Erro ao verificar se o convite do usuário está bloqueado:', error);
      return false;
    }
  }
  
  /**
   * Força a persistência de todos os dados modificados
   * @returns {Promise<boolean>} - Status de sucesso
   */
  async forcePersist() {
    try {
      await this.persistCachedData(true);
      return true;
    } catch (error) {
      this.logger.error('Erro ao forçar persistência:', error);
      return false;
    }
  }


  // SQLite
  getSQLiteDb(name, schema){
    if(!this.sqlites[name]){
      this.logger.info(`[database][getSQLiteDb] Carregando base de dados SQLite '${name}'`);

      const databasesFolder = path.join(this.databasePath, "sqlites");
      if (!fs.existsSync(databasesFolder)) {
        fs.mkdirSync(databasesFolder, { recursive: true });
      }

      const dbPath = path.join(databasesFolder, `${name}.db`);
      this.sqlites[name] = new sqlite3.Database(dbPath);

      // Initialize database structure
      this.sqlites[name].serialize(() => {
        this.sqlites[name].run(schema, (err) => {
          if (err) {
            logger.error(`Erro ao inicializar base ${name}:`, { schema, err });
          }
        });
      });
    }

    return this.sqlites[name];
  }

  /**
   * Promisified db.run, db.all and db.get
   */
  dbRun(dbName, sql, params = []) {
    const db = this.sqlites[dbName];
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  dbAll(dbName, sql, params = []) {
    const db = this.sqlites[dbName];
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  dbGet(dbName, sql, params = []) {
    const db = this.sqlites[dbName];
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

}

module.exports = Database;

