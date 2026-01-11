const Redis = require('ioredis');
const Logger = require('../utils/Logger');
const Database = require('../utils/Database');

const CACHE_CONFIG = {
  'pushName': { ttl: 30 * 24 * 60 * 60 }, // 30 days
  'chat': { ttl: 4 * 60 * 60 },           // 4 hours
  'message': { ttl: 1 * 60 * 60 },        // 1 hour
  'contact': { ttl: 7 * 24 * 60 * 60 },   // 7 days
  'tg_name': { ttl: 30 * 24 * 60 * 60 },  // 30 days
  'app_cooldowns_data_v1': { ttl: 24 * 60 * 60 } // 24 hours
};

class CacheManager {
  constructor(redisURL, redisDB, redisTTL, maxCacheSize) {
    this.useRedis = (process.env.USE_REDIS === 'true');
    this.logger = new Logger(`cache-manager`);
    this.redisURL = redisURL;
    this.redisDB = (redisDB ?? 0) % 15;
    this.redisTTL = parseInt(redisTTL, 10) || 3600;
    this.maxCacheSize = parseInt(maxCacheSize, 10) || 100;

    // in-memory main cache / fallback
    this.messageCache = [];
    this.contactCache = [];
    this.chatCache = [];
    this.pushnameCache = [];
    this.telegramNameCache = [];

    // Pending writes for SQLite batching
    this.pendingWrites = new Map(); // key -> { value, expiresAt }
    this.unsavedChangesCount = 0;
    this.FLUSH_THRESHOLD = 100;
    this.FLUSH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

    // Database setup
    this.database = Database.getInstance();
    this.DB_NAME = 'cache';
    
    this.database.getSQLiteDb(this.DB_NAME, `
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_expires ON kv_store(expires_at);
    `);

    // Redis setup (optional)
    this.redisClient = null;
    if (this.redisURL && this.useRedis) {
      try {
        this.redisClient = new Redis(`${this.redisURL}/${this.redisDB}`, { /* ... options ... */ });
        this.redisClient.on('connect', () => this.logger.info(`CacheManager: Connected to Redis db ${this.redisDB}.`));
        this.redisClient.on('error', (err) => this.logger.error('CacheManager: Redis client error:', err.message));
        this.redisClient.ping().catch(err => this.logger.warn(`CacheManager: Initial Redis ping failed: ${err.message}.`));
      } catch (error) {
        this.logger.error('CacheManager: Failed to initialize Redis client:', error.message);
        this.redisClient = null;
      }
    } else {
      this.logger.info('CacheManager: No Redis configured. Using in-memory cache with SQLite persistence.');
    }

    // Start flush timer
    this.flushTimer = setInterval(() => this.flushPendingWrites(), this.FLUSH_INTERVAL_MS);
    
    // Start cleanup timer (every hour)
    this.cleanupTimer = setInterval(() => this.cleanExpired(), 60 * 60 * 1000);

    // Setup shutdown hook
    this.setupShutdown();
  }

  setupShutdown() {
    const exitHandler = async () => {
      this.logger.info('CacheManager: Saving cache to disk before exit...');
      await this.flushPendingWrites();
    };    
  }

  // --- Helper to get Config ---
  
  getCacheConfig(key) {
    if (CACHE_CONFIG[key]) return CACHE_CONFIG[key];
    const prefix = key.split(':')[0];
    if (CACHE_CONFIG[prefix]) return CACHE_CONFIG[prefix];
    return null;
  }

  // --- Persistence Helpers ---

  async _dbGet(key) {
    try {
      const row = await this.database.dbGet(this.DB_NAME, 'SELECT value, expires_at FROM kv_store WHERE key = ?', [key]);
      if (row) {
        if (row.expires_at && row.expires_at < Date.now()) {
          // Lazy expiration
          this.database.dbRun(this.DB_NAME, 'DELETE FROM kv_store WHERE key = ?', [key]).catch(()=>{});
          return null;
        }
        return JSON.parse(row.value);
      }
      return null;
    } catch (e) {
      this.logger.error(`Error reading from DB cache for ${key}:`, e);
      return null;
    }
  }

