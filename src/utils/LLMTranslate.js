const crypto = require("crypto");
const Logger = require("./Logger");
const Database = require("./Database");
const { translateText } = require("../functions/TranslationCommands");

const logger = new Logger("llm-translate");
const database = Database.getInstance();
const dbName = "translation-cache";

// Initialize database
database.getSQLiteDb(
	dbName,
	`
    CREATE TABLE IF NOT EXISTS cached_translations (
      hash TEXT PRIMARY KEY,
      original_text TEXT,
      translated_text TEXT,
      target_language TEXT,
      created_at INTEGER
    );
`
);

/**
 * Computes MD5 hash of text and target language
 * @param {string} text
 * @param {string} targetLanguage
 * @returns {string}
 */
function getHash(text, targetLanguage) {
	return crypto.createHash("md5").update(`${text}_${targetLanguage}`).digest("hex");
}

/**
 * Translates text using LLM with caching
 * @param {string} text - Text to translate
 * @param {string} targetLanguage - Target language (e.g., "Spanish (ES)")
 * @param {Object} llmService - Instance of LLMService
 * @returns {Promise<string>} - Translated text
 */
async function llmTranslate(text, targetLanguage, llmService) {
	if (!text || typeof text !== "string" || text.trim().length === 0) return text;

	// 1. Check Cache
	const hash = getHash(text, targetLanguage);
	try {
		const cached = await database.dbGet(
			dbName,
			"SELECT translated_text FROM cached_translations WHERE hash = ?",
			[hash]
		);
		if (cached) {
			//logger.debug(`[llmTranslate] Cache hit for '${text.substring(0, 20)}...'`);
			return cached.translated_text;
		}
	} catch (error) {
		logger.error("Error checking translation cache:", error);
	}

	// 2. LLM Translation
	let translatedText = null;
	try {
		const completionOptions = {
			prompt: text,
			systemContext: `You are a professional translator engine.
Source Language: Brazilian Portuguese (PT-BR)
Target Language: ${targetLanguage}

RULES:
1. Translate the TEXT CONTENT only.
2. DO NOT translate words preceding ! directly, like '!comandos' or '!ajuda'. These are bot commands.
2. DO NOT translate, remove, or change any EMOJIS. Keep them exactly where they are.
3. DO NOT change any formatting marks (like *bold*, _italics_, ~strikethrough~, or \`code\`).
4. DO NOT add conversational filler (like "Here is the translation"). Output ONLY the translated string.
5. If the text is only emojis/symbols, return it unchanged.
6. DO NOT translate commands (strings starting with '!', '.', '/', or '#'). Return them exactly as is.`
		};

		const response = await llmService.getCompletion(completionOptions);
		if (response?.toLowerCase().startsWith("erro:")) {
			throw new Error("Falha no LLM");
		}
		if (response && response.trim().length > 0) {
			translatedText = response.trim();
		}
	} catch (e) {
		logger.warn(`[llmTranslate] LLM translation failed, trying fallback: ${e.message}`);
	}

	// 3. Fallback Translation
	if (!translatedText) {
		try {
			// extract 'es' from 'Spanish (ES)'
			const match = targetLanguage.match(/\(([^)]+)\)/);
			const langCode = match
				? match[1].toLowerCase()
				: targetLanguage.length === 2
					? targetLanguage
					: "en";
			translatedText = await translateText(text, "pt", langCode);
		} catch (e) {
			logger.error(`[llmTranslate] Fallback translation failed: ${e.message}`);
			return text;
		}
	}

	// 4. Save to Cache
	if (translatedText) {
		try {
			await database.dbRun(
				dbName,
				`
        INSERT OR REPLACE INTO cached_translations (hash, original_text, translated_text, target_language, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
				[hash, text, translatedText, targetLanguage, Date.now()]
			);
		} catch (error) {
			logger.error("Error saving translation to cache:", error);
		}
	}

	return translatedText;
}

module.exports = {
	llmTranslate
};
