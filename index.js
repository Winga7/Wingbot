require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  ActivityType,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
} = require("discord.js");
const {
  initDatabase,
  cleanOldMessages,
  getGuildPrefix,
  isCommandEnabled,
  getCustomCommandReply,
  getBotGlobalSettings,
  recordDmMessage,
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
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
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

const loadAntispam = require("./events/antispam");
loadAntispam(client);

const loadScheduledMessages = require("./events/scheduledMessages");
loadScheduledMessages(client);

const loadReactionRoles = require("./events/reactionRoles");
loadReactionRoles(client);

const loadSocialFeeds = require("./events/socialFeeds");
loadSocialFeeds(client);

const loadTickets = require("./events/tickets");
loadTickets(client);

// Événement quand le bot est prêt
client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  const { DB_PATH } = require("./database");
  console.log(`[Bot] PID ${process.pid} · cwd=${process.cwd()}`);
  console.log(`[Bot] Lit/écrit la DB → ${DB_PATH}`);

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

  publishSlashCommands().catch((e) => {
    console.error("[slash] publication au démarrage :", e?.message || e);
  });
});

const DM_OK_COMMANDS = new Set(["ping", "help", "avatar", "botinfo"]);

function slashCommandPayload() {
  return [...client.commands.values()].map((command) => {
    const json = command.data.toJSON();
    if (!DM_OK_COMMANDS.has(json.name)) json.dm_permission = false;
    return json;
  });
}

async function publishSlashCommands(guild = null) {
  const body = slashCommandPayload();
  if (!guild && client.application) {
    await client.application.commands.set([]).catch((e) => {
      console.error("[slash] nettoyage des commandes globales :", e?.message || e);
    });
  }
  const guilds = guild ? [guild] : [...client.guilds.cache.values()];
  for (const g of guilds) {
    try {
      await g.commands.set(body);
      console.log(`[slash] ${body.length} commande(s) sur ${g.name} (${g.id})`);
    } catch (e) {
      console.error(
        `[slash] échec sur ${g.id} — l’invitation du bot doit inclure le scope applications.commands :`,
        e?.message || e
      );
    }
  }
}

client.on(Events.GuildCreate, (guild) => {
  publishSlashCommands(guild).catch((e) => {
    console.error("[slash] publication à l’arrivée :", e?.message || e);
  });
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

  if (!interaction.guild && !DM_OK_COMMANDS.has(interaction.commandName)) {
    return interaction.reply({
      content: "Cette commande s’utilise dans un serveur.",
      ephemeral: true,
    });
  }

  if (!command) {
    console.error(
      `Aucune commande correspondant à ${interaction.commandName} n'a été trouvée.`
    );
    return interaction.reply({
      content:
        "Cette commande slash n’est pas chargée. Redémarre le bot pour la republier.",
      ephemeral: true,
    });
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
  // ----- DMs (panneau Fonda → Messages privés) -----
  if (!message.guild) {
    try {
      const me = client.user;
      const isFromBot = message.author.id === me?.id;
      let otherUser = isFromBot ? null : message.author;
      let otherId = isFromBot ? null : message.author.id;

      if (isFromBot) {
        // DMs envoyés via discord.js OU via REST (ex. gestionimpact)
        let ch = message.channel;
        otherId =
          ch?.recipientId ||
          ch?.recipient?.id ||
          null;
        if (!otherId && ch?.recipients?.cache?.size) {
          otherId = [...ch.recipients.cache.keys()].find((id) => id !== me?.id) || null;
        }
        // Salon partiel / ouvert hors process → refetch pour avoir recipientId
        if (!otherId && message.channelId) {
          ch =
            (await client.channels.fetch(message.channelId).catch(() => null)) ||
            ch;
          otherId =
            ch?.recipientId ||
            ch?.recipient?.id ||
            [...(ch?.recipients?.cache?.keys?.() || [])].find(
              (id) => id !== me?.id
            ) ||
            null;
        }
        otherUser =
          ch?.recipient ||
          (otherId ? await client.users.fetch(otherId).catch(() => null) : null);
        if (!otherId && otherUser?.id) otherId = otherUser.id;
      }

      if (otherId) {
        const embeds = [...(message.embeds || [])].map((e) => ({
          title: e.title || undefined,
          description: e.description || undefined,
          url: e.url || undefined,
          color: e.color ?? undefined,
          fields: (e.fields || []).map((f) => ({
            name: f.name,
            value: f.value,
            inline: !!f.inline,
          })),
          footer: e.footer
            ? { text: e.footer.text, icon_url: e.footer.iconURL || undefined }
            : undefined,
          timestamp: e.timestamp || undefined,
          author: e.author
            ? {
                name: e.author.name,
                icon_url: e.author.iconURL || undefined,
                url: e.author.url || undefined,
              }
            : undefined,
          thumbnail: e.thumbnail?.url
            ? { url: e.thumbnail.url }
            : undefined,
          image: e.image?.url ? { url: e.image.url } : undefined,
        }));

        recordDmMessage({
          user_id: otherId,
          channel_id: message.channel?.id || message.channelId || null,
          message_id: message.id,
          direction: isFromBot ? "out" : "in",
          author_id: message.author.id,
          author_tag: message.author.tag,
          content: message.content || "",
          attachments: [...message.attachments.values()].map((a) => ({
            name: a.name,
            url: a.url,
          })),
          embeds,
          user_tag: otherUser?.tag || otherUser?.username || null,
          user_avatar: otherUser?.displayAvatarURL?.({ size: 128 }) || null,
          created_at: message.createdAt?.toISOString?.() || null,
        });
      } else if (isFromBot) {
        console.warn(
          "[DM] message bot sans destinataire résolu",
          message.id,
          message.channelId
        );
      }
    } catch (e) {
      console.error("[DM] enregistrement échoué:", e?.message || e);
    }
  }

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
        await command.executeMessage(message, args);
      } else {
        await message.reply("Cette commande n'est pas configurée pour les messages.");
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
