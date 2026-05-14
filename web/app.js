/* ============================================================================
 * Spider with Axioms — HTML presentation
 *   - slide navigation (← → / space / page-up/down / dot click)
 *   - SSE-driven live FD demo with side-by-side race
 *   - SVG bar charts on slide 4
 * Vanilla JS, no dependencies.
 * ========================================================================= */

(() => {

// ---------------------------------------------------------------------------
// Slide navigation
// ---------------------------------------------------------------------------
const slides = Array.from(document.querySelectorAll(".slide"));
const dots   = Array.from(document.querySelectorAll(".dot"));
const pageEl = document.getElementById("chrome-page");
let current  = 0;

function show(i) {
  current = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((s, k) => s.classList.toggle("active", k === current));
  dots  .forEach((d, k) => d.classList.toggle("active", k === current));
  if (pageEl) pageEl.textContent = current + 1;

  // Lazily render charts when slide 4 first appears (avoids initial-paint cost)
  if (current === 3) renderCharts();
}

document.addEventListener("keydown", (e) => {
  // ignore keystrokes while a text input has focus (none today, but safe)
  if (e.target instanceof HTMLInputElement) return;

  switch (e.key) {
    case "ArrowRight":
    case "PageDown":
    case " ":
      e.preventDefault(); show(current + 1); break;
    case "ArrowLeft":
    case "PageUp":
      e.preventDefault(); show(current - 1); break;
    case "Home":
      e.preventDefault(); show(0); break;
    case "End":
      e.preventDefault(); show(slides.length - 1); break;
  }
});

dots.forEach((d) => d.addEventListener("click", () => {
  show(parseInt(d.dataset.target, 10));
}));

// On load, activate slide 0
show(0);


// ---------------------------------------------------------------------------
// Demo-token bypass (lets Manuel race repeatedly without tripping the public
// rate-limit). Token comes from ?token=... on first visit, then sticks in
// localStorage and is appended to every /api/run URL.
// ---------------------------------------------------------------------------
const TOKEN_STORAGE_KEY = "spiderToken";
(function captureToken() {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("token");
  if (t) {
    localStorage.setItem(TOKEN_STORAGE_KEY, t);
    // strip the token from the visible URL bar
    params.delete("token");
    const newQuery = params.toString();
    const clean = window.location.pathname + (newQuery ? "?" + newQuery : "")
                + window.location.hash;
    window.history.replaceState(null, "", clean);
  }
})();
function getToken() { return localStorage.getItem(TOKEN_STORAGE_KEY) || ""; }

// ---------------------------------------------------------------------------
// Live demo: side-by-side SSE race
// ---------------------------------------------------------------------------
const DEMO_INSTANCE = "p09";
const DEMO_SEARCH   = "blind";          // both encodings supported

const btnRun   = document.getElementById("demo-run");
const btnReset = document.getElementById("demo-reset");
const statusEl = document.getElementById("demo-status");
const paneNoax = document.getElementById("pane-noax");
const paneAx   = document.getElementById("pane-ax");

let activeSources = [];
let raceState     = null;

function getPanes() {
  return [
    { id: "noaxioms", pane: paneNoax },
    { id: "axioms",   pane: paneAx   },
  ];
}

function resetPanes() {
  for (const { pane } of getPanes()) {
    pane.querySelector('[data-role="term"]').textContent = "";
    pane.querySelector('[data-role="term"]').hidden      = false;
    const summary = pane.querySelector('[data-role="summary"]');
    summary.hidden = true;
    summary.innerHTML = "";
    summary.classList.remove("is-winner");
    pane.querySelector('[data-role="timer"]').textContent = "0.00 s";
  }
}

function appendLine(termEl, text) {
  const div = document.createElement("span");
  // crude classification for color
  if (/^\[t=|^Total time:|^Search time:|^Plan cost:|^Plan length:|^Expanded/.test(text)) {
    div.className = "line-stat";
  } else {
    div.className = "line-info";
  }
  div.textContent = text + "\n";
  termEl.appendChild(div);
  // auto-scroll to bottom
  termEl.scrollTop = termEl.scrollHeight;
}

function fmtTime(s) {
  if (s == null || isNaN(s)) return "—";
  return s.toFixed(2) + " s";
}

function renderSummary(pane, data, isWinner) {
  const summary = pane.querySelector('[data-role="summary"]');
  pane.querySelector('[data-role="term"]').hidden = true;
  summary.hidden = false;
  summary.classList.toggle("is-winner", isWinner);

  const rows = [
    ["Total time",  fmtTime(data.total_time ?? data.wall_clock)],
    ["Plan cost",   data.cost   ?? "—"],
    ["Plan length", data.length ?? "—"],
    ["Expanded",    data.expanded != null ? data.expanded.toLocaleString() : "—"],
  ];

  summary.innerHTML = rows.map(([k, v], idx) => `
    <div class="summary-row">
      <span class="k">${k}</span>
      <span class="v${idx === 0 && isWinner ? " winner" : ""}">${v}</span>
      ${idx === 0 && isWinner ? '<span class="winner-badge">finished first</span>' : ""}
    </div>
  `).join("");
}

function tearDown() {
  for (const es of activeSources) { try { es.close(); } catch (_) {} }
  activeSources = [];
}

function startRace() {
  resetPanes();
  btnRun.disabled = true;
  btnReset.hidden = true;
  statusEl.textContent = "Connecting to WSL…";

  raceState = {
    finished: new Set(),
    results : {},
    started : performance.now(),
  };

  // ticker for the timers
  const tickerId = setInterval(() => {
    if (!raceState) return;
    const elapsed = (performance.now() - raceState.started) / 1000;
    for (const { id, pane } of getPanes()) {
      if (raceState.finished.has(id)) continue;
      pane.querySelector('[data-role="timer"]').textContent = elapsed.toFixed(2) + " s";
    }
  }, 100);

  const startedAt = performance.now();
  let connectedCount = 0;

  for (const { id, pane } of getPanes()) {
    const term    = pane.querySelector('[data-role="term"]');
    const timerEl = pane.querySelector('[data-role="timer"]');
    const tok     = getToken();
    const tokQS   = tok ? `&token=${encodeURIComponent(tok)}` : "";
    const url     = `api/run?encoding=${id}&instance=${DEMO_INSTANCE}&search=${DEMO_SEARCH}&track=opt${tokQS}`;
    const es      = new EventSource(url);
    activeSources.push(es);

    es.addEventListener("hello", (ev) => {
      connectedCount++;
      if (connectedCount === 2) statusEl.textContent = "Racing…";
      try {
        const data = JSON.parse(ev.data);
        appendLine(term, `$ ${data.cmd}`);
        appendLine(term, "");
      } catch (_) {}
    });

    es.addEventListener("line", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.line !== undefined) appendLine(term, data.line);
      } catch (_) {}
    });

    es.addEventListener("done", (ev) => {
      const data = JSON.parse(ev.data);
      raceState.results[id] = data;
      raceState.finished.add(id);
      timerEl.textContent = fmtTime(data.total_time ?? data.wall_clock);
      es.close();

      // Are we the first to finish?
      const isWinner = raceState.finished.size === 1;
      renderSummary(pane, data, isWinner);

      // Both done?
      if (raceState.finished.size === 2) {
        clearInterval(tickerId);
        btnReset.hidden = false;
        btnRun.disabled = false;
        const tNoax = raceState.results.noaxioms?.total_time;
        const tAx   = raceState.results.axioms?.total_time;
        if (tNoax && tAx) {
          const speedup = tNoax / tAx;
          statusEl.textContent =
            speedup > 1
              ? `axioms ${speedup.toFixed(1)}× faster`
              : `no-axioms ${(1/speedup).toFixed(1)}× faster`;
        } else {
          statusEl.textContent = "Race complete";
        }
      }
    });

    es.addEventListener("error", (ev) => {
      // EventSource fires 'error' both for connection problems and natural close
      if (es.readyState === EventSource.CLOSED) return;
      appendLine(term, "[error] stream closed unexpectedly");
      statusEl.textContent = "Stream error — is the WSL server running?";
      btnRun.disabled = false;
      es.close();
    });
  }
}

