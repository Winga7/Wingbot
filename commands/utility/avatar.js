const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Affiche l'avatar d'un utilisateur")
    .addUserOption((option) =>
      option
        .setName("utilisateur")
        .setDescription("L'utilisateur dont vous voulez voir l'avatar")
        .setRequired(false)
    ),
  async execute(interaction) {
    // Si aucun utilisateur n'est spécifié, utiliser l'auteur de la commande
    const user = interaction.options.getUser("utilisateur") || interaction.user;

    const avatarEmbed = {
      color: 0x00ff00,
      title: `Avatar de ${user.username}`,
      image: {
        url: user.displayAvatarURL({ dynamic: true, size: 1024 }),
      },
      footer: {
        text: `Demandé par ${interaction.user.username}`,
      },
      timestamp: new Date(),
    };

    await interaction.reply({ embeds: [avatarEmbed] });
  },
  executeMessage(message, args) {
    // Si un utilisateur est mentionné, utiliser celui-ci, sinon utiliser l'auteur
    const user = message.mentions.users.first() || message.author;

    const avatarEmbed = {
      color: 0x00ff00,
      title: `Avatar de ${user.username}`,
      image: {
        url: user.displayAvatarURL({ dynamic: true, size: 1024 }),
      },
      footer: {
        text: `Demandé par ${message.author.username}`,
      },
      timestamp: new Date(),
    };

    message.reply({ embeds: [avatarEmbed] });
  },
};
