// Director UI: load / inspect / edit / validate / play a match timeline.
import { validateTimeline, replay, oversStr, posXY } from "./rules.js";
import { createEngine, describe } from "./engine.js";

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
};
const SVG = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};
const STORE_KEY = "npl-director:last";

const S = {
  doc: null, schema: null, vocab: null, report: null, issues: new Map(),
  sel: { inn: 0, idx: -1 }, view: "form", cardMode: "sel",
  playing: false, stopReq: false, setupDone: false, playingKey: null,
};
const engine = createEngine();

// ------------------------------------------------------------------------------------------------ boot

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function boot() {
  $("engineName").textContent = `(${engine.name ?? "custom"})`;
  engine.onState(onEngineState);
  try {
    [S.schema, S.vocab] = await Promise.all([fetchJSON("schema/director.schema.json"), fetchJSON("schema/vocab.json")]);
  } catch (err) {
    // web/director/schema is a symlink to director/schema; without it we still replay the cricket rules.
    log(`schema/vocab unavailable (${err.message}); schema checks, the form and the field map are limited`);
    S.vocab = { positions: {}, shots: {}, bowling_styles: new Proxy({}, { get: () => ({ deliveries: [] }) }), ground: { inner_circle_radius_m: 27.43 } };
  }
  try {
    if (localStorage.getItem(STORE_KEY)) $("restoreBtn").hidden = false;
  } catch { /* storage blocked: restore just stays hidden */ }
  wire();
  log("ready. Open a timeline or load the sample.");
}

function wire() {
  $("fileInput").addEventListener("change", async (ev) => {
    const f = ev.target.files[0];
    if (f) loadText(await f.text(), f.name);
    ev.target.value = "";
  });
  $("pasteBtn").onclick = () => { $("pasteText").value = ""; $("pasteDlg").showModal(); };
  $("pasteDlg").addEventListener("close", () => {
    if ($("pasteDlg").returnValue === "ok") loadText($("pasteText").value, "pasted");
  });
  $("sampleBtn").onclick = async () => {
    try {
      loadDoc(await fetchJSON("examples/kgu_vs_lul_2026.json"), "sample kgu_vs_lul_2026.json");
    } catch (err) { log(`cannot load sample: ${err.message}`); }
  };
  $("restoreBtn").onclick = () => {
    try { loadText(localStorage.getItem(STORE_KEY), "last edit"); } catch (err) { log(`restore failed: ${err.message}`); }
  };
  $("exportBtn").onclick = exportDoc;
  $("gameBtn").onclick = playInGame;
  $("recomputeBtn").onclick = recompute;
  $("playBtn").onclick = () => play(false);
  $("stepBtn").onclick = () => play(true);
  $("pauseBtn").onclick = pause;
  $("speedSel").onchange = (e) => engine.setSpeed(Number(e.target.value));
  $("jsonApply").onclick = applyJSON;
  $("setFieldBtn").onclick = setFieldHere;
  $("defaultFieldBtn").onclick = defaultField;
  document.querySelectorAll(".inspector .tab").forEach((t) => (t.onclick = () => {
    S.view = t.dataset.view;
    document.querySelectorAll(".inspector .tab").forEach((x) => x.classList.toggle("active", x === t));
    renderInspector();
  }));
  let depth = 0;
  addEventListener("dragenter", (e) => { e.preventDefault(); depth++; $("dropzone").classList.add("on"); });
  addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("dropzone").classList.remove("on"); } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", async (e) => {
    e.preventDefault();
    depth = 0;
    $("dropzone").classList.remove("on");
    const f = e.dataTransfer.files[0];
    if (f) loadText(await f.text(), f.name);
  });
  addEventListener("keydown", (e) => {
    if (!S.doc || e.target.closest("input, textarea, select, dialog") || e.metaKey || e.ctrlKey) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); move(e.key === "ArrowRight" ? 1 : -1); }
    else if (e.key === " ") { e.preventDefault(); S.playing ? pause() : play(false); }
    else if (e.key === "n") play(true);
  });
}

// ------------------------------------------------------------------------------------------------ load / save

function loadText(text, name) {
  let doc;
  try { doc = JSON.parse(text); } catch (err) { return log(`${name}: not valid JSON (${err.message})`); }
  loadDoc(doc, name);
}

function loadDoc(doc, name) {
  if (!doc || typeof doc !== "object" || !doc.header || !Array.isArray(doc.innings)) {
    return log(`${name}: not a Director timeline (needs header and innings[])`);
  }
  S.doc = doc;
  S.setupDone = false;
  S.sel = { inn: 0, idx: firstDelivery(0) };
  log(`loaded ${name}: ${doc.innings.map((i) => `${i.events?.length ?? 0} events`).join(" + ")}${doc.fictional ? " (fictional sample)" : ""}`);
  ["exportBtn", "gameBtn", "recomputeBtn", "playBtn", "stepBtn"].forEach((id) => ($(id).disabled = false));
  revalidate();
  namesDatalist();
  renderAll();
}

