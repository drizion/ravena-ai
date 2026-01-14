const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

/**
 * Script de Migração de Dados da Ravenabot
 *
 * Este script migra dados da estrutura antiga para a nova estrutura:
 * - dados.json -> groups.json
 * - frases-zap.json -> custom-cmd/[groupId].json
 * - roleta.json -> roletarussa.json
 * - lists.json -> lists/[groupId].json
 *
 * Também copia arquivos de mídia para a nova estrutura.
 */

// Configurações
const OLD_BASE_PATHS = [
	"C:\\ravenas\\ravenabot1",
	"C:\\ravenas\\ravenabot2",
	"C:\\ravenas\\ravenabot3",
	"C:\\ravenas\\ravenabot4"
]; // Caminhos base das instalações antigas (ajuste conforme necessário)
const NEW_BASE_PATH = "./data"; // Caminho base da nova instalação

// Mapeia tipos de mídia para pastas
const MEDIA_TYPE_FOLDERS = {
	img: "images",
	gif: "gifs",
	vid: "videos",
	sfx: "audios",
	sticker: "stickers",
	stickerguif: "stickers",
	stickerimag: "stickers"
};

// Mapeamento de tipos de mídia para a nova estrutura
const MEDIA_TYPE_MAP = {
	img: "image",
	gif: "image",
	vid: "video",
	sfx: "audio",
	sticker: "sticker",
	stickerguif: "sticker",
	stickerimag: "sticker"
};

// Mapas para armazenar relações
const groupNameToId = new Map(); // Nome do grupo -> ID do grupo
const processedGroups = new Set(); // Grupos já processados para evitar duplicatas

/**
 * Cria diretórios necessários
 */
async function createDirectories() {
	const dirs = [
		NEW_BASE_PATH,
		path.join(NEW_BASE_PATH, "media"),
		path.join(NEW_BASE_PATH, "custom-cmd"),
		path.join(NEW_BASE_PATH, "lists")
	];

	for (const dir of dirs) {
		await fs
			.mkdir(dir, { recursive: true })
			.catch((err) => console.error(`Erro ao criar diretório ${dir}:`, err));
	}
}

/**
 * Lê um arquivo JSON
 * @param {string} filePath - Caminho do arquivo
 * @returns {Object|null} - Conteúdo do arquivo ou null em caso de erro
 */
async function readJsonFile(filePath) {
	try {
		const data = await fs.readFile(filePath, "utf8");
		return JSON.parse(data);
	} catch (error) {
		console.error(`Erro ao ler arquivo ${filePath}:`, error.message);
		return null;
	}
}

/**
 * Escreve um objeto para um arquivo JSON
 * @param {string} filePath - Caminho do arquivo
 * @param {Object} data - Dados a serem salvos
 */
async function writeJsonFile(filePath, data) {
	try {
		await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
		console.log(`Arquivo salvo: ${filePath}`);
	} catch (error) {
		console.error(`Erro ao escrever arquivo ${filePath}:`, error.message);
	}
}

/**
 * Copia um arquivo de mídia
 * @param {string} sourcePath - Caminho do arquivo de origem
 * @param {string} destPath - Caminho do arquivo de destino
 * @returns {boolean} - Sucesso da operação
 */
async function copyMediaFile(sourcePath, destPath) {
	try {
		await fs.copyFile(sourcePath, destPath);
		console.log(`Arquivo copiado: ${destPath}`);
		return true;
	} catch (error) {
		console.error(`Erro ao copiar arquivo ${sourcePath} para ${destPath}:`, error.message);
		return false;
	}
}

/**
 * Processa os arquivos dados.json para criar o novo groups.json
 */
