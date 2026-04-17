/**
 * Scanne un Guild discord.js et produit un payload JSON auto-suffisant.
 * Tous les IDs Discord sont remplacés par des refs internes (r1, c1, ch1…)
 * pour que le restore recrée tout sans dépendre des IDs sources.
 */

const { ChannelType, PermissionsBitField } = require("discord.js");

const BACKUP_SCHEMA_VERSION = 1;

/** Mapping type numérique → nom lisible pour le payload. Couvre tous les types pertinents. */
const CHANNEL_TYPE_NAMES = {
  [ChannelType.GuildText]: "GUILD_TEXT",
  [ChannelType.GuildVoice]: "GUILD_VOICE",
  [ChannelType.GuildCategory]: "GUILD_CATEGORY",
  [ChannelType.GuildAnnouncement]: "GUILD_ANNOUNCEMENT",
  [ChannelType.GuildStageVoice]: "GUILD_STAGE_VOICE",
  [ChannelType.GuildForum]: "GUILD_FORUM",
  [ChannelType.GuildMedia]: "GUILD_MEDIA",
};

function typeName(t) {
  return CHANNEL_TYPE_NAMES[t] || `TYPE_${t}`;
}

function overwriteToPayload(ow, roleRefByRealId, userRefByRealId) {
  const allow = String(ow.allow?.bitfield ?? ow.allow ?? "0");
  const deny = String(ow.deny?.bitfield ?? ow.deny ?? "0");
  const base = { allow, deny };
  if (ow.type === 0) {
    // type=0 → role
    const ref = roleRefByRealId.get(ow.id);
    return ref ? { ...base, target_type: "role", role_ref: ref } : null;
  }
  if (ow.type === 1) {
    // type=1 → user
    const ref = userRefByRealId.get(ow.id) || ow.id;
    return { ...base, target_type: "user", user_id: ref };
  }
  return null;
}