function firstDelivery(inn) {
  const i = S.doc.innings[inn]?.events?.findIndex((e) => e.type === "delivery");
  return i == null || i < 0 ? -1 : i;
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S.doc)); $("restoreBtn").hidden = false; }
    catch (err) { log(`could not keep a local copy of the edit: ${err.message}`); }
  }, 800);
}

function exportDoc() {
  const blob = new Blob([JSON.stringify(S.doc, null, 1) + "\n"], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: (S.doc.title || "timeline").replace(/[^\w.-]+/g, "_").slice(0, 60) + ".json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The real engine plays a whole compiled timeline (web/serve.py compiles it against the served game's player
// database, director/tools/compile.py); the game page runs it with ?director=<script url>.
async function playInGame() {
  const btn = $("gameBtn");
  btn.disabled = true;
  try {
    const r = await fetch("/api/director/compile", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(S.doc),
    });
    const res = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok) throw new Error(res.error || `HTTP ${r.status}`);
    for (const w of res.warnings) log(`engine: ${w}`);
    log(`engine: compiled ${res.balls} deliveries; opening the game`);
    if (!window.open(`/?director=${encodeURIComponent(res.url)}`, "_blank")) log("engine: the browser blocked the new tab");
  } catch (err) {
    log(`engine: cannot play in game: ${err.message}`);
  } finally {
    btn.disabled = !S.doc;
  }
}

// ------------------------------------------------------------------------------------------------ validation

function revalidate() {
  try {
    S.report = validateTimeline(S.doc, S.schema, S.vocab);
  } catch (err) {
    console.error(err);
    S.report = { errors: [`validator crashed: ${err.message} (fix the schema errors first)`], warnings: [], states: [], innings: [], result: null };
  }
  S.issues = new Map();
  const add = (inn, idx, level, msg) => {
    const k = `${inn}:${idx}`;
    if (!S.issues.has(k)) S.issues.set(k, []);
    S.issues.get(k).push({ level, msg });
  };
  S.report.states.forEach((st, i) => st.forEach((x, k) => x.issues.forEach((is) => add(i, k, is.level, is.msg))));
  for (const e of S.report.errors) {
    const m = /^\$\.innings\[(\d+)\]\.events\[(\d+)\](\S*): (.*)$/.exec(e);
    if (m) add(+m[1], +m[2], "error", `${m[3] || "event"}: ${m[4]}`);
  }
}

function locate(msg) {
  let m = /^innings (\d+) event (\d+)/.exec(msg);
  if (m) return { inn: m[1] - 1, idx: +m[2] };
  m = /^\$\.innings\[(\d+)\]\.events\[(\d+)\]/.exec(msg);
  if (m) return { inn: +m[1], idx: +m[2] };
  if (/^(header|\$\.header)/.test(msg)) return { inn: S.sel.inn, idx: -1 };
  return null;
}

function renderValidation() {
  const { errors, warnings } = S.report;
  $("valCount").textContent = `${errors.length} E · ${warnings.length} W`;
  const box = $("validation");
  box.replaceChildren();
  if (!errors.length && !warnings.length) return box.append(h("div", { class: "ok" }, "✓ Valid: schema and cricket rules pass."));
  const ul = h("ul");
  for (const [level, list] of [["error", errors], ["warning", warnings]])
    for (const msg of list.slice(0, 400)) {
      const loc = locate(msg);
      ul.append(h("li", { class: level, title: loc ? "click to select" : "", onclick: () => loc && select(loc.inn, loc.idx, true) }, msg));
    }
  if (errors.length + warnings.length > 800) ul.append(h("li", {}, "… more not shown"));
  box.append(ul);
}

// ------------------------------------------------------------------------------------------------ rendering

function renderAll() {
  const t = S.doc.header.teams || [];
  $("matchTitle").textContent = `${S.doc.fictional ? "[FICTIONAL] " : ""}${t.map((x) => x.abbrev || x.name).join(" v ")} · ${S.doc.header.venue?.name ?? ""} · ${S.doc.header.date ?? ""}`;
  renderTabs();
  renderTimeline();
  renderInspector();
  renderScorecard();
  renderValidation();
}

function afterEdit(structural) {
  revalidate();
  renderTimeline();
  renderScorecard();
  renderValidation();
  if (structural) renderInspector();
  else { renderSituation(); renderMap(); }
  persist();
}

function renderTabs() {
  const tabs = $("inningsTabs");
  tabs.replaceChildren(...S.doc.innings.map((inn, i) => h("button", {
    class: `tab${i === S.sel.inn ? " active" : ""}`, role: "tab",
    onclick: () => select(i, firstDelivery(i) < 0 ? -1 : firstDelivery(i), true),
  }, `Inns ${inn.number} · ${abbrev(inn.batting_team)}`)));
  $("cardTabs").replaceChildren(...[["sel", "At selection"], ["full", "Full"]].map(([k, label]) => h("button", {
    class: `tab${S.cardMode === k ? " active" : ""}`, onclick: () => { S.cardMode = k; renderTabs(); renderScorecard(); },
  }, label)));
}

