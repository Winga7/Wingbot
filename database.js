const Database = require("better-sqlite3");
const fs = require("node:fs");
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
  COMMANDS,
  COMMAND_GROUPS,
} = require("./commandsManifest");

// Chemin de la base : variable d'env prioritaire (utile en Docker pour pointer
// sur un volume partagé entre les conteneurs bot + dashboard), sinon fichier
// "wingbot.db" à la racine du projet (comportement local par défaut).
const DB_PATH = process.env.WINGBOT_DB_PATH
  ? path.resolve(process.env.WINGBOT_DB_PATH)
  : path.join(__dirname, "wingbot.db");

// S'assurer que le dossier parent existe (utile au premier lancement Docker
// si le volume est vide).
const DB_DIR = path.dirname(DB_PATH);
try {
  fs.mkdirSync(DB_DIR, { recursive: true });
} catch {
  /* ignore : si le dossier existe déjà ou si on n'a pas les droits, on remonte
     une erreur claire ci-dessous. */
}

// Vérifie qu'on peut écrire dans le dossier AVANT d'ouvrir la base, sinon
// SQLite remonte un cryptique "attempt to write a readonly database" sur la
// première migration. On préfère un message explicite.
try {
  fs.accessSync(DB_DIR, fs.constants.W_OK);
} catch {
  console.error(
    `\n[DB] ❌ Le dossier "${DB_DIR}" n'est pas accessible en écriture pour ` +
      `cet utilisateur (UID ${typeof process.getuid === "function" ? process.getuid() : "?"}).\n` +
      `\n  Si tu es en Docker, fixe les permissions du bind-mount sur l'hôte :\n` +
      `    sudo chown -R 1000:1000 ./data && chmod -R u+rwX ./data\n` +
      `  ou rebuild l'image avec ton UID :\n` +
      `    docker compose build --build-arg APP_UID=$(id -u) --build-arg APP_GID=$(id -g)\n`,
  );
  process.exit(1);
}

const db = new Database(DB_PATH);

// Activer le mode WAL pour de meilleures performances
db.pragma("journal_mode = WAL");
// IMPORTANT en multi-process (bot + dashboard) : on veut que chaque lecture voie
// les écritures committées par l'autre process. NORMAL est déjà ce comportement
// (les lecteurs voient toujours le dernier commit), on l'écrit explicitement.
db.pragma("synchronous = NORMAL");

console.log(`[DB] wingbot.db → ${DB_PATH}`);

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
  migrateBotGlobalSettingsTable();
  migrateGuildEmbedsTable();
  migratePremiumUsersTable();
  migrateGuildPremiumTable();
  migrateGuildBackupsTable();
  migrateBackupRestoresTable();
  migrateDmMessagesTable();
  migrateDashboardSessionsTable();

  console.log("✅ Base de données initialisée");
}

// ============================================================
//  Dashboard sessions (OAuth Discord persistées en DB)
// ============================================================
//
// Avant : sessions stockées dans une Map JS en mémoire → vidées à chaque
// restart du process Node (notamment chaque `docker compose up -d --build`),
// obligeant les utilisateurs à se reconnecter.
// Maintenant : persistées en SQLite dans le volume partagé `./data` →
// survivent aux restarts.

function migrateDashboardSessionsTable() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS dashboard_sessions (
      session_id    TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      username      TEXT,
      access_token  TEXT NOT NULL,
      expires_at    INTEGER NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    )
    `
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_user ON dashboard_sessions(user_id)`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expires ON dashboard_sessions(expires_at)`
  ).run();
}

function createDashboardSession({ sessionId, userId, username, accessToken, expiresAt }) {
  db.prepare(
    `INSERT OR REPLACE INTO dashboard_sessions
       (session_id, user_id, username, access_token, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    String(sessionId),
    String(userId),
    username || null,
    String(accessToken),
    Number(expiresAt)
  );
}

function getDashboardSession(sessionId) {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `SELECT session_id, user_id, username, access_token, expires_at
       FROM dashboard_sessions WHERE session_id = ?`
    )
    .get(String(sessionId));
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    deleteDashboardSession(sessionId);
    return null;
  }
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    accessToken: row.access_token,
    expiresAt: Number(row.expires_at),
  };
}

