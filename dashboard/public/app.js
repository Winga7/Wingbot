const $ = (id) => document.getElementById(id);

/** Vues routables (#hash) */
const VIEWS = new Set([
  "overview",
  "settings",
  "premium",
  "logs",
  "moderation",
  "warns",
  "embeds",
  "custom",
  "commands",
  "permissions",
  "announcements",
  "templates",
  "autoresponses",
  "actions",
  "autothreads",
  "ticketing",
  "giveaways",
  "levels",
  "leaderboard",
  "stats",
  "tempvoice",
  "starboard",
  "birthdays",
  "social",
]);

/** Onglets pas encore implémentés */
const PLACEHOLDER_VIEWS = {
  premium: {
    title: "Premium",
    desc: "Abonnement par serveur pour débloquer les fonctionnalités avancées — arrive bientôt.",
  },
  templates: {
    title: "Modèles",
    desc: "Enregistre et réutilise des modèles de messages et d’embeds.",
  },
  autoresponses: {
    title: "Réponses auto",
    desc: "Réponds aux mots-clés ou expressions dans les messages du serveur.",
  },
  actions: {
    title: "Actions auto",
    desc: "Déclenche des actions quand un événement se produit sur le serveur.",
  },
  autothreads: {
    title: "Fils auto",
    desc: "Ouvre un fil de discussion sur chaque message d’un salon.",
  },
  ticketing: {
    title: "Tickets",
    desc: "Support et modération via un système de tickets.",
  },
  giveaways: {
    title: "Giveaways",
    desc: "Concours et tirages au sort intégrés à Discord.",
  },
  levels: {
    title: "Niveaux",
    desc: "Récompense l’activité des membres avec de l’expérience.",
  },
  leaderboard: {
    title: "Classement",
    desc: "Podium des membres les plus actifs.",
  },
  stats: {
    title: "Statistiques",
    desc: "Graphiques et métriques d’activité du serveur.",
  },
  tempvoice: {
    title: "Vocaux temp.",
    desc: "Crée des vocaux à la demande, supprimés quand ils sont vides.",
  },
  starboard: {
    title: "Starboard",
    desc: "Met en avant les messages les plus appréciés.",
  },
  birthdays: {
    title: "Anniversaires",
    desc: "Souhaite l’anniversaire de tes membres automatiquement.",
  },
  social: {
    title: "Réseaux sociaux",
    desc: "Alertes Twitch, YouTube et autres intégrations.",
  },
};

const PLACEHOLDER_SET = new Set(Object.keys(PLACEHOLDER_VIEWS));

/** Cache DOM navigation (évite querySelectorAll à chaque changement d’onglet) */
const viewEls = new Map();
const navLinkEls = new Map();
let currentViewName = null;
let embedsLastGuildId = null;

function initViewNavCache() {
  document.querySelectorAll(".view[id^='view-']").forEach((el) => {
    const key = el.id === "view-coming-soon" ? "coming-soon" : el.id.slice(5);
    viewEls.set(key, el);
  });
  document.querySelectorAll(".nav-link[data-view]").forEach((a) => {
    navLinkEls.set(a.dataset.view, a);
  });
}

let manifest = { groups: [] };
let commandManifest = { groups: [], commands: [] };

/** Lignes pour le sélecteur : depuis /api/me/guilds ou repli config */
let guildPickerList = [];

let guilds = [];
/** Dernières listes Discord (UI accès commandes) */
let lastGuildChannelsList = [];
let lastGuildRolesList = [];

/** @type {Record<string, { id: string, name: string, icon_url: string | null }>} */
let guildMeta = {};

/** @type {{
 *   guild_id: string,
 *   feature_flags: Record<string, boolean>,
 *   log_channel_id: string | null,
 *   prefix: string,
 *   logs_master_enabled: boolean,
 *   commands_disabled: string[],
 *   command_groups_disabled: string[],
 *   command_access: {
 *     ignore_channel_ids: string[],
 *     allow_channel_ids: string[],
 *     block_role_ids: string[],
 *     allow_role_ids: string[],
 *     moderation_role_ids: string[],
 *     admin_role_ids: string[],
 *     premium_role_ids: string[],
 *   },
 *   custom_commands: { id?: number, trigger: string, response: string }[]
 * } | null} */
let guildState = null;

const LS_LAST_GUILD_KEY = "wingbot.lastGuildId";

let selectedGuildId = null;
let dirty = false;
let discordOAuthConnected = false;
let appMode = "loading"; // loading | landing | dashboard
let loadDataGen = 0;
let internalAccess = null; // prévu pour futur premium/fondateur (section non visible)
let botProfileState = { avatar_url: "", nickname: "" };

async function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.readAsDataURL(file);
  });
}

function getApiBase() {
  return "";
}

function apiUrl(path) {
  const base = getApiBase();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
  };
}

/** GET avec cookie Discord : pas de Content-Type JSON inutile */
function fetchOptsGet() {
  return {
    credentials: "include",
  };
}

function currentGuildRow() {
  return guildPickerList.find((x) => x.guild_id === selectedGuildId);
}

function currentGuildHasBot() {
  const r = currentGuildRow();
  if (!r) return false;
  return !!r.bot_in_guild;
}

function setDirty(v) {
  dirty = v;
  const canSave = v && selectedGuildId && currentGuildHasBot();
  $("save").disabled = !canSave;
  $("dirty-hint").hidden = !v;
}

function getHashView() {
  const h = (location.hash || "#overview").slice(1);
  return VIEWS.has(h) ? h : "overview";
}

function isPlaceholderView(name) {
  return PLACEHOLDER_SET.has(name);
}

function renderComingSoon(name) {
  const meta = PLACEHOLDER_VIEWS[name];
  if (!meta) return;
  const title = $("coming-soon-title");
  const desc = $("coming-soon-desc");
  const badge = $("coming-soon-badge");
  if (title) title.textContent = meta.title;
  if (desc) desc.textContent = meta.desc;
  if (badge) {
    badge.hidden = false;
    badge.textContent = "Bientôt";
    badge.className = "coming-soon-badge soon";
  }
}

function navigate(force = false) {
  const name = getHashView();
  if (!force && name === currentViewName) return;
  currentViewName = name;

  const isPlaceholder = isPlaceholderView(name);
  const comingSoon = viewEls.get("coming-soon");
  const targetId = isPlaceholder ? "coming-soon" : name;

  for (const [key, el] of viewEls) {
    if (key === "coming-soon") {
      el.hidden = !isPlaceholder;
    } else {
      el.hidden = isPlaceholder || key !== targetId;
    }
  }

  if (isPlaceholder) renderComingSoon(name);

  for (const [view, link] of navLinkEls) {
    link.classList.toggle("active", view === name);
  }

  if (name === "embeds" && window.wingbotEmbedWorkbench && selectedGuildId) {
    const gid = selectedGuildId;
    queueMicrotask(() => {
      if (embedsLastGuildId !== gid) {
        embedsLastGuildId = gid;
        window.wingbotEmbedWorkbench.refresh();
      }
    });
  }

  if (name === "warns" && selectedGuildId && currentGuildHasBot()) {
    queueMicrotask(() => loadWarningsList());
  }

  if (name === "announcements" && selectedGuildId && currentGuildHasBot()) {
    queueMicrotask(() => loadScheduledMessagesList());
  }
}

window.addEventListener("hashchange", navigate);

function setDiscordOAuthHref() {
  const url = apiUrl("/api/auth/discord/login");
  const a = $("discord-oauth-link");
  if (a) a.href = url;
  const landingLogin = $("landing-login-btn");
  if (landingLogin) landingLogin.href = url;
}

function setSidebarNavVisible(visible) {
  const nav = $("sidebar-nav");
  if (!nav) return;
  if (visible) nav.removeAttribute("hidden");
  else nav.setAttribute("hidden", "");
}

function clearOAuthConnectedQuery() {
  try {
    if (!/[?&]discord=connected(?:&|$)/.test(location.search)) return;
    const u = new URL(location.href);
    u.searchParams.delete("discord");
    u.searchParams.delete("reason");
    const qs = u.searchParams.toString();
    history.replaceState(
      null,
      "",
      u.pathname + (qs ? `?${qs}` : "") + u.hash
    );
  } catch {
    /* ignore */
  }
}

/** Relance les animations landing (cassées si la page a booté masquée). */
function restartLandingReveal() {
  const inner = document.querySelector(".landing-inner--reveal");
  if (!inner) return;
  inner.classList.remove("landing-inner--reveal");
  void inner.offsetWidth;
  inner.classList.add("landing-inner--reveal");
}

function showLandingPage() {
  appMode = "landing";
  const app = $("app");
  app?.classList.remove("app--dashboard");
  app?.classList.add("app--landing");
  $("landing-page")?.removeAttribute("hidden");
  $("workspace")?.setAttribute("hidden", "");
  setSidebarNavVisible(false);
  $("stats-section")?.setAttribute("hidden", "");
  $("save-dock")?.setAttribute("hidden", "");
  document.querySelector(".foot")?.setAttribute("hidden", "");
  restartLandingReveal();
  initLandingEffects();
}

function showDashboard() {
  appMode = "dashboard";
  stopLandingEffects();
  const app = $("app");
  app?.classList.add("app--dashboard");
  app?.classList.remove("app--landing");
  $("landing-page")?.setAttribute("hidden", "");
  $("workspace")?.removeAttribute("hidden");
  $("save-dock")?.removeAttribute("hidden");
  document.querySelector(".foot")?.removeAttribute("hidden");
}

async function refreshLandingInvite() {
  try {
    const r = await fetch(apiUrl("/api/bot/invite"), fetchOptsGet());
    if (!r.ok) return;
    const j = await r.json();
    if (!j?.invite_url) return;
    const btn = $("landing-invite-btn");
    if (btn) btn.href = j.invite_url;
  } catch {
    /* silencieux */
  }
}

function initNavSections() {
  document.querySelectorAll(".nav-section").forEach((section) => {
    const key = section.dataset.navSection;
    const head = section.querySelector(".nav-section-head");
    if (!head) return;

    const lsKey = `wingbot.navSection.${key}`;
    let collapsed = section.classList.contains("collapsed");
    try {
      const stored = localStorage.getItem(lsKey);
      if (stored === "collapsed") collapsed = true;
      else if (stored === "open") collapsed = false;
    } catch {
      /* garde l’état HTML par défaut */
    }
    section.classList.toggle("collapsed", collapsed);
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");

    head.addEventListener("click", () => {
      const nowCollapsed = !section.classList.contains("collapsed");
      section.classList.toggle("collapsed", nowCollapsed);
      head.setAttribute("aria-expanded", nowCollapsed ? "false" : "true");
      try {
        localStorage.setItem(lsKey, nowCollapsed ? "collapsed" : "open");
      } catch {
        /* ignore */
      }
    });
  });
}

const landingFx = {
  active: false,
  typeIdx: 0,
  charIdx: 0,
  typeTimer: null,
  phrases: [
    "Configuration enregistrée depuis le dashboard.",
    "Log envoyé · Membre expulsé par @Admin",
    "Commande /ban activée pour ce serveur.",
    "$règles → réponse envoyée avec succès.",
  ],
  onMove: null,
};

function stopLandingEffects() {
  if (!landingFx.active) return;
  landingFx.active = false;
  if (landingFx.typeTimer) clearTimeout(landingFx.typeTimer);
  landingFx.typeTimer = null;
  if (landingFx.onMove) {
    document.removeEventListener("mousemove", landingFx.onMove);
    landingFx.onMove = null;
  }
}

function landingTypewriterTick() {
  if (!landingFx.active) return;
  const el = $("landing-typewriter");
  if (!el) return;

  const phrase = landingFx.phrases[landingFx.typeIdx % landingFx.phrases.length];
  el.classList.remove("done");
  el.textContent = phrase.slice(0, landingFx.charIdx);

  if (landingFx.charIdx < phrase.length) {
    landingFx.charIdx += 1;
    landingFx.typeTimer = setTimeout(landingTypewriterTick, 28 + Math.random() * 32);
    return;
  }

  el.classList.add("done");
  landingFx.typeTimer = setTimeout(() => {
    landingFx.typeIdx += 1;
    landingFx.charIdx = 0;
    landingTypewriterTick();
  }, 2400);
}

function initLandingEffects() {
  if (landingFx.active) return;
  if (!$("landing-page") || $("landing-page").hidden) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const el = $("landing-typewriter");
    if (el) el.textContent = landingFx.phrases[0];
    return;
  }

  landingFx.active = true;
  landingFx.typeIdx = 0;
  landingFx.charIdx = 0;
  landingTypewriterTick();

  const spotlight = $("landing-spotlight");
  const showcase = $("landing-showcase");

  landingFx.onMove = (e) => {
    if (spotlight) {
      spotlight.style.setProperty("--spot-x", `${e.clientX}px`);
      spotlight.style.setProperty("--spot-y", `${e.clientY}px`);
    }
    if (showcase) {
      const rect = showcase.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / rect.width;
      const dy = (e.clientY - cy) / rect.height;
      showcase.style.transform = `rotateY(${dx * 6}deg) rotateX(${-dy * 4}deg)`;
    }
  };

  document.addEventListener("mousemove", landingFx.onMove);
}

