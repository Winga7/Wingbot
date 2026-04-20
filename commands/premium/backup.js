/**
 * /backup — système de sauvegarde/restauration de serveur Discord.
 *
 * Feature premium gated PAR SERVEUR : il faut que la guild ait un statut
 * premium actif (table `guild_premium`) OU que l'auteur de la commande soit
 * founder (bypass global). Le backup lui-même reste rattaché à l'utilisateur
 * qui l'a créé (owner_user_id), pour les permissions de restauration.
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ComponentType,
} = require("discord.js");

const { captureGuild } = require("../../backup/captureGuild");
const { restoreGuild } = require("../../backup/restoreGuild");
const {
  generateUniqueCode,
  normalizeCode,
  isValidCode,
} = require("../../backup/backupCode");
const {
  insertGuildBackup,
  getBackupByCode,
  listUserBackups,
  countUserBackups,
  deleteBackupByCodeFor,
  insertBackupRestore,
  updateBackupRestore,
} = require("../../database");
const {
  canUseFeature,
  getFeatureLimit,
  getEffectiveTier,
  isFounder,
  isGuildPremium,
} = require("../../premiumGate");
const { hasModAdminBypass } = require("../../memberPerms");

const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // 8 Mo hard-cap par backup en DB

// ============================================================
// Reporter de progression : DM unique édité au fil des phases.
// Throttle à ~2 s pour ne pas se faire rate-limit sur l'edit message.
// ============================================================
const PHASE_LABEL = {
  wipe: "🧹 Nettoyage du serveur",
  roles: "🏷️ Création des rôles",
  categories: "🗂️ Création des catégories",
  channels: "📁 Création des salons",
  messages: "📨 Rejeu des messages (par vagues, webhooks)",
  done: "✅ Terminé",
};
const PHASE_ORDER = ["wipe", "roles", "categories", "channels", "messages", "done"];

function progressBar(done, total, width = 20) {
  if (!total) return "▱".repeat(width);
  const filled = Math.min(width, Math.max(0, Math.round((done / total) * width)));
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

async function createRestoreProgressReporter(user, { code, guildName }) {
  let dm;
  try {
    dm = await user.createDM();
  } catch {
    return { onProgress: () => {}, finalize: async () => {} };
  }

  const startedAt = Date.now();
  let lastState = null;
  let lastEditAt = 0;
  let pending = null;
  let sending = false;
  let message = null;

  const buildEmbed = (state, finalSummary = null) => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const elapsedStr = elapsed < 60 ? `${elapsed} s` : `${Math.floor(elapsed / 60)} min ${elapsed % 60} s`;

    const phase = state?.phase || "wipe";
    const phaseIdx = PHASE_ORDER.indexOf(phase);
    const stepsDone = PHASE_ORDER.slice(0, Math.max(0, phaseIdx))
      .map((p) => `✅ ${PHASE_LABEL[p]}`)
      .join("\n");
    const currentLabel = PHASE_LABEL[phase] || phase;

    let currentLine = `➡️ **${currentLabel}**`;
    if (state?.total) {
      currentLine += ` — ${state.done}/${state.total}\n${progressBar(
        state.done,
        state.total
      )}`;
    }
    if (phase === "messages" && state?.channels) {
      currentLine += `\n_Salon ${state.channel}/${state.channels}${
        state.currentChannelName ? ` · #${state.currentChannelName}` : ""
      }_`;
    }

    const nextSteps = PHASE_ORDER.slice(phaseIdx + 1, -1)
      .map((p) => `⏳ ${PHASE_LABEL[p]}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(finalSummary ? "Restauration terminée" : "⏳ Restauration en cours")
      .setDescription(
        `Backup \`${code}\` → **${guildName}**\n_Durée écoulée : ${elapsedStr}_`
      )
      .addFields({
        name: "Progression",
        value: [stepsDone, currentLine, nextSteps].filter(Boolean).join("\n"),
      });

    if (finalSummary) {
      embed.setColor(finalSummary.ok ? 0x4ade80 : 0xef4444);
      embed.addFields({ name: "Résumé", value: finalSummary.text });
    } else {
      embed.setColor(0xa78bfa);
    }
    return embed;
  };

  const flush = async () => {
    if (sending) return;
    if (!pending) return;
    sending = true;
    const state = pending;
    pending = null;
    try {
      const embed = buildEmbed(state);
      if (!message) {
        message = await dm.send({ embeds: [embed] });
      } else {
        await message.edit({ embeds: [embed] });
      }
      lastEditAt = Date.now();
      lastState = state;
    } catch {
      // DM fermés ou autre : on désactive silencieusement
      message = null;
    } finally {
      sending = false;
      if (pending) {
        // Un nouvel état est tombé pendant l'envoi
        setTimeout(flush, 0);
      }
    }
  };

  const onProgress = (state) => {
    pending = state;
    const now = Date.now();
    const elapsed = now - lastEditAt;
    // Envoi immédiat si premier état ou changement de phase, sinon throttle à 2 s
    const phaseChanged = !lastState || lastState.phase !== state.phase;
    if (phaseChanged || elapsed > 2000) {
      flush();
    }
  };

  const finalize = async (summary) => {
    // Envoie forcément l'état final (sans throttle)
    try {
      const embed = buildEmbed(lastState || { phase: "done" }, summary);
      if (!message) {
        message = await dm.send({ embeds: [embed] });
      } else {
        await message.edit({ embeds: [embed] });
      }
    } catch {
      /* DM fermés */
    }
  };

  return { onProgress, finalize };
}

