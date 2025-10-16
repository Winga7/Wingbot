const { SlashCommandBuilder } = require("discord.js");
const { version } = require("../../package.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Affiche les informations détaillées sur le bot"),
  async execute(interaction) {
    const client = interaction.client;

    // Calculer l'uptime
    const uptime = client.uptime;
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptime % (1000 * 60)) / 1000);

    let uptimeString = "";
    if (days > 0) uptimeString += `${days}j `;
    if (hours > 0) uptimeString += `${hours}h `;
    if (minutes > 0) uptimeString += `${minutes}m `;
    uptimeString += `${seconds}s`;

    // Calculer la mémoire utilisée
    const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(
      2
    );

    // Nombre total d'utilisateurs
    const totalUsers = client.guilds.cache.reduce(
      (acc, guild) => acc + guild.memberCount,
      0
    );

    // Date de création du bot
    const createdDate = client.user.createdAt;
    const accountAge = Math.floor(
      (Date.now() - createdDate) / (1000 * 60 * 60 * 24)
    );

    const botEmbed = {
      color: 0x00ff00,
      title: "Informations sur le bot",
      thumbnail: {
        url: client.user.displayAvatarURL({ dynamic: true, size: 256 }),
      },
      fields: [
        {
          name: "Nom du bot",
          value: `${client.user.username}#${client.user.discriminator}`,
          inline: false,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: false,
        },
        {
          name: "Serveurs",
          value: client.guilds.cache.size.toString(),
          inline: true,
        },
        {
          name: "Utilisateurs",
          value: totalUsers.toString(),
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Commandes",
          value: client.commands.size.toString(),
          inline: true,
        },
        {
          name: "Ping",
          value: `${Math.round(client.ws.ping)}ms`,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Uptime",
          value: uptimeString,
          inline: false,
        },
        {
          name: "Mémoire utilisée",
          value: `${memoryUsage} MB`,
          inline: true,
        },
        {
          name: "Node.js",
          value: process.version,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Création du compte",
          value: `${createdDate.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })} (il y a ${accountAge} jours)`,
          inline: false,
        },
      ],
      footer: {
        text: `Wingbot v${version || "1.0.0"} - Créé par Winga`,
        icon_url: client.user.displayAvatarURL(),
      },
      timestamp: new Date(),
    };

    await interaction.reply({ embeds: [botEmbed] });
  },
  executeMessage(message, args) {
    const client = message.client;

    // Calculer l'uptime
    const uptime = client.uptime;
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptime % (1000 * 60)) / 1000);

    let uptimeString = "";
    if (days > 0) uptimeString += `${days}j `;
    if (hours > 0) uptimeString += `${hours}h `;
    if (minutes > 0) uptimeString += `${minutes}m `;
    uptimeString += `${seconds}s`;

    // Calculer la mémoire utilisée
    const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(
      2
    );

    // Nombre total d'utilisateurs
    const totalUsers = client.guilds.cache.reduce(
      (acc, guild) => acc + guild.memberCount,
      0
    );

    // Date de création du bot
    const createdDate = client.user.createdAt;
    const accountAge = Math.floor(
      (Date.now() - createdDate) / (1000 * 60 * 60 * 24)
    );

    const botEmbed = {
      color: 0x00ff00,
      title: "Informations sur le bot",
      thumbnail: {
        url: client.user.displayAvatarURL({ dynamic: true, size: 256 }),
      },
      fields: [
        {
          name: "Nom du bot",
          value: `${client.user.username}#${client.user.discriminator}`,
          inline: false,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: false,
        },
        {
          name: "Serveurs",
          value: client.guilds.cache.size.toString(),
          inline: true,
        },
        {
          name: "Utilisateurs",
          value: totalUsers.toString(),
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Commandes",
          value: client.commands.size.toString(),
          inline: true,
        },
        {
          name: "Ping",
          value: `${Math.round(client.ws.ping)}ms`,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Uptime",
          value: uptimeString,
          inline: false,
        },
        {
          name: "Mémoire utilisée",
          value: `${memoryUsage} MB`,
          inline: true,
        },
        {
          name: "Node.js",
          value: process.version,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
        {
          name: "Création du compte",
          value: `${createdDate.toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })} (il y a ${accountAge} jours)`,
          inline: false,
        },
      ],
      footer: {
        text: `Wingbot v${version || "1.0.0"} - Créé par Winga`,
        icon_url: client.user.displayAvatarURL(),
      },
      timestamp: new Date(),
    };

    message.reply({ embeds: [botEmbed] });
  },
};