function deleteDashboardSession(sessionId) {
  if (!sessionId) return 0;
  return db
    .prepare(`DELETE FROM dashboard_sessions WHERE session_id = ?`)
    .run(String(sessionId)).changes;
}

function purgeExpiredDashboardSessions() {
  return db
    .prepare(`DELETE FROM dashboard_sessions WHERE expires_at < ?`)
    .run(Date.now()).changes;
}

// ============================================================
//  DMs reçus / envoyés par le bot (vue Fonda → Messages privés)
// ============================================================

function migrateDmMessagesTable() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS dm_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT NOT NULL,
      channel_id   TEXT,
      message_id   TEXT UNIQUE,
      direction    TEXT NOT NULL CHECK(direction IN ('in','out')),
      author_id    TEXT,
      author_tag   TEXT,
      content      TEXT,
      attachments  TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    `
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_dm_messages_user ON dm_messages(user_id, created_at)`
  ).run();

  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS dm_threads (
      user_id        TEXT PRIMARY KEY,
      user_tag       TEXT,
      user_avatar    TEXT,
      channel_id     TEXT,
      last_read_at   DATETIME,
      last_message_at DATETIME
    )
    `
  ).run();
}

function recordDmMessage({
  user_id,
  channel_id,
  message_id,
  direction,
  author_id,
  author_tag,
  content,
  attachments,
  user_tag,
  user_avatar,
}) {
  if (!user_id || !direction) return null;
  const attJson = attachments
    ? typeof attachments === "string"
      ? attachments
      : JSON.stringify(attachments)
    : null;
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO dm_messages
        (user_id, channel_id, message_id, direction, author_id, author_tag, content, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(user_id),
      channel_id ? String(channel_id) : null,
      message_id ? String(message_id) : null,
      direction,
      author_id ? String(author_id) : null,
      author_tag || null,
      content || "",
      attJson
    );
  // upsert thread
  db.prepare(
    `INSERT INTO dm_threads (user_id, user_tag, user_avatar, channel_id, last_message_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       user_tag        = COALESCE(excluded.user_tag, dm_threads.user_tag),
       user_avatar     = COALESCE(excluded.user_avatar, dm_threads.user_avatar),
       channel_id      = COALESCE(excluded.channel_id, dm_threads.channel_id),
       last_message_at = CURRENT_TIMESTAMP`
  ).run(
    String(user_id),
    user_tag || null,
    user_avatar || null,
    channel_id ? String(channel_id) : null
  );
  return info.lastInsertRowid || null;
}

function listDmThreads(limit = 100) {
  const threads = db
    .prepare(
      `SELECT t.user_id, t.user_tag, t.user_avatar, t.channel_id,
              t.last_read_at, t.last_message_at,
              (SELECT content FROM dm_messages
                 WHERE user_id = t.user_id ORDER BY id DESC LIMIT 1) AS last_content,
              (SELECT direction FROM dm_messages
                 WHERE user_id = t.user_id ORDER BY id DESC LIMIT 1) AS last_direction,
              (SELECT COUNT(*) FROM dm_messages
                 WHERE user_id = t.user_id
                   AND direction = 'in'
                   AND (t.last_read_at IS NULL OR created_at > t.last_read_at)) AS unread
       FROM dm_threads t
       ORDER BY t.last_message_at DESC
       LIMIT ?`
    )
    .all(limit);
  return threads;
}

function getDmThread(userId, limit = 200) {
  if (!userId) return { thread: null, messages: [] };
  const thread = db
    .prepare(
      `SELECT user_id, user_tag, user_avatar, channel_id, last_read_at, last_message_at
       FROM dm_threads WHERE user_id = ?`
    )
    .get(String(userId));
  const messages = db
    .prepare(
      `SELECT id, message_id, direction, author_id, author_tag, content, attachments, created_at
       FROM dm_messages WHERE user_id = ? ORDER BY id ASC LIMIT ?`
    )
    .all(String(userId), limit)
    .map((r) => ({
      ...r,
      attachments: r.attachments ? safeJsonParse(r.attachments, []) : [],
    }));
  return { thread: thread || null, messages };
}

function markDmThreadRead(userId) {
  if (!userId) return;
  db.prepare(
    `UPDATE dm_threads SET last_read_at = CURRENT_TIMESTAMP WHERE user_id = ?`
  ).run(String(userId));
}

function updateDmThreadProfile(userId, { user_tag, user_avatar, channel_id }) {
  if (!userId) return;
  db.prepare(
    `INSERT INTO dm_threads (user_id, user_tag, user_avatar, channel_id, last_message_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       user_tag    = COALESCE(excluded.user_tag, dm_threads.user_tag),
       user_avatar = COALESCE(excluded.user_avatar, dm_threads.user_avatar),
       channel_id  = COALESCE(excluded.channel_id, dm_threads.channel_id)`
  ).run(
    String(userId),
    user_tag || null,
    user_avatar || null,
    channel_id ? String(channel_id) : null
  );
}

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// ============================================================
//  Premium / VIP / Backups
// ============================================================

function migratePremiumUsersTable() {
  // Conservée pour compatibilité, mais le concept "user premium / vip" est
  // déprécié. Seul le tier 'founder' est encore lu (pour offrir un bypass
  // global à un compte). Les anciennes lignes vip/premium sont ignorées par
  // premiumGate.js — on ne les drop pas pour préserver l'historique d'audit.
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS premium_users (
      user_id    TEXT PRIMARY KEY,
      tier       TEXT NOT NULL CHECK(tier IN ('founder','vip','premium')),
      granted_by TEXT,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      note       TEXT
    )
    `
  ).run();
}