function humanSize(b) {
  if (b == null) return "—";
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  return `${(b / 1024 / 1024).toFixed(2)} Mo`;
}

function tierBadge(tier) {
  return (
    { founder: "👑 Founder", premium: "✨ Premium", free: "Gratuit" }[tier] ||
    tier
  );
}

function premiumDeniedMessage() {
  return (
    "Cette commande nécessite que **ce serveur** ait un accès Premium.\n" +
    "Contacte un founder pour activer l'accès Premium sur ce serveur " +
    "(payant ou offert)."
  );
}

async function assertPremium(interaction, feature) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  if (canUseFeature(userId, guildId, feature)) return true;
  await interaction.reply({
    content: premiumDeniedMessage(),
    ephemeral: true,
  });
  return false;
}

// ============================================================
// /backup create
// ============================================================
async function handleCreate(interaction) {
  if (!(await assertPremium(interaction, "backup_create"))) return;

  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: "Commande utilisable en serveur uniquement.", ephemeral: true });
  }

  const slotsLimit = getFeatureLimit(
    interaction.user.id,
    interaction.guildId,
    "backup_create",
    "slots"
  );
  const used = countUserBackups(interaction.user.id);
  if (Number.isFinite(slotsLimit) && used >= slotsLimit) {
    return interaction.reply({
      content: `Tu as atteint la limite de ${slotsLimit} backups (${tierBadge(
        getEffectiveTier(interaction.user.id, interaction.guildId)
      )}). Supprime-en un avec \`/backup delete\` pour libérer un slot.`,
      ephemeral: true,
    });
  }

  const name = interaction.options.getString("nom") || `Backup de ${guild.name}`;
  const includeMessages = interaction.options.getBoolean("messages") ?? false;
  const requestedMsgCount = interaction.options.getInteger("nb_messages") ?? 25;
  const maxPerChan =
    getFeatureLimit(
      interaction.user.id,
      interaction.guildId,
      "backup_create",
      "max_messages_per_channel"
    ) ?? 25;
  const messagesPerChannel = Math.min(requestedMsgCount, maxPerChan);

  await interaction.deferReply({ ephemeral: true });

  let result;
  try {
    result = await captureGuild(guild, {
      includeMessages,
      messagesPerChannel,
      includeEmojis: true,
      includeBans: false,
    });
  } catch (e) {
    console.error("capture error", e);
    return interaction.editReply(`Erreur pendant la capture : ${e.message}`);
  }

  const payloadJson = JSON.stringify(result.payload);
  const size = Buffer.byteLength(payloadJson, "utf8");
  if (size > MAX_PAYLOAD_BYTES && !isFounder(interaction.user.id)) {
    return interaction.editReply(
      `Backup trop volumineux (${humanSize(size)} / max ${humanSize(
        MAX_PAYLOAD_BYTES
      )}). Réduis le nombre de messages à inclure.`
    );
  }

  const code = generateUniqueCode();
  insertGuildBackup({
    backup_code: code,
    source_guild_id: guild.id,
    owner_user_id: interaction.user.id,
    name,
    include_messages: includeMessages,
    payload: payloadJson,
    size_bytes: size,
    channels_count: result.stats.channels_count,
    roles_count: result.stats.roles_count,
    messages_count: result.stats.messages_count,
  });

  const embed = new EmbedBuilder()
    .setColor(0xa78bfa)
    .setTitle("Backup créé")
    .setDescription(
      `Ton serveur a été sauvegardé avec succès.\n**Code :** \`${code}\` _(garde-le, il sert à restaurer)_`
    )
    .addFields(
      { name: "Nom", value: name, inline: true },
      { name: "Taille", value: humanSize(size), inline: true },
      { name: "Rôles", value: String(result.stats.roles_count), inline: true },
      { name: "Catégories", value: String(result.stats.categories_count), inline: true },
      { name: "Salons", value: String(result.stats.channels_count), inline: true },
      {
        name: "Messages",
        value: includeMessages
          ? `${result.stats.messages_count} (${messagesPerChannel}/salon)`
          : "non inclus",
        inline: true,
      }
    )
    .setFooter({
      text: `Tier : ${tierBadge(
        getEffectiveTier(interaction.user.id, interaction.guildId)
      )}`,
    })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// ============================================================
