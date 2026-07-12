/* JACKED — offline gym weights tracker */
"use strict";

/* ---------------- Constants & state ---------------- */
const STORE_KEY = "jacked_v1";
const KG_PER_LB = 0.45359237;
const THEMES = [
  { id: "iron",      name: "Iron",      colors: ["#101318", "#e8483a", "#edf0f5"] },
  { id: "chalk",     name: "Chalk",     colors: ["#f2f1ed", "#c9382b", "#17191d"] },
  { id: "neon",      name: "Neon City", colors: ["#0d0616", "#ff2fb3", "#b465ff"] },
  { id: "terminal",  name: "Terminal",  colors: ["#030b03", "#22ff66", "#4dff7c"] },
  { id: "synthwave", name: "Synthwave", colors: ["#120b2a", "#22d3ee", "#f472b6"] },
];
const BARBELL_SVG = `<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 12h1.5M21 12h1.5"/><rect x="4" y="6" width="3" height="12" rx="1"/><rect x="8" y="8" width="2.4" height="8" rx="1"/><rect x="17" y="6" width="3" height="12" rx="1"/><rect x="13.6" y="8" width="2.4" height="8" rx="1"/><path d="M10.4 12h3.2"/></svg>`;
const DEFAULT_EXERCISES = [
  "Squat", "Bench Press", "Deadlift", "Overhead Press", "Barbell Row",
  "Incline Bench Press", "Front Squat", "Romanian Deadlift", "Pull Up",
  "Lat Pulldown", "Leg Press", "Leg Curl", "Leg Extension", "Dumbbell Press",
  "Lateral Raise", "Bicep Curl", "Tricep Pushdown", "Hip Thrust", "Cable Row",
];
const PLATES = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};
const BARS = { kg: [20, 15, 10], lb: [45, 35, 15] };

let state = loadState();
let route = { tab: "programs", programId: null, weekIdx: 0, sessionId: null, progressEx: null };

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.settings = Object.assign(defaultSettings(), s.settings);
      s.maxes = Object.assign({ squat: null, bench: null, deadlift: null }, s.maxes);
      s.programs = s.programs || [];
      s.sessions = s.sessions || [];
      return s;
    }
  } catch (e) { console.error("Failed to load saved data", e); }
  return {
    version: 1,
    settings: defaultSettings(),
    maxes: { squat: null, bench: null, deadlift: null },
    programs: [],
    sessions: [],
  };
}
function defaultSettings() {
  return { unit: "kg", theme: "iron", restSec: 120 };
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- Units ----------------
   Weights are always stored in kg. The settings unit is the DEFAULT;
   exercises (ex.unit) and session entries (en.unit) may override it. */
function unit() { return state.settings.unit; }
function toDisp(kg, u) {
  if (kg == null || !isFinite(kg)) return "";
  const v = (u || unit()) === "kg" ? kg : kg / KG_PER_LB;
  return String(Math.round(v * 10) / 10);
}
function fromDisp(val, u) {
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  return (u || unit()) === "kg" ? n : n * KG_PER_LB;
}
function fmtW(kg, u) { return kg == null ? "—" : `${toDisp(kg, u)} ${u || unit()}`; }
/* effective unit for an exercise name (lowercased key): newest session
   override wins, then any program override, then the default */
function unitForExercise(key) {
  const ss = [...state.sessions].sort((a, b) => a.date < b.date ? 1 : -1);
  for (const s of ss) for (const en of s.entries)
    if (en.unit && (en.name || "").trim().toLowerCase() === key) return en.unit;
  for (const p of state.programs) for (const w of p.weeks) for (const d of w.days) for (const ex of d.exercises)
    if (ex.unit && (ex.name || "").trim().toLowerCase() === key) return ex.unit;
  return unit();
}

/* ---------------- 1RM / PR helpers ---------------- */
function e1rm(kg, reps) {
  if (!kg || !reps) return 0;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}
function liftKey(name) {
  const n = (name || "").toLowerCase();
  if (/deadlift/.test(n) && !/romanian|stiff|rdl/.test(n)) return "deadlift";
  if (/bench/.test(n) && !/incline|decline|close/.test(n)) return "bench";
  if (/squat/.test(n) && !/front|split|bulgarian|hack|goblet/.test(n)) return "squat";
  return null;
}
/* exercise name -> chronologically sorted [{date, weightKg, reps, sessionId}] */
function buildHistory() {
  const map = {};
  for (const s of state.sessions) {
    for (const en of s.entries) {
      const key = (en.name || "").trim().toLowerCase();
      if (!key) continue;
      for (const set of en.sets) {
        if (set.weightKg > 0 && set.reps > 0) {
          (map[key] ||= []).push({ date: s.date, sessionId: s.id, weightKg: set.weightKg, reps: set.reps });
        }
      }
    }
  }
  for (const k in map) map[k].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return map;
}
/* PR sets within one session vs all strictly earlier history */
function sessionPRs(session, history) {
  const prs = [];
  for (const en of session.entries) {
    const key = (en.name || "").trim().toLowerCase();
    if (!key || !history[key]) continue;
    const prior = history[key].filter(h => h.date < session.date);
    const bestW = Math.max(0, ...prior.map(h => h.weightKg));
    const bestE = Math.max(0, ...prior.map(h => e1rm(h.weightKg, h.reps)));
    let topW = 0, topE = 0, topSet = null;
    for (const set of en.sets) {
      if (set.weightKg > 0 && set.reps > 0) {
        if (set.weightKg > topW) { topW = set.weightKg; }
        const e = e1rm(set.weightKg, set.reps);
        if (e > topE) { topE = e; topSet = set; }
      }
    }
    if (prior.length && topSet && (topW > bestW || topE > bestE)) {
      prs.push({ name: en.name, weightKg: topSet.weightKg, reps: topSet.reps, newWeight: topW > bestW, newE1rm: topE > bestE });
    }
  }
  return prs;
}

/* ---------------- Rendering ---------------- */
const $view = document.getElementById("view");

/* Pass { keepScroll: true } for in-place edits (add/remove/reorder within a
   screen) so the page doesn't jump to the top; navigation resets to top. */
function render(opts = {}) {
  const prevY = window.scrollY;
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === route.tab));
  if (route.tab === "programs") route.programId ? renderProgramEditor() : renderProgramList();
  else if (route.tab === "history") route.sessionId ? renderSessionEditor() : renderHistory();
  else if (route.tab === "progress") renderProgress();
  else renderSettings();
  updateExNames();
  if (opts.keepScroll) {
    window.scrollTo(0, prevY);
    // re-apply after layout settles — some mobile browsers clamp scroll
    // asynchronously right after a full innerHTML swap
    requestAnimationFrame(() => window.scrollTo(0, prevY));
  } else {
    window.scrollTo(0, 0);
  }
}
function updateExNames() {
  const names = new Set(DEFAULT_EXERCISES);
  for (const p of state.programs) for (const w of p.weeks) for (const d of w.days) for (const ex of d.exercises) if (ex.name) names.add(ex.name);
  for (const s of state.sessions) for (const en of s.entries) if (en.name) names.add(en.name);
  document.getElementById("exNames").innerHTML = [...names].sort().map(n => `<option value="${esc(n)}">`).join("");
}