// ============================================================
//  Premium par SERVEUR (modèle actuel — depuis avril 2026)
// ============================================================
//
// Un serveur Discord peut être marqué premium :
//  - source = 'paid' : payé (futur : intégration paiement)
//  - source = 'gift' : offert gracieusement par le founder ("VIP")
//
// All-or-nothing : un serveur premium → toutes les features premium dispo.
// L'attribut est de la GUILD, pas de l'utilisateur (un user peut donc être
// admin sur 5 serveurs dont 2 premium → seuls ces 2-là débloquent).

function migrateGuildPremiumTable() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS guild_premium (
      guild_id    TEXT PRIMARY KEY,
      source      TEXT NOT NULL CHECK(source IN ('paid','gift')),
      granted_by  TEXT,
      granted_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at  DATETIME,
      notes       TEXT
    )
    `
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_guild_premium_expires ON guild_premium(expires_at)`
  ).run();
}

function listPremiumGuilds() {
  return db
    .prepare(
      `SELECT guild_id, source, granted_by, granted_at, expires_at, notes
       FROM guild_premium ORDER BY granted_at DESC`
    )
    .all();
}

function getPremiumGuild(guildId) {
  if (!guildId) return null;
  return (
    db
      .prepare(
        `SELECT guild_id, source, granted_by, granted_at, expires_at, notes
         FROM guild_premium WHERE guild_id = ?`
      )
      .get(String(guildId)) || null
  );
}

function upsertPremiumGuild({ guild_id, source, granted_by, expires_at, notes }) {
  if (!guild_id || !source) throw new Error("guild_id et source requis");
  if (!["paid", "gift"].includes(source)) {
    throw new Error("source invalide (attendu : 'paid' | 'gift')");
  }
  db.prepare(
    `INSERT INTO guild_premium (guild_id, source, granted_by, expires_at, notes)
     VALUES (@guild_id, @source, @granted_by, @expires_at, @notes)
     ON CONFLICT(guild_id) DO UPDATE SET
       source     = excluded.source,
       granted_by = excluded.granted_by,
       expires_at = excluded.expires_at,
       notes      = excluded.notes`
  ).run({
    guild_id: String(guild_id),
    source,
    granted_by: granted_by ? String(granted_by) : null,
    expires_at: expires_at || null,
    notes: notes || null,
  });
  return getPremiumGuild(guild_id);
}

function deletePremiumGuild(guildId) {
  if (!guildId) return 0;
  return db
    .prepare(`DELETE FROM guild_premium WHERE guild_id = ?`)
    .run(String(guildId)).changes;
}

