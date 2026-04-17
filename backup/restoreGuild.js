/**
 * Restore : prend un payload capturé et recrée tout sur un guild cible.
 *
 * Modes :
 *   - 'wipe'   : supprime tout ce qui peut l'être sur la cible, puis recrée à l'identique
 *   - 'merge'  : conserve l'existant et ajoute les éléments manquants (non implémenté v1)
 *
 * Gère les rate limits discord.js (qui renvoie déjà des erreurs HTTPError avec retry_after).
 * Le worker est séquentiel par nature : créer rôles → mapper → catégories → mapper → salons.
 */

const { ChannelType, PermissionFlagsBits } = require("discord.js");

const CHANNEL_TYPE_BY_NAME = {
  GUILD_TEXT: ChannelType.GuildText,
  GUILD_VOICE: ChannelType.GuildVoice,
  GUILD_CATEGORY: ChannelType.GuildCategory,
  GUILD_ANNOUNCEMENT: ChannelType.GuildAnnouncement,
  GUILD_STAGE_VOICE: ChannelType.GuildStageVoice,
  GUILD_FORUM: ChannelType.GuildForum,
  GUILD_MEDIA: ChannelType.GuildMedia,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Exécute `fn`, retry sur 429 avec le retry_after indiqué. */
async function withRetry(fn, label, log) {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (e) {
      const status = e?.status || e?.httpStatus;
      const retryAfter =
        e?.retry_after ?? e?.retryAfter ?? e?.rawError?.retry_after;
      if ((status === 429 || retryAfter) && attempt <= 5) {
        const wait = Math.max(1000, Math.ceil((retryAfter || 1) * 1000) + 250);
        log.warn(`[${label}] rate-limit, attente ${wait}ms (essai ${attempt})`);
        await sleep(wait);
        continue;
      }
      if (status >= 500 && attempt <= 3) {
        log.warn(`[${label}] erreur ${status}, retry dans 1500ms`);
        await sleep(1500);
        continue;
      }
      throw e;
    }
  }
}

function makeLogger() {
  const entries = [];
  const push = (level, msg) => {
    entries.push({ t: Date.now(), level, msg });
    // Console pour debug live en DM/salon après
    if (level === "error") console.error("[restore]", msg);
    else if (level === "warn") console.warn("[restore]", msg);
  };
  return {
    info: (m) => push("info", m),
    warn: (m) => push("warn", m),
    error: (m) => push("error", m),
    entries,
  };
}

function buildOverwrites(overwrites, roleIdByRef) {
  const out = [];
  for (const ow of overwrites || []) {
    if (ow.target_type === "role") {
      const id = roleIdByRef.get(ow.role_ref);
      if (!id) continue;
      out.push({
        id,
        type: 0,
        allow: BigInt(ow.allow || "0"),
        deny: BigInt(ow.deny || "0"),
      });
    } else if (ow.target_type === "user" && ow.user_id) {
      out.push({
        id: ow.user_id,
        type: 1,
        allow: BigInt(ow.allow || "0"),
        deny: BigInt(ow.deny || "0"),
      });
    }
  }
  return out;
}

/**
 * Supprime tous les salons et rôles (hors managed + @everyone) de la cible.
 * Doit tourner avec MANAGE_CHANNELS + MANAGE_ROLES.
 */
async function wipeGuild(guild, log, onProgress) {
  log.info("Mode wipe : suppression des salons et rôles existants…");
  onProgress?.({ phase: "wipe", done: 0, total: 0 });

  // Salons d'abord (catégories en dernier pour éviter les "parent_id orphelin")
  const channels = Array.from(guild.channels.cache.values()).sort((a, b) => {
    const ac = a.type === ChannelType.GuildCategory ? 1 : 0;
    const bc = b.type === ChannelType.GuildCategory ? 1 : 0;
    return ac - bc;
  });
  for (const ch of channels) {
    await withRetry(
      () => ch.delete("Wingbot restore (wipe)"),
      `delete #${ch.name}`,
      log
    ).catch((e) => log.warn(`delete #${ch.name}: ${e.message}`));
  }

  const roles = Array.from(guild.roles.cache.values())
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position); // plus haut d'abord
  for (const role of roles) {
    await withRetry(
      () => role.delete("Wingbot restore (wipe)"),
      `delete role ${role.name}`,
      log
    ).catch((e) => log.warn(`delete role ${role.name}: ${e.message}`));
  }
}

