/** Mots aléatoires prédéfinis (équivalent {random_word} DraftBot). */
const RANDOM_WORDS = [
  "trampoline",
  "comète",
  "nébuleuse",
  "phoenix",
  "aurora",
  "cascade",
  "mirage",
  "eclipse",
  "onyx",
  "zenith",
  "vortex",
  "cristal",
  "horizon",
  "pulsar",
  "nova",
  "sable",
  "orage",
  "brume",
  "falcon",
  "lynx",
  "cobalt",
  "jade",
  "ember",
  "rift",
  "oasis",
  "pixel",
  "quark",
  "radar",
  "sonar",
  "turbo",
];

function pickRandomWord(list = RANDOM_WORDS) {
  const pool = Array.isArray(list) && list.length ? list : RANDOM_WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { RANDOM_WORDS, pickRandomWord };
