"use strict";
/* Tietoa 4D – Trimble Connect 3D Viewer -laajennus
   Visualisoi aikataulun mallissa: objektit ilmestyvät aikajanalla ("rakennus rakentuu"),
   sekä suunniteltu vs. toteutunut. Data pysyy selaimessa, mitään ei lähetetä muualle. */

// ==PURE START==
const IFC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const MAX128 = (1n << 128n);
const DAY = 86400000;
const WD = ["su", "ma", "ti", "ke", "to", "pe", "la"];

// Palauttaa GUIDin 32-merkkisenä hex-merkkijonona (tukee IFC 22-merk. ja Tekla/UUID-muotoa)
function guidToHex(g) {
  if (g == null) return null;
  let s = String(g).trim().replace(/^"+|"+$/g, "");
  if (/^id/i.test(s) && s.length >= 34) s = s.slice(2);
  const h = s.replace(/[{}\-\s]/g, "");
  if (/^[0-9a-fA-F]{32}$/.test(h)) return h.toLowerCase();
  if (s.length === 22) {
    let n = 0n;
    for (const c of s) {
      const i = IFC_CHARS.indexOf(c);
      if (i < 0) return null;
      n = n * 64n + BigInt(i);
    }
    if (n >= MAX128) return null;
    return n.toString(16).padStart(32, "0");
  }
  return null;
}
function hexToIfc(hex) {
  let n = BigInt("0x" + hex), out = "";
  for (let i = 0; i < 22; i++) { out = IFC_CHARS[Number(n % 64n)] + out; n = n / 64n; }
  return out;
}
function hexToDashed(h) {
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}

// Päivät käsitellään kokonaislukuina (päiviä 1.1.1970 alkaen, UTC) -> ei aikavyöhykeongelmia
function dn(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / DAY); }
function parseDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return dn(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/))) return dn(+m[3], +m[2], +m[1]);
  if (/^\d{5}([.,]\d+)?$/.test(s)) return dn(1899, 12, 30) + parseInt(s, 10); // Excel-sarjanumero
  return null;
}
function fmt(d) { const x = new Date(d * DAY); return x.getUTCDate() + "." + (x.getUTCMonth() + 1) + "." + x.getUTCFullYear(); }
function isoDate(d) { return new Date(d * DAY).toISOString().slice(0, 10); }
function weekday(d) { return WD[new Date(d * DAY).getUTCDay()]; }
function isoWeek(d) {
  const t = new Date(d * DAY);
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = t.valueOf();
  t.setUTCMonth(0, 1);
  if (t.getUTCDay() !== 4) t.setUTCMonth(0, 1 + ((4 - t.getUTCDay()) + 7) % 7);
  return 1 + Math.ceil((firstThursday - t) / (7 * DAY));
}

function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/)[0] || "";
  const cnt = { ";": first.split(";").length, ",": first.split(",").length, "\t": first.split("\t").length };
  const delim = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ""));
}

const ALIASES = {
  guid: ["guid", "ifcguid", "ifc guid", "ifc_guid", "globalid", "guid_field"],
  tunnus: ["tunnus", "elementtitunnus", "nimi", "name", "assembly_pos", "cast_unit_position_code"],
  start: ["alku", "suunniteltu alku", "suunniteltu_alku", "suunniteltu pvm", "suunniteltu_pvm", "asennuspvm", "pvm",
          "planned_start", "start", "planned_start_e", "planned_start_f", "planned_start_d"],
  end: ["loppu", "suunniteltu loppu", "suunniteltu_loppu", "planned_end", "end"],
  actual: ["toteutunut", "toteutunut pvm", "asennettu", "actual", "actual_end", "actual_end_e", "actual_end_f", "actual_end_d"]
};
function norm(s) { return String(s).trim().toLowerCase().replace(/\s+/g, " "); }

