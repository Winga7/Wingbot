const {
  Events,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const {
  getTicketPanel,
  getTicketPanelByMessage,
  getTicket,
  countOpenTicketsForUser,
  insertTicket,
  updateTicket,
} = require("../database");
const {
  parseTicketCustomId,
  closeCustomId,
  claimCustomId,
  defaultWelcomeContent,
} = require("../lib/ticketConfig");

function findCategory(panel, key) {
  return (panel.categories || []).find((c) => c.key === key) || null;
}

function isSupport(member, panel) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  for (const roleId of panel.support_role_ids || []) {
    if (member.roles.cache.has(roleId)) return true;
  }
  return false;
}

function sanitizeChannelName(username, ticketNumber) {
  const base = String(username || "user")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 18);
  return `ticket-${ticketNumber}-${base || "user"}`.slice(0, 100);
}

async function sendLog(guild, panel, embed) {
  if (!panel.log_channel_id) return;
  const ch =
    guild.channels.cache.get(panel.log_channel_id) ||
    (await guild.channels.fetch(panel.log_channel_id).catch(() => null));
  if (!ch?.isTextBased?.()) return;
  await ch.send({ embeds: [embed] }).catch(() => null);
}

async function openTicket(interaction, panel, categoryKey) {
  const guild = interaction.guild;
  const member = interaction.member;
  const category = findCategory(panel, categoryKey);
  if (!category) {
    return interaction.reply({
      content: "Catégorie introuvable sur ce panneau.",
      ephemeral: true,
    });
  }

  const openCount = countOpenTicketsForUser(guild.id, member.id);
  if (openCount >= panel.max_open_per_user) {
    return interaction.reply({
      content: `Tu as déjà **${openCount}** ticket(s) ouvert(s) (max ${panel.max_open_per_user}). Ferme-en un avant d'en rouvrir.`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const parent =
    guild.channels.cache.get(panel.ticket_category_id) ||
    (await guild.channels.fetch(panel.ticket_category_id).catch(() => null));
  if (!parent || parent.type !== ChannelType.GuildCategory) {
    return interaction.editReply({
      content:
        "La catégorie tickets est introuvable. Reconfigure le panneau depuis le dashboard.",
    });
  }

  const me = guild.members.me;
  if (
    !me?.permissions.has(PermissionFlagsBits.ManageChannels) ||
    !me.permissions.has(PermissionFlagsBits.ViewChannel)
  ) {
    return interaction.editReply({
      content:
        "Il me manque les permissions **Gérer les salons** / **Voir les salons**.",
    });
  }

  const ticketRow = insertTicket(guild.id, {
    panel_id: panel.id,
    category_key: category.key,
    channel_id: "pending",
    opener_user_id: member.id,
    opener_tag: member.user.tag,
  });

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];
  for (const roleId of panel.support_role_ids || []) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  let channel;
  try {
    channel = await guild.channels.create({
      name: sanitizeChannelName(member.user.username, ticketRow.ticket_number),
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: `Ticket #${ticketRow.ticket_number} · ${category.label} · ${member.user.tag}`,
      permissionOverwrites: overwrites,
      reason: `Ticket ouvert par ${member.user.tag}`,
    });
  } catch (e) {
    updateTicket(ticketRow.id, guild.id, {
      status: "closed",
      closed_by: "system",
      close_reason: String(e.message || "create_failed"),
    });
    return interaction.editReply({
      content: "Impossible de créer le salon ticket. Vérifie mes permissions.",
    });
  }

  updateTicket(ticketRow.id, guild.id, { channel_id: channel.id });

  const welcome = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${category.emoji || "🎫"} ${category.label}`)
    .setDescription(
      defaultWelcomeContent({
        opener: member.toString(),
        categoryLabel: category.label,
        ticketNumber: ticketRow.ticket_number,
      })
    )
    .setFooter({ text: `Ticket #${ticketRow.ticket_number}` })
    .setTimestamp();

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(claimCustomId(ticketRow.id))
      .setLabel("Prendre en charge")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🙋"),
    new ButtonBuilder()
      .setCustomId(closeCustomId(ticketRow.id))
      .setLabel("Fermer")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🔒")
  );

  await channel.send({
    content: `${member}`,
    embeds: [welcome],
    components: [controls],
  });

  await sendLog(
    guild,
    panel,
    new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Ticket ouvert")
      .addFields(
        { name: "Ticket", value: `#${ticketRow.ticket_number}`, inline: true },
        { name: "Catégorie", value: category.label, inline: true },
        { name: "Membre", value: member.user.tag, inline: true },
        { name: "Salon", value: `<#${channel.id}>`, inline: false }
      )
      .setTimestamp()
  );

  return interaction.editReply({
    content: `Ton ticket a été créé : ${channel}`,
  });
}

async function closeTicket(interaction, ticketId) {
  const guild = interaction.guild;
  const ticket = getTicket(ticketId, guild.id);
  if (!ticket || ticket.status !== "open") {
    return interaction.reply({
      content: "Ce ticket est déjà fermé ou introuvable.",
      ephemeral: true,
    });
  }

  const panel = getTicketPanel(ticket.panel_id, guild.id);
  const member = interaction.member;
  const isOpener = member.id === ticket.opener_user_id;
  const staff = panel ? isSupport(member, panel) : member.permissions.has(PermissionFlagsBits.ManageChannels);

  if (!isOpener && !staff) {
    return interaction.reply({
      content: "Seul l'auteur du ticket ou le staff peut le fermer.",
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  updateTicket(ticket.id, guild.id, {
    status: "closed",
    closed_by: member.id,
    close_reason: "Fermé via bouton",
  });

  const channel =
    guild.channels.cache.get(ticket.channel_id) ||
    (await guild.channels.fetch(ticket.channel_id).catch(() => null));

  if (panel) {
    await sendLog(
      guild,
      panel,
      new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Ticket fermé")
        .addFields(
          { name: "Ticket", value: `#${ticket.ticket_number}`, inline: true },
          { name: "Par", value: member.user.tag, inline: true },
          {
            name: "Auteur",
            value: ticket.opener_tag || ticket.opener_user_id,
            inline: true,
          }
        )
        .setTimestamp()
    );
  }

  if (channel) {
    await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setDescription(
              `Ticket fermé par ${member}.\nCe salon sera supprimé dans quelques secondes…`
            ),
        ],
      })
      .catch(() => null);
    setTimeout(() => {
      channel.delete("Ticket fermé").catch(() => null);
    }, 5000);
  }

  return interaction.editReply({ content: "Ticket fermé." });
}

async function claimTicket(interaction, ticketId) {
  const guild = interaction.guild;
  const ticket = getTicket(ticketId, guild.id);
  if (!ticket || ticket.status !== "open") {
    return interaction.reply({
      content: "Ticket introuvable ou déjà fermé.",
      ephemeral: true,
    });
  }

  const panel = getTicketPanel(ticket.panel_id, guild.id);
  if (!panel || !isSupport(interaction.member, panel)) {
    return interaction.reply({
      content: "Réservé aux rôles support configurés sur le panneau.",
      ephemeral: true,
    });
  }

  if (ticket.claimed_by === interaction.user.id) {
    return interaction.reply({
      content: "Tu as déjà pris en charge ce ticket.",
      ephemeral: true,
    });
  }

  updateTicket(ticket.id, guild.id, { claimed_by: interaction.user.id });

  const channel =
    guild.channels.cache.get(ticket.channel_id) ||
    (await guild.channels.fetch(ticket.channel_id).catch(() => null));
  if (channel?.isTextBased?.()) {
    await channel.send(
      `🙋 ${interaction.user} a pris en charge ce ticket.`
    );
  }

  return interaction.reply({
    content: "Ticket pris en charge.",
    ephemeral: true,
  });
}

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu()) {
    const parsed = parseTicketCustomId(interaction.customId);
    if (parsed?.action === "select") {
      const panel = getTicketPanel(parsed.panelId, interaction.guild.id);
      if (!panel || !panel.enabled) {
        return interaction.reply({
          content: "Ce panneau tickets n'est plus actif.",
          ephemeral: true,
        });
      }
      const key = interaction.values?.[0];
      if (!key) return;
      return openTicket(interaction, panel, key);
    }
  }

  if (!interaction.isButton()) return;
  const parsed = parseTicketCustomId(interaction.customId);
  if (!parsed) return;

  if (parsed.action === "open") {
    const panel = getTicketPanel(parsed.panelId, interaction.guild.id);
    if (!panel || !panel.enabled) {
      return interaction.reply({
        content: "Ce panneau tickets n'est plus actif.",
        ephemeral: true,
      });
    }
    return openTicket(interaction, panel, parsed.categoryKey);
  }

  if (parsed.action === "close") {
    return closeTicket(interaction, parsed.ticketId);
  }

  if (parsed.action === "claim") {
    return claimTicket(interaction, parsed.ticketId);
  }
}

module.exports = function loadTickets(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.guild) return;
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    if (!String(interaction.customId || "").startsWith("wingbot:ticket:")) return;
    try {
      await handleInteraction(interaction);
    } catch (e) {
      console.error("[tickets]", e?.message || e);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "Erreur lors du traitement du ticket.",
            ephemeral: true,
          })
          .catch(() => null);
      }
    }
  });
};

module.exports.getTicketPanelByMessage = getTicketPanelByMessage;