function migrateGuildBackupsTable() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS guild_backups (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_code      TEXT UNIQUE NOT NULL,
      source_guild_id  TEXT NOT NULL,
      owner_user_id    TEXT NOT NULL,
      name             TEXT,
      include_messages INTEGER DEFAULT 0,
      payload          TEXT NOT NULL,
      size_bytes       INTEGER,
      channels_count   INTEGER DEFAULT 0,
      roles_count      INTEGER DEFAULT 0,
      messages_count   INTEGER DEFAULT 0,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    `
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_guild_backups_owner ON guild_backups(owner_user_id)`
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_guild_backups_source ON guild_backups(source_guild_id)`
  ).run();
}

function migrateBackupRestoresTable() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS backup_restores (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_id        INTEGER NOT NULL,
      target_guild_id  TEXT NOT NULL,
      triggered_by     TEXT NOT NULL,
      mode             TEXT NOT NULL,
      status           TEXT NOT NULL,
      log              TEXT,
      started_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at      DATETIME,
      FOREIGN KEY(backup_id) REFERENCES guild_backups(id) ON DELETE CASCADE
    )
    `
  ).run();
}

// ------- Premium users CRUD -------

function listPremiumUsers() {
  return db
    .prepare(
      `SELECT user_id, tier, granted_by, granted_at, expires_at, note
       FROM premium_users ORDER BY granted_at DESC`
    )
    .all();
}

function getPremiumUser(userId) {
  if (!userId) return null;
  return db
    .prepare(
      `SELECT user_id, tier, granted_by, granted_at, expires_at, note
       FROM premium_users WHERE user_id = ?`
    )
    .get(String(userId)) || null;
}

function upsertPremiumUser({ user_id, tier, granted_by, expires_at, note }) {
  if (!user_id || !tier) throw new Error("user_id et tier requis");
  if (!["founder", "vip", "premium"].includes(tier)) {
    throw new Error("tier invalide");
  }
  db.prepare(
    `INSERT INTO premium_users (user_id, tier, granted_by, expires_at, note)
     VALUES (@user_id, @tier, @granted_by, @expires_at, @note)
     ON CONFLICT(user_id) DO UPDATE SET
       tier       = excluded.tier,
       granted_by = excluded.granted_by,
       expires_at = excluded.expires_at,
       note       = excluded.note`
  ).run({
    user_id: String(user_id),
    tier,
    granted_by: granted_by ? String(granted_by) : null,
    expires_at: expires_at || null,
    note: note || null,
  });
  return getPremiumUser(user_id);
}

function deletePremiumUser(userId) {
  if (!userId) return 0;
  return db
    .prepare(`DELETE FROM premium_users WHERE user_id = ?`)
    .run(String(userId)).changes;
}

// ------- Backups CRUD -------

function insertGuildBackup(row) {
  const info = db
    .prepare(
      `INSERT INTO guild_backups
        (backup_code, source_guild_id, owner_user_id, name, include_messages,
         payload, size_bytes, channels_count, roles_count, messages_count)
       VALUES (@backup_code, @source_guild_id, @owner_user_id, @name, @include_messages,
               @payload, @size_bytes, @channels_count, @roles_count, @messages_count)`
    )
    .run({
      backup_code: row.backup_code,
      source_guild_id: row.source_guild_id,
      owner_user_id: row.owner_user_id,
      name: row.name || null,
      include_messages: row.include_messages ? 1 : 0,
      payload: row.payload,
      size_bytes: row.size_bytes || null,
      channels_count: row.channels_count || 0,
      roles_count: row.roles_count || 0,
      messages_count: row.messages_count || 0,
    });
  return info.lastInsertRowid;
}

function getBackupByCode(code) {
  if (!code) return null;
  return db
    .prepare(
      `SELECT * FROM guild_backups WHERE backup_code = ?`
    )
    .get(String(code).trim().toUpperCase()) || null;
}

function getBackupById(id) {
  return db.prepare(`SELECT * FROM guild_backups WHERE id = ?`).get(id) || null;
}

function listUserBackups(userId, limit = 50) {
  return db
    .prepare(
      `SELECT id, backup_code, source_guild_id, owner_user_id, name,
              include_messages, size_bytes, channels_count, roles_count,
              messages_count, created_at
       FROM guild_backups
       WHERE owner_user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(String(userId), limit);
}

function countUserBackups(userId) {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM guild_backups WHERE owner_user_id = ?`)
      .get(String(userId))?.n || 0
  );
}

