// ===== 心意市集 v3 扩库专项验证（src/js/gift-shop.js「两个世界」分类 + 日常扩容） =====
// 用法：node tools/verify-gift-market-v3.mjs（自组装临时站点，不依赖也不触发 node build.mjs）
// 覆盖：
//   A 组静态断言：新分类登记 / 61 件新商品字段完整且 id 唯一 / DEF_V3_IDS 与新 id 集合一致 /
//     rescueBatch 双标记接线 / contacts.js EXCLUDE 登记 market-migrated-v3
//   B 组运行时（无头 Chrome）：分类胶囊与商品总数 / 「两个世界」筛选 14 件 /
//     购买链路（弹窗预填→送出→扣款→心意柜入账）/ v3 救援清误标 del 且一次性语义正确
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// ---- 新商品清单（与源码保持同步的预期集合）----
const NEW_IDS = ['g_card', 'g_blindbox', 'g_stickers', 'g_wordsbag', 'g_nearby', 'g_hands', 'g_patpat', 'g_unseen',
  'g_heartlink', 'g_amulet', 'g_courier', 'g_dreammeet', 'g_moonmeet', 'g_bridge',
  'g_daisy', 'g_cookie', 'g_oden', 'g_tanghulu', 'g_starear', 'g_picnic', 'g_nightmarket', 'g_boardgame',
  'g_telescope', 'g_walk', 'g_lullaby', 'g_eyemask', 'g_lipbalm', 'g_thermos', 'g_plant',
  'g_handcream', 'g_soap', 'g_wipes', 'g_bandaid', 'g_mask', 'g_powerbank', 'g_cable', 'g_canvasbag',
  'g_hat', 'g_gloves', 'g_calendar', 'g_bear', 'g_humid', 'g_lunchbox', 'g_pill', 'g_phonestand',
  'g_thermo', 'g_clipper', 'g_storage', 'g_luggage', 'g_backpack', 'g_glasses', 'g_vase', 'g_chopsticks',
  'g_pen', 'g_stickynote', 'g_powerstrip', 'g_wallet', 'g_cap', 'g_hairtie', 'g_fan', 'g_mousepad',
  'g_burger', 'g_pizza', 'g_friedchicken', 'g_riceball', 'g_dumplings', 'g_crayfish', 'g_honey', 'g_donut',
  'g_pancake', 'g_layerscake', 'g_sunrise', 'g_cycling', 'g_roadtrip', 'g_pottery', 'g_puzzle', 'g_gamenight',
  'g_listen', 'g_photoshoot', 'g_bathbomb', 'g_icecube', 'g_flashlight', 'g_cardholder', 'g_planet', 'g_comet',
  'g_curry', 'g_friedshrimp', 'g_sandwich', 'g_fries', 'g_coconut', 'g_fortune', 'g_cupcake', 'g_lollipop',
  'g_sundae', 'g_cactus', 'g_clover', 'g_earth', 'g_trainslow', 'g_island', 'g_hike', 'g_supermarket',
  'g_darts', 'g_musicfestival', 'g_bowling', 'g_cheer', 'g_nightcall', 'g_lovejournal', 'g_pendant', 'g_sponge',
  'g_pasta', 'g_wrap', 'g_salad', 'g_pretzel', 'g_mooncake', 'g_beads', 'g_sunglasses', 'g_crystal',
  'g_shinystar', 'g_partlycloudy', 'g_rollercoaster', 'g_sailboat', 'g_rowboat', 'g_taxi', 'g_carousel', 'g_theater',
  'g_homecook', 'g_windchime', 'g_contract', 'g_coat', 'g_dress', 'g_pencil', 'g_bookmark', 'g_compass', 'g_couchblanket',
  'g_watermelon', 'g_lemon', 'g_corn', 'g_tomato', 'g_peanut', 'g_grape', 'g_mango', 'g_brooch',
  'g_rocket', 'g_ufo', 'g_starface', 'g_kite', 'g_heli', 'g_cruise', 'g_pingpong', 'g_badminton',
  'g_fishing', 'g_skating', 'g_piano', 'g_balloon', 'g_camera', 'g_radio', 'g_mirror', 'g_sweater',
  'g_bathset', 'g_mosquito', 'g_keyboard', 'g_books', 'g_speaker', 'g_oatmeal', 'g_cushion', 'g_wallclock',
  'g_foodbox', 'g_bunny', 'g_teapot', 'g_yogamat', 'g_dumbbell', 'g_sewing', 'g_snackbox', 'g_sachet',
  'g_fireworks', 'g_billiards', 'g_yoyo', 'g_watercolor', 'g_guitar', 'g_archery', 'g_iceskate', 'g_sparkler',
  'g_wishbamboo', 'g_magicwand', 'g_surf', 'g_snorkel', 'g_fridgemagnet', 'g_bellservice', 'g_projector',
  'g_fountainpen', 'g_partypopper',
  'g_specialdrink', 'g_sourplum', 'g_bubbly', 'g_orange', 'g_apple', 'g_pear', 'g_peachjuicy',
  'g_kiwi', 'g_pineapple', 'g_cherry', 'g_shavedice',
  'g_coffee', 'g_paotui', 'g_hotdog', 'g_bread', 'g_croissant', 'g_squid',
  'g_waffle', 'g_eggtart',
  'g_mangosago', 'g_matchalatte', 'g_lemontea', 'g_grapetea', 'g_peachtea',
  'g_malatang', 'g_spicywok', 'g_ricechicken', 'g_legquarter', 'g_taco', 'g_baguette', 'g_bagel'];
