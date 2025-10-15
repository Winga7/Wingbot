const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("server")
    .setDescription("Fournit des informations sur le serveur."),
  async execute(interaction) {
    // interaction.guild est l'objet représentant le Serveur dans lequel la commande a été exécutée
    await interaction.reply(
      `Ce serveur s'appelle ${interaction.guild.name} et a ${interaction.guild.memberCount} membres.`
    );
  },
  executeMessage(message, args) {
    // message.guild est l'objet représentant le Serveur dans lequel la commande a été exécutée
    message.reply(
      `Ce serveur s'appelle ${message.guild.name} et a ${message.guild.memberCount} membres.`
    );
  },
};
