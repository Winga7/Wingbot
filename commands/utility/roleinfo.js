const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roleinfo")
    .setDescription("Affiche les informations sur un rôle")
    .addRoleOption((option) =>
      option
        .setName("role")
        .setDescription("Le rôle dont vous voulez voir les informations")
        .setRequired(true)
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "Cette commande s’utilise dans un serveur.",
        ephemeral: true,
      });
    }
    const role = interaction.options.getRole("role");
    if (!role) {
      return interaction.reply({
        content: "❌ Rôle introuvable.",
        ephemeral: true,
      });
    }

    // Date de création du rôle
    const createdDate = role.createdAt;
    const roleAge = Math.floor(
      (Date.now() - createdDate) / (1000 * 60 * 60 * 24)
    );

    // Permissions importantes
    const keyPermissions = [];
    if (role.permissions.has(PermissionFlagsBits.Administrator))
      keyPermissions.push("👑 Administrateur");
    if (role.permissions.has(PermissionFlagsBits.ManageGuild))
      keyPermissions.push("⚙️ Gérer le serveur");
    if (role.permissions.has(PermissionFlagsBits.ManageRoles))
      keyPermissions.push("🎭 Gérer les rôles");
    if (role.permissions.has(PermissionFlagsBits.ManageChannels))
      keyPermissions.push("📝 Gérer les salons");
    if (role.permissions.has(PermissionFlagsBits.KickMembers))
      keyPermissions.push("👢 Expulser des membres");
    if (role.permissions.has(PermissionFlagsBits.BanMembers))
      keyPermissions.push("🔨 Bannir des membres");
    if (role.permissions.has(PermissionFlagsBits.ManageMessages))
      keyPermissions.push("🗑️ Gérer les messages");
    if (role.permissions.has(PermissionFlagsBits.MentionEveryone))
      keyPermissions.push("📢 Mentionner @everyone");

    const permissionsDisplay =
      keyPermissions.length > 0
        ? keyPermissions.join("\n")
        : "Aucune permission spéciale";

    // Nombre de membres avec ce rôle
    const memberCount = role.members.size;

    // Position du rôle
    const position = role.position;

    // Couleur du rôle
    const colorHex = role.hexColor !== "#000000" ? role.hexColor : "Aucune";

    const roleEmbed = {
      color: role.color || 0x00ff00,
      title: "Informations sur le rôle",
      fields: [
        {
          name: "Nom du rôle",
          value: `${role}\n**ID**\n${role.id}`,
          inline: false,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: false,
        },
        {
          name: "Couleur",
          value: colorHex,
          inline: true,
        },
        {
          name: "Position",
          value: position.toString(),
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Membres",
          value: `${memberCount} membre(s)`,
          inline: true,
        },
        {
          name: "Mentionnable",
          value: role.mentionable ? "✅ Oui" : "❌ Non",
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Affiché séparément",
          value: role.hoist ? "✅ Oui" : "❌ Non",
          inline: true,
        },
        {
          name: "Géré par une intégration",
          value: role.managed ? "✅ Oui (bot/boost)" : "❌ Non",
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Créé le",
          value: `${createdDate.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}\n(il y a ${roleAge} jours)`,
          inline: false,
        },
        {
          name: "Permissions clés",
          value: permissionsDisplay,
          inline: false,
        },
      ],
      footer: {
        text: `Wingbot - Créé par Winga`,
        icon_url: interaction.client.user.displayAvatarURL(),
      },
      timestamp: new Date(),
    };

    await interaction.reply({ embeds: [roleEmbed] });
  },
  executeMessage(message, args) {
    // Récupérer le rôle mentionné ou par nom
    let role = message.mentions.roles.first();

    // Si pas de mention, chercher par nom
    if (!role && args.length > 0) {
      const roleName = args.join(" ");
      role = message.guild.roles.cache.find(
        (r) => r.name.toLowerCase() === roleName.toLowerCase()
      );
    }

    if (!role) {
      return message.reply(
        "❌ Veuillez mentionner un rôle ou fournir le nom d'un rôle valide.\nExemple: `$roleinfo @Modérateur` ou `$roleinfo Modérateur`"
      );
    }

    // Date de création du rôle
    const createdDate = role.createdAt;
    const roleAge = Math.floor(
      (Date.now() - createdDate) / (1000 * 60 * 60 * 24)
    );

    // Permissions importantes
    const keyPermissions = [];
    if (role.permissions.has(PermissionFlagsBits.Administrator))
      keyPermissions.push("👑 Administrateur");
    if (role.permissions.has(PermissionFlagsBits.ManageGuild))
      keyPermissions.push("⚙️ Gérer le serveur");
    if (role.permissions.has(PermissionFlagsBits.ManageRoles))
      keyPermissions.push("🎭 Gérer les rôles");
    if (role.permissions.has(PermissionFlagsBits.ManageChannels))
      keyPermissions.push("📝 Gérer les salons");
    if (role.permissions.has(PermissionFlagsBits.KickMembers))
      keyPermissions.push("👢 Expulser des membres");
    if (role.permissions.has(PermissionFlagsBits.BanMembers))
      keyPermissions.push("🔨 Bannir des membres");
    if (role.permissions.has(PermissionFlagsBits.ManageMessages))
      keyPermissions.push("🗑️ Gérer les messages");
    if (role.permissions.has(PermissionFlagsBits.MentionEveryone))
      keyPermissions.push("📢 Mentionner @everyone");

    const permissionsDisplay =
      keyPermissions.length > 0
        ? keyPermissions.join("\n")
        : "Aucune permission spéciale";

    // Nombre de membres avec ce rôle
    const memberCount = role.members.size;

    // Position du rôle
    const position = role.position;

    // Couleur du rôle
    const colorHex = role.hexColor !== "#000000" ? role.hexColor : "Aucune";

    const roleEmbed = {
      color: role.color || 0x00ff00,
      title: "Informations sur le rôle",
      fields: [
        {
          name: "Nom du rôle",
          value: `${role}\n**ID**\n${role.id}`,
          inline: false,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: false,
        },
        {
          name: "Couleur",
          value: colorHex,
          inline: true,
        },
        {
          name: "Position",
          value: position.toString(),
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Membres",
          value: `${memberCount} membre(s)`,
          inline: true,
        },
        {
          name: "Mentionnable",
          value: role.mentionable ? "✅ Oui" : "❌ Non",
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Affiché séparément",
          value: role.hoist ? "✅ Oui" : "❌ Non",
          inline: true,
        },
        {
          name: "Géré par une intégration",
          value: role.managed ? "✅ Oui (bot/boost)" : "❌ Non",
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Créé le",
          value: `${createdDate.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}\n(il y a ${roleAge} jours)`,
          inline: false,
        },
        {
          name: "Permissions clés",
          value: permissionsDisplay,
          inline: false,
        },
      ],
      footer: {
        text: `Wingbot - Créé par Winga`,
        icon_url: message.client.user.displayAvatarURL(),
      },
      timestamp: new Date(),
    };

    message.reply({ embeds: [roleEmbed] });
  },
};
