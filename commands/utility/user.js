const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("user")
    .setDescription("Fournit des informations sur l'utilisateur."),
  async execute(interaction) {
    // interaction.user est l'objet représentant l'Utilisateur qui a exécuté la commande
    // interaction.member est l'objet GuildMember, qui représente l'utilisateur dans le serveur spécifique
    await interaction.reply(
      `Cette commande a été exécutée par ${interaction.user.username}, qui a rejoint le serveur le ${interaction.member.joinedAt}.`
    );
  },
  executeMessage(message, args) {
    message.reply(
      `Cette commande a été exécutée par ${message.author.username}, qui a rejoint le serveur le ${message.member.joinedAt}.`
    );
  },
};
