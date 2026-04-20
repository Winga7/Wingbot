/**
 * Constructeur d’embeds (salon Discord, aperçu, édition du message).
 * Dépend de window.wingbotDashboard (défini dans app.js).
 */
(function () {
  const D = () => window.wingbotDashboard;
  const $ = (id) => document.getElementById(id);

  let embedList = [];
  let selectedEmbedId = null;
  let formPayload = null;
  let previewTimer = null;
  let savedSnapshot = null;
  let lastFocusedField = null;

  const TOKENS = [
    { t: "{guild}", l: "nom serveur", k: "info" },
    { t: "{guild.members}", l: "nb membres", k: "info" },
    { t: "{channel}", l: "#salon cible", k: "info" },
    { t: "{date}", l: "date", k: "time" },
    { t: "{time}", l: "heure", k: "time" },
    { t: "<t:{now}:F>", l: "horodatage complet", k: "time" },
    { t: "<t:{now}:R>", l: "il y a…", k: "time" },
    { t: "<@USER_ID>", l: "mention @user", k: "mention" },
    { t: "<@&ROLE_ID>", l: "mention @rôle", k: "mention" },
    { t: "<#CHANNEL_ID>", l: "mention #salon", k: "mention" },
  ];

  function defaultPayload() {
    return {
      content: "",
      embed: {
        title: "",
        description: "",
        color: 0x5865f2,
        url: "",
        timestamp: null,
        footer_text: "",
        footer_icon_url: "",
        author_name: "",
        author_icon_url: "",
        author_url: "",
        thumbnail_url: "",
        image_url: "",
        fields: [],
      },
      mentions: { user_ids: [], role_ids: [], parse_everyone: false },
    };
  }

  function hexColor(n) {
    const v = Number(n);
    const x =
      Number.isFinite(v) && v >= 0 ? (v >>> 0) & 0xffffff : 0x5865f2;
    return `#${x.toString(16).padStart(6, "0")}`;
  }

  /* Palette curatée pour l'embed builder. Groupée par vibe.
     Discord officiel → brand → pastel → neutre. */
  const COLOR_PRESETS = [
    { label: "Discord", colors: [
      "#5865f2", "#57f287", "#fee75c", "#eb459e", "#ed4245", "#99aab5",
    ]},
    { label: "Brand", colors: [
      "#9146ff", "#ff0000", "#1da1f2", "#00d1b2", "#ff6600", "#0099ff",
    ]},
    { label: "Vibrant", colors: [
      "#a78bfa", "#f472b6", "#22d3ee", "#fcd34d", "#4ade80", "#fb923c",
    ]},
    { label: "Neutre", colors: [
      "#ffffff", "#c4c4c4", "#6b7280", "#374151", "#1f2937", "#000000",
    ]},
  ];

  function normalizeHex(str) {
    const s = String(str || "").trim().toLowerCase().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/.test(s)) {
      return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
    }
    if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
    return null;
  }

  /* Écrit la couleur dans le champ caché + met à jour le swatch visible +
     notifie le reste du monde (schedulePreview + dirty tracking). */
  function setEmbedColor(hex) {
    const norm = normalizeHex(hex) || "#5865f2";
    const input = document.getElementById("emb-color");
    if (!input) return;
    input.value = norm;

    const swatch = document.querySelector(".emb-color-swatch");
    if (swatch) swatch.style.background = norm;
    const label = document.querySelector(".emb-color-hex");
    if (label) label.textContent = norm.toUpperCase();

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setupColorPicker() {
    const pop = document.getElementById("emb-color-pop");
    const btn = document.getElementById("emb-color-btn");
    const hidden = document.getElementById("emb-color");
    if (!pop || !btn || !hidden) return;

    let swatchesHtml = '<div class="emb-color-presets">';
    for (const group of COLOR_PRESETS) {
      swatchesHtml += `<div class="emb-color-group"><span class="emb-color-group-label">${group.label}</span><div class="emb-color-swatches">`;
      for (const c of group.colors) {
        swatchesHtml += `<button type="button" class="emb-color-dot" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`;
      }
      swatchesHtml += "</div></div>";
    }
    swatchesHtml += "</div>";

    pop.innerHTML = `
      ${swatchesHtml}
      <div class="emb-color-custom">
        <span class="emb-color-custom-preview" id="emb-color-preview"></span>
        <span class="emb-color-hash">#</span>
        <input type="text" id="emb-color-hex-input" class="emb-color-hex-input mono" maxlength="7" spellcheck="false" autocomplete="off" placeholder="5865f2" />
      </div>
    `;

    const preview = pop.querySelector("#emb-color-preview");
    const hexInput = pop.querySelector("#emb-color-hex-input");

    const syncPreview = (hex) => {
      if (preview) preview.style.background = hex;
    };

    const markActiveDot = (hex) => {
      pop.querySelectorAll(".emb-color-dot").forEach((d) => {
        d.classList.toggle(
          "is-active",
          d.dataset.color?.toLowerCase() === hex.toLowerCase()
        );
      });
    };

    const openPop = () => {
      pop.hidden = false;
      btn.classList.add("is-open");
      const cur = normalizeHex(hidden.value) || "#5865f2";
      hexInput.value = cur.replace(/^#/, "");
      syncPreview(cur);
      markActiveDot(cur);
      requestAnimationFrame(() => hexInput.focus());
    };

    const closePop = () => {
      pop.hidden = true;
      btn.classList.remove("is-open");
    };

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop.hidden) openPop();
      else closePop();
    });

    pop.addEventListener("click", (e) => e.stopPropagation());

    pop.addEventListener("click", (e) => {
      const dot = e.target.closest(".emb-color-dot");
      if (!dot) return;
      const hex = dot.dataset.color;
      if (!hex) return;
      setEmbedColor(hex);
      hexInput.value = hex.replace(/^#/, "");
      syncPreview(hex);
      markActiveDot(hex);
    });

    hexInput.addEventListener("input", () => {
      const norm = normalizeHex(hexInput.value);
      if (!norm) return;
      setEmbedColor(norm);
      syncPreview(norm);
      markActiveDot(norm);
    });

    hexInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        closePop();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePop();
      }
    });

    document.addEventListener("click", (e) => {
      if (pop.hidden) return;
      if (!pop.contains(e.target) && !btn.contains(e.target)) closePop();
    });

    /* État initial du swatch — synchronise le visuel avec la valeur du hidden. */
    setEmbedColor(hidden.value || "#5865f2");
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Format proche de l'embed Discord :
     - Aujourd'hui      → "Aujourd'hui à 14:32"
     - Hier             → "Hier à 14:32"
     - Cette année      → "12 mars 2025 14:32"
     - Sinon date longue */
  function formatPreviewTimestamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (sameDay) return `Aujourd'hui à ${time}`;
    if (isYesterday) return `Hier à ${time}`;
    return d.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }) + ` ${time}`;
  }

  function readFormToPayload() {
    const p = defaultPayload();
    p.content = $("emb-content")?.value ?? "";
    p.embed.title = $("emb-title")?.value ?? "";
    p.embed.description = $("emb-desc")?.value ?? "";
    const col = $("emb-color")?.value ?? "#5865f2";
    p.embed.color = parseInt(String(col).replace(/^#/, ""), 16) || 0x5865f2;
    p.embed.url = $("emb-url")?.value ?? "";
    p.embed.footer_text = $("emb-footer-t")?.value ?? "";
    p.embed.footer_icon_url = $("emb-footer-i")?.value ?? "";
    p.embed.author_name = $("emb-author-n")?.value ?? "";
    p.embed.author_icon_url = $("emb-author-i")?.value ?? "";
    p.embed.author_url = $("emb-author-u")?.value ?? "";
    p.embed.thumbnail_url = $("emb-thumb")?.value ?? "";
    p.embed.image_url = $("emb-image")?.value ?? "";
    if ($("emb-ts")?.checked) {
      const v = $("emb-ts-val")?.value;
      p.embed.timestamp = v ? new Date(v).toISOString() : new Date().toISOString();
    } else {
      p.embed.timestamp = null;
    }
    p.mentions.user_ids = String($("emb-m-users")?.value ?? "")
      .split(/[\s,;]+/)
      .map((x) => x.replace(/\D/g, ""))
      .filter((x) => /^\d{17,20}$/.test(x));
    p.mentions.role_ids = String($("emb-m-roles")?.value ?? "")
      .split(/[\s,;]+/)
      .map((x) => x.replace(/\D/g, ""))
      .filter((x) => /^\d{17,20}$/.test(x));
    p.mentions.parse_everyone = !!$("emb-m-everyone")?.checked;
    const rows = document.querySelectorAll(".emb-field-row");
    p.embed.fields = [];
    rows.forEach((row) => {
      const name = row.querySelector(".emb-f-name")?.value ?? "";
      const value = row.querySelector(".emb-f-val")?.value ?? "";
      const inline = row.querySelector(".emb-f-inline")?.checked ?? false;
      if (!name.trim() && !value.trim()) return;
      p.embed.fields.push({ name, value, inline });
    });
    return p;
  }

  function applyPayloadToForm(p) {
    const base = defaultPayload();
    const m = Object.assign(base, p || {});
    m.embed = Object.assign(base.embed, (p && p.embed) || {});
    m.mentions = Object.assign(base.mentions, (p && p.mentions) || {});
    if (!Array.isArray(m.embed.fields)) m.embed.fields = [];
    $("emb-content").value = m.content || "";
    $("emb-title").value = m.embed.title || "";
    $("emb-desc").value = m.embed.description || "";
    setEmbedColor(
      hexColor(
        m.embed.color != null && m.embed.color !== ""
          ? Number(m.embed.color)
          : 0x5865f2
      )
    );
    $("emb-url").value = m.embed.url || "";
    $("emb-footer-t").value = m.embed.footer_text || "";
    $("emb-footer-i").value = m.embed.footer_icon_url || "";
    $("emb-author-n").value = m.embed.author_name || "";
    $("emb-author-i").value = m.embed.author_icon_url || "";
    $("emb-author-u").value = m.embed.author_url || "";
    $("emb-thumb").value = m.embed.thumbnail_url || "";
    $("emb-image").value = m.embed.image_url || "";
    const hasTs = !!m.embed.timestamp;
    $("emb-ts").checked = hasTs;
    $("emb-ts-val").value = hasTs
      ? String(m.embed.timestamp).slice(0, 16)
      : "";
    $("emb-m-users").value = (m.mentions.user_ids || []).join(" ");
    $("emb-m-roles").value = (m.mentions.role_ids || []).join(" ");
    $("emb-m-everyone").checked = !!m.mentions.parse_everyone;
    renderFieldRows(m.embed.fields);
    schedulePreview();
  }

  function renderFieldRows(fields) {
    const root = $("emb-fields");
    if (!root) return;
    root.innerHTML = "";
    const list = fields.length ? fields : [{ name: "", value: "", inline: false }];
    list.forEach((f) => {
      const row = document.createElement("div");
      row.className = "emb-field-row";
      row.innerHTML = `
        <input type="text" class="input-sm mono emb-f-name" placeholder="Nom du champ" maxlength="256" />
        <label class="emb-inline-lab"><input type="checkbox" class="emb-f-inline" /> Sur une ligne</label>
        <textarea class="input-sm emb-f-val" rows="2" placeholder="Valeur (markdown Discord)" maxlength="1024"></textarea>
        <button type="button" class="btn link emb-f-del">Retirer</button>`;
      row.querySelector(".emb-f-name").value = f.name || "";
      row.querySelector(".emb-f-val").value = f.value || "";
      row.querySelector(".emb-f-inline").checked = !!f.inline;
      row.querySelector(".emb-f-del").addEventListener("click", () => {
        row.remove();
        if (!$("emb-fields").querySelector(".emb-field-row")) addFieldRow();
        schedulePreview();
      });
      row.querySelectorAll("input, textarea").forEach((el) => {
        el.addEventListener("input", schedulePreview);
        el.addEventListener("change", schedulePreview);
      });
      root.appendChild(row);
    });
  }

  function addFieldRow() {
    renderFieldRows([...(readFormToPayload().embed.fields || []), { name: "", value: "", inline: false }]);
    schedulePreview();
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 90);
  }

  function runPreview() {
    const mount = $("emb-preview");
    if (!mount) return;
    const p = readFormToPayload();
    const e = p.embed;
    const col = hexColor(e.color != null ? e.color : 0x5865f2);
    let fieldsHtml = "";
    (e.fields || []).forEach((f) => {
      if (!f.name && !f.value) return;
      const cls = "d-emb-field" + (f.inline ? " is-inline" : "");
      fieldsHtml += `<div class="${cls}"><span class="d-emb-fn">${esc(f.name) || " "}</span><div class="d-emb-fv">${esc(f.value).replace(/\n/g, "<br/>")}</div></div>`;
    });
    const auth =
      e.author_name || e.author_icon_url
        ? `<div class="d-emb-author">${e.author_icon_url ? `<img class="d-emb-aimg" src="${esc(e.author_icon_url)}" alt="" />` : ""}<span>${esc(e.author_name)}</span></div>`
        : "";
    const thumb = e.thumbnail_url
      ? `<img class="d-emb-thumb" src="${esc(e.thumbnail_url)}" alt="" />`
      : "";
    const img = e.image_url ? `<img class="d-emb-img" src="${esc(e.image_url)}" alt="" />` : "";
    const titleLine = e.title
      ? `<div class="d-emb-title">${e.url ? `<a href="${esc(e.url)}">${esc(e.title)}</a>` : esc(e.title)}</div>`
      : "";
    const desc = e.description
      ? `<div class="d-emb-desc">${esc(e.description).replace(/\n/g, "<br/>")}</div>`
      : "";
    const tsText = e.timestamp ? formatPreviewTimestamp(e.timestamp) : "";
    const hasFooter = !!(e.footer_text || e.footer_icon_url || tsText);
    const sep = (e.footer_text || e.footer_icon_url) && tsText
      ? `<span class="d-emb-foot-sep">•</span>`
      : "";
    const foot = hasFooter
      ? `<div class="d-emb-foot">${e.footer_icon_url ? `<img class="d-emb-fimg" src="${esc(e.footer_icon_url)}" alt="" />` : ""}${e.footer_text ? `<span>${esc(e.footer_text)}</span>` : ""}${sep}${tsText ? `<span class="d-emb-ts">${esc(tsText)}</span>` : ""}</div>`
      : "";

    mount.innerHTML = `
      <div class="d-emb-wrap">
        ${p.content ? `<div class="d-emb-content">${esc(p.content).replace(/\n/g, "<br/>")}</div>` : ""}
        <div class="d-emb-card" style="border-left-color:${col}">
          <div class="d-emb-inner">
            ${thumb}
            <div class="d-emb-main">
              ${auth}
              ${titleLine}
              ${desc}
              ${fieldsHtml ? `<div class="d-emb-fields">${fieldsHtml}</div>` : ""}
              ${img}
              ${foot}
            </div>
          </div>
        </div>
        <p class="muted tiny" style="margin-top:0.5rem">Aperçu approximatif — les tokens ({guild}, {channel}, {date}…) seront remplacés à l’envoi.</p>
      </div>`;
    updateDirty();
  }

  function fillChannelSelect() {
    const sel = $("emb-channel");
    if (!sel) return;
    sel.innerHTML = '<option value="">— Choisir un salon —</option>';
    const chans = D()?.getLastChannels?.() || [];
    for (const ch of chans) {
      const o = document.createElement("option");
      o.value = ch.id;
      o.textContent = `#${ch.name}`;
      sel.appendChild(o);
    }
  }

  function setStatus(t) {
    const el = $("emb-status");
    if (el) el.textContent = t || "";
  }

  async function api(path, opts = {}) {
    const { apiUrl, fetchOptsGet, authHeaders } = D();
    const url = apiUrl(path);
    const method = opts.method || "GET";
    const ro = { credentials: "include", method };
    if (method === "GET" || method === "HEAD") {
      Object.assign(ro, fetchOptsGet());
    } else {
      ro.headers = { ...authHeaders(), ...opts.headers };
      if (opts.body !== undefined) {
        ro.body =
          typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      }
    }
    const res = await fetch(url, ro);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || j.error || res.statusText);
    return j;
  }

  async function loadList() {
    const gid = D()?.getSelectedGuildId?.();
    if (!gid || !D().currentGuildHasBot()) {
      embedList = [];
      selectedEmbedId = null;
      renderList();
      return;
    }
    const data = await api(`/api/guilds/${encodeURIComponent(gid)}/embeds`);
    embedList = data.embeds || [];
    renderList();
  }

  function renderList() {
    const ul = $("emb-list");
    if (!ul) return;
    ul.innerHTML = "";
    embedList.forEach((row) => {
      const li = document.createElement("li");
      li.className = "emb-li" + (row.id === selectedEmbedId ? " is-active" : "");
      const tag = row.message_id ? " (Discord)" : " (brouillon)";
      li.textContent = `${row.name || "Sans titre"}${tag}`;
      li.dataset.id = String(row.id);
      li.addEventListener("click", () => selectEmbed(row.id));
      ul.appendChild(li);
    });
  }

  async function selectEmbed(id) {
    const gid = D()?.getSelectedGuildId?.();
    if (!gid) return;
    selectedEmbedId = id;
    renderList();
    const row = await api(`/api/guilds/${encodeURIComponent(gid)}/embeds/${id}`);
    formPayload = row.payload;
    if ($("emb-name")) $("emb-name").value = row.name || "";
    applyPayloadToForm(formPayload);
    fillChannelSelect();
    if (row.channel_id) $("emb-channel").value = row.channel_id;
    $("emb-meta").textContent = row.message_id
      ? `Message Discord #${row.message_id} — tu peux modifier puis « Mettre à jour sur Discord ».`
      : "Brouillon — choisis un salon puis « Publier sur Discord ».";
    setStatus("");
    markClean();
  }

  function newEmbed() {
    selectedEmbedId = null;
    formPayload = defaultPayload();
    if ($("emb-name")) $("emb-name").value = "";
    applyPayloadToForm(formPayload);
    fillChannelSelect();
    $("emb-meta").textContent = "Nouveau brouillon — enregistre puis publie.";
    renderList();
    setStatus("");
    markDirty();
  }

  async function saveDraft() {
    const gid = D()?.getSelectedGuildId?.();
    if (!gid) return;
    const payload = readFormToPayload();
    const name = ($("emb-name")?.value || "").trim() || "Sans titre";
    try {
      if (selectedEmbedId == null) {
        const row = await api(`/api/guilds/${encodeURIComponent(gid)}/embeds`, {
          method: "POST",
          body: { name, payload },
        });
        selectedEmbedId = row.id;
        await loadList();
        await selectEmbed(row.id);
        setStatus("Brouillon enregistré ✓");
      } else {
        await api(`/api/guilds/${encodeURIComponent(gid)}/embeds/${selectedEmbedId}`, {
          method: "PUT",
          body: {
            name,
            payload,
            channel_id: $("emb-channel").value.trim() || null,
          },
        });
        await loadList();
        setStatus("Enregistré ✓");
        markClean();
      }
    } catch (e) {
      setStatus(String(e.message || e));
    }
  }

  async function sendDiscord() {
    const gid = D()?.getSelectedGuildId?.();
    if (!gid || selectedEmbedId == null) {
      setStatus("Enregistre d’abord le brouillon.");
      return;
    }
    const ch = $("emb-channel")?.value?.trim();
    try {
      await api(
        `/api/guilds/${encodeURIComponent(gid)}/embeds/${selectedEmbedId}/send`,
        {
          method: "POST",
          body: {
            channel_id: ch || undefined,
            payload: readFormToPayload(),
          },
        }
      );
      await loadList();
      await selectEmbed(selectedEmbedId);
      setStatus("Message Discord mis à jour ✓");
      markClean();
    } catch (e) {
      setStatus(String(e.message || e));
    }
  }

  async function deleteEmbed() {
    const gid = D()?.getSelectedGuildId?.();
    if (!gid || selectedEmbedId == null) return;
    const row = embedList.find((x) => x.id === selectedEmbedId);
    let q = "";
    if (row?.message_id && row?.channel_id) {
      const also = window.confirm(
        "Supprimer aussi le message sur Discord ?\n\nOK = oui, supprime le message.\nAnnuler = non, garde le message et retire seulement l’entrée du dashboard."
      );
      if (also) q = "?delete_discord_message=1";
    } else if (!window.confirm("Supprimer ce brouillon du dashboard ?")) {
      return;
    }
    try {
      await api(
        `/api/guilds/${encodeURIComponent(gid)}/embeds/${selectedEmbedId}${q}`,
        { method: "DELETE" }
      );
      selectedEmbedId = null;
      await loadList();
      if (embedList.length) await selectEmbed(embedList[0].id);
      else newEmbed();
      setStatus("Supprimé.");
    } catch (e) {
      setStatus(String(e.message || e));
    }
  }

  const SECTION_ICONS = {
    content: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    embed: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="15" x2="14" y2="15"/></svg>',
    author: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    media: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    footer: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="16" x2="21" y2="16"/></svg>',
    fields: '<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    mentions: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8"/></svg>',
    channel: '<svg viewBox="0 0 24 24"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
  };
  const CARET = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';

  function section({ id, icon, title, subtitle, open = false, body }) {
    return `
<details class="emb-section" ${open ? "open" : ""} data-section="${id}">
  <summary>
    <span class="emb-section-ico">${SECTION_ICONS[icon] || ""}</span>
    <span class="emb-section-title"><span>${title}</span>${subtitle ? `<small>${subtitle}</small>` : ""}</span>
    <span class="emb-section-caret">${CARET}</span>
  </summary>
  <div class="emb-section-body">${body}</div>
</details>`;
  }

  function ensureDom() {
    const root = $("embed-builder-root");
    if (!root || root.dataset.ready === "1") return;
    root.dataset.ready = "1";
    root.innerHTML = `
<div class="emb-layout">
  <aside class="emb-aside">
    <h4 class="emb-aside-title">Embeds enregistrés</h4>
    <ul id="emb-list" class="emb-list"></ul>
    <button type="button" class="btn secondary full" id="emb-btn-new">+ Nouvel embed</button>
  </aside>
  <div class="emb-main">

    <div class="emb-preview-top">
      <h4>Aperçu en direct</h4>
      <div id="emb-preview"></div>
    </div>

    <div class="emb-form-wrap">
      <div class="emb-meta-bar">
        <label class="field-row">
          <span>Nom (dashboard)</span>
          <input type="text" id="emb-name" class="input-sm input-wide" maxlength="120" placeholder="Annonce, règles, FAQ…" />
        </label>
        <label class="field-row">
          <span>Salon Discord cible</span>
          <select id="emb-channel" class="input-sm input-wide"></select>
        </label>
        <p class="emb-meta-note tiny" id="emb-meta"></p>
      </div>

      <div class="emb-tokens" id="emb-tokens">
        <span class="emb-tokens-label">Tokens</span>
        ${TOKENS.map((x) => `<button type="button" class="tok" data-token="${x.t.replace(/"/g, "&quot;")}" data-kind="${x.k}" title="${x.l}">${x.t}</button>`).join("")}
      </div>

      ${section({
        id: "content",
        icon: "content",
        title: "Texte au-dessus de l’embed",
        subtitle: "Message optionnel qui précède le cadre d’embed",
        open: true,
        body: `
          <label class="field-row">
            <span>Contenu (2000 car. max)</span>
            <textarea id="emb-content" class="input-sm input-wide" rows="3" maxlength="2000" placeholder="Salut @everyone, …"></textarea>
          </label>`,
      })}

      ${section({
        id: "embed",
        icon: "embed",
        title: "Embed principal",
        subtitle: "Titre, description, couleur et lien",
        open: true,
        body: `
          <div class="emb-grid2">
            <label class="field-row"><span>Titre</span><input type="text" id="emb-title" class="input-sm input-wide" maxlength="256" /></label>
            <label class="field-row"><span>Couleur</span>
              <div class="emb-color-picker" id="emb-color-picker">
                <button type="button" class="emb-color-btn" id="emb-color-btn" aria-label="Choisir une couleur">
                  <span class="emb-color-swatch"></span>
                  <span class="emb-color-hex mono">#5865F2</span>
                  <svg class="emb-color-chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <input type="hidden" id="emb-color" value="#5865f2" />
                <div class="emb-color-pop" id="emb-color-pop" hidden></div>
              </div>
            </label>
          </div>
          <label class="field-row"><span>Description (markdown Discord)</span><textarea id="emb-desc" class="input-sm input-wide" rows="5" maxlength="4096"></textarea></label>
          <label class="field-row"><span>Lien du titre (URL)</span><input type="url" id="emb-url" class="input-sm input-wide mono" placeholder="https://…" /></label>`,
      })}

      ${section({
        id: "author",
        icon: "author",
        title: "Auteur",
        subtitle: "Nom + icône en tête d’embed",
        body: `
          <div class="emb-grid3">
            <label class="field-row"><span>Nom</span><input type="text" id="emb-author-n" class="input-sm input-wide" maxlength="256" /></label>
            <label class="field-row"><span>Icône (URL)</span><input type="url" id="emb-author-i" class="input-sm input-wide mono" /></label>
            <label class="field-row"><span>Lien auteur</span><input type="url" id="emb-author-u" class="input-sm input-wide mono" /></label>
          </div>`,
      })}

      ${section({
        id: "media",
        icon: "media",
        title: "Médias",
        subtitle: "Miniature et grande image",
        body: `
          <div class="emb-grid2">
            <label class="field-row"><span>Miniature (URL)</span><input type="url" id="emb-thumb" class="input-sm input-wide mono" /></label>
            <label class="field-row"><span>Grande image (URL)</span><input type="url" id="emb-image" class="input-sm input-wide mono" /></label>
          </div>`,
      })}

      ${section({
        id: "footer",
        icon: "footer",
        title: "Pied de page",
        subtitle: "Texte discret + horodatage en bas de l’embed",
        body: `
          <div class="emb-grid2">
            <label class="field-row"><span>Texte</span><input type="text" id="emb-footer-t" class="input-sm input-wide" maxlength="2048" /></label>
            <label class="field-row"><span>Icône (URL)</span><input type="url" id="emb-footer-i" class="input-sm input-wide mono" /></label>
          </div>
          <label class="field-row">
            <span>Horodatage <small class="muted">(date/heure affichée à côté du footer)</small></span>
            <span class="emb-ts-row">
              <label class="emb-ts-toggle">
                <input type="checkbox" id="emb-ts" />
                <span>Afficher</span>
              </label>
              <input type="datetime-local" id="emb-ts-val" class="input-sm" />
              <button type="button" class="btn link emb-ts-now" id="emb-ts-now">Maintenant</button>
            </span>
          </label>`,
      })}

      ${section({
        id: "fields",
        icon: "fields",
        title: "Champs",
        subtitle: "Blocs nom / valeur, en ligne ou non",
        body: `
          <div id="emb-fields" class="emb-fields"></div>
          <button type="button" class="btn secondary emb-add-field-btn" id="emb-add-field">+ Ajouter un champ</button>`,
      })}

      ${section({
        id: "mentions",
        icon: "mentions",
        title: "Mentions autorisées",
        subtitle: "Qui peut être pingé par ce message",
        body: `
          <p class="muted tiny" style="margin:0 0 0.7rem">IDs utilisateurs / rôles (espace ou virgule). Le texte peut aussi contenir <code>&lt;@id&gt;</code> — ils seront ajoutés automatiquement.</p>
          <label class="field-row"><span>Utilisateurs (IDs)</span><input type="text" id="emb-m-users" class="input-sm input-wide mono" placeholder="123… 456…" /></label>
          <label class="field-row"><span>Rôles (IDs)</span><input type="text" id="emb-m-roles" class="input-sm input-wide mono" /></label>
          <label class="emb-check"><input type="checkbox" id="emb-m-everyone" /> Autoriser <code>@everyone</code> / <code>@here</code> (⚠ réservé aux annonces d’admin)</label>`,
      })}
    </div>

    <div class="emb-actions">
      <button type="button" class="btn secondary" id="emb-save">Enregistrer le brouillon</button>
      <button type="button" class="btn primary" id="emb-send">Publier / mettre à jour sur Discord</button>
      <span class="emb-actions-spacer"></span>
      <span class="emb-status" id="emb-status"></span>
      <button type="button" class="btn danger" id="emb-del">Supprimer</button>
    </div>
  </div>
