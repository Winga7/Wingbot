const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { memberHasPermOrAdmin } = require("../../memberPerms");

const MAX_SEC = 21600; // 6 h

module.exports = {
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Définit le mode lent du salon (0 = désactivé)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((o) =>
      o
        .setName("secondes")
        .setDescription("Délai entre deux messages (0–21600)")
        .setMinValue(0)
        .setMaxValue(MAX_SEC)
        .setRequired(true)
    )
    .addChannelOption((o) =>
      o
        .setName("salon")
        .setDescription("Salon (par défaut : salon actuel)")
        .setRequired(false)
    ),

  async execute(interaction) {
    const sec = interaction.options.getInteger("secondes", true);
    const ch =
      interaction.options.getChannel("salon") || interaction.channel;

    if (!memberHasPermOrAdmin(interaction.member, PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: "❌ Tu n’as pas la permission de gérer les salons.",
        ephemeral: true,
      });
    }
    if (!ch.isTextBased()) {
      return interaction.reply({
        content: "❌ Choisis un salon texte (ou un fil).",
        ephemeral: true,
      });
    }

    try {
      await ch.setRateLimitPerUser(sec);
      await interaction.reply(
        sec === 0
          ? `✅ Mode lent désactivé dans ${ch}.`
          : `✅ Mode lent : **${sec}** s entre chaque message dans ${ch}.`
      );
    } catch (e) {
      console.error(e);
      await interaction.reply({
        content: "❌ Impossible de modifier le mode lent.",
        ephemeral: true,
      });
    }
  },

  executeMessage(message, args) {
    if (!memberHasPermOrAdmin(message.member, PermissionFlagsBits.ManageChannels)) {
      return message.reply(
        "❌ Tu n’as pas la permission de gérer les salons."
      );
    }
    const sec = parseInt(args[0], 10);
    if (isNaN(sec) || sec < 0 || sec > MAX_SEC) {
      return message.reply(
        `Usage : \`slowmode <0-${MAX_SEC}>\` (secondes, ce salon)`
      );
    }
    const channel = message.channel;
    if (!channel.isTextBased()) {
      return message.reply("❌ Utilise cette commande dans un salon texte.");
    }

    return channel
      .setRateLimitPerUser(sec)
      .then(() =>
        message.reply(
          sec === 0
            ? "✅ Mode lent désactivé."
            : `✅ Mode lent : **${sec}** s entre chaque message.`
        )
      )
      .catch(() => message.reply("❌ Impossible de modifier le mode lent."));
  },
};
