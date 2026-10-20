(() => {
  "use strict";

  const PAGE = 120;
  const FAMILY_LABELS = { theory: "Theory", recovery: "Recovery methods", broader: "Interpretability" };
  const $ = (id) => document.getElementById(id);

  const state = {
    index: null,
    topics: new Map(),
    months: new Map(),
    selected: new Set(),
    q: "",
    range: "7",
    sort: "day",
    showHidden: false,
    shown: PAGE,
    view: "daily",
    reading: null,
  };

  const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
  };

  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const dateLong = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  const addDays = (iso, n) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  /* Theme: system, light, dark */
  const THEMES = ["system", "light", "dark"];
  function applyTheme(theme) {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    $("theme-toggle").textContent = `Theme: ${theme}`;
  }
  let theme = THEMES.includes(store.get("sd-theme")) ? store.get("sd-theme") : "system";
  applyTheme(theme);
  $("theme-toggle").addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store.set("sd-theme", theme);
    applyTheme(theme);
  });

  /* Data */
  async function getJson(path) {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  async function ensureMonths(months) {
    const missing = months.filter((m) => !state.months.has(m.month));
    const loaded = await Promise.all(missing.map((m) => getJson(`data/${m.file}`)));
    missing.forEach((m, i) => state.months.set(m.month, loaded[i]));
  }

  function cutoff() {
    if (state.range === "all" || !state.index.latest_date) return null;
    return addDays(state.index.latest_date, 1 - Number(state.range));
  }

  function monthsForRange() {
    const from = cutoff();
    return state.index.months.filter((m) => !from || m.month >= from.slice(0, 7));
  }

  /* Header */
  function renderHeader() {
    const { index } = state;
    const days = Object.keys(index.days);
    const first = days.length ? days[days.length - 1] : null;
    const short = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    $("stat-total").textContent = `${index.total.toLocaleString("en")} papers${first ? ` since ${short(first)}` : ""}`;
    $("stat-updated").textContent = `updated ${short(index.generated_at.slice(0, 10))}`;
    const github = $("link-github");
    if (index.site.repo && !index.site.repo.startsWith("OWNER/")) {
      github.href = `https://github.com/${index.site.repo}`;
    } else {
      github.hidden = true;
    }
  }

  function renderVolume() {
    const svg = $("volume-chart");
    const latest = state.index.latest_date;
    if (!latest) return;
    const days = 90;
    const values = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = addDays(latest, -i);
      values.push({ day, n: state.index.days[day] || 0 });
    }
    const max = Math.max(1, ...values.map((v) => v.n));
    const width = 900;
    const height = 44;
    const step = width / days;
    const bars = values.map((v, i) => {
      const h = v.n ? Math.max(2, (v.n / max) * (height - 4)) : 0;
      const cls = i === days - 1 ? "bar latest" : "bar";
      return `<rect class="${cls}" x="${(i * step + 1).toFixed(1)}" y="${(height - h).toFixed(1)}" width="${(step - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${v.day}: ${v.n} papers</title></rect>`;
    }).join("");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.innerHTML = `${bars}<line class="baseline" x1="0" x2="${width}" y1="${height - 0.5}" y2="${height - 0.5}"/>`;
    const busiest = values.reduce((a, b) => (b.n > a.n ? b : a));
    $("volume-caption").textContent =
      `Papers per submission day, ${dateLong(values[0].day)} to ${dateLong(latest)}. Busiest day: ${busiest.n} papers.`;
  }

  /* Topic chips */
  function renderChips() {
    const groups = {};
    for (const topic of state.index.topics) (groups[topic.family] ||= []).push(topic);
    $("chips").innerHTML = Object.keys(FAMILY_LABELS).filter((f) => groups[f]).map((family) => `
      <div class="chip-group" role="group" aria-label="${FAMILY_LABELS[family]}">
        <span class="chip-group-label">${FAMILY_LABELS[family]}</span>
        ${groups[family].map((t) => `
          <button type="button" class="chip" data-slug="${t.slug}" data-family="${t.family}"
            aria-pressed="${state.selected.has(t.slug)}" title="${escapeHtml(t.description)}">
            ${escapeHtml(t.name)}<span class="n">${t.count}</span>
          </button>`).join("")}
      </div>`).join("");
  }

  $("chips").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    const slug = chip.dataset.slug;
    if (state.selected.has(slug)) state.selected.delete(slug);
    else state.selected.add(slug);
    chip.setAttribute("aria-pressed", state.selected.has(slug));
    const only = state.selected.size === 1 ? [...state.selected][0] : "";
    try { history.replaceState(null, "", only ? `#${only}` : location.pathname + location.search); } catch { /* sandboxed */ }
    state.shown = PAGE;
    render();
  });

  /* Filtering */
  function visiblePapers() {
    const from = cutoff();
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = [];
    let hidden = 0;
    for (const m of monthsForRange()) {
      for (const p of state.months.get(m.month) || []) {
        if (from && p.published < from) continue;
        if (state.selected.size && !p.topics.some((t) => state.selected.has(t))) continue;
        if (words.length) {
          const hay = `${p.title} ${p.abstract} ${p.authors.join(" ")} ${p.id}`.toLowerCase();
          if (!words.every((w) => hay.includes(w))) continue;
        }
        if (p.ai && p.ai.relevance === 0 && !state.showHidden) { hidden += 1; continue; }
        all.push(p);
      }
    }
    if (state.sort === "score") all.sort((a, b) => b.score - a.score || b.published.localeCompare(a.published));
    else all.sort((a, b) => b.published.localeCompare(a.published) || b.score - a.score);
    return { all, hidden };
  }

  /* Rendering */
  function authorsLine(authors) {
    const shown = authors.slice(0, 8).map(escapeHtml).join(", ");
    return authors.length > 8 ? `${shown}, and ${authors.length - 8} more` : shown;
  }

  function excerpt(text, limit = 320) {
    if (text.length <= limit) return { short: text, cut: false };
    const cut = text.slice(0, limit);
    return { short: cut.slice(0, cut.lastIndexOf(" ")) + "…", cut: true };
  }

  function paperHtml(p) {
    const tags = p.topics.map((slug) => {
      const t = state.topics.get(slug);
      return t ? `<span class="tag" data-family="${t.family}">${escapeHtml(t.name)}</span>` : "";
    }).join("");
    const abs = excerpt(p.abstract);
    const summary = p.ai && p.ai.tldr
      ? `<p class="summary"><span class="label">In one sentence</span>${escapeHtml(p.ai.tldr)}</p>`
      : "";
    const abstract = `<p class="abstract">${escapeHtml(summary ? "" : abs.short)}</p>`;
    const showAbstract = summary || abs.cut
      ? `<button type="button" class="text-button" data-act="abstract">${summary ? "Show abstract" : "Full abstract"}</button>`
      : "";
    const comment = p.comment ? `<p class="comment">${escapeHtml(p.comment)}</p>` : "";
    return `
      <article class="paper" data-id="${p.id}">
        <div class="paper-meta"><span class="arxiv-id">arXiv:${p.id}</span><span>${escapeHtml(p.primary_category)}</span>${tags}</div>
        <h3 class="paper-title"><a href="https://arxiv.org/abs/${p.id}">${escapeHtml(p.title)}</a></h3>
        <p class="authors">${authorsLine(p.authors)}</p>
        ${summary}${abstract}${comment}
        <div class="actions">
          <a href="https://arxiv.org/pdf/${p.id}">PDF</a>
          <a href="https://www.alphaxiv.org/abs/${p.id}">alphaXiv</a>
          <a href="https://huggingface.co/papers/${p.id}">Hugging Face</a>
          ${showAbstract}
          <button type="button" class="text-button" data-act="bibtex">BibTeX</button>
        </div>
      </article>`;
  }

  function render() {
    const { all, hidden } = visiblePapers();
    const page = all.slice(0, state.shown);
    let html = "";
    if (!page.length) {
      html = `<p class="empty">No papers match these filters. <button type="button" class="text-button" data-act="reset">Clear the filters</button></p>`;
    } else if (state.sort === "day") {
      let day = "";
      for (const p of page) {
        if (p.published !== day) {
          day = p.published;
          const count = all.filter((x) => x.published === day).length;
          html += `<h2 class="day"><time datetime="${day}">${dateLong(day)}</time><span class="count">${count} ${count === 1 ? "paper" : "papers"}</span></h2>`;
        }
        html += paperHtml(p);
      }
    } else {
      html = page.map(paperHtml).join("");
    }
    $("list").innerHTML = html;
    $("more").hidden = all.length <= state.shown;
    const period = { 3: "the last 3 days", 7: "the last 7 days", 30: "the last 30 days", all: "all dates" }[state.range];
    let status = `${all.length.toLocaleString("en")} ${all.length === 1 ? "paper" : "papers"} from ${period}`;
    if (state.selected.size) status += ` in ${state.selected.size} selected ${state.selected.size === 1 ? "topic" : "topics"}`;
    if (hidden) status += `. ${hidden} graded off-topic by the AI filter are hidden. <button type="button" class="text-button" data-act="hidden">Show them</button>`;
    else if (state.showHidden) status += `. <button type="button" class="text-button" data-act="hidden">Hide off-topic papers</button>`;
    $("status").innerHTML = status + (status.endsWith(">") ? "" : ".");
  }

  function bibtex(p) {
    const last = (p.authors[0] || "anon").split(" ").pop().normalize("NFD").replace(/[^A-Za-z]/g, "").toLowerCase();
    const word = (p.title.match(/[A-Za-z]{4,}/) || ["paper"])[0].toLowerCase();
    const year = `20${p.id.slice(0, 2)}`;
    return [
      `@misc{${last}${year}${word},`,
      `  title         = {${p.title}},`,
      `  author        = {${p.authors.join(" and ")}},`,
      `  year          = {${year}},`,
      `  eprint        = {${p.id}},`,
      `  archivePrefix = {arXiv},`,
      `  primaryClass  = {${p.primary_category}},`,
      `  url           = {https://arxiv.org/abs/${p.id}}`,
      `}`,
    ].join("\n");
  }

  function findPaper(id) {
    for (const papers of state.months.values()) {
      const hit = papers.find((p) => p.id === id);
      if (hit) return hit;
    }
    return null;
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    if (act === "reset") {
      state.selected.clear(); state.q = ""; $("q").value = ""; state.range = "all"; $("range").value = "all";
      renderChips(); await ensureMonths(monthsForRange()); render(); return;
    }
    if (act === "hidden") { state.showHidden = !state.showHidden; render(); return; }
    const article = button.closest(".paper");
    const paper = article && findPaper(article.dataset.id);
    if (!paper) return;
    if (act === "abstract") {
      const node = article.querySelector(".abstract");
      const open = button.dataset.open === "1";
      const hasSummary = Boolean(article.querySelector(".summary"));
      node.textContent = open ? (hasSummary ? "" : excerpt(paper.abstract).short) : paper.abstract;
      button.dataset.open = open ? "0" : "1";
      button.textContent = open ? (hasSummary ? "Show abstract" : "Full abstract") : "Shorter";
    }
    if (act === "bibtex") {
      const existing = article.querySelector(".bibtex");
      if (existing) { existing.remove(); button.textContent = "BibTeX"; return; }
      const text = bibtex(paper);
      const pre = document.createElement("pre");
      pre.className = "bibtex";
      pre.textContent = text;
      article.appendChild(pre);
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "BibTeX copied";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = "BibTeX selected";
      }
    }
  });

  /* Controls */
  let searchTimer = 0;
  $("q").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = event.target.value.trim(); state.shown = PAGE; render(); }, 150);
  });
  $("range").addEventListener("change", async (event) => {
    state.range = event.target.value; state.shown = PAGE;
    $("status").textContent = "Loading…";
    await ensureMonths(monthsForRange());
    render();
  });
  $("sort").addEventListener("change", (event) => { state.sort = event.target.value; state.shown = PAGE; render(); });
  $("more").addEventListener("click", () => { state.shown += PAGE; render(); });

  /* Reading list */
  const anchorOf = (slug) => `list-${slug}`;
  function renderReading() {
    const sections = state.reading || [];
    $("reading-toc").innerHTML = sections.map((s) =>
      `<a href="#${anchorOf(s.slug)}" data-section="${s.slug}">${escapeHtml(s.name)}</a>`).join("");
    $("reading-sections").innerHTML = sections.map((s) => `
      <section class="reading-section" id="${anchorOf(s.slug)}">
        <h2>${escapeHtml(s.name)}<span class="count">${s.item.length}</span></h2>
        <p class="section-description">${escapeHtml(s.description)}</p>
        <ul class="entries">${s.item.map((it) => `
          <li class="entry">
            <span class="entry-title"><a href="${escapeHtml(it.url)}">${escapeHtml(it.title)}</a></span>
            <span class="entry-meta">${escapeHtml(it.authors)}, ${escapeHtml(it.year)}${it.venue ? ` · ${escapeHtml(it.venue)}` : ""}</span>
            <p class="entry-note">${escapeHtml(it.note)}</p>
          </li>`).join("")}
        </ul>
      </section>`).join("");
  }

  $("reading-toc").addEventListener("click", (event) => {
    const link = event.target.closest("a[data-section]");
    if (!link) return;
    event.preventDefault();
    const target = document.getElementById(anchorOf(link.dataset.section));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function setView(view) {
    state.view = view;
    document.querySelectorAll("[data-for]").forEach((el) => { el.hidden = el.dataset.for !== view; });
    document.querySelectorAll(".view-tab").forEach((tab) => tab.setAttribute("aria-pressed", tab.dataset.view === view));
    try {
      const hash = view === "reading" ? "#reading-list" : (state.selected.size === 1 ? `#${[...state.selected][0]}` : "");
      history.replaceState(null, "", hash || location.pathname + location.search);
    } catch { /* sandboxed */ }
  }
  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-view]");
    if (!control) return;
    setView(control.dataset.view);
    if (control.dataset.scroll) $("views").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* Highlights: the most central papers of the latest week */
  function renderHighlights() {
    const latest = state.index.latest_date;
    if (!latest) return;
    const from = addDays(latest, -6);
    const pool = [];
    for (const papers of state.months.values()) {
      for (const p of papers) {
        if (p.published >= from && !(p.ai && p.ai.relevance === 0)) pool.push(p);
      }
    }
    pool.sort((a, b) => b.score - a.score || b.published.localeCompare(a.published));
    $("highlights").innerHTML = pool.slice(0, 3).map((p) => {
      const tags = p.topics.slice(0, 2).map((slug) => {
        const topic = state.topics.get(slug);
        return topic ? `<span class="tag" data-family="${topic.family}">${escapeHtml(topic.name)}</span>` : "";
      }).join("");
      const who = p.authors.length > 2 ? `${p.authors[0]} et al.` : p.authors.join(" and ");
      return `<article class="hl-card">
          <div class="hl-tags">${tags}</div>
          <span class="hl-title"><a href="https://arxiv.org/abs/${p.id}">${escapeHtml(p.title)}</a></span>
          <span class="hl-meta">${escapeHtml(who)} · ${dateLong(p.published)}</span>
        </article>`;
    }).join("");
  }

  /* Live toy model of superposition */
  const DENSITIES = [1, 0.3, 0.1, 0.03, 0.01];
  const TOTAL_STEPS = 3000;
  const STEPS_PER_FRAME = 20;
  const reduceMotion = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const toyState = { toy: null, run: 0, seed: 11 };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function drawToy() {
    const canvas = $("toy-canvas");
    const toy = toyState.toy;
    if (!canvas || !toy || !canvas.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth;
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const R = size * 0.33;
    ctx.lineWidth = 1;
    ctx.strokeStyle = cssVar("--rule");
    ctx.beginPath();
    ctx.moveTo(c - R * 1.3, c); ctx.lineTo(c + R * 1.3, c);
    ctx.moveTo(c, c - R * 1.3); ctx.lineTo(c, c + R * 1.3);
    ctx.stroke();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = cssVar("--rule-strong");
    ctx.beginPath(); ctx.arc(c, c, R, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);

    const accent = cssVar("--theory");
    const label = cssVar("--ink-2");
    const cols = toy.columns().map((col, i) => ({ ...col, i }));
    cols.sort((a, b) => a.imp - b.imp).forEach((col) => {
      const x = c + col.x * R;
      const y = c - col.y * R;
      ctx.globalAlpha = 0.28 + 0.72 * col.imp;
      ctx.strokeStyle = accent;
      ctx.fillStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = 1;
      if (col.norm > 0.3) {
        const ux = col.x / col.norm;
        const uy = col.y / col.norm;
        ctx.fillStyle = label;
        ctx.font = "500 11px 'IBM Plex Mono', ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`f${col.i + 1}`, c + ux * (col.norm * R + 15), c - uy * (col.norm * R + 15));
      }
    });
    const kept = cols.filter((col) => col.norm > 0.5).length;
    $("toy-status").textContent = `${kept} of ${toy.n} features stored`;
    $("toy-step").textContent = toy.steps < TOTAL_STEPS ? `step ${toy.steps}` : `loss ${toy.loss.toFixed(4)}`;
    canvas.setAttribute("aria-label", `${kept} of ${toy.n} features stored in two dimensions`);
  }

  function trainToy() {
    if (typeof window.createToy !== "function") return;
    const n = Number($("toy-n").value);
    const density = DENSITIES[Number($("toy-density").value)];
    $("toy-density-label").textContent = `${Math.round(density * 100)}% active`;
    $("toy-n-label").textContent = n;
    toyState.seed = (toyState.seed * 31 + 7) % 10007 + 1;
    const toy = window.createToy({ n, density, seed: toyState.seed });
    toyState.toy = toy;
    const run = ++toyState.run;
    if (reduceMotion) {
      while (toy.steps < TOTAL_STEPS) toy.step();
      drawToy();
      return;
    }
    const tick = () => {
      if (run !== toyState.run) return;
      for (let i = 0; i < STEPS_PER_FRAME && toy.steps < TOTAL_STEPS; i += 1) toy.step();
      drawToy();
      if (toy.steps < TOTAL_STEPS) requestAnimationFrame(tick);
    };
    drawToy();
    requestAnimationFrame(tick);
  }

  let toyTimer = 0;
  const retrain = () => { clearTimeout(toyTimer); toyTimer = setTimeout(trainToy, 120); };
  $("toy-density").addEventListener("input", retrain);
  $("toy-n").addEventListener("change", retrain);
  $("toy-run").addEventListener("click", trainToy);
  window.addEventListener("resize", drawToy);
  $("theme-toggle").addEventListener("click", () => requestAnimationFrame(drawToy));
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawToy);
  trainToy();

  /* Start */
  async function start() {
    try {
      state.index = await getJson("data/index.json");
    } catch (error) {
      $("list").innerHTML = `<p class="empty">The paper index could not be loaded (${escapeHtml(error.message)}). Reload the page to try again.</p>`;
      return;
    }
    for (const t of state.index.topics) state.topics.set(t.slug, t);
    try {
      state.reading = await getJson("data/reading_list.json");
      const curated = state.reading.reduce((n, s) => n + s.item.length, 0);
      $("reading-count").textContent = curated;
      $("stat-curated").textContent = `${curated} curated works`;
      renderReading();
    } catch { document.querySelector('.view-tab[data-view="reading"]').hidden = true; }
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash === "reading-list" && state.reading) setView("reading");
    if (state.topics.has(hash)) { state.selected.add(hash); state.range = "30"; $("range").value = "30"; }
    renderHeader();
    renderVolume();
    renderChips();
    await ensureMonths(monthsForRange());
    renderHighlights();
    render();
  }
  start();
})();
