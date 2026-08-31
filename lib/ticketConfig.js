/**
 * Configuration tickets — customId, catégories, composants Discord.
 */
const PREFIX = "wingbot:ticket";

const UI_MODES = new Set(["buttons", "select"]);

function slugKey(label, index) {
  const base = String(label || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base || `cat-${index + 1}`;
}

function parseCategories(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (!c || typeof c !== "object") continue;
      const label = String(c.label || "").trim().slice(0, 80);
      if (!label) continue;
      let key = String(c.key || slugKey(label, i))
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 32);
      if (!key || seen.has(key)) key = slugKey(label, i);
      seen.add(key);
      const emoji = String(c.emoji || "🎫").trim().slice(0, 32) || "🎫";
      out.push({
        key,
        label,
        emoji,
        description: String(c.description || "").trim().slice(0, 100),
      });
      if (out.length >= 25) break;
    }
    return out;
  } catch {
    return [];
  }
}

function parseSupportRoleIds(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x || "").replace(/\D/g, "")).filter((id) => /^\d{17,20}$/.test(id)))];
  }
  if (typeof raw === "string") {
    return [...new Set(raw.match(/\d{17,20}/g) || [])];
  }
  return [];
}

function openButtonCustomId(panelId, categoryKey) {
  return `${PREFIX}:open:${panelId}:${categoryKey}`;
}

function openSelectCustomId(panelId) {
  return `${PREFIX}:select:${panelId}`;
}

function closeCustomId(ticketId) {
  return `${PREFIX}:close:${ticketId}`;
}

function claimCustomId(ticketId) {
  return `${PREFIX}:claim:${ticketId}`;
}

function parseTicketCustomId(customId) {
  if (!customId || !String(customId).startsWith(`${PREFIX}:`)) return null;
  const parts = String(customId).split(":");
  if (parts.length < 3) return null;
  const action = parts[2];
  if (action === "open" && parts.length >= 5) {
    return {
      action: "open",
      panelId: Number(parts[3]),
      categoryKey: parts.slice(4).join(":"),
    };
  }
  if (action === "select" && parts.length >= 4) {
    return { action: "select", panelId: Number(parts[3]) };
  }
  if (action === "close" && parts.length >= 4) {
    return { action: "close", ticketId: Number(parts[3]) };
  }
  if (action === "claim" && parts.length >= 4) {
    return { action: "claim", ticketId: Number(parts[3]) };
  }
  return null;
}

function parseEmojiForApi(emoji) {
  const s = String(emoji || "").trim();
  if (!s) return undefined;
  const m = s.match(/^<a?:(\w+):(\d+)>$/);
  if (m) return { id: m[2], name: m[1], animated: s.startsWith("<a:") };
  return { name: s.slice(0, 2) };
}

function buildPanelComponents(panel) {
  const categories = panel.categories || [];
  if (!categories.length) return [];

  if (panel.ui_mode === "select" || categories.length > 5) {
    return [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: openSelectCustomId(panel.id),
            placeholder: "Ouvrir un ticket…",
            min_values: 1,
            max_values: 1,
            options: categories.slice(0, 25).map((c) => ({
              label: c.label.slice(0, 100),
              value: c.key.slice(0, 100),
              description: c.description ? c.description.slice(0, 100) : undefined,
              emoji: parseEmojiForApi(c.emoji),
            })),
          },
        ],
      },
    ];
  }

  const row = {
    type: 1,
    components: categories.slice(0, 5).map((c) => ({
      type: 2,
      style: 1,
      label: c.label.slice(0, 80),
      emoji: parseEmojiForApi(c.emoji),
      custom_id: openButtonCustomId(panel.id, c.key),
    })),
  };
  return [row];
}

function defaultPanelContent() {
  return "Besoin d'aide ? Ouvre un ticket ci-dessous — un salon privé sera créé pour toi et l'équipe.";
}

function defaultWelcomeContent({ opener, categoryLabel, ticketNumber }) {
  return (
    `Bonjour ${opener} !\n\n` +
    `Ticket **#${ticketNumber}** · ${categoryLabel}\n` +
    `Décris ta demande en détail. L'équipe te répondra dès que possible.\n\n` +
    `• **Prendre en charge** — réservé au staff\n` +
    `• **Fermer** — toi ou le staff`
  );
}

module.exports = {
  PREFIX,
  UI_MODES,
  slugKey,
  parseCategories,
  parseSupportRoleIds,
  openButtonCustomId,
  openSelectCustomId,
  closeCustomId,
  claimCustomId,
  parseTicketCustomId,
  parseEmojiForApi,
  buildPanelComponents,
  defaultPanelContent,
  defaultWelcomeContent,
};
