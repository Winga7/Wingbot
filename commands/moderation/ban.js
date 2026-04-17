const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { memberHasPermOrAdmin } = require("../../memberPerms");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannit un membre du serveur")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Membre à bannir").setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName("jours_messages")
        .setDescription("Supprimer les messages des X derniers jours (0–7)")
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("raison").setDescription("Raison (optionnel)").setRequired(false)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("membre", true);
    const deleteDays = interaction.options.getInteger("jours_messages") ?? 0;
    const reason =
      interaction.options.getString("raison")?.slice(0, 512) || "Aucune raison";

    if (!memberHasPermOrAdmin(interaction.member, PermissionFlagsBits.BanMembers)) {
      return interaction.reply({
        content: "❌ Tu n’as pas la permission de bannir des membres.",
        ephemeral: true,
      });
    }
    if (user.id === interaction.user.id) {
      return interaction.reply({
        content: "❌ Tu ne peux pas te bannir toi-même.",
        ephemeral: true,
      });
    }
    if (user.id === interaction.client.user.id) {
      return interaction.reply({
        content: "❌ Je ne peux pas me bannir moi-même.",
        ephemeral: true,
      });
    }

    try {
      const sec = Math.min(604800, Math.max(0, deleteDays) * 86400);
      await interaction.guild.members.ban(user, {
        deleteMessageSeconds: sec,
        reason,
      });
      const embed = new EmbedBuilder()
        .setColor(0xdc2626)
        .setTitle("Membre banni")
        .setDescription(
          `**${user.tag}** a été banni.\n**Raison :** ${reason}\n**Messages :** ${deleteDays} jour(s) effacés max.`
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } catch (e) {
      console.error(e);
      await interaction.reply({
        content: "❌ Impossible de bannir ce membre.",
        ephemeral: true,
      });
    }
  },

  executeMessage(message, args) {
    if (!memberHasPermOrAdmin(message.member, PermissionFlagsBits.BanMembers)) {
      return message.reply("❌ Tu n’as pas la permission de bannir des membres.");
    }
    const targetUser =
      message.mentions.users.first() ||
      (args[0] && message.client.users.cache.get(args[0].replace(/\D/g, "")));
    if (!targetUser) {
      return message.reply(
        "Usage : `ban @membre [0-7 jours] [raison]` — mentionne un membre."
      );
    }
    let deleteDays = 0;
    let reasonStart = 1;
    if (args[1] && /^\d$/.test(args[1]) && Number(args[1]) <= 7) {
      deleteDays = Number(args[1]);
      reasonStart = 2;
    }
    const reason =
      args.slice(reasonStart).join(" ").trim().slice(0, 512) || "Aucune raison";

    if (targetUser.id === message.author.id) {
      return message.reply("❌ Tu ne peux pas te bannir toi-même.");
    }
    if (targetUser.id === message.client.user.id) {
      return message.reply("❌ Je ne peux pas me bannir moi-même.");
    }

    return message.guild.members
      .ban(targetUser, {
        deleteMessageSeconds: Math.min(604800, deleteDays * 86400),
        reason,
      })
      .then(() =>
        message.reply(
          `✅ **${targetUser.tag}** a été banni. Raison : ${reason}`
        )
      )
      .catch(() => message.reply("❌ Impossible de bannir ce membre."));
  },
};
