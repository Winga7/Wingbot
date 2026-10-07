/**
 * Dashboard HTTP : lit/écrit wingbot.db + OAuth Discord (liste des serveurs admin).
 *
 * .env :
 *   TOKEN (bot), CLIENT_ID
 *   DISCORD_CLIENT_SECRET — secret OAuth2 (Discord Developer Portal)
 *   DASHBOARD_PUBLIC_URL — ex. http://127.0.0.1:3847 (URL par défaut, utilisée si
 *     l'origine de la requête n'est pas dans DASHBOARD_ALLOWED_ORIGINS)
 *   DASHBOARD_ALLOWED_ORIGINS — optionnel, liste CSV d'URLs autorisées pour l'OAuth
 *     (ex. "http://127.0.0.1:3847,http://192.168.68.133:3847,https://dash.wingbot.fr").
 *     Chacune de ces URLs doit aussi être enregistrée dans le portail Discord
 *     (OAuth2 → Redirects → <origine>/api/auth/discord/callback).
 *   DASHBOARD_HOST — optionnel, IP d'écoute HTTP (défaut : 0.0.0.0)
 *   BOT_INVITE_PERMISSIONS — optionnel, entier permissions (défaut : 268438528)
 *   TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET — app Twitch Dev (alertes live + clips)
 */
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const compression = require("compression");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { DASHBOARD_GROUPS } = require("../logFeatureDefinitions");
const { COMMAND_GROUPS, COMMANDS } = require("../commandsManifest");
const {
  initDatabase,
  db,
  getGuildDashboardPayload,
  applyGuildSettingsPatch,
  ensureGuildLogRow,
  getBotGlobalSettings,
  setBotGlobalSettings,
  listGuildEmbeds,
  getGuildEmbedRow,
  insertGuildEmbed,
  updateGuildEmbed,
  deleteGuildEmbed,
  listPremiumGuilds,
  upsertPremiumGuild,
  deletePremiumGuild,
  listUserBackups,
  recordDmMessage,
  listDmThreads,
  getDmThread,
  markDmThreadRead,
  updateDmThreadProfile,
  listGuildWarnings,
  deleteGuildWarning,
  clearGuildWarningsForUser,
  getGuildWarningById,
  getWarnConfig,
  listScheduledMessages,
  getScheduledMessage,
  insertScheduledMessage,
  updateScheduledMessage,
  deleteScheduledMessage,
  listReactionRolePanels,
  getReactionRolePanel,
  insertReactionRolePanel,
  updateReactionRolePanel,
  deleteReactionRolePanel,
  reactionRolePanelExistsForMessage,
  listSocialFeeds,
  getSocialFeed,
  insertSocialFeed,
  updateSocialFeed,
  deleteSocialFeed,
  listTicketPanels,
  getTicketPanel,
  ticketPanelExistsForMessage,
  insertTicketPanel,
  cloneTicketPanel,
  updateTicketPanel,
  deleteTicketPanel,
  listTickets,
  DB_PATH,
} = require("../database");
const { parseEmojiInput, emojiKeyToApiPath } = require("../lib/reactionRoleEmoji");
const {
  parseCategories,
  parseSupportRoleIds,
  parsePanelSettings,
  buildPanelComponents,
  defaultPanelContent,
} = require("../lib/ticketConfig");
const { resolveAndPreviewYoutubeChannel } = require("../lib/youtubeFeed");
const { resolveAndPreviewTwitchChannel } = require("../lib/twitchApi");
const {
  defaultEmbedPayload,
  mergeEmbedPayload,
  payloadToDiscordMessageBody,
  substituteEmbedPayload,
} = require("./embedPayload");
const {
  getSession,
  createSession,
  clearSessionCookie,
  destroySession,
  normalizeSnowflakeId,
  canManageGuild,
  userGuildIconUrl,
  fetchUserGuilds,
  fetchOAuthToken,
  fetchDiscordMe,
  buildInviteUrl,
  buildGenericInviteUrl,
} = require("./discordAuth");

initDatabase();

const app = express();
// Respecte X-Forwarded-* si le dashboard est derrière un reverse proxy
// (Traefik, nginx, Cloudflare…). Sans ça, req.protocol serait toujours "http".
app.set("trust proxy", true);
const PORT = Number(process.env.DASHBOARD_PORT) || 3847;
const HOST = process.env.DASHBOARD_HOST || "0.0.0.0";
const DISCORD_API = "https://discord.com/api/v10";

function csvSet(raw) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// Couche premium unifiée — lit l'env + les tables `premium_users` (founder
// seulement) et `guild_premium`. Source de vérité unique pour bot + dashboard.
const premiumGate = require("../premiumGate");

function isFounderUser(userId) {
  return premiumGate.isFounder(userId);
}

function requireFounder(req, res, next) {
  if (!isFounderUser(req.discordSession?.userId)) {
    return res.status(403).json({
      error: "founder_only",
      message: "Fonction réservée au compte fondateur.",
    });
  }
  next();
}

function canUseFeature(userId, guildId, featureKey) {
  return premiumGate.canUseFeature(userId, guildId, featureKey);
}

function publicBaseUrl() {
  const u = process.env.DASHBOARD_PUBLIC_URL || `http://localhost:${PORT}`;
  return u.replace(/\/$/, "");
}

/**
 * Liste parsée une fois de toutes les origines autorisées (DASHBOARD_PUBLIC_URL
 * + DASHBOARD_ALLOWED_ORIGINS). Utilisée pour choisir dynamiquement le
 * redirect_uri OAuth en fonction de l'hôte sur lequel l'utilisateur navigue.
 */