async function refreshBotBranding() {
  try {
    const r = await fetch(apiUrl("/api/bot/profile"), fetchOptsGet());
    if (!r.ok) return;
    const b = await r.json();
    if (!b?.avatar_url) return;

    const logo = $("sidebar-logo-img");
    if (logo) logo.src = b.avatar_url;

    const landingAvatar = $("landing-bot-avatar");
    if (landingAvatar) landingAvatar.src = b.avatar_url;

    const landingNavLogo = $("landing-nav-logo");
    if (landingNavLogo) landingNavLogo.src = b.avatar_url;

    const fav = $("site-favicon");
    if (fav) {
      fav.href = b.avatar_url;
      fav.type = "image/png";
    }
  } catch {
    // silencieux : branding non bloquant
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function updateInviteBanner() {
  const row = currentGuildRow();
  const banner = $("invite-banner");
  const link = $("invite-link");
  if (!banner || !link) return;

  if (row && row.invite_url && !row.bot_in_guild) {
    banner.hidden = false;
    link.href = row.invite_url;
  } else {
    banner.hidden = true;
  }
}

function updateGuildHeader(guildId) {
  const meta = guildMeta[guildId];
  const row = guildPickerList.find((x) => x.guild_id === guildId);
  const img = $("guild-icon");
  const nameEl = $("guild-name");
  const sub = $("guild-meta-sub");
  const warnMeta = $("discord-warn-meta");

  const iconSrc = meta?.icon_url || row?.icon_url;
  if (iconSrc) {
    img.src = iconSrc;
    img.hidden = false;
  } else {
    img.removeAttribute("src");
    img.hidden = true;
  }

  const displayName = meta?.name || row?.name;
  if (displayName) {
    nameEl.textContent = displayName;
    sub.textContent = row?.bot_in_guild
      ? "Configuration serveur · wingbot.db"
      : "Invite le bot pour configurer ce serveur.";
    warnMeta.hidden = true;
    warnMeta.textContent = "";
  } else {
    nameEl.textContent = guildId || "—";
    sub.textContent = "Chargement des infos…";
    warnMeta.hidden = false;
    warnMeta.textContent =
      "Ajoute `TOKEN` (bot) dans le `.env` pour les noms et salons.";
  }
}

async function fetchGuildMeta(guildId) {
  const res = await fetch(
    apiUrl(`/api/discord/guilds/${encodeURIComponent(guildId)}`),
    { credentials: "include" }
  );
  if (res.ok) {
    guildMeta[guildId] = await res.json();
  }
}

async function loadChannelSelect(guildId) {
  const sel = $("log-channel-select");
  sel.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "— Aucun salon —";
  sel.appendChild(empty);

  const res = await fetch(
    apiUrl(`/api/discord/guilds/${encodeURIComponent(guildId)}/channels`),
    { credentials: "include" }
  );

  if (!res.ok) {
    lastGuildChannelsList = [];
    const w = $("discord-warn-channels");
    w.hidden = false;
    w.textContent =
      "Salons indisponibles (bot absent ou TOKEN invalide).";
    return;
  }

  $("discord-warn-channels").hidden = true;
  $("discord-warn-channels").textContent = "";

  const data = await res.json();
  const channels = data.channels || [];
  lastGuildChannelsList = channels;
  const byCat = new Map();
  for (const ch of channels) {
    const label = ch.category || "Sans catégorie";
    if (!byCat.has(label)) byCat.set(label, []);
    byCat.get(label).push(ch);
  }

  const keys = [...byCat.keys()].sort((a, b) => {
    if (a === "Sans catégorie") return 1;
    if (b === "Sans catégorie") return -1;
    return a.localeCompare(b);
  });

  for (const key of keys) {
    const items = byCat.get(key);
    if (key === "Sans catégorie") {
      for (const ch of items) {
        const o = document.createElement("option");
        o.value = ch.id;
        o.textContent = `#${ch.name}`;
        sel.appendChild(o);
      }
    } else {
      const og = document.createElement("optgroup");
      og.label = key;
      for (const ch of items) {
        const o = document.createElement("option");
        o.value = ch.id;
        o.textContent = `#${ch.name}`;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
  }
}

function normalizeSnowflakeArrayUi(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const id = String(x ?? "")
      .replace(/\D/g, "")
      .trim();
    if (!/^\d{17,20}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function loadGuildRoles(guildId) {
  lastGuildRolesList = [];
  const res = await fetch(
    apiUrl(`/api/discord/guilds/${encodeURIComponent(guildId)}/roles`),
    { credentials: "include" }
  );
  if (!res.ok) return;
  const data = await res.json();
  lastGuildRolesList = Array.isArray(data.roles) ? data.roles : [];
}

function renderGroups() {
  const root = $("groups-root");
  if (!root || !guildState) return;
  root.innerHTML = "";
  const flags = guildState.feature_flags;

  manifest.groups.forEach((g, idx) => {
    const details = document.createElement("details");
    details.className = "group";
    details.open = idx === 0;

    const sum = document.createElement("summary");
    sum.className = "group-summary";
    sum.innerHTML = `
      <span class="group-title">${escapeHtml(g.title)}</span>
      <span class="group-actions">
        <button type="button" class="btn link btn-all-on" data-group="${escapeHtml(g.id)}">Tout</button>
        <button type="button" class="btn link btn-all-off" data-group="${escapeHtml(g.id)}">Rien</button>
      </span>
    `;
    details.appendChild(sum);

    const desc = document.createElement("p");
    desc.className = "group-desc muted";
    desc.textContent = g.description || "";
    details.appendChild(desc);

    const grid = document.createElement("div");
    grid.className = "flag-grid";

    for (const key of g.keys) {
      const id = `flag-${key.id}`;
      const wrap = document.createElement("label");
      wrap.className = "flag-row";
      wrap.title = key.id;
      wrap.innerHTML = `
        <input type="checkbox" id="${id}" data-key="${escapeHtml(key.id)}" ${flags[key.id] ? "checked" : ""} />
        <span class="flag-name">${escapeHtml(key.label)}</span>
      `;
      grid.appendChild(wrap);
    }

    details.appendChild(grid);
    root.appendChild(details);
  });

  root.querySelectorAll('input[type="checkbox"][data-key]').forEach((el) => {
    el.addEventListener("change", () => {
      const k = el.getAttribute("data-key");
      guildState.feature_flags[k] = el.checked;
      setDirty(true);
    });
  });

  root.querySelectorAll(".btn-all-on").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const gid = btn.getAttribute("data-group");
      const group = manifest.groups.find((x) => x.id === gid);
      if (!group) return;
      for (const k of group.keys) guildState.feature_flags[k.id] = true;
      root.querySelectorAll(`[data-key]`).forEach((inp) => {
        const k = inp.getAttribute("data-key");
        if (group.keys.some((x) => x.id === k)) inp.checked = true;
      });
      setDirty(true);
    });
  });

  root.querySelectorAll(".btn-all-off").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const gid = btn.getAttribute("data-group");
      const group = manifest.groups.find((x) => x.id === gid);
      if (!group) return;
      for (const k of group.keys) guildState.feature_flags[k.id] = false;
      root.querySelectorAll(`[data-key]`).forEach((inp) => {
        const k = inp.getAttribute("data-key");
        if (group.keys.some((x) => x.id === k)) inp.checked = false;
      });
      setDirty(true);
    });
  });
}

function syncCommandAccessSet(key, id, checked) {
  if (!guildState?.command_access) return;
  const s = new Set(guildState.command_access[key]);
  if (checked) s.add(id);
  else s.delete(id);
  guildState.command_access[key] = [...s];
  setDirty(true);
}

/* Rendu des chips (salons ou rôles) pour une section d'accès.
   Clic sur le chip entier = toggle. État visuel via data-checked. */
function renderAccessChips(container, items, key, getLabel, getColor) {
  container.innerHTML = "";
  const ca = guildState.command_access;

  if (!items.length) {
    const sp = document.createElement("span");
    sp.className = "muted tiny access-empty";
    sp.textContent =
      key === "ignore_channel_ids" || key === "allow_channel_ids"
        ? "Aucun salon listé (bot absent, TOKEN manquant, ou erreur API)."
        : "Aucun rôle listé.";
    container.appendChild(sp);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of items) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "access-chip";
    chip.dataset.id = item.id;
    chip.dataset.search = getLabel(item).toLowerCase();
    const checked = ca[key].includes(item.id);
    chip.dataset.checked = checked ? "1" : "0";

    const color = getColor ? getColor(item) : null;
    if (color) {
      chip.style.setProperty("--chip-accent", color);
    }

    const dot = document.createElement("span");
    dot.className = "access-chip-dot";
    chip.appendChild(dot);

    const label = document.createElement("span");
    label.className = "access-chip-label";
    label.textContent = getLabel(item);
    chip.appendChild(label);

    const tick = document.createElement("span");
    tick.className = "access-chip-tick";
    tick.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    chip.appendChild(tick);

    chip.addEventListener("click", (e) => {
      e.preventDefault();
      const next = chip.dataset.checked !== "1";
      chip.dataset.checked = next ? "1" : "0";
      syncCommandAccessSet(key, item.id, next);
      updateSectionCounter(chip.closest(".access-sec"));
    });

    frag.appendChild(chip);
  }
  container.appendChild(frag);
}

function updateSectionCounter(sec) {
  if (!sec) return;
  const total = sec.querySelectorAll(".access-chip").length;
  const checked = sec.querySelectorAll('.access-chip[data-checked="1"]').length;
  const badge = sec.querySelector(".access-count");
  if (badge) {
    badge.textContent = checked > 0 ? `${checked} / ${total}` : `${total}`;
    badge.classList.toggle("is-active", checked > 0);
  }
}

function renderAccessSection({
  id,
  title,
  hint,
  key,
  items,
  getLabel,
  getColor,
  open,
}) {
  const details = document.createElement("details");
  details.className = "access-sec";
  details.id = `access-sec-${id}`;
  if (open) details.open = true;

  const total = items.length;
  const selected = (guildState.command_access[key] || []).length;

  const sum = document.createElement("summary");
  sum.className = "access-sec-head";
  sum.innerHTML = `
    <span class="access-sec-title">${escapeHtml(title)}</span>
    <span class="access-count ${selected > 0 ? "is-active" : ""}">${
    selected > 0 ? `${selected} / ${total}` : `${total}`
  }</span>
    <svg class="access-sec-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  `;
  details.appendChild(sum);

  const body = document.createElement("div");
  body.className = "access-sec-body";

  const hintEl = document.createElement("p");
  hintEl.className = "access-sec-hint muted tiny";
  hintEl.textContent = hint;
  body.appendChild(hintEl);

  const toolbar = document.createElement("div");
  toolbar.className = "access-sec-toolbar";
  toolbar.innerHTML = `
    <div class="access-search">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" placeholder="${
        key === "ignore_channel_ids" ? "Rechercher un salon…" : "Rechercher un rôle…"
      }" />
    </div>
    <button type="button" class="btn ghost tiny access-clear">Tout décocher</button>
  `;
  body.appendChild(toolbar);

  const chipsWrap = document.createElement("div");
  chipsWrap.className = "access-chips";
  body.appendChild(chipsWrap);
  details.appendChild(body);

  renderAccessChips(chipsWrap, items, key, getLabel, getColor);

  const searchInput = toolbar.querySelector('input[type="search"]');
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    chipsWrap.querySelectorAll(".access-chip").forEach((c) => {
      c.style.display = !q || c.dataset.search.includes(q) ? "" : "none";
    });
  });

  toolbar.querySelector(".access-clear").addEventListener("click", () => {
    guildState.command_access[key] = [];
    chipsWrap.querySelectorAll(".access-chip").forEach((c) => {
      c.dataset.checked = "0";
    });
    setDirty(true);
    updateSectionCounter(details);
  });

  return details;
}

function roleColorCss(role) {
  const c = Number(role.color);
  if (!c || c === 0) return null;
  return "#" + c.toString(16).padStart(6, "0");
}

