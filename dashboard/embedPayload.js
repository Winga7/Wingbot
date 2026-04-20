/**
 * Normalisation payload embed (dashboard) → API Discord messages.
 */

const MAX_CONTENT = 2000;
const MAX_TITLE = 256;
const MAX_DESC = 4096;
const MAX_FIELD_NAME = 256;
const MAX_FIELD_VALUE = 1024;
const MAX_FIELDS = 25;
const MAX_URL = 2048;

function defaultEmbedPayload() {
  return {
    content: "",
    embed: {
      title: "",
      description: "",
      color: 0x5865f2,
      url: "",
      timestamp: null,
      footer_text: "",
      footer_icon_url: "",
      author_name: "",
      author_icon_url: "",
      author_url: "",
      thumbnail_url: "",
      image_url: "",
      fields: [],
    },
    mentions: {
      user_ids: [],
      role_ids: [],
      parse_everyone: false,
    },
  };
}

function clampStr(s, max) {
  if (s == null || s === "") return "";
  const t = String(s);
  return t.length > max ? t.slice(0, max) : t;
}

function parseColor(v) {
  if (v == null || v === "") return 0x5865f2;
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = Math.floor(v);
    if (n >= 0 && n <= 0xffffff) return n;
  }
  const s = String(v).trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) {
    return parseInt(s.replace(/^#/, ""), 16);
  }
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n >= 0 && n <= 0xffffff) return n;
  return 0x5865f2;
}

