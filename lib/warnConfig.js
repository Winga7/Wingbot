/**
 * Configuration des avertissements par serveur (guild_config.warn_config).
 */
function defaultWarnConfig() {
  return {
    auto_timeout_enabled: true,
    warns_before_timeout: 3,
    timeout_minutes: 60,
    timeout_escalated_minutes: 240,
    dm_user: true,
  };
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function parseWarnConfig(raw) {
  const base = defaultWarnConfig();
  if (raw == null || String(raw).trim() === "") return base;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return base;
    return {
      auto_timeout_enabled: o.auto_timeout_enabled !== false,
      warns_before_timeout: clampInt(
        o.warns_before_timeout,
        1,
        20,
        base.warns_before_timeout
      ),
      timeout_minutes: clampInt(o.timeout_minutes, 1, 40320, base.timeout_minutes),
      timeout_escalated_minutes: clampInt(
        o.timeout_escalated_minutes,
        1,
        40320,
        base.timeout_escalated_minutes
      ),
      dm_user: o.dm_user !== false,
    };
  } catch {
    return base;
  }
}

function mergeWarnPatch(current, patch) {
  const cur = parseWarnConfig(JSON.stringify(current));
  if (!patch || typeof patch !== "object") return cur;
  const next = { ...cur };
  for (const key of [
    "auto_timeout_enabled",
    "warns_before_timeout",
    "timeout_minutes",
    "timeout_escalated_minutes",
    "dm_user",
  ]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = patch[key];
    }
  }
  return parseWarnConfig(JSON.stringify(next));
}

module.exports = {
  defaultWarnConfig,
  parseWarnConfig,
  mergeWarnPatch,
};