async function processGroupsData() {
	const allGroups = [];

	for (const oldBasePath of OLD_BASE_PATHS) {
		const oldDataPath = path.join(oldBasePath, "db", "dados.json");
		const oldData = await readJsonFile(oldDataPath);

		if (!oldData || !oldData.grupos) {
			console.log(`Arquivo dados.json não encontrado ou inválido em ${oldBasePath}`);
			continue;
		}

		console.log(`Processando ${oldData.grupos.length} grupos de ${oldBasePath}`);

		for (const oldGroup of oldData.grupos) {
			const groupId = oldGroup.numeroGrupo;

			// Pula grupos já processados
			if (processedGroups.has(groupId)) {
				console.log(`Grupo ${groupId} já processado, pulando`);
				continue;
			}

			processedGroups.add(groupId);

			// Associa nome ao ID do grupo (para uso posterior)
			groupNameToId.set(oldGroup.nome.toLowerCase(), groupId);

			// Cria objeto do grupo no novo formato
			const newGroup = {
				id: groupId,
				addedBy: "migrado@c.us",
				removedBy: false,
				name: oldGroup.nome.toLowerCase(),
				prefix: "!",
				inviteCode: oldGroup.inviteCode || null,
				paused: oldGroup.pausado || false,
				filters: {
					nsfw: oldGroup.filtros?.nsfw || false,
					links: oldGroup.filtros?.links || false,
					words: oldGroup.filtros?.palavras || [],
					people: []
				},
				additionalAdmins: [],
				twitch: [],
				kick: [],
				youtube: [],
				greetings: {},
				farewells: {},
				createdAt: Date.parse(oldGroup.dataCriacao) || Date.now(),
				updatedAt: Date.now()
			};

			// Configurações de mensagens
			if (oldGroup.opts?.msgBoasVindas) {
				newGroup.greetings.text = oldGroup.opts.msgBoasVindas;
			}

			// Migra configurações do Twitch
			if (oldGroup.twitch && oldGroup.twitch.canal) {
				// Processa configurações de Twitch
				const mediaFiles = [];

				// Configurações de mídia online
				const onConfig = {
					media: []
				};

				// Verifica e processa arquivos de mídia online
				if (oldGroup.twitch.imgOn) {
					const fileName = path.basename(oldGroup.twitch.imgOn);
					mediaFiles.push({
						oldPath: oldGroup.twitch.imgOn,
						newFileName: `${Date.now()}-${Math.floor(Math.random() * 1000)}${path.extname(fileName)}`
					});

					onConfig.media.push({
						type: "image",
						content: mediaFiles[mediaFiles.length - 1].newFileName,
						caption: ""
					});
				} else if (oldGroup.twitch.msgOn) {
					onConfig.media.push({
						type: "text",
						content: `⚠️ ATENÇÃO!⚠️\n\n🌟 *${oldGroup.twitch.canal}* ✨ está *online* streamando *{jogo}*!\n_{titulo}_\n\nhttps://twitch.tv/${oldGroup.twitch.canal}`
					});
				}

				// Configurações de mídia offline
				const offConfig = {
					media: []
				};

				// Verifica e processa arquivos de mídia offline
				if (oldGroup.twitch.imgOff) {
					const fileName = path.basename(oldGroup.twitch.imgOff);
					mediaFiles.push({
						oldPath: oldGroup.twitch.imgOff,
						newFileName: `${Date.now() + 1}-${Math.floor(Math.random() * 1000)}${path.extname(fileName)}`
					});

					offConfig.media.push({
						type: "image",
						content: mediaFiles[mediaFiles.length - 1].newFileName,
						caption: ""
					});
				}

				// Adiciona canal Twitch ao novo grupo
				newGroup.twitch.push({
					channel: oldGroup.twitch.canal,
					onConfig,
					offConfig,
					changeTitleOnEvent: oldGroup.twitch.mudarTituloGrupoByTwitch || false,
					onlineTitle: oldGroup.twitch.tituloLiveOn || null,
					offlineTitle: oldGroup.twitch.tituloLiveOff || null,
					useAI: false
				});

				// Copia arquivos de mídia
				for (const mediaFile of mediaFiles) {
					try {
						const destPath = path.join(NEW_BASE_PATH, "media", mediaFile.newFileName);
						await copyMediaFile(mediaFile.oldPath, destPath);
					} catch (error) {
						console.error(`Erro ao copiar arquivo de mídia ${mediaFile.oldPath}:`, error);
					}
				}
			}

			// Adiciona o grupo à lista
			allGroups.push(newGroup);
		}
	}

	// Salva o arquivo groups.json
	await writeJsonFile(path.join(NEW_BASE_PATH, "groups.json"), allGroups);
	console.log(`Total de ${allGroups.length} grupos processados e salvos em groups.json`);
}
/**
 * Converte um comando antigo para o novo formato
 * @param {Object} oldCommand - Comando antigo
 * @returns {Object} - Comando no novo formato
 */