// /backup list
// ============================================================
async function handleList(interaction) {
  if (!(await assertPremium(interaction, "backup_create"))) return;
  const rows = listUserBackups(interaction.user.id, 25);
  if (!rows.length) {
    return interaction.reply({
      content: "Aucun backup. Crée-en un avec `/backup create`.",
      ephemeral: true,
    });
  }
  const lines = rows.map((r) => {
    const when = r.created_at?.replace("T", " ").slice(0, 16) || "?";
    const msg = r.include_messages ? `📨${r.messages_count}` : "";
    return `\`${r.backup_code}\` · ${r.name || "(sans nom)"} · ${humanSize(r.size_bytes)} · 🗂️${r.channels_count} 🏷️${r.roles_count} ${msg} · ${when}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0xa78bfa)
    .setTitle(`Tes backups (${rows.length})`)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({
      text: `Slots : ${rows.length} / ${
        getFeatureLimit(
          interaction.user.id,
          interaction.guildId,
          "backup_create",
          "slots"
        ) ?? "∞"
      }`,
    });
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

// ============================================================
// /backup info
// ============================================================
async function handleInfo(interaction) {
  if (!(await assertPremium(interaction, "backup_create"))) return;
  const code = normalizeCode(interaction.options.getString("code", true));
  if (!isValidCode(code)) {
    return interaction.reply({ content: "Code invalide.", ephemeral: true });
  }
  const row = getBackupByCode(code);
  if (!row || (row.owner_user_id !== interaction.user.id && !isFounder(interaction.user.id))) {
    return interaction.reply({ content: "Backup introuvable.", ephemeral: true });
  }
  const embed = new EmbedBuilder()
    .setColor(0xa78bfa)
    .setTitle(`Backup ${row.backup_code}`)
    .addFields(
      { name: "Nom", value: row.name || "—", inline: true },
      { name: "Source", value: `\`${row.source_guild_id}\``, inline: true },
      { name: "Date", value: row.created_at || "?", inline: true },
      { name: "Taille", value: humanSize(row.size_bytes), inline: true },
      { name: "Rôles", value: String(row.roles_count), inline: true },
      { name: "Salons", value: String(row.channels_count), inline: true },
      {
        name: "Messages",
        value: row.include_messages ? String(row.messages_count) : "non inclus",
        inline: true,
      }
    );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

// ============================================================
// /backup delete
// ============================================================
async function handleDelete(interaction) {
  if (!(await assertPremium(interaction, "backup_create"))) return;
  const code = normalizeCode(interaction.options.getString("code", true));
  if (!isValidCode(code)) {
    return interaction.reply({ content: "Code invalide.", ephemeral: true });
  }
  const n = deleteBackupByCodeFor(code, interaction.user.id);
  return interaction.reply({
    content: n ? `Backup \`${code}\` supprimé.` : "Backup introuvable ou non à toi.",
    ephemeral: true,
  });
}

// ============================================================
// /backup load — restore destructif avec double confirmation
// ============================================================
async function handleLoad(interaction) {
  if (!(await assertPremium(interaction, "backup_restore"))) return;

  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: "Commande utilisable en serveur uniquement.", ephemeral: true });
  }

  // L'auteur doit être owner ou admin du serveur cible
  const isOwner = guild.ownerId === interaction.user.id;
  const isAdmin = interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator);
  if (!isOwner && !isAdmin) {
    return interaction.reply({
      content: "Il faut être propriétaire ou administrateur du serveur cible pour restaurer un backup.",
      ephemeral: true,
    });
  }

  const code = normalizeCode(interaction.options.getString("code", true));
  if (!isValidCode(code)) {
    return interaction.reply({ content: "Code invalide.", ephemeral: true });
  }
  const row = getBackupByCode(code);
  if (!row) {
    return interaction.reply({ content: "Backup introuvable.", ephemeral: true });
  }
  if (row.owner_user_id !== interaction.user.id && !isFounder(interaction.user.id)) {
    return interaction.reply({
      content:
        "Ce backup ne t'appartient pas. Le propriétaire doit utiliser `/backup share` pour t'y donner accès (prochainement).",
      ephemeral: true,
    });
  }

  // Estimation de durée : Discord limite ~50 créations/h par guild avant rate-limit sévère.
  // En pratique on compte ~1.5 s par rôle/salon/catégorie + 1 s par message rejoué.
  const totalOps =
    row.roles_count + row.channels_count + (row.include_messages ? row.messages_count : 0);
  const estSeconds = Math.max(15, Math.round(totalOps * 1.5));
  const estMin = Math.ceil(estSeconds / 60);
  const estimate =
    estSeconds < 60
      ? `environ ${estSeconds} s`
      : estMin < 10
        ? `environ ${estMin} min`
        : `${estMin}+ min (Discord limite les créations, ça peut durer davantage)`;

  // Modal de confirmation : doit retaper le code
  const modal = new ModalBuilder()
    .setCustomId(`backup_confirm_${code}_${Date.now()}`)
    .setTitle("Confirmer la restauration");
  const input = new TextInputBuilder()
    .setCustomId("confirm_code")
    .setLabel(`Retape exactement : ${code}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(code.length)
    .setMaxLength(code.length + 2);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);

  let submit;
  try {
    submit = await interaction.awaitModalSubmit({
      filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(`backup_confirm_${code}_`),
      time: 60_000,
    });
  } catch {
    return; // timeout, rien à faire
  }

  const typed = normalizeCode(submit.fields.getTextInputValue("confirm_code"));
  if (typed !== code) {
    return submit.reply({
      content: "Le code ne correspond pas. Restauration annulée.",
      ephemeral: true,
    });
  }

  const warn = new EmbedBuilder()
    .setColor(0xfbbf24)
    .setTitle("⏳ Restauration en cours")
    .setDescription(
      `Backup \`${code}\` sur **${guild.name}**.\nTu recevras le résumé ici une fois terminé.`
    )
    .addFields(
      { name: "Durée estimée", value: estimate, inline: true },
      {
        name: "Éléments à recréer",
        value: `🏷️ ${row.roles_count} · 🗂️ ${row.channels_count}${
          row.include_messages ? ` · 📨 ${row.messages_count}` : ""
        }`,
        inline: true,
      },
      {
        name: "⚠️ À savoir",
        value:
          "• Beaucoup de **notifications** vont arriver (nouveaux salons, rôles, messages rejoués via webhook par vagues).\n" +
          "• **Mute le serveur** le temps de la restauration si tu veux éviter le spam.\n" +
          "• Je t'envoie la **progression en DM** (mise à jour au fil des phases) — ouvre tes DMs serveur si besoin.\n" +
          "• Ne **ferme pas** le bot et ne lance pas d'autres commandes dessus avant la fin.\n" +
          "• Si Discord te rate-limit, le bot attend et reprend tout seul.",
      }
    );
  await submit.reply({ embeds: [warn], ephemeral: true });

  const restoreId = insertBackupRestore({
    backup_id: row.id,
    target_guild_id: guild.id,
    triggered_by: interaction.user.id,
    mode: "wipe",
    status: "running",
  });

  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch (e) {
    updateBackupRestore(restoreId, {
      status: "failed",
      log: { error: `payload illisible: ${e.message}` },
      finished: true,
    });
    return submit.followUp({
      content: "Payload corrompu. Contacte le support.",
      ephemeral: true,
    });
  }

  const reporter = await createRestoreProgressReporter(interaction.user, {
    code,
    guildName: guild.name,
  });

  try {
    const result = await restoreGuild(guild, payload, {
      mode: "wipe",
      onProgress: reporter.onProgress,
    });
    updateBackupRestore(restoreId, {
      status: result.status,
      log: result.log,
      finished: true,
    });
    await reporter.finalize({
      ok: true,
      text: `🏷️ ${result.log.counts.roles} rôles · 🗂️ ${result.log.counts.categories} catégories · 📁 ${result.log.counts.channels} salons.`,
    });
    const summary = new EmbedBuilder()
      .setColor(0x4ade80)
      .setTitle("Restauration terminée")
      .setDescription(
        `✅ Backup \`${code}\` restauré sur **${guild.name}**.`
      )
      .addFields(
        { name: "Rôles", value: String(result.log.counts.roles), inline: true },
        { name: "Catégories", value: String(result.log.counts.categories), inline: true },
        { name: "Salons", value: String(result.log.counts.channels), inline: true }
      );
    try {
      await submit.followUp({ embeds: [summary], ephemeral: true });
    } catch {
      /* le salon/interaction peut avoir été wipé */
    }
  } catch (e) {
    console.error("restore fatal", e);
    updateBackupRestore(restoreId, {
      status: "failed",
      log: { error: String(e.message || e) },
      finished: true,
    });
    await reporter.finalize({ ok: false, text: `Erreur fatale : ${e.message}` });
    try {
      await submit.followUp({
        content: `❌ Erreur fatale pendant la restauration : ${e.message}`,
        ephemeral: true,
      });
    } catch {
      /* interaction peut être morte */
    }
  }
}

