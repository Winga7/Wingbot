/**
 * Configuration antispam par serveur (colonne guild_config.antispam_config).
 */
function defaultAntispamConfig() {
  return {
    enabled: false,
    /** Log uniquement, aucune suppression / MP / sourdine — pour calibrer sans risque */
    test_mode: true,
    cross_channel: true,
    /** Membre sur le serveur depuis X jours → seuils plus stricts (moins de faux positifs) */
    trusted_member_days: 14,
    url_spam: {
      enabled: true,
      max_messages: 3,
      window_sec: 45,
      min_channels: 3,
      /** Même lien posté sur plusieurs salons = signal fort (2 salons suffisent) */
      duplicate_link_trigger: true,
    },
    image_spam: {
      enabled: true,
      max_messages: 4,
      window_sec: 90,
      min_channels: 3,
    },
    immune_role_ids: [],
    immune_channel_ids: [],
    timeout_min_repeat: 60,
    timeout_min_escalated: 240,
    /** Nombre de détections avant sourdine (les précédentes = avertissement seulement) */
    strikes_before_timeout: 3,
    strike_decay_hours: 72,
  };
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizeSnowflakeList(arr, max = 40) {
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

function parseAntispamConfig(raw) {
  const base = defaultAntispamConfig();
  if (raw == null || String(raw).trim() === "") return base;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return base;
    const url = o.url_spam && typeof o.url_spam === "object" ? o.url_spam : {};
    const img = o.image_spam && typeof o.image_spam === "object" ? o.image_spam : {};
    return {
      enabled: !!o.enabled,
      test_mode: o.test_mode !== false,
      cross_channel: o.cross_channel !== false,
      trusted_member_days: clampInt(
        o.trusted_member_days,
        0,
        365,
        base.trusted_member_days
      ),
      url_spam: {
        enabled: url.enabled !== false,
        max_messages: clampInt(url.max_messages, 2, 20, base.url_spam.max_messages),
        window_sec: clampInt(url.window_sec, 10, 300, base.url_spam.window_sec),
        min_channels: clampInt(url.min_channels, 2, 20, base.url_spam.min_channels),
        duplicate_link_trigger: url.duplicate_link_trigger !== false,
      },
      image_spam: {
        enabled: img.enabled !== false,
        max_messages: clampInt(img.max_messages, 2, 30, base.image_spam.max_messages),
        window_sec: clampInt(img.window_sec, 15, 600, base.image_spam.window_sec),
        min_channels: clampInt(img.min_channels, 2, 20, base.image_spam.min_channels),
      },
      immune_role_ids: normalizeSnowflakeList(o.immune_role_ids),
      immune_channel_ids: normalizeSnowflakeList(o.immune_channel_ids),
      timeout_min_repeat: clampInt(
        o.timeout_min_repeat,
        5,
        40320,
        base.timeout_min_repeat
      ),
      timeout_min_escalated: clampInt(
        o.timeout_min_escalated,
        5,
        40320,
        base.timeout_min_escalated
      ),
      strikes_before_timeout: clampInt(
        o.strikes_before_timeout,
        2,
        10,
        base.strikes_before_timeout
      ),
      strike_decay_hours: clampInt(
        o.strike_decay_hours,
        1,
        720,
        base.strike_decay_hours
      ),
    };
  } catch {
    return base;
  }
}

function mergeAntispamPatch(current, patch) {
  const cur = parseAntispamConfig(JSON.stringify(current));
  if (!patch || typeof patch !== "object") return cur;
  const next = { ...cur };
  if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
    next.enabled = !!patch.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "test_mode")) {
    next.test_mode = !!patch.test_mode;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "cross_channel")) {
    next.cross_channel = !!patch.cross_channel;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "trusted_member_days")) {
    next.trusted_member_days = patch.trusted_member_days;
  }
  for (const key of ["url_spam", "image_spam"]) {
    if (patch[key] && typeof patch[key] === "object") {
      next[key] = { ...next[key] };
      for (const sub of [
        "enabled",
        "max_messages",
        "window_sec",
        "min_channels",
        "duplicate_link_trigger",
      ]) {
        if (Object.prototype.hasOwnProperty.call(patch[key], sub)) {
          next[key][sub] = patch[key][sub];
        }
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "immune_role_ids")) {
    next.immune_role_ids = normalizeSnowflakeList(patch.immune_role_ids);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "immune_channel_ids")) {
    next.immune_channel_ids = normalizeSnowflakeList(patch.immune_channel_ids);
  }
  for (const key of [
    "timeout_min_repeat",
    "timeout_min_escalated",
    "strikes_before_timeout",
    "strike_decay_hours",
  ]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = patch[key];
    }
  }
  return parseAntispamConfig(JSON.stringify(next));
}

module.exports = {
  defaultAntispamConfig,
  parseAntispamConfig,
  mergeAntispamPatch,
};
