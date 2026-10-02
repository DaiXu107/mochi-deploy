// ===== 心意市集「药品医护」分类专项验证（#859）=====
// 用户反馈原文：「心意市里只有感冒药。缺失日常使用的药品和比如手受伤了，需要用的。」
// 事实核对：改前全库 301 件里医药类只有 4 件（感冒药/创可贴/体温计/口罩），且散在 82 件的
// 大「日常用品」分类里；搜索是「名称/留言/分类」三选一匹配，搜「药」只命中「感冒药」一条
// ——用户看到的「只有感冒药」既是真的内容缺口，也是真的筛选缺口。
// 本批把医药类单独成类（第 13 类「药品医护」）并补齐常备药与外伤处理，脚本据此断言：
//   A 组静态：分类登记 / 图标配色 / 条目字段与唯一性 / 常备药覆盖病症 / 外伤处理覆盖处理四步 /
//            既有医药商品归类 / 新商品不在 DEF_V1_IDS（否则老用户升级会被全局迁移记成「删过的」而看不到）
//   B 组运行时（无头 Chrome，现场按 build.mjs 清单拼装产物）：分类胶囊可点且只渲染该分类 /
//            搜「药」不再是单条 / 手受伤的每一步搜得到 / 已迁移过的老档也看得到整柜
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdtempSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

const MEDCAT = '药品医护';
// 前 12 类是先前的口径，本批只允许「追加在末位」——打乱顺序会让所有老用户找不到原来的胶囊
const CATS_HEAD = ['花束', '甜品', '饮品', '美食', '饰品', '星空', '两个世界', '出行', '娱乐', '关怀', '情侣用品', '日常用品'];
// 常备药：按「哪儿不舒服」命名，用户照症状就能搜到
const MED_NAMES = ['感冒药', '退烧药', '消炎药', '止痛药', '胃药', '止咳糖浆', '润喉糖', '眼药水'];
// 外伤处理：按「受伤那一步」配齐（消毒 → 上药 → 包扎 → 消肿）
const INJURY_STEPS = { '消毒': ['碘伏'], '上药': ['跌打药酒'], '包扎': ['医用棉签', '纱布绷带'], '消肿': ['冰袋'] };
// 改前就有、本批归类的 4 件
const RECLASSIFIED = ['感冒药', '创可贴', '体温计', '口罩'];

