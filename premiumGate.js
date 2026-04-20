/**
 * Couche Premium / VIP — source de vérité unique pour les accès payants.
 *
 * Modèle (depuis avril 2026) :
 *
 *   - FOUNDER (par USER) : toi (et qui que tu mettes en founder via .env ou
 *     la table `premium_users`). Bypass total partout, sur n'importe quel
 *     serveur, sans limite. Le seul "privilège user-global" qui reste.
 *
 *   - PREMIUM (par GUILD) : un serveur Discord est marqué premium dans la
 *     table `guild_premium`. Tous les membres de ce serveur profitent de
 *     TOUTES les features premium (modèle "all-or-nothing").
 *       • source = 'paid' : le serveur a payé (futur : intégration paiement)
 *       • source = 'gift' : offert gracieusement par un founder (l'ancien
 *         concept "VIP", mais désormais lié au serveur, pas à l'utilisateur).
 *
 *   - FREE : tout le reste.
 *
 * Pourquoi ce changement ? L'ancien modèle "user premium" permettait à un
 * user payant de profiter du premium sur 50 serveurs où il était admin (un
 * seul abonnement → 50 serveurs débloqués), ce qui n'était pas tenable
 * commercialement. Désormais, le serveur paie, et seul ce serveur est
 * débloqué — peu importe qui est admin dedans.
 */

const {
  getPremiumUser,
  getPremiumGuild,
  listPremiumGuilds,
} = require("./database");

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

/**
 * Catalogue des features premium. Modèle all-or-nothing : si la guild est
 * premium (ou si l'user est founder), TOUTES ces features sont accessibles.
 *
 * On garde le concept de `limits` par feature — utile pour les commandes
 * qui ont des quotas (slots de backup, etc.). Désormais ces limites sont
 * indexées par "tier de feature" (free / premium / founder), pas par tier
 * utilisateur.
 */
const FEATURES = {
  // Branding global du bot — réservé strictement au founder (impacte tous
  // les serveurs, ne peut pas être délégué).
  bot_avatar: { founderOnly: true },
  bot_nickname: { founderOnly: true },
  bot_global_profile: { founderOnly: true },

  // Backups (la commande tourne dans une guild → on check la guild)
  backup_create: {
    limits: {
      free: { slots: 0, max_messages_per_channel: 0 },
      premium: { slots: 50, max_messages_per_channel: 250 },
      founder: { slots: Infinity, max_messages_per_channel: 500 },
    },
  },
  backup_restore: {
    limits: {
      free: { restores_per_day: 0 },
      premium: { restores_per_day: 5 },
      founder: { restores_per_day: Infinity },
    },
  },
  backup_auto: {},

  // Custom commands étendues (au-delà du quota free)
  custom_commands_extended: {},
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

// ============================================================
//  Founder (par USER)
// ============================================================

/**
 * `true` si l'utilisateur est founder (env OU DB tier='founder' non expiré).
 * Le founder a le bypass total partout.
 */
function isFounder(userId) {
  const id = normalizeSnowflakeId(userId);
  if (!id) return false;
  if (ENV_FOUNDER_IDS.has(id)) return true;
  const row = getPremiumUser(id);
  return !!(row && row.tier === "founder" && !isExpired(row));
}

// ============================================================
//  Premium (par GUILD)
// ============================================================

/** `true` si le serveur a un accès premium actif. */
function isGuildPremium(guildId) {
  if (!guildId) return false;
  const row = getPremiumGuild(String(guildId));
  return !!(row && !isExpired(row));
}

/**
 * Tier effectif applicable à une (user, guild) :
 *   - 'founder' si l'user est founder
 *   - 'premium' si la guild est premium
 *   - 'free'   sinon
 */
function getEffectiveTier(userId, guildId) {
  if (isFounder(userId)) return "founder";
  if (isGuildPremium(guildId)) return "premium";
  return "free";
}

// ============================================================
//  Vérifications de features
// ============================================================

/**
 * `true` si (user, guild) peut utiliser la feature.
 *  - founder : oui partout
 *  - premium guild : oui sauf si la feature est `founderOnly`
 *  - free : non
 */
function canUseFeature(userId, guildId, featureKey) {
  const f = FEATURES[featureKey];
  if (!f) return true; // feature inconnue → on n'empêche pas
  if (isFounder(userId)) return true;
  if (f.founderOnly) return false;
  return isGuildPremium(guildId);
}

/**
 * Limite associée à une feature pour ce tier effectif.
 * Ex : `getFeatureLimit(userId, guildId, "backup_create", "slots")` → 50.
 */
function getFeatureLimit(userId, guildId, featureKey, key) {
  const f = FEATURES[featureKey];
  if (!f?.limits) return undefined;
  const tier = getEffectiveTier(userId, guildId);
  return f.limits[tier]?.[key];
}

// ============================================================
//  Listings (pour le dashboard / la console Fonda)
// ============================================================

/** Liste des serveurs premium actifs (filtre les expirés). */
function listActivePremiumGuilds() {
  return listPremiumGuilds().filter((r) => !isExpired(r));
}

/** Liste des founders (DB + .env), pour affichage admin. */
function listFounders() {
  const out = [];
  const seen = new Set();
  for (const id of ENV_FOUNDER_IDS) {
    seen.add(id);
    out.push({ user_id: id, source: "env", note: "Défini dans FOUNDER_DISCORD_IDS" });
  }
  // On ne charge pas tous les users de la DB ici : c'est marginal et l'env
  // est déjà la source principale en pratique. Si besoin d'admin user-side
  // un jour, on rajoutera un listFoundersFromDb().
  return out;
}

module.exports = {
  FEATURES,
  isFounder,
  isGuildPremium,
  getEffectiveTier,
  canUseFeature,
  getFeatureLimit,
  listActivePremiumGuilds,
  listFounders,
  normalizeSnowflakeId,
};