const abbrev = (team) => S.doc.header.teams?.find((t) => t.name === team)?.abbrev ?? team;
const surname = (n) => (n || "?").split(" ").slice(-1)[0];
const EV_CHIP = { over_end: "|", bowler_change: "BC", drinks: "DR", strategic_timeout: "TO", injury: "INJ", substitution: "SUB",
  rain_delay: "RN", innings_break: "IB", powerplay_change: "PP", milestone: "★", cutscene: "CS", match_end: "END" };

function chipFor(e) {
  if (e.type !== "delivery") return [EV_CHIP[e.type] ?? "?", "c-ev"];
  const r = e.result || {}, x = r.extras || {};
  if (r.wicket && r.wicket.kind !== "retired_hurt") return ["W", "c-wkt"];
  if (x.wides) return [`${x.wides > 1 ? x.wides : ""}wd`, "c-extra"];
  if (x.no_balls) return [`nb${r.runs_bat ? r.runs_bat : ""}`, "c-extra"];
  if (x.byes) return [`${x.byes}b`, "c-extra"];
  if (x.leg_byes) return [`${x.leg_byes}lb`, "c-extra"];
  if (r.boundary === 6) return ["6", "c-six"];
  if (r.boundary === 4) return ["4", "c-four"];
  return r.runs_bat ? [String(r.runs_bat), "c-run"] : ["·", "c-dot"];
}

function renderTimeline() {
  const box = $("timeline");
  const keep = box.scrollTop;
  box.replaceChildren();
  if (!S.doc) return;
  const i = S.sel.inn, inn = S.doc.innings[i];
  box.append(h("div", { class: `item-header${S.sel.idx === -1 ? " sel" : ""}`, onclick: () => select(i, -1) }, "Match header · teams, XIs, venue, toss"));
  if (!inn) return;
  const rows = [];
  let cur = null;
  (inn.events || []).forEach((e, k) => {
    const over = e.type === "delivery" ? e.over : cur?.over ?? -1;
    if (!cur || (e.type === "delivery" && e.over !== cur.over)) rows.push((cur = { over, items: [] }));
    cur.items.push([e, k]);
  });
  const st = S.report.states[i] || [];
  for (const row of rows) {
    const dels = row.items.filter(([e]) => e.type === "delivery").map(([e]) => e);
    const runs = dels.reduce((a, e) => a + (e.result?.runs_bat || 0) + Object.values(e.result?.extras || {}).reduce((p, q) => p + q, 0), 0);
    const last = row.items[row.items.length - 1][1];
    const score = st[last]?.score;
    const bad = row.items.some(([, k]) => S.issues.get(`${i}:${k}`)?.some((x) => x.level === "error"));
    const label = h("div", { class: `over-label${bad ? " err" : ""}`, title: "select the over's first event",
      onclick: () => select(i, row.items[0][1]) },
      h("b", {}, row.over < 0 ? "Pre" : `Ov ${row.over + 1}`),
      dels.length ? `${surname(dels[0].bowler)} · ${runs}r` : "", h("br"), score ? `${score.runs}/${score.wickets}` : "");
    const balls = h("div", { class: "balls" });
    for (const [e, k] of row.items) {
      const [txt, cls] = chipFor(e);
      const iss = S.issues.get(`${i}:${k}`) || [];
      const lvl = iss.some((x) => x.level === "error") ? " bad" : iss.length ? " warn" : "";
      const selCls = S.sel.idx === k ? " sel" : "";
      const playCls = S.playingKey === `${i}:${k}` ? " playing" : "";
      const title = (e.type === "delivery" ? describe(e) : e.type + (e.kind ? `: ${e.kind}` : "") + (e.team ? `: ${e.team}` : "")) +
        (iss.length ? "\n" + iss.map((x) => `${x.level}: ${x.msg}`).join("\n") : "");
      balls.append(h("span", { class: `chip ${cls}${e.review ? " rv" : ""}${lvl}${selCls}${playCls}`, tabindex: 0, title,
        "data-key": `${i}:${k}`, onclick: () => select(i, k), onkeydown: (ev) => ev.key === "Enter" && select(i, k) }, txt));
    }
    box.append(h("div", { class: `over${row.items.some(([, k]) => S.playingKey === `${i}:${k}`) ? " playing" : ""}` }, label, balls));
  }
  box.scrollTop = keep;
}

function select(inn, idx, scroll) {
  if (!S.doc) return;
  const tabChanged = inn !== S.sel.inn;
  S.sel = { inn, idx };
  if (tabChanged) renderTabs();
  renderTimeline();
  renderInspector();
  if (S.cardMode === "sel") renderScorecard();
  if (scroll || tabChanged) document.querySelector(`.chip[data-key="${inn}:${idx}"]`)?.scrollIntoView({ block: "nearest" });
}

