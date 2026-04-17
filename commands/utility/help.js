const { SlashCommandBuilder } = require("discord.js");

const PREFIX_BLOCK = `**📋 Infos**
\`ping\` \`user\` \`userinfo\` \`server\` \`serverlogo\` \`botinfo\` \`roleinfo\` \`avatar\` \`messageinfo\`

**🛡️ Modération**
\`kick\` \`ban\` \`timeout\` \`untimeout\` \`warn\` \`slowmode\` \`clear\`

**⚙️ Admin**
\`setlogchannel\` \`togglelog\` \`logconfig\` \`logtest\` \`clearcache\`

**💎 Premium** _(admin uniquement)_
\`backup create\` \`backup list\` \`backup info <code>\` \`backup delete <code>\` \`backup load <code>\`

**Perso** — réponses configurées sur le dashboard (préfixe uniquement).`;

const SLASH_BLOCK = `**📋 Infos**
\`/ping\` \`/user\` \`/userinfo\` \`/server\` \`/serverlogo\` \`/botinfo\` \`/roleinfo\` \`/avatar\` \`/messageinfo\`

**🛡️ Modération**
\`/kick\` \`/ban\` \`/timeout\` \`/untimeout\` \`/warn\` \`/slowmode\` \`/clear\`

**⚙️ Admin**
\`/setlogchannel\` \`/togglelog\` \`/logconfig\` \`/logtest\` \`/clearcache\`

**💎 Premium** _(admin uniquement)_
\`/backup create\` \`/backup list\` \`/backup info\` \`/backup delete\` \`/backup load\``;

function buildEmbed() {
  return {
    color: 0x6366f1,
    title: "Commandes Wingbot",
    description:
      "Préfixe configurable (défaut `$`) et commandes slash `/`. `help` reste toujours actif.",
    fields: [
      {
        name: "Avec préfixe",
        value: PREFIX_BLOCK,
        inline: false,
      },
      {
        name: "Slash",
        value: SLASH_BLOCK,
        inline: false,
      },
    ],
    timestamp: new Date(),
    footer: { text: "Wingbot" },
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Affiche la liste des commandes disponibles."),
  async execute(interaction) {
    await interaction.reply({ embeds: [buildEmbed()] });
  },
  executeMessage(message) {
    message.reply({ embeds: [buildEmbed()] });
  },
};
