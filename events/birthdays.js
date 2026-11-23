const {
  getBirthdayConfig,
  listGuildsWithBirthdayEnabled,
  listBirthdaysForDay,
  markBirthdayAnnounced,
} = require("../database");
const { localParts, applyBirthdayVars } = require("../lib/birthdayConfig");

function memberAllowed(member, config) {
  if (!member) return false;
  if (config.blocked_role_ids.some((id) => member.roles.cache.has(id))) return false;
  if (config.allowed_role_ids.length) {
    return config.allowed_role_ids.some((id) => member.roles.cache.has(id));
  }
  return true;
}

async function processGuild(client, guildId, config, nowMs) {
  const local = localParts(nowMs, config.timezone_offset_minutes);
  if (local.hour !== config.hour) return;
  if (!config.channel_id) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  const channel =
    guild.channels.cache.get(config.channel_id) ||
    (await guild.channels.fetch(config.channel_id).catch(() => null));
  if (!channel?.isTextBased?.()) return;

  const rows = listBirthdaysForDay(guildId, local.month, local.day);
  const winners = [];
  for (const row of rows) {
    if (row.last_announced_year === local.year) continue;
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (!member || member.user.bot) continue;
    if (!memberAllowed(member, config)) continue;
    winners.push(member);
  }
  if (!winners.length) return;

  if (config.temp_role_id) {
    for (const member of winners) {
      await member.roles.add(config.temp_role_id).catch(() => null);
    }
  }

  const mentions = winners.map((m) => `<@${m.id}>`).join(", ");
  const roleMention = config.temp_role_id ? `<@&${config.temp_role_id}>` : "";
  let content = applyBirthdayVars(config.message, {
    users: mentions,
    role: roleMention,
    gifts: roleMention,
  }).trim();
  if (config.mention_role_id) {
    content = `<@&${config.mention_role_id}> ${content}`.trim();
  }

  await channel
    .send({
      content: content.slice(0, 2000),
      allowedMentions: {
        users: winners.map((m) => m.id),
        roles: [config.mention_role_id, config.temp_role_id].filter(Boolean),
      },
    })
    .catch((error) => console.error("[birthdays] send :", error?.message || error));

  for (const member of winners) {
    markBirthdayAnnounced(guildId, member.id, local.year);
  }
}

async function clearYesterdayTempRoles(client, nowMs) {
  const guilds = listGuildsWithBirthdayEnabled();
  for (const entry of guilds) {
    if (!entry.config.temp_role_id) continue;
    const local = localParts(nowMs, entry.config.timezone_offset_minutes);
    // à l'heure configurée, on retire le rôle aux gens qui n'ont PAS anniversaire aujourd'hui
    if (local.hour !== entry.config.hour) continue;
    const guild = await client.guilds.fetch(entry.guild_id).catch(() => null);
    if (!guild) continue;
    const role =
      guild.roles.cache.get(entry.config.temp_role_id) ||
      (await guild.roles.fetch(entry.config.temp_role_id).catch(() => null));
    if (!role) continue;
    const today = new Set(
      listBirthdaysForDay(entry.guild_id, local.month, local.day).map((r) => r.user_id)
    );
    for (const [, member] of role.members) {
      if (today.has(member.id)) continue;
      await member.roles.remove(role.id).catch(() => null);
    }
  }
}

module.exports = function loadBirthdays(client) {
  if (client.__wingbotBirthdays) return;
  client.__wingbotBirthdays = true;

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      await clearYesterdayTempRoles(client, now);
      const guilds = listGuildsWithBirthdayEnabled();
      for (const entry of guilds) {
        try {
          await processGuild(client, entry.guild_id, entry.config, now);
        } catch (error) {
          console.error(`[birthdays] guild ${entry.guild_id} :`, error?.message || error);
        }
      }
    } finally {
      running = false;
    }
  }

  setInterval(tick, 60 * 1000);
  setTimeout(tick, 20_000);
};