function renderCommandAccessPanel() {
  const root = $("command-access-root");
  if (!root || !guildState) return;
  root.innerHTML = "";

  const intro = document.createElement("details");
  intro.className = "access-intro";
  intro.innerHTML = `
    <summary>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      Comment ça marche ?
    </summary>
    <div class="access-intro-body muted tiny">
      <p><strong>Salons sans commandes</strong> — aucune commande (y compris <code>help</code>) dans ces salons.</p>
      <p><strong>Salons autorisés</strong> — au moins un coché = les commandes ne marchent <em>que</em> dans ces salons.</p>
      <p><strong>Rôles sans commandes</strong> — ces rôles ne peuvent rien lancer sauf <code>help</code>.</p>
      <p><strong>Rôles autorisés (global)</strong> — au moins un coché = liste blanche pour toutes les commandes ( + admin + propriétaire ).</p>
      <p><strong>Modération / Administration / Premium</strong> — au moins un rôle coché = seuls ces rôles (+ admin + propriétaire) peuvent utiliser les commandes de la catégorie.</p>
      <p>Les permissions Discord natives (ex. <code>KickMembers</code>) s'appliquent toujours en plus de ces règles.</p>
    </div>
  `;
  root.appendChild(intro);

  root.appendChild(
    renderAccessSection({
      id: "channels-block",
      title: "Salons sans commandes",
      hint: "Aucune commande du bot dans les salons cochés.",
      key: "ignore_channel_ids",
      items: lastGuildChannelsList,
      getLabel: (ch) => `#${ch.name}`,
      open: true,
    })
  );

  root.appendChild(
    renderAccessSection({
      id: "channels-allow",
      title: "Salons autorisés (liste blanche)",
      hint: "Vide = partout (sauf salons interdits ci-dessus). Au moins un coché = commandes uniquement dans ces salons.",
      key: "allow_channel_ids",
      items: lastGuildChannelsList,
      getLabel: (ch) => `#${ch.name}`,
    })
  );

  root.appendChild(
    renderAccessSection({
      id: "blocked",
      title: "Rôles sans commandes",
      hint: "Ces rôles ne peuvent utiliser aucune commande (sauf help).",
      key: "block_role_ids",
      items: lastGuildRolesList,
      getLabel: (r) => r.name,
      getColor: roleColorCss,
    })
  );

  root.appendChild(
    renderAccessSection({
      id: "allowed",
      title: "Rôles autorisés (liste blanche)",
      hint: "Vide = tout le monde peut essayer. Au moins un coché = seuls ces rôles + admin Discord + propriétaire.",
      key: "allow_role_ids",
      items: lastGuildRolesList,
      getLabel: (r) => r.name,
      getColor: roleColorCss,
    })
  );

  root.appendChild(
    renderAccessSection({
      id: "mod-roles",
      title: "Rôles modération",
      hint: "kick, ban, warn, timeout, clear… — au moins un coché = réservé à ces rôles (+ admin / propriétaire).",
      key: "moderation_role_ids",
      items: lastGuildRolesList,
      getLabel: (r) => r.name,
      getColor: roleColorCss,
      open: true,
    })
  );

  root.appendChild(
    renderAccessSection({
      id: "admin-roles",
      title: "Rôles administration",
      hint: "setlogchannel, togglelog, logconfig… — au moins un coché = réservé à ces rôles (+ admin / propriétaire).",
      key: "admin_role_ids",
      items: lastGuildRolesList,
      getLabel: (r) => r.name,
      getColor: roleColorCss,
    })
  );

  root.appendChild(
    renderAccessSection({
      id: "premium-roles",
      title: "Rôles premium",
      hint: "backup… — au moins un coché = réservé à ces rôles (+ admin / propriétaire).",
      key: "premium_role_ids",
      items: lastGuildRolesList,
      getLabel: (r) => r.name,
      getColor: roleColorCss,
    })
  );

  const cats = document.createElement("div");
  cats.className = "panel-block access-cat-ref";
  const byCat = {};
  for (const c of commandManifest.commands || []) {
    if (c.id === "help") continue;
    const cat = c.category || "utility";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(c.label || c.id);
  }
  const catLabels = {
    utility: "Utilitaires",
    moderation: "Modération",
    admin: "Administration",
    premium: "Premium",
  };
  cats.innerHTML = `<h3 class="muted tiny" style="margin:0 0 0.5rem">Référence des catégories</h3>`;
  const ul = document.createElement("ul");
  ul.className = "mod-doc-list muted tiny";
  for (const [cat, cmds] of Object.entries(byCat)) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(catLabels[cat] || cat)}</strong> — <span class="mono">${escapeHtml(cmds.join(", "))}</span>`;
    ul.appendChild(li);
  }
  cats.appendChild(ul);
  root.appendChild(cats);
}

function renderCommands() {
  const root = $("commands-root");
  if (!root || !guildState) return;
  root.innerHTML = "";
  const groups = commandManifest.groups || [];
  const cmds = commandManifest.commands || [];
  const groupsDisabled = new Set(guildState.command_groups_disabled || []);

  for (const g of groups) {
    const section = document.createElement("div");
    section.className = "cmd-group";
    const head = document.createElement("div");
    head.className = "cmd-group-head";
    const h = document.createElement("h4");
    h.textContent = `${g.icon || ""} ${g.title}`.trim();
    const groupOff = groupsDisabled.has(g.id);
    const masterLab = document.createElement("label");
    const masterInp = document.createElement("input");
    masterInp.type = "checkbox";
    masterInp.setAttribute("data-group-master", g.id);
    masterInp.checked = !groupOff;
    masterLab.appendChild(masterInp);
    const masterSpan = document.createElement("span");
    masterSpan.textContent = "Groupe activé";
    masterLab.appendChild(masterSpan);
    head.appendChild(h);
    head.appendChild(masterLab);
    section.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "cmd-toggles";

    for (const c of cmds.filter((x) => x.category === g.id)) {
      if (c.id === "help") {
        const row = document.createElement("div");
        row.className = "cmd-row cmd-row-immutable";
        row.innerHTML = `
        <input type="checkbox" checked disabled title="Toujours active" />
        <span class="cmd-row-text">
          <strong class="mono">${escapeHtml(c.label)}</strong>
          <span class="muted tiny">${escapeHtml(c.description)} — toujours active</span>
        </span>`;
        grid.appendChild(row);
        continue;
      }
      const enabled = !groupOff && !guildState.commands_disabled.includes(c.id);
      const row = document.createElement("label");
      row.className = "cmd-row";
      row.innerHTML = `
        <input type="checkbox" data-cmd="${escapeHtml(c.id)}" ${enabled ? "checked" : ""} ${groupOff ? "disabled" : ""} />
        <span class="cmd-row-text">
          <strong class="mono">${escapeHtml(c.label)}</strong>
          <span class="muted tiny">${escapeHtml(c.description)}${groupOff ? " — groupe désactivé" : ""}</span>
        </span>
      `;
      grid.appendChild(row);
    }
    section.appendChild(grid);
    root.appendChild(section);
  }

  root.querySelectorAll("input[data-cmd]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const id = inp.getAttribute("data-cmd");
      if (id === "help") return;
      const dis = new Set(guildState.commands_disabled);
      if (inp.checked) dis.delete(id);
      else dis.add(id);
      guildState.commands_disabled = [...dis].filter((x) => x !== "help");
      setDirty(true);
      updateOverview();
    });
  });

  root.querySelectorAll("[data-group-master]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const gid = inp.getAttribute("data-group-master");
      if (!gid) return;
      const set = new Set(guildState.command_groups_disabled);
      if (inp.checked) set.delete(gid);
      else set.add(gid);
      guildState.command_groups_disabled = [...set];
      setDirty(true);
      renderCommands();
      updateOverview();
    });
  });
}

function isDashboardFounder() {
  return !!internalAccess?.founder;
}

function defaultAntispamState() {
  return {
    enabled: false,
    test_mode: false,
    cross_channel: true,
    trusted_member_days: 14,
    url_spam: {
      enabled: true,
      max_messages: 3,
      window_sec: 45,
      min_channels: 3,
      duplicate_link_trigger: true,
    },
    image_spam: {
      enabled: true,
      max_messages: 4,
      window_sec: 90,
      min_channels: 3,
    },
    immune_role_ids: [],
    immune_channel_ids: [],
    timeout_min_repeat: 60,
    timeout_min_escalated: 240,
    strikes_before_timeout: 3,
    strike_decay_hours: 72,
  };
}

function renderAntispamPanel() {
  const root = $("antispam-panel");
  if (!root || !guildState) return;
  if (!guildState.antispam_config) {
    guildState.antispam_config = defaultAntispamState();
  }
  const cfg = guildState.antispam_config;
  const founder = isDashboardFounder();
  const testModeBlock = founder
    ? `
    <label class="field-row switch-row">
      <span><strong>Mode test</strong> — observe seulement, ne supprime rien</span>
      <input type="checkbox" id="as-test" ${cfg.test_mode ? "checked" : ""} />
    </label>
    <p class="muted tiny" style="margin:0 0 0.75rem">
      Calibre les détections avec le mode test + log <em>Antispam automatique</em> activé,
      puis désactive le mode test pour appliquer les sanctions.
    </p>`
    : "";

  root.innerHTML = `
    <label class="field-row switch-row">
      <span>Antispam activé</span>
      <input type="checkbox" id="as-enabled" ${cfg.enabled ? "checked" : ""} />
    </label>
    ${testModeBlock}
    <label class="field-row switch-row">
      <span>Détection multi-salons (comptes hackés)</span>
      <input type="checkbox" id="as-cross" ${cfg.cross_channel ? "checked" : ""} />
    </label>
    <label class="field-row">
      <span>Membre fidèle (jours sur le serveur)</span>
      <input type="number" id="as-trusted-days" class="input-sm" min="0" max="365" value="${cfg.trusted_member_days ?? 14}" />
      <span class="muted tiny">seuils +1 si membre plus ancien</span>
    </label>
    <h4 class="muted tiny" style="margin:1rem 0 0.5rem">Spam de liens</h4>
    <label class="field-row switch-row">
      <span>Activer</span>
      <input type="checkbox" id="as-url-on" ${cfg.url_spam.enabled ? "checked" : ""} />
    </label>
    <label class="field-row">
      <span>Messages max / fenêtre</span>
      <input type="number" id="as-url-max" class="input-sm" min="2" max="20" value="${cfg.url_spam.max_messages}" />
      <input type="number" id="as-url-win" class="input-sm" min="10" max="300" value="${cfg.url_spam.window_sec}" title="secondes" />
      <span class="muted tiny">sec</span>
    </label>
    <label class="field-row">
      <span>Salons min. (multi-salons)</span>
      <input type="number" id="as-url-ch" class="input-sm" min="2" max="20" value="${cfg.url_spam.min_channels}" />
    </label>
    <label class="field-row switch-row">
      <span>Même lien sur 2+ salons = alerte immédiate</span>
      <input type="checkbox" id="as-url-dup" ${cfg.url_spam.duplicate_link_trigger !== false ? "checked" : ""} />
    </label>
    <h4 class="muted tiny" style="margin:1rem 0 0.5rem">Spam d’images (fichiers uploadés)</h4>
    <label class="field-row switch-row">
      <span>Activer</span>
      <input type="checkbox" id="as-img-on" ${cfg.image_spam.enabled ? "checked" : ""} />
    </label>
    <label class="field-row">
      <span>Messages max / fenêtre</span>
      <input type="number" id="as-img-max" class="input-sm" min="2" max="30" value="${cfg.image_spam.max_messages}" />
      <input type="number" id="as-img-win" class="input-sm" min="15" max="600" value="${cfg.image_spam.window_sec}" />
      <span class="muted tiny">sec</span>
    </label>
    <label class="field-row">
      <span>Salons min. (multi-salons)</span>
      <input type="number" id="as-img-ch" class="input-sm" min="2" max="20" value="${cfg.image_spam.min_channels}" />
    </label>
    <h4 class="muted tiny" style="margin:1rem 0 0.5rem">Sanctions</h4>
    <label class="field-row">
      <span>Détections avant sourdine</span>
      <input type="number" id="as-strikes" class="input-sm" min="2" max="10" value="${cfg.strikes_before_timeout}" />
    </label>
    <label class="field-row">
      <span>Sourdine récidive (min)</span>
      <input type="number" id="as-timeout-repeat" class="input-sm" min="5" max="40320" value="${cfg.timeout_min_repeat}" />
    </label>
    <label class="field-row">
      <span>Sourdine récidive forte (min)</span>
      <input type="number" id="as-timeout-esc" class="input-sm" min="5" max="40320" value="${cfg.timeout_min_escalated}" />
    </label>
    <label class="field-row">
      <span>Réinitialiser strikes après (h)</span>
      <input type="number" id="as-decay" class="input-sm" min="1" max="720" value="${cfg.strike_decay_hours}" />
    </label>
    <p class="muted tiny" style="margin-top:0.75rem">
      Un lien YouTube dans un salon ≠ spam. Les aperçus de lien ne comptent pas comme images.
      Admins, staff et salons ignorés (Permissions) sont exclus.
    </p>
  `;

  const sync = () => {
    cfg.enabled = $("as-enabled").checked;
    if ($("as-test")) cfg.test_mode = $("as-test").checked;
    cfg.cross_channel = $("as-cross").checked;
    cfg.trusted_member_days = Number($("as-trusted-days").value);
    cfg.url_spam.enabled = $("as-url-on").checked;
    cfg.url_spam.duplicate_link_trigger = $("as-url-dup").checked;
    cfg.url_spam.max_messages = Number($("as-url-max").value);
    cfg.url_spam.window_sec = Number($("as-url-win").value);
    cfg.url_spam.min_channels = Number($("as-url-ch").value);
    cfg.image_spam.enabled = $("as-img-on").checked;
    cfg.image_spam.max_messages = Number($("as-img-max").value);
    cfg.image_spam.window_sec = Number($("as-img-win").value);
    cfg.image_spam.min_channels = Number($("as-img-ch").value);
    cfg.strikes_before_timeout = Number($("as-strikes").value);
    cfg.timeout_min_repeat = Number($("as-timeout-repeat").value);
    cfg.timeout_min_escalated = Number($("as-timeout-esc").value);
    cfg.strike_decay_hours = Number($("as-decay").value);
    setDirty(true);
  };

  const fieldIds = [
    "as-enabled",
    "as-cross",
    "as-trusted-days",
    "as-url-on",
    "as-url-dup",
    "as-url-max",
    "as-url-win",
    "as-url-ch",
    "as-img-on",
    "as-img-max",
    "as-img-win",
    "as-img-ch",
    "as-strikes",
    "as-timeout-repeat",
    "as-timeout-esc",
    "as-decay",
  ];
  if (founder) fieldIds.splice(1, 0, "as-test");
  for (const id of fieldIds) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("change", sync);
    if (el.type === "number") el.addEventListener("input", sync);
  }
}

function defaultWarnState() {
  return {
    auto_timeout_enabled: true,
    warns_before_timeout: 3,
    timeout_minutes: 60,
    timeout_escalated_minutes: 240,
    dm_user: true,
  };
}

function renderWarnConfigPanel() {
  const root = $("warn-config-panel");
  if (!root || !guildState) return;
  if (!guildState.warn_config) {
    guildState.warn_config = defaultWarnState();
  }
  const cfg = guildState.warn_config;

  root.innerHTML = `
    <label class="field-row switch-row">
      <span>Sourdine auto au seuil de warns</span>
      <input type="checkbox" id="wc-auto-timeout" ${cfg.auto_timeout_enabled ? "checked" : ""} />
    </label>
    <label class="field-row switch-row">
      <span>Envoyer un MP au membre warn</span>
      <input type="checkbox" id="wc-dm" ${cfg.dm_user !== false ? "checked" : ""} />
    </label>
    <label class="field-row">
      <span>Warns avant sourdine</span>
      <input type="number" id="wc-threshold" class="input-sm" min="1" max="20" value="${cfg.warns_before_timeout}" />
    </label>
    <label class="field-row">
      <span>Durée sourdine (min)</span>
      <input type="number" id="wc-timeout" class="input-sm" min="1" max="40320" value="${cfg.timeout_minutes}" />
    </label>
    <label class="field-row">
      <span>Sourdine récidive forte (min)</span>
      <input type="number" id="wc-timeout-esc" class="input-sm" min="1" max="40320" value="${cfg.timeout_escalated_minutes}" />
    </label>
  `;

  const sync = () => {
    cfg.auto_timeout_enabled = $("wc-auto-timeout").checked;
    cfg.dm_user = $("wc-dm").checked;
    cfg.warns_before_timeout = Number($("wc-threshold").value);
    cfg.timeout_minutes = Number($("wc-timeout").value);
    cfg.timeout_escalated_minutes = Number($("wc-timeout-esc").value);
    setDirty(true);
  };

  for (const id of [
    "wc-auto-timeout",
    "wc-dm",
    "wc-threshold",
    "wc-timeout",
    "wc-timeout-esc",
  ]) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("change", sync);
    if (el.type === "number") el.addEventListener("input", sync);
  }
}

let schedEditingId = null;

function parseEmbedColorInput(raw) {
  const s = String(raw || "").trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) {
    return parseInt(s.replace(/^#/, ""), 16);
  }
  return 0x5865f2;
}

function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSchedWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fillSchedChannelSelect() {
  const sel = $("sched-channel");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "— Choisir un salon —";
  sel.appendChild(empty);
  for (const ch of lastGuildChannelsList) {
    const opt = document.createElement("option");
    opt.value = ch.id;
    opt.textContent = `#${ch.name}`;
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function resetSchedForm() {
  schedEditingId = null;
  const title = $("sched-form-title");
  if (title) title.textContent = "Nouvelle annonce";
  $("sched-label").value = "";
  $("sched-channel").value = "";
  $("sched-send-at").value = "";
  $("sched-repeat").value = "once";
  $("sched-content").value = "";
  $("sched-embed-title").value = "";
  $("sched-embed-desc").value = "";
  $("sched-embed-color").value = "#5865f2";
  const cancel = $("btn-sched-cancel");
  if (cancel) cancel.hidden = true;
}

