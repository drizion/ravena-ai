const path = require("path");
const fs = require("fs").promises;
const Database = require("./Database");

const database = Database.getInstance();
const DB_NAME = "video_cache";

// Initialize Database
database.getSQLiteDb(
	DB_NAME,
	`
  CREATE TABLE IF NOT EXISTS video_cache (
    id TEXT PRIMARY KEY,
    json_data TEXT
  );
`,
	true
);

// Helper function to check if a file exists
async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

class VideoCacheManager {
	constructor(downloader, databasePath) {
		this.getVideoInfo = downloader;
		this.downloadAudio = downloader;
		this.downloadVideo = downloader;
		// databasePath is ignored as we use Singleton Database with fixed structure
	}

	getTimestamp() {
		const tzoffset = new Date().getTimezoneOffset() * 60000; //offset in milliseconds
		const localISOTime = new Date(Date.now() - tzoffset)
			.toISOString()
			.replace(/T/, " ")
			.replace(/\..+/, "");
		//return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
		return localISOTime;
	}

	/**
	 * Helper to get cache entry
	 */
	async _getCacheEntry(id) {
		try {
			const row = await database.dbGet(DB_NAME, "SELECT json_data FROM video_cache WHERE id = ?", [
				id
			]);
			return row ? JSON.parse(row.json_data) : {};
		} catch (e) {
			console.error("Error reading video cache:", e);
			return {};
		}
	}

	/**
	 * Helper to save cache entry
	 */
	async _saveCacheEntry(id, data) {
		try {
			await database.dbRun(
				DB_NAME,
				"INSERT OR REPLACE INTO video_cache (id, json_data) VALUES (?, ?)",
				[id, JSON.stringify(data)]
			);
		} catch (e) {
			console.error("Error writing video cache:", e);
		}
	}

	/**
	 * Get video info with caching
	 * @param {string} id - Video ID
	 * @param {Object} options - Options for fetching video info
	 * @returns {Promise<Object>} Video information
	 */
	async getVideoInfoWithCache(id, options) {
		const cache = await this._getCacheEntry(id);

		// If cached info exists, return it
		if (cache.videoInfo) {
			return cache.videoInfo;
		}

		// Fetch new video info
		const videoInfo = await this.getVideoInfo(id, options);

		// Update cache
		cache.videoInfo = {
			id: videoInfo.id,
			uploader: videoInfo.uploader,
			title: videoInfo.title,
			duration: videoInfo.duration,
			timestamp: this.getTimestamp(),
			ts: Math.round(+new Date() / 1000)
		};

		// Save to DB
		await this._saveCacheEntry(id, cache);

		return videoInfo;
	}

	/**
	 * Set the last download location for a video/audio
	 * @param {string} id - Video ID
	 * @param {string} downloadPath - Path where the video/audio was downloaded
	 * @param {string} type - Type of download ('video' or 'audio')
	 */
	async setLastDownloadLocation(id, downloadPath, type = "video") {
		const cache = await this._getCacheEntry(id);

		cache.downloads = cache.downloads || {};
		cache.downloads[type] = {
			path: downloadPath,
			timestamp: Date.now()
		};

		await this._saveCacheEntry(id, cache);
	}

	/**
	 * Get the last download location for a video/audio
	 * @param {string} id - Video ID
	 * @param {string} type - Type of download ('video' or 'audio')
	 * @returns {Promise<string|null>} Path to the downloaded file or null if not found
	 */
	async getLastDownloadLocation(id, type = "video") {
		const cache = await this._getCacheEntry(id);

		if (cache.downloads && cache.downloads[type]) {
			return cache.downloads[type].path;
		}
		return null;
	}

	/**
	 * Download video with caching and tracking download location
	 * @param {string} id - Video ID
	 * @param {Object} options - Options for downloading video
	 * @returns {Promise<Object>} Download result with lastDownloadLocation
	 */
	async downloadVideoWithCache(id, options) {
		const cache = await this._getCacheEntry(id);
		const type = "video";

		// Check if there's a cached download location and the file exists
		if (cache.downloads && cache.downloads[type]) {
			const existingFilePath = cache.downloads[type].path;
			const fileStillExists = await fileExists(existingFilePath);

			if (fileStillExists) {
				return {
					lastDownloadLocation: existingFilePath,
					fromCache: true
				};
			}

			// If file no longer exists, remove the cached location
			delete cache.downloads[type];
			await this._saveCacheEntry(id, cache);
		}

		// Perform the download
		const downloadResult = await this.downloadVideo(id, options);

		// If download was successful, cache the download location
		if (downloadResult && downloadResult.outputPath) {
			await this.setLastDownloadLocation(id, downloadResult.outputPath, type);
			downloadResult.lastDownloadLocation = downloadResult.outputPath;
		}

		return downloadResult;
	}

	/**
	 * Download audio with caching and tracking download location
	 * @param {string} id - Video ID
	 * @param {Object} options - Options for downloading audio
	 * @returns {Promise<Object>} Download result with lastDownloadLocation
	 */
	async downloadMusicWithCache(id, options) {
		const cache = await this._getCacheEntry(id);
		const type = "audio";

		// Check if there's a cached download location and the file exists
		if (cache.downloads && cache.downloads[type]) {
			//console.log(`[downloadMusicWithCache] ${id} cached.`);
			const existingFilePath = cache.downloads[type].path;
			const fileStillExists = await fileExists(existingFilePath);

			if (fileStillExists) {
				return {
					lastDownloadLocation: existingFilePath,
					fromCache: true
				};
			}

			// If file no longer exists, remove the cached location
			delete cache.downloads[type];
			await this._saveCacheEntry(id, cache);
		}
		//console.log(`[downloadMusicWithCache] No cache for ${id}.`);

		// Perform the download
		const downloadResult = await this.downloadAudio(id, options);

		// If download was successful, cache the download location
		if (downloadResult && downloadResult.outputPath) {
			await this.setLastDownloadLocation(id, downloadResult.outputPath, type);
			downloadResult.lastDownloadLocation = downloadResult.outputPath;
		}

		return downloadResult;
	}
}

module.exports = VideoCacheManager;
