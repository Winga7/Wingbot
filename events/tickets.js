const {
  Events,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  getTicketPanel,
  getTicketPanelByMessage,
  getTicket,
  countOpenTicketsForUser,
  insertTicket,
  updateTicket,
} = require("../database");

function getPublicBaseUrl() {
  const u =
    process.env.DASHBOARD_PUBLIC_URL ||
    process.env.PUBLIC_URL ||
    process.env.WINGBOT_PUBLIC_URL ||
    "";
  return String(u).replace(/\/+$/, "");
}
const {
  parseTicketCustomId,
  closeCustomId,
  claimCustomId,
  defaultWelcomeContent,
  buildOpenModal,
  buildFormDataEmbed,
  isModalEnabled,
  resolveCategorySetting,
  resolveCategoryRoles,
  resolveTicketCategoryId,
  resolveTranscriptChannelId,
  applyChannelNameTemplate,
} = require("../lib/ticketConfig");
const { sendTicketTranscript } = require("../lib/ticketTranscript");

function findCategory(panel, key) {
  return (panel.categories || []).find((c) => c.key === key) || null;
}

function isStaff(member, panel, category, kind = "support") {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  const roles = resolveCategoryRoles(category, panel);
  const list =
    kind === "claim" ? roles.claim_role_ids : roles.support_role_ids;
  for (const roleId of list) {
    if (member.roles.cache.has(roleId)) return true;
  }
  return false;
}

function canClose(member, ticket, panel, category) {
  const rule = resolveCategorySetting(category, panel, "close_allowed");
  const isOpener = member.id === ticket.opener_user_id;
  const staff = isStaff(member, panel, category, "support");
  if (rule === "opener") return isOpener;
  if (rule === "staff") return staff;
  return isOpener || staff;
}

async function sendLog(guild, panel, embed) {
  if (!panel.log_channel_id) return;
  const ch =
    guild.channels.cache.get(panel.log_channel_id) ||
    (await guild.channels.fetch(panel.log_channel_id).catch(() => null));
  if (!ch?.isTextBased?.()) return;
  await ch.send({ embeds: [embed] }).catch(() => null);
}

function buildControlButtons(panel, category, ticketId) {
  const settings = panel.settings || {};
  const claimEnabled = resolveCategorySetting(category, panel, "claim_enabled");
  const buttons = [];
  if (settings.show_claim_button !== false && claimEnabled) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(claimCustomId(ticketId))
        .setLabel(settings.claim_button_label || "Prendre en charge")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🙋")
    );
  }
  if (settings.show_close_button !== false) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(closeCustomId(ticketId))
        .setLabel(settings.close_button_label || "Fermer")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🔒")
    );
  }
  if (!buttons.length) return [];
  return [new ActionRowBuilder().addComponents(...buttons)];
}

async function beginOpenTicket(interaction, panel, categoryKey) {
  const category = findCategory(panel, categoryKey);
  if (!category) {
    return interaction.reply({
      content: "Catégorie introuvable sur ce panneau.",
      ephemeral: true,
    });
  }

  const member = interaction.member;
  const openCount = countOpenTicketsForUser(interaction.guild.id, member.id);
  if (openCount >= panel.max_open_per_user) {
    return interaction.reply({
      content: `Tu as déjà **${openCount}** ticket(s) ouvert(s) (max ${panel.max_open_per_user}). Ferme-en un avant d'en rouvrir.`,
      ephemeral: true,
    });
  }

  if (isModalEnabled(category, panel)) {
    const modalData = buildOpenModal(panel, category);
    const modal = new ModalBuilder()
      .setCustomId(modalData.custom_id)
      .setTitle(modalData.title);
    for (const row of modalData.components) {
      const input = row.components[0];
      const textInput = new TextInputBuilder()
        .setCustomId(input.custom_id)
        .setLabel(input.label)
        .setStyle(
          input.style === 2 ? TextInputStyle.Paragraph : TextInputStyle.Short
        )
        .setRequired(input.required !== false);
      if (input.placeholder) textInput.setPlaceholder(input.placeholder);
      if (input.min_length) textInput.setMinLength(input.min_length);
      if (input.max_length) textInput.setMaxLength(input.max_length);
      modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    }
    return interaction.showModal(modal);
  }

  return createTicket(interaction, panel, category, null);
}

