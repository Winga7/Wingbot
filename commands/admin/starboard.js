const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { getStarboardConfig, setStarboardConfig } = require("../../database");
const { memberHasPermOrAdmin } = require("../../memberPerms");

function deny(send, text) {
  return send(`❌ ${text}`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("starboard")
    .setDescription("Configurer le starboard")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Active le starboard dans un salon")
        .addChannelOption((o) =>
          o
            .setName("salon")
            .setDescription("Salon où publier les messages mis en avant")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("minimum")
            .setDescription("Réactions minimum (1-25)")
            .setMinValue(1)
            .setMaxValue(25)
            .setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("emoji").setDescription("Émoji (défaut ⭐)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Désactive le starboard")
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Affiche la config actuelle")
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ Serveur uniquement.", ephemeral: true });
    }
    if (!memberHasPermOrAdmin(interaction.member, PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "❌ Il faut Gérer le serveur.",
        ephemeral: true,
      });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "setup") {
      const channel = interaction.options.getChannel("salon", true);
      const min = interaction.options.getInteger("minimum") || 3;
      const emoji = interaction.options.getString("emoji") || "⭐";
      const saved = setStarboardConfig(interaction.guildId, {
        ...getStarboardConfig(interaction.guildId),
        enabled: true,
        channel_id: channel.id,
        min_reactions: min,
        emoji,
      });
      return interaction.reply({
        content: `✅ Starboard actif dans ${channel} · ${saved.emoji} × ${saved.min_reactions}`,
        ephemeral: true,
      });
    }
    if (sub === "disable") {
      setStarboardConfig(interaction.guildId, {
        ...getStarboardConfig(interaction.guildId),
        enabled: false,
      });
      return interaction.reply({ content: "✅ Starboard désactivé.", ephemeral: true });
    }
    const cfg = getStarboardConfig(interaction.guildId);
    return interaction.reply({
      content:
        `Starboard : **${cfg.enabled ? "on" : "off"}**\n` +
        `Salon : ${cfg.channel_id ? `<#${cfg.channel_id}>` : "—"}\n` +
        `Émoji : ${cfg.emoji} · minimum : ${cfg.min_reactions}`,
      ephemeral: true,
    });
  },

  async executeMessage(message, args) {
    if (!message.guild) return;
    const send = (t) => message.reply(t);
    if (!memberHasPermOrAdmin(message.member, PermissionFlagsBits.ManageGuild)) {
      return deny(send, "Il faut Gérer le serveur.");
    }
    const sub = String(args[0] || "").toLowerCase();
    if (sub === "status" || !sub) {
      const cfg = getStarboardConfig(message.guild.id);
      return send(
        `Starboard : **${cfg.enabled ? "on" : "off"}** · ${cfg.channel_id ? `<#${cfg.channel_id}>` : "—"} · ${cfg.emoji} × ${cfg.min_reactions}`
      );
    }
    if (sub === "disable" || sub === "off") {
      setStarboardConfig(message.guild.id, {
        ...getStarboardConfig(message.guild.id),
        enabled: false,
      });
      return send("✅ Starboard désactivé.");
    }
    if (sub === "setup" || sub === "on") {
      const channel = message.mentions.channels.first() || message.channel;
      const min = /^\d+$/.test(String(args[1] || "")) ? Number(args[1]) : 3;
      const saved = setStarboardConfig(message.guild.id, {
        ...getStarboardConfig(message.guild.id),
        enabled: true,
        channel_id: channel.id,
        min_reactions: min,
      });
      return send(`✅ Starboard actif dans ${channel} · ${saved.emoji} × ${saved.min_reactions}`);
    }
    return deny(send, "Usage : `starboard setup #salon [min]` · `disable` · `status`");
  },
};
