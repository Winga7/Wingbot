const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getLogChannel, getLogSettings } = require("../../database");
const { hasModAdminBypass } = require("../../memberPerms");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("logconfig")
    .setDescription("Affiche la configuration actuelle des logs")
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
    const settings = getLogSettings(interaction.guild.id);

    const statusEmoji = (enabled) => (enabled ? "✅" : "❌");

    const configEmbed = {
      color: 0x00ff00,
      title: "⚙️ Configuration des Logs",
      fields: [
        {
          name: "Salon de logs",
          value: logChannelId ? `<#${logChannelId}>` : "❌ Non configuré",
          inline: false,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: false,
        },
        {
          name: "📝 Messages",
          value: `${statusEmoji(settings.log_messages)} ${
            settings.log_messages ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "👥 Membres",
          value: `${statusEmoji(settings.log_members)} ${
            settings.log_members ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "🔊 Vocal",
          value: `${statusEmoji(settings.log_voice)} ${
            settings.log_voice ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "🎭 Rôles",
          value: `${statusEmoji(settings.log_roles)} ${
            settings.log_roles ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "🔨 Modération",
          value: `${statusEmoji(settings.log_moderation)} ${
            settings.log_moderation ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "⚙️ Serveur",
          value: `${statusEmoji(settings.log_server)} ${
            settings.log_server ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
      ],
      footer: {
        text: "Wingbot - Créé par Winga",
        icon_url: interaction.client.user.displayAvatarURL(),
      },
      timestamp: new Date(),
    };

    await interaction.reply({ embeds: [configEmbed], ephemeral: true });
  },
  executeMessage(message, args) {
    if (!hasModAdminBypass(message.member)) {
      return message.reply(
        "❌ Tu dois être propriétaire du serveur ou avoir la permission Administrateur."
      );
    }

    const logChannelId = getLogChannel(message.guild.id);
    const settings = getLogSettings(message.guild.id);

    const statusEmoji = (enabled) => (enabled ? "✅" : "❌");

    const configEmbed = {
      color: 0x00ff00,
      title: "⚙️ Configuration des Logs",
      fields: [
        {
          name: "Salon de logs",
          value: logChannelId ? `<#${logChannelId}>` : "❌ Non configuré",
          inline: false,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: false,
        },
        {
          name: "📝 Messages",
          value: `${statusEmoji(settings.log_messages)} ${
            settings.log_messages ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "👥 Membres",
          value: `${statusEmoji(settings.log_members)} ${
            settings.log_members ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "🔊 Vocal",
          value: `${statusEmoji(settings.log_voice)} ${
            settings.log_voice ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "🎭 Rôles",
          value: `${statusEmoji(settings.log_roles)} ${
            settings.log_roles ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "🔨 Modération",
          value: `${statusEmoji(settings.log_moderation)} ${
            settings.log_moderation ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "⚙️ Serveur",
          value: `${statusEmoji(settings.log_server)} ${
            settings.log_server ? "Activé" : "Désactivé"
          }`,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
      ],
      footer: {
        text: "Wingbot - Créé par Winga",
        icon_url: message.client.user.displayAvatarURL(),
      },
      timestamp: new Date(),
    };

    message.reply({ embeds: [configEmbed] });
  },
};
