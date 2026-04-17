const Database = require("better-sqlite3");
const path = require("path");
const {
  ALL_KEYS,
  DEFAULT_FLAGS,
  LEGACY_MAP,
  TOGGLE_GROUP,
} = require("./logFeatureDefinitions");
const {
  ALL_COMMAND_IDS,
  IMMUTABLE_COMMAND_IDS,
} = require("./commandsManifest");

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

  migrateLogSettingsFeatureFlags();
  migrateGuildConfigExtras();
  migrateCustomCommandsTable();

  console.log("✅ Base de données initialisée");
}

function migrateCustomCommandsTable() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS custom_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      response TEXT NOT NULL,
      UNIQUE (guild_id, trigger)
    )
  `
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_custom_commands_guild ON custom_commands(guild_id)`
  ).run();
}

function migrateLogSettingsFeatureFlags() {
  const cols = db.prepare("PRAGMA table_info(log_settings)").all();
  if (!cols.some((c) => c.name === "feature_flags")) {
    db.prepare("ALTER TABLE log_settings ADD COLUMN feature_flags TEXT").run();
  }
}

function migrateGuildConfigExtras() {
  const cols = db.prepare("PRAGMA table_info(guild_config)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("prefix")) {
    db.prepare("ALTER TABLE guild_config ADD COLUMN prefix TEXT").run();
    db.prepare("UPDATE guild_config SET prefix = ? WHERE prefix IS NULL").run(
      "$"
    );
  }
  if (!names.has("logs_master_enabled")) {
    db.prepare(
      "ALTER TABLE guild_config ADD COLUMN logs_master_enabled INTEGER"
    ).run();
    db.prepare(
      "UPDATE guild_config SET logs_master_enabled = 1 WHERE logs_master_enabled IS NULL"
    ).run();
  }
  if (!names.has("commands_disabled")) {
    db.prepare("ALTER TABLE guild_config ADD COLUMN commands_disabled TEXT").run();
    db.prepare(
      "UPDATE guild_config SET commands_disabled = ? WHERE commands_disabled IS NULL"
    ).run("[]");
  }
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

function ensureGuildLogRow(guildId) {
  db.prepare(`
    INSERT INTO guild_config (guild_id)
    VALUES (?)
    ON CONFLICT(guild_id) DO NOTHING
  `).run(guildId);
  db.prepare(`
    INSERT INTO log_settings (guild_id)
    VALUES (?)
    ON CONFLICT(guild_id) DO NOTHING
  `).run(guildId);
}

/** Flags effectifs (granulaires), avec rétrocompat si feature_flags absent */
function getResolvedFeatureFlags(guildId) {
  const row = db.prepare("SELECT * FROM log_settings WHERE guild_id = ?").get(
    guildId
  );
  if (!row) return { ...DEFAULT_FLAGS };

  let parsed = {};
  if (row.feature_flags) {
    try {
      parsed = JSON.parse(row.feature_flags);
    } catch {
      parsed = {};
    }
  }

  const hasGranular =
    row.feature_flags &&
    String(row.feature_flags).trim() !== "" &&
    String(row.feature_flags).trim() !== "{}" &&
    Object.keys(parsed).length > 0;

  if (hasGranular) {
    return { ...DEFAULT_FLAGS, ...parsed };
  }

  const fromLegacy = { ...DEFAULT_FLAGS };
  for (const [col, keys] of Object.entries(LEGACY_MAP)) {
    if (row[col]) {
      for (const k of keys) fromLegacy[k] = true;
    }
  }
  return fromLegacy;
}

function legacyIntsFromFlags(flags) {
  const out = {};
  for (const [col, keys] of Object.entries(LEGACY_MAP)) {
    out[col] = keys.some((k) => flags[k]) ? 1 : 0;
  }
  return out;
}

/** Sauvegarde l'objet flags complet + synchro des 6 colonnes legacy */
function saveFeatureFlags(guildId, flags) {
  ensureGuildLogRow(guildId);
  const merged = { ...DEFAULT_FLAGS };
  for (const k of ALL_KEYS) merged[k] = !!flags[k];

  const leg = legacyIntsFromFlags(merged);
  db.prepare(`
    UPDATE log_settings SET
      log_messages = ?,
      log_members = ?,
      log_voice = ?,
      log_roles = ?,
      log_moderation = ?,
      log_server = ?,
      feature_flags = ?
    WHERE guild_id = ?
  `).run(
    leg.log_messages,
    leg.log_members,
    leg.log_voice,
    leg.log_roles,
    leg.log_moderation,
    leg.log_server,
    JSON.stringify(merged),
    guildId
  );
}

function isLogsMasterEnabled(guildId) {
  const row = db
    .prepare("SELECT logs_master_enabled FROM guild_config WHERE guild_id = ?")
    .get(guildId);
  if (!row) return true;
  return row.logs_master_enabled !== 0;
}

function isLogEnabled(guildId, flagKey) {
  if (!isLogsMasterEnabled(guildId)) return false;
  const f = getResolvedFeatureFlags(guildId);
  return !!f[flagKey];
}

function getGuildPrefix(guildId) {
  const row = db.prepare("SELECT prefix FROM guild_config WHERE guild_id = ?").get(
    guildId
  );
  if (!row || row.prefix == null || String(row.prefix).trim() === "") {
    return "$";
  }
  return String(row.prefix);
}

function getDisabledCommands(guildId) {
  const row = db
    .prepare("SELECT commands_disabled FROM guild_config WHERE guild_id = ?")
    .get(guildId);
  if (!row?.commands_disabled) return [];
  try {
    const arr = JSON.parse(row.commands_disabled);
    const list = Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    const immutable = new Set(IMMUTABLE_COMMAND_IDS);
    return list.filter((id) => !immutable.has(id));
  } catch {
    return [];
  }
}

function isCommandEnabled(guildId, commandName) {
  if (IMMUTABLE_COMMAND_IDS.includes(commandName)) return true;
  return !getDisabledCommands(guildId).includes(commandName);
}

/** Clé de déclencheur (minuscules, trim) — compatible caractères accentués */
function normalizeCustomTrigger(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isValidCustomTrigger(tr) {
  if (!tr || tr.length > 32) return false;
  return /^[\p{L}\p{N}_-]{1,32}$/u.test(tr);
}

function getCustomCommands(guildId) {
  const rows = db
    .prepare(
      `SELECT id, trigger, response FROM custom_commands WHERE guild_id = ? ORDER BY trigger ASC`
    )
    .all(guildId);
  return rows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    response: r.response,
  }));
}

