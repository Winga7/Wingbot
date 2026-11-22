const { Events } = require("discord.js");
const { getStatsConfig, addGuildActivity, addChannelMessages } = require("../database");

const sessions = new Map();

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function ignored(config, channelId, parentId) {
  if (!channelId) return true;
  if (config.ignored_channel_ids.includes(channelId)) return true;
  return !!(parentId && config.ignored_channel_ids.includes(parentId));
}

module.exports = (client) => {
  if (client.__wingbotStats) return;
  client.__wingbotStats = true;

  client.on(Events.MessageCreate, (message) => {
    try {
      if (!message.guild || message.author?.bot || message.system || message.webhookId) return;
      const config = getStatsConfig(message.guild.id);
      if (!config.enabled || !config.track_messages) return;
      const parentId = message.channel?.parentId;
      if (ignored(config, message.channelId, parentId)) return;
      addGuildActivity(message.guild.id, { messages: 1 });
      addChannelMessages(message.guild.id, message.channelId);
    } catch (error) {
      console.error("[stats] message :", error?.message || error);
    }
  });

  client.on(Events.GuildMemberAdd, (member) => {
    try {
      if (!member.guild || member.user?.bot) return;
      const config = getStatsConfig(member.guild.id);
      if (!config.enabled || !config.track_members) return;
      addGuildActivity(member.guild.id, { joins: 1 });
    } catch (error) {
      console.error("[stats] arrivée :", error?.message || error);
    }
  });

  client.on(Events.GuildMemberRemove, (member) => {
    try {
      if (!member.guild || member.user?.bot) return;
      const config = getStatsConfig(member.guild.id);
      if (!config.enabled || !config.track_members) return;
      addGuildActivity(member.guild.id, { leaves: 1 });
    } catch (error) {
      console.error("[stats] départ :", error?.message || error);
    }
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    try {
      const guild = newState.guild || oldState.guild;
      const user = newState.member?.user || oldState.member?.user;
      if (!guild || !user || user.bot) return;
      const id = key(guild.id, user.id);
      const prev = sessions.get(id);
      const oldId = oldState.channelId;
      const newId = newState.channelId;

      if (oldId && oldId !== newId && prev && prev.channelId === oldId) {
        const config = getStatsConfig(guild.id);
        if (config.enabled && config.track_voice && !ignored(config, prev.channelId, prev.parentId)) {
          const elapsed = Date.now() - prev.joinedAt;
          if (elapsed >= 5000) {
            addGuildActivity(guild.id, { voice_seconds: Math.floor(elapsed / 1000) });
          }
        }
        sessions.delete(id);
      }

      if (!newId || newId === oldId) return;
      if (newId === guild.afkChannelId) return;
      const config = getStatsConfig(guild.id);
      if (!config.enabled || !config.track_voice) return;
      const parentId = newState.channel?.parentId || null;
      if (ignored(config, newId, parentId)) return;
      sessions.set(id, { channelId: newId, joinedAt: Date.now(), parentId });
    } catch (error) {
      console.error("[stats] vocal :", error?.message || error);
    }
  });
};
