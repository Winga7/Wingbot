const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulse un membre du serveur")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre à expulser").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("raison").setDescription("Raison (optionnel)").setRequired(false)
    ),

  async execute(interaction) {
    const member = interaction.options.getMember("membre");
    const reason =
      interaction.options.getString("raison")?.slice(0, 512) || "Aucune raison";

    if (!member) {
      return interaction.reply({
        content: "❌ Membre introuvable sur ce serveur.",
        ephemeral: true,
      });
    }
    if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return interaction.reply({
        content: "❌ Tu n’as pas la permission d’expulser des membres.",
        ephemeral: true,
      });
    }
    if (!member.kickable) {
      return interaction.reply({
        content: "❌ Je ne peux pas expulser ce membre (rôle trop haut ou propriétaire).",
        ephemeral: true,
      });
    }
    if (member.id === interaction.user.id) {
      return interaction.reply({
        content: "❌ Tu ne peux pas t’expulser toi-même.",
        ephemeral: true,
      });
    }

    try {
      await member.kick(reason);
      const embed = new EmbedBuilder()
        .setColor(0xf97316)
        .setTitle("Membre expulsé")
        .setDescription(
          `**${member.user.tag}** a été expulsé.\n**Raison :** ${reason}`
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } catch (e) {
      console.error(e);
      await interaction.reply({
        content: "❌ Impossible d’expulser ce membre.",
        ephemeral: true,
      });
    }
  },

  executeMessage(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply("❌ Tu n’as pas la permission d’expulser des membres.");
    }
    const target =
      message.mentions.members?.first() ||
      (args[0] &&
        message.guild.members.cache.get(String(args[0]).replace(/\D/g, "")));
    if (!target) {
      return message.reply(
        "Usage : `kick @membre [raison]` — mentionne un membre ou donne son ID."
      );
    }
    const reason =
      args.slice(1).join(" ").trim().slice(0, 512) || "Aucune raison";

    if (!target.kickable) {
      return message.reply(
        "❌ Je ne peux pas expulser ce membre (rôle trop haut ou propriétaire)."
      );
    }
    if (target.id === message.author.id) {
      return message.reply("❌ Tu ne peux pas t’expulser toi-même.");
    }

    return target
      .kick(reason)
      .then(() =>
        message.reply(
          `✅ **${target.user.tag}** a été expulsé. Raison : ${reason}`
        )
      )
      .catch(() => message.reply("❌ Impossible d’expulser ce membre."));
  },
};
