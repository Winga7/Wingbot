const { Events, EmbedBuilder } = require("discord.js");
const {
  getAntispamConfig,
  getCommandAccessConfig,
  getLogChannel,
  isLogEnabled,
  getWarnConfig,
  countGuildWarnings,
} = require("../database");
const { staffRolesUnion } = require("../lib/commandAccessConfig");
const { hasModAdminBypass } = require("../memberPerms");
const { issueWarning } = require("../lib/warnService");

/** @type {Map<string, { events: SpamEvent[] }>} */
const activity = new Map();

const DISCORD_INVITE =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite|discord\.me)\/[\w-]+/i;
/** http(s), www., ou domaine.tld/chemin — couvre la plupart des liens de phishing */
const LOOSE_URL =
  /(?:https?:\/\/|www\.)[^\s<>\]\|]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|gg|co|me|xyz|ru|cn|tk|ml|ga|cf|click|link|shop|top|info|online|site|app|dev|tv|cc)(?:\/[^\s<>\]\|]*)?/gi;
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]+)\)/g;
const SCAM_HINT =
  /free\s*nitro|steam\s*(?:gift|nitro)|@everyone|@here|air\s*drop|crypto\s*giveaway|claim\s*(?:your\s+)?(?:reward|prize|nitro)|gift\s*nitro|discord\s*nitro\s*(?:free|gift)|check\s+this\s+out.*http|hurry\s+up|limited\s+offer/i;

/**
 * @typedef {{
 *   t: number,
 *   channelId: string,
 *   messageId: string,
 *   kind: string,
 *   urlKeys?: string[],
 *   strong?: boolean,
 *   contentFp?: string,
 * }} SpamEvent
 */

function trackerKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function stripObfuscation(text) {
  return String(text || "")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\|\|/g, "")
    .replace(/\s*([.:/])\s*/g, "$1");
}

