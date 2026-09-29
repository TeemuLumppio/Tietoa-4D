"use strict";
/* Tietoa 4D v2 – Trimble Connect 3D Viewer -laajennus
   Syöttötila: malli värittyy aikataulun mukaan (liukuväri), aikataulutta olevat harmaana.
   Toistotila: rakennus rakentuu aikajanalla / suunniteltu vs. toteutunut.
   Kohdistus: Tocoman-tehtävä (lohko + kerros + rakennusosa) -> mallin ominaisuudet.
   Etusija: käsin annettu > elementtilista (vaihe 2) > Tocoman-sääntö (vaihe 1).
   Data pysyy selaimessa (localStorage) ja työtiedostossa (.json). */

const IFC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const DAY = 86400000;
const WD = ["su", "ma", "ti", "ke", "to", "pe", "la"];
const PCHUNK = 400;

/* ================= Apufunktiot ================= */
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
    if (n >= (1n << 128n)) return null;
    return n.toString(16).padStart(32, "0");
  }
  return null;
}
function hexToIfc(hex) {
  let n = BigInt("0x" + hex), out = "";
  for (let i = 0; i < 22; i++) { out = IFC_CHARS[Number(n % 64n)] + out; n = n / 64n; }
  return out;
}
function isHex(id) { return /^[0-9a-f]{32}$/.test(String(id)); }

function dn(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / DAY); }
function todayDn() { const t = new Date(); return dn(t.getFullYear(), t.getMonth() + 1, t.getDate()); }
function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) { if (isNaN(v.getTime())) return null; return dn(v.getFullYear(), v.getMonth() + 1, v.getDate()); }
  if (typeof v === "number") { if (v > 20000 && v < 80000) return dn(1899, 12, 30) + Math.floor(v); return null; }
  const s = String(v).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return dn(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/))) return dn(+m[3], +m[2], +m[1]);
  if (/^\d{5}([.,]\d+)?$/.test(s)) return dn(1899, 12, 30) + parseInt(s, 10);
  return null;
}
function fmt(d) { if (d == null) return ""; const x = new Date(d * DAY); return x.getUTCDate() + "." + (x.getUTCMonth() + 1) + "." + x.getUTCFullYear(); }
function fmtS(d) { if (d == null) return "?"; const x = new Date(d * DAY); return x.getUTCDate() + "." + (x.getUTCMonth() + 1) + "."; }
function isoDate(d) { return d == null ? "" : new Date(d * DAY).toISOString().slice(0, 10); }
function wday(d) { return new Date(d * DAY).getUTCDay(); }
function isoWeek(d) {
  const t = new Date(d * DAY);
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = t.valueOf();
  t.setUTCMonth(0, 1);
  if (t.getUTCDay() !== 4) t.setUTCMonth(0, 1 + ((4 - t.getUTCDay()) + 7) % 7);
  return 1 + Math.ceil((firstThursday - t) / (7 * DAY));
}
function workdays(a, b) {
  const out = [];
  if (a == null) return out;
  if (b == null || b < a) b = a;
  for (let d = a; d <= b; d++) { const w = wday(d); if (w >= 1 && w <= 5) out.push(d); }
  if (!out.length) out.push(a);
  return out;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function csvCell(v) { const s = String(v == null ? "" : v); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/)[0] || "";
  const cnt = { ";": first.split(";").length, ",": first.split(",").length, "\t": first.split("\t").length };
  const delim = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
  const rows = [];
  let row = [], cur = "", q = false;
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

/* ---- Nimikkeistön yhtenäistys ---- */
function up(s) { return String(s == null ? "" : s).trim().toUpperCase().replace(/\s+/g, " "); }
function normOsa(s) {
  let x = up(s).replace(/ELEMETTI/g, "ELEMENTTI").replace(/^PV\s+/, "PV-");
  if (x === "DELTAT") x = "DELTAPALKIT";
  return x;
}
function splitComps(name) { return up(name).split(/\s*,\s*|\s+JA\s+/).map(normOsa).filter(x => x); }
function kerrosOfName(s) {
  const x = up(s).replace(/\s+/g, "");
  const m = x.match(/^(K|\d+)\.?KRS/);
  if (m) return m[1];
  if (/^KELLARI/.test(x)) return "K";
  return "";
}
function normKerros(s) {
  const k = kerrosOfName(s);
  if (k) return k;
  const x = up(s).replace(/\s+/g, "");
  if (/^(K|\d+)$/.test(x)) return x;
  const m = x.match(/^KRS\.?(\d+)/);
  return m ? m[1] : x;
}
function normLohko(s) {
  let x = up(s);
  const m = x.match(/LOHKO\s*([A-Z0-9ÅÄÖ]+)/);
  if (m) return m[1];
  x = x.replace(/[^A-Z0-9ÅÄÖ]+/g, " ").trim();
  return x.split(" ")[0] || "";
}

/* ---- Tocoman-aikataulun purku ---- */
function parseTocoman(rows) {
  let hi = -1;
  const col = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const h = (rows[i] || []).map(up);
    if (h.indexOf("NIMI") >= 0 && h.indexOf("ALKU") >= 0) {
      hi = i;
      h.forEach((v, j) => { if (v && col[v] == null) col[v] = j; });
      break;
    }
  }
  if (hi < 0) return null;
  const g = (r, k) => (col[k] != null && col[k] < r.length) ? r[col[k]] : null;
  const recs = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = g(r, "NIMI");
    if (name == null || String(name).trim() === "") continue;
    const wr = g(r, "HIER");
    recs.push({
      row: g(r, "RIVI"), wbs: wr == null ? "" : String(wr).replace(/[="'\s]/g, ""),
      name: String(name).trim(), start: parseDate(g(r, "ALKU")), end: parseDate(g(r, "LOPPU")),
      qty: g(r, "MÄÄRÄ"), unit: String(g(r, "YKS") || "").trim(), sij: String(g(r, "SIJAINTI") || "").trim()
    });
  }
  const byW = new Map(), hasChild = new Set();
  for (const r of recs) if (r.wbs) byW.set(r.wbs, r);
  for (const r of recs) if (r.wbs.indexOf(".") > 0) hasChild.add(r.wbs.slice(0, r.wbs.lastIndexOf(".")));
  const parentOf = r => { const i = r.wbs.lastIndexOf("."); return i > 0 ? byW.get(r.wbs.slice(0, i)) : null; };
  const tasks = [];
  for (const r of recs) {
    if (!r.wbs || hasChild.has(r.wbs) || r.start == null) continue;
    if (r.wbs.split(".").length < 2) continue;
    let lohko = r.sij ? normLohko(r.sij) : "", kerros = "";
    const p = parentOf(r);
    let a = p;
    while (a) {
      if (!kerros) kerros = kerrosOfName(a.name);
      if (!lohko && /LOHKO/i.test(a.name)) lohko = normLohko(a.name);
      a = parentOf(a);
    }
    const vaihe = (p && !kerros && !/LOHKO/i.test(p.name)) ? p.name : "";
    const qn = typeof r.qty === "number" ? r.qty : parseFloat(String(r.qty == null ? "" : r.qty).replace(",", "."));
    tasks.push({
      id: "W" + r.wbs, wbs: r.wbs, row: r.row, lohko, kerros, vaihe, name: r.name, comps: splitComps(r.name),
      start: r.start, end: r.end != null ? r.end : r.start, qty: isNaN(qn) ? null : qn, unit: r.unit
    });
  }
  return tasks;
}
function taskLabel(t) {
  return (t.lohko || "–") + " · " + (t.kerros ? t.kerros + ".krs" : (t.vaihe || "–")) + " · " + t.name + " · " + fmtS(t.start) + "–" + fmtS(t.end);
}

/* ---- Nimi -> rakennusosa -ehdotukset ---- */
const RULES = [
  [/ONTELO/, ["ONTELOT"]],
  [/DELTA/, ["DELTAPALKIT"]],
  [/KUORILAAT|KL-?LAAT/, ["KL-LAATAT"]],
  [/SEIN.*ELEMENT|ELEMENT.*SEIN/, ["ELEMENTTISEINÄT"]],
  [/SEIN/, ["PV-SEINÄT", "SEINÄT", "ELEMENTTISEINÄT"]],
  [/PILARI.*(PV|VALU)|(PV|VALU).*PILARI/, ["PV-PILARIT", "PILARIT"]],
  [/PILARI/, ["PILARIT", "PV-PILARIT"]],
  [/PALKKI|PALKIT/, ["PALKIT", "PV-PALKIT", "DELTAPALKIT"]],
  [/HOLVI/, ["HOLVIT", "PV-HOLVI"]],
  [/KONSOL|KONSIL/, ["PV-KONSOLIT", "PV-KONSILOT", "KONSOLIT"]],
  [/ANTURA/, ["ANTURAT"]],
  [/PORRA|PORTA/, ["PORTAAT"]],
  [/PARVEK/, ["PARVEKKEET"]]
];
function lcs(a, b) {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      if (a[i - 1] === b[j - 1]) { prev[j] = diag + 1; if (prev[j] > best) best = prev[j]; }
      else prev[j] = 0;
      diag = tmp;
    }
  }
  return best;
}
function suggest(name, comps) {
  const n = up(name);
  if (!n || !comps.length) return "";
  for (const rule of RULES) {
    if (!rule[0].test(n)) continue;
    for (const c of rule[1]) if (comps.indexOf(c) >= 0) return c;
  }
  const a = n.replace(/[^A-ZÅÄÖ]/g, "");
  let best = "", bl = 0;
  for (const c of comps) { const l = lcs(a, c.replace(/[^A-ZÅÄÖ]/g, "")); if (l > bl) { bl = l; best = c; } }
  return bl >= 5 ? best : "";
}

