import { chromium } from "playwright";
import { readFile, unlink } from "node:fs/promises";

// One persistent browser is reused across slash commands.
// Each render uses a fresh isolated context so concurrent requests don't
// interfere with each other.
let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch().catch((err) => {
      browserPromise = null; // allow next call to retry from scratch
      throw err;
    });
  }
  return browserPromise;
}

export async function shutdownBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {
    /* ignore */
  } finally {
    browserPromise = null;
  }
}

/**
 * Render a message as an animated GIF by driving the existing web app
 * with a headless Chromium tab.
 *
 * @param {string} text     The message to render.
 * @param {string} baseUrl  Where the static web app is being served, e.g.
 *                          "http://localhost:3000/".
 * @returns {Promise<Buffer>} The encoded GIF bytes.
 */
export async function renderGif(text, baseUrl) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  let downloadPath = null;

  try {
    page.on("pageerror", (e) => console.error("[browser]", e.message));

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    // Wait until the page's JS exposes the shared helpers — that's our
    // signal that the renderer is ready to drive.
    await page.waitForFunction(() => !!window.SplitFlap, null, {
      timeout: 10_000,
    });

    await page.fill("#message-input", text);

    // Click Export GIF and capture the resulting download. Encoding can
    // take 10-20s for the longest messages, so bump the timeout.
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.click("#export-button");
    const download = await downloadPromise;

    downloadPath = await download.path();
    return await readFile(downloadPath);
  } finally {
    if (downloadPath) {
      unlink(downloadPath).catch(() => {});
    }
    await ctx.close();
  }
}