function convertCommand(oldCommand) {
	const newCommand = {
		startsWith: oldCommand.msgInicio,
		responses: oldCommand.respostas.map((response) => {
			// Verifica se é uma resposta de mídia
			// Formato antigo: "legenda img-nomeArquivo.jpg"
			const mediaMatch = response.match(
				/(.*?)\s+(img|gif|vid|sfx|sticker|stickerguif|stickerimag)-([^\\/:*?"<>|\r\n]+)$/
			);

			if (mediaMatch) {
				const caption = mediaMatch[1].trim();
				const mediaType = mediaMatch[2];
				const mediaFileName = mediaMatch[3];
				const newMediaType = MEDIA_TYPE_MAP[mediaType] || "image";

				return `{${newMediaType}-${mediaFileName}}${caption ? " " + caption : ""}`;
			}

			// Tenta o outro formato também: "img-nomeArquivo.jpg legenda"
			const alternativeMatch = response.match(
				/^(img|gif|vid|sfx|sticker|stickerguif|stickerimag)-([^\\/:*?"<>|\r\n]+)\s+(.*?)$/
			);

			if (alternativeMatch) {
				const mediaType = alternativeMatch[1];
				const mediaFileName = alternativeMatch[2];
				const caption = alternativeMatch[3].trim();
				const newMediaType = MEDIA_TYPE_MAP[mediaType] || "image";

				return `{${newMediaType}-${mediaFileName}}${caption ? " " + caption : ""}`;
			}

			// Retorna resposta texto sem alterações
			return response;
		}),
		sendAllResponses: oldCommand.precisaTodas || false,
		mentions: oldCommand.mentions || [],
		cooldown: oldCommand.cooldown || 0,
		react: oldCommand.react || null,
		reply: oldCommand.reply !== undefined ? oldCommand.reply : true,
		count: oldCommand.contador || 0,
		metadata: {
			createdBy:
				oldCommand.autores && oldCommand.autores.length > 0
					? oldCommand.autores[0]
					: "migrado@c.us",
			createdAt: Date.now()
		},
		active: !oldCommand.oculto,
		deleted: false
	};

	return newCommand;
}

/**
 * Processa o arquivo frases-zap.json para criar os arquivos custom-cmd
 */
async function processCustomCommands() {
	const commandsByGroup = new Map(); // Mapa de ID do grupo -> comandos

	for (const oldBasePath of OLD_BASE_PATHS) {
		const oldCommandsPath = path.join(oldBasePath, "db", "frases-zap.json");
		const oldCommandsData = await readJsonFile(oldCommandsPath);

		if (!oldCommandsData || !oldCommandsData.frases) {
			console.log(`Arquivo frases-zap.json não encontrado ou inválido em ${oldBasePath}`);
			continue;
		}

		console.log(`Processando ${oldCommandsData.frases.length} comandos de ${oldBasePath}`);

		// Agrupa comandos por canais (grupos)
		for (const oldCommand of oldCommandsData.frases) {
			if (!oldCommand.canais || oldCommand.canais.length === 0) {
				continue; // Pula comandos sem canais associados
			}

			// Converte o comando para o novo formato
			const newCommand = convertCommand(oldCommand);

			// Adiciona o comando a cada grupo associado
			for (const channel of oldCommand.canais) {
				// Tenta obter o ID do grupo pelo nome do canal
				const channelName = channel.toLowerCase();
				const groupId = groupNameToId.get(channelName);

				if (!groupId) {
					console.log(
						`Canal "${channel}" não encontrado nos grupos processados, pulando comando ${oldCommand.msgInicio}`
					);
					continue;
				}

				// Inicializa array de comandos para o grupo se necessário
				if (!commandsByGroup.has(groupId)) {
					commandsByGroup.set(groupId, []);
				}

				// Adiciona o comando ao grupo
				commandsByGroup.get(groupId).push(newCommand);

				// Verifica e processa arquivos de mídia
				for (const response of oldCommand.respostas) {
					const mediaMatch = response.match(
						/^(img|gif|vid|sfx|sticker|stickerguif|stickerimag)-([^\\/:*?"<>|\r\n]+)/
					);

					if (mediaMatch) {
						const mediaType = mediaMatch[1];
						const mediaFileName = mediaMatch[2];
						const mediaFolder = MEDIA_TYPE_FOLDERS[mediaType];

						if (!mediaFolder) {
							console.log(`Tipo de mídia desconhecido: ${mediaType}`);
							continue;
						}

						// Copia o arquivo de mídia
						try {
							const sourcePath = path.join(oldBasePath, "media", mediaFolder, mediaFileName);
							const destPath = path.join(NEW_BASE_PATH, "media", mediaFileName);

							await copyMediaFile(sourcePath, destPath);
						} catch (error) {
							console.error(`Erro ao copiar arquivo de mídia ${mediaFileName}:`, error);
						}
					}
				}
			}
		}
	}

	// Salva os arquivos de comandos personalizados para cada grupo
	for (const [groupId, commands] of commandsByGroup.entries()) {
		const customCmdPath = path.join(NEW_BASE_PATH, "custom-cmd", `${groupId}.json`);
		await writeJsonFile(customCmdPath, commands);
		console.log(`Salvos ${commands.length} comandos para o grupo ${groupId}`);
	}
}

/**
 * Processa o arquivo roleta.json para criar o novo roletarussa.json
 */
async function processRussianRoulette() {
	const newRoulette = {
		grupos: {},
		configuracoes: {
			tempoDefault: 300
		}
	};

	for (const oldBasePath of OLD_BASE_PATHS) {
		const oldRoulettePath = path.join(oldBasePath, "db", "roleta.json");
		const oldRouletteData = await readJsonFile(oldRoulettePath);

		if (!oldRouletteData) {
			console.log(`Arquivo roleta.json não encontrado ou inválido em ${oldBasePath}`);
			continue;
		}

		console.log(`Processando dados de roleta russa de ${oldBasePath}`);

		// Processa cada grupo na roleta
		for (const [groupId, groupData] of Object.entries(oldRouletteData)) {
			// Pula grupos já processados
			if (newRoulette.grupos[groupId]) {
				continue;
			}

			// Inicializa dados do grupo
			newRoulette.grupos[groupId] = {
				tempoTimeout: 300, // 5 minutos em segundos
				jogadores: {},
				ultimoJogador: null
			};

			// Processa jogadores
			for (const [userId, userData] of Object.entries(groupData)) {
				newRoulette.grupos[groupId].jogadores[userId] = {
					tentativasAtuais: userData.qtdTentativasAtual || 0,
					tentativasMaximo: userData.qtdMaximaTentativas || 0,
					mortes: userData.qtdMortes || 0,
					timeoutAte: 0 // Sem timeout inicialmente
				};
			}
		}
	}

	// Salva o arquivo roletarussa.json
	await writeJsonFile(path.join(NEW_BASE_PATH, "roletarussa.json"), newRoulette);
	console.log(`Dados de roleta russa processados e salvos`);
}

/**
 * Processa o arquivo lists.json para criar os arquivos de listas
 */
async function processLists() {
	for (const oldBasePath of OLD_BASE_PATHS) {
		// Verifica se o arquivo lists.json existe
		const oldListsPath = path.join(oldBasePath, "db", "lists.json");
		try {
			await fs.access(oldListsPath);
		} catch (error) {
			console.log(`Arquivo lists.json não encontrado em ${oldBasePath}`);
			continue;
		}

		const oldListsData = await readJsonFile(oldListsPath);
		if (!oldListsData) {
			continue;
		}

		console.log(`Processando listas de ${oldBasePath}`);

		// Processa cada grupo com listas
		for (const [channelName, listsData] of Object.entries(oldListsData)) {
			const groupId = groupNameToId.get(channelName.toLowerCase());

			if (!groupId) {
				console.log(`Canal "${channelName}" não encontrado nos grupos processados, pulando listas`);
				continue;
			}

			// Converte listas para o novo formato
			const newLists = Array.isArray(listsData)
				? listsData.map((list) => ({
						name: list.name,
						title: list.title || null,
						createdAt: list.createdAt || Date.now(),
						createdBy: list.createdBy || "migrado@c.us",
						members: Array.isArray(list.members) ? list.members : []
					}))
				: [];

			// Salva o arquivo de listas para o grupo
			const newListsPath = path.join(NEW_BASE_PATH, "lists", `${groupId}.json`);
			await writeJsonFile(newListsPath, newLists);
			console.log(`Salvas ${newLists.length} listas para o grupo ${groupId}`);
		}
	}
}

/**
 * Função principal de migração
 */
async function migrateData() {
	console.log("Iniciando migração de dados");

	// Cria diretórios necessários
	await createDirectories();

	// Processa grupos
	await processGroupsData();

	// Processa comandos personalizados
	await processCustomCommands();

	// Processa roleta russa
	await processRussianRoulette();

	// Processa listas
	await processLists();

	console.log("Migração concluída");
}

// Executa a migração
migrateData().catch((err) => {
	console.error("Erro na migração:", err);
});
