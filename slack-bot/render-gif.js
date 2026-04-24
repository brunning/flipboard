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
 * @param {string} text                   The message to render.
 * @param {string} baseUrl                Where the static web app is being
 *                                        served, e.g. "http://localhost:3000/".
 * @param {object} [opts]
 * @param {number} [opts.rows]            Sign rows to seed in the page.
 * @param {number} [opts.cols]            Sign columns to seed in the page.
 * @returns {Promise<Buffer>} The encoded GIF bytes.
 */
export async function renderGif(text, baseUrl, { rows, cols } = {}) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  let downloadPath = null;

  try {
    page.on("pageerror", (e) => console.error("[browser]", e.message));

    // The web app reads its layout from localStorage on init, so seed it
    // before any page script runs. This keeps the bot's config.json the
    // single source of truth for GIFs the bot produces.
    if (Number.isInteger(rows) && Number.isInteger(cols)) {
      await page.addInitScript(
        ({ rows, cols }) => {
          try {
            localStorage.setItem("splitflap.rows", String(rows));
            localStorage.setItem("splitflap.cols", String(cols));
          } catch {
            /* ignore */
          }
        },
        { rows, cols },
      );
    }

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    // Wait until the page's JS exposes the shared helpers AND has picked
    // up the seeded dimensions — that's our signal that the renderer is
    // ready to drive.
    await page.waitForFunction(
      ({ expectRows, expectCols }) => {
        const sf = window.SplitFlap;
        if (!sf) return false;
        if (expectRows == null) return true;
        return sf.ROWS === expectRows && sf.COLS === expectCols;
      },
      { expectRows: rows ?? null, expectCols: cols ?? null },
      { timeout: 10_000 },
    );

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
