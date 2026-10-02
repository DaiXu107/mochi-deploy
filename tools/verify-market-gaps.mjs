// ===== 心意市集「四组缺口商品」专项验证（#870）=====
// 用户直派「1234都要补」——即上一轮审计出的四组缺口：
//   ① 节日节令食品（改前只有中秋月饼，端午/元宵/春节/腊八全空）
//   ② 美妆个护（改前只有护手霜/润唇膏/香皂/洗浴套装，且埋在 82 件的「日常用品」里）
//   ③ 经期关怀（改前 0 件，而 app 自己有经期记录功能）
//   ④ 花束补齐（改前 8 件，是全库最少的分类）
// 本批同时把「月饼」归入节日节令、把 4 件个护从「日常用品」移入「美妆个护」。
//   A 组静态：两类目登记 / 四组商品齐全且归类正确 / 全库字段与唯一性 / 新商品未混进 DEF_V1_IDS
//   B 组运行时（无头 Chrome，现场按 build.mjs 清单拼装产物）：胶囊与总数 / 点新类目成组渲染 /
//            搜得到的口语名 / 已迁移过的老档也看得到
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

const FEST = '节日节令';
const BEAUTY = '美妆个护';
const MEDCAT = '药品医护';
// 本批之前的 13 类（顺序不许动 —— 老用户的胶囊位置靠它）
const CATS_HEAD13 = ['花束', '甜品', '饮品', '美食', '饰品', '星空', '两个世界', '出行', '娱乐', '关怀', '情侣用品', '日常用品', '药品医护'];
const FEST_NAMES = ['粽子', '汤圆', '年糕', '腊八粥', '手工饺子', '青团', '圣诞姜饼', '月饼'];
const BEAUTY_NEW = ['口红', '香水', '面膜', '防晒霜', '身体乳', '护发精油', '美甲套装', '化妆刷', '眼影盘', '化妆棉'];
const BEAUTY_MOVED = ['护手霜', '润唇膏', '香皂', '洗浴套装'];
const PERIOD_NAMES = ['红糖姜茶', '暖宝宝贴', '热水袋', '痛经贴'];
const CARE_NAMES = ['帮你揉肚子', '陪你躺一天'];
const BOUQUET_NEW = ['百合', '康乃馨', '绣球', '荷花', '香槟玫瑰', '干花束', '银杏叶', '蒲公英'];

