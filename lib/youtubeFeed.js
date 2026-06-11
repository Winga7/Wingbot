/**
 * Détection des nouvelles vidéos YouTube via le flux RSS public (sans clé API).
 */

const RSS_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=";

function decodeXmlText(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseFirstFeedEntry(xml) {
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entryMatch) return null;
  const entry = entryMatch[1];
  const videoId =
    entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ||
    entry.match(/<videoId>([^<]+)<\/videoId>/)?.[1];
  if (!videoId) return null;
  const titles = [...entry.matchAll(/<title(?:[^>]*)>([^<]*)<\/title>/g)].map(
    (m) => decodeXmlText(m[1]).trim()
  );
  const title = titles.length > 1 ? titles[1] : titles[0] || "";
  const link =
    entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/)?.[1] ||
    entry.match(/<link[^>]+href="([^"]+)"[^>]+rel="alternate"/)?.[1] ||
    `https://www.youtube.com/watch?v=${videoId}`;
  const published = entry.match(/<published>([^<]+)<\/published>/)?.[1] || null;
  const channelName =
    decodeXmlText(entry.match(/<name>([^<]*)<\/name>/)?.[1] || "").trim();
  const thumbnail =
    entry.match(/<media:thumbnail[^>]+url="([^"]+)"/)?.[1] ||
    entry.match(/<media:content[^>]+url="([^"]+)"/)?.[1] ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return {
    id: videoId,
    title,
    url: link,
    published_at: published,
    channel_name: channelName,
    thumbnail,
  };
}

function normalizeYoutubeSourceInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^UC[\w-]{22}$/.test(s)) return { channel_id: s };
  if (s.startsWith("@")) return { handle: s.slice(1) };
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      if (id) return { video_hint: id };
    }
    if (host.includes("youtube.com")) {
      const channelId = u.pathname.match(/\/channel\/(UC[\w-]{22})/i)?.[1];
      if (channelId) return { channel_id: channelId };
      const handle = u.pathname.match(/^\/@([^/]+)/)?.[1];
      if (handle) return { handle };
      const custom = u.pathname.match(/^\/c\/([^/]+)/)?.[1];
      if (custom) return { handle: custom };
      const user = u.pathname.match(/^\/user\/([^/]+)/)?.[1];
      if (user) return { handle: user };
    }
  } catch {
    /* ignore */
  }
  return { handle: s.replace(/^@/, "") };
}

async function fetchText(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      "User-Agent":
        "Wingbot/1.0 (+https://github.com) Discord bot YouTube RSS",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} pour ${url}`);
    err.status = r.status;
    throw err;
  }
  return text;
}

async function resolveChannelIdFromHandle(handle) {
  const clean = String(handle || "")
    .trim()
    .replace(/^@/, "");
  if (!clean) return null;
  const html = await fetchText(
    `https://www.youtube.com/@${encodeURIComponent(clean)}`
  );
  const m =
    html.match(/"channelId":"(UC[\w-]{22})"/) ||
    html.match(/"externalId":"(UC[\w-]{22})"/) ||
    html.match(/channel_id=(UC[\w-]{22})/);
  return m?.[1] || null;
}

async function resolveYoutubeChannelId(sourceInput) {
  const norm = normalizeYoutubeSourceInput(sourceInput);
  if (!norm) return null;
  if (norm.channel_id) return norm.channel_id;
  if (norm.video_hint) {
    const err = new Error(
      "Indique l'URL ou l'ID de la chaîne YouTube, pas celle d'une vidéo"
    );
    err.status = 400;
    throw err;
  }
  if (norm.handle) return resolveChannelIdFromHandle(norm.handle);
  return null;
}

async function fetchLatestYoutubeVideo(channelId) {
  const xml = await fetchText(`${RSS_URL}${encodeURIComponent(channelId)}`);
  return parseFirstFeedEntry(xml);
}

async function resolveAndPreviewYoutubeChannel(sourceInput) {
  const channelId = await resolveYoutubeChannelId(sourceInput);
  if (!channelId) {
    const err = new Error("Chaîne YouTube introuvable — vérifie l'URL ou l'ID UC…");
    err.status = 400;
    throw err;
  }
  const latest = await fetchLatestYoutubeVideo(channelId);
  if (!latest) {
    const err = new Error("Aucune vidéo trouvée sur cette chaîne");
    err.status = 400;
    throw err;
  }
  return {
    channel_id: channelId,
    channel_name: latest.channel_name || "",
    channel_url: `https://www.youtube.com/channel/${channelId}`,
    latest_video: latest,
  };
}

module.exports = {
  normalizeYoutubeSourceInput,
  resolveYoutubeChannelId,
  fetchLatestYoutubeVideo,
  resolveAndPreviewYoutubeChannel,
};