/* ---------------- Programs list ---------------- */
function renderProgramList() {
  const cards = state.programs.map(p => {
    const days = p.weeks.reduce((a, w) => a + w.days.length, 0);
    return `<div class="card clickable" data-open="${p.id}">
      <div class="row between">
        <div class="grow">
          <div class="card-title">${esc(p.name)}</div>
          <div class="muted">${p.weeks.length} week${p.weeks.length !== 1 ? "s" : ""} · ${days} day${days !== 1 ? "s" : ""}</div>
        </div>
        <button class="btn small danger" data-del="${p.id}">Delete</button>
      </div>
    </div>`;
  }).join("");
  $view.innerHTML = `
    <div class="page-title">Training Programs</div>
    <button class="btn block" id="importSplitBtn" style="margin-bottom:12px">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      Import split from screenshot
    </button>
    <input type="file" id="splitFile" accept="image/*" class="hidden">
    ${cards || `<div class="empty">${BARBELL_SVG}<br>No programs yet.<br>Tap <strong>+</strong> to build one, or import a screenshot of your split.</div>`}
    <button class="fab-add" id="addProgram">+</button>`;
  document.getElementById("addProgram").onclick = () => {
    const p = { id: uid(), name: "New Program", weeks: [{ days: [{ name: "Day 1", exercises: [] }] }] };
    state.programs.push(p); save();
    route.programId = p.id; route.weekIdx = 0; render();
  };
  const splitFile = document.getElementById("splitFile");
  document.getElementById("importSplitBtn").onclick = () => splitFile.click();
  splitFile.onchange = () => { if (splitFile.files[0]) importSplitFromImage(splitFile.files[0]); };
  $view.querySelectorAll("[data-open]").forEach(el => el.onclick = e => {
    if (e.target.closest("[data-del]")) return;
    route.programId = el.dataset.open; route.weekIdx = 0; render();
  });
  $view.querySelectorAll("[data-del]").forEach(el => el.onclick = () => {
    confirmModal("Delete program?", "This removes the plan. Logged workout history is kept.", () => {
      state.programs = state.programs.filter(p => p.id !== el.dataset.del); save(); render();
    });
  });
}

/* ---------------- Program editor ---------------- */
function findProgram() { return state.programs.find(p => p.id === route.programId); }

