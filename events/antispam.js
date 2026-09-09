const { Events, EmbedBuilder } = require("discord.js");
const {
  getAntispamConfig,
  getCommandAccessConfig,
  getLogChannel,
  isLogEnabled,
} = require("../database");
const { staffRolesUnion } = require("../lib/commandAccessConfig");
const { hasModAdminBypass } = require("../memberPerms");
const { issueWarning } = require("../lib/warnService");
const { getWarnConfig, countGuildWarnings } = require("../database");

/** @type {Map<string, { events: SpamEvent[] }>} */
const activity = new Map();

const DISCORD_INVITE =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const HTTP_URL = /https?:\/\/[^\s<>)]+/gi;

/**
 * @typedef {{ t: number, channelId: string, messageId: string, kind: string, urlKey?: string, strong?: boolean }} SpamEvent
 */

function trackerKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function normalizeUrlKey(raw) {
  const s = String(raw || "").trim().toLowerCase();
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    return `${u.hostname}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return s.replace(/[?#].*$/, "");
  }
}

function extractUrlKeys(text) {
  const keys = new Set();
  const content = String(text || "");
  for (const m of content.match(HTTP_URL) || []) {
    keys.add(normalizeUrlKey(m));
  }
  for (const m of content.match(DISCORD_INVITE) || []) {
    keys.add(normalizeUrlKey(m));
  }
  return [...keys];
}

/**
 * Un seul lien YouTube / article dans un salon ≠ spam.
 * On ne suit que les messages avec lien(s) réel(s) dans le texte.
 */
function analyzeUrlMessage(message) {
  const text = message.content || "";
  const keys = extractUrlKeys(text);
  if (keys.length === 0) return null;

  const invite = DISCORD_INVITE.test(text);
  const multi = keys.length >= 2;

  return {
    keys,
    /** Signal fort : invite Discord ou plusieurs liens d’un coup */
    strong: invite || multi,
    primaryKey: keys[0],
  };
}

/**
 * Images uploadées uniquement — pas les miniatures d’aperçu de lien (gros source de faux positifs).
 */
function messageHasUploadedImage(message) {
  for (const att of message.attachments?.values?.() || []) {
    const ct = att.contentType || "";
    if (ct.startsWith("image/")) return true;
    if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(att.name || "")) return true;
  }
  return false;
}

/**
 * Tout salon de guilde où on peut chatter en texte :
 * salons textuels, annonces, threads, et chat intégré des vocaux / scènes.
 */
function isAntispamEligibleChannel(channel) {
  if (!channel?.guild) return false;
  if (!channel.isTextBased?.()) return false;
  if (channel.isDMBased?.()) return false;
  return true;
}

function pruneActivity(key, windowMs) {
  const entry = activity.get(key);
  if (!entry) return [];
  const cutoff = Date.now() - windowMs;
  entry.events = entry.events.filter((e) => e.t >= cutoff);
  if (entry.events.length === 0) activity.delete(key);
  return entry.events;
}

function pushActivity(guildId, userId, channelId, messageId, kind, extra = {}) {
  const key = trackerKey(guildId, userId);
  const now = Date.now();
  let entry = activity.get(key);
  if (!entry) {
    entry = { events: [] };
    activity.set(key, entry);
  }
  entry.events.push({ t: now, channelId, messageId, kind, ...extra });
  if (activity.size > 8000) {
    const cutoff = now - 180000;
    for (const [k, v] of activity) {
      v.events = v.events.filter((e) => e.t >= cutoff);
      if (v.events.length === 0) activity.delete(k);
    }
  }
}

function countKind(events, kind) {
  return events.filter((e) => e.kind === kind);
}

function uniqueChannels(events) {
  return new Set(events.map((e) => e.channelId)).size;
}

/** Membre ancien sur le serveur → on exige un peu plus avant de sanctionner */
function effectiveRule(rule, member, cfg) {
  const days = cfg.trusted_member_days || 0;
  if (!member?.joinedAt || days <= 0) return rule;
  const joinedDays = (Date.now() - member.joinedAt.getTime()) / 86400000;
  if (joinedDays < days) return rule;
  return {
    ...rule,
    max_messages: rule.max_messages + 1,
    min_channels: rule.min_channels + 1,
  };
}

/**
 * Détection conservatrice :
 * - jamais sur un seul salon (si cross_channel)
 * - burst multi-salons OU même lien dupliqué sur 2+ salons
 */
function evaluateSpam(events, kind, rule, crossChannel, urlOpts) {
  const filtered = countKind(events, kind);
  if (filtered.length < 2) return null;

  if (kind === "url" && urlOpts?.duplicate_link_trigger) {
    const byUrl = new Map();
    for (const e of filtered) {
      if (!e.urlKey) continue;
      if (!byUrl.has(e.urlKey)) byUrl.set(e.urlKey, new Set());
      byUrl.get(e.urlKey).add(e.channelId);
    }
    for (const [urlKey, channels] of byUrl) {
      if (channels.size >= 2) {
        return {
          reason:
            "même lien posté sur plusieurs salons (comportement type compte compromis)",
          detail: `lien \`${urlKey}\` sur ${channels.size} salons`,
        };
      }
    }
  }

  if (filtered.length < rule.max_messages) return null;

  if (crossChannel) {
    const chCount = uniqueChannels(filtered);
    if (chCount < rule.min_channels) return null;
    return {
      reason:
        kind === "url"
          ? "spam de liens sur plusieurs salons"
          : "spam d’images sur plusieurs salons",
      detail: `${filtered.length} messages / ${chCount} salons en ${rule.window_sec}s`,
    };
  }

  const byChannel = new Map();
  for (const e of filtered) {
    byChannel.set(e.channelId, (byChannel.get(e.channelId) || 0) + 1);
  }
  for (const [ch, n] of byChannel) {
    if (n >= rule.max_messages) {
      return {
        reason: `rafale de ${kind === "url" ? "liens" : "images"} dans un salon`,
        detail: `${n} messages dans <#${ch}>`,
      };
    }
  }
  return null;
}

