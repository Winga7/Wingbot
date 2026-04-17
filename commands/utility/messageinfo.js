const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");
const { getCachedMessage } = require("../../database");

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("messageinfo")
    .setDescription("Affiche un message depuis le cache (si supprimé)")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("ID du message (snowflake)")
        .setRequired(true)
    ),

  async execute(interaction) {
    const messageId = interaction.options.getString("id", true);

    const cached = getCachedMessage(messageId);
    if (!cached) {
      return interaction.reply({
        content:
          "❌ Je n'ai rien trouvé dans le cache pour cet ID de message.",
        ephemeral: true,
      });
    }

    // Sécurité: on ne montre que si c'est le même serveur que la requête.
    if (cached.guild_id && cached.guild_id !== interaction.guild.id) {
      return interaction.reply({
        content:
          "❌ Ce message ne semble pas appartenir au serveur actuel (cache ignoré).",
        ephemeral: true,
      });
    }

    const attachmentsList = safeJsonParse(cached.attachments) || [];
    const embedsList = safeJsonParse(cached.embeds) || [];

    const attachmentsText =
      attachmentsList.length > 0
        ? attachmentsList
            .slice(0, 8)
            .map((a) => (a.url ? `[${a.name || "fichier"}](${a.url})` : a.name || "Fichier"))
            .join("\n")
            .substring(0, 1024)
        : "Aucune";

    const content = cached.content || "*[Contenu vide]*";
    const embedsText =
      embedsList.length > 0
        ? `${embedsList
            .slice(0, 5)
            .map((e) => e.title || "Embed")
            .join(", ")}`
        : "Aucun";

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🗃️ Message trouvé dans le cache")
      .setDescription(content.substring(0, 1024))
      .addFields(
        { name: "Auteur", value: cached.author_tag || "Inconnu", inline: false },
        { name: "Salon", value: cached.channel_id ? `<#${cached.channel_id}>` : "Inconnu", inline: false },
        { name: "Pièces jointes", value: attachmentsText, inline: false },
        { name: "Embeds", value: embedsText, inline: false },
      )
      .setFooter({ text: `ID Message: ${cached.message_id}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },

  executeMessage(message, args) {
    if (!args[0]) {
      return message.reply("❌ Usage: `$messageinfo <message_id>`");
    }

    const messageId = args[0];
    const cached = getCachedMessage(messageId);

    if (!cached) {
      return message.reply(
        "❌ Je n'ai rien trouvé dans le cache pour cet ID de message."
      );
    }

    if (cached.guild_id && cached.guild_id !== message.guild.id) {
      return message.reply(
        "❌ Ce message ne semble pas appartenir au serveur actuel (cache ignoré)."
      );
    }

    const attachmentsList = safeJsonParse(cached.attachments) || [];
    const embedsList = safeJsonParse(cached.embeds) || [];

    const attachmentsText =
      attachmentsList.length > 0
        ? attachmentsList
            .slice(0, 8)
            .map((a) => (a.url ? `[${a.name || "fichier"}](${a.url})` : a.name || "Fichier"))
            .join("\n")
            .substring(0, 1024)
        : "Aucune";

    const content = cached.content || "*[Contenu vide]*";
    const embedsText =
      embedsList.length > 0
        ? `${embedsList
            .slice(0, 5)
            .map((e) => e.title || "Embed")
            .join(", ")}`
        : "Aucun";

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🗃️ Message trouvé dans le cache")
      .setDescription(content.substring(0, 1024))
      .addFields(
        { name: "Auteur", value: cached.author_tag || "Inconnu", inline: false },
        { name: "Salon", value: cached.channel_id ? `<#${cached.channel_id}>` : "Inconnu", inline: false },
        { name: "Pièces jointes", value: attachmentsText, inline: false },
        { name: "Embeds", value: embedsText, inline: false },
      )
      .setFooter({ text: `ID Message: ${cached.message_id}` })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  },
};

