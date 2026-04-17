const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { setLogChannel } = require("../../database");
const { hasModAdminBypass } = require("../../memberPerms");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setlogchannel")
    .setDescription("Définit le salon où les logs seront envoyés")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName("salon")
        .setDescription("Le salon de logs")
        .setRequired(true)
    ),
  async execute(interaction) {
    if (!hasModAdminBypass(interaction.member)) {
      return interaction.reply({
        content:
          "❌ Tu dois être propriétaire du serveur ou avoir la permission Administrateur.",
        ephemeral: true,
      });
    }

    const channel = interaction.options.getChannel("salon");

    // Vérifier que c'est un salon textuel
    if (channel.type !== 0) {
      return interaction.reply({
        content: "❌ Veuillez sélectionner un salon textuel.",
        ephemeral: true,
      });
    }

    try {
      setLogChannel(interaction.guild.id, channel.id);

      await interaction.reply({
        content: `✅ Le salon de logs a été défini sur ${channel}.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("Erreur lors de la configuration du salon de logs:", error);
      await interaction.reply({
        content: "❌ Une erreur s'est produite lors de la configuration.",
        ephemeral: true,
      });
    }
  },
  executeMessage(message, args) {
    if (!hasModAdminBypass(message.member)) {
      return message.reply(
        "❌ Tu dois être propriétaire du serveur ou avoir la permission Administrateur."
      );
    }

    const channel = message.mentions.channels.first();

    if (!channel) {
      return message.reply(
        "❌ Veuillez mentionner un salon. Exemple: `$setlogchannel #logs`"
      );
    }

    // Vérifier que c'est un salon textuel
    if (channel.type !== 0) {
      return message.reply("❌ Veuillez sélectionner un salon textuel.");
    }

    try {
      setLogChannel(message.guild.id, channel.id);

      message.reply(`✅ Le salon de logs a été défini sur ${channel}.`);
    } catch (error) {
      console.error("Erreur lors de la configuration du salon de logs:", error);
      message.reply("❌ Une erreur s'est produite lors de la configuration.");
    }
  },
};
