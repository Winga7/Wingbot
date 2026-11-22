const { Events } = require("discord.js");
const { getGuildPrefix, getLevelConfig, grantMemberXp } = require("../database");
const {
  progressFromXp,
  applyLevelVariables,
} = require("../lib/levelConfig");
const { syncLevelRoles } = require("../lib/levelRoles");

module.exports = (client) => {
  if (client.__wingbotLevels) return;
  client.__wingbotLevels = true;

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message.guild || message.author?.bot || message.system) return;
      const config = getLevelConfig(message.guild.id);
      if (!config.enabled) return;

      const channelId = message.channelId;
      const parentId = message.channel?.parentId;
      if (
        config.ignored_channel_ids.includes(channelId) ||
        (parentId && config.ignored_channel_ids.includes(parentId))
      ) {
        return;
      }

      const member = message.member;
      if (!member) return;
      if (member.roles.cache.some((role) => config.ignored_role_ids.includes(role.id))) {
        return;
      }

      const prefix = getGuildPrefix(message.guild.id);
      const content = String(message.content || "").trim();
      if (!content || content.length < config.min_length) return;
      if (prefix && content.startsWith(prefix)) return;

      const gain =
        config.xp_min +
        Math.floor(Math.random() * (config.xp_max - config.xp_min + 1));
      const result = grantMemberXp(
        message.guild.id,
        message.author.id,
        gain,
        Date.now(),
        config.cooldown_seconds * 1000
      );
      if (!result.ok) return;

      const before = progressFromXp(result.before);
      const after = progressFromXp(result.after);
      if (after.level <= before.level) return;

      await syncLevelRoles(member, after.level, config);
      if (!config.announce) return;

      const text = applyLevelVariables(config.announce_text, {
        user: `<@${message.author.id}>`,
        username: message.author.username,
        level: String(after.level),
        xp: String(after.total),
        server: message.guild.name,
      }).trim();
      if (!text) return;

      let channel = message.channel;
      if (config.announce_channel_id) {
        channel =
          message.guild.channels.cache.get(config.announce_channel_id) ||
          (await message.guild.channels.fetch(config.announce_channel_id).catch(() => null)) ||
          message.channel;
      }
      if (!channel?.isTextBased?.()) return;
      await channel
        .send({
          content: text.slice(0, 300),
          allowedMentions: { parse: ["users"] },
        })
        .catch((error) => {
          console.error("[levels] annonce :", error?.message || error);
        });
    } catch (error) {
      console.error("[levels] message :", error?.message || error);
    }
  });
};