async function createTicket(interaction, panel, category, formData) {
  const guild = interaction.guild;
  const member = interaction.member;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const parentId = resolveTicketCategoryId(category, panel);
  const parent =
    guild.channels.cache.get(parentId) ||
    (await guild.channels.fetch(parentId).catch(() => null));
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
    form_data: formData,
  });

  const { support_role_ids } = resolveCategoryRoles(category, panel);
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
  for (const roleId of support_role_ids) {
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

  const useDefaultName = resolveCategorySetting(
    category,
    panel,
    "use_default_channel_name"
  );
  const template = resolveCategorySetting(
    category,
    panel,
    "channel_name_template"
  );
  const channelName = useDefaultName
    ? applyChannelNameTemplate(template, {
        ticketNumber: ticketRow.ticket_number,
        username: member.user.username,
        categoryKey: category.key,
        categoryLabel: category.label,
      })
    : applyChannelNameTemplate("ticket-{number}", {
        ticketNumber: ticketRow.ticket_number,
        username: member.user.username,
        categoryKey: category.key,
        categoryLabel: category.label,
      });

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
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

  const welcomeColor =
    category.welcome_embed_color ??
    panel.settings?.welcome_embed_color ??
    0x5865f2;
  const welcomeTitle =
    category.welcome_title || `${category.emoji || "🎫"} ${category.label}`;
  const welcomeDesc =
    category.welcome_description ||
    defaultWelcomeContent({
      opener: member.toString(),
      categoryLabel: category.label,
      ticketNumber: ticketRow.ticket_number,
    });

  const embeds = [
    new EmbedBuilder()
      .setColor(welcomeColor)
      .setTitle(welcomeTitle)
      .setDescription(welcomeDesc)
      .setFooter({ text: `Ticket #${ticketRow.ticket_number}` })
      .setTimestamp(),
  ];

  if (formData && Object.keys(formData).length) {
    const formEmbed = buildFormDataEmbed(formData, category);
    if (formEmbed) embeds.push(new EmbedBuilder(formEmbed));
  }

  const components = buildControlButtons(panel, category, ticketRow.id);

  await channel.send({
    content: `${member}`,
    embeds,
    components,
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

async function handleModalSubmit(interaction) {
  const parsed = parseTicketCustomId(interaction.customId);
  if (parsed?.action !== "modal") return false;

  const panel = getTicketPanel(parsed.panelId, interaction.guild.id);
  if (!panel || !panel.enabled) {
    await interaction.reply({
      content: "Ce panneau tickets n'est plus actif.",
      ephemeral: true,
    });
    return true;
  }

  const category = findCategory(panel, parsed.categoryKey);
  if (!category) {
    await interaction.reply({
      content: "Catégorie introuvable.",
      ephemeral: true,
    });
    return true;
  }

  const fields =
    category.modal_fields?.length > 0
      ? category.modal_fields
      : [{ id: "reason", label: "Décris ta demande" }];

  const formData = {};
  for (const f of fields) {
    const val = interaction.fields.getTextInputValue(f.id).trim();
    formData[f.label || f.id] = val;
  }

  await createTicket(interaction, panel, category, formData);
  return true;
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
  const category = panel ? findCategory(panel, ticket.category_key) : null;
  const member = interaction.member;

  if (!canClose(member, ticket, panel, category)) {
    return interaction.reply({
      content: "Tu n'as pas la permission de fermer ce ticket.",
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  updateTicket(ticket.id, guild.id, {
    status: "closed",
    closed_by: member.id,
    close_reason: "Fermé via bouton",
  });

  const closedTicket = getTicket(ticket.id, guild.id);
  const channel =
    guild.channels.cache.get(ticket.channel_id) ||
    (await guild.channels.fetch(ticket.channel_id).catch(() => null));

  const transcriptEnabled = resolveCategorySetting(
    category,
    panel,
    "transcript_enabled"
  );
  if (panel && transcriptEnabled && channel) {
    const transcriptChannelId = resolveTranscriptChannelId(category, panel);
    await sendTicketTranscript({
      guild,
      channel,
      ticket: closedTicket,
      panel,
      category,
      targetChannelId: transcriptChannelId,
      closedByTag: member.user.tag,
      publicBaseUrl: getPublicBaseUrl(),
      updateTicket,
    });
  }

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

  const deleteChannel = resolveCategorySetting(
    category,
    panel,
    "delete_channel_on_close"
  );
  const deleteDelay = panel?.settings?.delete_delay_seconds ?? 5;

  if (channel) {
    if (deleteChannel) {
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xef4444)
              .setDescription(
                `Ticket fermé par ${member}.\nCe salon sera supprimé${deleteDelay > 0 ? ` dans ${deleteDelay}s` : ""}…`
              ),
          ],
        })
        .catch(() => null);
      if (deleteDelay > 0) {
        setTimeout(() => {
          channel.delete("Ticket fermé").catch(() => null);
        }, deleteDelay * 1000);
      } else {
        await channel.delete("Ticket fermé").catch(() => null);
      }
    } else {
      await channel.permissionOverwrites
        .edit(ticket.opener_user_id, { SendMessages: false })
        .catch(() => null);
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xef4444)
              .setDescription(
                `Ticket fermé par ${member}.\nLe salon est conservé en lecture seule.`
              ),
          ],
        })
        .catch(() => null);
    }
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
  const category = panel ? findCategory(panel, ticket.category_key) : null;
  const claimEnabled = resolveCategorySetting(category, panel, "claim_enabled");
  if (!claimEnabled) {
    return interaction.reply({
      content: "La prise en charge est désactivée sur ce type de ticket.",
      ephemeral: true,
    });
  }

  if (!panel || !isStaff(interaction.member, panel, category, "claim")) {
    return interaction.reply({
      content: "Réservé aux rôles autorisés sur ce panneau.",
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
  if (interaction.isModalSubmit()) {
    return handleModalSubmit(interaction);
  }

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
      return beginOpenTicket(interaction, panel, key);
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
    return beginOpenTicket(interaction, panel, parsed.categoryKey);
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
    const cid = String(interaction.customId || "");
    if (!cid.startsWith("wingbot:ticket:")) return;
    if (
      !interaction.isButton() &&
      !interaction.isStringSelectMenu() &&
      !interaction.isModalSubmit()
    ) {
      return;
    }
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
