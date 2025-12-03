const axios = require('axios');
const Logger = require('../utils/Logger');
const fs = require('fs');
const path = require('path');

/**
 * Serviço para interagir com APIs de LLM
 */
class LLMService {
	/**
	 * Cria um novo serviço LLM
	 * @param {Object} config - Opções de configuração
	 */
	constructor(config = {}) {
		this.logger = new Logger('llm-service');
		this.openRouterKey = config.openRouterKey || process.env.OPENROUTER_API_KEY;
		this.openAIKey = config.openAIKey || process.env.OPENAI_API_KEY;
		this.googleKey = config.googleKey || process.env.GOOGLE_API_KEY;
		this.deepseekKey = config.deepseekKey || process.env.DEEPSEEK_API_KEY;
		this.localEndpoint = config.localEndpoint || process.env.LOCAL_LLM_ENDPOINT || 'http://localhost:1234';
		this.apiTimeout = config.apiTimeout || parseInt(process.env.API_TIMEOUT) || 60000;
		this.localModel = process.env.LOCAL_LLM_MODEL || "google/gemma-3-12b";
		this.LMStudioToken = process.env.LMSTUDIO_TOKEN ?? "";
		this.ollamaEndpoint = config.ollamaEndpoint || process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
		this.ollamaModel = config.ollamaModel || process.env.OLLAMA_MODEL || 'gemma3:12b';

		this.providerDefinitions = [
			{
				name: 'ollama',
				method: async (options) => {
					const response = await this.ollamaCompletion({customEndpoint: "http://192.168.195.211:11434", ...options});
					if (response && response.message && response.message.content) {
						return response.message.content;
					}
					if (response && response.choices && response.choices[0] && response.choices[0].message) {
						return response.choices[0].message.content;
					}
					throw new Error('Resposta inválida ou vazia do Ollama');
				}
			}
			// {
			// 	name: 'ollama',
			// 	method: async (options) => {
			// 		const response = await this.ollamaCompletion({customEndpoint: "http://192.168.3.200:12345", ...options});
			// 		if (response && response.message && response.message.content) {
			// 			return response.message.content;
			// 		}
			// 		if (response && response.choices && response.choices[0] && response.choices[0].message) {
			// 			return response.choices[0].message.content;
			// 		}
			// 		throw new Error('Resposta inválida ou vazia do Ollama');
			// 	}
			// },
			// {
			// 	name: 'lmstudio',
			// 	method: async (options) => {
			// 		const response = await this.lmstudioCompletion(options);
			// 		return response.choices[0].message.content;
			// 	}
			// },
			// {
			// 	name: 'gemini',
			// 	method: async (options) => {
			// 		const response = await this.geminiCompletion(options);
			// 		return response.candidates[0].content.parts[0].text;
			// 	}
			// }
		];

		this.providerQueue = [...this.providerDefinitions];
		this.lastQueueChangeTimestamp = 0;
		this.resetQueueTimeout = 30 * 60 * 1000; // 30 minutos

		/*	
		this.logger.debug('LLMService inicializado com configuração:', {
			hasOpenRouterKey: !!this.openRouterKey,
			hasOpenAIKey: !!this.openAIKey,
			hasGoogleKey: !!this.googleKey,
			hasDeepseekKey: !!this.deepseekKey,
			localEndpoint: this.localEndpoint,
			apiTimeout: this.apiTimeout
		});
		*/
	}

	/**
	 * Envia uma solicitação de completação para OpenRouter
	 * @param {Object} options - Opções de solicitação
	 * @param {string} options.prompt - O texto do prompt
	 * @param {string} [options.model='google/gemini-2.5-flash:free'] - O modelo a usar
	 * @param {number} [options.maxTokens=1000] - Número máximo de tokens a gerar
	 * @param {number} [options.temperature=0.7] - Temperatura de amostragem
	 * @returns {Promise<Object>} - A resposta da API
	 */
	async openRouterCompletion(options) {
		try {
			if (!this.openRouterKey) {
				this.logger.error('Chave da API OpenRouter não configurada');
				throw new Error('Chave da API OpenRouter não configurada');
			}

			this.logger.debug('Enviando solicitação para API OpenRouter:', { 
				model: options.model || 'google/gemini-2.5-flash:free',
				promptLength: options.prompt.length,
				maxTokens: options.maxTokens || 5000
			});

			const response = await axios.post(
				'https://openrouter.ai/api/v1/chat/completions',
				{
					model: options.model || 'google/gemini-2.5-flash:free',
					messages: [
						{ role: 'user', content: options.prompt }
					],
					max_tokens: options.maxTokens || 5000,
					temperature: options.temperature || 0.7
				},
				{
					headers: {
						'Authorization': `Bearer ${this.openRouterKey}`,
						'Content-Type': 'application/json'
					},
					timeout: options.timeout || this.apiTimeout
				}
			);

			// this.logger.debug('Resposta recebida da API OpenRouter', {
			//	 status: response.status,
			//	 data: response.data,
			//	 contentLength: JSON.stringify(response.data).length
			// });

			return response.data;
		} catch (error) {
			this.logger.error('Erro ao chamar API OpenRouter:', error.message);
			throw error;
		}
	}

