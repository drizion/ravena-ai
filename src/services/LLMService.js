const axios = require("axios");
const Logger = require("../utils/Logger");
const fs = require("fs");
const path = require("path");
const Database = require("../utils/Database");

/**
 * Serviço para interagir com APIs de LLM
 */
class LLMService {
	/**
	 * Cria um novo serviço LLM
	 * @param {Object} config - Opções de configuração
	 */
	constructor(config = {}) {
		this.logger = new Logger("llm-service");
		this.openAIKey = config.openAIKey ?? process.env.OPENAI_API_KEY;
		this.geminiKey = config.geminiKey ?? process.env.GEMINI_API_KEY;
		this.deepseekKey = config.deepseekKey ?? process.env.DEEPSEEK_API_KEY;
		this.localEndpoint =
			config.localEndpoint ?? process.env.LOCAL_LLM_ENDPOINT ?? "http://localhost:1234";
		this.apiTimeout = config.apiTimeout ?? parseInt(process.env.API_TIMEOUT) ?? 60000;
		this.localModel = process.env.LOCAL_LLM_MODEL ?? "google/gemma-3-12b";
		this.LMStudioToken = process.env.LMSTUDIO_TOKEN ?? "";
		this.ollamaEndpoint =
			config.ollamaEndpoint ?? process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434";
		this.ollamaModel = config.ollamaModel ?? process.env.OLLAMA_MODEL ?? "gemma3:12b";

		// Initialize Database for stats
		this.database = Database.getInstance();
		this.DB_NAME = "llm_stats";

		this.database.getSQLiteDb(
			this.DB_NAME,
			`
			CREATE TABLE IF NOT EXISTS usage_stats (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				timestamp INTEGER,
				provider TEXT,
				model TEXT,
				request_type TEXT,
				input_tokens INTEGER,
				output_tokens INTEGER
			);
			CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_stats(timestamp);
			`
		);

		this.providerDefinitions = [
			{
				name: "ollama-gemma3:27b",
				method: async (options) => {
					//options.model = "ministral-3:14b";
					options.model = "gemma3:27b";
					options.timeout = options.timeout ?? 15000;
					const response = await this.ollamaCompletion({
						customEndpoint: "http://192.168.195.211:11434",
						...options
					});
					if (response && response.message && response.message.content) {
						return response.message.content;
					}
					if (response && response.choices && response.choices[0] && response.choices[0].message) {
						return response.choices[0].message.content;
					}
					throw new Error("Resposta inválida ou vazia do Ollama");
				}
			},

			{
				name: "gemini",
				method: async (options) => {
					const response = await this.geminiCompletion(options);
					return response.candidates[0].content.parts[0].text;
				}
			}

			// {
			// 	name: "ollama-gemma3:12b-it-qat",
			// 	method: async (options) => {
			// 		options.model = "gemma3:12b-it-qat";
			// 		options.timeout = options.timeout ?? 60000;
			// 		options.ignoreVideo = true;
			// 		const response = await this.ollamaCompletion({
			// 			customEndpoint: "http://192.168.3.200:12345",
			// 			...options
			// 		});
			// 		if (response && response.message && response.message.content) {
			// 			return response.message.content;
			// 		}
			// 		if (response && response.choices && response.choices[0] && response.choices[0].message) {
			// 			return response.choices[0].message.content;
			// 		}
			// 		throw new Error("Resposta inválida ou vazia do Ollama");
			// 	}
			// }

			// {
			// 	name: 'lmstudio',
			// 	method: async (options) => {
			// 		const response = await this.lmstudioCompletion(options);
			// 		return response.choices[0].message.content;
			// 	}
			// },
		];

		this.providerQueue = [...this.providerDefinitions];
		this.lastQueueChangeTimestamp = 0;
		this.resetQueueTimeout = 10 * 60 * 1000; // 10 minutos
	}