function move(step) {
  let { inn, idx } = S.sel;
  idx += step;
  if (idx >= (S.doc.innings[inn]?.events.length ?? 0)) { if (inn + 1 < S.doc.innings.length) { inn++; idx = 0; } else return; }
  if (idx < -1) { if (inn > 0) { inn--; idx = S.doc.innings[inn].events.length - 1; } else return; }
  select(inn, idx, true);
}

// ------------------------------------------------------------------------------------------------ inspector

const selected = () => (S.sel.idx < 0 ? S.doc.header : S.doc.innings[S.sel.inn]?.events[S.sel.idx]);

function renderInspector() {
  const ev = S.doc && selected();
  const form = $("form");
  const body = document.querySelector(".insp-body");
  const keep = body.scrollTop;
  form.replaceChildren();
  $("jsonView").hidden = S.view !== "json";
  form.hidden = S.view !== "form";
  if (!ev) { $("inspTitle").textContent = "Inspector"; $("mapWrap").hidden = true; $("situation").textContent = ""; return; }
  $("inspTitle").textContent = S.sel.idx < 0 ? "Match header" :
    ev.type === "delivery" ? `Ball ${ev.over}.${ev.ball} · ${ev.id ?? ""}` : `${ev.type.replaceAll("_", " ")} · ${ev.id ?? ""}`;
  renderSituation();
  renderMap();
  if (S.view === "json") {
    $("jsonText").value = JSON.stringify(ev, null, 2);
    $("jsonMsg").textContent = "";
  } else if (S.schema) {
    const node = S.sel.idx < 0 ? S.schema.$defs.header : branchOf(ev);
    if (!node) form.append(h("p", { class: "muted" }, `Unknown event type '${ev.type}'. Use the JSON tab.`));
    else renderObject(form, node, ev);
  } else form.append(h("p", { class: "muted" }, "Schema not loaded: use the JSON tab to edit."));
  body.scrollTop = keep;
}

function renderSituation() {
  const box = $("situation");
  box.replaceChildren();
  if (S.sel.idx < 0 || !S.doc) return;
  const st = S.report.states[S.sel.inn] || [];
  const before = S.sel.idx > 0 ? st[S.sel.idx - 1] : null;
  const after = st[S.sel.idx];
  if (after) {
    box.append("Before ", h("b", {}, before ? `${before.score.runs}/${before.score.wickets} (${before.score.overs})` : "0/0 (0.0)"),
      " → after ", h("b", {}, `${after.score.runs}/${after.score.wickets} (${after.score.overs})`),
      after.target ? ` · target ${after.target}` : "",
      before?.freeHit ? h("span", { class: "fh" }, " · FREE HIT") : "",
      after.closed ? ` · innings closed: ${after.closed}` : "");
  }
  const iss = S.issues.get(`${S.sel.inn}:${S.sel.idx}`) || [];
  $("eventIssues").replaceChildren(...iss.map((x) => h("li", { class: x.level }, x.msg)));
}

// Schema-driven form ------------------------------------------------------------------------------------

function deref(node) {
  let out = node;
  while (out?.$ref) {
    const { $ref, ...rest } = out;
    out = { ...$ref.slice(2).split("/").reduce((n, p) => n[p], S.schema), ...rest };
  }
  return out;
}
function branchOf(ev) {
  const branches = S.schema.$defs.event.oneOf.map(deref);
  return branches.find((b) => b.properties.type.const === ev.type);
}
function defaultFor(node) {
  node = deref(node);
  if (node.oneOf) return defaultFor(node.oneOf[0]);
  if (node.anyOf) return defaultFor(node.anyOf[0]);
  if ("const" in node) return node.const;
  if (node.enum) return node.default ?? node.enum[0];
  if (node.default !== undefined) return node.default;
  switch (node.type) {
    case "object": { const o = {}; for (const k of node.required || []) o[k] = defaultFor(node.properties[k]); return o; }
    case "array": return [];
    case "integer": case "number": return Math.max(node.minimum ?? 0, node.exclusiveMinimum != null ? node.exclusiveMinimum + 1 : 0);
    case "boolean": return false;
    default: return "";
  }
}
const isNameRef = (node) => node?.$ref === "#/$defs/name";

function renderObject(el, node, obj) {
  node = deref(node);
  const req = new Set(node.required || []);
  const props = node.properties || {};
  for (const [k, sub] of Object.entries(props)) if (k in obj || req.has(k)) renderField(el, k, sub, obj, k, req.has(k));
  const missing = Object.keys(props).filter((k) => !(k in obj) && !req.has(k));
  const unknown = Object.keys(obj).filter((k) => !(k in props));
  for (const k of unknown) el.append(h("div", { class: "f-row" }, h("label", {}, k), h("span", { class: "muted" }, "unknown property (see JSON tab)"),
    h("button", { class: "x", type: "button", title: "remove", onclick: () => { delete obj[k]; afterEdit(true); } }, "×")));
  if (missing.length) {
    const sel = h("select", { "aria-label": "add field" }, h("option", { value: "" }, "+ add field…"), ...missing.map((k) => h("option", { value: k }, k)));
    sel.onchange = () => { if (sel.value) { obj[sel.value] = defaultFor(props[sel.value]); afterEdit(true); } };
    el.append(h("div", { class: "adder" }, sel));
  }
}