function renderProgramEditor() {
  const p = findProgram();
  if (!p) { route.programId = null; return renderProgramList(); }
  if (route.weekIdx >= p.weeks.length) route.weekIdx = Math.max(0, p.weeks.length - 1);
  const week = p.weeks[route.weekIdx];

  const tabs = p.weeks.map((_, i) =>
    `<button class="${i === route.weekIdx ? "active" : ""}" data-week="${i}">W${i + 1}</button>`).join("") +
    `<button data-addweek="1" title="Add week">+</button>`;

  const days = week.days.map((day, di) => `
    <div class="card day-card open" data-day="${di}">
      <div class="day-head">
        <span class="caret">▶</span>
        <input class="input grow day-name" data-di="${di}" value="${esc(day.name)}">
        <span class="ex-count" title="Number of exercises — type a bigger number to add blank ones">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1.5 12h1.5M21 12h1.5"/><rect x="4" y="7.5" width="2.6" height="9" rx="1"/><rect x="17.4" y="7.5" width="2.6" height="9" rx="1"/><path d="M6.6 12h10.8"/></svg>
          <input class="ex-count-input" data-di="${di}" type="number" inputmode="numeric" min="0" value="${day.exercises.length}" aria-label="Exercise count">
        </span>
      </div>
      <div class="day-body">
        ${day.exercises.map((ex, xi) => exCardHTML(ex, di, xi)).join("")}
        <button class="btn block" data-addex="${di}" style="margin-top:10px">+ Add exercise</button>
        <div class="row" style="margin-top:10px">
          <button class="btn primary grow" data-logday="${di}">Log workout</button>
          <button class="btn danger" data-deldaay="${di}" title="Delete day">Delete day</button>
        </div>
      </div>
    </div>`).join("");

  $view.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <button class="btn small" id="backBtn">← Back</button>
      <input class="input grow" id="progName" value="${esc(p.name)}" style="font-weight:800">
    </div>
    <div class="week-tabs">${tabs}</div>
    <div class="row" style="margin-bottom:10px; flex-wrap:wrap">
      <button class="btn small" id="copyWeek" ${route.weekIdx === 0 ? "disabled" : ""}>Copy previous week</button>
      <button class="btn small" id="addDay">+ Day</button>
      <button class="btn small danger" id="delWeek" ${p.weeks.length <= 1 ? "disabled" : ""}>Delete week</button>
    </div>
    ${days || `<div class="empty">No days in this week. Tap <strong>+ Day</strong>.</div>`}`;

  document.getElementById("backBtn").onclick = () => { route.programId = null; render(); };
  bindValue(document.getElementById("progName"), v => { p.name = v || "Program"; });
  $view.querySelectorAll("[data-week]").forEach(b => b.onclick = () => { route.weekIdx = +b.dataset.week; render(); });
  $view.querySelector("[data-addweek]").onclick = () => { p.weeks.push({ days: [{ name: "Day 1", exercises: [] }] }); route.weekIdx = p.weeks.length - 1; save(); render(); };
  document.getElementById("copyWeek").onclick = () => {
    const prev = p.weeks[route.weekIdx - 1];
    p.weeks[route.weekIdx] = JSON.parse(JSON.stringify(prev));
    p.weeks[route.weekIdx].days.forEach(d => d.exercises.forEach(ex => ex.id = uid()));
    save(); render();
  };
  document.getElementById("addDay").onclick = () => { week.days.push({ name: `Day ${week.days.length + 1}`, exercises: [] }); save(); render(); };
  document.getElementById("delWeek").onclick = () => confirmModal("Delete this week?", "", () => {
    p.weeks.splice(route.weekIdx, 1); route.weekIdx = Math.max(0, route.weekIdx - 1); save(); render();
  });

  $view.querySelectorAll(".day-head").forEach(h => h.onclick = e => {
    if (e.target.closest("input,button")) return;
    h.closest(".day-card").classList.toggle("open");
    h.closest(".day-card").querySelector(".day-body").classList.toggle("hidden");
  });
  $view.querySelectorAll(".day-name").forEach(inp => bindValue(inp, v => { week.days[+inp.dataset.di].name = v; }));
  $view.querySelectorAll("[data-deldaay]").forEach(b => b.onclick = () => confirmModal("Delete day?", "", () => {
    week.days.splice(+b.dataset.deldaay, 1); save(); render();
  }));
  $view.querySelectorAll("[data-addex]").forEach(b => b.onclick = () => {
    const di = +b.dataset.addex;
    const ex = { id: uid(), name: "", weightKg: null, percent: null, sets: 3, reps: 8, rpe: null, notes: "" };
    week.days[di].exercises.push(ex);
    save();
    appendExercise(week, di, ex); // surgical insert — no full re-render, no scroll jump
  });
  $view.querySelectorAll(".ex-count-input").forEach(inp => {
    const commit = () => {
      const di = +inp.dataset.di;
      const list = week.days[di].exercises;
      const want = parseInt(inp.value, 10);
      // only ever grow: add blank exercises; never remove existing ones
      if (isFinite(want) && want > list.length) {
        const toAdd = want - list.length;
        for (let k = 0; k < toAdd; k++) {
          const ex = { id: uid(), name: "", weightKg: null, percent: null, sets: null, reps: null, rpe: null, notes: "" };
          list.push(ex);
          appendExercise(week, di, ex);
        }
        save();
      } else {
        inp.value = list.length; // reset display; lowering does nothing
      }
    };
    inp.onchange = commit;
    inp.addEventListener("focus", () => inp.select());
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
    // make the whole count chip a tap target, not just the tiny number
    inp.closest(".ex-count").addEventListener("click", e => { if (e.target !== inp) inp.focus(); });
  });
  $view.querySelectorAll("[data-logday]").forEach(b => b.onclick = () => logDay(p, route.weekIdx, week.days[+b.dataset.logday]));

  bindExCards(week);
}

function exCardHTML(ex, di, xi) {
  const lift = liftKey(ex.name);
  const auto = ex.percent != null && lift && state.maxes[lift];
  const noMax = ex.percent != null && lift && !state.maxes[lift];
  const exU = ex.unit || unit();
  return `<div class="ex-card ${auto ? "autocalc" : ""}" data-di="${di}" data-xi="${xi}">
    <div class="row">
      <input class="input grow ex-f" data-f="name" list="exNames" placeholder="Exercise name" value="${esc(ex.name)}">
      <button class="btn small ex-up" title="Move up">↑</button>
      <button class="btn small ex-down" title="Move down">↓</button>
      <button class="btn small danger ex-del">✕</button>
    </div>
    <div class="ex-grid">
      <label class="field weightfield">Weight
        <span class="stepper">
          <input class="input ex-f" data-f="weight" type="number" step="any" inputmode="decimal" value="${toDisp(ex.weightKg, exU)}">
          <button type="button" class="w-dec" title="−${exU === "kg" ? "2.5" : "5"} ${exU}">−</button>
          <button type="button" class="w-inc" title="+${exU === "kg" ? "2.5" : "5"} ${exU}">+</button>
          <button type="button" class="w-unit ${ex.unit ? "override" : ""}" title="Unit for this exercise (default: ${unit()})">${exU}</button>
        </span>
      </label>
      <label class="field">Sets<input class="input ex-f" data-f="sets" type="number" inputmode="numeric" value="${ex.sets ?? ""}"></label>
      <label class="field">Reps<input class="input ex-f" data-f="reps" type="number" inputmode="numeric" value="${ex.reps ?? ""}"></label>
      <label class="field">%1RM<input class="input ex-f" data-f="percent" type="number" inputmode="decimal" value="${ex.percent ?? ""}" placeholder="—"></label>
      <label class="field">RPE<input class="input ex-f" data-f="rpe" type="number" step="0.5" inputmode="decimal" value="${ex.rpe ?? ""}" placeholder="—"></label>
      <label class="field wide">Notes<input class="input ex-f" data-f="notes" value="${esc(ex.notes)}" placeholder="Optional"></label>
    </div>
    ${noMax ? `<div class="badge warn" style="margin-top:8px">Set your ${lift} 1RM in Settings to auto-calc</div>` : ""}
    ${auto ? `<div class="muted" style="margin-top:6px">Auto: ${ex.percent}% of ${fmtW(state.maxes[lift])} 1RM</div>` : ""}
  </div>`;
}

function bindExCards(week) {
  $view.querySelectorAll(".ex-card").forEach(card => bindOneExCard(card, week));
}

/* Append one exercise card to its day WITHOUT re-rendering the page, so
   scroll position can't move (mobile browsers clamp scroll on full rebuilds). */
function appendExercise(week, di, ex) {
  const dayCard = $view.querySelector(`.day-card[data-day="${di}"]`);
  if (!dayCard) return render({ keepScroll: true });
  const addBtn = dayCard.querySelector("[data-addex]");
  const xi = week.days[di].exercises.indexOf(ex);
  const temp = document.createElement("div");
  temp.innerHTML = exCardHTML(ex, di, xi);
  const card = temp.firstElementChild;
  addBtn.parentNode.insertBefore(card, addBtn);
  bindOneExCard(card, week);
  const chip = dayCard.querySelector(".ex-count-input");
  if (chip) chip.value = week.days[di].exercises.length;
}

function bindOneExCard(card, week) {
    const di = +card.dataset.di, xi = +card.dataset.xi;
    const list = week.days[di].exercises;
    const ex = list[xi];
    const exU = () => ex.unit || unit();
    card.querySelectorAll(".ex-f").forEach(inp => {
      inp.addEventListener("input", () => {
        const f = inp.dataset.f, v = inp.value;
        if (f === "name") ex.name = v;
        else if (f === "notes") ex.notes = v;
        else if (f === "weight") { ex.weightKg = fromDisp(v, exU()); ex.percent = null; const pct = card.querySelector('[data-f="percent"]'); if (pct) pct.value = ""; }
        else if (f === "percent") {
          ex.percent = v === "" ? null : parseFloat(v);
          const lift = liftKey(ex.name);
          if (ex.percent != null && lift && state.maxes[lift]) {
            ex.weightKg = Math.round(state.maxes[lift] * ex.percent / 100 * 2) / 2;
            const w = card.querySelector('[data-f="weight"]'); if (w) w.value = toDisp(ex.weightKg, exU());
          }
        }
        else ex[f] = v === "" ? null : parseFloat(v);
        save();
      });
    });
    const bump = dir => {
      const stepKg = exU() === "kg" ? 2.5 : 5 * KG_PER_LB;
      ex.weightKg = Math.max(0, (ex.weightKg || 0) + dir * stepKg);
      ex.percent = null;
      const w = card.querySelector('[data-f="weight"]'); if (w) w.value = toDisp(ex.weightKg, exU());
      const pct = card.querySelector('[data-f="percent"]'); if (pct) pct.value = "";
      save();
    };
    card.querySelector(".w-dec").onclick = () => bump(-1);
    card.querySelector(".w-inc").onclick = () => bump(1);
    card.querySelector(".w-unit").onclick = () => {
      const next = exU() === "kg" ? "lb" : "kg";
      ex.unit = next === unit() ? null : next;
      save(); render({ keepScroll: true });
    };
    card.querySelector(".ex-del").onclick = () => { list.splice(xi, 1); save(); render({ keepScroll: true }); };
    card.querySelector(".ex-up").onclick = () => { if (xi > 0) { [list[xi - 1], list[xi]] = [list[xi], list[xi - 1]]; save(); render({ keepScroll: true }); } };
    card.querySelector(".ex-down").onclick = () => { if (xi < list.length - 1) { [list[xi + 1], list[xi]] = [list[xi], list[xi + 1]]; save(); render({ keepScroll: true }); } };
}

/* Create a session from a planned day */
function logDay(program, weekIdx, day) {
  const session = {
    id: uid(), date: todayISO(),
    label: `${program.name} · W${weekIdx + 1} · ${day.name}`,
    entries: day.exercises.filter(ex => ex.name).map(ex => ({
      id: uid(), name: ex.name, unit: ex.unit || null, notes: "",
      sets: Array.from({ length: Math.max(1, ex.sets || 1) }, () => ({ weightKg: ex.weightKg, reps: ex.reps })),
    })),
  };
  state.sessions.push(session); save();
  route.tab = "history"; route.sessionId = session.id; render();
}

/* ---------------- History ---------------- */
function renderHistory() {
  const history = buildHistory();
  const sorted = [...state.sessions].sort((a, b) => a.date < b.date ? 1 : -1);
  let html = "", lastMonth = "";
  for (const s of sorted) {
    const month = new Date(s.date + "T12:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (month !== lastMonth) { html += `<div class="session-date-group">${month}</div>`; lastMonth = month; }
    const prs = sessionPRs(s, history);
    const nice = new Date(s.date + "T12:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const exNames = s.entries.map(e => e.name).filter(Boolean).slice(0, 4).join(", ");
    html += `<div class="card clickable" data-open="${s.id}">
      <div class="row between">
        <div class="grow">
          <strong>${nice}</strong> ${prs.length ? `<span class="badge">★ ${prs.length} PR${prs.length > 1 ? "s" : ""}</span>` : ""}
          <div class="muted">${esc(s.label || "Workout")}</div>
          <div class="muted">${esc(exNames)}${s.entries.length > 4 ? "…" : ""}</div>
        </div>
        <button class="btn small danger" data-del="${s.id}">Delete</button>
      </div>
    </div>`;
  }
  $view.innerHTML = `
    <div class="page-title">Workout History</div>
    ${html || `<div class="empty">${BARBELL_SVG}<br>No workouts logged yet.<br>Tap <strong>+</strong> or use <strong>Log workout</strong> on a program day.</div>`}
    <button class="fab-add" id="addSession">+</button>`;
  document.getElementById("addSession").onclick = () => {
    const s = { id: uid(), date: todayISO(), label: "Workout", entries: [] };
    state.sessions.push(s); save();
    route.sessionId = s.id; render();
  };
  $view.querySelectorAll("[data-open]").forEach(el => el.onclick = e => {
    if (e.target.closest("[data-del]")) return;
    route.sessionId = el.dataset.open; render();
  });
  $view.querySelectorAll("[data-del]").forEach(el => el.onclick = () => confirmModal("Delete workout?", "This log entry will be removed permanently.", () => {
    state.sessions = state.sessions.filter(s => s.id !== el.dataset.del); save(); render();
  }));
}

function renderSessionEditor() {
  const s = state.sessions.find(x => x.id === route.sessionId);
  if (!s) { route.sessionId = null; return renderHistory(); }
  const history = buildHistory();
  const prs = sessionPRs(s, history);

  const entries = s.entries.map((en, ei) => `
    <div class="card" data-ei="${ei}">
      <div class="row">
        <input class="input grow en-name" list="exNames" placeholder="Exercise name" value="${esc(en.name)}">
        <button class="btn small en-unit ${en.unit ? "override" : ""}" title="Unit for this exercise (default: ${unit()})">${en.unit || unit()}</button>
        <button class="btn small danger en-del">✕</button>
      </div>
      ${en.sets.map((set, si) => `
        <div class="set-row" data-si="${si}">
          <span class="setnum">${si + 1}</span>
          <label class="field">Weight (${en.unit || unit()})<input class="input set-w" type="number" step="any" inputmode="decimal" value="${toDisp(set.weightKg, en.unit || unit())}"></label>
          <label class="field">Reps<input class="input set-r" type="number" inputmode="numeric" value="${set.reps ?? ""}"></label>
          <button class="btn small danger set-del">✕</button>
        </div>`).join("")}
      <div class="row" style="margin-top:10px">
        <button class="btn small en-addset">+ Set</button>
        <input class="input grow en-notes" placeholder="Notes" value="${esc(en.notes)}">
      </div>
    </div>`).join("");

  $view.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <button class="btn small" id="backBtn">← Back</button>
      <input class="input grow" id="sLabel" value="${esc(s.label)}" style="font-weight:800">
    </div>
    <div class="row" style="margin-bottom:12px">
      <input class="input" type="date" id="sDate" value="${s.date}" style="max-width:180px">
      ${prs.map(p => `<span class="badge">★ PR ${esc(p.name)}</span>`).join(" ")}
    </div>
    ${entries}
    <button class="btn block primary" id="addEntry">+ Add exercise</button>`;

  document.getElementById("backBtn").onclick = () => { route.sessionId = null; render(); };
  bindValue(document.getElementById("sLabel"), v => { s.label = v; });
  document.getElementById("sDate").onchange = e => { s.date = e.target.value || todayISO(); save(); render(); };
  document.getElementById("addEntry").onclick = () => {
    s.entries.push({ id: uid(), name: "", notes: "", sets: [{ weightKg: null, reps: null }] });
    save(); render({ keepScroll: true });
  };
  $view.querySelectorAll(".card[data-ei]").forEach(card => {
    const en = s.entries[+card.dataset.ei];
    bindValue(card.querySelector(".en-name"), v => { en.name = v; });
    bindValue(card.querySelector(".en-notes"), v => { en.notes = v; });
    card.querySelector(".en-unit").onclick = () => {
      const next = (en.unit || unit()) === "kg" ? "lb" : "kg";
      en.unit = next === unit() ? null : next;
      save(); render({ keepScroll: true });
    };
    card.querySelector(".en-del").onclick = () => { s.entries.splice(+card.dataset.ei, 1); save(); render({ keepScroll: true }); };
    card.querySelector(".en-addset").onclick = () => {
      const last = en.sets[en.sets.length - 1];
      en.sets.push({ weightKg: last ? last.weightKg : null, reps: last ? last.reps : null });
      save(); render({ keepScroll: true });
    };
    card.querySelectorAll(".set-row").forEach(rowEl => {
      const set = en.sets[+rowEl.dataset.si];
      rowEl.querySelector(".set-w").addEventListener("input", e => { set.weightKg = fromDisp(e.target.value, en.unit || unit()); save(); });
      rowEl.querySelector(".set-r").addEventListener("input", e => { set.reps = e.target.value === "" ? null : parseInt(e.target.value, 10); save(); });
      rowEl.querySelector(".set-del").onclick = () => { en.sets.splice(+rowEl.dataset.si, 1); save(); render({ keepScroll: true }); };
    });
  });
}

