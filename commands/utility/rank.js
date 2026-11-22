const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getLevelConfig, getMemberLevel, countMembersAboveXp } = require("../../database");
const { progressFromXp, progressBar } = require("../../lib/levelConfig");
const { resolveSlashMember, resolveMessageMember } = require("../../lib/resolveTargets");

function rankEmbed(guild, user, row, config) {
  const progress = progressFromXp(row?.xp || 0);
  const rank = countMembersAboveXp(guild.id, progress.total) + 1;
  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setAuthor({
      name: user.username,
      iconURL: user.displayAvatarURL({ extension: "png", size: 128 }),
    })
    .setTitle(`Niveau ${progress.level}`)
    .setDescription(
      `${progressBar(progress.into, progress.need)}\n` +
        `**${progress.into}** / **${progress.need}** XP vers le niveau suivant\n` +
        `Total : **${progress.total}** XP · Rang **#${rank}**`
    )
    .setFooter({
      text: config.enabled
        ? guild.name
        : `${guild.name} · le gain d'XP est désactivé`,
    });
  return embed;
}

async function replyRank(guild, user, send) {
  if (!guild || !user) {
    return send("❌ Utilise cette commande sur un serveur.");
  }
  if (user.bot) {
    return send("❌ Les bots n'ont pas de niveau.");
  }
  const config = getLevelConfig(guild.id);
  const row = getMemberLevel(guild.id, user.id);
  return send({ embeds: [rankEmbed(guild, user, row, config)] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Affiche le niveau et l'XP d'un membre")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Membre à consulter").setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ Commande de serveur uniquement.", ephemeral: true });
    }
    const picked = interaction.options.getUser("membre");
    let user = picked || interaction.user;
    if (picked) {
      const member = await resolveSlashMember(interaction, "membre");
      user = member?.user || picked;
    }
    await replyRank(interaction.guild, user, (payload) => {
      const body = typeof payload === "string" ? { content: payload, ephemeral: true } : { ...payload, ephemeral: false };
      return interaction.reply(body);
    });
  },

  async executeMessage(message, args) {
    if (!message.guild) return;
    const member = args[0] ? await resolveMessageMember(message, args[0]) : message.member;
    const user = member?.user || (args[0] ? null : message.author);
    if (args[0] && !user) {
      return message.reply("❌ Membre introuvable.");
    }
    await replyRank(message.guild, user, (payload) => message.reply(payload));
  },
};
