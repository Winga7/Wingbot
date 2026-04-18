const { SlashCommandBuilder } = require("discord.js");

const INFOS = [
  "ping",
  "user",
  "userinfo",
  "server",
  "serverlogo",
  "botinfo",
  "roleinfo",
  "avatar",
  "messageinfo",
];

const MODERATION = [
  "kick",
  "ban",
  "timeout",
  "untimeout",
  "warn",
  "slowmode",
  "clear",
];

const ADMIN = [
  "setlogchannel",
  "togglelog",
  "logconfig",
  "logtest",
  "clearcache",
];

const PREMIUM = [
  "backup create",
  "backup list",
  "backup info <code>",
  "backup delete <code>",
  "backup load <code>",
];

function fmt(list) {
  return list.map((c) => `\`${c}\``).join(" ");
}

function buildEmbed() {
  return {
    color: 0x6366f1,
    title: "Commandes Wingbot",
    description:
      "Toutes les commandes fonctionnent en **slash** (`/`) et en **préfixe** (défaut `$`, configurable).\n" +
      "_La commande `help` est toujours active, même si tu désactives d'autres commandes._",
    fields: [
      { name: "📋 Infos", value: fmt(INFOS), inline: false },
      { name: "🛡️ Modération", value: fmt(MODERATION), inline: false },
      { name: "⚙️ Admin", value: fmt(ADMIN), inline: false },
      {
        name: "💎 Premium _(admin uniquement)_",
        value: fmt(PREMIUM),
        inline: false,
      },
      {
        name: "✨ Commandes perso",
        value:
          "Réponses configurables depuis le dashboard. _Préfixe uniquement._",
        inline: false,
      },
    ],
    timestamp: new Date(),
    footer: { text: "Wingbot · tape /help ou $help" },
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Affiche la liste des commandes disponibles."),
  async execute(interaction) {
    await interaction.reply({ embeds: [buildEmbed()] });
  },
  executeMessage(message) {
    message.reply({ embeds: [buildEmbed()] });
  },
};
