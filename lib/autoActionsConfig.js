/** Actions auto : rôles à l'arrivée + auto-réactions par salon. */

const crypto = require("node:crypto");
const { normalizeEmoji } = require("./autoresponseConfig");

const MAX_JOIN_ROLES = 15;
const MAX_REACT_RULES = 15;
const MAX_CHANNELS = 40;
const MAX_EMOJIS = 3;

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

function intBetween(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function newId() {
  return crypto.randomBytes(6).toString("hex");
}

function normalizeEmojis(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const emoji = normalizeEmoji(item);
    if (!emoji || seen.has(emoji)) continue;
    seen.add(emoji);
    out.push(emoji);
    if (out.length >= MAX_EMOJIS) break;
  }
  return out;
}

function parseReactRule(raw) {
  if (!raw || typeof raw !== "object") return null;
  const channel_ids = snowflakeList(raw.channel_ids, MAX_CHANNELS);
  const emojis = normalizeEmojis(raw.emojis);
  if (!channel_ids.length || !emojis.length) return null;
  return {
    id: /^\w{6,24}$/.test(String(raw.id || "")) ? String(raw.id) : newId(),
    enabled: raw.enabled !== false,
    channel_ids,
    emojis,
    ignore_bots: raw.ignore_bots !== false,
  };
}

function parseAutoActionsConfig(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if (!raw || typeof raw !== "object") raw = {};

  const joinRaw = raw.join_roles && typeof raw.join_roles === "object" ? raw.join_roles : {};
  const join_roles = {
    enabled: !!joinRaw.enabled,
    role_ids: snowflakeList(joinRaw.role_ids, MAX_JOIN_ROLES),
    delay_seconds: intBetween(joinRaw.delay_seconds, 0, 300, 0),
  };

  const auto_reacts = [];
  const list = Array.isArray(raw.auto_reacts) ? raw.auto_reacts : [];
  for (const item of list) {
    const parsed = parseReactRule(item);
    if (parsed) auto_reacts.push(parsed);
    if (auto_reacts.length >= MAX_REACT_RULES) break;
  }

  return {
    enabled: !!raw.enabled,
    join_roles,
    auto_reacts,
  };
}

module.exports = {
  MAX_JOIN_ROLES,
  MAX_REACT_RULES,
  MAX_EMOJIS,
  parseAutoActionsConfig,
  parseReactRule,
  newId,
};
