/**
 * Clés emoji stables pour reaction roles (DB + API Discord).
 * Unicode : "✅"
 * Custom  : "name:123456789012345678"
 */

function reactionToKey(reaction) {
  const em = reaction?.emoji;
  if (!em) return null;
  if (em.id) return `${em.name}:${em.id}`;
  return em.name || null;
}

function emojiKeyToApiPath(key) {
  const k = String(key || "").trim();
  if (!k) throw new Error("emoji vide");
  if (k.includes(":")) {
    const [name, id] = k.split(":");
    if (!name || !/^\d{17,20}$/.test(id)) {
      throw new Error(`emoji custom invalide : ${k}`);
    }
    return encodeURIComponent(`${name}:${id}`);
  }
  return encodeURIComponent(k);
}

function parseEmojiInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const custom = s.match(/^<a?:([^:]+):(\d{17,20})>$/);
  if (custom) return `${custom[1]}:${custom[2]}`;
  if (/^\w+:\d{17,20}$/.test(s)) return s;
  if (s.length <= 32) return s;
  return null;
}

module.exports = {
  reactionToKey,
  emojiKeyToApiPath,
  parseEmojiInput,
};