/* ================= Tila ================= */
const $ = id => document.getElementById(id);
const DEFAULT_PROPS = { lohko: "Elementin lohko", kerros: "Elementin kerros", nimi: "Elementin nimi", tunnus: "Elementin piirustusnumero" };
function freshState() { return { v: 2, tasks: [], key: {}, keyAuto: {}, manual: {}, elem: {}, props: Object.assign({}, DEFAULT_PROPS) }; }
let S = freshState();
let API = null, projectKey = "tc4d2_default";
const objs = new Map();          // "modelId|rid" -> objekti
let taskById = new Map(), tasksByLohko = new Map(), orderDay = new Map();
const nameCounts = new Map();
let selected = [];
const undoStack = [];
let modelRead = false, autoReadTried = false;

function log(msg) {
  const el = $("log");
  el.textContent = "[" + new Date().toLocaleTimeString("fi-FI") + "] " + msg + "\n" + el.textContent.slice(0, 20000);
  console.log("[Tietoa4D]", msg);
}
function busy(msg) { $("busy").textContent = msg || ""; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(projectKey, JSON.stringify(S)); }
    catch (e) { log("Selaimeen tallennus epäonnistui – tallenna työtiedosto (.json)."); }
  }, 300);
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(projectKey);
    if (!raw) return;
    const x = JSON.parse(raw);
    S = Object.assign(freshState(), x);
    S.props = Object.assign({}, DEFAULT_PROPS, x.props || {});
    log("Palautettiin tallennettu työ: " + S.tasks.length + " tehtävää, " + Object.keys(S.manual).length + " käsin korjattua.");
  } catch (e) { /* ei tallennettua työtä */ }
}
function propsToUI() { $("pLohko").value = S.props.lohko; $("pKerros").value = S.props.kerros; $("pNimi").value = S.props.nimi; $("pTunnus").value = S.props.tunnus; }

/* ================= Mallin luku ================= */
function flattenProps(p) {
  const map = {};
  const add = (n, v, set) => {
    if (n == null) return;
    const k = String(n).trim().toLowerCase();
    if (!(k in map)) map[k] = v;
    if (set) map[(String(set) + "." + String(n)).trim().toLowerCase()] = v;
  };
  const walk = (node, set, depth) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) { node.forEach(x => walk(x, set, depth + 1)); return; }
    if (typeof node !== "object") return;
    if ("name" in node && "value" in node && (node.value === null || typeof node.value !== "object")) add(node.name, node.value, set);
    if (Array.isArray(node.properties)) walk(node.properties, (node.name != null && !("value" in node)) ? node.name : set, depth + 1);
  };
  walk(p && p.properties ? p.properties : [], null, 0);
  if (p && p.class) map["class"] = p.class;
  if (p && p.product && p.product.name) map["product.name"] = p.product.name;
  return map;
}
function prop(f, name) {
  if (!name) return "";
  const k = String(name).trim().toLowerCase();
  if (k in f) return f[k];
  for (const kk in f) if (kk.endsWith("." + k)) return f[kk];
  return "";
}
function makeObj(modelId, rid, hex, fields) {
  const f = fields || {};
  const nimi = String(f.nimi || "").trim(), rl = String(f.lohko || "").trim(), rk = String(f.kerros || "").trim(), tun = String(f.tunnus || "").trim();
  return {
    k: modelId + "|" + rid, modelId, rid, id: hex || (modelId + "|" + rid),
    nimi, nimiU: up(nimi), rawLohko: rl, rawKerros: rk, lohko: normLohko(rl), kerros: normKerros(rk),
    tunnus: tun, tunnusKey: up(tun), extra: !fields,
    osa: "", autoTaskId: null, taskId: null, start: null, end: null, actual: null, src: ""
  };
}

async function readModel() {
  if (!API) return;
  busy("Luetaan mallia…");
  objs.clear(); nameCounts.clear();
  let mos = [];
  try { mos = await API.viewer.getObjects(); } catch (e) { log("getObjects: " + (e && e.message ? e.message : e)); }
  mos = Array.isArray(mos) ? mos : [];
  let all = 0;
  mos.forEach(m => { all += (m.objects || []).length; });
  if (!all) { busy(""); log("Mallista ei löytynyt objekteja. Onko malli ladattu katselimeen?"); return; }
  let done = 0, elems = 0;
  for (const mo of mos) {
    const ids = (mo.objects || []).map(x => (typeof x === "number" ? x : (x ? x.id : null))).filter(x => Number.isInteger(x));
    for (let i = 0; i < ids.length; i += PCHUNK) {
      const part = ids.slice(i, i + PCHUNK);
      let props = [], ext = [];
      try { props = (await API.viewer.getObjectProperties(mo.modelId, part)) || []; } catch (e) { log("getObjectProperties: " + (e && e.message ? e.message : e)); }
      try { ext = (await API.viewer.convertToObjectIds(mo.modelId, part)) || []; } catch (e) { /* GUID ei pakollinen */ }
      const pm = new Map();
      props.forEach(p => { if (p && p.id != null) pm.set(p.id, p); });
      part.forEach((rid, j) => {
        const p = pm.get(rid) || props[j];
        if (!p) return;
        const f = flattenProps(p);
        const fields = { nimi: prop(f, S.props.nimi), lohko: prop(f, S.props.lohko), kerros: prop(f, S.props.kerros), tunnus: prop(f, S.props.tunnus) };
        if (!String(fields.nimi || "").trim() && !String(fields.lohko || "").trim() && !String(fields.kerros || "").trim() && !String(fields.tunnus || "").trim()) return;
        const o = makeObj(mo.modelId, rid, guidToHex(ext[j]), fields);
        objs.set(o.k, o);
        elems++;
        if (o.nimiU) nameCounts.set(o.nimiU, (nameCounts.get(o.nimiU) || 0) + 1);
      });
      done += part.length;
      busy("Luetaan mallia… " + Math.round(done * 100 / all) + " %");
    }
  }
  modelRead = true;
  log("Malli luettu: " + all + " objektia, joista " + elems + " elementtitiedoilla, " + nameCounts.size + " eri nimeä.");
  if (!elems) log("Kenttiä \"" + S.props.nimi + "\" / \"" + S.props.lohko + "\" ei löytynyt. Tarkista kenttien nimet kohdasta Asetukset → Näytä valitun ominaisuudet.");
  await resolveOrphans();
  busy("");
  autoSuggest();
  recalc();
  renderKeyTable();
  await render(true);
  refreshSelection();
}