if (btnRun)   btnRun  .addEventListener("click", startRace);
if (btnReset) btnReset.addEventListener("click", () => {
  tearDown();
  resetPanes();
  btnReset.hidden = true;
  statusEl.textContent = "";
  raceState = null;
});


// ---------------------------------------------------------------------------
// SVG bar charts (slide 4)
// ---------------------------------------------------------------------------
const OPERATORS_DATA = {
  opt: [
    { i: "p01", n: 2870,   a: 1594  },
    { i: "p03", n: 9645,   a: 5255  },
    { i: "p05", n: 22345,  a: 11097 },
    { i: "p07", n: 2866,   a: 1516  },
    { i: "p09", n: 9443,   a: 4839  },
    { i: "p11", n: 22863,  a: 11807 },
    { i: "p13", n: 44157,  a: 21193 },
    { i: "p15", n: 4387,   a: 2419  },
  ],
  sat: [
    { i: "p01", n: 22438,  a: 11352 },
    { i: "p03", n: 43267,  a: 19993 },
    { i: "p05", n: 103363, a: 43663 },
    { i: "p07", n: 12057,  a: 6455  },
    { i: "p09", n: 38647,  a: 18553 },
  ],
};

const WALLTIME_DATA = [
  { i: "p01", n:   0.85, a:  0.12, speedup: 7.0 },
  { i: "p03", n: 107.06, a: 22.43, speedup: 4.8 },
  { i: "p07", n:   0.75, a:  0.09, speedup: 8.6 },
  { i: "p09", n:  66.69, a: 16.23, speedup: 4.1 },
  { i: "p15", n:   0.40, a:  0.08, speedup: 5.0 },
];

