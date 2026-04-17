/**
 * Génère des codes de backup courts, lisibles, non ambigus.
 * Format : WB-XXXX-XXXX (ex. WB-3F7A-K2QM)
 * Alphabet sans 0/O, 1/I/L pour éviter les confusions.
 */

const { codeExists } = require("../database");

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomSegment(len = 4) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function generateCode() {
  return `WB-${randomSegment(4)}-${randomSegment(4)}`;
}

/** Renvoie un code garanti unique en DB (retry max 20 fois par sécurité). */
function generateUniqueCode() {
  for (let i = 0; i < 20; i++) {
    const code = generateCode();
    if (!codeExists(code)) return code;
  }
  throw new Error("Impossible de générer un code unique (collision répétée)");
}

function normalizeCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isValidCode(code) {
  return /^WB-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(normalizeCode(code));
}

module.exports = {
  generateCode,
  generateUniqueCode,
  normalizeCode,
  isValidCode,
};
