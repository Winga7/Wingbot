const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const { cleanOldMessages } = require("../../database");
const { hasModAdminBypass } = require("../../memberPerms");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clearcache")
    .setDescription("Nettoie le cache des messages (plus de 7 jours)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!hasModAdminBypass(interaction.member)) {
      return interaction.reply({
        content:
          "❌ Tu dois être propriétaire du serveur ou avoir la permission Administrateur.",
        ephemeral: true,
      });
    }

    // Le cache est auto-nettoyé de toute façon (tous les jours).
    // Ici on force simplement la suppression des entrées > 7 jours.
    cleanOldMessages();

    return interaction.reply({
      content: "✅ Cache de messages nettoyé (entrées > 7 jours).",
      ephemeral: true,
    });
  },

  executeMessage(message) {
    if (!hasModAdminBypass(message.member)) {
      return message.reply(
        "❌ Tu dois être propriétaire du serveur ou avoir la permission Administrateur."
      );
    }

    cleanOldMessages();
    return message.reply("✅ Cache de messages nettoyé (entrées > 7 jours).");
  },
};