async function recreateRoles(guild, payload, log, onProgress) {
  const roleIdByRef = new Map();
  const normalTotal = payload.roles.filter((r) => !r.is_everyone && !r.skip_create).length;
  onProgress?.({ phase: "roles", done: 0, total: normalTotal });

  // @everyone : on modifie ses permissions pour matcher la source
  const everyoneFromSrc = payload.roles.find((r) => r.is_everyone);
  if (everyoneFromSrc) {
    roleIdByRef.set(everyoneFromSrc._ref, guild.id);
    try {
      await withRetry(
        () =>
          guild.roles.everyone.setPermissions(
            BigInt(everyoneFromSrc.permissions || "0"),
            "Wingbot restore"
          ),
        "setPerms @everyone",
        log
      );
    } catch (e) {
      log.warn(`@everyone setPermissions: ${e.message}`);
    }
  }

  // Rôles managed : on ne peut pas les recréer, on mappe sur les rôles existants s'ils existent par nom
  for (const r of payload.roles.filter((x) => x.skip_create && !x.is_everyone)) {
    const existing = guild.roles.cache.find(
      (x) => x.managed && x.name === r.name
    );
    if (existing) roleIdByRef.set(r._ref, existing.id);
  }

  // Rôles normaux : création dans l'ordre (bas → haut), la position est gérée après
  const normalRoles = payload.roles.filter(
    (r) => !r.is_everyone && !r.skip_create
  );
  let created = 0;
  for (const r of normalRoles) {
    try {
      const newRole = await withRetry(
        () =>
          guild.roles.create({
            name: r.name,
            color: r.color || undefined,
            hoist: !!r.hoist,
            mentionable: !!r.mentionable,
            permissions: BigInt(r.permissions || "0"),
            reason: "Wingbot restore",
          }),
        `create role ${r.name}`,
        log
      );
      roleIdByRef.set(r._ref, newRole.id);
      created++;
      if (created % 3 === 0 || created === normalTotal) {
        onProgress?.({ phase: "roles", done: created, total: normalTotal });
      }
    } catch (e) {
      log.error(`role ${r.name}: ${e.message}`);
    }
  }
  log.info(`Rôles créés : ${created}/${normalRoles.length}`);
  return roleIdByRef;
}

async function recreateCategories(guild, payload, roleIdByRef, log, onProgress) {
  const catIdByRef = new Map();
  const total = payload.categories.length;
  onProgress?.({ phase: "categories", done: 0, total });
  let i = 0;
  for (const c of payload.categories) {
    try {
      const cat = await withRetry(
        () =>
          guild.channels.create({
            name: c.name,
            type: ChannelType.GuildCategory,
            nsfw: !!c.nsfw,
            permissionOverwrites: buildOverwrites(c.overwrites, roleIdByRef),
            reason: "Wingbot restore",
          }),
        `create cat ${c.name}`,
        log
      );
      catIdByRef.set(c._ref, cat.id);
      i++;
      if (i % 2 === 0 || i === total) {
        onProgress?.({ phase: "categories", done: i, total });
      }
    } catch (e) {
      log.error(`cat ${c.name}: ${e.message}`);
    }
  }
  log.info(`Catégories créées : ${catIdByRef.size}/${payload.categories.length}`);
  return catIdByRef;
}

