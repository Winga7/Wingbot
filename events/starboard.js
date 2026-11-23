const { EmbedBuilder, Events } = require("discord.js");
const {
  getStarboardConfig,
  getStarboardPost,
  upsertStarboardPost,
  deleteStarboardPost,
} = require("../database");
const {
  emojiMatches,
  applyStarboardVars,
} = require("../lib/starboardConfig");

async function resolveReaction(reaction) {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return null;
    }
  }
  return reaction;
}

async function resolveMessage(message) {
  if (message.partial) {
    try {
      return await message.fetch();
    } catch {
      return null;
    }
  }
  return message;
}

function memberHasAnyRole(member, roleIds) {
  if (!roleIds?.length) return true;
  return roleIds.some((id) => member.roles.cache.has(id));
}

async function countValidStars(reaction, message, config) {
  const users = await reaction.users.fetch().catch(() => null);
  if (!users) return 0;
  let count = 0;
  for (const user of users.values()) {
    if (user.bot) continue;
    if (config.remove_self_stars && user.id === message.author?.id) continue;
    if (config.voter_role_ids.length) {
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member || !memberHasAnyRole(member, config.voter_role_ids)) continue;
    }
    count += 1;
  }
  return count;
}

function buildStarboardPayload(message, config, count) {
  const url = message.url;
  const content = applyStarboardVars(config.content, {
    emoji: config.emoji,
    count,
    url,
  }).slice(0, 2000);

  if (!config.use_embed) {
    return { content, allowedMentions: { parse: [] } };
  }

  const color = Number.parseInt(String(config.embed_color || "#fbbf24").slice(1), 16) || 0xfbbf24;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: message.author?.tag || "Message",
      iconURL: message.author?.displayAvatarURL?.({ extension: "png", size: 128 }),
    })
    .setDescription(message.content?.slice(0, 4000) || null)
    .addFields({ name: "Source", value: `[Aller au message](${url})` })
    .setFooter({ text: `${count} × ${config.emoji}` })
    .setTimestamp(message.createdAt || new Date());

  const image =
    message.attachments?.find((a) => a.contentType?.startsWith("image/")) ||
    message.attachments?.first?.();
  if (image?.url) embed.setImage(image.url);

  return { content, embeds: [embed], allowedMentions: { parse: [] } };
}

async function syncStarboard(client, reaction, user) {
  if (user?.bot) return;
  const rx = await resolveReaction(reaction);
  if (!rx) return;
  const message = await resolveMessage(rx.message);
  if (!message?.guild || message.system) return;

  const config = getStarboardConfig(message.guild.id);
  if (!config.enabled || !config.channel_id) return;
  if (!emojiMatches(config.emoji, rx)) return;
  if (config.ignore_bots && message.author?.bot) return;
  if (config.ignored_channel_ids.includes(message.channelId)) return;
  if (
    config.allowed_channel_ids.length &&
    !config.allowed_channel_ids.includes(message.channelId)
  ) {
    return;
  }
  if (message.channelId === config.channel_id) return;

  if (config.remove_self_stars && user?.id === message.author?.id) {
    await rx.users.remove(user.id).catch(() => null);
  }

  const count = await countValidStars(rx, message, config);
  const existing = getStarboardPost(message.guild.id, message.id);
  const board =
    message.guild.channels.cache.get(config.channel_id) ||
    (await message.guild.channels.fetch(config.channel_id).catch(() => null));
  if (!board?.isTextBased?.()) return;

  if (count < config.min_reactions) {
    if (existing?.starboard_message_id) {
      await board.messages.delete(existing.starboard_message_id).catch(() => null);
      deleteStarboardPost(message.guild.id, message.id);
    }
    return;
  }

  const payload = buildStarboardPayload(message, config, count);
  if (existing?.starboard_message_id) {
    const posted = await board.messages.fetch(existing.starboard_message_id).catch(() => null);
    if (posted) {
      await posted.edit(payload).catch(() => null);
      upsertStarboardPost({
        guild_id: message.guild.id,
        source_message_id: message.id,
        source_channel_id: message.channelId,
        starboard_message_id: posted.id,
        star_count: count,
      });
      return;
    }
  }

  const sent = await board.send(payload).catch(() => null);
  if (!sent) return;
  upsertStarboardPost({
    guild_id: message.guild.id,
    source_message_id: message.id,
    source_channel_id: message.channelId,
    starboard_message_id: sent.id,
    star_count: count,
  });
}

module.exports = function loadStarboard(client) {
  if (client.__wingbotStarboard) return;
  client.__wingbotStarboard = true;

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      await syncStarboard(client, reaction, user);
    } catch (error) {
      console.error("[starboard] add :", error?.message || error);
    }
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
      await syncStarboard(client, reaction, user);
    } catch (error) {
      console.error("[starboard] remove :", error?.message || error);
    }
  });
};
