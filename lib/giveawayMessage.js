const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const CUSTOM_PREFIX = "wgw";

function joinCustomId(giveawayId) {
  return `${CUSTOM_PREFIX}:j:${Number(giveawayId)}`;
}

function parseGiveawayCustomId(customId) {
  const parts = String(customId || "").split(":");
  if (parts.length !== 3 || parts[0] !== CUSTOM_PREFIX || parts[1] !== "j") {
    return null;
  }
  const id = Number(parts[2]);
  if (!Number.isInteger(id) || id < 1) return null;
  return { action: "join", giveawayId: id };
}

function buildGiveawayEmbed(row, { entries = 0, winners = null } = {}) {
  const endsUnix = Math.floor(new Date(row.ends_at).getTime() / 1000);
  const embed = new EmbedBuilder()
    .setColor(row.status === "active" ? 0x6366f1 : row.status === "ended" ? 0x22c55e : 0x94a3b8)
    .setTitle(row.status === "active" ? "🎉 Giveaway" : row.status === "ended" ? "🎉 Giveaway terminé" : "Giveaway annulé")
    .setDescription(`**${row.prize}**`)
    .addFields(
      { name: "Gagnants", value: String(row.winners_count), inline: true },
      { name: "Participants", value: String(entries), inline: true },
      {
        name: row.status === "active" ? "Fin" : "Fin prévue",
        value: `<t:${endsUnix}:R> (<t:${endsUnix}:f>)`,
        inline: false,
      }
    )
    .setFooter({ text: `Giveaway #${row.id}` });

  if (row.required_role_ids?.length) {
    embed.addFields({
      name: "Rôle requis",
      value: row.required_role_ids.map((id) => `<@&${id}>`).join(" "),
    });
  }

  if (row.status === "ended") {
    const list = Array.isArray(winners) ? winners : row.winner_ids || [];
    embed.addFields({
      name: "Tirage",
      value: list.length
        ? list.map((id) => `<@${id}>`).join(", ")
        : "Personne n'avait participé.",
    });
  }

  if (row.status === "cancelled") {
    embed.addFields({ name: "État", value: "Annulé par un organisateur." });
  }

  return embed;
}

function buildGiveawayComponents(row, disabled = false) {
  const button = new ButtonBuilder()
    .setCustomId(joinCustomId(row.id))
    .setLabel(disabled ? "Terminé" : "Participer")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!!disabled || row.status !== "active");
  return [new ActionRowBuilder().addComponents(button)];
}

function winnersAnnouncement(prize, winnerIds) {
  if (!winnerIds?.length) {
    return `Le giveaway **${prize}** est terminé. Aucun participant.`;
  }
  const mentions = winnerIds.map((id) => `<@${id}>`).join(", ");
  return `🎉 Bravo ${mentions} ! Vous gagnez **${prize}**.`;
}

module.exports = {
  CUSTOM_PREFIX,
  joinCustomId,
  parseGiveawayCustomId,
  buildGiveawayEmbed,
  buildGiveawayComponents,
  winnersAnnouncement,
};