function normalizeSnowflakeArray(arr, max = 80) {
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

function mergeEmbedPayload(base, patch) {
  const out = JSON.parse(JSON.stringify(base || defaultEmbedPayload()));
  if (!patch || typeof patch !== "object") return out;
  if (typeof patch.content === "string") out.content = patch.content;
  if (patch.embed && typeof patch.embed === "object") {
    const e = patch.embed;
    for (const k of [
      "title",
      "description",
      "url",
      "timestamp",
      "footer_text",
      "footer_icon_url",
      "author_name",
      "author_icon_url",
      "author_url",
      "thumbnail_url",
      "image_url",
    ]) {
      if (Object.prototype.hasOwnProperty.call(e, k)) {
        if (k === "timestamp") {
          out.embed.timestamp = e.timestamp == null || e.timestamp === "" ? null : String(e.timestamp);
        } else {
          out.embed[k] = e[k] == null ? "" : String(e[k]);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(e, "color")) {
      out.embed.color = parseColor(e.color);
    }
    if (Object.prototype.hasOwnProperty.call(e, "fields") && Array.isArray(e.fields)) {
      out.embed.fields = e.fields
        .slice(0, MAX_FIELDS)
        .map((f) => ({
          name: f?.name == null ? "" : String(f.name),
          value: f?.value == null ? "" : String(f.value),
          inline: !!f?.inline,
        }));
    }
  }
  if (patch.mentions && typeof patch.mentions === "object") {
    const m = patch.mentions;
    if (Array.isArray(m.user_ids)) out.mentions.user_ids = normalizeSnowflakeArray(m.user_ids);
    if (Array.isArray(m.role_ids)) out.mentions.role_ids = normalizeSnowflakeArray(m.role_ids);
    if (typeof m.parse_everyone === "boolean") out.mentions.parse_everyone = m.parse_everyone;
  }
  return out;
}

function extractMentionsFromText(text) {
  const users = new Set();
  const roles = new Set();
  if (!text || typeof text !== "string") return { users, roles };
  let m;
  const reU = /<@!?(\d{17,20})>/g;
  while ((m = reU.exec(text))) users.add(m[1]);
  const reR = /<@&(\d{17,20})>/g;
  while ((m = reR.exec(text))) roles.add(m[1]);
  return { users, roles };
}

function collectAllText(payload) {
  const parts = [payload.content || ""];
  const e = payload.embed || {};
  parts.push(e.title || "", e.description || "", e.url || "", e.footer_text || "");
  parts.push(e.author_name || "", e.author_url || "");
  for (const f of e.fields || []) {
    parts.push(f.name || "", f.value || "");
  }
  return parts.join("\n");
}

function buildAllowedMentions(payload) {
  const m = payload.mentions || { user_ids: [], role_ids: [], parse_everyone: false };
  const text = collectAllText(payload);
  const exU = extractMentionsFromText(text);
  const userIds = [...new Set([...normalizeSnowflakeArray(m.user_ids), ...exU.users])];
  const roleIds = [...new Set([...normalizeSnowflakeArray(m.role_ids), ...exU.roles])];
  const parse = [];
  if (m.parse_everyone && (text.includes("@everyone") || text.includes("@here"))) {
    parse.push("everyone");
  }
  const out = {
    parse,
    users: userIds,
    roles: roleIds,
  };
  return out;
}

/** Objet embed unique pour l’API Discord (clés omises si vides). */
function toDiscordEmbedObject(payload) {
  const e = payload.embed || {};
  const embed = {};
  const title = clampStr(e.title, MAX_TITLE);
  const desc = clampStr(e.description, MAX_DESC);
  const url = clampStr(e.url, MAX_URL);
  if (title) embed.title = title;
  if (desc) embed.description = desc;
  if (url) embed.url = url;
  if (typeof e.color === "number" && e.color >= 0 && e.color <= 0xffffff) {
    embed.color = e.color;
  }
  if (e.timestamp) {
    const d = new Date(e.timestamp);
    if (!Number.isNaN(d.getTime())) embed.timestamp = d.toISOString();
  }
  const ft = clampStr(e.footer_text, 2048);
  const fi = clampStr(e.footer_icon_url, MAX_URL);
  if (ft || fi) {
    embed.footer = { text: ft || "\u200b" };
    if (fi) embed.footer.icon_url = fi;
  }
  const an = clampStr(e.author_name, 256);
  const ai = clampStr(e.author_icon_url, MAX_URL);
  const au = clampStr(e.author_url, MAX_URL);
  if (an || ai || au) {
    embed.author = { name: an || "\u200b" };
    if (ai) embed.author.icon_url = ai;
    if (au) embed.author.url = au;
  }
  const tu = clampStr(e.thumbnail_url, MAX_URL);
  if (tu) embed.thumbnail = { url: tu };
  const iu = clampStr(e.image_url, MAX_URL);
  if (iu) embed.image = { url: iu };
  if (e.fields?.length) {
    embed.fields = e.fields.slice(0, MAX_FIELDS).map((f) => ({
      name: clampStr(f.name, MAX_FIELD_NAME) || "\u200b",
      value: clampStr(f.value, MAX_FIELD_VALUE) || "\u200b",
      inline: !!f.inline,
    }));
  }
  return embed;
}

/**
 * Substitue les tokens dynamiques d'un texte avant envoi Discord.
 * ctx : { guild: {id,name,member_count}, channel: {id,name}, locale? }
 *
 * Les deux syntaxes sont acceptées : `{token}` ET `{{token}}` (alignées avec
 * le moteur des commandes perso, voir customCommandTemplates.js).
 */
function substituteTokens(text, ctx = {}) {
  if (text == null || text === "") return text;
  const s = String(text);
  if (!s.includes("{")) return s;
  const now = Math.floor(Date.now() / 1000);
  const g = ctx.guild || {};
  const c = ctx.channel || {};
  const locale = ctx.locale || "fr-FR";
  const d = new Date();
  const dateStr = d.toLocaleDateString(locale);
  const timeStr = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const members =
    g.member_count ?? g.approximate_member_count ?? g.memberCount ?? "";
  const tokens = [
    ["now", String(now)],
    ["date", dateStr],
    ["time", timeStr],
    ["guild.members", String(members)],
    ["members", String(members)],
    ["guild.id", String(g.id || "")],
    ["guild.name", String(g.name || "")],
    ["guild", String(g.name || "")],
    ["server.id", String(g.id || "")],
    ["server", String(g.name || "")],
    ["channel.id", String(c.id || "")],
    ["channel.name", String(c.name || "")],
    ["channel", c.id ? `<#${c.id}>` : ""],
  ];
  let out = s;
  for (const [token, value] of tokens) {
    const re = new RegExp(
      `\\{\\{?\\s*${token.replace(/\./g, "\\.")}\\s*\\}\\}?`,
      "g"
    );
    out = out.replace(re, value);
  }
  return out;
}

function substituteEmbedPayload(payload, ctx = {}) {
  const p = mergeEmbedPayload(defaultEmbedPayload(), payload);
  p.content = substituteTokens(p.content, ctx);
  const e = p.embed || {};
  for (const k of [
    "title",
    "description",
    "url",
    "footer_text",
    "author_name",
    "author_url",
  ]) {
    if (e[k]) e[k] = substituteTokens(e[k], ctx);
  }
  if (Array.isArray(e.fields)) {
    e.fields = e.fields.map((f) => ({
      name: substituteTokens(f.name, ctx),
      value: substituteTokens(f.value, ctx),
      inline: !!f.inline,
    }));
  }
  p.embed = e;
  return p;
}

function payloadToDiscordMessageBody(payload) {
  const p = mergeEmbedPayload(defaultEmbedPayload(), payload);
  p.embed.color = parseColor(p.embed.color);
  const content = clampStr(p.content, MAX_CONTENT);
  const embedObj = toDiscordEmbedObject(p);
  const hasEmbed = Object.keys(embedObj).length > 0;
  if (!content && !hasEmbed) {
    const err = new Error("Contenu ou embed requis (titre, description, champs, image…)");
    err.code = "EMPTY_PAYLOAD";
    throw err;
  }
  const body = {
    allowed_mentions: buildAllowedMentions(p),
  };
  if (content) body.content = content;
  if (hasEmbed) body.embeds = [embedObj];
  return body;
}

module.exports = {
  defaultEmbedPayload,
  mergeEmbedPayload,
  payloadToDiscordMessageBody,
  substituteEmbedPayload,
  substituteTokens,
  parseColor,
  clampStr,
  MAX_CONTENT,
  MAX_DESC,
  MAX_FIELDS,
};