function getCustomCommandReply(guildId, triggerLower) {
  const t = normalizeCustomTrigger(triggerLower);
  if (!t) return null;
  const row = db
    .prepare(
      `SELECT response FROM custom_commands WHERE guild_id = ? AND trigger = ?`
    )
    .get(guildId, t);
  return row?.response ?? null;
}

function replaceCustomCommands(guildId, rows) {
  if (!Array.isArray(rows)) {
    throw new Error("custom_commands doit être un tableau");
  }
  const reserved = new Set(ALL_COMMAND_IDS);
  const seen = new Set();
  const insert = db.prepare(
    `INSERT INTO custom_commands (guild_id, trigger, response) VALUES (?, ?, ?)`
  );
  const del = db.prepare(`DELETE FROM custom_commands WHERE guild_id = ?`);

  const transaction = db.transaction(() => {
    del.run(guildId);
    for (const row of rows) {
      const tr = normalizeCustomTrigger(row.trigger);
      const resp = String(row.response ?? "").trim();
      if (!tr || !resp) continue;
      if (!isValidCustomTrigger(tr)) {
        throw new Error(
          `Déclencheur invalide « ${tr} » : 1–32 caractères (lettres y compris accents, chiffres, _ ou -)`
        );
      }
      if (reserved.has(tr)) {
        throw new Error(
          `Le nom « ${tr} » est réservé pour une commande du bot`
        );
      }
      if (resp.length > 2000) {
        throw new Error("Réponse trop longue (max 2000 caractères)");
      }
      if (seen.has(tr)) continue;
      seen.add(tr);
      insert.run(guildId, tr, resp);
    }
  });
  transaction();
}