const CATS_EXPECT = ['花束', '甜品', '饮品', '美食', '饰品', '星空', '两个世界', '出行', '娱乐', '关怀', '情侣用品', '日常用品', '药品医护', '节日节令', '美妆个护'];

// ---- A 组：源码静态断言 ----
let staticTotal = 0;
{
  const s = readFileSync(join(root, 'src', 'js', 'gift-shop.js'), 'utf8');

  const catsM = s.match(/const CATS = \[([^\]]+)\]/);
  const cats = catsM ? [...catsM[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  check('A1 CATS 含「两个世界」「饮品」且顺序正确、共13类（#859 追加「药品医护」）',
    JSON.stringify(cats) === JSON.stringify(CATS_EXPECT), cats.join('|'));

  check('A2 CAT_ICON/CAT_COLOR 已登记新分类（两个世界🌗/#e0f7fa、饮品🧋/#ffe0b2）',
    /'两个世界':\s*'🌗'/.test(s) && /'两个世界':\s*'#e0f7fa'/.test(s) &&
    /'饮品':\s*'🧋'/.test(s) && /'饮品':\s*'#ffe0b2'/.test(s));

  // 解析 DEF_GIFTS 数组条目
  const arrM = s.match(/const DEF_GIFTS = \[([\s\S]*?)\n  \];/);
  const items = [];
  if (arrM) {
    const re = /\{ id:\s*'([^']+)',\s*name:\s*'([^']*)',\s*emoji:\s*'([^']*)',\s*price:\s*([\d.]+),\s*cat:\s*'([^']+)',\s*wish:\s*'([^']*)'/g;
    let m; while ((m = re.exec(arrM[1]))) items.push({ id: m[1], name: m[2], emoji: m[3], price: parseFloat(m[4]), cat: m[5], wish: m[6] });
  }
  staticTotal = items.length;
  const dupIds = items.map((i) => i.id).filter((id, i, a) => a.indexOf(id) !== i);
  // 同分类内 emoji 必须唯一（跨分类允许复用，如水果同时出现在美食与饮品）
  const seenCatEmoji = {};
  const dupEmojis = [];
  items.forEach((i) => { const k = i.cat + '|' + i.emoji; if (seenCatEmoji[k]) { if (!dupEmojis.includes(k)) dupEmojis.push(k); } seenCatEmoji[k] = 1; });
  // #859：条目总数不再写死（每扩库一次就过期一次）——改成「解析数 == 源码里的条目数」，
  // 仍然能拦住漏解析/正则不匹配，扩库不必再来改这里。
  const srcItemCount = (arrM[1].match(/\{ id:\s*'/g) || []).length;
  check('A3 DEF_GIFTS 全条目解析成功（' + items.length + '/' + srcItemCount + '）且 id 唯一、分类内 emoji 唯一',
    items.length === srcItemCount && items.length > 0 && dupIds.length === 0 && dupEmojis.length === 0,
    { total: items.length, inSource: srcItemCount, dupIds, dupEmojis });

  const missing = NEW_IDS.filter((id) => !items.some((i) => i.id === id));
  const badField = items.filter((i) => !i.name || !i.emoji || !(i.price >= 0) || !CATS_EXPECT.includes(i.cat) || !i.wish || i.wish.length > 40);
  check('A4 222 件新商品全部存在且字段完整（wish≤40/cat合法/价格≥0）', missing.length === 0 && badField.length === 0 && NEW_IDS.every((id) => !dupIds.includes(id)),
    { missing, badField: badField.map((b) => b.id) });

  const v3M = s.match(/const DEF_V3_IDS = \{([^}]+)\}/);
  const v3Ids = v3M ? [...v3M[1].matchAll(/([a-z0-9_]+): 1/g)].map((x) => x[1]) : [];
  const v3Match = v3Ids.length === NEW_IDS.length && NEW_IDS.every((id) => v3Ids.includes(id));
  check('A5 DEF_V3_IDS 与新商品 id 集合完全一致（222 个）', v3Match,
    { v3Count: v3Ids.length, diff: v3Ids.filter((x) => !NEW_IDS.includes(x)).concat(NEW_IDS.filter((x) => !v3Ids.includes(x))) });

  // 原散落的喝的已归入「饮品」分类
  const byId = {};
  items.forEach((i) => { byId[i.id] = i; });
  const movedOk = ['g_tea', 'g_juice', 'g_milk', 'g_coconut', 'g_teapot'].every((id) => byId[id] && byId[id].cat === '饮品');
  check('A6 奶茶/果汁/热牛奶/椰子/一壶茶 已归入「饮品」分类', movedOk,
    { tea: byId.g_tea && byId.g_tea.cat, juice: byId.g_juice && byId.g_juice.cat, milk: byId.g_milk && byId.g_milk.cat, coconut: byId.g_coconut && byId.g_coconut.cat, teapot: byId.g_teapot && byId.g_teapot.cat });

  check('A7 rescueBatch 接线 v2+v3 双标记（幂等救援）',
    /rescueBatch\(DEF_V2_IDS,\s*'market-migrated-v2'\)/.test(s) && /rescueBatch\(DEF_V3_IDS,\s*'market-migrated-v3'\)/.test(s));

  const ct = readFileSync(join(root, 'src', 'js', 'contacts.js'), 'utf8');
  check('A8 contacts.js EXCLUDE 已登记 market-migrated-v3（防 migrateLegacy 误迁标记键）', ct.includes(`'market-migrated-v3'`));

  check('A9 搜索接线：双入口输入框 + filterGifts 跨分类过滤 + 面板 init 注入',
    s.includes(`searchRowHtml('market-search')`) && s.includes(`bindSearchRow('market-search', renderMarket)`) &&
    s.includes(`searchRowHtml('gift-search')`) && s.includes(`bindSearchRow('gift-search', giftPanelRerender)`) &&
    /function filterGifts\(/.test(s) && /resetSearchInput\('gift-search'\)/.test(s));

  const mc = readFileSync(join(root, 'src', 'css', 'market.css'), 'utf8');
  check('A10 market.css 搜索行样式齐（浅色+深色）',
    mc.includes('.market-search-row') && mc.includes('.market-search-clear') &&
    mc.includes('[data-theme="dark"] .market-search'));
}

if (!results.every((r) => r.ok)) { console.log('\n静态断言未全过，跳过运行时组'); process.exit(1); }

// ---- 运行时环境 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

// 自组装临时站点：index.html 由 src 源文件现场拼接（文件清单从 build.mjs 提取，防手抄漂移）
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-gmv3-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  if (!jsAll.includes("'两个世界'") || !jsAll.includes('market-migrated-v3')) { console.error('JS 拼接缺少 gift-shop v3 扩库内容'); process.exit(1); }
  writeFileSync(join(tmpSite, 'index.html'),
    html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll));
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gmv3-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
async function preScript(src) {
  const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: src });
  return r.identifier;
}
async function unpre(id) { try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); } catch (e) {} }
async function marketProbe() {
  return evalJs(`(function(){
    var pg = document.getElementById('page-market');
    if (!pg || pg.hidden) {
      var app = document.querySelector('[data-app="market"]');
      if (!app) return { open: false };
      app.click();
    }
    var pills = Array.prototype.map.call(document.querySelectorAll('#market-cats .market-cat-name'), function(n){ return n.textContent; });
    var grid = document.querySelectorAll('#market-grid .gift-item').length;
    return { open: true, pills: pills, pillCount: pills.length, grid: grid,
      jsErr: (window.__jsErrors || []).length };
  })()`);
}
async function clickCat(name) {
  return evalJs(`(function(){
    var btns = document.querySelectorAll('#market-cats .market-cat');
    for (var i=0;i<btns.length;i++) {
      var n = btns[i].querySelector('.market-cat-name');
      if (n && n.textContent === ${JSON.stringify(name)}) { btns[i].click(); return true; }
    }
    return false;
  })()`);
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- B 组 1：全新档案 → 市集渲染 ----
await gotoApp();
let s = await marketProbe();
check('B1 市集页打开：' + CATS_EXPECT.length + '+1 分类胶囊齐全，网格总数=' + staticTotal + '，无 JS 异常',
  s && s.open && s.pillCount === CATS_EXPECT.length + 1 && s.grid === staticTotal && s.jsErr === 0,
  { pillCount: s && s.pillCount, grid: s && s.grid, pills: s && s.pills, jsErr: s && s.jsErr });

check('B2 「两个世界」胶囊在分类栏中（饮品插入后第7个）', s && s.pills && s.pills.indexOf('两个世界') === 7, s && s.pills);

// 点击「两个世界」分类
let ok = await clickCat('两个世界');
await sleep(300);
let w = await evalJs(`(function(){
  var names = Array.prototype.map.call(document.querySelectorAll('#market-grid .gift-item-name'), function(n){ return n.textContent; });
  return { count: names.length, names: names };
})()`);
const WV_NAMES = ['手写字卡', '字卡盲盒', '表情包补给', '千言锦囊', '身边坐标', '隔空牵手', '摸摸头', '看不见的抱抱', '心跳感应', '平安符', '跨界快递', '同一场梦', '同时看月亮', '世界之桥'];
check('B3 「两个世界」筛选出 14 件世界观商品且名称齐全', ok && w && w.count === 14 && WV_NAMES.every((n) => w.names.includes(n)),
  { count: w && w.count, names: w && w.names });

// ---- S 组：商品文字搜索（市集页 + 送礼面板）----
async function typeSearch(id, txt) {
  return evalJs(`(function(){
    var i = document.getElementById(${JSON.stringify(id)});
    if (!i) return false;
    i.value = ${JSON.stringify(txt)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}
async function gridState() {
  return evalJs(`(function(){
    var names = Array.prototype.map.call(document.querySelectorAll('#market-grid .gift-item-name'), function(n){ return n.textContent; });
    var empty = document.querySelector('#market-grid .gift-empty');
    var clr = document.getElementById('market-search-clear');
    return { count: names.length, names: names, empty: empty ? empty.textContent : '', clrHidden: clr ? clr.hidden : null };
  })()`);
}
// S1 市集页搜索命中（西瓜在美食分类，当前停在「两个世界」→ 验证跨分类）
ok = await typeSearch('market-search', '西瓜');
await sleep(300);
w = await gridState();
check('S1 市集页输入「西瓜」：跨分类命中 1 件、✕ 清除按钮出现',
  ok && w && w.count === 1 && w.names[0] === '西瓜' && w.clrHidden === false,
  { count: w && w.count, names: w && w.names, clrHidden: w && w.clrHidden });
// S2 无结果文案 + 点 ✕ 恢复全量
ok = await typeSearch('market-search', '不存在的商品xyz');
await sleep(300);
w = await gridState();
const s2empty = w && w.count === 0 && String(w.empty).indexOf('不存在的商品xyz') >= 0;
ok = await evalJs(`document.getElementById('market-search-clear').click(); true;`);
await sleep(300);
w = await gridState();
check('S2 无结果提示含关键词；点 ✕ 后恢复分类视图且按钮隐藏', s2empty && ok && w.count === 14 && w.clrHidden === true,
  { s2empty, count: w && w.count, clrHidden: w && w.clrHidden });
// S3 先选分类再搜索：搜索优先于分类（花束分类下搜「毛巾」应命中日常用品）
ok = await clickCat('花束');
await sleep(300);
ok = await typeSearch('market-search', '毛巾');
await sleep(300);
w = await gridState();
check('S3 「花束」分类下搜「毛巾」仍跨分类命中', ok && w && w.count === 1 && w.names[0] === '毛巾',
  { count: w && w.count, names: w && w.names });
ok = await evalJs(`document.getElementById('market-search-clear').click(); true;`);
await sleep(300);
ok = await clickCat('全部'); // 复位分类，供后续购买链路使用
await sleep(300);

// ---- B 组 2：购买链路（手写字卡 ¥1.30 → 送出 → 扣款 → 心意柜入账）----
ok = await evalJs(`(function(){
  var items = document.querySelectorAll('#market-grid .gift-item');
  for (var i=0;i<items.length;i++) {
    var n = items[i].querySelector('.gift-item-name');
    if (n && n.textContent === '手写字卡') { items[i].click(); return true; }
  }
  return false;
})()`);
await sleep(400);
let d = await evalJs(`(function(){
  var tc = document.getElementById('tc-mask');
  var title = document.getElementById('tc-panel-title');
  var wishEl = document.getElementById('gb-wish');
  // 安卓内核下 textarea 被 mobile-adapt 转 ce-ghost（值走代理）：读空时依次从
  // ce-box 内容、幽灵框初始 textContent 取值兜底（未改动时初值留在 textContent）
  var prefill = wishEl ? String(wishEl.value || '') : '';
  if (!prefill && wishEl) {
    var box = wishEl.__ceBox || (wishEl.parentNode && wishEl.parentNode.querySelector('.ce-box[data-for="gb-wish"]'));
    if (box) prefill = String(box.textContent || '');
  }
  if (!prefill && wishEl) prefill = String(wishEl.textContent || '');
  var okBtn = document.getElementById('gb-ok');
  return { visible: !!(tc && !tc.hidden), title: title ? title.textContent : '',
    prefill: prefill, hasOk: !!okBtn };
})()`);
check('B4 点手写字卡弹出购买面板且默认留言预填', ok && d && d.visible && String(d.title).indexOf('手写字卡') >= 0 &&
  String(d.prefill).indexOf('每个字都挑过了') >= 0 && d.hasOk, d);

ok = await evalJs(`document.getElementById('gb-ok').click(); true;`);
await sleep(500);
let buy = await evalJs(`(function(){
  var g = localStorage.getItem('xy-home-v2:gift-wallet');
  var box = localStorage.getItem('xy-home-v2:default:giftbox-items');
  var toast = document.getElementById('cc-toast');
  return { wallet: g ? JSON.parse(g) : null,
    boxHit: !!box && box.indexOf('"giftId":"g_card"') >= 0 && box.indexOf('"side":"out"') >= 0,
    toast: toast ? toast.textContent : '' };
})()`);
check('B5 送出后：我的心意币扣 ¥1.30、心意柜记一笔送出、toast「已送出」',
  ok && buy && buy.wallet && buy.wallet.myBalance === 52000 - 130 && buy.boxHit && buy.toast === '已送出', // v3.15.x：默认钱包改为 ¥520/¥520
  { myBalance: buy && buy.wallet && buy.wallet.myBalance, boxHit: buy && buy.boxHit, toast: buy && buy.toast });

// ---- S 组续：聊天送礼面板搜索 ----
ok = await evalJs(`window.openGiftPanel(); true;`);
await sleep(400);
let ps = await evalJs(`(function(){
  var panel = document.getElementById('chat-gift-panel');
  var si = document.getElementById('gift-search');
  return { visible: !!(panel && !panel.hidden), hasSearch: !!si, count: document.querySelectorAll('#gift-grid .gift-item').length };
})()`);
check('S4a 送礼面板打开：搜索框已注入，全量商品渲染', ok && ps && ps.visible && ps.hasSearch && ps.count === staticTotal,
  { visible: ps && ps.visible, hasSearch: ps && ps.hasSearch, count: ps && ps.count });
ok = await typeSearch('gift-search', '手写');
await sleep(300);
ps = await evalJs(`(function(){
  var names = Array.prototype.map.call(document.querySelectorAll('#gift-grid .gift-item-name'), function(n){ return n.textContent; });
  return { count: names.length, names: names };
})()`);
check('S4b 面板输入「手写」：命中手写字卡（留言含"随手写"的便利贴一并模糊命中属预期）', ok && ps && ps.count >= 1 && ps.names.includes('手写字卡'),
  { count: ps && ps.count, names: ps && ps.names });
ok = await typeSearch('gift-search', '');
await sleep(300);
ps = await evalJs(`(function(){
  var clr = document.getElementById('gift-search-clear');
  var panel = document.getElementById('chat-gift-panel');
  if (clr) clr.click();
  return { count: document.querySelectorAll('#gift-grid .gift-item').length, clrHidden: clr ? clr.hidden : null,
    panelVisible: !!(panel && !panel.hidden) };
})()`);
await sleep(200);
check('S4c 面板清空关键词：恢复全量、✕ 隐藏', ok && ps && ps.count === staticTotal && ps.clrHidden === true,
  { count: ps && ps.count, clrHidden: ps && ps.clrHidden });
await evalJs(`document.getElementById('chat-gift-close').click(); true;`);

// ---- B 组 3：v3 救援——误标 del 的默认商品被清一次（幂等标记生效）----
let pid = await preScript(`
  try {
    localStorage.setItem('xy-home-v2:market-custom', '[{"id":"g_bridge","del":1}]');
    localStorage.removeItem('xy-home-v2:market-migrated-v3');
  } catch (e) {}
`);
await gotoApp();
await unpre(pid);
await marketProbe(); // 重载后先点图标打开市集页
ok = await clickCat('两个世界');
await sleep(300);
w = await evalJs(`(function(){
  var names = Array.prototype.map.call(document.querySelectorAll('#market-grid .gift-item-name'), function(n){ return n.textContent; });
  var custom = localStorage.getItem('xy-home-v2:market-custom');
  var mark = localStorage.getItem('xy-home-v2:market-migrated-v3');
  return { count: names.length, hasBridge: names.indexOf('世界之桥') >= 0, custom: custom, mark: mark };
})()`);
check('B6 救援：被误标 del 的「世界之桥」恢复显示、del 标记清除、v3 幂等标记落盘',
  ok && w && w.count === 14 && w.hasBridge && w.custom === '[]' && w.mark === '1',
  { count: w && w.count, hasBridge: w && w.hasBridge, custom: w && w.custom, mark: w && w.mark });

// ---- B 组 4：救援跑过之后用户主动删除应被尊重（不再复活）----
pid = await preScript(`
  try { localStorage.setItem('xy-home-v2:market-custom', '[{"id":"g_bridge","del":1}]'); } catch (e) {}
`); // 注意：不清 market-migrated-v3（上一场景已落盘）
await gotoApp();
await unpre(pid);
await marketProbe(); // 重载后先点图标打开市集页
ok = await clickCat('两个世界');
await sleep(300);
w = await evalJs(`(function(){
  var names = Array.prototype.map.call(document.querySelectorAll('#market-grid .gift-item-name'), function(n){ return n.textContent; });
  return { count: names.length, hasBridge: names.indexOf('世界之桥') >= 0 };
})()`);
check('B7 删除尊重：标记已在时用户删的「世界之桥」保持隐藏（13件）', ok && w && w.count === 13 && !w.hasBridge,
  { count: w && w.count, hasBridge: w && w.hasBridge });

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);
