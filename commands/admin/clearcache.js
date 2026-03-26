const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const { cleanOldMessages } = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clearcache")
    .setDescription("Nettoie le cache des messages (plus de 7 jours)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: "❌ Vous devez être administrateur pour utiliser cette commande.",
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
    if (!message.member.permissions.has("Administrator")) {
      return message.reply(
        "❌ Vous devez être administrateur pour utiliser cette commande."
      );
    }

    cleanOldMessages();
    return message.reply("✅ Cache de messages nettoyé (entrées > 7 jours).");
  },
};