/* ---------------- Progress ---------------- */
function renderProgress() {
  const history = buildHistory();
  const names = Object.keys(history).sort();
  if (!names.length) {
    $view.innerHTML = `<div class="page-title">Progress</div>
      <div class="empty">${BARBELL_SVG}<br>Log some workouts first —<br>your charts and PRs will appear here.</div>`;
    return;
  }
  if (!route.progressEx || !history[route.progressEx]) route.progressEx = names[0];
  const rows = history[route.progressEx];

  /* one point per session date: top-set weight + best e1RM */
  const byDate = {};
  for (const r of rows) {
    const d = byDate[r.date] ||= { w: 0, e: 0 };
    d.w = Math.max(d.w, r.weightKg);
    d.e = Math.max(d.e, e1rm(r.weightKg, r.reps));
  }
  const points = Object.entries(byDate).map(([date, v]) => ({ date, w: v.w, e: v.e }));
  const exUnit = unitForExercise(route.progressEx);
  const bestW = Math.max(...rows.map(r => r.weightKg));
  const bestE = Math.max(...rows.map(r => e1rm(r.weightKg, r.reps)));
  const lastDate = rows[rows.length - 1].date;

  /* all-time PR feed (running-max weight events, newest first) */
  const prFeed = [];
  for (const n of names) {
    let max = 0;
    for (const r of history[n]) {
      if (r.weightKg > max) { max = r.weightKg; prFeed.push({ name: n, date: r.date, weightKg: r.weightKg, reps: r.reps }); }
    }
  }
  prFeed.sort((a, b) => a.date < b.date ? 1 : -1);

  const displayName = n => n.replace(/\b\w/g, c => c.toUpperCase());
  $view.innerHTML = `
    <div class="page-title">Progress</div>
    <label class="field" style="margin-bottom:12px">Exercise
      <select class="input" id="exSelect">${names.map(n => `<option value="${esc(n)}" ${n === route.progressEx ? "selected" : ""}>${esc(displayName(n))}</option>`).join("")}</select>
    </label>
    <div class="stat-grid">
      <div class="stat"><div class="val">${fmtW(bestW, exUnit)}</div><div class="lbl">Best set</div></div>
      <div class="stat"><div class="val">${fmtW(bestE, exUnit)}</div><div class="lbl">Best est. 1RM</div></div>
      <div class="stat"><div class="val">${points.length}</div><div class="lbl">Sessions</div></div>
      <div class="stat"><div class="val">${new Date(lastDate + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div><div class="lbl">Last trained</div></div>
    </div>
    <div class="chart-wrap">${chartSVG(points, exUnit)}</div>
    <div class="legend">
      <span><i style="background:var(--accent)"></i>Top set weight</span>
      <span><i style="background:var(--accent2)"></i>Est. 1RM</span>
    </div>
    <div class="page-title" style="margin-top:22px">Recent PRs</div>
    ${prFeed.slice(0, 12).map(p => {
      const pu = unitForExercise(p.name);
      return `<div class="card row between">
      <div><strong>${esc(displayName(p.name))}</strong><div class="muted">${new Date(p.date + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</div></div>
      <span class="badge">★ ${toDisp(p.weightKg, pu)} ${pu} × ${p.reps}</span>
    </div>`;
    }).join("") || `<div class="muted">No PRs yet.</div>`}`;

  document.getElementById("exSelect").onchange = e => { route.progressEx = e.target.value; render(); };
}

function chartSVG(points, u) {
  if (points.length < 2) return `<div class="muted" style="padding:20px;text-align:center">Log this exercise in at least 2 sessions to see a chart.</div>`;
  const W = Math.max(560, points.length * 56), H = 240;
  const padL = 44, padR = 16, padT = 14, padB = 30;
  const vals = points.flatMap(p => [p.w, p.e]).map(kg => parseFloat(toDisp(kg, u)));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 5; hi += 5; }
  const span = hi - lo; lo -= span * 0.1; hi += span * 0.1;
  const x = i => padL + i * (W - padL - padR) / (points.length - 1);
  const y = v => padT + (hi - v) * (H - padT - padB) / (hi - lo);
  const disp = kg => parseFloat(toDisp(kg, u));

  const gridLines = [];
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, yy = y(v);
    gridLines.push(`<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--border)" stroke-dasharray="4 4"/>
      <text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(v)}</text>`);
  }
  const line = (key, color, area) => {
    const pts = points.map((p, i) => `${x(i)},${y(disp(p[key]))}`).join(" ");
    const dots = points.map((p, i) => {
      const last = i === points.length - 1;
      return `<circle cx="${x(i)}" cy="${y(disp(p[key]))}" r="${last ? 5 : 3.5}" fill="${color}" ${last ? `stroke="var(--bg2)" stroke-width="2"` : ""}/>`;
    }).join("");
    const fill = area
      ? `<polygon points="${x(0)},${H - padB} ${pts} ${x(points.length - 1)},${H - padB}" fill="${color}" opacity="0.12"/>`
      : "";
    return `${fill}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
  };
  const labels = points.map((p, i) => {
    const step = Math.ceil(points.length / 8);
    if (i % step !== 0 && i !== points.length - 1) return "";
    const d = new Date(p.date + "T12:00");
    return `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.getDate()}/${d.getMonth() + 1}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    ${gridLines.join("")}${labels}
    ${line("e", "var(--accent2)", false)}${line("w", "var(--accent)", true)}
  </svg>`;
}

/* ---------------- Settings ---------------- */
function renderSettings() {
  const themeCards = THEMES.map(t => `
    <button class="theme-swatch ${state.settings.theme === t.id ? "active" : ""}" data-theme-pick="${t.id}">
      <span class="dots">${t.colors.map(c => `<i style="background:${c}"></i>`).join("")}</span>${t.name}
    </button>`).join("");

  $view.innerHTML = `
    <div class="page-title">Settings</div>

    <div class="card">
      <label class="field">Default unit</label>
      <div class="segmented" style="margin-top:8px">
        <button data-unit="kg" class="${unit() === "kg" ? "active" : ""}">Kilograms (kg)</button>
        <button data-unit="lb" class="${unit() === "lb" ? "active" : ""}">Pounds (lb)</button>
      </div>
      <div class="muted" style="margin-top:8px">Used everywhere unless an exercise has its own unit — tap the kg/lb chip on any exercise to override it (e.g. machines in kg, dumbbells in lb). Weights are stored precisely, so switching never loses accuracy.</div>
    </div>

    <div class="card">
      <label class="field">Theme</label>
      <div class="theme-grid" style="margin-top:8px">${themeCards}</div>
    </div>

    <div class="card">
      <label class="field">1RM Maxes (${unit()})</label>
      <div class="ex-grid" style="grid-template-columns:repeat(3,1fr);margin-top:8px">
        <label class="field">Squat<input class="input" id="maxSquat" type="number" step="any" inputmode="decimal" value="${toDisp(state.maxes.squat)}"></label>
        <label class="field">Bench<input class="input" id="maxBench" type="number" step="any" inputmode="decimal" value="${toDisp(state.maxes.bench)}"></label>
        <label class="field">Deadlift<input class="input" id="maxDeadlift" type="number" step="any" inputmode="decimal" value="${toDisp(state.maxes.deadlift)}"></label>
      </div>
      <button class="btn primary block" id="saveMaxes" style="margin-top:12px">Save & update programs</button>
      <div class="muted" style="margin-top:8px">Program exercises using %1RM are recalculated from these.</div>
    </div>

    <div class="card">
      <label class="field">Default rest timer</label>
      <div class="segmented" style="margin-top:8px">
        ${[60, 90, 120, 180].map(s => `<button data-rest="${s}" class="${state.settings.restSec === s ? "active" : ""}">${s / 60}:${String(s % 60).padStart(2, "0")}</button>`).join("")}
      </div>
    </div>

    <div class="card">
      <label class="field">Backup</label>
      <div class="row" style="margin-top:8px">
        <button class="btn grow" id="exportBtn">⬇ Export data</button>
        <button class="btn grow" id="importBtn">⬆ Import data</button>
      </div>
      <input type="file" id="importFile" accept=".json,application/json" class="hidden">
      <div class="muted" style="margin-top:8px">Export saves everything to a JSON file. Import restores it on any device.</div>
    </div>

    <div class="muted" style="text-align:center;margin-top:18px">JACKED · your data stays in this browser — use Export for backups</div>`;

  $view.querySelectorAll("[data-unit]").forEach(b => b.onclick = () => { state.settings.unit = b.dataset.unit; save(); syncHeader(); render(); });
  $view.querySelectorAll("[data-theme-pick]").forEach(b => b.onclick = () => {
    state.settings.theme = b.dataset.themePick; save(); applyTheme(); render();
  });
  $view.querySelectorAll("[data-rest]").forEach(b => b.onclick = () => { state.settings.restSec = +b.dataset.rest; timer.setTo(state.settings.restSec); save(); render(); });

  document.getElementById("saveMaxes").onclick = () => {
    state.maxes.squat = fromDisp(document.getElementById("maxSquat").value);
    state.maxes.bench = fromDisp(document.getElementById("maxBench").value);
    state.maxes.deadlift = fromDisp(document.getElementById("maxDeadlift").value);
    /* recalc all %-based program weights */
    for (const p of state.programs) for (const w of p.weeks) for (const d of w.days) for (const ex of d.exercises) {
      const lift = liftKey(ex.name);
      if (ex.percent != null && lift && state.maxes[lift]) {
        ex.weightKg = Math.round(state.maxes[lift] * ex.percent / 100 * 2) / 2;
      }
    }
    save(); toast("Maxes saved — programs updated");
  };

  document.getElementById("exportBtn").onclick = exportData;
  const fileInput = document.getElementById("importFile");
  document.getElementById("importBtn").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => importData(reader.result);
    reader.readAsText(f);
  };
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `jacked-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importData(text) {
  let data;
  try {
    data = JSON.parse(text);
    if (!data || typeof data !== "object" || !Array.isArray(data.programs) || !Array.isArray(data.sessions)) throw new Error("bad shape");
  } catch {
    return toast("That file doesn't look like a JACKED backup", true);
  }
  confirmModal("Import backup?", "This replaces ALL current data with the backup file.", () => {
    data.settings = Object.assign(defaultSettings(), data.settings);
    data.maxes = Object.assign({ squat: null, bench: null, deadlift: null }, data.maxes);
    state = data; save(); applyTheme(); syncHeader(); render();
    toast("Backup imported");
  });
}

/* ---------------- Screenshot split import ----------------
   OCR runs fully in the browser via tesseract.js (loaded on demand
   from CDN, so this one feature needs internet on first use). */
const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

function ensureTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = TESSERACT_CDN;
    s.onload = res;
    s.onerror = () => rej(new Error("tesseract load failed"));
    document.head.appendChild(s);
  });
}

