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
        ]),
      inline: false,
    },
    {
      name: "🌐 Dashboard · Modération & commandes",
      value: formatDashboardHelpLines([
        "permissions",
        "moderation",
        "logs",
      ]),
      inline: false,
    },
  ];
}

module.exports = {
  DASHBOARD_FEATURES,
  formatDashboardHelpLines,
  formatDashboardHelpFields,
};
