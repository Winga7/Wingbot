const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { memberHasPermOrAdmin } = require("../../memberPerms");
const {
  deleteGuildWarning,
  getGuildWarningById,
  countGuildWarnings,
  clearGuildWarningsForUser,
} = require("../../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unwarn")
    .setDescription("Retire un avertissement (par ID) ou tous ceux d’un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((o) =>
      o.setName("warn_id").setDescription("ID du warn à retirer").setMinValue(1)
    )
    .addUserOption((o) =>
      o.setName("membre").setDescription("Retirer tous les warns du membre")
    ),

  async execute(interaction) {
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
    const warnId = interaction.options.getInteger("warn_id");
    const user = interaction.options.getUser("membre");
    if (!warnId && !user) {
      return interaction.reply({
        content: "Indique `warn_id` ou `membre`.",
        ephemeral: true,
      });
    }
    return runUnwarn(interaction, interaction.guild.id, warnId, user);
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
    const sub = (args[0] || "").toLowerCase();
    if (sub === "all" || sub === "clear") {
      const target =
        message.mentions.users.first() ||
        (args[1] &&
          message.client.users.cache.get(String(args[1]).replace(/\D/g, "")));
      if (!target) {
        return message.reply("Usage : `unwarn all @membre`");
      }
      return runUnwarn(message, message.guild.id, null, target);
    }
    const id = parseInt(args[0], 10);
    if (!Number.isInteger(id) || id < 1) {
      return message.reply("Usage : `unwarn <warn_id>` ou `unwarn all @membre`");
    }
    return runUnwarn(message, message.guild.id, id, null);
  },
};

async function runUnwarn(ctx, guildId, warnId, user) {
  if (user) {
    const n = clearGuildWarningsForUser(guildId, user.id);
    const text = `✅ ${n} avertissement(s) retiré(s) pour **${user.tag}**.`;
    if (ctx.reply) return ctx.reply({ content: text, ephemeral: !!ctx.user });
    return ctx.reply(text);
  }

  const row = getGuildWarningById(guildId, warnId);
  if (!row) {
    const text = `❌ Warn #${warnId} introuvable sur ce serveur.`;
    if (ctx.reply) return ctx.reply({ content: text, ephemeral: !!ctx.user });
    return ctx.reply(text);
  }

  deleteGuildWarning(guildId, warnId);
  const remaining = countGuildWarnings(guildId, row.user_id);

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("Avertissement retiré")
    .setDescription(
      [
        `**Warn #${warnId}** supprimé`,
        `**Membre :** <@${row.user_id}> (\`${row.user_id}\`)`,
        `**Reste actif :** ${remaining}`,
      ].join("\n")
    );

  if (ctx.reply) return ctx.reply({ embeds: [embed], ephemeral: !!ctx.user });
  return ctx.reply({ embeds: [embed] });
}
