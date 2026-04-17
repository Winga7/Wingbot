const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Retire le timeout d’un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre").setRequired(true)
    ),

  async execute(interaction) {
    const member = interaction.options.getMember("membre");
    if (!member) {
      return interaction.reply({
        content: "❌ Membre introuvable.",
        ephemeral: true,
      });
    }
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({
        content: "❌ Tu n’as pas la permission de modérer les membres.",
        ephemeral: true,
      });
    }
    if (!member.moderatable) {
      return interaction.reply({
        content: "❌ Je ne peux pas modifier ce membre.",
        ephemeral: true,
      });
    }

    try {
      await member.timeout(null);
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("Timeout retiré")
        .setDescription(`**${member.user.tag}** peut à nouveau parler.`)
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } catch (e) {
      console.error(e);
      await interaction.reply({
        content: "❌ Impossible de retirer le timeout.",
        ephemeral: true,
      });
    }
  },

  executeMessage(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply(
        "❌ Tu n’as pas la permission de modérer les membres."
      );
    }
    const target =
      message.mentions.members?.first() ||
      (args[0] &&
        message.guild.members.cache.get(String(args[0]).replace(/\D/g, "")));
    if (!target) {
      return message.reply("Usage : `untimeout @membre`");
    }
    if (!target.moderatable) {
      return message.reply("❌ Je ne peux pas modifier ce membre.");
    }

    return target
      .timeout(null)
      .then(() =>
        message.reply(`✅ Timeout retiré pour **${target.user.tag}**.`)
      )
      .catch(() => message.reply("❌ Impossible de retirer le timeout."));
  },
};
