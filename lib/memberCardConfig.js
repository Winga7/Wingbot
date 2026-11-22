/** Cartes image arrivée / départ / expulsion. */

const KINDS = ["join", "leave", "kick"];

const DEFAULTS = {
  join: {
    enabled: false,
    channel_id: null,
    title: "BIENVENUE",
    title_color: "#39FF14",
    name_text: "{username}",
    name_color: "#5DFF4A",
    name_uppercase: true,
    message: "BIENVENUE {username} TU ES LE {memberCount} MEMBRES !",
    text_color: "#FFFFFF",
    ring_color: "#39FF14",
    background: "",
    show_avatar: true,
    content: "",
  },
  leave: {
    enabled: false,
    channel_id: null,
    title: "AU REVOIR",
    title_color: "#39FF14",
    name_text: "{username}",
    name_color: "#5DFF4A",
    name_uppercase: true,
    message: "{username} A QUITTÉ {server}.",
    text_color: "#FFFFFF",
    ring_color: "#39FF14",
    background: "",
    show_avatar: true,
    content: "",
  },
  kick: {
    enabled: false,
    channel_id: null,
    title: "EXPULSÉ",
    title_color: "#FF4D4D",
    name_text: "{username}",
    name_color: "#FF8A8A",
    name_uppercase: true,
    message: "{username} A ÉTÉ EXPULSÉ PAR {moderatorName}.",
    text_color: "#FFFFFF",
    ring_color: "#FF4D4D",
    background: "",
    show_avatar: true,
    content: "",
  },
};

function clip(value, max) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .slice(0, max);
}

function cleanColor(value, fallback) {
  const s = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback;
}

function cleanChannelId(value) {
  const s = String(value ?? "").trim();
  return /^\d{17,20}$/.test(s) ? s : null;
}

function cleanBackground(value) {
  const s = String(value ?? "").trim();
  if (!s || s.toLowerCase() === "transparent") return "";
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : "";
}

function normalizeCard(kind, input) {
  const base = { ...DEFAULTS[kind] };
  const src = input && typeof input === "object" ? input : {};
  if ("enabled" in src) base.enabled = !!src.enabled;
  if ("channel_id" in src) base.channel_id = cleanChannelId(src.channel_id);
  if ("title" in src) base.title = clip(src.title, 48).replace(/\n/g, " ");
  if ("title_color" in src) base.title_color = cleanColor(src.title_color, base.title_color);
  if ("name_text" in src) base.name_text = clip(src.name_text, 80).replace(/\n/g, " ");
  if ("name_color" in src) base.name_color = cleanColor(src.name_color, base.name_color);
  if ("name_uppercase" in src) base.name_uppercase = !!src.name_uppercase;
  if ("message" in src) base.message = clip(src.message, 500);
  if ("text_color" in src) base.text_color = cleanColor(src.text_color, base.text_color);
  if ("ring_color" in src) base.ring_color = cleanColor(src.ring_color, base.ring_color);
  if ("background" in src) base.background = cleanBackground(src.background);
  if ("show_avatar" in src) base.show_avatar = !!src.show_avatar;
  if ("content" in src) base.content = clip(src.content, 500);
  return base;
}

function parseMemberCards(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== "object") obj = {};
  return {
    join: normalizeCard("join", obj.join),
    leave: normalizeCard("leave", obj.leave),
    kick: normalizeCard("kick", obj.kick),
  };
}

function applyCardVariables(template, vars) {
  const map = vars && typeof vars === "object" ? vars : {};
  const keys = Object.keys(map);
  return String(template ?? "").replace(/\{([a-zA-Z]+)\}/g, (full, key) => {
    const found = keys.find((k) => k.toLowerCase() === key.toLowerCase());
    if (!found) return full;
    return String(map[found] ?? "");
  });
}

function previewVars({ username, server, memberCount } = {}) {
  const name = String(username || "Membre").slice(0, 32) || "Membre";
  return {
    username: name,
    displayName: name,
    tag: name,
    server: String(server || "Serveur").slice(0, 80) || "Serveur",
    memberCount: String(memberCount || "80"),
    id: "0",
    moderatorName: "Modérateur",
    moderator: "Modérateur",
    user: name,
  };
}

module.exports = {
  KINDS,
  DEFAULTS,
  parseMemberCards,
  normalizeCard,
  applyCardVariables,
  previewVars,
};