// ============================================================
// Version préfixe — UX adaptée aux messages (pas de modal)
// ============================================================

function replyPremiumDenied(message) {
  return message.reply(premiumDeniedMessage());
}

async function msgCreate(message, args) {
  const guild = message.guild;
  if (!guild) return;
  if (!canUseFeature(message.author.id, guild.id, "backup_create"))
    return replyPremiumDenied(message);

  const slotsLimit = getFeatureLimit(
    message.author.id,
    guild.id,
    "backup_create",
    "slots"
  );
  const used = countUserBackups(message.author.id);
  if (Number.isFinite(slotsLimit) && used >= slotsLimit) {
    return message.reply(
      `Limite atteinte (${slotsLimit} backups). Supprime-en un avec \`backup delete <code>\`.`
    );
  }

  // Parse args basique : --messages (flag) --nb=25 puis le reste = nom
  let includeMessages = false;
  let requestedMsgCount = 25;
  const nameParts = [];
  for (const a of args) {
    if (a === "--messages" || a === "-m") includeMessages = true;
    else if (a.startsWith("--nb=")) requestedMsgCount = parseInt(a.slice(5), 10) || 25;
    else nameParts.push(a);
  }
  const name = nameParts.join(" ").trim() || `Backup de ${guild.name}`;
  const maxPerChan =
    getFeatureLimit(
      message.author.id,
      guild.id,
      "backup_create",
      "max_messages_per_channel"
    ) ?? 25;
  const messagesPerChannel = Math.min(requestedMsgCount, maxPerChan);

  const status = await message.reply("⏳ Capture en cours…");
  let result;
  try {
    result = await captureGuild(guild, {
      includeMessages,
      messagesPerChannel,
      includeEmojis: true,
      includeBans: false,
    });
  } catch (e) {
    return status.edit(`Erreur : ${e.message}`);
  }

  const payloadJson = JSON.stringify(result.payload);
  const size = Buffer.byteLength(payloadJson, "utf8");
  if (size > MAX_PAYLOAD_BYTES && !isFounder(message.author.id)) {
    return status.edit(
      `Backup trop volumineux (${humanSize(size)} / max ${humanSize(MAX_PAYLOAD_BYTES)}).`
    );
  }

  const code = generateUniqueCode();
  insertGuildBackup({
    backup_code: code,
    source_guild_id: guild.id,
    owner_user_id: message.author.id,
    name,
    include_messages: includeMessages,
    payload: payloadJson,
    size_bytes: size,
    channels_count: result.stats.channels_count,
    roles_count: result.stats.roles_count,
    messages_count: result.stats.messages_count,
  });

  return status.edit(
    `✅ Backup créé : \`${code}\`\n**${name}** · ${humanSize(size)} · 🏷️${result.stats.roles_count} 🗂️${result.stats.channels_count}${
      includeMessages ? ` 📨${result.stats.messages_count}` : ""
    }`
  );
}