function rowsToItems(rows) {
  const res = { items: [], skipped: 0, headerFound: false };
  if (!rows.length) return res;
  const hdr = rows[0].map(norm);
  const idx = {};
  for (const f in ALIASES) {
    idx[f] = -1;
    for (const a of ALIASES[f]) { const i = hdr.indexOf(a); if (i >= 0) { idx[f] = i; break; } }
  }
  let body = rows;
  if (idx.guid >= 0) { res.headerFound = true; body = rows.slice(1); }
  else {
    idx.guid = 0; idx.start = 1; idx.end = 2; idx.actual = 3; idx.tunnus = -1;
    if (!guidToHex(rows[0][0])) body = rows.slice(1);
  }
  for (const r of body) {
    const hex = guidToHex(r[idx.guid]);
    if (!hex) { res.skipped++; continue; }
    const g = f => (idx[f] >= 0 && idx[f] < r.length) ? r[idx[f]] : null;
    res.items.push({
      hex, tunnus: String(g("tunnus") || "").trim(),
      start: parseDate(g("start")), end: parseDate(g("end")), actual: parseDate(g("actual"))
    });
  }
  return res;
}

// Objektin tila valittuna päivänä
function stateOf(it, d, mode) {
  const ps = it.start, pe = (it.end != null ? it.end : it.start);
  if (mode === "compare") {
    if (it.actual != null && d >= it.actual) return "done";
    if (pe != null && d > pe) return "late";
    if (ps != null && d >= ps) return "wip";
    if (ps == null && pe == null && it.actual == null) return "none";
    return "hidden";
  }
  if (ps == null && pe == null) return it.actual != null ? (d >= it.actual ? "done" : "hidden") : "none";
  const s = ps != null ? ps : pe;
  if (d < s) return "hidden";
  if (pe != null && d < pe) return "wip";
  return "done";
}
// ==PURE END==

/* ---------------- UI ja Trimble Connect -yhteys ---------------- */
const $ = id => document.getElementById(id);
const COLORS = {
  wip:  { r: 245, g: 158, b: 11,  a: 255 },
  done: { r: 22,  g: 163, b: 74,  a: 255 },
  late: { r: 220, g: 38,  b: 38,  a: 255 },
  ghost:{ r: 200, g: 200, b: 200, a: 40 }
};
const LEGEND = [
  ["hidden", "Tulossa (piilossa)", "#ffffff"],
  ["wip", "Työn alla", "#f59e0b"],
  ["done", "Valmis", "#16a34a"],
  ["late", "Myöhässä", "#dc2626"],
  ["none", "Ei päivämäärää", "#c8c8c8"]
];
const CHUNK = 1000;

let API = null, projectKey = "tc4d_default";
let items = new Map();        // hex -> {hex,tunnus,start,end,actual,refs:[{modelId,rid}]}
let lastState = new Map();    // hex -> tila viimeksi piirrettynä
let minDay = null, maxDay = null, cur = null;
let applying = false, applyAgain = false, playing = false;