function renderField(el, label, raw, holder, key, required) {
  const node = deref(raw);
  const v = holder[key];
  const remove = required ? h("span") : h("button", { class: "x", type: "button", title: "remove field",
    onclick: () => { Array.isArray(holder) ? holder.splice(key, 1) : delete holder[key]; afterEdit(true); } }, "×");
  if (node.oneOf && v && typeof v === "object") {
    const b = node.oneOf.map(deref).find((x) => x.properties?.type?.const === v.type);
    if (b) return renderField(el, label, b, holder, key, required);
  }
  if (node.type === "object" || (node.properties && v && typeof v === "object" && !Array.isArray(v))) {
    const fs = h("fieldset", {}, h("legend", { class: v?.inferred ? "inferred" : "" }, label));
    if (!required) fs.append(h("div", { style: "text-align:right" }, remove));
    if (v && typeof v === "object") renderObject(fs, node, v);
    else fs.append(h("button", { class: "btn small", type: "button", onclick: () => { holder[key] = defaultFor(node); afterEdit(true); } }, `create ${label}`));
    return el.append(fs);
  }
  if (node.type === "array") {
    const fs = h("fieldset", {}, h("legend", {}, `${label} [${(v || []).length}]`));
    const arr = v || [];
    const items = node.items || {};
    arr.forEach((item, i) => {
      const box = h("div", { class: "arr-item" });
      if (deref(items).type === "object") {
        box.append(h("button", { class: "x", type: "button", title: "remove item", onclick: () => { arr.splice(i, 1); afterEdit(true); } }, "×"));
        renderObject(box, items, item);
      } else renderField(box, `#${i + 1}`, items, arr, i, false);
      fs.append(box);
    });
    fs.append(h("div", { class: "adder" },
      h("button", { class: "btn small", type: "button", onclick: () => { if (!holder[key]) holder[key] = arr; arr.push(defaultFor(items)); afterEdit(true); } }, `+ add ${label}`),
      required ? null : remove));
    return el.append(fs);
  }
  el.append(h("div", { class: `f-row${required ? " req" : ""}`, title: node.description || "" }, h("label", { title: label }, label), scalarInput(node, raw, holder, key), remove));
}

function scalarInput(node, raw, holder, key) {
  const v = holder[key];
  const set = (val) => { holder[key] = val; afterEdit(false); };
  if ("const" in node) return h("input", { type: "text", value: String(node.const), readonly: true });
  let options = node.enum;
  if (node.anyOf) options = node.anyOf.map(deref).flatMap((b) => b.enum ?? (b.type === "null" ? [null] : []));
  if (options) {
    const sel = h("select", {}, ...options.map((o, i) => h("option", { value: i }, o === null ? "— none" : String(o))));
    const at = options.findIndex((o) => o === v);
    if (at < 0) sel.prepend(h("option", { value: "" }, v === undefined ? "" : `${v} (invalid)`));
    sel.value = at < 0 ? "" : String(at);
    sel.onchange = () => sel.value !== "" && set(options[+sel.value]);
    return sel;
  }
  if (node.type === "boolean") {
    const cb = h("input", { type: "checkbox" });
    cb.checked = v === true;
    cb.onchange = () => set(cb.checked);
    return h("span", {}, cb);
  }
  if (node.type === "integer" || node.type === "number") {
    const inp = h("input", { type: "number", step: node.type === "integer" ? 1 : "any", min: node.minimum, max: node.maximum, value: v ?? "" });
    inp.onchange = () => {
      if (inp.value === "") return;
      const n = Number(inp.value);
      set(node.type === "integer" ? Math.round(n) : n);
    };
    return inp;
  }
  const inp = h("input", { type: "text", value: v ?? "", list: isNameRef(raw) ? "dl-names" : null });
  inp.onchange = () => set(inp.value);
  return inp;
}

function namesDatalist() {
  let dl = $("dl-names");
  if (!dl) document.body.append((dl = h("datalist", { id: "dl-names" })));
  const names = (S.doc?.header.teams || []).flatMap((t) => [t.name, ...(t.players || []).map((p) => p.name)]);
  dl.replaceChildren(...names.map((n) => h("option", { value: n })));
}

function applyJSON() {
  let val;
  try { val = JSON.parse($("jsonText").value); } catch (err) { $("jsonMsg").textContent = `JSON error: ${err.message}`; return; }
  if (S.sel.idx < 0) S.doc.header = val;
  else S.doc.innings[S.sel.inn].events[S.sel.idx] = val;
  $("jsonMsg").textContent = "applied";
  afterEdit(true);
}

