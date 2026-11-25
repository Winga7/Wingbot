/** Fils auto : ouvre un fil sur chaque message d'un salon. */

const crypto = require("node:crypto");

const MAX_CHANNELS = 25;
const MAX_NAME = 90;
const ARCHIVE_OPTIONS = new Set([60, 1440, 4320, 10080]);

function clip(value, max) {
  return String(value ?? "").replace(/\r/g, "").slice(0, max);
}

function intBetween(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function newId() {
  return crypto.randomBytes(6).toString("hex");
}

function parseOneChannel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const channel_id = String(raw.channel_id ?? "").replace(/\D/g, "");
  if (!/^\d{17,20}$/.test(channel_id)) return null;
  let auto_archive_minutes = Number(raw.auto_archive_minutes);
  if (!ARCHIVE_OPTIONS.has(auto_archive_minutes)) auto_archive_minutes = 1440;
  const name_format =
    clip(raw.name_format, MAX_NAME).trim() || "💬 {username}";
  return {
    id: /^\w{6,24}$/.test(String(raw.id || "")) ? String(raw.id) : newId(),
    enabled: raw.enabled !== false,
    channel_id,
    name_format,
    auto_archive_minutes,
    ignore_bots: raw.ignore_bots !== false,
    ignore_existing_thread: raw.ignore_existing_thread !== false,
  };
}

function parseAutothreadConfig(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if (!raw || typeof raw !== "object") raw = {};
  const channels = [];
  const seen = new Set();
  const list = Array.isArray(raw.channels) ? raw.channels : [];
  for (const item of list) {
    const parsed = parseOneChannel(item);
    if (!parsed || seen.has(parsed.channel_id)) continue;
    seen.add(parsed.channel_id);
    channels.push(parsed);
    if (channels.length >= MAX_CHANNELS) break;
  }
  return {
    enabled: !!raw.enabled,
    channels,
  };
}

function applyThreadName(template, ctx) {
  let name = String(template || "💬 {username}")
    .replaceAll("{user}", ctx.username || "membre")
    .replaceAll("{username}", ctx.username || "membre")
    .replaceAll("{message}", ctx.messageSnippet || "discussion")
    .replaceAll("{channel}", ctx.channelName || "salon");
  name = name.replace(/\s+/g, " ").trim() || "discussion";
  return name.slice(0, 100);
}

module.exports = {
  MAX_CHANNELS,
  MAX_NAME,
  ARCHIVE_OPTIONS,
  parseAutothreadConfig,
  parseOneChannel,
  applyThreadName,
  newId,
  intBetween,
};
