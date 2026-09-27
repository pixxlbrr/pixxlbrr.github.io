(function () {
  "use strict";

  /* ============================================================
     CONSTANTS
     ============================================================ */
  const DAY_NAMES_ALL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const DAY_SHORT_ALL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_START_MIN = 8 * 60;   // 08:00
  const DAY_END_MIN = 22 * 60;    // 22:00
  const HOURS = Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 + 1 }, (_, i) => 8 + i);

  const LS_KEY_SETTINGS = "timetable.settings.v1";
  const LS_KEY_STATE = "timetable.state.v1";
  const LS_KEY_CBS = "timetable.cbsSlots.v1";
  const LS_KEY_CUSTOM_PRESETS = "timetable.customPresets.v1";

  // Academic terms, each 8 weeks, used to label the week header ("Term 4, Week 3").
  const TERM_WEEKS = 8;
  const TERMS = [
    { number: 1, start: new Date(2026, 1, 16) },  // 16 Feb 2026
    { number: 2, start: new Date(2026, 3, 27) },  // 27 Apr 2026
    { number: 3, start: new Date(2026, 6, 6) },   // 6 Jul 2026
    { number: 4, start: new Date(2026, 8, 14) }   // 14 Sep 2026
  ];

  // CBS activities are suspended (except Bible Study) for this one week.
  const CBS_BREAK_WEEK_KEY = "2026-10-19";
  const CBS_BREAK_EXEMPT = "Bible Study";

  const DEFAULT_CAT_COLORS = {
    plenary: "#cb7d46",
    lecture: "#cbb329",
    sg: "#b82f2f",
    practical: "#c63773",
    tutorial: "#2a864e",
    cs: "#33a695",
    hospital: "#4192d9",
    other: "#6b7280",
    cbs: "#4368cf",
    medsoc: "#823ac1"
  };

  const PRESETS = {
    light: {bg: "#f1f1f1", surface: "#ffffff", text: "#1b2430", textDim: "#5b6472", accent: "#535672", border: "#d7d8da"},
    paper: {bg: "#fffaf5", surface: "#ffffff", text: "#1b2430", textDim: "#5b6472", accent: "#7f2121", border: "#e4e0dd"},
    milk: {bg: "#fffbf3", surface: "#ffffff", text: "#7d684f", textDim: "#74725d", accent: "#ecdec5", border: "#e4e1dc"},
    sky: {bg: "#e1f2ff", surface: "#ffffff", text: "#071a26", textDim: "#5d6574", accent: "#91cdf7", border: "#c9d9e6"},
    strawberry: {bg: "#ffc2d4", surface: "#ffd0de", text: "#FFFFFF", textDim: "#462f31", accent: "#721218", border: "#e4afc0"},
    taro: {bg: "#e4d6ff", surface: "#dfcfff", text: "#FFFFFF", textDim: "#79648f", accent: "#ab8ef0", border: "#c4b5e6"},
    matcha: {bg: "#92ba88", surface: "#bfdbb8", text: "#f0fff7", textDim: "#485848", accent: "#6d5450", border: "#84a87d"},
    hot_choc: {bg: "#bf9e87", surface: "#b3937d", text: "#f0fff7", textDim: "#4e260e", accent: "#e9b4f6", border: "#ab866f"},
    ocean: {bg: "#081739", surface: "#060e28", text: "#e9ecf2", textDim: "#848baa", accent: "#329fb7", border: "#303c59"},
    tapioca: {bg: "#211730", surface: "#352847", text: "#e0cea8", textDim: "#a487b8", accent: "#cdaa8b", border: "#453c51"},
    sunset: {bg: "#0a021a", surface: "#332d2d", text: "#ffc0a3", textDim: "#a38f83", accent: "#e08c7d", border: "#312a3f"},
    ink: {bg: "#171a21", surface: "#20242e", text: "#e9ecf2", textDim: "#7d8798", accent: "#23d0ce", border: "#3c3f45"},
    midnight: {bg: "#0a0d16", surface: "#25272e", text: "#e9ecf2", textDim: "#aec2d6", accent: "#d1029c", border: "#31343b"},
    matrix: {bg: "#000000", surface: "#151515", text: "#00ff00", textDim: "#ffffff", accent: "#ff0000", border: "#292929"},
    dark: {bg: "#101010", surface: "#222222", text: "#d7d7d7", textDim: "#b8b8b8", accent: "#888dba", border: "#363636"}
  };

  const DEFAULT_SETTINGS = {
    bg: PRESETS.paper.bg,
    surface: PRESETS.paper.surface,
    text: PRESETS.paper.text,
    textDim: PRESETS.paper.textDim,
    accent: PRESETS.paper.accent,
    border: PRESETS.paper.border,
    fontHeading: "'Work Sans'",
    fontBody: "'Lato'",
    fontScale: 100,
    bgImage: null,
    bgImageOpacity: 40,
    timetableOpacity: 100,
    catColors: DEFAULT_CAT_COLORS
  };
  function freshDefaultSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, { catColors: Object.assign({}, DEFAULT_CAT_COLORS) });
  }

  /* ============================================================
     GROUP PARSING  ("A1,2", "B3-7,C3.1", "D1,2,9,A3", "" = everyone)
     ============================================================ */
  function parseGroupsString(str) {
    if (!str || !str.trim()) return { all: true, tokens: [] };
    const tokens = [];
    let currentLetter = null;
    str.split(",").forEach((raw) => {
      const part = raw.trim();
      if (!part) return;
      const m = part.match(/^([A-Da-d])(.*)$/);
      let rest;
      if (m) {
        currentLetter = m[1].toUpperCase();
        rest = m[2].trim();
      } else {
        rest = part;
      }
      if (rest === "") {
        // whole-letter group, e.g. "A" or "B" alone
        tokens.push({ letter: currentLetter, wholeLetter: true });
        return;
      }
      if (rest.includes("-")) {
        const [a, b] = rest.split("-");
        const start = Math.floor(parseFloat(a));
        const end = Math.floor(parseFloat(b));
        if (!isNaN(start) && !isNaN(end)) {
          tokens.push({ letter: currentLetter, start, end });
        }
      } else {
        const num = Math.floor(parseFloat(rest));
        if (!isNaN(num)) {
          tokens.push({ letter: currentLetter, start: num, end: num });
        }
      }
    });
    return { all: false, tokens };
  }

  function eventMatchesGroup(groupsStr, userLetter, userNum) {
    const parsed = parseGroupsString(groupsStr);
    if (parsed.all) return true;
    for (const t of parsed.tokens) {
      if (t.letter !== userLetter) continue;
      if (t.wholeLetter) return true;
      if (userNum >= t.start && userNum <= t.end) return true;
    }
    return false;
  }

  /* ============================================================
     DATE HELPERS  (data dates are "DD/MM/YYYY")
     ============================================================ */
  function parseDMY(str) {
    const [d, m, y] = str.split("/").map(Number);
    return new Date(y, m - 1, d);
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function mondayOf(date) {
    const d = new Date(date);
    const dow = d.getDay(); // 0=Sun..6=Sat
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }
  function fmtDayDate(date) {
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function fmtWeekRange(monday, numDays) {
    const lastDay = addDays(monday, numDays - 1);
    const sameMonth = monday.getMonth() === lastDay.getMonth();
    const optsFull = { day: "numeric", month: "short", year: "numeric" };
    const optsShort = { day: "numeric" };
    if (sameMonth) {
      return `${monday.toLocaleDateString("en-GB", optsShort)} – ${lastDay.toLocaleDateString("en-GB", optsFull)}`;
    }
    return `${monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${lastDay.toLocaleDateString("en-GB", optsFull)}`;
  }
  function timeToMin(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }
  function getTermWeekInfo(monday) {
    for (const t of TERMS) {
      const diffDays = Math.round((monday - t.start) / 86400000);
      if (diffDays >= 0 && diffDays < TERM_WEEKS * 7) {
        return { term: t.number, week: Math.floor(diffDays / 7) + 1 };
      }
    }
    return null;
  }
  function fmtWeekLabel(monday, numDays) {
    const range = fmtWeekRange(monday, numDays);
    const info = getTermWeekInfo(monday);
    const label = info ? `Term ${info.term} Week ${info.week}` : "Break";
    const rangeSpan = `<span class="week-range">  |  ${range}</span>`;
    return `${label} ${rangeSpan}`;
  }

  /* ============================================================
     EVENT CATEGORISATION (colour-coding)
     ============================================================ */
  function categoryOf(type) {
    if (!type) return "other";
    if (/^Plenary/i.test(type)) return "plenary";
    if (/^P\d/i.test(type)) return "practical";
    if (/^CS\d/i.test(type)) return "cs";
    if (/^SG\d/i.test(type)) return "sg";
    if (/^L\d/i.test(type)) return "lecture";
    if (/^T\d/i.test(type)) return "tutorial";
    if (/^Hos/i.test(type)) return "hospital";
    return "other";
  }
  const CATEGORY_LABEL = {
    plenary: "Plenary", 
    lecture: "Lecture", 
    sg: "Scenario group", 
    practical: "Practical", 
    tutorial: "Tutorial", 
    cs: "Clinical skills",
    hospital: "Hospital", 
    other: "Other",
    cbs: "CBS", 
    medsoc: "MedSoc"
  };

  /* ============================================================
     STATE
     ============================================================ */
  const state = {
    group: null,          // { letter, num, label }
    weekStart: null,      // Monday Date
    cbsVisible: {},        // { [activityType]: boolean } — independent toggle per CBS activity
    showMedSoc: false,
    showWeekends: false,  // 5-day vs 7-day view
    cbsSlots: {}           // { [weekKey]: { [activityType]: selectedSlotIndex } } — per-week overrides
  };

  let settings = freshDefaultSettings();
  let customPresets = []; // [{ name, bg, surface, text, accent, fontHeading, fontBody }]

  // Map of CBS activity type -> list of valid weekly slots {day, start, end}, built once from cbsEvents.
  // Insertion order matches the data's order (Bible Study, The Bible Talks, Core Training, ...).
  let cbsGroups = new Map();
  function buildCbsGroups() {
    cbsGroups = new Map();
    (cbsEvents || []).forEach((c) => {
      if (!c.type) return;
      if (!cbsGroups.has(c.type)) cbsGroups.set(c.type, []);
      cbsGroups.get(c.type).push({ day: c.day, start: c.start, end: c.end });
    });
  }
  function weekKeyOf(monday) {
    const y = monday.getFullYear();
    const m = String(monday.getMonth() + 1).padStart(2, "0");
    const d = String(monday.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // Selected slot index for a CBS activity type, scoped to one specific week.
  function getCbsSelectedIndex(type, weekKey) {
    const slots = cbsGroups.get(type);
    if (!slots || !slots.length) return 0;
    const weekMap = state.cbsSlots[weekKey];
    let idx = weekMap ? weekMap[type] : undefined;
    if (typeof idx !== "number" || idx < 0 || idx >= slots.length) idx = 0;
    return idx;
  }
  function setCbsSelectedIndex(type, weekKey, idx) {
    if (!state.cbsSlots[weekKey]) state.cbsSlots[weekKey] = {};
    state.cbsSlots[weekKey][type] = idx;
    saveCbsSlots();
  }

  /* ============================================================
     PERSISTENCE
     ============================================================ */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY_SETTINGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        settings = Object.assign(freshDefaultSettings(), parsed, {
          catColors: Object.assign({}, DEFAULT_CAT_COLORS, parsed.catColors || {})
        });
      }
    } catch (e) { /* ignore corrupt storage */ }
  }
  function saveSettings() {
    try { localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(settings)); return true; } catch (e) { return false; }
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.groupLabel) {
          const m = parsed.groupLabel.match(/^([A-D])(\d{1,2})$/);
          if (m) state.group = { letter: m[1], num: parseInt(m[2], 10), label: parsed.groupLabel };
        }
        state.showMedSoc = !!parsed.showMedSoc;
        state.showWeekends = !!parsed.showWeekends;
        state.cbsVisible = parsed.cbsVisible && typeof parsed.cbsVisible === "object" ? parsed.cbsVisible : {};
      }
    } catch (e) { /* ignore */ }
  }
  function saveState() {
    try {
      localStorage.setItem(LS_KEY_STATE, JSON.stringify({
        groupLabel: state.group ? state.group.label : null,
        showMedSoc: state.showMedSoc,
        showWeekends: state.showWeekends,
        cbsVisible: state.cbsVisible
      }));
    } catch (e) {}
  }
  function loadCbsSlots() {
    try {
      const raw = localStorage.getItem(LS_KEY_CBS);
      if (raw) state.cbsSlots = JSON.parse(raw) || {};
    } catch (e) { /* ignore */ }
  }
  function saveCbsSlots() {
    try { localStorage.setItem(LS_KEY_CBS, JSON.stringify(state.cbsSlots)); } catch (e) {}
  }
  function loadCustomPresets() {
    try {
      const raw = localStorage.getItem(LS_KEY_CUSTOM_PRESETS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) customPresets = parsed;
      }
    } catch (e) { /* ignore corrupt storage */ }
  }
  function saveCustomPresets() {
    try { localStorage.setItem(LS_KEY_CUSTOM_PRESETS, JSON.stringify(customPresets)); } catch (e) {}
  }

  /* ============================================================
     APPLY THEME
     ============================================================ */
  function isValidHex(v) {
    return /^#[0-9a-fA-F]{6}$/.test(v);
  }
  function normalizeHex(v) {
    let s = (v || "").trim();
    if (s && s[0] !== "#") s = "#" + s;
    return s;
  }

  function applyTheme() {
    const root = document.documentElement.style;
    root.setProperty("--bg", settings.bg);
    root.setProperty("--surface", settings.surface);
    root.setProperty("--text", settings.text);
    root.setProperty("--text-dim", settings.textDim);
    root.setProperty("--accent", settings.accent);
    root.setProperty("--border", settings.border);
    root.setProperty("--font-heading", settings.fontHeading);
    root.setProperty("--font-body", settings.fontBody);
    root.setProperty("--font-scale", (settings.fontScale / 100).toString());
    root.setProperty("--bg-image-opacity", (settings.bgImageOpacity / 100).toString());
    root.setProperty("--timetable-opacity", (settings.timetableOpacity / 100).toString());

    // background image layer + its preview thumbnail in the settings panel
    const bgLayer = $("#bg-image-layer");
    const bgPreview = $("#bg-image-preview");
    const bgRemoveBtn = $("#bg-image-remove");
    if (bgLayer) bgLayer.style.backgroundImage = settings.bgImage ? `url("${settings.bgImage}")` : "none";
    if (bgPreview) {
      bgPreview.style.backgroundImage = settings.bgImage ? `url("${settings.bgImage}")` : "none";
      bgPreview.hidden = !settings.bgImage;
    }
    if (bgRemoveBtn) bgRemoveBtn.hidden = !settings.bgImage;
    $("#bg-image-opacity").value = settings.bgImageOpacity;
    $("#timetable-opacity").value = settings.timetableOpacity;
    $("#pct-bg-image-opacity").value = settings.bgImageOpacity;
    $("#pct-timetable-opacity").value = settings.timetableOpacity;
    $("#pct-font-scale").value = settings.fontScale;

    Object.keys(settings.catColors).forEach((cat) => {
      root.setProperty(`--cat-${cat}`, settings.catColors[cat]);
    });

    // sync control inputs
    $("#color-bg").value = settings.bg;
    $("#color-surface").value = settings.surface;
    $("#color-text").value = settings.text;
    $("#color-text-dim").value = settings.textDim;
    $("#color-accent").value = settings.accent;
    $("#color-border").value = settings.border;
    $("#hex-bg").value = settings.bg;
    $("#hex-surface").value = settings.surface;
    $("#hex-text").value = settings.text;
    $("#hex-text-dim").value = settings.textDim;
    $("#hex-accent").value = settings.accent;
    $("#hex-border").value = settings.border;
    $("#font-heading").value = settings.fontHeading;
    $("#font-body").value = settings.fontBody;
    $("#font-scale").value = settings.fontScale;
    document.querySelectorAll(".pct-input").forEach((input) => input.classList.remove("is-invalid"));
    document.querySelectorAll("#cat-colors input[type=color]").forEach((input) => {
      const cat = input.dataset.cat;
      if (cat && settings.catColors[cat]) input.value = settings.catColors[cat];
    });
    document.querySelectorAll("#cat-colors .hex-input").forEach((input) => {
      const cat = input.dataset.cat;
      if (cat && settings.catColors[cat]) input.value = settings.catColors[cat];
    });
  }

  /* ============================================================
     BUILD EVENT-COLOUR CONTROLS (one per category, in settings panel)
     ============================================================ */
  function buildCatColorControls() {
    const container = $("#cat-colors");
    container.innerHTML = "";
    Object.keys(DEFAULT_CAT_COLORS).forEach((cat) => {
      const row = el("label", "color-row");
      row.appendChild(el("span", null, CATEGORY_LABEL[cat] || cat));
      const controls = el("span", "color-controls");
      const current = settings.catColors[cat] || DEFAULT_CAT_COLORS[cat];

      const hexInput = document.createElement("input");
      hexInput.type = "text";
      hexInput.className = "hex-input";
      hexInput.maxLength = 7;
      hexInput.spellcheck = false;
      hexInput.dataset.cat = cat;
      hexInput.value = current;
      hexInput.setAttribute("aria-label", `${CATEGORY_LABEL[cat] || cat} hex code`);

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.dataset.cat = cat;
      colorInput.value = current;

      colorInput.addEventListener("input", (e) => {
        settings.catColors[cat] = e.target.value;
        hexInput.value = e.target.value;
        hexInput.classList.remove("is-invalid");
        applyTheme();
        saveSettings();
      });
      hexInput.addEventListener("input", (e) => {
        const v = normalizeHex(e.target.value);
        if (isValidHex(v)) {
          hexInput.classList.remove("is-invalid");
          settings.catColors[cat] = v;
          colorInput.value = v;
          applyTheme();
          saveSettings();
        } else {
          hexInput.classList.add("is-invalid");
        }
      });
      hexInput.addEventListener("blur", () => {
        hexInput.classList.remove("is-invalid");
        hexInput.value = settings.catColors[cat] || DEFAULT_CAT_COLORS[cat];
      });

      controls.appendChild(hexInput);
      controls.appendChild(colorInput);
      row.appendChild(controls);
      container.appendChild(row);
    });
  }

  /* ============================================================
     CUSTOM (USER-SAVED) THEME PRESETS
     ============================================================ */
  function buildCustomPresetSwatches() {
    const row = $("#preset-row");
    row.querySelectorAll(".preset-swatch.is-custom").forEach((n) => n.remove());
    customPresets.forEach((p, idx) => {
      const btn = el("button", "preset-swatch is-custom");
      btn.type = "button";
      btn.style.setProperty("--sw1", p.bg);
      btn.style.setProperty("--sw2", p.accent);
      btn.style.setProperty("--sw3", p.text);
      btn.dataset.customIndex = String(idx);
      btn.title = p.name;
      btn.appendChild(document.createTextNode(p.name));
      const del = el("span", "preset-swatch-delete", "&times;");
      del.title = "Delete this preset";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        customPresets.splice(idx, 1);
        saveCustomPresets();
        buildCustomPresetSwatches();
      });
      btn.appendChild(del);
      btn.addEventListener("click", () => {
        Object.assign(settings, {
          bg: p.bg, surface: p.surface, text: p.text,
          textDim: p.textDim || DEFAULT_SETTINGS.textDim,
          accent: p.accent, border: p.border || DEFAULT_SETTINGS.border,
          fontHeading: p.fontHeading, fontBody: p.fontBody
        });
        applyTheme();
        saveSettings();
      });
      row.appendChild(btn);
    });
  }

  function saveCurrentAsPreset(rawName) {
    let name = (rawName || "").trim() || "My theme";
    // keep names unique so swatches (and storage entries) don't collide
    let finalName = name;
    let n = 2;
    while (customPresets.some((p) => p.name === finalName)) {
      finalName = `${name} ${n}`;
      n++;
    }
    customPresets.push({
      name: finalName,
      bg: settings.bg,
      surface: settings.surface,
      text: settings.text,
      textDim: settings.textDim,
      accent: settings.accent,
      border: settings.border,
      fontHeading: settings.fontHeading,
      fontBody: settings.fontBody
    });
    saveCustomPresets();
    buildCustomPresetSwatches();
  }


  const VOTD_URL = "https://www.bible.com/verse-of-the-day";
  // bible.com itself doesn't send CORS headers for its normal pages, so a
  // direct cross-origin fetch from the browser will often be blocked. This
  // read-only public proxy is tried as a fallback so the live verse can
  // still be reached; if both fail, we fall back to a small static verse
  // bank below (picked at random, not by date — bible.com's page is what
  // handles "today's" verse, our code doesn't need to know the date at all).
  const VOTD_PROXY_URL = "https://api.allorigins.win/raw?url=";
  // The same quote-card styling is reused further down the page for the
  // "This Week's Bible Verses" list (past days), so a class-based selector
  // alone can end up grabbing yesterday's verse instead of today's. The
  // page's own <meta property="og:description"> tag is more reliable: it's
  // set once per page load and always describes *today's* verse, formatted
  // as "Book C:V verse text...". We fall back to the card selector only if
  // that meta tag is ever missing.
  const VOTD_SELECTOR = 'div[class*="border-l-large"][class*="mbe-3"][class*="pis-2"]';

  const VOTD_FALLBACK = [
    { text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.", ref: "John 3:16 (KJV)" },
    { text: "Trust in the LORD with all thine heart; and lean not unto thine own understanding.", ref: "Proverbs 3:5 (KJV)" },
    { text: "I can do all things through Christ which strengtheneth me.", ref: "Philippians 4:13 (KJV)" },
    { text: "Be not wise in thine own eyes: fear the LORD, and depart from evil.", ref: "Proverbs 3:7 (KJV)" },
    { text: "The LORD is my shepherd; I shall not want.", ref: "Psalm 23:1 (KJV)" },
    { text: "Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.", ref: "Joshua 1:9 (KJV)" },
    { text: "Come unto me, all ye that labour and are heavy laden, and I will give you rest.", ref: "Matthew 11:28 (KJV)" },
    { text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.", ref: "Romans 8:28 (KJV)" },
    { text: "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.", ref: "Jeremiah 29:11 (KJV)" },
    { text: "Casting all your care upon him; for he careth for you.", ref: "1 Peter 5:7 (KJV)" },
    { text: "Rejoice in the Lord alway: and again I say, Rejoice.", ref: "Philippians 4:4 (KJV)" },
    { text: "This is the day which the LORD hath made; we will rejoice and be glad in it.", ref: "Psalm 118:24 (KJV)" },
    { text: "Delight thyself also in the LORD: and he shall give thee the desires of thine heart.", ref: "Psalm 37:4 (KJV)" },
    { text: "Be still, and know that I am God.", ref: "Psalm 46:10 (KJV)" }
  ];

  // Book names are 1-3 words, optionally led by a number ("1 Peter"), always
  // followed by "C:V" or "C:V-V". Matches both the meta description's
  // "Book C:V text..." shape and a trailing "...text Book C:V (VER)" shape.
  const VOTD_REF_CORE = '[1-3]?\\s?[A-Z][a-zA-Z]*(?:\\s[A-Za-z]+){0,2}\\s\\d{1,3}:\\d{1,3}(?:[-–]\\d{1,3})?';
  const VOTD_LEADING_REF_RE = new RegExp(`^(${VOTD_REF_CORE})\\s+(.+)$`);
  const VOTD_TRAILING_REF_RE = new RegExp(`(${VOTD_REF_CORE}\\s\\([A-Za-z0-9]+\\))\\s*$`);

  function splitVerseAndReference(raw) {
    const trimmed = raw.trim();
    const lead = trimmed.match(VOTD_LEADING_REF_RE);
    if (lead) return { text: lead[2].trim(), ref: lead[1].trim() };
    const trail = trimmed.match(VOTD_TRAILING_REF_RE);
    if (trail) return { text: trimmed.slice(0, trail.index).trim(), ref: trail[1].trim() };
    return { text: trimmed, ref: "" };
  }

  function extractVerseFromHTML(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Primary: the meta description always describes today's verse only.
    const meta = doc.querySelector('meta[property="og:description"]') || doc.querySelector('meta[name="twitter:description"]');
    const metaContent = meta && meta.getAttribute("content");
    if (metaContent && metaContent.trim()) return metaContent.trim();

    // Fallback: the styled quote card (also used for past days further down
    // the page, so this is a less reliable second choice).
    const node = doc.querySelector(VOTD_SELECTOR);
    if (node) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return null;
  }

  async function fetchVerseFrom(url) {
    // Cache-bust so an intermediary proxy/CDN can't keep serving yesterday's
    // snapshot of the page.
    const bustUrl = url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    const res = await fetch(bustUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("verse request failed");
    const html = await res.text();
    const verse = extractVerseFromHTML(html);
    if (!verse) throw new Error("verse element not found");
    return verse;
  }

  async function loadVerseOfDay() {
    const textEl = $("#votd-text");
    const refEl = $("#votd-ref");
    if (!textEl || !refEl) return;

    // Simple, direct fetch of bible.com's own verse-of-the-day page — the
    // site updates this itself each day, so there's no date logic here.
    try {
      const { text, ref } = splitVerseAndReference(await fetchVerseFrom(VOTD_URL));
      textEl.textContent = text;
      refEl.textContent = ref;
      return;
    } catch (e) { /* likely blocked by CORS — try the proxy below */ }

    try {
      const proxied = VOTD_PROXY_URL + encodeURIComponent(VOTD_URL + "?_=" + Date.now());
      const { text, ref } = splitVerseAndReference(await fetchVerseFrom(proxied));
      textEl.textContent = text;
      refEl.textContent = ref;
      return;
    } catch (e) { /* bible.com unreachable — fall back to a static verse */ }

    const v = VOTD_FALLBACK[Math.floor(Math.random() * VOTD_FALLBACK.length)];
    textEl.textContent = v.text;
    refEl.textContent = v.ref;
  }

  /* ============================================================
     DOM HELPERS
     ============================================================ */
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* ============================================================
     SCENARIO GROUP TEXT INPUT
     ============================================================ */
  const SCENARIO_RE = /^([A-Da-d])\s*(\d{1,2})$/;

  function initScenarioInput() {
    const input = $("#scenario-input");
    if (state.group) input.value = state.group.label;
  }

  // Parses the raw text field value into a group, updating state + the
  // input's valid/invalid styling. Returns true if state.group changed.
  function applyScenarioInputValue(raw) {
    const trimmed = raw.trim();
    const input = $("#scenario-input");

    if (!trimmed) {
      input.classList.remove("is-invalid");
      if (state.group !== null) { state.group = null; return true; }
      return false;
    }

    const m = trimmed.match(SCENARIO_RE);
    if (!m) {
      // Still being typed / not a recognised group yet — don't wipe out
      // a previously valid selection, just flag the field as incomplete.
      input.classList.add("is-invalid");
      return false;
    }

    input.classList.remove("is-invalid");
    const label = `${m[1].toUpperCase()}${parseInt(m[2], 10)}`;
    const changed = !state.group || state.group.label !== label;
    state.group = { letter: m[1].toUpperCase(), num: parseInt(m[2], 10), label };
    return changed;
  }

  /* ============================================================
     BUILD PER-ACTIVITY CBS CHECKBOXES
     ============================================================ */
  function buildCbsToggles() {
    const container = $("#cbs-toggles");
    container.querySelectorAll(".toggle-chip").forEach((n) => n.remove());
    cbsGroups.forEach((slots, type) => {
      const label = el("label", "toggle-chip");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.cbsType = type;
      input.checked = !!state.cbsVisible[type];
      label.appendChild(input);
      const box = el("span", "toggle-box");
      box.style.setProperty("--dot", "var(--cat-cbs)");
      label.appendChild(box);
      label.appendChild(document.createTextNode(type));
      container.appendChild(label);
    });
  }

  /* ============================================================
     DEFAULT WEEK TO SHOW ON LOAD
     ============================================================ */
  function initCurrentWeek() {
    state.weekStart = mondayOf(new Date());
  }

  /* ============================================================
     GATHER EVENTS FOR CURRENT WEEK / DAY
     ============================================================ */
  function getEventsForDay(dayDate, dayName, weekKey) {
    const items = [];

    // -- course classes, filtered by scenario group --
    if (state.group) {
      (classes || []).forEach((c) => {
        if (!c.date) return;
        const cd = parseDMY(c.date);
        if (!sameDay(cd, dayDate)) return;
        if (!eventMatchesGroup(c.groups, state.group.letter, state.group.num)) return;
        items.push({
          kind: "class",
          category: categoryOf(c.type),
          title: c.title || c.type || "Class",
          sub: c.courseName || "",
          type: c.type || "",
          start: c.start, end: c.end,
          teachers: c.teachers || "",
          location: c.location || "",
          groups: c.groups || ""
        });
      });
    }

    // -- CBS recurring weekly events: only the currently-selected slot per activity type,
    //    only for activities the user has individually ticked on, and honouring the break week --
    cbsGroups.forEach((slots, type) => {
      if (!state.cbsVisible[type]) return;
      if (weekKey === CBS_BREAK_WEEK_KEY && type !== CBS_BREAK_EXEMPT) return;
      const idx = getCbsSelectedIndex(type, weekKey);
      const slot = slots[idx];
      if (!slot || slot.day !== dayName) return;
      items.push({
        kind: "cbs",
        category: "cbs",
        title: type,
        sub: "CBS (weekly) \u2014 drag to move",
        cbsType: type,
        weekKey: weekKey,
        start: slot.start, end: slot.end,
        teachers: "", location: "", groups: ""
      });
    });

    // -- MedSoc dated events --
    if (state.showMedSoc) {
      (medsocEvents || []).forEach((c) => {
        if (!c.date) return;
        const cd = parseDMY(c.date);
        if (!sameDay(cd, dayDate)) return;
        items.push({
          kind: "medsoc",
          category: "medsoc",
          title: c.title || "MedSoc event",
          sub: "MedSoc",
          start: c.start, end: c.end,
          teachers: "", location: c.location || "", link: c.link || "",
          groups: ""
        });
      });
    }

    return items;
  }

  /* ============================================================
     LAYOUT OVERLAPPING EVENTS WITHIN A DAY COLUMN
     ============================================================ */
  function layoutColumn(items) {
    // sort by start time
    const withTimes = items.map((it) => ({
      ...it,
      s: timeToMin(it.start),
      e: timeToMin(it.end)
    })).sort((a, b) => a.s - b.s || a.e - b.e);

    // simple cluster + column packing for overlaps
    const clusters = [];
    let cluster = [];
    let clusterEnd = -Infinity;
    withTimes.forEach((it) => {
      if (cluster.length && it.s >= clusterEnd) {
        clusters.push(cluster);
        cluster = [];
        clusterEnd = -Infinity;
      }
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.e);
    });
    if (cluster.length) clusters.push(cluster);

    const placed = [];
    clusters.forEach((clus) => {
      const cols = []; // each col: last end time
      clus.forEach((it) => {
        let colIdx = cols.findIndex((endT) => it.s >= endT);
        if (colIdx === -1) { colIdx = cols.length; cols.push(it.e); }
        else { cols[colIdx] = it.e; }
        it._col = colIdx;
      });
      const totalCols = cols.length;
      clus.forEach((it) => {
        placed.push({ ...it, _cols: totalCols });
      });
    });
    return placed;
  }

  /* ============================================================
     RENDER TIMETABLE
     ============================================================ */
  function render() {
    const empty = $("#empty-state");
    const wrap = $("#timetable-wrap");
    const legend = $("#legend");

    if (!state.group) {
      empty.hidden = false;
      wrap.hidden = true;
      legend.hidden = true;
      return;
    }
    empty.hidden = true;
    wrap.hidden = false;
    legend.hidden = false;

    const numDays = state.showWeekends ? 7 : 5;
    const dayNames = DAY_NAMES_ALL.slice(0, numDays);
    const dayShort = DAY_SHORT_ALL.slice(0, numDays);
    const weekKey = weekKeyOf(state.weekStart);

    $("#week-label").innerHTML = fmtWeekLabel(state.weekStart, numDays);

    const tt = $("#timetable");
    tt.innerHTML = "";
    tt.style.gridTemplateColumns = `56px repeat(${numDays}, minmax(120px, 1fr))`;
    tt.style.gridTemplateRows = `56px 1fr`;
    tt.style.minWidth = `${56 + numDays * 130}px`;

    const totalMin = DAY_END_MIN - DAY_START_MIN;
    const numHours = HOURS.length - 1;
    const rowHeight = 64; // px per hour, sets overall grid body height
    const bodyHeight = numHours * rowHeight;

    // corner cell
    tt.appendChild(el("div", "tt-corner"));

    const today = new Date();

    // day headers
    for (let i = 0; i < numDays; i++) {
      const dayDate = addDays(state.weekStart, i);
      const head = el("div", "tt-daycol-head" + (sameDay(dayDate, today) ? " is-today" : ""));
      head.appendChild(el("div", "dow", dayShort[i]));
      head.appendChild(el("div", "ddate", fmtDayDate(dayDate)));
      tt.appendChild(head);
    }

    // hour-label column: same fixed pixel height and same top:% math as the
    // track below, so labels line up exactly with the hour gridlines.
    const hoursCol = el("div", "tt-hours");
    hoursCol.style.height = `${bodyHeight}px`;
    HOURS.forEach((h, idx) => {
      if (idx === numHours) return; // skip label on the closing bottom line
      const label = el("div", "tt-hourlabel", `${h}:00`);
      label.style.top = `calc(${(idx / numHours) * 100}% + 0.6rem`;
      hoursCol.appendChild(label);
    });
    tt.appendChild(hoursCol);

    // track container spans the whole body row, same fixed height as hoursCol
    const track = el("div", "tt-track");
    track.style.gridColumn = `2 / ${numDays + 2}`;
    track.style.gridTemplateColumns = `repeat(${numDays}, 1fr)`;
    track.style.height = `${bodyHeight}px`;

    const dayColumnEls = [];
    let activeGhosts = [];

    function clearCbsGhosts() {
      activeGhosts.forEach((g) => g.remove());
      activeGhosts = [];
    }
    function showCbsGhosts(type) {
      clearCbsGhosts();
      const slots = cbsGroups.get(type) || [];
      const selectedIdx = getCbsSelectedIndex(type, weekKey);
      slots.forEach((slot, idx) => {
        if (idx === selectedIdx) return;
        const dIdx = dayNames.indexOf(slot.day);
        if (dIdx === -1) return; // not visible in the current view
        const col = dayColumnEls[dIdx];
        if (!col) return;
        const s = timeToMin(slot.start), e = timeToMin(slot.end);
        const top = ((s - DAY_START_MIN) / totalMin) * 100;
        const height = Math.max(((e - s) / totalMin) * 100, 2.2);

        const ghost = el("div", "tt-event-ghost");
        ghost.style.top = `${top}%`;
        ghost.style.height = `${height}%`;
        ghost.appendChild(el("div", "ghost-label", "Drop here"));
        ghost.appendChild(el("div", "ghost-time", `${slot.start}\u2013${slot.end}`));
        ghost.addEventListener("dragover", (ev) => { ev.preventDefault(); ghost.classList.add("drag-over"); });
        ghost.addEventListener("dragleave", () => ghost.classList.remove("drag-over"));
        ghost.addEventListener("drop", (ev) => {
          ev.preventDefault();
          setCbsSelectedIndex(type, weekKey, idx);
          render();
        });
        col.appendChild(ghost);
        activeGhosts.push(ghost);
      });
    }

    for (let i = 0; i < numDays; i++) {
      const dayDate = addDays(state.weekStart, i);
      const dayName = dayNames[i];
      const col = el("div", "tt-daycol");
      dayColumnEls.push(col);

      // hour gridlines
      HOURS.forEach((h, idx) => {
        const line = el("div", "tt-hourline");
        line.style.top = `${(idx / numHours) * 100}%`;
        col.appendChild(line);
      });

      const items = getEventsForDay(dayDate, dayName, weekKey);
      const placed = layoutColumn(items);

      placed.forEach((it) => {
        const s = Math.max(it.s, DAY_START_MIN);
        const e = Math.min(it.e, DAY_END_MIN);
        const top = ((s - DAY_START_MIN) / totalMin) * 100;
        const height = Math.max(((e - s) / totalMin) * 100, 2.2);
        const widthPct = 100 / it._cols;
        const leftPct = it._col * widthPct;

        const card = el("div", "tt-event" + (it.kind === "cbs" ? " tt-event-draggable" : ""));
        card.style.top = `${top}%`;
        card.style.height = `${height}%`;
        card.style.left = `calc(${leftPct}% + 3px)`;
        card.style.width = `calc(${widthPct}% - 6px)`;
        card.style.setProperty("--cat-color", `var(--cat-${it.category})`);
        card.tabIndex = 0;
        card.setAttribute("role", "button");

        if (it.kind === "class" && it.type) {
          const meta = el("div", "ev-meta");
          meta.appendChild(el("span", "ev-type", escapeHTML(it.type)));
          if (it.location) meta.appendChild(el("span", "ev-loc-inline", escapeHTML(it.location)));
          card.appendChild(meta);
        } else if (it.location) {
          card.appendChild(el("div", "ev-meta", `<span class="ev-loc-inline">${escapeHTML(it.location)}</span>`));
        }
        card.appendChild(el("div", "ev-title", escapeHTML(it.title)));
        card.appendChild(el("div", "ev-time", `${it.start}–${it.end}`));
        if (it.kind === "cbs") card.appendChild(el("div", "ev-drag-hint", "\u2837 drag to move"));

        card.addEventListener("click", () => openPopover(it));
        card.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openPopover(it); }
        });

        if (it.kind === "cbs" && it.cbsType) {
          card.draggable = true;
          card.addEventListener("dragstart", (ev) => {
            ev.dataTransfer.setData("text/plain", it.cbsType);
            ev.dataTransfer.effectAllowed = "move";
            card.classList.add("dragging");
            showCbsGhosts(it.cbsType);
          });
          card.addEventListener("dragend", () => {
            card.classList.remove("dragging");
            clearCbsGhosts();
          });
        }

        col.appendChild(card);
      });

      track.appendChild(col);
    }

    tt.appendChild(track);

    renderLegend();
  }

  function renderLegend() {
    const legend = $("#legend");
    legend.innerHTML = "";
    const cats = ["plenary", "lecture", "sg", "practical", "tutorial", "cs", "hospital", "other"];
    const anyCbsVisible = Object.keys(state.cbsVisible).some((t) => state.cbsVisible[t]);
    if (anyCbsVisible) cats.push("cbs");
    if (state.showMedSoc) cats.push("medsoc");
    cats.forEach((cat) => {
      const item = el("div", "legend-item");
      const dot = el("span", "legend-dot");
      dot.style.background = `var(--cat-${cat})`;
      item.appendChild(dot);
      item.appendChild(document.createTextNode(CATEGORY_LABEL[cat]));
      legend.appendChild(item);
    });
  }

  function escapeHTML(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  /* ============================================================
     EVENT POPOVER
     ============================================================ */
  function openPopover(it) {
    const body = $("#popover-body");
    body.innerHTML = "";
    const catSpan = el("span", "pv-cat", CATEGORY_LABEL[it.category] || "Event");
    catSpan.style.setProperty("--cat-color", `var(--cat-${it.category})`);
    body.appendChild(catSpan);
    body.appendChild(el("h3", null, escapeHTML(it.title)));
    if (it.sub) body.appendChild(el("div", "pv-course", escapeHTML(it.sub)));

    const dl = el("dl");
    function row(label, value) {
      if (!value) return;
      dl.appendChild(el("dt", null, label));
      dl.appendChild(el("dd", null, value));
    }
    row("Time", `${it.start}–${it.end}`);
    row("Teachers", it.teachers ? escapeHTML(it.teachers) : "");
    row("Location", it.location ? escapeHTML(it.location) : "");
    row("Groups", it.groups ? escapeHTML(it.groups) : "");
    if (it.link) {
      dl.appendChild(el("dt", null, "Link"));
      const dd = el("dd");
      const a = el("a", null, "More info");
      a.href = it.link; a.target = "_blank"; a.rel = "noopener noreferrer";
      dd.appendChild(a);
      dl.appendChild(dd);
    }
    body.appendChild(dl);

    if (it.kind === "cbs" && it.cbsType) {
      const slots = cbsGroups.get(it.cbsType) || [];
      if (slots.length > 1) {
        const moveWrap = el("div", "pv-move");
        moveWrap.appendChild(el("div", "pv-move-label", "Move to another time (this week only)"));
        const optRow = el("div", "pv-move-options");
        const currentIdx = getCbsSelectedIndex(it.cbsType, it.weekKey);
        slots.forEach((slot, idx) => {
          const isCurrent = idx === currentIdx;
          const btn = el("button", "pv-move-btn" + (isCurrent ? " is-current" : ""),
            `${slot.day.slice(0, 3)} ${slot.start}\u2013${slot.end}`);
          btn.type = "button";
          btn.disabled = isCurrent;
          btn.addEventListener("click", () => {
            setCbsSelectedIndex(it.cbsType, it.weekKey, idx);
            closePopover();
            render();
          });
          optRow.appendChild(btn);
        });
        moveWrap.appendChild(optRow);
        body.appendChild(moveWrap);
      }
    }

    $("#event-popover").hidden = false;
    $("#popover-scrim").hidden = false;
  }
  function closePopover() {
    $("#event-popover").hidden = true;
    $("#popover-scrim").hidden = true;
  }

  /* ============================================================
     WIRE UP CONTROLS
     ============================================================ */
  function wireControls() {
    $("#scenario-input").addEventListener("input", (e) => {
      const changed = applyScenarioInputValue(e.target.value);
      if (changed) { saveState(); render(); }
    });
    $("#scenario-input").addEventListener("blur", (e) => {
      // Tidy up the displayed text to the normalised form (e.g. "a1" -> "A1").
      if (state.group) e.target.value = state.group.label;
    });

    $("#prev-week").addEventListener("click", () => {
      state.weekStart = addDays(state.weekStart, -7);
      render();
    });
    $("#next-week").addEventListener("click", () => {
      state.weekStart = addDays(state.weekStart, 7);
      render();
    });
    $("#today-week").addEventListener("click", () => {
      state.weekStart = mondayOf(new Date());
      render();
    });

    $("#toggle-medsoc").addEventListener("change", (e) => {
      state.showMedSoc = e.target.checked;
      saveState();
      render();
    });
    $("#toggle-weekend").addEventListener("change", (e) => {
      state.showWeekends = e.target.checked;
      saveState();
      render();
    });
    document.querySelectorAll("#cbs-toggles input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        state.cbsVisible[e.target.dataset.cbsType] = e.target.checked;
        saveState();
        render();
      });
    });

    // settings panel open/close
    const panel = $("#settings-panel");
    const scrim = $("#settings-scrim");
    let panelCloseTimer = null;
    function openPanel() {
      clearTimeout(panelCloseTimer);
      panel.hidden = false;
      scrim.hidden = false;
      // force a reflow so the transform transition actually triggers,
      // rather than the browser batching this with the hidden-attr change
      void panel.offsetWidth;
      panel.classList.add("is-open");
      document.body.classList.add("settings-open");
      panel.setAttribute("aria-hidden", "false");
      $("#settings-toggle").setAttribute("aria-expanded", "true");
    }
    function closePanel() {
      panel.classList.remove("is-open");
      document.body.classList.remove("settings-open");
      scrim.hidden = true;
      panel.setAttribute("aria-hidden", "true");
      $("#settings-toggle").setAttribute("aria-expanded", "false");
      // keep the panel in the layout until the slide-out finishes so it
      // doesn't just vanish mid-animation
      clearTimeout(panelCloseTimer);
      panelCloseTimer = setTimeout(() => { panel.hidden = true; }, 350);
    }
    $("#settings-toggle").addEventListener("click", openPanel);
    $("#settings-close").addEventListener("click", closePanel);
    scrim.addEventListener("click", closePanel);

    // colour pickers
    function wireColorField(colorId, hexId, key) {
      const colorInput = $(colorId);
      const hexInput = $(hexId);
      colorInput.addEventListener("input", (e) => {
        settings[key] = e.target.value;
        hexInput.value = e.target.value;
        hexInput.classList.remove("is-invalid");
        applyTheme();
        saveSettings();
      });
      hexInput.addEventListener("input", (e) => {
        const v = normalizeHex(e.target.value);
        if (isValidHex(v)) {
          hexInput.classList.remove("is-invalid");
          settings[key] = v;
          colorInput.value = v;
          applyTheme();
          saveSettings();
        } else {
          hexInput.classList.add("is-invalid");
        }
      });
      hexInput.addEventListener("blur", () => {
        hexInput.classList.remove("is-invalid");
        hexInput.value = settings[key];
      });
    }
    wireColorField("#color-bg", "#hex-bg", "bg");
    wireColorField("#color-surface", "#hex-surface", "surface");
    wireColorField("#color-text", "#hex-text", "text");
    wireColorField("#color-text-dim", "#hex-text-dim", "textDim");
    wireColorField("#color-accent", "#hex-accent", "accent");
    wireColorField("#color-border", "#hex-border", "border");

    // fonts
    $("#font-heading").addEventListener("change", (e) => { settings.fontHeading = e.target.value; applyTheme(); saveSettings(); });
    $("#font-body").addEventListener("change", (e) => { settings.fontBody = e.target.value; applyTheme(); saveSettings(); });

    // range sliders paired with a typeable percentage field (font size,
    // background image opacity, timetable opacity)
    function wireRangeField(rangeId, pctId, key, min, max) {
      const rangeInput = $(rangeId);
      const pctInput = $(pctId);

      function commit(v) {
        settings[key] = v;
        rangeInput.value = v;
        pctInput.value = v;
        pctInput.classList.remove("is-invalid");
        applyTheme();
        saveSettings();
      }

      rangeInput.addEventListener("input", (e) => {
        commit(parseInt(e.target.value, 10));
      });

      // only allow digits while typing
      pctInput.addEventListener("input", (e) => {
        const digits = e.target.value.replace(/[^\d]/g, "");
        if (digits !== e.target.value) e.target.value = digits;
      });

      function applyPctInput() {
        const raw = pctInput.value.trim();
        if (raw === "") { pctInput.classList.add("is-invalid"); return; }
        let v = parseInt(raw, 10);
        if (isNaN(v)) { pctInput.classList.add("is-invalid"); return; }
        v = Math.min(max, Math.max(min, v));
        commit(v);
      }
      pctInput.addEventListener("change", applyPctInput);
      pctInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); applyPctInput(); pctInput.blur(); }
      });
      pctInput.addEventListener("blur", () => {
        pctInput.classList.remove("is-invalid");
        pctInput.value = settings[key];
      });
    }
    wireRangeField("#font-scale", "#pct-font-scale", "fontScale", 85, 120);
    wireRangeField("#bg-image-opacity", "#pct-bg-image-opacity", "bgImageOpacity", 0, 100);
    wireRangeField("#timetable-opacity", "#pct-timetable-opacity", "timetableOpacity", 20, 100);

    // background image upload / removal / opacity
    function loadBgImageFile(file) {
      if (!file || !file.type || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        settings.bgImage = reader.result;
        applyTheme();
        if (!saveSettings()) {
          alert("That image was too large to save for next time, but it'll stay applied for this session.");
        }
      };
      reader.readAsDataURL(file);
    }
    $("#bg-image-input").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      loadBgImageFile(file);
      e.target.value = "";
    });
    // drag-and-drop an image straight onto the upload button
    const bgUploadBtn = $(".bg-image-upload-btn");
    ["dragenter", "dragover"].forEach((evt) => {
      bgUploadBtn.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        bgUploadBtn.classList.add("is-dragover");
      });
    });
    ["dragleave", "dragend"].forEach((evt) => {
      bgUploadBtn.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        bgUploadBtn.classList.remove("is-dragover");
      });
    });
    bgUploadBtn.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      bgUploadBtn.classList.remove("is-dragover");
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      loadBgImageFile(file);
    });
    $("#bg-image-remove").addEventListener("click", () => {
      settings.bgImage = null;
      $("#bg-image-input").value = "";
      applyTheme();
      saveSettings();
    });

    // presets
    document.querySelectorAll(".preset-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = PRESETS[btn.dataset.preset];
        if (!p) return;
        Object.assign(settings, p);
        applyTheme();
        saveSettings();
      });
    });

    $("#settings-reset").addEventListener("click", () => {
      settings = freshDefaultSettings();
      applyTheme();
      saveSettings();
    });

    // save current theme as a custom preset
    $("#save-preset-btn").addEventListener("click", () => {
      const input = $("#preset-name-input");
      saveCurrentAsPreset(input.value);
      input.value = "";
    });
    $("#preset-name-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); $("#save-preset-btn").click(); }
    });

    // CBS "more info" blurb
    $("#cbs-info-toggle").addEventListener("click", () => {
      const blurb = $("#cbs-info-blurb");
      const btn = $("#cbs-info-toggle");
      const nowHidden = !blurb.hidden;
      blurb.hidden = nowHidden;
      btn.setAttribute("aria-expanded", (!nowHidden).toString());
      btn.classList.toggle("is-active", !nowHidden);
    });

    // popover close
    $("#popover-close").addEventListener("click", closePopover);
    $("#popover-scrim").addEventListener("click", closePopover);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closePopover(); closePanel(); }
    });
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    loadSettings();
    loadState();
    loadCbsSlots();
    buildCbsGroups();
    applyTheme();
    initScenarioInput();
    buildCbsToggles();
    buildCatColorControls();
    loadCustomPresets();
    buildCustomPresetSwatches();
    initCurrentWeek();

    $("#toggle-medsoc").checked = state.showMedSoc;
    $("#toggle-weekend").checked = state.showWeekends;

    wireControls();
    render();
    loadVerseOfDay();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
