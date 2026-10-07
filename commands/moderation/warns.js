const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { memberHasPermOrAdmin } = require("../../memberPerms");
const { listGuildWarnings, countGuildWarnings } = require("../../database");
const { replyCommand } = require("../../lib/commandReply");
const { resolveMessageUser } = require("../../lib/resolveTargets");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warns")
    .setDescription("Liste les avertissements actifs d’un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre").setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("membre", true);
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
    await interaction.deferReply({ ephemeral: true });
    return replyWarnList(interaction, user);
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
      return message.reply("Usage : `warns @membre`");
    }
    return replyWarnList(message, target);
  },
};

async function replyWarnList(ctx, user) {
  const guild = ctx.guild;
  const rows = listGuildWarnings(guild.id, { userId: user.id, limit: 15 });
  const total = countGuildWarnings(guild.id, user.id);

  if (rows.length === 0) {
    return replyCommand(ctx, {
      content: `${user.tag} n’a aucun avertissement actif.`,
      ephemeral: true,
    });
  }

  const lines = rows.map((w) => {
    const when = w.created_at ? String(w.created_at).slice(0, 16) : "?";
    const src = w.source === "antispam" ? "antispam" : "manuel";
    return `**#${w.id}** · ${when} · ${src}\n${w.reason}\n— ${w.moderator_tag || "?"}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xeab308)
    .setTitle(`Avertissements — ${user.tag}`)
    .setDescription(lines.join("\n\n").slice(0, 4000))
    .setFooter({ text: `Total actif : ${total} · unwarn <id> pour retirer` });

  return replyCommand(ctx, { embeds: [embed], ephemeral: true });
}
