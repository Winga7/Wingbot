const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { getStatsConfig, getActivityReport } = require("../../database");
const { MAX_QUERY_DAYS } = require("../../lib/statsConfig");
const { memberHasPermOrAdmin } = require("../../memberPerms");

function formatVoice(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function parseDays(value) {
  if (value == null || value === "") return 7;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUERY_DAYS) return null;
  return n;
}

function channelLabel(guild, member, channelId) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !member) return null;
  if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) return null;
  return `#${channel.name}`;
}

function statsEmbed(guild, member, report) {
  const lines = report.top_channels
    .map((row) => {
      const label = channelLabel(guild, member, row.channel_id);
      if (!label) return null;
      return `${label} · **${row.messages}**`;
    })
    .filter(Boolean)
    .slice(0, 5);

  return new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`Activité · ${report.days} jour${report.days > 1 ? "s" : ""}`)
    .setDescription("Compteurs du serveur. Le contenu des messages n'est pas enregistré.")
    .addFields(
      { name: "Messages", value: String(report.totals.messages), inline: true },
      { name: "Arrivées", value: String(report.totals.joins), inline: true },
      { name: "Départs", value: String(report.totals.leaves), inline: true },
      { name: "Vocal", value: formatVoice(report.totals.voice_seconds), inline: true },
      {
        name: "Salons les plus actifs",
        value: lines.length ? lines.join("\n") : "Aucun salon visible sur cette période.",
      }
    )
    .setFooter({ text: `${guild.name} · dates UTC` });
}

async function replyStats(guild, member, days, send) {
  const config = getStatsConfig(guild.id);
  if (!config.enabled) {
    return send("❌ Le suivi des statistiques est désactivé sur ce serveur.");
  }
  if (!config.public_command && !memberHasPermOrAdmin(member, PermissionFlagsBits.ManageGuild)) {
    return send("❌ Ces statistiques sont réservées aux personnes qui gèrent le serveur.");
  }
  const report = getActivityReport(guild.id, days);
  return send({ embeds: [statsEmbed(guild, member, report)] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Activité du serveur : messages, vocal, arrivées et départs")
    .addIntegerOption((option) =>
      option
        .setName("jours")
        .setDescription("Nombre de jours (1 à 30)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(MAX_QUERY_DAYS)
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ Commande de serveur uniquement.", ephemeral: true });
    }
    const days = parseDays(interaction.options.getInteger("jours"));
    if (days == null) {
      return interaction.reply({
        content: `❌ Indique un nombre de jours entre 1 et ${MAX_QUERY_DAYS}.`,
        ephemeral: true,
      });
    }
    await replyStats(interaction.guild, interaction.member, days, (payload) => {
      const body = typeof payload === "string"
        ? { content: payload, ephemeral: true }
        : { ...payload, ephemeral: false };
      return interaction.reply(body);
    });
  },

  async executeMessage(message, args) {
    if (!message.guild) return;
    const days = parseDays(args[0]);
    if (days == null) {
      return message.reply(`❌ Indique un nombre de jours entre 1 et ${MAX_QUERY_DAYS}. Exemple : \`stats 7\`.`);
    }
    await replyStats(message.guild, message.member, days, (payload) => message.reply(payload));
  },
};
