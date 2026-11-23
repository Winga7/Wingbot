/** Starboard : un salon pour les messages les plus réagis. */

const MAX_IGNORED = 40;
const MAX_ROLES = 20;
const MAX_CONTENT = 300;

const DEFAULT_STARBOARD = {
  enabled: false,
  channel_id: null,
  emoji: "⭐",
  min_reactions: 3,
  ignore_bots: true,
  remove_self_stars: true,
  use_embed: true,
  embed_color: "#fbbf24",
  content: "{emoji} **{emoji.count}** | {message.url}",
  ignored_channel_ids: [],
  allowed_channel_ids: [],
  voter_role_ids: [],
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

function normalizeEmoji(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "⭐";
  const custom = text.match(/^<?a?:([\w~]+):(\d{17,20})>?$/);
  if (custom) return `<:${custom[1]}:${custom[2]}>`;
  return text.slice(0, 32);
}

function parseHexColor(raw, fallback) {
  const text = String(raw ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  return fallback;
}

function parseStarboardConfig(input) {
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
  return {
    enabled: !!raw.enabled,
    channel_id: /^\d{17,20}$/.test(channel) ? channel : null,
    emoji: normalizeEmoji(raw.emoji),
    min_reactions: intBetween(raw.min_reactions, 1, 25, 3),
    ignore_bots: raw.ignore_bots !== false,
    remove_self_stars: raw.remove_self_stars !== false,
    use_embed: raw.use_embed !== false,
    embed_color: parseHexColor(raw.embed_color, "#fbbf24"),
    content: clip(raw.content, MAX_CONTENT) || DEFAULT_STARBOARD.content,
    ignored_channel_ids: snowflakeList(raw.ignored_channel_ids, MAX_IGNORED),
    allowed_channel_ids: snowflakeList(raw.allowed_channel_ids, MAX_IGNORED),
    voter_role_ids: snowflakeList(raw.voter_role_ids, MAX_ROLES),
  };
}

function applyStarboardVars(template, { emoji, count, url }) {
  return String(template || "")
    .replaceAll("{emoji.count}", String(count))
    .replaceAll("{emoji}", String(emoji))
    .replaceAll("{message.url}", String(url));
}

function emojiMatches(configEmoji, reaction) {
  const conf = String(configEmoji || "");
  const custom = conf.match(/^<?a?:([\w~]+):(\d{17,20})>?$/);
  if (custom) {
    return reaction.emoji?.id === custom[2];
  }
  return reaction.emoji?.name === conf || reaction.emoji?.identifier === conf;
}

module.exports = {
  DEFAULT_STARBOARD,
  MAX_IGNORED,
  MAX_ROLES,
  parseStarboardConfig,
  applyStarboardVars,
  emojiMatches,
  normalizeEmoji,
};