  _scheduleWrite(key, value) {
    // Determine TTL from config
    const config = this.getCacheConfig(key);
    
    // If no config found, do NOT persist to SQLite
    if (!config) return;

    const ttlSeconds = config.ttl;
    const expiresAt = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null;
    
    this.pendingWrites.set(key, { value: JSON.stringify(value), expiresAt });
    this.unsavedChangesCount++;

    if (this.unsavedChangesCount >= this.FLUSH_THRESHOLD) {
      this.flushPendingWrites();
    }
  }

  async flushPendingWrites() {
    if (this.pendingWrites.size === 0) return;

    this.logger.debug(`Flushing ${this.pendingWrites.size} cache items to disk...`);
    const batch = Array.from(this.pendingWrites.entries());
    this.pendingWrites.clear();
    this.unsavedChangesCount = 0;

    try {
      await this.database.dbRun(this.DB_NAME, 'BEGIN TRANSACTION');
      for (const [key, data] of batch) {
        await this.database.dbRun(this.DB_NAME, 
          'INSERT OR REPLACE INTO kv_store (key, value, expires_at) VALUES (?, ?, ?)',
          [key, data.value, data.expiresAt]
        );
      }
      await this.database.dbRun(this.DB_NAME, 'COMMIT');
    } catch (e) {
      this.logger.error('Error flushing cache to disk:', e);
      try { await this.database.dbRun(this.DB_NAME, 'ROLLBACK'); } catch (_) {}
    }
  }

  async cleanExpired() {
    try {
      await this.database.dbRun(this.DB_NAME, 'DELETE FROM kv_store WHERE expires_at < ?', [Date.now()]);
    } catch (e) {
      this.logger.error('Error cleaning expired cache:', e);
    }
  }

  // --- Cache Methods ---

