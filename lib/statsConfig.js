/** Statistiques d'activité : compteurs seulement, jamais le contenu ni les membres. */

const RETENTION_DAYS = 31;
const MAX_QUERY_DAYS = 30;
const MAX_IGNORED = 40;
const MAX_VOICE_SECONDS = 12 * 3600;

const DEFAULT_STATS_CONFIG = {
  enabled: false,
  track_messages: true,
  track_members: true,
  track_voice: true,
  public_command: true,
  ignored_channel_ids: [],
};

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

function parseStatsConfig(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if (!raw || typeof raw !== "object") raw = {};
  return {
    enabled: !!raw.enabled,
    track_messages: raw.track_messages !== false,
    track_members: raw.track_members !== false,
    track_voice: raw.track_voice !== false,
    public_command: raw.public_command !== false,
    ignored_channel_ids: snowflakeList(raw.ignored_channel_ids, MAX_IGNORED),
  };
}

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function shiftUtcDay(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function clampQueryDays(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) return 7;
  return Math.min(MAX_QUERY_DAYS, Math.max(1, n));
}

module.exports = {
  RETENTION_DAYS,
  MAX_QUERY_DAYS,
  MAX_IGNORED,
  MAX_VOICE_SECONDS,
  DEFAULT_STATS_CONFIG,
  parseStatsConfig,
  utcDay,
  shiftUtcDay,
  clampQueryDays,
};
