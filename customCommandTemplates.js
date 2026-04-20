/**
 * Réponses des commandes perso : substitution de placeholders.
 *
 * Syntaxes acceptées (équivalentes) — `{token}` ET `{{token}}` :
 *
 *   {user}            → mention <@id>
 *   {user.tag}        → Pseudo#1234 (ou pseudo seul depuis pseudos uniques)
 *   {user.id}         → 1234567890
 *   {username}        → pseudo (sans tag)
 *   {server} | {guild}            → nom du serveur
 *   {server.id} | {guild.id}      → id du serveur
 *   {guild.name}                  → nom du serveur (alias)
 *   {members} | {guild.members}   → membre count
 *   {channel}         → mention <#id>
 *   {channel.id}      → id du salon
 *   {channel.name}    → nom du salon
 *   {date}            → date locale FR
 *   {time}            → heure locale FR (HH:MM)
 *   {now}             → timestamp Unix
 *   {reply}           → contenu du message cité (vide sinon)
 *   {reply.content}   → idem {reply}
 *   {reply.user}      → mention de l'auteur cité
 *
 * Et l'option spéciale `{{delete}}` (uniquement double-accolade pour rester
 * cohérent avec l'ancien comportement) → supprime le message déclencheur.
 */

const TOKEN_REGEX_MAP = (token) =>
  // Match `{token}` ou `{{token}}` insensible à la casse, avec espaces possibles.
  new RegExp(`\\{\\{?\\s*${token.replace(/\./g, "\\.")}\\s*\\}\\}?`, "gi");

/**
 * @param {string} template
 * @param {import("discord.js").Message} message
 * @returns {Promise<{ content: string, deleteCmd: boolean, allowedMentions: import("discord.js").MessageMentionOptions }>}
 */
async function expandCustomTemplate(template, message) {
  let out = String(template || "");
  let deleteCmd = false;

  // {{delete}} — uniquement double accolade (option destructive, on évite les
  // collisions avec un éventuel mot "delete" en simple-accolade).
  if (/\{\{\s*delete\s*\}\}/i.test(out)) {
    deleteCmd = true;
    out = out.replace(/\{\{\s*delete\s*\}\}/gi, "").trim();
  }

  const author = message.author;
  const guild = message.guild;
  const ch = message.channel;
  const userIds = new Set();
  const now = new Date();
  const locale = "fr-FR";

  const replacements = [
    ["user.tag", () => author.tag],
    ["user.id", () => author.id],
    ["user", () => {
      userIds.add(author.id);
      return `<@${author.id}>`;
    }],
    ["username", () => author.username],
    ["channel.id", () => ch.id],
    ["channel.name", () => ch.name || ""],
    ["channel", () => `<#${ch.id}>`],
    ["guild.name", () => guild?.name ?? ""],
    ["guild.id", () => guild?.id ?? ""],
    ["guild.members", () =>
      guild?.memberCount != null ? String(guild.memberCount) : "—"],
    ["guild", () => guild?.name ?? ""],
    ["server.id", () => guild?.id ?? ""],
    ["server", () => guild?.name ?? ""],
    ["members", () =>
      guild?.memberCount != null ? String(guild.memberCount) : "—"],
    ["date", () => now.toLocaleDateString(locale)],
    ["time", () =>
      now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })],
    ["now", () => String(Math.floor(now.getTime() / 1000))],
  ];

  for (const [token, fn] of replacements) {
    out = out.replace(TOKEN_REGEX_MAP(token), fn);
  }

  if (message.reference?.messageId && /\{\{?\s*reply/i.test(out)) {
    const refMsg = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);
    if (refMsg) {
      userIds.add(refMsg.author.id);
      const short = (s) =>
        String(s || "")
          .slice(0, 500)
          .replace(/@/g, "@\u200b");
      out = out
        .replace(TOKEN_REGEX_MAP("reply.content"), refMsg.content ? short(refMsg.content) : "")
        .replace(TOKEN_REGEX_MAP("reply.user"), `<@${refMsg.author.id}>`)
        .replace(TOKEN_REGEX_MAP("reply"), refMsg.content ? short(refMsg.content) : "");
    } else {
      out = out
        .replace(TOKEN_REGEX_MAP("reply.content"), "")
        .replace(TOKEN_REGEX_MAP("reply.user"), "")
        .replace(TOKEN_REGEX_MAP("reply"), "");
    }
  } else {
    out = out
      .replace(TOKEN_REGEX_MAP("reply.content"), "")
      .replace(TOKEN_REGEX_MAP("reply.user"), "")
      .replace(TOKEN_REGEX_MAP("reply"), "");
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
