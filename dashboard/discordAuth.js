/**
 * OAuth2 Discord : liste des serveurs où l’utilisateur peut gérer (admin / gérer le serveur).
 * Session en mémoire + cookie HttpOnly.
 */
const crypto = require("node:crypto");

const DISCORD_API = "https://discord.com/api/v10";
const OAUTH_AUTHORIZE = "https://discord.com/api/oauth2/authorize";
const OAUTH_TOKEN = "https://discord.com/api/oauth2/token";

/** @type {Map<string, { accessToken: string, expiresAt: number, userId: string, username: string }>} */
const sessions = new Map();

const SESSION_COOKIE = "wingbot_discord";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function getSessionIdFromReq(req) {
  const c = parseCookies(req.headers.cookie || "");
  return c[SESSION_COOKIE] || null;
}

function getSession(req) {
  const sid = getSessionIdFromReq(req);
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s || Date.now() > s.expiresAt) {
    if (sid) sessions.delete(sid);
    return null;
  }
  return { sessionId: sid, ...s };
}

function createSession(res, { accessToken, expiresInSec, userId, username }) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + Math.min((expiresInSec || 604800) * 1000, SESSION_MAX_AGE_MS);
  sessions.set(sessionId, {
    accessToken,
    expiresAt,
    userId,
    username,
  });

  const maxAgeSec = Math.floor((expiresAt - Date.now()) / 1000);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function destroySession(req) {
  const sid = getSessionIdFromReq(req);
  if (sid) sessions.delete(sid);
}

/**
 * Toujours en string : les snowflakes ne doivent jamais passer par Number (perte de précision).
 */
function normalizeSnowflakeId(id) {
  if (id == null) return "";
  return String(id).trim();
}

/**
 * Peut gérer le serveur (inviter le bot, ouvrir le dashboard) : propriétaire, admin Discord, ou « Gérer le serveur ».
 * permissions est une chaîne bitfield (Discord /users/@me/guilds).
 */
function canManageGuild(g) {
  if (g == null) return false;
  if (g.owner === true || g.owner === "true" || g.owner === 1) return true;
  try {
    const raw = g.permissions ?? g.permission ?? "0";
    const p = BigInt(String(raw).trim());
    const ADMINISTRATOR = 1n << 3n;
    const MANAGE_GUILD = 1n << 5n;
    return (
      (p & ADMINISTRATOR) === ADMINISTRATOR ||
      (p & MANAGE_GUILD) === MANAGE_GUILD
    );
  } catch {
    return false;
  }
}

function userGuildIconUrl(guildId, iconHash) {
  if (!iconHash) return null;
  const ext = String(iconHash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=64`;
}

/**
 * @param {string} accessToken - OAuth user token
 */
async function fetchUserGuilds(accessToken) {
  const r = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Discord guilds ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function fetchOAuthToken(code, redirectUri, clientId, clientSecret) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const r = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`OAuth token ${r.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

async function fetchDiscordMe(accessToken) {
  const r = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error("Impossible de lire le profil Discord");
  return r.json();
}

function buildInviteUrl(guildId, clientId, permissionsStr) {
  const perms = permissionsStr || "268438528";
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: perms,
    scope: "bot applications.commands",
    guild_id: guildId,
    disable_guild_select: "true",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

module.exports = {
  SESSION_COOKIE,
  parseCookies,
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
};
