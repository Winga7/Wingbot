const fs = require("node:fs");
const path = require("node:path");
const { REST, Routes } = require("discord.js");
require("dotenv").config();

// Récupérer l'ID du serveur depuis les arguments de ligne de commande
const guildId = process.argv[2];

if (!guildId) {
  console.log("❌ Erreur: Vous devez fournir l'ID du serveur en argument.");
  console.log("Usage: node deploy-commands-server.js <SERVER_ID>");
  console.log("\nPour obtenir l'ID d'un serveur:");
  console.log(
    "1. Activez le Mode Développeur dans Discord (Paramètres > Avancé)"
  );
  console.log("2. Clic droit sur le serveur > Copier l'identifiant du serveur");
  process.exit(1);
}

const commands = [];
// Configuration du chemin des commandes
const foldersPath = path.join(__dirname, "commands");
const commandFolders = fs.readdirSync(foldersPath);

// Chargement des commandes
for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
      commands.push(command.data.toJSON());
    } else {
      console.log(
        `[ATTENTION] La commande à ${filePath} manque une propriété requise "data" ou "execute".`
      );
    }
  }
}

// Créer une instance REST
const rest = new REST().setToken(process.env.TOKEN);

// Déployer les commandes sur un serveur spécifique
(async () => {
  try {
    console.log(
      `Début du déploiement de ${commands.length} commande(s) slash sur le serveur ${guildId}.`
    );

    // Déployer les commandes pour un serveur spécifique
    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
      { body: commands }
    );

    console.log(
      `✅ Déploiement réussi de ${data.length} commande(s) slash sur le serveur ${guildId}.`
    );
  } catch (error) {
    console.error("❌ Erreur lors du déploiement:", error);
    if (error.code === 50001) {
      console.log("Le bot n'a peut-être pas accès à ce serveur.");
    }
  }
})();
