const { Events } = require("discord.js");
const { getAutoActionsConfig } = require("../database");
const { reactionToApi } = require("../lib/autoresponseConfig");

module.exports = (client) => {
  if (client.__wingbotAutoActions) return;
  client.__wingbotAutoActions = true;

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      if (!member?.guild || member.user?.bot) return;
      const config = getAutoActionsConfig(member.guild.id);
      if (!config.enabled || !config.join_roles.enabled) return;
      const roleIds = config.join_roles.role_ids;
      if (!roleIds.length) return;

      const delay = config.join_roles.delay_seconds * 1000;
      const apply = async () => {
        const fresh =
          member.guild.members.cache.get(member.id) ||
          (await member.guild.members.fetch(member.id).catch(() => null));
        if (!fresh) return;
        const me = member.guild.members.me;
        const assignable = roleIds.filter((id) => {
          const role = member.guild.roles.cache.get(id);
          if (!role || role.managed) return false;
          if (!me) return true;
          return role.editable && me.roles.highest.comparePositionTo(role) > 0;
        });
        if (!assignable.length) return;
        await fresh.roles.add(assignable, "Wingbot · rôles auto à l'arrivée").catch((error) => {
          console.error("[autoActions join]", error.message || error);
        });
      };

      if (delay > 0) setTimeout(() => apply().catch(() => null), delay);
      else await apply();
    } catch (error) {
      console.error("[autoActions join]", error);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message.guild || message.system) return;
      if (!message.channel?.isTextBased?.()) return;

      const config = getAutoActionsConfig(message.guild.id);
      if (!config.enabled || !config.auto_reacts.length) return;

      const channelId = message.channelId;
      for (const rule of config.auto_reacts) {
        if (!rule.enabled) continue;
        if (rule.ignore_bots && message.author?.bot) continue;
        if (!rule.channel_ids.includes(channelId)) continue;
        for (const emoji of rule.emojis) {
          await message.react(reactionToApi(emoji)).catch(() => null);
        }
        break;
      }
    } catch (error) {
      console.error("[autoActions react]", error);
    }
  });
};
