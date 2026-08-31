/**
 * Configuration tickets — customId, catégories, composants Discord, paramètres.
 */
const PREFIX = "wingbot:ticket";

const UI_MODES = new Set(["buttons", "select"]);
const BUTTON_STYLES = new Set(["primary", "secondary", "success", "danger"]);
const CLOSE_ALLOWED = new Set(["opener", "staff", "both"]);
const MODAL_FIELD_STYLES = new Set(["short", "paragraph"]);

const DEFAULT_PANEL_SETTINGS = {
  delete_channel_on_close: true,
  delete_delay_seconds: 5,
  transcript_enabled: false,
  transcript_channel_id: null,
  claim_enabled: true,
  close_allowed: "both",
  claim_role_ids: [],
  channel_name_template: "ticket-{number}-{user}",
  use_default_channel_name: true,
  modal_enabled: false,
  welcome_embed_color: 0x5865f2,
  claim_button_label: "Prendre en charge",
  close_button_label: "Fermer",
  show_claim_button: true,
  show_close_button: true,
};

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

function parseModalFields(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < 5; i++) {
    const f = raw[i];
    if (!f || typeof f !== "object") continue;
    const label = String(f.label || "").trim().slice(0, 45);
    if (!label) continue;
    out.push({
      id: String(f.id || `field_${i}`).slice(0, 32),
      label,
      placeholder: String(f.placeholder || "").slice(0, 100),
      style: MODAL_FIELD_STYLES.has(f.style) ? f.style : "short",
      required: f.required !== false,
      min_length: Math.max(0, Math.min(4000, Number(f.min_length) || 0)),
      max_length: Math.max(1, Math.min(4000, Number(f.max_length) || (f.style === "paragraph" ? 1000 : 200))),
    });
  }
  return out;
}

function parseCategoryItem(c, i, seen) {
  if (!c || typeof c !== "object") return null;
  const label = String(c.label || "").trim().slice(0, 80);
  if (!label) return null;
  let key = String(c.key || slugKey(label, i))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
  if (!key || seen.has(key)) key = slugKey(label, i);
  seen.add(key);
  const emoji = String(c.emoji || "🎫").trim().slice(0, 32) || "🎫";
  const buttonStyle = BUTTON_STYLES.has(c.button_style) ? c.button_style : "primary";
  return {
    key,
    label,
    emoji,
    description: String(c.description || "").trim().slice(0, 100),
    button_style: buttonStyle,
    emoji_only: !!c.emoji_only,
    ticket_category_id: c.ticket_category_id ? String(c.ticket_category_id) : null,
    support_role_ids: parseSupportRoleIds(c.support_role_ids),
    claim_role_ids: parseSupportRoleIds(c.claim_role_ids),
    modal_enabled: c.modal_enabled === true ? true : c.modal_enabled === false ? false : null,
    modal_fields: parseModalFields(c.modal_fields),
    channel_name_template: c.channel_name_template
      ? String(c.channel_name_template).slice(0, 100)
      : null,
    delete_channel_on_close:
      c.delete_channel_on_close === true
        ? true
        : c.delete_channel_on_close === false
          ? false
          : null,
    transcript_enabled:
      c.transcript_enabled === true
        ? true
        : c.transcript_enabled === false
          ? false
          : null,
    claim_enabled:
      c.claim_enabled === true ? true : c.claim_enabled === false ? false : null,
    close_allowed: CLOSE_ALLOWED.has(c.close_allowed) ? c.close_allowed : null,
    welcome_title: c.welcome_title ? String(c.welcome_title).slice(0, 256) : null,
    welcome_description: c.welcome_description
      ? String(c.welcome_description).slice(0, 4096)
      : null,
    welcome_embed_color:
      c.welcome_embed_color != null ? parseEmbedColor(c.welcome_embed_color) : null,
  };
}

function parseCategories(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) {
      const item = parseCategoryItem(arr[i], i, seen);
      if (item) out.push(item);
      if (out.length >= 25) break;
    }
    return out;
  } catch {
    return [];
  }
}

function parseEmbedColor(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw & 0xffffff;
  const s = String(raw || "").trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) return parseInt(s.replace(/^#/, ""), 16);
  return DEFAULT_PANEL_SETTINGS.welcome_embed_color;
}

function parsePanelSettings(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw || "{}");
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== "object") obj = {};
  return {
    delete_channel_on_close:
      obj.delete_channel_on_close !== false,
    delete_delay_seconds: Math.min(
      120,
      Math.max(0, Number(obj.delete_delay_seconds) || 5)
    ),
    transcript_enabled: !!obj.transcript_enabled,
    transcript_channel_id: obj.transcript_channel_id
      ? String(obj.transcript_channel_id)
      : null,
    claim_enabled: obj.claim_enabled !== false,
    close_allowed: CLOSE_ALLOWED.has(obj.close_allowed)
      ? obj.close_allowed
      : "both",
    claim_role_ids: parseSupportRoleIds(obj.claim_role_ids),
    channel_name_template: String(
      obj.channel_name_template || DEFAULT_PANEL_SETTINGS.channel_name_template
    ).slice(0, 100),
    use_default_channel_name: obj.use_default_channel_name !== false,
    modal_enabled: !!obj.modal_enabled,
    welcome_embed_color: parseEmbedColor(
      obj.welcome_embed_color ?? DEFAULT_PANEL_SETTINGS.welcome_embed_color
    ),
    claim_button_label: String(
      obj.claim_button_label || DEFAULT_PANEL_SETTINGS.claim_button_label
    ).slice(0, 80),
    close_button_label: String(
      obj.close_button_label || DEFAULT_PANEL_SETTINGS.close_button_label
    ).slice(0, 80),
    show_claim_button: obj.show_claim_button !== false,
    show_close_button: obj.show_close_button !== false,
  };
}

