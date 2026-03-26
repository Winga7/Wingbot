const { Events, AuditLogEvent, EmbedBuilder } = require("discord.js");
const {
  getLogChannel,
  isLogEnabled,
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

  function formatOverwriteTarget(guild, overwriteId) {
    if (!guild || !overwriteId) return `\`${overwriteId}\``;
    if (guild.roles.cache.has(overwriteId)) return `<@&${overwriteId}>`;
    return `<@${overwriteId}>`;
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
    if (!isLogEnabled(message.guild.id, "msg_cache")) return;

    cacheMessage(message);
  });

  // Message supprimé
  client.on(Events.MessageDelete, async (message) => {
    if (!message.guild) return;

    if (!isLogEnabled(message.guild.id, "msg_delete")) return;

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

    if (!isLogEnabled(newMessage.guild.id, "msg_edit")) return;

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
    if (!isLogEnabled(member.guild.id, "mem_join")) return;

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
    const gid = member.guild.id;

    const kickExecutor = await getAuditLogExecutor(
      member.guild,
      AuditLogEvent.MemberKick,
      member.user.id
    );

    const banExecutor = await getAuditLogExecutor(
      member.guild,
      AuditLogEvent.MemberBanAdd,
      member.user.id
    );

    // Ban : détail dans GuildBanAdd (évite doublon)
    if (banExecutor) {
      return;
    }

    if (kickExecutor) {
      if (!isLogEnabled(gid, "mem_kick")) return;

      const rolesKick =
        member.roles.cache
          .filter((role) => role.id !== member.guild.id)
          .map((role) => role.name)
          .join(", ") || "Aucun rôle";

      const embedKick = new EmbedBuilder()
        .setColor(0xff6600)
        .setTitle("👢 Expulsé")
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
        .addFields(
          { name: "Raison", value: `Expulsé par ${kickExecutor.tag}` },
          { name: "Rôles", value: rolesKick.substring(0, 1024) },
          {
            name: "Nombre de membres",
            value: member.guild.memberCount.toString(),
            inline: true,
          }
        )
        .setFooter({ text: `ID Utilisateur: ${member.user.id}` })
        .setTimestamp();

      await sendLog(member.guild, embedKick);
      return;
    }

    if (!isLogEnabled(gid, "mem_leave")) return;

    const roles =
      member.roles.cache
        .filter((role) => role.id !== member.guild.id)
        .map((role) => role.name)
        .join(", ") || "Aucun rôle";

    const embed = new EmbedBuilder()
      .setColor(0xff9900)
      .setTitle("👋 Membre Parti")
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setDescription(`${member.user.tag} (<@${member.user.id}>)`)
      .addFields(
        { name: "Raison", value: "A quitté le serveur" },
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
    const gid = newState.guild.id;
    const member = newState.member;

    // Rejoint un salon vocal
    if (!oldState.channel && newState.channel) {
      if (isLogEnabled(gid, "voc_join")) {
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
    }

    // Quitté un salon vocal
    else if (oldState.channel && !newState.channel) {
      if (isLogEnabled(gid, "voc_leave")) {
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
    }

    // Déplacé vers un autre salon
    else if (
      oldState.channel &&
      newState.channel &&
      oldState.channel.id !== newState.channel.id
    ) {
      if (isLogEnabled(gid, "voc_move")) {
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
    }

    // Server Mute/Unmute
    if (oldState.serverMute !== newState.serverMute) {
      if (isLogEnabled(gid, "voc_srv_mute")) {
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
    }

    // Server Deafen/Undeafen
    if (oldState.serverDeaf !== newState.serverDeaf) {
      if (isLogEnabled(gid, "voc_srv_deaf")) {
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
    }

    // Self mute/deaf/video/stream volontairement désactivé :
    // c'est trop bruit et peu utile en pratique.
  });

  // === LOGS DE RÔLES ===

  // Changement de rôles
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const gid = newMember.guild.id;
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    // Rôle ajouté
    const addedRoles = newRoles.filter((role) => !oldRoles.has(role.id));
    if (addedRoles.size > 0 && isLogEnabled(gid, "role_add")) {
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
    if (removedRoles.size > 0 && isLogEnabled(gid, "role_remove")) {
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
    if (
      oldMember.nickname !== newMember.nickname &&
      isLogEnabled(gid, "nick_change")
    ) {
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

    // === TIMEOUT (Modération) ===
    if (isLogEnabled(gid, "mod_timeout")) {
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
    if (!isLogEnabled(guild.id, "srv_channel")) return;

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
    if (!isLogEnabled(guild.id, "srv_channel")) return;

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
    if (!isLogEnabled(guild.id, "srv_channel")) return;

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

    // Overwrites (permissions rôle / membre sur le salon)
    try {
      const oldOw = oldChannel.permissionOverwrites?.cache;
      const newOw = newChannel.permissionOverwrites?.cache;
      if (oldOw && newOw) {
        const allIds = new Set([...oldOw.keys(), ...newOw.keys()]);
        for (const id of allIds) {
          const o = oldOw.get(id);
          const n = newOw.get(id);
          const label = formatOverwriteTarget(guild, id);
          if (!o && n) {
            changes.push(`Permission ajoutée: ${label}`);
          } else if (o && !n) {
            changes.push(`Permission supprimée: ${label}`);
          } else if (o && n) {
            const oA = String(o.allow?.bitfield ?? o.allow);
            const nA = String(n.allow?.bitfield ?? n.allow);
            const oD = String(o.deny?.bitfield ?? o.deny);
            const nD = String(n.deny?.bitfield ?? n.deny);
            if (oA !== nA || oD !== nD) {
              changes.push(`Permissions modifiées: ${label}`);
            }
          }
        }
      }
    } catch {
      /* ignore */
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
    if (!isLogEnabled(guild.id, "srv_thread")) return;

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
    if (!isLogEnabled(guild.id, "srv_thread")) return;

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
    if (!isLogEnabled(guild.id, "srv_thread")) return;

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
    if (!isLogEnabled(guild.id, "srv_emoji")) return;

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
    if (!isLogEnabled(guild.id, "srv_emoji")) return;

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
    if (!isLogEnabled(guild.id, "srv_emoji")) return;

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

      if (!isLogEnabled(guild.id, "msg_reaction")) return;

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

      if (!isLogEnabled(guild.id, "msg_reaction")) return;

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

      if (!isLogEnabled(guild.id, "msg_bulk")) return;

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
    if (!isLogEnabled(newGuild.id, "srv_guild_meta")) return;

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
      if (!isLogEnabled(guild.id, "srv_invite")) return;

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
      if (!isLogEnabled(guild.id, "srv_invite")) return;

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
      if (!isLogEnabled(guild.id, "mod_unban")) return;

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

  // Ban explicite (détail + raison Discord)
  client.on(Events.GuildBanAdd, async (ban) => {
    try {
      const guild = ban?.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "mod_ban")) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.MemberBanAdd,
        ban.user.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🔨 Banni")
        .setDescription(`${ban.user.tag} (<@${ban.user.id}>)`)
        .setThumbnail(ban.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: "Raison", value: ban.reason || "Non spécifiée", inline: false },
          { name: "Par", value: executor ? executor.tag : "Système", inline: true },
          { name: "ID", value: ban.user.id, inline: true }
        )
        .setFooter({ text: `ID Serveur: ${guild.id}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildBanAdd:", err);
    }
  });

  // Épingles (pin / unpin détecté via audit quand possible)
  client.on(Events.ChannelPinsUpdate, async (channel) => {
    try {
      const guild = channel?.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "msg_pin")) return;

      let title = "📌 Épingles mises à jour";
      let extra = "";
      try {
        const pinLogs = await guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.MessagePin,
        });
        const unpinLogs = await guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.MessageUnpin,
        });
        const pinEntry = pinLogs.entries.first();
        const unpinEntry = unpinLogs.entries.first();
        const now = Date.now();
        const pinOk = pinEntry && now - pinEntry.createdTimestamp < 5000;
        const unpinOk = unpinEntry && now - unpinEntry.createdTimestamp < 5000;
        if (
          pinOk &&
          (!unpinOk || pinEntry.createdTimestamp > unpinEntry.createdTimestamp)
        ) {
          title = "📌 Message épinglé";
          extra = pinEntry.executor ? `Par ${pinEntry.executor.tag}` : "";
        } else if (unpinOk) {
          title = "📌 Message désépinglé";
          extra = unpinEntry.executor
            ? `Par ${unpinEntry.executor.tag}`
            : "";
        }
      } catch {
        /* ignore */
      }

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle(title)
        .setDescription(
          channel.isTextBased?.()
            ? `Salon: <#${channel.id}>`
            : String(channel.name || channel.id)
        );
      if (extra) {
        embed.addFields({ name: "Audit", value: extra, inline: false });
      }
      embed.setFooter({ text: `ID Salon: ${channel.id}` }).setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs ChannelPinsUpdate:", err);
    }
  });

  // Rôles serveur (création / suppression / modification)
  client.on(Events.GuildRoleCreate, async (role) => {
    try {
      const guild = role.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_role")) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.RoleCreate,
        role.id
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("🎭 Rôle créé")
        .setDescription(`${role.name} (${role})`)
        .addFields(
          { name: "ID", value: role.id, inline: true },
          { name: "Par", value: executor ? executor.tag : "Système", inline: true }
        )
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildRoleCreate:", err);
    }
  });

  client.on(Events.GuildRoleDelete, async (role) => {
    try {
      const guild = role.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_role")) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.RoleDelete,
        role.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🗑️ Rôle supprimé")
        .setDescription(`\`${role.name}\``)
        .addFields(
          { name: "ID", value: role.id, inline: true },
          { name: "Par", value: executor ? executor.tag : "Système", inline: true }
        )
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildRoleDelete:", err);
    }
  });

  client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    try {
      const guild = newRole.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_role")) return;

      const changes = [];
      if (oldRole.name !== newRole.name) {
        changes.push(`Nom: \`${oldRole.name}\` -> \`${newRole.name}\``);
      }
      if (oldRole.color !== newRole.color) {
        changes.push("Couleur modifiée");
      }
      if (oldRole.hoist !== newRole.hoist) {
        changes.push(`Affichage séparé: \`${oldRole.hoist}\` -> \`${newRole.hoist}\``);
      }
      if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`Mentionnable: \`${oldRole.mentionable}\` -> \`${newRole.mentionable}\``);
      }
      if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        changes.push("Permissions modifiées");
      }

      if (changes.length === 0) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.RoleUpdate,
        newRole.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("🛠️ Rôle modifié")
        .setDescription(`${newRole.name} (${newRole})`)
        .addFields(
          {
            name: "Changements",
            value: changes.join("\n").substring(0, 1024),
            inline: false,
          },
          { name: "Par", value: executor ? executor.tag : "Système", inline: false }
        )
        .setFooter({ text: `ID Rôle: ${newRole.id}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildRoleUpdate:", err);
    }
  });

  // Événements planifiés (serveur)
  client.on(Events.GuildScheduledEventCreate, async (evt) => {
    try {
      const guild = evt.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_event")) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.GuildScheduledEventCreate,
        evt.id
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("📅 Événement créé")
        .setDescription(evt.name || "Sans nom")
        .addFields(
          { name: "ID", value: evt.id, inline: true },
          { name: "Par", value: executor ? executor.tag : "Système", inline: true }
        )
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildScheduledEventCreate:", err);
    }
  });

  client.on(Events.GuildScheduledEventUpdate, async (oldEvt, newEvt) => {
    try {
      const guild = newEvt.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_event")) return;

      const changes = [];
      if (oldEvt.name !== newEvt.name) {
        changes.push(`Nom: \`${oldEvt.name}\` -> \`${newEvt.name}\``);
      }
      if (oldEvt.status !== newEvt.status) {
        changes.push(`Statut: \`${oldEvt.status}\` -> \`${newEvt.status}\``);
      }
      if (changes.length === 0) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.GuildScheduledEventUpdate,
        newEvt.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("🛠️ Événement modifié")
        .setDescription(newEvt.name || "Sans nom")
        .addFields(
          {
            name: "Changements",
            value: changes.join("\n").substring(0, 1024),
            inline: false,
          },
          { name: "Par", value: executor ? executor.tag : "Système", inline: false }
        )
        .setFooter({ text: `ID: ${newEvt.id}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildScheduledEventUpdate:", err);
    }
  });

  client.on(Events.GuildScheduledEventDelete, async (evt) => {
    try {
      const guild = evt.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_event")) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.GuildScheduledEventDelete,
        evt.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🗑️ Événement supprimé")
        .setDescription(evt.name || "Sans nom")
        .addFields(
          { name: "ID", value: evt.id, inline: true },
          { name: "Par", value: executor ? executor.tag : "Système", inline: true }
        )
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildScheduledEventDelete:", err);
    }
  });

  client.on(Events.GuildScheduledEventUserAdd, async (scheduledEvent, user) => {
    try {
      const guild = scheduledEvent.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_event_user")) return;

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("✅ Inscription événement")
        .setDescription(`${user.tag} (<@${user.id}>)`)
        .addFields({ name: "Événement", value: scheduledEvent.name || scheduledEvent.id })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildScheduledEventUserAdd:", err);
    }
  });

  client.on(Events.GuildScheduledEventUserRemove, async (scheduledEvent, user) => {
    try {
      const guild = scheduledEvent.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_event_user")) return;

      const embed = new EmbedBuilder()
        .setColor(0xff9900)
        .setTitle("❌ Désinscription événement")
        .setDescription(`${user.tag} (<@${user.id}>)`)
        .addFields({ name: "Événement", value: scheduledEvent.name || scheduledEvent.id })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildScheduledEventUserRemove:", err);
    }
  });

  // Stickers serveur
  client.on(Events.GuildStickerCreate, async (sticker) => {
    try {
      const guild = sticker.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_sticker")) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.StickerCreate,
        sticker.id
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("🏷️ Sticker créé")
        .setDescription(`\`${sticker.name}\``)
        .addFields(
          { name: "ID", value: sticker.id, inline: true },
          { name: "Par", value: executor ? executor.tag : "Système", inline: true }
        )
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildStickerCreate:", err);
    }
  });

  client.on(Events.GuildStickerDelete, async (sticker) => {
    try {
      const guild = sticker.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_sticker")) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.StickerDelete,
        sticker.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🗑️ Sticker supprimé")
        .setDescription(`\`${sticker.name}\``)
        .addFields(
          { name: "ID", value: sticker.id, inline: true },
          { name: "Par", value: executor ? executor.tag : "Système", inline: true }
        )
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildStickerDelete:", err);
    }
  });

  client.on(Events.GuildStickerUpdate, async (oldSticker, newSticker) => {
    try {
      const guild = newSticker.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_sticker")) return;

      const changes = [];
      if (oldSticker.name !== newSticker.name) {
        changes.push(`Nom: \`${oldSticker.name}\` -> \`${newSticker.name}\``);
      }
      if (oldSticker.description !== newSticker.description) {
        changes.push("Description modifiée");
      }
      if (changes.length === 0) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.StickerUpdate,
        newSticker.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("🛠️ Sticker modifié")
        .setDescription(`\`${newSticker.name}\``)
        .addFields(
          {
            name: "Changements",
            value: changes.join("\n").substring(0, 1024),
            inline: false,
          },
          { name: "Par", value: executor ? executor.tag : "Système", inline: false }
        )
        .setFooter({ text: `ID: ${newSticker.id}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs GuildStickerUpdate:", err);
    }
  });

  // Scène (stage)
  client.on(Events.StageInstanceCreate, async (instance) => {
    try {
      const guild = instance.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_stage")) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.StageInstanceCreate,
        instance.id
      );

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("🎭 Scène créée")
        .setDescription(instance.topic || "Sans titre")
        .addFields(
          {
            name: "Salon",
            value: instance.channelId ? `<#${instance.channelId}>` : "Inconnu",
            inline: false,
          },
          { name: "Par", value: executor ? executor.tag : "Système", inline: false }
        )
        .setFooter({ text: `ID: ${instance.id}` })
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs StageInstanceCreate:", err);
    }
  });

  client.on(Events.StageInstanceDelete, async (instance) => {
    try {
      const guild = instance.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_stage")) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.StageInstanceDelete,
        instance.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🗑️ Scène supprimée")
        .setDescription(instance.topic || "Sans titre")
        .addFields(
          {
            name: "Salon",
            value: instance.channelId ? `<#${instance.channelId}>` : "Inconnu",
            inline: false,
          },
          { name: "Par", value: executor ? executor.tag : "Système", inline: false }
        )
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs StageInstanceDelete:", err);
    }
  });

  client.on(Events.StageInstanceUpdate, async (oldInst, newInst) => {
    try {
      const guild = newInst.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_stage")) return;

      const changes = [];
      if (oldInst.topic !== newInst.topic) {
        changes.push(
          `Titre: \`${(oldInst.topic || "").substring(0, 80)}\` -> \`${(newInst.topic || "").substring(0, 80)}\``
        );
      }
      if (changes.length === 0) return;

      const executor = await getAuditLogExecutor(
        guild,
        AuditLogEvent.StageInstanceUpdate,
        newInst.id
      );

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("🛠️ Scène modifiée")
        .setDescription(newInst.topic || "Sans titre")
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
    } catch (err) {
      console.error("Erreur logs StageInstanceUpdate:", err);
    }
  });

  // Webhooks du salon
  client.on(Events.WebhooksUpdate, async (channel) => {
    try {
      const guild = channel?.guild;
      if (!guild) return;
      if (!isLogEnabled(guild.id, "srv_webhook")) return;

      const hooks = await channel.fetchWebhooks().catch(() => null);
      const names = hooks
        ? hooks.map((w) => w.name).slice(0, 8).join(", ")
        : "—";

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("🔗 Webhooks mis à jour")
        .setDescription(channel.isTextBased?.() ? `<#${channel.id}>` : String(channel.id))
        .addFields(
          { name: "Webhooks (aperçu)", value: names.substring(0, 1024) || "—" },
          { name: "Nombre", value: `${hooks ? hooks.size : 0}`, inline: true }
        )
        .setTimestamp();

      await sendLog(guild, embed);
    } catch (err) {
      console.error("Erreur logs WebhooksUpdate:", err);
    }
  });

  console.log("✅ Système de logs chargé");
};