async function importSplitFromImage(file) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">
    <h3>Import Split</h3>
    <div class="muted" id="ocrStatus">Loading OCR engine…</div>
    <div class="ocr-bar"><i id="ocrFill" style="width:0%"></i></div>
  </div></div>`;
  const status = msg => { const el = document.getElementById("ocrStatus"); if (el) el.textContent = msg; };
  const fill = p => { const el = document.getElementById("ocrFill"); if (el) el.style.width = Math.round(p * 100) + "%"; };
  try {
    await ensureTesseract();
    status("Reading screenshot…");
    const worker = await Tesseract.createWorker("eng", 1, {
      logger: m => { if (m.status === "recognizing text") fill(m.progress); },
    });
    const { data } = await worker.recognize(file);
    await worker.terminate();
    closeModal();
    const days = parseSplitText(data.text || "");
    const count = days.reduce((a, d) => a + d.exercises.length, 0);
    if (!count) return toast("Couldn't find exercises in that screenshot", true);
    const program = {
      id: uid(), name: "Imported Split",
      weeks: [{
        days: days.map(d => ({
          name: d.name,
          exercises: d.exercises.map(e => ({ id: uid(), name: e.name, weightKg: null, percent: null, sets: e.sets, reps: e.reps, rpe: null, notes: "" })),
        })),
      }],
    };
    state.programs.push(program); save();
    route.tab = "programs"; route.programId = program.id; route.weekIdx = 0; render();
    toast(`Imported ${count} exercise${count !== 1 ? "s" : ""} — check names and fill any blanks`);
  } catch (err) {
    console.error(err);
    closeModal();
    toast("Couldn't read the screenshot — check your internet and try again", true);
  }
}

/* Turn OCR text into [{name, exercises:[{name, sets, reps}]}].
   Missing sets/reps stay null (blank fields), per design.
   Handles: "Day 1: Chest", "PUSH DAY", weekday tables, "Bench 4x8",
   "(3x10 - each leg)", "(3x failure)", "4 sets of 6-8 reps",
   and table rows like "Chest Press 4 6-10". */
function parseSplitText(text) {
  // day headers that always start a new day (may carry a title after them)
  const DAY_NUM_RE = /^(?:day\s*\d+|week\s*\d+\s*day\s*\d+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
  const DAY_WORD_RE = /^(?:push|pull|legs?|upper|lower|full\s*body|rest)\s*day\b\s*[:\-–—]?\s*$/i;
  // bare muscle-group labels: fold into an empty day's title, or start a day
  const MUSCLE_WORD = "push|pull|legs?|upper|lower|chest|back|shoulders?|arms?|biceps|triceps|core|abs|quads|hamstrings|glutes|calves|traps|delts|rear\\s*delts|full\\s*body";
  const MUSCLE_RE = new RegExp(`^(?:${MUSCLE_WORD})(?:\\s*[&+,/]?\\s*(?:and\\s+)?(?:${MUSCLE_WORD}))*\\s*[:\\-–—]?\\s*$`, "i");
  // lines that are never exercises
  const JUNK_WORD_RE = /^(?:workouts?|training|splits?|plans?|programs?|routines?|exercises?|sets?|reps?|weight|notes?|name|schedule|focus|day|week|optional|superset)\s*$/i;
  const JUNK_ANY_RE = /(?:workout\s*split|day\s*split|bro\s*split|workout\s*plan|training\s*plan|workout\s*focus|full\s*body\s*workout|muscle\s*group|for\s+muscle|build\s+muscle|lose\s+fat|get\s+stronger|strength\s+gain|muscle\s*&|&\s*strength|macros|calories|protein|carbs|fat\b|water|download|\.com|www\.|https?:|key\s*rules|remember|progressive\s*overload|training\s*days|rest\s*days|consistency|\d\s*[:.]\s*\d{2}\s*(?:am|pm)|\b(?:19|20)\d{2}\b)/i;

  // "Bench Press 3x failure" / "Push-Ups: 2 sets to failure"
  const FAIL_RE = /^(.*?[A-Za-z])[\s:\-–—.]*(\d{1,2})\s*(?:[x×*]|sets?)?\s*(?:sets?\s*)?(?:to\s+)?failure\b.*$/i;
  // "Bench Press 4x8" / "RDL's 3x10 - each leg" / "Romanian Deadlifts: 3x 8-10"
  const AFTER_RE = /^(.*?[A-Za-z])[\s:\-–—.]*(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*[x×*]\s*(\d{1,3})(?:\s*[-–]\s*\d{1,3})?(?:[\s\-–—].*)?$/;
  // "4x8 Bench Press"
  const BEFORE_RE = /^(\d{1,2})\s*[x×*]\s*(\d{1,3})(?:\s*[-–]\s*\d{1,3})?[\s:\-–—.]*([A-Za-z].*)$/;
  // "Bench Press: 4 sets of 6-8 reps" / "Lunges: 3 sets of 10 per leg" / "Shrugs 3 sets"
  const WORD_RE = /^(.*?[A-Za-z])[\s:\-–—.]*(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*sets?(?:\s*(?:of|[x×*])?\s*(\d{1,3})(?:\s*[-–]\s*\d{1,3})?)?(?:\s*reps?)?(?:[\s\-–—,].*)?$/i;
  // table rows: "Chest Press 4 6-10" / "Lateral Raises 3 15" (sets & reps columns)
  const TABLE_RE = /^(.*?[A-Za-z])\s+(\d{1,2})(?:\s*[-–]\s*\d{1,2})?(?:\s+each)?\s+(\d{1,3})(?:\s*[-–]\s*\d{1,3})?(?:\s*(?:reps?|each\b.*))?\s*$/;

  const clean = s => s.replace(/[()|_~`"“”•·]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s:\-–—.,]+|[\s:\-–—.,]+$/g, "").trim();
  const titleCase = s => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
  const days = [];
  let current = null;
  const newDay = (name, auto) => { current = { name: titleCase(name).slice(0, 40), exercises: [], fromHeader: !auto, auto: !!auto }; days.push(current); };

  for (const raw of text.split(/\r?\n/)) {
    // strip list bullets like "1. " / "3) " / "- " but never a leading "3x8"
    const line = clean(raw.replace(/^\s*(?:[•·\-–—*>]|\d{1,2}[.)])\s+/, ""));
    if (line.length < 2 || !/[A-Za-z]/.test(line)) continue;
    if (JUNK_WORD_RE.test(line) || JUNK_ANY_RE.test(line)) continue;

    if (DAY_NUM_RE.test(line) || DAY_WORD_RE.test(line)) { newDay(line); continue; }
    if (MUSCLE_RE.test(line)) {
      // column labels that repeat the day title ("Chest" under "Day 1 Chest…") → skip;
      // "Chest & Back" after a bare "Monday" header → fold into the day title;
      // "PUSH"-style headers between exercise groups → start a new day
      const key = (line.toLowerCase().match(/[a-z]+/) || [""])[0];
      if (current && current.name.toLowerCase().includes(key)) continue;
      if (current && !current.exercises.length && current.fromHeader) current.name = (current.name + " — " + titleCase(line)).slice(0, 40);
      else newDay(line);
      continue;
    }

    let name = null, sets = null, reps = null, m;
    if ((m = FAIL_RE.exec(line))) { name = m[1]; sets = +m[2]; }
    else if ((m = AFTER_RE.exec(line))) { name = m[1]; sets = +m[2]; reps = +m[3]; }
    else if ((m = BEFORE_RE.exec(line))) { sets = +m[1]; reps = +m[2]; name = m[3]; }
    else if ((m = WORD_RE.exec(line))) { name = m[1]; sets = +m[2]; reps = m[3] ? +m[3] : null; }
    else if ((m = TABLE_RE.exec(line))) { name = m[1]; sets = +m[2]; reps = +m[3]; }
    else if (/[A-Za-z]{3,}/.test(line) && line.length <= 40) { name = line; } // name only — sets/reps stay blank

    if (!name) continue;
    name = clean(name);
    if (name.length < 3 || !/[A-Za-z]{3}/.test(name)) continue;
    if (sets != null && !(sets >= 1 && sets <= 20)) sets = null;
    if (reps != null && !(reps >= 1 && reps <= 100)) reps = null;
    if (!current) newDay("Day 1", true);
    current.exercises.push({ name, sets, reps });
  }
  // text before the first real day header is usually poster-title junk:
  // when header days carry the exercises, drop name-only strays from auto days
  if (days.some(d => !d.auto && d.exercises.length)) {
    for (const d of days) if (d.auto) d.exercises = d.exercises.filter(e => e.sets != null || e.reps != null);
  }
  // schedule-style screenshots (weekday → muscle group) yield named but empty
  // days — keep those; otherwise drop empty days
  const withEx = days.filter(d => d.exercises.length);
  if (!withEx.length && days.length >= 2) return days;
  return withEx;
}

