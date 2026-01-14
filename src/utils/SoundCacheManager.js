/* WIP! Não funciona ainda pra baixar */
const fs = require("fs").promises;
const path = require("path");

const SC_CACHE_FILE = "soundcloud-cache.json";

// Helper function to check if a file exists
async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

class SoundCacheManager {
	constructor(soundcloud, databasePath) {
		this.soundcloud = soundcloud;
		this.cachePath = path.join(databasePath, SC_CACHE_FILE);
	}

	/**
	 * Read the cache file, creating it if it doesn't exist
	 * @returns {Promise<Object>} Parsed cache object
	 */
	async _readCache() {
		try {
			const cacheContent = await fs.readFile(this.cachePath, "utf8");
			return JSON.parse(cacheContent);
		} catch (error) {
			// If file doesn't exist or can't be read, return an empty cache
			console.error(`[SoundCacheManager._readCache] Error, resetting cache.`);
			await this._writeCache({});

			return {};
		}
	}

	getTimestamp() {
		const tzoffset = new Date().getTimezoneOffset() * 60000; //offset in milliseconds
		const localISOTime = new Date(Date.now() - tzoffset)
			.toISOString()
			.replace(/T/, " ")
			.replace(/\..+/, "");
		return localISOTime;
	}

	/**
	 * Write the entire cache to file
	 * @param {Object} cache - The cache object to write
	 */
	async _writeCache(cache) {
		try {
			await fs.writeFile(this.cachePath, JSON.stringify(cache, null, 2), "utf8");
		} catch (error) {
			console.error("Error writing soundcloud cache:", error);
			throw error;
		}
	}

	/**
	 * Get track info with caching
	 * @param {string} id - Track ID
	 * @returns {Promise<Object>} Track information
	 */
	async getTrackInfoWithCache(id) {
		const cache = await this._readCache();

		// If cached info exists, return it
		if (cache[id] && cache[id].trackInfo) {
			return cache[id].trackInfo;
		}

		// Fetch new track info
		const trackInfo = await this.soundcloud.tracks.get(id);

		// Update cache
		cache[id] = cache[id] || {};
		cache[id].trackInfo = {
			id: trackInfo.id,
			title: trackInfo.title,
			user: trackInfo.user.username,
			duration: trackInfo.duration,
			timestamp: this.getTimestamp(),
			ts: Math.round(+new Date() / 1000)
		};

		// Write updated cache
		await this._writeCache(cache);

		return trackInfo;
	}

	/**
	 * Set the last download location for a track
	 * @param {string} id - Track ID
	 * @param {string} downloadPath - Path where the audio was downloaded
	 */
	async setLastDownloadLocation(id, downloadPath) {
		const cache = await this._readCache();

		// Ensure the entry for this ID exists
		cache[id] = cache[id] || {};

		// Store download location
		cache[id].downloads = cache[id].downloads || {};
		cache[id].downloads["audio"] = {
			path: downloadPath,
			timestamp: Date.now()
		};

		// Write updated cache
		await this._writeCache(cache);
	}

	async _downloadTrack(track, options) {
		try {
			const downloadPaths = await this.soundcloud.util.downloadTracks([track], options.path);
			if (downloadPaths && downloadPaths.length > 0) {
				return { outputPath: downloadPaths[0] };
			}
			return null;
		} catch (error) {
			console.error(
				`[SoundCacheManager._downloadTrack] Error downloading track ${track.id}:`,
				error
			);
			return null;
		}
	}

	/**
	 * Download audio with caching and tracking download location
	 * @param {Object} track - The track object from soundcloud.ts
	 * @param {Object} options - Options for downloading audio
	 * @returns {Promise<Object>} Download result with lastDownloadLocation
	 */
	async downloadTrackWithCache(track, options) {
		const cache = await this._readCache();
		const id = track.id;

		if (cache[id] && cache[id].downloads && cache[id].downloads["audio"]) {
			const existingFilePath = cache[id].downloads["audio"].path;
			if (await fileExists(existingFilePath)) {
				console.log(`[SoundCacheManager.downloadTrackWithCache] ${id} cached.`);
				return { lastDownloadLocation: existingFilePath, fromCache: true };
			}
			delete cache[id].downloads["audio"];
			await this._writeCache(cache);
		}

		console.log(`[SoundCacheManager.downloadTrackWithCache] No cache for ${id}, downloading.`);
		const downloadResult = await this._downloadTrack(track, options);

		console.log("cache download", downloadResult);
		if (downloadResult && downloadResult.outputPath) {
			await this.setLastDownloadLocation(id, downloadResult.outputPath);
			downloadResult.lastDownloadLocation = downloadResult.outputPath;
		}

		return downloadResult;
	}
}

module.exports = SoundCacheManager;
