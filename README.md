# Wingbot

<p align="center">
  <strong>Bot Discord moderne</strong> — commandes slash & préfixe, dashboard web, SQLite, Docker.
</p>

<p align="center">
  <img alt="Discord.js" src="https://img.shields.io/badge/Discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white" />
  <img alt="Node" src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat-square&logo=sqlite&logoColor=white" />
  <img alt="Version" src="https://img.shields.io/badge/version-0.0.3-0ea5e9?style=flat-square" />
  <img alt="Licence" src="https://img.shields.io/badge/licence-ISC-gray?style=flat-square" />
</p>

---

Wingbot gère la modération, les logs, les tickets et les annonces depuis Discord **et** depuis un dashboard web. Une base SQLite partagée, un déploiement Docker en deux services — simple à lancer, prêt pour plusieurs serveurs.

| | |
|---|---|
| **Bot** | Slash + préfixe, intents Discord, verrou anti-double instance |
| **Dashboard** | Config visuelle sur le port `3847` |
| **Données** | SQLite (`./data`) — logs, warns, tickets, configs |

---

## Sommaire

- [Ce que fait Wingbot](#ce-que-fait-wingbot)
- [Démarrage rapide](#démarrage-rapide)
- [Configuration Discord](#configuration-discord)
- [Variables d’environnement](#variables-denvironnement)
- [Docker](#docker)
- [Scripts utiles](#scripts-utiles)
- [Structure du projet](#structure-du-projet)
- [Aller plus loin](#aller-plus-loin)

---

## Ce que fait Wingbot

### Sur Discord

| | Commandes |
|---|---|
| **Utilitaires** | `ping` · `help` · `userinfo` · `user` · `roleinfo` · `botinfo` · `avatar` · `server` · `serverlogo` · `messageinfo` · `rank` · `leaderboard` · `stats` · `birthday` |
| **Modération** | `kick` · `ban` · `timeout` · `untimeout` · `warn` · `warns` · `unwarn` · `slowmode` · `clear` |
| **Admin** | `setlogchannel` · `togglelog` · `logconfig` · `logtest` · `clearcache` · `xp` · `giveaway` · `tempvoice` · `starboard` |
| **Premium** | `backup` — sauvegarde / restauration complète du serveur |

### Depuis le dashboard

| Fonction | En bref |
|---|---|
| **Annonces** | Messages / embeds planifiés (une fois, quotidien, hebdo) |
| **Réseaux sociaux** | Alertes YouTube & Twitch (lives, clips) |
| **Réactions-rôles** | Panneaux emoji → rôle, modes normal / unique |
| **Tickets** | Multi-boutons, claim, fermeture, transcripts |
| **Permissions** | Salons & rôles par commande |
| **Embeds** | Constructeur et publication depuis le web |
| **Commandes perso** | Réponses au préfixe configurables |
| **Antispam & warns** | Seuils et sanctions automatiques |
| **Logs** | Salon + événements à tracer |
| **Niveaux** | XP à l'écrit, annonce, rôles récompense, `rank` / `leaderboard` / `xp` |
| **Statistiques** | Compteurs d'activité (messages, vocal, arrivées), `stats` |
| **Giveaways** | Tirages au sort (bouton Participer), `giveaway` |
| **Vocaux temp.** | « Créer votre salon » + panel, `tempvoice` |
| **Starboard** | Messages populaires (⭐) dans un salon dédié |
| **Anniversaires** | Dates, annonce du jour, rôle temporaire |

---

## Démarrage rapide

```bash
git clone https://github.com/Winga7/Wingbot.git
cd Wingbot
npm install
```

1. Crée un fichier `.env` (voir [ci-dessous](#variables-denvironnement))
2. Déploie les slash sur ton serveur de test
3. Lance le bot, puis le dashboard

```bash
npm run deploy          # slash → GUILD_ID
npm start               # bot
npm run dashboard       # autre terminal → http://127.0.0.1:3847
```

> **Astuce** — En dev, utilise `npm run dev` (nodemon). Bot et dashboard tournent ensemble ; **ne lance pas deux bots** (verrou Gateway).

---

## Configuration Discord

Dans le [Developer Portal](https://discord.com/developers/applications) :

1. **Bot → Privileged Gateway Intents** — active *Presence*, *Server Members*, *Message Content*
2. **OAuth2 → Redirects** — ajoute  
   `http://127.0.0.1:3847/auth/discord/callback`
3. Récupère le **token**, le **Client ID** et le **Client Secret**

---

## Variables d’environnement

Fichier `.env` à la racine :

```env
# ── Obligatoire ──────────────────────────────────
TOKEN=ton_token_bot
CLIENT_ID=ton_client_id
DISCORD_CLIENT_SECRET=ton_client_secret

# ── Slash en local (un serveur = plus rapide) ────
GUILD_ID=id_du_serveur_de_test

# ── Dashboard ────────────────────────────────────
DASHBOARD_PUBLIC_URL=http://127.0.0.1:3847
```

<details>
<summary><strong>Options avancées</strong> (Twitch, DB, fondateurs…)</summary>

```env
# DASHBOARD_PORT=3847
# DASHBOARD_ALLOWED_ORIGINS=http://127.0.0.1:3847,https://dash.exemple.fr
# WINGBOT_DB_PATH=./data/wingbot.db
# TWITCH_CLIENT_ID=
# TWITCH_CLIENT_SECRET=
# FOUNDER_DISCORD_IDS=id1,id2
# BOT_INVITE_PERMISSIONS=268438528
# WINGBOT_ALLOW_MULTIPLE=1   # Docker uniquement — contourne le verrou
```

</details>

---

## Docker

Tout en un — bot + dashboard, volume SQLite partagé :

```bash
mkdir -p data
docker compose up -d --build
```

| Service | Conteneur | Rôle |
|---------|-----------|------|
| `bot` | `wingbot-bot` | Gateway Discord |
| `dashboard` | `wingbot-dashboard` | UI → **:3847** |

> Monte toujours le dossier `./data` entier (pas seulement le `.db`) : SQLite en WAL utilise aussi `-wal` et `-shm`.

---

## Scripts utiles

| Commande | Rôle |
|----------|------|
| `npm start` | Démarre le bot |
| `npm run dev` | Bot en watch (nodemon) |
| `npm run dashboard` | Dashboard web |
| `npm run deploy` | Slash → serveur `GUILD_ID` |
| `node deploy-commands-global.js` | Slash globales (prod, ~1 h) |
| `node deploy-commands-server.js <id>` | Slash → une guilde précise |

---

## Niveaux

Réglage dans le dashboard : **Communauté → Niveaux**.

| Commande | Qui | Effet |
|---|---|---|
| `/rank` · `$rank` | tout le monde | Niveau, barre d'XP et rang |
| `/leaderboard` · `$leaderboard` | tout le monde | Top 10 |
| `/xp set` · `$xp set @membre montant` | Gérer le serveur | Fixe l'XP totale (0 à 5&nbsp;000&nbsp;000) |
| `/xp add` · `$xp add @membre montant` | Gérer le serveur | Ajoute ou retire jusqu'à 100&nbsp;000 XP |
| `/xp reset` · `$xp reset @membre` | Gérer le serveur | Remet un membre à zéro et retire ses rôles récompense |
| `/xp reset-all` · `$xp reset all CONFIRM` | Gérer le serveur | Efface toute l'XP du serveur (les rôles déjà donnés restent) |

Courbe : pour passer du niveau `n` au suivant, il faut `5n² + 50n + 100` XP. Niveau maximum : 150.

---

## Statistiques

Réglage dans le dashboard : **Communauté → Statistiques**. Le suivi est désactivé par défaut.

| Commande | Qui | Effet |
|---|---|---|
| `/stats` · `$stats` | tout le monde, si l'option publique est cochée | Activité des 7 derniers jours |
| `/stats jours:30` · `$stats 30` | idem | Activité de 1 à 30 jours |

Seuls des compteurs sont gardés, pendant 31 jours (dates UTC) : nombre de messages par salon, arrivées, départs, secondes de vocal. Pas le texte des messages, pas de statistique par membre. Les bots, les webhooks et le salon AFK sont ignorés. L'effacement des compteurs se fait depuis le dashboard.

---

## Giveaways

Réglage dans le dashboard : **Communauté → Giveaways**. Désactivé par défaut.

| Commande | Qui | Effet |
|---|---|---|
| `/giveaway start` · `$giveaway start 1h 1 Lot` | Gérer le serveur ou rôle organisateur | Lance un giveaway |
| `/giveaway end` · `$giveaway end <id>` | idem | Termine et tire les gagnants |
| `/giveaway cancel` · `$giveaway cancel <id>` | idem | Annule sans tirage |
| `/giveaway reroll` · `$giveaway reroll <id>` | idem | Retire de nouveaux gagnants |
| `/giveaway list` · `$giveaway list` | idem | Liste les giveaways actifs |

Participation uniquement via le bouton Discord (toggle). Tirage avec `crypto` côté serveur. Durée de 1 minute à 30 jours, jusqu'à 20 gagnants. Pas d'inscription depuis le dashboard. Test local du tirage : `node scripts/test-giveaway-pick.js`.

---

## Vocaux temporaires

Réglage dans le dashboard : **Communauté → Vocaux temp.**

1. Choisis une **catégorie**
2. Clique **Créer « ➕ Créer votre salon »** (ou `/tempvoice setup`)
3. Les membres qui rejoignent ce salon sont déplacés dans leur vocal + panel de boutons

| | |
|---|---|
| **Création** | Rejoindre `➕ Créer votre salon` → vocal perso + déplacement |
| **Fin** | Salon supprimé quand il est vide |
| **Panel** | Ouvert / Fermé / Privé, listes, purge, micro, vidéo, soundboard, statut, réglages, transfert |
| **Premium** | `{custom_word}` et sauvegardes de config (pas de limite artificielle de salons de création) |

| Commande | Effet |
|---|---|
| `/tempvoice setup` | Crée « Créer votre salon » dans la catégorie choisie |
| `/tempvoice list` · `$tempvoice list` | Liste les salons de création |
| `/tempvoice enable` · `$tempvoice enable\|disable` | Active le module |
| `/tempvoice toggle` / `remove` | Active ou retire un salon de création |

Permissions bot : Gérer les salons, Déplacer des membres, Voir, Se connecter. Test local : `node scripts/test-tempvoice-perms.js`.

---

## Starboard

Réglage : **Communauté → Starboard** ou `/starboard setup #salon`.

Quand un message atteint le nombre de réactions choisi (défaut ⭐ × 3), le bot le republie dans le salon starboard (embed + lien). Si les réactions redescendent sous le seuil, le post est retiré. Les bots peuvent être ignorés ; l'auto-réaction de l'auteur peut être retirée.

Test local : `node scripts/test-starboard-config.js`.

---

## Anniversaires

Réglage : **Communauté → Anniversaires**.

| Commande | Effet |
|---|---|
| `/birthday set 23/11` · `$birthday set 23/11` | Enregistre ta date (cooldown 24 h pour remodifier) |
| `/birthday list` · `$birthday list` | Prochains anniversaires |
| `/birthday toggle` · `$birthday on\|off` | Visible / masqué sur ce serveur |
| `/birthday admin-set` | Admin : définir pour un membre |

Annonce à l'heure configurée (décalage UTC), mention optionnelle, rôle temporaire du jour. Mode serveur uniquement (dates propres à chaque guilde).

Test local : `node scripts/test-birthday-config.js`.

---

## Structure du projet

```
Wingbot/
├── index.js           Point d’entrée bot
├── database.js        SQLite (better-sqlite3)
├── commands/          utility · moderation · admin · premium
├── events/            logs · tickets · niveaux · stats · giveaways · tempvoice · starboard · birthdays…
├── dashboard/         Express + front
├── backup/            Capture / restore (premium)
├── lib/               Configs partagées
├── docker-compose.yml
└── Dockerfile
```

---

## Aller plus loin

- [Guide du système de logs](./LOGS_GUIDE.md)

---

<p align="center">
  <sub>ISC · Winga</sub>
</p>
