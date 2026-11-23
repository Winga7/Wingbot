/** Test local — pas d'HTTP. node scripts/test-starboard-config.js */
const {
  parseStarboardConfig,
  emojiMatches,
  applyStarboardVars,
} = require("../lib/starboardConfig");

const cfg = parseStarboardConfig({
  enabled: true,
  channel_id: "123456789012345678",
  emoji: "⭐",
  min_reactions: 99,
  ignored_channel_ids: ["bad", "123456789012345679"],
});
if (cfg.min_reactions !== 25) throw new Error("min clamp");
if (cfg.ignored_channel_ids.length !== 1) throw new Error("ignore list");
if (!emojiMatches("⭐", { emoji: { name: "⭐" } })) throw new Error("emoji unicode");
if (!emojiMatches("<:star:123456789012345678>", { emoji: { id: "123456789012345678" } })) {
  throw new Error("emoji custom");
}
const text = applyStarboardVars("{emoji} {emoji.count} {message.url}", {
  emoji: "⭐",
  count: 4,
  url: "https://discord.com/channels/1/2/3",
});
if (!text.includes("4") || !text.includes("⭐")) throw new Error("vars");
console.log("ok", text);