// ------------------------------------------------------------------------------------------------ field map

function fieldSource() {
  const st = S.report.states[S.sel.inn]?.[S.sel.idx];
  const field = st?.field;
  if (!field) return null;
  const evs = S.doc.innings[S.sel.inn].events;
  for (let k = S.sel.idx; k >= 0; k--) if (evs[k].field === field) return { field, idx: k, ev: evs[k] };
  return null;
}

function slotXY(slot) {
  if (slot.x_m != null && slot.y_m != null) return [slot.x_m, slot.y_m];
  if (slot.position && S.vocab.positions[slot.position]) return posXY(S.vocab.positions, slot.position);
  return [0, 30];
}

function nearestPosition(x, y) {
  let best = null, bd = Infinity;
  for (const name of Object.keys(S.vocab.positions)) {
    const [px, py] = posXY(S.vocab.positions, name);
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

function renderMap() {
  const ev = S.sel.idx >= 0 && selected();
  const show = ev && ev.type === "delivery" && Object.keys(S.vocab.positions).length;
  $("mapWrap").hidden = !show;
  if (!show) return;
  const svg = $("fieldMap");
  const r = S.vocab.ground.inner_circle_radius_m;
  svg.replaceChildren(
    s("circle", { cx: 0, cy: -5, r: 76, fill: "#123a22", stroke: "#e8f5e9", "stroke-width": 0.6 }),
    s("path", { d: `M ${-r} 0 A ${r} ${r} 0 0 0 ${r} 0 L ${r} -20.12 A ${r} ${r} 0 0 0 ${-r} -20.12 Z`, fill: "#164428", stroke: "#cfe8d4", "stroke-width": 0.4, "stroke-dasharray": "2 1.5" }),
    s("rect", { x: -1.52, y: -20.12, width: 3.05, height: 20.12, fill: "#c8b27e" }),
    s("text", { x: 60, y: 4, fill: "#cfe8d4", "font-size": 5 }, "OFF"),
    s("text", { x: -72, y: 4, fill: "#cfe8d4", "font-size": 5 }, "LEG"),
    s("text", { x: 0, y: -77, fill: "#cfe8d4", "font-size": 4, "text-anchor": "middle" }, "bowler's end"),
  );
  // named positions: faint drop targets (a dragged fielder snaps its label to the nearest)
  for (const name of Object.keys(S.vocab.positions)) {
    const [px, py] = posXY(S.vocab.positions, name);
    svg.append(s("g", { class: "pos-mark", transform: `translate(${px} ${-py})` }, s("circle", { r: 0.8 }), s("text", { y: -1.6 }, name.replaceAll("_", " "))));
  }
  // ball path
  const bp = ev.ball_path;
  if (bp && (bp.direction || bp.angle_deg != null)) {
    const pos = S.vocab.positions[bp.direction];
    const a = ((bp.angle_deg ?? pos?.[0] ?? 0) * Math.PI) / 180;
    const d = bp.distance_m ?? pos?.[1] ?? 30;
    const res = ev.result || {};
    const col = res.wicket ? "#ff5a5f" : res.boundary === 6 ? "#c792ff" : res.boundary === 4 ? "#6fb1ff" : "#ffe08a";
    svg.append(s("line", { x1: 0, y1: 0, x2: d * Math.sin(a), y2: -d * Math.cos(a), stroke: col, "stroke-width": 0.9,
      "stroke-dasharray": bp.along_ground === false ? "3 1.5" : null }), s("circle", { cx: d * Math.sin(a), cy: -d * Math.cos(a), r: 1.3, fill: col }));
  }
  const src = fieldSource();
  $("mapNote").textContent = !src ? "No field set yet in this innings." :
    src.idx === S.sel.idx ? "This ball sets the field (drag fielders)." : `Field set at ${src.ev.id ?? "ball " + src.ev.over + "." + src.ev.ball}; dragging edits that ball's field.`;
  $("mapNote").append(h("br"), `Batter-relative · striker ${ev.batter ?? "?"} (${handOf(ev.batter)})`);
  if (!src) return;
  const active = new Set((ev.fielding || []).map((f) => f.player));
  const team = S.doc.innings[S.sel.inn].bowling_team;
  const keeper = S.doc.header.teams.find((t) => t.name === team)?.wicket_keeper;
  for (const slot of src.field) {
    const [x, y] = slotXY(slot);
    const g = s("g", { class: `fielder${slot.player === keeper ? " keeper" : ""}${slot.player === ev.bowler ? " bowler" : ""}${active.has(slot.player) ? " active" : ""}`,
      transform: `translate(${x} ${-y})` },
    s("title", {}, `${slot.player} · ${slot.position ?? "custom"}`), s("circle", { r: 2.6 }), s("text", { y: 6.2 }, surname(slot.player)));
    dragFielder(svg, g, slot);
    svg.append(g);
  }
}

function handOf(name) {
  return S.doc.header.teams.flatMap((t) => t.players || []).find((p) => p.name === name)?.bats ?? "?";
}

function dragFielder(svg, g, slot) {
  g.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    const toData = (ev) => {
      const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
      return [Math.round(pt.x * 10) / 10, Math.round(-pt.y * 10) / 10];
    };
    const moveH = (ev) => {
      const [x, y] = toData(ev);
      g.setAttribute("transform", `translate(${x} ${-y})`);
      slot.x_m = x; slot.y_m = y;
      slot.position = nearestPosition(x, y);
      g.querySelector("title").textContent = `${slot.player} · ~${slot.position}`;
    };
    const up = () => {
      g.removeEventListener("pointermove", moveH);
      g.removeEventListener("pointerup", up);
      afterEdit(fieldSource()?.idx === S.sel.idx);
    };
    g.addEventListener("pointermove", moveH);
    g.addEventListener("pointerup", up);
  });
}