function resolveCategorySetting(category, panel, key) {
  if (category && category[key] != null && category[key] !== "") {
    return category[key];
  }
  const settings = panel.settings || DEFAULT_PANEL_SETTINGS;
  if (settings[key] != null) return settings[key];
  return DEFAULT_PANEL_SETTINGS[key];
}

function resolveCategoryRoles(category, panel) {
  const support =
    category?.support_role_ids?.length > 0
      ? category.support_role_ids
      : panel.support_role_ids || [];
  const claim =
    category?.claim_role_ids?.length > 0
      ? category.claim_role_ids
      : panel.settings?.claim_role_ids?.length > 0
        ? panel.settings.claim_role_ids
        : support;
  return { support_role_ids: support, claim_role_ids: claim };
}

function resolveTicketCategoryId(category, panel) {
  return category?.ticket_category_id || panel.ticket_category_id;
}

function isModalEnabled(category, panel) {
  if (category?.modal_enabled === true) return true;
  if (category?.modal_enabled === false) return false;
  if (panel.settings?.modal_enabled) return true;
  return (category?.modal_fields || []).length > 0;
}

function parseSupportRoleIds(raw) {
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .map((x) => String(x || "").replace(/\D/g, ""))
          .filter((id) => /^\d{17,20}$/.test(id))
      ),
    ];
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

function modalCustomId(panelId, categoryKey) {
  return `${PREFIX}:modal:${panelId}:${categoryKey}`;
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
  if (action === "modal" && parts.length >= 5) {
    return {
      action: "modal",
      panelId: Number(parts[3]),
      categoryKey: parts.slice(4).join(":"),
    };
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

function buttonStyleToInt(style) {
  switch (style) {
    case "secondary":
      return 2;
    case "success":
      return 3;
    case "danger":
      return 4;
    default:
      return 1;
  }
}

function buildPanelComponents(panel) {
  const categories = panel.categories || [];
  if (!categories.length) return [];

  const forceSelect = panel.ui_mode === "select";
  if (forceSelect || categories.length > 25) {
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

  const rows = [];
  for (let i = 0; i < categories.length; i += 5) {
    const chunk = categories.slice(i, i + 5);
    rows.push({
      type: 1,
      components: chunk.map((c) => {
        const btn = {
          type: 2,
          style: buttonStyleToInt(c.button_style),
          emoji: parseEmojiForApi(c.emoji),
          custom_id: openButtonCustomId(panel.id, c.key),
        };
        if (!c.emoji_only) btn.label = c.label.slice(0, 80);
        return btn;
      }),
    });
  }
  return rows;
}

function buildOpenModal(panel, category) {
  const fields =
    category.modal_fields?.length > 0
      ? category.modal_fields
      : [
          {
            id: "reason",
            label: "Décris ta demande",
            placeholder: "Explique ton problème en détail…",
            style: "paragraph",
            required: true,
            min_length: 10,
            max_length: 1000,
          },
        ];
  return {
    custom_id: modalCustomId(panel.id, category.key),
    title: `${category.emoji || "🎫"} ${category.label}`.slice(0, 45),
    components: fields.map((f) => ({
      type: 1,
      components: [
        {
          type: 4,
          custom_id: f.id.slice(0, 100),
          label: f.label.slice(0, 45),
          style: f.style === "paragraph" ? 2 : 1,
          placeholder: f.placeholder ? f.placeholder.slice(0, 100) : undefined,
          required: f.required !== false,
          min_length: f.min_length || undefined,
          max_length: f.max_length || undefined,
        },
      ],
    })),
  };
}

function applyChannelNameTemplate(template, ctx) {
  const user = String(ctx.username || "user")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 18);
  const category = String(ctx.categoryKey || "ticket")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 12);
  const categoryLabel = String(ctx.categoryLabel || "ticket")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 16);
  let name = String(template || DEFAULT_PANEL_SETTINGS.channel_name_template)
    .replace(/\{number\}/gi, String(ctx.ticketNumber || "0"))
    .replace(/\{user\}/gi, user || "user")
    .replace(/\{category\}/gi, category)
    .replace(/\{label\}/gi, categoryLabel)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!name) name = `ticket-${ctx.ticketNumber || "0"}`;
  return name.slice(0, 100);
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
    `• **Fermer** — selon les permissions configurées`
  );
}

function buildFormDataEmbed(formData, category) {
  if (!formData || !Object.keys(formData).length) return null;
  const fields = Object.entries(formData).map(([key, value]) => ({
    name: key.slice(0, 256),
    value: String(value || "—").slice(0, 1024),
  }));
  return {
    color: category?.welcome_embed_color ?? 0x5865f2,
    title: "Informations du ticket",
    fields,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  PREFIX,
  UI_MODES,
  BUTTON_STYLES,
  CLOSE_ALLOWED,
  DEFAULT_PANEL_SETTINGS,
  slugKey,
  parseCategories,
  parsePanelSettings,
  parseSupportRoleIds,
  parseModalFields,
  resolveCategorySetting,
  resolveCategoryRoles,
  resolveTicketCategoryId,
  isModalEnabled,
  openButtonCustomId,
  openSelectCustomId,
  modalCustomId,
  closeCustomId,
  claimCustomId,
  parseTicketCustomId,
  parseEmojiForApi,
  buildPanelComponents,
  buildOpenModal,
  applyChannelNameTemplate,
  defaultPanelContent,
  defaultWelcomeContent,
  buildFormDataEmbed,
  parseEmbedColor,
};
