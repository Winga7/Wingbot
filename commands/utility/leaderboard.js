const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getLevelConfig, listLevelLeaderboard } = require("../../database");
const { progressFromXp } = require("../../lib/levelConfig");

function boardEmbed(guild, rows, enabled) {
  const lines = rows.length
    ? rows.map((row, index) => {
        const progress = progressFromXp(row.xp);
        return `**${index + 1}.** <@${row.user_id}> — niveau **${progress.level}** · ${progress.total} XP`;
      })
    : ["Personne n'a encore d'XP."];
  return new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`Classement · ${guild.name}`)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({
      text: enabled ? "Top 10" : "Top 10 · le gain d'XP est désactivé",
    });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Affiche le top 10 des niveaux du serveur"),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ Commande de serveur uniquement.", ephemeral: true });
    }
    const config = getLevelConfig(interaction.guild.id);
    const rows = listLevelLeaderboard(interaction.guild.id, 10);
    return interaction.reply({
      embeds: [boardEmbed(interaction.guild, rows, config.enabled)],
    });
  },

  executeMessage(message) {
    if (!message.guild) return;
    const config = getLevelConfig(message.guild.id);
    const rows = listLevelLeaderboard(message.guild.id, 10);
    return message.reply({
      embeds: [boardEmbed(message.guild, rows, config.enabled)],
    });
  },
};
