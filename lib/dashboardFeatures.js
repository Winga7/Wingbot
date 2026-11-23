/**
 * Fonctions configurables via le dashboard (pas de commande Discord dédiée).
 * Source unique pour /help, $help et la doc interne.
 */
const DASHBOARD_FEATURES = [
  {
    id: "announcements",
    name: "Annonces programmées",
    nav: "Messages → Annonces",
    hash: "announcements",
    summary: "Envoie un message ou embed à date/heure (une fois, quotidien, hebdo).",
  },
  {
    id: "social",
    name: "Réseaux sociaux",
    nav: "Messages → Réseaux sociaux",
    hash: "social",
    summary:
      "Alertes YouTube (nouvelles vidéos), Twitch (début de live, nouveaux clips) vers le salon choisi.",
  },
  {
    id: "reactionroles",
    name: "Réactions rôles",
    nav: "Serveur → Réactions rôles",
    hash: "reactionroles",
    summary:
      "Panneaux emoji → rôle sur un message (nouveau ou existant), modes normal / unique.",
  },
  {
    id: "ticketing",
    name: "Tickets",
    nav: "Tickets → Panneaux & config",
    hash: "ticketing",
    summary:
      "Panneau multi-boutons (jusqu'à 25 types), modals pré-ouverture, rôles/permissions par type, claim, fermeture, transcript et nom de salon personnalisable.",
  },
  {
    id: "permissions",
    name: "Permissions commandes",
    nav: "Commandes → Permissions",
    hash: "permissions",
    summary:
      "Salons autorisés ou interdits, rôles modération / admin / premium pour les commandes.",
  },
  {
    id: "embeds",
    name: "Constructeur d'embeds",
    nav: "Messages → Constructeur",
    hash: "embeds",
    summary: "Crée et publie des embeds Discord depuis le dashboard.",
  },
  {
    id: "custom",
    name: "Commandes perso",
    nav: "Messages → Commandes perso",
    hash: "custom",
    summary: "Réponses au préfixe configurables (pas de slash).",
  },
  {
    id: "moderation",
    name: "Antispam & warns",
    nav: "Modération → Outils mod / Warns",
    hash: "moderation",
    summary: "Antispam automatique, seuils de warns et sanctions.",
  },
  {
    id: "logs",
    name: "Logs",
    nav: "Modération → Logs",
    hash: "logs",
    summary: "Salon de logs et événements à tracer.",
  },
  {
    id: "membercards",
    name: "Arrivées & départs",
    nav: "Messages → Arrivées",
    hash: "membercards",
    summary:
      "Carte image d'arrivée, de départ ou d'expulsion : textes, couleurs et salon, chacun activable à part.",
  },
  {
    id: "levels",
    name: "Niveaux",
    nav: "Communauté → Niveaux",
    hash: "levels",
    summary:
      "XP à l'écrit, annonce de niveau et rôles récompense. Commandes rank, leaderboard et xp.",
  },
  {
    id: "stats",
    name: "Statistiques",
    nav: "Communauté → Statistiques",
    hash: "stats",
    summary:
      "Compteurs d'activité sur 31 jours : messages, vocal, arrivées et départs. Commande stats.",
  },
  {
    id: "giveaways",
    name: "Giveaways",
    nav: "Communauté → Giveaways",
    hash: "giveaways",
    summary:
      "Tirages au sort avec bouton Participer. Commande giveaway start / end / cancel / reroll / list.",
  },
  {
    id: "tempvoice",
    name: "Vocaux temporaires",
    nav: "Communauté → Vocaux temp.",
    hash: "tempvoice",
    summary:
      "Hubs créateurs, panel Ouvert/Fermé/Privé, listes, purge, transfert, sauvegardes premium. Commande tempvoice.",
  },
];

function formatDashboardHelpLines(ids = null) {
  const list = ids
    ? DASHBOARD_FEATURES.filter((f) => ids.includes(f.id))
    : DASHBOARD_FEATURES;
  return list
    .map((f) => `• **${f.name}** — _${f.nav}_\n  ${f.summary}`)
    .join("\n\n");
}

/** Deux blocs pour l’embed /help (limite 1024 car. par field Discord). */
function formatDashboardHelpFields() {
  return [
    {
      name: "🌐 Dashboard · Messages & serveur",
      value:
        "Pas de commande Discord — configuration via le **dashboard** :\n\n" +
        formatDashboardHelpLines([
          "announcements",
          "social",
          "reactionroles",
          "embeds",
          "custom",
          "membercards",
          "levels",
        ]),
      inline: false,
    },
    {
      name: "🌐 Dashboard · Tickets & modération",
      value: formatDashboardHelpLines([
        "ticketing",
        "permissions",
        "moderation",
        "logs",
      ]),
      inline: false,
    },
    {
      name: "🌐 Dashboard · Communauté",
      value: formatDashboardHelpLines(["stats", "giveaways", "tempvoice"]),
      inline: false,
    },
  ];
}

module.exports = {
  DASHBOARD_FEATURES,
  formatDashboardHelpLines,
  formatDashboardHelpFields,
};
