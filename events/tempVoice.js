const {
  ChannelType,
  Events,
  PermissionFlagsBits,
} = require("discord.js");
const {
  getTempVoiceGuildConfig,
  getTempVoiceHubByChannel,
  getTempVoiceHub,
  takeTempVoiceIndex,
  getTempVoiceChannel,
  createTempVoiceChannelRow,
  updateTempVoiceChannelRow,
  deleteTempVoiceChannelRow,
  listTempVoiceSaves,
  createTempVoiceSave,
  getTempVoiceSave,
  getDefaultTempVoiceSave,
} = require("../database");
const { formatTempVoiceName } = require("../lib/tempVoiceNames");
const {
  cloneOverwrites,
  buildTempVoiceOverwrites,
} = require("../lib/tempVoicePermissions");
const {
  parseTempVoiceCustomId,
  buildSettingsEmbed,
  buildSettingsComponents,
  buildUserSelect,
  buildRoleSelect,
  buildListMenu,
  buildSettingsModal,
  buildSavesMenu,
} = require("../lib/tempVoicePanel");
const { canUseFeature } = require("../premiumGate");
const { MAX_SAVES_PER_HUB } = require("../lib/tempVoiceConfig");

const editBuckets = new Map();
const creating = new Set();

function editBudget(channelId) {
  const now = Date.now();
  const key = String(channelId);
  let bucket = editBuckets.get(key) || [];
  bucket = bucket.filter((t) => now - t < 10 * 60 * 1000);
  return bucket;
}

function canEditChannel(channelId) {
  return editBudget(channelId).length < 2;
}

function markEdit(channelId) {
  const bucket = editBudget(channelId);
  bucket.push(Date.now());
  editBuckets.set(String(channelId), bucket);
}

function memberHasRole(member, roleIds) {
  return (roleIds || []).some((id) => member.roles.cache.has(id));
}

function isModerator(member, hub) {
  if (!member) return false;
  if (member.guild?.ownerId === member.id) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return memberHasRole(member, hub.moderator_role_ids);
}

function canUseSettings(member, state, hub) {
  if (!member) return false;
  if (memberHasRole(member, hub.settings_deny_role_ids)) return false;
  if (isModerator(member, hub)) return true;
  if (memberHasRole(member, hub.settings_allow_role_ids)) return true;
  return member.id === state.owner_id;
}

function isUntouchable(member, hub) {
  if (!member) return false;
  if (isModerator(member, hub)) return true;
  return memberHasRole(member, hub.untouchable_role_ids);
}

function snapshotState(state) {
  return {
    mode: state.mode,
    whitelist_users: [...(state.whitelist_users || [])],
    whitelist_roles: [...(state.whitelist_roles || [])],
    blacklist_users: [...(state.blacklist_users || [])],
    blacklist_roles: [...(state.blacklist_roles || [])],
    mic: !!state.mic,
    video: !!state.video,
    soundboard: !!state.soundboard,
    status: !!state.status,
    user_limit: state.user_limit,
    name: state.name,
  };
}

async function applyOverwrites(channel, hub, state) {
  const guild = channel.guild;
  const baseChannel =
    hub.permission_source === "hub"
      ? guild.channels.cache.get(hub.hub_channel_id)
      : guild.channels.cache.get(hub.category_id);
  const base = cloneOverwrites(baseChannel);
  const overwrites = buildTempVoiceOverwrites({
    guildId: guild.id,
    botId: guild.members.me?.id || guild.client.user.id,
    ownerId: state.owner_id,
    mode: state.mode,
    hub,
    state,
    baseOverwrites: base,
  });
  await channel.permissionOverwrites.set(overwrites);
}

async function refreshPanel(channel, hub, state) {
  if (!hub.settings_embed || !state.panel_message_id) return;
  const message = await channel.messages.fetch(state.panel_message_id).catch(() => null);
  if (!message) return;
  await message
    .edit({
      embeds: [buildSettingsEmbed(channel, state, hub)],
      components: buildSettingsComponents(channel.id, hub, state),
    })
    .catch(() => null);
}

