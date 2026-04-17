const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { memberHasPermOrAdmin } = require("../../memberPerms");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Envoie un avertissement public à un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre averti").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("raison").setDescription("Raison").setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("membre", true);
    const reason = interaction.options.getString("raison", true).slice(0, 500);

    if (!memberHasPermOrAdmin(interaction.member, PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({
        content: "❌ Tu n’as pas la permission de modérer les membres.",
        ephemeral: true,
      });
    }
    if (user.id === interaction.user.id) {
      return interaction.reply({
        content: "❌ Tu ne peux pas t’avertir toi-même.",
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0xeab308)
      .setTitle("Avertissement")
      .setDescription(
        `${user} a reçu un avertissement.\n\n**Raison :** ${reason}`
      )
      .setFooter({ text: `Par ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    try {
      await user.send({
        content: `⚠️ Tu as été averti sur **${interaction.guild.name}** : ${reason}`,
      });
    } catch {
      /* MP fermés */
    }
  },

  executeMessage(message, args) {
    if (!memberHasPermOrAdmin(message.member, PermissionFlagsBits.ModerateMembers)) {
      return message.reply(
        "❌ Tu n’as pas la permission de modérer les membres."
      );
    }
    const target =
      message.mentions.users.first() ||
      (args[0] && message.client.users.cache.get(args[0].replace(/\D/g, "")));
    if (!target) {
      return message.reply("Usage : `warn @membre <raison>`");
    }
    const reason = args.slice(1).join(" ").trim();
    if (!reason) {
      return message.reply("Indique une raison.");
    }
    if (target.id === message.author.id) {
      return message.reply("❌ Tu ne peux pas t’avertir toi-même.");
    }

    const embed = new EmbedBuilder()
      .setColor(0xeab308)
      .setTitle("Avertissement")
      .setDescription(
        `${target} a reçu un avertissement.\n\n**Raison :** ${reason.slice(0, 500)}`
      )
      .setFooter({ text: `Par ${message.author.tag}` })
      .setTimestamp();

    return message.reply({ embeds: [embed] }).then(() => {
      target
        .send({
          content: `⚠️ Tu as été averti sur **${message.guild.name}** : ${reason.slice(0, 500)}`,
        })
        .catch(() => {});
    });
  },
};