function setFieldHere() {
  const ev = selected();
  const src = fieldSource();
  if (!src) return defaultField();
  ev.field = structuredClone(src.field);
  afterEdit(true);
}

function defaultField() {
  const ev = selected();
  const inn = S.doc.innings[S.sel.inn];
  const team = S.doc.header.teams.find((t) => t.name === inn.bowling_team);
  if (!team) return log("default field: bowling team not in header");
  const spin = /break|orthodox|wrist/.test(team.players.find((p) => p.name === ev.bowler)?.bowls ?? "");
  const spots = spin ? ["point", "cover", "mid_off", "mid_on", "short_fine_leg", "deep_cover", "long_on", "deep_midwicket", "deep_square_leg"]
    : ["first_slip", "point", "cover", "mid_off", "mid_on", "square_leg", "short_fine_leg", "third_man", "fine_leg"];
  const others = team.xi.filter((n) => n !== team.wicket_keeper && n !== ev.bowler);
  ev.field = [{ player: team.wicket_keeper, position: "wicket_keeper" }, { player: ev.bowler, position: "bowler" },
    ...others.map((n, i) => ({ player: n, position: spots[i] }))];
  afterEdit(true);
}

// ------------------------------------------------------------------------------------------------ scorecard

function renderScorecard() {
  const box = $("scorecard");
  box.replaceChildren();
  if (!S.doc || S.report.schemaFailed) return box.append(h("p", { class: "empty" }, S.doc ? "Fix the schema errors to see the scorecard." : "—"));
  let rep = S.report;
  if (S.cardMode === "sel") {
    const { inn, idx } = S.sel;
    const doc = { ...S.doc, innings: S.doc.innings.slice(0, inn + 1).map((x, k) => (k < inn ? x : { ...x, events: x.events.slice(0, idx + 1) })) };
    try { rep = replay(doc, S.vocab); } catch (err) { return box.append(h("p", { class: "empty" }, `scorecard unavailable: ${err.message}`)); }
  }
  for (const inn of rep.innings) {
    const team = S.doc.header.teams.find((t) => t.name === inn.bat);
    const card = h("div", { class: "card" });
    card.append(h("h3", {}, h("span", {}, inn.bat), h("span", { class: "tot" }, `${inn.runs}/${inn.wkts} (${oversStr(inn.legal)})`)));
    if (inn.target) card.append(h("div", { class: "note" }, `Target ${inn.target} · need ${Math.max(inn.target - inn.runs, 0)} from ${inn.overs * 6 - inn.legal}`));
    const bat = h("table", {}, h("tr", {}, ...["Batter", "", "R", "B", "4s", "6s", "SR"].map((x) => h("th", {}, x))));
    for (const [n, b] of inn.batters) {
      bat.append(h("tr", { class: n === inn.striker || n === inn.non ? "atcrease" : "" }, h("td", {}, n), h("td", { class: "how", title: b.out ?? "not out" }, b.out ?? "not out"),
        h("td", {}, b.runs), h("td", {}, b.balls), h("td", {}, b.fours), h("td", {}, b.sixes), h("td", {}, b.balls ? ((100 * b.runs) / b.balls).toFixed(0) : "-")));
    }
    card.append(bat);
    const x = inn.extras;
    card.append(h("div", { class: "note" }, `Extras ${x.wides + x.no_balls + x.byes + x.leg_byes + x.penalty} (wd ${x.wides}, nb ${x.no_balls}, b ${x.byes}, lb ${x.leg_byes}${x.penalty ? `, pen ${x.penalty}` : ""})`));
    const yet = (team?.xi || []).filter((n) => !inn.batters.has(n));
    if (yet.length) card.append(h("div", { class: "note" }, `Yet to bat: ${yet.join(", ")}`));
    if (inn.fow.length) card.append(h("div", { class: "note" }, `FoW: ${inn.fow.map((f) => `${f.runs}-${f.wicket} (${surname(f.batter)}, ${f.overs})`).join(", ")}`));
    const bowl = h("table", {}, h("tr", {}, ...["Bowler", "O", "M", "R", "W", "Econ", "wd", "nb"].map((y) => h("th", {}, y))));
    for (const [n, b] of inn.bowlers)
      bowl.append(h("tr", {}, h("td", {}, n), h("td", {}, oversStr(b.balls)), h("td", {}, b.maidens), h("td", {}, b.runs), h("td", {}, b.wickets),
        h("td", {}, b.balls ? ((6 * b.runs) / b.balls).toFixed(2) : "-"), h("td", {}, b.wides), h("td", {}, b.no_balls)));
    card.append(bowl);
    box.append(card);
  }
  if (rep.result) {
    const r = rep.result;
    box.append(h("div", { class: "result" }, r.type === "win" ? `${r.winner} won by ${r.margin_runs ? r.margin_runs + " runs" : r.margin_wickets + " wickets"}` : r.type.replace("_", " ")));
  }
}

