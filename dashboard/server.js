/**
 * Dashboard HTTP : lit/écrit wingbot.db + OAuth Discord (liste des serveurs admin).
 *
 * .env :
 *   TOKEN (bot), CLIENT_ID
 *   DISCORD_CLIENT_SECRET — secret OAuth2 (Discord Developer Portal)
 *   DASHBOARD_PUBLIC_URL — ex. http://127.0.0.1:3847 (URL exacte du dashboard)
 *   DASHBOARD_HOST — optionnel, IP d'écoute HTTP (défaut : 0.0.0.0)
 *   BOT_INVITE_PERMISSIONS — optionnel, entier permissions (défaut : 268438528)
 */
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
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
  upsertPremiumUser,
  deletePremiumUser,
  listUserBackups,
} = require("../database");
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
} = require("./discordAuth");

initDatabase();

const app = express();
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

// Couche premium unifiée : lit l'env + la table premium_users.
// La source de vérité unique est ./premiumGate.js, y compris pour le bot et les commandes slash.
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

function isPremiumUser(userId) {
  return premiumGate.atLeast(userId, "premium");
}

function canUseFeature(userId, featureKey) {
  if (isFounderUser(userId)) return true;
  return premiumGate.canUseFeature(userId, featureKey);
}

function publicBaseUrl() {
  const u = process.env.DASHBOARD_PUBLIC_URL || `http://localhost:${PORT}`;
  return u.replace(/\/$/, "");
}

