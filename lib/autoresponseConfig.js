/** Réponses automatiques : mots-clés → message / réactions. */

const crypto = require("node:crypto");

const MAX_RESPONSES = 25;
const MAX_TRIGGER = 120;
const MAX_RESPONSE = 1500;
const MAX_REACTIONS = 3;
const MAX_CHANNELS = 40;
const MAX_ROLES = 20;

const MATCH_MODES = new Set(["contains", "exact", "startswith"]);

function snowflakeList(value, max) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const id = String(item ?? "").replace(/\D/g, "");
    if (!/^\d{17,20}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function clip(value, max) {
  return String(value ?? "").replace(/\r/g, "").slice(0, max);
}

function intBetween(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeEmoji(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const custom = text.match(/^<?(a)?:([\w~]+):(\d{17,20})>?$/);
  if (custom) return `<${custom[1] ? "a" : ""}:${custom[2]}:${custom[3]}>`;
  return text.slice(0, 32);
}

function normalizeReactions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const emoji = normalizeEmoji(item);
    if (!emoji || seen.has(emoji)) continue;
    seen.add(emoji);
    out.push(emoji);
    if (out.length >= MAX_REACTIONS) break;
  }
  return out;
}

function newId() {
  return crypto.randomBytes(6).toString("hex");
}

function parseOneResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const trigger = clip(raw.trigger, MAX_TRIGGER).trim();
  if (!trigger) return null;
  const match = MATCH_MODES.has(raw.match) ? raw.match : "contains";
  const response = clip(raw.response, MAX_RESPONSE);
  const reactions = normalizeReactions(raw.reactions);
  if (!response && !reactions.length) return null;
  return {
    id: /^\w{6,24}$/.test(String(raw.id || "")) ? String(raw.id) : newId(),
    enabled: raw.enabled !== false,
    trigger,
    match,
    response,
    reactions,
    reply: !!raw.reply,
    delete_trigger: !!raw.delete_trigger,
    cooldown_seconds: intBetween(raw.cooldown_seconds, 0, 3600, 5),
    channel_ids: snowflakeList(raw.channel_ids, MAX_CHANNELS),
    ignored_channel_ids: snowflakeList(raw.ignored_channel_ids, MAX_CHANNELS),
    required_role_ids: snowflakeList(raw.required_role_ids, MAX_ROLES),
    ignore_bots: raw.ignore_bots !== false,
  };
}

function parseAutoresponseConfig(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if (!raw || typeof raw !== "object") raw = {};
  const responses = [];
  const list = Array.isArray(raw.responses) ? raw.responses : [];
  for (const item of list) {
    const parsed = parseOneResponse(item);
    if (parsed) responses.push(parsed);
    if (responses.length >= MAX_RESPONSES) break;
  }
  return {
    enabled: !!raw.enabled,
    responses,
  };
}

function applyAutoresponseVars(template, ctx) {
  return String(template || "")
    .replaceAll("{user}", ctx.user || "")
    .replaceAll("{username}", ctx.username || "")
    .replaceAll("{user.id}", ctx.userId || "")
    .replaceAll("{channel}", ctx.channel || "")
    .replaceAll("{channel.name}", ctx.channelName || "")
    .replaceAll("{server}", ctx.server || "")
    .replaceAll("{guild}", ctx.server || "")
    .replaceAll("{trigger}", ctx.trigger || "");
}

function messageMatchesTrigger(content, rule) {
  const text = String(content || "");
  const needle = rule.trigger;
  if (rule.match === "exact") {
    return text.trim().toLowerCase() === needle.toLowerCase();
  }
  if (rule.match === "startswith") {
    return text.toLowerCase().startsWith(needle.toLowerCase());
  }
  return text.toLowerCase().includes(needle.toLowerCase());
}

function reactionToApi(emoji) {
  const custom = String(emoji).match(/^<(a)?:([\w~]+):(\d{17,20})>$/);
  if (custom) return `${custom[2]}:${custom[3]}`;
  return emoji;
}

module.exports = {
  MAX_RESPONSES,
  MAX_TRIGGER,
  MAX_RESPONSE,
  MAX_REACTIONS,
  parseAutoresponseConfig,
  parseOneResponse,
  applyAutoresponseVars,
  messageMatchesTrigger,
  reactionToApi,
  newId,
  normalizeEmoji,
};
