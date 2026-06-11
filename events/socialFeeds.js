const { EmbedBuilder } = require("discord.js");
const {
  listEnabledSocialFeeds,
  updateSocialFeed,
} = require("../database");
const { fetchLatestYoutubeVideo } = require("../lib/youtubeFeed");
const {
  defaultEmbedPayload,
  mergeEmbedPayload,
  payloadToDiscordMessageBody,
  substituteEmbedPayload,
} = require("../dashboard/embedPayload");

function buildSocialMessageBody(row, guild, channel, video) {
  const base = defaultEmbedPayload();
  const merged = mergeEmbedPayload(base, {
    content: row.payload?.content || "",
    embed: row.payload?.embed || {},
  });
  const substituted = substituteEmbedPayload(merged, {
    guild: {
      id: guild.id,
      name: guild.name,
      member_count: guild.memberCount,
    },
    channel: {
      id: channel.id,
      name: channel.name,
    },
    youtube: {
      title: video.title || "",
      url: video.url || "",
      id: video.id || "",
      thumbnail: video.thumbnail || "",
      channel_name: video.channel_name || row.source_label || "",
      channel_url: row.source_url || "",
      published_at: video.published_at || "",
    },
  });
  return payloadToDiscordMessageBody(substituted);
}

async function deliverSocialAlert(client, row, video) {
  const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
  if (!guild) {
    console.warn(`[social] serveur ${row.guild_id} introuvable (#${row.id})`);
    return false;
  }
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn(`[social] salon ${row.channel_id} invalide (#${row.id})`);
    return false;
  }
  const body = buildSocialMessageBody(row, guild, channel, video);
  const embeds = (body.embeds || []).map((e) => new EmbedBuilder(e));
  await channel.send({
    content: body.content || undefined,
    embeds: embeds.length ? embeds : undefined,
    allowedMentions: body.allowed_mentions,
  });
  return true;
}

async function checkYoutubeFeed(client, row) {
  const now = new Date().toISOString();
  try {
    const latest = await fetchLatestYoutubeVideo(row.source_id);
    if (!latest?.id) {
      updateSocialFeed(row.id, row.guild_id, {
        last_checked_at: now,
        last_error: "Flux RSS vide",
      });
      return;
    }
    if (!row.last_video_id) {
      updateSocialFeed(row.id, row.guild_id, {
        last_video_id: latest.id,
        last_checked_at: now,
        last_error: null,
      });
      return;
    }
    if (latest.id === row.last_video_id) {
      updateSocialFeed(row.id, row.guild_id, {
        last_checked_at: now,
        last_error: null,
      });
      return;
    }
    const ok = await deliverSocialAlert(client, row, latest);
    if (ok) {
      updateSocialFeed(row.id, row.guild_id, {
        last_video_id: latest.id,
        last_checked_at: now,
        last_error: null,
      });
      console.log(
        `[social] YouTube #${row.id} → nouvelle vidéo ${latest.id} (${row.guild_id})`
      );
    }
  } catch (e) {
    updateSocialFeed(row.id, row.guild_id, {
      last_checked_at: now,
      last_error: String(e?.message || e).slice(0, 500),
    });
    console.error(`[social] échec feed #${row.id}:`, e?.message || e);
  }
}

module.exports = function loadSocialFeeds(client) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const feeds = listEnabledSocialFeeds("youtube");
      for (const row of feeds) {
        await checkYoutubeFeed(client, row);
        await new Promise((r) => setTimeout(r, 800));
      }
    } finally {
      running = false;
    }
  }

  setInterval(tick, 5 * 60_000);
  setTimeout(tick, 25_000);
};
