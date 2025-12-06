const { Contact, LocalAuth, MessageMedia, Location, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrimg = require('qr-image');
const { randomBytes } = require('crypto');
const imagemagick = require('imagemagick');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');
const express = require('express');
const mime = require('mime-types');
const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');

const EvolutionGoClient = require('./services/EvolutionGoClient');
const CacheManager = require('./services/CacheManager');
const ReturnMessage = require('./models/ReturnMessage');
const ReactionsHandler = require('./ReactionsHandler');
const LLMService = require('./services/LLMService');
const MentionHandler = require('./MentionHandler');
const AdminUtils = require('./utils/AdminUtils');
const InviteSystem = require('./InviteSystem');
const StreamSystem = require('./StreamSystem');
const Database = require('./utils/Database');
const LoadReport = require('./LoadReport');
const Logger = require('./utils/Logger');
const { toOpus, toMp3 } = require('./utils/Conversions');

// Utils
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);
const convertAsync = promisify(imagemagick.convert);

class WhatsAppBotEvoGo {
  constructor(options) {
    this.id = options.id;
    this.vip = options.vip;
    this.comunitario = options.comunitario;
    this.numeroResponsavel = options.numeroResponsavel;
    this.supportMsg = options.supportMsg;
    this.phoneNumber = options.phoneNumber;
    this.eventHandler = options.eventHandler;
    this.prefix = options.prefix || process.env.DEFAULT_PREFIX || '!';
    this.logger = new Logger(`bot-evo-go-${this.id}`);
    this.websocket = options.useWebsocket ?? false;
    this.evolutionWS = options.evolutionWS;
    this.evolutionApiUrl = options.evolutionApiUrl;
    this.evolutionApiKey = options.evolutionApiKey; // Global Key
    this.evolutionInstanceApiKey = options.evolutionInstanceApiKey; // Instance Token
    this.instanceName = options.evoInstanceName ?? options.id;
    this.webhookHost = options.webhookHost;
    this.webhookPort = options.webhookPort || process.env.WEBHOOK_PORT_EVO || 3000;
    this.notificarDonate = options.notificarDonate;
    this.pvAI = options.pvAI;
    this.version = "EvolutionGO";
    this.wwebversion = "0";
    this.banido = options.banido;

    // Acesso pelo painel por terceiros
    this.privado = options.privado ?? false;
    this.managementUser = options.managementUser ?? process.env.BOTAPI_USER ?? "admin";
    this.managementPW = options.managementPW ?? process.env.BOTAPI_PASSWORD ?? "batata123";

    this.redisURL = options.redisURL;
    this.redisDB = options.redisDB || 0;
    this.redisTTL = options.redisTTL || 604800;
    this.maxCacheSize = 3000;

    this.skipGroupsPath = path.join(__dirname, '..', 'data', `skip-groups-${this.id}.json`);

    this.streamIgnoreGroups = [];
    this.skipGroupInfo = [];
    this.messageCache = [];
    this.contactCache = [];
    this.sentMessagesCache = [];
    this.cacheManager = new CacheManager(
      this.redisURL,
      this.redisDB,
      this.redisTTL,
      this.maxCacheSize
    );

    if (!this.evolutionApiUrl || !this.evolutionApiKey || !this.evolutionInstanceApiKey || !this.instanceName || !this.webhookHost) {
      const errMsg = 'WhatsAppBotEvoGo: evolutionApiUrl, evolutionApiKey, evolutionInstanceApiKey, instanceName, and webhookHost are required!';
      this.logger.error(errMsg, {
        evolutionApiUrl: !!this.evolutionApiUrl,
        evolutionApiKey: !!this.evolutionApiKey,
        evolutionInstanceApiKey: !!this.evolutionInstanceApiKey,
        instanceName: !!this.instanceName,
        webhookHost: !!this.webhookHost
      });
      throw new Error(errMsg);
    }

    this.apiClient = new EvolutionGoClient(
      this.evolutionApiUrl,
      this.evolutionApiKey,
      this.evolutionInstanceApiKey,
      this.logger
    );

    this.database = Database.getInstance();
    this.isConnected = false;
    this.safeMode = options.safeMode !== undefined ? options.safeMode : (process.env.SAFE_MODE === 'true');
    this.otherBots = options.otherBots || [];

    this.ignorePV = options.ignorePV || false;
    this.whitelist = options.whitelistPV || [];
    this.ignoreInvites = options.ignoreInvites || false;
    this.grupoLogs = options.grupoLogs || process.env.GRUPO_LOGS;
    this.grupoInvites = options.grupoInvites || process.env.GRUPO_INVITES;
    this.grupoAvisos = options.grupoAvisos || process.env.GRUPO_AVISOS;

    this.userAgent = options.userAgent || process.env.USER_AGENT;

    this.mentionHandler = new MentionHandler();

    this.lastMessageReceived = 0;
    this.startupTime = 0;

    this.loadReport = new LoadReport(this);
    this.inviteSystem = new InviteSystem(this);
    this.reactionHandler = new ReactionsHandler();

    this.streamSystem = null;
    this.streamMonitor = null;
    this.stabilityMonitor = options.stabilityMonitor ?? false;

    this.llmService = new LLMService({});
    this.adminUtils = AdminUtils.getInstance();

    this.webhookApp = null;
    this.webhookServer = null;

    this.blockedContacts = [];

    if (!this.streamSystem) {
      this.streamSystem = new StreamSystem(this);
      this.streamMonitor = this.streamSystem.streamMonitor;
    }

    // Client Fake
    this.client = {
      getChatById: (arg) => {
        return this.getChatDetails(arg);
      },
      getContactById: (arg) => {
        return this.getContactDetails(arg);
      },
      getInviteInfo: (arg) => {
        return this.inviteInfo(arg);
      },
      getMessageById: async (messageId) => {
        return await this.recoverMsgFromCache(messageId);
      },
      setStatus: (arg) => {
        this.updateProfileStatus(arg);
      },
      leaveGroup: (arg) => {
        this.leaveGroup(arg);
      },
      setProfilePicture: (arg) => {
        this.updateProfilePicture(arg);
      },
      setPrivacySettings: (arg) => {
        this.updatePrivacySettings(arg);
      },
      acceptInvite: (arg) => {
        return this.acceptInviteCode(arg);
      },
      sendPresenceUpdate: async (xxx) => {
        return true;
      },
      info: {
        wid: {
          _serialized: `${options.phoneNumber}`
        }
      }
    }

    this.updateVersions();
    setInterval(this.updateVersions, 3600000);
  }

  async getEvoGoInstance(token, name) {
    const allInstances = await this.apiClient.get(`/instance/all`, {}, true);
    return allInstances.data?.find(aI => aI.token === token && aI.name === name);
  }

  async logout() {
    this.logger.info(`[logout] Logging out instance ${this.instanceName}`);
    return await this.apiClient.delete('/instance/logout', {}, false);
  }

  async deleteInstance() {
    // Precisa pegar O ID da instancia, que só vem no /all
    const instanceToDelete = await this.getEvoGoInstance(this.evolutionInstanceApiKey, this.instanceName)
    this.logger.info(`[deleteInstance] Deleting instance ${this.instanceName}`, { instanceToDelete });

    if (instanceToDelete) {
      return await this.apiClient.delete(`/instance/delete/${instanceToDelete.id}`, {}, true);
    } else {
      return { "erro": "não encontrei a instancia", name: this.instanceName, token: this.evolutionInstanceApiKey };
    }
  }

  async createInstance() {
    this.logger.info(`[createInstance] Creating instance ${this.instanceName}`);
    const payload = {
      "name": this.instanceName,
      "token": this.evolutionInstanceApiKey,
      "webhookUrl": `${process.env.EVOGO_WEBHOOK_HOST}:${this.webhookPort}/webhook/evogo/${this.instanceName}`,
      "webhookEvents": ["MESSAGE", "PRESENCE", "CALL", "CONNECTION", "QRCODE", "CONNECTION", "CONTACT", "GROUP", "NEWSLETTER"] // Ajustar conforme necessidade da V3
    };

    this.logger.info(`[createInstance] Creating instance ${this.instanceName}`, payload);
    return await this.apiClient.post('/instance/create', payload, true);
  }

