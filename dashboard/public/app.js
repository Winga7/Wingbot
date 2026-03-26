const $ = (id) => document.getElementById(id);

const LS_KEY = "wingbot_dashboard_token";
const LS_API_ORIGIN = "wingbot_api_origin";

/** @type {Record<string, { id: string, name: string, icon_url: string | null }>} */
let guildMeta = {};

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

let manifest = { groups: [] };
let guilds = [];
/** @type {Record<string, boolean>} */
let flags = {};
let selectedGuildId = null;
let dirty = false;

function authHeaders() {
  const token = $("token").value.trim();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function hintApiOriginFromPage() {
  const o = $("api-origin");
  if (!o || o.value.trim()) return;
  const { protocol, host } = window.location;
  if (protocol === "http:" || protocol === "https:") {
    o.placeholder = `${protocol}//${host}`;
  }
}

function setDirty(v) {
  dirty = v;
  $("save").disabled = !v || !selectedGuildId;
  $("dirty-hint").hidden = !v;
}

function renderGroups() {
  const root = $("groups-root");
  root.innerHTML = "";

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
      flags[k] = el.checked;
      setDirty(true);
    });
  });

  root.querySelectorAll(".btn-all-on").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const gid = btn.getAttribute("data-group");
      const group = manifest.groups.find((x) => x.id === gid);
      if (!group) return;
      for (const k of group.keys) flags[k.id] = true;
      syncCheckboxes();
      setDirty(true);
    });
  });

  root.querySelectorAll(".btn-all-off").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const gid = btn.getAttribute("data-group");
      const group = manifest.groups.find((x) => x.id === gid);
      if (!group) return;
      for (const k of group.keys) flags[k.id] = false;
      syncCheckboxes();
      setDirty(true);
    });
  });
}