	/**
	 * Envia uma solicitação de completação para API Gemini
	 * @param {Object} options - Opções de solicitação
	 * @param {string} options.prompt - O texto do prompt
	 * @param {string} [options.model='gemini-1.5-flash'] - O modelo a usar
	 * @param {number} [options.maxTokens=1000] - Número máximo de tokens a gerar
	 * @param {number} [options.temperature=0.7] - Temperatura de amostragem
	 * @returns {Promise<Object>} - A resposta da API
	 */
	async geminiCompletion(options) {
		try {
			if (!this.googleKey) {
				this.logger.error('Chave da API Google não configurada');
				throw new Error('Chave da API Google não configurada');
			}

			const model = options.model || 'gemini-2.5-flash';
			this.logger.debug('[LLMService] Enviando solicitação para API Gemini:', { 
				model: model,
				promptLength: options.prompt.length,
				maxTokens: options.maxTokens || 5000
			});

			//if(options.systemContext){
			//	this.logger.info(`[geminiCompletion] Usando ctx personalizado: ${options.systemContext.trim(0, 30)}...`);
			//}

			this.logger.info(`[LLMService][geminiCompletion] Prompt: ${options.prompt.trim(0, 30)}...`);

			// Endpoint da API Gemini
			const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.googleKey}`;


			const response = await axios.post(
				endpoint,
				{
					contents: [
						{ role: 'user', parts: [{ text: options.prompt }] }
					],
					system_instruction:
					{
						parts: [
							{
								text: options.systemContext ?? "Você é ravena, um bot de whatsapp criado por moothz"
							}
						]
					},
					generationConfig: {
						maxOutputTokens: options.maxTokens || 5000,
						temperature: options.temperature || 0.7
					}
				},
				{
					headers: {
						'Content-Type': 'application/json'
					},
					timeout: options.timeout || this.apiTimeout
				}
			);

			// this.logger.debug('Resposta recebida da API Gemini', {
			//	 status: response.status,
			//	 contentLength: JSON.stringify(response.data).length
			// });

			return response.data;
		} catch (error) {
			this.logger.error('[LLMService] Erro ao chamar API Gemini:',  error.message);
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
				this.logger.error('Chave da API Deepseek não configurada');
				throw new Error('Chave da API Deepseek não configurada');
			}

			const model = options.version === 'v1' ? 'deepseek-coder' : 'deepseek-chat';
			const baseUrl = `https://api.deepseek.com/${options.version || 'v3'}`;
			
			this.logger.debug('Enviando solicitação para API Deepseek:', { 
				model: model,
				version: options.version || 'v3',
				promptLength: options.prompt.length,
				maxTokens: options.maxTokens || 5000
			});

			const response = await axios.post(
				`${baseUrl}/chat/completions`,
				{
					model: model,
					messages: [
						{ role: 'user', content: options.prompt }
					],
					max_tokens: options.maxTokens || 5000,
					temperature: options.temperature || 0.7
				},
				{
					headers: {
						'Authorization': `Bearer ${this.deepseekKey}`,
						'Content-Type': 'application/json'
					},
					timeout: options.timeout || this.apiTimeout
				}
			);

			// this.logger.debug('Resposta recebida da API Deepseek', {
			//	 status: response.status,
			//	 contentLength: JSON.stringify(response.data).length
			// });

			return response.data;
		} catch (error) {
			this.logger.error('Erro ao chamar API Deepseek:', error.message);
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
				? `${(options.customEndpoint ?? this.localEndpoint)}/chat/completions` 
				: 'https://api.openai.com/v1/chat/completions';
			
			const apiKey = options.useLocal ? `Basic ${this.LMStudioToken}` : `Bearer ${this.openAIKey}`;
			
			if (!options.useLocal && !this.openAIKey) {
				this.logger.error('Chave da API OpenAI não configurada');
				throw new Error('Chave da API OpenAI não configurada');
			}

			this.logger.debug(`Enviando solicitação para API ${options.useLocal ? 'LM Studio Local' : 'OpenAI'}:`, { 
				endpoint,
				model: options.model || 'gpt-3.5-turbo',
				promptLength: options.prompt.length,
				maxTokens: options.maxTokens || 5000 
			});

			const ctxInclude = options.systemContext ?? "Você é ravena, um bot de whatsapp criado por moothz";
			
			const response = await axios.post(
				endpoint,
				{
					model: options.model || 'gpt-3.5-turbo',
					messages: [
						{ role: 'system', content: ctxInclude },
						{ role: 'user', content: options.prompt }
					],
					max_tokens: options.maxTokens || 5000,
					temperature: options.temperature || 0.7
				},
				{
					headers: {
						'Authorization': apiKey,
						'Content-Type': 'application/json'
					},
					timeout: options.timeout || this.apiTimeout
				}
			);

			// this.logger.debug(`Resposta recebida da API ${options.useLocal ? 'LM Studio Local' : 'OpenAI'}`, {
			//	 status: response.status,
			//	 contentLength: JSON.stringify(response.data).length
			// });

			return response.data;
		} catch (error) {
			this.logger.error(`Erro ao chamar API ${options.useLocal ? 'LM Studio Local' : 'OpenAI'}:`, error.message);
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
			const endpoint = (options.customEndpoint ?? this.localEndpoint) + '/api/v0/chat/completions';
			
			const messages = [];
			const systemContext = options.systemContext ?? "Você é ravena, um bot de whatsapp criado por moothz";
			messages.push({ role: 'system', content: systemContext });

			const userMessage = { role: 'user' };

			if (options.image) {
				userMessage.content = [{ type: 'text', text: options.prompt }];
				let image_url;

				if (options.image.startsWith('data:image')) {
					image_url = options.image;
				} else if (fs.existsSync(options.image)) {
					const fileContent = fs.readFileSync(options.image, 'base64');
					const mimeType = path.extname(options.image).replace('.', '') || 'jpeg';
					image_url = `data:image/${mimeType};base64,${fileContent}`;
				} else {
					image_url = `data:image/jpeg;base64,${options.image}`;
				}
				
				userMessage.content.push({
					type: 'image_url',
					image_url: { url: image_url }
				});
			} else {
				userMessage.content = options.prompt;
			}

			messages.push(userMessage);


			const queryOptions = {
				model: options.model || this.localModel,
				messages: messages,
				max_tokens: options.maxTokens || 8096,
				temperature: options.temperature || 0.7,
				stream: false
			};

			//this.logger.debug('[LLMService][lmstudioCompletion] Enviando solicitação para API LM Studio:', queryOptions);

			if(options.response_format){
				queryOptions.response_format = options.response_format;
			}
			
			const response = await axios.post(
				endpoint,
				queryOptions,
				{
					headers: {
						'Authorization': `Bearer ${this.LMStudioToken}`,
						'Content-Type': 'application/json'
					},
					timeout: options.timeout || this.apiTimeout
				}
			);

			return response.data;
		} catch (error) {
			this.logger.error('[LLMService] Erro ao chamar API LM Studio:', error.message);
			throw error;
		}
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
			
