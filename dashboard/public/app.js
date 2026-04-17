const $ = (id) => document.getElementById(id);

const VIEWS = ["overview", "settings", "logs", "commands", "custom", "moderation"];

let manifest = { groups: [] };
let commandManifest = { groups: [], commands: [] };

/** Lignes pour le sélecteur : depuis /api/me/guilds ou repli config */
let guildPickerList = [];

let guilds = [];
/** @type {Record<string, { id: string, name: string, icon_url: string | null }>} */
let guildMeta = {};

/** @type {{
 *   guild_id: string,
 *   feature_flags: Record<string, boolean>,
 *   log_channel_id: string | null,
 *   prefix: string,
 *   logs_master_enabled: boolean,
 *   commands_disabled: string[],
 *   custom_commands: { id?: number, trigger: string, response: string }[]
 * } | null} */
let guildState = null;

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

function renderCommands() {
  const root = $("commands-root");
  if (!root || !guildState) return;
  root.innerHTML = "";
  const groups = commandManifest.groups || [];
  const cmds = commandManifest.commands || [];

  for (const g of groups) {
    const section = document.createElement("div");
    section.className = "cmd-group";
    const h = document.createElement("h4");
    h.textContent = `${g.icon || ""} ${g.title}`.trim();
    section.appendChild(h);

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
      const enabled = !guildState.commands_disabled.includes(c.id);
      const row = document.createElement("label");
      row.className = "cmd-row";
      row.innerHTML = `
        <input type="checkbox" data-cmd="${escapeHtml(c.id)}" ${enabled ? "checked" : ""} />
        <span class="cmd-row-text">
          <strong class="mono">${escapeHtml(c.label)}</strong>
          <span class="muted tiny">${escapeHtml(c.description)}</span>
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

function updateOverview() {
  if (!guildState) return;
  $("ov-logs").textContent = guildState.logs_master_enabled
    ? "Activé"
    : "Désactivé";
  $("ov-prefix").textContent = guildState.prefix || "$";
  $("ov-cmd-off").textContent = String(guildState.commands_disabled.length);
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

  const firstWithBot = guildPickerList.find((x) => x.bot_in_guild)?.guild_id || "";
  if (
    selectedGuildId &&
    guildPickerList.some((x) => x.guild_id === selectedGuildId)
  ) {
    sel.value = selectedGuildId;
  } else {
    sel.value = firstWithBot || guildPickerList[0]?.guild_id || "";
    selectedGuildId = sel.value || null;
  }
}

function syncSettingsInputs() {
  if (!guildState) return;
  $("input-prefix").value = guildState.prefix || "$";
  $("switch-logs-master").checked = !!guildState.logs_master_enabled;
}

function setViewsDisabled(noBot) {
  const ids = ["view-settings", "view-logs", "view-commands", "view-custom"];
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
  guildState = {
    guild_id: data.guild_id,
    feature_flags: { ...data.feature_flags },
    log_channel_id: data.log_channel_id || null,
    prefix: data.prefix ?? "$",
    logs_master_enabled:
      data.logs_master_enabled !== undefined ? !!data.logs_master_enabled : true,
    commands_disabled: dis.filter((id) => id !== "help"),
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
  $("groups-root").innerHTML = "";
  $("commands-root").innerHTML = "";
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
  const founderMenu = $("founder-menu");
  if (founderMenu) founderMenu.hidden = !internalAccess?.founder;
  if (internalAccess?.founder) {
    loadGlobalBotSettings().catch(() => null);
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
  $("main-top").hidden = false;
  $("views").hidden = false;

  fillGuildSelect();

  const fallbackId =
    guildPickerList.find((x) => x.bot_in_guild)?.guild_id ||
    guildPickerList[0].guild_id;
  const firstId = selectedGuildId || fallbackId;
  const pick = guildPickerList.find((x) => x.guild_id === firstId) || guildPickerList[0];
  selectedGuildId = pick.guild_id;
  $("guild-select").value = selectedGuildId;

  if (!location.hash) {
    location.hash = "#overview";
  }
  navigate();

  const params = new URLSearchParams(location.search);
  if (params.get("discord") === "connected") {
    history.replaceState({}, "", location.pathname + location.hash);
  }

  if (!pick.bot_in_guild) {
    await clearGuildUiForNoBot();
    updateGuildHeader(selectedGuildId);
    updateInviteBanner();
    setViewsDisabled(true);
    return;
  }

  setViewsDisabled(false);

  const res = await fetch(
    apiUrl(`/api/guilds/${encodeURIComponent(selectedGuildId)}`),
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
}

async function onGuildChange() {
  const id = $("guild-select").value;
  if (!id) return;
  const previous = selectedGuildId;

  if (dirty) {
    const ok = window.confirm(
      "Modifications non enregistrées. Continuer sans enregistrer ?"
    );
    if (!ok) {
      $("guild-select").value = previous || "";
      return;
    }
  }

  selectedGuildId = id;
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

$("input-bot-nickname")?.addEventListener("input", () => {
  setDirty(true);
});

$("input-bot-avatar-url")?.addEventListener("input", () => {
  setDirty(true);
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

setDiscordOAuthHref();
loadData();

document.querySelectorAll(".nav-link").forEach((a) => {
  a.addEventListener("click", () => {
    setTimeout(navigate, 0);
  });
});