/* ---------------- Plate calculator ---------------- */
function openPlateCalc() {
  const u = unit();
  const bars = BARS[u];
  showModal(`
    <h3>Plate Calculator</h3>
    <div class="row">
      <label class="field grow">Target weight (${u})<input class="input" id="pcTarget" type="number" step="any" inputmode="decimal" autofocus></label>
      <label class="field">Bar<select class="input" id="pcBar">${bars.map((b, i) => `<option value="${b}" ${i === 0 ? "selected" : ""}>${b} ${u}</option>`).join("")}</select></label>
    </div>
    <div id="pcOut" style="margin-top:6px"></div>`);
  const calc = () => {
    const target = parseFloat(document.getElementById("pcTarget").value);
    const bar = parseFloat(document.getElementById("pcBar").value);
    const out = document.getElementById("pcOut");
    if (isNaN(target) || target <= 0) { out.innerHTML = ""; return; }
    if (target < bar) { out.innerHTML = `<div class="badge warn">Target is lighter than the bar (${bar} ${u})</div>`; return; }
    let perSide = (target - bar) / 2;
    const result = [];
    for (const p of PLATES[u]) {
      const n = Math.floor(perSide / p + 1e-9);
      if (n > 0) { result.push({ p, n }); perSide -= n * p; perSide = Math.round(perSide * 1000) / 1000; }
    }
    const loaded = target - perSide * 2;
    out.innerHTML = `
      <div class="muted" style="margin:6px 0">Per side:</div>
      <div class="plate-result">${result.map(r => `<div class="plate">${r.p}<small>× ${r.n}</small></div>`).join("") || `<span class="muted">Empty bar</span>`}</div>
      ${perSide > 0.01 ? `<div class="badge warn" style="margin-top:10px">Closest load: ${Math.round(loaded * 10) / 10} ${u} (${Math.round(perSide * 2 * 100) / 100} ${u} short)</div>` : ""}`;
  };
  document.getElementById("pcTarget").addEventListener("input", calc);
  document.getElementById("pcBar").addEventListener("change", calc);
}