/** Payload unifié pour le dashboard */
function getGuildDashboardPayload(guildId) {
  ensureGuildLogRow(guildId);
  return {
    guild_id: guildId,
    log_channel_id: getLogChannel(guildId),
    feature_flags: getResolvedFeatureFlags(guildId),
    prefix: getGuildPrefix(guildId),
    logs_master_enabled: isLogsMasterEnabled(guildId),
    commands_disabled: getDisabledCommands(guildId),
    custom_commands: getCustomCommands(guildId),
  };
}

function isValidPrefix(p) {
  if (typeof p !== "string") return false;
  const t = p.trim();
  if (t.length < 1 || t.length > 16) return false;
  return /^[^\s]+$/.test(t);
}

/**
 * Mise à jour partielle (dashboard). Seules les clés présentes sont appliquées.
 */
function applyGuildSettingsPatch(guildId, patch) {
  if (!patch || typeof patch !== "object") return;

  ensureGuildLogRow(guildId);

  if (patch.feature_flags != null) {
    if (typeof patch.feature_flags !== "object") {
      throw new Error("feature_flags invalide");
    }
    const current = getResolvedFeatureFlags(guildId);
    const merged = { ...current };
    for (const k of ALL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch.feature_flags, k)) {
        merged[k] = !!patch.feature_flags[k];
      }
    }
    saveFeatureFlags(guildId, merged);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "log_channel_id")) {
    const ch = patch.log_channel_id;
    const empty = ch === null || ch === "";
    const okId = typeof ch === "string" && /^\d{17,20}$/.test(ch.trim());
    if (!empty && !okId) {
      throw new Error(
        "log_channel_id : ID Discord (17–20 chiffres) ou vide"
      );
    }
    if (empty) {
      setLogChannel(guildId, null);
    } else {
      setLogChannel(guildId, String(ch).trim());
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "prefix")) {
    const p = String(patch.prefix ?? "").trim();
    if (!isValidPrefix(p)) {
      throw new Error("Préfixe invalide : 1 à 16 caractères, sans espace");
    }
    db.prepare(
      "UPDATE guild_config SET prefix = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?"
    ).run(p, guildId);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "logs_master_enabled")) {
    const v = !!patch.logs_master_enabled;
    db.prepare(
      "UPDATE guild_config SET logs_master_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?"
    ).run(v ? 1 : 0, guildId);
  }

  if (patch.commands_disabled != null) {
    if (!Array.isArray(patch.commands_disabled)) {
      throw new Error("commands_disabled doit être un tableau de noms de commandes");
    }
    const valid = new Set(ALL_COMMAND_IDS);
    const immutable = new Set(IMMUTABLE_COMMAND_IDS);
    const filtered = [
      ...new Set(
        patch.commands_disabled.filter((x) => typeof x === "string")
      ),
    ].filter((id) => valid.has(id) && !immutable.has(id));
    db.prepare(
      "UPDATE guild_config SET commands_disabled = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?"
    ).run(JSON.stringify(filtered), guildId);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "custom_commands")) {
    replaceCustomCommands(guildId, patch.custom_commands);
  }
}

// Activer/désactiver un type de log (compat commandes /togglelog)
function toggleLog(guildId, logType, enabled) {
  ensureGuildLogRow(guildId);

  const keys = TOGGLE_GROUP[logType];
  if (!keys) return false;

  const flags = getResolvedFeatureFlags(guildId);
  const val = !!enabled;
  for (const k of keys) flags[k] = val;
  saveFeatureFlags(guildId, flags);
  return true;
}

// Récupérer la configuration des logs (colonnes legacy + feature_flags brut)
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
      feature_flags: null,
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
  getResolvedFeatureFlags,
  saveFeatureFlags,
  isLogEnabled,
  isLogsMasterEnabled,
  getGuildPrefix,
  getDisabledCommands,
  isCommandEnabled,
  getCustomCommands,
  getCustomCommandReply,
  getGuildDashboardPayload,
  applyGuildSettingsPatch,
  ensureGuildLogRow,
  cacheMessage,
  getCachedMessage,
  cleanOldMessages,
};
