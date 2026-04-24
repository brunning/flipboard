import "dotenv/config";
import bolt from "@slack/bolt";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderGif, shutdownBrowser } from "./render-gif.js";

const { App } = bolt;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Serve the existing web app sitting one level up.
const STATIC_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);

// Read sign dimensions from the shared config.json at the repo root.
// The web app reads the same file, so the bot's input validation always
// matches what the rendered GIF can actually display.
function loadSignConfig() {
  const defaults = { rows: 2, cols: 16 };
  try {
    const raw = readFileSync(path.join(STATIC_DIR, "config.json"), "utf8");
    const cfg = JSON.parse(raw);
    return {
      rows: Number.isInteger(cfg.rows) && cfg.rows > 0 ? cfg.rows : defaults.rows,
      cols: Number.isInteger(cfg.cols) && cfg.cols > 0 ? cfg.cols : defaults.cols,
    };
  } catch (err) {
    console.warn(
      `[flipboard] using default ${defaults.rows}x${defaults.cols} — could not load config.json: ${err.message}`,
    );
    return defaults;
  }
}

const { rows: ROWS, cols: COLS } = loadSignConfig();
const MAX_INPUT = ROWS * COLS + (ROWS - 1);
const ALLOWED_RE = /^[A-Z0-9 .,!?\-:/&']*$/;
console.log(`[flipboard] sign size: ${ROWS} rows × ${COLS} cols (max ${MAX_INPUT} chars)`);

function validate(raw) {
  const text = (raw || "").trim();
  if (!text) return { ok: false, reason: "Usage: `/flipboard your message`" };
  const upper = text.toUpperCase();
  if (upper.length > MAX_INPUT) {
    return {
      ok: false,
      reason: `Message is ${upper.length} characters; the sign holds at most ${MAX_INPUT}.`,
    };
  }
  if (!ALLOWED_RE.test(upper)) {
    return {
      ok: false,
      reason:
        "Only letters, digits, spaces, and `.,!?-:/&'` are supported on the sign.",
    };
  }
  return { ok: true, text: upper };
}

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`Missing required env var: ${name}`);
    console.error("Copy .env.example to .env and fill in your Slack tokens.");
    process.exit(1);
  }
}
requireEnv("SLACK_BOT_TOKEN");
requireEnv("SLACK_APP_TOKEN");

// Static server — only listens on localhost so the headless browser can
// load the web app. Not exposed to the internet.
const expressApp = express();
expressApp.use(express.static(STATIC_DIR));
const httpServer = expressApp.listen(PORT, "127.0.0.1", () => {
  console.log(`Static server running at http://127.0.0.1:${PORT}`);
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.command("/flipboard", async ({ command, ack, client, respond }) => {
  await ack();

  const v = validate(command.text);
  if (!v.ok) {
    await respond({ response_type: "ephemeral", text: v.reason });
    return;
  }

  await respond({
    response_type: "ephemeral",
    text: `Rendering "${v.text}" — one moment…`,
  });

  try {
    const buffer = await renderGif(v.text, `http://127.0.0.1:${PORT}/`);
    await client.files.uploadV2({
      channel_id: command.channel_id,
      file: buffer,
      filename: `flipboard-${Date.now()}.gif`,
      title: v.text,
    });
  } catch (err) {
    console.error("render/upload failed", err);
    await respond({
      response_type: "ephemeral",
      text: `Sorry, something went wrong rendering that: ${err.message}`,
    });
  }
});

(async () => {
  await app.start();
  console.log("⚡ Flipboard bot connected to Slack (Socket Mode).");
})().catch((err) => {
  console.error("Failed to start Bolt app:", err);
  process.exit(1);
});

async function shutdown() {
  console.log("\nShutting down…");
  try {
    await app.stop();
  } catch {}
  await shutdownBrowser();
  httpServer.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
