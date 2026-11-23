const { PermissionFlagsBits } = require("discord.js");

const CONNECT = PermissionFlagsBits.Connect;
const VIEW = PermissionFlagsBits.ViewChannel;
const SPEAK = PermissionFlagsBits.Speak;
const STREAM = PermissionFlagsBits.Stream;
const USE_SOUNDBOARD = PermissionFlagsBits.UseSoundboard;
const SET_VOICE_STATUS = PermissionFlagsBits.SetVoiceChannelStatus;
const PRIORITY = PermissionFlagsBits.PrioritySpeaker;
const CREATE_INVITE = PermissionFlagsBits.CreateInstantInvite;
const MANAGE_CHANNELS = PermissionFlagsBits.ManageChannels;
const MANAGE_ROLES = PermissionFlagsBits.ManageRoles;

function bit(...flags) {
  return flags.reduce((acc, f) => acc | f, 0n);
}

function cloneOverwrites(channel) {
  if (!channel?.permissionOverwrites?.cache) return [];
  return [...channel.permissionOverwrites.cache.values()].map((ow) => ({
    id: ow.id,
    type: ow.type,
    allow: ow.allow.bitfield,
    deny: ow.deny.bitfield,
  }));
}

function creatorAllowBits(creatorPerms) {
  let allow =
    VIEW |
    CONNECT |
    SPEAK |
    STREAM |
    PermissionFlagsBits.MuteMembers |
    PermissionFlagsBits.MoveMembers |
    PermissionFlagsBits.DeafenMembers;
  if (creatorPerms.create_invite) allow |= CREATE_INVITE;
  if (creatorPerms.manage_channel) allow |= MANAGE_CHANNELS;
  if (creatorPerms.manage_permissions) allow |= MANAGE_ROLES | MANAGE_CHANNELS;
  if (creatorPerms.priority_speaker) allow |= PRIORITY;
  if (creatorPerms.set_status) allow |= SET_VOICE_STATUS;
  if (creatorPerms.use_soundboard) allow |= USE_SOUNDBOARD;
  return allow;
}

function whitelistAllowBits(wlPerms) {
  let allow = VIEW | CONNECT | SPEAK;
  if (wlPerms.mic) allow |= SPEAK;
  if (wlPerms.video) allow |= STREAM;
  if (wlPerms.soundboard) allow |= USE_SOUNDBOARD;
  if (wlPerms.status) allow |= SET_VOICE_STATUS;
  return allow;
}

/**
 * Construit les overwrites d'un salon temporaire selon le mode DraftBot.
 * @param {'open'|'closed'|'private'} mode
 */
function buildTempVoiceOverwrites({
  guildId,
  botId,
  ownerId,
  mode,
  hub,
  state,
  baseOverwrites,
}) {
  const accessRoles = hub.access_role_ids.length ? hub.access_role_ids : [guildId];
  const whitelistUsers = state.whitelist_users || [];
  const whitelistRoles = state.whitelist_roles || [];
  const blacklistUsers = state.blacklist_users || [];
  const blacklistRoles = state.blacklist_roles || [];
  const excludes = state.session_excludes || [];
  const mods = hub.moderator_role_ids || [];

  const byId = new Map();
  for (const ow of baseOverwrites || []) {
    byId.set(ow.id, {
      id: ow.id,
      allow: BigInt(ow.allow || 0),
      deny: BigInt(ow.deny || 0),
    });
  }

  const set = (id, allow, deny) => {
    byId.set(id, { id, allow: BigInt(allow), deny: BigInt(deny) });
  };

  // Bot
  set(
    botId,
    VIEW |
      CONNECT |
      SPEAK |
      MANAGE_CHANNELS |
      MANAGE_ROLES |
      PermissionFlagsBits.MoveMembers |
      PermissionFlagsBits.MuteMembers,
    0n
  );

  // Owner
  set(ownerId, creatorAllowBits(hub.creator_perms), 0n);

  // Access roles / everyone according to mode
  for (const roleId of accessRoles) {
    if (mode === "open") {
      set(roleId, VIEW | CONNECT, 0n);
    } else if (mode === "closed") {
      set(roleId, VIEW, CONNECT);
    } else {
      set(roleId, 0n, VIEW | CONNECT);
    }
  }

  // Moderators always can join
  for (const roleId of mods) {
    set(roleId, VIEW | CONNECT | SPEAK | STREAM, 0n);
  }

  // Whitelist
  const wlBits = whitelistAllowBits(hub.whitelist_perms);
  for (const id of whitelistUsers) set(id, wlBits, 0n);
  for (const id of whitelistRoles) set(id, wlBits, 0n);

  // Blacklist + session excludes
  for (const id of [...blacklistUsers, ...blacklistRoles, ...excludes]) {
    set(id, 0n, VIEW | CONNECT);
  }

  // Global toggles for @everyone-style participants: applied via access roles deny bits when toggled off
  // Mic / video / soundboard / status off → deny on access roles (not owner/whitelist/mods)
  if (!state.mic || !state.video || !state.soundboard || !state.status) {
    for (const roleId of accessRoles) {
      const current = byId.get(roleId) || { id: roleId, allow: 0n, deny: 0n };
      let deny = current.deny;
      let allow = current.allow;
      if (!state.mic) {
        deny |= SPEAK;
        allow &= ~SPEAK;
      }
      if (!state.video) {
        deny |= STREAM;
        allow &= ~STREAM;
      }
      if (!state.soundboard) {
        deny |= USE_SOUNDBOARD;
        allow &= ~USE_SOUNDBOARD;
      }
      if (!state.status) {
        deny |= SET_VOICE_STATUS;
        allow &= ~SET_VOICE_STATUS;
      }
      set(roleId, allow, deny);
    }
  }

  return [...byId.values()].map((ow) => ({
    id: ow.id,
    allow: ow.allow,
    deny: ow.deny,
  }));
}

module.exports = {
  cloneOverwrites,
  buildTempVoiceOverwrites,
  creatorAllowBits,
  whitelistAllowBits,
  CONNECT,
  VIEW,
  SPEAK,
  STREAM,
  USE_SOUNDBOARD,
  SET_VOICE_STATUS,
};
