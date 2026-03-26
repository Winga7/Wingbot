/**
 * Dashboard HTTP : lit/écrit wingbot.db + OAuth Discord (liste des serveurs admin).
 *
 * .env :
 *   DASHBOARD_TOKEN, TOKEN (bot), CLIENT_ID
 *   DISCORD_CLIENT_SECRET — secret OAuth2 (Discord Developer Portal)
 *   DASHBOARD_PUBLIC_URL — ex. http://127.0.0.1:3847 (URL exacte du dashboard)
 *   BOT_INVITE_PERMISSIONS — optionnel, entier permissions (défaut : 268438528)
 */
const path = require("node:path");
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
} = require("../database");
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
const TOKEN = process.env.DASHBOARD_TOKEN || "";
const DISCORD_API = "https://discord.com/api/v10";

function publicBaseUrl() {
  const u = process.env.DASHBOARD_PUBLIC_URL || `http://127.0.0.1:${PORT}`;
  return u.replace(/\/$/, "");
}

function oauthRedirectUri() {
  return `${publicBaseUrl()}/api/auth/discord/callback`;
}

async function botGuildExists(guildId) {
  const id = normalizeSnowflakeId(guildId);
  if (!id) return false;
  const botToken = (process.env.TOKEN || "").trim();
  if (!botToken) return false;
  const url = `${DISCORD_API}/guilds/${encodeURIComponent(id)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bot ${botToken}`,
        "User-Agent": "DiscordBot (https://discord.com, 1.0)",
      },
    });
    if (r.status === 429 && attempt < 2) {
      const reset = Number(r.headers.get("retry-after") || "1");
      await new Promise((res) => setTimeout(res, Math.ceil(reset * 1000) + 100));
      continue;
    }
    if (!r.ok && r.status !== 404 && r.status !== 403) {
      console.warn(
        `[dashboard] botGuildExists(${id}) HTTP ${r.status} — vérifie TOKEN (bot) dans .env`
      );
    }
    return r.ok;
  }
  return false;
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

function guildIconUrlBot(guildId, iconHash) {
  if (!iconHash) return null;
  const ext = String(iconHash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=64`;
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

function requireToken(req, res, next) {
  if (!TOKEN) {
    return res
      .status(503)
      .type("text/plain")
      .send(
        "DASHBOARD_TOKEN n'est pas défini dans .env. Ajoute un secret puis redémarre le dashboard."
      );
  }
  const auth = req.headers.authorization || "";
  const expected = `Bearer ${TOKEN}`;
  if (auth !== expected) {
    return res.status(401).type("text/plain").send("Non autorisé");
  }
  next();
}

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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "wingbot-dashboard" });
});

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
    prompt: "consent",
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
app.get("/api/auth/discord/status", requireToken, (req, res) => {
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
  requireToken,
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
      const out = [];

      for (const g of manageable) {
        const gid = normalizeSnowflakeId(g.id);
        const botIn = await botGuildExists(gid);
        out.push({
          guild_id: gid,
          name: g.name,
          icon_url: userGuildIconUrl(gid, g.icon),
          bot_in_guild: botIn,
          has_config_in_db: hasRowInDb(gid),
          invite_url: buildInviteUrl(gid, clientId, perms),
        });
      }

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

app.get("/api/manifest", requireToken, (_req, res) => {
  res.json({ groups: DASHBOARD_GROUPS });
});

app.get("/api/config", requireToken, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT guild_id FROM guild_config ORDER BY updated_at DESC`
      )
      .all();

    const guilds = rows.map((r) => getGuildDashboardPayload(r.guild_id));
    res.json({ guilds });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.get("/api/guilds/:guildId", requireToken, async (req, res) => {
  try {
    const { guildId } = req.params;
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

app.put("/api/guilds/:guildId", requireToken, async (req, res) => {
  try {
    const { guildId } = req.params;
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

app.get("/api/commands-manifest", requireToken, (_req, res) => {
  res.json({ groups: COMMAND_GROUPS, commands: COMMANDS });
});

app.get("/api/stats", requireToken, (_req, res) => {
  try {
    const cacheCount = db
      .prepare("SELECT COUNT(*) AS n FROM message_cache")
      .get();
    const guildCount = db
      .prepare("SELECT COUNT(*) AS n FROM guild_config")
      .get();

    res.json({
      serveurs_configures: guildCount?.n ?? 0,
      messages_en_cache: cacheCount?.n ?? 0,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.get("/api/discord/guilds/:guildId", requireToken, async (req, res) => {
  try {
    const { guildId } = req.params;
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

app.get("/api/discord/guilds/:guildId/channels", requireToken, async (req, res) => {
  try {
    const { guildId } = req.params;
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

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`📊 Dashboard Wingbot : ${publicBaseUrl()}/`);
  console.log(
    `   OAuth redirect à déclarer sur Discord : ${oauthRedirectUri()}`
  );
  if (!TOKEN) {
    console.warn("⚠️  DASHBOARD_TOKEN manquant dans .env");
  }
  if (!process.env.DISCORD_CLIENT_SECRET) {
    console.warn(
      "⚠️  DISCORD_CLIENT_SECRET manquant — connexion « Mes serveurs » désactivée."
    );
  }
});