function deleteBackupByCodeFor(code, ownerUserId) {
  if (!code) return 0;
  return db
    .prepare(
      `DELETE FROM guild_backups WHERE backup_code = ? AND owner_user_id = ?`
    )
    .run(String(code).trim().toUpperCase(), String(ownerUserId)).changes;
}

function codeExists(code) {
  if (!code) return false;
  return !!db
    .prepare(`SELECT 1 FROM guild_backups WHERE backup_code = ?`)
    .get(String(code).trim().toUpperCase());
}

// ------- Restores log -------

function insertBackupRestore(row) {
  const info = db
    .prepare(
      `INSERT INTO backup_restores
        (backup_id, target_guild_id, triggered_by, mode, status, log)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.backup_id,
      String(row.target_guild_id),
      String(row.triggered_by),
      row.mode,
      row.status,
      row.log ? JSON.stringify(row.log) : null
    );
  return info.lastInsertRowid;
}

function updateBackupRestore(id, patch) {
  const fields = [];
  const vals = [];
  for (const k of ["status", "log"]) {
    if (k in patch) {
      fields.push(`${k} = ?`);
      vals.push(k === "log" ? JSON.stringify(patch.log || {}) : patch[k]);
    }
  }
  if (patch.finished) {
    fields.push(`finished_at = CURRENT_TIMESTAMP`);
  }
  if (!fields.length) return;
  vals.push(id);
  db.prepare(
    `UPDATE backup_restores SET ${fields.join(", ")} WHERE id = ?`
  ).run(...vals);
}

function migrateGuildEmbedsTable() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS guild_embeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      channel_id TEXT,
      message_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_guild_embeds_guild ON guild_embeds(guild_id)`
  ).run();
}

function parseGuildEmbedPayload(raw) {
  try {
    const o = JSON.parse(raw || "{}");
    if (!o || typeof o !== "object") return {};
    return o;
  } catch {
    return {};
  }
}

