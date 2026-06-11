const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { memberHasPermOrAdmin } = require("../../memberPerms");
const { listGuildWarnings, countGuildWarnings } = require("../../database");

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
    return replyWarnList(interaction, user);
  },

  executeMessage(message, args) {
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
    const target =
      message.mentions.users.first() ||
      (args[0] &&
        message.client.users.cache.get(String(args[0]).replace(/\D/g, "")));
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
    const text = `${user.tag} n’a aucun avertissement actif.`;
    if (ctx.reply) {
      return ctx.reply({ content: text, ephemeral: !!ctx.user });
    }
    return ctx.reply(text);
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

  if (ctx.reply) {
    return ctx.reply({ embeds: [embed], ephemeral: !!ctx.user });
  }
  return ctx.reply({ embeds: [embed] });
}
