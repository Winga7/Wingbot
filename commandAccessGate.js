const { PermissionFlagsBits } = require("discord.js");
const { COMMANDS, IMMUTABLE_COMMAND_IDS } = require("./commandsManifest");
const { getCommandAccessConfig } = require("./database");

const COMMAND_META = new Map(COMMANDS.map((c) => [c.id, c]));

/**
 * Contrôle d’accès configurable (salons / rôles) avant les vérifs Discord par commande.
 * @returns {string|null} message d’erreur affichable, ou null si OK
 */
function getCommandAccessDenial({ guild, member, channel, commandName }) {
  if (!guild) return null;

  const cfg = getCommandAccessConfig(guild.id);
  const chId = channel?.id;
  if (chId && cfg.ignore_channel_ids.includes(chId)) {
    return "Les commandes sont désactivées dans ce salon.";
  }

  if (IMMUTABLE_COMMAND_IDS.includes(commandName)) return null;

  if (!member) {
    return "Impossible de vérifier ton profil membre sur ce serveur.";
  }

  const roleCache = member.roles?.cache;
  if (roleCache && typeof roleCache.has === "function") {
    if (cfg.block_role_ids.some((id) => roleCache.has(id))) {
      return "Ton rôle ne te permet pas d’utiliser les commandes sur ce serveur.";
    }
  }

  const guildOwner = guild.ownerId === member.id;
  const isAdministrator =
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ?? false;

  if (cfg.allow_role_ids.length > 0) {
    const hasAllow =
      roleCache && cfg.allow_role_ids.some((id) => roleCache.has(id));
    if (!guildOwner && !isAdministrator && !hasAllow) {
      return "Tu n’as pas un rôle autorisé pour utiliser les commandes.";
    }
  }

  const meta = COMMAND_META.get(commandName);
  const cat = meta?.category;
  if ((cat === "moderation" || cat === "admin") && cfg.staff_role_ids.length > 0) {
    const hasStaff =
      roleCache && cfg.staff_role_ids.some((id) => roleCache.has(id));
    if (!guildOwner && !isAdministrator && !hasStaff) {
      return "Tu n’as pas un rôle staff autorisé pour les commandes modération / administration.";
    }
  }

  return null;
}

module.exports = { getCommandAccessDenial };
