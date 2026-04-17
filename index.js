require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  ActivityType,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
} = require("discord.js");
const {
  initDatabase,
  cleanOldMessages,
  getGuildPrefix,
  isCommandEnabled,
  getCustomCommandReply,
  getBotGlobalSettings,
} = require("./database");
const { expandCustomTemplate } = require("./customCommandTemplates");
const { getCommandAccessDenial } = require("./commandAccessGate");

// Initialiser la base de données
initDatabase();

/** Une seule connexion Gateway par token : évite les logs en double (2× `node index.js`, etc.). */
function acquireRunLockOrExit() {
  if (process.env.WINGBOT_ALLOW_MULTIPLE === "1") return;
  const lockPath = path.join(__dirname, ".wingbot-instance.lock");
  const tryRemoveStale = () => {
    if (!fs.existsSync(lockPath)) return true;
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    const oldPid = Number(raw);
    if (!Number.isFinite(oldPid) || oldPid <= 0) {
      fs.unlinkSync(lockPath);
      return true;
    }
    try {
      process.kill(oldPid, 0);
      return false;
    } catch {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
      return true;
    }
  };

  if (!tryRemoveStale()) {
    console.error(
      "\n[Wingbot] Une autre instance du bot tourne déjà (même dossier, autre terminal ou processus).\n" +
        "→ Ferme l’autre `npm run dev` / `npm start` avant d’en relancer un.\n" +
        "→ Le dashboard (`npm run dashboard`) ne remplace pas le bot : il peut tourner en parallèle sans second `index.js`.\n" +
        "→ Pour contourner ce verrou (déconseillé) : WINGBOT_ALLOW_MULTIPLE=1\n"
    );
    process.exit(1);
  }

  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch (e) {
    if (e && e.code === "EEXIST") {
      if (!tryRemoveStale()) {
        console.error(
          "[Wingbot] Verrou présent : une autre instance vient de démarrer. Réessaie dans une seconde."
        );
        process.exit(1);
      }
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    } else {
      throw e;
    }
  }

  const release = () => {
    try {
      if (!fs.existsSync(lockPath)) return;
      const cur = fs.readFileSync(lockPath, "utf8").trim();
      if (cur === String(process.pid)) fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  };
  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(0);
  });
}

acquireRunLockOrExit();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildScheduledEvents,
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

// Charger le système de logs
const loadLogs = require("./events/logs");
loadLogs(client);

// Événement quand le bot est prêt
client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  const activityTypeByKey = {
    Custom: ActivityType.Custom,
    Playing: ActivityType.Playing,
    Listening: ActivityType.Listening,
    Watching: ActivityType.Watching,
    Competing: ActivityType.Competing,
  };

  const applyGlobalBotSettings = async () => {
    try {
      const cfg = getBotGlobalSettings();
      if (cfg.desired_username && client.user.username !== cfg.desired_username) {
        await client.user.setUsername(cfg.desired_username).catch(() => null);
      }
      const activityText = String(cfg.presence_activity_text || "").trim();
      const typeKey = String(cfg.presence_activity_type || "None").trim();
      const wantActivity = typeKey !== "None" && activityText.length > 0;
      const activities = wantActivity
        ? [
            {
              name: activityText.slice(0, 128),
              type: activityTypeByKey[typeKey] ?? ActivityType.Playing,
            },
          ]
        : [];
      client.user.setPresence({
        status: cfg.presence_status || "online",
        activities,
      });
    } catch (e) {
      console.error("Erreur applyGlobalBotSettings:", e);
    }
  };

  applyGlobalBotSettings();
  setInterval(() => {
    applyGlobalBotSettings();
  }, 5 * 1000);

  // Nettoyer les vieux messages du cache tous les jours
  setInterval(() => {
    cleanOldMessages();
  }, 24 * 60 * 60 * 1000); // 24 heures
});

// Événement pour les interactions (slash commands)
client.on(Events.InteractionCreate, async (interaction) => {
  // Vérifier si c'est une commande slash
  if (!interaction.isChatInputCommand()) return;

  // Chercher la commande dans la collection
  const command = client.commands.get(interaction.commandName);

  if (
    interaction.guildId &&
    command &&
    !isCommandEnabled(interaction.guildId, interaction.commandName)
  ) {
    return interaction.reply({
      content:
        "Cette commande est désactivée sur ce serveur. Réactive-la depuis le dashboard.",
      ephemeral: true,
    });
  }

  if (command && interaction.guild) {
    const denial = getCommandAccessDenial({
      guild: interaction.guild,
      member: interaction.member,
      channel: interaction.channel,
      commandName: interaction.commandName,
    });
    if (denial) {
      return interaction.reply({
        content: `❌ ${denial}`,
        ephemeral: true,
      });
    }
  }

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

// Événement pour les messages
client.on(Events.MessageCreate, async (message) => {
  // Ignorer les messages du bot lui-même
  if (message.author.bot) return;

  const guildId = message.guild?.id;
  const prefix = guildId ? getGuildPrefix(guildId) : "$";

  // Vérifier si le message commence par le préfixe
  if (!message.content.startsWith(prefix)) return;

  // Extraire la commande et les arguments
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName);

  if (command) {
    if (guildId && !isCommandEnabled(guildId, commandName)) {
      return message.reply(
        "Cette commande est désactivée sur ce serveur. Réactive-la depuis le dashboard."
      );
    }
    if (message.guild) {
      const denial = getCommandAccessDenial({
        guild: message.guild,
        member: message.member,
        channel: message.channel,
        commandName,
      });
      if (denial) {
        return message.reply(`❌ ${denial}`);
      }
    }
    try {
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
    return;
  }

  if (message.guild) {
    const denialCustom = getCommandAccessDenial({
      guild: message.guild,
      member: message.member,
      channel: message.channel,
      commandName: "__custom__",
    });
    if (denialCustom) {
      return message.reply(`❌ ${denialCustom}`);
    }
  }

  const customReply = guildId && getCustomCommandReply(guildId, commandName);
  if (customReply) {
    const { content, deleteCmd, allowedMentions } = await expandCustomTemplate(
      customReply,
      message
    );
    if (content.trim()) {
      await message.reply({ content, allowedMentions });
    }
    if (deleteCmd) {
      await message.delete().catch(() => {});
    }
    return;
  }

  return message.reply(
    `Commande \`${commandName}\` introuvable. Utilisez \`${prefix}help\` pour voir les commandes disponibles.`
  );
});

// Connexion du bot avec le token
client.login(process.env.TOKEN);
