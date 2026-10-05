/* ペット記録アプリ: Firebase(Firestore)で家族の端末間共有。Googleログイン+許可アカウントのみ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCf5xUoXkyMgZtf37r7Cq7pcLsrqoc6KeM",
  authDomain: "pet-record-67258.firebaseapp.com",
  projectId: "pet-record-67258",
  storageBucket: "pet-record-67258.firebasestorage.app",
  messagingSenderId: "465696836186",
  appId: "1:465696836186:web:3ed8a522ca3918863c6663"
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const fs = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const petsCol = collection(fs, "pets"), recsCol = collection(fs, "records"), photosCol = collection(fs, "photos");

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (n) => `<svg><use href="#i-${n}"/></svg>`;
const WD = ["日", "月", "火", "水", "木", "金", "土"];

/* ---------- 状態 ---------- */
let pets = [], records = [], user = null, denied = false, loaded = { pets: false, records: false }, unsubs = [];
let curPet = null, tab = "home", range = "3m", photoLimit = 30, timelineLimit = 20;
try { curPet = localStorage.getItem("curPet") || null; tab = localStorage.getItem("tab") || "home"; } catch (e) {}

const byName = () => (user && (user.displayName || user.email || "")).split(/[\s@]/)[0] || "";
const petRecs = (type) => records.filter((r) => r.petId === curPet && (!type || r.type === type)).sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
const pet = () => pets.find((p) => p.id === curPet);
const strip = (o) => { const c = { ...o }; delete c.id; return c; };
const fail = (e) => { console.error(e); toast("保存に失敗しました。通信を確認してください"); };

function syncCurPet() {
  if (!pets.find((p) => p.id === curPet)) curPet = pets[0] ? pets[0].id : null;
  try { localStorage.setItem("curPet", curPet || ""); } catch (e) {}
}
function startSync() {
  stopSync(); denied = false; loaded = { pets: false, records: false };
  const onErr = (e) => { if (e.code === "permission-denied") { denied = true; render(); } else console.error(e); };
  unsubs.push(onSnapshot(petsCol, (snap) => { pets = snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); loaded.pets = true; syncCurPet(); render(); }, onErr));
  unsubs.push(onSnapshot(recsCol, (snap) => { records = snap.docs.map((d) => ({ ...d.data(), id: d.id })); loaded.records = true; checkUnlock(); render(); }, onErr));
}
function stopSync() { unsubs.forEach((u) => u()); unsubs = []; pets = []; records = []; }

/* ---------- 日付ユーティリティ(記録日時は自動入力) ---------- */
const pad = (n) => String(n).padStart(2, "0");
function toLocalInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v) => { const t = new Date(v).getTime(); return isNaN(t) ? Date.now() : t; };
function fmtDate(ms) { const d = new Date(ms); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`; }
function fmtTime(ms) { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
const fmtFull = (ms) => `${fmtDate(ms)} ${fmtTime(ms)}`;
const fmtShort = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function ageText(birth) {
  if (!birth) return "";
  const b = new Date(birth), n = new Date();
  let m = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth();
  if (n.getDate() < b.getDate()) m--;
  if (m < 0) return "";
  const y = Math.floor(m / 12);
  return y > 0 ? `${y}歳${m % 12 ? m % 12 + "か月" : ""}` : `${m}か月`;
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  return d >= 0 ? d + 1 : null;
}
const fmtW = (v, unit) => {
  const n = Number(v);
  return (unit === "kg" ? n.toFixed(2).replace(/\.?0+$/, "") : String(Math.round(n * 10) / 10));
};

/* ---------- UI部品 ---------- */
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
}
function openSheet(title, html, onMount) {
  const s = $("#sheet"), b = $(".sheet-body", s);
  b.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button class="x" aria-label="閉じる">${icon("close")}</button></div>${html}`;
  s.hidden = false;
  $(".x", b).onclick = closeSheet;
  $(".sheet-back", s).onclick = closeSheet;
  b.scrollTop = 0;
  onMount && onMount(b);
}
function closeSheet() { $("#sheet").hidden = true; $(".sheet-body").innerHTML = ""; }

function avatar(p, cls = "") {
  return p && p.photo
    ? `<img class="av ${cls}" src="${p.photo}" alt="">`
    : `<span class="av ${cls}">${icon("paw")}</span>`;
}

/* ---------- 画像処理 ---------- */
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("画像を読み込めませんでした")); };
    img.src = url;
  });
}
async function resize(file, max, q) {
  const img = await loadImage(file);
  const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}
