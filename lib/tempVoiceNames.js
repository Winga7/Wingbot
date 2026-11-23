const { pickRandomWord } = require("./tempVoiceWords");

function formatTempVoiceName(format, { member, index, customWords }) {
  const display =
    member?.displayName ||
    member?.nickname ||
    member?.user?.globalName ||
    member?.user?.username ||
    "Membre";
  const username = member?.user?.username || display;
  const tag = member?.user?.tag || username;
  const random = pickRandomWord();
  const custom = pickRandomWord(customWords && customWords.length ? customWords : [random]);

  let name = String(format || "Salon de {user}");
  name = name
    .replaceAll("{user.username}", username)
    .replaceAll("{user.tag}", tag)
    .replaceAll("{user}", display)
    .replaceAll("{index}", String(index || 1))
    .replaceAll("{random_word}", random)
    .replaceAll("{custom_word}", custom);

  name = name.replace(/\s+/g, " ").trim().slice(0, 100);
  return name || `Salon de ${display}`.slice(0, 100);
}

module.exports = { formatTempVoiceName };
