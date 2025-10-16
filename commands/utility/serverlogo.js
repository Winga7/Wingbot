const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("serverlogo")
    .setDescription("Affiche le logo du serveur"),
  async execute(interaction) {
    const guild = interaction.guild;
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
      footer: {
        text: `Demandé par ${interaction.user.username}`,
      },
      timestamp: new Date(),
    };

    await interaction.reply({ embeds: [logoEmbed] });
  },
  executeMessage(message, args) {
    const guild = message.guild;
    const logoUrl = guild.iconURL({ dynamic: true, size: 1024 });

    if (!logoUrl) {
      return message.reply("❌ Ce serveur n'a pas de logo.");
    }

    const logoEmbed = {
      color: 0x00ff00,
      title: `Logo de ${guild.name}`,
      image: {
        url: logoUrl,
      },
      footer: {
        text: `Demandé par ${message.author.username}`,
      },
      timestamp: new Date(),
    };

    message.reply({ embeds: [logoEmbed] });
  },
};