async function resizeSafe(file) {
  let out = await resize(file, 1280, 0.82);
  if (out.length > 900000) out = await resize(file, 1000, 0.7);
  if (out.length > 900000) out = await resize(file, 800, 0.6);
  return out;
}
async function squareThumb(file, size) {
  const img = await loadImage(file);
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL("image/jpeg", 0.8);
}

/* ---------- ヘッダー(ペット切替) ---------- */
function renderPetBar() {
  $("#petBar").innerHTML =
    pets.map((p) => `<button class="chip ${p.id === curPet ? "on" : ""}" data-pet="${p.id}">${avatar(p, "")}${esc(p.name)}</button>`).join("") +
    `<button class="chip add" id="addPet">${icon("plus")}ペット追加</button>`;
  $("#petBar").querySelectorAll("[data-pet]").forEach((b) => (b.onclick = () => {
    curPet = b.dataset.pet; photoLimit = 30; timelineLimit = 20;
    try { localStorage.setItem("curPet", curPet); } catch (e) {}
    render();
  }));
  $("#addPet").onclick = () => petForm();
}

/* ---------- 画面描画 ---------- */
function render() {
  if (!user) { $("#petBar").innerHTML = ""; $("#tabs").hidden = true; $("#view").innerHTML = loginView(); const b = $("#loginBtn"); if (b) b.onclick = login; return; }
  $("#tabs").hidden = false;
  if (denied) { $("#petBar").innerHTML = ""; $("#tabs").hidden = true; $("#view").innerHTML = deniedView(); $("#outBtn").onclick = () => signOut(auth); return; }
  if (!loaded.pets || !loaded.records) { $("#petBar").innerHTML = ""; $("#view").innerHTML = `<div class="empty"><p>読み込み中...</p></div>`; return; }
  renderPetBar();
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const v = $("#view");
  if (!pets.length) { v.innerHTML = welcome(); $("#startBtn").onclick = () => petForm(); return; }
  ({ home: viewHome, weight: viewWeight, photo: viewPhoto, pet: viewPet }[tab])(v);
}
function loginView() {
  return `<div class="empty"><img src="icons/icon-192.png" alt=""><h2>ペット記録</h2>
    <p>家族で共有する記録アプリです。<br>許可されたGoogleアカウントでログインしてください。</p>
    <button class="btn" id="loginBtn">Googleでログイン</button></div>`;
}
function deniedView() {
  return `<div class="empty"><h2>このアカウントは許可されていません</h2>
    <p>${esc(user.email)} は、このアプリの利用者として登録されていません。<br>別のGoogleアカウントでログインし直してください。</p>
    <button class="btn" id="outBtn">ログアウト</button></div>`;
}
async function login() {
  const prov = new GoogleAuthProvider(); prov.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, prov); }
  catch (e) {
    if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
    try { await signInWithRedirect(auth, prov); } catch (e2) { toast("ログインできませんでした"); }
  }
}
function welcome() {
  return `<div class="empty"><img src="icons/icon-192.png" alt=""><h2>ペット記録へようこそ</h2>
    <p>体重・写真・メモを、記録した日時つきで残せます。<br>まずは家族を登録してください。</p>
    <button class="btn" id="startBtn">${icon("plus")}ペットを登録する</button>
    <p class="hint" style="margin-top:18px">記録は許可された家族のアカウント間で共有されます。</p></div>`;
}

const who = (r) => (r.by ? ` ・ ${esc(r.by)}` : "");
function recordItem(r, p) {
  const unit = p.unit || "g";
  if (r.type === "weight")
    return `<button class="item" data-rec="${r.id}"><span class="ic">${icon("scale")}</span><span class="tx"><div class="t1">${fmtW(r.value, unit)} ${unit}</div><div class="t2">${fmtTime(r.at)}${who(r)}${r.note ? " ・ " + esc(r.note) : ""}</div></span></button>`;
  if (r.type === "photo")
    return `<button class="item" data-rec="${r.id}"><img class="th" src="${r.thumb}" alt=""><span class="tx"><div class="t1">写真</div><div class="t2">${fmtTime(r.at)}${who(r)}${r.note ? " ・ " + esc(r.note) : ""}</div></span></button>`;
  return `<button class="item" data-rec="${r.id}"><span class="ic memo">${icon("note")}</span><span class="tx"><div class="t1">メモ</div><div class="t2">${fmtTime(r.at)}${who(r)} ・ ${esc(r.note)}</div></span></button>`;
}
function groupedList(list, p) {
  let last = "", out = "";
  for (const r of list) {
    const k = dayKey(r.at);
    if (k !== last) { out += `<div class="day">${fmtDate(r.at)}</div>`; last = k; }
    out += recordItem(r, p);
  }
  return out;
}
function bindRecs(root) {
  root.querySelectorAll("[data-rec]").forEach((b) => (b.onclick = () => {
    const r = records.find((x) => x.id === b.dataset.rec);
    r && (r.type === "photo" ? photoViewer(r.id) : recordForm(r.type, r));
  }));
}

