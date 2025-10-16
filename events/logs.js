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

    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

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
    if (!settings.log_members) return;

    // Vérifier si c'est un kick ou ban
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

    let reason = "A quitté le serveur";
    let color = 0xff9900;

    if (banExecutor) {
      reason = `Banni par ${banExecutor.tag}`;
      color = 0xff0000;
    } else if (kickExecutor) {
      reason = `Expulsé par ${kickExecutor.tag}`;
      color = 0xff6600;
    }

    const roles =
      member.roles.cache
        .filter((role) => role.id !== member.guild.id)
        .map((role) => role.name)
        .join(", ") || "Aucun rôle";

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle("👋 Membre Parti")
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
  });

  // === LOGS DE RÔLES ===

  // Changement de rôles
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const settings = getLogSettings(newMember.guild.id);
    if (!settings.log_roles) return;

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
  });

  console.log("✅ Système de logs chargé");
};
