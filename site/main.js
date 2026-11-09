(() => {
  "use strict";

  const REPO = "https://github.com/Mordsome/KairoLauncher";
  const VERSION = "0.1.0";

  // Screens: files in img/shots/. [file, tab name, caption]
  const SHOTS = [
    ["home", "Home", "The selected install, Kairo's patch notes, and the split Play button."],
    ["picker", "Choose what to play", "Every install as a tile. Make as many as you like with New install."],
    ["new-install", "New install", "A Fabric install for any version, with Sodium, Iris and Lithium from Modrinth."],
    ["library", "Library", "Every install with its own folder, last played and its own settings."],
    ["mods", "Mods", "Pick several mods from Modrinth, each checked for exactly that loader and version."],
    ["appearance", "Appearance", "Give an install its own accent colour, corners and background picture."],
    ["own-look", "Its own look", "The whole launcher takes that look whenever the install is selected."],
    ["layouts", "Home layouts", "Classic, Centred, Side panel or Bottom bar. This is Side panel."],
    ["backgrounds", "Backgrounds", "The Pixel field, Aurora, or your own picture or GIF."],
    ["accounts", "Accounts", "Several Microsoft accounts, each pictured by its skin's head."],
    ["sign-in", "Sign in", "Microsoft's own page, in your browser. The launcher never sees your password."],
  ];

  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const THEMES = {
    kairo: { bg: "#0a1322", a: [127, 216, 255], h: [255, 154, 82] },
    void: { bg: "#130a2a", a: [180, 140, 255], h: [255, 110, 199] },
  };
  let theme = "kairo";
  try { const s = localStorage.getItem("kl-theme"); if (THEMES[s]) theme = s; } catch (e) {}

  /* ---------- pixel field: the launcher's own calm background ---------- */
  const cv = $("#pixels"), cx = cv.getContext("2d");
  const CELL = 18;
  let W = 0, H = 0, cols = 0, rows = 0, heat = new Float32Array(0), grid = null, stars = [];
  const ripples = [], waves = [];
  let mouse = null, f = null, hovered = null, hoverAt = 0, running = false;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / CELL); rows = Math.ceil(H / CELL);
    heat = new Float32Array(cols * rows);
    grid = document.createElement("canvas"); grid.width = W * dpr; grid.height = H * dpr;
    const g = grid.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "rgba(255,255,255,0.03)";
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g.fillRect(x * CELL + CELL / 2 - 1, y * CELL + CELL / 2 - 1, 2, 2);
    stars = Array.from({ length: Math.round(W * H / 9000) }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() < 0.15 ? 2 : 1, p: Math.random() * 6.28, v: 0.4 + Math.random() }));
    draw(0); wake();
  }
  function bump(px, py, r, amt) {
    const cxl = Math.floor(px / CELL), cyl = Math.floor(py / CELL), R = Math.ceil(r);
    for (let y = cyl - R; y <= cyl + R; y++) {
      if (y < 0 || y >= rows) continue;
      for (let x = cxl - R; x <= cxl + R; x++) {
        if (x < 0 || x >= cols) continue;
        const d = Math.hypot(x - cxl, y - cyl);
        if (d > r) continue;
        const i = y * cols + x;
        heat[i] = Math.min(1, heat[i] + amt * (1 - d / (r + 0.5)));
      }
    }
  }
  function wave(node, strength) {
    if (reduce) return;
    const r = node.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H) return;
    waves.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, d: 0, max: 7, a: strength });
    if (waves.length > 10) waves.shift();
    wake();
  }
  function draw(t) {
    if (!grid) return false;
    let busy = false;
    cx.clearRect(0, 0, W, H);
    if (theme === "void") {
      busy = !reduce;
      for (const s of stars) {
        const a = reduce ? 0.35 : 0.2 + 0.2 * Math.sin(t / 1000 * s.v * 0.6 + s.p);
        cx.fillStyle = `rgba(230,220,255,${Math.max(0.04, a).toFixed(3)})`;
        cx.fillRect(s.x, s.y, s.s, s.s);
      }
    }
    cx.drawImage(grid, 0, 0, W, H);
    const [ar, ag, ab] = THEMES[theme].a, [hr, hg, hb] = THEMES[theme].h;
    for (let i = 0; i < heat.length; i++) {
      const h = heat[i];
      if (h < 0.01) { heat[i] = 0; continue; }
      busy = true;
      const e = h * h * (3 - 2 * h), mix = h > 0.7 ? (h - 0.7) / 0.3 : 0;
      cx.fillStyle = `rgba(${ar + (hr - ar) * mix | 0},${ag + (hg - ag) * mix | 0},${ab + (hb - ab) * mix | 0},${(e * 0.55).toFixed(3)})`;
      const sz = (CELL - 8) + 4 * e, x = (i % cols) * CELL + CELL / 2, y = Math.floor(i / cols) * CELL + CELL / 2;
      cx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      heat[i] = h * 0.95;
    }
    return busy;
  }
  function frame(t) {
    let busy = false;
    if (mouse) {
      if (!f) f = { x: mouse.x, y: mouse.y };
      const px = f.x, py = f.y;
      f.x += (mouse.x - f.x) * 0.22; f.y += (mouse.y - f.y) * 0.22;
      const mvx = f.x - px, mvy = f.y - py, speed = Math.hypot(mvx, mvy);
      if (speed > 0.4) {
        busy = true;
        const amt = Math.min(0.22, 0.05 + speed * 0.012), steps = Math.min(10, Math.ceil(speed / 9));
        for (let s = 1; s <= steps; s++) bump(px + mvx * s / steps, py + mvy * s / steps, 1.3, amt / steps * 2);
      }
    } else f = null;
    if (hovered && t - hoverAt > 1600) { hoverAt = t; wave(hovered, 0.3); }
    if (hovered) busy = true;
    for (let k = waves.length - 1; k >= 0; k--) {
      const w = waves[k]; w.d += 0.14; busy = true;
      const fade = w.a * Math.pow(1 - w.d / w.max, 1.5);
      const c0 = Math.max(0, Math.floor(w.x0 / CELL) - w.max - 1), c1 = Math.min(cols - 1, Math.ceil(w.x1 / CELL) + w.max + 1);
      const r0 = Math.max(0, Math.floor(w.y0 / CELL) - w.max - 1), r1 = Math.min(rows - 1, Math.ceil(w.y1 / CELL) + w.max + 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
        const dx = Math.max(w.x0 - x, 0, x - w.x1), dy = Math.max(w.y0 - y, 0, y - w.y1);
        const dist = Math.hypot(dx, dy) / CELL; if (dist === 0) continue;
        const band = 1 - Math.abs(dist - w.d) / 0.9;
        if (band > 0) { const i = r * cols + c; heat[i] = Math.min(1, heat[i] + fade * band * 0.22); }
      }
      if (w.d >= w.max) waves.splice(k, 1);
    }
    for (let k = ripples.length - 1; k >= 0; k--) {
      const rp = ripples[k]; rp.r += 0.35; busy = true;
      const n = Math.max(12, Math.round(rp.r * 7));
      for (let a = 0; a < n; a++) { const ang = a / n * Math.PI * 2; bump(rp.x + Math.cos(ang) * rp.r * CELL, rp.y + Math.sin(ang) * rp.r * CELL, 0.6, 0.35 * (1 - rp.r / rp.max)); }
      if (rp.r >= rp.max) ripples.splice(k, 1);
    }
    if (draw(t) || busy) requestAnimationFrame(frame); else running = false; // nothing moving: no CPU
  }
  function wake() { if (!reduce && !running && !document.hidden) { running = true; requestAnimationFrame(frame); } }
  addEventListener("pointermove", (e) => { mouse = { x: e.clientX, y: e.clientY }; wake(); }, { passive: true });
  document.addEventListener("pointerout", (e) => { if (!e.relatedTarget) mouse = null; });
  addEventListener("pointerdown", (e) => { if (!reduce) { ripples.push({ x: e.clientX, y: e.clientY, r: 0, max: 6 }); wake(); } }, { passive: true });
  addEventListener("scroll", () => { waves.length = 0; }, { passive: true });
  document.addEventListener("visibilitychange", wake);
  function hoverable(sel) {
    document.querySelectorAll(sel).forEach((node) => {
      const on = () => { hovered = node; hoverAt = performance.now(); wave(node, 0.9); };
      const off = () => { if (hovered === node) hovered = null; };
      node.addEventListener("pointerenter", on); node.addEventListener("pointerleave", off);
      node.addEventListener("focus", () => wave(node, 0.9)); node.addEventListener("blur", off);
    });
  }

  /* ---------- theme: the site follows Kairo or Kairo Void, like the launcher ---------- */
  function setTheme(t) {
    if (!THEMES[t]) return;
    theme = t;
    root.dataset.theme = t;
    $('meta[name="theme-color"]').setAttribute("content", THEMES[t].bg);
    document.querySelectorAll(".switch button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.set === t)));
    document.querySelectorAll(".win-img").forEach((img) => img.classList.toggle("show", img.dataset.ed === t));
    try { localStorage.setItem("kl-theme", t); } catch (e) {}
    draw(0); wake();
  }
  const order = ["kairo", "void"];
  document.querySelectorAll(".switch button").forEach((b) => {
    b.addEventListener("click", () => setTheme(b.dataset.set));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const t = order[(order.indexOf(theme) + 1) % 2];
      setTheme(t); document.querySelector(`.switch [data-set="${t}"]`).focus();
    });
  });
  // a tiny tilt on the hero window
  const win = $("#win");
  if (!reduce && matchMedia("(hover: hover)").matches) {
    win.addEventListener("pointermove", (e) => { const r = win.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; win.style.transform = `perspective(1400px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg)`; });
    win.addEventListener("pointerleave", () => { win.style.transform = ""; });
  }

  /* ---------- what you can play ---------- */
  const PICKS = [
    ["Kairo", "Fabric · Minecraft 26.3", "Kairo", "The everyday Kairo client: frosted glass, a drag-and-drop HUD, PvP mode, cosmetics and emotes. Installed with Fabric, Fabric API and Sodium in one click.", ["Every file checked against the Kairo release", "Keep Kairo updated: Kairo, Fabric API and Sodium move together", "Make as many Kairo installs as you like"], ["26.3"], "kairo"],
    ["Void", "Fabric · Minecraft 26.3", "Kairo Void", "Kairo turned all the way up. Pick it and the whole launcher turns violet, with sharp corners.", ["The same one-click install as Kairo", "A photosensitivity warning before the first install", "Never both Kairo jars in one install"], ["26.3"], "void"],
    ["Vanilla", "Mojang · no mods", "Plain Minecraft", "Stock Minecraft, straight from Mojang's servers. Every release from 1.8 to the newest.", ["Snapshots behind a switch in Settings", "The right Java for each version, from Mojang", "Shared game files, so a second install is quick"], ["26.3", "1.21.x", "1.20.1", "1.16.5", "1.12.2", "1.8.9", "and every release between"], null],
    ["Other", "Build your own", "Your own install", "Pick a loader and a Minecraft version, tick the mods you want, and press Create. Or import a Modrinth modpack instead.", ["Versions read live from each loader", "Sodium, Iris and Lithium from Modrinth, checked against their hashes", "Forge and OptiFine from their own sites, the way they ask"], ["Fabric", "NeoForge", "Forge", "OptiFine", "+ Sodium", "+ Iris", "+ Lithium", ".mrpack"], null],
  ];
  const plist = $("#pickList");
  const ptabs = PICKS.map((p, i) => {
    const b = el("button", "pick-item", p[0]);
    b.type = "button"; b.setAttribute("role", "tab");
    b.addEventListener("click", () => showPick(i, true));
    b.addEventListener("pointerenter", () => { if (matchMedia("(hover: hover)").matches) showPick(i, false); });
    b.addEventListener("keydown", (e) => {
      let j = null;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") j = (i + 1) % PICKS.length;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") j = (i - 1 + PICKS.length) % PICKS.length;
      if (j !== null) { e.preventDefault(); showPick(j, false); ptabs[j].focus(); }
    });
    plist.appendChild(b); return b;
  });
  function showPick(i, clicked) {
    const p = PICKS[i];
    ptabs.forEach((b, k) => { b.setAttribute("aria-selected", String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    $("#pcKick").textContent = p[1]; $("#pcTitle").textContent = p[2]; $("#pcText").textContent = p[3];
    const ticks = $("#pcTicks"); ticks.replaceChildren(...p[4].map((t) => el("li", null, t)));
    const chips = $("#pcChips"); chips.replaceChildren(...p[5].map((t) => el("span", null, t)));
    if (clicked && p[6]) setTheme(p[6]); // like "Match the selected install"
  }

  /* ---------- features ---------- */
  const IC = {
    key: "M14.5 9.5a4.5 4.5 0 1 1-9 0a4.5 4.5 0 0 1 9 0zM13 12.5l7 7M17 16.5l2-2M15 14.5l2-2",
    stack: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
    bolt: "M13 2.5L5 13.5h6l-1 8 8-11h-6z",
    puzzle: "M9 3.5h3a1.5 1.5 0 0 1 3 0h3v5a1.5 1.5 0 0 1 0 3v6.5h-6a1.5 1.5 0 0 0-3 0H3v-6a1.5 1.5 0 0 0 0-3V3.5z",
    box: "M4 7.5l8-4 8 4v9l-8 4-8-4zM4 7.5l8 4 8-4M12 11.5v9",
    folders: "M3 7a1.5 1.5 0 0 1 1.5-1.5H9l2 2h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z",
    cup: "M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 2.5v3M11 2.5v3M14 2.5v3",
    shield: "M12 3l7.5 3v6c0 4.5-3.2 7.8-7.5 9-4.3-1.2-7.5-4.5-7.5-9V6zM8.5 12l2.5 2.5 4.5-5",
    palette: "M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.3-1.6-1.3-2.8 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
    users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.7 2.6 3 5.2",
    layout: "M3.5 4.5h17v15h-17zM3.5 9h17M9 9v10.5",
    log: "M6 3.5h9l4 4v13H6zM14.5 3.5v4.5H19M9 12h7M9 15.5h7M9 8.5h3",
  };
  const FEATS = [
    ["key", "Microsoft sign-in in your browser", "Microsoft's own page, the official way. The launcher never sees your password, and keeps your sign-in in your system's secure storage."],
    ["bolt", "Kairo in one click", "Fabric, Fabric API, Sodium and the right Kairo jar, installed and checked. Keep Kairo updated moves them all together."],
    ["stack", "Every version", "Any release from 1.8 to the newest, read live from Mojang. Snapshots behind a switch."],
    ["puzzle", "Any loader", "Fabric, NeoForge, Forge and OptiFine, each from its official source, the way it asks."],
    ["box", "Mods and modpacks", "Search Modrinth, pick several mods and install them with their dependencies. Import .mrpack modpacks."],
    ["folders", "Separate installs", "Each with its own mods, worlds and settings. Rename, duplicate, change version, delete to the bin."],
    ["palette", "A look for every install", "Its own accent colour, corners and background picture. The Pixel field, Aurora or your own GIF."],
    ["layout", "Home your way", "Four Home layouts: Classic, Centred, Side panel and Bottom bar. Patch notes for the latest Kairo."],
    ["users", "All your accounts", "Several Microsoft accounts, switched from the rail, each pictured by its skin's head."],
    ["cup", "The right Java", "Mojang's own Java runtimes, picked per version by itself. Or point it at your own."],
    ["shield", "Checked and signed", "Every download checked against its official hash. Launcher updates must carry Mordsome's signature."],
    ["log", "Logs and crash help", "The game log, live. When Minecraft crashes, it says why in plain words and opens the report."],
  ];
  const fg = $("#featGrid");
  const NS = "http://www.w3.org/2000/svg";
  FEATS.forEach(([i, t, d]) => {
    const a = el("article", "feat");
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(NS, "path"); path.setAttribute("d", IC[i]); svg.appendChild(path);
    a.append(svg, el("h3", null, t), el("p", null, d));
    fg.appendChild(a);
  });

  /* ---------- screenshots ---------- */
  const stabs = $("#shotTabs"), simg = $("#shotImg");
  const sbtns = SHOTS.map(([id, t], i) => {
    const b = el("button", null, t);
    b.type = "button"; b.setAttribute("role", "tab");
    b.addEventListener("click", () => showShot(i));
    b.addEventListener("keydown", (e) => {
      let j = null;
      if (e.key === "ArrowRight") j = (i + 1) % SHOTS.length;
      if (e.key === "ArrowLeft") j = (i - 1 + SHOTS.length) % SHOTS.length;
      if (j !== null) { e.preventDefault(); showShot(j); sbtns[j].focus(); }
    });
    stabs.appendChild(b); return b;
  });
  function showShot(i) {
    const [id, t, d] = SHOTS[i];
    sbtns.forEach((b, k) => { b.setAttribute("aria-selected", String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    $("#shotCap").textContent = d;
    simg.classList.add("fade");
    const next = new Image();
    next.onload = () => { simg.src = next.src; simg.alt = `Kairo Launcher: ${t}`; simg.classList.remove("fade"); };
    next.src = `img/shots/${id}.png`;
  }
  SHOTS.forEach(([id]) => { const pre = new Image(); pre.src = `img/shots/${id}.png`; });

  /* ---------- download ---------- */
  const OS = {
    win: "M3.5 5.5l7-1v7h-7zM12.5 4.3l8-1.3v8.5h-8zM3.5 12.5h7v7l-7-1zM12.5 12.5h8V21l-8-1.3z",
    linux: "M12 3c-2.3 0-3.5 2-3.5 4.5 0 1.6-.4 2.6-1.6 4.3C5.6 13.6 5 15.3 5 17c0 1.7 1.2 3 3 3h8c1.8 0 3-1.3 3-3 0-1.7-.6-3.4-1.9-5.2-1.2-1.7-1.6-2.7-1.6-4.3C15.5 5 14.3 3 12 3zM10.5 8h.01M13.5 8h.01M10.5 10.5c.9.7 2.1.7 3 0",
    mac: "M15.5 3.5c-1.4.1-2.9 1.1-3.3 2.6 1.4.1 2.9-1 3.3-2.6zM18.5 16.2c-.8 1.9-2.1 4.3-3.8 4.3-1.4 0-1.7-.8-3.2-.8s-1.9.8-3.2.8c-1.8 0-4.3-3.5-4.3-7.3 0-3.2 2-4.9 4-4.9 1.4 0 2.4.9 3.4.9s2.2-1 3.7-.9c.6 0 2.4.2 3.5 1.9-3 1.8-2.4 5.9-.1 6z",
  };
  const DL = [
    ["win", "Windows", "Windows 10 and 11, 64-bit. An installer that keeps the launcher up to date by itself.", `KairoLauncher-Setup-${VERSION}.exe`, `${REPO}/releases/latest`, "main", `v${VERSION}`],
    ["linux", "Linux", "An AppImage for most distributions. Make it executable and run it.", `KairoLauncher-${VERSION}.AppImage`, `${REPO}/releases/latest`, "", `v${VERSION}`],
    ["mac", "macOS", "Not yet. Maybe later.", "", null, "", "Maybe later"],
  ];
  const dg = $("#dlGrid");
  DL.forEach(([id, t, d, file, href, cls, badge]) => {
    const a = el("article", "dl" + (cls ? " " + cls : ""));
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "os"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(NS, "path"); path.setAttribute("d", OS[id]); svg.appendChild(path);
    a.append(svg, el("span", "badge" + (href ? " ok" : ""), badge), el("h3", null, t), el("p", null, d));
    if (file) a.appendChild(el("span", "meta", file));
    if (href) { const b = el("a", "btn btn-main", "Download"); b.href = href; a.appendChild(b); }
    else { const b = el("span", "btn btn-ghost", "Not yet"); b.setAttribute("aria-disabled", "true"); a.appendChild(b); }
    dg.appendChild(a);
  });

  /* ---------- privacy: the same list as Settings → Privacy ---------- */
  const TALK = [
    ["Microsoft, Xbox and Mojang", "To sign you in, download Minecraft and the Java it runs on, and show your skin's head as your account picture."],
    ["Fabric, NeoForge and Forge", "To download mod loaders from their official servers."],
    ["Modrinth", "To find and download mods and modpacks."],
    ["GitHub", "For Kairo, its patch notes and launcher updates."],
    ["optifine.net", "Opened in your browser when you install OptiFine."],
  ];
  const tl = $("#talk");
  TALK.forEach(([t, d]) => { const li = el("li"); li.append(el("b", null, t), el("span", null, d)); tl.appendChild(li); });

  /* ---------- start ---------- */
  setTheme(theme);
  showPick(0, false); showShot(0);
  hoverable(".btn, .switch, .feat, .dl, .shot-tabs button, .talk li, details, .pick-card");
  resize();
  addEventListener("resize", resize);
})();