</div>`;

    document.querySelectorAll("#embed-builder-root input, #embed-builder-root textarea, #embed-builder-root select").forEach((el) => {
      el.addEventListener("input", schedulePreview);
      el.addEventListener("change", schedulePreview);
    });

    const formWrap = document.querySelector(".emb-form-wrap");
    if (formWrap) {
      formWrap.addEventListener("focusin", (ev) => {
        const t = ev.target;
        if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type === "text")) && t.id !== "emb-name") {
          lastFocusedField = t;
        }
      });
    }

    const tokBar = $("emb-tokens");
    if (tokBar) {
      tokBar.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".tok");
        if (!btn) return;
        insertTokenAtCursor(btn.dataset.token || "");
      });
    }

    $("emb-add-field").addEventListener("click", addFieldRow);
    $("emb-btn-new").addEventListener("click", newEmbed);
    $("emb-save").addEventListener("click", saveDraft);
    $("emb-send").addEventListener("click", sendDiscord);
    $("emb-del").addEventListener("click", deleteEmbed);
    const tsNow = $("emb-ts-now");
    if (tsNow) {
      tsNow.addEventListener("click", () => {
        const tsCheck = $("emb-ts");
        const tsVal = $("emb-ts-val");
        if (!tsCheck || !tsVal) return;
        tsCheck.checked = true;
        const d = new Date();
        d.setSeconds(0, 0);
        const pad = (n) => String(n).padStart(2, "0");
        tsVal.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        schedulePreview();
      });
    }
    setupColorPicker();
    renderFieldRows([]);
    markClean();
    schedulePreview();
  }

  function insertTokenAtCursor(token) {
    if (!token) return;
    let target = lastFocusedField;
    if (!target || !document.contains(target)) {
      target = $("emb-content") || $("emb-desc");
    }
    if (!target) return;
    target.focus();
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const v = target.value;
    target.value = v.slice(0, start) + token + v.slice(end);
    const pos = start + token.length;
    try {
      target.setSelectionRange(pos, pos);
    } catch {}
    target.dispatchEvent(new Event("input", { bubbles: true }));
    lastFocusedField = target;
  }

  function currentSnapshot() {
    return JSON.stringify({
      name: $("emb-name")?.value || "",
      channel: $("emb-channel")?.value || "",
      payload: readFormToPayload(),
    });
  }

  function markClean() {
    savedSnapshot = currentSnapshot();
    updateDirty();
  }

  function markDirty() {
    savedSnapshot = null;
    updateDirty();
  }

  function updateDirty() {
    const bar = $("emb-actions");
    if (!bar) return;
    const dirty =
      savedSnapshot === null || currentSnapshot() !== savedSnapshot;
    bar.classList.toggle("is-dirty", dirty);
    const saveBtn = $("emb-save");
    if (saveBtn) {
      saveBtn.disabled = !dirty;
      saveBtn.textContent = dirty
        ? "Enregistrer le brouillon •"
        : "Brouillon enregistré";
    }
  }

  async function refresh() {
    ensureDom();
    const gid = D()?.getSelectedGuildId?.();
    if (!gid || !D().currentGuildHasBot()) {
      const root = $("embed-builder-root");
      if (root) {
        root.innerHTML =
          '<p class="muted">Choisis un serveur où le bot est présent.</p>';
        root.dataset.ready = "";
      }
      return;
    }
    ensureDom();
    fillChannelSelect();
    await loadList();
    if (selectedEmbedId != null && embedList.some((x) => x.id === selectedEmbedId)) {
      await selectEmbed(selectedEmbedId);
    } else if (embedList.length) {
      await selectEmbed(embedList[0].id);
    } else {
      newEmbed();
    }
  }

  window.wingbotEmbedWorkbench = { refresh };

  requestAnimationFrame(() => {
    if (location.hash.replace(/^#/, "") === "embeds") {
      window.wingbotEmbedWorkbench?.refresh();
    }
  });
})();
