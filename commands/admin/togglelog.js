const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { toggleLog } = require("../../database");
const { hasModAdminBypass } = require("../../memberPerms");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("togglelog")
    .setDescription("Active ou désactive un type de log")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Type de log à activer/désactiver")
        .setRequired(true)
        .addChoices(
          { name: "🌐 Tout", value: "all" },
          { name: "📝 Messages", value: "messages" },
          { name: "👥 Membres", value: "members" },
          { name: "🔊 Vocal", value: "voice" },
          { name: "🎭 Rôles", value: "roles" },
          { name: "🔨 Modération", value: "moderation" },
          { name: "⚙️ Serveur", value: "server" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("etat")
        .setDescription("Activer ou désactiver")
        .setRequired(true)
        .addChoices(
          { name: "✅ Activer", value: "on" },
          { name: "❌ Désactiver", value: "off" }
        )
    ),
  async execute(interaction) {
    if (!hasModAdminBypass(interaction.member)) {
      return interaction.reply({
        content:
          "❌ Tu dois être propriétaire du serveur ou avoir la permission Administrateur.",
        ephemeral: true,
      });
    }

    const type = interaction.options.getString("type");
    const state = interaction.options.getString("etat");
    const enabled = state === "on";

    try {
      toggleLog(interaction.guild.id, type, enabled);

      const typeNames = {
        all: "tous les logs",
        messages: "les logs de messages",
        members: "les logs de membres",
        voice: "les logs vocaux",
        roles: "les logs de rôles",
        moderation: "les logs de modération",
        server: "les logs du serveur",
      };

      await interaction.reply({
        content: `✅ ${typeNames[type]} ${
          enabled ? "ont été activés" : "ont été désactivés"
        }.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("Erreur lors de la configuration des logs:", error);
      await interaction.reply({
        content: "❌ Une erreur s'est produite lors de la configuration.",
        ephemeral: true,
      });
    }
  },
  executeMessage(message, args) {
    if (!hasModAdminBypass(message.member)) {
      return message.reply(
        "❌ Tu dois être propriétaire du serveur ou avoir la permission Administrateur."
      );
    }

    if (args.length < 2) {
      return message.reply(
        "❌ Usage: `$togglelog <type> <on/off>`\nTypes: `all`, `messages`, `members`, `voice`, `roles`, `moderation`, `server`"
      );
    }

    const type = args[0].toLowerCase();
    const state = args[1].toLowerCase();

    const validTypes = [
      "all",
      "messages",
      "members",
      "voice",
      "roles",
      "moderation",
      "server",
    ];
    const validStates = ["on", "off"];

    if (!validTypes.includes(type)) {
      return message.reply(
        `❌ Type invalide. Types disponibles: ${validTypes.join(", ")}`
      );
    }

    if (!validStates.includes(state)) {
      return message.reply("❌ État invalide. Utilisez `on` ou `off`.");
    }

    const enabled = state === "on";

    try {
      toggleLog(message.guild.id, type, enabled);

      const typeNames = {
        all: "tous les logs",
        messages: "les logs de messages",
        members: "les logs de membres",
        voice: "les logs vocaux",
        roles: "les logs de rôles",
        moderation: "les logs de modération",
        server: "les logs du serveur",
      };

      message.reply(
        `✅ ${typeNames[type]} ${
          enabled ? "ont été activés" : "ont été désactivés"
        }.`
      );
    } catch (error) {
      console.error("Erreur lors de la configuration des logs:", error);
      message.reply("❌ Une erreur s'est produite lors de la configuration.");
    }
  },
};