/* ---------------- Rest timer ---------------- */
const timer = (() => {
  let total = state.settings.restSec, remaining = total, running = false, interval = null;
  const fab = document.getElementById("timerFab");
  const fabText = document.getElementById("timerFabText");
  const panel = document.getElementById("timerPanel");
  const display = document.getElementById("timerDisplay");
  const startBtn = document.getElementById("timerStart");

  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function paint() {
    display.textContent = fmt(remaining);
    fabText.textContent = running || remaining !== total ? fmt(remaining) : "";
    fab.classList.toggle("running", running);
    startBtn.textContent = running ? "Pause" : (remaining === 0 || remaining === total ? "Start" : "Resume");
  }
  function tick() {
    remaining--;
    if (remaining <= 0) {
      remaining = 0; stop();
      fab.classList.add("done");
      setTimeout(() => fab.classList.remove("done"), 3200);
      beep(); if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 500]);
      remaining = total;
    }
    paint();
  }
  function start() { if (remaining <= 0) remaining = total; running = true; clearInterval(interval); interval = setInterval(tick, 1000); paint(); }
  function stop() { running = false; clearInterval(interval); paint(); }
  function setTo(sec) { total = sec; remaining = sec; stop(); }

  fab.onclick = () => panel.classList.toggle("hidden");
  startBtn.onclick = () => running ? stop() : start();
  document.getElementById("timerMinus").onclick = () => { remaining = Math.max(0, remaining - 15); if (!running) total = Math.max(15, total - 15); paint(); };
  document.getElementById("timerPlus").onclick = () => { remaining += 15; if (!running) total += 15; paint(); };
  panel.querySelectorAll("[data-sec]").forEach(b => b.onclick = () => { setTo(+b.dataset.sec); start(); });
  document.addEventListener("click", e => {
    if (!panel.classList.contains("hidden") && !panel.contains(e.target) && !fab.contains(e.target)) panel.classList.add("hidden");
  });
  paint();
  return { setTo };
})();

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach(t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "square"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.18);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* audio unavailable */ }
}