	/**
	 * Updates and logs the token usage to SQLite.
	 * @param {string} provider - The name of the provider.
	 * @param {Object} response - The API response object containing usage data.
	 * @param {string} model - The model used.
	 * @param {Object} options - Original request options (to determine request type).
	 * @private
	 */
	async _trackUsage(provider, response, model, options) {
		let promptTokens = 0;
		let completionTokens = 0;

		// Determine request type
		let requestType = "text";
		if (options.images && options.images.length > 1) {
			requestType = "video";
		} else if (options.image || (options.images && options.images.length > 0)) {
			requestType = "image";
		}

		// OpenAI / Deepseek / LMStudio
		if (response.usage) {
			promptTokens = response.usage.prompt_tokens || 0;
			completionTokens = response.usage.completion_tokens || 0;
		}
		// Gemini
		else if (response.usageMetadata) {
			promptTokens = response.usageMetadata.promptTokenCount || 0;
			completionTokens = response.usageMetadata.candidatesTokenCount || 0;
		}
		// Ollama (standard /api/chat)
		else if (response.prompt_eval_count !== undefined || response.eval_count !== undefined) {
			promptTokens = response.prompt_eval_count || 0;
			completionTokens = response.eval_count || 0;
		}

		if (promptTokens > 0 || completionTokens > 0) {
			this.logger.info(
				`[TokenUsage][${provider}] Type: ${requestType} | Model: ${model} | In: ${promptTokens} | Out: ${completionTokens}`
			);

			try {
				await this.database.dbRun(
					this.DB_NAME,
					`INSERT INTO usage_stats (timestamp, provider, model, request_type, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?)`,
					[Date.now(), provider, model, requestType, promptTokens, completionTokens]
				);
			} catch (e) {
				this.logger.error("Error saving LLM stats:", e);
			}
		}
	}

	/**
	 * Retrieves aggregated usage statistics from the database.
	 * @returns {Promise<Object>} - Aggregated stats.
	 */
	async getStats() {
		try {
			const rows = await this.database.dbAll(this.DB_NAME, "SELECT * FROM usage_stats");

			const stats = {
				total_requests: 0,
				total_input_tokens: 0,
				total_output_tokens: 0,
				by_type: {
					text: { requests: 0, input_tokens: 0, output_tokens: 0 },
					image: { requests: 0, input_tokens: 0, output_tokens: 0 },
					video: { requests: 0, input_tokens: 0, output_tokens: 0 }
				},
				by_provider: {}
			};

			for (const row of rows) {
				stats.total_requests++;
				stats.total_input_tokens += row.input_tokens;
				stats.total_output_tokens += row.output_tokens;

				const type = row.request_type || "text";
				if (!stats.by_type[type]) {
					stats.by_type[type] = {
						requests: 0,
						input_tokens: 0,
						output_tokens: 0
					};
				}

				stats.by_type[type].requests++;
				stats.by_type[type].input_tokens += row.input_tokens;
				stats.by_type[type].output_tokens += row.output_tokens;

				const provider = row.provider;
				if (!stats.by_provider[provider]) {
					stats.by_provider[provider] = {
						requests: 0,
						input_tokens: 0,
						output_tokens: 0
					};
				}
				stats.by_provider[provider].requests++;
				stats.by_provider[provider].input_tokens += row.input_tokens;
				stats.by_provider[provider].output_tokens += row.output_tokens;
			}

			return stats;
		} catch (e) {
			this.logger.error("Error getting stats", e);
			return {};
		}
	}