function fillSchedForm(row) {
  schedEditingId = row.id;
  $("sched-form-title").textContent = `Modifier #${row.id}`;
  $("sched-label").value = row.label || "";
  $("sched-channel").value = row.channel_id || "";
  $("sched-send-at").value = toDatetimeLocalValue(row.send_at);
  $("sched-repeat").value = row.repeat || "once";
  $("sched-content").value = row.payload?.content || "";
  const emb = row.payload?.embed || {};
  $("sched-embed-title").value = emb.title || "";
  $("sched-embed-desc").value = emb.description || "";
  const c = emb.color;
  $("sched-embed-color").value =
    typeof c === "number" && c > 0
      ? `#${c.toString(16).padStart(6, "0")}`
      : "#5865f2";
  $("btn-sched-cancel").hidden = false;
}

function collectSchedPayloadFromForm() {
  const content = String($("sched-content").value || "");
  const title = String($("sched-embed-title").value || "").trim();
  const description = String($("sched-embed-desc").value || "").trim();
  const color = parseEmbedColorInput($("sched-embed-color").value);
  const embed =
    title || description
      ? {
          title,
          description,
          color,
          fields: [],
        }
      : null;
  return { content, embed };
}

async function loadScheduledMessagesList() {
  const list = $("sched-list");
  if (!list || !selectedGuildId || !currentGuildHasBot()) return;
  fillSchedChannelSelect();
  list.textContent = "Chargement…";
  try {
    const res = await fetch(
      apiUrl(
        `/api/guilds/${encodeURIComponent(selectedGuildId)}/scheduled-messages`
      ),
      fetchOptsGet()
    );
    if (!res.ok) {
      list.textContent = "Impossible de charger les annonces.";
      return;
    }
    const data = await res.json();
    renderScheduledList(data.scheduled || []);
  } catch {
    list.textContent = "Erreur réseau.";
  }
}

function renderScheduledList(rows) {
  const list = $("sched-list");
  if (!list) return;
  if (!rows.length) {
    list.textContent = "Aucune annonce programmée.";
    return;
  }
  const repeatLabel = { once: "Une fois", daily: "Quotidien", weekly: "Hebdo" };
  list.innerHTML = "";
  for (const row of rows) {
    const ch = lastGuildChannelsList.find((c) => c.id === row.channel_id);
    const chName = ch ? `#${ch.name}` : row.channel_id;
    const div = document.createElement("div");
    div.className = "warn-row";
    div.style.cssText =
      "border:1px solid var(--border, #333);border-radius:8px;padding:0.65rem 0.75rem;margin-bottom:0.5rem;";
    const status = row.enabled ? "Actif" : "Pause";
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;align-items:center">
        <strong>${escapeHtml(row.label || `Annonce #${row.id}`)}</strong>
        <span class="muted tiny">${status} · ${repeatLabel[row.repeat] || row.repeat}</span>
      </div>
      <div class="muted tiny" style="margin-top:0.35rem">${escapeHtml(chName)} · ${escapeHtml(formatSchedWhen(row.send_at))}</div>
      <div style="margin-top:0.45rem;display:flex;gap:0.35rem;flex-wrap:wrap">
        <button type="button" class="btn link tiny btn-sched-edit" data-id="${row.id}">Modifier</button>
        <button type="button" class="btn link tiny btn-sched-toggle" data-id="${row.id}" data-on="${row.enabled ? "1" : "0"}">${row.enabled ? "Pause" : "Activer"}</button>
        <button type="button" class="btn link tiny btn-sched-del" data-id="${row.id}">Supprimer</button>
      </div>
    `;
    list.appendChild(div);
  }
  list.querySelectorAll(".btn-sched-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      const row = rows.find((r) => r.id === id);
      if (row) fillSchedForm(row);
    });
  });
  list.querySelectorAll(".btn-sched-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const enabled = btn.dataset.on !== "1";
      const res = await fetch(
        apiUrl(
          `/api/guilds/${encodeURIComponent(selectedGuildId)}/scheduled-messages/${id}`
        ),
        {
          method: "PUT",
          headers: authHeaders(),
          credentials: "include",
          body: JSON.stringify({ enabled }),
        }
      );
      if (res.ok) loadScheduledMessagesList();
    });
  });
  list.querySelectorAll(".btn-sched-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      if (!confirm(`Supprimer l'annonce #${id} ?`)) return;
      const res = await fetch(
        apiUrl(
          `/api/guilds/${encodeURIComponent(selectedGuildId)}/scheduled-messages/${id}`
        ),
        { method: "DELETE", credentials: "include" }
      );
      if (res.ok) {
        if (schedEditingId === id) resetSchedForm();
        loadScheduledMessagesList();
      }
    });
  });
}

async function saveScheduledMessage() {
  if (!selectedGuildId || !currentGuildHasBot()) return;
  const channelId = $("sched-channel").value;
  const sendAtLocal = $("sched-send-at").value;
  if (!channelId) {
    alert("Choisis un salon.");
    return;
  }
  if (!sendAtLocal) {
    alert("Choisis une date et une heure.");
    return;
  }
  const sendAt = new Date(sendAtLocal);
  if (Number.isNaN(sendAt.getTime())) {
    alert("Date invalide.");
    return;
  }
  const body = {
    label: $("sched-label").value,
    channel_id: channelId,
    send_at: sendAt.toISOString(),
    repeat: $("sched-repeat").value,
    payload: collectSchedPayloadFromForm(),
  };
  const url = schedEditingId
    ? apiUrl(
        `/api/guilds/${encodeURIComponent(selectedGuildId)}/scheduled-messages/${schedEditingId}`
      )
    : apiUrl(
        `/api/guilds/${encodeURIComponent(selectedGuildId)}/scheduled-messages`
      );
  const res = await fetch(url, {
    method: schedEditingId ? "PUT" : "POST",
    headers: authHeaders(),
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    alert(j.error || "Échec de l'enregistrement.");
    return;
  }
  resetSchedForm();
  loadScheduledMessagesList();
}

async function loadWarningsList() {
  const panel = $("warn-list-panel");
  if (!panel || !selectedGuildId || !currentGuildHasBot()) return;

  panel.textContent = "Chargement…";
  const filterRaw = String($("warn-filter-user")?.value || "").replace(/\D/g, "");
  const q = filterRaw ? `?user_id=${encodeURIComponent(filterRaw)}&limit=80` : "?limit=80";

  try {
    const res = await fetch(
      apiUrl(`/api/guilds/${encodeURIComponent(selectedGuildId)}/warnings${q}`),
      fetchOptsGet()
    );
    if (!res.ok) {
      panel.textContent = "Impossible de charger les warns.";
      return;
    }
    const data = await res.json();
    const rows = data.warnings || [];
    if (!rows.length) {
      panel.textContent = "Aucun avertissement actif.";
      return;
    }

    panel.innerHTML = "";
    for (const w of rows) {
      const row = document.createElement("div");
      row.className = "warn-row";
      row.style.cssText =
        "border:1px solid var(--border, #333);border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.5rem;";
      const src = w.source === "antispam" ? "antispam" : "manuel";
      const when = w.created_at ? String(w.created_at).slice(0, 16) : "?";
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;align-items:center">
          <strong>#${w.id}</strong>
          <span class="mono muted tiny">${when} · ${src}</span>
          <button type="button" class="btn link tiny btn-del-warn" data-warn-id="${w.id}">Retirer</button>
        </div>
        <div style="margin-top:0.35rem"><span class="mono">${w.user_tag || w.user_id}</span> <span class="muted tiny">(${w.user_id})</span></div>
        <div style="margin-top:0.25rem">${escapeHtml(w.reason || "")}</div>
        <div class="muted tiny" style="margin-top:0.25rem">par ${escapeHtml(w.moderator_tag || "?")}</div>
      `;
      panel.appendChild(row);
    }

    panel.querySelectorAll(".btn-del-warn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const wid = btn.getAttribute("data-warn-id");
        if (!wid || !confirm(`Retirer le warn #${wid} ?`)) return;
        const del = await fetch(
          apiUrl(
            `/api/guilds/${encodeURIComponent(selectedGuildId)}/warnings/${encodeURIComponent(wid)}`
          ),
          { method: "DELETE", credentials: "include" }
        );
        if (del.ok) loadWarningsList();
        else alert("Échec de la suppression.");
      });
    });
  } catch {
    panel.textContent = "Erreur réseau.";
  }
}

