const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const {
  getGiveawayConfig,
  countActiveGiveaways,
  createGiveaway,
  setGiveawayMessage,
  getGiveawayById,
  getGiveawayByMessage,
  listGiveaways,
  countGiveawayEntries,
} = require("../../database");
const {
  clipPrize,
  parseDurationMs,
  formatDuration,
  MAX_WINNERS,
  MAX_REQUIRED_ROLES,
  snowflakeList,
} = require("../../lib/giveawayConfig");
const {
  buildGiveawayEmbed,
  buildGiveawayComponents,
} = require("../../lib/giveawayMessage");
const {
  closeGiveaway,
  rerollGiveaway,
  memberCanManageGiveaways,
} = require("../../events/giveaways");

function deny(send, text) {
  return send(`❌ ${text}`);
}

async function resolveGiveaway(guild, raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/^\d{1,10}$/.test(text) && !/^\d{17,20}$/.test(text)) {
    const byId = getGiveawayById(Number(text));
    if (byId && byId.guild_id === guild.id) return byId;
  }
  if (/^\d{17,20}$/.test(text)) {
    return getGiveawayByMessage(guild.id, text);
  }
  return null;
}

async function startGiveaway({
  guild,
  channel,
  hostId,
  prize,
  durationRaw,
  winnersCount,
  requiredRoleIds,
}) {
  const config = getGiveawayConfig(guild.id);
  if (!config.enabled) return { error: "Les giveaways sont désactivés (dashboard Communauté → Giveaways)." };
  if (countActiveGiveaways(guild.id) >= config.max_active) {
    return { error: `Limite atteinte : ${config.max_active} giveaway(s) actif(s) maximum.` };
  }
  const cleanPrize = clipPrize(prize);
  if (!cleanPrize) return { error: "Indique un lot (200 caractères max)." };
  const durationMs = parseDurationMs(durationRaw);
  if (!durationMs) {
    return { error: "Durée invalide. Exemples : `10m`, `2h`, `1d`, ou minutes (`30`)." };
  }
  const winners = Math.min(MAX_WINNERS, Math.max(1, Math.floor(Number(winnersCount) || 1)));
  if (!channel?.isTextBased?.() || channel.isThread?.()) {
    return { error: "Choisis un salon texte du serveur." };
  }
  const me = guild.members.me;
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel])) {
    return { error: "Je ne peux pas écrire dans ce salon." };
  }
  const roles = snowflakeList(requiredRoleIds, MAX_REQUIRED_ROLES);
  const endsAt = new Date(Date.now() + durationMs).toISOString();
  const row = createGiveaway({
    guildId: guild.id,
    channelId: channel.id,
    prize: cleanPrize,
    winnersCount: winners,
    endsAtIso: endsAt,
    hostId,
    requiredRoleIds: roles,
  });
  const message = await channel.send({
    embeds: [buildGiveawayEmbed(row, { entries: 0 })],
    components: buildGiveawayComponents(row),
  });
  setGiveawayMessage(row.id, message.id);
  row.message_id = message.id;
  return { row, durationMs };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Lancer ou gérer un giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Lance un giveaway")
        .addStringOption((option) =>
          option.setName("lot").setDescription("Ce qui est à gagner").setRequired(true).setMaxLength(200)
        )
        .addStringOption((option) =>
          option
            .setName("duree")
            .setDescription("Ex. 10m, 2h, 1d ou minutes (30)")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("gagnants")
            .setDescription("Nombre de gagnants")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(MAX_WINNERS)
        )
        .addChannelOption((option) =>
          option
            .setName("salon")
            .setDescription("Salon du giveaway")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Rôle requis pour participer").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("end")
        .setDescription("Termine un giveaway maintenant")
        .addStringOption((option) =>
          option.setName("id").setDescription("ID du giveaway ou ID du message").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("cancel")
        .setDescription("Annule un giveaway sans tirage")
        .addStringOption((option) =>
          option.setName("id").setDescription("ID du giveaway ou ID du message").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("reroll")
        .setDescription("Retire de nouveaux gagnants")
        .addStringOption((option) =>
          option.setName("id").setDescription("ID du giveaway ou ID du message").setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("gagnants")
            .setDescription("Nombre de gagnants à retirer")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(MAX_WINNERS)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Liste les giveaways actifs")
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ Commande de serveur uniquement.", ephemeral: true });
    }
    const config = getGiveawayConfig(interaction.guild.id);
    if (!memberCanManageGiveaways(interaction.member, config)) {
      return interaction.reply({
        content: "❌ Il faut Gérer le serveur ou un rôle organisateur.",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "start") {
      await interaction.deferReply({ ephemeral: true });
      const channel =
        interaction.options.getChannel("salon") || interaction.channel;
      const role = interaction.options.getRole("role");
      const result = await startGiveaway({
        guild: interaction.guild,
        channel,
        hostId: interaction.user.id,
        prize: interaction.options.getString("lot", true),
        durationRaw: interaction.options.getString("duree", true),
        winnersCount: interaction.options.getInteger("gagnants") || 1,
        requiredRoleIds: role ? [role.id] : [],
      });
      if (result.error) {
        return interaction.editReply({ content: `❌ ${result.error}` });
      }
      return interaction.editReply({
        content: `✅ Giveaway **#${result.row.id}** lancé dans <#${result.row.channel_id}> (${formatDuration(result.durationMs)}).`,
      });
    }

    if (sub === "list") {
      const rows = listGiveaways(interaction.guild.id, { status: "active", limit: 15 });
      if (!rows.length) {
        return interaction.reply({ content: "Aucun giveaway actif.", ephemeral: true });
      }
      const lines = rows.map((row) => {
        const ends = Math.floor(new Date(row.ends_at).getTime() / 1000);
        return `\`#${row.id}\` · **${row.prize}** · ${countGiveawayEntries(row.id)} participants · fin <t:${ends}:R>`;
      });
      return interaction.reply({ content: lines.join("\n"), ephemeral: true });
    }

    const row = await resolveGiveaway(interaction.guild, interaction.options.getString("id", true));
    if (!row) {
      return interaction.reply({ content: "❌ Giveaway introuvable.", ephemeral: true });
    }

    if (sub === "end") {
      if (row.status !== "active") {
        return interaction.reply({ content: "❌ Ce giveaway n'est plus actif.", ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      await closeGiveaway(interaction.client, row);
      return interaction.editReply({ content: `✅ Giveaway **#${row.id}** terminé.` });
    }

    if (sub === "cancel") {
      if (row.status !== "active") {
        return interaction.reply({ content: "❌ Ce giveaway n'est plus actif.", ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      await closeGiveaway(interaction.client, row, { cancel: true });
      return interaction.editReply({ content: `✅ Giveaway **#${row.id}** annulé.` });
    }

    if (sub === "reroll") {
      await interaction.deferReply({ ephemeral: true });
      const result = await rerollGiveaway(
        interaction.client,
        row,
        interaction.options.getInteger("gagnants") || row.winners_count
      );
      if (!result.ok) {
        const messages = {
          not_ended: "Retirage possible uniquement sur un giveaway terminé.",
          empty: "Personne n'avait participé.",
          failed: "Retirage impossible.",
        };
        return interaction.editReply({ content: `❌ ${messages[result.reason] || "Erreur."}` });
      }
      return interaction.editReply({ content: `✅ Nouveaux gagnants pour **#${row.id}**.` });
    }
  },

  async executeMessage(message, args) {
    if (!message.guild) return;
    const send = (text) => message.reply(text);
    const config = getGiveawayConfig(message.guild.id);
    if (!memberCanManageGiveaways(message.member, config)) {
      return deny(send, "Il faut Gérer le serveur ou un rôle organisateur.");
    }
    const sub = String(args[0] || "").toLowerCase();

    if (sub === "start") {
      const durationRaw = args[1];
      const winnersCount = /^\d+$/.test(String(args[2] || "")) ? Number(args[2]) : 1;
      const prizeStart = /^\d+$/.test(String(args[2] || "")) ? 3 : 2;
      const prize = args.slice(prizeStart).join(" ");
      const result = await startGiveaway({
        guild: message.guild,
        channel: message.channel,
        hostId: message.author.id,
        prize,
        durationRaw,
        winnersCount,
        requiredRoleIds: [],
      });
      if (result.error) return deny(send, result.error);
      return send(
        `✅ Giveaway **#${result.row.id}** lancé (${formatDuration(result.durationMs)}).`
      );
    }

    if (sub === "list") {
      const rows = listGiveaways(message.guild.id, { status: "active", limit: 15 });
      if (!rows.length) return send("Aucun giveaway actif.");
      const lines = rows.map((row) => {
        const ends = Math.floor(new Date(row.ends_at).getTime() / 1000);
        return `\`#${row.id}\` · **${row.prize}** · ${countGiveawayEntries(row.id)} · fin <t:${ends}:R>`;
      });
      return send(lines.join("\n"));
    }

    if (sub === "end" || sub === "cancel" || sub === "reroll") {
      const row = await resolveGiveaway(message.guild, args[1]);
      if (!row) return deny(send, "Giveaway introuvable. Indique l'ID (`giveaway list`).");
      if (sub === "end") {
        if (row.status !== "active") return deny(send, "Ce giveaway n'est plus actif.");
        await closeGiveaway(message.client, row);
        return send(`✅ Giveaway **#${row.id}** terminé.`);
      }
      if (sub === "cancel") {
        if (row.status !== "active") return deny(send, "Ce giveaway n'est plus actif.");
        await closeGiveaway(message.client, row, { cancel: true });
        return send(`✅ Giveaway **#${row.id}** annulé.`);
      }
      const count = /^\d+$/.test(String(args[2] || "")) ? Number(args[2]) : row.winners_count;
      const result = await rerollGiveaway(message.client, row, count);
      if (!result.ok) return deny(send, "Retirage impossible (giveaway terminé avec des participants requis).");
      return send(`✅ Nouveaux gagnants pour **#${row.id}**.`);
    }

    return deny(
      send,
      "Usage : `giveaway start <duree> [gagnants] <lot>` · `end|cancel|reroll <id>` · `list`"
    );
  },
};
