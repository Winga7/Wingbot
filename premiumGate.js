/**
 * Couche Premium / VIP : source de vérité unique pour les tiers utilisateurs.
 *
 * Tiers (ordre décroissant de pouvoir) :
 *   - founder : accès total, gère les autres tiers, bypass quotas
 *   - vip     : accès total aussi (offert par un founder)
 *   - premium : features payantes
 *   - free    : par défaut
 *
 * Les founders sont définis dans .env (FOUNDER_DISCORD_IDS) ET peuvent
 * également exister en DB (avec tier='founder'). L'env sert de seed pour
 * qu'un admin ne puisse jamais se retrouver verrouillé hors du système.
 */

const { getPremiumUser, listPremiumUsers } = require("./database");

function csvSet(raw) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

const ENV_FOUNDER_IDS = csvSet(
  process.env.FOUNDER_DISCORD_IDS || process.env.FOUNDER_DISCORD_ID
);
const ENV_PREMIUM_IDS = csvSet(process.env.PREMIUM_USER_IDS);

const TIER_RANK = { free: 0, premium: 1, vip: 2, founder: 3 };

/**
 * Matrice des features. Chaque entrée déclare le tier MINIMUM requis.
 * `limit` : valeur max associée au tier (ex. slots de backup, taille, etc.)
 */
const FEATURES = {
  // Branding
  bot_avatar: { minTier: "founder" },
  bot_nickname: { minTier: "founder" },
  bot_global_profile: { minTier: "founder" },

  // Backups
  backup_create: {
    minTier: "premium",
    limits: {
      premium: { slots: 15, max_messages_per_channel: 100 },
      vip: { slots: 50, max_messages_per_channel: 250 },
      founder: { slots: Infinity, max_messages_per_channel: 500 },
    },
  },
  backup_restore: {
    minTier: "premium",
    limits: {
      premium: { restores_per_day: 1 },
      vip: { restores_per_day: 5 },
      founder: { restores_per_day: Infinity },
    },
  },
  backup_auto: { minTier: "vip" },

  // Custom commands (exemple d'upsell futur)
  custom_commands_extended: { minTier: "premium" },
};

function normalizeSnowflakeId(x) {
  const s = String(x ?? "").replace(/\D/g, "");
  return /^\d{17,20}$/.test(s) ? s : null;
}

function isExpired(row) {
  if (!row || !row.expires_at) return false;
  const t = Date.parse(row.expires_at);
  return Number.isFinite(t) && t < Date.now();
}

/**
 * Retourne le tier effectif d'un utilisateur : 'founder' | 'vip' | 'premium' | 'free'.
 * La valeur la plus élevée gagne entre .env et la DB (et on ignore les rangées expirées).
 */
function getUserTier(userId) {
  const id = normalizeSnowflakeId(userId);
  if (!id) return "free";
  if (ENV_FOUNDER_IDS.has(id)) return "founder";

  const row = getPremiumUser(id);
  const dbTier = row && !isExpired(row) ? row.tier : null;
  const envTier = ENV_PREMIUM_IDS.has(id) ? "premium" : null;

  let best = "free";
  for (const t of [dbTier, envTier]) {
    if (t && TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}

function isFounder(userId) {
  return getUserTier(userId) === "founder";
}

/** true si l'utilisateur a au moins `minTier` */
function atLeast(userId, minTier) {
  return TIER_RANK[getUserTier(userId)] >= (TIER_RANK[minTier] ?? 99);
}

function canUseFeature(userId, featureKey) {
  const f = FEATURES[featureKey];
  if (!f) return true;
  return atLeast(userId, f.minTier);
}

function getFeatureLimit(userId, featureKey, key) {
  const f = FEATURES[featureKey];
  if (!f?.limits) return undefined;
  const tier = getUserTier(userId);
  return f.limits[tier]?.[key];
}

/**
 * Liste les VIP/premium actifs (et inclut les founders .env sous forme synthétique
 * pour que l'UI dashboard puisse les afficher).
 */
function listActivePremiumUsers() {
  const rows = listPremiumUsers();
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (isExpired(r)) continue;
    seen.add(r.user_id);
    out.push({ ...r, source: "db" });
  }
  for (const id of ENV_FOUNDER_IDS) {
    if (seen.has(id)) continue;
    out.push({
      user_id: id,
      tier: "founder",
      granted_by: null,
      granted_at: null,
      expires_at: null,
      note: "Défini dans .env (FOUNDER_DISCORD_IDS)",
      source: "env",
    });
  }
  return out;
}

module.exports = {
  TIER_RANK,
  FEATURES,
  getUserTier,
  isFounder,
  atLeast,
  canUseFeature,
  getFeatureLimit,
  listActivePremiumUsers,
  normalizeSnowflakeId,
};