async function disconnectTargets(channel, userIds) {
  for (const id of userIds) {
    const member = channel.members.get(id);
    if (member) await member.voice.setChannel(null).catch(() => null);
  }
}

async function createTemporaryChannel(member, hub) {
  const guild = member.guild;
  const key = `${guild.id}:${member.id}`;
  if (creating.has(key)) return;
  creating.add(key);
  try {
    const index = takeTempVoiceIndex(hub.id);
    let state = {
      owner_id: member.id,
      mode: "open",
      whitelist_users: [],
      whitelist_roles: [],
      blacklist_users: [],
      blacklist_roles: [],
      session_excludes: [],
      mic: true,
      video: true,
      soundboard: true,
      status: true,
    };

    let def = null;
    if (canUseFeature(member.id, guild.id, "temp_voice_saves") && hub.saves_enabled) {
      def = getDefaultTempVoiceSave(guild.id, hub.id, member.id);
      if (def?.payload) {
        state = {
          ...state,
          mode: def.payload.mode || "open",
          whitelist_users: def.payload.whitelist_users || [],
          whitelist_roles: def.payload.whitelist_roles || [],
          blacklist_users: def.payload.blacklist_users || [],
          blacklist_roles: def.payload.blacklist_roles || [],
          mic: def.payload.mic !== false,
          video: def.payload.video !== false,
          soundboard: def.payload.soundboard !== false,
          status: def.payload.status !== false,
        };
      }
    }

    const name = formatTempVoiceName(hub.name_format, {
      member,
      index,
      customWords: canUseFeature(member.id, guild.id, "temp_voice_custom_words")
        ? hub.custom_words
        : [],
    });

    const parent = hub.category_id || null;
    const channel = await guild.channels.create({
      name: defName(name, def?.payload?.name),
      type: ChannelType.GuildVoice,
      parent,
      userLimit: Number.isInteger(def?.payload?.user_limit)
        ? def.payload.user_limit
        : hub.user_limit || 0,
      reason: `Salon temporaire · ${member.user.tag}`,
    });

    await applyOverwrites(channel, hub, state);
    await member.voice.setChannel(channel).catch(() => null);

    let panelMessageId = null;
    if (hub.settings_embed) {
      const panel = await channel
        .send({
          embeds: [buildSettingsEmbed(channel, state, hub)],
          components: buildSettingsComponents(channel.id, hub, state),
        })
        .catch(() => null);
      panelMessageId = panel?.id || null;
    }

    createTempVoiceChannelRow({
      channel_id: channel.id,
      guild_id: guild.id,
      hub_id: hub.id,
      owner_id: state.owner_id,
      mode: state.mode,
      whitelist_users: state.whitelist_users,
      whitelist_roles: state.whitelist_roles,
      blacklist_users: state.blacklist_users,
      blacklist_roles: state.blacklist_roles,
      session_excludes: [],
      mic: state.mic,
      video: state.video,
      soundboard: state.soundboard,
      status: state.status,
      panel_message_id: panelMessageId,
    });
  } finally {
    creating.delete(key);
  }
}

function defName(fallback, saved) {
  const name = String(saved || fallback || "Salon").slice(0, 100);
  return name || "Salon";
}

async function maybeDeleteEmpty(channel) {
  const state = getTempVoiceChannel(channel.id);
  if (!state) return;
  const hub = getTempVoiceHub(state.hub_id);
  if (hub?.permanent_channel_ids?.includes(channel.id)) return;
  if (channel.members.size > 0) return;
  deleteTempVoiceChannelRow(channel.id);
  await channel.delete("Salon temporaire vide").catch(() => null);
}

