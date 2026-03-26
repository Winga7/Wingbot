const $ = (id) => document.getElementById(id);

const LS_KEY = "wingbot_dashboard_token";
const LS_API_ORIGIN = "wingbot_api_origin";
const VIEWS = ["overview", "settings", "logs", "commands", "moderation"];

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
 *   commands_disabled: string[]
 * } | null} */
let guildState = null;

let selectedGuildId = null;
let dirty = false;
let discordOAuthConnected = false;

function getApiBase() {
  const raw = ($("api-origin")?.value || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  return (localStorage.getItem(LS_API_ORIGIN) || "").replace(/\/$/, "");
}

function apiUrl(path) {
  const base = getApiBase();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders() {
  const token = $("token").value.trim();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/** GET avec cookie Discord : pas de Content-Type JSON inutile */
function fetchOptsGet() {
  const token = $("token").value.trim();
  return {
    headers: { Authorization: `Bearer ${token}` },
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

function hintApiOriginFromPage() {
  const o = $("api-origin");
  if (!o || o.value.trim()) return;
  const { protocol, host } = window.location;
  if (protocol === "http:" || protocol === "https:") {
    o.placeholder = `${protocol}//${host}`;
  }
}

function setDiscordOAuthHref() {
  const a = $("discord-oauth-link");
  if (a) a.href = apiUrl("/api/auth/discord/login");
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
    { headers: { Authorization: authHeaders().Authorization }, credentials: "include" }
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
    { headers: { Authorization: authHeaders().Authorization }, credentials: "include" }
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
      const dis = new Set(guildState.commands_disabled);
      if (inp.checked) dis.delete(id);
      else dis.add(id);
      guildState.commands_disabled = [...dis];
      setDirty(true);
      updateOverview();
    });
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

  if (
    selectedGuildId &&
    guildPickerList.some((x) => x.guild_id === selectedGuildId)
  ) {
    sel.value = selectedGuildId;
  } else {
    sel.value = guildPickerList[0]?.guild_id || "";
    selectedGuildId = sel.value || null;
  }
}

function syncSettingsInputs() {
  if (!guildState) return;
  $("input-prefix").value = guildState.prefix || "$";
  $("switch-logs-master").checked = !!guildState.logs_master_enabled;
}

function setViewsDisabled(noBot) {
  const ids = ["view-settings", "view-logs", "view-commands"];
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

async function applyGuildData(data) {
  guildState = {
    guild_id: data.guild_id,
    feature_flags: { ...data.feature_flags },
    log_channel_id: data.log_channel_id || null,
    prefix: data.prefix ?? "$",
    logs_master_enabled:
      data.logs_master_enabled !== undefined ? !!data.logs_master_enabled : true,
    commands_disabled: Array.isArray(data.commands_disabled)
      ? [...data.commands_disabled]
      : [],
  };

  setDirty(false);
  $("save-status").textContent = "";
  syncSettingsInputs();
  renderGroups();
  renderCommands();
  updateOverview();

  await refreshDiscordForGuild(data.guild_id);

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
  $("log-channel-select").innerHTML = "";
  $("ov-logs").textContent = "—";
  $("ov-prefix").textContent = "—";
  $("ov-cmd-off").textContent = "—";
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
  const token = $("token").value.trim();
  $("error").hidden = true;
  $("error").textContent = "";

  if (!token) {
    $("error").hidden = false;
    $("error").textContent = "Indique le token DASHBOARD_TOKEN.";
    return;
  }

  localStorage.setItem(LS_KEY, token);
  const apiInput = ($("api-origin")?.value || "").trim();
  if (apiInput) {
    localStorage.setItem(LS_API_ORIGIN, apiInput.replace(/\/$/, ""));
  } else {
    localStorage.removeItem(LS_API_ORIGIN);
  }

  setDiscordOAuthHref();

  const headers = { Authorization: `Bearer ${token}` };

  const [manRes, cmdManRes, cfgRes, statsRes] = await Promise.all([
    fetch(apiUrl("/api/manifest"), { headers }),
    fetch(apiUrl("/api/commands-manifest"), { headers }),
    fetch(apiUrl("/api/config"), { headers }),
    fetch(apiUrl("/api/stats"), { headers }),
  ]);

  if (!manRes.ok || !cmdManRes.ok || !cfgRes.ok || !statsRes.ok) {
    const bad = !manRes.ok ? manRes : !cmdManRes.ok ? cmdManRes : !cfgRes.ok ? cfgRes : statsRes;
    let err = await bad.text();
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

  const firstId = selectedGuildId || guildPickerList[0].guild_id;
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

  const body = {
    feature_flags: { ...guildState.feature_flags },
    log_channel_id: $("log-channel-select").value.trim() || null,
    prefix: ($("input-prefix").value || "").trim() || "$",
    logs_master_enabled: $("switch-logs-master").checked,
    commands_disabled: [...guildState.commands_disabled],
  };

  try {
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

$("load").addEventListener("click", loadData);
$("save").addEventListener("click", save);
$("guild-select").addEventListener("change", onGuildChange);

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

$("token").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadData();
});

$("btn-discord-logout")?.addEventListener("click", async () => {
  await fetch(apiUrl("/api/auth/discord/logout"), {
    method: "POST",
    headers: authHeaders(),
    credentials: "include",
  });
  discordOAuthConnected = false;
  $("discord-user-label").hidden = true;
  $("btn-discord-logout").hidden = true;
  await loadData();
});

const saved = localStorage.getItem(LS_KEY);
if (saved) $("token").value = saved;
const savedApi = localStorage.getItem(LS_API_ORIGIN);
if (savedApi && $("api-origin")) $("api-origin").value = savedApi;
hintApiOriginFromPage();
setDiscordOAuthHref();

document.querySelectorAll(".nav-link").forEach((a) => {
  a.addEventListener("click", () => {
    setTimeout(navigate, 0);
  });
});
