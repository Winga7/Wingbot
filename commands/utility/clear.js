const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription(
      "Supprime des messages dans le canal (par défaut: max possible)"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName("nombre")
        .setDescription("Nombre de messages à supprimer (1-100)")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName("utilisateur")
        .setDescription("Supprime uniquement les messages de cet utilisateur")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Type de messages à supprimer")
        .setRequired(false)
        .addChoices(
          { name: "Messages avec images", value: "images" },
          { name: "Messages avec embeds", value: "embeds" },
          { name: "Messages avec liens", value: "links" },
          { name: "Messages avec @everyone", value: "mentions" }
        )
    ),

  async execute(interaction) {
    // Vérifier les permissions
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      return interaction.reply({
        content: "❌ Vous n'avez pas la permission de gérer les messages.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const nombre = interaction.options.getInteger("nombre");
      const utilisateur = interaction.options.getUser("utilisateur");
      const type = interaction.options.getString("type");

      const channel = interaction.channel;
      let deletedCount = 0;

      // Si aucune option n'est spécifiée, supprimer le maximum possible
      if (!nombre && !utilisateur && !type) {
        const messages = await channel.messages.fetch({ limit: 100 });
        const filteredMessages = messages.filter(
          (msg) => msg.createdTimestamp > Date.now() - 14 * 24 * 60 * 60 * 1000
        );

        if (filteredMessages.size === 0) {
          return interaction.editReply(
            "❌ Aucun message récent à supprimer (messages de moins de 14 jours)."
          );
        }

        await channel.bulkDelete(filteredMessages);
        deletedCount = filteredMessages.size;
      } else {
        // Déterminer la limite de messages à récupérer
        const limite = nombre || 100;

        const messages = await channel.messages.fetch({ limit: limite });
        let filteredMessages = messages.filter(
          (msg) => msg.createdTimestamp > Date.now() - 14 * 24 * 60 * 60 * 1000
        );

        // Filtrer par utilisateur si spécifié
        if (utilisateur) {
          filteredMessages = filteredMessages.filter(
            (msg) => msg.author.id === utilisateur.id
          );
        }

        // Filtrer par type si spécifié
        if (type) {
          switch (type) {
            case "images":
              filteredMessages = filteredMessages.filter(
                (msg) => msg.attachments.size > 0
              );
              break;
            case "embeds":
              filteredMessages = filteredMessages.filter(
                (msg) => msg.embeds.length > 0
              );
              break;
            case "links":
              filteredMessages = filteredMessages.filter((msg) =>
                msg.content.includes("http")
              );
              break;
            case "mentions":
              filteredMessages = filteredMessages.filter(
                (msg) =>
                  msg.content.includes("@everyone") ||
                  msg.content.includes("@here")
              );
              break;
          }
        }

        if (filteredMessages.size === 0) {
          return interaction.editReply(
            "❌ Aucun message correspondant aux critères trouvé."
          );
        }

        await channel.bulkDelete(filteredMessages);
        deletedCount = filteredMessages.size;
      }

      await interaction.editReply(
        `✅ ${deletedCount} message(s) supprimé(s) avec succès !`
      );
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
      await interaction.editReply(
        "❌ Une erreur s'est produite lors de la suppression des messages."
      );
    }
  },

  executeMessage(message, args) {
    // Commande avec préfixe $ - peut prendre un nombre en argument
    if (!message.member.permissions.has("ManageMessages")) {
      return message.reply(
        "❌ Vous n'avez pas la permission de gérer les messages."
      );
    }

    // Récupérer le canal avant de supprimer le message
    const channel = message.channel;

    // Déterminer le nombre de messages à supprimer
    let nombre = 100; // Par défaut, maximum possible
    if (args.length > 0) {
      const argNombre = parseInt(args[0]);
      if (!isNaN(argNombre) && argNombre > 0 && argNombre <= 100) {
        nombre = argNombre;
      }
    }

    // Supprimer le message de commande
    message.delete().catch(() => {});

    // Attendre un peu puis procéder
    setTimeout(() => {
      channel.messages
        .fetch({ limit: nombre })
        .then((messages) => {
          const filteredMessages = messages.filter(
            (msg) =>
              msg.createdTimestamp > Date.now() - 14 * 24 * 60 * 60 * 1000
          );

          if (filteredMessages.size === 0) {
            return channel
              .send(
                "❌ Aucun message récent à supprimer (messages de moins de 14 jours)."
              )
              .then((msg) => setTimeout(() => msg.delete(), 3000));
          }

          return channel.bulkDelete(filteredMessages);
        })
        .then((deletedMessages) => {
          channel
            .send(
              `✅ ${deletedMessages.size} message(s) supprimé(s) avec succès !`
            )
            .then((msg) => setTimeout(() => msg.delete(), 3000));
        })
        .catch((error) => {
          console.error("Erreur:", error);
          channel
            .send(
              "❌ Une erreur s'est produite lors de la suppression des messages."
            )
            .then((msg) => setTimeout(() => msg.delete(), 3000));
        });
    }, 100); // Attendre 100ms
  },
};
