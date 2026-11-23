const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const {
  getBirthdayConfig,
  getMemberBirthday,
  setMemberBirthday,
  setMemberBirthdayEnabled,
  deleteMemberBirthday,
  listUpcomingBirthdays,
} = require("../../database");
const {
  parseBirthdayDate,
  formatBirthdayDate,
  MAX_CHANGE_COOLDOWN_MS,
} = require("../../lib/birthdayConfig");
const { memberHasPermOrAdmin } = require("../../memberPerms");
const { resolveMessageUser } = require("../../lib/resolveTargets");

function deny(send, text) {
  return send(`❌ ${text}`);
}

function canChange(row) {
  if (!row?.updated_at) return true;
  return Date.now() - Number(row.updated_at || 0) >= MAX_CHANGE_COOLDOWN_MS;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("Gérer ton anniversaire sur ce serveur")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Définir ta date (JJ/MM ou JJ/MM/AAAA)")
        .addStringOption((o) =>
          o.setName("date").setDescription("Exemple : 23/11").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Retirer ta date d'anniversaire")
    )
    .addSubcommand((sub) =>
      sub
        .setName("toggle")
        .setDescription("Activer ou masquer ton anniversaire sur ce serveur")
        .addBooleanOption((o) =>
          o.setName("visible").setDescription("Visible").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Prochains anniversaires")
    )
    .addSubcommand((sub) =>
      sub
        .setName("admin-set")
        .setDescription("Définir l'anniversaire d'un membre (Gérer le serveur)")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("date").setDescription("JJ/MM").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("admin-remove")
        .setDescription("Supprimer l'anniversaire d'un membre (Gérer le serveur)")
        .addUserOption((o) =>
          o.setName("membre").setDescription("Membre").setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ Serveur uniquement.", ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    const cfg = getBirthdayConfig(interaction.guildId);

    if (sub === "list") {
      const rows = listUpcomingBirthdays(interaction.guildId, 12);
      if (!rows.length) {
        return interaction.reply({ content: "Aucun anniversaire enregistré.", ephemeral: true });
      }
      const lines = rows.map((row) => {
        const date = formatBirthdayDate(row);
        return `<@${row.user_id}> · **${date}**${row.enabled ? "" : " _(masqué)_"}`;
      });
      return interaction.reply({
        content: `Prochains anniversaires :\n${lines.join("\n")}`,
        ephemeral: false,
      });
    }

    if (sub === "set") {
      const parsed = parseBirthdayDate(interaction.options.getString("date", true));
      if (!parsed) {
        return interaction.reply({
          content: "❌ Date invalide. Exemple : `23/11` ou `23/11/2001`.",
          ephemeral: true,
        });
      }
      const current = getMemberBirthday(interaction.guildId, interaction.user.id);
      if (current && !canChange(current)) {
        return interaction.reply({
          content: "❌ Tu pourras modifier ta date dans 24 h.",
          ephemeral: true,
        });
      }
      setMemberBirthday(interaction.guildId, interaction.user.id, {
        ...parsed,
        enabled: true,
      });
      return interaction.reply({
        content: `✅ Anniversaire enregistré : **${formatBirthdayDate(parsed)}**${cfg.enabled ? "" : " (module encore désactivé sur le serveur)"}`,
        ephemeral: true,
      });
    }

    if (sub === "remove") {
      deleteMemberBirthday(interaction.guildId, interaction.user.id);
      return interaction.reply({ content: "✅ Date retirée.", ephemeral: true });
    }

    if (sub === "toggle") {
      const visible = interaction.options.getBoolean("visible", true);
      const row = getMemberBirthday(interaction.guildId, interaction.user.id);
      if (!row) {
        return interaction.reply({
          content: "❌ Tu n'as pas encore défini de date. `/birthday set`",
          ephemeral: true,
        });
      }
      setMemberBirthdayEnabled(interaction.guildId, interaction.user.id, visible);
      return interaction.reply({
        content: visible ? "✅ Anniversaire visible." : "✅ Anniversaire masqué.",
        ephemeral: true,
      });
    }

    if (!memberHasPermOrAdmin(interaction.member, PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "❌ Il faut Gérer le serveur.",
        ephemeral: true,
      });
    }

    if (sub === "admin-set") {
      const user = interaction.options.getUser("membre", true);
      const parsed = parseBirthdayDate(interaction.options.getString("date", true));
      if (!parsed || user.bot) {
        return interaction.reply({ content: "❌ Date ou membre invalide.", ephemeral: true });
      }
      setMemberBirthday(interaction.guildId, user.id, { ...parsed, enabled: true });
      return interaction.reply({
        content: `✅ ${user.username} : **${formatBirthdayDate(parsed)}**`,
        ephemeral: true,
      });
    }

    if (sub === "admin-remove") {
      const user = interaction.options.getUser("membre", true);
      deleteMemberBirthday(interaction.guildId, user.id);
      return interaction.reply({ content: `✅ Date de ${user.username} retirée.`, ephemeral: true });
    }
  },

  async executeMessage(message, args) {
    if (!message.guild) return;
    const send = (t) => message.reply(t);
    const sub = String(args[0] || "").toLowerCase();

    if (sub === "list") {
      const rows = listUpcomingBirthdays(message.guild.id, 12);
      if (!rows.length) return send("Aucun anniversaire enregistré.");
      return send(
        rows
          .map((row) => `<@${row.user_id}> · **${formatBirthdayDate(row)}**`)
          .join("\n")
      );
    }
    if (sub === "set") {
      const parsed = parseBirthdayDate(args[1]);
      if (!parsed) return deny(send, "Usage : `birthday set 23/11`");
      const current = getMemberBirthday(message.guild.id, message.author.id);
      if (current && !canChange(current)) return deny(send, "Modifiable dans 24 h.");
      setMemberBirthday(message.guild.id, message.author.id, { ...parsed, enabled: true });
      return send(`✅ Enregistré : **${formatBirthdayDate(parsed)}**`);
    }
    if (sub === "remove") {
      deleteMemberBirthday(message.guild.id, message.author.id);
      return send("✅ Date retirée.");
    }
    if (sub === "on" || sub === "off") {
      const row = getMemberBirthday(message.guild.id, message.author.id);
      if (!row) return deny(send, "Définis d'abord une date.");
      setMemberBirthdayEnabled(message.guild.id, message.author.id, sub === "on");
      return send(sub === "on" ? "✅ Visible." : "✅ Masqué.");
    }
    if (sub === "admin") {
      if (!memberHasPermOrAdmin(message.member, PermissionFlagsBits.ManageGuild)) {
        return deny(send, "Il faut Gérer le serveur.");
      }
      const action = String(args[1] || "").toLowerCase();
      const user = await resolveMessageUser(message, args[2]);
      if (!user) return deny(send, "Indique un membre.");
      if (action === "set") {
        const parsed = parseBirthdayDate(args[3]);
        if (!parsed) return deny(send, "`birthday admin set @membre 23/11`");
        setMemberBirthday(message.guild.id, user.id, { ...parsed, enabled: true });
        return send(`✅ ${user.username} : **${formatBirthdayDate(parsed)}**`);
      }
      if (action === "remove") {
        deleteMemberBirthday(message.guild.id, user.id);
        return send(`✅ Date de ${user.username} retirée.`);
      }
    }
    return deny(
      send,
      "Usage : `birthday set 23/11` · `remove` · `list` · `on`/`off` · admin : `birthday admin set @user 23/11`"
    );
  },
};
