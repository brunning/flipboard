/* Animated split-flap sign.
 * Each tile cycles through SEQUENCE one character at a time until it
 * reaches its target letter. */

const SEQUENCE = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-:/&'";
// Sign dimensions can be changed live via the Layout controls on the page.
// We persist the user's choice in localStorage so it survives reloads.
const DEFAULT_ROWS = 2;
const DEFAULT_COLS = 16;
const MIN_ROWS = 1, MAX_ROWS = 12;
const MIN_COLS = 1, MAX_COLS = 40;
let ROWS = DEFAULT_ROWS;
let COLS = DEFAULT_COLS;
// Max characters a user can usefully type: ROWS full lines joined by a
// single space character between each pair of lines.
let MAX_INPUT = ROWS * COLS + (ROWS - 1);
const FLIP_DURATION_MS = 70;
const FLIP_BUFFER_MS = 8;

const LS_ROWS = "splitflap.rows";
const LS_COLS = "splitflap.cols";

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function loadStoredDimensions() {
  try {
    const r = parseInt(localStorage.getItem(LS_ROWS), 10);
    const c = parseInt(localStorage.getItem(LS_COLS), 10);
    if (Number.isInteger(r)) ROWS = clamp(r, MIN_ROWS, MAX_ROWS);
    if (Number.isInteger(c)) COLS = clamp(c, MIN_COLS, MAX_COLS);
  } catch {
    /* localStorage may be unavailable in some sandboxes; fall back to defaults */
  }
  MAX_INPUT = ROWS * COLS + (ROWS - 1);
}

function persistDimensions() {
  try {
    localStorage.setItem(LS_ROWS, String(ROWS));
    localStorage.setItem(LS_COLS, String(COLS));
  } catch {
    /* ignore */
  }
}

function indexOf(char) {
  const idx = SEQUENCE.indexOf(char);
  return idx >= 0 ? idx : 0;
}

function makeChar(text) {
  const span = document.createElement("span");
  span.className = "char";
  span.textContent = text;
  return span;
}

class Tile {
  constructor(el) {
    this.el = el;
    this.currentIdx = 0;
    this.targetIdx = 0;
    this.generation = 0;
    this.animating = false;

    const topHalf = document.createElement("div");
    topHalf.className = "half top";
    this.topChar = makeChar(SEQUENCE[0]);
    topHalf.appendChild(this.topChar);

    const bottomHalf = document.createElement("div");
    bottomHalf.className = "half bottom";
    this.bottomChar = makeChar(SEQUENCE[0]);
    bottomHalf.appendChild(this.bottomChar);

    el.appendChild(topHalf);
    el.appendChild(bottomHalf);
  }

  reset() {
    this.generation++;
    this.currentIdx = 0;
    this.targetIdx = 0;
    this.topChar.textContent = SEQUENCE[0];
    this.bottomChar.textContent = SEQUENCE[0];
    this.el.querySelectorAll(".flap").forEach((f) => f.remove());
  }

  setTarget(char) {
    this.targetIdx = indexOf(char);
  }

  flipOnce(myGen) {
    return new Promise((resolve) => {
      if (this.generation !== myGen) {
        resolve();
        return;
      }

      const oldChar = SEQUENCE[this.currentIdx];
      const newIdx = (this.currentIdx + 1) % SEQUENCE.length;
      const newChar = SEQUENCE[newIdx];

      // Top flap shows the OLD upper half and falls out of view, revealing
      // the NEW upper half on the static surface beneath.
      const topFlap = document.createElement("div");
      topFlap.className = "flap top-flap";
      topFlap.appendChild(makeChar(oldChar));

      // Bottom flap shows the NEW lower half rising into place, covering
      // the static lower half (which we update to NEW at the midpoint).
      const bottomFlap = document.createElement("div");
      bottomFlap.className = "flap bottom-flap";
      bottomFlap.appendChild(makeChar(newChar));

      // Reveal NEW top now (covered by topFlap until it falls).
      this.topChar.textContent = newChar;

      this.el.appendChild(topFlap);
      this.el.appendChild(bottomFlap);
      this.currentIdx = newIdx;

      // Trigger animations on next frame so the start state is committed.
      requestAnimationFrame(() => {
        if (this.generation !== myGen) return;
        topFlap.classList.add("flip");
        bottomFlap.classList.add("flip");
      });

      // Swap the static bottom half to NEW around the midpoint, while the
      // bottom flap is still mostly edge-on and hiding it.
      setTimeout(() => {
        if (this.generation === myGen) {
          this.bottomChar.textContent = newChar;
        }
      }, Math.floor(FLIP_DURATION_MS * 0.55));

      setTimeout(() => {
        topFlap.remove();
        bottomFlap.remove();
        resolve();
      }, FLIP_DURATION_MS + FLIP_BUFFER_MS);
    });
  }

