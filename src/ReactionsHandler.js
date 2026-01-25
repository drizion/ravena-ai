const fs = require("fs").promises;
const path = require("path");
const Logger = require("./utils/Logger");

/**
 * Trata reações a mensagens e executa comandos correspondentes
 */
class ReactionsHandler {
	constructor() {
		this.logger = new Logger("reaction-handler");
		this.reactionCommands = {};
		this.functionsPath = path.join(__dirname, "functions");

		this.loadCommands();
	}

	/**
	 * Carrega todos os comandos que possuem triggers de reação
	 */
	async loadCommands() {
		try {
			// Verifica se o diretório functions existe
			try {
				await fs.access(this.functionsPath);
			} catch (error) {
				this.logger.info("Diretório functions não existe, criando-o");
				await fs.mkdir(this.functionsPath, { recursive: true });
			}

			// Obtém todos os arquivos no diretório functions
			const files = await fs.readdir(this.functionsPath);
			const jsFiles = files.filter((file) => file.endsWith(".js"));

			//this.logger.info(`Encontrados ${jsFiles.length} arquivos de função para verificar reações`);

			const modulosComErro = [];
			// Carrega cada módulo de função
			for (const file of jsFiles) {
				try {
					const commandModule = require(path.join(this.functionsPath, file));

					// Verifica se o módulo exporta comandos
					if (commandModule.commands && Array.isArray(commandModule.commands)) {
						// Processa cada comando para encontrar os que têm triggers de reação
						commandModule.commands.forEach((cmd) => {
							if (cmd.reactions && cmd.reactions.trigger) {
								this.processCommandTriggers(cmd);
							}
						});
					}
				} catch (error) {
					this.logger.error(`Erro ao carregar módulo para reações ${file}:`, error);
					modulosComErro.push(file);
				}
			}

			const numReactionCommands = Object.keys(this.reactionCommands).length;
			//this.logger.info(`Carregados ${numReactionCommands} comandos de reação`);

			if (modulosComErro.length > 0) {
				this.logger.warn(
					`ATENÇÃO: ${modulosComErro.length} módulos com erro:\n ${modulosComErro.join("\n- ")}`
				);
			}
		} catch (error) {
			this.logger.error("Erro ao carregar comandos de reação:", error);
		}
	}

	/**
	 * Processa os triggers de um comando e os adiciona ao mapa de reactionCommands
	 * @param {Command} cmd - O objeto de comando
	 */
	processCommandTriggers(cmd) {
		try {
			const triggers = Array.isArray(cmd.reactions.trigger)
				? cmd.reactions.trigger
				: [cmd.reactions.trigger];

			// Adiciona cada trigger ao mapa
			triggers.forEach((emoji) => {
				if (emoji && typeof emoji === "string") {
					this.reactionCommands[emoji] = cmd.name;
					//this.logger.debug(`Mapeado emoji '${emoji}' para comando ${cmd.name}`);
				}
			});
		} catch (error) {
			this.logger.error(`Erro ao processar triggers do comando ${cmd.name}:`, error);
		}
	}

	/**
	 * Processa uma reação a uma mensagem
	 * @param {WhatsAppBot} bot - A instância do bot
	 * @param {Object} reaction - Os dados da reação
	 * @returns {Promise<boolean>} - Se a reação foi tratada
	 */
	async processReaction(bot, reaction) {
		try {
			//this.logger.info(`Processando reação: ${reaction.reaction} de ${reaction.senderId} na mensagem ${reaction.msgId._serialized}`);

			// Verifica se este emoji mapeia para um comando
			const commandName = this.reactionCommands[reaction.reaction];
			if (!commandName) {
				//this.logger.debug(`Nenhum comando mapeado para o emoji: ${reaction.reaction}`);
				//console.log(this.reactionCommands);
				return false;
			}

			// Obtém a mensagem que recebeu a reação
			const message = await bot.client.getMessageById(reaction.msgId._serialized);
			if (!message) {
				this.logger.warn(
					`Não foi possível encontrar mensagem com ID: ${reaction.msgId._serialized}`
				);
				return false;
			}

			// Cria um objeto de mensagem formatado
			const formattedMessage = await bot.formatMessage(message);
			formattedMessage.originReaction = reaction; // Para comandos com reactions dinâmicas

			// Encontra e executa o comando
			const command = bot.eventHandler.commandHandler.fixedCommands.getCommand(commandName);
			if (command) {
				// Extrai argumentos do conteúdo da mensagem, se disponível
				const msgText =
					formattedMessage.type === "text" ? formattedMessage.content : formattedMessage.caption;
				const args = msgText ? msgText.trim().split(/\s+/) : [];

				// Obtém dados do grupo
				let group = null;
				if (formattedMessage.group) {
					const groupData = await bot.eventHandler.getOrCreateGroup(formattedMessage.group);
					group = groupData.group;

					if (group.mutedStrings && Array.isArray(group.mutedStrings)) {
						//this.logger.debug(`[processReaction] ${reaction.reaction}`, {muted: group.mutedStrings})
						const isIgnored = group.mutedStrings.some((str) => str.includes(reaction.reaction));

						if (isIgnored) {
							this.logger.debug(
								`Ignorando reação do comando '${commandName}' (${reaction.reaction}), mutada no grupo '${group.name}'`
							);
							return false;
						}
					} else if (group.paused) {
						// Se o grupo estiver pausado, ignora a reação
						this.logger.info(`Ignorando reação em grupo pausado: ${formattedMessage.group}`);
						return false;
					}
				}

				this.logger.info(`Executando comando ${commandName} via reação ${reaction.reaction}`);

				// Executa o comando
				await bot.eventHandler.commandHandler.executeFixedCommand(
					bot,
					formattedMessage,
					command,
					args,
					group
				);
				return true;
			} else {
				this.logger.warn(
					`Comando ${commandName} mapeado do emoji ${reaction.reaction} não encontrado`
				);
			}

			return false;
		} catch (error) {
			this.logger.error("Erro ao processar reação:", error);
			return false;
		}
	}
}

module.exports = ReactionsHandler;