async function fetchRecentMessages(channel, limit) {
  if (!limit || limit <= 0) return [];
  try {
    const coll = await channel.messages.fetch({ limit: Math.min(limit, 100) });
    const arr = Array.from(coll.values()).reverse(); // plus ancien → plus récent
    return arr.map((m) => ({
      author: {
        id: m.author?.id || null,
        username: m.author?.username || "Unknown",
        global_name: m.author?.globalName || null,
        avatar_url:
          m.author
            ?.displayAvatarURL?.({ size: 128, extension: "png" })
            ?.toString() || null,
        bot: !!m.author?.bot,
      },
      content: m.content || "",
      created_at: m.createdAt?.toISOString() || null,
      pinned: !!m.pinned,
      attachments: Array.from(m.attachments?.values?.() || []).map((a) => ({
        url: a.url,
        name: a.name,
        size: a.size,
        content_type: a.contentType || null,
      })),
      embeds: Array.from(m.embeds || []).map((e) => e.toJSON?.() || e),
      sticker_names: Array.from(m.stickers?.values?.() || []).map((s) => s.name),
    }));
  } catch {
    return [];
  }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {{ includeMessages?: boolean, messagesPerChannel?: number, includeEmojis?: boolean, includeBans?: boolean }} [opts]
 */
async function captureGuild(guild, opts = {}) {
  const includeMessages = !!opts.includeMessages;
  const messagesPerChannel = Math.max(0, Math.min(500, opts.messagesPerChannel ?? 25));
  const includeEmojis = opts.includeEmojis !== false;
  const includeBans = !!opts.includeBans;

  // ----- Guild metadata -----
  const payload = {
    version: BACKUP_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    source: {
      guild_id: guild.id,
      name: guild.name,
      icon_url: guild.iconURL?.({ size: 512, extension: "png" }) || null,
    },
    guild: {
      name: guild.name,
      icon_url: guild.iconURL?.({ size: 1024, extension: "png" }) || null,
      banner_url: guild.bannerURL?.({ size: 1024, extension: "png" }) || null,
      description: guild.description || null,
      verification_level: guild.verificationLevel ?? null,
      default_message_notifications: guild.defaultMessageNotifications ?? null,
      explicit_content_filter: guild.explicitContentFilter ?? null,
      afk_timeout: guild.afkTimeout ?? null,
      afk_channel_ref: null, // résolu plus bas
      system_channel_ref: null,
      system_channel_flags: guild.systemChannelFlags?.bitfield
        ? String(guild.systemChannelFlags.bitfield)
        : null,
      preferred_locale: guild.preferredLocale || null,
      rules_channel_ref: null,
      public_updates_channel_ref: null,
    },
    roles: [],
    categories: [],
    channels: [],
    emojis: [],
    bans: [],
    messages: {},
  };

  // ----- Roles -----
  // On exclut @everyone (géré spécialement) et les rôles managed (bots, boosters, etc.)
  const roles = Array.from(guild.roles.cache.values())
    .sort((a, b) => a.position - b.position); // bas → haut

  const roleRefByRealId = new Map();
  let rIdx = 0;
  for (const role of roles) {
    if (role.id === guild.id) {
      // @everyone : on capture juste ses permissions pour les appliquer à la cible
      payload.roles.push({
        _ref: "r_everyone",
        name: "@everyone",
        is_everyone: true,
        permissions: String(role.permissions.bitfield),
      });
      roleRefByRealId.set(role.id, "r_everyone");
      continue;
    }
    if (role.managed) {
      // Rôles bots/boosters : on garde la ref pour résoudre les overwrites, mais on ne les recréera pas
      const ref = `r_managed_${rIdx++}`;
      payload.roles.push({
        _ref: ref,
        name: role.name,
        managed: true,
        skip_create: true,
      });
      roleRefByRealId.set(role.id, ref);
      continue;
    }
    const ref = `r${++rIdx}`;
    payload.roles.push({
      _ref: ref,
      name: role.name,
      color: role.color || 0,
      hoist: !!role.hoist,
      mentionable: !!role.mentionable,
      position: role.position,
      permissions: String(role.permissions.bitfield),
      icon_url: role.iconURL?.() || null,
      unicode_emoji: role.unicodeEmoji || null,
    });
    roleRefByRealId.set(role.id, ref);
  }

  // ----- Channels (catégories d'abord, puis enfants) -----
  const allChannels = Array.from(guild.channels.cache.values()).sort(
    (a, b) => a.rawPosition - b.rawPosition
  );

  const userRefByRealId = new Map(); // overwrites user-based restent ID bruts
  const categoryRefByRealId = new Map();

  let cIdx = 0;
  for (const ch of allChannels) {
    if (ch.type !== ChannelType.GuildCategory) continue;
    const ref = `cat${++cIdx}`;
    categoryRefByRealId.set(ch.id, ref);
    payload.categories.push({
      _ref: ref,
      name: ch.name,
      position: ch.rawPosition,
      nsfw: !!ch.nsfw,
      overwrites: Array.from(ch.permissionOverwrites?.cache?.values?.() || [])
        .map((ow) => overwriteToPayload(ow, roleRefByRealId, userRefByRealId))
        .filter(Boolean),
    });
  }

  const channelRefByRealId = new Map();
  let chIdx = 0;
  for (const ch of allChannels) {
    if (ch.type === ChannelType.GuildCategory) continue;
    const ref = `ch${++chIdx}`;
    channelRefByRealId.set(ch.id, ref);

    const node = {
      _ref: ref,
      type: typeName(ch.type),
      name: ch.name,
      position: ch.rawPosition,
      parent_ref: ch.parentId ? categoryRefByRealId.get(ch.parentId) || null : null,
      topic: ch.topic || null,
      nsfw: !!ch.nsfw,
      rate_limit_per_user: ch.rateLimitPerUser ?? 0,
      overwrites: Array.from(ch.permissionOverwrites?.cache?.values?.() || [])
        .map((ow) => overwriteToPayload(ow, roleRefByRealId, userRefByRealId))
        .filter(Boolean),
    };

    // Spécifiques voice / stage
    if (
      ch.type === ChannelType.GuildVoice ||
      ch.type === ChannelType.GuildStageVoice
    ) {
      node.bitrate = ch.bitrate ?? null;
      node.user_limit = ch.userLimit ?? 0;
      node.rtc_region = ch.rtcRegion || null;
    }

    // Spécifiques forum / media : tags si dispo
    if (
      ch.type === ChannelType.GuildForum ||
      ch.type === ChannelType.GuildMedia
    ) {
      node.default_auto_archive_duration = ch.defaultAutoArchiveDuration ?? null;
      node.default_thread_rate_limit_per_user =
        ch.defaultThreadRateLimitPerUser ?? null;
      node.available_tags = Array.from(ch.availableTags || []).map((t) => ({
        name: t.name,
        moderated: !!t.moderated,
        emoji: t.emoji
          ? {
              id: t.emoji.id || null,
              name: t.emoji.name || null,
            }
          : null,
      }));
    }

    payload.channels.push(node);
  }

  // Résolution refs de guilde (afk, system, rules, public_updates)
  const resolveChannelRef = (id) =>
    (id && channelRefByRealId.get(id)) || null;
  payload.guild.afk_channel_ref = resolveChannelRef(guild.afkChannelId);
  payload.guild.system_channel_ref = resolveChannelRef(guild.systemChannelId);
  payload.guild.rules_channel_ref = resolveChannelRef(guild.rulesChannelId);
  payload.guild.public_updates_channel_ref = resolveChannelRef(
    guild.publicUpdatesChannelId
  );

  // ----- Emojis -----
  if (includeEmojis) {
    for (const emoji of guild.emojis.cache.values()) {
      payload.emojis.push({
        name: emoji.name,
        url: emoji.url,
        animated: !!emoji.animated,
        roles: Array.from(emoji.roles?.cache?.keys?.() || [])
          .map((rid) => roleRefByRealId.get(rid))
          .filter(Boolean),
      });
    }
  }

  // ----- Bans (optionnel) -----
  if (includeBans) {
    try {
      const bans = await guild.bans.fetch();
      payload.bans = Array.from(bans.values()).map((b) => ({
        user_id: b.user.id,
        reason: b.reason || null,
      }));
    } catch {
      payload.bans = [];
    }
  }

  // ----- Messages récents -----
  let messagesCount = 0;
  if (includeMessages && messagesPerChannel > 0) {
    const sendable = allChannels.filter(
      (c) =>
        c.type === ChannelType.GuildText ||
        c.type === ChannelType.GuildAnnouncement
    );
    for (const ch of sendable) {
      // Permission check avant fetch pour éviter les 403 en masse
      const me = guild.members.me;
      if (!me || !ch.permissionsFor(me)?.has(PermissionsBitField.Flags.ViewChannel)) {
        continue;
      }
      if (!ch.permissionsFor(me)?.has(PermissionsBitField.Flags.ReadMessageHistory)) {
        continue;
      }
      const ref = channelRefByRealId.get(ch.id);
      if (!ref) continue;
      const msgs = await fetchRecentMessages(ch, messagesPerChannel);
      if (msgs.length) {
        payload.messages[ref] = msgs;
        messagesCount += msgs.length;
      }
    }
  }

  // ----- Stats -----
  const stats = {
    roles_count: payload.roles.filter((r) => !r.is_everyone && !r.skip_create).length,
    categories_count: payload.categories.length,
    channels_count: payload.channels.length,
    emojis_count: payload.emojis.length,
    bans_count: payload.bans.length,
    messages_count: messagesCount,
  };

  return { payload, stats };
}

module.exports = {
  captureGuild,
  BACKUP_SCHEMA_VERSION,
};