  async animateToTarget() {
    if (this.animating) return;
    this.animating = true;
    const myGen = this.generation;
    while (this.currentIdx !== this.targetIdx && this.generation === myGen) {
      await this.flipOnce(myGen);
    }
    this.animating = false;
  }
}

class Sign {
  constructor(rootEl) {
    this.rootEl = rootEl;
    this.tiles = [];
    this.build();
  }

  build() {
    this.rootEl.innerHTML = "";
    this.tiles = [];
    for (let r = 0; r < ROWS; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      const rowTiles = [];
      for (let c = 0; c < COLS; c++) {
        const tileEl = document.createElement("div");
        tileEl.className = "tile";
        rowEl.appendChild(tileEl);
        rowTiles.push(new Tile(tileEl));
      }
      this.tiles.push(rowTiles);
      this.rootEl.appendChild(rowEl);
    }
  }

  display(text) {
    const lines = wrapText(text);
    const grid = buildGrid(lines);

    // Reset all tiles back to blank, invalidating any in-flight animations.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.tiles[r][c].reset();
      }
    }

    // Set targets and start animating each tile concurrently.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const target = grid[r][c];
        this.tiles[r][c].setTarget(target);
        this.tiles[r][c].animateToTarget();
      }
    }
  }
}

/** Normalize input: uppercase, replace unsupported chars with space. */
function normalize(text) {
  return text
    .toUpperCase()
    .split("")
    .map((c) => (SEQUENCE.includes(c) ? c : " "))
    .join("");
}

/**
 * Wrap text into at most ROWS lines of at most COLS characters,
 * breaking on word boundaries. Words longer than COLS are hard-split.
 */
function wrapText(text) {
  const normalized = normalize(text || "").trim();
  if (!normalized) return [];

  const words = normalized.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  const pushCurrent = () => {
    if (current) {
      lines.push(current);
      current = "";
    }
  };

  for (const word of words) {
    if (lines.length >= ROWS) break;

    if (word.length > COLS) {
      pushCurrent();
      let remaining = word;
      while (remaining.length > COLS && lines.length < ROWS) {
        lines.push(remaining.slice(0, COLS));
        remaining = remaining.slice(COLS);
      }
      current = remaining.length <= COLS ? remaining : "";
      continue;
    }

    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= COLS) {
      current += " " + word;
    } else {
      pushCurrent();
      current = word;
    }
  }

  if (current && lines.length < ROWS) lines.push(current);
  return lines.slice(0, ROWS);
}

/** Place lines onto the configured grid with horizontal centering.
 *  Lines fill from the top row down; unused rows stay blank. */
function buildGrid(lines) {
  const grid = Array.from({ length: ROWS }, () => " ".repeat(COLS));
  if (lines.length === 0) return grid;

  const startRow = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].slice(0, COLS);
    const padLeft = Math.floor((COLS - line.length) / 2);
    const padRight = COLS - padLeft - line.length;
    grid[startRow + i] =
      " ".repeat(padLeft) + line + " ".repeat(padRight);
  }
  return grid;
}

// Read any persisted dimensions before publishing window.SplitFlap so the
// recorder sees the right values immediately if it asks before the form
// is wired up.
loadStoredDimensions();

// Shared state for the GIF recorder. Mutated in place as the user changes
// the layout — record.js reads these fields fresh on each export.
window.SplitFlap = {
  SEQUENCE,
  ROWS,
  COLS,
  MAX_INPUT,
  FLIP_DURATION_MS,
  wrapText,
  buildGrid,
  indexOf,
};