async function resolveOrphans() {
  const have = new Set();
  for (const o of objs.values()) have.add(o.id);
  const miss = Object.keys(S.manual).filter(h => !have.has(h) && isHex(h));
  if (!miss.length) return;
  let models = [];
  try { models = (await API.viewer.getModels("loaded")) || []; } catch (e) { return; }
  let found = 0;
  for (const m of models) {
    const pending = miss.filter(h => !have.has(h));
    for (let i = 0; i < pending.length; i += 1000) {
      const part = pending.slice(i, i + 1000);
      let rids = [];
      try { rids = (await API.viewer.convertToObjectRuntimeIds(m.id, part.map(hexToIfc))) || []; } catch (e) { continue; }
      rids.forEach((rid, j) => {
        if (!Number.isInteger(rid) || rid <= 0) return;
        const o = makeObj(m.id, rid, part[j], null);
        if (!objs.has(o.k)) { objs.set(o.k, o); have.add(part[j]); found++; }
      });
    }
  }
  if (found) log(found + " käsin ajastettua muuta objektia kohdistettiin.");
}

/* ================= Laskenta ================= */
function allComps() { const s = new Set(); S.tasks.forEach(t => t.comps.forEach(c => s.add(c))); return [...s].sort(); }
function autoSuggest() {
  const comps = allComps();
  let changed = false;
  for (const name of nameCounts.keys()) {
    if (S.key[name] != null && !S.keyAuto[name]) continue;
    S.key[name] = suggest(name, comps);
    S.keyAuto[name] = true;
    changed = true;
  }
  if (changed) save();
}
function sortedTasks() {
  return S.tasks.slice().sort((a, b) => (a.lohko || "").localeCompare(b.lohko || "", "fi") || (a.start - b.start) || a.wbs.localeCompare(b.wbs));
}
function findTask(o) {
  if (!o.osa) return null;
  const lists = [tasksByLohko.get(o.lohko) || [], o.lohko ? (tasksByLohko.get("") || []) : []];
  let best = null, bestScore = -1;
  for (const list of lists) for (const t of list) {
    if (t.comps.indexOf(o.osa) < 0) continue;
    let sc;
    if (t.kerros) { if (t.kerros !== o.kerros) continue; sc = 2; } else sc = 1;
    if (sc > bestScore || (sc === bestScore && t.start < best.start)) { best = t; bestScore = sc; }
  }
  return best;
}
function assignTask(o) {
  o.osa = o.nimiU ? (S.key[o.nimiU] || "") : "";
  const t = findTask(o);
  o.autoTaskId = t ? t.id : null;
  const m = S.manual[o.id];
  if (m && m.taskId === "__none") o.taskId = null;
  else if (m && m.taskId && taskById.has(m.taskId)) o.taskId = m.taskId;
  else o.taskId = o.autoTaskId;
}
function distribute() {
  orderDay = new Map();
  const groups = new Map();
  for (const o of objs.values()) {
    const e = o.tunnusKey ? S.elem[o.tunnusKey] : null;
    if (!e || e.order == null || e.start != null || e.end != null || !o.taskId) continue;
    if (!groups.has(o.taskId)) groups.set(o.taskId, new Map());
    groups.get(o.taskId).set(o.tunnusKey, e.order);
  }
  for (const [tid, g] of groups) {
    const t = taskById.get(tid);
    if (!t || t.start == null) continue;
    const days = workdays(t.start, t.end);
    const list = [...g.entries()].sort((a, b) => a[1] - b[1]);
    list.forEach((it, i) => {
      const di = Math.min(days.length - 1, Math.floor(i * days.length / list.length));
      orderDay.set(it[0] + "|" + tid, days[di]);
    });
  }
}
function effDates(o) {
  const m = S.manual[o.id] || {};
  const e = o.tunnusKey ? S.elem[o.tunnusKey] : null;
  const t = o.taskId ? taskById.get(o.taskId) : null;
  let start = null, end = null, src = "";
  if (t) { start = t.start; end = t.end != null ? t.end : t.start; src = (m.taskId && m.taskId !== "__none") ? "käsin" : "sääntö"; }
  const od = (e && o.taskId) ? orderDay.get(o.tunnusKey + "|" + o.taskId) : undefined;
  if (od != null) { start = od; end = od; src = "elementti"; }
  if (e && (e.start != null || e.end != null)) {
    if (e.start != null) start = e.start;
    if (e.end != null) end = e.end; else end = e.start;
    if (start == null) start = end;
    src = "elementti";
  }
  if (m.start != null) { start = m.start; src = "käsin"; if (m.end == null && (end == null || end < start)) end = start; }
  if (m.end != null) { end = m.end; src = "käsin"; if (start == null) start = m.end; }
  o.start = start;
  o.end = end;
  o.actual = m.actual != null ? m.actual : (e && e.actual != null ? e.actual : null);
  o.src = src;
}
function recalc() {
  taskById = new Map();
  tasksByLohko = new Map();
  for (const t of S.tasks) {
    taskById.set(t.id, t);
    const l = t.lohko || "";
    if (!tasksByLohko.has(l)) tasksByLohko.set(l, []);
    tasksByLohko.get(l).push(t);
  }
  for (const o of objs.values()) assignTask(o);
  distribute();
  for (const o of objs.values()) effDates(o);
  recomputeRange();
  updateInfo();
  renderCoverage();
}
function computeOne(o) { assignTask(o); effDates(o); }

function updateInfo() {
  let el = 0, sch = 0, man = 0, act = 0;
  for (const o of objs.values()) {
    if (o.extra && o.start == null && o.actual == null) continue;
    el++;
    if (o.start != null) sch++;
    if (o.src === "käsin") man++;
    if (o.actual != null) act++;
  }
  const parts = [S.tasks.length ? S.tasks.length + " tehtävää" : "Ei aikataulua"];
  if (modelRead) parts.push(el + " elementtiä", sch + " aikataulussa", (el - sch) + " ilman");
  else parts.push("mallia ei luettu");
  if (man) parts.push(man + " käsin korjattu");
  if (act) parts.push(act + " asennettu");
  $("info").textContent = parts.join(" · ");
}

