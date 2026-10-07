/**
 * Résout un membre / utilisateur pour les commandes slash et préfixe.
 * Le cache Discord est incomplet : un ID valide doit être fetch, sinon
 * /kick, /timeout, /warns… répondent « introuvable ».
 */

function snowflakeFrom(token) {
  const id = String(token || "").replace(/\D/g, "");
  return /^\d{17,20}$/.test(id) ? id : "";
}

async function resolveSlashMember(interaction, optionName) {
  const cached = interaction.options.getMember(optionName);
  if (cached) return cached;
  const user = interaction.options.getUser(optionName);
  if (!user || !interaction.guild) return null;
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

async function resolveMessageMember(message, token) {
  const id = snowflakeFrom(token);
  if (id) {
    const cached =
      message.mentions.members?.get(id) || message.guild.members.cache.get(id);
    if (cached) return cached;
    return message.guild.members.fetch(id).catch(() => null);
  }
  return message.mentions.members?.first() || null;
}

async function resolveMessageUser(message, token) {
  const id = snowflakeFrom(token);
  if (id) {
    const cached =
      message.mentions.users?.get(id) || message.client.users.cache.get(id);
    if (cached) return cached;
    return message.client.users.fetch(id).catch(() => null);
  }
  return message.mentions.users?.first() || null;
}

module.exports = {
  snowflakeFrom,
  resolveSlashMember,
  resolveMessageMember,
  resolveMessageUser,
};
