const fs = require("node:fs");
const path = require("node:path");
const { applyCardVariables } = require("./memberCardConfig");

const WIDTH = 900;
const MAX_MESSAGE_LINES = 4;

let fontsReady = false;
let canvasApi = null;

function loadCanvas() {
  if (canvasApi) return canvasApi;
  try {
    canvasApi = require("@napi-rs/canvas");
  } catch (error) {
    const err = new Error("Le module image @napi-rs/canvas n'est pas installé.");
    err.cause = error;
    throw err;
  }
  return canvasApi;
}

function ensureFonts() {
  if (fontsReady) return;
  fontsReady = true;
  const { GlobalFonts } = loadCanvas();
  const root = path.join(__dirname, "..", "assets", "fonts");
  const jobs = [
    [
      "WingbotDisplay",
      [
        path.join(root, "Anton-Regular.ttf"),
        "C:\\Windows\\Fonts\\impact.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
      ],
    ],
    [
      "WingbotText",
      [
        path.join(root, "Roboto-Bold.ttf"),
        "C:\\Windows\\Fonts\\segoeuib.ttf",
        "C:\\Windows\\Fonts\\arialbd.ttf",
      ],
    ],
  ];
  for (const [family, files] of jobs) {
    let registered = false;
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      try {
        GlobalFonts.registerFromPath(file, family);
        registered = true;
        break;
      } catch (error) {
        console.error("[member-cards] police", file, error?.message || error);
      }
    }
    if (!registered) {
      console.error(`[member-cards] police introuvable : ${family}`);
    }
  }
}

function cleanDraw(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, max);
}

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = cleanDraw(text, 500).split("\n");
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (lines.length < MAX_MESSAGE_LINES) lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      if (lines.length >= MAX_MESSAGE_LINES) break;
    }
    if (lines.length < MAX_MESSAGE_LINES && line) lines.push(line);
    if (lines.length >= MAX_MESSAGE_LINES) break;
  }
  return lines.slice(0, MAX_MESSAGE_LINES);
}

function drawCentered(ctx, text, y, color, font) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.72)";
  ctx.strokeText(text, WIDTH / 2, y);
  ctx.fillStyle = color;
  ctx.fillText(text, WIDTH / 2, y);
}

function fitSize(ctx, text, family, start, min, maxWidth) {
  let size = start;
  const sample = text || " ";
  while (size > min) {
    ctx.font = `${size}px ${family}`;
    if (ctx.measureText(sample).width <= maxWidth) return size;
    size -= 2;
  }
  return min;
}

function drawAvatar(ctx, image, cx, cy, radius, ringColor, letter) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) {
    const size = radius * 2;
    const scale = Math.max(size / image.width, size / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(radius * 0.72)}px WingbotText, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter || "?", cx, cy + 2);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 8;
  ctx.stroke();
}

async function fetchImageBuffer(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Wingbot (https://discord.com)" },
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 32 || buffer.length > 8_000_000) return null;
    return buffer;
  } catch {
    return null;
  }
}

/**
 * PNG transparent (ou fond coloré) : avatar rond, titre, pseudo, message.
 * @returns {Promise<Buffer>}
 */
async function renderMemberCardPng({ card, vars, avatarBuffer }) {
  const { createCanvas, loadImage } = loadCanvas();
  ensureFonts();

  const title = cleanDraw(applyCardVariables(card.title, vars), 48).trim();
  let nameLine = cleanDraw(applyCardVariables(card.name_text, vars), 80).trim();
  if (card.name_uppercase) nameLine = nameLine.toLocaleUpperCase("fr-FR");
  const message = cleanDraw(applyCardVariables(card.message, vars), 500);

  const measure = createCanvas(WIDTH, 32);
  const mctx = measure.getContext("2d");
  const titleSize = title
    ? fitSize(mctx, title, "WingbotDisplay", 78, 36, WIDTH - 80)
    : 0;
  const nameSize = nameLine
    ? fitSize(mctx, nameLine, "WingbotDisplay", 40, 22, WIDTH - 80)
    : 0;
  mctx.font = "28px WingbotText";
  const messageLines = message
    ? wrapLines(mctx, message, WIDTH - 100)
    : [];

  const avatarR = card.show_avatar ? 96 : 0;
  let height = 28;
  if (avatarR) height += avatarR * 2 + 28;
  if (title) height += titleSize + 14;
  if (nameLine) height += nameSize + 16;
  if (messageLines.length) height += messageLines.length * 36 + 8;
  height = Math.max(height, avatarR ? 280 : 120);

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");
  if (card.background) {
    ctx.fillStyle = card.background;
    ctx.fillRect(0, 0, WIDTH, height);
  }

  let y = 18;
  if (avatarR) {
    const cx = WIDTH / 2;
    const cy = y + avatarR + 6;
    let image = null;
    if (avatarBuffer) {
      try {
        image = await loadImage(avatarBuffer);
      } catch {
        image = null;
      }
    }
    const letter = (nameLine || vars?.username || "?").trim().charAt(0);
    drawAvatar(ctx, image, cx, cy, avatarR, card.ring_color, letter);
    y = cy + avatarR + 22;
  }

  if (title) {
    drawCentered(
      ctx,
      title,
      y,
      card.title_color,
      `${titleSize}px WingbotDisplay`
    );
    y += titleSize + 10;
  }
  if (nameLine) {
    drawCentered(
      ctx,
      nameLine,
      y,
      card.name_color,
      `${nameSize}px WingbotDisplay`
    );
    y += nameSize + 14;
  }
  if (messageLines.length) {
    messageLines.forEach((line, index) => {
      drawCentered(
        ctx,
        line,
        y + index * 36,
        card.text_color,
        "28px WingbotText"
      );
    });
  }

  return canvas.toBuffer("image/png");
}

module.exports = {
  renderMemberCardPng,
  fetchImageBuffer,
};
