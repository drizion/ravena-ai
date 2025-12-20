const Redis = require('ioredis');
const Logger = require('../utils/Logger');

class CacheManager {
  constructor(redisURL, redisDB, redisTTL, maxCacheSize) {
    this.logger = new Logger(`redis`);
    this.redisURL = redisURL;
    this.redisDB = (redisDB ?? 0) % 15;
    this.redisTTL = parseInt(redisTTL, 10) || 3600;
    this.maxCacheSize = parseInt(maxCacheSize, 10) || 100;

    // in-memory fallback
    this.messageCache = [];
    this.contactCache = [];
    this.chatCache = [];
    this.pushnameCache = [];
    this.telegramNameCache = [];

    this.redisClient = null;

    if (this.redisURL) {
      try {
        this.redisClient = new Redis(`${this.redisURL}/${this.redisDB}`, { /* ... options ... */ });
        this.redisClient.on('connect', () => this.logger.info(`CacheManager: Connected to Redis db ${this.redisDB}.`));
        this.redisClient.on('error', (err) => this.logger.error('CacheManager: Redis client error:', err.message));
        // Optional initial ping
        this.redisClient.ping().catch(err => this.logger.warn(`CacheManager: Initial Redis ping failed: ${err.message}.`));
      } catch (error) {
        this.logger.error('CacheManager: Failed to initialize Redis client:', error.message);
        this.redisClient = null;
      }
    } else {
      this.logger.info('CacheManager: No redisURL provided. Using in-memory cache only.');
    }
  }

