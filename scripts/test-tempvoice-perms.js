/**
 * Test local uniquement — pas d'HTTP, pas de Discord réseau.
 * Usage : node scripts/test-tempvoice-perms.js
 */
const {
  buildTempVoiceOverwrites,
  CONNECT,
} = require("../lib/tempVoicePermissions");
const { formatTempVoiceName } = require("../lib/tempVoiceNames");
const { parseHubConfig } = require("../lib/tempVoiceConfig");

const hub = parseHubConfig({
  enabled: true,
  access_role_ids: [],
  moderator_role_ids: ["999999999999999999"],
  creator_perms: { manage_channel: false },
  whitelist_perms: { mic: true, video: true, soundboard: true, status: true },
});

const state = {
  owner_id: "111111111111111111",
  mode: "private",
  whitelist_users: ["222222222222222222"],
  whitelist_roles: [],
  blacklist_users: ["333333333333333333"],
  blacklist_roles: [],
  session_excludes: [],
  mic: true,
  video: false,
  soundboard: true,
  status: true,
};

const overs = buildTempVoiceOverwrites({
  guildId: "444444444444444444",
  botId: "555555555555555555",
  ownerId: state.owner_id,
  mode: state.mode,
  hub,
  state,
  baseOverwrites: [],
});

const byId = Object.fromEntries(overs.map((o) => [o.id, o]));
if (!byId[state.owner_id]) throw new Error("owner missing");
if ((byId["333333333333333333"].deny & CONNECT) === 0n) {
  throw new Error("blacklist should deny connect");
}
if ((byId["222222222222222222"].allow & CONNECT) === 0n) {
  throw new Error("whitelist should allow connect");
}

const name = formatTempVoiceName("Salon {index} {user}", {
  member: { displayName: "Alice", user: { username: "alice", tag: "alice#0" } },
  index: 3,
  customWords: ["licorne"],
});
if (!name.includes("3") || !name.includes("Alice")) throw new Error("name format");

console.log("ok", name);
