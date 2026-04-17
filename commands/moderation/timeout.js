const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

const MAX_MIN = 40320; // 28 jours

module.exports = {
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Met un membre en timeout (sourdine)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre à timeout").setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName("minutes")
        .setDescription("Durée en minutes (1 à 40320)")
        .setMinValue(1)
        .setMaxValue(MAX_MIN)
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("raison").setDescription("Raison (optionnel)").setRequired(false)
    ),

  async execute(interaction) {
    const member = interaction.options.getMember("membre");
    const minutes = interaction.options.getInteger("minutes", true);
    const reason =
      interaction.options.getString("raison")?.slice(0, 512) || "Aucune raison";

    if (!member) {
      return interaction.reply({
        content: "❌ Membre introuvable sur ce serveur.",
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
        content: "❌ Je ne peux pas timeout ce membre.",
        ephemeral: true,
      });
    }
    if (member.id === interaction.user.id) {
      return interaction.reply({
        content: "❌ Tu ne peux pas te timeout toi-même.",
        ephemeral: true,
      });
    }

    const ms = minutes * 60 * 1000;
    try {
      await member.timeout(ms, reason);
      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle("Timeout appliqué")
        .setDescription(
          `**${member.user.tag}** — **${minutes}** min.\n**Raison :** ${reason}`
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } catch (e) {
      console.error(e);
      await interaction.reply({
        content: "❌ Impossible d’appliquer le timeout.",
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
    const minutes = parseInt(args[1], 10);
    if (!target || isNaN(minutes) || minutes < 1 || minutes > MAX_MIN) {
      return message.reply(
        `Usage : \`timeout @membre <minutes> [raison]\` (1–${MAX_MIN} min)`
      );
    }
    const reason =
      args.slice(2).join(" ").trim().slice(0, 512) || "Aucune raison";

    if (!target.moderatable) {
      return message.reply("❌ Je ne peux pas timeout ce membre.");
    }
    if (target.id === message.author.id) {
      return message.reply("❌ Tu ne peux pas te timeout toi-même.");
    }

    const ms = minutes * 60 * 1000;
    return target
      .timeout(ms, reason)
      .then(() =>
        message.reply(
          `✅ **${target.user.tag}** — timeout **${minutes}** min. Raison : ${reason}`
        )
      )
      .catch(() => message.reply("❌ Impossible d’appliquer le timeout."));
  },
};
