const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { getLogChannel } = require("../../database");
const { hasModAdminBypass } = require("../../memberPerms");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("logtest")
    .setDescription("Envoie un message test dans le salon de logs")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!hasModAdminBypass(interaction.member)) {
      return interaction.reply({
        content:
          "❌ Tu dois être propriétaire du serveur ou avoir la permission Administrateur.",
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

    const idsTest = [
      `${interaction.guild.name} (\`${interaction.guild.id}\`)`,
      `Salon logs <#${logChannel.id}> (\`${logChannel.id}\`)`,
      `Demandeur ${interaction.user} (\`${interaction.user.id}\`)`,
    ].join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🧪 Test du salon de logs")
      .setDescription(
        "Si tu vois ce message, le bot écrit bien dans le salon de logs configuré."
      )
      .addFields({ name: "IDs", value: idsTest.substring(0, 1024), inline: false })
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });

    return interaction.reply({
      content: "✅ Test envoyé dans le salon de logs.",
      ephemeral: true,
    });
  },

  executeMessage(message) {
    if (!hasModAdminBypass(message.member)) {
      return message.reply(
        "❌ Tu dois être propriétaire du serveur ou avoir la permission Administrateur."
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

    const idsTest = [
      `${message.guild.name} (\`${message.guild.id}\`)`,
      `Salon logs <#${logChannel.id}> (\`${logChannel.id}\`)`,
      `Demandeur ${message.author} (\`${message.author.id}\`)`,
    ].join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🧪 Test du salon de logs")
      .setDescription(
        "Si tu vois ce message, le bot écrit bien dans le salon de logs configuré."
      )
      .addFields({ name: "IDs", value: idsTest.substring(0, 1024), inline: false })
      .setTimestamp();

    logChannel.send({ embeds: [embed] }).catch(() => null);
    return message.reply("✅ Test envoyé dans le salon de logs.");
  },
};

