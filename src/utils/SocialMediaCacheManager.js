const fs = require("fs").promises;
const path = require("path");

const SMD_CACHE_FILE = "smd-cache.json";

// Helper function to check if a file exists
async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Gerenciador de cache para downloads de mídias sociais
 */
class SocialMediaCacheManager {
	/**
	 * Cria uma nova instância do SocialMediaCacheManager
	 * @param {string} databasePath - Caminho para o diretório de cache
	 */
	constructor(databasePath) {
		this.cachePath = path.join(databasePath, SMD_CACHE_FILE);
	}

	/**
	 * Obtém o timestamp atual no formato legível
	 * @returns {string} Timestamp formatado
	 */
	getTimestamp() {
		const tzoffset = new Date().getTimezoneOffset() * 60000; // Offset em milissegundos
		const localISOTime = new Date(Date.now() - tzoffset)
			.toISOString()
			.replace(/T/, " ")
			.replace(/\..+/, "");
		return localISOTime;
	}

	/**
	 * Lê o arquivo de cache, criando-o se não existir
	 * @returns {Promise<Object>} Objeto de cache parseado
	 */
	async _readCache() {
		try {
			const cacheContent = await fs.readFile(this.cachePath, "utf8");
			return JSON.parse(cacheContent);
		} catch (error) {
			// Se o arquivo não existe ou não pode ser lido, retorna um cache vazio
			console.error(`[_readCache] Erro, reiniciando cache.`);
			await this._writeCache({});
			return {};
		}
	}

	/**
	 * Escreve o cache inteiro no arquivo
	 * @param {Object} cache - O objeto de cache a ser escrito
	 */
	async _writeCache(cache) {
		try {
			await fs.writeFile(this.cachePath, JSON.stringify(cache, null, 2), "utf8");
		} catch (error) {
			console.error("Erro ao escrever cache:", error);
			throw error;
		}
	}

	/**
	 * Armazena informações de download no cache
	 * @param {string} url - URL do conteúdo baixado
	 * @param {Array<string>} filePaths - Caminhos dos arquivos baixados
	 * @param {string} platform - Plataforma de origem (instagram, tiktok, etc)
	 */
	async storeDownloadInfo(url, filePaths, platform) {
		const cache = await this._readCache();

		// Normaliza a URL como chave do cache
		const normalizedUrl = url.trim().toLowerCase();

		// Armazena os dados no cache
		cache[normalizedUrl] = {
			url,
			platform,
			files: filePaths,
			timestamp: this.getTimestamp(),
			ts: Math.round(+new Date() / 1000)
		};

		// Salva o cache atualizado
		await this._writeCache(cache);
	}

	/**
	 * Verifica se o conteúdo da URL já foi baixado e ainda existe
	 * @param {string} url - URL do conteúdo
	 * @returns {Promise<Object|null>} Informações do cache ou null se não existe
	 */
	async getCachedDownload(url) {
		const cache = await this._readCache();
		const normalizedUrl = url.trim().toLowerCase();

		if (!cache[normalizedUrl]) {
			return null;
		}

		const cacheEntry = cache[normalizedUrl];

		// Verifica se todos os arquivos ainda existem
		if (cacheEntry.files && Array.isArray(cacheEntry.files)) {
			for (const filePath of cacheEntry.files) {
				const fileStillExists = await fileExists(filePath);
				if (!fileStillExists) {
					// Se algum arquivo não existir, considera o cache inválido
					return null;
				}
			}

			// Todos os arquivos existem, retorna a entrada do cache
			return {
				files: cacheEntry.files,
				platform: cacheEntry.platform,
				fromCache: true
			};
		}

		return null;
	}

	/**
	 * Remove entradas expiradas do cache
	 * @param {number} maxAge - Idade máxima em segundos (padrão: 7 dias)
	 */
	async cleanupExpiredEntries(maxAge = 7 * 24 * 60 * 60) {
		const cache = await this._readCache();
		const now = Math.round(+new Date() / 1000);
		let entriesRemoved = 0;

		for (const [url, entry] of Object.entries(cache)) {
			// Verifica se a entrada tem timestamp
			if (!entry.ts) {
				continue;
			}

			// Verifica se a entrada expirou
			if (now - entry.ts > maxAge) {
				delete cache[url];
				entriesRemoved++;
			}
		}

		if (entriesRemoved > 0) {
			await this._writeCache(cache);
			console.log(`Removidas ${entriesRemoved} entradas expiradas do cache.`);
		}
	}
}

module.exports = SocialMediaCacheManager;
