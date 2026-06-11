/**
 * API Twitch Helix (Client Credentials) — live et clips.
 * .env : TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET (app dédiée Wingbot recommandée).
 */

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_HELIX = "https://api.twitch.tv/helix";

let tokenCache = { token: null, expiresAt: 0 };

function getTwitchCredentials() {
  const clientId = (process.env.TWITCH_CLIENT_ID || "").trim();
  const clientSecret = (process.env.TWITCH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    const err = new Error(
      "TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET requis dans .env (app Twitch Dev dédiée)"
    );
    err.code = "NO_TWITCH_CREDS";
    throw err;
  }
  return { clientId, clientSecret };
}

async function getAppAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const { clientId, clientSecret } = getTwitchCredentials();
  const r = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`Twitch token ${r.status}: ${text.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  const data = JSON.parse(text);
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

async function twitchHelix(pathStr, searchParams = null) {
  const { clientId } = getTwitchCredentials();
  const token = await getAppAccessToken();
  let url = `${TWITCH_HELIX}${pathStr}`;
  if (searchParams) {
    const q = new URLSearchParams(searchParams);
    url += `?${q.toString()}`;
  }
  const r = await fetch(url, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`Twitch Helix ${r.status}: ${text.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

function normalizeTwitchLoginInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return { user_id: s };
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "twitch.tv" || host === "m.twitch.tv") {
      const login = u.pathname.replace(/^\//, "").split("/")[0];
      if (login && !["videos", "directory", "settings"].includes(login.toLowerCase())) {
        return { login: login.toLowerCase() };
      }
    }
  } catch {
    /* ignore */
  }
  return { login: s.replace(/^@/, "").toLowerCase() };
}

async function resolveTwitchUser(sourceInput) {
  const norm = normalizeTwitchLoginInput(sourceInput);
  if (!norm) {
    const err = new Error("Chaîne Twitch invalide");
    err.status = 400;
    throw err;
  }
  let data;
  if (norm.user_id) {
    data = await twitchHelix("/users", { id: norm.user_id });
  } else {
    data = await twitchHelix("/users", { login: norm.login });
  }
  const user = data?.data?.[0];
  if (!user) {
    const err = new Error("Chaîne Twitch introuvable");
    err.status = 404;
    throw err;
  }
  return {
    id: user.id,
    login: user.login,
    display_name: user.display_name,
    profile_image_url: user.profile_image_url || "",
    url: `https://www.twitch.tv/${user.login}`,
  };
}

function formatStreamPayload(stream, user) {
  const thumb = String(stream.thumbnail_url || "")
    .replace("{width}", "1280")
    .replace("{height}", "720");
  return {
    id: stream.id,
    title: stream.title || "",
    url: user.url,
    game: stream.game_name || "",
    viewers: stream.viewer_count ?? 0,
    thumbnail: thumb,
    login: user.login,
    display_name: user.display_name,
    started_at: stream.started_at || "",
  };
}

async function getTwitchStream(broadcasterId) {
  const data = await twitchHelix("/streams", { user_id: broadcasterId });
  const stream = data?.data?.[0];
  return stream || null;
}

async function fetchTwitchClipsSince(broadcasterId, startedAtIso) {
  const startedAt = startedAtIso || new Date(Date.now() - 7 * 86400000).toISOString();
  const data = await twitchHelix("/clips", {
    broadcaster_id: broadcasterId,
    started_at: startedAt,
    first: "50",
  });
  const clips = data?.data || [];
  return clips.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

async function getLatestTwitchClip(broadcasterId) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const clips = await fetchTwitchClipsSince(broadcasterId, since);
  if (!clips.length) return null;
  const c = clips[clips.length - 1];
  return formatClipPayload(c, null);
}

function formatClipPayload(clip, user) {
  return {
    id: clip.id,
    title: clip.title || "",
    url: clip.url || "",
    thumbnail: clip.thumbnail_url || "",
    creator: clip.creator_name || "",
    view_count: clip.view_count ?? 0,
    created_at: clip.created_at || "",
    duration: clip.duration ?? 0,
    login: user?.login || clip.broadcaster_name || "",
    display_name: user?.display_name || clip.broadcaster_name || "",
  };
}

async function resolveAndPreviewTwitchChannel(sourceInput, kind) {
  const user = await resolveTwitchUser(sourceInput);
  const preview = {
    broadcaster_id: user.id,
    login: user.login,
    display_name: user.display_name,
    channel_url: user.url,
    profile_image_url: user.profile_image_url,
  };
  if (kind === "live") {
    const stream = await getTwitchStream(user.id);
    preview.is_live = !!stream;
    preview.live = stream ? formatStreamPayload(stream, user) : null;
  } else if (kind === "clip") {
    const latest = await getLatestTwitchClip(user.id);
    preview.latest_clip = latest;
  }
  return preview;
}

module.exports = {
  normalizeTwitchLoginInput,
  resolveTwitchUser,
  getTwitchStream,
  fetchTwitchClipsSince,
  getLatestTwitchClip,
  formatStreamPayload,
  formatClipPayload,
  resolveAndPreviewTwitchChannel,
};
