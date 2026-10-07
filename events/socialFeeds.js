const { EmbedBuilder } = require("discord.js");
const {
  listEnabledSocialFeeds,
  updateSocialFeed,
} = require("../database");
const { fetchLatestYoutubeVideo } = require("../lib/youtubeFeed");
const {
  getTwitchStream,
  fetchTwitchClipsSince,
  formatStreamPayload,
  formatClipPayload,
  resolveTwitchUser,
} = require("../lib/twitchApi");
const {
  defaultEmbedPayload,
  mergeEmbedPayload,
  payloadToDiscordMessageBody,
  substituteEmbedPayload,
} = require("../dashboard/embedPayload");

function buildSubstituteContext(row, guild, channel, eventData) {
  const ctx = {
    guild: {
      id: guild.id,
      name: guild.name,
      member_count: guild.memberCount,
    },
    channel: {
      id: channel.id,
      name: channel.name,
    },
  };
  if (row.platform === "youtube") {
    ctx.youtube = {
      title: eventData.title || "",
      url: eventData.url || "",
      id: eventData.id || "",
      thumbnail: eventData.thumbnail || "",
      channel_name: eventData.channel_name || row.source_label || "",
      channel_url: row.source_url || "",
      published_at: eventData.published_at || "",
    };
  } else if (row.event_kind === "live") {
    ctx.twitch = eventData;
  } else if (row.event_kind === "clip") {
    ctx.twitch = {
      display_name: eventData.display_name || row.source_label || "",
      login: eventData.login || "",
      url: row.source_url || "",
      clip: {
        title: eventData.title || "",
        url: eventData.url || "",
        id: eventData.id || "",
        thumbnail: eventData.thumbnail || "",
        creator: eventData.creator || "",
        view_count: eventData.view_count ?? 0,
      },
    };
  }
  return ctx;
}

function buildSocialMessageBody(row, guild, channel, eventData) {
  const base = defaultEmbedPayload();
  const merged = mergeEmbedPayload(base, {
    content: row.payload?.content || "",
    embed: row.payload?.embed || {},
  });
  const substituted = substituteEmbedPayload(
    merged,
    buildSubstituteContext(row, guild, channel, eventData)
  );
  return payloadToDiscordMessageBody(substituted);
}

async function deliverSocialAlert(client, row, eventData) {
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
  const body = buildSocialMessageBody(row, guild, channel, eventData);
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

async function checkTwitchLiveFeed(client, row) {
  const now = new Date().toISOString();
  try {
    const user = await resolveTwitchUser(row.source_url || row.source_id);
    const stream = await getTwitchStream(user.id);
    const online = !!stream;
    const state = online ? "online" : "offline";

    if (row.last_state == null) {
      updateSocialFeed(row.id, row.guild_id, {
        last_state: state,
        last_checked_at: now,
        last_error: null,
      });
      return;
    }

    if (online && row.last_state !== "online") {
      const payload = formatStreamPayload(stream, user);
      const ok = await deliverSocialAlert(client, row, payload);
      if (ok) {
        console.log(
          `[social] Twitch live #${row.id} → ${user.login} en live (${row.guild_id})`
        );
      }
    }

    updateSocialFeed(row.id, row.guild_id, {
      last_state: state,
      last_checked_at: now,
      last_error: null,
    });
  } catch (e) {
    updateSocialFeed(row.id, row.guild_id, {
      last_checked_at: now,
      last_error: String(e?.message || e).slice(0, 500),
    });
    console.error(`[social] échec Twitch live #${row.id}:`, e?.message || e);
  }
}

function parseFeedTime(value) {
  if (!value) return NaN;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return Date.parse(`${s.replace(" ", "T")}Z`);
  }
  return Date.parse(s);
}

async function checkTwitchClipFeed(client, row) {
  const now = new Date();
  const nowIso = now.toISOString();
  try {
    const user = await resolveTwitchUser(row.source_url || row.source_id);
    const feedCreated = parseFeedTime(row.created_at);
    const publishAfter = (Number.isFinite(feedCreated) ? feedCreated : now.getTime()) - 30 * 60_000;
    const watermark = parseFeedTime(row.last_state);
    const sinceMs = Number.isFinite(watermark)
      ? Math.max(watermark - 15 * 60_000, now.getTime() - 6 * 60 * 60_000, publishAfter)
      : Math.max(publishAfter, now.getTime() - 6 * 60 * 60_000);
    const rawClips = await fetchTwitchClipsSince(
      user.id,
      new Date(sinceMs).toISOString(),
      nowIso
    );

    const fresh = rawClips.filter((clip) => {
      const created = Date.parse(clip.created_at);
      if (!Number.isFinite(created) || created < publishAfter) return false;
      if (Number.isFinite(watermark) && created <= watermark) return false;
      return true;
    });

    let postedUntil = Number.isFinite(watermark) ? watermark : null;
    let lastPostedId = row.last_video_id;
    let failReason = null;
    for (const clip of fresh) {
      const payload = formatClipPayload(clip, user);
      const ok = await deliverSocialAlert(client, row, payload);
      if (!ok) {
        failReason = "Impossible d'envoyer le clip dans le salon Discord";
        break;
      }
      postedUntil = Date.parse(clip.created_at);
      lastPostedId = clip.id;
      console.log(
        `[social] Twitch clip #${row.id} → ${clip.id} (${row.guild_id})`
      );
      await new Promise((r) => setTimeout(r, 600));
    }

    updateSocialFeed(row.id, row.guild_id, {
      last_video_id: lastPostedId,
      last_state: postedUntil != null ? new Date(postedUntil).toISOString() : row.last_state,
      last_checked_at: nowIso,
      last_error: failReason,
    });
  } catch (e) {
    updateSocialFeed(row.id, row.guild_id, {
      last_checked_at: nowIso,
      last_error: String(e?.message || e).slice(0, 500),
    });
    console.error(`[social] échec Twitch clip #${row.id}:`, e?.message || e);
  }
}

async function checkSocialFeed(client, row) {
  if (row.platform === "youtube") return checkYoutubeFeed(client, row);
  if (row.platform === "twitch" && row.event_kind === "live") {
    return checkTwitchLiveFeed(client, row);
  }
  if (row.platform === "twitch" && row.event_kind === "clip") {
    return checkTwitchClipFeed(client, row);
  }
}

module.exports = function loadSocialFeeds(client) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const feeds = listEnabledSocialFeeds();
      for (const row of feeds) {
        await checkSocialFeed(client, row);
        await new Promise((r) => setTimeout(r, 800));
      }
    } finally {
      running = false;
    }
  }

  setInterval(tick, 3 * 60_000);
  setTimeout(tick, 25_000);
};