// ---------- A 组：源码静态断言 ----------
const s = readFileSync(join(root, 'src', 'js', 'gift-shop.js'), 'utf8');
const catsM = s.match(/const CATS = \[([^\]]+)\]/);
const cats = catsM ? [...catsM[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
// #870 起分类不止 13 个（又追加了「节日节令」「美妆个护」），这条不再写死总数——
// 真正要守的是「前 12 类顺序未动」与「药品医护仍在」，避免每次扩类都来改一次期望。
check('A1 「药品医护」已登记且前 12 类顺序未动（追加式注册，老用户原胶囊位置不变）',
  cats.length >= CATS_HEAD.length + 1 && JSON.stringify(cats.slice(0, CATS_HEAD.length)) === JSON.stringify(CATS_HEAD) && cats.includes(MEDCAT),
  cats.join('|'));

check('A2 新分类已在 CAT_ICON / CAT_COLOR 登记（缺登记则胶囊掉成默认礼物图标与灰底）',
  new RegExp("'" + MEDCAT + "':\\s*'💊'").test(s) && new RegExp("'" + MEDCAT + "':\\s*'#ffebee'").test(s));

const arrM = s.match(/const DEF_GIFTS = \[([\s\S]*?)\n  \];/);
const items = [];
if (arrM) {
  const re = /\{ id:\s*'([^']+)',\s*name:\s*'([^']*)',\s*emoji:\s*'([^']*)',\s*price:\s*([\d.]+),\s*cat:\s*'([^']+)',\s*wish:\s*'([^']*)'/g;
  let m; while ((m = re.exec(arrM[1]))) items.push({ id: m[1], name: m[2], emoji: m[3], price: parseFloat(m[4]), cat: m[5], wish: m[6] });
}
const staticTotal = items.length;
const med = items.filter((i) => i.cat === MEDCAT);
const dupIds = items.map((i) => i.id).filter((id, i, a) => a.indexOf(id) !== i);
const seenCatEmoji = {}; const dupEmojis = [];
med.forEach((i) => { const k = i.emoji; if (seenCatEmoji[k]) dupEmojis.push(k); seenCatEmoji[k] = 1; });
const badField = med.filter((i) => !i.name || !i.emoji || !(i.price >= 0) || !i.wish || i.wish.length > 40);
check('A3 「药品医护」条目齐全且字段完整（≥15 件、id 全库唯一、类内 emoji 不撞、wish≤40）',
  med.length >= 15 && dupIds.length === 0 && dupEmojis.length === 0 && badField.length === 0,
  { count: med.length, dupIds, dupEmojis, badField: badField.map((b) => b.id) });

const medNames = med.map((i) => i.name);
const missMed = MED_NAMES.filter((n) => !medNames.includes(n));
check('A4 常备药按病症齐了（退烧/消炎/止痛/胃/止咳/润喉/眼药水，用户「日常用的药」）',
  missMed.length === 0, { missing: missMed, have: medNames.join('/') });

const missStep = [];
Object.entries(INJURY_STEPS).forEach(([step, names]) => {
  names.forEach((n) => { if (!medNames.includes(n)) missStep.push(step + ':' + n); });
});
check('A5 外伤处理覆盖「消毒→上药→包扎→消肿」四步（用户「手受伤了要用的」）',
  missStep.length === 0, { missing: missStep, have: medNames.join('/') });

const reclassed = RECLASSIFIED.filter((n) => {
  const it = items.find((i) => i.name === n);
  return !it || it.cat !== MEDCAT;
});
check('A6 改前那 4 件医药商品（感冒药/创可贴/体温计/口罩）已归入本分类', reclassed.length === 0, { notInMed: reclassed });

// 全局迁移只对 DEF_V1_IDS 里的 id 记「删除标记」——新 id 若混进那个集合，老用户升级后
// 市集里根本看不到这批药（迁移以为用户删过）。这条断言就是拦这个。
const v1M = s.match(/const DEF_V1_IDS = \{([^}]+)\}/);
const v1Ids = v1M ? [...v1M[1].matchAll(/([a-z0-9_]+): 1/g)].map((x) => x[1]) : [];
const medNewIds = med.map((i) => i.id).filter((id) => !['g_pill', 'g_bandaid', 'g_thermo', 'g_mask'].includes(id));
const leaked = medNewIds.filter((id) => v1Ids.includes(id));
check('A7 本批新商品未混进 DEF_V1_IDS（否则老用户升级时会被迁移记成「删过的」而看不到）',
  v1Ids.length > 0 && leaked.length === 0, { v1Count: v1Ids.length, leaked, newIds: medNewIds.length });

if (!results.every((r) => r.ok)) { console.log('\n静态断言未全过，跳过运行时组'); process.exit(1); }

// ---------- B 组：运行时（无头 Chrome，现场拼装产物） ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

// index.html 由 src 现场拼接（文件清单从 build.mjs 提取，防手抄漂移）
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-medcat-'));
{
  const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : []);
  const cssFiles = parseArr(bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/));
  const jsFiles = parseArr(bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/));
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => { try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; } }).join('\n');
  if (!jsAll.includes(MEDCAT)) { console.error('拼接出的 JS 里没有「药品医护」分类'); process.exit(1); }
  writeFileSync(join(tmpSite, 'index.html'), html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll));
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const profile = join(tmpdir(), 'mochi-medcat-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
async function preScript(src) { const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: src }); return r.identifier; }
async function unpre(id) { try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); } catch (e) {} }