function log(msg) {
  const el = $("log");
  el.textContent = "[" + new Date().toLocaleTimeString("fi-FI") + "] " + msg + "\n" + el.textContent;
  console.log("[Tietoa4D]", msg);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mode = () => $("mode").value;

function othersStyle() {
  const o = $("others").value;
  if (o === "hide") return { visible: false };
  if (o === "ghost") return { visible: true, color: COLORS.ghost };
  return { visible: "reset", color: "reset" };
}
function styleOf(s) {
  switch (s) {
    case "hidden": return { visible: false };
    case "wip": return { visible: true, color: COLORS.wip };
    case "done": return (mode() === "plan" && $("natural").checked) ? { visible: true, color: "reset" } : { visible: true, color: COLORS.done };
    case "late": return { visible: true, color: COLORS.late };
    default: return othersStyle();
  }
}
async function setAll(style) {
  try { await API.viewer.setObjectState(undefined, style); }
  catch (e) { await API.viewer.setObjectState({}, style); }
}

/* ---- Tallennus selaimeen (projektikohtainen) ---- */
function save() {
  try {
    const arr = [...items.values()].map(i => [i.hex, i.tunnus, i.start, i.end, i.actual]);
    localStorage.setItem(projectKey, JSON.stringify(arr));
  } catch (e) { /* localStorage voi olla estetty iframessa */ }
}
function loadLocal() {
  try {
    const arr = JSON.parse(localStorage.getItem(projectKey) || "[]");
    for (const [hex, tunnus, start, end, actual] of arr) items.set(hex, { hex, tunnus, start, end, actual, refs: [] });
    if (arr.length) log("Palautettiin " + arr.length + " riviä edellisestä istunnosta.");
  } catch (e) { }
}

/* ---- Aikajana ---- */
function recomputeRange() {
  let lo = Infinity, hi = -Infinity;
  for (const it of items.values()) for (const d of [it.start, it.end, it.actual]) if (d != null) { lo = Math.min(lo, d); hi = Math.max(hi, d); }
  if (lo === Infinity) { minDay = maxDay = cur = null; $("slider").max = 0; updateLabel(); return; }
  minDay = lo - 7; maxDay = hi + 7;
  if (cur == null || cur < minDay || cur > maxDay) cur = minDay;
  $("slider").max = maxDay - minDay;
  $("slider").value = cur - minDay;
  updateLabel();
}
function setDay(d) {
  if (minDay == null) return;
  cur = Math.max(minDay, Math.min(maxDay, d));
  $("slider").value = cur - minDay;
  updateLabel();
}
function updateLabel() {
  $("dateLabel").textContent = cur == null ? "–" : weekday(cur) + " " + fmt(cur) + "  ·  vk " + isoWeek(cur);
}
function updateInfo() {
  const total = items.size;
  let matched = 0;
  for (const it of items.values()) if (it.refs.length) matched++;
  $("dataInfo").textContent = total
    ? total + " riviä · " + matched + " kohdistui malliin" + (total - matched ? " · " + (total - matched) + " ei löytynyt" : "") +
      (minDay != null ? " · " + fmt(minDay + 7) + "–" + fmt(maxDay - 7) : "")
    : "Ei aikataulua ladattuna.";
}

/* ---- Kohdistus malliin (GUID -> runtime id) ---- */
async function resolve() {
  if (!API) return;
  let models = [];
  try { models = await API.viewer.getModels("loaded"); } catch (e) { log("getModels epäonnistui: " + e.message); }
  if (!models || !models.length) { log("Mallia ei ole ladattu katselimeen."); updateInfo(); return; }
  for (const it of items.values()) it.refs = [];
  const keys = [...items.keys()];
  for (const m of models) {
    for (const variant of ["ifc", "dashed"]) {
      const pending = keys.filter(k => !items.get(k).refs.some(r => r.modelId === m.id));
      if (!pending.length) break;
      for (let i = 0; i < pending.length; i += CHUNK) {
        const part = pending.slice(i, i + CHUNK);
        const ext = part.map(k => variant === "ifc" ? hexToIfc(k) : hexToDashed(k));
        let rids = [];
        try { rids = (await API.viewer.convertToObjectRuntimeIds(m.id, ext)) || []; }
        catch (e) { log("Muunnos (" + variant + ") epäonnistui mallille " + (m.name || m.id) + ": " + e.message); continue; }
        rids.forEach((rid, j) => { if (Number.isInteger(rid) && rid > 0) items.get(part[j]).refs.push({ modelId: m.id, rid }); });
      }
    }
  }
  const missing = [...items.values()].filter(it => !it.refs.length);
  log("Kohdistus valmis: " + (items.size - missing.length) + "/" + items.size + " löytyi " + models.length + " mallista.");
  if (missing.length) log("Ei löytynyt (max 20): " + missing.slice(0, 20).map(it => hexToIfc(it.hex) + (it.tunnus ? " " + it.tunnus : "")).join(", "));
  updateInfo();
  await apply(true);
}

/* ---- Piirto ---- */
async function apply(force) {
  if (!API || cur == null) return;
  if (applying) { applyAgain = applyAgain || true; if (force) lastState.clear(); return; }
  applying = true;
  try {
    if (force) { lastState.clear(); await setAll(othersStyle()); }
    const groups = {}, counts = { hidden: 0, wip: 0, done: 0, late: 0, none: 0 };
    for (const [k, it] of items) {
      if (!it.refs.length) continue;
      const s = stateOf(it, cur, mode());
      counts[s]++;
      if (lastState.get(k) === s) continue;
      lastState.set(k, s);
      const g = groups[s] || (groups[s] = {});
      for (const r of it.refs) (g[r.modelId] || (g[r.modelId] = [])).push(r.rid);
    }
    for (const s in groups) {
      const sel = { modelObjectIds: Object.entries(groups[s]).map(([modelId, ids]) => ({ modelId, objectRuntimeIds: ids })) };
      await API.viewer.setObjectState(sel, styleOf(s));
    }
    renderLegend(counts);
  } catch (e) { log("Piirtovirhe: " + e.message); }
  finally {
    applying = false;
    if (applyAgain) { applyAgain = false; apply(lastState.size === 0); }
  }
}
function renderLegend(c) {
  $("legend").innerHTML = LEGEND
    .filter(([k]) => k !== "late" || mode() === "compare")
    .map(([k, label, col]) => '<div><span class="sw" style="background:' + col + '"></span>' + label + ": <b>" + c[k] + "</b></div>")
    .join("");
}

/* ---- Toisto ---- */
async function play() {
  if (minDay == null) return;
  if (cur >= maxDay) setDay(minDay);
  playing = true; $("btnPlay").textContent = "⏸ Tauko";
  while (playing && cur < maxDay) {
    setDay(cur + (+$("stepSel").value));
    await apply(false);
    await sleep(+$("speed").value);
  }
  playing = false; $("btnPlay").textContent = "▶ Toista";
}

/* ---- Valinta mallista ---- */
async function selectionObjects() {
  const out = [];
  const sel = (await API.viewer.getSelection()) || [];
  for (const m of sel) {
    const rids = m.objectRuntimeIds || [];
    if (!rids.length) continue;
    const ext = (await API.viewer.convertToObjectIds(m.modelId, rids)) || [];
    ext.forEach((g, i) => { const hex = guidToHex(g); if (hex) out.push({ hex, modelId: m.modelId, rid: rids[i] }); });
  }
  return out;
}

/* ---- CSV-vienti ---- */
function toCSV(list) {
  const lines = ["GUID;Tunnus;Alku;Loppu;Toteutunut"];
  for (const it of list) lines.push([hexToIfc(it.hex), it.tunnus || "",
    it.start != null ? fmt(it.start) : "", it.end != null ? fmt(it.end) : "", it.actual != null ? fmt(it.actual) : ""].join(";"));
  return lines.join("\r\n");
}
function download(csv, name) {
  $("out").value = csv;
  try {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { log("Lataus estetty – kopioi CSV tekstikentästä."); }
}

/* ---- Tapahtumat ---- */
$("file").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  if (!f) return;
  const text = await f.text();
  const res = rowsToItems(parseCSV(text));
  for (const r of res.items) items.set(r.hex, Object.assign(items.get(r.hex) || { refs: [] }, r));
  log("Luettiin " + res.items.length + " riviä tiedostosta " + f.name + (res.skipped ? " (" + res.skipped + " ohitettu: ei kelvollista GUIDia)" : "") +
      (res.headerFound ? "" : " – otsikkoriviä ei tunnistettu, oletus: GUID;Alku;Loppu;Toteutunut"));
  const noDates = res.items.filter(r => r.start == null && r.end == null && r.actual == null).length;
  if (noDates) log(noDates + " riviltä ei löytynyt päivämäärää (tuetut muodot: 15.10.2026, 2026-10-15, Excel-päivä).");
  ev.target.value = "";
  recomputeRange(); save(); await resolve();
});
$("btnResolve").onclick = () => resolve();
$("btnClear").onclick = async () => {
  if (!confirm("Tyhjennetäänkö koko aikataulu tästä projektista?")) return;
  items.clear(); lastState.clear(); save(); recomputeRange(); updateInfo();
  if (API) await setAll({ visible: "reset", color: "reset" });
  $("legend").innerHTML = "";
};
$("btnAssign").onclick = async () => {
  if (!API) return;
  const s = parseDate($("pStart").value), e = parseDate($("pEnd").value), a = parseDate($("pActual").value);
  if (s == null && e == null && a == null) { alert("Anna vähintään yksi päivämäärä."); return; }
  if (s != null && e != null && e < s) { alert("Loppu on ennen alkua."); return; }
  const objs = await selectionObjects();
  if (!objs.length) { alert("Valitse ensin objektit mallista."); return; }
  for (const o of objs) {
    const it = items.get(o.hex) || { hex: o.hex, tunnus: "", start: null, end: null, actual: null, refs: [] };
    if (s != null) it.start = s;
    if (e != null) it.end = e;
    if (a != null) it.actual = a;
    if (!it.refs.some(r => r.modelId === o.modelId && r.rid === o.rid)) it.refs.push({ modelId: o.modelId, rid: o.rid });
    items.set(o.hex, it); lastState.delete(o.hex);
  }
  log("Päivämäärät asetettu " + objs.length + " objektille.");
  recomputeRange(); save(); updateInfo(); await apply(false);
};
$("btnUnassign").onclick = async () => {
  if (!API) return;
  const objs = await selectionObjects();
  let n = 0;
  for (const o of objs) if (items.delete(o.hex)) { n++; lastState.delete(o.hex); }
  log("Poistettu " + n + " objektin aikataulutieto.");
  recomputeRange(); save(); updateInfo(); await apply(true);
};
$("slider").addEventListener("input", () => { if (minDay != null) { setDay(minDay + (+$("slider").value)); apply(false); } });
$("btnPrev").onclick = () => { setDay(cur - (+$("stepSel").value)); apply(false); };
$("btnNext").onclick = () => { setDay(cur + (+$("stepSel").value)); apply(false); };
$("btnPlay").onclick = () => { if (playing) playing = false; else play(); };
$("btnToday").onclick = () => { setDay(Math.floor(Date.now() / DAY)); apply(false); };
$("btnReset").onclick = async () => { playing = false; if (API) await setAll({ visible: "reset", color: "reset" }); lastState.clear(); $("legend").innerHTML = ""; };
$("mode").onchange = () => apply(true);
$("others").onchange = () => apply(true);
$("natural").onchange = () => apply(true);
$("btnExport").onclick = () => download(toCSV([...items.values()]), "tietoa-4d-aikataulu.csv");
$("btnTemplate").onclick = async () => {
  if (!API) return;
  const objs = await selectionObjects();
  if (!objs.length) { alert("Valitse ensin objektit mallista."); return; }
  const seen = new Set(), list = [];
  for (const o of objs) if (!seen.has(o.hex)) { seen.add(o.hex); list.push(items.get(o.hex) || { hex: o.hex, tunnus: "" }); }
  download(toCSV(list), "tietoa-4d-pohja.csv");
  log("CSV-pohja: " + list.length + " objektia.");
};