let chartsRendered = false;
function renderCharts() {
  if (chartsRendered) return;
  drawOperatorsChart(document.getElementById("chart-operators"));
  drawWalltimeChart (document.getElementById("chart-walltime"));
  chartsRendered = true;
  // re-render on resize (debounced)
  let raf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      drawOperatorsChart(document.getElementById("chart-operators"));
      drawWalltimeChart (document.getElementById("chart-walltime"));
    });
  });
}

// helper: log10 scale mapping a value v in [vmin, vmax] to a pixel range
function logScale(v, vmin, vmax, pxMin, pxMax) {
  const lv = Math.log10(Math.max(v, vmin));
  const lmin = Math.log10(vmin), lmax = Math.log10(vmax);
  return pxMin + ((lv - lmin) / (lmax - lmin)) * (pxMax - pxMin);
}

function svgEl(tag, attrs = {}, children = []) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}

function drawOperatorsChart(host) {
  if (!host) return;
  host.innerHTML = "";
  const W = host.clientWidth, H = host.clientHeight;
  if (!W || !H) return;
  const M = { l: 50, r: 12, t: 10, b: 38 };
  const innerW = W - M.l - M.r, innerH = H - M.t - M.b;

  const groups = [
    { label: "Optimal track", rows: OPERATORS_DATA.opt },
    { label: "Satisficing track", rows: OPERATORS_DATA.sat },
  ];
  const total = groups.reduce((s, g) => s + g.rows.length, 0);
  const groupGap = 22;
  const usable   = innerW - groupGap * (groups.length - 1);
  const slotW    = usable / total;
  const barW     = slotW * 0.36;

  // y-axis: log scale 1 .. 200000
  const yMin = 1, yMax = 200000;
  const y = (v) => M.t + innerH - logScale(v, yMin, yMax, 0, innerH);

  const svg = svgEl("svg", {
    class: "svgchart",
    viewBox: `0 0 ${W} ${H}`,
    width: W, height: H,
    preserveAspectRatio: "xMinYMin meet",
  });

  // grid + y-ticks at powers of 10
  for (const tv of [1, 10, 100, 1000, 10000, 100000]) {
    const yy = y(tv);
    svg.appendChild(svgEl("line", {
      class: "grid-line",
      x1: M.l, x2: M.l + innerW, y1: yy, y2: yy,
    }));
    svg.appendChild(svgEl("text", {
      x: M.l - 6, y: yy + 3,
      "text-anchor": "end",
      fill: "var(--muted)", "font-size": 9,
    })).textContent = tv >= 1000 ? `${tv/1000}k` : `${tv}`;
  }

  // y-axis title
  const yTitle = svgEl("text", {
    transform: `translate(12, ${M.t + innerH / 2}) rotate(-90)`,
    "text-anchor": "middle",
    fill: "var(--muted)", "font-size": 10,
  });
  yTitle.textContent = "grounded operators (log scale)";
  svg.appendChild(yTitle);

  // bars
  let xCursor = M.l;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    // group label
    const gx = xCursor + (g.rows.length * slotW) / 2;
    svg.appendChild(svgEl("text", {
      x: gx, y: M.t + innerH + 30,
      class: "group-label", "text-anchor": "middle",
    })).textContent = g.label.toUpperCase();

    for (let i = 0; i < g.rows.length; i++) {
      const row = g.rows[i];
      const center = xCursor + i * slotW + slotW / 2;
      // no-axioms bar (left)
      svg.appendChild(svgEl("rect", {
        class: "bar-noax",
        x: center - barW - 1, y: y(row.n),
        width: barW, height: M.t + innerH - y(row.n),
      }));
      // axioms bar (right)
      svg.appendChild(svgEl("rect", {
        class: "bar-ax",
        x: center + 1, y: y(row.a),
        width: barW, height: M.t + innerH - y(row.a),
      }));
      // x label
      svg.appendChild(svgEl("text", {
        x: center, y: M.t + innerH + 14,
        "text-anchor": "middle",
        fill: "var(--ink)", "font-size": 9.5,
      })).textContent = row.i;
    }

    xCursor += g.rows.length * slotW;
    if (gi < groups.length - 1) {
      // divider
      svg.appendChild(svgEl("line", {
        class: "group-divider",
        x1: xCursor + groupGap / 2, x2: xCursor + groupGap / 2,
        y1: M.t,                    y2: M.t + innerH,
      }));
      xCursor += groupGap;
    }
  }

  // baseline
  svg.appendChild(svgEl("line", {
    class: "axis-line",
    x1: M.l, x2: M.l + innerW, y1: M.t + innerH, y2: M.t + innerH,
  }));

  host.appendChild(svg);
}

