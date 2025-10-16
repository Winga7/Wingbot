require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client, Collection, Events, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
  ],
});

// Initialisation de la collection de commandes
client.commands = new Collection();

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
      client.commands.set(command.data.name, command);
    } else {
      console.log(
        `[ATTENTION] La commande à ${filePath} manque une propriété requise "data" ou "execute".`
      );
    }
  }
}

// Événement quand le bot est prêt
client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

// Événement pour les interactions (slash commands)
client.on(Events.InteractionCreate, async (interaction) => {
  // Vérifier si c'est une commande slash
  if (!interaction.isChatInputCommand()) return;

  // Chercher la commande dans la collection
  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(
      `Aucune commande correspondant à ${interaction.commandName} n'a été trouvée.`
    );
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content:
          "Une erreur s'est produite lors de l'exécution de cette commande!",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content:
          "Une erreur s'est produite lors de l'exécution de cette commande!",
        ephemeral: true,
      });
    }
  }
});

// Préfixe pour les commandes de message
const prefix = "$";

// Événement pour les messages
client.on(Events.MessageCreate, (message) => {
  // Ignorer les messages du bot lui-même
  if (message.author.bot) return;

  // Vérifier si le message commence par le préfixe
  if (!message.content.startsWith(prefix)) return;

  // Extraire la commande et les arguments
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  // Chercher la commande dans la collection
  const command = client.commands.get(commandName);

  if (!command) {
    return message.reply(
      `Commande \`${commandName}\` introuvable. Utilisez \`${prefix}help\` pour voir les commandes disponibles.`
    );
  }

  try {
    // Exécuter la commande avec le contexte de message
    if (command.executeMessage) {
      command.executeMessage(message, args);
    } else {
      message.reply("Cette commande n'est pas configurée pour les messages.");
    }
  } catch (error) {
    console.error(error);
    message.reply(
      "Une erreur s'est produite lors de l'exécution de cette commande."
    );
  }
});

// Accès aux variables d'environnement
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

// Connexion du bot avec le token
client.login(token);
