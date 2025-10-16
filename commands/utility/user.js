const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("user")
    .setDescription("Fournit des informations sur l'utilisateur")
    .addUserOption((option) =>
      option
        .setName("utilisateur")
        .setDescription("L'utilisateur dont vous voulez voir les informations")
        .setRequired(false)
    ),
  async execute(interaction) {
    // Si aucun utilisateur n'est spécifié, utiliser l'auteur de la commande
    const user = interaction.options.getUser("utilisateur") || interaction.user;
    const member = interaction.guild.members.cache.get(user.id);

    await interaction.reply(
      `Cette commande a été exécutée par ${
        interaction.user.username
      }, qui a rejoint le serveur le ${interaction.member.joinedAt}.\n${
        user.id !== interaction.user.id
          ? `Informations sur ${user.username} : a rejoint le serveur le ${
              member?.joinedAt || "Non disponible"
            }.`
          : ""
      }`
    );
  },
  executeMessage(message, args) {
    const user = message.mentions.users.first() || message.author;
    const member = message.guild.members.cache.get(user.id);

    message.reply(
      `Cette commande a été exécutée par ${
        message.author.username
      }, qui a rejoint le serveur le ${message.member.joinedAt}.${
        user.id !== message.author.id
          ? `\nInformations sur ${user.username} : a rejoint le serveur le ${
              member?.joinedAt || "Non disponible"
            }.`
          : ""
      }`
    );
  },
};