function drawWalltimeChart(host) {
  if (!host) return;
  host.innerHTML = "";
  const W = host.clientWidth, H = host.clientHeight;
  if (!W || !H) return;
  const M = { l: 50, r: 12, t: 28, b: 28 };
  const innerW = W - M.l - M.r, innerH = H - M.t - M.b;

  const rows = WALLTIME_DATA;
  const slotW = innerW / rows.length;
  const barW  = slotW * 0.30;

  const yMin = 0.05, yMax = 200;
  const y = (v) => M.t + innerH - logScale(v, yMin, yMax, 0, innerH);

  const svg = svgEl("svg", {
    class: "svgchart",
    viewBox: `0 0 ${W} ${H}`,
    width: W, height: H,
    preserveAspectRatio: "xMinYMin meet",
  });

  // grid + ticks
  for (const tv of [0.1, 1, 10, 100]) {
    const yy = y(tv);
    svg.appendChild(svgEl("line", {
      class: "grid-line",
      x1: M.l, x2: M.l + innerW, y1: yy, y2: yy,
    }));
    svg.appendChild(svgEl("text", {
      x: M.l - 6, y: yy + 3,
      "text-anchor": "end",
      fill: "var(--muted)", "font-size": 9,
    })).textContent = tv < 1 ? tv.toFixed(1) + "s" : tv + "s";
  }

  // y-axis title
  svg.appendChild(svgEl("text", {
    transform: `translate(12, ${M.t + innerH / 2}) rotate(-90)`,
    "text-anchor": "middle",
    fill: "var(--muted)", "font-size": 10,
  })).textContent = "wall-clock (log scale)";

  rows.forEach((row, i) => {
    const center = M.l + i * slotW + slotW / 2;

    svg.appendChild(svgEl("rect", {
      class: "bar-noax",
      x: center - barW - 1, y: y(row.n),
      width: barW, height: M.t + innerH - y(row.n),
    }));
    svg.appendChild(svgEl("rect", {
      class: "bar-ax",
      x: center + 1, y: y(row.a),
      width: barW, height: M.t + innerH - y(row.a),
    }));

    // numeric labels on top of each bar
    svg.appendChild(svgEl("text", {
      class: "bar-label",
      x: center - barW/2 - 1, y: y(row.n) - 3,
      "text-anchor": "middle", fill: "var(--noax)",
    })).textContent = row.n < 1 ? row.n.toFixed(2) + "s" : row.n.toFixed(1) + "s";

    svg.appendChild(svgEl("text", {
      class: "bar-label",
      x: center + barW/2 + 1, y: y(row.a) - 3,
      "text-anchor": "middle", fill: "var(--ax)",
    })).textContent = row.a < 1 ? row.a.toFixed(2) + "s" : row.a.toFixed(1) + "s";

    // speedup callout above the pair
    svg.appendChild(svgEl("text", {
      class: "speedup",
      x: center, y: M.t - 12,
      "text-anchor": "middle",
    })).textContent = `axioms ${row.speedup.toFixed(1)}× faster`;

    // x label
    svg.appendChild(svgEl("text", {
      x: center, y: M.t + innerH + 16,
      "text-anchor": "middle",
      fill: "var(--ink)", "font-size": 9.5,
    })).textContent = "opt " + row.i;
  });

  // baseline
  svg.appendChild(svgEl("line", {
    class: "axis-line",
    x1: M.l, x2: M.l + innerW, y1: M.t + innerH, y2: M.t + innerH,
  }));

  host.appendChild(svg);
}

})();
