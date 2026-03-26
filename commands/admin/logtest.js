const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { getLogChannel } = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("logtest")
    .setDescription("Envoie un message test dans le salon de logs")
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

    const logChannelId = getLogChannel(interaction.guild.id);
    if (!logChannelId) {
      return interaction.reply({
        content: "❌ Aucun salon de logs n'est configuré. Utilisez `/setlogchannel`.",
        ephemeral: true,
      });
    }

    const logChannel =
      interaction.guild.channels.cache.get(logChannelId) ||
      (await interaction.guild.channels.fetch(logChannelId).catch(() => null));

    if (!logChannel || !logChannel.isTextBased?.()) {
      return interaction.reply({
        content: "❌ Je ne peux pas accéder au salon de logs configuré.",
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🧪 Test des logs")
      .setDescription(
        "Si tu vois ce message, c'est que le bot envoie correctement dans le salon de logs."
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });

    return interaction.reply({
      content: "✅ Test envoyé dans le salon de logs.",
      ephemeral: true,
    });
  },

  executeMessage(message) {
    if (!message.member.permissions.has("Administrator")) {
      return message.reply(
        "❌ Vous devez être administrateur pour utiliser cette commande."
      );
    }

    const logChannelId = getLogChannel(message.guild.id);
    if (!logChannelId) {
      return message.reply(
        "❌ Aucun salon de logs n'est configuré. Utilisez `$setlogchannel #salon`."
      );
    }

    const logChannel = message.guild.channels.cache.get(logChannelId);
    if (!logChannel || !logChannel.isTextBased?.()) {
      return message.reply(
        "❌ Je ne peux pas accéder au salon de logs configuré."
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🧪 Test des logs")
      .setDescription(
        "Si tu vois ce message, c'est que le bot envoie correctement dans le salon de logs."
      )
      .setTimestamp();

    logChannel.send({ embeds: [embed] }).catch(() => null);
    return message.reply("✅ Test envoyé dans le salon de logs.");
  },
};

