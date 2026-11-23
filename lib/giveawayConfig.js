/** Giveaways : validation de la config serveur. */

const MAX_MANAGER_ROLES = 20;
const MAX_ACTIVE = 10;
const MIN_DURATION_MS = 60 * 1000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_WINNERS = 20;
const MAX_PRIZE = 200;
const MAX_REQUIRED_ROLES = 10;

const DEFAULT_GIVEAWAY_CONFIG = {
  enabled: false,
  manager_role_ids: [],
  max_active: 5,
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

function intBetween(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseGiveawayConfig(input) {
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
    manager_role_ids: snowflakeList(raw.manager_role_ids, MAX_MANAGER_ROLES),
    max_active: intBetween(raw.max_active, 1, MAX_ACTIVE, 5),
  };
}

function clipPrize(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, MAX_PRIZE);
}

/**
 * Durée : minutes entières, ou 30s / 5m / 2h / 3d.
 * Minimum 1 minute, maximum 30 jours.
 */
function parseDurationMs(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const minutes = Number(text);
    if (!Number.isInteger(minutes) || minutes < 1) return null;
    const ms = minutes * 60 * 1000;
    return ms > MAX_DURATION_MS ? null : ms;
  }
  const match = text.match(/^(\d+)\s*(s|m|h|d|sec|min|mins|minute|minutes|heure|heures|jour|jours)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount < 1) return null;
  const unit = match[2].toLowerCase();
  let ms = 0;
  if (unit === "s" || unit === "sec") ms = amount * 1000;
  else if (unit.startsWith("m")) ms = amount * 60 * 1000;
  else if (unit.startsWith("h") || unit.startsWith("heure")) ms = amount * 60 * 60 * 1000;
  else ms = amount * 24 * 60 * 60 * 1000;
  if (ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) return null;
  return ms;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const days = Math.floor(total / (24 * 3600 * 1000));
  const hours = Math.floor((total % (24 * 3600 * 1000)) / (3600 * 1000));
  const minutes = Math.floor((total % (3600 * 1000)) / (60 * 1000));
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${Math.max(1, minutes)} min`;
}

module.exports = {
  DEFAULT_GIVEAWAY_CONFIG,
  MAX_MANAGER_ROLES,
  MAX_ACTIVE,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  MAX_WINNERS,
  MAX_PRIZE,
  MAX_REQUIRED_ROLES,
  parseGiveawayConfig,
  clipPrize,
  parseDurationMs,
  formatDuration,
  snowflakeList,
};