/* ---- 3Dチンチラ(衣装解放・記念日・体型) ---- */
const COSTUMES = [
  { id: "none", name: "ふつう", days: 0 },
  { id: "bear-onesie", name: "くまのきぐるみ", days: 3 },
  { id: "kimono", name: "着物", days: 7 },
  { id: "ninja", name: "忍者", days: 14 },
  { id: "suit", name: "スーツ", days: 30 },
  { id: "wedding", name: "ウェディング", days: 60 },
];
const isChinchilla = (p) => /チンチラ|ちんちら|chinchilla/i.test(p.species || "");
const recDays = (petId) => new Set(records.filter((r) => r.petId === petId).map((r) => dayKey(r.at))).size;
function celebrate(p) {
  const t = new Date(), md = (s) => (s ? s.slice(5) : "");
  const today = `${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  if (p.birthday && md(p.birthday) === today) {
    const y = t.getFullYear() - Number(p.birthday.slice(0, 4));
    return { costume: "bear-onesie", text: y > 0 ? `${p.name}、${y}歳のお誕生日おめでとう!` : `${p.name}、お誕生日おめでとう!` };
  }
  if (p.adopted && md(p.adopted) === today) {
    const y = t.getFullYear() - Number(p.adopted.slice(0, 4));
    return { costume: "wedding", text: y > 0 ? `${p.name}、お迎えして${y}周年!ずっと一緒だよ` : `${p.name}、うちの子になった記念日!` };
  }
  return null;
}
function bodyInfo(p) {
  const ws = petRecs("weight");
  if (ws.length < 3) return { scale: 1, label: "体重の記録が3回たまると、体型が体重に合わせて変わります" };
  const avg = ws.reduce((a, r) => a + r.value, 0) / ws.length;
  const ratio = ws[0].value / avg;
  const scale = Math.min(1.18, Math.max(0.88, 1 + 1.5 * (ratio - 1)));
  const lab = ratio > 1.03 ? "ふっくら" : ratio < 0.97 ? "すっきり" : "いつもどおり";
  return { scale, label: `体型: ${lab}(これまでの平均との比較・遊びの演出です)` };
}
let viewerP = null;
function getViewer() {
  if (!viewerP) viewerP = import("./chinchilla3d.js").then((m) => m.createViewer());
  return viewerP;
}
function card3d(p) {
  if (!isChinchilla(p)) return "";
  const days = recDays(p.id), cel = celebrate(p);
  const cur = cel ? cel.costume : (COSTUMES.find((c) => c.id === p.costume && c.days <= days) ? p.costume : "none");
  const chips = COSTUMES.map((c) => {
    const ok = c.days <= days;
    return `<button class="cchip ${c.id === cur && !cel ? "on" : ""}" data-cos="${c.id}" ${ok ? "" : "disabled"}>${esc(c.name)}${ok ? "" : `<small>あと${c.days - days}日</small>`}</button>`;
  }).join("");
  return `<div class="card v3dcard">
    ${cel ? `<div class="banner">${esc(cel.text)}</div>` : ""}
    <div id="v3dHost" class="v3dhost"></div>
    <div class="hint" style="text-align:center;margin:6px 0 10px">指でぐるっと回せます。タップするとぴょんと跳ねます。</div>
    <div class="hint" style="text-align:center;margin:0 0 10px">${esc(bodyInfo(p).label)}</div>
    <h2 style="margin-top:6px">衣装(記録した日数 ${days}日)</h2>
    <div class="costumes">${chips}</div>
  </div>`;
}
async function mount3d(p) {
  const host = $("#v3dHost");
  if (!host) return;
  try {
    const v = await getViewer();
    const h = $("#v3dHost");
    if (!h) return;
    h.appendChild(v.el);
    const days = recDays(p.id), cel = celebrate(p);
    const costume = cel ? cel.costume : (COSTUMES.find((c) => c.id === p.costume && c.days <= days) ? p.costume : "none");
    v.setLook({ coat: p.coat || "gray", costume, scale: bodyInfo(p).scale });
  } catch (e) { console.error(e); host.innerHTML = ""; }
}
let lastUnlocked = {};
function checkUnlock() {
  for (const p of pets) {
    const n = COSTUMES.filter((c) => c.days <= recDays(p.id)).length;
    if (lastUnlocked[p.id] !== undefined && n > lastUnlocked[p.id] && isChinchilla(p)) {
      const c = COSTUMES.filter((c) => c.days <= recDays(p.id)).pop();
      toast(`新しい衣装「${c.name}」が解放されました`);
    }
    lastUnlocked[p.id] = n;
  }
}

function viewHome(v) {
  const p = pet(), unit = p.unit || "g";
  const ws = petRecs("weight");
  const age = ageText(p.birthday), together = daysSince(p.adopted);
  const meta = [p.species, age, together ? `一緒に${together}日目` : ""].filter(Boolean).join(" ・ ");
  let wCard = `<div class="stat"><div class="l">最新の体重</div><div class="v">--</div></div><div class="stat"><div class="l">前回との差</div><div class="v">--</div></div>`;
  if (ws.length) {
    const d = ws[1] ? ws[0].value - ws[1].value : null;
    const dTxt = d === null ? "--" : `<span class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "+" : ""}${fmtW(d, unit)}<small>${unit}</small></span>`;
    wCard = `<div class="stat"><div class="l">最新の体重(${fmtShort(ws[0].at)})</div><div class="v">${fmtW(ws[0].value, unit)}<small>${unit}</small></div></div><div class="stat"><div class="l">前回との差</div><div class="v">${dTxt}</div></div>`;
  }
  const all = petRecs();
  v.innerHTML = `
    <div class="card hero">${avatar(p)}<div><div class="nm">${esc(p.name)}</div><div class="meta">${esc(meta)}</div></div></div>
    ${card3d(p)}
    <div class="stats" style="margin-bottom:14px">${wCard}</div>
    <div class="quick">
      <button class="qbtn" id="qW">${icon("scale")}体重</button>
      <button class="qbtn b" id="qP">${icon("camera")}写真</button>
      <button class="qbtn m" id="qM">${icon("note")}メモ</button>
    </div>
    <h3 class="sec">きろく</h3>
    ${all.length ? groupedList(all.slice(0, timelineLimit), p) + (all.length > timelineLimit ? `<button class="btn ghost block" id="more">もっと見る</button>` : "") : `<div class="empty"><p>まだ記録がありません。<br>上のボタンから最初の記録を残しましょう。</p></div>`}`;
  v.querySelectorAll("[data-cos]").forEach((b) => (b.onclick = () => updateDoc(doc(petsCol, p.id), { costume: b.dataset.cos }).catch(fail)));
  mount3d(p);
  $("#qW").onclick = () => recordForm("weight");
  $("#qP").onclick = () => recordForm("photo");
  $("#qM").onclick = () => recordForm("memo");
  const more = $("#more"); if (more) more.onclick = () => { timelineLimit += 30; render(); };
  bindRecs(v);
}

/* ---- 体重 ---- */
function viewWeight(v) {
  const p = pet(), unit = p.unit || "g";
  const all = petRecs("weight");
  const days = { "1m": 30, "3m": 90, "1y": 365, all: 0 }[range];
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const shown = all.filter((r) => r.at >= cutoff);
  let stats = "";
  if (shown.length) {
    const vals = shown.map((r) => r.value);
    stats = `<div class="stats" style="margin-top:10px">
      <div class="stat"><div class="l">最大</div><div class="v">${fmtW(Math.max(...vals), unit)}<small>${unit}</small></div></div>
      <div class="stat"><div class="l">最小</div><div class="v">${fmtW(Math.min(...vals), unit)}<small>${unit}</small></div></div></div>`;
  }
  v.innerHTML = `
    <button class="btn block" id="addW" style="margin-bottom:14px">${icon("plus")}体重を記録する</button>
    <div class="card">
      <div class="range">${[["1m", "1か月"], ["3m", "3か月"], ["1y", "1年"], ["all", "全期間"]].map(([k, l]) => `<button data-r="${k}" class="${range === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${shown.length ? `<div id="chartBox"></div><div class="pt-info" id="ptInfo">グラフの点をタップすると詳細が出ます</div>${stats}` : `<div class="empty"><p>この期間の体重記録はありません</p></div>`}
    </div>
    <h3 class="sec">体重の履歴</h3>
    ${all.length ? groupedList(all, p) : ""}`;
  $("#addW").onclick = () => recordForm("weight");
  v.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { range = b.dataset.r; render(); }));
  if (shown.length) drawChart($("#chartBox"), shown.slice().reverse(), unit);
  bindRecs(v);
}