	/**
	 * Envia uma solicitação de completação para API Gemini
	 * @param {Object} options - Opções de solicitação
	 * @param {string} options.prompt - O texto do prompt
	 * @param {string} [options.model='gemini-2.5-flash-lite'] - O modelo a usar
	 * @param {number} [options.maxTokens=1000] - Número máximo de tokens a gerar
	 * @param {number} [options.temperature=0.7] - Temperatura de amostragem
	 * @returns {Promise<Object>} - A resposta da API
	 */
	async geminiCompletion(options) {
		try {
			if (!this.geminiKey) {
				this.logger.error("Chave da API Gemini não configurada");
				throw new Error("Chave da API Gemini não configurada");
			}

			const model = "gemini-2.5-flash-lite";
			this.logger.debug("[LLMService] Enviando solicitação para API Gemini:", {
				model,
				promptLength: options.prompt.length,
				maxTokens: options.maxTokens ?? 5000
			});

			this.logger.info(
				`[LLMService][geminiCompletion] Prompt: ${this.summarizeString(options.prompt)}`
			);

			// Endpoint da API Gemini
			const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiKey}`;

			// Prepare parts with text prompt
			const parts = [{ text: options.prompt }];

			// Handle images if present
			if (options.images || options.image) {
				let imagesToProcess = options.images ? options.images : [options.image];

				if (options.ignoreVideo) {
					imagesToProcess = [imagesToProcess[0]];
				}

				for (const img of imagesToProcess) {
					let base64Image;
					let mimeType = "image/jpeg"; // Default fallback

					if (img.startsWith("data:image")) {
						// Attempt to extract mime type from data URI
						const matches = img.match(/^data:(.+);base64,(.+)$/);
						if (matches) {
							mimeType = matches[1];
							base64Image = matches[2];
						} else {
							// Simple fallback if regex fails but starts with data:image
							base64Image = img.split(",")[1];
						}
					} else if (fs.existsSync(img)) {
						base64Image = fs.readFileSync(img, "base64");
						const ext = path.extname(img).toLowerCase().replace(".", "");
						if (ext === "png") mimeType = "image/png";
						else if (ext === "webp") mimeType = "image/webp";
						else if (ext === "heic") mimeType = "image/heic";
						else if (ext === "heif") mimeType = "image/heif";
						// default remains jpeg
					} else {
						// Assume raw base64 string
						base64Image = img;
					}

					if (base64Image) {
						parts.push({
							inline_data: {
								mime_type: mimeType,
								data: base64Image
							}
						});
					}
				}
			}

			const response = await axios.post(
				endpoint,
				{
					contents: [{ role: "user", parts }],
					system_instruction: {
						parts: [
							{
								text:
									options.systemContext ??
									"Você é ravena, um bot de whatsapp criado por moothz. Não se apresente, a menos que solicitado pelo usuário."
							}
						]
					},
					generationConfig: {
						maxOutputTokens: options.maxTokens ?? 5000,
						temperature: options.temperature ?? 0.7
					}
				},
				{
					headers: {
						"Content-Type": "application/json"
					},
					timeout: options.timeout ?? this.apiTimeout
				}
			);

			// this.logger.debug('Resposta recebida da API Gemini', {
			//	 status: response.status,
			//	 contentLength: JSON.stringify(response.data).length
			// });

			this._trackUsage("Gemini", response.data, model, options);

			return response.data;
		} catch (error) {
			this.logger.error("[LLMService] Erro ao chamar API Gemini:", error.message);
			if (error.response) {
				this.logger.error(
					"[LLMService] Gemini API Response Error:",
					JSON.stringify(error.response.data)
				);
			}
			throw error;
		}
	}

	/**
	 * Envia uma solicitação de completação para API Deepseek
	 * @param {Object} options - Opções de solicitação
	 * @param {string} options.prompt - O texto do prompt
	 * @param {string} [options.model='deepseek-chat'] - O modelo a usar
	 * @param {number} [options.maxTokens=1000] - Número máximo de tokens a gerar
	 * @param {number} [options.temperature=0.7] - Temperatura de amostragem
	 * @param {string} [options.version='v3'] - Versão da API (v1 para R1, v3 para Chat V3)
	 * @returns {Promise<Object>} - A resposta da API
	 */
	async deepseekCompletion(options) {
		try {
			if (!this.deepseekKey) {
				this.logger.error("Chave da API Deepseek não configurada");
				throw new Error("Chave da API Deepseek não configurada");
			}

			const model = options.version === "v1" ? "deepseek-coder" : "deepseek-chat";
			const baseUrl = `https://api.deepseek.com/${options.version ?? "v3"}`;

			this.logger.debug("Enviando solicitação para API Deepseek:", {
				model,
				version: options.version ?? "v3",
				promptLength: options.prompt.length,
				maxTokens: options.maxTokens ?? 5000
			});

			const response = await axios.post(
				`${baseUrl}/chat/completions`,
				{
					model,
					messages: [{ role: "user", content: options.prompt }],
					max_tokens: options.maxTokens ?? 5000,
					temperature: options.temperature ?? 0.7
				},
				{
					headers: {
						Authorization: `Bearer ${this.deepseekKey}`,
						"Content-Type": "application/json"
					},
					timeout: options.timeout ?? this.apiTimeout
				}
			);

			// this.logger.debug('Resposta recebida da API Deepseek', {
			//	 status: response.status,
			//	 contentLength: JSON.stringify(response.data).length
			// });

			this._trackUsage("Deepseek", response.data, model, options);

			return response.data;
		} catch (error) {
			this.logger.error("Erro ao chamar API Deepseek:", error.message);
			throw error;
		}
	}

	/**
	 * Envia uma solicitação de completação para OpenAI (ou LM Studio local)
	 * @param {Object} options - Opções de solicitação
	 * @param {string} options.prompt - O texto do prompt
	 * @param {string} [options.model='gpt-3.5-turbo'] - O modelo a usar
	 * @param {number} [options.maxTokens=1000] - Número máximo de tokens a gerar
	 * @param {number} [options.temperature=0.7] - Temperatura de amostragem
	 * @param {boolean} [options.useLocal=false] - Se deve usar o endpoint LM Studio local
	 * @returns {Promise<Object>} - A resposta da API
	 */
	async openAICompletion(options) {
		try {
			// Determina endpoint e chave da API com base em local ou remoto
			const endpoint = options.useLocal
				? `${options.customEndpoint ?? this.localEndpoint}/chat/completions`
				: "https://api.openai.com/v1/chat/completions";

			const apiKey = options.useLocal ? `Basic ${this.LMStudioToken}` : `Bearer ${this.openAIKey}`;

			if (!options.useLocal && !this.openAIKey) {
				this.logger.error("Chave da API OpenAI não configurada");
				throw new Error("Chave da API OpenAI não configurada");
			}

			const model = options.model ?? "gpt-3.5-turbo";

			this.logger.debug(
				`Enviando solicitação para API ${options.useLocal ? "LM Studio Local" : "OpenAI"}:`,
				{
					endpoint,
					model,
					promptLength: options.prompt.length,
					maxTokens: options.maxTokens ?? 5000
				}
			);

			const ctxInclude =
				options.systemContext ??
				"Você é ravena, um bot de whatsapp criado por moothz. Não se apresente, a menos que solicitado pelo usuário.";

			const response = await axios.post(
				endpoint,
				{
					model,
					messages: [
						{ role: "system", content: ctxInclude },
						{ role: "user", content: options.prompt }
					],
					max_tokens: options.maxTokens ?? 5000,
					temperature: options.temperature ?? 0.7
				},
				{
					headers: {
						Authorization: apiKey,
						"Content-Type": "application/json"
					},
					timeout: options.timeout ?? this.apiTimeout
				}
			);

			// this.logger.debug(`Resposta recebida da API ${options.useLocal ? 'LM Studio Local' : 'OpenAI'}`, {
			//	 status: response.status,
			//	 contentLength: JSON.stringify(response.data).length
			// });

			this._trackUsage(options.useLocal ? "Local" : "OpenAI", response.data, model, options);

			return response.data;
		} catch (error) {
			this.logger.error(
				`Erro ao chamar API ${options.useLocal ? "LM Studio Local" : "OpenAI"}:`,
				error.message
			);
			throw error;
		}
	}

	/**
	 * Envia uma solicitação de completação para o LM Studio usando a API /api/v0.
	 * Para entradas de imagem, é mais eficiente fornecer a imagem já em formato base64.
	 * @param {Object} options - Opções de solicitação
	 * @param {string} options.prompt - O texto do prompt
	 * @param {string} [options.model] - O modelo a usar (caminho do modelo no LM Studio)
	 * @param {number} [options.maxTokens=4096] - Número máximo de tokens a gerar
	 * @param {number} [options.temperature=0.7] - Temperatura de amostragem
	 * @param {string} [options.image] - Imagem para entrada de visão (em base64 ou caminho do arquivo).
	 * @param {string} [options.systemContext] - Contexto do sistema
	 * @returns {Promise<Object>} - A resposta da API
	 */
	async lmstudioCompletion(options) {
		try {
			const endpoint = (options.customEndpoint ?? this.localEndpoint) + "/api/v0/chat/completions";

			const messages = [];
			const systemContext =
				options.systemContext ??
				"Você é ravena, um bot de whatsapp criado por moothz. Não se apresente, a menos que solicitado pelo usuário.";
			messages.push({ role: "system", content: systemContext });

			const userMessage = { role: "user" };

			if (options.image) {
				userMessage.content = [{ type: "text", text: options.prompt }];
				let image_url;

				if (options.image.startsWith("data:image")) {
					image_url = options.image;
				} else if (fs.existsSync(options.image)) {
					const fileContent = fs.readFileSync(options.image, "base64");
					const mimeType = path.extname(options.image).replace(".", "") ?? "jpeg";
					image_url = `data:image/${mimeType};base64,${fileContent}`;
				} else {
					image_url = `data:image/jpeg;base64,${options.image}`;
				}

				userMessage.content.push({
					type: "image_url",
					image_url: { url: image_url }
				});
			} else {
				userMessage.content = options.prompt;
			}

			messages.push(userMessage);

			const model = options.model ?? this.localModel;
			const queryOptions = {
				model,
				messages,
				max_tokens: options.maxTokens ?? 8096,
				temperature: options.temperature ?? 0.7,
				stream: false
			};

			//this.logger.debug('[LLMService][lmstudioCompletion] Enviando solicitação para API LM Studio:', queryOptions);

			if (options.response_format) {
				queryOptions.response_format = options.response_format;
			}

			const response = await axios.post(endpoint, queryOptions, {
				headers: {
					Authorization: `Bearer ${this.LMStudioToken}`,
					"Content-Type": "application/json"
				},
				timeout: options.timeout ?? this.apiTimeout
			});

			this._trackUsage("LMStudio", response.data, model, options);

			return response.data;
		} catch (error) {
			this.logger.error("[LLMService] Erro ao chamar API LM Studio:", error.message);
			throw error;
		}
	}

	summarizeString(text) {
		if (typeof text !== "string") return "";

		if (text.length <= 200) {
			return text;
		}

		const firstPart = text.slice(0, 100);
		const lastPart = text.slice(-100);

		return `${firstPart}[...]${lastPart}`;
	}

	/**
	 * Sends a completion request to the Ollama API.
	 * This method handles text, system context, and image inputs.
	 * @param {Object} options - Request options.
	 * @param {string} options.prompt - The text prompt.
	 * @param {string} [options.model] - The model to use (e.g., 'gemma3:12b').
	 * @param {number} [options.maxTokens=8096] - Maximum number of tokens to generate. Ollama uses 'num_predict'.
	 * @param {number} [options.temperature=0.7] - Sampling temperature.
	 * @param {string} [options.image] - Image for vision input (can be a file path or a base64 string).
	 * @param {string} [options.systemContext] - The system context/instruction.
	 * @param {number} [options.timeout] - Request timeout in milliseconds.
	 * @returns {Promise<Object>} - The response from the Ollama API.
	 */
	async ollamaCompletion(options) {
		try {
			const debugPrompt = options.debugPrompt ?? true;

			const endpoint = (options.customEndpoint ?? this.ollamaEndpoint) + "/api/chat";

			const messages = [];
			const systemContext =
				options.systemContext ??
				"Você é ravena, um bot de whatsapp criado por moothz. Não se apresente, a menos que solicitado pelo usuário.";
			messages.push({ role: "system", content: systemContext });

			const userMessage = {
				role: "user",
				content: options.prompt
			};

			if (options.images || options.image) {
				let imagesToProcess = options.images ? options.images : [options.image];
				const processedImages = [];

				if (options.ignoreVideo) {
					imagesToProcess = [imagesToProcess[0]];
				}

				for (const img of imagesToProcess) {
					let base64Image;
					if (img.startsWith("data:image")) {
						base64Image = img.split(",")[1];
					} else if (fs.existsSync(img)) {
						base64Image = fs.readFileSync(img, "base64");
					} else {
						base64Image = img;
					}

					if (base64Image) {
						processedImages.push(base64Image);
					}
				}

				if (processedImages.length > 0) {
					userMessage.images = processedImages;
				}
			}

			messages.push(userMessage);

			let ollamaFormat = null;
			if (options.response_format) {
				if (
					options.response_format.type === "json_schema" &&
					options.response_format.json_schema?.schema
				) {
					ollamaFormat = options.response_format.json_schema.schema;
				} else {
					ollamaFormat = options.response_format;
				}
			}

			const payload = {
				model: options.model ?? this.ollamaModel,
				messages,
				format: ollamaFormat,
				stream: false,
				options: {
					temperature: options.temperature ?? 0.7,
					num_predict: options.maxTokens ?? 8096
				}
			};

			const toTime = options.timeout ?? this.apiTimeout ?? 60000;
			const debugData = {
				endpoint,
				model: payload.model,
				promptLength: options.prompt.length,
				hasImage: !!options.image,
				hasSchema: !!ollamaFormat, // Log if we are using a schema
				timeout: toTime
			};

			if (debugPrompt) {
				this.logger.debug("[LLMService][ollamaCompletion] Sending request to Ollama API", {
					size: options.prompt.length,
					prompt: this.summarizeString(options.prompt)
				}); // , debugData
			} else {
				this.logger.debug("[LLMService][ollamaCompletion] Sending request to Ollama API");
			}

			const response = await axios.post(endpoint, payload, {
				headers: {
					"Content-Type": "application/json"
				},
				timeout: toTime
			});

			this._trackUsage("Ollama", response.data, payload.model, options);

			return response.data;
		} catch (error) {
			// Enhanced error logging
			this.logger.error("[LLMService] Error calling Ollama API:", error.message);
			if (error.response) {
				//this.logger.error('Ollama API Response Error Data:', error.response.data);
				this.logger.error("[LLMService] Ollama API Response Error:", error.response.status);
			} else if (error.request) {
				this.logger.error("[LLMService] Ollama API No Response Received.");
			}
			throw error;
		}
	}

	/**
	 * Obtém completação de texto de qualquer LLM configurado
	 * @param {Object} options - Opções de solicitação
	 * @param {string} options.prompt - O texto do prompt
	 * @param {string} [options.provider='openai'] - O provedor a usar ('openai', 'gemini', 'deepseek', 'lmstudio', ou 'local')
	 * @param {string} [options.model] - O modelo a usar (específico do provedor)
	 * @param {number} [options.maxTokens=1000] - Número máximo de tokens a gerar
	 * @param {number} [options.temperature=0.7] - Temperatura de amostragem
	 * @returns {Promise<string>} - O texto gerado
	 */
	async getCompletion(options) {
		try {
			// Se um provedor específico for solicitado, use-o diretamente
			if (options.provider) {
				this.logger.debug("[LLMService] Obtendo completação com opções:", {
					provider: options.provider,
					promptLength: options.prompt.length,
					temperature: options.temperature ?? 0.7
				});

				let response = await this.getCompletionFromSpecificProvider(options);
				response = response
					.replace(/<think>.*?<\/think>/gs, "")
					.trim()
					.replace(/^"|"$/g, ""); // Remove tags de think e frase entre aspas

				return response;
			}
			// Caso contrário, tente múltiplos provedores em sequência
			else {
				//this.logger.debug('[LLMService] Nenhum provedor específico solicitado, tentando múltiplos provedores em sequência');

				let response = await this.getCompletionFromProviders(options);
				response = response
					.replace(/<think>.*?<\/think>/gs, "")
					.trim()
					.replace(/^"|"$/g, ""); // Remove tags de think e frase entre aspas

				return response;
			}
		} catch (error) {
			this.logger.error("Erro ao obter completação:", error.message);
			return "Ocorreu um erro ao gerar uma resposta. Por favor, tente novamente mais tarde.";
		}
	}

	/**
	 * Obtém completação de um provedor específico
	 * @param {Object} options - Opções de solicitação
	 * @returns {Promise<string>} - O texto gerado
	 * @private
	 */
	async getCompletionFromSpecificProvider(options) {
		let response;

		switch (options.provider) {
			case "lmstudio":
				response = await this.lmstudioCompletion(options);
				if (
					!response ||
					!response.choices ||
					!response.choices[0] ||
					!response.choices[0].message
				) {
					this.logger.error("Resposta inválida da API LM Studio:", response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;

			case "ollama":
				response = await this.ollamaCompletion(options);
				if (
					!response ||
					!response.choices ||
					!response.choices[0] ||
					!response.choices[0].message
				) {
					this.logger.error("Resposta inválida da API ollama:", response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;

			case "gemini":
				response = await this.geminiCompletion(options);
				if (
					!response ||
					!response.candidates ||
					!response.candidates[0] ||
					!response.candidates[0].content ||
					!response.candidates[0].content.parts ||
					!response.candidates[0].content.parts[0]
				) {
					this.logger.error("Resposta inválida da API Gemini:", response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.candidates[0].content.parts[0].text;

			case "deepseek-r1":
				response = await this.deepseekCompletion({ ...options, version: "v1" });
				if (
					!response ||
					!response.choices ||
					!response.choices[0] ||
					!response.choices[0].message
				) {
					this.logger.error("Resposta inválida da API Deepseek R1:", response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;

			case "deepseek":
				response = await this.deepseekCompletion({ ...options, version: "v3" });
				if (
					!response ||
					!response.choices ||
					!response.choices[0] ||
					!response.choices[0].message
				) {
					this.logger.error("Resposta inválida da API Deepseek:", response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;

			case "local":
				response = await this.openAICompletion({
					...options,
					useLocal: true,
					model: this.localModel
				});
				if (
					!response ||
					!response.choices ||
					!response.choices[0] ||
					!response.choices[0].message
				) {
					this.logger.error("Resposta inválida da API Local:", response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;

			case "openai":
			default:
				response = await this.openAICompletion(options);
				if (
					!response ||
					!response.choices ||
					!response.choices[0] ||
					!response.choices[0].message
				) {
					this.logger.error("Resposta inválida da API OpenAI:", response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;
		}
	}

	/**
	 * Tenta múltiplos provedores em sequência até que um funcione
	 * @param {Object} options - Opções de solicitação
	 * @returns {Promise<string>} - O texto gerado pelo primeiro provedor disponível
	 */
	async getCompletionFromProviders(options) {
		const now = Date.now();
		if (
			this.lastQueueChangeTimestamp > 0 &&
			now - this.lastQueueChangeTimestamp > this.resetQueueTimeout
		) {
			this.logger.info(
				"[LLMService] Resetando a fila de provedores para a ordem padrão após 30 minutos."
			);
			this.providerQueue = [...this.providerDefinitions];
			this.lastQueueChangeTimestamp = 0;
		}

		const totalProviders = this.providerQueue.length;
		if (totalProviders === 0) {
			this.logger.error("Nenhum provedor definido.");
			return "Erro: Nenhum provedor de IA configurado.";
		}

		for (let i = 0; i < totalProviders; i++) {
			const provider = this.providerQueue[0]; // Sempre tenta o provedor no início da fila
			try {
				this.logger.debug(`[LLMService] Tentando provedor: ${provider.name}`);
				const result = await provider.method(options);

				if (!result || typeof result !== "string" || result.trim() === "") {
					throw new Error("Resposta vazia ou inválida do provedor");
				}

				if (!result.includes("Imagem[")) {
					this.logger.debug(
						`[LLMService] Provedor ${provider.name} retornou resposta com sucesso`,
						{ result: this.summarizeString(result) }
					);
				}

				// O provedor bem-sucedido já está no início da fila, bom para a próxima vez.
				return result;
			} catch (error) {
				this.logger.error(`Erro ao usar provedor ${provider.name}:`, error.message);

				// Rebaixa o provedor que falhou, movendo-o para o final da fila.
				this.logger.warn(`[LLMService] Rebaixando provedor ${provider.name} para o final da fila.`);
				this.providerQueue.push(this.providerQueue.shift());
				this.lastQueueChangeTimestamp = Date.now();
			}
		}

		// Se o loop terminar, todos os provedores foram tentados e falharam.
		this.logger.error("Todos os provedores falharam");
		return "Erro: Não foi possível gerar uma resposta de nenhum provedor disponível. Por favor, tente novamente mais tarde.";
	}
}

module.exports = LLMService;
