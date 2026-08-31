const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const {
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const DB_PATH = process.env.WINGBOT_DB_PATH
  ? path.resolve(process.env.WINGBOT_DB_PATH)
  : path.join(__dirname, "..", "data", "wingbot.db");
const TRANSCRIPTS_DIR = path.join(path.dirname(DB_PATH), "transcripts");

function ensureTranscriptsDir(guildId) {
  const dir = path.join(TRANSCRIPTS_DIR, String(guildId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDiscordTime(d) {
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

function avatarUrl(user) {
  if (!user) return "";
  return user.displayAvatarURL({ size: 64, extension: "png" }) || "";
}

function buildTranscriptHtml({
  guild,
  channel,
  ticket,
  panel,
  category,
  messages,
  closedByTag,
}) {
  const panelLabel = panel?.label || `Panneau #${ticket.panel_id}`;
  const catLabel = category?.label || ticket.category_key;
  const opener = ticket.opener_tag || ticket.opener_user_id;

  const participants = new Map();
  for (const msg of messages) {
    const u = msg.author;
    if (!u || u.bot) continue;
    const key = u.id;
    if (!participants.has(key)) {
      participants.set(key, { tag: u.tag, count: 0, color: u.hexAccentColor || "#5865f2" });
    }
    participants.get(key).count += 1;
  }

  const msgHtml = messages
    .map((msg) => {
      const author = msg.author;
      const when = formatDiscordTime(msg.createdAt);
      const av = avatarUrl(author);
      let body = escapeHtml(msg.content || "");
      body = body.replace(/\n/g, "<br/>");
      if (!body && !msg.embeds?.length && !msg.attachments?.size) {
        body = '<span class="empty">(message vide)</span>';
      }
      let embeds = "";
      for (const e of msg.embeds || []) {
        embeds += `<div class="embed"><strong>${escapeHtml(e.title || "")}</strong><p>${escapeHtml(e.description || "")}</p></div>`;
      }
      let attachments = "";
      for (const a of msg.attachments?.values?.() || []) {
        attachments += `<a class="attach" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.name || "fichier")}</a> `;
      }
      return `
        <article class="msg">
          <img class="avatar" src="${escapeHtml(av)}" alt="" loading="lazy" />
          <div class="body">
            <header><strong style="color:${escapeHtml(author?.hexAccentColor || "#fff")}">${escapeHtml(author?.username || "?")}</strong> <time>${escapeHtml(when)}</time></header>
            <div class="content">${body}${embeds}${attachments}</div>
          </div>
        </article>`;
    })
    .join("\n");

  const usersList = [...participants.values()]
    .map((p) => `<li>${escapeHtml(p.tag)} — ${p.count} message(s)</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Transcript #${ticket.ticket_number} — ${escapeHtml(channel.name)}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#313338;color:#dbdee1;line-height:1.45}
    .wrap{max-width:920px;margin:0 auto;padding:1.25rem 1rem 3rem}
    .hero{background:#2b2d31;border:1px solid #1e1f22;border-radius:12px;padding:1rem 1.15rem;margin-bottom:1rem}
    .hero h1{margin:0 0 .35rem;font-size:1.15rem;color:#f2f3f5}
    .hero p{margin:.15rem 0;color:#b5bac1;font-size:.88rem}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.65rem;margin:.85rem 0 0}
    .meta div{background:#1e1f22;border-radius:8px;padding:.55rem .65rem}
    .meta span{display:block;font-size:.72rem;color:#949ba4;text-transform:uppercase;letter-spacing:.04em}
    .meta strong{font-size:.88rem;color:#f2f3f5}
    .chat{background:#2b2d31;border:1px solid #1e1f22;border-radius:12px;padding:.75rem .65rem}
    .msg{display:flex;gap:.65rem;padding:.55rem .45rem;border-radius:8px}
    .msg:hover{background:#35373c}
    .avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0}
    .body{min-width:0;flex:1}
    header time{color:#949ba4;font-size:.75rem;margin-left:.35rem;font-weight:400}
    .content{font-size:.92rem;word-break:break-word}
    .empty{color:#949ba4;font-style:italic}
    .embed{margin-top:.45rem;padding:.55rem .65rem;border-left:4px solid #5865f2;background:#1e1f22;border-radius:6px}
    .embed p{margin:.25rem 0 0;color:#b5bac1;font-size:.85rem}
    .attach{display:inline-block;margin-top:.35rem;color:#00a8fc;font-size:.82rem}
    ul.participants{margin:.5rem 0 0;padding-left:1.1rem;color:#b5bac1;font-size:.85rem}
    footer{margin-top:1rem;text-align:center;color:#949ba4;font-size:.75rem}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Ticket #${ticket.ticket_number} · ${escapeHtml(catLabel)}</h1>
      <p>${escapeHtml(guild.name)} · #${escapeHtml(channel.name)}</p>
      <div class="meta">
        <div><span>Auteur</span><strong>${escapeHtml(opener)}</strong></div>
        <div><span>Panneau</span><strong>${escapeHtml(panelLabel)}</strong></div>
        <div><span>Ouvert</span><strong>${escapeHtml(formatDiscordTime(new Date(ticket.opened_at)))}</strong></div>
        <div><span>Fermé</span><strong>${escapeHtml(formatDiscordTime(new Date(ticket.closed_at || Date.now())))}${closedByTag ? ` · ${escapeHtml(closedByTag)}` : ""}</strong></div>
        <div><span>Messages</span><strong>${messages.length}</strong></div>
      </div>
      ${usersList ? `<ul class="participants">${usersList}</ul>` : ""}
    </section>
    <section class="chat">${msgHtml || "<p class='empty' style='padding:1rem'>Aucun message.</p>"}</section>
    <footer>Transcript Wingbot · ${escapeHtml(formatDiscordTime(new Date()))}</footer>
  </div>
</body>
</html>`;
}

function saveTranscriptFile(guildId, ticketId, token, html) {
  const dir = ensureTranscriptsDir(guildId);
  const filePath = path.join(dir, `${ticketId}-${token}.html`);
  fs.writeFileSync(filePath, html, "utf8");
  return filePath;
}

function getTranscriptPublicUrl(publicBaseUrl, guildId, ticketId, token) {
  const base = String(publicBaseUrl || "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/transcripts/${encodeURIComponent(guildId)}/${encodeURIComponent(ticketId)}/${encodeURIComponent(token)}.html`;
}

function buildTranscriptLogEmbed({ guild, channel, ticket, panel, category, messages, closedByTag }) {
  const catLabel = category?.label || ticket.category_key;
  const panelLabel = panel?.label || `Panneau #${ticket.panel_id}`;
  const opener = ticket.opener_tag || ticket.opener_user_id;

  const users = new Map();
  for (const msg of messages) {
    const u = msg.author;
    if (!u) continue;
    users.set(u.id, u.username || u.tag);
  }
  const usersField = [...users.values()].slice(0, 12).join(", ") || opener;

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setAuthor({ name: opener })
    .addFields(
      { name: "Ticket Owner", value: `<@${ticket.opener_user_id}>`, inline: true },
      { name: "Ticket Name", value: `#${channel.name}`, inline: true },
      { name: "Panel Name", value: panelLabel, inline: true },
      { name: "Catégorie", value: catLabel, inline: true },
      { name: "Ticket #", value: String(ticket.ticket_number), inline: true },
      { name: "Users in transcript", value: usersField.slice(0, 1024), inline: false }
    )
    .setFooter({ text: closedByTag ? `Fermé par ${closedByTag}` : "Ticket fermé" })
    .setTimestamp();
}

async function sendTicketTranscript({
  guild,
  channel,
  ticket,
  panel,
  category,
  targetChannelId,
  closedByTag,
  publicBaseUrl,
  updateTicket,
}) {
  if (!targetChannelId || !channel?.isTextBased?.()) return null;
  const target =
    guild.channels.cache.get(targetChannelId) ||
    (await guild.channels.fetch(targetChannelId).catch(() => null));
  if (!target?.isTextBased?.()) return null;

  const messages = await fetchAllMessages(channel);
  const token = crypto.randomBytes(16).toString("hex");
  const html = buildTranscriptHtml({
    guild,
    channel,
    ticket,
    panel,
    category,
    messages,
    closedByTag,
  });
  saveTranscriptFile(guild.id, ticket.id, token, html);

  if (updateTicket) {
    updateTicket(ticket.id, guild.id, { transcript_token: token });
  }

  const safeChannel = String(channel.name || "ticket").replace(/[^\w-]/g, "-").slice(0, 40);
  const fileName = `transcript-${safeChannel}.html`;
  const file = new AttachmentBuilder(Buffer.from(html, "utf8"), { name: fileName });

  const publicUrl = getTranscriptPublicUrl(publicBaseUrl, guild.id, ticket.id, token);
  const components = [];
  if (publicUrl) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Direct Link")
          .setStyle(ButtonStyle.Link)
          .setURL(publicUrl),
        new ButtonBuilder()
          .setLabel(fileName.slice(0, 80))
          .setStyle(ButtonStyle.Link)
          .setURL(publicUrl)
      )
    );
  }

  const embed = buildTranscriptLogEmbed({
    guild,
    channel,
    ticket,
    panel,
    category,
    messages,
    closedByTag,
  });

  const infoBlock =
    "```\n" +
    `<Server-Info>\n` +
    `Server: ${guild.name} (${guild.id})\n` +
    `Channel: #${channel.name} (${channel.id})\n` +
    `Messages: ${messages.length}\n` +
    `Ticket: #${ticket.ticket_number}\n` +
    `\`\`\``;

  await target
    .send({
      content: infoBlock,
      embeds: [embed],
      files: [file],
      components,
    })
    .catch(() => null);

  return { token, publicUrl };
}

function readTranscriptFile(guildId, ticketId, token) {
  const filePath = path.join(
    TRANSCRIPTS_DIR,
    String(guildId),
    `${ticketId}-${token}.html`
  );
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

module.exports = {
  TRANSCRIPTS_DIR,
  fetchAllMessages,
  buildTranscriptHtml,
  saveTranscriptFile,
  getTranscriptPublicUrl,
  sendTicketTranscript,
  readTranscriptFile,
};
