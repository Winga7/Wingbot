const { EmbedBuilder } = require("discord.js");
const {
  listDueScheduledMessages,
  advanceScheduledMessageAfterSend,
} = require("../database");
const {
  defaultEmbedPayload,
  mergeEmbedPayload,
  payloadToDiscordMessageBody,
  substituteEmbedPayload,
} = require("../dashboard/embedPayload");

function buildMessageBody(row, guild, channel) {
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
  });
  return payloadToDiscordMessageBody(substituted);
}

async function deliverScheduledMessage(client, row) {
  const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
  if (!guild) {
    console.warn(`[sched] serveur ${row.guild_id} introuvable (#${row.id})`);
    return false;
  }
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn(`[sched] salon ${row.channel_id} invalide (#${row.id})`);
    return false;
  }
  const body = buildMessageBody(row, guild, channel);
  const embeds = (body.embeds || []).map((e) => new EmbedBuilder(e));
  await channel.send({
    content: body.content || undefined,
    embeds: embeds.length ? embeds : undefined,
    allowedMentions: body.allowed_mentions,
  });
  return true;
}

module.exports = function loadScheduledMessages(client) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = new Date().toISOString();
      const due = listDueScheduledMessages(now);
      for (const row of due) {
        try {
          const ok = await deliverScheduledMessage(client, row);
          if (ok) {
            advanceScheduledMessageAfterSend(row.id, row.guild_id, now);
          }
        } catch (e) {
          console.error(`[sched] échec #${row.id}:`, e?.message || e);
        }
      }
    } finally {
      running = false;
    }
  }

  setInterval(tick, 30_000);
  setTimeout(tick, 12_000);
};