async function recreateChannels(guild, payload, roleIdByRef, catIdByRef, log, onProgress) {
  const chIdByRef = new Map();
  const total = payload.channels.length;
  onProgress?.({ phase: "channels", done: 0, total });
  let i = 0;
  for (const ch of payload.channels) {
    const type = CHANNEL_TYPE_BY_NAME[ch.type];
    if (type === undefined) {
      log.warn(`salon ${ch.name} : type inconnu ${ch.type}, ignoré`);
      continue;
    }
    const options = {
      name: ch.name,
      type,
      nsfw: !!ch.nsfw,
      permissionOverwrites: buildOverwrites(ch.overwrites, roleIdByRef),
      reason: "Wingbot restore",
    };
    if (ch.parent_ref && catIdByRef.has(ch.parent_ref)) {
      options.parent = catIdByRef.get(ch.parent_ref);
    }
    if (ch.topic) options.topic = ch.topic;
    if (typeof ch.rate_limit_per_user === "number") {
      options.rateLimitPerUser = ch.rate_limit_per_user;
    }
    if (type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice) {
      if (typeof ch.bitrate === "number" && ch.bitrate > 0) {
        options.bitrate = ch.bitrate;
      }
      if (typeof ch.user_limit === "number") options.userLimit = ch.user_limit;
      if (ch.rtc_region) options.rtcRegion = ch.rtc_region;
    }
    if (type === ChannelType.GuildForum || type === ChannelType.GuildMedia) {
      if (Array.isArray(ch.available_tags) && ch.available_tags.length) {
        options.availableTags = ch.available_tags.map((t) => ({
          name: t.name,
          moderated: !!t.moderated,
          emoji: t.emoji
            ? { id: t.emoji.id || undefined, name: t.emoji.name || undefined }
            : undefined,
        }));
      }
    }
    try {
      const created = await withRetry(
        () => guild.channels.create(options),
        `create #${ch.name}`,
        log
      );
      chIdByRef.set(ch._ref, created.id);
      i++;
      if (i % 3 === 0 || i === total) {
        onProgress?.({ phase: "channels", done: i, total });
      }
    } catch (e) {
      log.error(`salon ${ch.name}: ${e.message}`);
    }
  }
  log.info(`Salons créés : ${chIdByRef.size}/${payload.channels.length}`);
  return chIdByRef;
}

async function applyGuildSettings(guild, payload, chIdByRef, log) {
  const g = payload.guild || {};
  const patch = {};
  if (g.name && g.name !== guild.name) patch.name = g.name;
  if (g.description !== undefined) patch.description = g.description;
  if (typeof g.verification_level === "number") {
    patch.verificationLevel = g.verification_level;
  }
  if (typeof g.default_message_notifications === "number") {
    patch.defaultMessageNotifications = g.default_message_notifications;
  }
  if (typeof g.explicit_content_filter === "number") {
    patch.explicitContentFilter = g.explicit_content_filter;
  }
  if (g.afk_channel_ref && chIdByRef.has(g.afk_channel_ref)) {
    patch.afkChannel = chIdByRef.get(g.afk_channel_ref);
  }
  if (typeof g.afk_timeout === "number") patch.afkTimeout = g.afk_timeout;
  if (g.system_channel_ref && chIdByRef.has(g.system_channel_ref)) {
    patch.systemChannel = chIdByRef.get(g.system_channel_ref);
  }
  if (g.preferred_locale) patch.preferredLocale = g.preferred_locale;

  if (Object.keys(patch).length) {
    try {
      await withRetry(
        () => guild.edit(patch, "Wingbot restore"),
        "edit guild",
        log
      );
      log.info(`Guild mise à jour (${Object.keys(patch).join(", ")})`);
    } catch (e) {
      log.warn(`edit guild: ${e.message}`);
    }
  }

  // Icône / bannière : à télécharger et réuploader en data URI (limite ~8Mo)
  if (g.icon_url) {
    try {
      await withRetry(
        () => guild.setIcon(g.icon_url, "Wingbot restore"),
        "setIcon",
        log
      );
    } catch (e) {
      log.warn(`setIcon: ${e.message}`);
    }
  }
}

/**
 * Rejoue les N derniers messages de chaque salon via webhook temporaire.
 * Les auteurs ne reçoivent pas de ping (allowed_mentions vide), format type quote.
 */
