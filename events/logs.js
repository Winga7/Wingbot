const { Events, AuditLogEvent, EmbedBuilder } = require("discord.js");
const {
  getLogChannel,
  getLogSettings,
  cacheMessage,
  getCachedMessage,
} = require("../database");

module.exports = (client) => {
  // Helper: Envoyer un log
  async function sendLog(guild, embed) {
    const logChannelId = getLogChannel(guild.id);
    if (!logChannelId) return;

    const logChannel =
      guild.channels.cache.get(logChannelId) ||
      (await guild.channels.fetch(logChannelId).catch(() => null));
    if (!logChannel || !logChannel.isTextBased?.()) return;

    try {
      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error("Erreur lors de l'envoi du log:", error);
    }
  }

  // Helper: Récupérer l'auteur d'une action depuis l'audit log
  async function getAuditLogExecutor(guild, actionType, targetId) {
    try {
      const auditLogs = await guild.fetchAuditLogs({
        limit: 1,
        type: actionType,
      });

      const log = auditLogs.entries.first();
      if (!log) return null;

      // Vérifier que c'est récent (moins de 5 secondes)
      if (Date.now() - log.createdTimestamp > 5000) return null;

      // Vérifier que c'est la bonne cible
      if (targetId && log.target?.id !== targetId) return null;

      return log.executor;
    } catch (error) {
      console.error("Erreur lors de la récupération de l'audit log:", error);
      return null;
    }
  }

  // === LOGS DE MESSAGES ===

  // Cache tous les messages pour pouvoir les récupérer si supprimés
  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    cacheMessage(message);
  });

  // Message supprimé
  client.on(Events.MessageDelete, async (message) => {
    if (!message.guild) return;

    const settings = getLogSettings(message.guild.id);
    if (!settings.log_messages) return;

    // Récupérer le message du cache si partial
    let cachedData = null;
    if (message.partial) {
      cachedData = getCachedMessage(message.id);
    }

    const content =
      message.content || cachedData?.content || "*[Contenu non disponible]*";
    const author = message.author || {
      tag: cachedData?.author_tag || "Inconnu",
      id: cachedData?.author_id,
    };

    const attachments =
      message.attachments?.size > 0
        ? message.attachments.map((a) => `[${a.name}](${a.url})`).join("\n")
        : cachedData?.attachments
        ? JSON.parse(cachedData.attachments)
            .map((a) => `[${a.name}](${a.url})`)
            .join("\n")
        : "Aucune";

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("🗑️ Message Supprimé")
      .setDescription(
        `**Auteur:** ${author.tag} (<@${author.id}>)\n**Salon:** <#${message.channel.id}>`
      )
      .addFields(
        { name: "Contenu", value: content.substring(0, 1024) || "*Vide*" },
        {
          name: "Pièces jointes",
          value: attachments.substring(0, 1024) || "Aucune",
        }
      )
      .setFooter({ text: `ID Message: ${message.id}` })
      .setTimestamp();

    await sendLog(message.guild, embed);
  });

  // Message modifié
  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return; // Ignore si pas de changement de contenu

    const settings = getLogSettings(newMessage.guild.id);
    if (!settings.log_messages) return;

    const oldContent =
      oldMessage.content || "*[Contenu original non disponible]*";
    const newContent = newMessage.content || "*[Contenu vide]*";

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle("✏️ Message Modifié")
      .setDescription(
        `**Auteur:** ${newMessage.author.tag} (<@${newMessage.author.id}>)\n**Salon:** <#${newMessage.channel.id}>\n**[Aller au message](${newMessage.url})**`
      )
      .addFields(
        { name: "📜 Ancien message", value: oldContent.substring(0, 1024) },
        { name: "📝 Nouveau message", value: newContent.substring(0, 1024) }
      )
      .setFooter({ text: `ID Message: ${newMessage.id}` })
      .setTimestamp();

    await sendLog(newMessage.guild, embed);
  });

  // === LOGS DE MEMBRES ===

  // Membre rejoint
  client.on(Events.GuildMemberAdd, async (member) => {
    const settings = getLogSettings(member.guild.id);
    if (!settings.log_members) return;

    const accountAge = Math.floor(
      (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24)
    );

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("👋 Membre Rejoint")
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
      .addFields(
        { name: "ID", value: member.user.id, inline: true },
        {
          name: "Compte créé",
          value: `Il y a ${accountAge} jours`,
          inline: true,
        },
        {
          name: "Nombre de membres",
          value: member.guild.memberCount.toString(),
          inline: true,
        }
      )
      .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
      .setTimestamp();

    await sendLog(member.guild, embed);
  });

  // Membre parti/kické/banni
  client.on(Events.GuildMemberRemove, async (member) => {
    const settings = getLogSettings(member.guild.id);
    const logMembersEnabled = !!settings.log_members;
    const logModerationEnabled = !!settings.log_moderation;

    if (!logMembersEnabled && !logModerationEnabled) return;

    // Vérifier si c'est un kick ou ban
    const kickExecutor = logModerationEnabled
      ? await getAuditLogExecutor(
          member.guild,
          AuditLogEvent.MemberKick,
          member.user.id
        )
      : null;

    const banExecutor = logModerationEnabled
      ? await getAuditLogExecutor(
          member.guild,
          AuditLogEvent.MemberBanAdd,
          member.user.id
        )
      : null;

    let reason = "A quitté le serveur";
    let color = 0xff9900;
    let title = "👋 Membre Parti";

    if (banExecutor) {
      reason = `Banni par ${banExecutor.tag}`;
      color = 0xff0000;
      title = "🔨 Banni";
    } else if (kickExecutor) {
      reason = `Expulsé par ${kickExecutor.tag}`;
      color = 0xff6600;
      title = "👢 Expulsé";
    } else {
      // Membre parti (pas kick/ban)
      if (!logMembersEnabled) return;
    }

    if (!banExecutor && !kickExecutor && logModerationEnabled === false) {
      // Rien à faire (garde-fou)
      return;
    }

    if ((banExecutor || kickExecutor) && !logModerationEnabled) return;

    const roles =
      member.roles.cache
        .filter((role) => role.id !== member.guild.id)
        .map((role) => role.name)
        .join(", ") || "Aucun rôle";

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
      .addFields(
        { name: "Raison", value: reason },
        { name: "Rôles", value: roles.substring(0, 1024) },
        {
          name: "Nombre de membres",
          value: member.guild.memberCount.toString(),
          inline: true,
        }
      )
      .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
      .setTimestamp();

    await sendLog(member.guild, embed);
  });

  // === LOGS VOCAUX ===

  // Changements d'état vocal
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const settings = getLogSettings(newState.guild.id);
    if (!settings.log_voice) return;

    const member = newState.member;

    // Rejoint un salon vocal
    if (!oldState.channel && newState.channel) {
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("🔊 Rejoint un Salon Vocal")
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields({
          name: "Salon",
          value: `<#${newState.channel.id}>`,
        })
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(newState.guild, embed);
    }

    // Quitté un salon vocal
    else if (oldState.channel && !newState.channel) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🔇 Quitté un Salon Vocal")
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields({
          name: "Salon",
          value: `<#${oldState.channel.id}>`,
        })
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(newState.guild, embed);
    }

    // Déplacé vers un autre salon
    else if (
      oldState.channel &&
      newState.channel &&
      oldState.channel.id !== newState.channel.id
    ) {
      // Vérifier si c'est une action de modération
      const moveExecutor = await getAuditLogExecutor(
        newState.guild,
        AuditLogEvent.MemberMove,
        member.user.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("🔀 Déplacé Entre Salons Vocaux")
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields(
          { name: "De", value: `<#${oldState.channel.id}>`, inline: true },
          { name: "Vers", value: `<#${newState.channel.id}>`, inline: true },
          {
            name: "Action",
            value: moveExecutor
              ? `Déplacé par ${moveExecutor.tag}`
              : "Déplacement manuel",
          }
        )
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(newState.guild, embed);
    }

    // Server Mute/Unmute
    if (oldState.serverMute !== newState.serverMute) {
      const muteExecutor = await getAuditLogExecutor(
        newState.guild,
        AuditLogEvent.MemberUpdate,
        member.user.id
      );

      const embed = new EmbedBuilder()
        .setColor(newState.serverMute ? 0xff0000 : 0x00ff00)
        .setTitle(newState.serverMute ? "🔇 Server Mute" : "🔊 Server Unmute")
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields({
          name: "Par",
          value: muteExecutor ? muteExecutor.tag : "Système",
        })
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(newState.guild, embed);
    }

    // Server Deafen/Undeafen
    if (oldState.serverDeaf !== newState.serverDeaf) {
      const deafenExecutor = await getAuditLogExecutor(
        newState.guild,
        AuditLogEvent.MemberUpdate,
        member.user.id
      );

      const embed = new EmbedBuilder()
        .setColor(newState.serverDeaf ? 0xff0000 : 0x00ff00)
        .setTitle(
          newState.serverDeaf ? "🔇 Server Deafen" : "🔊 Server Undeafen"
        )
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields({
          name: "Par",
          value: deafenExecutor ? deafenExecutor.tag : "Système",
        })
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(newState.guild, embed);
    }

    // Self mute/deaf/video/stream (actions de l'utilisateur sur lui-même)
    if (oldState.selfMute !== newState.selfMute) {
      const embed = new EmbedBuilder()
        .setColor(newState.selfMute ? 0xff0000 : 0x00ff00)
        .setTitle(newState.selfMute ? "🔇 Self Mute" : "🔊 Self Unmute")
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields({
          name: "Salon vocal",
          value: newState.channel ? `<#${newState.channel.id}>` : "Hors vocal",
          inline: true,
        })
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(newState.guild, embed);
    }

    if (oldState.selfDeaf !== newState.selfDeaf) {
      const embed = new EmbedBuilder()
        .setColor(newState.selfDeaf ? 0xff0000 : 0x00ff00)
        .setTitle(newState.selfDeaf ? "🔇 Self Deaf" : "🔊 Self Undeaf")
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields({
          name: "Salon vocal",
          value: newState.channel ? `<#${newState.channel.id}>` : "Hors vocal",
          inline: true,
        })
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(newState.guild, embed);
    }

    if (oldState.selfVideo !== newState.selfVideo) {
      const embed = new EmbedBuilder()
        .setColor(newState.selfVideo ? 0x00ff00 : 0xffa500)
        .setTitle(newState.selfVideo ? "📹 Self Video Activée" : "🛑 Self Video Désactivée")
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields({
          name: "Salon vocal",
          value: newState.channel ? `<#${newState.channel.id}>` : "Hors vocal",
          inline: true,
        })
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(newState.guild, embed);
    }

    // selfStream n'est dispo que pour certains clients/versions
    if (typeof oldState.selfStream === "boolean" && oldState.selfStream !== newState.selfStream) {
      const embed = new EmbedBuilder()
        .setColor(newState.selfStream ? 0x00ff00 : 0xffa500)
        .setTitle(newState.selfStream ? "🎥 Self Stream Démarré" : "🛑 Self Stream Arrêté")
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields({
          name: "Salon vocal",
          value: newState.channel ? `<#${newState.channel.id}>` : "Hors vocal",
          inline: true,
        })
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(newState.guild, embed);
    }
  });

  // === LOGS DE RÔLES ===

  // Changement de rôles
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const settings = getLogSettings(newMember.guild.id);
    const logRolesEnabled = !!settings.log_roles;
    const logModerationEnabled = !!settings.log_moderation;

    if (!logRolesEnabled && !logModerationEnabled) return;

    if (logRolesEnabled) {
      const oldRoles = oldMember.roles.cache;
      const newRoles = newMember.roles.cache;

      // Rôle ajouté
      const addedRoles = newRoles.filter((role) => !oldRoles.has(role.id));
      if (addedRoles.size > 0) {
        const roleExecutor = await getAuditLogExecutor(
          newMember.guild,
          AuditLogEvent.MemberRoleUpdate,
          newMember.user.id
        );

        for (const [, role] of addedRoles) {
          const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle("➕ Rôle Ajouté")
            .setDescription(`${newMember.user.tag} (<@${newMember.user.id}>)`)
            .addFields(
              { name: "Rôle", value: role.toString(), inline: true },
              {
                name: "Par",
                value: roleExecutor ? roleExecutor.tag : "Système",
                inline: true,
              }
            )
            .setFooter({ text: `ID Utilisateur: ${newMember.user.id}` })
            .setTimestamp();

          await sendLog(newMember.guild, embed);
        }
      }

      // Rôle retiré
      const removedRoles = oldRoles.filter((role) => !newRoles.has(role.id));
      if (removedRoles.size > 0) {
        const roleExecutor = await getAuditLogExecutor(
          newMember.guild,
          AuditLogEvent.MemberRoleUpdate,
          newMember.user.id
        );

        for (const [, role] of removedRoles) {
          const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("➖ Rôle Retiré")
            .setDescription(`${newMember.user.tag} (<@${newMember.user.id}>)`)
            .addFields(
              { name: "Rôle", value: role.toString(), inline: true },
              {
                name: "Par",
                value: roleExecutor ? roleExecutor.tag : "Système",
                inline: true,
              }
            )
            .setFooter({ text: `ID Utilisateur: ${newMember.user.id}` })
            .setTimestamp();

          await sendLog(newMember.guild, embed);
        }
      }

      // Changement de surnom
      if (oldMember.nickname !== newMember.nickname) {
        const nicknameExecutor = await getAuditLogExecutor(
          newMember.guild,
          AuditLogEvent.MemberUpdate,
          newMember.user.id
        );

        const embed = new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle("✏️ Surnom Modifié")
          .setDescription(`${newMember.user.tag} (<@${newMember.user.id}>)`)
          .addFields(
            {
              name: "Ancien surnom",
              value: oldMember.nickname || "*Aucun*",
              inline: true,
            },
            {
              name: "Nouveau surnom",
              value: newMember.nickname || "*Aucun*",
              inline: true,
            },
            {
              name: "Par",
              value: nicknameExecutor
                ? nicknameExecutor.tag
                : newMember.user.tag + " (lui-même)",
            }
          )
          .setFooter({ text: `ID Utilisateur: ${newMember.user.id}` })
          .setTimestamp();

        await sendLog(newMember.guild, embed);
      }
    }

    // === TIMEOUT (Modération) ===
    if (logModerationEnabled) {
      const oldTimeout = oldMember.communicationDisabledUntil || null;
      const newTimeout = newMember.communicationDisabledUntil || null;

      const oldTime = oldTimeout ? oldTimeout.getTime() : null;
      const newTime = newTimeout ? newTimeout.getTime() : null;

      if (oldTime !== newTime) {
        const executor = await getAuditLogExecutor(
          newMember.guild,
          AuditLogEvent.MemberUpdate,
          newMember.user.id
        );

        const embed = new EmbedBuilder();
        const isEnabled = newTimeout !== null;
        const isDisabled = oldTimeout !== null && newTimeout === null;

        if (!oldTimeout && newTimeout) {
          embed.setTitle("⏱️ Timeout activé").setColor(0xff0000);
        } else if (isDisabled) {
          embed.setTitle("✅ Timeout retiré").setColor(0x00ff00);
        } else {
          embed.setTitle("✏️ Timeout modifié").setColor(0xffa500);
        }

        embed
          .setDescription(
            `${newMember.user.tag} (<@${newMember.user.id}>)`
          )
          .setFooter({ text: `ID Utilisateur: ${newMember.user.id}` })
          .setTimestamp()
          .addFields(
            {
              name: "Par",
              value: executor ? executor.tag : "Système",
              inline: false,
            },
            {
              name: "Ancienne valeur",
              value: oldTimeout
                ? `Jusqu'au ${oldTimeout.toLocaleString("fr-FR")}`
                : "Aucune",
              inline: true,
            },
            {
              name: "Nouvelle valeur",
              value: newTimeout
                ? `Jusqu'au ${newTimeout.toLocaleString("fr-FR")}`
                : "Aucune",
              inline: true,
            }
          );

        await sendLog(newMember.guild, embed);
      }
    }
  });

  // === LOGS SERVER (Channels / Threads / Emojis) ===
  // Channels création/suppression/modification
  client.on(Events.ChannelCreate, async (channel) => {
    const guild = channel?.guild;
    if (!guild) return;
    const settings = getLogSettings(guild.id);
    if (!settings.log_server) return;

    const executor = await getAuditLogExecutor(
      guild,
      AuditLogEvent.ChannelCreate,
      channel.id
    );

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🧱 Channel Créé")
      .setDescription(`${channel.name} (<#${channel.id}>)`)
      .addFields(
        { name: "ID", value: channel.id, inline: true },
        {
          name: "Catégorie",
          value: channel.parentId ? `<#${channel.parentId}>` : "Aucune",
          inline: true,
        },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setTimestamp();

    await sendLog(guild, embed);
  });

  client.on(Events.ChannelDelete, async (channel) => {
    const guild = channel?.guild;
    if (!guild) return;
    const settings = getLogSettings(guild.id);
    if (!settings.log_server) return;

    const executor = await getAuditLogExecutor(
      guild,
      AuditLogEvent.ChannelDelete,
      channel.id
    );

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("🗑️ Channel Supprimé")
      .setDescription(`${channel.name || "Salon"} (<#${channel.id}>)`)
      .addFields(
        { name: "ID", value: channel.id, inline: true },
        {
          name: "Catégorie",
          value: channel.parentId ? `<#${channel.parentId}>` : "Aucune",
          inline: true,
        },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setTimestamp();

    await sendLog(guild, embed);
  });

  client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    const guild = newChannel?.guild || oldChannel?.guild;
    if (!guild) return;
    const settings = getLogSettings(guild.id);
    if (!settings.log_server) return;

    const changes = [];
    if (oldChannel.name !== newChannel.name) {
      changes.push(`Nom: \`${oldChannel.name}\` -> \`${newChannel.name}\``);
    }
    if (oldChannel.parentId !== newChannel.parentId) {
      changes.push(
        `Catégorie: \`${oldChannel.parentId || "Aucune"}\` -> \`${newChannel.parentId || "Aucune"}\``
      );
    }

    // Text
    if (oldChannel.topic !== newChannel.topic && newChannel.topic !== undefined) {
      const oldTopic = oldChannel.topic || "Aucun";
      const newTopic = newChannel.topic || "Aucun";
      if (oldTopic !== newTopic) {
        changes.push(
          `Sujet: \`${oldTopic.substring(0, 80)}\` -> \`${newTopic.substring(0, 80)}\``
        );
      }
    }

    // NSFW
    if (
      typeof oldChannel.nsfw === "boolean" ||
      typeof newChannel.nsfw === "boolean"
    ) {
      if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push(`NSFW: \`${oldChannel.nsfw}\` -> \`${newChannel.nsfw}\``);
      }
    }

    // Slowmode / Rate limit
    if (
      oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser &&
      newChannel.rateLimitPerUser !== undefined
    ) {
      changes.push(
        `Limite: \`${oldChannel.rateLimitPerUser || 0}\` -> \`${newChannel.rateLimitPerUser || 0}\``
      );
    }

    // Voice
    if (oldChannel.userLimit !== newChannel.userLimit) {
      if (newChannel.userLimit !== undefined) {
        changes.push(`User limit: \`${oldChannel.userLimit}\` -> \`${newChannel.userLimit}\``);
      }
    }
    if (oldChannel.bitrate !== newChannel.bitrate) {
      if (newChannel.bitrate !== undefined) {
        changes.push(`Bitrate: \`${oldChannel.bitrate}\` -> \`${newChannel.bitrate}\``);
      }
    }

    if (changes.length === 0) return;

    const executor = await getAuditLogExecutor(
      guild,
      AuditLogEvent.ChannelUpdate,
      newChannel.id
    );

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle("🛠️ Channel Modifié")
      .setDescription(`${newChannel.name} (<#${newChannel.id}>)`)
      .addFields(
        {
          name: "Changements",
          value: changes.join("\n").substring(0, 1024),
          inline: false,
        },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setTimestamp();

    await sendLog(guild, embed);
  });

  // Threads
  client.on(Events.ThreadCreate, async (thread) => {
    const guild = thread?.guild;
    if (!guild) return;
    const settings = getLogSettings(guild.id);
    if (!settings.log_server) return;

    const executor = await getAuditLogExecutor(
      guild,
      AuditLogEvent.ChannelCreate,
      thread.id
    );

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🧵 Thread Créé")
      .setDescription(`${thread.name} (<#${thread.id}>)`)
      .addFields(
        { name: "ID", value: thread.id, inline: true },
        {
          name: "Parent",
          value: thread.parentId ? `<#${thread.parentId}>` : "Aucun",
          inline: true,
        },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setTimestamp();

    await sendLog(guild, embed);
  });

  client.on(Events.ThreadDelete, async (thread) => {
    const guild = thread?.guild;
    if (!guild) return;
    const settings = getLogSettings(guild.id);
    if (!settings.log_server) return;

    const executor = await getAuditLogExecutor(
      guild,
      AuditLogEvent.ChannelDelete,
      thread.id
    );

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("🗑️ Thread Supprimé")
      .setDescription(`${thread.name || "Thread"} (<#${thread.id}>)`)
      .addFields(
        { name: "ID", value: thread.id, inline: true },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setTimestamp();

    await sendLog(guild, embed);
  });

  client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
    const guild = newThread?.guild || oldThread?.guild;
    if (!guild) return;
    const settings = getLogSettings(guild.id);
    if (!settings.log_server) return;

    const changes = [];
    if (oldThread.name !== newThread.name) {
      changes.push(`Nom: \`${oldThread.name}\` -> \`${newThread.name}\``);
    }
    if (oldThread.locked !== newThread.locked) {
      changes.push(`Locked: \`${oldThread.locked}\` -> \`${newThread.locked}\``);
    }
    if (oldThread.archived !== newThread.archived) {
      changes.push(`Archived: \`${oldThread.archived}\` -> \`${newThread.archived}\``);
    }

    if (changes.length === 0) return;

    const executor = await getAuditLogExecutor(
      guild,
      AuditLogEvent.ChannelUpdate,
      newThread.id
    );

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle("🛠️ Thread Modifié")
      .setDescription(`${newThread.name} (<#${newThread.id}>)`)
      .addFields(
        {
          name: "Changements",
          value: changes.join("\n").substring(0, 1024),
          inline: false,
        },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setTimestamp();

    await sendLog(guild, embed);
  });

  // Emojis du serveur
  client.on(Events.GuildEmojiCreate, async (emoji) => {
    const guild = emoji?.guild;
    if (!guild) return;
    const settings = getLogSettings(guild.id);
    if (!settings.log_server) return;

    const executor = await getAuditLogExecutor(
      guild,
      AuditLogEvent.EmojiCreate,
      emoji.id
    );

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("😊 Emoji Créé")
      .setDescription(`${emoji.toString()} \`${emoji.name}\``)
      .addFields(
        { name: "ID", value: emoji.id, inline: true },
        { name: "Animé", value: emoji.animated ? "Oui" : "Non", inline: true },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setTimestamp();

    await sendLog(guild, embed);
  });

  client.on(Events.GuildEmojiDelete, async (emoji) => {
    const guild = emoji?.guild;
    if (!guild) return;
    const settings = getLogSettings(guild.id);
    if (!settings.log_server) return;

    const executor = await getAuditLogExecutor(
      guild,
      AuditLogEvent.EmojiDelete,
      emoji.id
    );

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("🗑️ Emoji Supprimé")
      .setDescription(`\`${emoji.name}\` (ID: ${emoji.id})`)
      .addFields(
        { name: "Animé", value: emoji.animated ? "Oui" : "Non", inline: true },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setTimestamp();

    await sendLog(guild, embed);
  });

  client.on(Events.GuildEmojiUpdate, async (oldEmoji, newEmoji) => {
    const guild = newEmoji?.guild || oldEmoji?.guild;
    if (!guild) return;
    const settings = getLogSettings(guild.id);
    if (!settings.log_server) return;

    const changes = [];
    if (oldEmoji.name !== newEmoji.name) {
      changes.push(`Nom: \`${oldEmoji.name}\` -> \`${newEmoji.name}\``);
    }
    if (oldEmoji.animated !== newEmoji.animated) {
      changes.push(
        `Animé: \`${oldEmoji.animated}\` -> \`${newEmoji.animated}\``
      );
    }
    if (oldEmoji.requireColons !== newEmoji.requireColons) {
      changes.push(
        `Require colons: \`${oldEmoji.requireColons}\` -> \`${newEmoji.requireColons}\``
      );
    }

    if (changes.length === 0) return;

    const executor = await getAuditLogExecutor(
      guild,
      AuditLogEvent.EmojiUpdate,
      newEmoji.id
    );

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle("🛠️ Emoji Modifié")
      .setDescription(`${newEmoji.toString()} \`${newEmoji.name}\``)
      .addFields(
        {
          name: "Changements",
          value: changes.join("\n").substring(0, 1024),
          inline: false,
        },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setTimestamp();

    await sendLog(guild, embed);
  });

  // === LOGS REACTIONS ===
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      if (!user || user.bot) return;

      if (reaction?.partial) {
        reaction = await reaction.fetch().catch(() => null);
      }
      if (!reaction) return;

      let message = reaction.message;
      if (message?.partial) {
        message = await message.fetch().catch(() => null);
      }
      const guild = message?.guild;
      if (!guild) return;

      const settings = getLogSettings(guild.id);
      if (!settings.log_messages) return;

      const emojiStr = reaction.emoji?.toString?.() || "Émoji";
      const emojiName =
        reaction.emoji?.name || reaction.emoji?.id || emojiStr;

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("💠 Réaction ajoutée")
        .setDescription(message?.url ? `Message: ${message.url}` : "Message")
        .addFields(
          {
            name: "Utilisateur",
            value: user.tag ? `${user.tag} (<@${user.id}>)` : `${user.id}`,
            inline: false,
          },
          {
            name: "Emoji",
            value: `\`${emojiName}\` (${emojiStr})`,
            inline: true,
          },
          {
            name: "Nombre",
            value: `${reaction.count ?? 0}`,
            inline: true,
          }
        )
        .setFooter({ text: `ID Message: ${message.id}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs reaction add:", err);
    }
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
      if (!user || user.bot) return;

      if (reaction?.partial) {
        reaction = await reaction.fetch().catch(() => null);
      }
      if (!reaction) return;

      let message = reaction.message;
      if (message?.partial) {
        message = await message.fetch().catch(() => null);
      }
      const guild = message?.guild;
      if (!guild) return;

      const settings = getLogSettings(guild.id);
      if (!settings.log_messages) return;

      const emojiStr = reaction.emoji?.toString?.() || "Émoji";
      const emojiName =
        reaction.emoji?.name || reaction.emoji?.id || emojiStr;

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("💠 Réaction retirée")
        .setDescription(message?.url ? `Message: ${message.url}` : "Message")
        .addFields(
          {
            name: "Utilisateur",
            value: user.tag ? `${user.tag} (<@${user.id}>)` : `${user.id}`,
            inline: false,
          },
          {
            name: "Emoji",
            value: `\`${emojiName}\` (${emojiStr})`,
            inline: true,
          },
          {
            name: "Nombre (reste)",
            value: `${reaction.count ?? 0}`,
            inline: true,
          }
        )
        .setFooter({ text: `ID Message: ${message.id}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs reaction remove:", err);
    }
  });

  // Bulk delete (suppression de plusieurs messages d'un coup)
  client.on(Events.MessageBulkDelete, async (messages) => {
    try {
      const first = messages?.first?.();
      const guild = first?.guild;
      if (!guild) return;

      const settings = getLogSettings(guild.id);
      if (!settings.log_messages) return;

      const deletedCount = messages?.size ?? 0;

      const authorsSet = new Set();
      for (const msg of messages.values()) {
        const tag = msg.author?.tag || msg.author?.username;
        if (tag) authorsSet.add(tag);
      }
      const authors = authorsSet.size > 0 ? Array.from(authorsSet).slice(0, 10).join(", ") : "Inconnu";

      const channelId = first?.channel?.id;

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🧨 Messages supprimés en masse")
        .addFields(
          { name: "Salon", value: channelId ? `<#${channelId}>` : "Inconnu", inline: true },
          { name: "Nombre", value: `${deletedCount}`, inline: true },
          { name: "Auteurs (échantillon)", value: authors, inline: false }
        )
        .setFooter({ text: "Bulk delete (Discord)" })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs bulk delete:", err);
    }
  });

  // === LOGS SERVER (mise à jour du serveur) ===
  client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const settings = getLogSettings(newGuild.id);
    if (!settings.log_server) return;

    const changes = [];
    if (oldGuild.name !== newGuild.name) {
      changes.push(`Nom: \`${oldGuild.name}\` -> \`${newGuild.name}\``);
    }

    const oldIcon = oldGuild.iconURL({ size: 64, extension: "png" }) || null;
    const newIcon = newGuild.iconURL({ size: 64, extension: "png" }) || null;
    if (oldIcon !== newIcon) {
      changes.push("Icone: changement");
    }

    if (changes.length === 0) return;

    const executor = await getAuditLogExecutor(
      newGuild,
      AuditLogEvent.GuildUpdate,
      newGuild.id
    );

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle("🏷️ Serveur modifié")
      .setDescription(`${newGuild.name}`)
      .addFields(
        { name: "Changements", value: changes.join("\n").substring(0, 1024), inline: false },
        { name: "Par", value: executor ? executor.tag : "Système", inline: false }
      )
      .setFooter({ text: `ID Serveur: ${newGuild.id}` })
      .setTimestamp();

    await sendLog(newGuild, embed);
  });

  // === LOGS INVITES ===
  client.on(Events.InviteCreate, async (invite) => {
    try {
      const guild = invite?.guild;
      if (!guild) return;
      const settings = getLogSettings(guild.id);
      if (!settings.log_server) return;

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("📨 Invite créée")
        .setDescription(`Code: \`${invite.code}\``)
        .addFields(
          {
            name: "Salon",
            value: invite.channelId ? `<#${invite.channelId}>` : "Inconnu",
            inline: true,
          },
          { name: "Créé par", value: invite.inviter ? invite.inviter.tag : "Inconnu", inline: true },
          { name: "Uses", value: `${invite.uses ?? 0}`, inline: true }
        )
        .setFooter({ text: `ID Invite: ${invite.code}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs InviteCreate:", err);
    }
  });

  client.on(Events.InviteDelete, async (invite) => {
    try {
      const guild = invite?.guild;
      if (!guild) return;
      const settings = getLogSettings(guild.id);
      if (!settings.log_server) return;

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🗑️ Invite supprimée")
        .setDescription(`Code: \`${invite.code}\``)
        .addFields(
          { name: "Salon", value: invite.channelId ? `<#${invite.channelId}>` : "Inconnu", inline: true },
          { name: "Uses", value: `${invite.uses ?? 0}`, inline: true }
        )
        .setFooter({ text: `ID Invite: ${invite.code}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs InviteDelete:", err);
    }
  });

  // Unban (retirer un ban) -> modération
  client.on(Events.GuildBanRemove, async (ban) => {
    try {
      const guild = ban?.guild;
      if (!guild) return;
      const settings = getLogSettings(guild.id);
      if (!settings.log_moderation) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.MemberBanRemove,
        ban.user.id
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("✅ Unban")
        .setDescription(`${ban.user.tag} (<@${ban.user.id}>)`)
        .addFields(
          { name: "Par", value: executor ? executor.tag : "Système", inline: false },
          { name: "ID Utilisateur", value: ban.user.id, inline: true }
        )
        .setFooter({ text: `ID Serveur: ${guild.id}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildBanRemove:", err);
    }
  });

  console.log("✅ Système de logs chargé");
};