async function msgList(message) {
  if (!canUseFeature(message.author.id, message.guild?.id, "backup_create"))
    return replyPremiumDenied(message);
  const rows = listUserBackups(message.author.id, 25);
  if (!rows.length) return message.reply("Aucun backup. Crée-en un : `backup create`.");
  const lines = rows.map((r) => {
    const msg = r.include_messages ? ` 📨${r.messages_count}` : "";
    return `\`${r.backup_code}\` · ${r.name || "(sans nom)"} · ${humanSize(r.size_bytes)}${msg}`;
  });
  return message.reply(lines.join("\n").slice(0, 1900));
}

function msgInfo(message, args) {
  if (!canUseFeature(message.author.id, message.guild?.id, "backup_create"))
    return replyPremiumDenied(message);
  const code = normalizeCode(args[0]);
  if (!isValidCode(code)) return message.reply("Code invalide.");
  const row = getBackupByCode(code);
  if (!row || (row.owner_user_id !== message.author.id && !isFounder(message.author.id))) {
    return message.reply("Backup introuvable.");
  }
  return message.reply(
    [
      `**${row.backup_code}** · ${row.name || "—"}`,
      `Source : \`${row.source_guild_id}\` · ${row.created_at}`,
      `Taille : ${humanSize(row.size_bytes)} · 🏷️${row.roles_count} 🗂️${row.channels_count}${
        row.include_messages ? ` 📨${row.messages_count}` : ""
      }`,
    ].join("\n")
  );
}