async function replayMessages(guild, payload, chIdByRef, log, onProgress) {
  const messages = payload.messages || {};
  const totalMsgs = Object.values(messages).reduce(
    (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
    0
  );
  const totalChannels = Object.keys(messages).length;
  onProgress?.({
    phase: "messages",
    done: 0,
    total: totalMsgs,
    channel: 0,
    channels: totalChannels,
  });
  let total = 0;
  let channelIdx = 0;
  for (const [ref, msgs] of Object.entries(messages)) {
    const chId = chIdByRef.get(ref);
    if (!chId) continue;
    const ch = guild.channels.cache.get(chId);
    if (!ch || typeof ch.createWebhook !== "function") continue;
    channelIdx++;
    onProgress?.({
      phase: "messages",
      done: total,
      total: totalMsgs,
      channel: channelIdx,
      channels: totalChannels,
      currentChannelName: ch.name,
    });

    let hook;
    try {
      hook = await withRetry(
        () =>
          ch.createWebhook({
            name: "Wingbot Restore",
            reason: "Wingbot restore : replay messages",
          }),
        `webhook #${ch.name}`,
        log
      );
    } catch (e) {
      log.warn(`webhook #${ch.name}: ${e.message}`);
      continue;
    }

    for (const m of msgs) {
      const username = (m.author?.global_name || m.author?.username || "User").slice(
        0,
        80
      );
      const content =
        (m.content || "").slice(0, 1900) ||
        (m.attachments?.length ? "" : "\u200b"); // discord exige content OU embed non-vide
      try {
        await withRetry(
          () =>
            hook.send({
              content: content || undefined,
              username,
              avatarURL: m.author?.avatar_url || undefined,
              embeds: Array.isArray(m.embeds) && m.embeds.length ? m.embeds.slice(0, 10) : undefined,
              allowedMentions: { parse: [] },
            }),
          `msg #${ch.name}`,
          log
        );
        total++;
        if (total % 10 === 0 || total === totalMsgs) {
          onProgress?.({
            phase: "messages",
            done: total,
            total: totalMsgs,
            channel: channelIdx,
            channels: totalChannels,
            currentChannelName: ch.name,
          });
        }
      } catch (e) {
        log.warn(`msg #${ch.name}: ${e.message}`);
      }
    }

    try {
      await hook.delete("Wingbot restore : webhook temporaire");
    } catch {
      /* ignore */
    }
  }
  if (total) log.info(`Messages rejoués : ${total}`);
}

/**
 * Point d'entrée. `onProgress(step, pct)` est optionnel pour une UI live.
 */
async function restoreGuild(guild, payload, opts = {}) {
  const mode = opts.mode === "merge" ? "merge" : "wipe";
  const log = makeLogger();
  const onProgress =
    typeof opts.onProgress === "function" ? opts.onProgress : null;

  log.info(`Restore démarré (mode=${mode}) sur ${guild.name}`);
  if (mode === "merge") {
    log.warn(
      "Mode merge non supporté pour l'instant, bascule en wipe (prévu dans v2)"
    );
  }

  // Vérifier les permissions du bot
  const me = guild.members.me;
  if (!me) throw new Error("Le bot n'est pas membre du serveur cible.");
  const need =
    PermissionFlagsBits.ManageGuild |
    PermissionFlagsBits.ManageChannels |
    PermissionFlagsBits.ManageRoles |
    PermissionFlagsBits.ManageWebhooks;
  if (!me.permissions.has(need)) {
    throw new Error(
      "Permissions insuffisantes : il faut Administrator (ou au minimum ManageGuild + ManageChannels + ManageRoles + ManageWebhooks)."
    );
  }

  await wipeGuild(guild, log, onProgress);

  const roleIdByRef = await recreateRoles(guild, payload, log, onProgress);
  const catIdByRef = await recreateCategories(
    guild,
    payload,
    roleIdByRef,
    log,
    onProgress
  );
  const chIdByRef = await recreateChannels(
    guild,
    payload,
    roleIdByRef,
    catIdByRef,
    log,
    onProgress
  );

  await applyGuildSettings(guild, payload, chIdByRef, log);

  if (payload.messages && Object.keys(payload.messages).length) {
    await replayMessages(guild, payload, chIdByRef, log, onProgress);
  }

  onProgress?.({ phase: "done", done: 1, total: 1 });
  log.info("Restore terminé.");
  return {
    status: "success",
    log: {
      entries: log.entries,
      counts: {
        roles: roleIdByRef.size,
        categories: catIdByRef.size,
        channels: chIdByRef.size,
      },
    },
  };
}

module.exports = {
  restoreGuild,
};
