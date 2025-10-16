# 📋 Guide du Système de Logs - Wingbot

## 🚀 Installation

Le système de logs est maintenant installé avec **SQLite** comme base de données.

### ⚠️ Important : Activer les Intents Discord

Pour que les logs fonctionnent correctement, vous devez activer ces intents dans le [Discord Developer Portal](https://discord.com/developers/applications) :

1. Allez sur votre application
2. Cliquez sur **"Bot"** dans le menu de gauche
3. Descendez jusqu'à **"Privileged Gateway Intents"**
4. Activez :
   - ✅ **PRESENCE INTENT**
   - ✅ **SERVER MEMBERS INTENT**
   - ✅ **MESSAGE CONTENT INTENT** (déjà activé normalement)
5. Sauvegardez

---

## 🎯 Configuration

### 1️⃣ Définir le salon de logs

```bash
$setlogchannel #logs
# ou
/setlogchannel salon:#logs
```

### 2️⃣ Activer les types de logs

#### Activer TOUT d'un coup :
```bash
$togglelog all on
```

#### Activer par catégorie :
```bash
$togglelog messages on      # Messages supprimés/modifiés
$togglelog members on       # Arrivées/départs de membres
$togglelog voice on         # Activité vocale
$togglelog roles on         # Changements de rôles
$togglelog moderation on    # Actions de modération
$togglelog server on        # Changements du serveur
```

#### Désactiver :
```bash
$togglelog all off          # Tout désactiver
$togglelog messages off     # Désactiver juste les messages
```

### 3️⃣ Voir la configuration

```bash
$logconfig
# ou
/logconfig
```

---

## 📊 Types de logs disponibles

### 📝 **Messages** (`messages`)
- ❌ **Message supprimé** : contenu, auteur, pièces jointes
- ✏️ **Message modifié** : ancien VS nouveau message

### 👥 **Membres** (`members`)
- 👋 **Membre rejoint** : date de création du compte, avatar
- 👋 **Membre parti** : raison (left/kicked/banned), rôles

### 🔊 **Vocal** (`voice`)
- ➡️ **Rejoint un salon vocal**
- ⬅️ **Quitté un salon vocal**
- 🔀 **Déplacé entre salons** (avec qui l'a déplacé si action modo)
- 🔇 **Server Mute/Unmute** (avec qui a fait l'action)
- 🔇 **Server Deafen/Undeafen** (avec qui a fait l'action)

### 🎭 **Rôles** (`roles`)
- ➕ **Rôle ajouté** (avec qui l'a ajouté si action modo)
- ➖ **Rôle retiré** (avec qui l'a retiré si action modo)
- ✏️ **Surnom modifié** (avec qui l'a modifié)

### 🔨 **Modération** (`moderation`)
- *À venir dans une prochaine mise à jour*
- Kicks, bans, timeouts, warns

### ⚙️ **Serveur** (`server`)
- *À venir dans une prochaine mise à jour*
- Création/suppression de salons, emojis, etc.

---

## 🎨 Couleurs des embeds

- 🟢 **Vert** : Actions positives (ajout, arrivée, activation)
- 🔴 **Rouge** : Actions négatives (suppression, départ, bannissement)
- 🟠 **Orange** : Modifications (édition, changement)

---

## 💾 Base de données

### Fichier
`wingbot.db` (créé automatiquement à la racine du projet)

### Tables
- `guild_config` : Configuration par serveur
- `log_settings` : Paramètres de logs par serveur
- `message_cache` : Cache des messages (7 jours)

### Nettoyage automatique
Les messages en cache sont automatiquement supprimés après **7 jours**.

---

## 🔧 Maintenance

### Sauvegarder la base de données
Copiez simplement le fichier `wingbot.db`

### Réinitialiser la configuration d'un serveur
Supprimez les entrées dans la base de données ou utilisez un outil SQLite.

---

## ❓ FAQ

### Les logs ne s'affichent pas ?
1. Vérifiez que le salon de logs est configuré : `$logconfig`
2. Vérifiez que les logs sont activés : `$logconfig`
3. Vérifiez que le bot a la permission d'envoyer des messages dans le salon de logs
4. Vérifiez que les intents sont activés dans le Discord Developer Portal

### Je ne vois pas "qui" a fait une action de modération ?
1. Assurez-vous que le bot a la permission **"Voir les logs du serveur"** (View Audit Log)
2. Certaines actions automatiques ne peuvent pas être attribuées à un utilisateur

### Comment migrer vers un dashboard web plus tard ?
La base de données SQLite est déjà structurée pour être facilement utilisée par un dashboard web. Il suffira de créer une API REST qui lit/écrit dans `wingbot.db`.

---

## 🚀 Prochaines fonctionnalités

- ✅ Logs de messages, membres, vocal, rôles
- ⏳ Logs de modération (kick, ban, warn)
- ⏳ Logs du serveur (salons, emojis, etc.)
- ⏳ Dashboard web pour la configuration
- ⏳ Statistiques et analytics
- ⏳ Export des logs en PDF/CSV

---

**Créé par Winga** 💚