function msgDelete(message, args) {
  if (!canUseFeature(message.author.id, message.guild?.id, "backup_create"))
    return replyPremiumDenied(message);
  const code = normalizeCode(args[0]);
  if (!isValidCode(code)) return message.reply("Code invalide.");
  const n = deleteBackupByCodeFor(code, message.author.id);
  return message.reply(n ? `Backup \`${code}\` supprimé.` : "Backup introuvable ou non à toi.");
}

async function msgLoad(message, args) {
  const guild = message.guild;
  if (!guild) return;
  if (!canUseFeature(message.author.id, guild.id, "backup_restore"))
    return replyPremiumDenied(message);

  // Owner ou admin uniquement (double sécurité, même si prefix n'a pas le filtre slash)
  const isOwner = guild.ownerId === message.author.id;
  const isAdmin = hasModAdminBypass(message.member);
  if (!isOwner && !isAdmin) {
    return message.reply("Réservé au propriétaire ou aux administrateurs du serveur.");
  }

  const code = normalizeCode(args[0]);
  if (!isValidCode(code)) return message.reply("Code invalide.");
  const row = getBackupByCode(code);
  if (!row) return message.reply("Backup introuvable.");
  if (row.owner_user_id !== message.author.id && !isFounder(message.author.id)) {
    return message.reply("Ce backup ne t'appartient pas.");
  }

  const totalOps =
    row.roles_count + row.channels_count + (row.include_messages ? row.messages_count : 0);
  const estSeconds = Math.max(15, Math.round(totalOps * 1.5));
  const estimate =
    estSeconds < 60
      ? `environ ${estSeconds} s`
      : `environ ${Math.ceil(estSeconds / 60)} min`;

  await message.reply(
    [
      `⚠️ **Restauration DESTRUCTIVE** sur **${guild.name}**.`,
      `Tous les salons et rôles actuels seront supprimés puis recréés depuis le backup \`${code}\`.`,
      ``,
      `**Durée estimée** : ${estimate} (🏷️${row.roles_count} · 🗂️${row.channels_count}${
        row.include_messages ? ` · 📨${row.messages_count}` : ""
      })`,
      `**⚠️ Beaucoup de notifications** vont arriver pendant la restauration (messages rejoués par vagues via webhook) — pense à **mute le serveur** pour éviter le spam.`,
      `Je t'enverrai la **progression en DM** (mise à jour au fil des phases), et le résumé final aussi en DM (le salon courant sera recréé).`,
      `Si Discord rate-limit, le bot attend et reprend tout seul.`,
      ``,
      `Tape exactement \`${code} confirmer\` dans les 60 s pour lancer.`,
    ].join("\n")
  );

  const filter = (m) =>
    m.author.id === message.author.id &&
    m.channel.id === message.channel.id &&
    normalizeCode(m.content.split(/\s+/)[0]) === code &&
    /confirmer/i.test(m.content);
  let collected;
  try {
    collected = await message.channel.awaitMessages({ filter, max: 1, time: 60_000, errors: ["time"] });
  } catch {
    return message.reply("Annulé (timeout).");
  }
  if (!collected.size) return;

  await message.channel.send(
    `⏳ Restauration de \`${code}\` lancée. Progression envoyée en DM.`
  );

  const restoreId = insertBackupRestore({
    backup_id: row.id,
    target_guild_id: guild.id,
    triggered_by: message.author.id,
    mode: "wipe",
    status: "running",
  });

  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch (e) {
    updateBackupRestore(restoreId, { status: "failed", log: { error: e.message }, finished: true });
    return message.channel.send("Payload corrompu.");
  }

  const reporter = await createRestoreProgressReporter(message.author, {
    code,
    guildName: guild.name,
  });

  try {
    const result = await restoreGuild(guild, payload, {
      mode: "wipe",
      onProgress: reporter.onProgress,
    });
    updateBackupRestore(restoreId, { status: result.status, log: result.log, finished: true });
    await reporter.finalize({
      ok: true,
      text: `🏷️ ${result.log.counts.roles} rôles · 🗂️ ${result.log.counts.categories} catégories · 📁 ${result.log.counts.channels} salons.`,
    });
  } catch (e) {
    console.error("restore fatal", e);
    updateBackupRestore(restoreId, { status: "failed", log: { error: String(e.message || e) }, finished: true });
    await reporter.finalize({ ok: false, text: `Erreur fatale : ${e.message}` });
  }
}