function oauthRedirectUri() {
  return `${publicBaseUrl()}/api/auth/discord/callback`;
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
  const botToken = (process.env.TOKEN || "").trim();
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

const LOGGABLE_CHANNEL_TYPES = new Set([0, 5, 15]);

function formatChannelsForUi(channels) {
  const list = channels.filter((c) => LOGGABLE_CHANNEL_TYPES.has(c.type));
  const categories = channels
    .filter((c) => c.type === 4)
    .sort((a, b) => a.position - b.position);

  const out = [];
  const seen = new Set();

  for (const cat of categories) {
    const kids = list
      .filter((c) => c.parent_id === cat.id)
      .sort((a, b) => a.position - b.position);
    for (const k of kids) {
      out.push({
        id: k.id,
        name: k.name,
        category: cat.name,
      });
      seen.add(k.id);
    }
  }

  const orphans = list
    .filter((c) => !c.parent_id && !seen.has(c.id))
    .sort((a, b) => a.position - b.position);
  for (const o of orphans) {
    out.push({ id: o.id, name: o.name, category: null });
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
// Clé = sessionId, TTL court pour rester frais.
const manageableGuildIdsCache = new Map();
const MANAGEABLE_CACHE_TTL_MS = 15000;

async function getManageableGuildIds(accessToken, cacheKey = "") {
  const now = Date.now();
  if (cacheKey) {
    const hit = manageableGuildIdsCache.get(cacheKey);
    if (hit && hit.expiresAt > now) return hit.ids;
  }

  const rawGuilds = await fetchUserGuilds(accessToken);
  const manageable = rawGuilds.filter((g) => canManageGuild(g));
  const ids = new Set(
    manageable
      .map((g) => normalizeSnowflakeId(g.id))
      .filter((id) => !!id)
  );
  if (cacheKey) {
    manageableGuildIdsCache.set(cacheKey, {
      ids,
      expiresAt: now + MANAGEABLE_CACHE_TTL_MS,
    });
    if (manageableGuildIdsCache.size > 300) {
      for (const [k, v] of manageableGuildIdsCache) {
        if (v.expiresAt <= now) manageableGuildIdsCache.delete(k);
      }
    }
  }
  return ids;
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
  res.json({ ok: true, service: "wingbot-dashboard" });
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

app.get("/api/internal/access", requireDiscordSession, (req, res) => {
  const userId = req.discordSession.userId;
  res.json({
    user_id: userId,
    tier: premiumGate.getUserTier(userId),
    founder: isFounderUser(userId),
    premium: isPremiumUser(userId),
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

app.put("/api/bot/avatar", requireDiscordSession, async (req, res) => {
  try {
    if (!canUseFeature(req.discordSession.userId, "bot_avatar")) {
      return res.status(403).json({
        error: "feature_locked",
        message: "Cette fonctionnalité n'est pas disponible pour ce compte.",
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

      if (hasAvatar && !canUseFeature(req.discordSession.userId, "bot_avatar")) {
        return res.status(403).json({
          error: "feature_locked",
          message: "Cette fonctionnalité n'est pas disponible pour ce compte.",
        });
      }
      if (hasNick && !canUseFeature(req.discordSession.userId, "bot_nickname")) {
        return res.status(403).json({
          error: "feature_locked",
          message: "Cette fonctionnalité n'est pas disponible pour ce compte.",
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
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: oauthRedirectUri(),
    response_type: "code",
    scope: "identify guilds",
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

/** Discord renvoie ici après autorisation */
app.get("/api/auth/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const err = req.query.error;
    if (err) {
      return res.redirect(`${publicBaseUrl()}/?discord=error&reason=${encodeURIComponent(err)}`);
    }
    if (!code) {
      return res.redirect(`${publicBaseUrl()}/?discord=error`);
    }
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(503).send("OAuth non configuré (.env)");
    }
    const tokenData = await fetchOAuthToken(
      code,
      oauthRedirectUri(),
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
    res.redirect(`${publicBaseUrl()}/?discord=connected`);
  } catch (e) {
    console.error(e);
    res.redirect(
      `${publicBaseUrl()}/?discord=error&reason=${encodeURIComponent(String(e.message))}`
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
      const accessToken = req.discordSession.accessToken;
      const clientId = process.env.CLIENT_ID;
      if (!clientId) {
        return res.status(503).json({ error: "CLIENT_ID manquant" });
      }

      const rawGuilds = await fetchUserGuilds(accessToken);
      /** IDs déjà couverts (snowflakes en string) */
      const seen = new Set();
      let manageable = rawGuilds.filter((g) => {
        const ok = canManageGuild(g);
        if (ok) seen.add(normalizeSnowflakeId(g.id));
        return ok;
      });

      /** Guilde en base mais absente du filtre (ex. bug permissions) : on réintègre si OAuth dit encore « gérable » */
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
        !!db
          .prepare("SELECT 1 FROM guild_config WHERE guild_id = ?")
          .get(gid);

      const perms = process.env.BOT_INVITE_PERMISSIONS || "268438528";

      /* Un seul appel Discord pour TOUTES les guildes du bot, en parallèle
         avec le rendu — plus besoin d'await par serveur. */
      const botIdsPromise = getBotGuildIdsCached().catch(() => new Set());
      const botIds = await botIdsPromise;

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
    applyGuildSettingsPatch(guildId, req.body || {});
    res.json(getGuildDashboardPayload(guildId));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: String(e.message) });
  }
});

app.get("/api/commands-manifest", requireDiscordSession, (_req, res) => {
  res.json({ groups: COMMAND_GROUPS, commands: COMMANDS });
});

app.get("/api/stats", requireDiscordSession, async (req, res) => {
  try {
    const cacheCount = db
      .prepare("SELECT COUNT(*) AS n FROM message_cache")
      .get();
    const manageableIds = await getManageableGuildIds(
      req.discordSession.accessToken,
      req.discordSession.sessionId || req.discordSession.userId
    );
    const rows = db.prepare("SELECT guild_id FROM guild_config").all();
    const guildCount = rows
      .map((r) => normalizeSnowflakeId(r.guild_id))
      .filter((id) => manageableIds.has(id)).length;

    res.json({
      serveurs_configures: guildCount,
      messages_en_cache: cacheCount?.n ?? 0,
    });
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
    const channels = await discordFetchJson(
      `/guilds/${encodeURIComponent(guildId)}/channels`
    );
    res.json({ channels: formatChannelsForUi(channels) });
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
      const roles = await discordFetchJson(
        `/guilds/${encodeURIComponent(guildId)}/roles`
      );
      res.json({ roles: formatRolesForUi(roles) });
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
// Admin VIP / Premium (founder-only)
// ============================================================

app.get(
  "/api/admin/premium",
  requireDiscordSession,
  requireFounder,
  (_req, res) => {
    res.json({ users: premiumGate.listActivePremiumUsers() });
  }
);

app.post(
  "/api/admin/premium",
  requireDiscordSession,
  requireFounder,
  (req, res) => {
    try {
      const { user_id, tier, expires_at, note } = req.body || {};
      const id = premiumGate.normalizeSnowflakeId(user_id);
      if (!id) return res.status(400).json({ error: "user_id invalide" });
      if (!["founder", "vip", "premium"].includes(tier)) {
        return res.status(400).json({ error: "tier invalide" });
      }
      const row = upsertPremiumUser({
        user_id: id,
        tier,
        granted_by: req.discordSession.userId,
        expires_at: expires_at || null,
        note: note ? String(note).slice(0, 200) : null,
      });
      res.json({ user: row });
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: String(e.message) });
    }
  }
);

app.delete(
  "/api/admin/premium/:userId",
  requireDiscordSession,
  requireFounder,
  (req, res) => {
    const id = premiumGate.normalizeSnowflakeId(req.params.userId);
    if (!id) return res.status(400).json({ error: "user_id invalide" });
    const changes = deletePremiumUser(id);
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

app.use(express.static(path.join(__dirname, "public")));

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
