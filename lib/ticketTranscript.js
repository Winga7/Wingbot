const { AttachmentBuilder } = require("discord.js");

async function fetchAllMessages(channel) {
  const all = [];
  let before;
  for (let i = 0; i < 20; i++) {
    const batch = await channel.messages
      .fetch({ limit: 100, ...(before ? { before } : {}) })
      .catch(() => null);
    if (!batch?.size) break;
    const arr = [...batch.values()];
    all.push(...arr);
    before = arr[arr.length - 1]?.id;
    if (batch.size < 100) break;
  }
  return all.reverse();
}

function formatMessageLine(msg) {
  const when = msg.createdAt
    ? msg.createdAt.toISOString().replace("T", " ").slice(0, 19)
    : "?";
  const author = msg.author?.tag || msg.member?.user?.tag || "Unknown";
  let body = msg.content || "";
  if (msg.embeds?.length) {
    for (const e of msg.embeds) {
      if (e.title) body += `\n[Embed] ${e.title}`;
      if (e.description) body += `\n${e.description}`;
    }
  }
  if (msg.attachments?.size) {
    body += `\n[Pièces jointes: ${[...msg.attachments.values()].map((a) => a.url).join(", ")}]`;
  }
  return `[${when}] ${author}: ${body || "(vide)"}`;
}

function buildTranscriptText({ guild, channel, ticket, messages }) {
  const lines = [
    `Transcript — Ticket #${ticket.ticket_number}`,
    `Serveur: ${guild.name} (${guild.id})`,
    `Salon: #${channel.name} (${channel.id})`,
    `Auteur: ${ticket.opener_tag || ticket.opener_user_id}`,
    `Catégorie: ${ticket.category_key}`,
    `Ouvert: ${ticket.opened_at || "?"}`,
    `Fermé: ${ticket.closed_at || new Date().toISOString()}`,
    "",
    "— Messages —",
    "",
  ];
  for (const msg of messages) {
    lines.push(formatMessageLine(msg));
  }
  return lines.join("\n");
}

async function sendTicketTranscript({
  guild,
  channel,
  ticket,
  targetChannelId,
  closedByTag,
}) {
  if (!targetChannelId || !channel?.isTextBased?.()) return false;
  const target =
    guild.channels.cache.get(targetChannelId) ||
    (await guild.channels.fetch(targetChannelId).catch(() => null));
  if (!target?.isTextBased?.()) return false;

  const messages = await fetchAllMessages(channel);
  const text = buildTranscriptText({ guild, channel, ticket, messages });
  const safeName = `ticket-${ticket.ticket_number}.txt`;
  const file = new AttachmentBuilder(Buffer.from(text, "utf8"), {
    name: safeName,
  });

  await target
    .send({
      content: `📄 Transcript ticket **#${ticket.ticket_number}** · ${ticket.opener_tag || ticket.opener_user_id}${closedByTag ? ` · fermé par ${closedByTag}` : ""}`,
      files: [file],
    })
    .catch(() => null);
  return true;
}

module.exports = {
  fetchAllMessages,
  buildTranscriptText,
  sendTicketTranscript,
};
