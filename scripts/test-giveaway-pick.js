/**
 * Test local uniquement — pas d'HTTP, pas de Discord.
 * Usage : node scripts/test-giveaway-pick.js
 */
const { pickWinners } = require("../lib/giveawayPick");
const { parseDurationMs, parseGiveawayConfig } = require("../lib/giveawayConfig");

const pool = [
  "111111111111111111",
  "222222222222222222",
  "333333333333333333",
  "444444444444444444",
  "555555555555555555",
];

const winners = pickWinners(pool, 2);
if (winners.length !== 2) throw new Error("count");
if (winners.some((id) => !pool.includes(id))) throw new Error("pool");
if (new Set(winners).size !== 2) throw new Error("unique");

const excluded = pickWinners(pool, 2, { exclude: [winners[0]] });
if (excluded.includes(winners[0])) throw new Error("exclude");

if (pickWinners(["not-an-id", "111"], 5).length !== 0) throw new Error("snowflake");
if (parseDurationMs("30s") !== null) throw new Error("min duration");
if (parseDurationMs("1m") !== 60_000) throw new Error("1m");
if (parseDurationMs("2h") !== 2 * 3600_000) throw new Error("2h");
if (parseGiveawayConfig({ enabled: true, max_active: 99 }).max_active !== 10) {
  throw new Error("max_active clamp");
}

console.log("ok", winners.join(","));