  async putPushnameInCache(data) {
    if (!data || typeof data.id === 'undefined') return;
    const userId = data.id;
    const redisKey = `pushName:${userId}`;
    const config = this.getCacheConfig(redisKey);
    const ttl = config ? config.ttl : this.redisTTL;

    // Redis
    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', ttl);
        return;
      } catch (err) {}
    }

    // Memory
    this.pushnameCache.push(data);
    if (this.pushnameCache.length > this.maxCacheSize) this.pushnameCache.shift();

    // SQLite Persistence
    this._scheduleWrite(redisKey, data);
  }

  async getPushnameFromCache(id) {
    if (!id) return null;
    const redisKey = `pushName:${id}`;

    // Redis
    if (this.redisClient) {
      try {
        const cached = await this.redisClient.get(redisKey);
        if (cached) return JSON.parse(cached);
      } catch (err) {}
    }

    // Memory
    const memItem = this.pushnameCache.find(m => m.id == id);
    if (memItem) return memItem;

    // SQLite
    const dbItem = await this._dbGet(redisKey);
    if (dbItem) {
      // Promote to memory
      this.pushnameCache.push(dbItem);
      if (this.pushnameCache.length > this.maxCacheSize) this.pushnameCache.shift();
      return dbItem;
    }
    return null;
  }

  async putChatInCache(data) {
    if (!data || !data.id || typeof data.id._serialized === 'undefined') return;
    const chatId = data.id._serialized;
    const redisKey = `chat:${chatId}`;
    const config = this.getCacheConfig(redisKey);
    const ttl = config ? config.ttl : this.redisTTL;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', ttl);
        return;
      } catch (err) {}
    }

    this.chatCache.push(data);
    if (this.chatCache.length > this.maxCacheSize) this.chatCache.shift();

    this._scheduleWrite(redisKey, data);
  }

  async getChatFromCache(id) {
    if (!id) return null;
    const redisKey = `chat:${id}`;

    if (this.redisClient) {
      try {
        const cached = await this.redisClient.get(redisKey);
        if (cached) return JSON.parse(cached);
      } catch (err) {}
    }

    const memItem = this.chatCache.find(m => m.key && m.key.id == id); 
    
    if (memItem) return memItem;

    const dbItem = await this._dbGet(redisKey);
    if (dbItem) {
      this.chatCache.push(dbItem);
      if (this.chatCache.length > this.maxCacheSize) this.chatCache.shift();
      return dbItem;
    }
    return null;
  }

  async putMessageInCache(data) {
    if (!data || !data.key || typeof data.key.id === 'undefined') return;
    const messageId = data.key.id;
    const redisKey = `message:${messageId}`;
    const config = this.getCacheConfig(redisKey);
    const ttl = config ? config.ttl : this.redisTTL;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', ttl);
        return;
      } catch (err) {}
    }

    this.messageCache.push(data);
    if (this.messageCache.length > this.maxCacheSize) this.messageCache.shift();

    this._scheduleWrite(redisKey, data);
  }

  async putSentMessageInCache(key) {
    if (!key || !key.id) return;
    const messageId = key.id;
    const redisKey = `message:${messageId}`;
    const config = this.getCacheConfig(redisKey);
    const ttl = config ? config.ttl : this.redisTTL;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(key), 'EX', ttl);
        return;
      } catch (err) {}
    }

    this.messageCache.push(key);
    if (this.messageCache.length > this.maxCacheSize) this.messageCache.shift();

    this._scheduleWrite(redisKey, key);
  }

  async getMessageFromCache(id) {
    if (!id) return null;
    const redisKey = `message:${id}`;

    if (this.redisClient) {
      try {
        const cached = await this.redisClient.get(redisKey);
        if (cached) return JSON.parse(cached);
      } catch (err) {}
    }

    const memItem = this.messageCache.find(m => m.key && m.key.id == id);
    if (memItem) return memItem;

    const dbItem = await this._dbGet(redisKey);
    if (dbItem) {
      this.messageCache.push(dbItem);
      if (this.messageCache.length > this.maxCacheSize) this.messageCache.shift();
      return dbItem;
    }
    return null;
  }

  // V3 Methods
  async putGoMessageInCache(data) {
    if (!data || !data.id) return;
    const messageId = data.id;
    const redisKey = `message:${messageId}`;
    const config = this.getCacheConfig(redisKey);
    const ttl = config ? config.ttl : this.redisTTL;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', ttl);
        return;
      } catch (err) {}
    }

    this.messageCache.push(data);
    if (this.messageCache.length > this.maxCacheSize) this.messageCache.shift();

    this._scheduleWrite(redisKey, data);
  }

  async putGoSentMessageInCache(message) {
    if (!message || !message.id) return;
    const messageId = typeof message.id === 'object' ? message.id._serialized : message.id;
    if (!messageId) return;
    const redisKey = `message:${messageId}`;
    const config = this.getCacheConfig(redisKey);
    const ttl = config ? config.ttl : this.redisTTL;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(message), 'EX', ttl);
        return;
      } catch (err) {}
    }

    this.messageCache.push(message);
    if (this.messageCache.length > this.maxCacheSize) this.messageCache.shift();

    this._scheduleWrite(redisKey, message);
  }

  async getGoMessageFromCache(id) {
    if (!id) return null;
    const redisKey = `message:${id}`;

    if (this.redisClient) {
      try {
        const cached = await this.redisClient.get(redisKey);
        if (cached) return JSON.parse(cached);
      } catch (err) {}
    }

    const memItem = this.messageCache.find(m => m.id == id || (m.key && m.key.id == id));
    if (memItem) return memItem;

    const dbItem = await this._dbGet(redisKey);
    if (dbItem) {
      this.messageCache.push(dbItem);
      if (this.messageCache.length > this.maxCacheSize) this.messageCache.shift();
      return dbItem;
    }
    return null;
  }

  async putContactInCache(data) {
    if (!data || typeof data.number === 'undefined') return;
    const contactNumber = data.number;
    const redisKey = `contact:${contactNumber}`;
    const config = this.getCacheConfig(redisKey);
    const ttl = config ? config.ttl : this.redisTTL;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', ttl);
        return;
      } catch (err) {}
    }

    this.contactCache.push(data);
    if (this.contactCache.length > this.maxCacheSize) this.contactCache.shift();

    this._scheduleWrite(redisKey, data);
  }

  async getContactFromCache(id) {
    if (!id) return null;
    const redisKey = `contact:${id}`;

    if (this.redisClient) {
      try {
        const cached = await this.redisClient.get(redisKey);
        if (cached) return JSON.parse(cached);
      } catch (err) {}
    }

    const memItem = this.contactCache.find(c => c.number == id);
    if (memItem) return memItem;

    const dbItem = await this._dbGet(redisKey);
    if (dbItem) {
      this.contactCache.push(dbItem);
      if (this.contactCache.length > this.maxCacheSize) this.contactCache.shift();
      return dbItem;
    }
    return null;
  }

  async putTelegramNameInCache(userId, name) {
    if (!userId || !name) return;
    const redisKey = `tg_name:${userId}`;
    const config = this.getCacheConfig(redisKey);
    const ttl = config ? config.ttl : 86400; // 24h default fallback

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, name, 'EX', ttl);
        return;
      } catch (err) {}
    }

    const existingIndex = this.telegramNameCache.findIndex(i => i.id === userId);
    if(existingIndex > -1) this.telegramNameCache.splice(existingIndex, 1);
    
    this.telegramNameCache.push({ id: userId, name, timestamp: Date.now() });
    if (this.telegramNameCache.length > this.maxCacheSize) this.telegramNameCache.shift();

    this._scheduleWrite(redisKey, name);
  }

  async getTelegramNameFromCache(userId) {
    if (!userId) return null;
    const redisKey = `tg_name:${userId}`;

    if (this.redisClient) {
      try {
        const cachedName = await this.redisClient.get(redisKey);
        if (cachedName) return cachedName;
      } catch (err) {}
    }

    const item = this.telegramNameCache.find(i => i.id === userId);
    if (item) {
      if (Date.now() - item.timestamp > 86400 * 1000) return null; 
      return item.name;
    }

    const dbName = await this._dbGet(redisKey);
    if (dbName) {
        // Promote to memory
        this.telegramNameCache.push({ id: userId, name: dbName, timestamp: Date.now() });
        if (this.telegramNameCache.length > this.maxCacheSize) this.telegramNameCache.shift();
        return dbName;
    }
    return null;
  }

  async getCooldowns() {
    const redisKey = 'app_cooldowns_data_v1';
    
    if (this.redisClient) {
      try {
        const cachedData = await this.redisClient.get(redisKey);
        if (cachedData) return JSON.parse(cachedData);
      } catch (err) {
        this.logger.error(`Error retrieving cooldowns from Redis: ${err.message}`);
      }
    }

    const dbData = await this._dbGet(redisKey);
    return dbData || {};
  }

  async saveCooldowns(cooldownsData) {
    if (typeof cooldownsData !== 'object' || cooldownsData === null) return;
    const redisKey = 'app_cooldowns_data_v1';
    // config handled in _scheduleWrite

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(cooldownsData));
      } catch (err) {
        this.logger.error(`Error saving cooldowns to Redis: ${err.message}`);
      }
    }

    this._scheduleWrite(redisKey, cooldownsData);
  }

  async disconnectRedis() {
    // Flush before disconnect
    await this.flushPendingWrites();
    
    if (this.redisClient && (this.redisClient.status === 'ready' || this.redisClient.status === 'connecting' || this.redisClient.status === 'reconnecting')) {
      try {
        await this.redisClient.quit();
        this.logger.info('CacheManager: Redis client disconnected gracefully.');
      } catch (err) {
        this.logger.error('CacheManager: Error disconnecting Redis client:', err.message);
      } finally {
        this.redisClient = null;
      }
    }
  }
}

module.exports = CacheManager;