			const endpoint = (options.customEndpoint ?? this.ollamaEndpoint) + '/api/chat';

			const messages = [];
			const systemContext = options.systemContext ?? "Você é ravena, um bot de whatsapp criado por moothz";
			messages.push({ role: 'system', content: systemContext });

			const userMessage = {
				role: 'user',
				content: options.prompt,
			};

			if (options.image) {
				let base64Image;

				if (options.image.startsWith('data:image')) {
					base64Image = options.image.split(',')[1];
				} else if (fs.existsSync(options.image)) {
					base64Image = fs.readFileSync(options.image, 'base64');
				} else {
					base64Image = options.image;
				}

				if (base64Image) {
					userMessage.images = [base64Image];
				}
			}

			messages.push(userMessage);

			let ollamaFormat = null;
			if (options.response_format) {
				if (options.response_format.type === 'json_schema' && options.response_format.json_schema?.schema) {
					ollamaFormat = options.response_format.json_schema.schema;
				} else {
					ollamaFormat = options.response_format;
				}
			}

			const payload = {
				model: options.model || this.ollamaModel,
				messages: messages,
				format: ollamaFormat,
				stream: false,
				options: {
					temperature: options.temperature || 0.7,
					num_predict: options.maxTokens || 8096,
				},
			};

			const toTime = options.timeout || this.apiTimeout || 60000;
			this.logger.debug('[LLMService][ollamaCompletion] Sending request to Ollama API', {
					endpoint: endpoint,
					model: payload.model,
					promptLength: options.prompt.length,
					hasImage: !!options.image,
					hasSchema: !!ollamaFormat, // Log if we are using a schema
					timeout: toTime	  
			});

