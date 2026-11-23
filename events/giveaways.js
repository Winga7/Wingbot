const { Events, PermissionFlagsBits } = require("discord.js");
const {
  getGiveawayConfig,
  getGiveawayById,
  addGiveawayEntry,
  removeGiveawayEntry,
  countGiveawayEntries,
  listGiveawayEntryIds,
  listDueGiveaways,
  finishGiveaway,
  setGiveawayWinners,
} = require("../database");
const { pickWinners } = require("../lib/giveawayPick");
const {
  parseGiveawayCustomId,
  buildGiveawayEmbed,
  buildGiveawayComponents,
  winnersAnnouncement,
} = require("../lib/giveawayMessage");

async function refreshGiveawayMessage(client, row, { entries, winners, disabled } = {}) {
  if (!row?.channel_id || !row?.message_id) return;
  const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
  if (!guild) return;
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.messages.fetch(row.message_id).catch(() => null);
  if (!message) return;
  const count = entries ?? countGiveawayEntries(row.id);
  await message
    .edit({
      embeds: [buildGiveawayEmbed(row, { entries: count, winners })],
      components: buildGiveawayComponents(row, disabled ?? row.status !== "active"),
    })
    .catch((error) => {
      console.error("[giveaways] edit :", error?.message || error);
    });
}

async function announceWinners(client, row, winnerIds) {
  const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
  if (!guild) return;
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel
    .send({
      content: winnersAnnouncement(row.prize, winnerIds),
      allowedMentions: { users: winnerIds },
    })
    .catch((error) => {
      console.error("[giveaways] annonce :", error?.message || error);
    });
}

async function closeGiveaway(client, row, { cancel = false } = {}) {
  const entries = listGiveawayEntryIds(row.id);
  const winners = cancel ? [] : pickWinners(entries, row.winners_count);
  const finished = finishGiveaway(row.id, winners, cancel ? "cancelled" : "ended");
  if (!finished) return null;
  await refreshGiveawayMessage(client, finished, {
    entries: entries.length,
    winners: finished.winner_ids,
    disabled: true,
  });
  if (!cancel) await announceWinners(client, finished, finished.winner_ids);
  return finished;
}

async function handleJoinButton(interaction) {
  const parsed = parseGiveawayCustomId(interaction.customId);
  if (!parsed) return false;

  await interaction.deferReply({ ephemeral: true });

  const config = getGiveawayConfig(interaction.guildId);
  if (!config.enabled) {
    await interaction.editReply({ content: "Les giveaways sont désactivés sur ce serveur." });
    return true;
  }

  const row = getGiveawayById(parsed.giveawayId);
  if (!row || row.guild_id !== interaction.guildId) {
    await interaction.editReply({ content: "Ce giveaway n'existe plus." });
    return true;
  }
  if (row.status !== "active") {
    await interaction.editReply({ content: "Ce giveaway est terminé." });
    return true;
  }
  if (new Date(row.ends_at).getTime() <= Date.now()) {
    await closeGiveaway(interaction.client, row);
    await interaction.editReply({ content: "Ce giveaway vient de se terminer." });
    return true;
  }
  if (interaction.user.bot) {
    await interaction.editReply({ content: "Les bots ne peuvent pas participer." });
    return true;
  }

  const member = interaction.member;
  if (row.required_role_ids.length) {
    const ok = row.required_role_ids.some((id) => member.roles.cache.has(id));
    if (!ok) {
      await interaction.editReply({
        content: "Tu n'as pas le rôle requis pour participer.",
      });
      return true;
    }
  }

  const current = addGiveawayEntry(row.id, interaction.user.id);
  if (!current.ok && current.reason === "closed") {
    await interaction.editReply({ content: "Ce giveaway est terminé." });
    return true;
  }

  if (current.joined) {
    const entries = countGiveawayEntries(row.id);
    await refreshGiveawayMessage(interaction.client, row, { entries });
    await interaction.editReply({ content: "✅ Participation enregistrée. Clique à nouveau pour te retirer." });
    return true;
  }

  removeGiveawayEntry(row.id, interaction.user.id);
  const entries = countGiveawayEntries(row.id);
  await refreshGiveawayMessage(interaction.client, row, { entries });
  await interaction.editReply({ content: "Participation retirée." });
  return true;
}

module.exports = function loadGiveaways(client) {
  if (client.__wingbotGiveaways) return;
  client.__wingbotGiveaways = true;

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.guild || !interaction.isButton()) return;
    if (!String(interaction.customId || "").startsWith("wgw:")) return;
    try {
      await handleJoinButton(interaction);
    } catch (error) {
      console.error("[giveaways] bouton :", error?.message || error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "Erreur lors de la participation.", ephemeral: true })
          .catch(() => null);
      }
    }
  });

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const due = listDueGiveaways(new Date().toISOString());
      for (const row of due) {
        try {
          await closeGiveaway(client, row);
        } catch (error) {
          console.error(`[giveaways] fin #${row.id} :`, error?.message || error);
        }
      }
    } finally {
      running = false;
    }
  }

  setInterval(tick, 20_000);
  setTimeout(tick, 8_000);
};

module.exports.closeGiveaway = closeGiveaway;
module.exports.refreshGiveawayMessage = refreshGiveawayMessage;
module.exports.rerollGiveaway = async function rerollGiveaway(client, row, count) {
  if (!row || row.status !== "ended") return { ok: false, reason: "not_ended" };
  const entries = listGiveawayEntryIds(row.id);
  if (!entries.length) return { ok: false, reason: "empty" };
  const winners = pickWinners(entries, count || row.winners_count);
  const updated = setGiveawayWinners(row.id, winners);
  if (!updated) return { ok: false, reason: "failed" };
  await refreshGiveawayMessage(client, updated, {
    entries: entries.length,
    winners: updated.winner_ids,
    disabled: true,
  });
  await announceWinners(client, updated, updated.winner_ids);
  return { ok: true, giveaway: updated };
};

module.exports.memberCanManageGiveaways = function memberCanManageGiveaways(member, config) {
  if (!member) return false;
  if (member.guild?.ownerId === member.id) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return (config?.manager_role_ids || []).some((id) => member.roles.cache.has(id));
};