function renderCustomCommands() {
  const root = $("custom-commands-root");
  if (!root || !guildState) return;
  root.innerHTML = "";
  const list = guildState.custom_commands || [];
  list.forEach((row, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "custom-cmd-row";

    const trig = document.createElement("input");
    trig.type = "text";
    trig.className = "input-sm mono";
    trig.placeholder = "declencheur";
    trig.value = row.trigger || "";
    trig.dataset.ccIdx = String(idx);
    trig.addEventListener("input", () => {
      guildState.custom_commands[idx].trigger = trig.value;
      setDirty(true);
    });

    const ta = document.createElement("textarea");
    ta.className = "input-sm custom-cmd-ta";
    ta.rows = 2;
    ta.placeholder = "Réponse (max 2000 car.)";
    ta.value = row.response || "";
    ta.addEventListener("input", () => {
      guildState.custom_commands[idx].response = ta.value;
      setDirty(true);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn link";
    del.textContent = "Retirer";
    del.addEventListener("click", () => {
      guildState.custom_commands.splice(idx, 1);
      renderCustomCommands();
      setDirty(true);
    });

    wrap.appendChild(trig);
    wrap.appendChild(ta);
    wrap.appendChild(del);
    root.appendChild(wrap);
  });
}

function effectiveDisabledCommandCount() {
  if (!guildState) return 0;
  const dis = new Set(
    (guildState.commands_disabled || []).filter((x) => x !== "help")
  );
  const groupsOff = new Set(guildState.command_groups_disabled || []);
  for (const c of commandManifest.commands || []) {
    if (c.id === "help") continue;
    if (groupsOff.has(c.category)) dis.add(c.id);
  }
  return dis.size;
}

function updateOverview() {
  if (!guildState) return;

  // --- Cartes existantes ---
  const logsOn = !!guildState.logs_master_enabled;
  const ovLogs = $("ov-logs");
  if (ovLogs) {
    ovLogs.textContent = logsOn ? "Activé" : "Désactivé";
    ovLogs.style.color = logsOn ? "#86efac" : "#fda4af";
  }
  const logChan = guildState.log_channel_id;
  const ovLogsDetail = $("ov-logs-detail");
  if (ovLogsDetail) {
    if (logChan) {
      const ch = (lastGuildChannelsList || []).find((c) => c.id === logChan);
      ovLogsDetail.textContent = ch
        ? `Salon : #${ch.name}`
        : `Salon ID ${logChan}`;
    } else {
      ovLogsDetail.textContent = "Salon non configuré";
    }
  }

  $("ov-prefix").textContent = guildState.prefix || "$";

  const totalCmds = (commandManifest.commands || []).length;
  const off = effectiveDisabledCommandCount();
  const active = Math.max(totalCmds - off, 0);
  setText("ov-cmd-active", String(active));
  setText("ov-cmd-total", `/ ${totalCmds || "—"}`);
  setText("ov-cmd-off", String(off));
  setText(
    "ov-cmd-custom",
    String((guildState.custom_commands || []).length || 0)
  );

  // --- Hero (nom + members + status bot) ---
  const guild = (guildPickerList || []).find(
    (g) => g.guild_id === selectedGuildId
  );
  setText("ov-hero-name", guild?.name || "Serveur sélectionné");
  setText("ov-hero-id", `ID ${selectedGuildId || "—"}`);
  const memberCount =
    guild?.approximate_member_count ?? guild?.member_count ?? null;
  setText(
    "ov-hero-members",
    memberCount != null ? `${memberCount} membres` : "Membres : —"
  );
  const heroIcon = $("ov-hero-icon");
  if (heroIcon) {
    if (guild?.icon_url) {
      heroIcon.innerHTML = `<img src="${escapeAttr(guild.icon_url)}" alt="" />`;
    } else {
      heroIcon.textContent = (guild?.name || "?").slice(0, 1).toUpperCase();
    }
  }
  const heroStatusText = $("ov-hero-status-text");
  if (heroStatusText) {
    const present = currentGuildHasBot();
    heroStatusText.textContent = present ? "Bot en ligne" : "Bot absent";
    const pill = $("ov-hero-status");
    if (pill) pill.classList.toggle("is-off", !present);
  }

  // --- Catégories de logs actives ---
  const flags = guildState.feature_flags || {};
  const activeFlags = Object.values(flags).filter(Boolean).length;
  setText("ov-feature-flags", String(activeFlags));

  // --- DMs non lus (utilise le badge déjà calculé par refreshFondaThreads) ---
  const unread = (fondaState?.threads || []).reduce(
    (acc, t) => acc + (t.unread_count || 0),
    0
  );
  setText("ov-dms-unread", String(unread));

  // --- Embeds : on récupère la liste de manière non bloquante ---
  loadOverviewEmbedsCount();
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

let _ovEmbedsCache = { gid: null, count: null };
async function loadOverviewEmbedsCount() {
  const gid = selectedGuildId;
  if (!gid || !currentGuildHasBot()) {
    setText("ov-embeds", "—");
    return;
  }
  if (_ovEmbedsCache.gid === gid && _ovEmbedsCache.count != null) {
    setText("ov-embeds", String(_ovEmbedsCache.count));
    return;
  }
  try {
    const res = await fetch(apiUrl(`/api/guilds/${encodeURIComponent(gid)}/embeds`), {
      ...fetchOptsGet(),
      credentials: "include",
    });
    if (!res.ok) throw new Error(res.statusText);
    const j = await res.json();
    const list = Array.isArray(j.embeds) ? j.embeds : [];
    _ovEmbedsCache = { gid, count: list.length };
    setText("ov-embeds", String(list.length));
    const published = list.filter((e) => e.message_id).length;
    setText(
      "ov-embeds-detail",
      published
        ? `${published} publié${published > 1 ? "s" : ""} sur Discord`
        : list.length
        ? "Tous en brouillon"
        : "Aucun pour le moment"
    );
  } catch {
    setText("ov-embeds", "—");
  }
}

function fillGuildSelect() {
  const sel = $("guild-select");
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— Choisir un serveur —";
  sel.appendChild(opt0);

  for (const g of guildPickerList) {
    const o = document.createElement("option");
    o.value = g.guild_id;
    const meta = guildMeta[g.guild_id];
    const baseName = g.name || meta?.name || g.guild_id;
    o.textContent = g.bot_in_guild ? baseName : `${baseName} (bot absent)`;
    sel.appendChild(o);
  }

  if (
    selectedGuildId &&
    guildPickerList.some((x) => x.guild_id === selectedGuildId)
  ) {
    sel.value = selectedGuildId;
  } else {
    sel.value = "";
  }
}

function renderGuildPickerGrid() {
  const grid = $("guild-picker-grid");
  const empty = $("guild-picker-empty");
  if (!grid) return;
  grid.innerHTML = "";

  if (!guildPickerList.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const sorted = [...guildPickerList].sort((a, b) => {
    if (a.bot_in_guild !== b.bot_in_guild) return a.bot_in_guild ? -1 : 1;
    const an = (a.name || guildMeta[a.guild_id]?.name || "").toLowerCase();
    const bn = (b.name || guildMeta[b.guild_id]?.name || "").toLowerCase();
    return an.localeCompare(bn, "fr");
  });

  const frag = document.createDocumentFragment();
  for (const g of sorted) {
    const meta = guildMeta[g.guild_id];
    const name = g.name || meta?.name || g.guild_id;
    const icon = g.icon_url || meta?.icon_url || "";
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0] || "")
      .join("")
      .toUpperCase() || "?";

    const card = document.createElement("button");
    card.type = "button";
    card.className = "guild-card";
    if (!g.bot_in_guild) card.classList.add("no-bot");
    card.dataset.guildId = g.guild_id;

    const iconWrap = document.createElement("span");
    iconWrap.className = "guild-card-icon";
    if (icon) {
      const img = document.createElement("img");
      img.src = icon;
      img.alt = "";
      img.loading = "lazy";
      img.width = 72;
      img.height = 72;
      iconWrap.appendChild(img);
    } else {
      iconWrap.textContent = initials;
      iconWrap.classList.add("fallback");
    }
    card.appendChild(iconWrap);

    const label = document.createElement("span");
    label.className = "guild-card-name";
    label.textContent = name;
    card.appendChild(label);

    const badge = document.createElement("span");
    badge.className = "guild-card-badge " + (g.bot_in_guild ? "ok" : "warn");
    badge.textContent = g.bot_in_guild ? "Bot actif" : "Bot absent";
    card.appendChild(badge);

    card.addEventListener("click", () => pickGuild(g.guild_id));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}

function showGuildPicker() {
  const picker = $("guild-picker");
  const top = $("main-top");
  const views = $("views");
  setSidebarNavVisible(false);
  if (picker) {
    picker.hidden = false;
    renderGuildPickerGrid();
  }
  if (top) top.hidden = true;
  if (views) views.hidden = true;
  const banner = $("invite-banner");
  if (banner) banner.hidden = true;
}

function hideGuildPicker() {
  const picker = $("guild-picker");
  const top = $("main-top");
  const views = $("views");
  setSidebarNavVisible(true);
  if (picker) picker.hidden = true;
  if (top) top.hidden = false;
  if (views) views.hidden = false;
}

async function pickGuild(id) {
  if (!id) return;
  if (dirty) {
    const ok = window.confirm(
      "Modifications non enregistrées. Continuer sans enregistrer ?"
    );
    if (!ok) return;
  }
  try {
    localStorage.setItem(LS_LAST_GUILD_KEY, id);
  } catch {
    // localStorage peut être indisponible (mode privé) — on ignore
  }
  $("guild-select").value = id;
  hideGuildPicker();
  await onGuildChange({ skipConfirm: true });
}

function syncSettingsInputs() {
  if (!guildState) return;
  $("input-prefix").value = guildState.prefix || "$";
  $("switch-logs-master").checked = !!guildState.logs_master_enabled;
}

function setViewsDisabled(noBot) {
  const keys = [
    "settings",
    "logs",
    "commands",
    "permissions",
    "custom",
    "embeds",
    "moderation",
    "warns",
    "announcements",
  ];
  for (const key of keys) {
    const el = viewEls.get(key);
    if (!el) continue;
    el.style.opacity = noBot ? "0.45" : "";
    el.style.pointerEvents = noBot ? "none" : "";
  }
}

async function refreshDiscordForGuild(guildId) {
  const row = guildPickerList.find((x) => x.guild_id === guildId);
  if (row?.name && row?.icon_url) {
    guildMeta[guildId] = {
      id: guildId,
      name: row.name,
      icon_url: row.icon_url,
    };
  } else if (!guildMeta[guildId]?.name) {
    await fetchGuildMeta(guildId);
  }
  updateGuildHeader(guildId);
  if (currentGuildHasBot()) {
    await loadChannelSelect(guildId);
    await loadGuildRoles(guildId);
  } else {
    lastGuildChannelsList = [];
    lastGuildRolesList = [];
  }
}

async function loadBotProfileForGuild(guildId) {
  const avatarInput = $("input-bot-avatar-url");
  const nickInput = $("input-bot-nickname");
  if (!avatarInput || !nickInput) return;

  avatarInput.value = "";
  nickInput.value = "";
  botProfileState = { avatar_url: "", nickname: "" };

  const row = guildPickerList.find((x) => x.guild_id === guildId);
  if (!row?.bot_in_guild) return;

  const r = await fetch(
    apiUrl(`/api/discord/guilds/${encodeURIComponent(guildId)}/bot-profile`),
    fetchOptsGet()
  );
  if (!r.ok) return;
  const p = await r.json();
  botProfileState = {
    avatar_url: p.avatar_url || "",
    nickname: p.nickname || "",
  };
  nickInput.value = p.nickname || "";
}

async function applyGuildData(data) {
  const dis = Array.isArray(data.commands_disabled)
    ? [...data.commands_disabled]
    : [];
  const ac = data.command_access || {};
  guildState = {
    guild_id: data.guild_id,
    feature_flags: { ...data.feature_flags },
    log_channel_id: data.log_channel_id || null,
    prefix: data.prefix ?? "$",
    logs_master_enabled:
      data.logs_master_enabled !== undefined ? !!data.logs_master_enabled : true,
    commands_disabled: dis.filter((id) => id !== "help"),
    command_groups_disabled: Array.isArray(data.command_groups_disabled)
      ? [...data.command_groups_disabled]
      : [],
    command_access: {
      ignore_channel_ids: normalizeSnowflakeArrayUi(ac.ignore_channel_ids),
      allow_channel_ids: normalizeSnowflakeArrayUi(ac.allow_channel_ids),
      block_role_ids: normalizeSnowflakeArrayUi(ac.block_role_ids),
      allow_role_ids: normalizeSnowflakeArrayUi(ac.allow_role_ids),
      moderation_role_ids: normalizeSnowflakeArrayUi(
        ac.moderation_role_ids?.length
          ? ac.moderation_role_ids
          : ac.staff_role_ids
      ),
      admin_role_ids: normalizeSnowflakeArrayUi(
        ac.admin_role_ids?.length ? ac.admin_role_ids : ac.staff_role_ids
      ),
      premium_role_ids: normalizeSnowflakeArrayUi(ac.premium_role_ids),
    },
    custom_commands: Array.isArray(data.custom_commands)
      ? data.custom_commands.map((r) => ({
          id: r.id,
          trigger: r.trigger ?? "",
          response: r.response ?? "",
        }))
      : [],
    antispam_config: data.antispam_config
      ? { ...defaultAntispamState(), ...data.antispam_config,
          url_spam: { ...defaultAntispamState().url_spam, ...(data.antispam_config.url_spam || {}) },
          image_spam: { ...defaultAntispamState().image_spam, ...(data.antispam_config.image_spam || {}) },
        }
      : defaultAntispamState(),
    warn_config: data.warn_config
      ? { ...defaultWarnState(), ...data.warn_config }
      : defaultWarnState(),
  };

  setDirty(false);
  $("save-status").textContent = "";
  syncSettingsInputs();
  renderGroups();
  renderCommands();
  renderCustomCommands();
  renderAntispamPanel();
  renderWarnConfigPanel();
  if (getHashView() === "warns") loadWarningsList();
  updateOverview();

  await refreshDiscordForGuild(data.guild_id);
  await loadBotProfileForGuild(data.guild_id);
  renderCommandAccessPanel();
  if (getHashView() === "announcements") loadScheduledMessagesList();
  if (getHashView() === "embeds" && window.wingbotEmbedWorkbench) {
    window.wingbotEmbedWorkbench.refresh();
  }

  const sel = $("log-channel-select");
  const id = guildState.log_channel_id || "";
  sel.value = id;
  if (id) {
    let found = false;
    for (const o of sel.options) {
      if (o.value === id) {
        found = true;
        break;
      }
    }
    if (!found) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = `Salon inconnu (#${id.slice(-6)})`;
      sel.appendChild(o);
      sel.value = id;
    }
  }
}

async function clearGuildUiForNoBot() {
  guildState = null;
  lastGuildChannelsList = [];
  lastGuildRolesList = [];
  $("groups-root").innerHTML = "";
  $("commands-root").innerHTML = "";
  const car = $("command-access-root");
  if (car) car.innerHTML = "";
  const ebr = $("embed-builder-root");
  if (ebr) {
    ebr.innerHTML =
      '<p class="muted">Choisis un serveur où le bot est présent.</p>';
    ebr.dataset.ready = "";
  }
  const ccr = $("custom-commands-root");
  if (ccr) ccr.innerHTML = "";
  $("log-channel-select").innerHTML = "";
  $("ov-logs").textContent = "—";
  $("ov-prefix").textContent = "—";
  $("ov-cmd-off").textContent = "—";
  const avatarInput = $("input-bot-avatar-url");
  const nickInput = $("input-bot-nickname");
  if (avatarInput) avatarInput.value = "";
  if (nickInput) nickInput.value = "";
  botProfileState = { avatar_url: "", nickname: "" };
  setDirty(false);
}

async function refreshDiscordStatus() {
  const res = await fetch(apiUrl("/api/auth/discord/status"), fetchOptsGet());
  const u = $("discord-user-label");
  const lo = $("btn-discord-logout");
  const li = $("discord-oauth-link");
  if (res.ok) {
    const j = await res.json();
    discordOAuthConnected = !!j.connected;
    if (j.connected && j.username) {
      u.hidden = false;
      u.textContent = `Discord : ${j.username}`;
      if (lo) lo.hidden = false;
      if (li) li.hidden = true;
    } else {
      u.hidden = true;
      if (lo) lo.hidden = true;
      if (li) li.hidden = false;
    }
  }
}

async function loadData() {
  const gen = ++loadDataGen;
  $("error").hidden = true;
  $("error").textContent = "";
  setDiscordOAuthHref();

  try {
  const st = await fetch(apiUrl("/api/auth/discord/status"), fetchOptsGet());
  if (gen !== loadDataGen) return;
  if (!st.ok) {
    showLandingPage();
    $("error").hidden = false;
    $("error").textContent = "Impossible de vérifier la session Discord.";
    return;
  }
  const status = await st.json();
  if (!status.connected) {
    discordOAuthConnected = false;
    internalAccess = null;
    showLandingPage();
    $("main-top").hidden = true;
    $("views").hidden = true;
    $("discord-user-label").hidden = true;
    $("btn-discord-logout").hidden = true;
    const fondaBtn = $("btn-open-fonda");
    if (fondaBtn) fondaBtn.hidden = true;
    const banner = $("invite-banner");
    if (banner) banner.hidden = true;
    const picker = $("guild-picker");
    if (picker) picker.hidden = true;
    const li = $("discord-oauth-link");
    if (li) li.hidden = false;
    $("error").hidden = true;
    $("error").textContent = "";
    return;
  }

  showDashboard();
  clearOAuthConnectedQuery();
  discordOAuthConnected = true;

  const brandingP = Promise.all([
    refreshBotBranding(),
    refreshLandingInvite().catch(() => null),
  ]);

  const [manRes, cmdManRes, cfgRes, statsRes, accessRes] = await Promise.all([
    fetch(apiUrl("/api/manifest"), fetchOptsGet()),
    fetch(apiUrl("/api/commands-manifest"), fetchOptsGet()),
    fetch(apiUrl("/api/config"), fetchOptsGet()),
    fetch(apiUrl("/api/stats"), fetchOptsGet()),
    fetch(apiUrl("/api/internal/access"), fetchOptsGet()),
  ]);
  if (gen !== loadDataGen) return;

  if (!manRes.ok || !cmdManRes.ok || !cfgRes.ok || !statsRes.ok || !accessRes.ok) {
    const bad = !manRes.ok
      ? manRes
      : !cmdManRes.ok
      ? cmdManRes
      : !cfgRes.ok
      ? cfgRes
      : !statsRes.ok
      ? statsRes
      : accessRes;
    let err = await bad.text();
    try {
      const j = JSON.parse(err);
      if (j?.message) err = j.message;
      else if (j?.error) err = j.error;
    } catch {
      /* texte brut */
    }
    if (
      err.includes("Cannot GET") ||
      err.includes("<!DOCTYPE html>") ||
      bad.status === 404
    ) {
      err =
        "API injoignable. Utilise l’URL du serveur Node (npm run dashboard) ou renseigne l’URL API.";
    }
    $("error").hidden = false;
    $("error").textContent = err || "Erreur API";
    return;
  }

  manifest = await manRes.json();
  commandManifest = await cmdManRes.json();
  const config = await cfgRes.json();
  const stats = await statsRes.json();
  internalAccess = await accessRes.json();
  if (gen !== loadDataGen) return;

  brandingP.catch(() => null);

  const fondaBtn = $("btn-open-fonda");
  if (fondaBtn) fondaBtn.hidden = !internalAccess?.founder;
  if (internalAccess?.founder) {
    loadGlobalBotSettings().catch(() => null);
    startFondaDmPolling();
  } else {
    stopFondaDmPolling();
  }

  guilds = config.guilds || [];
  guildMeta = {};

  await refreshDiscordStatus();

  const meRes = await fetch(apiUrl("/api/me/guilds"), fetchOptsGet());

  if (meRes.ok) {
    const me = await meRes.json();
    guildPickerList = me.guilds || [];
  } else {
    guildPickerList = (config.guilds || []).map((g) => ({
      guild_id: g.guild_id,
      name: null,
      icon_url: null,
      bot_in_guild: true,
      has_config_in_db: true,
      invite_url: null,
    }));
  }

  /** Nombre de serveurs dans le sélecteur (OAuth admin), pas seulement SQLite */
  $("stat-guilds").textContent = String(guildPickerList.length || 0);
  $("stat-cache").textContent = stats.messages_en_cache ?? "0";
  $("stats-section").hidden = false;

  if (guildPickerList.length === 0) {
    $("error").hidden = false;
    $("error").textContent =
      "Aucun serveur administrable trouvé. Ajoute d’abord Wingbot sur un serveur, puis actualise.";
    $("views").hidden = true;
    $("main-top").hidden = true;
    setSidebarNavVisible(false);
    return;
  }

  await Promise.all(
    guildPickerList
      .filter((g) => !g.name && g.bot_in_guild)
      .map((g) => fetchGuildMeta(g.guild_id))
  );

  for (const g of guildPickerList) {
    if (!guildMeta[g.guild_id] && g.name) {
      guildMeta[g.guild_id] = {
        id: g.guild_id,
        name: g.name,
        icon_url: g.icon_url,
      };
    }
  }

  $("views").hidden = false;

  fillGuildSelect();

  if (!location.hash || !VIEWS.has(location.hash.slice(1))) {
    history.replaceState(null, "", "#overview");
  }

  currentViewName = null;
  navigate();

  const params = new URLSearchParams(location.search);
  if (params.get("discord") === "connected") {
    history.replaceState({}, "", location.pathname + location.hash);
  }

  let savedId = null;
  try {
    savedId = localStorage.getItem(LS_LAST_GUILD_KEY);
  } catch {
    savedId = null;
  }
  const savedStillThere =
    savedId && guildPickerList.some((x) => x.guild_id === savedId);

  if (savedStillThere) {
    selectedGuildId = savedId;
    $("guild-select").value = savedId;
    hideGuildPicker();
    navigate();
    const pick = guildPickerList.find((x) => x.guild_id === savedId);
    if (!pick.bot_in_guild) {
      await clearGuildUiForNoBot();
      updateGuildHeader(savedId);
      updateInviteBanner();
      setViewsDisabled(true);
      return;
    }
    setViewsDisabled(false);
    const res = await fetch(
      apiUrl(`/api/guilds/${encodeURIComponent(savedId)}`),
      fetchOptsGet()
    );
    if (!res.ok) {
      $("error").hidden = false;
      $("error").textContent = await res.text();
      return;
    }
    const data = await res.json();
    await applyGuildData(data);
    updateInviteBanner();
    return;
  }

  selectedGuildId = null;
  showGuildPicker();
  } catch (e) {
    console.error("[dashboard] loadData", e);
    if (gen !== loadDataGen) return;
    showLandingPage();
    $("error").hidden = false;
    $("error").textContent =
      "Erreur au chargement du dashboard. Vérifie que le serveur tourne (npm run dashboard).";
  }
}

async function onGuildChange(opts = {}) {
  const id = $("guild-select").value;
  if (!id) return;
  const previous = selectedGuildId;

  if (dirty && !opts.skipConfirm) {
    const ok = window.confirm(
      "Modifications non enregistrées. Continuer sans enregistrer ?"
    );
    if (!ok) {
      $("guild-select").value = previous || "";
      return;
    }
  }

  selectedGuildId = id;
  embedsLastGuildId = null;
  try {
    localStorage.setItem(LS_LAST_GUILD_KEY, id);
  } catch {
    // pas de persistance dispo, on continue
  }
  $("save-status").textContent = "Chargement…";

  const pick = guildPickerList.find((x) => x.guild_id === id);
  updateInviteBanner();

  if (!pick?.bot_in_guild) {
    await clearGuildUiForNoBot();
    updateGuildHeader(id);
    setViewsDisabled(true);
    $("save-status").textContent = "";
    return;
  }

  setViewsDisabled(false);

  const res = await fetch(apiUrl(`/api/guilds/${encodeURIComponent(id)}`), fetchOptsGet());

  if (!res.ok) {
    $("save-status").textContent = "";
    $("error").hidden = false;
    $("error").textContent = await res.text();
    return;
  }

  const data = await res.json();
  await applyGuildData(data);
  $("save-status").textContent = "";
  updateInviteBanner();
}

async function save() {
  if (!selectedGuildId || !guildState || !currentGuildHasBot()) return;
  $("save").disabled = true;
  $("save-status").textContent = "Enregistrement…";

  const customPayload = (guildState.custom_commands || [])
    .map((r) => ({
      trigger: String(r.trigger || "")
        .trim()
        .toLowerCase(),
      response: String(r.response || "").trim(),
    }))
    .filter((r) => r.trigger && r.response);

  const body = {
    feature_flags: { ...guildState.feature_flags },
    log_channel_id: $("log-channel-select").value.trim() || null,
    prefix: ($("input-prefix").value || "").trim() || "$",
    logs_master_enabled: $("switch-logs-master").checked,
    commands_disabled: [...guildState.commands_disabled].filter((id) => id !== "help"),
    command_groups_disabled: [...(guildState.command_groups_disabled || [])],
    command_access: { ...guildState.command_access },
    antispam_config: { ...guildState.antispam_config },
    warn_config: { ...guildState.warn_config },
    custom_commands: customPayload,
  };
  if (!isDashboardFounder()) {
    const { test_mode, ...antispamRest } = body.antispam_config;
    body.antispam_config = antispamRest;
  }

  try {
    const avatarInput = $("input-bot-avatar-url");
    const avatarFileInput = $("input-bot-avatar-file");
    const nickInput = $("input-bot-nickname");
    const desiredAvatar = String(avatarInput?.value || "").trim();
    const desiredNick = String(nickInput?.value || "").trim();
    const avatarFile = avatarFileInput?.files?.[0] || null;
    const avatarDataUri = avatarFile ? await fileToDataUri(avatarFile) : "";
    const avatarChanged =
      !!avatarDataUri ||
      (desiredAvatar.length > 0 && desiredAvatar !== String(botProfileState.avatar_url || ""));
    const nickChanged = desiredNick !== String(botProfileState.nickname || "");
    if (avatarChanged || nickChanged) {
      const bpRes = await fetch(
        apiUrl(`/api/discord/guilds/${encodeURIComponent(selectedGuildId)}/bot-profile`),
        {
          method: "PUT",
          headers: authHeaders(),
          credentials: "include",
          body: JSON.stringify({
            ...(avatarChanged ? { avatar_url: desiredAvatar } : {}),
            ...(avatarDataUri ? { avatar_data_uri: avatarDataUri } : {}),
            ...(nickChanged ? { nickname: desiredNick } : {}),
          }),
        }
      );
      if (!bpRes.ok) {
        const j = await bpRes.json().catch(() => ({}));
        $("save-status").textContent = "";
        $("error").hidden = false;
        $("error").textContent =
          j.message || j.error || (await bpRes.text()) || "Erreur mise à jour profil bot";
        return;
      }
      const updatedBotProfile = await bpRes.json().catch(() => ({}));
      botProfileState = {
        avatar_url: updatedBotProfile.avatar_url || botProfileState.avatar_url || "",
        nickname: updatedBotProfile.nickname || "",
      };
      if (avatarChanged) await refreshBotBranding();
      if (avatarFileInput) avatarFileInput.value = "";
    }

    const res = await fetch(
      apiUrl(`/api/guilds/${encodeURIComponent(selectedGuildId)}`),
      {
        method: "PUT",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      $("save-status").textContent = "";
      $("error").hidden = false;
      $("error").textContent = j.error || (await res.text()) || "Erreur";
      return;
    }

    const data = await res.json();
    const idx = guilds.findIndex((g) => g.guild_id === data.guild_id);
    if (idx >= 0) guilds[idx] = data;
    else guilds.push(data);

    const pi = guildPickerList.findIndex((g) => g.guild_id === data.guild_id);
    if (pi >= 0) guildPickerList[pi].has_config_in_db = true;

    await applyGuildData(data);
    $("save-status").textContent = "Enregistré ✓";
    setTimeout(() => {
      $("save-status").textContent = "";
    }, 2200);
  } catch (e) {
    $("save-status").textContent = "";
    $("error").hidden = false;
    $("error").textContent = String(e.message || e);
  } finally {
    $("save").disabled = !dirty || !selectedGuildId || !currentGuildHasBot();
  }
}

async function loadGlobalBotSettings() {
  if (!internalAccess?.founder) return;
  const res = await fetch(apiUrl("/api/bot/global-settings"), fetchOptsGet());
  if (!res.ok) return;
  const data = await res.json();
  $("global-bot-username").value = data.desired_username || "";
  $("global-bot-avatar-url").value = "";
  $("global-presence-status").value = data.presence_status || "online";
  $("global-presence-type").value = data.presence_activity_type || "None";
  $("global-presence-text").value = data.presence_activity_text || "";
}

async function saveGlobalBotSettings() {
  if (!internalAccess?.founder) return;
  const status = $("save-global-status");
  status.textContent = "Enregistrement…";
  try {
    const avatarFile = $("global-bot-avatar-file")?.files?.[0] || null;
    const avatarDataUri = avatarFile ? await fileToDataUri(avatarFile) : "";
    const body = {
      desired_username: $("global-bot-username").value.trim(),
      presence_status: $("global-presence-status").value,
      presence_activity_type: $("global-presence-type").value,
      presence_activity_text: $("global-presence-text").value.trim(),
    };
    const avatarUrl = $("global-bot-avatar-url").value.trim();
    if (avatarUrl) body.avatar_url = avatarUrl;
    if (avatarDataUri) body.avatar_data_uri = avatarDataUri;
    const res = await fetch(apiUrl("/api/bot/global-settings"), {
      method: "PUT",
      headers: authHeaders(),
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || j.error || (await res.text()) || "Erreur");
    }
    const data = await res.json();
    $("global-bot-avatar-url").value = "";
    $("global-bot-avatar-file").value = "";
    status.textContent = "Enregistré ✓";
    await refreshBotBranding();
    setTimeout(() => {
      status.textContent = "";
    }, 2200);
  } catch (e) {
    status.textContent = "";
    $("error").hidden = false;
    $("error").textContent = String(e.message || e);
  }
}

$("save").addEventListener("click", save);
$("guild-select").addEventListener("change", onGuildChange);

$("btn-switch-guild")?.addEventListener("click", () => {
  if (dirty) {
    const ok = window.confirm(
      "Modifications non enregistrées. Changer de serveur sans enregistrer ?"
    );
    if (!ok) return;
  }
  showGuildPicker();
});

$("btn-add-custom")?.addEventListener("click", () => {
  if (!guildState) return;
  if (!guildState.custom_commands) guildState.custom_commands = [];
  guildState.custom_commands.push({ trigger: "", response: "" });
  renderCustomCommands();
  setDirty(true);
});

$("log-channel-select").addEventListener("change", () => {
  if (guildState) {
    guildState.log_channel_id = $("log-channel-select").value || null;
  }
  setDirty(true);
});

$("input-prefix").addEventListener("input", () => {
  if (guildState) guildState.prefix = $("input-prefix").value;
  setDirty(true);
  updateOverview();
});

$("switch-logs-master").addEventListener("change", () => {
  if (guildState) {
    guildState.logs_master_enabled = $("switch-logs-master").checked;
  }
  setDirty(true);
  updateOverview();
});

$("input-bot-nickname")?.addEventListener("input", (e) => {
  const v = String(e.target.value ?? "").trim();
  if (v !== String(botProfileState.nickname || "")) setDirty(true);
});

$("input-bot-avatar-url")?.addEventListener("input", (e) => {
  const v = String(e.target.value ?? "").trim();
  if (v !== String(botProfileState.avatar_url || "")) setDirty(true);
});

$("btn-discord-logout")?.addEventListener("click", async () => {
  await fetch(apiUrl("/api/auth/discord/logout"), {
    method: "POST",
    credentials: "include",
  });
  discordOAuthConnected = false;
  $("discord-user-label").hidden = true;
  $("btn-discord-logout").hidden = true;
  const li = $("discord-oauth-link");
  if (li) li.hidden = false;
  await loadData();
});

$("save-global-bot")?.addEventListener("click", saveGlobalBotSettings);

// ============================================================
//  Fenêtre Fonda — onglets + Messages privés du bot
// ============================================================

const fondaState = {
  open: false,
  activeTab: "settings",
  selectedUserId: null,
  threads: [],
  messages: [],
  pollTimer: null,
  threadPollTimer: null,
};

function openFondaModal(initialTab) {
  const modal = $("fonda-modal");
  if (!modal) return;
  fondaState.open = true;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  if (initialTab) switchFondaTab(initialTab);
  refreshFondaThreads().catch(() => null);
  startFondaThreadPolling();
}

function closeFondaModal() {
  const modal = $("fonda-modal");
  if (!modal) return;
  fondaState.open = false;
  modal.hidden = true;
  document.body.style.overflow = "";
  stopFondaThreadPolling();
  stopFondaDmPolling();
}

function switchFondaTab(tabName) {
  fondaState.activeTab = tabName;
  document.querySelectorAll(".fonda-tab").forEach((b) => {
    const active = b.dataset.fondaTab === tabName;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".fonda-tab-panel").forEach((p) => {
    const active = p.dataset.fondaPanel === tabName;
    p.classList.toggle("active", active);
    p.hidden = !active;
  });
  if (tabName === "dms") {
    refreshFondaThreads().catch(() => null);
  }
  if (tabName === "vip") {
    refreshVipList().catch(() => null);
  }
}

// ----- Onglet VIP / Premium (par SERVEUR) -----
//
// Le Premium est désormais lié au SERVEUR Discord, pas à l'utilisateur. Cet
// onglet permet au founder d'activer le statut Premium sur un serveur via
// son ID, en précisant la source ('paid' / 'gift').

async function refreshVipList() {
  if (!internalAccess?.founder) return;
  const root = $("vip-list");
  if (!root) return;
  try {
    const res = await fetch(apiUrl("/api/admin/guild-premium"), fetchOptsGet());
    if (!res.ok) {
      root.innerHTML =
        '<p class="muted tiny vip-empty">Impossible de charger la liste.</p>';
      return;
    }
    const data = await res.json();
    renderVipList(data.guilds || []);
  } catch (e) {
    root.innerHTML = `<p class="muted tiny vip-empty">${escapeHtml(
      e.message || "Erreur"
    )}</p>`;
  }
}

function renderVipList(guilds) {
  const root = $("vip-list");
  if (!root) return;
  if (!guilds.length) {
    root.innerHTML =
      '<p class="muted tiny vip-empty">Aucun serveur Premium pour l’instant.</p>';
    return;
  }
  const sourceLabel = {
    paid: "💳 Payé",
    gift: "🎁 Offert",
  };
  root.innerHTML = "";
  for (const g of guilds) {
    const row = document.createElement("div");
    row.className = "vip-row";
    const sourceClass = `tier-${g.source === "paid" ? "premium" : "vip"}`;
    const expires = g.expires_at
      ? `Expire : ${new Date(g.expires_at).toLocaleString("fr-FR")}`
      : "Pas d’expiration";
    const granted = g.granted_at
      ? `Activé : ${new Date(g.granted_at).toLocaleDateString("fr-FR")}`
      : "—";
    const notes = g.notes ? ` · ${escapeHtml(g.notes)}` : "";
    const displayName = g.name
      ? escapeHtml(g.name)
      : `<span class="muted">(bot non présent)</span>`;
    const icon = g.icon_url
      ? `<img src="${escapeAttr(g.icon_url)}" alt="" width="24" height="24" style="border-radius:6px;margin-right:6px;vertical-align:middle" />`
      : "";
    row.innerHTML = `
      <span class="vip-tier-badge ${sourceClass}">${sourceLabel[g.source] || g.source}</span>
      <div class="vip-row-info">
        <span class="vip-row-id">${icon}${displayName} <span class="muted tiny mono">${escapeHtml(g.guild_id)}</span></span>
        <span class="vip-row-meta">${escapeHtml(granted)} · ${escapeHtml(expires)}${notes}</span>
      </div>
      <div class="vip-row-actions">
        <button type="button" class="btn ghost tiny" data-vip-remove="${escapeAttr(g.guild_id)}">Désactiver</button>
      </div>
    `;
    root.appendChild(row);
  }
  root.querySelectorAll("[data-vip-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeVip(btn.dataset.vipRemove));
  });
}

async function addOrUpdateVip() {
  const guildId = String($("vip-guild-id").value || "").trim();
  const source = $("vip-source").value;
  const expiresLocal = $("vip-expires-at").value;
  const notes = String($("vip-notes").value || "").trim();
  const status = $("vip-save-status");
  if (!guildId) {
    status.textContent = "❌ ID du serveur requis";
    return;
  }
  status.textContent = "Enregistrement…";
  try {
    const body = {
      guild_id: guildId,
      source,
      notes: notes || null,
      expires_at: expiresLocal ? new Date(expiresLocal).toISOString() : null,
    };
    const res = await fetch(apiUrl("/api/admin/guild-premium"), {
      method: "POST",
      headers: authHeaders(),
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || j.error || "Échec");
    }
    status.textContent = "Enregistré ✓";
    $("vip-guild-id").value = "";
    $("vip-expires-at").value = "";
    $("vip-notes").value = "";
    await refreshVipList();
    setTimeout(() => {
      status.textContent = "";
    }, 2000);
  } catch (e) {
    status.textContent = "❌ " + (e.message || "Erreur");
  }
}

async function removeVip(guildId) {
  if (!guildId) return;
  if (!window.confirm(`Désactiver le Premium du serveur ${guildId} ?`)) return;
  try {
    const res = await fetch(
      apiUrl(`/api/admin/guild-premium/${encodeURIComponent(guildId)}`),
      { method: "DELETE", credentials: "include" }
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || j.error || "Échec");
    }
    await refreshVipList();
  } catch (e) {
    alert("Erreur : " + (e.message || e));
  }
}

async function refreshFondaThreads() {
  if (!internalAccess?.founder) return;
  try {
    const res = await fetch(apiUrl("/api/dm/threads"), fetchOptsGet());
    if (!res.ok) return;
    const data = await res.json();
    fondaState.threads = data.threads || [];
    renderFondaThreads();
    updateFondaUnreadBadges();
  } catch {
    // silencieux
  }
}

function renderFondaThreads() {
  const root = $("dm-thread-list");
  if (!root) return;
  if (!fondaState.threads.length) {
    root.innerHTML =
      '<p class="muted tiny dm-empty">Aucun message privé pour l’instant.</p>';
    return;
  }
  root.innerHTML = "";
  for (const t of fondaState.threads) {
    const item = document.createElement("div");
    item.className = "dm-thread-item";
    if (t.user_id === fondaState.selectedUserId) item.classList.add("active");
    const avatar = t.user_avatar || defaultAvatarFor(t.user_id);
    const name =
      t.user_tag || `Utilisateur ${String(t.user_id).slice(-4)}`;
    const previewRaw = t.last_content || "";
    const preview =
      (t.last_direction === "out" ? "Toi : " : "") +
      (previewRaw.length > 60 ? previewRaw.slice(0, 60) + "…" : previewRaw);
    const time = formatRelativeTime(t.last_message_at);
    item.innerHTML = `
      <img class="dm-thread-avatar" src="${escapeAttr(avatar)}" alt="" onerror="this.style.visibility='hidden'" />
      <div class="dm-thread-text">
        <div class="dm-thread-name">${escapeHtml(name)}</div>
        <div class="dm-thread-preview">${escapeHtml(preview || "—")}</div>
      </div>
      <div class="dm-thread-meta">
        <span class="dm-thread-time">${escapeHtml(time)}</span>
        ${t.unread > 0 ? `<span class="dm-thread-unread">${t.unread}</span>` : ""}
      </div>
    `;
    item.addEventListener("click", () => selectFondaThread(t.user_id));
    root.appendChild(item);
  }
}

function updateFondaUnreadBadges() {
  const totalUnread = fondaState.threads.reduce(
    (s, t) => s + (Number(t.unread) || 0),
    0
  );
  const tabBadge = $("fonda-tab-dms-badge");
  if (tabBadge) {
    tabBadge.hidden = totalUnread === 0;
    tabBadge.textContent = String(totalUnread);
  }
  const btnDot = $("fonda-btn-dot");
  if (btnDot) btnDot.hidden = totalUnread === 0;
}

async function selectFondaThread(userId) {
  if (!userId) return;
  fondaState.selectedUserId = userId;
  renderFondaThreads();
  $("dm-main-head").hidden = false;
  $("dm-composer").hidden = false;
  $("dm-messages").innerHTML =
    '<p class="muted tiny dm-placeholder">Chargement…</p>';
  await loadFondaThreadMessages();
  // marque comme lu
  try {
    await fetch(apiUrl(`/api/dm/threads/${encodeURIComponent(userId)}/read`), {
      method: "POST",
      credentials: "include",
    });
    refreshFondaThreads().catch(() => null);
  } catch {
    /* ignore */
  }
  $("dm-composer-input")?.focus();
}

async function loadFondaThreadMessages() {
  if (!fondaState.selectedUserId) return;
  try {
    const res = await fetch(
      apiUrl(`/api/dm/threads/${encodeURIComponent(fondaState.selectedUserId)}`),
      fetchOptsGet()
    );
    if (!res.ok) return;
    const data = await res.json();
    fondaState.messages = data.messages || [];
    renderFondaMessages(data.thread);
  } catch {
    /* ignore */
  }
}

function renderFondaMessages(thread) {
  const root = $("dm-messages");
  if (!root) return;

  // Smart scroll : si l'user était déjà en bas (à 60px près), on re-scrolle.
  // Sinon on respecte sa position de lecture (notamment pendant le polling).
  const wasAtBottom =
    root.scrollHeight - root.scrollTop - root.clientHeight < 60;

  root.innerHTML = "";

  if (thread) {
    $("dm-current-name").textContent =
      thread.user_tag || `Utilisateur ${String(thread.user_id).slice(-4)}`;
    $("dm-current-id").textContent = thread.user_id;
    const av = $("dm-current-avatar");
    av.src = thread.user_avatar || defaultAvatarFor(thread.user_id);
    av.onerror = () => {
      av.style.visibility = "hidden";
    };
  }

  if (!fondaState.messages.length) {
    root.innerHTML =
      '<p class="muted tiny dm-placeholder">Aucun message dans cette conversation.</p>';
    return;
  }

  const userAvatar = thread?.user_avatar || defaultAvatarFor(thread?.user_id);
  const GROUP_WINDOW_MS = 5 * 60 * 1000;

  // 1) Annoter chaque message avec la position dans son groupe (first/last)
  //    et le séparateur de jour le précédant éventuellement.
  const items = fondaState.messages.map((m) => {
    const d = new Date(m.created_at + (m.created_at?.endsWith("Z") ? "" : "Z"));
    return { m, d };
  });

  let lastDayKey = "";
  let prev = null;
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    const dayKey = cur.d.toDateString();
    cur.daySep = dayKey !== lastDayKey ? cur.d : null;
    lastDayKey = dayKey;

    const sameGroupAsPrev =
      prev &&
      prev.m.direction === cur.m.direction &&
      !cur.daySep &&
      cur.d - prev.d < GROUP_WINDOW_MS;

    cur.firstOfGroup = !sameGroupAsPrev;
    if (sameGroupAsPrev) prev.lastOfGroup = false;
    cur.lastOfGroup = true;
    prev = cur;
  }

  // 2) Rendu
  for (const it of items) {
    if (it.daySep) {
      const sep = document.createElement("div");
      sep.className = "dm-day-sep";
      sep.innerHTML = `<span>${escapeHtml(formatDaySep(it.d))}</span>`;
      root.appendChild(sep);
    }

    const row = document.createElement("div");
    row.className = `dm-row ${it.m.direction}`;
    if (it.firstOfGroup) row.classList.add("group-first");
    if (it.lastOfGroup) row.classList.add("group-last");

    const time = it.d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const fullTs = it.d.toLocaleString("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    let attachmentsHtml = "";
    if (Array.isArray(it.m.attachments)) {
      for (const a of it.m.attachments) {
        if (a?.url) {
          attachmentsHtml += `<a class="dm-msg-attachment" href="${escapeAttr(
            a.url
          )}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(
            a.name || "Pièce jointe"
          )}</a>`;
        }
      }
    }

    // Avatar uniquement sur le dernier message du groupe (côté `in`).
    // Pour `out`, on ne met pas d'avatar (le bot s'en passe), ça allège l'UI.
    const avatarSlot =
      it.m.direction === "in"
        ? `<div class="dm-row-avatar">${
            it.lastOfGroup
              ? `<img src="${escapeAttr(userAvatar)}" alt="" />`
              : ""
          }</div>`
        : "";

    row.innerHTML = `
      ${avatarSlot}
      <div class="dm-bubble" title="${escapeAttr(fullTs)}">
        <div class="dm-msg-content">${escapeHtml(it.m.content || "")}</div>
        ${attachmentsHtml}
      </div>
      ${it.lastOfGroup ? `<span class="dm-row-time">${escapeHtml(time)}</span>` : ""}
    `;
    root.appendChild(row);
  }

  if (wasAtBottom) {
    root.scrollTop = root.scrollHeight;
  }
}

function formatDaySep(d) {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Aujourd'hui";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

async function sendFondaDm(content) {
  if (!fondaState.selectedUserId) return;
  const status = $("dm-composer-status");
  const sendBtn = $("dm-send-btn");
  if (sendBtn) sendBtn.disabled = true;
  if (status) status.textContent = "Envoi…";
  try {
    const res = await fetch(
      apiUrl(
        `/api/dm/threads/${encodeURIComponent(
          fondaState.selectedUserId
        )}/messages`
      ),
      {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ content }),
      }
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || j.error || "Échec de l’envoi");
    }
    if (status) status.textContent = "Envoyé ✓";
    setTimeout(() => {
      if (status) status.textContent = "";
    }, 1500);
    await loadFondaThreadMessages();
    refreshFondaThreads().catch(() => null);
    return true;
  } catch (e) {
    if (status) status.textContent = "❌ " + (e.message || "Erreur");
    return false;
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function startFondaThreadPolling() {
  stopFondaThreadPolling();
  fondaState.threadPollTimer = setInterval(() => {
    if (!fondaState.open) return;
    refreshFondaThreads().catch(() => null);
    if (fondaState.selectedUserId && fondaState.activeTab === "dms") {
      loadFondaThreadMessages().catch(() => null);
    }
  }, 6000);
}

function stopFondaThreadPolling() {
  if (fondaState.threadPollTimer) {
    clearInterval(fondaState.threadPollTimer);
    fondaState.threadPollTimer = null;
  }
}

function startFondaDmPolling() {
  stopFondaDmPolling();
  // Poll en arrière-plan (même modal fermée) pour mettre à jour la pastille rouge
  refreshFondaThreads().catch(() => null);
  fondaState.pollTimer = setInterval(() => {
    refreshFondaThreads().catch(() => null);
  }, 20000);
}

function stopFondaDmPolling() {
  if (fondaState.pollTimer) {
    clearInterval(fondaState.pollTimer);
    fondaState.pollTimer = null;
  }
}

function defaultAvatarFor(userId) {
  const n = Number(BigInt(String(userId || "0")) % 5n);
  return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function formatRelativeTime(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "à l’instant";
  if (diff < 3600) return Math.floor(diff / 60) + " min";
  if (diff < 86400) return Math.floor(diff / 3600) + " h";
  if (diff < 7 * 86400) return Math.floor(diff / 86400) + " j";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// --- listeners modal Fonda ---
$("btn-open-fonda")?.addEventListener("click", () => openFondaModal());
document.querySelectorAll("[data-close-fonda]").forEach((el) => {
  el.addEventListener("click", closeFondaModal);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && fondaState.open) closeFondaModal();
});
document.querySelectorAll(".fonda-tab").forEach((b) => {
  b.addEventListener("click", () => switchFondaTab(b.dataset.fondaTab));
});
$("btn-sched-save")?.addEventListener("click", () => saveScheduledMessage());
$("btn-sched-cancel")?.addEventListener("click", () => resetSchedForm());
$("btn-sched-refresh")?.addEventListener("click", () => loadScheduledMessagesList());

$("btn-refresh-warns")?.addEventListener("click", () => loadWarningsList());
$("warn-filter-user")?.addEventListener("change", () => loadWarningsList());
$("warn-filter-user")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadWarningsList();
});

$("btn-refresh-dms")?.addEventListener("click", () => {
  refreshFondaThreads().catch(() => null);
  if (fondaState.selectedUserId) loadFondaThreadMessages().catch(() => null);
});
$("dm-composer")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("dm-composer-input");
  const content = String(input.value || "").trim();
  if (!content) return;
  const ok = await sendFondaDm(content);
  if (ok) input.value = "";
});
$("dm-composer-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("dm-composer").requestSubmit();
  }
});

// --- listeners onglet VIP ---
$("vip-add-btn")?.addEventListener("click", addOrUpdateVip);
$("btn-refresh-vip")?.addEventListener("click", () => {
  refreshVipList().catch(() => null);
});

setDiscordOAuthHref();
initViewNavCache();
initNavSections();

$("sidebar-nav")?.addEventListener("click", (e) => {
  const a = e.target.closest(".nav-link[data-view]");
  if (!a) return;
  const view = a.dataset.view;
  if (!view) return;
  if (location.hash === `#${view}`) {
    e.preventDefault();
    navigate(true);
  }
});

window.wingbotDashboard = {
  apiUrl,
  authHeaders,
  fetchOptsGet,
  getSelectedGuildId: () => selectedGuildId,
  currentGuildHasBot,
  getLastChannels: () => lastGuildChannelsList,
};

loadData();

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".ov-quick-btn[data-go]");
  if (!btn) return;
  const target = btn.dataset.go;
  if (!target) return;
  location.hash = `#${target}`;
});
