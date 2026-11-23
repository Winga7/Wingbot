/** Anniversaires : dates par serveur, annonce quotidienne, rôle du jour. */

const MAX_ROLES = 20;
const MAX_MESSAGE = 500;
const MAX_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const DEFAULT_BIRTHDAY_CONFIG = {
  enabled: false,
  channel_id: null,
  hour: 9,
  timezone_offset_minutes: 60,
  message: "Joyeux anniversaire {user} ! 🎂",
  mention_role_id: null,
  temp_role_id: null,
  allowed_role_ids: [],
  blocked_role_ids: [],
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

function clip(value, max) {
  return String(value ?? "").replace(/\r/g, "").slice(0, max);
}

function intBetween(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseBirthdayConfig(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if (!raw || typeof raw !== "object") raw = {};
  const channel = String(raw.channel_id ?? "").replace(/\D/g, "");
  const mention = String(raw.mention_role_id ?? "").replace(/\D/g, "");
  const temp = String(raw.temp_role_id ?? "").replace(/\D/g, "");
  return {
    enabled: !!raw.enabled,
    channel_id: /^\d{17,20}$/.test(channel) ? channel : null,
    hour: intBetween(raw.hour, 0, 23, 9),
    timezone_offset_minutes: intBetween(raw.timezone_offset_minutes, -720, 840, 60),
    message: clip(raw.message, MAX_MESSAGE) || DEFAULT_BIRTHDAY_CONFIG.message,
    mention_role_id: /^\d{17,20}$/.test(mention) ? mention : null,
    temp_role_id: /^\d{17,20}$/.test(temp) ? temp : null,
    allowed_role_ids: snowflakeList(raw.allowed_role_ids, MAX_ROLES),
    blocked_role_ids: snowflakeList(raw.blocked_role_ids, MAX_ROLES),
  };
}

/** Parse JJ/MM ou JJ-MM ou JJ.MM ; année optionnelle. */
function parseBirthdayDate(raw) {
  const text = String(raw ?? "").trim();
  const match = text.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{4}))?$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3] ? Number(match[3]) : null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year != null && (year < 1900 || year > new Date().getFullYear())) return null;
  const probe = new Date(Date.UTC(year || 2000, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { day, month, year };
}

function formatBirthdayDate({ day, month, year }) {
  const d = String(day).padStart(2, "0");
  const m = String(month).padStart(2, "0");
  return year ? `${d}/${m}/${year}` : `${d}/${m}`;
}

function localParts(nowMs, offsetMinutes) {
  const shifted = new Date(nowMs + offsetMinutes * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

function applyBirthdayVars(template, { users, role, gifts }) {
  return String(template || "")
    .replaceAll("{users}", users)
    .replaceAll("{user}", users)
    .replaceAll("{role}", role || "")
    .replaceAll("{gifts}", gifts || "");
}

module.exports = {
  DEFAULT_BIRTHDAY_CONFIG,
  MAX_CHANGE_COOLDOWN_MS,
  parseBirthdayConfig,
  parseBirthdayDate,
  formatBirthdayDate,
  localParts,
  applyBirthdayVars,
};
