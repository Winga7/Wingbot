/**
 * Réponses des commandes perso : placeholders + option {{delete}}.
 */

/**
 * @param {string} template
 * @param {import("discord.js").Message} message
 * @returns {Promise<{ content: string, deleteCmd: boolean, allowedMentions: import("discord.js").MessageMentionOptions }>}
 */
async function expandCustomTemplate(template, message) {
  let out = String(template || "");
  let deleteCmd = false;

  if (/\{\{\s*delete\s*\}\}/i.test(out)) {
    deleteCmd = true;
    out = out.replace(/\{\{\s*delete\s*\}\}/gi, "").trim();
  }

  const author = message.author;
  const guild = message.guild;
  const ch = message.channel;
  const userIds = new Set();

  out = out.replace(/\{\{\s*user\s*\}\}/gi, () => {
    userIds.add(author.id);
    return `<@${author.id}>`;
  });
  out = out.replace(/\{\{\s*user\.tag\s*\}\}/gi, () => author.tag);
  out = out.replace(/\{\{\s*username\s*\}\}/gi, () => author.username);
  out = out.replace(/\{\{\s*channel\s*\}\}/gi, () => `<#${ch.id}>`);
  out = out.replace(/\{\{\s*guild\s*\}\}/gi, () => guild?.name ?? "");
  out = out.replace(/\{\{\s*members\s*\}\}/gi, () =>
    guild?.memberCount != null ? String(guild.memberCount) : "—"
  );

  if (message.reference?.messageId && /\{\{\s*reply/i.test(out)) {
    const refMsg = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);
    if (refMsg) {
      userIds.add(refMsg.author.id);
      const short = (s) =>
        String(s || "")
          .slice(0, 500)
          .replace(/@/g, "@\u200b");
      out = out.replace(/\{\{\s*reply\.content\s*\}\}/gi, refMsg.content ? short(refMsg.content) : "");
      out = out.replace(/\{\{\s*reply\.user\s*\}\}/gi, `<@${refMsg.author.id}>`);
      out = out.replace(/\{\{\s*reply\s*\}\}/gi, refMsg.content ? short(refMsg.content) : "");
    } else {
      out = out
        .replace(/\{\{\s*reply\.content\s*\}\}/gi, "")
        .replace(/\{\{\s*reply\.user\s*\}\}/gi, "")
        .replace(/\{\{\s*reply\s*\}\}/gi, "");
    }
  } else {
    out = out
      .replace(/\{\{\s*reply\.content\s*\}\}/gi, "")
      .replace(/\{\{\s*reply\.user\s*\}\}/gi, "")
      .replace(/\{\{\s*reply\s*\}\}/gi, "");
  }

  const content = out.slice(0, 2000);
  const allowedMentions = {
    users: [...userIds],
    roles: [],
    parse: [],
  };

  return { content, deleteCmd, allowedMentions };
}

module.exports = { expandCustomTemplate };
