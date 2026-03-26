/**
 * Liste des commandes slash (même noms que préfixe) pour le dashboard.
 * category: admin | utility
 */
const COMMAND_GROUPS = [
  {
    id: "utility",
    title: "Utilitaires",
    icon: "✨",
  },
  {
    id: "admin",
    title: "Administration",
    icon: "⚙️",
  },
];

const COMMANDS = [
  {
    id: "ping",
    category: "utility",
    label: "ping",
    description: "Latence du bot",
  },
  {
    id: "help",
    category: "utility",
    label: "help",
    description: "Liste des commandes",
  },
  {
    id: "userinfo",
    category: "utility",
    label: "userinfo",
    description: "Infos sur un membre",
  },
  {
    id: "user",
    category: "utility",
    label: "user",
    description: "Infos utilisateur (léger)",
  },
  {
    id: "roleinfo",
    category: "utility",
    label: "roleinfo",
    description: "Infos sur un rôle",
  },
  {
    id: "botinfo",
    category: "utility",
    label: "botinfo",
    description: "Infos sur le bot",
  },
  {
    id: "avatar",
    category: "utility",
    label: "avatar",
    description: "Avatar d’un utilisateur",
  },
  {
    id: "server",
    category: "utility",
    label: "server",
    description: "Infos sur le serveur",
  },
  {
    id: "serverlogo",
    category: "utility",
    label: "serverlogo",
    description: "Icône du serveur",
  },
  {
    id: "clear",
    category: "utility",
    label: "clear",
    description: "Supprimer des messages",
  },
  {
    id: "messageinfo",
    category: "utility",
    label: "messageinfo",
    description: "Détails d’un message",
  },
  {
    id: "setlogchannel",
    category: "admin",
    label: "setlogchannel",
    description: "Définir le salon de logs",
  },
  {
    id: "togglelog",
    category: "admin",
    label: "togglelog",
    description: "Activer / désactiver des groupes de logs",
  },
  {
    id: "logconfig",
    category: "admin",
    label: "logconfig",
    description: "Voir la config des logs",
  },
  {
    id: "logtest",
    category: "admin",
    label: "logtest",
    description: "Tester l’envoi des logs",
  },
  {
    id: "clearcache",
    category: "admin",
    label: "clearcache",
    description: "Vider le cache des messages",
  },
];

module.exports = {
  COMMAND_GROUPS,
  COMMANDS,
  ALL_COMMAND_IDS: COMMANDS.map((c) => c.id),
};