function listGuildEmbeds(guildId) {
  const rows = db
    .prepare(
      `SELECT id, guild_id, name, channel_id, message_id, payload, created_at, updated_at
       FROM guild_embeds WHERE guild_id = ? ORDER BY updated_at DESC`
    )
    .all(guildId);
  return rows.map((r) => ({
    id: r.id,
    guild_id: r.guild_id,
    name: r.name || "",
    channel_id: r.channel_id || null,
    message_id: r.message_id || null,
    payload: parseGuildEmbedPayload(r.payload),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

function getGuildEmbedRow(embedId, guildId) {
  const row = db
    .prepare(
      `SELECT id, guild_id, name, channel_id, message_id, payload, created_at, updated_at
       FROM guild_embeds WHERE id = ? AND guild_id = ?`
    )
    .get(embedId, guildId);
  if (!row) return null;
  return {
    id: row.id,
    guild_id: row.guild_id,
    name: row.name || "",
    channel_id: row.channel_id || null,
    message_id: row.message_id || null,
    payload: parseGuildEmbedPayload(row.payload),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function insertGuildEmbed(guildId, name, payloadObj) {
  ensureGuildLogRow(guildId);
  const nm = String(name || "Sans titre").trim().slice(0, 120) || "Sans titre";
  const payloadStr = JSON.stringify(payloadObj && typeof payloadObj === "object" ? payloadObj : {});
  const r = db
    .prepare(
      `INSERT INTO guild_embeds (guild_id, name, payload, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(guildId, nm, payloadStr);
  return getGuildEmbedRow(Number(r.lastInsertRowid), guildId);
}

function updateGuildEmbed(embedId, guildId, patch) {
  const cur = getGuildEmbedRow(embedId, guildId);
  if (!cur) return null;
  const name =
    patch.name != null
      ? String(patch.name).trim().slice(0, 120) || cur.name
      : cur.name;
  let payload = cur.payload;
  if (patch.payload != null && typeof patch.payload === "object") {
    payload = patch.payload;
  }
  const channel_id =
    patch.channel_id !== undefined
      ? patch.channel_id == null || patch.channel_id === ""
        ? null
        : String(patch.channel_id).trim()
      : cur.channel_id;
  const message_id =
    patch.message_id !== undefined
      ? patch.message_id == null || patch.message_id === ""
        ? null
        : String(patch.message_id).trim()
      : cur.message_id;

  db.prepare(
    `UPDATE guild_embeds SET
      name = ?,
      channel_id = ?,
      message_id = ?,
      payload = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND guild_id = ?`
  ).run(
    name,
    channel_id,
    message_id,
    JSON.stringify(payload),
    embedId,
    guildId
  );
  return getGuildEmbedRow(embedId, guildId);
}

function deleteGuildEmbed(embedId, guildId) {
  const r = db
    .prepare(`DELETE FROM guild_embeds WHERE id = ? AND guild_id = ?`)
    .run(embedId, guildId);
  return r.changes > 0;
}

function migrateBotGlobalSettingsTable() {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS bot_global_settings (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      desired_username TEXT,
      presence_status TEXT DEFAULT 'online',
      presence_activity_type TEXT DEFAULT 'None',
      presence_activity_text TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  ).run();
  db.prepare(
    `
    INSERT INTO bot_global_settings (singleton_id, desired_username, presence_status, presence_activity_type, presence_activity_text)
    VALUES (1, NULL, 'online', 'None', NULL)
    ON CONFLICT(singleton_id) DO NOTHING
  `
  ).run();
}

function getBotGlobalSettings() {
  const row = db
    .prepare(
      `SELECT desired_username, presence_status, presence_activity_type, presence_activity_text
       FROM bot_global_settings WHERE singleton_id = 1`
    )
    .get();
  return {
    desired_username: row?.desired_username ?? null,
    presence_status: row?.presence_status || "online",
    presence_activity_type: row?.presence_activity_type || "None",
    presence_activity_text: row?.presence_activity_text ?? null,
  };
}

function setBotGlobalSettings(patch) {
  const current = getBotGlobalSettings();
  const merged = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "desired_username")) {
    const v = String(patch.desired_username ?? "").trim();
    merged.desired_username = v || null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "presence_status")) {
    const allowed = new Set(["online", "idle", "dnd", "invisible"]);
    const v = String(patch.presence_status || "").trim().toLowerCase();
    if (!allowed.has(v)) throw new Error("presence_status invalide");
    merged.presence_status = v;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "presence_activity_type")) {
    const allowed = new Set(["None", "Custom", "Playing", "Listening", "Watching", "Competing"]);
    const v = String(patch.presence_activity_type || "").trim();
    if (!allowed.has(v)) throw new Error("presence_activity_type invalide");
    merged.presence_activity_type = v;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "presence_activity_text")) {
    const v = String(patch.presence_activity_text ?? "").trim();
    merged.presence_activity_text = v || null;
  }

  db.prepare(
    `UPDATE bot_global_settings
     SET desired_username = ?,
         presence_status = ?,
         presence_activity_type = ?,
         presence_activity_text = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE singleton_id = 1`
  ).run(
    merged.desired_username,
    merged.presence_status,
    merged.presence_activity_type,
    merged.presence_activity_text
  );
  return merged;
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
  if (!names.has("command_groups_disabled")) {
    db.prepare("ALTER TABLE guild_config ADD COLUMN command_groups_disabled TEXT").run();
    db.prepare(
      "UPDATE guild_config SET command_groups_disabled = ? WHERE command_groups_disabled IS NULL"
    ).run("[]");
  }
  if (!names.has("command_access")) {
    db.prepare("ALTER TABLE guild_config ADD COLUMN command_access TEXT").run();
    db.prepare(
      "UPDATE guild_config SET command_access = ? WHERE command_access IS NULL"
    ).run("{}");
  }
}

const COMMAND_GROUP_IDS = new Set(COMMAND_GROUPS.map((g) => g.id));
const COMMAND_CATEGORY_BY_ID = Object.fromEntries(
  COMMANDS.map((c) => [c.id, c.category])
);

function defaultCommandAccess() {
  return {
    ignore_channel_ids: [],
    block_role_ids: [],
    allow_role_ids: [],
    staff_role_ids: [],
  };
}

function normalizeSnowflakeList(arr, max = 60) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const id = String(x ?? "")
      .replace(/\D/g, "")
      .trim();
    if (!/^\d{17,20}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function parseCommandAccess(raw) {
  const base = defaultCommandAccess();
  if (raw == null || String(raw).trim() === "") return base;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return base;
    return {
      ignore_channel_ids: normalizeSnowflakeList(o.ignore_channel_ids),
      block_role_ids: normalizeSnowflakeList(o.block_role_ids),
      allow_role_ids: normalizeSnowflakeList(o.allow_role_ids),
      staff_role_ids: normalizeSnowflakeList(o.staff_role_ids),
    };
  } catch {
    return base;
  }
}

function getCommandAccessConfig(guildId) {
  const row = db
    .prepare("SELECT command_access FROM guild_config WHERE guild_id = ?")
    .get(guildId);
  return parseCommandAccess(row?.command_access);
}

function getDisabledCommandGroups(guildId) {
  const row = db
    .prepare("SELECT command_groups_disabled FROM guild_config WHERE guild_id = ?")
    .get(guildId);
  if (!row?.command_groups_disabled) return [];
  try {
    const arr = JSON.parse(row.command_groups_disabled);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.filter((x) => typeof x === "string" && COMMAND_GROUP_IDS.has(x)))];
  } catch {
    return [];
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
  if (getDisabledCommands(guildId).includes(commandName)) return false;
  const cat = COMMAND_CATEGORY_BY_ID[commandName];
  if (cat && getDisabledCommandGroups(guildId).includes(cat)) return false;
  return true;
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
    command_groups_disabled: getDisabledCommandGroups(guildId),
    command_access: getCommandAccessConfig(guildId),
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

  if (patch.command_groups_disabled != null) {
    if (!Array.isArray(patch.command_groups_disabled)) {
      throw new Error("command_groups_disabled doit être un tableau de groupes");
    }
    const filtered = [
      ...new Set(
        patch.command_groups_disabled.filter(
          (x) => typeof x === "string" && COMMAND_GROUP_IDS.has(x)
        )
      ),
    ];
    db.prepare(
      "UPDATE guild_config SET command_groups_disabled = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?"
    ).run(JSON.stringify(filtered), guildId);
  }

  if (patch.command_access != null) {
    if (typeof patch.command_access !== "object" || patch.command_access === null) {
      throw new Error("command_access invalide");
    }
    const cur = getCommandAccessConfig(guildId);
    const next = { ...cur };
    for (const key of [
      "ignore_channel_ids",
      "block_role_ids",
      "allow_role_ids",
      "staff_role_ids",
    ]) {
      if (Object.prototype.hasOwnProperty.call(patch.command_access, key)) {
        const v = patch.command_access[key];
        if (!Array.isArray(v)) {
          throw new Error(`command_access.${key} doit être un tableau d’IDs`);
        }
        next[key] = normalizeSnowflakeList(v);
      }
    }
    db.prepare(
      "UPDATE guild_config SET command_access = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?"
    ).run(JSON.stringify(next), guildId);
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
  DB_PATH,
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
  getCommandAccessConfig,
  getCustomCommands,
  getCustomCommandReply,
  getGuildDashboardPayload,
  applyGuildSettingsPatch,
  ensureGuildLogRow,
  cacheMessage,
  getCachedMessage,
  cleanOldMessages,
  getBotGlobalSettings,
  setBotGlobalSettings,
  listGuildEmbeds,
  getGuildEmbedRow,
  insertGuildEmbed,
  updateGuildEmbed,
  deleteGuildEmbed,
  listPremiumUsers,
  getPremiumUser,
  upsertPremiumUser,
  deletePremiumUser,
  listPremiumGuilds,
  getPremiumGuild,
  upsertPremiumGuild,
  deletePremiumGuild,
  createDashboardSession,
  getDashboardSession,
  deleteDashboardSession,
  purgeExpiredDashboardSessions,
  insertGuildBackup,
  getBackupByCode,
  getBackupById,
  listUserBackups,
  countUserBackups,
  deleteBackupByCodeFor,
  codeExists,
  insertBackupRestore,
  updateBackupRestore,
  recordDmMessage,
  listDmThreads,
  getDmThread,
  markDmThreadRead,
  updateDmThreadProfile,
};