/* ---------------- Modals & toast ---------------- */
const modalRoot = document.getElementById("modalRoot");
function showModal(innerHTML) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHTML}
    <button class="btn block" id="modalClose" style="margin-top:14px">Close</button></div></div>`;
  modalRoot.querySelector(".modal-backdrop").addEventListener("click", e => { if (e.target === e.currentTarget) closeModal(); });
  document.getElementById("modalClose").onclick = closeModal;
}
function closeModal() { modalRoot.innerHTML = ""; }
function confirmModal(title, msg, onYes) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">
    <h3>${esc(title)}</h3>
    ${msg ? `<p class="muted">${esc(msg)}</p>` : ""}
    <div class="row" style="margin-top:14px">
      <button class="btn grow" id="mNo">Cancel</button>
      <button class="btn grow danger" id="mYes">Confirm</button>
    </div></div></div>`;
  document.getElementById("mNo").onclick = closeModal;
  document.getElementById("mYes").onclick = () => { closeModal(); onYes(); };
  modalRoot.querySelector(".modal-backdrop").addEventListener("click", e => { if (e.target === e.currentTarget) closeModal(); });
}
let toastTimeout;
function toast(msg, isError) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom));z-index:60;padding:10px 18px;border-radius:10px;font-weight:700;font-size:.9rem;box-shadow:0 6px 20px rgba(0,0,0,.4);transition:opacity .3s";
    document.body.appendChild(el);
  }
  el.style.background = isError ? "var(--danger)" : "var(--accent)";
  el.style.color = "var(--accent-text)";
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.style.opacity = "0"; }, 2400);
}

/* ---------------- Shared helpers ---------------- */
function bindValue(input, setter) {
  input.addEventListener("input", () => { setter(input.value); save(); });
}
function applyTheme() { document.documentElement.dataset.theme = state.settings.theme; }
function syncHeader() { document.getElementById("unitToggle").textContent = unit(); }

/* ---------------- Init ---------------- */
document.querySelectorAll(".nav-btn").forEach(b => b.onclick = () => {
  route.tab = b.dataset.tab;
  route.programId = null; route.sessionId = null;
  render();
});
document.getElementById("unitToggle").onclick = () => {
  state.settings.unit = unit() === "kg" ? "lb" : "kg";
  save(); syncHeader(); render();
  toast(`Default unit: ${unit()} (per-exercise overrides kept)`);
};
document.getElementById("plateBtn").onclick = openPlateCalc;

applyTheme();
syncHeader();
render();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* offline install unavailable */ });
}