// 打开市集并读页面状态（胶囊 / 网格 / 异常）
async function marketProbe() {
  return evalJs(`(function(){
    var pg = document.getElementById('page-market');
    if (!pg || pg.hidden) { var app = document.querySelector('[data-app="market"]'); if (!app) return { open: false }; app.click(); }
    var pills = Array.prototype.map.call(document.querySelectorAll('#market-cats .market-cat-name'), function(n){ return n.textContent; });
    var names = Array.prototype.map.call(document.querySelectorAll('#market-grid .gift-item-name'), function(n){ return n.textContent; });
    return { open: true, pills: pills, pillCount: pills.length, grid: names.length, names: names,
      jsErr: (window.__jsErrors || []).length };
  })()`);
}
async function clickCat(name) {
  return evalJs(`(function(){
    var btns = document.querySelectorAll('#market-cats .market-cat');
    for (var i=0;i<btns.length;i++) { var n = btns[i].querySelector('.market-cat-name');
      if (n && n.textContent === ${JSON.stringify(name)}) { btns[i].click(); return true; } }
    return false;
  })()`);
}
async function typeSearch(txt) {
  return evalJs(`(function(){
    var i = document.getElementById('market-search');
    if (!i) return false;
    i.value = ${JSON.stringify(txt)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}
async function gridNames() {
  return evalJs(`Array.prototype.map.call(document.querySelectorAll('#market-grid .gift-item-name'), function(n){ return n.textContent; })`);
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- B 组 1：全新档案 ----
await gotoApp();
let st = await marketProbe();
check('B1 市集页打开：' + (CATS_HEAD.length + 1) + '+1 分类胶囊（含「药品医护」）、网格总数=' + staticTotal,
  st && st.open && st.pillCount === cats.length + 1 && st.grid === staticTotal && st.pills.includes(MEDCAT) && st.jsErr === 0,
  { pillCount: st && st.pillCount, grid: st && st.grid, jsErr: st && st.jsErr, hasMed: st && st.pills && st.pills.includes(MEDCAT) });

const clicked = await clickCat(MEDCAT);
await sleep(300);
let names = await gridNames();
check('B2 点「药品医护」：只渲染本分类 ' + med.length + ' 件、且 4 件老医药商品都在',
  clicked && names && names.length === med.length && RECLASSIFIED.every((n) => names.includes(n)),
  { count: names && names.length, names: names });

// 用户视角的原始症状：搜「药」只出「感冒药」一条
await clickCat('全部');
await sleep(200);
await typeSearch('药');
await sleep(350);
names = await gridNames();
check('B3 搜「药」：命中 ≥5 件（改前只有「感冒药」1 件），用户照症状就能筛出整柜',
  names && names.length >= 5 && names.includes('感冒药'),
  { count: names && names.length, names: names });

await typeSearch('碘伏');
await sleep(350);
names = await gridNames();
check('B4 搜「碘伏」：命中 1 件（手破了先消毒这一步找得到）', names && names.length === 1 && names[0] === '碘伏', names);

await typeSearch('创可贴');
await sleep(350);
names = await gridNames();
check('B5 搜「创可贴」：命中 1 件且已归入本分类（手受伤最先想到的那件）', names && names.length === 1 && names[0] === '创可贴', names);

await typeSearch('');
await sleep(300);

// ---- B 组 2：已迁移过的老档（升级用户）----
// 预置「本机早就跑过全局迁移」的标记：老用户不该因为迁移记录而看不到这批新增的药
const pre = await preScript(`
  try {
    localStorage.setItem('xy-home-v2:market-custom', '[]');
    localStorage.setItem('xy-home-v2:market-migrated', '1');
    localStorage.setItem('xy-home-v2:market-migrated-v2', '1');
    localStorage.setItem('xy-home-v2:market-migrated-v3', '1');
  } catch (e) {}
`);
await gotoApp();
st = await marketProbe();
check('B6 老档（已迁移标记在位）：全库仍 ' + staticTotal + ' 件、新分类仍在（升级用户看得到这批药）',
  st && st.open && st.grid === staticTotal && st.pills.includes(MEDCAT) && st.jsErr === 0,
  { grid: st && st.grid, hasMed: st && st.pills && st.pills.includes(MEDCAT), jsErr: st && st.jsErr });
await clickCat(MEDCAT);
await sleep(300);
names = await gridNames();
check('B7 老档点「药品医护」：仍是 ' + med.length + ' 件（迁移未把新商品记成「用户删过的」）',
  names && names.length === med.length, { count: names && names.length });
await unpre(pre);

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);
