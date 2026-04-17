/**
 * Définition unique des clés de logs (granulaires) + groupes pour /togglelog legacy.
 */
const ALL_KEYS = [
  "msg_cache",
  "msg_delete",
  "msg_edit",
  "msg_reaction",
  "msg_bulk",
  "msg_pin",
  "mem_join",
  "mem_leave",
  "mem_kick",
  "voc_join",
  "voc_leave",
  "voc_move",
  "voc_srv_mute",
  "voc_srv_deaf",
  "voc_self_mute",
  "voc_self_deaf",
  "voc_stream",
  "voc_video",
  "role_add",
  "role_remove",
  "nick_change",
  "mod_timeout",
  "mod_ban",
  "mod_unban",
  "srv_channel",
  "srv_thread",
  "srv_emoji",
  "srv_sticker",
  "srv_guild_meta",
  "srv_invite",
  "srv_event",
  "srv_event_user",
  "srv_stage",
  "srv_webhook",
  "srv_role",
];

/** @type {Record<string, boolean>} */
const DEFAULT_FLAGS = Object.fromEntries(ALL_KEYS.map((k) => [k, false]));

/** Anciennes colonnes → clés activées quand feature_flags est absent */
const LEGACY_MAP = {
  log_messages: [
    "msg_cache",
    "msg_delete",
    "msg_edit",
    "msg_reaction",
    "msg_bulk",
    "msg_pin",
  ],
  log_members: ["mem_join", "mem_leave", "mem_kick"],
  log_voice: [
    "voc_join",
    "voc_leave",
    "voc_move",
    "voc_srv_mute",
    "voc_srv_deaf",
  ],
  log_roles: ["role_add", "role_remove", "nick_change"],
  log_moderation: ["mod_timeout", "mod_ban", "mod_unban"],
  log_server: [
    "srv_channel",
    "srv_thread",
    "srv_emoji",
    "srv_sticker",
    "srv_guild_meta",
    "srv_invite",
    "srv_event",
    "srv_event_user",
    "srv_stage",
    "srv_webhook",
    "srv_role",
  ],
};

/** Pour /togglelog : nom → clés */
const TOGGLE_GROUP = {
  all: ALL_KEYS,
  messages: LEGACY_MAP.log_messages,
  members: LEGACY_MAP.log_members,
  voice: LEGACY_MAP.log_voice,
  roles: LEGACY_MAP.log_roles,
  moderation: LEGACY_MAP.log_moderation,
  server: LEGACY_MAP.log_server,
};

/** Manifest UI : groupes + libellés FR */
const DASHBOARD_GROUPS = [
  {
    id: "messages",
    title: "Messages",
    description: "Contenu, réactions, épingles, suppressions groupées",
    keys: [
      { id: "msg_cache", label: "Cache des messages (récupération si suppression)" },
      { id: "msg_delete", label: "Message supprimé" },
      { id: "msg_edit", label: "Message modifié" },
      { id: "msg_reaction", label: "Réactions ajoutées / retirées" },
      { id: "msg_bulk", label: "Suppression en masse (bulk delete)" },
      { id: "msg_pin", label: "Épingles / désépingles" },
    ],
  },
  {
    id: "members",
    title: "Membres",
    description: "Arrivées, départs, expulsions",
    keys: [
      { id: "mem_join", label: "Membre rejoint" },
      { id: "mem_leave", label: "Membre a quitté (volontaire)" },
      { id: "mem_kick", label: "Expulsion (kick)" },
    ],
  },
  {
    id: "voice",
    title: "Vocal",
    description: "Connexions et actions de modération vocale",
    keys: [
      { id: "voc_join", label: "Rejoint un salon vocal" },
      { id: "voc_leave", label: "A quitté le vocal" },
      { id: "voc_move", label: "Déplacé entre salons" },
      { id: "voc_srv_mute", label: "Server mute / unmute" },
      { id: "voc_srv_deaf", label: "Server deafen / undeafen" },
      { id: "voc_self_mute", label: "Micro coupé / réactivé par le membre" },
      { id: "voc_self_deaf", label: "Casque coupé / réactivé par le membre" },
      { id: "voc_stream", label: "Go Live (stream) activé / arrêté" },
      { id: "voc_video", label: "Caméra activée / désactivée" },
    ],
  },
  {
    id: "roles",
    title: "Rôles & profil",
    description: "Changements sur les membres",
    keys: [
      { id: "role_add", label: "Rôle ajouté à un membre" },
      { id: "role_remove", label: "Rôle retiré" },
      { id: "nick_change", label: "Surnom modifié" },
    ],
  },
  {
    id: "moderation",
    title: "Modération",
    description: "Sanctions et modération",
    keys: [
      { id: "mod_timeout", label: "Timeout (exclusion temporaire)" },
      { id: "mod_ban", label: "Bannissement" },
      { id: "mod_unban", label: "Débannissement" },
    ],
  },
  {
    id: "server",
    title: "Serveur & structure",
    description: "Salons, serveur, intégrations",
    keys: [
      { id: "srv_channel", label: "Salons : création / suppression / modification (dont permissions)" },
      { id: "srv_thread", label: "Fils (threads)" },
      { id: "srv_emoji", label: "Émojis du serveur" },
      { id: "srv_sticker", label: "Stickers du serveur" },
      { id: "srv_guild_meta", label: "Nom / icône du serveur" },
      { id: "srv_invite", label: "Invitations" },
      { id: "srv_event", label: "Événements planifiés (création / modif / suppression)" },
      { id: "srv_event_user", label: "Inscriptions / désinscriptions aux événements" },
      { id: "srv_stage", label: "Scènes (stage)" },
      { id: "srv_webhook", label: "Webhooks (mise à jour par salon)" },
      { id: "srv_role", label: "Rôles du serveur (création / modification / suppression)" },
    ],
  },
];

module.exports = {
  ALL_KEYS,
  DEFAULT_FLAGS,
  LEGACY_MAP,
  TOGGLE_GROUP,
  DASHBOARD_GROUPS,
};
