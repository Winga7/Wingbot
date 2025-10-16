const Database = require("better-sqlite3");
const path = require("path");

// Créer ou ouvrir la base de données
const db = new Database(path.join(__dirname, "wingbot.db"));

// Activer le mode WAL pour de meilleures performances
db.pragma("journal_mode = WAL");

// Créer les tables si elles n'existent pas
function initDatabase() {
  // Table de configuration des serveurs
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      log_channel_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  ).run();

  // Table des paramètres de logs
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS log_settings (
      guild_id TEXT PRIMARY KEY,
      log_messages INTEGER DEFAULT 0,
      log_members INTEGER DEFAULT 0,
      log_voice INTEGER DEFAULT 0,
      log_roles INTEGER DEFAULT 0,
      log_moderation INTEGER DEFAULT 0,
      log_server INTEGER DEFAULT 0,
      FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
    )
  `
  ).run();

  // Table de cache des messages (pour récupérer les messages supprimés)
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS message_cache (
      message_id TEXT PRIMARY KEY,
      guild_id TEXT,
      channel_id TEXT,
      author_id TEXT,
      author_tag TEXT,
      content TEXT,
      attachments TEXT,
      embeds TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  ).run();

  console.log("✅ Base de données initialisée");
}

// === FONCTIONS DE CONFIGURATION ===

// Définir le salon de logs
function setLogChannel(guildId, channelId) {
  const stmt = db.prepare(`
    INSERT INTO guild_config (guild_id, log_channel_id, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id) DO UPDATE SET 
      log_channel_id = excluded.log_channel_id,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(guildId, channelId);

  // Créer les paramètres de logs si ils n'existent pas
  const stmtSettings = db.prepare(`
    INSERT INTO log_settings (guild_id)
    VALUES (?)
    ON CONFLICT(guild_id) DO NOTHING
  `);
  stmtSettings.run(guildId);
}

// Récupérer le salon de logs
function getLogChannel(guildId) {
  const stmt = db.prepare(
    "SELECT log_channel_id FROM guild_config WHERE guild_id = ?"
  );
  const result = stmt.get(guildId);
  return result?.log_channel_id || null;
}

// Activer/désactiver un type de log
function toggleLog(guildId, logType, enabled) {
  // S'assurer que la config existe
  const stmtConfig = db.prepare(`
    INSERT INTO guild_config (guild_id)
    VALUES (?)
    ON CONFLICT(guild_id) DO NOTHING
  `);
  stmtConfig.run(guildId);

  const stmtSettings = db.prepare(`
    INSERT INTO log_settings (guild_id)
    VALUES (?)
    ON CONFLICT(guild_id) DO NOTHING
  `);
  stmtSettings.run(guildId);

  // Mettre à jour le paramètre
  if (logType === "all") {
    const stmt = db.prepare(`
      UPDATE log_settings 
      SET log_messages = ?, log_members = ?, log_voice = ?, 
          log_roles = ?, log_moderation = ?, log_server = ?
      WHERE guild_id = ?
    `);
    const value = enabled ? 1 : 0;
    stmt.run(value, value, value, value, value, value, guildId);
  } else {
    const columnMap = {
      messages: "log_messages",
      members: "log_members",
      voice: "log_voice",
      roles: "log_roles",
      moderation: "log_moderation",
      server: "log_server",
    };

    const column = columnMap[logType];
    if (!column) return false;

    const stmt = db.prepare(
      `UPDATE log_settings SET ${column} = ? WHERE guild_id = ?`
    );
    stmt.run(enabled ? 1 : 0, guildId);
  }

  return true;
}

// Récupérer la configuration des logs
function getLogSettings(guildId) {
  const stmt = db.prepare("SELECT * FROM log_settings WHERE guild_id = ?");
  const result = stmt.get(guildId);

  if (!result) {
    return {
      log_messages: 0,
      log_members: 0,
      log_voice: 0,
      log_roles: 0,
      log_moderation: 0,
      log_server: 0,
    };
  }

  return result;
}

// === FONCTIONS DE CACHE DES MESSAGES ===

// Ajouter un message au cache
function cacheMessage(message) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO message_cache 
    (message_id, guild_id, channel_id, author_id, author_tag, content, attachments, embeds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const attachments = JSON.stringify(
    message.attachments.map((a) => ({
      name: a.name,
      url: a.url,
      proxyURL: a.proxyURL,
    }))
  );

  const embeds = JSON.stringify(
    message.embeds.map((e) => ({
      title: e.title,
      description: e.description,
      url: e.url,
    }))
  );

  stmt.run(
    message.id,
    message.guild?.id || null,
    message.channel.id,
    message.author.id,
    message.author.tag,
    message.content,
    attachments,
    embeds
  );
}

// Récupérer un message du cache
function getCachedMessage(messageId) {
  const stmt = db.prepare("SELECT * FROM message_cache WHERE message_id = ?");
  return stmt.get(messageId);
}

// Nettoyer les vieux messages du cache (plus de 7 jours)
function cleanOldMessages() {
  const stmt = db.prepare(
    "DELETE FROM message_cache WHERE created_at < datetime('now', '-7 days')"
  );
  const result = stmt.run();
  console.log(`🧹 ${result.changes} anciens messages supprimés du cache`);
}

// Exporter les fonctions
module.exports = {
  db,
  initDatabase,
  setLogChannel,
  getLogChannel,
  toggleLog,
  getLogSettings,
  cacheMessage,
  getCachedMessage,
  cleanOldMessages,
};
