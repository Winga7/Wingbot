const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Affiche les informations détaillées sur un utilisateur")
    .addUserOption((option) =>
      option
        .setName("utilisateur")
        .setDescription("L'utilisateur dont vous voulez voir les informations")
        .setRequired(false)
    ),
  async execute(interaction) {
    // Si aucun utilisateur n'est spécifié, utiliser l'auteur de la commande
    if (!interaction.guild) {
      return interaction.reply({
        content: "Cette commande s’utilise dans un serveur.",
        ephemeral: true,
      });
    }
    const user = interaction.options.getUser("utilisateur") || interaction.user;
    const member =
      interaction.options.getMember("utilisateur") ||
      (await interaction.guild.members.fetch(user.id).catch(() => null));

    // Date de création du compte
    const accountCreated = user.createdAt;
    const accountAge = Math.floor(
      (Date.now() - accountCreated) / (1000 * 60 * 60 * 24)
    );

    // Date de rejoindre le serveur
    const joinedDate = member?.joinedAt || null;
    const joinedAge = joinedDate
      ? Math.floor((Date.now() - joinedDate) / (1000 * 60 * 60 * 24))
      : null;

    // Récupérer les rôles (sans @everyone)
    const roles = member?.roles.cache
      .filter((role) => role.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => role.toString())
      .slice(0, 10); // Limiter à 10 rôles pour éviter un message trop long

    const rolesDisplay =
      roles && roles.length > 0 ? roles.join(", ") : "Aucun rôle";

    // Statut de l'utilisateur
    const presence = member?.presence;
    const status = presence?.status || "offline";
    const statusEmojis = {
      online: "🟢 En ligne",
      idle: "🟡 Inactif",
      dnd: "🔴 Ne pas déranger",
      offline: "⚫ Hors ligne",
    };

    // Badge de boost
    const boostStatus = member?.premiumSince
      ? `✨ Boost depuis le ${member.premiumSince.toLocaleDateString("fr-FR")}`
      : "Non";

    // Convertir la couleur (displayColor retourne déjà un nombre)
    const embedColor = member?.displayColor || 0x00ff00;

    const userEmbed = {
      color: embedColor,
      title: `Informations sur ${user.username}`,
      thumbnail: {
        url: user.displayAvatarURL({ dynamic: true, size: 256 }),
      },
      fields: [
        {
          name: "Utilisateur",
          value: `<@${user.id}>\n**Tag**\n${user.tag}\n**ID**\n${user.id}`,
          inline: false,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: false,
        },
        {
          name: "Statut",
          value: statusEmojis[status],
          inline: true,
        },
        {
          name: "Bot",
          value: user.bot ? "Oui 🤖" : "Non",
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Compte créé le",
          value: `${accountCreated.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}\n(il y a ${accountAge} jours)`,
          inline: false,
        },
        {
          name: "A rejoint le serveur",
          value: joinedDate
            ? `${joinedDate.toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}\n(il y a ${joinedAge} jours)`
            : "Non disponible",
          inline: false,
        },
        {
          name: "Boost du serveur",
          value: boostStatus,
          inline: false,
        },
        {
          name: `Rôles [${roles ? roles.length : 0}]`,
          value: rolesDisplay,
          inline: false,
        },
      ],
      footer: {
        text: `Wingbot - Créé par Winga`,
        icon_url: interaction.client.user.displayAvatarURL(),
      },
      timestamp: new Date(),
    };

    await interaction.reply({ embeds: [userEmbed] });
  },
  async executeMessage(message, args) {
    const { resolveMessageUser, resolveMessageMember } = require("../../lib/resolveTargets");
    const user = (await resolveMessageUser(message, args[0])) || message.author;
    const member = await resolveMessageMember(message, user.id);

    // Date de création du compte
    const accountCreated = user.createdAt;
    const accountAge = Math.floor(
      (Date.now() - accountCreated) / (1000 * 60 * 60 * 24)
    );

    // Date de rejoindre le serveur
    const joinedDate = member?.joinedAt || null;
    const joinedAge = joinedDate
      ? Math.floor((Date.now() - joinedDate) / (1000 * 60 * 60 * 24))
      : null;

    // Récupérer les rôles (sans @everyone)
    const roles = member?.roles.cache
      .filter((role) => role.id !== message.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => role.toString())
      .slice(0, 10);

    const rolesDisplay =
      roles && roles.length > 0 ? roles.join(", ") : "Aucun rôle";

    // Statut de l'utilisateur
    const presence = member?.presence;
    const status = presence?.status || "offline";
    const statusEmojis = {
      online: "🟢 En ligne",
      idle: "🟡 Inactif",
      dnd: "🔴 Ne pas déranger",
      offline: "⚫ Hors ligne",
    };

    // Badge de boost
    const boostStatus = member?.premiumSince
      ? `✨ Boost depuis le ${member.premiumSince.toLocaleDateString("fr-FR")}`
      : "Non";

    // Convertir la couleur (displayColor retourne déjà un nombre)
    const embedColor = member?.displayColor || 0x00ff00;

    const userEmbed = {
      color: embedColor,
      title: `Informations sur ${user.username}`,
      thumbnail: {
        url: user.displayAvatarURL({ dynamic: true, size: 256 }),
      },
      fields: [
        {
          name: "Utilisateur",
          value: `<@${user.id}>\n**Tag**\n${user.tag}\n**ID**\n${user.id}`,
          inline: false,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: false,
        },
        {
          name: "Statut",
          value: statusEmojis[status],
          inline: true,
        },
        {
          name: "Bot",
          value: user.bot ? "Oui 🤖" : "Non",
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Compte créé le",
          value: `${accountCreated.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}\n(il y a ${accountAge} jours)`,
          inline: false,
        },
        {
          name: "A rejoint le serveur",
          value: joinedDate
            ? `${joinedDate.toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}\n(il y a ${joinedAge} jours)`
            : "Non disponible",
          inline: false,
        },
        {
          name: "Boost du serveur",
          value: boostStatus,
          inline: false,
        },
        {
          name: `Rôles [${roles ? roles.length : 0}]`,
          value: rolesDisplay,
          inline: false,
        },
      ],
      footer: {
        text: `Wingbot - Créé par Winga`,
        icon_url: message.client.user.displayAvatarURL(),
      },
      timestamp: new Date(),
    };

    message.reply({ embeds: [userEmbed] });
  },
};
