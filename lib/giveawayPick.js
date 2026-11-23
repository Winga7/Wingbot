/**
 * Tirage au sort local (crypto). Aucune API réseau.
 * Utilisable en script de test hors Discord.
 */
const crypto = require("crypto");

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

/**
 * @param {string[]} userIds
 * @param {number} count
 * @param {{ exclude?: string[] }} [options]
 * @returns {string[]}
 */
function pickWinners(userIds, count, options = {}) {
  const exclude = new Set((options.exclude || []).map(String));
  const seen = new Set();
  const pool = [];
  for (const raw of userIds || []) {
    const id = String(raw || "");
    if (!/^\d{17,20}$/.test(id) || seen.has(id) || exclude.has(id)) continue;
    seen.add(id);
    pool.push(id);
  }
  const n = Math.min(Math.max(0, Math.floor(Number(count) || 0)), pool.length);
  if (n <= 0) return [];
  shuffleInPlace(pool);
  return pool.slice(0, n);
}

module.exports = { pickWinners, shuffleInPlace };
