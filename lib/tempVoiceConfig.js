/** Configuration hubs salons vocaux temporaires (parité DraftBot). */

const MAX_HUBS_FREE = 1;
const MAX_HUBS_PREMIUM = 10;
const MAX_ACCESS_ROLES = 5;
const MAX_MOD_ROLES = 20;
const MAX_CUSTOM_WORDS = 50;
const MAX_NAME_FORMAT = 100;
const MAX_SAVES_PER_HUB = 5;
const MAX_PERMANENT = 25;

const DEFAULT_CREATOR_PERMS = {
  create_invite: true,
  manage_channel: false,
  manage_permissions: false,
  priority_speaker: false,
  set_status: true,
  use_soundboard: true,
};

const DEFAULT_WHITELIST_PERMS = {
  mic: true,
  video: true,
  soundboard: true,
  status: true,
};

const DEFAULT_BUTTONS = {
  open: true,
  closed: true,
  private: true,
  whitelist: true,
  blacklist: true,
  exclude: true,
  purge: true,
  mic: true,
  video: true,
  soundboard: true,
  status: true,
  settings: true,
  transfer: true,
  saves: true,
};

const DEFAULT_SETTINGS_OPTIONS = {
  name: true,
  limit: true,
  region: true,
};

const DEFAULT_HUB = {
  enabled: true,
  hub_channel_id: null,
  category_id: null,
  name_format: "Salon de {user}",
  permission_source: "category",
  creator_perms: { ...DEFAULT_CREATOR_PERMS },
  user_limit: 0,
  permanent_channel_ids: [],
  settings_embed: true,
  access_role_ids: [],
  settings_allow_role_ids: [],
  settings_deny_role_ids: [],
  moderator_role_ids: [],
  untouchable_role_ids: [],
  whitelist_perms: { ...DEFAULT_WHITELIST_PERMS },
  enabled_buttons: { ...DEFAULT_BUTTONS },
  settings_options: { ...DEFAULT_SETTINGS_OPTIONS },
  allow_claim: true,
  saves_enabled: false,
  custom_words: [],
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

function boolMap(input, defaults) {
  const raw = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of Object.keys(defaults)) {
    out[key] = raw[key] === undefined ? defaults[key] : !!raw[key];
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

function parseCustomWords(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const word = String(item ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 32);
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push(word);
    if (out.length >= MAX_CUSTOM_WORDS) break;
  }
  return out;
}

function parseHubConfig(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if (!raw || typeof raw !== "object") raw = {};
  const hubChannel = String(raw.hub_channel_id ?? "").replace(/\D/g, "");
  const category = String(raw.category_id ?? "").replace(/\D/g, "");
  return {
    enabled: raw.enabled !== false,
    hub_channel_id: /^\d{17,20}$/.test(hubChannel) ? hubChannel : null,
    category_id: /^\d{17,20}$/.test(category) ? category : null,
    name_format: clip(raw.name_format, MAX_NAME_FORMAT) || DEFAULT_HUB.name_format,
    permission_source: raw.permission_source === "hub" ? "hub" : "category",
    creator_perms: boolMap(raw.creator_perms, DEFAULT_CREATOR_PERMS),
    user_limit: intBetween(raw.user_limit, 0, 99, 0),
    permanent_channel_ids: snowflakeList(raw.permanent_channel_ids, MAX_PERMANENT),
    settings_embed: raw.settings_embed !== false,
    access_role_ids: snowflakeList(raw.access_role_ids, MAX_ACCESS_ROLES),
    settings_allow_role_ids: snowflakeList(raw.settings_allow_role_ids, MAX_MOD_ROLES),
    settings_deny_role_ids: snowflakeList(raw.settings_deny_role_ids, MAX_MOD_ROLES),
    moderator_role_ids: snowflakeList(raw.moderator_role_ids, MAX_MOD_ROLES),
    untouchable_role_ids: snowflakeList(raw.untouchable_role_ids, MAX_MOD_ROLES),
    whitelist_perms: boolMap(raw.whitelist_perms, DEFAULT_WHITELIST_PERMS),
    enabled_buttons: boolMap(raw.enabled_buttons, DEFAULT_BUTTONS),
    settings_options: boolMap(raw.settings_options, DEFAULT_SETTINGS_OPTIONS),
    allow_claim: raw.allow_claim !== false,
    saves_enabled: !!raw.saves_enabled,
    custom_words: parseCustomWords(raw.custom_words),
  };
}

function parseTempVoiceGuildConfig(input) {
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
  };
}

module.exports = {
  MAX_HUBS_FREE,
  MAX_HUBS_PREMIUM,
  MAX_ACCESS_ROLES,
  MAX_MOD_ROLES,
  MAX_CUSTOM_WORDS,
  MAX_NAME_FORMAT,
  MAX_SAVES_PER_HUB,
  MAX_PERMANENT,
  DEFAULT_CREATOR_PERMS,
  DEFAULT_WHITELIST_PERMS,
  DEFAULT_BUTTONS,
  DEFAULT_SETTINGS_OPTIONS,
  DEFAULT_HUB,
  parseHubConfig,
  parseTempVoiceGuildConfig,
  snowflakeList,
  parseCustomWords,
  clip,
  intBetween,
};
