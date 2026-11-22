/** Niveaux : courbe d'XP, validation de la config, texte d'annonce. */

const MAX_LEVEL = 150;
const MAX_XP = 5_000_000;
const MAX_REWARDS = 20;
const MAX_IGNORED = 40;

const DEFAULT_LEVEL_CONFIG = {
  enabled: false,
  xp_min: 15,
  xp_max: 25,
  cooldown_seconds: 60,
  min_length: 5,
  announce: true,
  announce_channel_id: null,
  announce_text: "Bravo {user}, tu passes **niveau {level}** !",
  stack_roles: false,
  ignored_channel_ids: [],
  ignored_role_ids: [],
  rewards: [],
};

function clip(value, max) {
  return String(value ?? "").replace(/\r/g, "").slice(0, max);
}

function intBetween(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

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

function cleanChannelId(value) {
  const id = String(value ?? "").replace(/\D/g, "");
  return /^\d{17,20}$/.test(id) ? id : null;
}

function parseRewards(value) {
  if (!Array.isArray(value)) return [];
  const byLevel = new Map();
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const level = intBetween(row.level, 1, MAX_LEVEL, 0);
    const roleId = cleanChannelId(row.role_id);
    if (!level || !roleId) continue;
    byLevel.set(level, roleId);
    if (byLevel.size >= MAX_REWARDS) break;
  }
  return [...byLevel.entries()]
    .map(([level, role_id]) => ({ level, role_id }))
    .sort((a, b) => a.level - b.level);
}

function parseLevelConfig(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== "object") obj = {};
  const base = { ...DEFAULT_LEVEL_CONFIG };
  if ("enabled" in obj) base.enabled = !!obj.enabled;
  if ("xp_min" in obj) base.xp_min = intBetween(obj.xp_min, 1, 100, base.xp_min);
  if ("xp_max" in obj) base.xp_max = intBetween(obj.xp_max, 1, 100, base.xp_max);
  if (base.xp_max < base.xp_min) base.xp_max = base.xp_min;
  if ("cooldown_seconds" in obj) {
    base.cooldown_seconds = intBetween(obj.cooldown_seconds, 10, 3600, base.cooldown_seconds);
  }
  if ("min_length" in obj) base.min_length = intBetween(obj.min_length, 1, 200, base.min_length);
  if ("announce" in obj) base.announce = !!obj.announce;
  if ("announce_channel_id" in obj) base.announce_channel_id = cleanChannelId(obj.announce_channel_id);
  if ("announce_text" in obj) base.announce_text = clip(obj.announce_text, 300);
  if ("stack_roles" in obj) base.stack_roles = !!obj.stack_roles;
  if ("ignored_channel_ids" in obj) {
    base.ignored_channel_ids = snowflakeList(obj.ignored_channel_ids, MAX_IGNORED);
  }
  if ("ignored_role_ids" in obj) {
    base.ignored_role_ids = snowflakeList(obj.ignored_role_ids, MAX_IGNORED);
  }
  if ("rewards" in obj) base.rewards = parseRewards(obj.rewards);
  return base;
}

/** XP nécessaire pour passer du niveau `level` au suivant. */
function xpToAdvance(level) {
  const l = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level) || 0));
  return 5 * l * l + 50 * l + 100;
}

function progressFromXp(total) {
  let xp = Math.max(0, Math.min(MAX_XP, Math.floor(Number(total) || 0)));
  const stored = xp;
  let level = 0;
  while (level < MAX_LEVEL) {
    const need = xpToAdvance(level);
    if (xp < need) {
      return { level, into: xp, need, total: stored };
    }
    xp -= need;
    level += 1;
  }
  return { level: MAX_LEVEL, into: xp, need: xpToAdvance(MAX_LEVEL), total: stored };
}

function clampXp(value) {
  const n = Math.floor(Number(value) || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_XP, Math.max(0, n));
}

function applyLevelVariables(template, vars) {
  const map = vars && typeof vars === "object" ? vars : {};
  const keys = Object.keys(map);
  return String(template ?? "").replace(/\{([a-zA-Z]+)\}/g, (full, key) => {
    const found = keys.find((k) => k.toLowerCase() === key.toLowerCase());
    if (!found) return full;
    return String(map[found] ?? "");
  });
}

function progressBar(into, need) {
  const width = 12;
  const ratio = need <= 0 ? 1 : Math.min(1, into / need);
  const filled = Math.round(ratio * width);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled));
}

module.exports = {
  MAX_LEVEL,
  MAX_XP,
  DEFAULT_LEVEL_CONFIG,
  parseLevelConfig,
  xpToAdvance,
  progressFromXp,
  clampXp,
  applyLevelVariables,
  progressBar,
};
