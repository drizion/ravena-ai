const path = require('path');
const Database = require('./Database');

const database = Database.getInstance();
const DB_NAME = 'video_cache';

// Initialize Database
database.getSQLiteDb(DB_NAME, `
  CREATE TABLE IF NOT EXISTS video_cache (
    id TEXT PRIMARY KEY,
    json_data TEXT
  );
`);

class VideoCacheManager {
  constructor(downloader, databasePath) {
    this.getVideoInfo = downloader;
    this.downloadAudio = downloader;
    this.downloadVideo = downloader;
    // databasePath is ignored as we use Singleton Database with fixed structure
  }

  getTimestamp(){
    var tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
      var localISOTime = (new Date(Date.now() - tzoffset)).toISOString().replace(/T/, ' ').replace(/\..+/, '');
    //return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    return localISOTime;
  }

  /**
   * Get video info with caching
   * @param {string} id - Video ID
   * @param {Object} options - Options for fetching video info
   * @returns {Promise<Object>} Video information
   */
  async getVideoInfoWithCache(id, options) {
    try {
      const row = await database.dbGet(DB_NAME, 'SELECT json_data FROM video_cache WHERE id = ?', [id]);
      
      if (row) {
        const cached = JSON.parse(row.json_data);
        if (cached && cached.videoInfo) {
          return cached.videoInfo;
        }
      }
    } catch (e) {
      console.error('Error reading video cache:', e);
    }

    // Fetch new video info
    const videoInfo = await this.getVideoInfo(id, options);

    // Update cache
    const cacheEntry = {
      videoInfo: {
        id: videoInfo.id, 
        uploader: videoInfo.uploader, 
        title: videoInfo.title, 
        duration: videoInfo.duration, 
        timestamp: this.getTimestamp(), 
        ts: Math.round(+new Date()/1000)
      }
    };

    // Save to DB
    try {
      // Need to fetch again to merge if there are other fields?
      // The previous implementation replaced the whole entry for the ID but merged with existing `cache[id]`.
      // So if `cache[id]` had other props (like download location), they should be preserved.
      
      const existingRow = await database.dbGet(DB_NAME, 'SELECT json_data FROM video_cache WHERE id = ?', [id]);
      let finalEntry = existingRow ? JSON.parse(existingRow.json_data) : {};
      
      finalEntry = { ...finalEntry, ...cacheEntry };
      
      await database.dbRun(DB_NAME, 'INSERT OR REPLACE INTO video_cache (id, json_data) VALUES (?, ?)', 
        [id, JSON.stringify(finalEntry)]);
        
    } catch (e) {
      console.error('Error writing video cache:', e);
    }

    return videoInfo;
  }

  /**
   * Set the last download location for a video/audio
   * @param {string} id - Video ID
   * @param {string} downloadPath - Path where the video/audio was downloaded
   * @param {string} type - Type of download ('video' or 'audio')
   */
  async setLastDownloadLocation(id, downloadPath, type = 'video') {
    try {
      const row = await database.dbGet(DB_NAME, 'SELECT json_data FROM video_cache WHERE id = ?', [id]);
      let entry = row ? JSON.parse(row.json_data) : {};
      
      if (type === 'video') {
        entry.lastVideoDownload = downloadPath;
      } else {
        entry.lastAudioDownload = downloadPath;
      }
      
      await database.dbRun(DB_NAME, 'INSERT OR REPLACE INTO video_cache (id, json_data) VALUES (?, ?)', 
        [id, JSON.stringify(entry)]);
        
    } catch (e) {
      console.error('Error setting download location:', e);
    }
  }

  /**
   * Get the last download location for a video/audio
   * @param {string} id - Video ID
   * @param {string} type - Type of download ('video' or 'audio')
   * @returns {Promise<string|null>} Path to the downloaded file or null if not found
   */
  async getLastDownloadLocation(id, type = 'video') {
    try {
      const row = await database.dbGet(DB_NAME, 'SELECT json_data FROM video_cache WHERE id = ?', [id]);
      if (!row) return null;
      
      const entry = JSON.parse(row.json_data);
      if (type === 'video') {
        return entry.lastVideoDownload || null;
      } else {
        return entry.lastAudioDownload || null;
      }
    } catch (e) {
      console.error('Error getting download location:', e);
      return null;
    }
  }
}

module.exports = VideoCacheManager;