			const response = await axios.post(endpoint, payload, {
				headers: {
					'Content-Type': 'application/json',
				},
				timeout: toTime,
			});


			return response.data;

		} catch (error) {
			// Enhanced error logging
			this.logger.error('[LLMService] Error calling Ollama API:', error.message);
			if (error.response) {
				//this.logger.error('Ollama API Response Error Data:', error.response.data);
				this.logger.error('[LLMService] Ollama API Response Error:', error.response.status);
			} else if (error.request) {
				this.logger.error('[LLMService] Ollama API No Response Received.');
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
				this.logger.debug('[LLMService] Obtendo completação com opções:', { 
					provider: options.provider,
					promptLength: options.prompt.length,
					temperature: options.temperature || 0.7
				});

				let response = await this.getCompletionFromSpecificProvider(options);
				response = response.replace(/<think>.*?<\/think>/gs, "").trim().replace(/^"|"$/g, ""); // Remove tags de think e frase entre aspas

				return response;
			} 
			// Caso contrário, tente múltiplos provedores em sequência
			else {
				//this.logger.debug('[LLMService] Nenhum provedor específico solicitado, tentando múltiplos provedores em sequência');

				let response =	await this.getCompletionFromProviders(options);
				response = response.replace(/<think>.*?<\/think>/gs, "").trim().replace(/^"|"$/g, ""); // Remove tags de think e frase entre aspas

				return response;
			}
		} catch (error) {
			this.logger.error('Erro ao obter completação:', error.message);
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
			case 'lmstudio':
				response = await this.lmstudioCompletion(options);
				if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
					this.logger.error('Resposta inválida da API LM Studio:', response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;

			case 'ollama':
				response = await this.ollamaCompletion(options);
				if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
					this.logger.error('Resposta inválida da API ollama:', response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;

			case 'gemini':
				response = await this.geminiCompletion(options);
				if (!response || !response.candidates || !response.candidates[0] || 
						!response.candidates[0].content || !response.candidates[0].content.parts || 
						!response.candidates[0].content.parts[0]) {
					this.logger.error('Resposta inválida da API Gemini:', response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.candidates[0].content.parts[0].text;
				
			case 'deepseek-r1':
				response = await this.deepseekCompletion({...options, version: 'v1'});
				if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
					this.logger.error('Resposta inválida da API Deepseek R1:', response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;
				
			case 'deepseek':
				response = await this.deepseekCompletion({...options, version: 'v3'});
				if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
					this.logger.error('Resposta inválida da API Deepseek:', response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;
				
			case 'local':
				response = await this.openAICompletion({ ...options, useLocal: true, model: this.localModel});
				if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
					this.logger.error('Resposta inválida da API Local:', response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;

				
			case 'openrouter':
				response = await this.openRouterCompletion(options);
				if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
					this.logger.error('Resposta inválida da API OpenRouter:', response);
					return "Erro: Não foi possível gerar uma resposta. Por favor, tente novamente mais tarde.";
				}
				return response.choices[0].message.content;
				
			case 'openai':
			default:
				response = await this.openAICompletion(options);
				if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
					this.logger.error('Resposta inválida da API OpenAI:', response);
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
		if (this.lastQueueChangeTimestamp > 0 && (now - this.lastQueueChangeTimestamp > this.resetQueueTimeout)) {
			this.logger.info('[LLMService] Resetando a fila de provedores para a ordem padrão após 30 minutos.');
			this.providerQueue = [...this.providerDefinitions];
			this.lastQueueChangeTimestamp = 0;
		}

		const totalProviders = this.providerQueue.length;
		if (totalProviders === 0) {
			 this.logger.error('Nenhum provedor definido.');
			 return "Erro: Nenhum provedor de IA configurado.";
		}

		for (let i = 0; i < totalProviders; i++) {
			const provider = this.providerQueue[0]; // Sempre tenta o provedor no início da fila
			try {
				this.logger.debug(`[LLMService] Tentando provedor: ${provider.name}`);
				const result = await provider.method(options);

				if (!result || typeof result !== 'string' || result.trim() === '') {
					throw new Error('Resposta vazia ou inválida do provedor');
				}

				this.logger.debug(`[LLMService] Provedor ${provider.name} retornou resposta com sucesso`);

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
		this.logger.error('Todos os provedores falharam');
		return "Erro: Não foi possível gerar uma resposta de nenhum provedor disponível. Por favor, tente novamente mais tarde.";
	}
}

module.exports = LLMService;