/* ================= Avainkirja ja kohdistusraportti ================= */
function keySummary() {
  const names = [...nameCounts.keys()];
  const auto = names.filter(n => S.keyAuto[n]).length;
  const unm = names.filter(n => !S.key[n]).length;
  $("keySum").textContent = "Avainkirja: " + names.length + " nimeä" + (unm ? " · " + unm + " liittämättä" : "") + (auto ? " · " + auto + " ehdotusta" : "");
}
function renderKeyTable() {
  keySummary();
  const comps = allComps();
  const names = [...nameCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (!names.length) { $("keyTable").innerHTML = '<div class="muted">Lue malli ensin.</div>'; return; }
  const opts = v => '<option value="">— ei aikataulussa —</option>' +
    comps.map(c => '<option value="' + esc(c) + '"' + (c === v ? " selected" : "") + ">" + esc(c) + "</option>").join("");
  $("keyTable").innerHTML = '<table class="tbl">' + names.map(nc =>
    '<tr><td class="' + (S.keyAuto[nc[0]] ? "auto" : "") + '">' + esc(nc[0]) + ' <span class="muted">(' + nc[1] + ')</span></td>' +
    '<td><select data-name="' + esc(nc[0]) + '">' + opts(S.key[nc[0]] || "") + "</select></td></tr>").join("") + "</table>";
  $("keyTable").querySelectorAll("select").forEach(sel => sel.addEventListener("change", () => {
    const n = sel.getAttribute("data-name");
    S.key[n] = sel.value;
    delete S.keyAuto[n];
    const td = sel.closest("tr").querySelector("td");
    if (td) td.className = "";
    save(); keySummary(); recalc(); render(false); showSelection();
  }));
}
function renderCoverage() {
  if (!$("covBox").open) return;
  if (!S.tasks.length || !modelRead) { $("coverage").innerHTML = '<div class="muted">Tarvitaan aikataulu ja luettu malli.</div>'; return; }
  const cnt = new Map(), noTask = new Map(), noKey = new Map();
  for (const o of objs.values()) {
    if (o.extra) continue;
    if (o.taskId) cnt.set(o.taskId, (cnt.get(o.taskId) || 0) + 1);
    else if (o.osa) { const k = (o.lohko || "?") + " / " + (o.kerros || "?") + " / " + o.osa; noTask.set(k, (noTask.get(k) || 0) + 1); }
    else if (o.nimiU) noKey.set(o.nimiU, (noKey.get(o.nimiU) || 0) + 1);
  }
  let h = '<table class="tbl"><tr><th>Tehtävä</th><th>Malli</th><th>Toc.</th></tr>';
  for (const t of sortedTasks()) {
    const m = cnt.get(t.id) || 0;
    const q = /kpl/i.test(t.unit) ? t.qty : null;
    const cls = q == null ? "" : (q === m ? "ok" : "warn");
    const qs = q != null ? String(q) : (t.qty != null ? t.qty + " " + t.unit : "");
    h += '<tr class="' + cls + '" data-task="' + esc(t.id) + '"><td>' + esc(taskLabel(t)) + "</td><td>" + m + "</td><td>" + esc(qs) + "</td></tr>";
  }
  h += "</table>";
  const tbl = (map, attr) => '<table class="tbl">' + [...map.entries()].sort((a, b) => b[1] - a[1])
    .map(e => "<tr " + attr + '="' + esc(e[0]) + '"><td>' + esc(e[0]) + "</td><td>" + e[1] + "</td></tr>").join("") + "</table>";
  if (noTask.size) h += "<h3>Rakennusosa tunnistettu, tehtävää ei löydy (lohko / kerros / osa)</h3>" + tbl(noTask, "data-nt");
  if (noKey.size) h += "<h3>Nimeä ei ole liitetty rakennusosaan</h3>" + tbl(noKey, "data-nk");
  $("coverage").innerHTML = h;
  $("coverage").querySelectorAll("tr[data-task]").forEach(tr => tr.addEventListener("click", () => { const id = tr.getAttribute("data-task"); selectWhere(o => o.taskId === id); }));
  $("coverage").querySelectorAll("tr[data-nt]").forEach(tr => tr.addEventListener("click", () => {
    const k = tr.getAttribute("data-nt");
    selectWhere(o => !o.taskId && o.osa && ((o.lohko || "?") + " / " + (o.kerros || "?") + " / " + o.osa) === k);
  }));
  $("coverage").querySelectorAll("tr[data-nk]").forEach(tr => tr.addEventListener("click", () => { const k = tr.getAttribute("data-nk"); selectWhere(o => !o.osa && o.nimiU === k); }));
}
async function selectWhere(pred) {
  if (!API) return;
  const g = {};
  let n = 0;
  for (const o of objs.values()) if (pred(o)) { (g[o.modelId] || (g[o.modelId] = [])).push(o.rid); n++; }
  if (!n) { log("Ei valittavia objekteja."); return; }
  const sel = { modelObjectIds: Object.keys(g).map(modelId => ({ modelId, objectRuntimeIds: g[modelId] })) };
  try { await API.viewer.setSelection(sel, "set"); log("Valittu " + n + " objektia."); }
  catch (e) { log("setSelection: " + (e && e.message ? e.message : e)); }
  setTimeout(refreshSelection, 300);
}

/* ================= Väritys ================= */
const C = {
  grey: { r: 150, g: 150, b: 150, a: 255 }, magenta: { r: 236, g: 0, b: 140, a: 255 }, ghost: { r: 200, g: 200, b: 200, a: 40 },
  wip: { r: 245, g: 158, b: 11, a: 255 }, done: { r: 22, g: 163, b: 74, a: 255 }, late: { r: 220, g: 38, b: 38, a: 255 },
  future: { r: 125, g: 175, b: 225, a: 255 },
  rule: { r: 37, g: 99, b: 235, a: 255 }, elem: { r: 13, g: 148, b: 136, a: 255 }, manual: { r: 234, g: 88, b: 12, a: 255 }
};
const TASK_PAL = [[31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40], [148, 103, 189], [140, 86, 75], [227, 119, 194], [188, 189, 34], [23, 190, 207], [57, 59, 121], [99, 121, 57], [140, 109, 49]];
const RESET = { visible: "reset", color: "reset" };
const GRAD_STEPS = 24;
function rgbCss(c) { return "rgb(" + c.r + "," + c.g + "," + c.b + ")"; }
function hsv(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return { r: f(5), g: f(3), b: f(1), a: 255 };
}
function gradColor(i) { return hsv(240 * (1 - i / (GRAD_STEPS - 1)), 0.85, 0.92); }
function unschedStyle() {
  const v = $("unsched").value;
  if (v === "magenta") return { visible: true, color: C.magenta };
  if (v === "ghost") return { visible: true, color: C.ghost };
  if (v === "hide") return { visible: false };
  return { visible: true, color: C.grey };
}
function unschedCss() {
  const v = $("unsched").value;
  return v === "magenta" ? rgbCss(C.magenta) : v === "ghost" ? "rgba(200,200,200,.35)" : v === "hide" ? "transparent" : rgbCss(C.grey);
}
async function setAll(style) {
  try { await API.viewer.setObjectState(undefined, style); }
  catch (e) { await API.viewer.setObjectState({}, style); }
}
function addTo(groups, key, style, o) {
  let g = groups.get(key);
  if (!g) { g = { style, ids: {} }; groups.set(key, g); }
  (g.ids[o.modelId] || (g.ids[o.modelId] = [])).push(o.rid);
}
async function applyGroups(groups) {
  for (const g of groups.values()) {
    const sel = { modelObjectIds: Object.keys(g.ids).map(modelId => ({ modelId, objectRuntimeIds: g.ids[modelId] })) };
    if (sel.modelObjectIds.length) await API.viewer.setObjectState(sel, g.style);
  }
}
function sw(col, label, n) { return '<div><span class="sw" style="background:' + rgbCss(col) + '"></span>' + label + ": <b>" + (n || 0) + "</b></div>"; }
function noneRow(n) { return '<div><span class="sw" style="background:' + unschedCss() + '"></span>Ei aikataulua: <b>' + (n || 0) + "</b></div>"; }

async function renderInput() {
  lastState.clear();
  await setAll(unschedStyle());
  const by = $("colorBy").value, today = todayDn();
  const groups = new Map(), cnt = {};
  const inc = k => { cnt[k] = (cnt[k] || 0) + 1; };
  let lo = Infinity, hi = -Infinity;
  for (const o of objs.values()) if (o.start != null) { if (o.start < lo) lo = o.start; if (o.start > hi) hi = o.start; }
  const taskIdx = new Map();
  sortedTasks().forEach((t, i) => taskIdx.set(t.id, i));
  for (const o of objs.values()) {
    if (by === "today") {
      let s = null;
      if (o.actual != null && o.actual <= today) s = "done";
      else if (o.start == null) s = null;
      else if (o.end != null && o.end < today) s = "late";
      else if (o.start <= today) s = "wip";
      else s = "future";
      if (!s) { if (!o.extra) inc("none"); continue; }
      inc(s);
      addTo(groups, s, { visible: true, color: C[s] }, o);
      continue;
    }
    if (o.start == null) { if (!o.extra) inc("none"); continue; }
    if (by === "date") {
      const i = hi > lo ? Math.round((o.start - lo) / (hi - lo) * (GRAD_STEPS - 1)) : 0;
      addTo(groups, "g" + i, { visible: true, color: gradColor(i) }, o);
      inc("sched");
    } else if (by === "task") {
      const i = (o.taskId && taskIdx.has(o.taskId)) ? taskIdx.get(o.taskId) : -1;
      const p = i < 0 ? [120, 120, 200] : TASK_PAL[i % TASK_PAL.length];
      addTo(groups, "t" + i, { visible: true, color: { r: p[0], g: p[1], b: p[2], a: 255 } }, o);
      inc("sched");
    } else {
      const k = o.src === "käsin" ? "manual" : (o.src === "elementti" ? "elem" : "rule");
      addTo(groups, k, { visible: true, color: C[k] }, o);
      inc(k);
    }
  }
  await applyGroups(groups);
  let h = "";
  if (by === "date") {
    if (lo !== Infinity) {
      const stops = [];
      for (let i = 0; i < GRAD_STEPS; i += 3) stops.push(rgbCss(gradColor(i)));
      stops.push(rgbCss(gradColor(GRAD_STEPS - 1)));
      h += '<div class="grad" style="background:linear-gradient(90deg,' + stops.join(",") + ')"></div>' +
        '<div class="gradlbl"><span>' + fmt(lo) + "</span><span>" + fmt(Math.round((lo + hi) / 2)) + "</span><span>" + fmt(hi) + "</span></div>";
    }
    h += "<div>Aikataulussa: <b>" + (cnt.sched || 0) + "</b></div>";
  } else if (by === "task") {
    h += "<div>Jokainen tehtävä omalla värillään (" + (cnt.sched || 0) + " objektia). Valitse objekti nähdäksesi tehtävän.</div>";
  } else if (by === "source") {
    h += sw(C.rule, "Tocoman-sääntö", cnt.rule) + sw(C.elem, "Elementtilista", cnt.elem) + sw(C.manual, "Käsin annettu", cnt.manual);
  } else {
    h += sw(C.done, "Asennettu", cnt.done) + sw(C.late, "Myöhässä", cnt.late) + sw(C.wip, "Työn alla", cnt.wip) + sw(C.future, "Tulossa", cnt.future);
  }
  $("legend").innerHTML = h + noneRow(cnt.none);
}

/* ---- Toisto ---- */
const lastState = new Map();
let minDay = null, maxDay = null, cur = null, playing = false;
function recomputeRange() {
  let lo = Infinity, hi = -Infinity;
  for (const o of objs.values()) for (const d of [o.start, o.end, o.actual]) if (d != null) { if (d < lo) lo = d; if (d > hi) hi = d; }
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
function updateLabel() { $("dateLabel").textContent = cur == null ? "–" : WD[wday(cur)] + " " + fmt(cur) + "  ·  vk " + isoWeek(cur); }
function stateOf(o, d, mode) {
  const ps = o.start, pe = o.end != null ? o.end : o.start;
  if (mode === "compare") {
    if (o.actual != null && d >= o.actual) return "done";
    if (ps == null) return o.actual != null ? "hidden" : "none";
    if (d > pe) return "late";
    if (d >= ps) return "wip";
    return "hidden";
  }
  if (ps == null) return o.actual != null ? (d >= o.actual ? "done" : "hidden") : "none";
  if (d < ps) return "hidden";
  if (d < pe) return "wip";
  return "done";
}
function playStyle(s) {
  if (s === "hidden") return { visible: false };
  if (s === "wip") return { visible: true, color: C.wip };
  if (s === "late") return { visible: true, color: C.late };
  return ($("playMode").value === "plan" && $("natural").checked) ? { visible: true, color: "reset" } : { visible: true, color: C.done };
}
async function renderPlay(force) {
  if (cur == null) recomputeRange();
  if (cur == null) {
    await setAll(unschedStyle());
    $("legend").innerHTML = '<div class="muted">Ei päivämääriä toistettavaksi.</div>';
    return;
  }
  if (force) { lastState.clear(); await setAll(unschedStyle()); }
  const mode = $("playMode").value;
  const groups = new Map(), cnt = { hidden: 0, wip: 0, done: 0, late: 0, none: 0 };
  for (const o of objs.values()) {
    const s = stateOf(o, cur, mode);
    if (!(s === "none" && o.extra)) cnt[s]++;
    if (s === "none") {
      if (lastState.has(o.k)) { lastState.delete(o.k); addTo(groups, "none", unschedStyle(), o); }
      continue;
    }
    if (lastState.get(o.k) === s) continue;
    lastState.set(o.k, s);
    addTo(groups, s, playStyle(s), o);
  }
  await applyGroups(groups);
  let h = '<div><span class="sw" style="background:#fff"></span>Tulossa (piilossa): <b>' + cnt.hidden + "</b></div>" + sw(C.wip, "Työn alla", cnt.wip);
  h += (mode === "plan" && $("natural").checked) ? '<div><span class="sw" style="background:#ddd"></span>Valmis (oma väri): <b>' + cnt.done + "</b></div>" : sw(C.done, "Valmis", cnt.done);
  if (mode === "compare") h += sw(C.late, "Myöhässä", cnt.late);
  $("legend").innerHTML = h + noneRow(cnt.none);
}
async function play() {
  if (minDay == null) return;
  if (cur >= maxDay) setDay(minDay);
  playing = true;
  $("btnPlay").textContent = "⏸ Tauko";
  while (playing && cur < maxDay && viewMode() === "play") {
    setDay(cur + (+$("stepSel").value));
    await render(false);
    await sleep(+$("speed").value);
  }
  playing = false;
  $("btnPlay").textContent = "▶ Toista";
}

/* ---- Piirron ohjaus ---- */
let rendering = false, again = false, againForce = false, offApplied = false;
function viewMode() { const r = document.querySelector('input[name="vm"]:checked'); return r ? r.value : "input"; }
async function render(force) {
  if (!API) return;
  if (rendering) { again = true; againForce = againForce || !!force; return; }
  rendering = true;
  try {
    if (!$("colorOn").checked) {
      if (!offApplied || force) { await setAll(RESET); lastState.clear(); offApplied = true; }
      $("legend").innerHTML = '<div class="muted">Väritys pois päältä – malli omilla väreillään.</div>';
    } else {
      offApplied = false;
      if (viewMode() === "input") await renderInput();
      else await renderPlay(force);
    }
  } catch (e) { log("Piirtovirhe: " + (e && e.message ? e.message : e)); }
  finally {
    rendering = false;
    if (again) { const f = againForce; again = false; againForce = false; render(f); }
  }
}

/* ================= Valinta ja muokkaus ================= */
async function refreshSelection() {
  if (!API) return;
  let sel = [];
  try { sel = (await API.viewer.getSelection()) || []; } catch (e) { return; }
  const out = [];
  for (const m of sel) {
    const rids = m.objectRuntimeIds || [];
    const unknown = [];
    for (const rid of rids) { const o = objs.get(m.modelId + "|" + rid); if (o) out.push(o); else unknown.push(rid); }
    if (unknown.length && unknown.length <= 5000) {
      let ext = [];
      try { ext = (await API.viewer.convertToObjectIds(m.modelId, unknown)) || []; } catch (e) { /* ei GUIDia */ }
      unknown.forEach((rid, j) => {
        const o = makeObj(m.modelId, rid, guidToHex(ext[j]), null);
        objs.set(o.k, o);
        computeOne(o);
        out.push(o);
      });
    }
  }
  selected = out;
  showSelection();
}
function common(arr, f) {
  if (!arr.length) return undefined;
  const v = f(arr[0]);
  for (let i = 1; i < arr.length; i++) if (f(arr[i]) !== v) return undefined;
  return v;
}
function uniqById(arr) { const seen = new Set(); return arr.filter(o => (seen.has(o.id) ? false : (seen.add(o.id), true))); }
function reason(o) {
  const m = S.manual[o.id];
  if (m && m.taskId === "__none") return "poistettu aikataulusta käsin";
  if (!S.tasks.length) return "aikataulua ei ole ladattu";
  if (!o.nimiU) return o.extra ? "objektilla ei ole elementtitietoja" : "ei elementtinimeä";
  if (!o.osa) return "nimeä \"" + o.nimi + "\" ei ole liitetty rakennusosaan (avainkirja)";
  return "ei tehtävää: lohko " + (o.lohko || "?") + ", kerros " + (o.kerros || "?") + ", " + o.osa;
}
function setEditEnabled(b) { ["eTask", "eStart", "eEnd", "eActual", "btnSave", "btnInstalled", "btnRevert"].forEach(id => { $(id).disabled = !b; }); }
function clearDirty() { ["eTask", "eStart", "eEnd", "eActual"].forEach(id => { $(id).dataset.dirty = ""; $(id).classList.remove("dirty"); }); }
function showSelection() {
  clearDirty();
  const n = selected.length;
  if (!n) {
    $("selInfo").innerHTML = "Valitse objekteja mallista.";
    $("eStart").value = ""; $("eEnd").value = ""; $("eActual").value = ""; $("eTask").value = "";
    setEditEnabled(false);
    return;
  }
  setEditEnabled(true);
  const cs = common(selected, o => o.start), ce = common(selected, o => o.end), ca = common(selected, o => o.actual), ct = common(selected, o => o.taskId || "");
  $("eStart").value = cs == null ? "" : isoDate(cs);
  $("eEnd").value = ce == null ? "" : isoDate(ce);
  $("eActual").value = ca == null ? "" : isoDate(ca);
  $("eTask").value = ct === undefined ? "__multi" : ct;
  if ($("eTask").selectedIndex < 0) $("eTask").value = "";
  if (n === 1) {
    const o = selected[0];
    const t = o.taskId ? taskById.get(o.taskId) : null;
    const row = (k, v) => "<tr><td>" + k + "</td><td>" + esc(v) + "</td></tr>";
    $("selInfo").innerHTML = '<table class="tbl kv">' +
      row("Nimi", o.nimi || "–") + row("Lohko / kerros", (o.rawLohko || "–") + " / " + (o.rawKerros || "–")) +
      row("Tunnus", o.tunnus || "–") + row("Rakennusosa", o.osa || "–") +
      row("Tehtävä", t ? taskLabel(t) : "– (" + reason(o) + ")") +
      row("Aikataulu", o.start != null ? fmt(o.start) + " – " + fmt(o.end) + " (" + o.src + ")" : "–") +
      row("Toteutunut", o.actual != null ? fmt(o.actual) : "–") + "</table>";
  } else {
    const diff = [];
    if (cs === undefined || ce === undefined) diff.push("päivät");
    if (ct === undefined) diff.push("tehtävät");
    if (ca === undefined) diff.push("toteumat");
    const noSch = selected.filter(o => o.start == null).length;
    $("selInfo").innerHTML = "<b>" + n + " objektia valittu</b>" + (diff.length ? '<div class="muted">Eroavat: ' + diff.join(", ") + " – tyhjä kenttä = useita arvoja</div>" : "") +
      (noSch ? '<div class="muted">' + noSch + " ilman aikataulua</div>" : "");
  }
}
function fillTaskSelect() {
  const groups = new Map();
  for (const t of sortedTasks()) { const l = t.lohko || "–"; if (!groups.has(l)) groups.set(l, []); groups.get(l).push(t); }
  let h = '<option value="">— sääntö —</option><option value="__none">Ei aikataulua (poista)</option><option value="__multi" disabled>(useita eri tehtäviä)</option>';
  for (const [l, ts] of groups) h += '<optgroup label="Lohko ' + esc(l) + '">' + ts.map(t => '<option value="' + esc(t.id) + '">' + esc(taskLabel(t)) + "</option>").join("") + "</optgroup>";
  $("eTask").innerHTML = h;
}
function pushUndo(list) {
  const before = {};
  uniqById(list).forEach(o => { before[o.id] = S.manual[o.id] ? JSON.parse(JSON.stringify(S.manual[o.id])) : null; });
  undoStack.push(before);
  if (undoStack.length > 50) undoStack.shift();
}
function cleanManual(id) { const m = S.manual[id]; if (m && m.start == null && m.end == null && m.actual == null && !m.taskId) delete S.manual[id]; }
function afterEdit(msg) { save(); recalc(); render(false); showSelection(); log(msg); }
function isDirty(id) { return $(id).dataset.dirty === "1"; }

function saveEdits() {
  if (!selected.length) return;
  if (!isDirty("eStart") && !isDirty("eEnd") && !isDirty("eActual") && !isDirty("eTask")) { log("Ei muutettuja kenttiä."); return; }
  const s = parseDate($("eStart").value), e = parseDate($("eEnd").value), a = parseDate($("eActual").value), tv = $("eTask").value;
  const sEff = isDirty("eStart") ? s : common(selected, o => o.start);
  const eEff = isDirty("eEnd") ? e : common(selected, o => o.end);
  if (sEff != null && eEff != null && eEff < sEff) { alert("Loppu on ennen alkua."); return; }
  pushUndo(selected);
  const list = uniqById(selected);
  for (const o of list) {
    const m = S.manual[o.id] || (S.manual[o.id] = {});
    if (isDirty("eTask") && tv !== "__multi") { if (tv) m.taskId = tv; else delete m.taskId; }
    if (isDirty("eStart")) { if (s != null) m.start = s; else delete m.start; }
    if (isDirty("eEnd")) { if (e != null) m.end = e; else delete m.end; }
    if (isDirty("eActual")) { if (a != null) m.actual = a; else delete m.actual; }
    cleanManual(o.id);
  }
  afterEdit("Tallennettu " + list.length + " objektille.");
}
function markInstalled() {
  if (!selected.length) return;
  const a = parseDate($("eActual").value);
  const day = (a != null && isDirty("eActual")) ? a : todayDn();
  pushUndo(selected);
  const list = uniqById(selected);
  for (const o of list) (S.manual[o.id] || (S.manual[o.id] = {})).actual = day;
  afterEdit("Merkitty asennetuksi " + fmt(day) + ": " + list.length + " objektia.");
}
function revertSelected() {
  if (!selected.length) return;
  pushUndo(selected);
  const list = uniqById(selected);
  let n = 0;
  for (const o of list) if (S.manual[o.id]) { delete S.manual[o.id]; n++; }
  afterEdit("Palautettu sääntöön: " + n + " objektia.");
}
function undo() {
  const before = undoStack.pop();
  if (!before) { log("Ei kumottavaa."); return; }
  for (const id of Object.keys(before)) { if (before[id]) S.manual[id] = before[id]; else delete S.manual[id]; }
  afterEdit("Kumottu (" + Object.keys(before).length + " objektia).");
}

/* ================= Tuonti ================= */
const ALIAS = {
  guid: ["guid", "ifcguid", "ifc guid", "globalid"],
  tunnus: ["tunnus", "elementtitunnus", "piirustusnumero", "elementin piirustusnumero"],
  order: ["järjestys", "asennusjärjestys", "jarjestys", "order"],
  start: ["alku", "suunniteltu alku", "asennuspvm", "suunniteltu pvm", "pvm", "planned_start", "planned_start_e", "planned_start_f", "planned_start_d"],
  end: ["loppu", "suunniteltu loppu", "planned_end"],
  actual: ["toteutunut", "asennettu", "toteutunut pvm", "actual_end", "actual_end_e", "actual_end_f", "actual_end_d"]
};
function findCol(hdr, list) { for (const a of list) { const i = hdr.indexOf(a); if (i >= 0) return i; } return -1; }

function importRows(rows, fname) {
  if (!rows || !rows.length) return false;
  const tasks = parseTocoman(rows);
  if (tasks && tasks.length) { importTasks(tasks, fname); return true; }
  const hdr = (rows[0] || []).map(x => String(x == null ? "" : x).trim().toLowerCase());
  const hasVal = ["order", "start", "end", "actual"].some(k => findCol(hdr, ALIAS[k]) >= 0);
  if (findCol(hdr, ALIAS.tunnus) >= 0 && hasVal) { importElems(rows, hdr, fname); return true; }
  if (findCol(hdr, ALIAS.guid) >= 0 || guidToHex((rows[0] || [])[0]) || guidToHex((rows[1] || [])[0])) { importGuidRows(rows, hdr, fname); return true; }
  return false;
}
function importTasks(tasks, fname) {
  const had = S.tasks.length;
  S.tasks = tasks;
  const comps = allComps();
  for (const n of Object.keys(S.key)) if (S.keyAuto[n]) S.key[n] = suggest(n, comps);
  for (const n of nameCounts.keys()) if (S.key[n] == null) { S.key[n] = suggest(n, comps); S.keyAuto[n] = true; }
  const ids = new Set(tasks.map(t => t.id));
  const orphan = Object.values(S.manual).filter(m => m.taskId && m.taskId !== "__none" && !ids.has(m.taskId)).length;
  save(); fillTaskSelect(); recalc(); renderKeyTable(); render(true);
  const lohkot = [...new Set(tasks.map(t => t.lohko).filter(x => x))].join(", ");
  log("Tocoman-aikataulu " + fname + ": " + tasks.length + " tehtävää (lohkot " + lohkot + ")" + (had ? ", korvasi aiemman" : "") + "." +
    (orphan ? " " + orphan + " käsin valittua tehtävää ei enää löydy – ne palaavat sääntöön." : ""));
  if (!modelRead) log("Paina seuraavaksi \"Lue malli\".");
}
function importElems(rows, hdr, fname) {
  const ci = { t: findCol(hdr, ALIAS.tunnus), o: findCol(hdr, ALIAS.order), s: findCol(hdr, ALIAS.start), e: findCol(hdr, ALIAS.end), a: findCol(hdr, ALIAS.actual) };
  const keys = new Set();
  for (const o of objs.values()) if (o.tunnusKey) keys.add(o.tunnusKey);
  let n = 0, cleared = 0, match = 0;
  for (const r of rows.slice(1)) {
    const g = i => (i >= 0 && i < r.length) ? r[i] : null;
    const key = up(g(ci.t));
    if (!key) continue;
    const ov = g(ci.o);
    const ord = (ov == null || String(ov).trim() === "") ? null : parseFloat(String(ov).replace(",", "."));
    const e = { order: (ord == null || isNaN(ord)) ? null : ord, start: parseDate(g(ci.s)), end: parseDate(g(ci.e)), actual: parseDate(g(ci.a)) };
    if (e.order == null && e.start == null && e.end == null && e.actual == null) { if (S.elem[key]) { delete S.elem[key]; cleared++; } continue; }
    S.elem[key] = e;
    n++;
    if (keys.has(key)) match++;
  }
  save(); recalc(); render(true); showSelection();
  log("Elementtilista " + fname + ": " + n + " elementtiä" + (modelRead ? ", joista " + match + " löytyi mallista" : "") + (cleared ? ", " + cleared + " tyhjennetty" : "") + ".");
}
function importGuidRows(rows, hdr, fname) {
  let gi = findCol(hdr, ALIAS.guid), si, ei, ai, body;
  if (gi >= 0) { si = findCol(hdr, ALIAS.start); ei = findCol(hdr, ALIAS.end); ai = findCol(hdr, ALIAS.actual); body = rows.slice(1); }
  else { gi = 0; si = 1; ei = 2; ai = 3; body = guidToHex((rows[0] || [])[0]) ? rows : rows.slice(1); }
  let n = 0;
  for (const r of body) {
    const hex = guidToHex(r[gi]);
    if (!hex) continue;
    const g = i => (i >= 0 && i < r.length) ? r[i] : null;
    const s = parseDate(g(si)), e = parseDate(g(ei)), a = parseDate(g(ai));
    if (s == null && e == null && a == null) continue;
    const m = S.manual[hex] || (S.manual[hex] = {});
    if (s != null) m.start = s;
    if (e != null) m.end = e;
    if (a != null) m.actual = a;
    n++;
  }
  save();
  log("GUID-tiedosto " + fname + ": " + n + " riviä tuotu käsin annettuina.");
  const done = () => { recalc(); render(true); showSelection(); };
  if (modelRead) resolveOrphans().then(done); else done();
}
function importWork(x) {
  if (!x || !Array.isArray(x.tasks)) { alert("Tiedosto ei ole Tietoa 4D -työtiedosto."); return; }
  if (!confirm("Korvataanko nykyinen työ työtiedostolla (" + x.tasks.length + " tehtävää, " + Object.keys(x.manual || {}).length + " käsin korjattua)?")) return;
  S = Object.assign(freshState(), x);
  S.props = Object.assign({}, DEFAULT_PROPS, x.props || {});
  delete S.savedAt;
  save(); propsToUI(); fillTaskSelect();
  log("Työtiedosto avattu.");
  if (API && modelRead) readModel(); else { recalc(); render(true); }
}

/* ================= Vienti ================= */
function download(text, name, mime) {
  $("out").value = text.length > 200000 ? text.slice(0, 200000) + "\n…" : text;
  try {
    const isCsv = !mime;
    const blob = new Blob([(isCsv ? "\uFEFF" : "") + text], { type: (mime || "text/csv") + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { log("Lataus estetty – kopioi sisältö tekstikentästä."); }
}
function exportSchedule() {
  const lines = ["GUID;Tunnus;Nimi;Lohko;Kerros;Rakennusosa;Tehtävä;Suunniteltu alku (laskettu);Suunniteltu loppu (laskettu);Toteutunut (laskettu);Lähde"];
  const seen = new Set();
  for (const o of objs.values()) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    if (o.extra && o.start == null && o.actual == null) continue;
    const t = o.taskId ? taskById.get(o.taskId) : null;
    lines.push([isHex(o.id) ? hexToIfc(o.id) : "", o.tunnus, o.nimi, o.rawLohko, o.rawKerros, o.osa, t ? taskLabel(t) : "", fmt(o.start), fmt(o.end), fmt(o.actual), o.src].map(csvCell).join(";"));
  }
  download(lines.join("\r\n"), "tietoa-4d-aikataulu.csv");
  log("Aikataulu viety: " + (lines.length - 1) + " riviä.");
}
function exportElemTemplate() {
  const by = new Map();
  for (const o of objs.values()) if (o.tunnusKey && !by.has(o.tunnusKey)) by.set(o.tunnusKey, o);
  if (!by.size) { alert("Mallista ei löytynyt elementtitunnuksia (kenttä \"" + S.props.tunnus + "\"). Lue malli ensin."); return; }
  const list = [...by.values()].sort((a, b) => ((a.start == null ? 1e9 : a.start) - (b.start == null ? 1e9 : b.start)) || a.tunnus.localeCompare(b.tunnus, "fi"));
  const lines = ["Tunnus;Nimi;Lohko;Kerros;Tehtävä;Tehtävän alku;Tehtävän loppu;Järjestys;Alku;Loppu;Toteutunut"];
  for (const o of list) {
    const t = o.taskId ? taskById.get(o.taskId) : null;
    const e = S.elem[o.tunnusKey] || {};
    lines.push([o.tunnus, o.nimi, o.rawLohko, o.rawKerros, t ? t.name : "", t ? fmt(t.start) : "", t ? fmt(t.end) : "",
      e.order == null ? "" : e.order, fmt(e.start), fmt(e.end), fmt(e.actual)].map(csvCell).join(";"));
  }
  download(lines.join("\r\n"), "tietoa-4d-elementit.csv");
  log("Elementtipohja: " + list.length + " elementtiä. Täytä Järjestys TAI Alku/Loppu ja tuo tiedosto takaisin.");
}
function saveWork() {
  download(JSON.stringify(Object.assign({ savedAt: new Date().toISOString() }, S)), "tietoa-4d-tyotiedosto.json", "application/json");
  log("Työtiedosto tallennettu. Vie se projektin kansioon, jotta muut voivat avata sen.");
}

/* ---- Kokeellinen: toteuma Status Sharingin väreistä ---- */
const SS = [["None", 128, 128, 140], ["Enable", 31, 119, 180], ["Commit", 15, 60, 110], ["Started", 250, 175, 40], ["Paused", 170, 30, 40], ["Completed", 0, 104, 55]];
function toRgb(c) {
  if (!c) return null;
  if (typeof c === "string") { const m = c.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i); return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null; }
  if (typeof c === "object" && c.r != null) return c;
  return null;
}
function nearestSS(c) {
  const x = toRgb(c);
  if (!x) return "?";
  let best = "?", bd = Infinity;
  for (const s of SS) { const d = (x.r - s[1]) ** 2 + (x.g - s[2]) ** 2 + (x.b - s[3]) ** 2; if (d < bd) { bd = d; best = s[0]; } }
  return best;
}
async function importSS() {
  if (!API) return;
  if (typeof API.viewer.getColoredObjects !== "function") {
    log("Kokeellinen: getColoredObjects ei ole saatavilla tässä Workspace API -versiossa – Status Sharingin toteumaa ei voi lukea tätä kautta.");
    return;
  }
  if (!confirm("1) Kytke tämän laajennuksen \"Väritä malli\" pois.\n2) Kytke Status Sharingissa \"Väritä tilat mallissa\" päälle.\n3) Paina OK.\nCompleted-tilaiset saavat toteutuneeksi Toteutunut-kentän päivän tai tämän päivän.")) return;
  let res;
  try { res = await API.viewer.getColoredObjects(); } catch (e) { log("getColoredObjects: " + (e && e.message ? e.message : e)); return; }
  log("Kokeellinen: värivastaus (alku): " + JSON.stringify(res).slice(0, 400));
  const day = parseDate($("eActual").value) != null ? parseDate($("eActual").value) : todayDn();
  const counts = {}, before = {};
  let setN = 0;
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const moi = node.modelObjectIds || node.objects;
    if (node.color && Array.isArray(moi)) {
      const st = nearestSS(node.color);
      for (const mo of moi) for (const rid of (mo.objectRuntimeIds || [])) {
        counts[st] = (counts[st] || 0) + 1;
        if (st !== "Completed") continue;
        const o = objs.get(mo.modelId + "|" + rid);
        if (!o) continue;
        if (!(o.id in before)) before[o.id] = S.manual[o.id] ? JSON.parse(JSON.stringify(S.manual[o.id])) : null;
        const m = S.manual[o.id] || (S.manual[o.id] = {});
        if (m.actual == null) { m.actual = day; setN++; }
      }
      return;
    }
    Object.keys(node).forEach(k => visit(node[k]));
  };
  visit(res);
  if (Object.keys(before).length) { undoStack.push(before); if (undoStack.length > 50) undoStack.shift(); }
  log("Kokeellinen: tilat " + JSON.stringify(counts) + " → " + setN + " uutta toteumaa (" + fmt(day) + ").");
  save(); recalc(); $("colorOn").checked = true; render(true); showSelection();
}

/* ---- Ominaisuuksien näyttö ---- */
async function showProps() {
  if (!API) return;
  let sel = [];
  try { sel = (await API.viewer.getSelection()) || []; } catch (e) { /* ei valintaa */ }
  const m = sel.find(x => (x.objectRuntimeIds || []).length);
  if (!m) { alert("Valitse ensin yksi objekti mallista."); return; }
  let p = [];
  try { p = (await API.viewer.getObjectProperties(m.modelId, [m.objectRuntimeIds[0]])) || []; }
  catch (e) { log("getObjectProperties: " + (e && e.message ? e.message : e)); return; }
  const f = flattenProps(p[0] || {});
  const lines = Object.keys(f).filter(k => k.indexOf(".") < 0 || k === "product.name").sort().map(k => k + " = " + f[k]);
  $("out").value = lines.join("\n");
  log("Valitun objektin ominaisuudet (" + lines.length + ") näkyvät kohdan 4 tekstikentässä.");
}

/* ================= Tapahtumat ================= */
$("file").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  try {
    const name = f.name.toLowerCase();
    if (name.endsWith(".json")) { importWork(JSON.parse(await f.text())); return; }
    let ok = false;
    if (/\.xlsx?$/.test(name)) {
      if (typeof XLSX === "undefined") { alert("Excel-lukija ei latautunut. Tallenna tiedosto CSV:ksi ja yritä uudelleen."); return; }
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      for (const sn of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
        if (importRows(rows, f.name + " / " + sn)) { ok = true; break; }
      }
    } else ok = importRows(parseCSV(await f.text()), f.name);
    if (!ok) { log("Tiedostoa " + f.name + " ei tunnistettu (Tocoman: Nimi+Alku, elementtilista: Tunnus+Järjestys/Alku, tai GUID)."); alert("Tiedoston muotoa ei tunnistettu – katso loki."); }
  } catch (e) { log("Tuonti epäonnistui: " + (e && e.message ? e.message : e)); alert("Tiedoston luku epäonnistui – katso loki."); }
});
$("btnRead").onclick = () => readModel();
$("btnClearAll").onclick = async () => {
  if (!confirm("Tyhjennetäänkö koko työ tästä projektista (aikataulu, avainkirja, elementtilista ja käsin korjaukset)? Tallenna työtiedosto ensin, jos haluat säilyttää ne.")) return;
  const props = S.props;
  S = freshState(); S.props = props;
  undoStack.length = 0;
  save(); fillTaskSelect(); autoSuggest(); recalc(); renderKeyTable(); render(true); showSelection();
  log("Työ tyhjennetty.");
};
$("btnSaveProps").onclick = () => {
  S.props = { lohko: $("pLohko").value.trim(), kerros: $("pKerros").value.trim(), nimi: $("pNimi").value.trim(), tunnus: $("pTunnus").value.trim() };
  save(); readModel();
};
$("btnShowProps").onclick = () => showProps();
$("covBox").addEventListener("toggle", () => renderCoverage());
$("colorOn").addEventListener("change", () => { offApplied = false; render(true); });
document.querySelectorAll('input[name="vm"]').forEach(r => r.addEventListener("change", () => {
  const p = viewMode() === "play";
  $("playPanel").hidden = !p;
  $("inputPanel").hidden = p;
  playing = false;
  recomputeRange();
  render(true);
}));
$("unsched").onchange = () => render(true);
$("colorBy").onchange = () => render(true);
$("playMode").onchange = () => render(true);
$("natural").onchange = () => render(true);
$("slider").addEventListener("input", () => { if (minDay != null) { setDay(minDay + (+$("slider").value)); render(false); } });
$("btnPrev").onclick = () => { if (cur != null) { setDay(cur - (+$("stepSel").value)); render(false); } };
$("btnNext").onclick = () => { if (cur != null) { setDay(cur + (+$("stepSel").value)); render(false); } };
$("btnPlay").onclick = () => { if (playing) playing = false; else play(); };
$("btnToday").onclick = () => { setDay(todayDn()); render(false); };
["eTask", "eStart", "eEnd", "eActual"].forEach(id => {
  const mark = () => { $(id).dataset.dirty = "1"; $(id).classList.add("dirty"); };
  $(id).addEventListener("input", mark);
  $(id).addEventListener("change", mark);
});
$("btnSave").onclick = saveEdits;
$("btnInstalled").onclick = markInstalled;
$("btnRevert").onclick = revertSelected;
$("btnUndo").onclick = undo;
$("btnSelMissing").onclick = () => selectWhere(o => !o.extra && o.start == null);
$("btnExport").onclick = exportSchedule;
$("btnElemTpl").onclick = exportElemTemplate;
$("btnSaveWork").onclick = saveWork;
$("btnSS").onclick = importSS;

