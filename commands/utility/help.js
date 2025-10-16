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
            "`$ping` - Répond avec Pong!\n`$user` - Informations sur l'utilisateur\n`$userinfo [@utilisateur]` - Infos détaillées sur un utilisateur\n`$server` - Informations sur le serveur\n`$serverlogo` - Affiche le logo du serveur\n`$botinfo` - Informations sur le bot\n`$roleinfo <@role>` - Informations sur un rôle\n`$avatar [@utilisateur]` - Affiche l'avatar d'un utilisateur\n`$help` - Affiche cette aide\n`$clear [nombre]` - Supprime des messages",
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
            "`$ping` - Répond avec Pong!\n`$user` - Informations sur l'utilisateur\n`$userinfo [@utilisateur]` - Infos détaillées sur un utilisateur\n`$server` - Informations sur le serveur\n`$serverlogo` - Affiche le logo du serveur\n`$botinfo` - Informations sur le bot\n`$roleinfo <@role>` - Informations sur un rôle\n`$avatar [@utilisateur]` - Affiche l'avatar d'un utilisateur\n`$help` - Affiche cette aide\n`$clear [nombre]` - Supprime des messages",
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