function memberIsImmune(member, cfg, access) {
  if (!member) return true;
  if (hasModAdminBypass(member)) return true;
  const immune = new Set([
    ...(cfg.immune_role_ids || []),
    ...staffRolesUnion(access),
  ]);
  for (const roleId of member.roles.cache.keys()) {
    if (immune.has(roleId)) return true;
  }
  return false;
}

function channelIsImmune(channelId, cfg, access) {
  const ignore = new Set([
    ...(cfg.immune_channel_ids || []),
    ...(access.ignore_channel_ids || []),
  ]);
  return ignore.has(channelId);
}

async function sendModLog(guild, embed) {
  if (!isLogEnabled(guild.id, "mod_antispam")) return;
  const channelId = getLogChannel(guild.id);
  if (!channelId) return;
  const ch = guild.channels.cache.get(channelId);
  if (!ch?.isTextBased?.()) return;
  await ch.send({ embeds: [embed] }).catch(() => null);
}

/**
 * Supprime tous les messages spam trackés (textuels + chat des vocaux),
 * pas seulement le message qui a déclenché la détection.
 */
async function deleteSpamMessages(guild, events, kind, triggerMessage) {
  /** @type {Map<string, Set<string>>} */
  const byChannel = new Map();

  const add = (channelId, messageId) => {
    if (!channelId || !messageId) return;
    if (!byChannel.has(channelId)) byChannel.set(channelId, new Set());
    byChannel.get(channelId).add(messageId);
  };

  for (const e of events) {
    if (e.kind !== kind) continue;
    add(e.channelId, e.messageId);
  }
  if (triggerMessage?.id) {
    add(triggerMessage.channel?.id || triggerMessage.channelId, triggerMessage.id);
  }

  let deleted = 0;
  for (const [channelId, idSet] of byChannel) {
    const ids = [...idSet];
    const ch =
      guild.channels.cache.get(channelId) ||
      (await guild.channels.fetch(channelId).catch(() => null));
    if (!ch?.isTextBased?.() || !ch.messages) continue;

    // bulkDelete si possible (≥2 msgs, <14j) — marche aussi sur le chat d’un vocal
    if (ids.length >= 2 && typeof ch.bulkDelete === "function") {
      try {
        const res = await ch.bulkDelete(ids, true);
        deleted += res?.size || ids.length;
        continue;
      } catch {
        /* fallback unitaire */
      }
    }

    for (const id of ids) {
      try {
        if (triggerMessage?.id === id && triggerMessage.deletable !== false) {
          await triggerMessage.delete().catch(() => null);
          deleted += 1;
        } else {
          await ch.messages.delete(id).catch(() => null);
          deleted += 1;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return deleted;
}

async function applySanction(message, cfg, kind, evalResult, events) {
  const { guild, member, author, channel } = message;
  if (!guild || !member) return false;

  const reasonLabel = evalResult.reason;
  const warnCfg = getWarnConfig(guild.id);
  const currentWarns = countGuildWarnings(guild.id, author.id);
  const nextTotal = currentWarns + 1;

  let simulatedTimeout = 0;
  if (warnCfg.auto_timeout_enabled && nextTotal >= warnCfg.warns_before_timeout) {
    simulatedTimeout =
      nextTotal >= warnCfg.warns_before_timeout + 2
        ? warnCfg.timeout_escalated_minutes
        : warnCfg.timeout_minutes;
  }

  const trackedCount = events.filter((e) => e.kind === kind).length;

  if (cfg.test_mode) {
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("🧪 Antispam — mode test (aucune action)")
      .setDescription(
        [
          `**Membre :** ${author} (\`${author.id}\`)`,
          `**Salon :** ${channel}`,
          `**Type :** ${kind}`,
          `**Détection :** ${reasonLabel}`,
          evalResult.detail ? `**Détail :** ${evalResult.detail}` : null,
          `**Serait appliqué :** suppression de ~${Math.max(trackedCount, 1)} msg(s) + warn`,
          `**Warn simulé :** ${nextTotal}/${warnCfg.warns_before_timeout}`,
          simulatedTimeout > 0
            ? `**Sourdine simulée :** ${simulatedTimeout} min`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .setFooter({ text: "Désactive le mode test quand tu es satisfait du calibrage" })
      .setTimestamp();
    await sendModLog(guild, embed);
    return true;
  }

  const deleted = await deleteSpamMessages(guild, events, kind, message);

  const fullReason = `Antispam : ${reasonLabel}${
    evalResult.detail ? ` (${evalResult.detail})` : ""
  }`;

  const result = await issueWarning({
    guild,
    targetUser: author,
    moderator: null,
    reason: fullReason.slice(0, 500),
    source: "antispam",
    targetMember: member,
  });

  const embed = new EmbedBuilder()
    .setColor(result.timeoutMin > 0 ? 0xef4444 : 0xf59e0b)
    .setTitle("🛡️ Antispam — warn enregistré")
    .setDescription(
      [
        `**Membre :** ${author} (\`${author.id}\`)`,
        `**Salon :** ${channel}`,
        `**Type :** ${kind}`,
        `**Warn #${result.warning.id}** · total ${result.total}/${warnCfg.warns_before_timeout}`,
        evalResult.detail ? `**Détail :** ${evalResult.detail}` : null,
        deleted > 0 ? `**Messages supprimés :** ${deleted}` : null,
        result.timeoutMin > 0
          ? `**Sourdine auto :** ${result.timeoutMin} min`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setTimestamp();

  await sendModLog(guild, embed);
  return true;
}

async function handleAntispamMessage(message) {
  if (!message.guild || message.system) return false;
  // Ignore uniquement notre propre bot — les bots de raid / comptes bot spammeurs passent
  if (message.author.id === message.client.user?.id) return false;
  if (!isAntispamEligibleChannel(message.channel)) return false;

  const cfg = getAntispamConfig(message.guild.id);
  if (!cfg.enabled) return false;

  const access = getCommandAccessConfig(message.guild.id);
  if (channelIsImmune(message.channel.id, cfg, access)) return false;

  const member =
    message.member ||
    (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (memberIsImmune(member, cfg, access)) return false;

  const urlInfo = cfg.url_spam.enabled ? analyzeUrlMessage(message) : null;
  const hasImage = cfg.image_spam.enabled && messageHasUploadedImage(message);
  if (!urlInfo && !hasImage) return false;

  const key = trackerKey(message.guild.id, message.author.id);
  const kinds = [];
  if (urlInfo) kinds.push("url");
  if (hasImage) kinds.push("image");

  for (const kind of kinds) {
    const baseRule = kind === "url" ? cfg.url_spam : cfg.image_spam;
    const rule = effectiveRule(baseRule, member, cfg);

    if (kind === "url" && urlInfo) {
      pushActivity(
        message.guild.id,
        message.author.id,
        message.channel.id,
        message.id,
        "url",
        {
          urlKey: urlInfo.primaryKey,
          strong: urlInfo.strong,
        }
      );
    } else {
      pushActivity(
        message.guild.id,
        message.author.id,
        message.channel.id,
        message.id,
        kind
      );
    }

    const events = pruneActivity(key, rule.window_sec * 1000);
    const evalResult = evaluateSpam(
      events,
      kind,
      rule,
      cfg.cross_channel,
      kind === "url" ? cfg.url_spam : null
    );

    if (!evalResult) continue;

    const acted = await applySanction(message, cfg, kind, evalResult, events);
    if (acted) {
      const remaining = events.filter((e) => e.kind !== kind);
      if (remaining.length) activity.set(key, { events: remaining });
      else activity.delete(key);
      return true;
    }
  }

  return false;
}

module.exports = (client) => {
  if (client.__wingbotAntispamAttached) return;
  client.__wingbotAntispamAttached = true;

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleAntispamMessage(message);
    } catch (e) {
      console.error("[antispam]", e?.message || e);
    }
  });
};

module.exports.handleAntispamMessage = handleAntispamMessage;
module.exports.analyzeUrlMessage = analyzeUrlMessage;
module.exports.messageHasUploadedImage = messageHasUploadedImage;
module.exports.evaluateSpam = evaluateSpam;
module.exports.isAntispamEligibleChannel = isAntispamEligibleChannel;
module.exports.deleteSpamMessages = deleteSpamMessages;
