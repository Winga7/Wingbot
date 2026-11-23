const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const {
  getTempVoiceGuildConfig,
  setTempVoiceGuildConfig,
  listTempVoiceHubs,
  countTempVoiceHubs,
  createTempVoiceHub,
  updateTempVoiceHub,
  deleteTempVoiceHub,
  getTempVoiceHub,
} = require("../../database");
const { MAX_HUBS_FREE, MAX_HUBS_PREMIUM, DEFAULT_HUB } = require("../../lib/tempVoiceConfig");
const { getFeatureLimit } = require("../../premiumGate");
const { memberHasPermOrAdmin } = require("../../memberPerms");

function deny(send, text) {
  return send(`❌ ${text}`);
}

function maxHubsFor(userId, guildId) {
  const n = getFeatureLimit(userId, guildId, "temp_voice_multi_hubs", "hubs");
  if (n == null) return MAX_HUBS_FREE;
  return Math.min(MAX_HUBS_PREMIUM, Math.max(1, n));
}

async function ensureBotVoicePerms(guild) {
  const me = guild.members.me;
  if (!me) return "Bot introuvable sur le serveur.";
  const need = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.MoveMembers,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.ViewChannel,
  ];
  if (!me.permissions.has(need)) {
    return "Il me faut Gérer les salons, Déplacer des membres, Voir les salons et Se connecter.";
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tempvoice")
    .setDescription("Configurer les salons vocaux temporaires")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Active ou désactive le module")
        .addBooleanOption((o) =>
          o.setName("actif").setDescription("Activer").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("hub-create")
        .setDescription("Crée un hub (salon ➕ Créer votre salon)")
        .addChannelOption((o) =>
          o
            .setName("categorie")
            .setDescription("Catégorie des salons temporaires")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("nom_hub").setDescription("Nom du salon hub").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("hub-toggle")
        .setDescription("Active ou désactive un hub")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("ID du hub").setRequired(true)
        )
        .addBooleanOption((o) =>
          o.setName("actif").setDescription("Activer").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("hub-delete")
        .setDescription("Supprime un hub")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("ID du hub").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Liste les hubs")
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ Serveur uniquement.", ephemeral: true });
    }
    if (!memberHasPermOrAdmin(interaction.member, PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "❌ Il faut Gérer le serveur.",
        ephemeral: true,
      });
    }
    const sub = interaction.options.getSubcommand();

    if (sub === "enable") {
      const actif = interaction.options.getBoolean("actif", true);
      setTempVoiceGuildConfig(interaction.guildId, { enabled: actif });
      return interaction.reply({
        content: actif
          ? "✅ Module salons temporaires activé."
          : "✅ Module désactivé (les hubs restent, sans création).",
        ephemeral: true,
      });
    }

    if (sub === "list") {
      const cfg = getTempVoiceGuildConfig(interaction.guildId);
      const hubs = listTempVoiceHubs(interaction.guildId);
      if (!hubs.length) {
        return interaction.reply({
          content: `Module : ${cfg.enabled ? "on" : "off"} · aucun hub. Dashboard : Communauté → Vocaux temp.`,
          ephemeral: true,
        });
      }
      const lines = hubs.map(
        (h) =>
          `\`#${h.id}\` ${h.enabled ? "🟢" : "⚪"} hub <#${h.hub_channel_id || "?"}> · cat <#${h.category_id || "?"}> · \`${h.name_format}\``
      );
      return interaction.reply({
        content: `Module : **${cfg.enabled ? "on" : "off"}**\n${lines.join("\n")}`,
        ephemeral: true,
      });
    }

    if (sub === "hub-create") {
      await interaction.deferReply({ ephemeral: true });
      const permErr = await ensureBotVoicePerms(interaction.guild);
      if (permErr) return interaction.editReply({ content: `❌ ${permErr}` });
      const max = maxHubsFor(interaction.user.id, interaction.guildId);
      if (countTempVoiceHubs(interaction.guildId) >= max) {
        return interaction.editReply({
          content: `❌ Limite de hubs atteinte (${max}). Premium : jusqu'à ${MAX_HUBS_PREMIUM}.`,
        });
      }
      let category = interaction.options.getChannel("categorie");
      if (!category) {
        category = await interaction.guild.channels.create({
          name: "Salons temporaires",
          type: ChannelType.GuildCategory,
          reason: "Hub vocaux temporaires Wingbot",
        });
      }
      const hubName =
        interaction.options.getString("nom_hub")?.trim().slice(0, 100) ||
        "➕ Créer votre salon";
      const hubChannel = await interaction.guild.channels.create({
        name: hubName,
        type: ChannelType.GuildVoice,
        parent: category.id,
        reason: "Hub vocaux temporaires Wingbot",
      });
      const hub = createTempVoiceHub(interaction.guildId, {
        ...DEFAULT_HUB,
        enabled: true,
        hub_channel_id: hubChannel.id,
        category_id: category.id,
      });
      setTempVoiceGuildConfig(interaction.guildId, { enabled: true });
      return interaction.editReply({
        content: `✅ Hub **#${hub.id}** créé : ${hubChannel} dans ${category}.`,
      });
    }

    if (sub === "hub-toggle") {
      const id = interaction.options.getInteger("id", true);
      const hub = getTempVoiceHub(id);
      if (!hub || hub.guild_id !== interaction.guildId) {
        return interaction.reply({ content: "❌ Hub introuvable.", ephemeral: true });
      }
      const actif = interaction.options.getBoolean("actif", true);
      updateTempVoiceHub(id, { enabled: actif });
      return interaction.reply({
        content: actif ? `✅ Hub #${id} activé.` : `✅ Hub #${id} désactivé.`,
        ephemeral: true,
      });
    }

    if (sub === "hub-delete") {
      const id = interaction.options.getInteger("id", true);
      const hub = getTempVoiceHub(id);
      if (!hub || hub.guild_id !== interaction.guildId) {
        return interaction.reply({ content: "❌ Hub introuvable.", ephemeral: true });
      }
      deleteTempVoiceHub(id);
      return interaction.reply({
        content: `✅ Hub #${id} supprimé de la base (le salon Discord n'est pas effacé automatiquement).`,
        ephemeral: true,
      });
    }
  },

  async executeMessage(message, args) {
    if (!message.guild) return;
    const send = (t) => message.reply(t);
    if (!memberHasPermOrAdmin(message.member, PermissionFlagsBits.ManageGuild)) {
      return deny(send, "Il faut Gérer le serveur.");
    }
    const sub = String(args[0] || "").toLowerCase();
    if (sub === "list") {
      const hubs = listTempVoiceHubs(message.guild.id);
      const cfg = getTempVoiceGuildConfig(message.guild.id);
      if (!hubs.length) return send(`Module ${cfg.enabled ? "on" : "off"} · aucun hub.`);
      return send(
        hubs
          .map((h) => `\`#${h.id}\` ${h.enabled ? "on" : "off"} · <#${h.hub_channel_id}>`)
          .join("\n")
      );
    }
    if (sub === "enable" || sub === "on") {
      setTempVoiceGuildConfig(message.guild.id, { enabled: true });
      return send("✅ Module activé.");
    }
    if (sub === "disable" || sub === "off") {
      setTempVoiceGuildConfig(message.guild.id, { enabled: false });
      return send("✅ Module désactivé.");
    }
    if (sub === "create" || sub === "hub-create") {
      const max = maxHubsFor(message.author.id, message.guild.id);
      if (countTempVoiceHubs(message.guild.id) >= max) {
        return deny(send, `Limite de hubs (${max}).`);
      }
      const permErr = await ensureBotVoicePerms(message.guild);
      if (permErr) return deny(send, permErr);
      const category = await message.guild.channels.create({
        name: "Salons temporaires",
        type: ChannelType.GuildCategory,
      });
      const hubChannel = await message.guild.channels.create({
        name: "➕ Créer votre salon",
        type: ChannelType.GuildVoice,
        parent: category.id,
      });
      const hub = createTempVoiceHub(message.guild.id, {
        ...DEFAULT_HUB,
        hub_channel_id: hubChannel.id,
        category_id: category.id,
      });
      setTempVoiceGuildConfig(message.guild.id, { enabled: true });
      return send(`✅ Hub **#${hub.id}** · ${hubChannel}`);
    }
    return deny(
      send,
      "Usage : `tempvoice list` · `enable` · `disable` · `create` · slash pour le reste"
    );
  },
};
