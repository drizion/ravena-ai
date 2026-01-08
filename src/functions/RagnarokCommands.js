const path = require('path');
const Logger = require('../utils/Logger');
const ReturnMessage = require('../models/ReturnMessage');
const Command = require('../models/Command');
const Database = require('../utils/Database');
const fs = require('fs').promises;
const mysql = require('mysql2/promise');
const AdminUtils = require('../utils/AdminUtils');

const logger = new Logger('ragnarok-commands');
const adminUtils = AdminUtils.getInstance();

// Database configuration
const dbConfig = {
  host: process.env.RAGNAROK_HOST,
  user: process.env.RAGNAROK_USER,
  password: process.env.RAGNAROK_PASSWORD,
  database: process.env.RAGNAROK_DATABASE
};

/**
 * Sanitizes strings to alphanumeric only
 */
function sanitize(str) {
  return str ? str.replace(/[^a-zA-Z0-9]/g, '') : '';
}

/**
 * Generates a random password
 */
function generatePassword(length = 8) {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let retVal = "";
  for (let i = 0; i < length; ++i) {
    retVal += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return retVal;
}

async function ragnarokCommand(bot, message, args, group) {
  const chatId = message.author;
  const authorId = message.author ?? message.authorAlt;
  const sanitizedUser = sanitize(authorId.split('@')[0]);
  
  let user, pass;
  let isNew = false;

  // 1. Check Super Admin
  if (false && adminUtils.isSuperAdmin(authorId)) {
    user = "admin";
    pass = "admin";
  } else {
    const connection = await mysql.createConnection(dbConfig);
    try {
      // Check if account exists
      const [rows] = await connection.execute('SELECT account_id, userid, user_pass FROM login WHERE userid = ?', [sanitizedUser]);
      
      if (rows.length > 0) {
        user = rows[0].userid;
        pass = rows[0].user_pass;
      } else {
        // Create new account
        isNew = true;
        user = sanitizedUser;
        pass = generatePassword();
        
        const [result] = await connection.execute(
          'INSERT INTO login (userid, user_pass, sex, email, group_id) VALUES (?, ?, "M", ?, 0)',
          [user, pass, `${user}@ravenabot.com`]
        );
        
        const accountId = result.insertId;

        // Create initial character
        let rawName = message.name ?? message.pushName ?? message.pushname ?? message.authorName;
        let charName = sanitize(rawName);
        
        // Logic: if sanitized name has valid length (< 5 according to your instruction), use it. 
        // Otherwise use Player_username
        if (!charName || charName.length >= 5 || charName.length === 0) {
          charName = sanitize("Player_" + user).substring(0, 23);
        }

        try {
          await connection.execute(
            'INSERT INTO `char` (account_id, name, char_num, class, base_level, job_level, hair, hair_color, last_map, last_x, last_y, save_map, save_x, save_y, max_hp, hp, max_sp, sp) VALUES (?, ?, 0, 0, 1, 1, 1, 1, "ghosthunter", 54, 61, "ghosthunter", 54, 61, 40, 40, 11, 11)',
            [accountId, charName]
          );
        } catch (charErr) {
          logger.error("Failed to create character: " + charErr.message);
          // Character creation might fail if name is taken, we continue anyway as account is created
        }
      }
    } finally {
      await connection.end();
    }
  }

  // 2. Generate Auth Link
  const authPayload = Buffer.from(`${user}:${pass}`).toString('base64');
  const loginLink = `${process.env.RAGNAROK_URL}/?auth=${authPayload}`;

  let responseText = isNew ? "*Sua conta foi criada com sucesso!* ⚔️\n\n" : "*Aqui estão seus dados de acesso:* 🛡️\n\n";
  responseText += `*Usuário:* ${user}\n`;
  responseText += `*Senha:* ${pass}\n\n`;
  responseText += "*Link de Acesso Direto:*\n";
  responseText += `${loginLink}\n\n`;
  responseText += "⚠️ *ATENÇÃO:* Nunca compartilhe este link com ninguém. Ele permite acesso direto à sua conta e personagens.";

  return new ReturnMessage({
    chatId: chatId,
    content: responseText,
    options: {
      quotedMessageId: message.origin.id._serialized,
      evoReply: message.origin
    }
  });
}

async function ragnarokResetCommand(bot, message, args, group) {
  const chatId = message.author;
  const authorId = message.author ?? message.authorAlt;
  const sanitizedUser = sanitize(authorId.split('@')[0]);
  
  if (adminUtils.isSuperAdmin(authorId)) {
      return new ReturnMessage({ chatId, content: "Admins não podem ser resetados via bot." });
  }

  const connection = await mysql.createConnection(dbConfig);
  try {
    if (args[0] === 'full') {
      // Get account ID
      const [rows] = await connection.execute('SELECT account_id FROM login WHERE userid = ?', [sanitizedUser]);
      if (rows.length > 0) {
        const accId = rows[0].account_id;
        await connection.execute('DELETE FROM `char` WHERE account_id = ?', [accId]);
        await connection.execute('DELETE FROM login WHERE account_id = ?', [accId]);
      }
      await connection.end();
      return ragnarokCommand(bot, message, args, group);
    } else {
      const newPass = generatePassword();
      const [result] = await connection.execute('UPDATE login SET user_pass = ? WHERE userid = ?', [newPass, sanitizedUser]);
      
      if (result.affectedRows === 0) {
          await connection.end();
          return new ReturnMessage({ chatId, content: "Conta não encontrada. Use !ragnarok primeiro." });
      }
      
      await connection.end();
      return ragnarokCommand(bot, message, args, group);
    }
  } catch (e) {
    await connection.end();
    logger.error("Reset failed: " + e.message);
    return new ReturnMessage({ chatId, content: "Erro ao processar reset." });
  }
}

const commands = [
  new Command({
    name: 'ragnavena',
    description: 'Ragnarok da ravena, no navegador!',
    category: "jogos",
    reactions: { before: "⚔️", after: "🛡️" },
    method: ragnarokCommand
  }),
  new Command({
    name: 'ragnavena-reset',
    description: 'Reseta sua senha ou conta (use "full" para apagar tudo)',
    category: "jogos",
    hidden: true,
    reactions: { before: "🔄", after: "✅" },
    method: ragnarokResetCommand
  })
];

module.exports = { commands };