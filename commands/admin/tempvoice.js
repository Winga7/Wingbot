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
const { MAX_CREATORS, DEFAULT_HUB } = require("../../lib/tempVoiceConfig");
const { memberHasPermOrAdmin } = require("../../memberPerms");

function deny(send, text) {
  return send(`❌ ${text}`);
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
    .setDescription("Salons vocaux temporaires")
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
        .setName("setup")
        .setDescription("Crée « ➕ Créer votre salon » dans une catégorie")
        .addChannelOption((o) =>
          o
            .setName("categorie")
            .setDescription("Catégorie où placer le salon")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("nom")
            .setDescription("Nom du salon (défaut : ➕ Créer votre salon)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("toggle")
        .setDescription("Active ou désactive un salon de création")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("ID affiché par /tempvoice list").setRequired(true)
        )
        .addBooleanOption((o) =>
          o.setName("actif").setDescription("Activer").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Retire un salon de création (sans supprimer le vocal Discord)")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("ID affiché par /tempvoice list").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Liste les salons de création")
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
          ? "✅ Salons temporaires activés."
          : "✅ Module désactivé (les salons de création restent, sans nouvel usage).",
        ephemeral: true,
      });
    }

    if (sub === "list") {
      const cfg = getTempVoiceGuildConfig(interaction.guildId);
      const hubs = listTempVoiceHubs(interaction.guildId);
      if (!hubs.length) {
        return interaction.reply({
          content:
            `Module : ${cfg.enabled ? "on" : "off"} · aucun salon de création.\n` +
            `Dashboard : Communauté → Vocaux temp. ou \`/tempvoice setup\`.`,
          ephemeral: true,
        });
      }
      const lines = hubs.map(
        (h) =>
          `\`#${h.id}\` ${h.enabled ? "🟢" : "⚪"} <#${h.hub_channel_id || "?"}> · cat <#${h.category_id || "?"}>`
      );
      return interaction.reply({
        content: `Module : **${cfg.enabled ? "on" : "off"}**\n${lines.join("\n")}`,
        ephemeral: true,
      });
    }

    if (sub === "setup") {
      await interaction.deferReply({ ephemeral: true });
      const permErr = await ensureBotVoicePerms(interaction.guild);
      if (permErr) return interaction.editReply({ content: `❌ ${permErr}` });
      if (countTempVoiceHubs(interaction.guildId) >= MAX_CREATORS) {
        return interaction.editReply({
          content: `❌ Trop de salons de création (max technique ${MAX_CREATORS}).`,
        });
      }
      const category = interaction.options.getChannel("categorie", true);
      const hubName =
        interaction.options.getString("nom")?.trim().slice(0, 100) ||
        "➕ Créer votre salon";
      const hubChannel = await interaction.guild.channels.create({
        name: hubName,
        type: ChannelType.GuildVoice,
        parent: category.id,
        reason: "Salon de création temporaire Wingbot",
      });
      const hub = createTempVoiceHub(interaction.guildId, {
        ...DEFAULT_HUB,
        enabled: true,
        hub_channel_id: hubChannel.id,
        category_id: category.id,
      });
      setTempVoiceGuildConfig(interaction.guildId, { enabled: true });
      return interaction.editReply({
        content: `✅ ${hubChannel} est prêt dans ${category}. Les membres qui le rejoignent obtiennent leur salon.`,
      });
    }

    if (sub === "toggle") {
      const id = interaction.options.getInteger("id", true);
      const hub = getTempVoiceHub(id);
      if (!hub || hub.guild_id !== interaction.guildId) {
        return interaction.reply({ content: "❌ Introuvable.", ephemeral: true });
      }
      const actif = interaction.options.getBoolean("actif", true);
      updateTempVoiceHub(id, { enabled: actif });
      return interaction.reply({
        content: actif ? `✅ #${id} activé.` : `✅ #${id} désactivé.`,
        ephemeral: true,
      });
    }

    if (sub === "remove") {
      const id = interaction.options.getInteger("id", true);
      const hub = getTempVoiceHub(id);
      if (!hub || hub.guild_id !== interaction.guildId) {
        return interaction.reply({ content: "❌ Introuvable.", ephemeral: true });
      }
      deleteTempVoiceHub(id);
      return interaction.reply({
        content: `✅ #${id} retiré de la config (le vocal Discord n'est pas effacé).`,
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
      if (!hubs.length) return send(`Module ${cfg.enabled ? "on" : "off"} · aucun salon de création.`);
      return send(
        hubs
          .map((h) => `\`#${h.id}\` ${h.enabled ? "on" : "off"} · <#${h.hub_channel_id}>`)
          .join("\n")
      );
    }
    if (sub === "enable" || sub === "on") {
      setTempVoiceGuildConfig(message.guild.id, { enabled: true });
      return send("✅ Activé.");
    }
    if (sub === "disable" || sub === "off") {
      setTempVoiceGuildConfig(message.guild.id, { enabled: false });
      return send("✅ Désactivé.");
    }
    if (sub === "setup" || sub === "create") {
      return deny(
        send,
        "Pour le préfixe, utilise le dashboard (choisir la catégorie) ou `/tempvoice setup`."
      );
    }
    return deny(
      send,
      "Usage : `tempvoice list` · `enable` · `disable` · `/tempvoice setup` pour créer le salon"
    );
  },
};
