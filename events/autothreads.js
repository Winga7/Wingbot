const { Events, ChannelType } = require("discord.js");
const { getAutothreadConfig } = require("../database");
const { applyThreadName } = require("../lib/autothreadConfig");

module.exports = (client) => {
  if (client.__wingbotAutothreads) return;
  client.__wingbotAutothreads = true;

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message.guild || message.system) return;
      if (message.channel?.isThread?.()) return;
      if (
        message.channel?.type !== ChannelType.GuildText &&
        message.channel?.type !== ChannelType.GuildAnnouncement
      ) {
        return;
      }

      const config = getAutothreadConfig(message.guild.id);
      if (!config.enabled || !config.channels.length) return;

      const rule = config.channels.find(
        (c) => c.enabled && c.channel_id === message.channelId
      );
      if (!rule) return;
      if (rule.ignore_bots && message.author?.bot) return;
      if (rule.ignore_existing_thread && message.hasThread) return;

      const snippet = String(message.content || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      const name = applyThreadName(rule.name_format, {
        username: message.author?.username || "membre",
        messageSnippet: snippet || "discussion",
        channelName: message.channel.name || "salon",
      });

      await message
        .startThread({
          name,
          autoArchiveDuration: rule.auto_archive_minutes,
          reason: "Wingbot · fil automatique",
        })
        .catch((error) => {
          console.error("[autothreads]", error.message || error);
        });
    } catch (error) {
      console.error("[autothreads]", error);
    }
  });
};