function syncCheckboxes() {
  for (const [k, v] of Object.entries(flags)) {
    const el = document.getElementById(`flag-${k}`);
    if (el) el.checked = !!v;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fillGuildSelect() {
  const sel = $("guild-select");
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— Choisir —";
  sel.appendChild(opt0);

  for (const g of guilds) {
    const o = document.createElement("option");
    o.value = g.guild_id;
    const meta = guildMeta[g.guild_id];
    o.textContent = meta?.name ? meta.name : g.guild_id;
    sel.appendChild(o);
  }

  if (selectedGuildId && guilds.some((x) => x.guild_id === selectedGuildId)) {
    sel.value = selectedGuildId;
  } else {
    sel.value = guilds[0]?.guild_id || "";
    selectedGuildId = sel.value || null;
  }
}

function updateGuildHeader(guildId) {
  const meta = guildMeta[guildId];
  const img = $("guild-icon");
  const title = $("panel-title");
  const sub = $("panel-sub");
  const warnMeta = $("discord-warn-meta");

  if (meta?.icon_url) {
    img.src = meta.icon_url;
    img.hidden = false;
  } else {
    img.removeAttribute("src");
    img.hidden = true;
  }

  if (meta?.name) {
    title.textContent = meta.name;
    sub.textContent = "Dossier local · wingbot.db";
    warnMeta.hidden = true;
    warnMeta.textContent = "";
  } else {
    title.textContent = "Configuration des logs";
    sub.textContent =
      "Impossible de charger le nom depuis Discord (vérifie TOKEN du bot dans .env).";
    warnMeta.hidden = false;
    warnMeta.textContent =
      "Ajoute `TOKEN` (token du bot) dans le `.env` à la racine du projet, puis redémarre le dashboard.";
  }
}

async function fetchGuildMeta(guildId) {
  const res = await fetch(
    apiUrl(`/api/discord/guilds/${encodeURIComponent(guildId)}`),
    { headers: { Authorization: authHeaders().Authorization } }
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
    { headers: { Authorization: authHeaders().Authorization } }
  );

  if (!res.ok) {
    const w = $("discord-warn-channels");
    w.hidden = false;
    w.textContent =
      "Impossible de charger la liste des salons (bot absent du serveur, TOKEN invalide, ou erreur Discord). Tu peux enregistrer quand même si le salon est déjà en base.";
    return;
  }

  const wCh = $("discord-warn-channels");
  wCh.hidden = true;
  wCh.textContent = "";

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

async function refreshDiscordForGuild(guildId) {
  if (!guildMeta[guildId]?.name) {
    await fetchGuildMeta(guildId);
  }
  updateGuildHeader(guildId);
  await loadChannelSelect(guildId);
}

async function applyGuildData(data) {
  flags = { ...data.feature_flags };
  setDirty(false);
  $("save-status").textContent = "";
  renderGroups();
  await refreshDiscordForGuild(data.guild_id);

  const sel = $("log-channel-select");
  const id = data.log_channel_id || "";
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
      o.textContent = `Salon inconnu ou inaccessible (#${id.slice(-6)})`;
      sel.appendChild(o);
      sel.value = id;
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

  const headers = { Authorization: `Bearer ${token}` };

  const [manRes, cfgRes, statsRes] = await Promise.all([
    fetch(apiUrl("/api/manifest"), { headers }),
    fetch(apiUrl("/api/config"), { headers }),
    fetch(apiUrl("/api/stats"), { headers }),
  ]);

  if (!manRes.ok || !cfgRes.ok || !statsRes.ok) {
    const bad = !manRes.ok ? manRes : !cfgRes.ok ? cfgRes : statsRes;
    let err = await bad.text();
    if (
      err.includes("Cannot GET") ||
      err.includes("<!DOCTYPE html>") ||
      bad.status === 404
    ) {
      err =
        "L’API du dashboard n’est pas joignable à cette adresse. Soit tu n’ouvres pas la bonne URL : lance « npm run dashboard » et va sur http://127.0.0.1:3847 (ou le port DASHBOARD_PORT). Soit tu utilises Live Server : indique alors l’URL complète du serveur Node ci-dessus (ex. http://127.0.0.1:3847), sans slash final.";
    }
    $("error").hidden = false;
    $("error").textContent = err || "Erreur API (token invalide ?)";
    return;
  }

  manifest = await manRes.json();
  const config = await cfgRes.json();
  const stats = await statsRes.json();

  guilds = config.guilds || [];
  guildMeta = {};

  $("stat-guilds").textContent = stats.serveurs_configures ?? "0";
  $("stat-cache").textContent = stats.messages_en_cache ?? "0";
  $("stats-section").hidden = false;

  if (guilds.length === 0) {
    $("error").hidden = false;
    $("error").textContent =
      "Aucun serveur en base — utilise le bot (ex. /setlogchannel) pour créer une entrée.";
    $("main-panel").hidden = true;
    return;
  }

  await Promise.all(guilds.map((g) => fetchGuildMeta(g.guild_id)));

  $("main-panel").hidden = false;
  fillGuildSelect();

  const firstId = selectedGuildId || guilds[0].guild_id;
  const row = guilds.find((x) => x.guild_id === firstId) || guilds[0];
  selectedGuildId = row.guild_id;
  $("guild-select").value = selectedGuildId;
  await applyGuildData(row);
}

async function onGuildChange() {
  const id = $("guild-select").value;
  if (!id) return;
  const previous = selectedGuildId;

  if (dirty) {
    const ok = window.confirm(
      "Tu as des changements non enregistrés. Continuer sans enregistrer ?"
    );
    if (!ok) {
      $("guild-select").value = previous || "";
      return;
    }
  }

  selectedGuildId = id;

  $("save-status").textContent = "Chargement…";
  const res = await fetch(apiUrl(`/api/guilds/${encodeURIComponent(id)}`), {
    headers: authHeaders(),
  });
  if (!res.ok) {
    $("save-status").textContent = "";
    $("error").hidden = false;
    $("error").textContent = await res.text();
    return;
  }
  const data = await res.json();
  await applyGuildData(data);
  $("save-status").textContent = "";
}

async function save() {
  if (!selectedGuildId) return;
  $("save").disabled = true;
  $("save-status").textContent = "Enregistrement…";

  const body = {
    feature_flags: { ...flags },
    log_channel_id: $("log-channel-select").value.trim() || null,
  };

  try {
    const res = await fetch(
      apiUrl(`/api/guilds/${encodeURIComponent(selectedGuildId)}`),
      {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const t = await res.text();
      $("save-status").textContent = "";
      $("error").hidden = false;
      $("error").textContent = t || "Erreur enregistrement";
      return;
    }

    const data = await res.json();
    const idx = guilds.findIndex((g) => g.guild_id === data.guild_id);
    if (idx >= 0) guilds[idx] = data;
    else guilds.push(data);

    await applyGuildData(data);
    $("save-status").textContent = "Enregistré ✓";
    setTimeout(() => {
      $("save-status").textContent = "";
    }, 2500);
  } catch (e) {
    $("save-status").textContent = "";
    $("error").hidden = false;
    $("error").textContent = String(e.message || e);
  } finally {
    $("save").disabled = !dirty || !selectedGuildId;
  }
}

$("load").addEventListener("click", loadData);
$("save").addEventListener("click", save);
$("guild-select").addEventListener("change", onGuildChange);

$("log-channel-select").addEventListener("change", () => setDirty(true));

$("token").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadData();
});

const saved = localStorage.getItem(LS_KEY);
if (saved) {
  $("token").value = saved;
}
const savedApi = localStorage.getItem(LS_API_ORIGIN);
if (savedApi && $("api-origin")) {
  $("api-origin").value = savedApi;
}
hintApiOriginFromPage();