/* ---- Yhteys Trimble Connectiin ---- */
let resolveTimer = null;
(async () => {
  if (typeof TrimbleConnectWorkspace === "undefined") {
    $("conn").textContent = "Workspace API ei latautunut"; log("Workspace API -skriptiä ei saatu ladattua."); return;
  }
  try {
    API = await TrimbleConnectWorkspace.connect(window.parent, (event, args) => {
      if (/model/i.test(event)) {
        clearTimeout(resolveTimer);
        resolveTimer = setTimeout(() => { if (items.size) resolve(); }, 1500);
      }
    }, 30000);
    $("conn").textContent = "Yhdistetty";
    try {
      const p = API.project.getProject ? await API.project.getProject() : await API.project.getCurrentProject();
      if (p && p.id) { projectKey = "tc4d_" + p.id; $("conn").textContent = p.name || "Yhdistetty"; }
    } catch (e) { log("Projektin tietoja ei saatu – tallennus yhteiseen avaimeen."); }
    loadLocal(); recomputeRange(); updateInfo();
    if (items.size) await resolve();
    log("Valmis. Lataa aikataulu-CSV tai suunnittele valitsemalla objekteja.");
  } catch (e) {
    $("conn").textContent = "Ei yhteyttä";
    log("Yhteys Trimble Connectiin epäonnistui: " + (e && e.message ? e.message : e) + " – avaa laajennus Trimble Connectin 3D-katselimessa.");
  }
})();
