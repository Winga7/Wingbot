const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { memberHasPermOrAdmin } = require("../../memberPerms");
const { issueWarning } = require("../../lib/warnService");
const { getWarnConfig } = require("../../database");
const { replyCommand } = require("../../lib/commandReply");
const {
  resolveSlashMember,
  resolveMessageUser,
  resolveMessageMember,
} = require("../../lib/resolveTargets");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Enregistre un avertissement pour un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre averti").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("raison").setDescription("Raison").setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("membre", true);
    const reason = interaction.options.getString("raison", true).slice(0, 500);

    if (
      !memberHasPermOrAdmin(
        interaction.member,
        PermissionFlagsBits.ModerateMembers
      )
    ) {
      return interaction.reply({
        content: "❌ Tu n’as pas la permission de modérer les membres.",
        ephemeral: true,
      });
    }
    if (user.id === interaction.user.id) {
      return interaction.reply({
        content: "❌ Tu ne peux pas t’avertir toi-même.",
        ephemeral: true,
      });
    }
    if (user.bot) {
      return interaction.reply({
        content: "❌ Impossible d’avertir un bot.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    try {
      const targetMember = await resolveSlashMember(interaction, "membre");
      const result = await issueWarning({
        guild: interaction.guild,
        targetUser: user,
        moderator: interaction.user,
        reason,
        source: "manual",
        targetMember,
      });

      const cfg = getWarnConfig(interaction.guild.id);
      const embed = new EmbedBuilder()
        .setColor(result.timeoutMin > 0 ? 0xef4444 : 0xeab308)
        .setTitle("Avertissement enregistré")
        .setDescription(
          [
            `${user} — **warn #${result.warning.id}**`,
            `**Raison :** ${reason}`,
            `**Total actif :** ${result.total}/${cfg.warns_before_timeout}`,
            result.timeoutMin > 0
              ? `**Sourdine auto :** ${result.timeoutMin} min`
              : null,
          ]
            .filter(Boolean)
            .join("\n")
        )
        .setFooter({ text: `Par ${interaction.user.tag}` })
        .setTimestamp();

      await replyCommand(interaction, { embeds: [embed] });
    } catch (e) {
      console.error("[warn]", e);
      await replyCommand(interaction, {
        content: "❌ Impossible d’enregistrer cet avertissement.",
      });
    }
  },

  async executeMessage(message, args) {
    if (
      !memberHasPermOrAdmin(
        message.member,
        PermissionFlagsBits.ModerateMembers
      )
    ) {
      return message.reply(
        "❌ Tu n’as pas la permission de modérer les membres."
      );
    }
    const target = await resolveMessageUser(message, args[0]);
    if (!target) {
      return message.reply("Usage : `warn @membre <raison>`");
    }
    const reason = args.slice(1).join(" ").trim();
    if (!reason) {
      return message.reply("Indique une raison.");
    }
    if (target.id === message.author.id) {
      return message.reply("❌ Tu ne peux pas t’avertir toi-même.");
    }
    if (target.bot) {
      return message.reply("❌ Impossible d’avertir un bot.");
    }

    const targetMember = await resolveMessageMember(message, target.id);

    const result = await issueWarning({
      guild: message.guild,
      targetUser: target,
      moderator: message.author,
      reason: reason.slice(0, 500),
      source: "manual",
      targetMember,
    });

    const cfg = getWarnConfig(message.guild.id);
    const embed = new EmbedBuilder()
      .setColor(result.timeoutMin > 0 ? 0xef4444 : 0xeab308)
      .setTitle("Avertissement enregistré")
      .setDescription(
        [
          `${target} — **warn #${result.warning.id}**`,
          `**Raison :** ${reason.slice(0, 500)}`,
          `**Total actif :** ${result.total}/${cfg.warns_before_timeout}`,
          result.timeoutMin > 0
            ? `**Sourdine auto :** ${result.timeoutMin} min`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .setFooter({ text: `Par ${message.author.tag}` })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  },
};
