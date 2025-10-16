const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("server")
    .setDescription("Fournit des informations sur le serveur")
    .addStringOption((option) =>
      option
        .setName("option")
        .setDescription("Afficher une information spécifique")
        .setRequired(false)
        .addChoices({ name: "Logo du serveur", value: "logo" })
    ),
  async execute(interaction) {
    const option = interaction.options.getString("option");
    const guild = interaction.guild;

    // Si l'option "logo" est sélectionnée
    if (option === "logo") {
      const logoUrl = guild.iconURL({ dynamic: true, size: 1024 });

      if (!logoUrl) {
        return interaction.reply({
          content: "❌ Ce serveur n'a pas de logo.",
          ephemeral: true,
        });
      }

      const logoEmbed = {
        color: 0x00ff00,
        title: `Logo de ${guild.name}`,
        image: {
          url: logoUrl,
        },
        timestamp: new Date(),
      };

      return interaction.reply({ embeds: [logoEmbed] });
    }

    // Calculer les membres en ligne
    const onlineMembers = guild.members.cache.filter(
      (member) =>
        member.presence?.status === "online" ||
        member.presence?.status === "idle" ||
        member.presence?.status === "dnd"
    ).size;

    // Calculer la date de création
    const createdDate = guild.createdAt;
    const now = new Date();
    const diffTime = Math.abs(now - createdDate);
    const diffYears = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 365));
    const diffMonths = Math.floor(
      (diffTime % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30)
    );
    const diffDays = Math.floor(
      (diffTime % (1000 * 60 * 60 * 24 * 30)) / (1000 * 60 * 60 * 24)
    );

    let ageString = "";
    if (diffYears > 0)
      ageString += `${diffYears} an${diffYears > 1 ? "s" : ""}`;
    if (diffMonths > 0) ageString += ` ${diffMonths} mois`;
    if (diffDays > 0 && diffYears === 0)
      ageString += ` ${diffDays} jour${diffDays > 1 ? "s" : ""}`;

    // Récupérer le propriétaire
    const owner = await guild.fetchOwner();

    // Compter les salons
    const channels = guild.channels.cache;
    const textChannels = channels.filter((c) => c.type === 0).size;
    const voiceChannels = channels.filter((c) => c.type === 2).size;
    const totalChannels = textChannels + voiceChannels;

    const serverEmbed = {
      color: 0x00ff00,
      title: guild.name,
      thumbnail: {
        url: guild.iconURL({ dynamic: true, size: 256 }) || "",
      },
      fields: [
        {
          name: "Propriétaire du serveur",
          value: `<@${owner.user.id}> (\`${owner.user.username}\`)\n**Identifiant**\n${owner.user.id}`,
          inline: false,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: false,
        },
        {
          name: "Membres",
          value: guild.memberCount.toString(),
          inline: true,
        },
        {
          name: "Membres en ligne",
          value: onlineMembers.toString(),
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Rôles",
          value: guild.roles.cache.size.toString(),
          inline: true,
        },
        {
          name: "Salons",
          value: totalChannels.toString(),
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Création du serveur",
          value: `${createdDate.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })} (il y a ${ageString})`,
          inline: false,
        },
        {
          name: "Liste des émojis",
          value:
            guild.emojis.cache.size > 0
              ? `${guild.emojis.cache.size} émoji(s)`
              : "Aucun",
          inline: false,
        },
      ],
      footer: {
        text: `Wingbot - Créé par Winga`,
        icon_url: interaction.client.user.displayAvatarURL(),
      },
      timestamp: new Date(),
    };

    await interaction.reply({ embeds: [serverEmbed] });
  },
  executeMessage(message, args) {
    const guild = message.guild;

    // Calculer les membres en ligne
    const onlineMembers = guild.members.cache.filter(
      (member) =>
        member.presence?.status === "online" ||
        member.presence?.status === "idle" ||
        member.presence?.status === "dnd"
    ).size;

    // Calculer la date de création
    const createdDate = guild.createdAt;
    const now = new Date();
    const diffTime = Math.abs(now - createdDate);
    const diffYears = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 365));
    const diffMonths = Math.floor(
      (diffTime % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30)
    );
    const diffDays = Math.floor(
      (diffTime % (1000 * 60 * 60 * 24 * 30)) / (1000 * 60 * 60 * 24)
    );

    let ageString = "";
    if (diffYears > 0)
      ageString += `${diffYears} an${diffYears > 1 ? "s" : ""}`;
    if (diffMonths > 0) ageString += ` ${diffMonths} mois`;
    if (diffDays > 0 && diffYears === 0)
      ageString += ` ${diffDays} jour${diffDays > 1 ? "s" : ""}`;

    // Récupérer le propriétaire
    guild.fetchOwner().then((owner) => {
      // Compter les salons
      const channels = guild.channels.cache;
      const textChannels = channels.filter((c) => c.type === 0).size;
      const voiceChannels = channels.filter((c) => c.type === 2).size;
      const totalChannels = textChannels + voiceChannels;

      const serverEmbed = {
        color: 0x00ff00,
        title: guild.name,
        thumbnail: {
          url: guild.iconURL({ dynamic: true, size: 256 }) || "",
        },
        fields: [
          {
            name: "Propriétaire du serveur",
            value: `<@${owner.user.id}> (\`${owner.user.username}\`)\n**Identifiant**\n${owner.user.id}`,
            inline: false,
          },
          {
            name: "\u200b",
            value: "\u200b",
            inline: false,
          },
          {
            name: "Membres",
            value: guild.memberCount.toString(),
            inline: true,
          },
          {
            name: "Membres en ligne",
            value: onlineMembers.toString(),
            inline: true,
          },
          {
            name: "\u200b",
            value: "\u200b",
            inline: true,
          },
          {
            name: "Rôles",
            value: guild.roles.cache.size.toString(),
            inline: true,
          },
          {
            name: "Salons",
            value: totalChannels.toString(),
            inline: true,
          },
          {
            name: "\u200b",
            value: "\u200b",
            inline: true,
          },
          {
            name: "Création du serveur",
            value: `${createdDate.toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })} (il y a ${ageString})`,
            inline: false,
          },
          {
            name: "Liste des émojis",
            value:
              guild.emojis.cache.size > 0
                ? `${guild.emojis.cache.size} émoji(s)`
                : "Aucun",
            inline: false,
          },
        ],
        footer: {
          text: `Wingbot - Créé par Winga`,
          icon_url: message.client.user.displayAvatarURL(),
        },
        timestamp: new Date(),
      };

      message.reply({ embeds: [serverEmbed] });
    });
  },
};