document.addEventListener("DOMContentLoaded", () => {
  const signEl = document.getElementById("sign");
  const formEl = document.getElementById("message-form");
  const inputEl = document.getElementById("message-input");
  const buttonEl = formEl.querySelector("button[type='submit']");
  const hintRowsEl = document.getElementById("hint-rows");
  const hintColsEl = document.getElementById("hint-cols");
  const layoutForm = document.getElementById("layout-form");
  const rowsInput = document.getElementById("rows-input");
  const colsInput = document.getElementById("cols-input");

  const sign = new Sign(signEl);
  let lastMessage = "";

  function syncDimensionUI() {
    inputEl.maxLength = MAX_INPUT;
    if (inputEl.value.length > MAX_INPUT) {
      inputEl.value = inputEl.value.slice(0, MAX_INPUT);
    }
    if (hintRowsEl) hintRowsEl.textContent = String(ROWS);
    if (hintColsEl) hintColsEl.textContent = String(COLS);
    if (rowsInput) rowsInput.value = String(ROWS);
    if (colsInput) colsInput.value = String(COLS);
  }

  function applyLayout(newRows, newCols) {
    const nextRows = clamp(newRows || DEFAULT_ROWS, MIN_ROWS, MAX_ROWS);
    const nextCols = clamp(newCols || DEFAULT_COLS, MIN_COLS, MAX_COLS);
    const changed = nextRows !== ROWS || nextCols !== COLS;
    ROWS = nextRows;
    COLS = nextCols;
    MAX_INPUT = ROWS * COLS + (ROWS - 1);
    window.SplitFlap.ROWS = ROWS;
    window.SplitFlap.COLS = COLS;
    window.SplitFlap.MAX_INPUT = MAX_INPUT;
    syncDimensionUI();
    persistDimensions();
    if (changed) {
      sign.build();
      showMessage(inputEl.value);
    }
    fitSignToViewport();
  }

  // Below this tile width characters get hard to read, so we'd rather let
  // the sign overflow and scroll than crush it any further. 14px is the
  // smallest that still keeps the default 16-column board readable on the
  // narrowest common phones (~320px viewport).
  const MIN_TILE_W = 14;

  function fitSignToViewport() {
    if (!signEl) return;
    // Clear any prior override so we can measure the natural breakpoint
    // tile size for the current viewport.
    signEl.style.removeProperty("--tile-w");
    signEl.style.removeProperty("--tile-h");

    const rootCs = getComputedStyle(document.documentElement);
    const natTileW = parseFloat(rootCs.getPropertyValue("--tile-w"));
    const natTileH = parseFloat(rootCs.getPropertyValue("--tile-h"));
    const tileGap = parseFloat(rootCs.getPropertyValue("--tile-gap"));
    if (!natTileW || !natTileH) return;

    const signCs = getComputedStyle(signEl);
    const padX =
      parseFloat(signCs.paddingLeft) + parseFloat(signCs.paddingRight);
    const borderX =
      parseFloat(signCs.borderLeftWidth) + parseFloat(signCs.borderRightWidth);

    const main = signEl.parentElement;
    const mainCs = main ? getComputedStyle(main) : null;
    const mainPad = mainCs
      ? parseFloat(mainCs.paddingLeft) + parseFloat(mainCs.paddingRight)
      : 0;

    // 4px fudge so we never sit exactly flush with the viewport edge.
    const avail = document.documentElement.clientWidth - mainPad - 4;
    const totalGap = (COLS - 1) * tileGap;
    const intrinsic = COLS * natTileW + totalGap + padX + borderX;
    if (intrinsic <= avail) return;

    const targetTileW = Math.floor((avail - totalGap - padX - borderX) / COLS);
    if (targetTileW < MIN_TILE_W) return; // accept overflow scrolling
    const targetTileH = Math.round(targetTileW * (natTileH / natTileW));
    signEl.style.setProperty("--tile-w", `${targetTileW}px`);
    signEl.style.setProperty("--tile-h", `${targetTileH}px`);
  }

  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      fitSignToViewport();
    });
  });

  syncDimensionUI();

  const showMessage = (text) => {
    sign.display(text);
    lastMessage = text;
    // Disable the button briefly to prevent rapid re-fires that interleave
    // animations awkwardly. The lock matches the longest possible flip run.
    buttonEl.disabled = true;
    const longestPath = SEQUENCE.length;
    const lockMs = longestPath * FLIP_DURATION_MS + 200;
    setTimeout(() => {
      buttonEl.disabled = false;
    }, Math.min(lockMs, 3500));
  };

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    showMessage(inputEl.value);
  });

  if (layoutForm) {
    layoutForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const r = parseInt(rowsInput.value, 10);
      const c = parseInt(colsInput.value, 10);
      applyLayout(r, c);
    });
  }

  // Welcome message on first load — truncated to whatever fits.
  const welcome = "WELCOME TO THE SPLIT-FLAP SIGN".slice(0, MAX_INPUT);
  inputEl.value = welcome;
  showMessage(welcome);
  fitSignToViewport();

  window.SplitFlap.getCurrentMessage = () => lastMessage || inputEl.value;
});
