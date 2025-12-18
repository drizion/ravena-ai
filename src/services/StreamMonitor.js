const axios = require('axios');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { parse } = require('node-html-parser');
const Database = require('../utils/Database');
const Logger = require('../utils/Logger');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class StreamMonitor extends EventEmitter {
  // Propriedade estática para armazenar a instância única
  static instance = null;
  
  /**
   * Obtém a instância singleton do StreamMonitor
   * @param {Array} [channels=[]] - Canais iniciais para monitorar (usado apenas na primeira instanciação)
   * @returns {StreamMonitor} A instância única do StreamMonitor
   */
  static getInstance(channels = [], totalBots = 50) {
    if (!StreamMonitor.instance) {
      StreamMonitor.instance = new StreamMonitor(channels, totalBots);
    }
    return StreamMonitor.instance;
  }

  constructor(channels = [], totalBots = 50) {
    
    // Se já existir uma instância, retorna ela
    if (StreamMonitor.instance) {
      return StreamMonitor.instance;
    }
    
    super();

    this.setMaxListeners(totalBots);

    this.database = Database.getInstance();
    //this.monitoringDbPath = path.join(this.database.databasePath, "monitoramento.json"); // Deprecated
    this.dbNameMonitor = "stream_monitor";
    this.dbNameYt = "ytchannels";

    this.channels = [];
    this.streamStatuses = {};
    this.twitchToken = null;
    this.kickToken = null; // Added for Kick token
    this.twitchClientId = process.env.TWITCH_CLIENT_ID;
    this.twitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
    this.kickClientId = process.env.KICK_CLIENT_ID;
    this.kickClientSecret = process.env.KICK_CLIENT_SECRET;

    this.pollingInterval = 60000*3; // 3 minute default polling interval
    this.pollingIntervalBatches = 30000; // between batches
    this.pollingTimers = {
      twitch: null,
      kick: null,
      youtube: null
    };

    this.youtubeNotFounds = {};
    
    // Flag para verificar se o monitoramento está ativo
    this.isMonitoring = false;
    this.isReady = false;

    this.logger = new Logger('stream-monitor');
    this.logger.info('Service StreamMonitor carregado (modo singleton - SQLite)');
    
    // Initialize database
    this.initPromise = this._initDatabase();
    
    this.initPromise.then(() => {
        this.isReady = true;
        this.logger.info('StreamMonitor SQLite pronto.');
        // Subscribe to initial channels if provided
        if (channels.length > 0) {
            channels.forEach(channel => {
                this.subscribe(channel.name, channel.source);
            });
        }
    });
    
    // Define esta instância como a instância singleton
    StreamMonitor.instance = this;
  }

  /**
   * Initialize the monitoring database
   * @private
   */
  async _initDatabase() {
    try {
        // Stream Monitor DB
        await this.database.getSQLiteDb(this.dbNameMonitor, `
            CREATE TABLE IF NOT EXISTS monitored_channels (
                name TEXT NOT NULL,
                platform TEXT NOT NULL,
                subscribed_at TEXT,
                PRIMARY KEY (name, platform)
            );
            CREATE TABLE IF NOT EXISTS stream_status (
                platform TEXT NOT NULL,
                channel_name TEXT NOT NULL,
                is_live INTEGER DEFAULT 0,
                title TEXT,
                game TEXT,
                thumbnail TEXT,
                viewer_count INTEGER,
                started_at TEXT,
                last_checked TEXT,
                last_video_id TEXT,
                last_video_data TEXT,
                PRIMARY KEY (platform, channel_name)
            );
        `);

        // YouTube Cache DB
        await this.database.getSQLiteDb(this.dbNameYt, `
            CREATE TABLE IF NOT EXISTS channel_cache (
                channel_handle TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL
            );
        `);

        await this._loadStateFromDB();

    } catch (error) {
        this.logger.error('Error initializing database:', error);
    }
  }

  /**
   * Load state from SQLite to memory
   * @private
   */
  async _loadStateFromDB() {
      try {
        // Load channels
        const channelRows = await this.database.dbAll(this.dbNameMonitor, "SELECT * FROM monitored_channels");
        const loadedChannels = channelRows.map(r => ({ 
            name: r.name, 
            source: r.platform, 
            subscribedAt: r.subscribed_at 
        }));

        // Merge with potentially already subscribed channels (memory)
        for (const ch of loadedChannels) {
            const exists = this.channels.find(c => c.name.toLowerCase() === ch.name.toLowerCase() && c.source === ch.source);
            if (!exists) {
                this.channels.push(ch);
            }
        }

        // Load statuses
        const statusRows = await this.database.dbAll(this.dbNameMonitor, "SELECT * FROM stream_status");
        for(const row of statusRows) {
            const key = `${row.platform}:${row.channel_name.toLowerCase()}`;
            
            // If already in memory (updated by early polls or subscribes), don't overwrite with old DB data
            if (this.streamStatuses[key] && this.streamStatuses[key].lastChecked) {
                continue;
            }

            let lastVideo = null;
            if (row.last_video_data) {
                try {
                    lastVideo = JSON.parse(row.last_video_data);
                } catch(e) {}
            }

            this.streamStatuses[key] = {
                isLive: !!row.is_live,
                title: row.title,
                game: row.game,
                thumbnail: row.thumbnail,
                viewerCount: row.viewer_count,
                startedAt: row.started_at,
                lastChecked: row.last_checked,
                lastVideo: lastVideo,
                platform: row.platform,
                channelName: row.channel_name
            };
        }
        
        this.logger.info(`Loaded ${this.channels.length} channels and ${statusRows.length} statuses from DB.`);
      } catch (error) {
          this.logger.error('Error loading state from DB:', error);
      }
  }

  /**
   * Save channel to DB
   * @private
   */
  async _saveChannelToDB(channel) {
      try {
          await this.database.dbRun(this.dbNameMonitor, `
              INSERT OR REPLACE INTO monitored_channels (name, platform, subscribed_at)
              VALUES (?, ?, ?)
          `, [channel.name, channel.source, channel.subscribedAt]);
      } catch (error) {
          this.logger.error(`Error saving channel ${channel.name} to DB:`, error);
      }
  }

  /**
   * Remove channel from DB
   * @private
   */
  async _removeChannelFromDB(channelName, platform) {
      try {
          await this.database.dbRun(this.dbNameMonitor, `
              DELETE FROM monitored_channels WHERE name = ? AND platform = ?
          `, [channelName, platform]);
          
          await this.database.dbRun(this.dbNameMonitor, `
              DELETE FROM stream_status WHERE channel_name = ? AND platform = ?
          `, [channelName, platform]);
      } catch (error) {
          this.logger.error(`Error removing channel ${channelName} from DB:`, error);
      }
  }

  /**
   * Update stream status in DB
   * @private
   */
  async _updateStatusInDB(key, status) {
      try {
          const [platform, channelName] = key.split(':');
          const lastVideoData = status.lastVideo ? JSON.stringify(status.lastVideo) : null;
          const lastVideoId = status.lastVideo ? status.lastVideo.id : null;

          await this.database.dbRun(this.dbNameMonitor, `
              INSERT OR REPLACE INTO stream_status 
              (platform, channel_name, is_live, title, game, thumbnail, viewer_count, started_at, last_checked, last_video_id, last_video_data)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
              status.platform || platform, 
              status.channelName || channelName, 
              status.isLive ? 1 : 0, 
              status.title, 
              status.game, 
              status.thumbnail, 
              status.viewerCount, 
              status.startedAt, 
              status.lastChecked,
              lastVideoId,
              lastVideoData
          ]);
      } catch (error) {
          this.logger.error(`Error updating status for ${key} in DB:`, error);
      }
  }

  /**
   * Start monitoring all channels
   */
  async startMonitoring() {
    // Wait for initialization
    await this.initPromise;

    // Evita iniciar o monitoramento várias vezes
    if (this.isMonitoring) {
      this.logger.info('O monitoramento de streams já está ativo (ignorando chamada duplicada)');
      return;
    }
    
    // Stop any existing polling
    this.stopMonitoring();
    
    // Start new polling for each platform
    this.pollingTimers.twitch = setInterval(() => this._pollTwitchChannels(), this.pollingInterval);
    this.pollingTimers.kick = setInterval(() => this._pollKickChannels(), this.pollingInterval);
    this.pollingTimers.youtube = setInterval(() => this._pollYoutubeChannels(), this.pollingInterval);
    
    // Do an initial poll
    this._pollTwitchChannels();
    this._pollKickChannels();
    this._pollYoutubeChannels();
    
    this.isMonitoring = true;
    this.logger.info('Monitoramento de streams iniciado');
  }

  /**
   * Stop monitoring all channels
   */
  stopMonitoring() {
    Object.keys(this.pollingTimers).forEach(platform => {
      if (this.pollingTimers[platform]) {
        clearInterval(this.pollingTimers[platform]);
        this.pollingTimers[platform] = null;
      }
    });
    
    this.isMonitoring = false;
    this.logger.info('Monitoramento de streams interrompido');
  }

  /**
   * Set the polling interval for all platforms
   * @param {number} interval - Polling interval in milliseconds
   */
  setPollingInterval(interval, delay = 60000) {
    this.pollingInterval = interval;
    // Restart monitoring with new interval
    if (Object.values(this.pollingTimers).some(timer => timer !== null)) {
      setTimeout(this.startMonitoring, delay);
    }
  }

  /**
   * Subscribe to a channel
   * @param {string} channelName - The name of the channel
   * @param {string} source - The source platform (twitch, kick, youtube)
   * @returns {boolean} - Success status
   */
  subscribe(channelName, source) {
    if (!['twitch', 'kick', 'youtube'].includes(source.toLowerCase())) {
      this.logger.error(`Invalid source: ${source}. Must be 'twitch', 'kick', or 'youtube'`);
      return false;
    }

    const normalizedSource = source.toLowerCase();
    const existingChannel = this.channels.find(
      c => c.name.toLowerCase() === channelName.toLowerCase() && 
           c.source.toLowerCase() === normalizedSource
    );

    if (!existingChannel) {
      const newChannel = {
        name: channelName,
        source: normalizedSource,
        subscribedAt: new Date().toISOString()
      };

      this.channels.push(newChannel);
      
      // Initialize status for this channel
      const channelKey = `${normalizedSource}:${channelName.toLowerCase()}`;
      if (!this.streamStatuses[channelKey]) {
        this.streamStatuses[channelKey] = {
          isLive: false,
          lastVideo: null,
          lastChecked: null,
          platform: normalizedSource,
          channelName: channelName
        };
      }
      
      this._saveChannelToDB(newChannel);
      this._updateStatusInDB(channelKey, this.streamStatuses[channelKey]);
      
      return true;
    }
    
    return false; // Already subscribed
  }

  /**
   * Unsubscribe from a channel
   * @param {string} channelName - The name of the channel
   * @param {string} source - The source platform
   * @returns {boolean} - Success status
   */
  unsubscribe(channelName, source) {
    const normalizedSource = source.toLowerCase();
    const initialLength = this.channels.length;
    
    this.channels = this.channels.filter(
      c => !(c.name.toLowerCase() === channelName.toLowerCase() && 
             c.source.toLowerCase() === normalizedSource)
    );
    
    // Remove status for this channel
    const channelKey = `${normalizedSource}:${channelName.toLowerCase()}`;
    if (this.streamStatuses[channelKey]) {
      delete this.streamStatuses[channelKey];
    }
    
    // Remove from DB
    this._removeChannelFromDB(channelName, normalizedSource);
    
    return this.channels.length < initialLength;
  }

  /**
   * Get the status of all monitored streams
   * @returns {Object} - Status object
   */
  getStreamStatus() {
    return this.streamStatuses;
  }

  /**
   * Get the status of a specific channel
   * @param {string} channelName - The name of the channel
   * @param {string} source - The source platform
   * @returns {Object|null} - Channel status or null if not found
   */
  getChannelStatus(channelName, source) {
    const channelKey = `${source.toLowerCase()}:${channelName.toLowerCase()}`;
    return this.streamStatuses[channelKey] || null;
  }

  /**
   * Get list of all subscribed channels
   * @returns {Array} - List of channel objects
   */
  getSubscribedChannels() {
    return this.channels;
  }

  logErrorToFile(filename, error){
    try{
      const logErrorFile = path.join(this.database.databasePath, filename);
      fs.writeFileSync(logErrorFile, error, 'utf8');
    } catch(e){
      this.logger.error(`[logErrorFile] Erro gravando log em arquivo`, e.message);
    }
  }

   /**
   * Refresh the Twitch API token or load existing token if still valid
   * @private
   * @returns {Promise<string|null>} - The valid token or null on error
   */
  async _refreshTwitchToken() {
    try {
      const tokenFilePath = path.join(this.database.databasePath, "twitch-token.json");
      
      // Check if we have a saved token that's still valid
      if (fs.existsSync(tokenFilePath)) {
          const tokenData = JSON.parse(fs.readFileSync(tokenFilePath, 'utf8'));
          // If token is less than 15 days old, reuse it
          const now = Date.now();
          const tokenAge = now - tokenData.timestamp;
          const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
          
          if (tokenAge < fifteenDaysMs && tokenData.access_token) {
              this.logger.info('Using existing Twitch token (less than 15 days old)');
              this.twitchToken = tokenData.access_token;
              return this.twitchToken;
          }
      }
      
      // Request a new token
      this.logger.info(`Requesting new Twitch API token`);
      
      const response = await axios.post('https://id.twitch.tv/oauth2/token', {
        client_id: this.twitchClientId,
        client_secret: this.twitchClientSecret,
        grant_type: 'client_credentials',
      });
      
      if (response.status === 200 && response.data && response.data.access_token) {
        const tokenData = {
          ...response.data,
          timestamp: Date.now()
        };
        fs.writeFileSync(tokenFilePath, JSON.stringify(tokenData, null, 2), 'utf8');
        
        this.twitchToken = response.data.access_token;
        this.logger.info('Successfully obtained and saved new Twitch token');
        return this.twitchToken;
      } else {
        this.logger.error(`Unexpected Twitch token response: ${JSON.stringify(response.data)}`);
        return null;
      }
    } catch (error) {
      this.logger.error(`Error refreshing Twitch token: ${error.message}`);
      return null;
    }
  }

  /**
   * Refresh the Kick API token or load existing token if still valid
   * @private
   * @returns {Promise<string|null>} - The valid token or null on error
   */
  async _refreshKickToken() {
    try {
        const tokenFilePath = path.join(this.database.databasePath, "kick-token.json");

        // Check if we have a saved, unexpired token
        if (fs.existsSync(tokenFilePath)) {
            const tokenData = JSON.parse(fs.readFileSync(tokenFilePath, 'utf8'));
            if (tokenData.expires_at && Date.now() < tokenData.expires_at) {
                this.logger.info('Using existing Kick token.');
                this.kickToken = tokenData.access_token;
                return this.kickToken;
            }
        }

        // Request a new token
        this.logger.info(`Requesting new Kick API token`);
        
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', this.kickClientId);
        params.append('client_secret', this.kickClientSecret);

        const response = await axios.post('https://id.kick.com/oauth/token', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (response.status === 200 && response.data && response.data.access_token) {
            const tokenData = {
                ...response.data,
                // Calculate expiration time (expires_in is in seconds)
                expires_at: Date.now() + (response.data.expires_in * 1000)
            };
            fs.writeFileSync(tokenFilePath, JSON.stringify(tokenData, null, 2), 'utf8');
            
            this.kickToken = response.data.access_token;
            this.logger.info('Successfully obtained and saved new Kick token.');
            return this.kickToken;
        } else {
            this.logger.error(`Unexpected Kick token response: ${JSON.stringify(response.data)}`);
            return null;
        }
    } catch (error) {
        this.logger.error(`Error refreshing Kick token (${this.kickClientId}): ${error.message}`);
        return null;
    }
  }


  shuffle (array){ 
    for (let i = array.length - 1; i > 0; i--) { 
      const j = Math.floor(Math.random() * (i + 1)); 
      [array[i], array[j]] = [array[j], array[i]]; 
    } 
    return array; 
  }

  /**
   * Verifica se um canal da Twitch existe
   * @param {string} channelName - Nome do canal a verificar
   * @returns {Promise<boolean>} - True se o canal existir, false caso contrário
   */
  async twitchChannelExists(channelName) {
    try {
      // Ensure we have a valid token
      if (!this.twitchToken) {
        const token = await this._refreshTwitchToken();
        if (!token) return false; // Can't proceed without token
      }
      
      // Normalize channel name
      const normalizedChannelName = channelName.toLowerCase().trim();
      
      // Query Twitch API to check if the user exists
      const userResponse = await axios.get(
        `https://api.twitch.tv/helix/users`,
        {
          headers: {
            'Client-ID': this.twitchClientId,
            'Authorization': `Bearer ${this.twitchToken}`
          },
          params: {
            login: normalizedChannelName
          }
        }
      );
      
      // If we got data and at least one user, the channel exists
      return userResponse.data && 
             userResponse.data.data && 
             userResponse.data.data.length > 0;
             
    } catch (error) {
      // If unauthorized, try to refresh token and try again
      if (error.response && error.response.status === 401) {
        await this._refreshTwitchToken();
        // Try one more time with the new token
        try {
          const userResponse = await axios.get(
            `https://api.twitch.tv/helix/users`,
            {
              headers: {
                'Client-ID': this.twitchClientId,
                'Authorization': `Bearer ${this.twitchToken}`
              },
              params: {
                login: channelName.toLowerCase().trim()
              }
            }
          );
          
          return userResponse.data && 
                 userResponse.data.data && 
                 userResponse.data.data.length > 0;
        } catch (retryError) {
          this.logger.error(`Error checking if Twitch channel exists (retry): ${channelName}`, retryError.message);
          return true;
        }
      }
      
      this.logger.error(`Error checking if Twitch channel exists: ${channelName}`, error.message);
      return true;
    }
  }

  async cleanupChannelList(channelsObj){
    try {
      let channels = channelsObj.map(ch => ch.name);
      this.logger.info(`[cleanupChannelList] Algum dos canais desta lista pode estar com erro, verificando todos: `, channels);
      const groups = await this.database.getGroups();


      const channelsToRemove = [];

      // Processa cada grupo
      for(let channelCheck of channels){
        // Procura quais grupos tem esse canal

        let channelHasGroup = false;
        for (const group of groups) {
          if (group.twitch && Array.isArray(group.twitch)) {
            for (const gpChannel of group.twitch) {
              if(gpChannel.channel == channelCheck){
                channelHasGroup = true;

                if(channelCheck.includes("http://") || channelCheck.includes("https://")){
                  this.logger.info(`[cleanupChannelList] Canal Twitch formato de link: ${channelCheck} - Removendo do grupo ${group.id} (${group.name ?? 'sem nome'})`);
                  channelsToRemove.push(channelCheck.toLowerCase());
                  continue;
                }

                // Ok, canal está num grupo e não é link, mas esse canal existe?
                const channelExists = await this.twitchChannelExists(channelCheck);
              
                if (!channelExists) {
                  this.logger.info(`[cleanupChannelList] Canal Twitch não encontrado: ${channelCheck} - Removendo do grupo ${group.id} (${group.name ?? 'sem nome'})`);
                  channelsToRemove.push(channelCheck.toLowerCase());
                  continue;
                } else {
                  this.logger.info(`[cleanupChannelList] ${channelCheck} @ (${group.name ?? 'sem nome'}), ok, existe!`);
                }
                await sleep(500);  // API da twitch fica nervosa com spam
              }
            }
          }
        }  

        // Passei por todos os grupos mas não encontrei o canal, só dá unsubscribe
        // Provavelmente chegou aqui pq configuraram errado e depois removeram antes do bot mesmo remover
        if(!channelHasGroup){
            const resUnsub = await this.unsubscribe(channelCheck, 'twitch');
            this.logger.info(`[cleanupChannelList] Canal Twitch não está em grupo algum: ${channelCheck} - Apenas unsubscribe ${resUnsub}`);
        }
      }

      for (const group of groups) {
        if (channelsToRemove.length > 0) {
          group.twitch = group.twitch.filter(c => !channelsToRemove.includes(c.channel.toLowerCase()));
          await this.database.saveGroup(group);
          this.logger.info(`[cleanupChannelList] Removidos ${channelsToRemove.length} canais inexistentes do grupo ${group.id}`, channelsToRemove);
        }
      }
    } catch (error) {
      this.logger.error('[cleanupChannelList] Erro ao fazer limpeza dos canais:', error);
    }
  }

  /**
   * Poll Twitch channels for status updates
   * @private
   */
  async _pollTwitchChannels(customChannels = null) {
    const twitchChannels = this.shuffle(customChannels ?? this.channels.filter(c => c.source.toLowerCase() === 'twitch'));
    if (twitchChannels.length === 0) return;
    
    // Ensure we have a valid token
    if (!this.twitchToken) {
      const token = await this._refreshTwitchToken();
      if (!token) return; // Can't proceed without token
    }
    
    // Split channels into batches of 100 (Twitch API limit)
    const channelBatches = [];
    for (let i = 0; i < twitchChannels.length; i += 75) {
      channelBatches.push(twitchChannels.slice(i, i + 75));
    }
    
    const totalBatches = channelBatches.length;
    this.logger.info(`[__pollTwitchChannels][${customChannels ? 'Retry' : ''}] Polling ${twitchChannels.length} twitch channels in ${totalBatches} batches.`);

    let bAt = 0;
    const failedBatches = [];
    for (const batch of channelBatches) {
      bAt += 1;
      //this.logger.info(`[_pollTwitchChannels][${bAt}/${totalBatches}] Polling ${batch.length} channels...`);
      try {
        // First get user IDs from login names
        const userResponse = await axios.get(
          `https://api.twitch.tv/helix/users`,
          {
            headers: {
              'Client-ID': this.twitchClientId,
              'Authorization': `Bearer ${this.twitchToken}`
            },
            params: {
              login: batch.map(c => this.sanitizePlatformChannelName(c.name.toLowerCase(), "twitch"))
            }
          }
        );
        
        const userIds = userResponse.data.data.map(user => user.id);
        
        // Then get stream status for these users
        const streamResponse = await axios.get(
          `https://api.twitch.tv/helix/streams`,
          {
            headers: {
              'Client-ID': this.twitchClientId,
              'Authorization': `Bearer ${this.twitchToken}`
            },
            params: {
              user_id: userIds
            }
          }
        );
        
        // Process the results
        const liveStreams = streamResponse.data.data;
        const liveStreamUserIds = liveStreams.map(stream => stream.user_id);
        
        // Update status for each channel and emit events for changes
        for(const user of userResponse.data.data) {
          const channelName = user.login;
          const channelKey = `twitch:${channelName.toLowerCase()}`;
          const isLiveNow = liveStreamUserIds.includes(user.id);
          const wasLive = this.streamStatuses[channelKey]?.isLive ?? false;
          const liveStream = liveStreams.find(stream => stream.user_id === user.id);
          
          // Create or update status
          if (!this.streamStatuses[channelKey]) {
            this.streamStatuses[channelKey] = {
              isLive: isLiveNow,
              lastChecked: new Date().toISOString(),
              platform: "twitch",
              channelName: channelName
            };
          } else {
            this.streamStatuses[channelKey].isLive = isLiveNow;
            this.streamStatuses[channelKey].lastChecked = new Date().toISOString();
          }
          
          // Add stream details if live
          if (isLiveNow && liveStream) {
            this.streamStatuses[channelKey].title = liveStream.title;
            this.streamStatuses[channelKey].thumbnail = liveStream.thumbnail_url
              .replace('{width}', '640')
              .replace('{height}', '360');
            this.streamStatuses[channelKey].viewerCount = liveStream.viewer_count;
            this.streamStatuses[channelKey].platform = "twitch";
            this.streamStatuses[channelKey].channelName = channelName;
            this.streamStatuses[channelKey].startedAt = liveStream.started_at;
            this.streamStatuses[channelKey].game = liveStream.game_name;

          }
          
          // Emit events for status changes
          if (isLiveNow && !wasLive) {
            this.emit('streamOnline', {
              platform: 'twitch',
              channelName: channelName,
              title: liveStream.title,
              game: liveStream.game_name,
              thumbnail: liveStream.thumbnail_url
                .replace('{width}', '640')
                .replace('{height}', '360'),
              viewerCount: liveStream.viewer_count,
              startedAt: liveStream.started_at
            });
          } else if (!isLiveNow && wasLive) {
            this.emit('streamOffline', {
              platform: 'twitch',
              channelName: channelName
            });
          }
          
          // Update DB
          await this._updateStatusInDB(channelKey, this.streamStatuses[channelKey]);
        }
        
      } catch (error) {
        // If unauthorized, try to refresh token
        if (error.response && error.response.status === 401) {
          await this._refreshTwitchToken();
        } else {
          failedBatches.push(batch);
          this.logger.error('Error polling Twitch channels, adding to failed batch:', error.message);
          this.logErrorToFile(`twitch-batch${bAt}-errors.json`, JSON.stringify(error, null, "\t"));
        }
      }

      await sleep(3000);
    }

    if(failedBatches.length > 0){
      if(customChannels){
        this.logger.warn(`[_pollTwitchChannels] Error polling ${failedBatches.length} batches while retrying, checking channels.`);
        this.cleanupChannelList(customChannels);
      } else {
        this.logger.warn(`[_pollTwitchChannels] Error polling ${failedBatches.length} batches, trying again.`);
        this._pollTwitchChannels(failedBatches.flat(1));
      }
    }
  }

  /**
   * Poll Kick channels for status updates
   * @private
   */
  async _pollKickChannels() {
    const kickChannels = this.channels.filter(c => c.source.toLowerCase() === 'kick');
    if (kickChannels.length === 0) return;

    // Ensure we have a valid token
    if (!this.kickToken) {
        const token = await this._refreshKickToken();
        if (!token) return; // Can't proceed without a token
    }

    // Split channels into batches (using 100 as a safe limit)
    const channelBatches = [];
    for (let i = 0; i < kickChannels.length; i += 100) {
        channelBatches.push(kickChannels.slice(i, i + 100));
    }

    this.logger.info(`[_pollKickChannels] Polling ${kickChannels.length} Kick channels in ${channelBatches.length} batches.`);

    for (const batch of channelBatches) {
        try {
            const slugs = [...new Set(batch.map(c => this.sanitizePlatformChannelName(c.name ?? "", "kick")))]
            .filter(Boolean) // remove strings avazias
            .map(name => `slug=${encodeURIComponent(name.substring(0, 25))}`)
            .join("&");

            const kickRequestParameters = {
                headers: {
                    'Authorization': `Bearer ${this.kickToken}`,
                    'Accept': 'application/json'
                }
            };

            this.logger.info(`[_pollKickChannels] Slugs: '${slugs}'`);
            const response = await axios.get(`https://api.kick.com/public/v1/channels?${slugs}`, kickRequestParameters);

            if (response.status === 200 && response.data) {
                const liveData = new Map(response.data.data.map(ch => [ch.slug.toLowerCase(), ch]));
                this.logger.info(`[_pollKickChannels] Response: '${JSON.stringify(liveData, null, '\t')}'`);

                // Update status for all channels in the batch
                for (const channel of batch) {
                    const channelKey = `kick:${channel.name.toLowerCase()}`;
                    const channelData = liveData.get(channel.name.toLowerCase());
                    const isLiveNow = !!(channelData && channelData.stream && channelData.stream.is_live);
                    const wasLive = this.streamStatuses[channelKey]?.isLive ?? false;

                    // Create or update status
                    if (!this.streamStatuses[channelKey]) {
                        this.streamStatuses[channelKey] = {};
                    }
                    this.streamStatuses[channelKey].isLive = isLiveNow;
                    this.streamStatuses[channelKey].lastChecked = new Date().toISOString();
                    this.streamStatuses[channelKey].platform = "kick";
                    this.streamStatuses[channelKey].channelName = channel.name;
                    
                    // Add stream details if live
                    if (isLiveNow) {
                        const stream = channelData.stream;
                        this.streamStatuses[channelKey].title = stream.stream_title;
                        this.streamStatuses[channelKey].thumbnail = stream.thumbnail;
                        this.streamStatuses[channelKey].viewerCount = stream.viewer_count;
                        this.streamStatuses[channelKey].startedAt = stream.start_time;
                        this.streamStatuses[channelKey].game = channelData.category ? channelData.category.name : 'Unknown';
                    }

                    // Emit events for status changes
                    if (isLiveNow && !wasLive) {
                        const stream = channelData.stream;
                        this.emit('streamOnline', {
                            platform: 'kick',
                            channelName: channelData.slug,
                            title: stream.stream_title,
                            game: channelData.category ? channelData.category.name : 'Unknown',
                            thumbnail: stream.thumbnail,
                            viewerCount: stream.viewer_count,
                            startedAt: stream.start_time
                        });
                    } else if (!isLiveNow && wasLive) {
                        this.emit('streamOffline', {
                            platform: 'kick',
                            channelName: channel.name
                        });
                    }
                    
                    // Update DB
                    await this._updateStatusInDB(channelKey, this.streamStatuses[channelKey]);
                }
            } else {
              this.logger.warn(`[_pollKickChannels] Error? ${response.status}`);
            }
        } catch (error) {
            if (error.response && error.response.status === 401) {
                this.logger.warn('[_pollKickChannels] Kick token unauthorized. Refreshing token for next poll.');
                // Force a refresh on the next cycle by clearing the current token
                this.kickToken = null; 
                await this._refreshKickToken();
            } else {
                this.logger.error(`[_pollKickChannels] Error polling Kick channels: ${error.message}`, { channels: batch });
            }
        }
        // Add a small delay between batches to avoid rate limiting
        await sleep(1000);
    }
  }

  extractChannelID(html) {
    // Regular expression to match YouTube channel URLs
    const regex = /youtube\.com\/channel\/(UC[\w-]+)/g;
    
    // Find all matches
    const matches = [...html.matchAll(regex)];
    
    // Extract channel IDs
    const channelIDs = matches.map(match => match[1]);
    
    // Count occurrences of each channel ID
    const counts = {};
    channelIDs.forEach(id => {
      counts[id] = (counts[id] ?? 0) + 1;
    });
    
    // Find the ID with the highest count
    let mostFrequentID = null;
    let highestCount = 0;
    
    for (const [id, count] of Object.entries(counts)) {
      if (count > highestCount) {
        highestCount = count;
        mostFrequentID = id;
      }
    }
    
    return mostFrequentID;
  }

  /**
   * Poll YouTube channels for status updates and new videos
   * @private
   */
   async getYtChannelID(ch){
    // Aberrações que tentam definir
    let channel = ch.includes("/") ? ch.split("/").at(-1) : ch;
    channel = channel.replace("@", "");

    // Check Cache DB
    try {
        const row = await this.database.dbGet(this.dbNameYt, `
            SELECT channel_id FROM channel_cache WHERE channel_handle = ?
        `, [channel]);
        
        if (row && row.channel_id) {
            return row.channel_id;
        }
    } catch(err) {
        this.logger.error(`[getYtChannelID] Error checking cache DB:`, err);
    }

    const chUrls = [`https://www.youtube.com/c/${channel}`, `https://www.youtube.com/@${channel}`];
    for(let chUrl of chUrls){
      try {
        //this.logger.debug(`[getYtChannelID] Tentando: ${chUrl}`);
        const resolveResponse = await axios.get(chUrl);
        
        let exID = this.extractChannelID(resolveResponse.data);

        if(exID){
          //this.logger.debug(`[getYtChannelID] Extraido ID do canal '${channel}': ${exID}`);
          
          // Save to Cache DB
          await this.database.dbRun(this.dbNameYt, `
            INSERT OR REPLACE INTO channel_cache (channel_handle, channel_id)
            VALUES (?, ?)
          `, [channel, exID]);
          
          return exID;
        }

      } catch (error) {
        this.logger.error(`[getYtChannelID] Erro tentando buscar YouTube channel ID para '${chUrl}':`, error.message);
      }
    }

    return null;
  }

  async _pollYoutubeChannels() {
    const youtubeChannels = this.channels.filter(c => c.source.toLowerCase() === 'youtube');
    if (youtubeChannels.length === 0) return;
    
    for (const channel of youtubeChannels) {
      try {
        // First, resolve channel name to channel ID if needed
        let channelId = this.sanitizePlatformChannelName(channel.name, "youtube");
        
        // If it's not a channel ID format, try to resolve it
        if (!channelId.startsWith('UC')) {
          //this.logger.debug(`[getYtChannelID] ${channelId} não é ID, vou tentar buscar`);
          channelId = await this.getYtChannelID(channelId) ?? channelId;
        }

        //this.logger.debug(`[_pollYoutubeChannels] Buscando videos para o channelID: ${channelId}`);
        
        // Get channel info and latest videos using RSS feed
        const response = await axios.get(
          `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
        );
        
        const channelKey = `youtube:${channel.name.toLowerCase()}`;
        
        // Parse the XML
        const parser = new (require('xml2js')).Parser({ explicitArray: false });
        const feed = await parser.parseStringPromise(response.data);
        
        if (!feed.feed || !feed.feed.entry || !Array.isArray(feed.feed.entry)) {
          // No videos or invalid response
          continue;
        }

        // Canal encontrado, a princípio, reseta se tiver erro anterior
        this.youtubeNotFounds[channel.name] = 0;
        
        // Get the latest video/stream
        const entries = Array.isArray(feed.feed.entry) ? feed.feed.entry : [feed.feed.entry];
        
        if (entries.length === 0) continue;
        
        const latestEntry = entries[0];
        const videoId = latestEntry['yt:videoId'];
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        // Initialize channel status if needed
        if (!this.streamStatuses[channelKey]) {
          this.streamStatuses[channelKey] = {
            isLive: false,
            lastVideo: null,
            lastChecked: new Date().toISOString(),
            platform: "youtube",
            channelName: channel.name
          };
        }
        
        // Check if this is a new video
        const lastVideoId = this.streamStatuses[channelKey]?.lastVideo?.id ?? '';
        if (videoId !== lastVideoId) {
          // Get more details about the video to determine if it's a livestream
          const videoResponse = await axios.get(`https://www.youtube.com/watch?v=${videoId}`);
          const html = videoResponse.data;
          
          // Look for live indicators in page source
          const isLiveNow = html.includes('"isLiveNow":true') || 
                            html.includes('"isLive":true') ||
                            html.includes('"liveBroadcastDetails"');
                            
          // Update status
          this.streamStatuses[channelKey].lastChecked = new Date().toISOString();
          this.streamStatuses[channelKey].lastVideo = {
            id: videoId,
            title: latestEntry.title,
            url: videoUrl,
            publishedAt: latestEntry.published,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`  // Best quality thumbnail
          };
          
          // If it's a livestream, update live status
          const wasLive = this.streamStatuses[channelKey].isLive;
          if (isLiveNow) {
            this.streamStatuses[channelKey].isLive = true;
            
            if (!wasLive) {
              // Emit streamOnline event
              this.emit('streamOnline', {
                platform: 'youtube',
                channelName: channel.name,
                title: latestEntry.title,
                thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                url: videoUrl,
                videoId: videoId
              });
            }
          } else {
            // If it was live before but not now, emit offline event
            if (wasLive) {
              this.streamStatuses[channelKey].isLive = false;
              this.emit('streamOffline', {
                platform: 'youtube',
                channelName: channel.name
              });
            }
            
            // Emit new video event
            this.emit('newVideo', {
              platform: 'youtube',
              channelName: channel.name,
              title: latestEntry.title,
              thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
              url: videoUrl,
              videoId: videoId,
              publishedAt: latestEntry.published
            });
          }
        } else {
          // Check if an existing livestream ended
          if (this.streamStatuses[channelKey].isLive) {
            try {
              const videoResponse = await axios.get(`https://www.youtube.com/watch?v=${videoId}`);
              const html = videoResponse.data;
              const isStillLive = html.includes('"isLiveNow":true') || 
                                 html.includes('"isLive":true');
              
              if (!isStillLive) {
                this.streamStatuses[channelKey].isLive = false;
                this.emit('streamOffline', {
                  platform: 'youtube',
                  channelName: channel.name
                });
              }
            } catch (error) {
              this.logger.error(`Error checking YouTube live status for ${channel.name}:`, error.message);
            }
          }
        }
        
        // Update DB
        await this._updateStatusInDB(channelKey, this.streamStatuses[channelKey]);

      } catch (error) {
        // Verifica se é um erro 404 (canal não encontrado)
        if (error.response && error.response.status === 404) {
          if(!this.youtubeNotFounds[channel.name]){
            this.youtubeNotFounds[channel.name] = 1;
            this.logger.warn(`Canal do YouTube não encontrado: '${channel.name}'. Iniciando monitoramento de not-found para ser removido.`);
          } else {
            this.youtubeNotFounds[channel.name]++;

            this.logger.warn(`Canal do YouTube não encontrado (${this.youtubeNotFounds[channel.name]} vezes): '${channel.name}'.`);
            if(this.youtubeNotFounds[channel.name] > 5){
              this.logger.warn(`Canal do YouTube não encontrado: '${channel.name}' muitas vezes. Removendo do monitoramento.`);

              // Remove o canal do monitoramento
              this.unsubscribe(channel.name, 'youtube');
              
              // Tenta enviar uma mensagem para todos os grupos que monitoram este canal
              try {
                // Obtém todos os grupos
                const groups = await this.database.getGroups();
                
                // Filtra grupos que monitoram este canal
                for (const group of groups) {
                  if (Array.isArray(group.youtube)) {
                    const channelConfig = group.youtube.find(c => 
                      c.channel.toLowerCase() === channel.name.toLowerCase()
                    );
                    
                    if (channelConfig) {
                      // Remove o canal da configuração deste grupo
                      group.youtube = group.youtube.filter(c => 
                        c.channel.toLowerCase() !== channel.name.toLowerCase()
                      );
                      
                      // Salva o grupo
                      await this.database.saveGroup(group);
                      
                      // Envia uma mensagem de notificação
                      this.emit('channelNotFound', {
                        platform: 'youtube',
                        channelName: channel.name,
                        groupId: group.id
                      });
                    }
                  }
                }
              } catch (notificationError) {
                this.logger.error(`Erro ao notificar grupos sobre canal não encontrado: ${channel.name}`, notificationError);
              }
            }
          }
        } else {
          this.logger.error(`Erro ao monitorar canal do YouTube ${channel.name}:`, error.message);
        }
      }
    }
  }

  /**
   * Busca o status de streams no Twitch sem necessidade de monitoramento prévio
   * @param {string|Array<string>} channels - Nome do canal ou array de nomes
   * @returns {Promise<Object|Array<Object>>} - Status da stream ou array de status
   */
  async getTwitchLiveStatus(channels) {
    try {
      // Normaliza para array
      const channelArray = Array.isArray(channels) ? channels : [channels];
      
      // Se não houver canais, retorna array vazio
      if (channelArray.length === 0) {
        return Array.isArray(channels) ? [] : null;
      }
      
      // Obtém um token válido
      if (!this.twitchToken) {
        const token = await this._refreshTwitchToken();
        if (!token) {
          throw new Error('Não foi possível obter token do Twitch');
        }
      }
      
      // Divide os canais em lotes de 100 (limite da API do Twitch)
      const results = [];
      const batches = [];
      for (let i = 0; i < channelArray.length; i += 100) {
        batches.push(channelArray.slice(i, i + 100));
      }
      
      for (const batch of batches) {
        try {
          // Primeiro obtém os IDs dos usuários a partir dos nomes de login
          const userResponse = await axios.get(
            `https://api.twitch.tv/helix/users`,
            {
              headers: {
                'Client-ID': this.twitchClientId,
                'Authorization': `Bearer ${this.twitchToken}`
              },
              params: {
                login: batch.map(c => c.toLowerCase())
              }
            }
          );
          
          // Se não encontrar usuários, continua para o próximo lote
          if (!userResponse.data.data || userResponse.data.data.length === 0) {
            continue;
          }
          
          const userIds = userResponse.data.data.map(user => user.id);
          
          // Obtém o status das streams para esses usuários
          const streamResponse = await axios.get(
            `https://api.twitch.tv/helix/streams`,
            {
              headers: {
                'Client-ID': this.twitchClientId,
                'Authorization': `Bearer ${this.twitchToken}`
              },
              params: {
                user_id: userIds
              }
            }
          );
          
          // Processa os resultados
          const liveStreams = streamResponse.data.data ?? [];
          const liveStreamUserIds = liveStreams.map(stream => stream.user_id);
          
          // Cria objetos de status para cada canal
          for (const user of userResponse.data.data) {
            const channelName = user.login;
            const isLiveNow = liveStreamUserIds.includes(user.id);
            const liveStream = liveStreams.find(stream => stream.user_id === user.id);
            
            //this.logger.debug(`[StreamMonitor] liveStream`, {channel: user.login, streamResponse, liveStream});

            // Cria o objeto de status
            const status = {
              platform: 'twitch',
              channelName: channelName,
              displayName: user.display_name,
              isLive: isLiveNow,
              lastChecked: new Date().toISOString()
            };
            
            // Adiciona detalhes da stream se estiver online
            if (isLiveNow && liveStream) {
              status.title = liveStream.title;
              status.game = liveStream.game_name;
              status.thumbnail = liveStream.thumbnail_url
                .replace('{width}', '640')
                .replace('{height}', '360');
              status.viewerCount = liveStream.viewer_count;
              status.startedAt = liveStream.started_at;
            }
            
            results.push(status);
          }
        } catch (error) {
          // Se não autorizado, tenta atualizar o token
          if (error.response && error.response.status === 401) {
            await this._refreshTwitchToken();
            // Não repete a tentativa aqui para evitar loops infinitos
          }
          
          this.logger.error(`Erro ao obter status do Twitch para ${batch.join(', ')}:`, error.message);
        }
      }
      
      // Retorna na mesma forma que a entrada (único objeto ou array)
      return Array.isArray(channels) ? results : (results[0] || null);
    } catch (error) {
      this.logger.error('Erro ao obter status do Twitch:', error.message);
      return Array.isArray(channels) ? [] : null;
    }
  }

 /**
   * Busca o status de streams no Kick sem necessidade de monitoramento prévio
   * @param {string|Array<string>} channels - Nome do canal ou array de nomes
   * @returns {Promise<Object|Array<Object>>} - Status da stream ou array de status
   */
  async getKickLiveStatus(channels) {
    try {
      // Normalize to array
      const channelArray = Array.isArray(channels) ? channels : [channels];
      
      // If no channels, return empty
      if (channelArray.length === 0) {
        return Array.isArray(channels) ? [] : null;
      }

      // Ensure we have a valid token
      if (!this.kickToken) {
          const token = await this._refreshKickToken();
          if (!token) {
              throw new Error('Could not get Kick token');
          }
      }
      
      const results = [];
      const batches = [];
      for (let i = 0; i < channelArray.length; i += 100) {
          batches.push(channelArray.slice(i, i + 100));
      }

      for (const batch of batches) {
        try {
            // Manually construct the query string for slugs, like in _pollKickChannels
            const slugsQuery = batch.map(c => `slug=${encodeURIComponent(c.toLowerCase())}`).join("&");

            const response = await axios.get(`https://api.kick.com/public/v1/channels?${slugsQuery}`, {
                headers: {
                    'Authorization': `Bearer ${this.kickToken}`,
                    'Accept': 'application/json'
                }
            });
            
            if (response.status === 200 && response.data && response.data.data) {
              const liveData = new Map(response.data.data.map(ch => [ch.slug.toLowerCase(), ch]));

              for (const channelName of batch) {
                  const channelData = liveData.get(channelName.toLowerCase());
                  
                  if (!channelData) {
                      results.push({
                          platform: 'kick',
                          channelName: channelName,
                          isLive: false,
                          error: 'Channel not found',
                          lastChecked: new Date().toISOString()
                      });
                      continue;
                  }

                  const isLiveNow = !!(channelData.stream && channelData.stream.is_live);
                  const status = {
                      platform: 'kick',
                      channelName: channelData.slug,
                      displayName: channelData.slug,
                      isLive: isLiveNow,
                      lastChecked: new Date().toISOString()
                  };

                  if (isLiveNow) {
                      const stream = channelData.stream;
                      status.title = channelData.stream_title;
                      status.game = channelData.category ? channelData.category.name : 'Unknown';
                      status.thumbnail = stream.thumbnail;
                      status.viewerCount = stream.viewer_count;
                      status.startedAt = stream.start_time;
                  }
                  results.push(status);
              }
            } else {
                // Handle cases where status is not 200 but didn't throw
                for (const channelName of batch) {
                    results.push({
                        platform: 'kick',
                        channelName: channelName,
                        isLive: false,
                        error: `API returned status ${response.status}`,
                        lastChecked: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            this.logger.error(`Error getting Kick status for batch ${batch.join(', ')}: ${error.message}`);
            
            if (error.response && error.response.status === 401) {
                this.logger.warn('Kick token was unauthorized. It will be refreshed on the next call.');
                this.kickToken = null; // Invalidate token
            }

            // Add error status for all channels in the failed batch
            for (const channelName of batch) {
              results.push({
                platform: 'kick',
                channelName: channelName,
                isLive: false,
                error: errorMessage,
                lastChecked: new Date().toISOString()
              });
            }
        }
      }
      
      // Return in the same format as the input (single object or array)
      return Array.isArray(channels) ? results : (results[0] || null);
    } catch (error) {
      this.logger.error('Critical error in getKickLiveStatus:', error.message);
      return Array.isArray(channels) ? [] : null;
    }
  }


  /**
   * Busca estatísticas de streams populares em múltiplas plataformas
   * @param {Object} options - Opções de busca
   * @param {number} options.limit - Número máximo de resultados por plataforma
   * @param {boolean} options.includeTwitch - Se deve incluir streams do Twitch
   * @param {boolean} options.includeKick - Se deve incluir streams do Kick
   * @returns {Promise<Object>} - Estatísticas de streams
   */
  async getTopStreams(options = {}) {
    const defaults = {
      limit: 5,
      includeTwitch: true,
      includeKick: true
    };
    
    const config = { ...defaults, ...options };
    const results = {
      twitch: [],
      kick: []
    };
    
    try {
      // Busca streams populares do Twitch
      if (config.includeTwitch) {
        try {
          // Garante que temos um token válido
          if (!this.twitchToken) {
            const token = await this._refreshTwitchToken();
            if (!token) {
              throw new Error('Não foi possível obter token do Twitch');
            }
          }
          
          // Busca os streams mais populares
          const response = await axios.get(
            `https://api.twitch.tv/helix/streams`,
            {
              headers: {
                'Client-ID': this.twitchClientId,
                'Authorization': `Bearer ${this.twitchToken}`
              },
              params: {
                first: config.limit
              }
            }
          );
          
          if (response.data && response.data.data) {
            results.twitch = response.data.data.map(stream => ({
              platform: 'twitch',
              channelName: stream.user_name,
              title: stream.title,
              game: stream.game_name,
              viewerCount: stream.viewer_count,
              startedAt: stream.started_at,
              thumbnail: stream.thumbnail_url
                .replace('{width}', '640')
                .replace('{height}', '360')
            }));
          }
        } catch (error) {
          this.logger.error('Erro ao obter streams populares do Twitch:', error.message);
        }
      }
      
      // Busca streams populares do Kick
      if (config.includeKick) {
        try {
          // Kick não tem API oficial, mas podemos tentar acessar a página inicial
          const response = await axios.get('https://kick.com/api/v1/featured-livestreams', {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          
          if (response.data && response.data.data) {
            results.kick = response.data.data
              .slice(0, config.limit)
              .map(stream => ({
                platform: 'kick',
                channelName: stream.slug,
                displayName: stream.user?.username ?? stream.slug,
                title: stream.session_title,
                game: stream.categories.length > 0 ? stream.categories[0].name : 'Desconhecido',
                viewerCount: stream.viewer_count,
                startedAt: stream.created_at,
                thumbnail: stream.thumbnail?.url ?? stream.user?.profile_pic ?? ''
              }));
          }
        } catch (error) {
          this.logger.error('Erro ao obter streams populares do Kick:', error.message);
        }
      }
      
      return results;
    } catch (error) {
      this.logger.error('Erro ao obter streams populares:', error.message);
      return results;
    }
  }

  /**
   * Sanitizes a URL or username into a clean channel handle.
   * @param {string} inputString - The URL or username to sanitize.
   * @param {string} platform - 'twitch', 'kick', or 'youtube' (default: 'twitch').
   */
  sanitizePlatformChannelName(inputString, platform = 'twitch') {
    if (typeof inputString !== 'string') {
      return "";
    }

    // Configuration for each platform's URL patterns and allowed characters
    const platformRules = {
      twitch: {
        // Removes twitch.tv/
        urlPattern: /^(https?:\/\/)?(www\.)?twitch\.tv\//i, 
        // Twitch only allows alphanumeric and underscores
        illegalChars: /[^a-z0-9_]/g 
      },
      kick: {
        // Removes kick.com/
        urlPattern: /^(https?:\/\/)?(www\.)?kick\.com\//i,
        // Kick follows same rules as Twitch (alphanumeric + underscore)
        illegalChars: /[^a-z0-9_]/g 
      },
      youtube: {
        // Removes youtube.com, youtu.be, and handle prefixes like /@, /c/, /user/
        urlPattern: /^(https?:\/\/)?(www\.)?(youtube\.com\/(c\/|user\/|@|channel\/)?|youtu\.be\/)/i,
        // YouTube handles allow hyphens (-) and dots (.)
        illegalChars: /[^a-z0-9_\-\.]/g 
      }
    };

    // Get rules for the requested platform (fallback to twitch if invalid platform passed)
    const rules = platformRules[platform.toLowerCase()] ?? platformRules.twitch;

    // 1. Remove the URL domain/protocol
    let cleaned = inputString.replace(rules.urlPattern, "");

    // 2. Lowercase everything (Standardizes input)
    cleaned = cleaned.toLowerCase();

    // 3. Remove any characters that are not allowed on that specific platform
    const sanitized = cleaned.replace(rules.illegalChars, "");

    return sanitized ?? "";
  }
}

module.exports = StreamMonitor;