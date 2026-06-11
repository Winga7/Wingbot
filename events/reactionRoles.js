const { Events, PermissionFlagsBits } = require("discord.js");
const { getReactionRolePanelByMessage } = require("../database");
const { reactionToKey } = require("../lib/reactionRoleEmoji");

async function resolveReaction(reaction) {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return null;
    }
  }
  return reaction;
}

async function resolveMessage(message) {
  if (message.partial) {
    try {
      return await message.fetch();
    } catch {
      return null;
    }
  }
  return message;
}

function findEntry(panel, emojiKey) {
  if (!emojiKey) return null;
  return panel.entries.find((e) => e.emoji === emojiKey) || null;
}

async function canManageRole(guild, role) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
  if (!role || role.managed) return false;
  if (role.position >= me.roles.highest.position) return false;
  return true;
}

async function applyReactionRole(panel, member, entry, add) {
  const guild = member.guild;
  const role =
    guild.roles.cache.get(entry.role_id) ||
    (await guild.roles.fetch(entry.role_id).catch(() => null));
  if (!(await canManageRole(guild, role))) return;

  if (add) {
    if (panel.mode === "unique") {
      for (const e of panel.entries) {
        if (e.role_id === entry.role_id) continue;
        if (member.roles.cache.has(e.role_id)) {
          await member.roles.remove(e.role_id).catch(() => null);
        }
      }
    }
    if (!member.roles.cache.has(entry.role_id)) {
      await member.roles.add(entry.role_id).catch(() => null);
    }
    return;
  }

  if (member.roles.cache.has(entry.role_id)) {
    await member.roles.remove(entry.role_id).catch(() => null);
  }
}

async function handleReaction(reaction, user, add) {
  if (user.bot) return;
  const rx = await resolveReaction(reaction);
  if (!rx) return;
  const message = await resolveMessage(rx.message);
  if (!message?.guild) return;

  const panel = getReactionRolePanelByMessage(message.guild.id, message.id);
  if (!panel) return;

  const emojiKey = reactionToKey(rx);
  const entry = findEntry(panel, emojiKey);
  if (!entry) return;

  const member = await message.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  await applyReactionRole(panel, member, entry, add);
}

module.exports = function loadReactionRoles(client) {
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      await handleReaction(reaction, user, true);
    } catch (e) {
      console.error("[reaction-roles] add:", e?.message || e);
    }
  });

  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
      await handleReaction(reaction, user, false);
    } catch (e) {
      console.error("[reaction-roles] remove:", e?.message || e);
    }
  });
};
