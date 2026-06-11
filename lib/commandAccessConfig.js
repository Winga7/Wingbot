/**
 * Configuration d'accès aux commandes par salon / rôle (guild_config.command_access).
 */

const ACCESS_LIST_KEYS = [
  "ignore_channel_ids",
  "allow_channel_ids",
  "block_role_ids",
  "allow_role_ids",
  "moderation_role_ids",
  "admin_role_ids",
  "premium_role_ids",
  "staff_role_ids",
];

/** Catégorie commandsManifest → clé de rôles requis */
const CATEGORY_ROLE_KEY = {
  moderation: "moderation_role_ids",
  admin: "admin_role_ids",
  premium: "premium_role_ids",
};

const CATEGORY_LABEL = {
  moderation: "modération",
  admin: "administration",
  premium: "premium",
};

function defaultCommandAccess() {
  return {
    ignore_channel_ids: [],
    allow_channel_ids: [],
    block_role_ids: [],
    allow_role_ids: [],
    moderation_role_ids: [],
    admin_role_ids: [],
    premium_role_ids: [],
    staff_role_ids: [],
  };
}

function normalizeSnowflakeList(arr, max = 80) {
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

function parseCommandAccess(raw) {
  const base = defaultCommandAccess();
  if (raw == null || String(raw).trim() === "") return base;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return base;

    const out = { ...base };
    for (const key of ACCESS_LIST_KEYS) {
      if (Object.prototype.hasOwnProperty.call(o, key)) {
        out[key] = normalizeSnowflakeList(o[key]);
      }
    }

    const legacyStaff = out.staff_role_ids;
    if (
      !out.moderation_role_ids.length &&
      !out.admin_role_ids.length &&
      legacyStaff.length
    ) {
      out.moderation_role_ids = [...legacyStaff];
      out.admin_role_ids = [...legacyStaff];
    }

    return out;
  } catch {
    return base;
  }
}

function mergeCommandAccessPatch(current, patch) {
  const next = { ...current };
  for (const key of ACCESS_LIST_KEYS) {
    if (key === "staff_role_ids") continue;
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      const v = patch[key];
      if (!Array.isArray(v)) {
        throw new Error(`command_access.${key} doit être un tableau d'IDs`);
      }
      next[key] = normalizeSnowflakeList(v);
    }
  }
  next.staff_role_ids = [];
  return next;
}

function staffRolesUnion(cfg) {
  const s = new Set([
    ...(cfg?.moderation_role_ids || []),
    ...(cfg?.admin_role_ids || []),
    ...(cfg?.premium_role_ids || []),
    ...(cfg?.staff_role_ids || []),
  ]);
  return [...s];
}

module.exports = {
  ACCESS_LIST_KEYS,
  CATEGORY_ROLE_KEY,
  CATEGORY_LABEL,
  defaultCommandAccess,
  normalizeSnowflakeList,
  parseCommandAccess,
  mergeCommandAccessPatch,
  staffRolesUnion,
};
