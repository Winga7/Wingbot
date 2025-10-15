const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Affiche la liste des commandes disponibles."),
  async execute(interaction) {
    const helpEmbed = {
      color: 0x00ff00, // Couleur du pseudo Winga
      title: "Commandes disponibles",
      description: "Voici les commandes avec préfixe `$` disponibles :",
      fields: [
        {
          name: "Commandes avec préfixe ($)",
          value:
            "`$ping` - Répond avec Pong!\n`$user` - Informations sur l'utilisateur\n`$server` - Informations sur le serveur\n`$help` - Affiche cette aide",
          inline: false,
        },
      ],
      timestamp: new Date(),
      footer: {
        text: "Wingbot - Créé par Winga",
      },
    };

    await interaction.reply({ embeds: [helpEmbed] });
  },
  executeMessage(message, args) {
    const helpEmbed = {
      color: 0x00ff00, // Couleur du pseudo Winga
      title: "Commandes disponibles",
      description: "Voici les commandes avec préfixe `$` disponibles :",
      fields: [
        {
          name: "Commandes avec préfixe ($)",
          value:
            "`$ping` - Répond avec Pong!\n`$user` - Informations sur l'utilisateur\n`$server` - Informations sur le serveur\n`$help` - Affiche cette aide",
          inline: false,
        },
      ],
      timestamp: new Date(),
      footer: {
        text: "Wingbot - Créé par Winga",
      },
    };

    message.reply({ embeds: [helpEmbed] });
  },
};