// ---------- A 组：源码静态断言 ----------
const s = readFileSync(join(root, 'src', 'js', 'gift-shop.js'), 'utf8');
const catsM = s.match(/const CATS = \[([^\]]+)\]/);
const cats = catsM ? [...catsM[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
check('A1 两个新类目已登记且前 13 类顺序未动（追加式注册，老用户原胶囊位置不变）',
  cats.length >= CATS_HEAD13.length + 2 && JSON.stringify(cats.slice(0, CATS_HEAD13.length)) === JSON.stringify(CATS_HEAD13) &&
  cats.includes(FEST) && cats.includes(BEAUTY),
  cats.join('|'));

check('A2 两个新类目已在 CAT_ICON / CAT_COLOR 登记（缺登记则胶囊掉成默认礼物图标与灰底）',
  new RegExp("'" + FEST + "':\\s*'🧧'").test(s) && new RegExp("'" + BEAUTY + "':\\s*'💄'").test(s) &&
  new RegExp("'" + FEST + "':\\s*'#fff8e1'").test(s) && new RegExp("'" + BEAUTY + "':\\s*'#fce4ec'").test(s));

const arrM = s.match(/const DEF_GIFTS = \[([\s\S]*?)\n  \];/);
const items = [];
if (arrM) {
  const re = /\{ id:\s*'([^']+)',\s*name:\s*'([^']*)',\s*emoji:\s*'([^']*)',\s*price:\s*([\d.]+),\s*cat:\s*'([^']+)',\s*wish:\s*'([^']*)'/g;
  let m; while ((m = re.exec(arrM[1]))) items.push({ id: m[1], name: m[2], emoji: m[3], price: parseFloat(m[4]), cat: m[5], wish: m[6] });
}
const byName = {}; items.forEach((i) => { byName[i.name] = i; });
const staticTotal = items.length;
const namesIn = (cat) => items.filter((i) => i.cat === cat).map((i) => i.name);
const missIn = (cat, want) => want.filter((n) => !namesIn(cat).includes(n));

// ① 节日节令：8 件齐全，且月饼已从「甜品」归位（否则中秋那份还单独躺在大类里）
const festMissing = missIn(FEST, FEST_NAMES);
check('A3 节日节令 8 件齐全（端午/元宵/春节/腊八/冬至/清明/圣诞/中秋各一份）且月饼已归位',
  festMissing.length === 0 && byName['月饼'] && byName['月饼'].cat === FEST && byName['月饼'].cat !== '甜品',
  { missing: festMissing, mooncake: byName['月饼'] && byName['月饼'].cat, count: namesIn(FEST).length });

// ② 美妆个护：10 件新增 + 4 件从「日常用品」移入，且原分类里不再残留
const beautyMissing = missIn(BEAUTY, BEAUTY_NEW.concat(BEAUTY_MOVED));
const beautyLeftBehind = BEAUTY_MOVED.filter((n) => byName[n] && byName[n].cat === '日常用品');
check('A4 美妆个护 14 件齐全（10 件新增 + 护手霜/润唇膏/香皂/洗浴套装移入，日常用品里不再残留）',
  beautyMissing.length === 0 && beautyLeftBehind.length === 0,
  { missing: beautyMissing, leftBehind: beautyLeftBehind, count: namesIn(BEAUTY).length });

// ③ 经期关怀：四件在「药品医护」，两件服务型在「关怀」
const periodMissing = missIn(MEDCAT, PERIOD_NAMES).concat(missIn('关怀', CARE_NAMES));
check('A5 经期关怀齐全（红糖姜茶/暖宝宝贴/热水袋/痛经贴归药品医护，帮你揉肚子/陪你躺一天归关怀）',
  periodMissing.length === 0, { missing: periodMissing });

// ④ 花束：补齐后 ≥16 件且 8 个新花材都在
const bouquetMissing = missIn('花束', BOUQUET_NEW);
check('A6 花束补齐（原 8 件 + 8 件新花材，共 ' + namesIn('花束').length + ' 件）',
  bouquetMissing.length === 0 && namesIn('花束').length >= 16, { missing: bouquetMissing });

// 全库体检：解析完整 / id 唯一 / 类内 emoji 唯一 / 字段完整
const srcItemCount = (arrM[1].match(/\{ id:\s*'/g) || []).length;
const dupIds = items.map((i) => i.id).filter((id, i, a) => a.indexOf(id) !== i);
const seenCatEmoji = {}; const dupEmojis = [];
items.forEach((i) => { const k = i.cat + '|' + i.emoji; if (seenCatEmoji[k]) dupEmojis.push(k); seenCatEmoji[k] = 1; });
const badField = items.filter((i) => !i.name || !i.emoji || !(i.price >= 0) || !cats.includes(i.cat) || !i.wish || i.wish.length > 40);
check('A7 全库 ' + staticTotal + ' 件解析完整（' + staticTotal + '/' + srcItemCount + '）、id 唯一、类内 emoji 不撞、字段完整',
  items.length === srcItemCount && items.length > 0 && dupIds.length === 0 && dupEmojis.length === 0 && badField.length === 0,
  { total: items.length, inSource: srcItemCount, dupIds, dupEmojis, badField: badField.map((b) => b.id) });

// 老用户可见性：新 id 混进 DEF_V1_IDS 会被全局迁移记成「用户删过的」
const v1M = s.match(/const DEF_V1_IDS = \{([^}]+)\}/);
const v1Ids = v1M ? [...v1M[1].matchAll(/([a-z0-9_]+): 1/g)].map((x) => x[1]) : [];
const newIds = items.filter((i) => /^g_(fest|beauty|period|bellyrub|liedown|lily|carnation|hydrangea|lotus|champagne|driedflower|ginkgo|dandelion)/.test(i.id)).map((i) => i.id);
const leaked = newIds.filter((id) => v1Ids.includes(id));
check('A8 本批新商品未混进 DEF_V1_IDS（否则老用户升级时会被迁移记成「删过的」而看不到）',
  v1Ids.length > 0 && newIds.length >= 25 && leaked.length === 0, { newIds: newIds.length, v1Count: v1Ids.length, leaked });

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

const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-gaps-'));
{
  const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : []);
  const cssFiles = parseArr(bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/));
  const jsFiles = parseArr(bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/));
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => { try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; } }).join('\n');
  if (!jsAll.includes(FEST) || !jsAll.includes(BEAUTY)) { console.error('拼接出的 JS 里没有新类目'); process.exit(1); }
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 90));
const profile = join(tmpdir(), 'mochi-gaps-' + Date.now());
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
async function marketProbe() {
  return evalJs(`(function(){
    var pg = document.getElementById('page-market');
    if (!pg || pg.hidden) { var app = document.querySelector('[data-app="market"]'); if (!app) return { open: false }; app.click(); }
    var pills = Array.prototype.map.call(document.querySelectorAll('#market-cats .market-cat-name'), function(n){ return n.textContent; });
    var names = Array.prototype.map.call(document.querySelectorAll('#market-grid .gift-item-name'), function(n){ return n.textContent; });
    return { open: true, pills: pills, pillCount: pills.length, grid: names.length, jsErr: (window.__jsErrors || []).length };
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
check('B1 市集页打开：' + cats.length + '+1 分类胶囊（两个新类目都在）、网格总数=' + staticTotal,
  st && st.open && st.pillCount === cats.length + 1 && st.grid === staticTotal &&
  st.pills.includes(FEST) && st.pills.includes(BEAUTY) && st.jsErr === 0,
  { pillCount: st && st.pillCount, grid: st && st.grid, jsErr: st && st.jsErr });

let clicked = await clickCat(FEST);
await sleep(300);
let names = await gridNames();
check('B2 点「节日节令」：只渲染本分类 ' + FEST_NAMES.length + ' 件且节令齐全',
  clicked && names && names.length === FEST_NAMES.length && FEST_NAMES.every((n) => names.includes(n)),
  { count: names && names.length, names: names });

await clickCat(BEAUTY);
await sleep(300);
names = await gridNames();
check('B3 点「美妆个护」：只渲染本分类 ' + namesIn(BEAUTY).length + ' 件且含移入的 4 件个护',
  names && names.length === namesIn(BEAUTY).length && BEAUTY_MOVED.every((n) => names.includes(n)),
  { count: names && names.length, names: names });

await clickCat('全部');
await sleep(200);
await typeSearch('暖宝宝');
await sleep(350);
names = await gridNames();
check('B4 搜口语名「暖宝宝」：命中 1 件（用户报症状时说的就是这个词）', names && names.length === 1 && names[0] === '暖宝宝贴', names);
await typeSearch('口红');
await sleep(350);
names = await gridNames();
check('B5 搜「口红」：命中 1 件（美妆从 0 件到能搜到）', names && names.length === 1 && names[0] === '口红', names);
await typeSearch('');
await sleep(300);

// ---- B 组 2：已迁移过的老档 ----
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
check('B6 老档（已迁移标记在位）：全库仍 ' + staticTotal + ' 件、两个新类目都在（升级用户看得到这批）',
  st && st.open && st.grid === staticTotal && st.pills.includes(FEST) && st.pills.includes(BEAUTY) && st.jsErr === 0,
  { grid: st && st.grid, jsErr: st && st.jsErr });
await clickCat(FEST);
await sleep(300);
names = await gridNames();
check('B7 老档点「节日节令」：仍是 ' + FEST_NAMES.length + ' 件（迁移未把新商品记成「用户删过的」）',
  names && names.length === FEST_NAMES.length, { count: names && names.length });
await unpre(pre);

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);
