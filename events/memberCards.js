const { Events, AuditLogEvent, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const { getMemberCards } = require("../database");
const { applyCardVariables } = require("../lib/memberCardConfig");
const { renderMemberCardPng, fetchImageBuffer } = require("../lib/memberCardImage");

module.exports = (client) => {
  if (client.__wingbotMemberCards) return;
  client.__wingbotMemberCards = true;

  const recent = new Map();

  function shouldSend(key) {
    const now = Date.now();
    const prev = recent.get(key);
    if (prev != null && now - prev < 5000) return false;
    recent.set(key, now);
    if (recent.size > 400) {
      const cutoff = now - 20000;
      for (const [k, t] of recent) {
        if (t < cutoff) recent.delete(k);
      }
    }
    return true;
  }

  async function recentAudit(guild, type, targetId) {
    try {
      const logs = await guild.fetchAuditLogs({ type, limit: 6 });
      const now = Date.now();
      for (const entry of logs.entries.values()) {
        if (now - entry.createdTimestamp > 8000) continue;
        const target = entry.targetId || entry.target?.id;
        if (targetId && target !== targetId) continue;
        return entry;
      }
    } catch (error) {
      console.error(
        "[member-cards] journaux d'audit indisponibles :",
        error?.message || error
      );
    }
    return null;
  }

  async function classifyRemoval(guild, userId) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const ban = await recentAudit(guild, AuditLogEvent.MemberBanAdd, userId);
    if (ban) return { type: "ban", executor: ban.executor || null };
    const kick = await recentAudit(guild, AuditLogEvent.MemberKick, userId);
    if (kick) return { type: "kick", executor: kick.executor || null };
    return { type: "leave", executor: null };
  }

  function imageVars(member, executor) {
    const username = member.user?.username || "Membre";
    const displayName = member.displayName || username;
    const moderatorName = executor?.username || "Modérateur";
    return {
      username,
      displayName,
      tag: member.user?.tag || username,
      server: member.guild?.name || "Serveur",
      memberCount: String(member.guild?.memberCount ?? ""),
      id: member.id || member.user?.id || "",
      moderatorName,
      moderator: moderatorName,
      user: username,
    };
  }

  function contentVars(member, executor, base) {
    const id = member.id || member.user?.id;
    return {
      ...base,
      user: id ? `<@${id}>` : base.username,
      moderator: executor?.id ? `<@${executor.id}>` : base.moderatorName,
      moderatorMention: executor?.id ? `<@${executor.id}>` : base.moderatorName,
    };
  }

  async function sendCard(member, kind, executor) {
    const guild = member.guild;
    if (!guild) return;
    const userId = member.id || member.user?.id;
    if (!userId) return;
    if (!shouldSend(`${guild.id}:${kind}:${userId}`)) return;

    const card = getMemberCards(guild.id)[kind];
    if (!card?.enabled || !card.channel_id) return;

    const channel =
      guild.channels.cache.get(card.channel_id) ||
      (await guild.channels.fetch(card.channel_id).catch(() => null));
    if (!channel?.isTextBased?.()) return;

    const drawn = imageVars(member, executor);
    const spoken = contentVars(member, executor, drawn);
    const content = applyCardVariables(card.content, spoken).trim().slice(0, 1800);
    const avatarUrl = member.displayAvatarURL?.({
      extension: "png",
      size: 256,
      forceStatic: true,
    }) || member.user?.displayAvatarURL?.({
      extension: "png",
      size: 256,
      forceStatic: true,
    });

    let png = null;
    if (card.show_avatar || card.title || card.name_text || card.message) {
      try {
        const avatarBuffer = card.show_avatar
          ? await fetchImageBuffer(avatarUrl)
          : null;
        png = await renderMemberCardPng({
          card,
          vars: drawn,
          avatarBuffer,
        });
      } catch (error) {
        console.error("[member-cards] rendu image :", error?.message || error);
      }
    }

    try {
      if (png) {
        await channel.send({
          content: content || undefined,
          files: [new AttachmentBuilder(png, { name: "carte.png" })],
        });
        return;
      }

      const title = applyCardVariables(card.title, drawn).trim() || " ";
      const nameLine = applyCardVariables(card.name_text, drawn).trim();
      const message = applyCardVariables(card.message, drawn).trim();
      const description = [nameLine, message].filter(Boolean).join("\n").slice(0, 4096);
      const color = Number.parseInt(String(card.title_color || "#39FF14").slice(1), 16);
      const embed = new EmbedBuilder()
        .setColor(Number.isFinite(color) ? color : 0x39ff14)
        .setTitle(title.slice(0, 256))
        .setDescription(description || " ");
      if (avatarUrl) embed.setThumbnail(avatarUrl);
      await channel.send({
        content: content || undefined,
        embeds: [embed],
      });
    } catch (error) {
      console.error("[member-cards] envoi :", error?.message || error);
    }
  }

  client.on(Events.GuildMemberAdd, async (member) => {
    if (!member?.guild || member.user?.bot) return;
    try {
      await sendCard(member, "join", null);
    } catch (error) {
      console.error("[member-cards] arrivée :", error?.message || error);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    if (!member?.guild || member.user?.bot) return;
    try {
      const cards = getMemberCards(member.guild.id);
      if (!cards.leave.enabled && !cards.kick.enabled) return;
      const removal = await classifyRemoval(member.guild, member.id);
      if (removal.type === "ban") return;
      if (removal.type === "kick") {
        await sendCard(member, "kick", removal.executor);
        return;
      }
      await sendCard(member, "leave", null);
    } catch (error) {
      console.error("[member-cards] départ :", error?.message || error);
    }
  });
};
