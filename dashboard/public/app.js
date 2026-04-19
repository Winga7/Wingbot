const $ = (id) => document.getElementById(id);

const VIEWS = ["overview", "settings", "logs", "commands", "custom", "embeds", "moderation"];

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
 *     block_role_ids: string[],
 *     allow_role_ids: string[],
 *     staff_role_ids: string[],
 *   },
 *   custom_commands: { id?: number, trigger: string, response: string }[]
 * } | null} */
let guildState = null;

const LS_LAST_GUILD_KEY = "wingbot.lastGuildId";

let selectedGuildId = null;
let dirty = false;
let discordOAuthConnected = false;
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
  return VIEWS.includes(h) ? h : "overview";
}

function navigate() {
  const name = getHashView();
  document.querySelectorAll(".view").forEach((v) => {
    v.hidden = v.id !== `view-${name}`;
  });
  document.querySelectorAll(".nav-link").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === name);
  });
  if (name === "embeds" && window.wingbotEmbedWorkbench) {
    window.wingbotEmbedWorkbench.refresh();
  }
}

window.addEventListener("hashchange", navigate);

function setDiscordOAuthHref() {
  const a = $("discord-oauth-link");
  if (a) a.href = apiUrl("/api/auth/discord/login");
}

async function refreshBotBranding() {
  try {
    const r = await fetch(apiUrl("/api/bot/profile"), fetchOptsGet());
    if (!r.ok) return;
    const b = await r.json();
    if (!b?.avatar_url) return;

    const logo = $("sidebar-logo-img");
    if (logo) logo.src = b.avatar_url;

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
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      key === "ignore_channel_ids"
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
      <p><strong>Rôles sans commandes</strong> — ces rôles ne peuvent rien lancer sauf <code>help</code>.</p>
      <p><strong>Rôles autorisés</strong> — au moins une case = liste blanche (eux + admin + propriétaire seulement).</p>
      <p><strong>Staff modération</strong> — au moins une case = commandes modération/admin exigent en plus un de ces rôles.</p>
      <p>Administrateur ou propriétaire Discord : toujours prioritaires sur ces règles.</p>
    </div>
  `;
  root.appendChild(intro);

  root.appendChild(
    renderAccessSection({
      id: "channels",
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
      id: "staff",
      title: "Rôles staff (modération & administration)",
      hint: "Au moins un coché = commandes modération/admin exigent en plus un de ces rôles (ou admin / propriétaire).",
      key: "staff_role_ids",
      items: lastGuildRolesList,
      getLabel: (r) => r.name,
      getColor: roleColorCss,
    })
  );
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
  $("ov-logs").textContent = guildState.logs_master_enabled
    ? "Activé"
    : "Désactivé";
  $("ov-prefix").textContent = guildState.prefix || "$";
  $("ov-cmd-off").textContent = String(effectiveDisabledCommandCount());
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
  const ids = [
    "view-settings",
    "view-logs",
    "view-commands",
    "view-custom",
    "view-embeds",
    "view-moderation",
  ];
  for (const id of ids) {
    const el = $(id);
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
      block_role_ids: normalizeSnowflakeArrayUi(ac.block_role_ids),
      allow_role_ids: normalizeSnowflakeArrayUi(ac.allow_role_ids),
      staff_role_ids: normalizeSnowflakeArrayUi(ac.staff_role_ids),
    },
    custom_commands: Array.isArray(data.custom_commands)
      ? data.custom_commands.map((r) => ({
          id: r.id,
          trigger: r.trigger ?? "",
          response: r.response ?? "",
        }))
      : [],
  };

  setDirty(false);
  $("save-status").textContent = "";
  syncSettingsInputs();
  renderGroups();
  renderCommands();
  renderCustomCommands();
  updateOverview();

  await refreshDiscordForGuild(data.guild_id);
  await loadBotProfileForGuild(data.guild_id);
  renderCommandAccessPanel();
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
  if (res.ok) {
    const j = await res.json();
    discordOAuthConnected = !!j.connected;
    if (j.connected && j.username) {
      u.hidden = false;
      u.textContent = `Discord : ${j.username}`;
      if (lo) lo.hidden = false;
    } else {
      u.hidden = true;
      if (lo) lo.hidden = true;
    }
  }
}

async function loadData() {
  $("error").hidden = true;
  $("error").textContent = "";
  setDiscordOAuthHref();
  await refreshBotBranding();

  const st = await fetch(apiUrl("/api/auth/discord/status"), fetchOptsGet());
  if (!st.ok) {
    $("error").hidden = false;
    $("error").textContent = "Impossible de vérifier la session Discord.";
    return;
  }
  const status = await st.json();
  if (!status.connected) {
    discordOAuthConnected = false;
    $("workspace").hidden = true;
    $("main-top").hidden = true;
    $("views").hidden = true;
    $("stats-section").hidden = true;
    $("discord-user-label").hidden = true;
    $("btn-discord-logout").hidden = true;
    $("error").hidden = false;
    $("error").textContent =
      "Connecte ton compte Discord avec « Voir mes serveurs (admin) ».";
    return;
  }

  const [manRes, cmdManRes, cfgRes, statsRes, accessRes] = await Promise.all([
    fetch(apiUrl("/api/manifest"), fetchOptsGet()),
    fetch(apiUrl("/api/commands-manifest"), fetchOptsGet()),
    fetch(apiUrl("/api/config"), fetchOptsGet()),
    fetch(apiUrl("/api/stats"), fetchOptsGet()),
    fetch(apiUrl("/api/internal/access"), fetchOptsGet()),
  ]);

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
      "Aucun serveur : connecte Discord (bouton « mes serveurs ») pour voir les serveurs où tu es admin, ou configure le bot une première fois sur un serveur.";
    $("workspace").hidden = true;
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

  $("workspace").hidden = false;

  fillGuildSelect();

  if (!location.hash) {
    location.hash = "#overview";
  }

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
    custom_commands: customPayload,
  };

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

$("load").addEventListener("click", loadData);
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

// ----- Onglet VIP / Premium -----

async function refreshVipList() {
  if (!internalAccess?.founder) return;
  const root = $("vip-list");
  if (!root) return;
  try {
    const res = await fetch(apiUrl("/api/admin/premium"), fetchOptsGet());
    if (!res.ok) {
      root.innerHTML =
        '<p class="muted tiny vip-empty">Impossible de charger la liste.</p>';
      return;
    }
    const data = await res.json();
    renderVipList(data.users || []);
  } catch (e) {
    root.innerHTML = `<p class="muted tiny vip-empty">${escapeHtml(
      e.message || "Erreur"
    )}</p>`;
  }
}

function renderVipList(users) {
  const root = $("vip-list");
  if (!root) return;
  if (!users.length) {
    root.innerHTML =
      '<p class="muted tiny vip-empty">Aucun utilisateur VIP / Premium pour l’instant.</p>';
    return;
  }
  const tierLabel = {
    founder: "👑 Founder",
    vip: "💎 VIP",
    premium: "✨ Premium",
  };
  root.innerHTML = "";
  for (const u of users) {
    const row = document.createElement("div");
    row.className = "vip-row";
    const tierClass = `tier-${u.tier}`;
    const expires = u.expires_at
      ? `Expire : ${new Date(u.expires_at).toLocaleString("fr-FR")}`
      : "Pas d’expiration";
    const granted = u.granted_at
      ? `Ajouté : ${new Date(u.granted_at).toLocaleDateString("fr-FR")}`
      : "Source : .env (founder)";
    const note = u.note ? ` · ${escapeHtml(u.note)}` : "";
    const fromEnv = !u.granted_at;
    row.innerHTML = `
      <span class="vip-tier-badge ${tierClass}">${tierLabel[u.tier] || u.tier}</span>
      <div class="vip-row-info">
        <span class="vip-row-id">${escapeHtml(u.user_id)}</span>
        <span class="vip-row-meta">${escapeHtml(granted)} · ${escapeHtml(expires)}${note}</span>
      </div>
      <div class="vip-row-actions">
        ${
          fromEnv
            ? '<span class="muted tiny" title="Défini dans .env, non modifiable ici">.env</span>'
            : `<button type="button" class="btn ghost tiny" data-vip-remove="${escapeAttr(u.user_id)}">Supprimer</button>`
        }
      </div>
    `;
    root.appendChild(row);
  }
  root.querySelectorAll("[data-vip-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeVip(btn.dataset.vipRemove));
  });
}

async function addOrUpdateVip() {
  const userId = String($("vip-user-id").value || "").trim();
  const tier = $("vip-tier").value;
  const expiresLocal = $("vip-expires-at").value;
  const note = String($("vip-note").value || "").trim();
  const status = $("vip-save-status");
  if (!userId) {
    status.textContent = "❌ ID utilisateur requis";
    return;
  }
  status.textContent = "Enregistrement…";
  try {
    const body = {
      user_id: userId,
      tier,
      note: note || null,
      expires_at: expiresLocal ? new Date(expiresLocal).toISOString() : null,
    };
    const res = await fetch(apiUrl("/api/admin/premium"), {
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
    $("vip-user-id").value = "";
    $("vip-expires-at").value = "";
    $("vip-note").value = "";
    await refreshVipList();
    setTimeout(() => {
      status.textContent = "";
    }, 2000);
  } catch (e) {
    status.textContent = "❌ " + (e.message || "Erreur");
  }
}

async function removeVip(userId) {
  if (!userId) return;
  if (!window.confirm(`Retirer l'accès de l'utilisateur ${userId} ?`)) return;
  try {
    const res = await fetch(
      apiUrl(`/api/admin/premium/${encodeURIComponent(userId)}`),
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

  let lastDay = "";
  for (const m of fondaState.messages) {
    const d = new Date(m.created_at + (m.created_at?.endsWith("Z") ? "" : "Z"));
    const dayKey = d.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    if (dayKey !== lastDay) {
      const sep = document.createElement("div");
      sep.className = "dm-day-sep";
      sep.textContent = dayKey;
      root.appendChild(sep);
      lastDay = dayKey;
    }
    const bubble = document.createElement("div");
    bubble.className = `dm-msg ${m.direction}`;
    const time = d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    let attachmentsHtml = "";
    if (Array.isArray(m.attachments)) {
      for (const a of m.attachments) {
        if (a?.url) {
          attachmentsHtml += `<a class="dm-msg-attachment" href="${escapeAttr(
            a.url
          )}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(
            a.name || "Pièce jointe"
          )}</a>`;
        }
      }
    }
    bubble.innerHTML = `
      <div class="dm-msg-content">${escapeHtml(m.content || "")}</div>
      ${attachmentsHtml}
      <span class="dm-msg-time">${escapeHtml(time)}</span>
    `;
    root.appendChild(bubble);
  }
  root.scrollTop = root.scrollHeight;
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

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

window.wingbotDashboard = {
  apiUrl,
  authHeaders,
  fetchOptsGet,
  getSelectedGuildId: () => selectedGuildId,
  currentGuildHasBot,
  getLastChannels: () => lastGuildChannelsList,
};

loadData();

document.querySelectorAll(".nav-link").forEach((a) => {
  a.addEventListener("click", () => {
    setTimeout(navigate, 0);
  });
});
