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
| **Utilitaires** | `ping` · `help` · `userinfo` · `user` · `roleinfo` · `botinfo` · `avatar` · `server` · `serverlogo` · `messageinfo` |
| **Modération** | `kick` · `ban` · `timeout` · `untimeout` · `warn` · `warns` · `unwarn` · `slowmode` · `clear` |
| **Admin** | `setlogchannel` · `togglelog` · `logconfig` · `logtest` · `clearcache` |
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

## Structure du projet

```
Wingbot/
├── index.js           Point d’entrée bot
├── database.js        SQLite (better-sqlite3)
├── commands/          utility · moderation · admin · premium
├── events/            logs · tickets · antispam · feeds…
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
