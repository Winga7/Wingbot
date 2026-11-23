const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");

const PREFIX = "wtv";

function cid(...parts) {
  return [PREFIX, ...parts].join(":");
}

function parseTempVoiceCustomId(customId) {
  const parts = String(customId || "").split(":");
  if (parts[0] !== PREFIX || parts.length < 3) return null;
  const action = parts[1];
  const channelId = parts[2];
  if (!/^\d{17,20}$/.test(channelId)) return null;
  return { action, channelId, extra: parts.slice(3) };
}

function modeLabel(mode) {
  if (mode === "closed") return "Fermé";
  if (mode === "private") return "Privé";
  return "Ouvert";
}

function buildSettingsEmbed(channel, state, hub) {
  const ownerMention = `<@${state.owner_id}>`;
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Réglages du salon vocal")
    .setDescription(
      `Propriétaire : ${ownerMention}\nMode : **${modeLabel(state.mode)}**\n` +
        `Limite : **${channel.userLimit || "∞"}**\n` +
        `Micro : **${state.mic ? "on" : "off"}** · Vidéo : **${state.video ? "on" : "off"}** · ` +
        `Soundboard : **${state.soundboard ? "on" : "off"}** · Statut : **${state.status ? "on" : "off"}**`
    )
    .setFooter({
      text: hub.allow_claim
        ? "Transférer : propriétaire, ou réquisition si le propriétaire est parti"
        : "Seul le propriétaire (ou un modo) peut gérer ce salon",
    });
}

function btn(action, channelId, label, style = ButtonStyle.Secondary, enabled = true) {
  return new ButtonBuilder()
    .setCustomId(cid(action, channelId))
    .setLabel(label)
    .setStyle(style)
    .setDisabled(!enabled);
}

function buildSettingsComponents(channelId, hub, state) {
  const b = hub.enabled_buttons || {};
  const rows = [];
  const row1 = new ActionRowBuilder();
  if (b.open) row1.addComponents(btn("open", channelId, "Ouvert", ButtonStyle.Success));
  if (b.closed) row1.addComponents(btn("closed", channelId, "Fermé", ButtonStyle.Primary));
  if (b.private) row1.addComponents(btn("private", channelId, "Privé", ButtonStyle.Secondary));
  if (row1.components.length) rows.push(row1);

  const row2 = new ActionRowBuilder();
  if (b.whitelist) row2.addComponents(btn("wl", channelId, "Liste blanche"));
  if (b.blacklist) row2.addComponents(btn("bl", channelId, "Liste noire"));
  if (b.exclude && hub.saves_enabled) {
    row2.addComponents(btn("exclude", channelId, "Exclure", ButtonStyle.Danger));
  }
  if (b.purge) row2.addComponents(btn("purge", channelId, "Purge", ButtonStyle.Danger));
  if (row2.components.length) rows.push(row2);

  const row3 = new ActionRowBuilder();
  if (b.mic) row3.addComponents(btn("mic", channelId, state.mic ? "Micro on" : "Micro off"));
  if (b.video) row3.addComponents(btn("video", channelId, state.video ? "Vidéo on" : "Vidéo off"));
  if (b.soundboard) {
    row3.addComponents(btn("sb", channelId, state.soundboard ? "Soundboard on" : "Soundboard off"));
  }
  if (b.status) {
    row3.addComponents(btn("status", channelId, state.status ? "Statut on" : "Statut off"));
  }
  if (row3.components.length) rows.push(row3);

  const row4 = new ActionRowBuilder();
  if (b.settings) row4.addComponents(btn("settings", channelId, "Réglages", ButtonStyle.Primary));
  if (b.transfer) row4.addComponents(btn("transfer", channelId, "Transférer"));
  if (b.saves && hub.saves_enabled) {
    row4.addComponents(btn("saves", channelId, "Sauvegardes"));
  }
  if (row4.components.length) rows.push(row4);

  return rows.slice(0, 5);
}

function buildUserSelect(action, channelId, placeholder) {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(cid(action, channelId))
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(5)
    ),
  ];
}

function buildRoleSelect(action, channelId, placeholder) {
  return [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(cid(action, channelId))
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(5)
    ),
  ];
}

function buildListMenu(channelId, kind) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid(`${kind}menu`, channelId))
        .setPlaceholder(kind === "wl" ? "Liste blanche" : "Liste noire")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("Ajouter des membres").setValue("add_users"),
          new StringSelectMenuOptionBuilder().setLabel("Ajouter des rôles").setValue("add_roles"),
          new StringSelectMenuOptionBuilder().setLabel("Retirer des membres").setValue("rem_users"),
          new StringSelectMenuOptionBuilder().setLabel("Retirer des rôles").setValue("rem_roles")
        )
    ),
  ];
}

function buildSettingsModal(channelId, hub, channel) {
  const opts = hub.settings_options || {};
  const modal = new ModalBuilder()
    .setCustomId(cid("settingsmodal", channelId))
    .setTitle("Réglages du salon");
  const rows = [];
  if (opts.name !== false) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Nom du salon")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue((channel.name || "").slice(0, 100))
      )
    );
  }
  if (opts.limit !== false) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("limit")
          .setLabel("Limite de membres (0 = illimité)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2)
          .setValue(String(channel.userLimit || 0))
      )
    );
  }
  if (opts.region !== false) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("region")
          .setLabel("Région (auto, france, rotterdam…)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(32)
          .setValue(channel.rtcRegion || "auto")
      )
    );
  }
  if (!rows.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Nom du salon")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue((channel.name || "").slice(0, 100))
      )
    );
  }
  modal.addComponents(...rows.slice(0, 5));
  return modal;
}

function buildSavesMenu(channelId, saves) {
  const options = [
    new StringSelectMenuOptionBuilder().setLabel("Nouvelle sauvegarde (actuelle)").setValue("new_current"),
    new StringSelectMenuOptionBuilder().setLabel("Nouvelle sauvegarde (vierge)").setValue("new_blank"),
  ];
  for (const save of saves.slice(0, 20)) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${save.is_default ? "★ " : ""}${save.name}`.slice(0, 100))
        .setValue(`load:${save.id}`)
        .setDescription(`Charger · #${save.id}`.slice(0, 100))
    );
  }
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid("savesmenu", channelId))
        .setPlaceholder("Sauvegardes")
        .addOptions(options.slice(0, 25))
    ),
  ];
}

module.exports = {
  PREFIX,
  parseTempVoiceCustomId,
  buildSettingsEmbed,
  buildSettingsComponents,
  buildUserSelect,
  buildRoleSelect,
  buildListMenu,
  buildSettingsModal,
  buildSavesMenu,
  modeLabel,
};
