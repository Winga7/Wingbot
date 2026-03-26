const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Affiche la liste des commandes disponibles."),
  async execute(interaction) {
    const helpEmbed = {
      color: 0x00ff00, // Couleur du pseudo Winga
      title: "Commandes disponibles",
      description:
        "Voici les commandes disponibles en préfixe (`$`) et en slash (`/`) :",
      fields: [
        {
          name: "Commandes avec préfixe ($)",
          value:
            "**📋 Informations**\n`$ping` - Répond avec Pong!\n`$user` - Informations sur l'utilisateur\n`$userinfo [@utilisateur]` - Infos détaillées sur un utilisateur\n`$server` - Informations sur le serveur\n`$serverlogo` - Affiche le logo du serveur\n`$botinfo` - Informations sur le bot\n`$roleinfo <@role>` - Informations sur un rôle\n`$avatar [@utilisateur]` - Affiche l'avatar d'un utilisateur\n`$messageinfo <message_id>` - Affiche un message depuis le cache (si supprimé)\n\n**🛡️ Modération**\n`$clear [nombre]` - Supprime des messages\n\n**⚙️ Configuration (Admin)**\n`$setlogchannel #salon` - Définir le salon de logs\n`$togglelog <type> <on/off>` - Activer/désactiver des logs\n`$logconfig` - Voir la configuration des logs\n`$logtest` - Test des logs\n`$clearcache` - Nettoie le cache des messages\n\n`$help` - Affiche cette aide",
          inline: false,
        },
        {
          name: "Commandes slash (/)",
          value:
            "**📋 Informations**\n`/ping` - Répond avec Pong!\n`/user` - Informations sur l'utilisateur\n`/userinfo [utilisateur]` - Infos détaillées sur un utilisateur\n`/server` - Informations sur le serveur\n`/serverlogo` - Affiche le logo du serveur\n`/botinfo` - Informations sur le bot\n`/roleinfo role` - Informations sur un rôle\n`/avatar [utilisateur]` - Affiche l'avatar d'un utilisateur\n`/messageinfo id` - Affiche un message depuis le cache (si supprimé)\n\n**🛡️ Modération**\n`/clear [nombre]` - Supprime des messages (optionnel)\n\n**⚙️ Configuration (Admin)**\n`/setlogchannel salon` - Définir le salon de logs\n`/togglelog type etat` - Activer/désactiver des logs\n`/logconfig` - Voir la configuration des logs\n`/logtest` - Test des logs\n`/clearcache` - Nettoie le cache des messages\n\n`/help` - Affiche cette aide",
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
      description:
        "Voici les commandes disponibles en préfixe (`$`) et en slash (`/`) :",
      fields: [
        {
          name: "Commandes avec préfixe ($)",
          value:
            "**📋 Informations**\n`$ping` - Répond avec Pong!\n`$user` - Informations sur l'utilisateur\n`$userinfo [@utilisateur]` - Infos détaillées sur un utilisateur\n`$server` - Informations sur le serveur\n`$serverlogo` - Affiche le logo du serveur\n`$botinfo` - Informations sur le bot\n`$roleinfo <@role>` - Informations sur un rôle\n`$avatar [@utilisateur]` - Affiche l'avatar d'un utilisateur\n`$messageinfo <message_id>` - Affiche un message depuis le cache (si supprimé)\n\n**🛡️ Modération**\n`$clear [nombre]` - Supprime des messages\n\n**⚙️ Configuration (Admin)**\n`$setlogchannel #salon` - Définir le salon de logs\n`$togglelog <type> <on/off>` - Activer/désactiver des logs\n`$logconfig` - Voir la configuration des logs\n`$logtest` - Test des logs\n`$clearcache` - Nettoie le cache des messages\n\n`$help` - Affiche cette aide",
          inline: false,
        },
        {
          name: "Commandes slash (/)",
          value:
            "**📋 Informations**\n`/ping` - Répond avec Pong!\n`/user` - Informations sur l'utilisateur\n`/userinfo [utilisateur]` - Infos détaillées sur un utilisateur\n`/server` - Informations sur le serveur\n`/serverlogo` - Affiche le logo du serveur\n`/botinfo` - Informations sur le bot\n`/roleinfo role` - Informations sur un rôle\n`/avatar [utilisateur]` - Affiche l'avatar d'un utilisateur\n`/messageinfo id` - Affiche un message depuis le cache (si supprimé)\n\n**🛡️ Modération**\n`/clear [nombre]` - Supprime des messages (optionnel)\n\n**⚙️ Configuration (Admin)**\n`/setlogchannel salon` - Définir le salon de logs\n`/togglelog type etat` - Activer/désactiver des logs\n`/logconfig` - Voir la configuration des logs\n`/logtest` - Test des logs\n`/clearcache` - Nettoie le cache des messages\n\n`/help` - Affiche cette aide",
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
