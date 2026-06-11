const { EmbedBuilder } = require("discord.js");
const {
  insertGuildWarning,
  countGuildWarnings,
  getWarnConfig,
  getLogChannel,
  isLogEnabled,
} = require("../database");

/**
 * Enregistre un avertissement, notifie le membre et la modération, applique la sourdine si seuil atteint.
 *
 * @param {object} opts
 * @param {import('discord.js').Guild} opts.guild
 * @param {import('discord.js').User} opts.targetUser
 * @param {import('discord.js').User|null} opts.moderator - null = bot (antispam)
 * @param {string} opts.reason
 * @param {'manual'|'antispam'} [opts.source]
 * @param {import('discord.js').GuildMember|null} [opts.targetMember]
 */
async function issueWarning({
  guild,
  targetUser,
  moderator,
  reason,
  source = "manual",
  targetMember = null,
}) {
  const cfg = getWarnConfig(guild.id);
  const modTag = moderator?.tag || "Wingbot (antispam)";
  const modId = moderator?.id || guild.client?.user?.id || "0";

  const row = insertGuildWarning({
    guildId: guild.id,
    userId: targetUser.id,
    userTag: targetUser.tag,
    moderatorId: modId,
    moderatorTag: modTag,
    reason: String(reason || "Aucune raison").slice(0, 500),
    source,
  });

  const total = countGuildWarnings(guild.id, targetUser.id);

  let timeoutMin = 0;
  let sanctionLabel = null;
  if (cfg.auto_timeout_enabled && total >= cfg.warns_before_timeout) {
    if (total >= cfg.warns_before_timeout + 2) {
      timeoutMin = cfg.timeout_escalated_minutes;
      sanctionLabel = `sourdine ${timeoutMin} min (récidive)`;
    } else if (total >= cfg.warns_before_timeout) {
      timeoutMin = cfg.timeout_minutes;
      sanctionLabel = `sourdine ${timeoutMin} min`;
    }
  }

  const member =
    targetMember ||
    (await guild.members.fetch(targetUser.id).catch(() => null));

  if (cfg.dm_user) {
    let dm = `⚠️ **Avertissement** sur **${guild.name}**\n**Raison :** ${row.reason}\n**Total :** ${total}/${cfg.warns_before_timeout} avant sourdine auto.`;
    if (timeoutMin > 0) {
      dm += `\n\nTu as été mis en **sourdine ${timeoutMin} min** (messages + vocal).`;
    }
    await targetUser.send({ content: dm }).catch(() => null);
  }

  if (timeoutMin > 0 && member?.moderatable) {
    await member
      .timeout(
        timeoutMin * 60 * 1000,
        `Seuil d'avertissements (${total}/${cfg.warns_before_timeout})`
      )
      .catch(() => null);
  }

  await sendWarnLog(guild, {
    targetUser,
    moderator,
    reason: row.reason,
    source,
    total,
    threshold: cfg.warns_before_timeout,
    timeoutMin,
    warningId: row.id,
  });

  return {
    warning: row,
    total,
    timeoutMin,
    sanctionLabel,
  };
}

async function sendWarnLog(
  guild,
  { targetUser, moderator, reason, source, total, threshold, timeoutMin, warningId }
) {
  if (!isLogEnabled(guild.id, "mod_warn")) return;
  const channelId = getLogChannel(guild.id);
  if (!channelId) return;
  const ch = guild.channels.cache.get(channelId);
  if (!ch?.isTextBased?.()) return;

  const sourceLabel =
    source === "antispam" ? "Antispam automatique" : "Modération manuelle";

  const embed = new EmbedBuilder()
    .setColor(timeoutMin > 0 ? 0xef4444 : 0xeab308)
    .setTitle("⚠️ Avertissement")
    .setDescription(
      [
        `**Membre :** ${targetUser} (\`${targetUser.id}\`)`,
        moderator
          ? `**Modérateur :** ${moderator} (\`${moderator.id}\`)`
          : `**Source :** ${sourceLabel}`,
        `**Raison :** ${reason}`,
        `**Warn #${warningId}** · **Total actif :** ${total}/${threshold}`,
        timeoutMin > 0 ? `**Sanction auto :** sourdine ${timeoutMin} min` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setTimestamp();

  await ch.send({ embeds: [embed] }).catch(() => null);
}

module.exports = {
  issueWarning,
  sendWarnLog,
};