  _normalizeId(id, logger) {
    if (typeof id !== 'string' || !id) {
      return '';
    }
    const cleanId = id.split('@')[0].split(':')[0];
    if (cleanId && !/^\d+$/.test(cleanId)) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`[isAdmin] ID inválido detectado: "${id}" resultou em "${cleanId}", que contém caracteres não numéricos.`);
      }
    }
    return cleanId;
  }

  async isUserAdminInGroup(userId, groupId) {
    return this.adminUtils.isAdmin(userId, { id: groupId }, null, this.client);
  }

  async recreateInstance() {
    const results = [];
    this.logger.info(`[recreateInstance] Starting recreation for ${this.instanceName}`);
    try {
      const deleteResult = await this.deleteInstance();
      results.push({ action: 'delete', status: 'success', result: deleteResult });
      this.logger.info(`[recreateInstance] Instance deleted. Waiting 5 seconds before creation...`);
    } catch (error) {
      this.logger.error(`[recreateInstance] Failed to delete instance:`, error);
      results.push({ action: 'delete', status: 'error', error: error.message });
    }

    await sleep(5000);

    for (let i = 0; i < 3; i++) {
      try {
        this.logger.info(`[recreateInstance] Attempting to create instance (try ${i + 1}/3)...`);
        const createResult = await this.createInstance();
        results.push({ action: 'create', status: 'success', result: createResult });
        this.logger.info(`[recreateInstance] Instance creation successful, defining settings`);

        try {
          const settingsResult = await this.instanceAdvSettings(); // Default ok
          results.push({ action: 'advSettings', status: 'success', result: settingsResult });
          this.logger.info(`[recreateInstance] Instance advanced settings successful.`);
        } catch (error) {
          this.logger.error(`[recreateInstance] Failed to define instance advanced settings:`, error);
          results.push({ action: 'advSettings', status: 'error', attempt: i + 1, error: error.message });
        }

        return results;
      } catch (error) {
        this.logger.error(`[recreateInstance] Attempt ${i + 1} failed:`, error);
        results.push({ action: 'create', status: 'error', attempt: i + 1, error: error.message });
        if (i < 2) {
          this.logger.info(`[recreateInstance] Waiting 5 seconds before retry...`);
          await sleep(5000);
        }
      }
    }

    this.logger.error(`[recreateInstance] Failed to create instance after 3 attempts.`);
    return results;
  }

  async instanceAdvSettings(alwaysOnline = true,rejectCall = true,readMessages = false,ignoreGroups = false,ignoreStatus = true) {
    // Precisa pegar O ID da instancia, que só vem no /all
    const instanceToEdit = await this.getEvoGoInstance(this.evolutionInstanceApiKey, this.instanceName)
    this.logger.info(`[instanceAdvSettings] Instance Settings ${this.instanceName}`, { instanceToEdit, alwaysOnline, rejectCall, readMessages, ignoreGroups, ignoreStatus });

    if (instanceToEdit) {
      return await this.apiClient.put(`/instance/${instanceToEdit.id}/advanced-settings`, { alwaysOnline, rejectCall, readMessages, ignoreGroups, ignoreStatus });
    } else {
      throw new Error(JSON.stringify({ "erro": "não encontrei a instancia", name: this.instanceName, token: this.evolutionInstanceApiKey }));
    }
  }

  async updateVersions() {
    // TODO: Implementar busca de versão na V3 se disponível
    this.version = "EvolutionGO";
  }



  async convertToSquareWebPImage(base64ImageContent) {
    // Copiado do V2
    let inputPath = '';
    let isTempInputFile = false;
    const tempId = randomBytes(16).toString('hex');
    const tempDirectory = os.tmpdir();
    const tempInputPath = path.join(tempDirectory, `${tempId}_input.tmp`);
    const tempOutputPath = path.join(tempDirectory, `${tempId}_output.webp`);

    try {
      if (!base64ImageContent || typeof base64ImageContent !== 'string') {
        throw new Error('Invalid base64ImageContent: Must be a non-empty string.');
      }
      const base64Data = base64ImageContent.includes(',') ? base64ImageContent.split(',')[1] : base64ImageContent;
      if (!base64Data) throw new Error('Invalid base64ImageContent: Empty data after stripping prefix.');

      const buffer = Buffer.from(base64Data, 'base64');
      await writeFileAsync(tempInputPath, buffer);
      inputPath = tempInputPath;
      isTempInputFile = true;

      const targetSize = 512;
      const videoFilter = `scale=${targetSize}:${targetSize}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${targetSize}:${targetSize}:(ow-iw)/2:(oh-ih)/2:color=black@0.0`;

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-vf', videoFilter,
            '-c:v', 'libwebp',
            '-lossless', '0',
            '-q:v', '80',
            '-compression_level', '6',
          ])
          .toFormat('webp')
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(tempOutputPath);
      });

      const webpBuffer = await readFileAsync(tempOutputPath);
      return webpBuffer.toString('base64');

    } catch (error) {
      this.logger.error('[toSquareWebPImage] Error:', error.message);
      throw error;
    } finally {
      if (isTempInputFile && fs.existsSync(tempInputPath)) await unlinkAsync(tempInputPath).catch(() => { });
      if (fs.existsSync(tempOutputPath)) await unlinkAsync(tempOutputPath).catch(() => { });
    }
  }

  async convertToSquarePNGImage(base64ImageContent) {
    const tempId = randomBytes(16).toString('hex');

    try {
      if (!base64ImageContent || typeof base64ImageContent !== 'string') {
        throw new Error('Invalid base64ImageContent: Must be a non-empty string.');
      }

      const base64Data = base64ImageContent.includes(',') ? base64ImageContent.split(',')[1] : base64ImageContent;

      if (!base64Data) {
        throw new Error('Invalid base64ImageContent: Empty data after stripping prefix.');
      }

      const imageBuffer = Buffer.from(base64Data, 'base64');
      const targetSize = 800; // Target dimension for the square output

      const resizedImageBuffer = await sharp(imageBuffer)
        .resize({
          width: targetSize,
          height: targetSize,
          fit: sharp.fit.inside,
          withoutEnlargement: false, // Allow upscaling
          kernel: sharp.kernel.lanczos3,
        })
        .toBuffer(); // Get the resized image as a buffer

      const finalImageBuffer = await sharp({
        create: {
          width: targetSize,
          height: targetSize,
          channels: 4, // 4 channels for RGBA (to support transparency)
          background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
        }
      })
        .composite([{
          input: resizedImageBuffer,    // The buffer of the resized image
          gravity: sharp.gravity.center // Center the image on the new canvas
        }])
        .png({
          // PNG specific options for compression:
          compressionLevel: 6, // zlib compression level (0-9), default is 6. Higher is smaller but slower.
          adaptiveFiltering: true // Use adaptive row filtering for potentially smaller file size.
        })
        .toBuffer();

      const base64Png = finalImageBuffer.toString('base64');

      return base64Png;
    } catch (error) {
      this.logger.error(`[convertToSquarePNGImage] [${tempId}] Error during Sharp processing: ${error.message}`, error.stack);
      throw error;
    }
  }

  async convertAnimatedWebpToGif(base64Webp, keepFile = false) {
    const tempId = randomBytes(8).toString('hex');
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `${tempId}.webp`);
    const outputFileName = `${tempId}.gif`;

    // Output location: public/gifs
    const outputDir = path.join(__dirname, '..', 'public', 'gifs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, outputFileName);

    // Decode and save base64 WebP to temp file
    const buffer = Buffer.from(base64Webp.split(',').pop(), 'base64');
    await writeFileAsync(inputPath, buffer);

    try {
      // imagemagick.convert takes an array of args (like CLI)
      await convertAsync([
        inputPath,
        '-coalesce',
        '-background', 'none',
        '-alpha', 'on',
        '-dispose', 'previous',
        outputPath
      ]);

      // Clean up input
      await unlinkAsync(inputPath).catch(() => { });

      // Return public file URL
      const fileUrl = `${process.env.BOT_DOMAIN_LOCAL ?? process.env.BOT_DOMAIN}/gifs/${outputFileName}`;

      // Optionally delete GIF after 60s
      if (!keepFile) {
        setTimeout(() => {
          fs.unlink(outputPath, () => { });
        }, 60000);
      }

      return fileUrl;
    } catch (err) {
      await unlinkAsync(inputPath).catch(() => { });
      console.error(`[convertAnimatedWebpToGif] ImageMagick error: ${err.message}`);
      throw err;
    }
  }

  async convertToSquareAnimatedGif(inputContent, keepFile = false) {
    this.logger.info("[convertToSquareAnimatedGif] ", inputContent.substring(0, 30));
    let inputPath = inputContent;
    let isTempInputFile = false;
    const tempId = randomBytes(16).toString('hex');

    const tempInputDirectory = os.tmpdir();
    const tempInputPath = path.join(tempInputDirectory, `${tempId}_input.tmp`);

    // Define the output directory and ensure it exists
    const outputDir = path.join(__dirname, '..', 'public', 'gifs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFileName = `${tempId}.gif`;
    const outputPath = path.join(outputDir, outputFileName);

    try {
      if (inputContent && !inputContent.startsWith('http://') && !inputContent.startsWith('https://')) {
        this.logger.info('[toSquareAnimatedGif] Input is base64. Decoding and saving to temporary file...');
        const base64Data = inputContent.includes(',') ? inputContent.split(',')[1] : inputContent;
        const buffer = Buffer.from(base64Data, 'base64');
        await writeFileAsync(tempInputPath, buffer);
        inputPath = tempInputPath;
        isTempInputFile = true;
        this.logger.info('[toSquareAnimatedGif] Base64 input saved to temporary file:', tempInputPath);
      } else if (inputContent && (inputContent.startsWith('http://') || inputContent.startsWith('https://'))) {
        this.logger.info('[toSquareAnimatedGif] Input is a URL:', inputPath);
        // ffmpeg can handle URLs directly
      } else {
        throw new Error('Invalid inputContent provided. Must be a URL or base64 string.');
      }

      this.logger.info('[toSquareAnimatedGif] Starting square animated GIF conversion for:', inputPath);

      const targetSize = 512;
      const fps = 15; // WhatsApp tends to prefer 10-20 FPS for GIFs. 15 is a good compromise.

      const videoFilter =
        `fps=${fps},` +
        `scale=${targetSize}:${targetSize}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${targetSize}:${targetSize}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,` +
        `split[s0][s1];[s0]palettegen=stats_mode=diff:max_colors=250:reserve_transparent=on[p];[s1][p]paletteuse=dither=bayer:alpha_threshold=128`;

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-vf', videoFilter,
            '-loop', '0',
          ])
          .toFormat('gif')
          .on('end', () => {
            this.logger.info('[toSquareAnimatedGif] Square animated GIF conversion finished.');
            resolve();
          })
          .on('error', (err) => {
            let ffmpegCommandDetails = '';
            if (err.ffmpegCommand) {
              ffmpegCommandDetails = `FFmpeg command: ${err.ffmpegCommand}`;
            } else if (err.spawnargs) {
              ffmpegCommandDetails = `FFmpeg arguments: ${err.spawnargs.join(' ')}`;
            }
            this.logger.error(`[toSquareAnimatedGif] Error during GIF conversion: ${err.message}. ${ffmpegCommandDetails}`, err.stack);
            reject(err);
          })
          .save(outputPath); // Save to the new permanent path
      });

      this.logger.info('[toSquareAnimatedGif] Square animated GIF saved to:', outputPath);

      // Schedule file deletion
      if (!keepFile) {
        setTimeout(() => {
          fs.unlink(outputPath, (err) => {
            if (err) {
              this.logger.error(`[toSquareAnimatedGif] Error deleting file ${outputPath}:`, err);
            } else {
              this.logger.info(`[toSquareAnimatedGif] Deleted file: ${outputPath}`);
            }
          });
        }, 60000);
      }

      // Check file size - WhatsApp has limits for GIFs (often around 1MB, but can vary)
      const stats = fs.statSync(outputPath);
      const fileSizeInMB = stats.size / (1024 * 1024);
      this.logger.info(`[toSquareAnimatedGif] Output GIF file size: ${fileSizeInMB.toFixed(2)} MB`);
      if (fileSizeInMB > 1.5) { // Example threshold, adjust as needed
        this.logger.warn(`[toSquareAnimatedGif] WARNING: Output GIF size is ${fileSizeInMB.toFixed(2)} MB, which might be too large for WhatsApp.`);
      }

      const fileUrl = `${process.env.BOT_DOMAIN_LOCAL ?? process.env.BOT_DOMAIN}/gifs/${outputFileName}`;
      this.logger.info('[toSquareAnimatedGif] Returning URL:', fileUrl);
      return fileUrl;

    } catch (error) {
      this.logger.error('[toSquareAnimatedGif] Error in convertToSquareAnimatedGif function:', error.message, error.stack);
      throw error;
    } finally {
      if (isTempInputFile && fs.existsSync(tempInputPath)) {
        try {
          await unlinkAsync(tempInputPath);
          this.logger.info('[toSquareAnimatedGif] Temporary input file deleted:', tempInputPath);
        } catch (e) {
          this.logger.error('[toSquareAnimatedGif] Error deleting temporary input file:', tempInputPath, e.message);
        }
      }
    }
  }

  async convertToAnimatedWebP(inputContent) {
    let inputPath = inputContent;
    let isTempInputFile = false;
    const tempId = randomBytes(16).toString('hex');

    const tempDirectory = os.tmpdir();
    const tempInputPath = path.join(tempDirectory, `${tempId}_input.tmp`);
    const tempOutputPath = path.join(tempDirectory, `${tempId}_output.webp`);

    try {
      if (inputContent && !inputContent.startsWith('http://') && !inputContent.startsWith('https://')) {
        this.logger.info('[toAnimatedWebP] Input is base64. Decoding and saving to temporary file...');
        const base64Data = inputContent.includes(',') ? inputContent.split(',')[1] : inputContent;
        const buffer = Buffer.from(base64Data, 'base64');
        await writeFileAsync(tempInputPath, buffer);
        inputPath = tempInputPath;
        isTempInputFile = true;
        this.logger.info('[toAnimatedWebP] Base64 input saved to temporary file:', tempInputPath);
      } else if (inputContent && (inputContent.startsWith('http://') || inputContent.startsWith('https://'))) {
        this.logger.info('[toAnimatedWebP] Input is a URL:', inputPath);
      } else {
        throw new Error('Invalid inputContent provided. Must be a URL or base64 string.');
      }

      this.logger.info('[toAnimatedWebP] Starting square animated WebP conversion for:', inputPath);

      // Define the target square dimensions
      const targetSize = 512;

      // Construct the complex video filter string
      // 1. Set FPS
      // 2. Scale to fit within targetSize x targetSize, preserving aspect ratio (lanczos for quality)
      // 3. Pad to targetSize x targetSize, center content, fill with transparent background
      // 4. Generate and use a palette for better WebP quality and transparency handling
      const videoFilter = `fps=20,scale=${targetSize}:${targetSize}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${targetSize}:${targetSize}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,split[s0][s1];[s0]palettegen=max_colors=250:reserve_transparent=on[p];[s1][p]paletteuse=dither=bayer:alpha_threshold=128`;

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-vf', videoFilter,
            '-loop', '0',
            '-c:v', 'libwebp',
            '-lossless', '0',
            '-q:v', '75', // Quality for lossy WebP (0-100)
            '-compression_level', '6', // Compression level (0-6)
            '-preset', 'default',
            '-an', // Remove audio
            '-vsync', 'cfr', // Constant frame rate
          ])
          .toFormat('webp')
          .on('end', () => {
            this.logger.info('[toAnimatedWebP] Square animated WebP conversion finished.');
            resolve();
          })
          .on('error', (err) => {
            let ffmpegCommand = '';
            if (err.ffmpegCommand) {
              ffmpegCommand = `FFmpeg command: ${err.ffmpegCommand}`;
            }
            this.logger.error(`[toAnimatedWebP] Error during square WebP conversion: ${err.message}. ${ffmpegCommand}`, err.stack);
            reject(err);
          })
          .save(tempOutputPath);
      });

      this.logger.info('[toAnimatedWebP] Square animated WebP saved to temporary file:', tempOutputPath);

      const webpBuffer = await readFileAsync(tempOutputPath);
      const base64WebP = webpBuffer.toString('base64');
      this.logger.info('[toAnimatedWebP] Square animated WebP converted to base64.');

      return base64WebP;

    } catch (error) {
      this.logger.error('[toAnimatedWebP] Error in convertToAnimatedWebP function:', error.message, error.stack);
      throw error;
    } finally {
      if (isTempInputFile && fs.existsSync(tempInputPath)) {
        try {
          await unlinkAsync(tempInputPath);
          this.logger.info('[toAnimatedWebP] Temporary input file deleted:', tempInputPath);
        } catch (e) {
          this.logger.error('[toAnimatedWebP] Error deleting temporary input file:', tempInputPath, e.message);
        }
      }
      if (fs.existsSync(tempOutputPath)) {
        try {
          await unlinkAsync(tempOutputPath);
          this.logger.info('[toAnimatedWebP] Temporary output file deleted:', tempOutputPath);
        } catch (e) {
          this.logger.error('[toAnimatedWebP] Error deleting temporary output file:', tempOutputPath, e.message);
        }
      }
    }
  }

  async toGif(inputContent) {
    let inputPath = inputContent;
    let isTempFile = false;
    const tempDirectory = os.tmpdir();
    const tempId = randomBytes(16).toString('hex'); // Generate a unique ID for temp files
    const tempInputPath = path.join(tempDirectory, `${tempId}_input.mp4`);
    const tempOutputPath = path.join(tempDirectory, `${tempId}_output.gif`);

    try {
      // Check if inputContent is base64 or URL
      if (!inputContent.startsWith('http://') && !inputContent.startsWith('https://')) {
        // Assume it's base64, decode and write to a temporary file
        const base64Data = inputContent.includes(',') ? inputContent.split(',')[1] : inputContent;
        const buffer = Buffer.from(base64Data, 'base64');
        await writeFileAsync(tempInputPath, buffer);
        inputPath = tempInputPath;
        isTempFile = true;
        this.logger.info('[toGif] Input is base64, saved to temporary file:', tempInputPath);
      } else {
        this.logger.info('[toGif] Input is a URL:', inputPath);
      }

      this.logger.info('[toGif] Starting GIF conversion for:', inputPath);

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-vf', 'fps=20,scale=512:-1:flags=lanczos', // Example: 10 fps, 320px width, maintain aspect ratio
            '-loop', '0' // 0 for infinite loop, -1 for no loop, N for N loops
          ])
          .toFormat('gif')
          .on('end', () => {
            this.logger.info('[toGif] GIF conversion finished.');
            resolve();
          })
          .on('error', (err) => {
            this.logger.error('[toGif] Error during GIF conversion:', err.message);
            reject(err);
          })
          .save(tempOutputPath);
      });

      this.logger.info('[toGif] GIF saved to temporary file:', tempOutputPath);

      // Read the generated GIF and convert to base64
      const gifBuffer = await readFileAsync(tempOutputPath);
      const base64Gif = gifBuffer.toString('base64');
      this.logger.info('[toGif] GIF converted to base64.');

      return base64Gif; // 'data:image/gif;base64,' não inclui

    } catch (error) {
      this.logger.error('[toGif] Error in toGif function:', error);
      throw error; // Re-throw the error to be caught by the caller
    } finally {
      // Clean up temporary files
      if (isTempFile && fs.existsSync(tempInputPath)) {
        try {
          await unlinkAsync(tempInputPath);
          this.logger.info('[toGif] Temporary input file deleted:', tempInputPath);
        } catch (e) {
          this.logger.error('[toGif] Error deleting temporary input file:', tempInputPath, e.message);
        }
      }
      if (fs.existsSync(tempOutputPath)) {
        try {
          await unlinkAsync(tempOutputPath);
          this.logger.info('[toGif] Temporary output file deleted:', tempOutputPath);
        } catch (e) {
          this.logger.error('[toGif] Error deleting temporary output file:', tempOutputPath, e.message);
        }
      }
    }
  }

  async getFileSizeByURL(url) {
    try {
      const headResponse = await axios.head(url);
      const contentLength = headResponse.headers['content-length'];
      return contentLength ? parseInt(contentLength, 10) : 0;
    } catch (error) {
      this.logger.warn(`[getFileSizeByURL] Could not get file size for ${url}: ${error.message}`);
      return 0;
    }
  }



  async _downloadMediaFromEvo(messageContent) {
    try {
      //this.logger.debug(`[_downloadMediaFromEvo] POST /message/downloadmedia`, { message: messageContent });
      const response = await this.apiClient.post('/message/downloadmedia', { message: messageContent });
      if (response?.data?.base64) {
        const base64Data = response.data.base64.replace(/^data:.*?;base64,/, '');

        let mimetype = [
          messageContent,
          messageContent.imageMessage,
          messageContent.videoMessage,
          messageContent.audioMessage,
          messageContent.stickerMessage
        ].find(msg => msg?.mimetype)?.mimetype?.split(";")[0];

        const extension = mime.extension(mimetype) || 'bin';
        const tempId = randomBytes(8).toString('hex');
        const fileName = `${tempId}.${extension}`;
        const outputDir = path.join(__dirname, '..', 'public', 'attachments');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const filePath = path.join(outputDir, fileName);

        if (extension === "bin") {
          this.logger.debug(`[_downloadMediaFromEvo] Arquivo bin? Mimetype ${mimetype}`);
        }
        await writeFileAsync(filePath, base64Data, 'base64');

        const fileUrl = `${process.env.BOT_DOMAIN_LOCAL ?? process.env.BOT_DOMAIN}/attachments/${fileName}`;

        const media = { url: fileUrl, mimetype, filename: fileName, filePath, base64: base64Data };
        //this.logger.debug(`[_downloadMediaFromEvo] Res: ${fileUrl}`, media);
        return media;
      }
    } catch (error) {
      this.logger.error(`[${this.id}] Error downloading media from Evo:`, error);
    }
    return null;
  }

  _storeMediaFile(source, extension) {
    const outputDir = path.join(__dirname, '..', 'public', 'attachments');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const tempId = randomBytes(8).toString('hex');
    const outputFileName = `${tempId}${extension}`;
    const outputFilePath = path.join(outputDir, outputFileName);

    if (Buffer.isBuffer(source)) {
      fs.writeFileSync(outputFilePath, source);
    } else if (typeof source === 'string' && fs.existsSync(source)) {
      fs.copyFileSync(source, outputFilePath);
    } else {
      throw new Error("Invalid source for _storeMediaFile");
    }

    setTimeout((ofp) => {
      if (fs.existsSync(ofp)) fs.unlinkSync(ofp);
    }, 10 * 60 * 1000, outputFilePath);

    return `${process.env.BOT_DOMAIN_LOCAL ?? process.env.BOT_DOMAIN}/attachments/${outputFileName}`;
  }

  async createMediaFromBase64(base64Data, mimetype, filename) {
    try {
      const extension = mime.extension(mimetype) || 'bin';
      const buffer = Buffer.from(base64Data, 'base64');
      const size = buffer.length;
      const url = this._storeMediaFile(buffer, `.${extension}`);

      // Fixes
      if (mimetype === "application/mp4") {
        mimetype = "video/mp4";
      }

      const media = { mimetype, data: base64Data, filename: filename || `file.${extension}`, source: 'base64', url, isMessageMedia: true, size };
      //this.logger.info(`[createMediaFromBase64] `, media );
      return media;
    } catch (error) {
      this.logger.error(`Error in createMediaFromBase64:`, error);
      throw error;
    }
  }

  async createMedia(filePath, customMime = false) {

    try {

      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);

      }

      const stats = fs.statSync(filePath);
      const size = stats.size;
      const extension = path.extname(filePath);
      const fileUrl = this._storeMediaFile(filePath, extension);


      let data = null;
      const sizeLimit = 200 * 1024 * 1024; // 200MB
      if (size < sizeLimit) {
        data = fs.readFileSync(filePath, { encoding: 'base64' });
      } else {
        this.logger.info(`[createMedia] File size (${size} bytes) exceeds limit, not reading to base64.`);
      }

      const filename = path.basename(filePath);
      let mimetype = customMime ? customMime : (mime.lookup(filePath) || 'application/octet-stream');

      // Fixes
      if (mimetype === "application/mp4") {
        mimetype = "video/mp4";
      }

      const media = { mimetype, data, filename, source: 'file', url: fileUrl, isMessageMedia: true, size };
      //this.logger.info(`[createMedia] `, media );
      return media;
    } catch (error) {
      console.error(`Error creating media from ${filePath}:`, error);
      throw error;
    }
  }


  async createMediaFromURL(url, options = { unsafeMime: true, customMime: false }) {
    try {
      const filename = path.basename(new URL(url).pathname) || 'media_from_url';
      let mimetype = mime.lookup(url.split("?")[0]) || (options.unsafeMime ? 'application/octet-stream' : null);
      const size = await this.getFileSizeByURL(url);

      if (!mimetype && options.unsafeMime) {
        try {
          const headResponse = await axios.head(url);
          this.logger.info("mimetype do header? ", headResponse);
          mimetype = options.customMime ? options.customMime : (headResponse.headers['content-type']?.split(';')[0] || 'application/octet-stream');
        } catch (e) { /* ignore */ }
      }

      // Fixes
      if (mimetype === "application/mp4") {
        mimetype = "video/mp4";
      }

      const media = { url, mimetype, filename, source: 'url', url, isMessageMedia: true, size };

      //this.logger.info(`[createMediaFromURL] `, media);
      return media;
    } catch (error) {
      this.logger.error(`[${this.id}] Evo: Error creating media from URL ${url}:`, error);
      throw error;
    }
  }

  async sendReturnMessages(returnMessages) {
    if (!Array.isArray(returnMessages)) {
      returnMessages = [returnMessages];
    }
    const validMessages = returnMessages.filter(msg => msg && msg.isValid && msg.isValid());
    if (validMessages.length === 0) {
      this.logger.warn(`[${this.id}] Sem ReturnMessages válidas pra enviar.`);
      return [];
    }
    const results = [];
    for (const message of validMessages) {
      if (message.delay > 0) {
        await sleep(message.delay);
      }

      let contentToSend = message.content;
      let options = { ...(message.options || {}) }; // Clone options

      try {
        const result = await this.sendMessage(message.chatId, contentToSend, options);
        results.push(result);

        if (message.reaction && result && result.id?._serialized) {
          try {
            await this.sendReaction(message.chatId, result.id._serialized, message.reaction); // Assuming result.id has the ID
          } catch (reactError) {
            this.logger.error(`[${this.id}] Erro enviando reaction "${message.reaction}" pra ${result.id._serialized}:`, reactError);
          }
        }
      } catch (sendError) {
        this.logger.error(`[${this.id}] Falha enviando ReturnMessages pra ${message.chatId}:`, sendError);
        results.push({
          error: sendError,
          messageContent: message.content,
          getInfo: () => { // Usado no StreamSystem pra saber se foi enviada
            return { delivery: [], played: [], read: [] };
          }
        });
      }
    }
    return results;
  }

  recoverMsgFromCache(messageId) {
    return new Promise(async (resolve, reject) => {
      try {
        if (!messageId) {
          resolve(null);
        } else {
          const actualId = this.getActualMsgId(messageId);

          
          const msg = await this.cacheManager.getGoMessageFromCache(actualId);

          //this.logger.debug(`[recoverMsgFromCache] `, { actualId, msg });
          if (!msg || !msg.evoMessageData) {
            resolve(msg || null);
            return;
          }

          const recovered = await this.formatMessageFromEvo(msg.evoMessageData);
          //this.logger.debug(`[recoverMsgFromCache] `, { actualId, recovered });
          if (!recovered) {
            resolve(msg);
          } else {
            resolve(recovered);
          }
        }
      } catch (e) {
        this.logger.error(`[recoverMsgFromCache] Erro recuperando msg '${messageId}'`, e);
        reject(e);
      }
    });
  }

  recoverContactFromCache(number) {
    return new Promise(async (resolve, reject) => {
      try {
        if (!number) {
          resolve(null);
        } else {
          const contact = await this.cacheManager.getContactFromCache(number);
          if (contact) {
            contact.block = async () => await this.setCttBlockStatus(contact.number, "block");
            contact.unblock = async () => await this.setCttBlockStatus(contact.number, "unblock");
            resolve(contact);
          } else {
            resolve(null);
          }
        }
      } catch (e) {
        this.logger.error(`[recoverContactFromCache] Erro recuperando contato '${number}'`, e);
        reject(e);
      }
    });
  }

  startConnectionMonitor() {
    if (!this.websocket) return;

    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
    }

    this.logger.info(`[ConnectionMonitor] Starting monitor...`);

    this.connectionMonitorInterval = setInterval(() => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentTimeInMinutes = hours * 60 + minutes;

      let thresholdMinutes = 5; // Default 07:31 - 23:59

      // 00:00 - 05:00 (5 * 60 = 300)
      if (currentTimeInMinutes >= 0 && currentTimeInMinutes <= 300) {
        thresholdMinutes = 30;
      }
      // 05:01 - 07:30 (7 * 60 + 30 = 450)
      else if (currentTimeInMinutes > 300 && currentTimeInMinutes <= 450) {
        thresholdMinutes = 10;
      }

      const timeSinceLastMessage = Date.now() - this.lastMessageReceived;
      const thresholdMs = thresholdMinutes * 60 * 1000;

      const isDisconnected = !this.isConnected || (this.ws && this.ws.readyState !== WebSocket.OPEN);

      if (isDisconnected) {
        this.logger.warn(`[ConnectionMonitor] WebSocket disconnected. Reconnecting...`);
        this._connectWebSocket();
      } else if (timeSinceLastMessage > thresholdMs) {
        this.logger.warn(`[ConnectionMonitor] No messages received for ${Math.floor(timeSinceLastMessage / 60000)} minutes (Threshold: ${thresholdMinutes}m). Restarting WebSocket...`);
        this._connectWebSocket();
      }

    }, 60000); // Check every minute
  }

  async _connectWebSocket() {
    try {
      const instanceInfo = await this.getEvoGoInstance(this.evolutionInstanceApiKey, this.instanceName);
      if (!instanceInfo) {
        this.logger.error(`[${this.id}] Instance not found for WebSocket connection.`);
        return;
      }
      const wsUrl = `${this.evolutionWS}/ws?token=${this.evolutionApiKey}&instanceId=${instanceInfo?.id}`;

      this.logger.info(`[${this.id}] Connecting to WebSocket: ${wsUrl}`);

      if (this.ws) {
        try {
          this.ws.removeAllListeners();
          this.ws.terminate();
        } catch (e) {
          this.logger.error(`[${this.id}] Error closing existing WebSocket:`, e);
        }
      }

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.logger.info(`[${this.id}] WebSocket connected.`);
        this._onInstanceConnected();
      });

      this.ws.on('message', (rawData) => {
        try {
          const data = JSON.parse(rawData);
          const payload = JSON.parse(data.payload);

          //this.logger.info(`[WebSocket] `, { payload });

          return this._handleWebhook({ websocket: true, body: payload }, { sendStatus: () => 0 }, true);
        } catch (err) {
          this.logger.error(`[${this.id}] Error parsing WebSocket message:`, err);
        }
      });

      this.ws.on('error', (err) => {
        this.logger.error(`[${this.id}] WebSocket error:`, err);
      });

      this.ws.on('close', () => {
        this.logger.warn(`[${this.id}] WebSocket disconnected.`);
        this._onInstanceDisconnected('WEBSOCKET_CLOSE');
      });

    } catch (error) {
      this.logger.error(`[${this.id}] Error in _connectWebSocket:`, error);
    }
  }

  async initialize() {
    await this._loadSkipGroupInfo();
    this.database.registerBotInstance(this);
    this.startupTime = Date.now();
    this.lastMessageReceived = Date.now();

    const instanceDesc = this.websocket ? `Websocket` : `Webhook on ${this.instanceName}:${this.webhookPort}`;
    this.logger.info(`[${this.startupTime}][${this.id}] Initializing EvolutionGO API bot instance ${this.instanceName} (Evo Instance: ${instanceDesc})`); // , { instanceInfo }

    try {
      if (this.websocket) {
          await this._connectWebSocket();
          this.startConnectionMonitor();
      } else {
        // Webhook Setup
        this.webhookApp = express();
        this.webhookApp.use(express.json({ limit: '500mb' }));
        this.webhookApp.use(express.urlencoded({ extended: true, limit: '500mb' }));

        const webhookPath = `/webhook/evogo/${this.instanceName}`;
        this.webhookApp.post(webhookPath, this._handleWebhook.bind(this));
        this.webhookApp.get(webhookPath, this._handleWebhook.bind(this));

        await new Promise((resolve, reject) => {
          this.webhookServer = this.webhookApp.listen(this.webhookPort, () => {
            this.logger.info(`Webhook listener for bot ${this.instanceName} started on ${this.webhookHost}:${this.webhookPort}${webhookPath}`);
            resolve();
          }).on('error', (err) => {
            this.logger.error(`Failed to start webhook listener for bot ${this.instanceName}:`, err);
            reject(err);
          });
        });
      }
    } catch (error) {
      this.logger.error(`Error during webhook setup for instance ${this.instanceName}:`, error);
    }

    this._loadDonationsToWhitelist();
    this._checkInstanceStatusAndConnect();

    return this;
  }

  async _checkInstanceStatusAndConnect(isRetry = false, forceConnect = false) {
    this.logger.info(`Checking instance status for ${this.instanceName}...`);
    try {
      let response;
      try{
        response = await this.apiClient.get(`/instance/status`);
      } catch (e){
        this.logger.error(`[_checkInstanceStatusAndConnect] Erro buscando status de ${this.instanceName}`, e);
        response = {data: {Connected: false, LoggedIn: false}};
      }

      const statusData = response?.data;
      this.isConnected = statusData?.Connected && statusData?.LoggedIn;
      const state = this.isConnected ? 'CONNECTED' : 'DISCONNECTED';
      const extra = {};


      const instanceDetails = {
        version: this.version,
        tipo: "evogo"
      }

      if (this.isConnected) {
        this._onInstanceConnected();
        extra.ok = true;
      } else {
        if (forceConnect) {
          this.logger.info(`Instance ${this.instanceName} is not connected. Attempting to connect...`);

          const connectResponse = await this.apiClient.post(`/instance/connect`, {
            webhookUrl: `${this.webhookHost}:${this.webhookPort}/webhook/evogo/${this.instanceName}`,
            subscribe: ["MESSAGE","SEND_MESSAGE","READ_RECEIPT","PRESENCE","CHAT_PRESENCE","CALL","CONNECTION","LABEL","CONTACT","GROUP","NEWSLETTER","QRCODE"],
            websocketEnable: this.websocket ? "enabled" : ""
          }, false);

          extra.connectData = {};

          if (connectResponse.message === "success") {
            const pairingCodeResponse = await this.apiClient.post(`/instance/pair`, { phone: this.phoneNumber }, false);
            const qrCodeResponse = await this.apiClient.get(`/instance/qr`, {}, false);

            this.logger.debug(`ConnectResponses:`, { phone: this.phoneNumber, pairingCodeResponse, qrCodeResponse });

            extra.connectData.pairingCode = pairingCodeResponse?.data?.PairingCode;
            extra.connectData.qrCode = qrCodeResponse?.data?.Qrcode; // code é base64, qrcode é a string
            extra.connectData.code = qrCodeResponse?.data?.Code; // code é base64, qrcode é a string
          }

          if (extra.connectData.pairingCode) {
            this.logger.info(`[${this.id}] PAIRING CODE: ${extra.connectData.pairingCode}`);
            const pairingCodeLocation = path.join(this.database.databasePath, `pairingcode_${this.id}.txt`);
            fs.writeFileSync(pairingCodeLocation, `[${new Date().toUTCString()}] ${extra.connectData.pairingCode}`);
          } else if (extra.connectData.code || extra.connectData.qrcode) {
            const qrBase64 = extra.connectData.code || extra.connectData.qrcode;
            if (qrBase64) {
              this.logger.info(`[${this.id}] QR Code received.`);
              const qrCodeLocal = path.join(this.database.databasePath, `qrcode_${this.id}.png`);
              const base64Data = qrBase64.replace(/^data:image\/png;base64,/, "");
              fs.writeFileSync(qrCodeLocal, base64Data, 'base64');
            }
          }
        }
      }
      return { instanceDetails, extra };
    } catch (error) {
      this.logger.error(`Error checking/connecting instance ${this.instanceName}:`, error);
      return { instanceDetails: {}, error };
    }
  }

  async _onInstanceConnected() {
    this.streamSystem.initialize();
    this._sendStartupNotifications();
    this.fetchAndPrepareBlockedContacts();

    if (this.isConnected) return;
    this.isConnected = true;
    this.logger.info(`[${this.id}] Successfully connected to WhatsApp via EvolutionGO API.`);
    if (this.eventHandler && typeof this.eventHandler.onConnected === 'function') {
      this.eventHandler.onConnected(this);
    }
  }

  _onInstanceDisconnected(reason = 'Unknown') {
    if (!this.isConnected && reason !== 'INITIALIZING') return;
    this.isConnected = false;
    this.logger.info(`[${this.id}] Disconnected from WhatsApp. Reason: ${reason}`);
    if (this.eventHandler && typeof this.eventHandler.onDisconnected === 'function') {
      this.eventHandler.onDisconnected(this, reason);
    }
    setTimeout(() => this._checkInstanceStatusAndConnect(), 30000);
  }

  async _handleWebhook(req, res) {
    // Evitar um bugzinho
    this.isConnected = true;

    const payload = req.body;
    // V3 Payload structure: { event: "Message", instance: "...", data: { ... } }

    if (!payload?.event) {
      return res.status(200).send(`hello-${this.instanceName}-${this.id}`);
    }

    if (this.shouldDiscardMessage() && payload.event === 'Message') {
      return res.sendStatus(200);
    }

    try {
      switch (payload.event) {
        case 'Connection': // Verificar nome correto do evento na V3
        case 'connection.update': // Compatibilidade?
          // Lógica de conexão
          break;

        case 'Message': // Mensagens e reactions
        case 'SendMessage':
          this.lastMessageReceived = Date.now();
          const msgData = payload.data;

          if (msgData) {
            const info = msgData.Info;
            const msg = msgData.Message;
            const reactionData = msg?.reactionMessage;

            const chatToFilter = info.Chat;
            if (chatToFilter === this.grupoLogs || chatToFilter === this.grupoInvites || chatToFilter === this.grupoEstabilidade) {
              break;
            }

            if(reactionData){
              // ravena só processa se VIER uma reaction (campo 'text')
              if (reactionData.text !== "" && !reactionData.key.fromMe) {

                //this.logger.debug(`[${this.id}] Received reaction:`, { reactionData });
                // reactionData.text -> emoji
                // reactionData.key.participant -> @lid da pessoa que RECEBEU a reaction
                // reactionData.key.remoteJID -> chat que veio a reaction
                this.reactionHandler.processReaction(this, {
                  reaction: reactionData.text,
                  senderId: info.Sender ?? info.SenderAlt,
                  msgId: { _serialized: reactionData.key.ID }
                });
              }
            } else {
              // Se não for reaction, é qualquer outro tipo de mensagem
              // Adicionar campos para formatMessageFromEvo
              const evoMsg = {
                ...msgData,
                event: payload.event
              };

              this.formatMessageFromEvo(evoMsg).then(formattedMessage => {
                if (formattedMessage && this.eventHandler && typeof this.eventHandler.onMessage === 'function') {
                  if (!formattedMessage.fromMe) {
                    this.eventHandler.onMessage(this, formattedMessage);
                  }
                }
              }).catch(e => {
                this.logger.error(`[Message] Erro formatando mensagem`, e);
              });
            }
          }
          break;

        case 'GroupInfo':
          // Payload: { event: "GroupInfo", data: { ... } }
          // data has: JID, Join, Leave, Promote, Demote
          // Aqui vem várias coisas, quando muda titulo, configs, etc.
          const groupInfoData = payload.data;
          if (groupInfoData) {

            // Eventos de mudança de membro
            if (groupInfoData.Join || groupInfoData.Leave || groupInfoData.Promote || groupInfoData.Demote) {
              this._handleGroupParticipantsUpdate(groupInfoData);
            }

            // Se mudou de nome, groupInfoData.Name Name: {Name: 'Novo Titulo',NameSetAt: '2025-11-24T16:57:49-03:00',NameSetBy: '123456@lid',NameSetByPN: '5599123456@s.whatsapp.net'}
          }
          break;

        case 'JoinedGroup':
          // Bot joined a group
          // Payload: { event: "JoinedGroup", data: { JID: "...", Participants: [...] } }
          this.logger.info(`[JoinedGroup] `, { payload });
          const joinedData = payload.data;
          if (joinedData) {
            this._handleGroupParticipantsUpdate({
              JID: joinedData.JID,
              Join: [this.phoneNumber],
              Sender: joinedData.Sender,
              SenderPN: joinedData.SenderPN,
              isBotJoining: true,
              _raw: joinedData
            });
          }
          break;

        case 'PushName':
          const newPushName = payload.data.Message?.NewPushName ?? payload.data?.Message?.PushName;

          if(newPushName && payload.data?.JID){
            this.cacheManager.putPushnameInCache({id: payload.data.JID , pushName: newPushName});
          }
          if(newPushName && payload.data?.JIDAlt){
            this.cacheManager.putPushnameInCache({id: payload.data.JIDAlt , pushName: newPushName});
          }
          break;
        case 'Contact':
          // Não precisa, mas já que veio, vamo aproveitar
          if(payload.data?.JID && payload.data?.Action){
            const nomeCtt = payload.data.Action.fullName ??payload.data.Action.firstName;

            this.cacheManager.putPushnameInCache({id: payload.data.JID , pushName: newPushName});

            if(payload.data.Action.lidJID){
              this.cacheManager.putPushnameInCache({id: payload.data.Action.lidJID , pushName: newPushName});
            }
          }
          break;
        case 'ChatPresence':
          break;
        case 'Receipt':
          break;

        default:
          this.logger.debug(`[_handleWebhook] Unhandled event: '${payload.event}'`, { payload });
          break;
      }
    } catch (error) {
      this.logger.error(`[${this.id}] Error processing webhook for event ${payload.event}:`, {error, payload});
    }
    res.sendStatus(200);
  }

  async fetchAndPrepareBlockedContacts() {
    const blockList = await this.apiClient.get(`/user/blocklist`);
    //blockList: {data: {      DHash: '1761266184514262',JIDs: [...  ]},message: 'success'}

    //this.logger.info(`[${this.id}][fetchAndPrepareBlockedContacts] `, { blockList });
    this.blockedContacts = blockList.data?.JIDs?.map(jid => { 
      return {
        id: { _serialized: jid },
        name: `Blocked_${jid}`
      }
    });

    this.prepareOtherBotsBlockList(); // From original bot
  }

  prepareOtherBotsBlockList() {
    if (!this.otherBots || !this.otherBots.length) return;
    if (!this.blockedContacts || !Array.isArray(this.blockedContacts)) {
      this.blockedContacts = [];
    }
    for (const bot of this.otherBots) { // Assuming otherBots is an array of JID-like strings or bot IDs
      const botId = bot.endsWith("@c.us") || bot.endsWith("@s.whatsapp.net") ? bot : `${bot}@c.us`; // Basic normalization
      if (!this.blockedContacts.some(c => c.id._serialized === botId)) {
        this.blockedContacts.push({
          id: { _serialized: botId },
          name: `Other Bot: ${bot}` // Or some identifier
        });
        //this.logger.info(`[${this.id}] Added other bot '${botId}' to internal ignore list.`);
      }
    }
    this.logger.info(`[${this.id}] Ignored contacts/bots list size: ${this.blockedContacts.length}`);
  }

  async formatMessage(data) { // Fallback
    return data;
  }

  async formatMessageFromEvo(evoMessageData, skipCache = false) {
    return new Promise(async (resolve, reject) => {
      try {
        if (!evoMessageData) {
          resolve(null);
          return;
        }

        //this.logger.debug(`[formatMessageFromEvo] `, {evoMessageData});
        const info = evoMessageData.Info;
        const messageContent = evoMessageData.Message;

        if (!info || !messageContent) {
          resolve(null);
          return;
        }

        const chatId = info.Chat;
        const isGroup = info.IsGroup || chatId.includes("broadcast");
        const fromMe = info.IsFromMe;
        const id = info.ID;
        const timestamp = new Date(info.Timestamp).getTime() / 1000;
        let pushName = info.PushName;
        const sender = info.Sender; // geralmente phoneNumber (JID)
        const senderAlt = info.SenderAlt // geralmente LID

        if(!pushName || pushName?.length < 1){
          pushName = await this.fetchPushNameFromCache(id) ?? "Usuario";
        }

        // Context Info (Reply/Mentions)
        let contextInfo = null;
        if (messageContent.extendedTextMessage) contextInfo = messageContent.extendedTextMessage.contextInfo;
        else if (messageContent.imageMessage) contextInfo = messageContent.imageMessage.contextInfo;
        else if (messageContent.videoMessage) contextInfo = messageContent.videoMessage.contextInfo;
        else if (messageContent.audioMessage) contextInfo = messageContent.audioMessage.contextInfo;
        else if (messageContent.stickerMessage) contextInfo = messageContent.stickerMessage.contextInfo;


        const mentions = contextInfo?.mentionedJID || [];
        const quotedMessageId = contextInfo?.quotedMessage ? contextInfo.stanzaID : null;
        const quotedParticipant = contextInfo?.participant;

        //this.logger.debug(`[formatMessageFromEvo] `, {evoMessageData, contextInfo, quotedMessageId});

        const responseTime = Math.max(0, this.getCurrentTimestamp() - timestamp);

        if (!fromMe) {
          this.loadReport.trackReceivedMessage(isGroup, responseTime, sender);
        }

        let type = 'unknown';
        let content = null;
        let caption = null;
        let mediaInfo = null;

        if (messageContent.conversation) {
          type = 'text';
          content = messageContent.conversation;
        } else if (messageContent.extendedTextMessage) {
          type = 'text';
          content = messageContent.extendedTextMessage.text;
        } else if (messageContent.imageMessage) {
          type = 'image';
          caption = messageContent.imageMessage.caption;
          const downloaded = await this._downloadMediaFromEvo(messageContent);
          mediaInfo = {
            mimetype: messageContent.imageMessage.mimetype,
            url: downloaded?.url || messageContent.imageMessage.url,
            data: downloaded?.base64,
            _evoMediaDetails: messageContent.imageMessage
          };
          content = mediaInfo;
        } else if (messageContent.videoMessage) {
          type = 'video';
          caption = messageContent.videoMessage.caption;
          const downloaded = await this._downloadMediaFromEvo(messageContent);
          mediaInfo = {
            mimetype: messageContent.videoMessage.mimetype,
            url: downloaded?.url || messageContent.videoMessage.url,
            data: downloaded?.base64,
            seconds: messageContent.videoMessage.seconds,
            _evoMediaDetails: messageContent.videoMessage
          };
          content = mediaInfo;
        } else if (messageContent.audioMessage) {
          type = messageContent.audioMessage.ptt ? 'ptt' : 'audio';
          const downloaded = await this._downloadMediaFromEvo(messageContent);
          mediaInfo = {
            mimetype: messageContent.audioMessage.mimetype,
            url: downloaded?.url || messageContent.audioMessage.url,
            data: downloaded?.base64,
            seconds: messageContent.audioMessage.seconds,
            ptt: messageContent.audioMessage.ptt,
            _evoMediaDetails: messageContent.audioMessage
          };
          content = mediaInfo;
        } else if (messageContent.stickerMessage) {
          type = 'sticker';
          const downloaded = await this._downloadMediaFromEvo(messageContent);
          mediaInfo = {
            mimetype: messageContent.stickerMessage.mimetype,
            url: downloaded?.url || messageContent.stickerMessage.url,
            data: downloaded?.base64,
            isAnimated: messageContent.stickerMessage.isAnimated,
            _evoMediaDetails: messageContent.stickerMessage
          };
          content = mediaInfo;
        } else if (messageContent.documentMessage) {
          type = 'document';
          caption = messageContent.documentMessage.caption;
          const downloaded = await this._downloadMediaFromEvo(messageContent);
          mediaInfo = {
            mimetype: messageContent.documentMessage.mimetype,
            url: downloaded?.url || messageContent.documentMessage.url,
            data: downloaded?.base64,
            filename: messageContent.documentMessage.fileName,
            title: messageContent.documentMessage.title,
            _evoMediaDetails: messageContent.documentMessage
          };
          content = mediaInfo;
        } else if (messageContent.locationMessage) {
          type = 'location'; ra
          content = {
            latitude: messageContent.locationMessage.degreesLatitude,
            longitude: messageContent.locationMessage.degreesLongitude,
            name: messageContent.locationMessage.name,
            address: messageContent.locationMessage.address
          };
        } else if (messageContent.contactMessage) {
          type = 'contact';
          content = {
            displayName: messageContent.contactMessage.displayName,
            vcard: messageContent.contactMessage.vcard
          };
        }

        const formattedMessage = {
          evoMessageData: evoMessageData,
          id: id,
          fromMe: fromMe,
          group: isGroup ? chatId : null,
          from: isGroup ? chatId : sender,
          author: this._normalizeId(sender),
          authorAlt: senderAlt,
          name: pushName,
          pushname: pushName,
          authorName: pushName,
          type: type,
          content: content,
          body: content,
          caption: caption,
          timestamp: timestamp,
          responseTime: responseTime,
          hasMedia: !!mediaInfo,
          mentions: mentions,
          isQuoted: evoMessageData.isQuoted,
          isNewsletter: chatId.includes("newsletter"),

          getContact: async () => {
            return await this.getContactDetails(sender, pushName);
          },
          getChat: async () => {
            return await this.getChatDetails(chatId);
          },
          delete: async () => {
            return this.deleteMessageByKey({ remoteJid: chatId, id: id, fromMe: fromMe });
          },
          downloadMedia: async () => {
            if (mediaInfo) {
              try {
                const downloaded = await this._downloadMediaFromEvo(messageContent);
                if (downloaded) {
                  return {
                    mimetype: downloaded.mimetype,
                    url: downloaded.url,
                    data: downloaded.base64,
                    filename: downloaded.filename,
                    isMessageMedia: true
                  };
                }
              } catch (e) {
                this.logger.error(`[downloadMedia] Failed`, e);
              }
            }
            return null;
          }
        };

        formattedMessage.origin = {
          mentionedIds: formattedMessage.mentions,
          id: { _serialized: `${chatId}_${fromMe}_${id}`, fromMe: fromMe, remote: chatId, id: id, _serialized_v3: id },
          key: { remoteJid: chatId, fromMe: fromMe, id: id },
          author: this._normalizeId(formattedMessage.author),
          from: formattedMessage.from,
          react: (emoji) => this.sendReaction(chatId, id, emoji),
          getContact: formattedMessage.getContact,
          getChat: formattedMessage.getChat,
          getQuotedMessage: async () => {
            this.logger.debug(`[getQuotedMessage] ${quotedMessageId}`);
            if (quotedMessageId) {
              return await this.recoverMsgFromCache(quotedMessageId);
            }
            return null;
          },
          delete: async () => {
            return this.deleteMessageByKey({ remoteJid: chatId, id: id, fromMe: fromMe });
          },
          body: content,
          ...evoMessageData
        };

        if (!skipCache) {
          this.cacheManager.putGoMessageInCache(formattedMessage);
        }

        resolve(formattedMessage);

      } catch (error) {
        this.logger.error(`[${this.id}] Error formatting message from EvolutionGO API:`, error);
        resolve(null);
      }
    });
  }

  getActualMsgId(messageId) {
    let actualId = messageId;
    if (typeof messageId === 'string' && (messageId.includes('_true_') || messageId.includes('_false_'))) {
      if (messageId.includes('_true_')) {
        actualId = messageId.split('_true_')[1];
      } else if (messageId.includes('_false_')) {
        actualId = messageId.split('_false_')[1];
      }
    }

    return actualId;
  }

  async sendMessage(chatId, content, options = {}) {
    try {
      if (!this.isConnected) throw new Error('Not connected');
      let isGroup = false;

      const payload = {
        number: chatId,
        delay: options.delay || 0
      };

      if (options.quotedMessageId) {
        const msgIdToQuote = this.getActualMsgId(options.quotedMessageId);

        // V3 quoted structure: { messageId, participant }
        // We need to find the participant if it's a group
        let participant = null;

        if (chatId.includes('@g.us')) {
          isGroup = true;
          // Try to find message in cache to get participant
          const quotedMsg = await this.recoverMsgFromCache(msgIdToQuote);
          if (quotedMsg) participant = quotedMsg.author || quotedMsg.from;
        }

        const target = participant || chatId; // Fallback
        const participantFmt = target.endsWith('@s.whatsapp.net') ? target : `${target}@s.whatsapp.net`;

        payload.quoted = {
          messageId: msgIdToQuote,
          participant: participantFmt
        };
      }

      let endpoint = '';
      if (typeof content === 'MessageMedia' || (typeof content === "object" && content.data && content.mimetype)) content.isMessageMedia = true;

      if (typeof content === 'string') {
        if(this.validURL(content)){
          // Facilidade pra enviar mídia
          endpoint = '/send/media';
          payload.url = content;
          payload.type = content.endsWith(".gif") ? "video" : (mime.lookup(content.split("?")[0]) ?? "document");
        } else {
          endpoint = '/send/text';
          payload.text = content;
        }
      } else if (content.isMessageMedia || options.sendMediaAsSticker) {
        if (options.sendMediaAsSticker) {
          endpoint = '/send/sticker';
          if (!content.url && content.data) {
            const media = await this.createMediaFromBase64(content.data, content.mimetype, content.filename);
            payload.sticker = media.url;
          } else {
            payload.sticker = content.url || content.data;
          }
        } else {
          endpoint = '/send/media';
          payload.url = content.url;
          if (!payload.url && content.data) {
            const media = await this.createMediaFromBase64(content.data, content.mimetype, content.filename);
            payload.url = media.url;
            if (options.sendMediaAsSticker) payload.sticker = media.url;
          }
          
          payload.caption = options.caption;

          let mediaType = content.mimetype ? content.mimetype.split('/')[0] : 'image';
          const cttSize = content.size ?? await this.getFileSizeByURL(content.url) ?? 0;
          const urlPublica = process.env.BOT_DOMAIN_LOCAL ? payload.url.replace(process.env.BOT_DOMAIN_LOCAL,process.env.BOT_DOMAIN) : payload.url;
          if (options.sendMediaAsDocument || (cttSize > 60 * 1024 * 1024)) {
            mediaType = 'document';
            // Se enviar como doc, manda a nossa URL publica junto também
            payload.caption += `\n\n> Link temporário: ${urlPublica}`;
          }

          payload.type = mediaType;
          payload.filename = content.filename;
        }
      } else if (content.isLocation) {
        endpoint = '/send/location';
        payload.latitude = content.latitude;
        payload.longitude = content.longitude;
        payload.name = content.name;
        payload.address = content.address;
      } else if (content.isContact) {
        endpoint = '/send/contact';
        payload.vcard = {
          fullName: content.name,
          phone: content.number
        };
      } else if (content.isPoll) {
        endpoint = '/send/poll';
        payload.question = content.name;
        payload.options = content.pollOptions;
        payload.maxAnswer = content.options.allowMultipleAnswers ? content.pollOptions.length : 1;
      }

      if (options.mentionAll) {
        payload.mentionAll = true;
      }
      else if (options.mentions) {
        payload.mentionedJid = options.mentions.join(",");
      }

      ///this.logger.debug(`[sendMessage] '${endpoint}'`, { contentType: typeof content, content, payload });

      const response = await this.apiClient.post(endpoint, payload);
      this.loadReport.trackSentMessage(isGroup);

      return {
        id: { _serialized: response.data?.Info?.ID || 'unknown' },
        ack: 1,
        timestamp: Math.floor(Date.now() / 1000),
        _data: response,
        getInfo: () => { // Usado no StreamSystem pra saber se foi enviada
          return { delivery: [1], played: [1], read: [1] };
        },
        pin: (tempo) =>{
          this.logger.info(`[${response?.data?.Info?.ID}] message.pin por ${tempo}ms: Não implementado`);
          return true;
        }
      };



    } catch (error) {
      this.logger.error(`[${this.id}] Error sending message:`, error);
      throw error;
      return false;
    }
  }

  async _handleGroupParticipantsUpdate(groupData) {
    // groupData: { JID, Join: [], Leave: [], Promote: [], Demote: [] }
    //this.logger.debug(`[_handleGroupParticipantsUpdate] `, groupData);
    const groupId = groupData.JID;

    // Helper to process actions
    const processAction = async (groupData, participants, action) => {
      if (!participants || !participants.length) return;


      let groupDetails = await this.getChatDetails(groupId);
      let groupName = groupDetails?.name || groupId;

      for (const participant of participants) {
        // participant is JID string
        const contact = await this.getContactDetails(participant);
        const contactResp = await this.getContactDetails(groupData.Sender) ?? await this.getContactDetails(groupData.SenderPN);

        const eventData = {
          group: { id: groupId, name: groupName, notInGroup: groupDetails.notInGroup, isBotJoining: groupData.isBotJoining },
          user: { id: participant, name: contact?.name || participant.split('@')[0] },
          responsavel: { id: groupData.SenderPN, name: contactResp?.name || groupData.SenderPN?.split('@')[0] },
          action: action,
          origin: { getChat: async () => await this.getChatDetails(groupId) }
        };

        if (action === 'add' || action === 'join') {
          if (this.eventHandler?.onGroupJoin) this.eventHandler.onGroupJoin(this, eventData);
        } else if (action === 'remove' || action === 'leave') {
          if (this.eventHandler?.onGroupLeave) this.eventHandler.onGroupLeave(this, eventData);
        } else if (action === 'promote') {
          if (this.eventHandler?.onGroupPromote) this.eventHandler.onGroupPromote(this, eventData);
        } else if (action === 'demote') {
          if (this.eventHandler?.onGroupDemote) this.eventHandler.onGroupDemote(this, eventData);
        }
      }
    };

    await processAction(groupData, groupData.Join, 'add');
    await processAction(groupData, groupData.Leave, 'remove');
    await processAction(groupData, groupData.Promote, 'promote');
    await processAction(groupData, groupData.Demote, 'demote');
  }

  acceptInviteCode(inviteCode) {
    return new Promise(async (resolve, reject) => {
      try {
        this.logger.debug(`[acceptInviteCode][${this.instanceName}] '${inviteCode}'`);
        const resp = await this.apiClient.post(`/group/join`, { code: inviteCode });

        resolve({ accepted: true });
      } catch (e) {
        this.logger.warn(`[acceptInviteCode][${this.instanceName}] Erro aceitando invite para '${inviteCode}'`, { e });
        resolve({ accepted: false, error: e.data?.error ?? "Erro aceitando invite" });
      }

    });
  }

  // NÃO TEM NA EVOGO
  // Fazer?
  inviteInfo(inviteCode) {
    return new Promise(async (resolve, reject) => {
      try {
        this.logger.debug(`[inviteInfo][${this.instanceName}] '${inviteCode}'`);
        //const inviteInfo = await this.apiClient.get(`/group/inviteInfo`, { inviteCode });
        const inviteInfo = { code: inviteCode };
        this.logger.info(`[inviteInfo] '${inviteCode}': ${JSON.stringify(inviteInfo)}`);

        resolve(inviteInfo);
      } catch (e) {
        this.logger.warn(`[inviteInfo] Erro pegando invite info para '${inviteCode}'`);
        reject(e);
      }

    });
  }

  async getChatDetails(chatId) {
    if (!chatId) return null;

    if (this.skipGroupInfo && this.skipGroupInfo.includes(chatId)) {
      this.logger.info(`[getChatDetails] Skipping fetch for ${chatId} as it is in skipGroupInfo list.`);
      return {
        id: { _serialized: chatId },
        name: chatId,
        isGroup: true,
        notInGroup: true,
        participants: []
      };
    }

    try {
      if (chatId.includes('@g.us')) {

        const groupInfoResponse = await this.apiClient.post('/group/info', { groupJid: chatId });
        const groupInfo = groupInfoResponse.data;

        if (groupInfo) {
          // Cache LIDs
          if (groupInfo.Participants) {
            groupInfo.Participants.forEach(p => {
              if (p.LID) this.cacheManager.putContactInCache({ id: { _serialized: p.JID }, lid: p.LID });
              // Check if it's me to store my LID
              if (p.JID.includes(this.phoneNumber)) {
                this.myLid = p.LID;
              }
            });
          }

          return {
            id: { _serialized: groupInfo.JID },
            name: groupInfo.Name || chatId,
            isGroup: true,
            notInGroup: false,
            groupMetadata: { desc: groupInfo.Topic },
            participants: groupInfo.Participants.map(p => ({
              id: { _serialized: p.JID },
              isAdmin: p.IsAdmin,
              isSuperAdmin: p.IsSuperAdmin,
              phoneNumber: p.PhoneNumber,
              lid: p.LID
            })),
            _raw: groupInfo,

            // Métodos do wwebjs
            setSubject: async (title) => {
              return await this.apiClient.post(`/group/name`, { groupJid: chatId, name: title });
            },
            fetchMessages: async (limit = 30) => {
              return false;
            },
            setMessagesAdminsOnly: async (adminOnly) => {
              // TODO evogo
              return false;
            },
            setPicture: async (picture) => {
              this.logger.debug(`[chat] setPicture, não implementado`, { picture });
              return await this.apiClient.post(`/group/photo`, { groupJid: chatId, image: picture.url });
            }
          };
        }
      } else {
        const contact = await this.getContactDetails(chatId);
        return {
          id: { _serialized: chatId },
          name: contact?.name || chatId,
          isGroup: false
        };
      }
    } catch (e) {
      if (e.status === 500 && e.data?.error === 'that group does not exist') {
        this.logger.warn(`[getChatDetails] Group ${chatId} does not exist (status 500). Adding to skip list.`);
        await this.addSkipGroup(chatId);
        return {
          id: { _serialized: chatId },
          name: chatId,
          isGroup: true,
          notInGroup: true,
          participants: []
        };
      } else if (e.data?.error?.includes("not participating")) {
        this.logger.info(`[getChatDetails] Error fetching ${chatId}, bot não está no grupo`);
        return {
          id: { _serialized: chatId },
          name: chatId,
          isGroup: true,
          notInGroup: true,
          participants: []
        };
      } else {
        this.logger.error(`[getChatDetails] Error fetching ${chatId}`, e);
      }
    }
    return { id: { _serialized: chatId }, isGroup: chatId.includes('@g.us') };
  }

  async _loadSkipGroupInfo() {
    try {
        const data = await readFileAsync(this.skipGroupsPath, 'utf8');
        const allSkips = JSON.parse(data);
        this.skipGroupInfo = allSkips[this.id] || [];
        this.logger.info(`[SkipGroups] Loaded ${this.skipGroupInfo.length} skipped groups for bot ${this.id}.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            this.logger.info(`[SkipGroups] ${this.skipGroupsPath} not found. Initializing empty skip list.`);
            this.skipGroupInfo = [];
            await this._saveSkipGroupInfo();
        } else {
            this.logger.error(`[SkipGroups] Error loading skip groups file:`, error);
        }
    }
  }

  async _saveSkipGroupInfo() {
      let allSkips = {};
      try {
          const data = await readFileAsync(this.skipGroupsPath, 'utf8');
          allSkips = JSON.parse(data);
      } catch (error) {
          if (error.code !== 'ENOENT') {
              this.logger.error(`[SkipGroups] Error reading skip groups file before saving:`, error);
              return;
          }
      }
      allSkips[this.id] = this.skipGroupInfo;
      try {
          await writeFileAsync(this.skipGroupsPath, JSON.stringify(allSkips, null, 2));
          this.logger.info(`[SkipGroups] Saved ${this.skipGroupInfo.length} skipped groups for bot ${this.id}.`);
      } catch (error) {
          this.logger.error(`[SkipGroups] Error saving skip groups file:`, error);
      }
  }

  async addSkipGroup(groupId) {
      if (!this.skipGroupInfo.includes(groupId)) {
          this.skipGroupInfo.push(groupId);
          await this._saveSkipGroupInfo();
          this.logger.info(`[SkipGroups] Added ${groupId} to skip list.`);
      }
  }

  async removeSkipGroup(groupId) {
      const initialLength = this.skipGroupInfo.length;
      this.skipGroupInfo = this.skipGroupInfo.filter(id => id !== groupId);
      if (this.skipGroupInfo.length < initialLength) {
          await this._saveSkipGroupInfo();
          this.logger.info(`[SkipGroups] Removed ${groupId} from skip list.`);
      }
  }

  async fetchPushNameFromCache(id){
    return await this.cacheManager.getPushnameFromCache(id);
  }

  async getContactDetails(id, prefetchedName, cacheDurationHours = 12) {
    if (!id) return null;

    if (id === this.phoneNumber) {
      return {
        id: { _serialized: id },
        name: this.instanceName,
        number: this.phoneNumber,
        lid: this.phoneNumber,
        picture: ""
      };
    }

    const now = Date.now();
    const expirationMs = cacheDurationHours * 60 * 60 * 1000;

    let returnData = { id: { _serialized: id }, number: id.split("@")[0], lid: id, name: prefetchedName ?? id.split('@')[0] };

    let cacheName;
    try {
      cacheName = await this.fetchPushNameFromCache(id);
      returnData.name = cacheName ?? returnData.name;
    } catch (e) {
      // Ignore
    }

    try{
      if (!cacheName || ((now - cachedContact._cachedAt) < expirationMs)) {
        // Não tem cache ou expirou
        const infoResponse = await this.apiClient.post('/user/info', { number: [id] });
        const info = infoResponse.data?.Users?.[id];

        if (info) {
          returnData.name = info.VerifiedName ?? returnData.name;
          returnData.lid =  info.LID;
          returnData.picture =  info.PictureID;

          this.cacheManager.putPushnameInCache({id: id , pushName: returnData.name});
        }
      }
    } catch (e) {
      // Ignore
    }


    //this.logger.debug(`[getChatDetails] ${id}, ${prefetchedName}`, { returnData });
    return returnData;
  }

  async sendReaction(chatId, messageId, reaction) {
    try {
      await this.apiClient.post('/message/react', {
        number: chatId,
        reaction: reaction,
        id: messageId,
        fromMe: false // Assuming we are reacting to others
      });
      return true;
    } catch (e) {
      this.logger.error(`[sendReaction] Error`, e);
      return false;
    }
  }

  async deleteMessageByKey(key) {
    this.logger.debug(`[deleteMessageByKey] `, { key });
    return await this.apiClient.post('/message/delete', {
      chat: key.remoteJid,
      messageId: key.id
    });
  }

  getLidFromPn(pn, chat) {
    // A princípio não vem o pn no chat
    //this.logger.debug(`[getLidFromPn] `, {pn, chat});
    return (chat?.participants?.find(p => p.phoneNumber?.startsWith(pn))?.id?._serialized) ?? pn;
  }

  getPnFromLid(lid, chat) {
    //this.logger.debug(`[getPnFromLid] `, {lid, chat});
    return (chat?.participants?.find(p => p.id?._serialized.startsWith(lid))?.phoneNumber) ?? lid;
  }

  notInWhitelist(author) { // author is expected to be a JID string
    const cleanAuthor = author.replace(/\D/g, ''); // Cleans non-digits from JID user part
    return !(this.whitelist.includes(cleanAuthor))
  }

  validURL(str) {
    var pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
      '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name
      '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address
      '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path
      '(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string
      '(\\#[-a-z\\d_]*)?$','i'); // fragment locator
    return !!pattern.test(str);
  }


  _loadDonationsToWhitelist() { }
  _sendStartupNotifications() { }
  shouldDiscardMessage() { return false; }
  getCurrentTimestamp() { return Math.round(Date.now() / 1000); }
  rndString() { return (Math.random() + 1).toString(36).substring(7); }

  async updateProfileStatus(status) {
    try {
      this.logger.debug(`[updateProfileStatus][${this.instanceName}] '${status}'`);
      await this.apiClient.post(`/user/profileStatus`, { status });
    } catch (e) {
      this.logger.warn(`[updateProfileStatus][${this.instanceName}] Erro definindo status '${status}'`, { erro: e, token: this.evolutionInstanceApiKey });
    }
  }

  async getCurrentGroups() {
    return await this.apiClient.get(`/group/myall`);
  }

  async destroy() {
    if (this.webhookServer) this.webhookServer.close();
    if (this.loadReport) this.loadReport.destroy();
  }
}

module.exports = WhatsAppBotEvoGo;
