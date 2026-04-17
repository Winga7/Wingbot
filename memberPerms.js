const { PermissionFlagsBits } = require("discord.js");

function isGuildOwner(member) {
  return !!(member?.guild && member.id === member.guild.ownerId);
}

/**
 * Propriétaire du serveur ou permission Administrateur : pas besoin des autres droits ciblés (kick, ban, etc.).
 */
function hasModAdminBypass(member) {
  if (!member) return false;
  if (isGuildOwner(member)) return true;
  return member.permissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

/**
 * Vérifie une permission Discord, ou true si propriétaire / administrateur du serveur.
 */
function memberHasPermOrAdmin(member, permission) {
  if (hasModAdminBypass(member)) return true;
  return member.permissions?.has(permission) ?? false;
}

module.exports = {
  hasModAdminBypass,
  memberHasPermOrAdmin,
  isGuildOwner,
};
