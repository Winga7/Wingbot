const { Events } = require("discord.js");
const { getAutoresponseConfig, getGuildPrefix } = require("../database");
const {
  applyAutoresponseVars,
  messageMatchesTrigger,
  reactionToApi,
} = require("../lib/autoresponseConfig");

/** @type {Map<string, number>} */
const cooldowns = new Map();

function coolKey(guildId, ruleId, userId) {
  return `${guildId}:${ruleId}:${userId}`;
}

module.exports = (client) => {
  if (client.__wingbotAutoresponses) return;
  client.__wingbotAutoresponses = true;

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message.guild || message.system) return;
      if (!message.channel?.isTextBased?.()) return;

      const config = getAutoresponseConfig(message.guild.id);
      if (!config.enabled || !config.responses.length) return;

      const content = String(message.content || "");
      if (!content.trim()) return;

      const prefix = getGuildPrefix(message.guild.id);
      if (prefix && content.trim().startsWith(prefix)) return;

      const channelId = message.channelId;
      const member = message.member;

      for (const rule of config.responses) {
        if (!rule.enabled) continue;
        if (rule.ignore_bots && message.author?.bot) continue;
        if (rule.ignored_channel_ids.includes(channelId)) continue;
        if (rule.channel_ids.length && !rule.channel_ids.includes(channelId)) continue;
        if (
          rule.required_role_ids.length &&
          (!member ||
            !rule.required_role_ids.some((id) => member.roles.cache.has(id)))
        ) {
          continue;
        }
        if (!messageMatchesTrigger(content, rule)) continue;

        const key = coolKey(message.guild.id, rule.id, message.author.id);
        const now = Date.now();
        const until = cooldowns.get(key) || 0;
        if (until > now) continue;
        if (rule.cooldown_seconds > 0) {
          cooldowns.set(key, now + rule.cooldown_seconds * 1000);
        }

        const vars = {
          user: `<@${message.author.id}>`,
          username: message.author.username,
          userId: message.author.id,
          channel: `<#${channelId}>`,
          channelName: message.channel.name || "",
          server: message.guild.name,
          trigger: rule.trigger,
        };

        if (rule.reactions.length) {
          for (const emoji of rule.reactions) {
            await message.react(reactionToApi(emoji)).catch(() => null);
          }
        }

        const text = applyAutoresponseVars(rule.response, vars).trim();
        if (text) {
          const payload = {
            content: text.slice(0, 1500),
            allowedMentions: { parse: ["users"] },
          };
          if (rule.reply) {
            await message.reply(payload).catch(() => null);
          } else {
            await message.channel.send(payload).catch(() => null);
          }
        }

        if (rule.delete_trigger) {
          await message.delete().catch(() => null);
        }

        break;
      }
    } catch (error) {
      console.error("[autoresponses]", error);
    }
  });
};
