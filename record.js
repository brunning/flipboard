/* GIF export: renders the same flap animation onto an offscreen canvas,
 * frame by frame, then encodes the frames into a GIF using gif.js. */

(() => {
  // Canvas / tile dimensions used for the GIF. Decoupled from the live DOM
  // sign so the GIF always renders at a consistent size. Sign-wide
  // dimensions (SIGN_W / SIGN_H) are derived per-export from the current
  // ROWS/COLS in window.SplitFlap so live layout changes are picked up.
  const TILE_W = 48;
  const TILE_H = 68;
  const SPLIT_GAP = 2; // gap between top/bottom halves
  const HALF_H = (TILE_H - SPLIT_GAP) / 2;
  const TILE_GAP = 4;
  const ROW_GAP = 8;
  const PADDING = 18;
  const TILE_RADIUS = 5;

  function signSize() {
    const { ROWS, COLS } = window.SplitFlap;
    return {
      w: COLS * TILE_W + (COLS - 1) * TILE_GAP + PADDING * 2,
      h: ROWS * TILE_H + (ROWS - 1) * ROW_GAP + PADDING * 2,
    };
  }

  const FONT_FAMILY =
    '"Helvetica Neue", "Arial Black", Arial, sans-serif';
  const CHAR_COLOR = "#f6e7bc";
  const PANEL_BG = "#0e0f13";
  const TILE_TOP_GRAD = ["#2a2d35", "#1f2128"];
  const TILE_BOTTOM_GRAD = ["#1c1e25", "#1a1c22"];
  const SPLIT_LINE = "#050608";

  // GIF playback. 25fps gives smooth motion without bloating the file.
  const FPS = 25;
  const FRAME_INTERVAL_MS = Math.round(1000 / FPS);
  const HOLD_END_MS = 1500; // hold the final frame so the message reads cleanly

  /* ─── pre-rendered character cache ───────────────────────────────────── */

  const charCache = new Map();

  function ensureCharCache() {
    if (charCache.size > 0) return;
    const { SEQUENCE } = window.SplitFlap;
    for (const c of SEQUENCE) {
      const canvas = document.createElement("canvas");
      canvas.width = TILE_W;
      canvas.height = TILE_H;
      const ctx = canvas.getContext("2d");
      if (c !== " ") {
        ctx.font = `800 ${Math.round(TILE_H * 0.78)}px ${FONT_FAMILY}`;
        ctx.fillStyle = CHAR_COLOR;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowOffsetY = 2;
        ctx.shadowBlur = 3;
        // Slight optical lift to balance descenders.
        ctx.fillText(c, TILE_W / 2, TILE_H / 2 + 2);
      }
      charCache.set(c, canvas);
    }
  }

  /* ─── primitives ─────────────────────────────────────────────────────── */

  function roundRectPath(ctx, x, y, w, h, radii) {
    const [tl, tr, br, bl] = Array.isArray(radii)
      ? radii
      : [radii, radii, radii, radii];
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    ctx.lineTo(x + bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
    ctx.lineTo(x, y + tl);
    ctx.quadraticCurveTo(x, y, x + tl, y);
    ctx.closePath();
  }

  function fillTopBg(ctx, x, y, w, h) {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, TILE_TOP_GRAD[0]);
    grad.addColorStop(1, TILE_TOP_GRAD[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  function fillBottomBg(ctx, x, y, w, h) {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, TILE_BOTTOM_GRAD[0]);
    grad.addColorStop(1, TILE_BOTTOM_GRAD[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  /* ─── tile renderer ──────────────────────────────────────────────────── */

  function drawTileBackground(ctx, x, y) {
    // Top half (rounded top corners).
    ctx.save();
    roundRectPath(ctx, x, y, TILE_W, HALF_H, [TILE_RADIUS, TILE_RADIUS, 0, 0]);
    ctx.clip();
    fillTopBg(ctx, x, y, TILE_W, HALF_H);
    ctx.restore();

    // Bottom half (rounded bottom corners).
    ctx.save();
    const bottomY = y + HALF_H + SPLIT_GAP;
    roundRectPath(
      ctx,
      x,
      bottomY,
      TILE_W,
      HALF_H,
      [0, 0, TILE_RADIUS, TILE_RADIUS],
    );
    ctx.clip();
    fillBottomBg(ctx, x, bottomY, TILE_W, HALF_H);
    ctx.restore();

    // Split-line shadow.
    ctx.fillStyle = SPLIT_LINE;
    ctx.fillRect(x, y + HALF_H, TILE_W, SPLIT_GAP);
  }

  function drawCharTopHalf(ctx, x, y, char) {
    if (char === " ") return;
    const src = charCache.get(char);
    if (!src) return;
    ctx.drawImage(src, 0, 0, TILE_W, HALF_H, x, y, TILE_W, HALF_H);
  }

  function drawCharBottomHalf(ctx, x, y, char) {
    if (char === " ") return;
    const src = charCache.get(char);
    if (!src) return;
    const srcY = TILE_H - HALF_H;
    ctx.drawImage(
      src,
      0,
      srcY,
      TILE_W,
      HALF_H,
      x,
      y + HALF_H + SPLIT_GAP,
      TILE_W,
      HALF_H,
    );
  }

  /** Draw one of the moving flaps that overlay a tile mid-flip.
   *  scaleY (0..1) is the foreshortening factor due to the perspective
   *  rotation around the horizontal middle of the tile. */
  function drawFlap(ctx, x, y, char, half, scaleY) {
    if (scaleY < 0.005) return;
    const drawH = HALF_H * scaleY;

    if (half === "top") {
      const destY = y + HALF_H - drawH;
      // Background gradient (top half), squashed.
      ctx.save();
      roundRectPath(
        ctx,
        x,
        destY,
        TILE_W,
        drawH,
        scaleY > 0.95
          ? [TILE_RADIUS, TILE_RADIUS, 0, 0]
          : [0, 0, 0, 0],
      );
      ctx.clip();
      fillTopBg(ctx, x, destY, TILE_W, drawH);
      if (char !== " ") {
        const src = charCache.get(char);
        if (src) ctx.drawImage(src, 0, 0, TILE_W, HALF_H, x, destY, TILE_W, drawH);
      }
      ctx.restore();
      // Hairline at the bottom edge gives a subtle "card" feel.
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(x, destY + drawH - 1, TILE_W, 1);
    } else {
      const destY = y + HALF_H + SPLIT_GAP;
      ctx.save();
      roundRectPath(
        ctx,
        x,
        destY,
        TILE_W,
        drawH,
        scaleY > 0.95
          ? [0, 0, TILE_RADIUS, TILE_RADIUS]
          : [0, 0, 0, 0],
      );
      ctx.clip();
      fillBottomBg(ctx, x, destY, TILE_W, drawH);
      if (char !== " ") {
        const src = charCache.get(char);
        if (src) {
          const srcY = TILE_H - HALF_H;
          ctx.drawImage(src, 0, srcY, TILE_W, HALF_H, x, destY, TILE_W, drawH);
        }
      }
      ctx.restore();
    }
  }

  /* ─── animation state ────────────────────────────────────────────────── */

  // Match CSS easings for the flap rotation.
  const easeIn = (t) => t * t;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);

  function tileStateAt(tile, t) {
    const stepFloat = t / FLIP_DURATION_MS;
    const stepIdx = Math.floor(stepFloat);

    if (stepIdx >= tile.totalFlips) {
      return {
        kind: "static",
        char: SEQUENCE[(tile.startIdx + tile.totalFlips) % SEQUENCE.length],
      };
    }

    const oldChar =
      SEQUENCE[(tile.startIdx + stepIdx) % SEQUENCE.length];
    const newChar =
      SEQUENCE[(tile.startIdx + stepIdx + 1) % SEQUENCE.length];
    const progress = Math.min(1, Math.max(0, stepFloat - stepIdx));
    return { kind: "flipping", oldChar, newChar, progress };
  }

  function drawTile(ctx, tile, t) {
    drawTileBackground(ctx, tile.x, tile.y);
    const state = tileStateAt(tile, t);

    if (state.kind === "static") {
      drawCharTopHalf(ctx, tile.x, tile.y, state.char);
      drawCharBottomHalf(ctx, tile.x, tile.y, state.char);
      return;
    }

    // The static top is already showing the NEW character (covered by the
    // falling top flap). The static bottom holds the OLD character until
    // the bottom flap covers it, then swaps to NEW.
    drawCharTopHalf(ctx, tile.x, tile.y, state.newChar);
    const bottomChar = state.progress >= 0.55 ? state.newChar : state.oldChar;
    drawCharBottomHalf(ctx, tile.x, tile.y, bottomChar);

    // Top flap: shows OLD top, scale collapses to 0 as the flap rotates away.
    const topScale = Math.cos((easeIn(state.progress) * Math.PI) / 2);
    drawFlap(ctx, tile.x, tile.y, state.oldChar, "top", topScale);

    // Bottom flap: shows NEW bottom, scale grows from 0 to 1.
    const bottomScale = Math.cos(((1 - easeOut(state.progress)) * Math.PI) / 2);
    drawFlap(ctx, tile.x, tile.y, state.newChar, "bottom", bottomScale);
  }

  function drawSign(ctx, t, tiles, w, h) {
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, w, h);
    for (const tile of tiles) {
      drawTile(ctx, tile, t);
    }
  }

  /* ─── tile layout ────────────────────────────────────────────────────── */

  function buildTiles(text) {
    const { ROWS, COLS, wrapText, buildGrid, indexOf } = window.SplitFlap;
    const grid = buildGrid(wrapText(text));
    const tiles = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const targetIdx = indexOf(grid[r][c]);
        tiles.push({
          x: PADDING + c * (TILE_W + TILE_GAP),
          y: PADDING + r * (TILE_H + ROW_GAP),
          startIdx: 0,
          totalFlips: targetIdx, // forward steps from blank to target
        });
      }
    }
    return tiles;
  }

  /* ─── encode ─────────────────────────────────────────────────────────── */

  function recordGif(text, { onProgress, onStatus } = {}) {
    return new Promise((resolve, reject) => {
      ensureCharCache();

      const { FLIP_DURATION_MS } = window.SplitFlap;
      const { w: SIGN_W, h: SIGN_H } = signSize();

      const tiles = buildTiles(text);
      const maxFlips = tiles.reduce((m, t) => Math.max(m, t.totalFlips), 0);
      const animDurationMs = maxFlips * FLIP_DURATION_MS;
      const totalDurationMs = animDurationMs + HOLD_END_MS;
      const frameCount = Math.max(2, Math.ceil(totalDurationMs / FRAME_INTERVAL_MS));

      const canvas = document.createElement("canvas");
      canvas.width = SIGN_W;
      canvas.height = SIGN_H;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const gif = new GIF({
        workers: 2,
        quality: 8,
        width: SIGN_W,
        height: SIGN_H,
        workerScript: "vendor/gif.worker.js",
        background: PANEL_BG,
      });

      onStatus?.("rendering frames…");
      // Render frames synchronously in chunks so we don't block too long.
      let i = 0;
      const renderChunk = () => {
        const chunkEnd = Math.min(frameCount, i + 6);
        for (; i < chunkEnd; i++) {
          const t = Math.min(i * FRAME_INTERVAL_MS, animDurationMs);
          drawSign(ctx, t, tiles, SIGN_W, SIGN_H);
          const isLast = i === frameCount - 1;
          gif.addFrame(ctx, {
            delay: isLast ? HOLD_END_MS : FRAME_INTERVAL_MS,
            copy: true,
          });
          onProgress?.((i + 1) / frameCount, "frames");
        }
        if (i < frameCount) {
          requestAnimationFrame(renderChunk);
        } else {
          onStatus?.("encoding gif…");
          gif.on("progress", (p) => onProgress?.(p, "encode"));
          gif.on("finished", (blob) => resolve(blob));
          gif.on("abort", () => reject(new Error("gif render aborted")));
          gif.render();
        }
      };
      renderChunk();
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function safeFilename(text) {
    const base = (text || "splitflap")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return `${base || "splitflap"}-${Date.now()}.gif`;
  }

  /* ─── UI wiring ──────────────────────────────────────────────────────── */

  function wireUi() {
    const exportBtn = document.getElementById("export-button");
    const inputEl = document.getElementById("message-input");
    const statusEl = document.getElementById("export-status");
    const submitBtn = document.querySelector("#message-form button[type='submit']");

    if (!exportBtn || !statusEl) return;

    let busy = false;

    const setStatus = (html, cls = "") => {
      statusEl.className = `export-status${cls ? " " + cls : ""}`;
      statusEl.innerHTML = html;
    };

    const renderProgress = (label, fraction) => {
      const pct = Math.round(fraction * 100);
      setStatus(
        `<span>${label}</span><span class="progress-bar"><span class="progress-fill" style="width:${pct}%"></span></span><span>${pct}%</span>`,
        "active",
      );
    };

    exportBtn.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      exportBtn.disabled = true;
      submitBtn.disabled = true;
      const text = inputEl.value;

      try {
        renderProgress("Rendering frames", 0);
        const blob = await recordGif(text, {
          onProgress: (p, phase) =>
            renderProgress(
              phase === "encode" ? "Encoding GIF" : "Rendering frames",
              p,
            ),
        });
        const filename = safeFilename(text);
        downloadBlob(blob, filename);
        const sizeKb = Math.round(blob.size / 1024);
        setStatus(
          `Saved <strong>${filename}</strong> (${sizeKb} KB).`,
          "active",
        );
      } catch (err) {
        console.error(err);
        setStatus(`Export failed: ${err.message}`, "error");
      } finally {
        busy = false;
        exportBtn.disabled = false;
        submitBtn.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUi, { once: true });
  } else {
    wireUi();
  }
})();