function normalizeUrlKey(raw) {
  let s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[>,)\]\}.]+$/g, "");
  if (!s) return "";
  if (s.startsWith("www.")) s = `https://${s}`;
  if (!/^https?:\/\//i.test(s) && !s.includes("://")) {
    if (/^(discord\.gg|discord(?:app)?\.com)/i.test(s)) s = `https://${s}`;
    else if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    let host = u.hostname.replace(/^www\./, "");
    let path = u.pathname.replace(/\/$/, "") || "";
    return `${host}${path}`;
  } catch {
    return s.replace(/[?#].*$/, "").replace(/^www\./, "");
  }
}

function extractUrlKeys(text) {
  const keys = new Set();
  const content = stripObfuscation(text);
  for (const m of content.match(LOOSE_URL) || []) {
    const k = normalizeUrlKey(m);
    if (k) keys.add(k);
  }
  MARKDOWN_LINK.lastIndex = 0;
  let md;
  while ((md = MARKDOWN_LINK.exec(content)) !== null) {
    const k = normalizeUrlKey(md[2]);
    if (k) keys.add(k);
  }
  return [...keys];
}

function contentFingerprint(text) {
  const raw = stripObfuscation(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, "§url§")
    .replace(/www\.\S+/gi, "§url§")
    .replace(/discord\.gg\/\S+/gi, "§inv§")
    .replace(/<@!?\d+>/g, "@u")
    .replace(/<#\d+>/g, "#c")
    .replace(/\s+/g, " ")
    .trim();
  if (raw.length < 12) return "";
  return raw.slice(0, 240);
}

/**
 * Un seul lien YouTube / article dans un salon ≠ spam.
 * On suit les messages avec lien(s) (http, www, domaine, markdown, invite).
 */
function analyzeUrlMessage(message) {
  const text = message.content || "";
  const cleaned = stripObfuscation(text);
  const keys = extractUrlKeys(cleaned);
  if (keys.length === 0) return null;

  const invite = DISCORD_INVITE.test(cleaned);
  const multi = keys.length >= 2;
  const scamHint = SCAM_HINT.test(cleaned);

  return {
    keys,
    /** Signal fort : invite, multi-liens, ou phrasing type phishing */
    strong: invite || multi || scamHint,
    invite,
    scamHint,
    primaryKey: keys[0],
    contentFp: contentFingerprint(text),
  };
}

/**
 * Images uploadées uniquement — pas les miniatures d’aperçu de lien.
 */
function messageHasUploadedImage(message) {
  for (const att of message.attachments?.values?.() || []) {
    const ct = att.contentType || "";
    if (ct.startsWith("image/")) return true;
    if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(att.name || "")) return true;
  }
  return false;
}

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

/**
 * Seuils assouplis pour membres anciens — SAUF signaux « compte compromis »
 * (même lien, même texte, invite Discord, phrasing scam).
 */
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
 * @returns {{ reason: string, detail?: string, strong?: boolean } | null}
 */
function evaluateSpam(events, kind, rule, crossChannel, urlOpts) {
  const filtered = countKind(events, kind);
  if (filtered.length < 2) return null;

  /* --- Signaux forts type compte hacké (pas de seuil « membre fidèle ») --- */

  if (kind === "url") {
    // Même lien (tous les urlKeys du message) sur 2+ salons
    if (urlOpts?.duplicate_link_trigger !== false) {
      const byUrl = new Map();
      for (const e of filtered) {
        const keys = e.urlKeys?.length
          ? e.urlKeys
          : e.urlKey
            ? [e.urlKey]
            : [];
        for (const uk of keys) {
          if (!uk) continue;
          if (!byUrl.has(uk)) byUrl.set(uk, new Set());
          byUrl.get(uk).add(e.channelId);
        }
      }
      for (const [urlKey, channels] of byUrl) {
        if (channels.size >= 2) {
          return {
            reason:
              "même lien posté sur plusieurs salons (comportement type compte compromis)",
            detail: `lien \`${urlKey.slice(0, 80)}\` sur ${channels.size} salons`,
            strong: true,
          };
        }
      }
    }

    // Même texte (fingerprint) sur 2+ salons
    const byFp = new Map();
    for (const e of filtered) {
      if (!e.contentFp) continue;
      if (!byFp.has(e.contentFp)) byFp.set(e.contentFp, new Set());
      byFp.get(e.contentFp).add(e.channelId);
    }
    for (const [, channels] of byFp) {
      if (channels.size >= 2) {
        return {
          reason:
            "même message recopié sur plusieurs salons (compte probablement compromis)",
          detail: `texte identique sur ${channels.size} salons`,
          strong: true,
        };
      }
    }

    // Invites Discord sur 2+ salons (codes différents = toujours suspect)
    const inviteEvents = filtered.filter((e) => e.strong && e.invite);
    if (inviteEvents.length >= 2 && uniqueChannels(inviteEvents) >= 2) {
      return {
        reason: "invites Discord sur plusieurs salons",
        detail: `${inviteEvents.length} messages / ${uniqueChannels(inviteEvents)} salons`,
        strong: true,
      };
    }

    // Messages « strong » (scam phrasing / multi-liens) sur 2+ salons — seuil bas
    const strongEvents = filtered.filter((e) => e.strong);
    if (strongEvents.length >= 2 && uniqueChannels(strongEvents) >= 2) {
      return {
        reason: "liens suspects (phishing / multi-liens) sur plusieurs salons",
        detail: `${strongEvents.length} messages / ${uniqueChannels(strongEvents)} salons`,
        strong: true,
      };
    }
  }

  if (kind === "image") {
    const byFp = new Map();
    for (const e of filtered) {
      if (!e.contentFp) continue;
      if (!byFp.has(e.contentFp)) byFp.set(e.contentFp, new Set());
      byFp.get(e.contentFp).add(e.channelId);
    }
    for (const [, channels] of byFp) {
      if (channels.size >= 2) {
        return {
          reason: "même message + image recopié sur plusieurs salons",
          detail: `texte identique sur ${channels.size} salons`,
          strong: true,
        };
      }
    }
  }

  /* --- Seuils classiques (rafale) --- */
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
      strong: false,
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
        strong: false,
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
 * Supprime TOUS les messages de l’utilisateur dans la fenêtre de détection,
 * sur tous les salons où il a été vu (pas seulement le kind qui a déclenché).
 * Combine les IDs trackés + un fetch récent par salon pour ne rien laisser.
 */
async function deleteSpamMessages(guild, userId, events, triggerMessage, windowMs) {
  /** @type {Map<string, Set<string>>} */
  const byChannel = new Map();
  const cutoff = Date.now() - Math.max(windowMs, 15_000);

  const add = (channelId, messageId) => {
    if (!channelId || !messageId) return;
    if (!byChannel.has(channelId)) byChannel.set(channelId, new Set());
    byChannel.get(channelId).add(messageId);
  };

  for (const e of events) {
    add(e.channelId, e.messageId);
  }
  if (triggerMessage?.id) {
    add(
      triggerMessage.channel?.id || triggerMessage.channelId,
      triggerMessage.id
    );
  }

  let deleted = 0;

  for (const [channelId, idSet] of byChannel) {
    const ch =
      guild.channels.cache.get(channelId) ||
      (await guild.channels.fetch(channelId).catch(() => null));
    if (!ch?.isTextBased?.() || !ch.messages) continue;

    // Récupère l’historique récent : tout msg de cet auteur dans la fenêtre
    try {
      const fetched = await ch.messages.fetch({ limit: 100 });
      for (const m of fetched.values()) {
        if (m.author?.id !== userId) continue;
        if (m.createdTimestamp < cutoff) continue;
        idSet.add(m.id);
      }
    } catch {
      /* droits manquants / salon inaccessible */
    }

    const ids = [...idSet];
    if (ids.length === 0) continue;

    if (ids.length >= 2 && typeof ch.bulkDelete === "function") {
      try {
        const res = await ch.bulkDelete(ids, true);
        deleted += res?.size ?? ids.length;
        continue;
      } catch {
        /* fallback unitaire (msg >14j, permissions, etc.) */
      }
    }

    for (const id of ids) {
      try {
        if (triggerMessage?.id === id) {
          await triggerMessage.delete().catch(() => null);
        } else {
          await ch.messages.delete(id).catch(() => null);
        }
        deleted += 1;
      } catch {
        /* ignore */
      }
    }
  }

  return deleted;
}

async function applySanction(message, cfg, kind, evalResult, events, windowMs) {
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

  const channelCount = uniqueChannels(events);
  const trackedCount = events.length;

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
          evalResult.strong ? `**Signal fort :** compte compromis / phishing` : null,
          `**Serait appliqué :** purge de tous ses msgs (~${trackedCount}+) sur ${channelCount} salon(s) + warn`,
          `**Warn simulé :** ${nextTotal}/${warnCfg.warns_before_timeout}`,
          simulatedTimeout > 0
            ? `**Sourdine simulée :** ${simulatedTimeout} min`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .setFooter({ text: "Désactive le mode test pour appliquer les sanctions" })
      .setTimestamp();
    await sendModLog(guild, embed);
    return true;
  }

  const deleted = await deleteSpamMessages(
    guild,
    author.id,
    events,
    message,
    windowMs
  );

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
        `**Salon déclencheur :** ${channel}`,
        `**Type :** ${kind}`,
        `**Warn #${result.warning.id}** · total ${result.total}/${warnCfg.warns_before_timeout}`,
        evalResult.detail ? `**Détail :** ${evalResult.detail}` : null,
        `**Messages supprimés :** ${deleted} (tous ses msgs dans la fenêtre, ${channelCount} salon(s))`,
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

  const contentFp =
    urlInfo?.contentFp || contentFingerprint(message.content || "");

  for (const kind of kinds) {
    const baseRule = kind === "url" ? cfg.url_spam : cfg.image_spam;

    if (kind === "url" && urlInfo) {
      pushActivity(
        message.guild.id,
        message.author.id,
        message.channel.id,
        message.id,
        "url",
        {
          urlKeys: urlInfo.keys,
          urlKey: urlInfo.primaryKey,
          strong: urlInfo.strong,
          invite: !!urlInfo.invite,
          contentFp: urlInfo.contentFp || contentFp,
        }
      );
    } else {
      pushActivity(
        message.guild.id,
        message.author.id,
        message.channel.id,
        message.id,
        kind,
        { contentFp }
      );
    }

    const windowMs = baseRule.window_sec * 1000;
    const events = pruneActivity(key, windowMs);

    // Les signaux « compte compromis » (même lien / texte / invite) ne regardent
    // pas les seuils — le bonus « membre fidèle » ne s’applique qu’aux rafales classiques.
    const rule = effectiveRule(baseRule, member, cfg);
    const evalResult = evaluateSpam(
      events,
      kind,
      rule,
      cfg.cross_channel,
      kind === "url" ? cfg.url_spam : null
    );

    if (!evalResult) continue;

    // Fenêtre de purge = la plus large des règles actives (pour tout nettoyer)
    const purgeWindowMs = Math.max(
      cfg.url_spam.window_sec,
      cfg.image_spam.window_sec,
      baseRule.window_sec
    ) * 1000;

    const allRecent = pruneActivity(key, purgeWindowMs);
    const acted = await applySanction(
      message,
      cfg,
      kind,
      evalResult,
      allRecent,
      purgeWindowMs
    );
    if (acted) {
      activity.delete(key);
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
module.exports.extractUrlKeys = extractUrlKeys;
module.exports.contentFingerprint = contentFingerprint;