async function executeMessage(message, args) {
  const sub = (args.shift() || "").toLowerCase();
  switch (sub) {
    case "create":
      return msgCreate(message, args);
    case "list":
    case "ls":
      return msgList(message);
    case "info":
      return msgInfo(message, args);
    case "delete":
    case "rm":
      return msgDelete(message, args);
    case "load":
    case "restore":
      return msgLoad(message, args);
    default:
      return message.reply(
        "Usage : `backup create [--messages] [--nb=25] <nom>` · `backup list` · `backup info <code>` · `backup delete <code>` · `backup load <code>`"
      );
  }
}

// ============================================================
// Entry points discord.js
// ============================================================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Sauvegarde / restauration du serveur (Premium)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Crée un backup complet du serveur")
        .addStringOption((o) => o.setName("nom").setDescription("Nom du backup (ex. avant refonte)"))
        .addBooleanOption((o) =>
          o.setName("messages").setDescription("Inclure les derniers messages par salon")
        )
        .addIntegerOption((o) =>
          o
            .setName("nb_messages")
            .setDescription("Messages par salon (25 par défaut)")
            .setMinValue(0)
            .setMaxValue(500)
        )
    )
    .addSubcommand((s) => s.setName("list").setDescription("Liste tes backups"))
    .addSubcommand((s) =>
      s
        .setName("info")
        .setDescription("Détails d'un backup")
        .addStringOption((o) =>
          o.setName("code").setDescription("Code WB-XXXX-XXXX").setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("Supprime un backup")
        .addStringOption((o) =>
          o.setName("code").setDescription("Code WB-XXXX-XXXX").setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("load")
        .setDescription("Restaure un backup sur ce serveur (destructif !)")
        .addStringOption((o) =>
          o.setName("code").setDescription("Code WB-XXXX-XXXX").setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case "create":
        return handleCreate(interaction);
      case "list":
        return handleList(interaction);
      case "info":
        return handleInfo(interaction);
      case "delete":
        return handleDelete(interaction);
      case "load":
        return handleLoad(interaction);
      default:
        return interaction.reply({ content: "Sous-commande inconnue.", ephemeral: true });
    }
  },

  executeMessage,
};
