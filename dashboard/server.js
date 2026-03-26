/**
 * Dashboard HTTP : lit/écrit la même base SQLite que le bot (wingbot.db).
 * Démarre séparément : npm run dashboard
 *
 * Variables .env (racine du projet) :
 *   DASHBOARD_PORT=3847
 *   DASHBOARD_TOKEN=un_secret_long_et_aleatoire
 */
const path = require("node:path");
const express = require("express");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { ALL_KEYS, DASHBOARD_GROUPS } = require("../logFeatureDefinitions");
const {
  initDatabase,
  db,
  getResolvedFeatureFlags,
  saveFeatureFlags,
  setLogChannel,
} = require("../database");

initDatabase();

const app = express();
const PORT = Number(process.env.DASHBOARD_PORT) || 3847;
const TOKEN = process.env.DASHBOARD_TOKEN || "";
const DISCORD_API = "https://discord.com/api/v10";

/** Appels Discord REST (même token que le bot, dans .env : TOKEN) */
async function discordFetchJson(path) {
  const botToken = process.env.TOKEN;
  if (!botToken) {
    const err = new Error("TOKEN du bot manquant dans .env (requis pour noms / salons)");
    err.code = "NO_BOT_TOKEN";
    throw err;
  }
  const r = await fetch(`${DISCORD_API}${path}`, {
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

function guildIconUrl(guildId, iconHash) {
  if (!iconHash) return null;
  const ext = String(iconHash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=64`;
}

/** Texte / annonces / forums — où on peut envoyer des embeds de logs */
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

// Permet d'ouvrir le HTML depuis un autre port (ex. Live Server) tout en ciblant cette API
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
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

function guildPayload(guildId) {
  const row = db
    .prepare(
      "SELECT log_channel_id FROM guild_config WHERE guild_id = ?"
    )
    .get(guildId);
  return {
    guild_id: guildId,
    log_channel_id: row?.log_channel_id ?? null,
    feature_flags: getResolvedFeatureFlags(guildId),
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "wingbot-dashboard" });
});

/** Schéma UI (groupes + clés + libellés FR) */
app.get("/api/manifest", requireToken, (_req, res) => {
  res.json({ groups: DASHBOARD_GROUPS });
});

/** Liste des serveurs présents en base avec flags résolus */
app.get("/api/config", requireToken, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `
        SELECT guild_id
        FROM guild_config
        ORDER BY updated_at DESC
      `
      )
      .all();

    const guilds = rows.map((r) => guildPayload(r.guild_id));
    res.json({ guilds });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/** Détail d'un serveur */
app.get("/api/guilds/:guildId", requireToken, (req, res) => {
  try {
    const { guildId } = req.params;
    const exists = db
      .prepare("SELECT 1 FROM guild_config WHERE guild_id = ?")
      .get(guildId);
    if (!exists) {
      return res.status(404).json({ error: "Serveur inconnu en base" });
    }
    res.json(guildPayload(guildId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/** Sauvegarde des flags + optionnellement salon de logs */
app.put("/api/guilds/:guildId", requireToken, (req, res) => {
  try {
    const { guildId } = req.params;
    const body = req.body || {};
    const incoming = body.feature_flags;
    if (typeof incoming !== "object" || incoming === null) {
      return res
        .status(400)
        .json({ error: "feature_flags doit être un objet { clé: bool }" });
    }

    const current = getResolvedFeatureFlags(guildId);
    const merged = { ...current };
    for (const k of ALL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(incoming, k)) {
        merged[k] = !!incoming[k];
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "log_channel_id")) {
      const ch = body.log_channel_id;
      const empty = ch === null || ch === "";
      const okId =
        typeof ch === "string" && /^\d{17,20}$/.test(ch.trim());
      if (!empty && !okId) {
        return res.status(400).json({
          error:
            "log_channel_id doit être un ID Discord (17–20 chiffres) ou vide pour retirer le salon",
        });
      }
    }

    saveFeatureFlags(guildId, merged);

    if (Object.prototype.hasOwnProperty.call(body, "log_channel_id")) {
      const ch = body.log_channel_id;
      if (ch === null || ch === "") {
        setLogChannel(guildId, null);
      } else {
        setLogChannel(guildId, String(ch).trim());
      }
    }

    res.json(guildPayload(guildId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
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

/** Métadonnées Discord (nom, icône) — uniquement si le serveur est déjà en base */
app.get("/api/discord/guilds/:guildId", requireToken, async (req, res) => {
  try {
    const { guildId } = req.params;
    const exists = db
      .prepare("SELECT 1 FROM guild_config WHERE guild_id = ?")
      .get(guildId);
    if (!exists) {
      return res.status(404).json({ error: "Serveur inconnu en base" });
    }
    const g = await discordFetchJson(`/guilds/${encodeURIComponent(guildId)}`);
    res.json({
      id: g.id,
      name: g.name,
      icon_url: guildIconUrl(g.id, g.icon),
    });
  } catch (e) {
    if (e.code === "NO_BOT_TOKEN") {
      return res.status(503).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/** Salons texte / annonces / forums pour le sélecteur de salon de logs */
app.get("/api/discord/guilds/:guildId/channels", requireToken, async (req, res) => {
  try {
    const { guildId } = req.params;
    const exists = db
      .prepare("SELECT 1 FROM guild_config WHERE guild_id = ?")
      .get(guildId);
    if (!exists) {
      return res.status(404).json({ error: "Serveur inconnu en base" });
    }
    const channels = await discordFetchJson(
      `/guilds/${encodeURIComponent(guildId)}/channels`
    );
    const channelsUi = formatChannelsForUi(channels);
    res.json({ channels: channelsUi });
  } catch (e) {
    if (e.code === "NO_BOT_TOKEN") {
      return res.status(503).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

// Les routes /api/* avant le static : évite toute ambiguïté avec les fichiers
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`📊 Dashboard Wingbot : http://127.0.0.1:${PORT}/`);
  console.log(
    `   Ouvre cette URL dans le navigateur (pas Live Server sur le HTML seul).`
  );
  if (!TOKEN) {
    console.warn(
      "⚠️  Définis DASHBOARD_TOKEN dans .env pour sécuriser l'API."
    );
  }
});