const _allowedOriginsCache = (() => {
  const raw = [
    process.env.DASHBOARD_PUBLIC_URL,
    ...(process.env.DASHBOARD_ALLOWED_ORIGINS || "").split(","),
  ];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const v = (item || "").trim().replace(/\/$/, "");
    if (!v || seen.has(v)) continue;
    try {
      const u = new URL(v);
      const key = `${u.protocol}//${u.host}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    } catch {
      /* URL invalide, on ignore */
    }
  }
  return out;
})();

/**
 * Retourne l'URL de base correspondant à la requête entrante si elle fait
 * partie des origines autorisées ; sinon retombe sur DASHBOARD_PUBLIC_URL.
 * Empêche un attaquant d'imposer un `redirect_uri` via un header Host bidouillé.
 *
 * Si le host matche une origine autorisée mais avec un autre protocole
 * (http vs https derrière Caddy), on utilise l'origine enregistrée.
 */
function publicBaseUrlFor(req) {
  if (!req) return publicBaseUrl();
  const hostHeader = String(
    req.headers["x-forwarded-host"] || req.headers.host || ""
  )
    .split(",")[0]
    .trim();
  if (!hostHeader) return publicBaseUrl();
  const proto = (
    req.headers["x-forwarded-proto"] ||
    req.protocol ||
    "http"
  )
    .split(",")[0]
    .trim();
  const candidate = `${proto}://${hostHeader}`.replace(/\/$/, "");
  if (_allowedOriginsCache.includes(candidate)) return candidate;

  // Même host, autre proto (ex. accès HTTPS public alors que .env a http)
  try {
    const candHost = new URL(candidate).host.toLowerCase();
    for (const origin of _allowedOriginsCache) {
      try {
        if (new URL(origin).host.toLowerCase() === candHost) return origin;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  const fallback = publicBaseUrl();
  if (candidate !== fallback) {
    console.warn(
      `[oauth] Origine non autorisée: ${candidate} → fallback ${fallback}. ` +
        `Ajoute-la à DASHBOARD_ALLOWED_ORIGINS (et Redirect Discord = ${candidate}/api/auth/discord/callback).`
    );
  }
  return fallback;
}

function oauthRedirectUri(req) {
  return `${publicBaseUrlFor(req)}/api/auth/discord/callback`;
}

/* ------------------------------------------------------------------ *
 * Cache : IDs des serveurs où le bot est présent.
 * Un seul appel `GET /users/@me/guilds` (jusqu'à 200 guildes par page)
 * remplace N appels individuels `GET /guilds/:id`. TTL court (60s) pour
 * rester à jour après une invitation du bot sans matraquer Discord.
 * ------------------------------------------------------------------ */
const BOT_GUILD_IDS_TTL_MS = 60 * 1000;
let botGuildIdsCache = { ids: null, at: 0, inflight: null };

async function fetchBotGuildIdsFromDiscord() {
  const botToken = (process.env.TOKEN || "").trim();
  if (!botToken) return new Set();

  const all = new Set();
  let after = "";
  for (let page = 0; page < 25; page++) {
    const url = `${DISCORD_API}/users/@me/guilds?limit=200${
      after ? `&after=${encodeURIComponent(after)}` : ""
    }`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bot ${botToken}`,
        "User-Agent": "DiscordBot (https://discord.com, 1.0)",
      },
    });
    if (r.status === 429) {
      const reset = Number(r.headers.get("retry-after") || "1");
      await new Promise((res) => setTimeout(res, Math.ceil(reset * 1000) + 100));
      page--;
      continue;
    }
    if (!r.ok) {
      console.warn(
        `[dashboard] fetchBotGuildIdsFromDiscord HTTP ${r.status} — vérifie TOKEN (bot) dans .env`
      );
      break;
    }
    const list = await r.json().catch(() => []);
    if (!Array.isArray(list) || list.length === 0) break;
    for (const g of list) {
      const gid = normalizeSnowflakeId(g.id);
      if (gid) all.add(gid);
    }
    if (list.length < 200) break;
    after = list[list.length - 1].id;
  }
  return all;
}

async function getBotGuildIdsCached({ force = false } = {}) {
  const now = Date.now();
  if (
    !force &&
    botGuildIdsCache.ids &&
    now - botGuildIdsCache.at < BOT_GUILD_IDS_TTL_MS
  ) {
    return botGuildIdsCache.ids;
  }
  if (botGuildIdsCache.inflight) return botGuildIdsCache.inflight;

  const p = fetchBotGuildIdsFromDiscord()
    .then((ids) => {
      botGuildIdsCache = { ids, at: Date.now(), inflight: null };
      return ids;
    })
    .catch((e) => {
      botGuildIdsCache.inflight = null;
      if (botGuildIdsCache.ids) return botGuildIdsCache.ids;
      throw e;
    });
  botGuildIdsCache.inflight = p;
  return p;
}

async function botGuildExists(guildId) {
  const id = normalizeSnowflakeId(guildId);
  if (!id) return false;
  const botToken = (process.env.TOKEN || "").trim();
  if (!botToken) return false;
  try {
    const ids = await getBotGuildIdsCached();
    if (ids.has(id)) return true;
    if (Date.now() - botGuildIdsCache.at < 5000) return false;
    const refreshed = await getBotGuildIdsCached({ force: true });
    return refreshed.has(id);
  } catch {
    return false;
  }
}

/** Appels Discord REST (bot) */
async function discordFetchJson(pathStr) {
  const botToken = (process.env.TOKEN || "").trim();
  if (!botToken) {
    const err = new Error("TOKEN du bot manquant dans .env");
    err.code = "NO_BOT_TOKEN";
    throw err;
  }
  const r = await fetch(`${DISCORD_API}${pathStr}`, {
    headers: {
      Authorization: `Bot ${botToken}`,
      "User-Agent": "WingbotDashboard (https://discord.com)",
    },
  });
  const text = await r.text();
  if (!r.ok) {
    const e = new Error(`Discord ${r.status}: ${text.slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  return text ? JSON.parse(text) : null;
}

async function discordBotJson(method, pathStr, bodyObj) {
  const botToken = (
    process.env.TOKEN ||
    process.env.DISCORD_BOT_TOKEN ||
    ""
  ).trim();
  if (!botToken) {
    const err = new Error("TOKEN du bot manquant dans .env");
    err.code = "NO_BOT_TOKEN";
    throw err;
  }
  const opts = {
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      "User-Agent": "WingbotDashboard (https://discord.com)",
    },
  };
  if (bodyObj !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(bodyObj);
  }
  const r = await fetch(`${DISCORD_API}${pathStr}`, opts);
  const text = await r.text();
  if (!r.ok) {
    const e = new Error(`Discord ${method} ${pathStr} → ${r.status}: ${text.slice(0, 500)}`);
    e.status = r.status;
    throw e;
  }
  return text ? JSON.parse(text) : null;
}

async function discordDeleteMessage(channelId, messageId) {
  const ch = normalizeSnowflakeId(channelId);
  const mid = normalizeSnowflakeId(messageId);
  if (!ch || !mid) return;
  const botToken = (process.env.TOKEN || "").trim();
  if (!botToken) return;
  const r = await fetch(
    `${DISCORD_API}/channels/${encodeURIComponent(ch)}/messages/${encodeURIComponent(mid)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${botToken}`,
        "User-Agent": "WingbotDashboard (https://discord.com)",
      },
    }
  );
  if (!r.ok && r.status !== 404) {
    const t = await r.text();
    const e = new Error(`Discord DELETE message ${r.status}: ${t.slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
}

function guildIconUrlBot(guildId, iconHash) {
  if (!iconHash) return null;
  const ext = String(iconHash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=64`;
}

function botAvatarUrl(user, size = 256) {
  if (!user?.id) return null;
  if (!user.avatar) return `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator || 0) % 5}.png`;
  const ext = String(user.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=${size}`;
}

async function fetchBotUser() {
  return discordFetchJson("/users/@me");
}

async function setBotAvatarFromDataUri(dataUri) {
  const botToken = (process.env.TOKEN || "").trim();
  if (!botToken) {
    const err = new Error("TOKEN du bot manquant dans .env");
    err.code = "NO_BOT_TOKEN";
    throw err;
  }
  const r = await fetch(`${DISCORD_API}/users/@me`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      "User-Agent": "WingbotDashboard (https://discord.com)",
    },
    body: JSON.stringify({ avatar: dataUri }),
  });
  const txt = await r.text();
  if (!r.ok) {
    const e = new Error(`Discord avatar ${r.status}: ${txt.slice(0, 300)}`);
    e.status = r.status;
    throw e;
  }
  return txt ? JSON.parse(txt) : null;
}

async function setBotNicknameInGuild(guildId, nickname) {
  const botToken = (process.env.TOKEN || "").trim();
  if (!botToken) {
    const err = new Error("TOKEN du bot manquant dans .env");
    err.code = "NO_BOT_TOKEN";
    throw err;
  }
  const normalizedGuildId = normalizeSnowflakeId(guildId);
  const nick = String(nickname || "").trim();
  const body = { nick: nick || null };
  const r = await fetch(
    `${DISCORD_API}/guilds/${encodeURIComponent(normalizedGuildId)}/members/@me`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
        "User-Agent": "WingbotDashboard (https://discord.com)",
      },
      body: JSON.stringify(body),
    }
  );
  const txt = await r.text();
  if (!r.ok) {
    const e = new Error(`Discord bot nick ${r.status}: ${txt.slice(0, 300)}`);
    e.status = r.status;
    throw e;
  }
  return txt ? JSON.parse(txt) : null;
}

async function imageUrlToDataUri(imageUrl) {
  const r = await fetch(imageUrl);
  if (!r.ok) {
    throw new Error(`Téléchargement image impossible (${r.status})`);
  }
  const contentType = r.headers.get("content-type") || "image/png";
  const arr = await r.arrayBuffer();
  const b64 = Buffer.from(arr).toString("base64");
  return `data:${contentType};base64,${b64}`;
}

/** Salons où on peut poster du texte (inclut le chat des vocaux / scène). */
const LOGGABLE_CHANNEL_TYPES = new Set([
  0, // GuildText
  2, // GuildVoice (chat textuel du vocal)
  5, // GuildAnnouncement
  13, // GuildStageVoice (chat scène)
  15, // GuildForum
]);

function formatChannelsForUi(channels) {
  const list = channels.filter((c) => LOGGABLE_CHANNEL_TYPES.has(c.type));
  const categories = channels
    .filter((c) => c.type === 4)
    .sort((a, b) => a.position - b.position);

  const out = [];
  const seen = new Set();

  const labelFor = (c) => {
    if (c.type === 2) return `🔊 ${c.name}`;
    if (c.type === 13) return `🎙️ ${c.name}`;
    return c.name;
  };

  for (const cat of categories) {
    const kids = list
      .filter((c) => c.parent_id === cat.id)
      .sort((a, b) => a.position - b.position);
    for (const k of kids) {
      out.push({
        id: k.id,
        name: labelFor(k),
        category: cat.name,
        type: k.type,
      });
      seen.add(k.id);
    }
  }

  const orphans = list
    .filter((c) => !c.parent_id && !seen.has(c.id))
    .sort((a, b) => a.position - b.position);
  for (const o of orphans) {
    out.push({ id: o.id, name: labelFor(o), category: null, type: o.type });
  }

  return out;
}

function formatRolesForUi(roles) {
  if (!Array.isArray(roles)) return [];
  return roles
    .filter((r) => r && r.name !== "@everyone" && !r.managed)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color ?? 0,
    }));
}

app.use(compression());
app.use(express.json({ limit: "512kb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

function requireDiscordSession(req, res, next) {
  const s = getSession(req);
  if (!s) {
    return res.status(401).json({
      error: "discord_not_connected",
      message: "Connecte ton compte Discord (bouton dans la barre latérale).",
    });
  }
  req.discordSession = s;
  next();
}

// Evite de spammer /users/@me/guilds pendant le chargement initial du dashboard.
// Un seul appel Discord partagé (config + stats + me/guilds + bootstrap).
const userGuildsCache = new Map();
const USER_GUILDS_CACHE_TTL_MS = 30000;

/** Cache court salons/rôles Discord (évite 2 appels API identiques au chargement). */
const guildDiscordListCache = new Map();
const GUILD_DISCORD_LIST_TTL_MS = 60000;

function getGuildDiscordListCache(key) {
  const hit = guildDiscordListCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    guildDiscordListCache.delete(key);
    return null;
  }
  return hit.data;
}

function setGuildDiscordListCache(key, data) {
  guildDiscordListCache.set(key, {
    data,
    expires: Date.now() + GUILD_DISCORD_LIST_TTL_MS,
  });
}

async function getUserGuildsCached(accessToken, cacheKey = "") {
  const now = Date.now();
  if (cacheKey) {
    const hit = userGuildsCache.get(cacheKey);
    if (hit?.guilds && hit.expiresAt > now) return hit.guilds;
    if (hit?.inflight) return hit.inflight;
  }

  const inflight = fetchUserGuilds(accessToken)
    .then((guilds) => {
      if (cacheKey) {
        userGuildsCache.set(cacheKey, {
          guilds,
          expiresAt: Date.now() + USER_GUILDS_CACHE_TTL_MS,
          inflight: null,
        });
        if (userGuildsCache.size > 300) {
          for (const [k, v] of userGuildsCache) {
            if (v.expiresAt <= now) userGuildsCache.delete(k);
          }
        }
      }
      return guilds;
    })
    .catch((err) => {
      if (cacheKey) {
        const hit = userGuildsCache.get(cacheKey);
        if (hit?.inflight === inflight) userGuildsCache.delete(cacheKey);
      }
      throw err;
    });

  if (cacheKey) {
    userGuildsCache.set(cacheKey, {
      guilds: null,
      expiresAt: 0,
      inflight,
    });
  }
  return inflight;
}

async function getManageableGuildIds(accessToken, cacheKey = "") {
  const rawGuilds = await getUserGuildsCached(accessToken, cacheKey);
  return new Set(
    rawGuilds
      .filter((g) => canManageGuild(g))
      .map((g) => normalizeSnowflakeId(g.id))
      .filter(Boolean)
  );
}

async function buildGuildPickerList(rawGuilds, clientId) {
  const seen = new Set();
  let manageable = rawGuilds.filter((g) => {
    const ok = canManageGuild(g);
    if (ok) seen.add(normalizeSnowflakeId(g.id));
    return ok;
  });

  const dbGuildIds = db
    .prepare("SELECT guild_id FROM guild_config")
    .all()
    .map((row) => normalizeSnowflakeId(row.guild_id));
  for (const gid of dbGuildIds) {
    if (!gid || seen.has(gid)) continue;
    const raw = rawGuilds.find((g) => normalizeSnowflakeId(g.id) === gid);
    if (raw && canManageGuild(raw)) {
      manageable.push(raw);
      seen.add(gid);
    }
  }

  const byId = new Map();
  for (const g of manageable) {
    const gid = normalizeSnowflakeId(g.id);
    if (gid) byId.set(gid, g);
  }
  manageable = [...byId.values()];

  const hasRowInDb = (gid) =>
    !!db.prepare("SELECT 1 FROM guild_config WHERE guild_id = ?").get(gid);

  const perms = process.env.BOT_INVITE_PERMISSIONS || "268438528";
  const botIds = await getBotGuildIdsCached().catch(() => new Set());

  const out = manageable.map((g) => {
    const gid = normalizeSnowflakeId(g.id);
    return {
      guild_id: gid,
      name: g.name,
      icon_url: userGuildIconUrl(gid, g.icon),
      bot_in_guild: botIds.has(gid),
      has_config_in_db: hasRowInDb(gid),
      invite_url: buildInviteUrl(gid, clientId, perms),
    };
  });

  out.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return out;
}

async function requireGuildManageAccess(req, res, next) {
  try {
    const gid = normalizeSnowflakeId(req.params.guildId);
    if (!gid) {
      return res.status(400).json({ error: "guild_id_invalide" });
    }
    const ids = await getManageableGuildIds(
      req.discordSession.accessToken,
      req.discordSession.sessionId || req.discordSession.userId
    );
    if (!ids.has(gid)) {
      return res.status(403).json({
        error: "forbidden",
        message: "Tu n'as pas les permissions de gestion sur ce serveur.",
      });
    }
    req.guildId = gid;
    next();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message) });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "wingbot-dashboard",
    db_path: DB_PATH,
    cwd: process.cwd(),
    pid: process.pid,
    node_env: process.env.NODE_ENV || null,
  });
});

app.get("/api/bot/profile", async (_req, res) => {
  try {
    const bot = await fetchBotUser();
    res.json({
      id: bot.id,
      username: bot.username,
      avatar_url: botAvatarUrl(bot, 256),
    });
  } catch (e) {
    if (e.code === "NO_BOT_TOKEN") {
      return res.status(503).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.get("/api/bot/invite", (_req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: "DISCORD_CLIENT_ID manquant" });
  }
  const perms = process.env.BOT_INVITE_PERMISSIONS || "268438528";
  res.json({ invite_url: buildGenericInviteUrl(clientId, perms) });
});

app.get("/api/internal/access", requireDiscordSession, (req, res) => {
  const userId = req.discordSession.userId;
  res.json({
    user_id: userId,
    founder: isFounderUser(userId),
    // Champ legacy conservé pour compat front : true si founder. La notion
    // de "user premium" n'existe plus (premium est désormais par serveur).
    premium: isFounderUser(userId),
  });
});

app.get("/api/bot/global-settings", requireDiscordSession, requireFounder, async (_req, res) => {
  try {
    const bot = await fetchBotUser();
    const cfg = getBotGlobalSettings();
    res.json({
      ...cfg,
      current_username: bot.username,
      avatar_url: botAvatarUrl(bot, 512),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.put("/api/bot/global-settings", requireDiscordSession, requireFounder, async (req, res) => {
  try {
    const payload = req.body || {};
    const hasAvatarUrl = Object.prototype.hasOwnProperty.call(payload, "avatar_url");
    const hasAvatarDataUri = Object.prototype.hasOwnProperty.call(payload, "avatar_data_uri");

    if (hasAvatarDataUri) {
      const dataUri = String(payload.avatar_data_uri || "").trim();
      if (!dataUri.startsWith("data:image/")) {
        return res.status(400).json({ error: "avatar_data_uri_invalide" });
      }
      await setBotAvatarFromDataUri(dataUri);
    } else if (hasAvatarUrl) {
      const imageUrl = String(payload.avatar_url || "").trim();
      if (!/^https?:\/\//i.test(imageUrl)) {
        return res.status(400).json({ error: "image_url_invalide" });
      }
      const dataUri = await imageUrlToDataUri(imageUrl);
      await setBotAvatarFromDataUri(dataUri);
    }

    const nextCfg = setBotGlobalSettings({
      desired_username: payload.desired_username,
      presence_status: payload.presence_status,
      presence_activity_type: payload.presence_activity_type,
      presence_activity_text: payload.presence_activity_text,
    });

    const bot = await fetchBotUser();
    res.json({
      ok: true,
      ...nextCfg,
      current_username: bot.username,
      avatar_url: botAvatarUrl(bot, 512),
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message) });
  }
});

// ============================================================
//  Messages privés du bot (founder-only) — vue Fonda → DMs
// ============================================================

function userAvatarUrlFromApi(user) {
  if (!user?.id) return null;
  if (!user.avatar) {
    return `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator || 0) % 5}.png`;
  }
  const ext = String(user.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}

app.get("/api/dm/threads", requireDiscordSession, requireFounder, (_req, res) => {
  try {
    res.json({ threads: listDmThreads(200) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.get(
  "/api/dm/threads/:userId",
  requireDiscordSession,
  requireFounder,
  (req, res) => {
    const id = normalizeSnowflakeId(req.params.userId);
    if (!id) return res.status(400).json({ error: "user_id invalide" });
    try {
      const data = getDmThread(id, 500);
      res.json(data);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/dm/threads/:userId/read",
  requireDiscordSession,
  requireFounder,
  (req, res) => {
    const id = normalizeSnowflakeId(req.params.userId);
    if (!id) return res.status(400).json({ error: "user_id invalide" });
    try {
      markDmThreadRead(id);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/dm/threads/:userId/messages",
  requireDiscordSession,
  requireFounder,
  async (req, res) => {
    const id = normalizeSnowflakeId(req.params.userId);
    if (!id) return res.status(400).json({ error: "user_id invalide" });
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "content_vide" });
    if (content.length > 2000) {
      return res.status(400).json({ error: "content_trop_long" });
    }
    try {
      const dmChannel = await discordBotJson("POST", "/users/@me/channels", {
        recipient_id: id,
      });
      if (!dmChannel?.id) {
        return res.status(502).json({ error: "dm_channel_invalide" });
      }
      const sent = await discordBotJson(
        "POST",
        `/channels/${encodeURIComponent(dmChannel.id)}/messages`,
        { content }
      );
      // Récupère un minimum d'info user pour bien remplir le thread
      let userInfo = null;
      try {
        userInfo = await discordFetchJson(`/users/${encodeURIComponent(id)}`);
      } catch {
        /* tolère un échec de fetch user */
      }
      const bot = await fetchBotUser().catch(() => null);
      recordDmMessage({
        user_id: id,
        channel_id: dmChannel.id,
        message_id: sent?.id || null,
        direction: "out",
        author_id: bot?.id || null,
        author_tag: bot ? `${bot.username}` : null,
        content,
        attachments: [],
        user_tag: userInfo
          ? userInfo.global_name || userInfo.username || null
          : null,
        user_avatar: userInfo ? userAvatarUrlFromApi(userInfo) : null,
      });
      updateDmThreadProfile(id, {
        user_tag: userInfo
          ? userInfo.global_name || userInfo.username || null
          : null,
        user_avatar: userInfo ? userAvatarUrlFromApi(userInfo) : null,
        channel_id: dmChannel.id,
      });
      res.json({ ok: true, message_id: sent?.id || null });
    } catch (e) {
      console.error("[DM send]", e);
      const status = e?.status === 403 ? 403 : 500;
      res.status(status).json({
        error: "send_failed",
        message:
          e?.status === 403
            ? "Discord refuse l'envoi (utilisateur n'autorise pas les DMs ou n'a aucun serveur en commun avec le bot)."
            : String(e.message || e),
      });
    }
  }
);

function normalizeDiscordApiEmbeds(embeds) {
  if (!Array.isArray(embeds) || !embeds.length) return [];
  return embeds.map((e) => ({
    title: e.title || undefined,
    description: e.description || undefined,
    url: e.url || undefined,
    color: typeof e.color === "number" ? e.color : undefined,
    fields: Array.isArray(e.fields)
      ? e.fields.map((f) => ({
          name: f.name,
          value: f.value,
          inline: !!f.inline,
        }))
      : undefined,
    footer: e.footer
      ? { text: e.footer.text, icon_url: e.footer.icon_url || undefined }
      : undefined,
    timestamp: e.timestamp || undefined,
    author: e.author
      ? {
          name: e.author.name,
          icon_url: e.author.icon_url || undefined,
          url: e.author.url || undefined,
        }
      : undefined,
    thumbnail: e.thumbnail?.url ? { url: e.thumbnail.url } : undefined,
    image: e.image?.url ? { url: e.image.url } : undefined,
  }));
}

/**
 * Importe l'historique d'un salon DM Discord vers la base locale.
 * @returns {{ imported: number, updated: number, channel_id: string, pages: number }}
 */
async function syncDmChannelFromDiscord(userId, options = {}) {
  const maxPages = Math.min(Math.max(Number(options.maxPages) || 5, 1), 10);
  const dmChannel = await discordBotJson("POST", "/users/@me/channels", {
    recipient_id: userId,
  });
  if (!dmChannel?.id) {
    const err = new Error("dm_channel_invalide");
    err.code = "DM_CHANNEL";
    throw err;
  }

  let userInfo = null;
  try {
    userInfo = await discordFetchJson(`/users/${encodeURIComponent(userId)}`);
  } catch {
    /* ignore */
  }
  const bot = await fetchBotUser().catch(() => null);
  const botId = bot?.id || null;

  let imported = 0;
  let touched = 0;
  let before = null;
  let pages = 0;

  while (pages < maxPages) {
    pages += 1;
    const qs = new URLSearchParams({ limit: "100" });
    if (before) qs.set("before", before);
    const batch = await discordBotJson(
      "GET",
      `/channels/${encodeURIComponent(dmChannel.id)}/messages?${qs}`
    );
    if (!Array.isArray(batch) || !batch.length) break;

    for (const msg of batch) {
      const authorId = msg.author?.id || null;
      const isOut = botId && authorId === botId;
      const embeds = normalizeDiscordApiEmbeds(msg.embeds);
      const rowId = recordDmMessage({
        user_id: userId,
        channel_id: dmChannel.id,
        message_id: msg.id,
        direction: isOut ? "out" : "in",
        author_id: authorId,
        author_tag: msg.author
          ? msg.author.global_name || msg.author.username || null
          : null,
        content: msg.content || "",
        attachments: Array.isArray(msg.attachments)
          ? msg.attachments.map((a) => ({
              name: a.filename || a.name || "fichier",
              url: a.url,
            }))
          : [],
        embeds,
        user_tag: userInfo
          ? userInfo.global_name || userInfo.username || null
          : null,
        user_avatar: userInfo ? userAvatarUrlFromApi(userInfo) : null,
        created_at: msg.timestamp || null,
      });
      if (rowId) {
        touched += 1;
        // lastInsertRowid only on insert; changes>0 also on update → count both
        imported += 1;
      }
    }

    before = batch[batch.length - 1]?.id;
    if (batch.length < 100) break;
  }

  updateDmThreadProfile(userId, {
    user_tag: userInfo
      ? userInfo.global_name || userInfo.username || null
      : null,
    user_avatar: userInfo ? userAvatarUrlFromApi(userInfo) : null,
    channel_id: dmChannel.id,
  });

  return {
    imported,
    updated: touched,
    channel_id: dmChannel.id,
    pages,
    user_tag: userInfo
      ? userInfo.global_name || userInfo.username || null
      : null,
  };
}

/** Importe l'historique DM Discord (ex. rappels / assignations gestionimpact). */
app.post(
  "/api/dm/threads/:userId/sync",
  requireDiscordSession,
  requireFounder,
  async (req, res) => {
    const id = normalizeSnowflakeId(req.params.userId);
    if (!id) return res.status(400).json({ error: "user_id invalide" });
    try {
      const result = await syncDmChannelFromDiscord(id);
      res.json({ ok: true, ...result });
    } catch (e) {
      console.error("[DM sync]", e);
      if (e.code === "NO_BOT_TOKEN") {
        return res.status(503).json({ error: "bot_token_manquant" });
      }
      res.status(502).json({ error: String(e.message || e) });
    }
  }
);

/**
 * Découvre tous les salons MP du bot via Discord et importe l'historique
 * (récupère les DMs gestionimpact même s'ils n'étaient pas encore en base).
 */
app.post(
  "/api/dm/sync-all",
  requireDiscordSession,
  requireFounder,
  async (req, res) => {
    try {
      const channels = await discordBotJson("GET", "/users/@me/channels");
      if (!Array.isArray(channels)) {
        return res.status(502).json({ error: "channels_invalides" });
      }

      const bot = await fetchBotUser().catch(() => null);
      const botId = bot?.id || null;
      let threads = 0;
      let messages = 0;
      const errors = [];

      for (const ch of channels) {
        // type 1 = DM, type 3 = group DM (on ignore les groupes)
        if (ch.type !== 1) continue;
        const recipients = Array.isArray(ch.recipients) ? ch.recipients : [];
        const other =
          recipients.find((u) => u?.id && u.id !== botId) || recipients[0];
        const userId = normalizeSnowflakeId(other?.id);
        if (!userId) continue;

        try {
          const result = await syncDmChannelFromDiscord(userId, {
            maxPages: 3,
          });
          threads += 1;
          messages += result.imported || 0;
        } catch (e) {
          errors.push({
            user_id: userId,
            error: String(e.message || e).slice(0, 200),
          });
        }
      }

      res.json({
        ok: true,
        threads,
        messages,
        discovered: channels.filter((c) => c.type === 1).length,
        errors: errors.slice(0, 10),
      });
    } catch (e) {
      console.error("[DM sync-all]", e);
      if (e.code === "NO_BOT_TOKEN") {
        return res.status(503).json({ error: "bot_token_manquant" });
      }
      res.status(502).json({ error: String(e.message || e) });
    }
  }
);

/**
 * Ingest DM envoyé par une app externe (gestionimpact) avec le même bot.
 * Auth : header X-Wingbot-Ingest-Secret = DM_INGEST_SECRET (.env)
 */
function requireDmIngestSecret(req, res, next) {
  const expected = String(process.env.DM_INGEST_SECRET || "").trim();
  if (!expected) {
    return res.status(503).json({
      error: "ingest_disabled",
      message: "DM_INGEST_SECRET non configuré sur Wingbot.",
    });
  }
  const got = String(
    req.headers["x-wingbot-ingest-secret"] ||
      req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
      ""
  ).trim();
  if (!got || got !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.post("/api/internal/dm/ingest", requireDmIngestSecret, async (req, res) => {
  try {
    const userId = normalizeSnowflakeId(req.body?.user_id || "");
    if (!userId) {
      return res.status(400).json({ error: "user_id invalide" });
    }

    const messageId = normalizeSnowflakeId(req.body?.message_id || "") || null;
    const channelId = normalizeSnowflakeId(req.body?.channel_id || "") || null;
    const direction =
      req.body?.direction === "in" || req.body?.direction === "out"
        ? req.body.direction
        : "out";
    const content = String(req.body?.content || "");
    const embeds = normalizeDiscordApiEmbeds(req.body?.embeds);
    const attachments = Array.isArray(req.body?.attachments)
      ? req.body.attachments
      : [];

    let userInfo = null;
    try {
      userInfo = await discordFetchJson(`/users/${encodeURIComponent(userId)}`);
    } catch {
      /* ignore */
    }
    const bot = await fetchBotUser().catch(() => null);

    const rowId = recordDmMessage({
      user_id: userId,
      channel_id: channelId,
      message_id: messageId,
      direction,
      author_id:
        normalizeSnowflakeId(req.body?.author_id || "") || bot?.id || null,
      author_tag:
        req.body?.author_tag ||
        bot?.username ||
        null,
      content,
      attachments,
      embeds,
      user_tag: userInfo
        ? userInfo.global_name || userInfo.username || null
        : req.body?.user_tag || null,
      user_avatar: userInfo
        ? userAvatarUrlFromApi(userInfo)
        : req.body?.user_avatar || null,
      created_at: req.body?.created_at || null,
    });

    res.json({ ok: true, recorded: !!rowId, message_id: messageId });
  } catch (e) {
    console.error("[DM ingest]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/bot/avatar", requireDiscordSession, async (req, res) => {
  try {
    // bot_avatar est une feature globale (impacte tous les serveurs) : on
    // n'a pas de guildId à passer, le check se réduit à "founder only".
    if (!canUseFeature(req.discordSession.userId, null, "bot_avatar")) {
      return res.status(403).json({
        error: "feature_locked",
        message: "Réservé au compte fondateur.",
      });
    }
    const manageableIds = await getManageableGuildIds(
      req.discordSession.accessToken,
      req.discordSession.sessionId || req.discordSession.userId
    );
    if (manageableIds.size === 0) {
      return res.status(403).json({
        error: "forbidden",
        message: "Aucun serveur gérable détecté pour ce compte Discord.",
      });
    }

    const imageUrl = String(req.body?.image_url || "").trim();
    if (!/^https?:\/\//i.test(imageUrl)) {
      return res.status(400).json({
        error: "image_url_invalide",
        message: "Envoie une URL d'image valide (http/https).",
      });
    }

    const dataUri = await imageUrlToDataUri(imageUrl);
    const updated = await setBotAvatarFromDataUri(dataUri);
    res.json({
      ok: true,
      avatar_url: botAvatarUrl(updated, 512),
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message) });
  }
});

app.get(
  "/api/discord/guilds/:guildId/bot-profile",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const botIn = await botGuildExists(guildId);
      if (!botIn) {
        return res.status(404).json({ error: "Bot non présent sur ce serveur" });
      }
      const bot = await fetchBotUser();
      const member = await discordFetchJson(
        `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(bot.id)}`
      );
      res.json({
        guild_id: guildId,
        bot_user_id: bot.id,
        username: bot.username,
        avatar_url: botAvatarUrl(bot, 512),
        nickname: member?.nick || "",
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.put(
  "/api/discord/guilds/:guildId/bot-profile",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const botIn = await botGuildExists(guildId);
      if (!botIn) {
        return res.status(404).json({ error: "Bot non présent sur ce serveur" });
      }

      const payload = req.body || {};
      const hasAvatar =
        Object.prototype.hasOwnProperty.call(payload, "avatar_url") ||
        Object.prototype.hasOwnProperty.call(payload, "avatar_data_uri");
      const hasNick = Object.prototype.hasOwnProperty.call(payload, "nickname");

      if (!hasAvatar && !hasNick) {
        return res.status(400).json({
          error: "payload_invalide",
          message: "Renseigne avatar_url et/ou nickname.",
        });
      }

      if (hasAvatar && !canUseFeature(req.discordSession.userId, guildId, "bot_avatar")) {
        return res.status(403).json({
          error: "feature_locked",
          message: "Réservé au compte fondateur.",
        });
      }
      if (hasNick && !canUseFeature(req.discordSession.userId, guildId, "bot_nickname")) {
        return res.status(403).json({
          error: "feature_locked",
          message: "Réservé au compte fondateur.",
        });
      }

      if (hasAvatar) {
        const imageUrl = String(payload.avatar_url || "").trim();
        const dataUriRaw = String(payload.avatar_data_uri || "").trim();
        if (dataUriRaw) {
          if (!dataUriRaw.startsWith("data:image/")) {
            return res.status(400).json({
              error: "avatar_data_uri_invalide",
              message: "Le fichier avatar doit être une image valide.",
            });
          }
          await setBotAvatarFromDataUri(dataUriRaw);
        } else {
          if (!/^https?:\/\//i.test(imageUrl)) {
            return res.status(400).json({
              error: "image_url_invalide",
              message: "Envoie une URL d'image valide (http/https).",
            });
          }
          const dataUri = await imageUrlToDataUri(imageUrl);
          await setBotAvatarFromDataUri(dataUri);
        }
      }

      if (hasNick) {
        const nick = String(payload.nickname || "").trim();
        if (nick.length > 32) {
          return res.status(400).json({
            error: "nickname_trop_long",
            message: "Le pseudo du bot ne peut pas dépasser 32 caractères.",
          });
        }
        await setBotNicknameInGuild(guildId, nick);
      }

      const bot = await fetchBotUser();
      const member = await discordFetchJson(
        `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(bot.id)}`
      );
      res.json({
        ok: true,
        guild_id: guildId,
        avatar_url: botAvatarUrl(bot, 512),
        nickname: member?.nick || "",
      });
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

/** Démarre le flux OAuth Discord (redirection) */
app.get("/api/auth/discord/login", (req, res) => {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) {
    return res.status(503).send("CLIENT_ID manquant dans .env");
  }
  const secret = process.env.DISCORD_CLIENT_SECRET;
  if (!secret) {
    return res.status(503).send("DISCORD_CLIENT_SECRET manquant — ajoute-le depuis le portail Discord (OAuth2).");
  }
  const redirectUri = oauthRedirectUri(req);
  console.log(
    `[oauth] login depuis ${req.headers["x-forwarded-host"] || req.headers.host} → redirect_uri=${redirectUri}`
  );
  // Si on renvoie vers 127.0.0.1 alors que l'utilisateur n'est pas en local → timeout garanti
  const hostHeader = String(
    req.headers["x-forwarded-host"] || req.headers.host || ""
  ).toLowerCase();
  if (
    /127\.0\.0\.1|localhost/.test(redirectUri) &&
    hostHeader &&
    !/127\.0\.0\.1|localhost/.test(hostHeader)
  ) {
    return res
      .status(503)
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>OAuth mal configuré</title>
<body style="font-family:system-ui;max-width:36rem;margin:3rem auto;line-height:1.5">
<h1>Connexion Discord impossible</h1>
<p>Le dashboard renvoie Discord vers <code>${redirectUri}</code> (localhost),
alors que tu es sur <strong>${hostHeader}</strong>. Ton navigateur attend une page
inaccessible → « délai dépassé ».</p>
<p><strong>À faire sur le serveur (.env) :</strong></p>
<pre style="background:#111;color:#eee;padding:1rem;border-radius:8px;white-space:pre-wrap">DASHBOARD_PUBLIC_URL=https://${hostHeader.split(":")[0]}
DASHBOARD_ALLOWED_ORIGINS=https://${hostHeader.split(":")[0]}</pre>
<p>Puis dans le <a href="https://discord.com/developers/applications">portail Discord</a>
→ OAuth2 → Redirects, ajoute exactement :</p>
<pre style="background:#111;color:#eee;padding:1rem;border-radius:8px;white-space:pre-wrap">https://${hostHeader.split(":")[0]}/api/auth/discord/callback</pre>
<p>Redémarre le dashboard (<code>docker compose up -d dashboard</code>) et réessaie.</p>
</body>`
      );
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify guilds",
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

/** Discord renvoie ici après autorisation */
app.get("/api/auth/discord/callback", async (req, res) => {
  const base = publicBaseUrlFor(req);
  const redirectUri = oauthRedirectUri(req);
  try {
    const code = req.query.code;
    const err = req.query.error;
    if (err) {
      return res.redirect(`${base}/?discord=error&reason=${encodeURIComponent(err)}`);
    }
    if (!code) {
      return res.redirect(`${base}/?discord=error`);
    }
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(503).send("OAuth non configuré (.env)");
    }
    console.log(`[oauth] callback → échange token (redirect_uri=${redirectUri})`);
    const tokenData = await fetchOAuthToken(
      code,
      redirectUri,
      clientId,
      clientSecret
    );
    const me = await fetchDiscordMe(tokenData.access_token);
    createSession(res, {
      accessToken: tokenData.access_token,
      expiresInSec: tokenData.expires_in,
      userId: me.id,
      username: me.global_name || me.username,
    });
    res.redirect(`${base}/?discord=connected`);
  } catch (e) {
    console.error("[oauth] callback failed:", e?.message || e);
    res.redirect(
      `${base}/?discord=error&reason=${encodeURIComponent(String(e.message))}`
    );
  }
});

app.post("/api/auth/discord/logout", (req, res) => {
  destroySession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** État session Discord (pour l’UI) */
app.get("/api/auth/discord/status", (req, res) => {
  const s = getSession(req);
  res.json({
    connected: !!s,
    username: s?.username || null,
  });
});

/**
 * Serveurs où tu es admin / gérant + présence du bot + lien d’invitation
 */
app.get(
  "/api/me/guilds",
  requireDiscordSession,
  async (req, res) => {
    try {
      const clientId = process.env.CLIENT_ID;
      if (!clientId) {
        return res.status(503).json({ error: "CLIENT_ID manquant" });
      }

      const cacheKey =
        req.discordSession.sessionId || req.discordSession.userId;
      const rawGuilds = await getUserGuildsCached(
        req.discordSession.accessToken,
        cacheKey
      );
      const out = await buildGuildPickerList(rawGuilds, clientId);

      res.json({
        discord_username: req.discordSession.username,
        guilds: out,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

/** Chargement initial dashboard : 1 requête au lieu de 6 + 1 appel Discord. */
app.get("/api/bootstrap", requireDiscordSession, async (req, res) => {
  try {
    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: "CLIENT_ID manquant" });
    }

    const cacheKey =
      req.discordSession.sessionId || req.discordSession.userId;
    const accessToken = req.discordSession.accessToken;

    const rawGuilds = await getUserGuildsCached(accessToken, cacheKey);
    const manageableIds = await getManageableGuildIds(accessToken, cacheKey);

    const [cacheCount, guildPicker] = await Promise.all([
      Promise.resolve(
        db.prepare("SELECT COUNT(*) AS n FROM message_cache").get()
      ),
      buildGuildPickerList(rawGuilds, clientId),
    ]);

    const rows = db
      .prepare("SELECT guild_id FROM guild_config ORDER BY updated_at DESC")
      .all();
    const configGuilds = rows
      .map((r) => normalizeSnowflakeId(r.guild_id))
      .filter((id) => manageableIds.has(id))
      .map((gid) => getGuildDashboardPayload(gid));

    res.json({
      manifest: { groups: DASHBOARD_GROUPS },
      commandManifest: { groups: COMMAND_GROUPS, commands: COMMANDS },
      config: { guilds: configGuilds },
      internalAccess: {
        founder: isFounderUser(req.discordSession.userId),
      },
      stats: { messages_en_cache: cacheCount?.n ?? 0 },
      guildPicker: {
        discord_username: req.discordSession.username,
        guilds: guildPicker,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.get("/api/manifest", requireDiscordSession, (_req, res) => {
  res.json({ groups: DASHBOARD_GROUPS });
});

app.get("/api/config", requireDiscordSession, async (req, res) => {
  try {
    const manageableIds = await getManageableGuildIds(
      req.discordSession.accessToken,
      req.discordSession.sessionId || req.discordSession.userId
    );
    const rows = db
      .prepare(
        `SELECT guild_id FROM guild_config ORDER BY updated_at DESC`
      )
      .all();

    const guilds = rows
      .map((r) => normalizeSnowflakeId(r.guild_id))
      .filter((id) => manageableIds.has(id))
      .map((gid) => getGuildDashboardPayload(gid));
    res.json({ guilds });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.get(
  "/api/guilds/:guildId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
  try {
    const guildId = req.guildId;
    const exists = db
      .prepare("SELECT 1 FROM guild_config WHERE guild_id = ?")
      .get(guildId);
    if (!exists) {
      const botIn = await botGuildExists(guildId);
      if (!botIn) {
        return res.status(404).json({
          error: "not_found",
          message: "Bot absent de ce serveur — utilise le lien d’invitation.",
        });
      }
      ensureGuildLogRow(guildId);
    }
    res.json(getGuildDashboardPayload(guildId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.put(
  "/api/guilds/:guildId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
  try {
    const guildId = req.guildId;
    const botIn = await botGuildExists(guildId);
    if (!botIn) {
      return res.status(400).json({
        error: "bot_not_in_guild",
        message: "Invite le bot sur ce serveur avant d’enregistrer la configuration.",
      });
    }
    ensureGuildLogRow(guildId);
    const patch = { ...(req.body || {}) };
    if (
      !isFounderUser(req.discordSession?.userId) &&
      patch.antispam_config &&
      typeof patch.antispam_config === "object"
    ) {
      const { test_mode, ...antispamRest } = patch.antispam_config;
      patch.antispam_config = antispamRest;
    }
    applyGuildSettingsPatch(guildId, patch);
    res.json(getGuildDashboardPayload(guildId));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message) });
  }
});

app.get(
  "/api/guilds/:guildId/warnings",
  requireDiscordSession,
  requireGuildManageAccess,
  (req, res) => {
    try {
      const guildId = req.guildId;
      const raw = String(req.query.q || req.query.user_id || "")
        .trim()
        .slice(0, 100);
      const digits = raw.replace(/\D/g, "");
      const isId = /^\d{17,20}$/.test(digits);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = listGuildWarnings(guildId, {
        userId: isId ? digits : null,
        search: !isId && raw ? raw : null,
        limit,
      });
      res.json({ warnings: rows, count: rows.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.delete(
  "/api/guilds/:guildId/warnings/user/:userId",
  requireDiscordSession,
  requireGuildManageAccess,
  (req, res) => {
    try {
      const guildId = req.guildId;
      const userId = normalizeSnowflakeId(req.params.userId);
      if (!userId) {
        return res.status(400).json({ error: "user_id invalide" });
      }
      const n = clearGuildWarningsForUser(guildId, userId);
      res.json({ ok: true, cleared: n, user_id: userId });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

/** Envoie un DM d'avertissement de démo (sans créer de warn en base). */
app.post(
  "/api/guilds/:guildId/warnings/test-dm",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const sessionUserId = normalizeSnowflakeId(req.discordSession.userId);
      if (!sessionUserId) {
        return res.status(400).json({ error: "session_invalide" });
      }
      const cfg = getWarnConfig(guildId);
      const guildName =
        String(req.body?.guild_name || "").trim() || "ce serveur";
      const reason =
        String(req.body?.reason || "").trim() ||
        "Test depuis le dashboard — aucun warn réel n'a été enregistré.";

      const embed = {
        title: "⚠️ Avertissement",
        description:
          "Un avertissement a été enregistré sur ton compte pour ce serveur.",
        color: 0xf59e0b,
        fields: [
          { name: "Serveur", value: guildName.slice(0, 256), inline: true },
          {
            name: "Total",
            value: `1/${cfg.warns_before_timeout || 3}`,
            inline: true,
          },
          { name: "Raison", value: reason.slice(0, 1024), inline: false },
          {
            name: "Prochaine étape",
            value: `À **${cfg.warns_before_timeout || 3}** avertissements actifs → sourdine automatique.`,
            inline: false,
          },
          {
            name: "Mode test",
            value: "Ceci est une **démo** — aucun warn n'a été ajouté en base.",
            inline: false,
          },
        ],
        footer: { text: "Wingbot · Modération (test)" },
        timestamp: new Date().toISOString(),
      };

      const dmChannel = await discordBotJson("POST", "/users/@me/channels", {
        recipient_id: sessionUserId,
      });
      if (!dmChannel?.id) {
        return res.status(502).json({ error: "dm_channel_invalide" });
      }
      const sent = await discordBotJson(
        "POST",
        `/channels/${encodeURIComponent(dmChannel.id)}/messages`,
        { embeds: [embed] }
      );

      const bot = await fetchBotUser().catch(() => null);
      recordDmMessage({
        user_id: sessionUserId,
        channel_id: dmChannel.id,
        message_id: sent?.id || null,
        direction: "out",
        author_id: bot?.id || null,
        author_tag: bot?.username || null,
        content: "",
        attachments: [],
        embeds: [embed],
        user_tag: req.discordSession.username || null,
        user_avatar: null,
      });

      res.json({ ok: true, message_id: sent?.id || null });
    } catch (e) {
      console.error("[warn test-dm]", e);
      const status = e?.status === 403 ? 403 : 500;
      res.status(status).json({
        error: "test_dm_failed",
        message:
          e?.status === 403
            ? "Discord refuse le DM (ouvre tes MP au bot ou partage un serveur)."
            : String(e.message || e),
      });
    }
  }
);

app.delete(
  "/api/guilds/:guildId/warnings/:warningId",
  requireDiscordSession,
  requireGuildManageAccess,
  (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.warningId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "warning_id invalide" });
      }
      const row = getGuildWarningById(guildId, id);
      if (!row) {
        return res.status(404).json({ error: "warn introuvable" });
      }
      deleteGuildWarning(guildId, id);
      res.json({ ok: true, removed_id: id, user_id: row.user_id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

const SCHED_REPEAT = new Set(["once", "daily", "weekly"]);

function normalizeScheduledPayloadInput(body) {
  const raw =
    body?.payload && typeof body.payload === "object" ? body.payload : body;
  const merged = mergeEmbedPayload(defaultEmbedPayload(), {
    content: raw?.content ?? "",
    embed: raw?.embed && typeof raw.embed === "object" ? raw.embed : {},
  });
  const e = merged.embed || {};
  const hasText = String(merged.content || "").trim().length > 0;
  const hasEmbed = !!(
    e.title ||
    e.description ||
    e.image_url ||
    e.thumbnail_url ||
    (e.fields && e.fields.length)
  );
  if (!hasText && !hasEmbed) {
    throw new Error("Contenu ou embed requis");
  }
  return { content: merged.content, embed: merged.embed };
}

function defaultSocialPayload(platform, eventKind) {
  if (platform === "twitch" && eventKind === "live") {
    return {
      content: "🔴 **{twitch.display_name}** est en live !\n{twitch.url}",
      embed: {
        title: "{twitch.title}",
        description: "{twitch.game} · {twitch.viewers} viewers",
        url: "{twitch.url}",
        thumbnail_url: "{twitch.thumbnail}",
        color: 0x9146ff,
        fields: [],
      },
    };
  }
  if (platform === "twitch" && eventKind === "clip") {
    return {
      content:
        "🎬 Nouveau clip — **{twitch.clip.title}**\n{twitch.clip.url}",
      embed: {
        title: "{twitch.clip.title}",
        description: "Par {twitch.clip.creator} · {twitch.display_name}",
        url: "{twitch.clip.url}",
        thumbnail_url: "{twitch.clip.thumbnail}",
        color: 0x9146ff,
        fields: [],
      },
    };
  }
  return {
    content: "🎬 **{youtube.title}**\n{youtube.url}",
    embed: {
      title: "{youtube.title}",
      description: "Nouvelle vidéo de {youtube.channel}",
      url: "{youtube.url}",
      thumbnail_url: "{youtube.thumbnail}",
      color: 0xff0000,
      fields: [],
    },
  };
}

function normalizeSocialPayloadInput(body, platform = "youtube", eventKind = "video") {
  const raw =
    body?.payload && typeof body.payload === "object" ? body.payload : body;
  let merged = mergeEmbedPayload(defaultEmbedPayload(), {
    content: raw?.content ?? "",
    embed: raw?.embed && typeof raw.embed === "object" ? raw.embed : {},
  });
  const e = merged.embed || {};
  const hasText = String(merged.content || "").trim().length > 0;
  const hasEmbed = !!(
    e.title ||
    e.description ||
    e.url ||
    e.image_url ||
    e.thumbnail_url ||
    (e.fields && e.fields.length)
  );
  if (!hasText && !hasEmbed) {
    merged = mergeEmbedPayload(
      defaultEmbedPayload(),
      defaultSocialPayload(platform, eventKind)
    );
  }
  return { content: merged.content, embed: merged.embed };
}

function parseSocialFeedCreateInput(body) {
  const alertType = String(body?.alert_type || body?.type || "youtube-video");
  if (alertType === "twitch-live") {
    return { platform: "twitch", event_kind: "live" };
  }
  if (alertType === "twitch-clip") {
    return { platform: "twitch", event_kind: "clip" };
  }
  if (body?.platform === "twitch") {
    const kind = body?.event_kind === "clip" ? "clip" : "live";
    return { platform: "twitch", event_kind: kind };
  }
  return { platform: "youtube", event_kind: "video" };
}

function socialFeedDuplicate(guildId, platform, sourceId, eventKind) {
  return listSocialFeeds(guildId).find(
    (f) =>
      f.platform === platform &&
      f.source_id === sourceId &&
      f.event_kind === eventKind
  );
}

function parseSendAtInput(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Date/heure invalide");
  }
  return d.toISOString();
}

async function assertGuildTextChannel(guildId, channelId) {
  const allowedTypes = new Set([0, 5, 10, 11, 12]);
  const chMeta = await discordFetchJson(
    `/channels/${encodeURIComponent(channelId)}`
  );
  if (!chMeta || normalizeSnowflakeId(chMeta.guild_id) !== guildId) {
    const err = new Error("Salon invalide pour ce serveur");
    err.status = 400;
    throw err;
  }
  if (!allowedTypes.has(chMeta.type)) {
    const err = new Error("Salon texte, annonce ou fil requis");
    err.status = 400;
    throw err;
  }
  return chMeta;
}

app.get(
  "/api/guilds/:guildId/scheduled-messages",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      res.json({ scheduled: listScheduledMessages(guildId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/scheduled-messages",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      const channelId = normalizeSnowflakeId(req.body?.channel_id);
      if (!channelId) {
        return res.status(400).json({ error: "channel_id requis" });
      }
      await assertGuildTextChannel(guildId, channelId);
      const payload = normalizeScheduledPayloadInput(req.body);
      const sendAt = parseSendAtInput(req.body?.send_at);
      const repeat = SCHED_REPEAT.has(req.body?.repeat)
        ? req.body.repeat
        : "once";
      const row = insertScheduledMessage(guildId, {
        channel_id: channelId,
        label: req.body?.label || "",
        payload,
        send_at: sendAt,
        repeat,
        enabled: req.body?.enabled !== false,
        created_by: req.discordSession?.userId || null,
      });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(e.status || 400).json({ error: String(e.message) });
    }
  }
);

app.put(
  "/api/guilds/:guildId/scheduled-messages/:schedId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.schedId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      if (!getScheduledMessage(id, guildId)) {
        return res.status(404).json({ error: "not_found" });
      }
      const patch = {};
      if (req.body?.channel_id != null) {
        const channelId = normalizeSnowflakeId(req.body.channel_id);
        if (!channelId) {
          return res.status(400).json({ error: "channel_id invalide" });
        }
        await assertGuildTextChannel(guildId, channelId);
        patch.channel_id = channelId;
      }
      if (req.body?.label != null) patch.label = req.body.label;
      if (req.body?.send_at != null) patch.send_at = parseSendAtInput(req.body.send_at);
      if (req.body?.repeat != null) {
        if (!SCHED_REPEAT.has(req.body.repeat)) {
          return res.status(400).json({ error: "repeat invalide" });
        }
        patch.repeat = req.body.repeat;
      }
      if (req.body?.enabled != null) patch.enabled = !!req.body.enabled;
      if (req.body?.payload != null || req.body?.content != null) {
        patch.payload = normalizeScheduledPayloadInput(req.body);
      }
      const row = updateScheduledMessage(id, guildId, patch);
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(e.status || 400).json({ error: String(e.message) });
    }
  }
);

app.delete(
  "/api/guilds/:guildId/scheduled-messages/:schedId",
  requireDiscordSession,
  requireGuildManageAccess,
  (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.schedId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      if (!deleteScheduledMessage(id, guildId)) {
        return res.status(404).json({ error: "not_found" });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

function normalizeReactionEntriesInput(raw) {
  if (!Array.isArray(raw)) throw new Error("entries doit être un tableau");
  const out = [];
  const seenEmoji = new Set();
  const seenRole = new Set();
  for (const e of raw) {
    const emoji = parseEmojiInput(e?.emoji);
    const role_id = normalizeSnowflakeId(e?.role_id);
    if (!emoji || !role_id) continue;
    if (seenEmoji.has(emoji) || seenRole.has(role_id)) continue;
    seenEmoji.add(emoji);
    seenRole.add(role_id);
    out.push({ emoji, role_id });
    if (out.length >= 20) break;
  }
  if (!out.length) {
    throw new Error("Au moins une paire emoji → rôle valide requise");
  }
  return out;
}

function buildReactionRoleMessageBody(body, ctx = null) {
  let merged = mergeEmbedPayload(defaultEmbedPayload(), {
    content: body?.content ?? "",
    embed: body?.embed && typeof body.embed === "object" ? body.embed : {},
  });
  if (ctx) merged = substituteEmbedPayload(merged, ctx);
  const e = merged.embed || {};
  const hasText = String(merged.content || "").trim().length > 0;
  const hasEmbed = !!(
    e.title ||
    e.description ||
    e.image_url ||
    e.thumbnail_url ||
    (e.fields && e.fields.length)
  );
  if (!hasText && !hasEmbed) {
    throw new Error("Contenu ou embed requis pour le message");
  }
  return payloadToDiscordMessageBody(merged);
}

async function discordAddReaction(channelId, messageId, emojiKey) {
  const path = `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${emojiKeyToApiPath(emojiKey)}/@me`;
  await discordBotJson("PUT", path);
}

async function publishReactionRoleMessage(guildId, channelId, body, entries) {
  const chMeta = await assertGuildTextChannel(guildId, channelId);
  const guildMeta = await discordFetchJson(
    `/guilds/${encodeURIComponent(guildId)}?with_counts=true`
  ).catch(() => null);
  const apiBody = buildReactionRoleMessageBody(body, {
    guild: {
      id: guildId,
      name: guildMeta?.name || "",
      member_count: guildMeta?.approximate_member_count,
    },
    channel: { id: chMeta.id, name: chMeta.name },
  });
  const msg = await discordBotJson(
    "POST",
    `/channels/${encodeURIComponent(channelId)}/messages`,
    apiBody
  );
  const messageId = String(msg.id);
  for (const entry of entries) {
    await discordAddReaction(channelId, messageId, entry.emoji);
    await new Promise((r) => setTimeout(r, 350));
  }
  return messageId;
}

async function attachReactionRoleToExistingMessage(
  guildId,
  channelId,
  messageId,
  entries
) {
  await assertGuildTextChannel(guildId, channelId);
  if (reactionRolePanelExistsForMessage(guildId, messageId)) {
    const err = new Error("Ce message a déjà un panneau réactions rôles");
    err.status = 409;
    throw err;
  }
  let msg;
  try {
    msg = await discordFetchJson(
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`
    );
  } catch (e) {
    if (e.status === 404) {
      const err = new Error(
        "Message introuvable dans ce salon (vérifie l'ID, le salon ou les permissions du bot)"
      );
      err.status = 404;
      throw err;
    }
    throw e;
  }
  for (const entry of entries) {
    await discordAddReaction(channelId, messageId, entry.emoji);
    await new Promise((r) => setTimeout(r, 350));
  }
  const contentSnapshot = String(msg.content || "").trim();
  let embedSnapshot = null;
  if (msg.embeds?.length) {
    const emb = msg.embeds[0];
    embedSnapshot = {
      title: emb.title || "",
      description: emb.description || "",
      color: emb.color ?? null,
      fields: [],
    };
  }
  return {
    messageId: String(messageId),
    content: contentSnapshot,
    embed: embedSnapshot,
  };
}

app.get(
  "/api/guilds/:guildId/reaction-roles",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      res.json({ panels: listReactionRolePanels(guildId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/reaction-roles",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      const channelId = normalizeSnowflakeId(req.body?.channel_id);
      if (!channelId) {
        return res.status(400).json({ error: "channel_id requis" });
      }
      const entries = normalizeReactionEntriesInput(req.body?.entries);
      const mode = req.body?.mode === "unique" ? "unique" : "normal";
      const existingMessageId = normalizeSnowflakeId(req.body?.message_id);
      let messageId;
      let content = String(req.body?.content || "");
      let embed =
        req.body?.embed && typeof req.body.embed === "object"
          ? req.body.embed
          : null;

      if (existingMessageId) {
        const attached = await attachReactionRoleToExistingMessage(
          guildId,
          channelId,
          existingMessageId,
          entries
        );
        messageId = attached.messageId;
        content = attached.content;
        embed = attached.embed;
      } else {
        messageId = await publishReactionRoleMessage(
          guildId,
          channelId,
          { content: req.body?.content, embed },
          entries
        );
      }

      const row = insertReactionRolePanel(guildId, {
        channel_id: channelId,
        message_id: messageId,
        label: req.body?.label || "",
        content,
        embed,
        mode,
        entries,
        enabled: true,
      });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(e.status || 400).json({ error: String(e.message) });
    }
  }
);

app.put(
  "/api/guilds/:guildId/reaction-roles/:panelId",
  requireDiscordSession,
  requireGuildManageAccess,
  (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.panelId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      if (!getReactionRolePanel(id, guildId)) {
        return res.status(404).json({ error: "not_found" });
      }
      const patch = {};
      if (req.body?.label != null) patch.label = req.body.label;
      if (req.body?.enabled != null) patch.enabled = !!req.body.enabled;
      if (req.body?.mode != null) {
        patch.mode = req.body.mode === "unique" ? "unique" : "normal";
      }
      const row = updateReactionRolePanel(id, guildId, patch);
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

app.delete(
  "/api/guilds/:guildId/reaction-roles/:panelId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.panelId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      const row = getReactionRolePanel(id, guildId);
      if (!row) return res.status(404).json({ error: "not_found" });
      if (req.query.delete_message === "1" && row.channel_id && row.message_id) {
        await discordDeleteMessage(row.channel_id, row.message_id);
      }
      deleteReactionRolePanel(id, guildId);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

function normalizeTicketCategoriesInput(raw) {
  const cats = parseCategories(
    Array.isArray(raw) ? JSON.stringify(raw) : raw || "[]"
  );
  if (!cats.length) {
    throw new Error("Au moins une catégorie (label + emoji) requise");
  }
  return cats;
}

async function publishTicketPanelMessage(panel) {
  await assertGuildTextChannel(panel.guild_id, panel.channel_id);
  const apiBody = buildReactionRoleMessageBody({
    content: panel.content,
    embed: panel.embed,
  });
  apiBody.components = buildPanelComponents(panel);
  const msg = await discordBotJson(
    "POST",
    `/channels/${encodeURIComponent(panel.channel_id)}/messages`,
    apiBody
  );
  return String(msg.id);
}

async function syncTicketPanelMessage(panel) {
  await assertGuildTextChannel(panel.guild_id, panel.channel_id);
  const apiBody = buildReactionRoleMessageBody({
    content: panel.content,
    embed: panel.embed,
  });
  apiBody.components = buildPanelComponents(panel);
  if (panel.message_id) {
    try {
      await discordBotJson(
        "PATCH",
        `/channels/${encodeURIComponent(panel.channel_id)}/messages/${encodeURIComponent(panel.message_id)}`,
        apiBody
      );
      return String(panel.message_id);
    } catch {
      /* message supprimé ou salon changé → republier */
    }
  }
  return publishTicketPanelMessage(panel);
}

function buildTicketPanelPatch(body) {
  const patch = {};
  if (body?.label != null) patch.label = body.label;
  if (body?.enabled != null) patch.enabled = !!body.enabled;
  if (body?.settings != null) patch.settings = body.settings;
  if (body?.categories != null) patch.categories = body.categories;
  if (body?.content != null) patch.content = body.content;
  if (body?.embed !== undefined) patch.embed = body.embed;
  const channelId = normalizeSnowflakeId(body?.channel_id);
  if (channelId) patch.channel_id = channelId;
  const ticketCat = normalizeSnowflakeId(body?.ticket_category_id);
  if (ticketCat) patch.ticket_category_id = ticketCat;
  if (body?.log_channel_id !== undefined) {
    patch.log_channel_id = normalizeSnowflakeId(body.log_channel_id) || null;
  }
  if (body?.support_role_ids != null) {
    patch.support_role_ids = parseSupportRoleIds(body.support_role_ids);
  }
  if (body?.ui_mode === "select" || body?.ui_mode === "buttons") {
    patch.ui_mode = body.ui_mode;
  }
  if (body?.max_open_per_user != null) {
    patch.max_open_per_user = Number(body.max_open_per_user) || 1;
  }
  return patch;
}

app.get(
  "/api/guilds/:guildId/ticket-panels/:panelId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.panelId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      const row = getTicketPanel(id, guildId);
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/ticket-panels/:panelId/clone",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.panelId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      const row = cloneTicketPanel(id, guildId);
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/ticket-panels/:panelId/send",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.panelId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      let panel = getTicketPanel(id, guildId);
      if (!panel) return res.status(404).json({ error: "not_found" });
      const patch = buildTicketPanelPatch(req.body || {});
      if (Object.keys(patch).length) {
        panel = updateTicketPanel(id, guildId, patch) || panel;
      }
      const messageId = await syncTicketPanelMessage(panel);
      panel = updateTicketPanel(id, guildId, {
        message_id: messageId,
        enabled: true,
      });
      res.json(panel);
    } catch (e) {
      console.error(e);
      res.status(e.status || 400).json({ error: String(e.message) });
    }
  }
);

app.get(
  "/api/guilds/:guildId/ticket-panels",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      res.json({ panels: listTicketPanels(guildId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.get(
  "/api/guilds/:guildId/tickets",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      const status =
        req.query.status === "open" || req.query.status === "closed"
          ? req.query.status
          : null;
      res.json({ tickets: listTickets(guildId, { status, limit: 150 }) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/ticket-panels",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      const channelId = normalizeSnowflakeId(req.body?.channel_id);
      const ticketCategoryId = normalizeSnowflakeId(
        req.body?.ticket_category_id
      );
      if (!channelId) {
        return res.status(400).json({ error: "channel_id requis" });
      }
      if (!ticketCategoryId) {
        return res.status(400).json({ error: "ticket_category_id requis" });
      }
      const categories = normalizeTicketCategoriesInput(req.body?.categories);
      const support_role_ids = parseSupportRoleIds(req.body?.support_role_ids);
      const settings = parsePanelSettings(req.body?.settings || {});
      const content =
        String(req.body?.content || "").trim() || defaultPanelContent();
      const embed =
        req.body?.embed && typeof req.body.embed === "object"
          ? req.body.embed
          : null;
      const uiMode =
        req.body?.ui_mode === "select" || categories.length > 25
          ? "select"
          : "buttons";

      let panel = insertTicketPanel(guildId, {
        channel_id: channelId,
        ticket_category_id: ticketCategoryId,
        log_channel_id: normalizeSnowflakeId(req.body?.log_channel_id) || null,
        support_role_ids,
        categories,
        settings,
        label: req.body?.label || "",
        content,
        embed,
        ui_mode: uiMode,
        max_open_per_user: Number(req.body?.max_open_per_user) || 1,
        enabled: false,
      });

      res.json(panel);
    } catch (e) {
      console.error(e);
      res.status(e.status || 400).json({ error: String(e.message) });
    }
  }
);

app.put(
  "/api/guilds/:guildId/ticket-panels/:panelId",
  requireDiscordSession,
  requireGuildManageAccess,
  (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.panelId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      if (!getTicketPanel(id, guildId)) {
        return res.status(404).json({ error: "not_found" });
      }
      const patch = buildTicketPanelPatch(req.body || {});
      if (req.body?.enabled != null) patch.enabled = !!req.body.enabled;
      const row = updateTicketPanel(id, guildId, patch);
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

app.delete(
  "/api/guilds/:guildId/ticket-panels/:panelId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.panelId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      const row = getTicketPanel(id, guildId);
      if (!row) return res.status(404).json({ error: "not_found" });
      if (req.query.delete_message === "1" && row.channel_id && row.message_id) {
        await discordDeleteMessage(row.channel_id, row.message_id);
      }
      deleteTicketPanel(id, guildId);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.get(
  "/api/guilds/:guildId/social-feeds",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      res.json({ feeds: listSocialFeeds(guildId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/social-feeds/preview-youtube",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const source = String(req.body?.source || "").trim();
      if (!source) {
        return res.status(400).json({ error: "source requis (URL ou ID chaîne YouTube)" });
      }
      const preview = await resolveAndPreviewYoutubeChannel(source);
      res.json(preview);
    } catch (e) {
      console.error(e);
      res.status(e.status || 400).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/social-feeds/preview-twitch",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const source = String(req.body?.source || "").trim();
      const kind = req.body?.kind === "clip" ? "clip" : "live";
      if (!source) {
        return res.status(400).json({ error: "source requis (URL ou pseudo Twitch)" });
      }
      const preview = await resolveAndPreviewTwitchChannel(source, kind);
      res.json(preview);
    } catch (e) {
      console.error(e);
      if (e.code === "NO_TWITCH_CREDS") {
        return res.status(503).json({ error: String(e.message) });
      }
      res.status(e.status || 400).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/social-feeds",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      const { platform, event_kind: eventKind } = parseSocialFeedCreateInput(
        req.body
      );
      const channelId = normalizeSnowflakeId(req.body?.channel_id);
      if (!channelId) {
        return res.status(400).json({ error: "channel_id requis" });
      }
      await assertGuildTextChannel(guildId, channelId);
      const source = String(req.body?.source || "").trim();
      if (!source) {
        return res.status(400).json({ error: "source requis" });
      }

      let insertData;
      if (platform === "twitch") {
        const preview = await resolveAndPreviewTwitchChannel(source, eventKind);
        const dup = socialFeedDuplicate(
          guildId,
          "twitch",
          preview.broadcaster_id,
          eventKind
        );
        if (dup) {
          const label =
            eventKind === "clip" ? "alerte clips" : "alerte live";
          return res.status(409).json({
            error: `Cette chaîne Twitch a déjà une ${label} sur ce serveur`,
          });
        }
        const payload = normalizeSocialPayloadInput(req.body, "twitch", eventKind);
        insertData = {
          channel_id: channelId,
          platform: "twitch",
          event_kind: eventKind,
          source_id: preview.broadcaster_id,
          source_label:
            String(req.body?.label || "").trim() ||
            preview.display_name ||
            preview.login,
          source_url: preview.channel_url,
          payload,
          enabled: req.body?.enabled !== false,
          last_state:
            eventKind === "live"
              ? preview.is_live
                ? "online"
                : "offline"
              : null,
          last_video_id: null,
        };
      } else {
        const preview = await resolveAndPreviewYoutubeChannel(source);
        const dup = socialFeedDuplicate(
          guildId,
          "youtube",
          preview.channel_id,
          "video"
        );
        if (dup) {
          return res.status(409).json({
            error: "Cette chaîne YouTube est déjà suivie sur ce serveur",
          });
        }
        const payload = normalizeSocialPayloadInput(req.body, "youtube", "video");
        insertData = {
          channel_id: channelId,
          platform: "youtube",
          event_kind: "video",
          source_id: preview.channel_id,
          source_label:
            String(req.body?.label || "").trim() || preview.channel_name || "",
          source_url: preview.channel_url,
          payload,
          enabled: req.body?.enabled !== false,
          last_video_id: preview.latest_video?.id || null,
        };
      }

      const row = insertSocialFeed(guildId, insertData);
      res.json(row);
    } catch (e) {
      console.error(e);
      if (e.code === "NO_TWITCH_CREDS") {
        return res.status(503).json({ error: String(e.message) });
      }
      res.status(e.status || 400).json({ error: String(e.message) });
    }
  }
);

app.put(
  "/api/guilds/:guildId/social-feeds/:feedId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.feedId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      const cur = getSocialFeed(id, guildId);
      if (!cur) return res.status(404).json({ error: "not_found" });
      const patch = {};
      if (req.body?.label != null) patch.source_label = req.body.label;
      if (req.body?.enabled != null) patch.enabled = !!req.body.enabled;
      if (req.body?.channel_id != null) {
        const channelId = normalizeSnowflakeId(req.body.channel_id);
        if (!channelId) {
          return res.status(400).json({ error: "channel_id invalide" });
        }
        await assertGuildTextChannel(guildId, channelId);
        patch.channel_id = channelId;
      }
      if (req.body?.payload != null || req.body?.content != null) {
        patch.payload = normalizeSocialPayloadInput(
          req.body,
          cur.platform,
          cur.event_kind
        );
      }
      const row = updateSocialFeed(id, guildId, patch);
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(e.status || 400).json({ error: String(e.message) });
    }
  }
);

app.delete(
  "/api/guilds/:guildId/social-feeds/:feedId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.feedId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "id invalide" });
      }
      if (!getSocialFeed(id, guildId)) {
        return res.status(404).json({ error: "not_found" });
      }
      deleteSocialFeed(id, guildId);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.get("/api/commands-manifest", requireDiscordSession, (_req, res) => {
  res.json({ groups: COMMAND_GROUPS, commands: COMMANDS });
});

app.get("/api/stats", requireDiscordSession, (_req, res) => {
  try {
    const cacheCount = db
      .prepare("SELECT COUNT(*) AS n FROM message_cache")
      .get();
    res.json({ messages_en_cache: cacheCount?.n ?? 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.get(
  "/api/discord/guilds/:guildId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
  try {
    const guildId = req.guildId;
    const botIn = await botGuildExists(guildId);
    if (!botIn) {
      return res.status(404).json({ error: "Bot non présent sur ce serveur" });
    }
    ensureGuildLogRow(guildId);
    const g = await discordFetchJson(`/guilds/${encodeURIComponent(guildId)}`);
    res.json({
      id: g.id,
      name: g.name,
      icon_url: guildIconUrlBot(g.id, g.icon),
    });
  } catch (e) {
    if (e.code === "NO_BOT_TOKEN") {
      return res.status(503).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.get(
  "/api/discord/guilds/:guildId/channels",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
  try {
    const guildId = req.guildId;
    const botIn = await botGuildExists(guildId);
    if (!botIn) {
      return res.status(404).json({ error: "Bot non présent sur ce serveur" });
    }
    ensureGuildLogRow(guildId);
    const cacheKey = `${guildId}:channels`;
    const cached = getGuildDiscordListCache(cacheKey);
    if (cached) {
      if (cached.channels) {
        return res.json({
          channels: cached.channels,
          categories: cached.categories || [],
        });
      }
      return res.json({ channels: cached, categories: [] });
    }
    const channels = await discordFetchJson(
      `/guilds/${encodeURIComponent(guildId)}/channels`
    );
    const formatted = formatChannelsForUi(channels);
    const categories = channels
      .filter((c) => c.type === 4)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => ({ id: c.id, name: c.name }));
    setGuildDiscordListCache(cacheKey, { channels: formatted, categories });
    res.json({ channels: formatted, categories });
  } catch (e) {
    if (e.code === "NO_BOT_TOKEN") {
      return res.status(503).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.get(
  "/api/discord/guilds/:guildId/roles",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const botIn = await botGuildExists(guildId);
      if (!botIn) {
        return res.status(404).json({ error: "Bot non présent sur ce serveur" });
      }
      ensureGuildLogRow(guildId);
      const cacheKey = `${guildId}:roles`;
      const cached = getGuildDiscordListCache(cacheKey);
      if (cached) {
        return res.json({ roles: cached });
      }
      const roles = await discordFetchJson(
        `/guilds/${encodeURIComponent(guildId)}/roles`
      );
      const formatted = formatRolesForUi(roles);
      setGuildDiscordListCache(cacheKey, formatted);
      res.json({ roles: formatted });
    } catch (e) {
      if (e.code === "NO_BOT_TOKEN") {
        return res.status(503).json({ error: e.message });
      }
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.get(
  "/api/guilds/:guildId/embeds",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({
          error: "bot_not_in_guild",
          message: "Invite le bot sur ce serveur.",
        });
      }
      ensureGuildLogRow(guildId);
      res.json({ embeds: listGuildEmbeds(guildId) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.get(
  "/api/guilds/:guildId/embeds/:embedId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.embedId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "embed_id_invalide" });
      }
      const row = getGuildEmbedRow(id, guildId);
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/embeds",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      ensureGuildLogRow(guildId);
      const name = req.body?.name;
      const payload = mergeEmbedPayload(
        defaultEmbedPayload(),
        req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {}
      );
      const row = insertGuildEmbed(guildId, name, payload);
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

app.put(
  "/api/guilds/:guildId/embeds/:embedId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.embedId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "embed_id_invalide" });
      }
      const cur = getGuildEmbedRow(id, guildId);
      if (!cur) return res.status(404).json({ error: "not_found" });
      const merged = mergeEmbedPayload(
        cur.payload,
        req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {}
      );
      const patch = { payload: merged };
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
        patch.name = req.body.name;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "channel_id")) {
        patch.channel_id = req.body.channel_id;
      }
      const row = updateGuildEmbed(id, guildId, patch);
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

app.delete(
  "/api/guilds/:guildId/embeds/:embedId",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.embedId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "embed_id_invalide" });
      }
      const row = getGuildEmbedRow(id, guildId);
      if (!row) return res.status(404).json({ error: "not_found" });
      if (req.query.delete_discord_message === "1" && row.channel_id && row.message_id) {
        await discordDeleteMessage(row.channel_id, row.message_id);
      }
      deleteGuildEmbed(id, guildId);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

app.post(
  "/api/guilds/:guildId/embeds/:embedId/send",
  requireDiscordSession,
  requireGuildManageAccess,
  async (req, res) => {
    try {
      const guildId = req.guildId;
      const id = Number(req.params.embedId);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "embed_id_invalide" });
      }
      if (!(await botGuildExists(guildId))) {
        return res.status(400).json({ error: "bot_not_in_guild" });
      }
      let row = getGuildEmbedRow(id, guildId);
      if (!row) return res.status(404).json({ error: "not_found" });

      if (req.body?.payload && typeof req.body.payload === "object") {
        const merged = mergeEmbedPayload(row.payload, req.body.payload);
        row = updateGuildEmbed(id, guildId, { payload: merged });
      }

      const allowedTypes = new Set([0, 5, 10, 11, 12]);
      let chMeta = null;
      let channelIdForSend = null;

      if (!row.message_id) {
        const chRaw = req.body?.channel_id || row.channel_id;
        const channelId = normalizeSnowflakeId(chRaw);
        if (!channelId) {
          return res.status(400).json({
            error: "channel_required",
            message: "Choisis un salon pour la première publication.",
          });
        }
        chMeta = await discordFetchJson(
          `/channels/${encodeURIComponent(channelId)}`
        );
        if (!chMeta || normalizeSnowflakeId(chMeta.guild_id) !== guildId) {
          return res.status(400).json({ error: "salon_invalide" });
        }
        if (!allowedTypes.has(chMeta.type)) {
          return res.status(400).json({
            error: "wrong_channel_type",
            message: "Salon texte, annonce ou fil requis.",
          });
        }
        channelIdForSend = channelId;
      } else {
        const chId = normalizeSnowflakeId(row.channel_id);
        const msgId = normalizeSnowflakeId(row.message_id);
        if (!chId || !msgId) {
          return res.status(400).json({ error: "message_inconnu" });
        }
        chMeta = await discordFetchJson(
          `/channels/${encodeURIComponent(chId)}`
        );
        if (!chMeta || normalizeSnowflakeId(chMeta.guild_id) !== guildId) {
          return res.status(400).json({ error: "salon_invalide" });
        }
        channelIdForSend = chId;
      }

      const guildMeta = await discordFetchJson(
        `/guilds/${encodeURIComponent(guildId)}?with_counts=true`
      ).catch(() => null);
      const substituted = substituteEmbedPayload(row.payload, {
        guild: {
          id: guildId,
          name: guildMeta?.name,
          member_count: guildMeta?.approximate_member_count,
        },
        channel: { id: chMeta?.id, name: chMeta?.name },
      });
      const apiBody = payloadToDiscordMessageBody(substituted);

      if (!row.message_id) {
        const msg = await discordBotJson(
          "POST",
          `/channels/${encodeURIComponent(channelIdForSend)}/messages`,
          apiBody
        );
        row = updateGuildEmbed(id, guildId, {
          channel_id: channelIdForSend,
          message_id: String(msg.id),
        });
        return res.json(row);
      }

      const msgId = normalizeSnowflakeId(row.message_id);
      await discordBotJson(
        "PATCH",
        `/channels/${encodeURIComponent(channelIdForSend)}/messages/${encodeURIComponent(msgId)}`,
        apiBody
      );
      res.json(getGuildEmbedRow(id, guildId));
    } catch (e) {
      if (e.code === "NO_BOT_TOKEN") {
        return res.status(503).json({ error: e.message });
      }
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

// ============================================================
// Admin Premium par SERVEUR (founder-only)
// ============================================================
//
// Endpoints :
//   GET    /api/admin/guild-premium           → liste des serveurs premium
//          (avec metadata Discord : nom, icone, owner) si dispo via le bot
//   POST   /api/admin/guild-premium           → activer/mettre à jour
//          { guild_id, source: 'paid'|'gift', expires_at?, notes? }
//   DELETE /api/admin/guild-premium/:guildId  → désactiver

app.get(
  "/api/admin/guild-premium",
  requireDiscordSession,
  requireFounder,
  async (_req, res) => {
    const rows = listPremiumGuilds();
    // On enrichit avec les noms/icones des serveurs où le bot est présent.
    const enriched = await Promise.all(
      rows.map(async (r) => {
        let meta = null;
        try {
          meta = await discordFetchJson(
            `/guilds/${encodeURIComponent(r.guild_id)}`
          ).catch(() => null);
        } catch {
          /* bot pas dans ce serveur, on retourne juste l'id */
        }
        return {
          ...r,
          name: meta?.name || null,
          icon_url: meta?.icon
            ? `https://cdn.discordapp.com/icons/${r.guild_id}/${meta.icon}.png?size=64`
            : null,
          owner_id: meta?.owner_id || null,
        };
      })
    );
    res.json({ guilds: enriched });
  }
);

app.post(
  "/api/admin/guild-premium",
  requireDiscordSession,
  requireFounder,
  (req, res) => {
    try {
      const { guild_id, source, expires_at, notes } = req.body || {};
      const id = premiumGate.normalizeSnowflakeId(guild_id);
      if (!id) return res.status(400).json({ error: "guild_id invalide" });
      if (!["paid", "gift"].includes(source)) {
        return res
          .status(400)
          .json({ error: "source invalide (attendu : 'paid' | 'gift')" });
      }
      const row = upsertPremiumGuild({
        guild_id: id,
        source,
        granted_by: req.discordSession.userId,
        expires_at: expires_at || null,
        notes: notes ? String(notes).slice(0, 300) : null,
      });
      res.json({ guild: row });
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

app.delete(
  "/api/admin/guild-premium/:guildId",
  requireDiscordSession,
  requireFounder,
  (req, res) => {
    const id = premiumGate.normalizeSnowflakeId(req.params.guildId);
    if (!id) return res.status(400).json({ error: "guild_id invalide" });
    const changes = deletePremiumGuild(id);
    res.json({ ok: !!changes });
  }
);

// Liste des backups de l'utilisateur courant (pour un futur onglet Backups dans le dashboard)
app.get(
  "/api/me/backups",
  requireDiscordSession,
  (req, res) => {
    const rows = listUserBackups(req.discordSession.userId, 50);
    res.json({ backups: rows });
  }
);

// Static avec cache-busting : on force la revalidation à chaque chargement pour
// les assets fréquemment modifiés (html/js/css). Sinon le navigateur garde
// l'ancienne version après un redéploiement et l'utilisateur voit "rien n'a
// changé".
app.get("/transcripts/:guildId/:ticketId/:token.html", (req, res) => {
  try {
    const { readTranscriptFile } = require("../lib/ticketTranscript");
    const guildId = String(req.params.guildId || "");
    const ticketId = Number(req.params.ticketId);
    const token = String(req.params.token || "").replace(/[^\w-]/g, "");
    if (!guildId || !Number.isInteger(ticketId) || ticketId < 1 || !token) {
      return res.status(400).send("Requête invalide");
    }
    const html = readTranscriptFile(guildId, ticketId, token);
    if (!html) return res.status(404).send("Transcript introuvable");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(html);
  } catch (e) {
    console.error("[transcript]", e?.message || e);
    res.status(500).send("Erreur serveur");
  }
});

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (/\.js$/i.test(filePath)) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      } else if (/\.css$/i.test(filePath)) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      }
      if (/\.(js|css)$/i.test(filePath)) {
        res.setHeader(
          "Cache-Control",
          "public, max-age=600, stale-while-revalidate=86400"
        );
      } else if (/\.html$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      } else if (/\.svg$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    },
  })
);

app.listen(PORT, HOST, () => {
  console.log(`📊 Dashboard Wingbot : ${publicBaseUrl()}/`);
  console.log(`   Écoute réseau : http://${HOST}:${PORT}`);
  console.log(
    `   OAuth redirect à déclarer sur Discord : ${oauthRedirectUri()}`
  );
  if (!process.env.DISCORD_CLIENT_SECRET) {
    console.warn(
      "⚠️  DISCORD_CLIENT_SECRET manquant — connexion « Mes serveurs » désactivée."
    );
  }
});