function drawChart(box, pts, unit) {
  const W = 340, H = 210, L = 46, R = 14, T = 14, B = 28;
  const vals = pts.map((r) => r.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pd = (hi - lo) * 0.18; lo -= pd; hi += pd;
  const t0 = pts[0].at, t1 = pts[pts.length - 1].at, span = Math.max(t1 - t0, 1);
  const even = t1 - t0 < 86400000; // 1日以内の記録は等間隔に並べる
  const X = (t, i) => pts.length === 1 ? (L + W - R) / 2 : L + (even ? i / (pts.length - 1) : (t - t0) / span) * (W - L - R);
  const Y = (val) => T + (1 - (val - lo) / (hi - lo)) * (H - T - B);
  let g = "";
  for (let i = 0; i <= 3; i++) {
    const val = lo + ((hi - lo) * i) / 3, y = Y(val);
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#eadfc8"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#8a7c6c">${fmtW(val, unit)}</text>`;
  }
  const line = pts.map((r, i) => `${X(r.at, i).toFixed(1)},${Y(r.value).toFixed(1)}`).join(" ");
  const dots = pts.map((r, i) => `<circle data-i="${i}" cx="${X(r.at, i).toFixed(1)}" cy="${Y(r.value).toFixed(1)}" r="4.5" fill="#fffdf7" stroke="#6f9a4a" stroke-width="2.2"/>`).join("");
  const xl = pts.length > 1
    ? `<text x="${L}" y="${H - 8}" font-size="11" fill="#8a7c6c">${fmtShort(t0)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="11" fill="#8a7c6c">${fmtShort(t1)}</text>`
    : `<text x="${X(t0, 0)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#8a7c6c">${fmtShort(t0)}</text>`;
  box.innerHTML = `<svg id="chart" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}${pts.length > 1 ? `<polyline points="${line}" fill="none" stroke="#6f9a4a" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` : ""}${dots}${xl}</svg>`;
  const info = $("#ptInfo");
  const sel = (i) => {
    box.querySelectorAll("circle").forEach((c, j) => { c.setAttribute("fill", j === i ? "#6f9a4a" : "#fffdf7"); c.setAttribute("r", j === i ? 6 : 4.5); });
    info.textContent = `${fmtFull(pts[i].at)}  ${fmtW(pts[i].value, unit)} ${unit}`;
  };
  const svg = $("#chart");
  svg.addEventListener("click", (e) => {
    const rc = svg.getBoundingClientRect(), x = ((e.clientX - rc.left) / rc.width) * W;
    let best = 0, bd = 1e9;
    pts.forEach((r, i) => { const d = Math.abs(X(r.at, i) - x); if (d < bd) { bd = d; best = i; } });
    sel(best);
  });
  sel(pts.length - 1);
}

/* ---- 写真 ---- */
function viewPhoto(v) {
  const ph = petRecs("photo");
  v.innerHTML = `
    <button class="btn block" id="addP" style="margin-bottom:14px">${icon("plus")}写真を追加する</button>
    ${ph.length ? `<div class="grid">${ph.slice(0, photoLimit).map((r) => `<button data-ph="${r.id}"><img src="${r.thumb}" alt="" loading="lazy"><span class="d">${fmtShort(r.at)}</span></button>`).join("")}</div>${ph.length > photoLimit ? `<button class="btn ghost block" id="morePh" style="margin-top:12px">もっと見る</button>` : ""}` : `<div class="empty"><p>まだ写真がありません</p></div>`}`;
  $("#addP").onclick = () => recordForm("photo");
  const m = $("#morePh"); if (m) m.onclick = () => { photoLimit += 60; render(); };
  v.querySelectorAll("[data-ph]").forEach((b) => (b.onclick = () => photoViewer(b.dataset.ph)));
}
const fullCache = new Map();
async function loadFull(id) {
  if (fullCache.has(id)) return fullCache.get(id);
  try { const s = await getDoc(doc(photosCol, id)); const f = s.exists() ? s.data().full : null; if (f) fullCache.set(id, f); return f; } catch (e) { return null; }
}
function photoViewer(id) {
  const list = petRecs("photo");
  let i = list.findIndex((r) => r.id === id);
  if (i < 0) return;
  const show = () => {
    const r = list[i];
    openSheet(fmtFull(r.at), `<div class="viewer"><img id="bigImg" src="${r.thumb}" style="filter:blur(2px)" alt="">
      ${r.note ? `<p style="margin:0 0 10px">${esc(r.note).replace(/\n/g, "<br>")}</p>` : ""}
      <div class="nav"><button class="btn ghost sm" id="pv" ${i >= list.length - 1 ? "disabled" : ""}>前(古い)</button><button class="btn ghost sm" id="nx" ${i <= 0 ? "disabled" : ""}>次(新しい)</button></div>
      <div class="row"><button class="btn ghost" id="ed" style="flex:1">${icon("edit")}日時・メモ</button><button class="btn danger" id="dl" style="flex:1">${icon("trash")}削除</button></div></div>`,
      (b) => {
        loadFull(r.id).then((f) => { const im = $("#bigImg"); if (im && f) { im.src = f; im.style.filter = ""; } });
        $("#pv", b).onclick = () => { i++; show(); };
        $("#nx", b).onclick = () => { i--; show(); };
        $("#ed", b).onclick = () => recordForm("photo", r);
        $("#dl", b).onclick = () => delRecord(r);
      });
  };
  show();
}

/* ---- 設定 ---- */
function viewPet(v) {
  const p = pet();
  const n = records.filter((r) => r.petId === p.id).length;
  v.innerHTML = `
    <div class="card hero">${avatar(p)}<div><div class="nm">${esc(p.name)}</div><div class="meta">記録 ${n}件</div></div></div>
    <div class="card"><h2>ログイン中のアカウント</h2><p style="margin:0 0 10px">${esc(user.email)}</p><button class="btn ghost sm" id="outBtn">ログアウト</button></div>
    <div class="row" style="margin-bottom:14px"><button class="btn ghost" id="edPet" style="flex:1">${icon("edit")}プロフィール編集</button><button class="btn danger" id="delPet" style="flex:1">${icon("trash")}このペットを削除</button></div>
    <div class="card"><h2>バックアップ</h2>
      <p class="hint" style="margin-top:0">記録はクラウドで家族と共有されています。念のための保管用に、ときどきファイルに書き出してください(全ペット・写真を含む)。読み込みは、いまの記録に追加されます(同じファイルを2回読み込むと重複します)。</p>
      <div class="row"><button class="btn ghost" id="exp" style="flex:1">${icon("down")}書き出す</button><button class="btn ghost" id="imp" style="flex:1">${icon("up")}読み込む</button></div>
      <input type="file" id="impFile" accept="application/json,.json" hidden>
    </div>`;
  $("#edPet").onclick = () => petForm(p);
  $("#delPet").onclick = async () => {
    if (!confirm(`「${p.name}」と、そのすべての記録(${n}件)を削除します。元に戻せません。よろしいですか?`)) return;
    try {
      const ids = records.filter((r) => r.petId === p.id).map((r) => ({ rec: r.id, photo: r.type === "photo" }));
      const ops = [];
      ids.forEach((x) => { ops.push(doc(recsCol, x.rec)); if (x.photo) ops.push(doc(photosCol, x.rec)); });
      ops.push(doc(petsCol, p.id));
      for (let k = 0; k < ops.length; k += 400) { const b = writeBatch(fs); ops.slice(k, k + 400).forEach((r) => b.delete(r)); await b.commit(); }
      curPet = null; toast("削除しました");
    } catch (e) { fail(e); }
  };
  $("#outBtn").onclick = () => { if (confirm("ログアウトしますか?")) signOut(auth); };
  $("#exp").onclick = exportData;
  $("#imp").onclick = () => $("#impFile").click();
  $("#impFile").onchange = (e) => importData(e.target.files[0]);
}

/* ---------- フォーム ---------- */
function petForm(p) {
  const isNew = !p;
  p = p || { name: "", species: "チンチラ", birthday: "", adopted: "", unit: "g", photo: "" };
  let photo = p.photo || "";
  openSheet(isNew ? "ペットを登録" : "プロフィール編集", `
    <div style="text-align:center;margin-bottom:12px"><span id="pAv" style="display:inline-block">${avatar({ photo }, "")}</span>
      <div><label class="btn ghost sm" style="margin-top:8px">写真を選ぶ<input type="file" id="pPhoto" accept="image/*" hidden></label></div></div>
    <label class="f">名前<input id="pName" value="${esc(p.name)}" maxlength="30" placeholder="例: もち"></label>
    <label class="f">種類<input id="pSpecies" value="${esc(p.species)}" maxlength="30"></label>
    <label class="f">3Dの毛色(チンチラの場合)<select id="pCoat"><option value="gray">グレー</option><option value="white-pied">ホワイトパイド(白っぽい子)</option></select></label>
    <label class="f">誕生日(わかれば)<input id="pBirth" type="date" value="${esc(p.birthday)}"></label>
    <label class="f">お迎えした日(わかれば)<input id="pAdopt" type="date" value="${esc(p.adopted)}"></label>
    <label class="f">体重の単位<select id="pUnit"><option value="g">g(グラム)</option><option value="kg">kg(キログラム)</option></select></label>
    <button class="btn block" id="pSave">保存する</button>`,
    (b) => {
      $("#pUnit", b).value = p.unit || "g";
      $("#pCoat", b).value = p.coat || "gray";
      const setAv = () => { $("#pAv", b).innerHTML = photo ? `<img class="av" src="${photo}" style="width:96px;height:96px;border-radius:50%" alt="">` : `<span class="av" style="width:96px;height:96px;border-radius:50%">${icon("paw")}</span>`; };
      setAv();
      $("#pPhoto", b).onchange = async (e) => { if (e.target.files[0]) { try { photo = await squareThumb(e.target.files[0], 240); setAv(); } catch (er) { toast(er.message); } } };
      $("#pSave", b).onclick = async () => {
        const name = $("#pName", b).value.trim();
        if (!name) { toast("名前を入力してください"); return; }
        const obj = { ...strip(p), name, species: $("#pSpecies", b).value.trim(), birthday: $("#pBirth", b).value, adopted: $("#pAdopt", b).value, unit: $("#pUnit", b).value, coat: $("#pCoat", b).value, photo };
        if (isNew) { const ref = doc(petsCol); obj.createdAt = Date.now(); curPet = ref.id; setDoc(ref, obj).catch(fail); }
        else updateDoc(doc(petsCol, p.id), obj).catch(fail);
        closeSheet(); toast("保存しました");
      };
    });
}

function recordForm(type, rec) {
  const p = pet(), unit = p.unit || "g", editing = !!rec;
  const titles = { weight: "体重を記録", photo: "写真を記録", memo: "メモを記録" };
  const r = rec || { type, at: Date.now(), note: "" };
  const autoVal = toLocalInput(r.at);
  const files = []; // {full, thumb, mtime}
  let body = "";
  if (type === "weight") body += `<label class="f">体重(${unit})<input id="rVal" type="number" inputmode="decimal" step="${unit === "kg" ? "0.001" : "0.1"}" min="0" value="${editing ? r.value : ""}" placeholder="${unit === "kg" ? "例: 0.55" : "例: 550"}"></label>`;
  if (type === "photo" && !editing) body += `<label class="btn ghost block" style="margin-bottom:10px">${icon("camera")}写真を選ぶ・撮る(複数可)<input type="file" id="rFile" accept="image/*" multiple hidden></label><div class="previews" id="prev"></div>
    <label class="chk" id="mtWrap" hidden><input type="checkbox" id="useMtime">写真ファイルの日時を記録日にする</label>`;
  body += `<label class="f">日時<span class="auto">${editing ? "" : "自動入力(変更もできます)"}</span><input id="rAt" type="datetime-local" value="${toLocalInput(r.at)}"></label>
    <label class="f">メモ${type === "memo" ? "" : "(任意)"}<textarea id="rNote" maxlength="1000" placeholder="${type === "memo" ? "今日のようす、ごはん、通院など" : ""}">${esc(r.note)}</textarea></label>
    <button class="btn block" id="rSave">${editing ? "更新する" : "記録する"}</button>
    ${editing ? `<button class="btn danger block" id="rDel" style="margin-top:10px">${icon("trash")}この記録を削除</button>` : ""}`;
  openSheet(editing ? (type === "weight" ? "体重を編集" : type === "photo" ? "写真を編集" : "メモを編集") : titles[type], body, (b) => {
    if (type === "weight" && !editing) setTimeout(() => $("#rVal", b).focus(), 50);
    if (type === "photo" && !editing) {
      $("#rFile", b).onchange = async (e) => {
        files.length = 0; $("#prev", b).innerHTML = "";
        for (const f of e.target.files) {
          try { files.push({ full: await resizeSafe(f), thumb: await squareThumb(f, 320), mtime: f.lastModified }); } catch (er) { toast(er.message); }
        }
        $("#prev", b).innerHTML = files.map((f) => `<img src="${f.thumb}" alt="">`).join("");
        $("#mtWrap", b).hidden = !files.length;
      };
    }
    $("#rSave", b).onclick = async () => {
      let at = !editing && $("#rAt", b).value === autoVal ? Date.now() : fromLocalInput($("#rAt", b).value);
      const note = $("#rNote", b).value.trim();
      if (type === "weight") {
        const val = parseFloat($("#rVal", b).value);
        if (!(val > 0)) { toast("体重を入力してください"); return; }
        if (editing) updateDoc(doc(recsCol, r.id), { at, value: val, note }).catch(fail);
        else setDoc(doc(recsCol), { petId: curPet, type, at, value: val, note, by: byName() }).catch(fail);
      } else if (type === "memo") {
        if (!note) { toast("メモを入力してください"); return; }
        if (editing) updateDoc(doc(recsCol, r.id), { at, note }).catch(fail);
        else setDoc(doc(recsCol), { petId: curPet, type, at, note, by: byName() }).catch(fail);
      } else if (editing) {
        updateDoc(doc(recsCol, r.id), { at, note }).catch(fail);
      } else {
        if (!files.length) { toast("写真を選んでください"); return; }
        const useM = $("#useMtime", b).checked;
        for (const f of files) {
          const ref = doc(recsCol), bt = writeBatch(fs);
          bt.set(ref, { petId: curPet, type, at: useM && f.mtime ? f.mtime : at, note, thumb: f.thumb, by: byName() });
          bt.set(doc(photosCol, ref.id), { full: f.full });
          bt.commit().catch(fail);
          at += 1; // 同時追加の順序を保つ
        }
      }
      closeSheet(); toast("記録しました");
    };
    const d = $("#rDel", b); if (d) d.onclick = () => delRecord(r);
  });
}
async function delRecord(r) {
  if (!confirm("この記録を削除します。よろしいですか?")) return;
  const bt = writeBatch(fs); bt.delete(doc(recsCol, r.id)); if (r.type === "photo") bt.delete(doc(photosCol, r.id));
  bt.commit().catch(fail); fullCache.delete(r.id); closeSheet(); toast("削除しました");
}

/* ---------- バックアップ ---------- */
async function exportData() {
  try {
    toast("書き出し中...");
    const photoSnap = await getDocs(photosCol), full = {};
    photoSnap.forEach((d) => (full[d.id] = d.data().full));
    const recs = records.map((r) => (r.type === "photo" ? { ...r, full: full[r.id] || r.thumb } : r));
    const data = JSON.stringify({ app: "pet-record", version: 2, exportedAt: Date.now(), pets, records: recs });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const d = new Date();
    a.download = `pet-record-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("書き出しました");
  } catch (e) { fail(e); }
}
async function importData(file) {
  if (!file) return;
  let d;
  try {
    d = JSON.parse(await file.text());
    if (d.app !== "pet-record" || !Array.isArray(d.pets) || !Array.isArray(d.records)) throw new Error();
  } catch (e) { toast("読み込めないファイルです"); return; }
  if (!confirm(`バックアップ(ペット${d.pets.length}匹・記録${d.records.length}件)を、いまの記録に追加します。よろしいですか?`)) return;
  try {
    const map = {}, ops = [];
    d.pets.forEach((p, k) => { const ref = doc(petsCol); map[p.id] = ref.id; ops.push([ref, { ...strip(p), createdAt: p.createdAt || Date.now() + k }]); });
    d.records.forEach((r) => {
      if (!(r.petId in map)) return;
      const ref = doc(recsCol), c = strip(r); delete c.full; c.petId = map[r.petId];
      ops.push([ref, c]);
      if (r.type === "photo" && r.full) ops.push([doc(photosCol, ref.id), { full: r.full }]);
    });
    for (let k = 0; k < ops.length; k += 200) { const bt = writeBatch(fs); ops.slice(k, k + 200).forEach(([ref, v]) => bt.set(ref, v)); await bt.commit(); }
    toast("読み込みました");
  } catch (e) { fail(e); }
}

/* ---------- 起動 ---------- */
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => {
  tab = b.dataset.tab; try { localStorage.setItem("tab", tab); } catch (e) {}
  window.scrollTo(0, 0); render();
}));
onAuthStateChanged(auth, (u) => {
  user = u;
  if (u) startSync(); else stopSync();
  render();
});
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
