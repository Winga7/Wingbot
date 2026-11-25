/** Test local — pas d'HTTP. node scripts/test-automation-config.js */
const {
  parseAutoresponseConfig,
  messageMatchesTrigger,
  applyAutoresponseVars,
} = require("../lib/autoresponseConfig");
const { parseAutoActionsConfig } = require("../lib/autoActionsConfig");
const {
  parseAutothreadConfig,
  applyThreadName,
} = require("../lib/autothreadConfig");

const ar = parseAutoresponseConfig({
  enabled: true,
  responses: [
    {
      trigger: "bonjour",
      match: "contains",
      response: "Salut {username} !",
      reactions: ["👋", "👋"],
      cooldown_seconds: 99999,
    },
    { trigger: "", response: "x" },
  ],
});
if (!ar.enabled || ar.responses.length !== 1) throw new Error("ar parse");
if (ar.responses[0].reactions.length !== 1) throw new Error("emoji dedupe");
if (ar.responses[0].cooldown_seconds !== 3600) throw new Error("cooldown clamp");
if (!messageMatchesTrigger("Hey bonjour toi", ar.responses[0])) {
  throw new Error("match contains");
}
if (messageMatchesTrigger("salut", ar.responses[0])) throw new Error("no match");
const text = applyAutoresponseVars(ar.responses[0].response, {
  username: "Winga",
});
if (text !== "Salut Winga !") throw new Error("vars");

const aa = parseAutoActionsConfig({
  enabled: true,
  join_roles: { enabled: true, role_ids: ["123456789012345678"], delay_seconds: -5 },
  auto_reacts: [{ channel_ids: ["123456789012345678"], emojis: ["🔥"] }],
});
if (aa.join_roles.delay_seconds !== 0) throw new Error("delay clamp");
if (aa.auto_reacts.length !== 1) throw new Error("react rule");

const at = parseAutothreadConfig({
  enabled: true,
  channels: [
    { channel_id: "123456789012345678", name_format: "💬 {username}", auto_archive_minutes: 99 },
    { channel_id: "123456789012345678", name_format: "dup" },
  ],
});
if (at.channels.length !== 1) throw new Error("channel dedupe");
if (at.channels[0].auto_archive_minutes !== 1440) throw new Error("archive default");
const name = applyThreadName("Fil {username}", { username: "Alex" });
if (name !== "Fil Alex") throw new Error("thread name");

console.log("ok automation");