// ------------------------------------------------------------------------------------------------ recompute

function recompute() {
  if (S.report.schemaFailed) return log("recompute: fix the schema errors first");
  const d = S.doc;
  try {
    if (d.innings[1]) {
      delete d.innings[1].target;
      const first = replay(d, S.vocab);
      d.innings[1].target = first.innings[0].runs + 1;
    }
    const r = replay(d, S.vocab);
    let n = 0;
    d.innings.forEach((inn, i) => inn.events.forEach((e, k) => {
      const st = r.states[i]?.[k];
      if (!st) return;
      if (e.type === "delivery") { e.result.score_after = st.score; n++; }
      else if (e.type === "over_end" && st.completedOver) {
        const [over, bowler, runs, wickets, maiden] = st.completedOver;
        Object.assign(e, { over, bowler, runs, wickets, maiden, score: st.score });
        n++;
      } else if (e.type === "innings_break") { e.score = st.score; e.target = st.score.runs + 1; n++; }
      else if (e.type === "match_end" && r.result) {
        const { method } = e.result;
        const res = r.result;
        e.result = { ...res, ...(method ? { method } : {}),
          text: res.type === "win" ? `${res.winner} won by ${res.margin_runs ? `${res.margin_runs} runs` : `${res.margin_wickets} wickets`}` : res.type.replace("_", " ") };
        n++;
      }
    }));
    log(`recomputed ${n} snapshots`);
  } catch (err) {
    console.error(err);
    log(`recompute failed: ${err.message}`);
  }
  afterEdit(true);
}

// ------------------------------------------------------------------------------------------------ playback

function updateTransport() {
  $("playBtn").disabled = !S.doc || S.playing;
  $("stepBtn").disabled = !S.doc || S.playing;
  $("pauseBtn").disabled = !S.playing;
  $("tally").className = `tally${S.playing ? " live" : S.setupDone ? " ready" : ""}`;
}

async function play(stepOnly) {
  if (S.playing || !S.doc) return;
  S.playing = true;
  S.stopReq = false;
  updateTransport();
  try {
    if (!S.setupDone) {
      await engine.setupMatch(S.doc.header);
      S.setupDone = true;
    }
    let { inn, idx } = S.sel;
    if (idx < 0) idx = 0;
    while (!S.stopReq) {
      const ev = S.doc.innings[inn]?.events[idx];
      if (!ev) {
        if (inn + 1 < S.doc.innings.length) { inn++; idx = 0; continue; }
        log("end of timeline");
        break;
      }
      S.playingKey = `${inn}:${idx}`;
      select(inn, idx, true);
      const res = await engine.playEvent(ev, { innings: inn, index: idx, state: S.report.states[inn]?.[idx] });
      if (!res.ok) break;
      idx++;
      if (stepOnly && ev.type === "delivery") {
        if (S.doc.innings[inn]?.events[idx]) select(inn, idx, true);
        break;
      }
    }
  } catch (err) {
    console.error(err);
    log(`playback error: ${err.message}`);
  } finally {
    S.playing = false;
    S.playingKey = null;
    updateTransport();
    renderTimeline();
  }
}

function pause() {
  if (!S.playing) return;
  if (S.stopReq) engine.stop(); // second press: cut the current event short
  S.stopReq = true;
  log("pausing after the current event (press again to stop now)");
}

function onEngineState(st) {
  $("progressBar").style.width = `${Math.round((st.progress ?? 0) * 100)}%`;
  $("engineState").textContent = st.phase;
  if (["start", "done", "setup", "ready", "aborted"].includes(st.phase)) log(`[${st.engine}] ${st.phase}: ${st.message ?? ""}`);
  updateTransport();
}

function log(msg) {
  const el = $("log");
  const t = new Date().toLocaleTimeString();
  el.textContent += `${t}  ${msg}\n`;
  const lines = el.textContent.split("\n");
  if (lines.length > 600) el.textContent = lines.slice(-500).join("\n");
  el.scrollTop = el.scrollHeight;
}

boot().catch((err) => { console.error(err); log(`boot failed: ${err.message}`); });
