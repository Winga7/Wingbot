/** Attribution des rôles récompense. N'enlève jamais un rôle que le bot ne peut pas gérer. */

function botTopPosition(guild, me) {
  return me?.roles?.highest?.position ?? 0;
}

function canManageRole(guild, me, role) {
  if (!role || !me) return false;
  if (role.managed) return false;
  if (role.id === guild.id) return false;
  return role.position < botTopPosition(guild, me);
}

async function guildMe(guild) {
  return guild.members.me || guild.members.fetchMe().catch(() => null);
}

async function syncLevelRoles(member, level, config) {
  const guild = member.guild;
  const me = await guildMe(guild);
  if (!me) return;
  const rewards = (config.rewards || []).filter((row) => row.level <= level);
  const rewardIds = new Set((config.rewards || []).map((row) => row.role_id));

  if (!config.stack_roles) {
    const best = rewards.reduce(
      (acc, row) => (!acc || row.level >= acc.level ? row : acc),
      null
    );
    const bestRole = best ? guild.roles.cache.get(best.role_id) : null;
    const bestOk = canManageRole(guild, me, bestRole);
    const toRemove = member.roles.cache.filter((role) => {
      if (!rewardIds.has(role.id)) return false;
      if (bestOk && role.id === bestRole.id) return false;
      return canManageRole(guild, me, role);
    });
    if (toRemove.size) {
      await member.roles.remove(toRemove, "Niveau Wingbot").catch((error) => {
        console.error("[levels] retrait rôle :", error?.message || error);
      });
    }
    if (bestOk && !member.roles.cache.has(bestRole.id)) {
      await member.roles.add(bestRole, "Niveau Wingbot").catch((error) => {
        console.error("[levels] ajout rôle :", error?.message || error);
      });
    }
    return;
  }

  const toAdd = rewards
    .map((row) => guild.roles.cache.get(row.role_id))
    .filter((role) => canManageRole(guild, me, role) && !member.roles.cache.has(role.id));
  if (toAdd.length) {
    await member.roles.add(toAdd, "Niveau Wingbot").catch((error) => {
      console.error("[levels] ajout rôles :", error?.message || error);
    });
  }
}

async function clearLevelRoles(member, config) {
  const guild = member.guild;
  const me = await guildMe(guild);
  if (!me) return;
  const rewardIds = new Set((config.rewards || []).map((row) => row.role_id));
  const toRemove = member.roles.cache.filter(
    (role) => rewardIds.has(role.id) && canManageRole(guild, me, role)
  );
  if (!toRemove.size) return;
  await member.roles.remove(toRemove, "Niveau Wingbot remis à zéro").catch((error) => {
    console.error("[levels] retrait rôles :", error?.message || error);
  });
}

module.exports = {
  syncLevelRoles,
  clearLevelRoles,
};