  async putPushnameInCache(data) {
    if (!data || typeof data.id === 'undefined' || typeof data.pushName !== "string" || data.pushName?.length < 1) {
      this.logger.debug('CacheManager (putPushnameInCache): Invalid pushName data.', { data });
      return;
    }
    const userId = data.id;
    const pushName = data.pushName;
    const redisKey = `pushName:${userId}`;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', this.redisTTL);
        return;
      } catch (err) {
        this.logger.error(`CacheManager (putPushnameInCache): Error caching pushName ${userId} in Redis: ${err.message}. Falling back.`);
      }
    }
    this.pushnameCache.push(data);
    if (this.pushnameCache.length > this.maxCacheSize) {
      this.pushnameCache.shift();
    }
  }

  async getPushnameFromCache(id) {
    if (typeof id === 'undefined' || id === null) return null;
    const redisKey = `pushName:${id}`;

    if (this.redisClient) {
      try {
        const cachedData = await this.redisClient.get(redisKey);
        if (cachedData) return JSON.parse(cachedData);
      } catch (err) {
        this.logger.error(`CacheManager (getPushnameFromCache): Error retrieving pushName ${id} from Redis: ${err.message}. Falling back.`);
      }
    }
    return this.pushnameCache.find(m => m.id == id) || null;
  }


  async putChatInCache(data) {
    if (!data || !data.id || typeof data.id?._serialized === 'undefined') {
      this.logger.debug('CacheManager (putChatInCache): Invalid chat data.', { data });
      return;
    }
    const chatId = data.id._serialized;
    const redisKey = `chat:${chatId}`;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', this.redisTTL);
        return;
      } catch (err) {
        this.logger.error(`CacheManager (putChatInCache): Error caching chat ${chatId} in Redis: ${err.message}. Falling back.`);
      }
    }
    this.chatCache.push(data);
    if (this.chatCache.length > this.maxCacheSize) {
      this.chatCache.shift();
    }
  }

  async getChatFromCache(id) {
    if (typeof id === 'undefined' || id === null) return null;
    const redisKey = `chat:${id}`;

    if (this.redisClient) {
      try {
        const cachedData = await this.redisClient.get(redisKey);
        if (cachedData) return JSON.parse(cachedData);
      } catch (err) {
        this.logger.error(`CacheManager (getChatFromCache): Error retrieving chat ${id} from Redis: ${err.message}. Falling back.`);
      }
    }
    return this.chatCache.find(m => m.key && m.key.id == id) || null;
  }


  async putMessageInCache(data) {
    if (!data || !data.key || typeof data.key.id === 'undefined') {
      this.logger.error('CacheManager (putMessageInCache): Invalid message data.');
      return;
    }
    const messageId = data.key.id;
    const redisKey = `message:${messageId}`;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', this.redisTTL);
        return;
      } catch (err) {
        this.logger.error(`CacheManager (putMessageInCache): Error caching message ${messageId} in Redis: ${err.message}. Falling back.`);
      }
    }
    this.messageCache.push(data);
    if (this.messageCache.length > this.maxCacheSize) {
      this.messageCache.shift();
    }
  }

  async putSentMessageInCache(key) {
    if (!key || !key.id || typeof key.id === 'undefined') {
      this.logger.error('CacheManager (putSentMessageInCache): Invalid message key data.');
      return;
    }
    const messageId = key.id;
    const redisKey = `message:${messageId}`;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(key), 'EX', this.redisTTL);
        return;
      } catch (err) {
        this.logger.error(`CacheManager (putSentMessageInCache): Error caching message key ${messageId} in Redis: ${err.message}. Falling back.`);
      }
    }
    this.messageCache.push(key);
    if (this.messageCache.length > this.maxCacheSize) {
      this.messageCache.shift();
    }
  }

  async getMessageFromCache(id) {
    if (typeof id === 'undefined' || id === null) return null;
    const redisKey = `message:${id}`;

    if (this.redisClient) {
      try {
        const cachedData = await this.redisClient.get(redisKey);
        if (cachedData) return JSON.parse(cachedData);
      } catch (err) {
        this.logger.error(`CacheManager (getMessageFromCache): Error retrieving message ${id} from Redis: ${err.message}. Falling back.`);
      }
    }
    return this.messageCache.find(m => m.key && m.key.id == id) || null;
  }

  // V3 Methods
  async putGoMessageInCache(data) {
    if (!data || !data.id) {
      this.logger.error('CacheManager (putGoMessageInCache): Invalid message data (missing id).');
      return;
    }
    const messageId = data.id;
    const redisKey = `message:${messageId}`;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', this.redisTTL);
        return;
      } catch (err) {
        this.logger.error(`CacheManager (putGoMessageInCache): Error caching message ${messageId} in Redis: ${err.message}. Falling back.`);
      }
    }
    this.messageCache.push(data);
    if (this.messageCache.length > this.maxCacheSize) {
      this.messageCache.shift();
    }
  }

  async putGoSentMessageInCache(message) {
    if (!message || !message.id) {
      this.logger.error('CacheManager (putGoSentMessageInCache): Invalid message data.');
      return;
    }

    const messageId = typeof message.id === 'object' ? message.id._serialized : message.id;

    if (!messageId) {
      this.logger.error('CacheManager (putGoSentMessageInCache): Invalid message ID.');
      return;
    }

    const redisKey = `message:${messageId}`;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(message), 'EX', this.redisTTL);
        return;
      } catch (err) {
        this.logger.error(`CacheManager (putGoSentMessageInCache): Error caching message ${messageId} in Redis: ${err.message}. Falling back.`);
      }
    }
    this.messageCache.push(message);
    if (this.messageCache.length > this.maxCacheSize) {
      this.messageCache.shift();
    }
  }

  async getGoMessageFromCache(id) {
    if (typeof id === 'undefined' || id === null) return null;
    const redisKey = `message:${id}`;

    if (this.redisClient) {
      try {
        const cachedData = await this.redisClient.get(redisKey);
        if (cachedData) return JSON.parse(cachedData);
      } catch (err) {
        this.logger.error(`CacheManager (getGoMessageFromCache): Error retrieving message ${id} from Redis: ${err.message}. Falling back.`);
      }
    }
    return this.messageCache.find(m => m.id == id || (m.key && m.key.id == id)) || null;
  }

  async putContactInCache(data) {
    if (!data || typeof data.number === 'undefined') {
      //this.logger.error('CacheManager (putContactInCache): Invalid contact data.');
      return;
    }
    const contactNumber = data.number;
    const redisKey = `contact:${contactNumber}`;

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(data), 'EX', this.redisTTL);
        return;
      } catch (err) {
        this.logger.error(`CacheManager (putContactInCache): Error caching contact ${contactNumber} in Redis: ${err.message}. Falling back.`);
      }
    }
    this.contactCache.push(data);
    if (this.contactCache.length > this.maxCacheSize) {
      this.contactCache.shift();
    }
  }

  async getContactFromCache(id) {
    if (typeof id === 'undefined' || id === null) return null;
    const redisKey = `contact:${id}`;

    if (this.redisClient) {
      try {
        const cachedData = await this.redisClient.get(redisKey);
        if (cachedData) return JSON.parse(cachedData);
      } catch (err) {
        this.logger.error(`CacheManager (getContactFromCache): Error retrieving contact ${id} from Redis: ${err.message}. Falling back.`);
      }
    }
    return this.contactCache.find(c => c.number == id) || null;
  }

  async putTelegramNameInCache(userId, name) {
    if (!userId || !name) return;
    const redisKey = `tg_name:${userId}`;
    const ttl = 86400; // 24 hours

    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, name, 'EX', ttl);
        return;
      } catch (err) {
        this.logger.error(`CacheManager (putTelegramNameInCache): Error caching tg_name ${userId}: ${err.message}.`);
      }
    }
    // In-memory fallback
    const existingIndex = this.telegramNameCache.findIndex(i => i.id === userId);
    if(existingIndex > -1) this.telegramNameCache.splice(existingIndex, 1);
    
    this.telegramNameCache.push({ id: userId, name, timestamp: Date.now() });
    if (this.telegramNameCache.length > this.maxCacheSize) {
      this.telegramNameCache.shift();
    }
  }

  async getTelegramNameFromCache(userId) {
    if (!userId) return null;
    const redisKey = `tg_name:${userId}`;

    if (this.redisClient) {
      try {
        const cachedName = await this.redisClient.get(redisKey);
        if (cachedName) return cachedName;
      } catch (err) {
        this.logger.error(`CacheManager (getTelegramNameFromCache): Error retrieving tg_name ${userId}: ${err.message}.`);
      }
    }
    // In-memory fallback
    const item = this.telegramNameCache.find(i => i.id === userId);
    if (item) {
      // Check 24h TTL for in-memory
      if (Date.now() - item.timestamp > 86400 * 1000) {
        return null; 
      }
      return item.name;
    }
    return null;
  }

  /**
 * Retrieves all cooldowns data from Redis.
 * If Redis is unavailable or data is not found, it returns an empty object.
 * @returns {Promise<Object>} A promise that resolves to the cooldowns object.
 */
  async getCooldowns() {
    // Using a distinct key for all cooldowns to avoid collision with other cached items.
    // Versioning the key (e.g., '_v1') can be helpful for future data structure changes.
    const redisKey = 'app_cooldowns_data_v1';
    let cooldownsData = {}; // Default to an empty object

    if (this.redisClient) {
      try {
        const cachedData = await this.redisClient.get(redisKey);
        if (cachedData) {
          cooldownsData = JSON.parse(cachedData);
          // this.logger.info('CacheManager: Cooldowns data successfully retrieved from Redis.');
        } else {
          // this.logger.info('CacheManager: No cooldowns data found in Redis. Will start with an empty set.');
        }
        return cooldownsData;
      } catch (err) {
        this.logger.error(`CacheManager (getCooldowns): Error retrieving cooldowns from Redis: ${err.message}. Returning an empty object.`);
        // Fallback to empty object on error to allow the application to start
      }
    } else {
      // this.logger.info('CacheManager (getCooldowns): Redis client not available. Returning an empty object for cooldowns.');
      // Fallback to empty object if Redis is not configured
    }
    return cooldownsData; // Ensure an object is always returned
  }

  /**
   * Saves the provided cooldowns data to Redis.
   * This data is persisted without a default TTL from this.redisTTL,
   * assuming cooldowns should be more persistent.
   * @param {Object} cooldownsData The complete cooldowns object to save.
   * @returns {Promise<void>}
   */
  async saveCooldowns(cooldownsData) {
    if (typeof cooldownsData !== 'object' || cooldownsData === null) {
      this.logger.error('CacheManager (saveCooldowns): Invalid cooldownsData provided. Must be an object. Not saving.');
      return;
    }
    const redisKey = 'app_cooldowns_data_v1';

    if (this.redisClient) {
      try {
        // Storing the entire cooldowns object as a JSON string.
        // Note: No 'EX' (expire) is set here, so cooldowns will persist until
        // manually deleted or if Redis eviction policies are triggered.
        // If you need TTL for cooldowns, you can add 'EX' and a suitable duration.
        await this.redisClient.set(redisKey, JSON.stringify(cooldownsData));
        // this.logger.info('CacheManager: Cooldowns data successfully saved to Redis.');
      } catch (err) {
        this.logger.error(`CacheManager (saveCooldowns): Error saving cooldowns to Redis: ${err.message}.`);
        // Consider if you need any fallback or re-try logic here if Redis save fails.
      }
    } else {
      // this.logger.info('CacheManager (saveCooldowns): Redis client not available. Cooldowns data not saved to Redis.');
      // If Redis is down, the data won't be persisted to Redis.
      // The CommandHandler would still have its in-memory copy for the current session.
    }
  }


  async disconnectRedis() {
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