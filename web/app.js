/* ============================================================================
 * Spider with Axioms, HTML presentation
 *   slide navigation, info popovers, SSE live demo, comparison panel,
 *   SVG bar charts. Vanilla JS, no dependencies.
 * ========================================================================= */

(() => {

// ---------------------------------------------------------------------------
// Slide navigation
// ---------------------------------------------------------------------------
const slides = Array.from(document.querySelectorAll(".slide"));
const tabs   = Array.from(document.querySelectorAll(".nav-tab"));
const pageEl = document.getElementById("chrome-page");
const prevBtn = document.getElementById("nav-prev");
const nextBtn = document.getElementById("nav-next");
let current  = 0;

function show(i) {
  current = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((s, k) => s.classList.toggle("active", k === current));
  tabs.forEach((t, k)   => t.classList.toggle("active", k === current));
  if (pageEl) pageEl.textContent = current + 1;
  if (prevBtn) prevBtn.disabled = current === 0;
  if (nextBtn) nextBtn.disabled = current === slides.length - 1;
  if (current === 4) renderCharts();
}

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  // do not steal arrow keys when the info popover or modal is open
  const modalOpen = !document.getElementById("rate-limit-modal").hidden;
  if (modalOpen && e.key !== "Escape") return;

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

tabs.forEach((t) => t.addEventListener("click", () => {
  show(parseInt(t.dataset.target, 10));
}));
if (prevBtn) prevBtn.addEventListener("click", () => show(current - 1));
if (nextBtn) nextBtn.addEventListener("click", () => show(current + 1));

show(0);


// ---------------------------------------------------------------------------
// Info popovers (Fast Downward etc.)
// ---------------------------------------------------------------------------
const INFO_ENTRIES = {
  "fast-downward": {
    title: "Fast Downward",
    body:
      "A classical planning system written in C++. It is widely used as a " +
      "reference implementation in planning research.",
    link: {
      label: "fast-downward.org",
      href:  "https://www.fast-downward.org/latest/",
    },
  },
};
const popover = document.getElementById("info-popover");
let popoverAnchor = null;

function showPopover(anchor, key) {
  const entry = INFO_ENTRIES[key];
  if (!entry || !popover) return;
  popover.innerHTML = `
    <h4>${entry.title}</h4>
    <p>${entry.body}</p>
    ${entry.link
      ? `<a class="popover-link" href="${entry.link.href}" target="_blank" rel="noopener">${entry.link.label} &#x2197;</a>`
      : ""}
  `;
  popover.hidden = false;
  // position next to the anchor button
  const r = anchor.getBoundingClientRect();
  const popW = popover.offsetWidth;
  const popH = popover.offsetHeight;
  let left = r.left + window.scrollX;
  let top  = r.bottom + window.scrollY + 8;
  if (left + popW > window.innerWidth - 12) {
    left = window.innerWidth - popW - 12;
  }
  if (top + popH > window.innerHeight - 12) {
    top = r.top + window.scrollY - popH - 8;
  }
  popover.style.left = `${left}px`;
  popover.style.top  = `${top}px`;
  popoverAnchor = anchor;
}

function hidePopover() {
  if (popover) popover.hidden = true;
  popoverAnchor = null;
}

document.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  const info = target.closest(".info-btn");
  if (info) {
    if (popoverAnchor === info) { hidePopover(); }
    else                        { showPopover(info, info.dataset.info); }
    e.stopPropagation();
    return;
  }
  if (popover && !popover.hidden && !target.closest("#info-popover")) {
    hidePopover();
  }
});


// ---------------------------------------------------------------------------
// Demo-token bypass (Manuel's laptop, via ?token=... once)
// ---------------------------------------------------------------------------
const TOKEN_STORAGE_KEY = "spiderToken";
(function captureToken() {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("token");
  if (t) {
    localStorage.setItem(TOKEN_STORAGE_KEY, t);
    params.delete("token");
    const newQuery = params.toString();
    const clean = window.location.pathname + (newQuery ? "?" + newQuery : "")
                + window.location.hash;
    window.history.replaceState(null, "", clean);
  }
})();
function getToken() { return localStorage.getItem(TOKEN_STORAGE_KEY) || ""; }


// ---------------------------------------------------------------------------
// Modal helpers (used for both 429 and 503)
// ---------------------------------------------------------------------------
const modalEl   = document.getElementById("rate-limit-modal");
const modalTitle = document.getElementById("modal-title");
const modalBody  = document.getElementById("modal-body");

const MODAL_COPY = {
  rateLimit: {
    title: "Hold on a moment",
    body:  "Each visitor can only start the race a couple of times per minute, so the server stays safe from bots. Try again in about a minute.",
  },
  serverBusy: {
    title: "The server is busy",
    body:  "Many visitors are running the demo right now. Try again in a few seconds.",
  },
  serverError: {
    title: "The server is not reachable",
    body:  "Something went wrong while reaching the backend. The page will work again once the server responds.",
  },
};

function showModal(variant) {
  const copy = MODAL_COPY[variant] || MODAL_COPY.serverError;
  modalTitle.textContent = copy.title;
  modalBody.textContent  = copy.body;
  modalEl.hidden = false;
}
function hideModal() { modalEl.hidden = true; }

document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element)) return;
  if (e.target.matches("[data-close-modal]")) hideModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideModal();
    hidePopover();
  }
});


// ---------------------------------------------------------------------------
// Live demo, side-by-side SSE race
// ---------------------------------------------------------------------------
const DEMO_INSTANCE = "p09";
const DEMO_SEARCH   = "blind";

const btnRun   = document.getElementById("demo-run");
const btnReset = document.getElementById("demo-reset");
const statusEl = document.getElementById("demo-status");
const paneNoax = document.getElementById("pane-noax");
const paneAx   = document.getElementById("pane-ax");
const comparePanel = document.getElementById("compare-panel");

let raceState = null;

function getPanes() {
  return [
    { id: "noaxioms", pane: paneNoax },
    { id: "axioms",   pane: paneAx   },
  ];
}

function resetPanes() {
  for (const { pane } of getPanes()) {
    pane.querySelector('[data-role="term"]').textContent = "";
    pane.querySelector('[data-role="term"]').hidden = false;
    pane.querySelector('[data-role="timer"]').textContent = "0.00 s";
  }
  if (comparePanel) {
    comparePanel.classList.remove("is-visible");
    const grid = document.getElementById("compare-grid");
    if (grid) grid.innerHTML = "";
  }
}

function appendLine(termEl, text) {
  const div = document.createElement("span");
  if (/^\[t=|^Total time:|^Search time:|^Plan cost:|^Plan length:|^Expanded/.test(text)) {
    div.className = "line-stat";
  } else {
    div.className = "line-info";
  }
  div.textContent = text + "\n";
  termEl.appendChild(div);
  termEl.scrollTop = termEl.scrollHeight;
}

function fmtTime(s) {
  if (s == null || isNaN(s)) return "-";
  return s.toFixed(2) + " s";
}

function tearDown() {
  if (raceState && raceState.abortControllers) {
    for (const c of raceState.abortControllers) { try { c.abort(); } catch (_) {} }
  }
}

async function startRace() {
  resetPanes();
  btnRun.disabled = true;
  btnReset.hidden = true;
  statusEl.textContent = "Starting the race...";

  const tok    = getToken();
  const tokQS  = tok ? `&token=${encodeURIComponent(tok)}` : "";

  raceState = {
    finished      : new Set(),
    results       : {},
    started       : performance.now(),
    helloReceived : new Set(),
    aborted       : false,
    abortControllers: [],
  };

  const tickerId = setInterval(() => {
    if (!raceState) return;
    const elapsed = (performance.now() - raceState.started) / 1000;
    for (const { id, pane } of getPanes()) {
      if (raceState.finished.has(id)) continue;
      pane.querySelector('[data-role="timer"]').textContent = elapsed.toFixed(2) + " s";
    }
  }, 100);

  function abortAll(modalVariant) {
    if (!raceState || raceState.aborted) return;
    raceState.aborted = true;
    for (const c of raceState.abortControllers) { try { c.abort(); } catch (_) {} }
    clearInterval(tickerId);
    btnRun.disabled = false;
    btnReset.hidden = true;
    statusEl.textContent = "";
    raceState = null;
    if (modalVariant) showModal(modalVariant);
  }

  // Launch both fetches in parallel; the first one to receive a non-OK
  // response decides which modal to show.
  await Promise.all(getPanes().map(async ({ id, pane }) => {
    if (!raceState || raceState.aborted) return;
    const term    = pane.querySelector('[data-role="term"]');
    const timerEl = pane.querySelector('[data-role="timer"]');
    const url     = `api/run?encoding=${id}&instance=${DEMO_INSTANCE}&search=${DEMO_SEARCH}&track=opt${tokQS}`;

    const ctrl = new AbortController();
    raceState.abortControllers.push(ctrl);

    let resp;
    try {
      resp = await fetch(url, { signal: ctrl.signal });
    } catch (_) {
      abortAll("serverError");
      return;
    }
    if (resp.status === 429) { abortAll("rateLimit");   return; }
    if (resp.status === 503) { abortAll("serverBusy");  return; }
    if (!resp.ok)            { abortAll("serverError"); return; }
    if (!resp.body)          { abortAll("serverError"); return; }

    // Parse SSE manually: events are separated by double-newlines.
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    function handleEvent(eventName, dataStr) {
      let data;
      try { data = JSON.parse(dataStr); } catch (_) { return; }
      if (eventName === "hello") {
        raceState.helloReceived.add(id);
        if (raceState.helloReceived.size === 2) statusEl.textContent = "Racing...";
        appendLine(term, `$ ${data.cmd}`);
        appendLine(term, "");
      } else if (eventName === "line") {
        if (data.line !== undefined) appendLine(term, data.line);
      } else if (eventName === "done") {
        raceState.results[id] = data;
        raceState.finished.add(id);
        timerEl.textContent = fmtTime(data.total_time ?? data.wall_clock);
        if (raceState.finished.size === 2) {
          clearInterval(tickerId);
          btnReset.hidden = false;
          btnRun.disabled = false;
          renderComparison(raceState.results);
          const tNoax = raceState.results.noaxioms?.total_time ?? raceState.results.noaxioms?.wall_clock;
          const tAx   = raceState.results.axioms?.total_time   ?? raceState.results.axioms?.wall_clock;
          if (tNoax && tAx) {
            const speedup = tNoax / tAx;
            statusEl.textContent =
              speedup > 1
                ? `axioms ${speedup.toFixed(1)}x faster`
                : `no-axioms ${(1/speedup).toFixed(1)}x faster`;
          } else {
            statusEl.textContent = "Race complete";
          }
        }
      }
    }

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          // Parse one event block, e.g. "event: line\ndata: {...}"
          let eventName = "message", dataStr = "";
          for (const ln of block.split("\n")) {
            if (ln.startsWith("event:")) eventName = ln.slice(6).trim();
            else if (ln.startsWith("data:")) dataStr += ln.slice(5).trim();
          }
          handleEvent(eventName, dataStr);
        }
      }
    } catch (err) {
      if (err && err.name !== "AbortError") {
        abortAll("serverError");
      }
    }
  }));
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
// Comparison panel rendering
// ---------------------------------------------------------------------------
function renderComparison(results) {
  const noax = results.noaxioms || {};
  const ax   = results.axioms   || {};
  const grid = document.getElementById("compare-grid");
  const headline = document.getElementById("compare-headline");
  const subline  = document.getElementById("compare-subline");
  if (!grid) return;

  const tNoax = noax.total_time ?? noax.wall_clock;
  const tAx   = ax.total_time   ?? ax.wall_clock;
  if (tNoax && tAx) {
    const ratio = tNoax / tAx;
    if (ratio >= 1.05) {
      headline.textContent = `axioms is ${ratio.toFixed(1)}x faster`;
    } else if (ratio <= 0.95) {
      headline.textContent = `no-axioms is ${(1/ratio).toFixed(1)}x faster`;
    } else {
      headline.textContent = "axioms and no-axioms finish in similar time";
    }
  } else {
    headline.textContent = "Race complete";
  }
  subline.textContent =
    "horizontal bars are scaled relative to the larger value, raw numbers shown inside each bar";

  const rows = [
    { label: "Total time",  noax: tNoax,            ax: tAx,          fmt: (v) => v != null ? `${v.toFixed(2)} s` : "-", lowerIsBetter: true },
    { label: "Plan cost",   noax: noax.cost,        ax: ax.cost,      fmt: (v) => v != null ? `${v}` : "-",              lowerIsBetter: null  },
    { label: "Plan length", noax: noax.length,      ax: ax.length,    fmt: (v) => v != null ? `${v}` : "-",              lowerIsBetter: true },
    { label: "Expanded",    noax: noax.expanded,    ax: ax.expanded,  fmt: (v) => v != null ? v.toLocaleString() : "-",  lowerIsBetter: true },
  ];

  grid.innerHTML = "";
  // column headers
  const hLabel = document.createElement("div"); hLabel.className = "ch-header"; hLabel.textContent = "metric"; hLabel.style.textAlign = "left";
  const hNoax  = document.createElement("div"); hNoax.className  = "ch-header noax"; hNoax.textContent  = "no-axioms";
  const hAx    = document.createElement("div"); hAx.className    = "ch-header ax";   hAx.textContent    = "axioms";
  grid.append(hLabel, hNoax, hAx);

  for (const r of rows) {
    const maxV = Math.max(Number(r.noax) || 0, Number(r.ax) || 0) || 1;
    const widthNoax = r.noax != null ? (Number(r.noax) / maxV) * 100 : 0;
    const widthAx   = r.ax   != null ? (Number(r.ax)   / maxV) * 100 : 0;

    const label = document.createElement("div");
    label.className = "ch-label";
    label.textContent = r.label;

    const cellNoax = document.createElement("div");
    cellNoax.className = "ch-bar-cell";
    cellNoax.innerHTML = `
      <div class="ch-bar">
        <div class="ch-bar-fill noax" style="width:${widthNoax}%"></div>
        <div class="ch-bar-value">${r.fmt(r.noax)}</div>
      </div>`;

    const cellAx = document.createElement("div");
    cellAx.className = "ch-bar-cell";
    cellAx.innerHTML = `
      <div class="ch-bar">
        <div class="ch-bar-fill ax" style="width:${widthAx}%"></div>
        <div class="ch-bar-value">${r.fmt(r.ax)}</div>
      </div>`;

    grid.append(label, cellNoax, cellAx);
  }

  // equivalence note for plan cost if equal
  if (noax.cost != null && ax.cost != null && noax.cost === ax.cost) {
    const note = document.createElement("div");
    note.style.gridColumn = "1 / -1";
    note.style.marginTop = "0.4rem";
    note.style.fontSize = "0.85rem";
    note.style.color = "var(--ax)";
    note.style.fontStyle = "italic";
    note.textContent = `Both reach plan cost ${noax.cost}, the equivalence check passes.`;
    grid.append(note);
  }

  comparePanel.classList.add("is-visible");
}


// ---------------------------------------------------------------------------
// SVG bar charts (slide 5)
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
  let raf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      drawOperatorsChart(document.getElementById("chart-operators"));
      drawWalltimeChart (document.getElementById("chart-walltime"));
    });
  });
}

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

  const yMin = 1, yMax = 200000;
  const y = (v) => M.t + innerH - logScale(v, yMin, yMax, 0, innerH);

  const svg = svgEl("svg", {
    class: "svgchart",
    viewBox: `0 0 ${W} ${H}`,
    width: W, height: H,
    preserveAspectRatio: "xMinYMin meet",
  });

  for (const tv of [1, 10, 100, 1000, 10000, 100000]) {
    const yy = y(tv);
    svg.appendChild(svgEl("line", {
      class: "grid-line",
      x1: M.l, x2: M.l + innerW, y1: yy, y2: yy,
    }));
    const t = svgEl("text", {
      x: M.l - 6, y: yy + 3,
      "text-anchor": "end", "font-size": 9,
    });
    t.textContent = tv >= 1000 ? `${tv/1000}k` : `${tv}`;
    svg.appendChild(t);
  }

  const yTitle = svgEl("text", {
    transform: `translate(12, ${M.t + innerH / 2}) rotate(-90)`,
    "text-anchor": "middle",
    "font-size": 10,
  });
  yTitle.textContent = "grounded operators (log scale)";
  svg.appendChild(yTitle);

  let xCursor = M.l;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const gx = xCursor + (g.rows.length * slotW) / 2;
    const gl = svgEl("text", { x: gx, y: M.t + innerH + 30, class: "group-label", "text-anchor": "middle" });
    gl.textContent = g.label.toUpperCase();
    svg.appendChild(gl);

    for (let i = 0; i < g.rows.length; i++) {
      const row = g.rows[i];
      const center = xCursor + i * slotW + slotW / 2;
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
      const xl = svgEl("text", { x: center, y: M.t + innerH + 14, "text-anchor": "middle", "font-size": 9.5 });
      xl.textContent = row.i;
      svg.appendChild(xl);
    }

    xCursor += g.rows.length * slotW;
    if (gi < groups.length - 1) {
      svg.appendChild(svgEl("line", {
        class: "group-divider",
        x1: xCursor + groupGap / 2, x2: xCursor + groupGap / 2,
        y1: M.t, y2: M.t + innerH,
      }));
      xCursor += groupGap;
    }
  }

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

  for (const tv of [0.1, 1, 10, 100]) {
    const yy = y(tv);
    svg.appendChild(svgEl("line", {
      class: "grid-line",
      x1: M.l, x2: M.l + innerW, y1: yy, y2: yy,
    }));
    const t = svgEl("text", { x: M.l - 6, y: yy + 3, "text-anchor": "end", "font-size": 9 });
    t.textContent = tv < 1 ? tv.toFixed(1) + "s" : tv + "s";
    svg.appendChild(t);
  }

  const yTitle = svgEl("text", {
    transform: `translate(12, ${M.t + innerH / 2}) rotate(-90)`,
    "text-anchor": "middle", "font-size": 10,
  });
  yTitle.textContent = "wall-clock (log scale)";
  svg.appendChild(yTitle);

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

    const lnNo = svgEl("text", {
      class: "bar-label",
      x: center - barW/2 - 1, y: y(row.n) - 3,
      "text-anchor": "middle",
    });
    lnNo.setAttribute("fill", "var(--noax)");
    lnNo.textContent = row.n < 1 ? row.n.toFixed(2) + "s" : row.n.toFixed(1) + "s";
    svg.appendChild(lnNo);

    const lnAx = svgEl("text", {
      class: "bar-label",
      x: center + barW/2 + 1, y: y(row.a) - 3,
      "text-anchor": "middle",
    });
    lnAx.setAttribute("fill", "var(--ax)");
    lnAx.textContent = row.a < 1 ? row.a.toFixed(2) + "s" : row.a.toFixed(1) + "s";
    svg.appendChild(lnAx);

    const sp = svgEl("text", {
      class: "speedup",
      x: center, y: M.t - 12,
      "text-anchor": "middle",
    });
    sp.textContent = `axioms ${row.speedup.toFixed(1)}x faster`;
    svg.appendChild(sp);

    const xl = svgEl("text", { x: center, y: M.t + innerH + 16, "text-anchor": "middle", "font-size": 9.5 });
    xl.textContent = "opt " + row.i;
    svg.appendChild(xl);
  });

  svg.appendChild(svgEl("line", {
    class: "axis-line",
    x1: M.l, x2: M.l + innerW, y1: M.t + innerH, y2: M.t + innerH,
  }));

  host.appendChild(svg);
}

})();