async function handleVoice(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const guildCfg = getTempVoiceGuildConfig(guild.id);
  if (!guildCfg.enabled) {
    if (oldState.channelId && getTempVoiceChannel(oldState.channelId)) {
      const ch = oldState.channel;
      if (ch) await maybeDeleteEmpty(ch);
    }
    return;
  }

  if (newState.channelId && newState.channelId !== oldState.channelId) {
    const hub = getTempVoiceHubByChannel(guild.id, newState.channelId);
    if (hub?.enabled && hub.hub_channel_id === newState.channelId) {
      await createTemporaryChannel(member, hub);
    }
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const left = oldState.channel;
    if (left && getTempVoiceChannel(left.id)) {
      await maybeDeleteEmpty(left);
    }
  }
}

async function replyEphemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

async function handlePanelInteraction(interaction) {
  const parsed = parseTempVoiceCustomId(interaction.customId);
  if (!parsed) return false;

  const channel = interaction.guild.channels.cache.get(parsed.channelId);
  const state = getTempVoiceChannel(parsed.channelId);
  if (!channel || !state) {
    await replyEphemeral(interaction, "Ce salon temporaire n'existe plus.");
    return true;
  }
  const hub = getTempVoiceHub(state.hub_id);
  if (!hub) {
    await replyEphemeral(interaction, "Hub introuvable.");
    return true;
  }

  if (!canUseSettings(interaction.member, state, hub)) {
    await replyEphemeral(interaction, "Tu ne peux pas gérer ce salon.");
    return true;
  }

  const action = parsed.action;

  if (action === "open" || action === "closed" || action === "private") {
    const next = updateTempVoiceChannelRow(channel.id, { mode: action === "open" ? "open" : action });
    await applyOverwrites(channel, hub, next);
    await refreshPanel(channel, hub, next);
    await replyEphemeral(interaction, `Mode **${action === "open" ? "Ouvert" : action === "closed" ? "Fermé" : "Privé"}**.`);
    return true;
  }

  if (action === "mic" || action === "video" || action === "sb" || action === "status") {
    const key = action === "sb" ? "soundboard" : action;
    const next = updateTempVoiceChannelRow(channel.id, { [key]: !state[key] });
    await applyOverwrites(channel, hub, next);
    await refreshPanel(channel, hub, next);
    let msg = `Permission **${key}** : ${next[key] ? "activée" : "désactivée"}.`;
    if (key === "mic") {
      msg += " Les membres déjà connectés doivent se reconnecter pour que Discord applique le micro.";
    }
    await replyEphemeral(interaction, msg);
    return true;
  }

  if (action === "wl" || action === "bl") {
    await interaction.reply({
      content: action === "wl" ? "Liste blanche" : "Liste noire",
      components: buildListMenu(channel.id, action),
      ephemeral: true,
    });
    return true;
  }

  if (action === "wlmenu" || action === "blmenu") {
    const kind = action.startsWith("wl") ? "wl" : "bl";
    const choice = interaction.values[0];
    if (choice === "add_users") {
      await interaction.update({
        content: "Choisis jusqu'à 5 membres à ajouter.",
        components: buildUserSelect(`${kind}addusers`, channel.id, "Membres"),
      });
    } else if (choice === "add_roles") {
      await interaction.update({
        content: "Choisis jusqu'à 5 rôles à ajouter.",
        components: buildRoleSelect(`${kind}addroles`, channel.id, "Rôles"),
      });
    } else if (choice === "rem_users") {
      await interaction.update({
        content: "Choisis les membres à retirer.",
        components: buildUserSelect(`${kind}remusers`, channel.id, "Membres"),
      });
    } else {
      await interaction.update({
        content: "Choisis les rôles à retirer.",
        components: buildRoleSelect(`${kind}remroles`, channel.id, "Rôles"),
      });
    }
    return true;
  }

  if (/^(wl|bl)(add|rem)(users|roles)$/.test(action)) {
    const isWhite = action.startsWith("wl");
    const isAdd = action.includes("add");
    const isUsers = action.endsWith("users");
    const selected = isUsers
      ? interaction.users.map((u) => u.id)
      : interaction.roles.map((r) => r.id);
    const userKey = isWhite ? "whitelist_users" : "blacklist_users";
    const roleKey = isWhite ? "whitelist_roles" : "blacklist_roles";
    const key = isUsers ? userKey : roleKey;
    let list = [...(state[key] || [])];

    for (const id of selected) {
      if (isUsers) {
        const m = await interaction.guild.members.fetch(id).catch(() => null);
        if (m && isUntouchable(m, hub) && !isWhite) continue;
        if (m && isModerator(m, hub) && !isWhite) continue;
        if (hub.access_role_ids.includes(id)) continue;
      } else {
        if (
          hub.moderator_role_ids.includes(id) ||
          hub.untouchable_role_ids.includes(id) ||
          hub.access_role_ids.includes(id)
        ) {
          continue;
        }
      }
      if (isAdd) {
        if (!list.includes(id)) list.push(id);
      } else {
        list = list.filter((x) => x !== id);
      }
    }

    const next = updateTempVoiceChannelRow(channel.id, { [key]: list });
    await applyOverwrites(channel, hub, next);
    if (!isWhite && isAdd) {
      const kickIds = isUsers
        ? selected
        : channel.members
            .filter((m) => selected.some((rid) => m.roles.cache.has(rid)))
            .map((m) => m.id);
      await disconnectTargets(channel, kickIds);
    }
    await refreshPanel(channel, hub, next);
    await interaction.update({
      content: "Liste mise à jour.",
      components: [],
    });
    return true;
  }

  if (action === "exclude") {
    if (!hub.saves_enabled || !canUseFeature(interaction.user.id, interaction.guildId, "temp_voice_saves")) {
      await replyEphemeral(interaction, "L'exclusion nécessite les sauvegardes (premium).");
      return true;
    }
    await interaction.reply({
      content: "Choisis un membre à exclure pour cette session.",
      components: buildUserSelect("excludeuser", channel.id, "Membre"),
      ephemeral: true,
    });
    return true;
  }

  if (action === "excludeuser") {
    const targetId = interaction.users.first()?.id;
    if (!targetId) return true;
    const m = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (m && isUntouchable(m, hub)) {
      await interaction.update({ content: "Ce membre est intouchable.", components: [] });
      return true;
    }
    const excludes = [...new Set([...(state.session_excludes || []), targetId])];
    const next = updateTempVoiceChannelRow(channel.id, { session_excludes: excludes });
    await applyOverwrites(channel, hub, next);
    await disconnectTargets(channel, [targetId]);
    await interaction.update({ content: "Membre exclu pour cette session.", components: [] });
    return true;
  }

  if (action === "purge") {
    const victims = [...channel.members.values()].filter((m) => {
      if (m.id === state.owner_id) return false;
      if (isModerator(m, hub)) return false;
      if (state.whitelist_users.includes(m.id)) return false;
      if (state.whitelist_roles.some((rid) => m.roles.cache.has(rid))) return false;
      return true;
    });
    await interaction.reply({
      content:
        victims.length === 0
          ? "Personne à purger."
          : `Purger ${victims.length} membre(s) : ${victims.map((m) => m.user.username).join(", ")} ?`,
      components:
        victims.length === 0
          ? []
          : [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 4,
                    label: "Confirmer la purge",
                    custom_id: `wtv:purgeok:${channel.id}`,
                  },
                ],
              },
            ],
      ephemeral: true,
    });
    return true;
  }

  if (action === "purgeok") {
    const victims = [...channel.members.values()].filter((m) => {
      if (m.id === state.owner_id) return false;
      if (isModerator(m, hub)) return false;
      if (state.whitelist_users.includes(m.id)) return false;
      if (state.whitelist_roles.some((rid) => m.roles.cache.has(rid))) return false;
      return true;
    });
    await disconnectTargets(
      channel,
      victims.map((m) => m.id)
    );
    await replyEphemeral(interaction, `Purge effectuée (${victims.length}).`);
    return true;
  }

  if (action === "settings") {
    const opts = hub.settings_options || {};
    if (!opts.name && !opts.limit && !opts.region) {
      await replyEphemeral(interaction, "Aucune option de réglages n'est autorisée.");
      return true;
    }
    if (!canEditChannel(channel.id) && !isModerator(interaction.member, hub)) {
      const bucket = editBudget(channel.id);
      const wait = Math.ceil((10 * 60 * 1000 - (Date.now() - bucket[0])) / 1000);
      await replyEphemeral(
        interaction,
        `Limite Discord : 2 modifications / 10 min. Réessaie dans ~${wait}s. Restant : 0.`
      );
      return true;
    }
    await interaction.showModal(buildSettingsModal(channel.id, hub, channel));
    return true;
  }

  if (action === "settingsmodal") {
    if (!canEditChannel(channel.id) && !isModerator(interaction.member, hub)) {
      await replyEphemeral(interaction, "Limite Discord de modifications atteinte.");
      return true;
    }
    const opts = hub.settings_options || {};
    const patch = {};
    if (opts.name !== false) {
      const name = interaction.fields.getTextInputValue("name")?.trim().slice(0, 100);
      if (name) patch.name = name;
    }
    if (opts.limit !== false) {
      try {
        const limit = Number(interaction.fields.getTextInputValue("limit"));
        if (Number.isInteger(limit) && limit >= 0 && limit <= 99) patch.userLimit = limit;
      } catch {
        /* field absent */
      }
    }
    if (opts.region !== false) {
      try {
        const region = interaction.fields.getTextInputValue("region")?.trim().toLowerCase();
        if (region && region !== "auto") patch.rtcRegion = region;
        if (region === "auto") patch.rtcRegion = null;
      } catch {
        /* field absent */
      }
    }
    if (Object.keys(patch).length) {
      await channel.edit(patch);
      markEdit(channel.id);
    }
    const left = 2 - editBudget(channel.id).length;
    await replyEphemeral(interaction, `Salon mis à jour. Modifications restantes : ${left}/2 (10 min).`);
    await refreshPanel(channel, hub, state);
    return true;
  }

  if (action === "transfer") {
    const ownerInChannel = channel.members.has(state.owner_id);
    if (interaction.user.id !== state.owner_id) {
      if (!hub.allow_claim || ownerInChannel) {
        await replyEphemeral(
          interaction,
          ownerInChannel
            ? "Seul le propriétaire peut transférer tant qu'il est présent."
            : "La réquisition de salon est désactivée."
        );
        return true;
      }
      const next = updateTempVoiceChannelRow(channel.id, { owner_id: interaction.user.id });
      await applyOverwrites(channel, hub, next);
      await refreshPanel(channel, hub, next);
      await replyEphemeral(interaction, "Tu es le nouveau propriétaire de ce salon.");
      return true;
    }
    await interaction.reply({
      content: "Choisis le nouveau propriétaire (transfert permanent).",
      components: buildUserSelect("transferto", channel.id, "Nouveau propriétaire"),
      ephemeral: true,
    });
    return true;
  }

  if (action === "transferto") {
    const targetId = interaction.users.first()?.id;
    if (!targetId || !channel.members.has(targetId)) {
      await interaction.update({
        content: "Le membre doit être dans le salon.",
        components: [],
      });
      return true;
    }
    const next = updateTempVoiceChannelRow(channel.id, { owner_id: targetId });
    await applyOverwrites(channel, hub, next);
    await refreshPanel(channel, hub, next);
    await interaction.update({
      content: `Propriété transférée à <@${targetId}>.`,
      components: [],
    });
    return true;
  }

  if (action === "saves") {
    if (!hub.saves_enabled || !canUseFeature(interaction.user.id, interaction.guildId, "temp_voice_saves")) {
      await replyEphemeral(interaction, "Sauvegardes réservées au premium (et activées sur le hub).");
      return true;
    }
    const saves = listTempVoiceSaves(interaction.guildId, hub.id, interaction.user.id);
    await interaction.reply({
      content: `Sauvegardes (${saves.length}/${MAX_SAVES_PER_HUB}).`,
      components: buildSavesMenu(channel.id, saves),
      ephemeral: true,
    });
    return true;
  }

  if (action === "savesmenu") {
    if (!hub.saves_enabled || !canUseFeature(interaction.user.id, interaction.guildId, "temp_voice_saves")) {
      await interaction.update({ content: "Sauvegardes indisponibles.", components: [] });
      return true;
    }
    const value = interaction.values[0];
    if (value === "new_current" || value === "new_blank") {
      const payload =
        value === "new_blank"
          ? {
              mode: "open",
              whitelist_users: [],
              whitelist_roles: [],
              blacklist_users: [],
              blacklist_roles: [],
              mic: true,
              video: true,
              soundboard: true,
              status: true,
              user_limit: hub.user_limit || 0,
              name: null,
            }
          : {
              ...snapshotState(state),
              user_limit: channel.userLimit || 0,
              name: channel.name,
            };
      try {
        createTempVoiceSave({
          guild_id: interaction.guildId,
          hub_id: hub.id,
          user_id: interaction.user.id,
          name: value === "new_blank" ? "Vierge" : "Configuration",
          payload,
        });
        await interaction.update({ content: "Sauvegarde créée.", components: [] });
      } catch (e) {
        await interaction.update({ content: e.message || "Échec.", components: [] });
      }
      return true;
    }
    if (value.startsWith("load:")) {
      const save = getTempVoiceSave(Number(value.slice(5)));
      if (!save || save.user_id !== interaction.user.id) {
        await interaction.update({ content: "Sauvegarde introuvable.", components: [] });
        return true;
      }
      const p = save.payload || {};
      const next = updateTempVoiceChannelRow(channel.id, {
        mode: p.mode || "open",
        whitelist_users: p.whitelist_users || [],
        whitelist_roles: p.whitelist_roles || [],
        blacklist_users: p.blacklist_users || [],
        blacklist_roles: p.blacklist_roles || [],
        mic: p.mic !== false,
        video: p.video !== false,
        soundboard: p.soundboard !== false,
        status: p.status !== false,
      });
      await applyOverwrites(channel, hub, next);
      if (p.name || Number.isInteger(p.user_limit)) {
        const edit = {};
        if (p.name) edit.name = String(p.name).slice(0, 100);
        if (Number.isInteger(p.user_limit)) edit.userLimit = p.user_limit;
        if (canEditChannel(channel.id)) {
          await channel.edit(edit).catch(() => null);
          markEdit(channel.id);
        }
      }
      await refreshPanel(channel, hub, next);
      await interaction.update({ content: `Sauvegarde « ${save.name} » chargée.`, components: [] });
      return true;
    }
  }

  return false;
}

module.exports = function loadTempVoice(client) {
  if (client.__wingbotTempVoice) return;
  client.__wingbotTempVoice = true;

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      await handleVoice(oldState, newState);
    } catch (error) {
      console.error("[tempvoice] voice :", error?.message || error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.guild) return;
    const cid = String(interaction.customId || "");
    if (!cid.startsWith("wtv:")) return;
    if (
      !interaction.isButton() &&
      !interaction.isStringSelectMenu() &&
      !interaction.isUserSelectMenu() &&
      !interaction.isRoleSelectMenu() &&
      !interaction.isModalSubmit()
    ) {
      return;
    }
    try {
      await handlePanelInteraction(interaction);
    } catch (error) {
      console.error("[tempvoice] panel :", error?.message || error);
      await replyEphemeral(interaction, "Erreur lors du réglage du salon.").catch(() => null);
    }
  });
};

module.exports._test = {
  canEditChannel,
  editBudget,
  snapshotState,
  isModerator,
};
