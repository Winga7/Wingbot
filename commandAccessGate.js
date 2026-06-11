const { PermissionFlagsBits } = require("discord.js");
const { COMMANDS, IMMUTABLE_COMMAND_IDS } = require("./commandsManifest");
const { getCommandAccessConfig } = require("./database");
const { CATEGORY_ROLE_KEY, CATEGORY_LABEL } = require("./lib/commandAccessConfig");

const COMMAND_META = new Map(COMMANDS.map((c) => [c.id, c]));

function memberHasAnyRole(member, roleIds) {
  if (!roleIds?.length || !member?.roles?.cache) return false;
  return roleIds.some((id) => member.roles.cache.has(id));
}

function isGuildPrivileged(member, guild) {
  if (!member || !guild) return false;
  if (guild.ownerId === member.id) return true;
  return member.permissions?.has?.(PermissionFlagsBits.Administrator) ?? false;
}

/**
 * Contrôle d'accès configurable (salons / rôles) avant les vérifs Discord par commande.
 * @returns {string|null} message d'erreur affichable, ou null si OK
 */
function getCommandAccessDenial({ guild, member, channel, commandName }) {
  if (!guild) return null;

  const cfg = getCommandAccessConfig(guild.id);
  const chId = channel?.id;
  const immutable = IMMUTABLE_COMMAND_IDS.includes(commandName);

  if (chId && cfg.ignore_channel_ids.includes(chId)) {
    return "Les commandes sont désactivées dans ce salon.";
  }

  if (
    chId &&
    cfg.allow_channel_ids.length > 0 &&
    !cfg.allow_channel_ids.includes(chId)
  ) {
    return "Les commandes ne sont autorisées que dans certains salons.";
  }

  if (immutable) return null;

  if (!member) {
    return "Impossible de vérifier ton profil membre sur ce serveur.";
  }

  if (memberHasAnyRole(member, cfg.block_role_ids)) {
    return "Ton rôle ne te permet pas d'utiliser les commandes sur ce serveur.";
  }

  const privileged = isGuildPrivileged(member, guild);

  if (cfg.allow_role_ids.length > 0 && !privileged) {
    if (!memberHasAnyRole(member, cfg.allow_role_ids)) {
      return "Tu n'as pas un rôle autorisé pour utiliser les commandes.";
    }
  }

  const meta = COMMAND_META.get(commandName);
  const cat = meta?.category;
  const roleKey = cat ? CATEGORY_ROLE_KEY[cat] : null;
  const requiredRoles = roleKey ? cfg[roleKey] || [] : [];

  if (requiredRoles.length > 0 && !privileged) {
    if (!memberHasAnyRole(member, requiredRoles)) {
      const label = CATEGORY_LABEL[cat] || cat;
      return `Tu n'as pas un rôle autorisé pour les commandes ${label}.`;
    }
  }

  return null;
}

module.exports = { getCommandAccessDenial };