/* ================= Yhteys Trimble Connectiin ================= */
let selTimer = null, modelTimer = null;
(async () => {
  setEditEnabled(false);
  fillTaskSelect();
  if (typeof TrimbleConnectWorkspace === "undefined") {
    $("conn").textContent = "Workspace API ei latautunut";
    log("Workspace API -skriptiä ei saatu ladattua.");
    return;
  }
  try {
    API = await TrimbleConnectWorkspace.connect(window.parent, (event) => {
      const ev = String(event || "");
      if (/selection/i.test(ev)) { clearTimeout(selTimer); selTimer = setTimeout(refreshSelection, 250); }
      else if (/model/i.test(ev) && !modelRead && !autoReadTried && S.tasks.length) {
        clearTimeout(modelTimer);
        modelTimer = setTimeout(() => { if (!modelRead && !autoReadTried) { autoReadTried = true; readModel(); } }, 2500);
      }
    }, 30000);
    $("conn").textContent = "Yhdistetty";
    try {
      const p = API.project.getProject ? await API.project.getProject() : await API.project.getCurrentProject();
      if (p && p.id) { projectKey = "tc4d2_" + p.id; $("conn").textContent = p.name || "Yhdistetty"; }
    } catch (e) { log("Projektin tietoja ei saatu – tallennus yhteiseen avaimeen."); }
    loadLocal();
    propsToUI();
    fillTaskSelect();
    recalc();
    if (S.tasks.length) setTimeout(() => { if (!modelRead) { autoReadTried = true; readModel(); } }, 800);
    else log("Valmis. Lataa Tocoman-aikataulu (xlsx) ja paina \"Lue malli\".");
  } catch (e) {
    $("conn").textContent = "Ei yhteyttä";
    log("Yhteys Trimble Connectiin epäonnistui: " + (e && e.message ? e.message : e) + " – avaa laajennus Trimble Connectin 3D-katselimessa.");
  }
})();
