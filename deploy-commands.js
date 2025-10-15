const fs = require("node:fs");
const path = require("node:path");
const { REST, Routes } = require("discord.js");
require("dotenv").config();

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

// Déployer les commandes
(async () => {
  try {
    console.log(
      `Début du déploiement de ${commands.length} commande(s) slash.`
    );

    // Déployer les commandes pour un serveur spécifique (plus rapide pour le développement)
    const data = await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log(`Déploiement réussi de ${data.length} commande(s) slash.`);
  } catch (error) {
    console.error(error);
  }
})();
