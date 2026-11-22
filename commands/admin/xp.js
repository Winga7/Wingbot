const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const {
  getLevelConfig,
  getMemberLevel,
  setMemberXp,
  deleteMemberLevel,
  deleteGuildLevels,
} = require("../../database");
const { clampXp, progressFromXp, MAX_XP } = require("../../lib/levelConfig");
const { syncLevelRoles, clearLevelRoles } = require("../../lib/levelRoles");
const { memberHasPermOrAdmin } = require("../../memberPerms");
const { resolveMessageUser } = require("../../lib/resolveTargets");

const ADD_CAP = 100_000;

function deny(send, text) {
  return send(`❌ ${text}`);
}

async function syncUserRoles(guild, userId, xp, config) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.user?.bot) return;
  await syncLevelRoles(member, progressFromXp(xp).level, config);
}

async function runSet(guild, user, amount) {
  if (!user || user.bot) return "Les bots ne reçoivent pas d'XP.";
  const xp = clampXp(amount);
  setMemberXp(guild.id, user.id, xp);
  const config = getLevelConfig(guild.id);
  await syncUserRoles(guild, user.id, xp, config);
  const progress = progressFromXp(xp);
  return `✅ ${user.username} est au niveau **${progress.level}** (${progress.total} XP).`;
}

async function runAdd(guild, user, delta) {
  if (!user || user.bot) return "Les bots ne reçoivent pas d'XP.";
  const current = getMemberLevel(guild.id, user.id)?.xp || 0;
  const xp = clampXp(current + delta);
  setMemberXp(guild.id, user.id, xp);
  const config = getLevelConfig(guild.id);
  await syncUserRoles(guild, user.id, xp, config);
  const progress = progressFromXp(xp);
  return `✅ ${user.username} : **${delta > 0 ? "+" : ""}${delta}** XP → niveau **${progress.level}** (${progress.total} XP).`;
}

async function runResetUser(guild, user) {
  if (!user || user.bot) return "Membre invalide.";
  deleteMemberLevel(guild.id, user.id);
  const config = getLevelConfig(guild.id);
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) await clearLevelRoles(member, config);
  return `✅ XP de ${user.username} remise à zéro. Les rôles récompense qu'il avait ont été retirés si le bot peut les gérer.`;
}

function runResetAll(guild) {
  const removed = deleteGuildLevels(guild.id);
  return `✅ XP effacée pour **${removed}** membre(s). Les rôles déjà donnés restent en place.`;
}

function parseAmount(raw, { allowNegative }) {
  if (!/^-?\d+$/.test(String(raw ?? "").trim())) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return null;
  if (!allowNegative && n < 0) return null;
  if (allowNegative && (n < -ADD_CAP || n > ADD_CAP)) return null;
  if (!allowNegative && n > MAX_XP) return null;
  return n;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Ajuste l'expérience d'un membre (Gérer le serveur)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Fixe l'XP totale d'un membre")
        .addUserOption((option) =>
          option.setName("membre").setDescription("Membre").setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("montant")
            .setDescription("XP totale")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(MAX_XP)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Ajoute ou retire de l'XP")
        .addUserOption((option) =>
          option.setName("membre").setDescription("Membre").setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("montant")
            .setDescription("XP à ajouter (négatif pour retirer)")
            .setRequired(true)
            .setMinValue(-ADD_CAP)
            .setMaxValue(ADD_CAP)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("reset")
        .setDescription("Remet l'XP d'un membre à zéro")
        .addUserOption((option) =>
          option.setName("membre").setDescription("Membre").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("reset-all")
        .setDescription("Efface l'XP de tout le serveur")
        .addStringOption((option) =>
          option
            .setName("confirmation")
            .setDescription("Écris RESET")
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ Commande de serveur uniquement.", ephemeral: true });
    }
    if (!memberHasPermOrAdmin(interaction.member, PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "❌ Il faut la permission Gérer le serveur.",
        ephemeral: true,
      });
    }
    const sub = interaction.options.getSubcommand();
    let text = "Action inconnue.";
    if (sub === "set") {
      text = await runSet(
        interaction.guild,
        interaction.options.getUser("membre", true),
        interaction.options.getInteger("montant", true)
      );
    } else if (sub === "add") {
      text = await runAdd(
        interaction.guild,
        interaction.options.getUser("membre", true),
        interaction.options.getInteger("montant", true)
      );
    } else if (sub === "reset") {
      text = await runResetUser(
        interaction.guild,
        interaction.options.getUser("membre", true)
      );
    } else if (sub === "reset-all") {
      const word = interaction.options.getString("confirmation", true).trim();
      if (word !== "RESET") {
        text = "Confirmation refusée. Écris exactement RESET.";
      } else {
        text = runResetAll(interaction.guild);
      }
    }
    const ok = text.startsWith("✅");
    return interaction.reply({
      content: ok ? text : `❌ ${text}`,
      ephemeral: true,
    });
  },

  async executeMessage(message, args) {
    if (!message.guild) return;
    const send = (text) => message.reply(text);
    if (!memberHasPermOrAdmin(message.member, PermissionFlagsBits.ManageGuild)) {
      return deny(send, "Il faut la permission Gérer le serveur.");
    }
    const sub = String(args[0] || "").toLowerCase();
    if (sub === "set" || sub === "add") {
      const user = await resolveMessageUser(message, args[1]);
      if (!user) return deny(send, "Indique un membre.");
      const amount = parseAmount(args[2], { allowNegative: sub === "add" });
      if (amount == null) {
        return deny(
          send,
          sub === "add"
            ? `Montant entier entre -${ADD_CAP} et ${ADD_CAP}.`
            : `Montant entier entre 0 et ${MAX_XP}.`
        );
      }
      const text = sub === "set"
        ? await runSet(message.guild, user, amount)
        : await runAdd(message.guild, user, amount);
      return send(text.startsWith("✅") ? text : `❌ ${text}`);
    }
    if (sub === "reset" && String(args[1] || "").toLowerCase() === "all") {
      if (args[2] !== "CONFIRM") {
        return deny(send, "Pour tout effacer : `xp reset all CONFIRM`.");
      }
      return send(runResetAll(message.guild));
    }
    if (sub === "reset") {
      const user = await resolveMessageUser(message, args[1]);
      if (!user) return deny(send, "Indique un membre, ou `all CONFIRM`.");
      const text = await runResetUser(message.guild, user);
      return send(text.startsWith("✅") ? text : `❌ ${text}`);
    }
    return deny(
      send,
      "Usage : `xp set @membre montant` · `xp add @membre montant` · `xp reset @membre` · `xp reset all CONFIRM`."
    );
  },
};
