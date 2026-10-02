// ===== 回归：花园数据丢失（真我 Edge：LS 缺键 + IDB 读慢/挂起 → 空花园覆盖老档） =====
// 用法：node tools/verify-garden-dataloss.mjs（内存拼装页面，不执行 build.mjs、不改 index.html）
// 根因（用户反馈「真我手机 Edge，种的花全没了」）：
//   garden.js 启动时的 IDB 找回是 fire-and-forget；真我/荣耀 Edge 等 IDB 事务可能挂起
//   （idb.js v3.9.x 已记录）。LS 缺 garden-data 时，找回完成前 checkPartnerPassive
//   （回到手机桌面即触发，lpc=0 → partnerAct+无条件 save）/进园自动保存链会把
//   「12 块全空的默认档」写回 LS+IDB，永久覆盖老花园。
// 修复断言：
//   T1 挂起一次（首次读 garden-data 返回 undefined，模拟 idbGet 超时熔断）：锁存期间
//      IDB 老花园不被覆盖；重试读到后自动采用并渲染出花；IDB 未被「12 格全空默认档」覆盖
//      （不断言三株齐全——进园时 partnerAct 的 harvestall 约 30% 概率会合法摘走已开花地块）
//   T2 v3.29.x 副本机制已下线：遗留的自动备份副本在启动后被自动清理（LS+IDB 都不剩），
//      且不再出现任何「从副本找回」弹窗（找回花园 / 检测到数据可能丢失）
//   T4 遗留副本只存在于 LS 时，「LS 大键→IDB 迁移」不得把它整包读进内存/写回 IDB（防复活）
//   T5 restore 整轮挂起（就绪标志恒假 + mochi-restore-done 被掐断）时，20 秒墙钟兜底仍完成清理
//   T3 正常路径回归：LS 有档时进园立即渲染，无锁卡顿
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

// ===== 内存拼装页面（与 build.mjs 同构，但不写任何产物文件） =====
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
const readSrc = (p) => readFileSync(join(root, 'src', p), 'utf8');
function wrapFile(f, code) {
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}
// 模拟真机慢/挂起 IDB：首次对 garden-data 的 idbGet/idbGetMany 直接按超时熔断返回
// undefined（等价 idbGet 内置 4s+4s 熔断后的结果），之后的读取直通真实数据。
// hangDelayMs 用于观察「锁定窗口内不许落盘」。
const HANG_MS = 1500;
const slowIdbChunk = `
;(function () {
  try {
    var RE = /:garden-data$/;
    var hungGet = false, hungMany = false;
    var og = window.idbGet, om = window.idbGetMany;
    window.idbGet = function (k) {
      if (!hungGet && RE.test(String(k))) { hungGet = true; window.__hangFired = true; return new Promise(function (res) { setTimeout(function () { res(undefined); }, ${HANG_MS}); }); }
      return og(k);
    };
    window.idbGetMany = function (ks) {
      ks = ks || []; var hit = false;
      for (var i = 0; i < ks.length; i++) if (RE.test(String(ks[i]))) { hit = true; break; }
      if (!hit) return om(ks);
      if (!hungMany) { hungMany = true; return new Promise(function (res) { setTimeout(function () { res({}); }, ${HANG_MS}); }); }
      return om(ks);
    };
  } catch (e) {}
})();`;
let html = readSrc('template.html');
html = html.replace('/*__STYLES__*/', cssFiles.map((f) => readSrc(join('css', f))).join('\n'));
{
  const chunks = [];
  for (const f of jsFiles) {
    chunks.push(wrapFile(f, readSrc(join('js', f))));
    if (f === 'contacts.js') chunks.push(wrapFile('__slow-idb-patch__', slowIdbChunk));
  }
  html = html.replace('/*__SCRIPTS__*/', chunks.join('\n'));
}
html = html.split('__BUILD_INFO__').join('verify');
html = html.split('__BUILD_TS__').join(String(Date.now()));
html = html.split('__APP_VERSION__').join('v0.0.verify');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (!req.url.split('?')[0].match(/\.[a-z]+$/i) || p.endsWith(root + '\\')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    if (statSync(p).isDirectory()) p = join(root, 'index.html');
    const body = p.endsWith('index.html') ? Buffer.from(html) : readFileSync(p);
    const ct = p.endsWith('index.html') ? 'text/html' : (types[extname(p)] || 'application/octet-stream');
    res.writeHead(200, { 'Content-Type': ct });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9970 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-gardenloss-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

let navSeq = 0;
async function waitFor(expr, tries = 60, step = 300) {
  for (let i = 0; i < tries; i++) { if (await evalJs(expr)) return true; await sleep(step); }
  return false;
}
async function coldStart(opts) {
  opts = opts || {};
  // Page.navigate 立即返回且求值可能仍落在旧文档上；先在旧文档打标记，
  // 等标记消失（文档已被替换）再等脚本就绪，否则用例会偶发误报。
  const token = 'nav' + Date.now().toString(36) + '-' + (++navSeq);
  await evalJs(`window.__navToken = ${JSON.stringify(token)}; true`);
  await cdp('Page.navigate', { url: baseUrl + '/' });
  await waitFor(`window.__navToken !== ${JSON.stringify(token)}`, 60, 250);
  await sleep(2200);
  await waitFor("typeof window.idbGet === 'function' && typeof window.idbGetMany === 'function' && typeof window.idbSet === 'function'");
  if (opts.ready === false) return; // 该用例刻意让「数据就绪」永不发生，等它只会空转到超时
  await waitFor('!!window.__mochiDataReady');
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(700);
}
async function gotoPage() { await coldStart(); }
async function clearOrigin() {
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexed_storage,cookies' });
  await sleep(300);
}
async function idbRaw(key) {
  // 注意：被测页的“首次挂起”补丁会让第一次读返回 undefined——取样失败时等挂起窗口
  // 过去后重试一次，避免测试自身吃到挂起结果误判
  const first = await evalJs(`(function(){return new Promise(function(res){ window.idbGet(${JSON.stringify(key)}).then(function(v){ res(v == null ? 'null' : String(v).slice(0, 400000)); }).catch(function(){ res('err'); }); });})()`);
  if (first !== 'null' && first !== 'err') return first;
  await sleep(HANG_MS + 800);
  const second = await evalJs(`(function(){return new Promise(function(res){ window.idbGet(${JSON.stringify(key)}).then(function(v){ res(v == null ? 'null' : String(v).slice(0, 400000)); }).catch(function(){ res('err'); }); });})()`);
  return second;
}

// ---------- 公共种子 ----------
const NOW = Math.floor(Date.now() / 1000);
const oldGarden = JSON.stringify({
  p: [
    { type: 'rose', planted: NOW - 86400 * 3 },
    { type: 'tulip', planted: NOW - 86400 * 2 },
    { type: 'lavender', planted: NOW - 86400 * 5 },
    null, null, null, null, null, null, null, null, null
  ],
  l: [{ who: '我', t: '种下了玫瑰', ts: NOW - 86400 * 3 }],
  lpc: NOW - 3600, exp: 120, inv: { rose: 2 }, dex: {},
  st: { p: 3, w: 1, h: 0, f: 0, mp: 0, mw: 0, mh: 0, mf: 0 }, decor: {}, visitor: null
});
async function seedDummies() {
  // 3 个无害业务键：供 Case B 校验「清理副本只动那一个键，不误伤业务数据」
  await evalJs(`(function(){ return Promise.all([
    window.idbSet('xy-home-v2:t-dummy-1','d1'),
    window.idbSet('xy-home-v2:t-dummy-2','d2'),
    window.idbSet('xy-home-v2:t-dummy-3','d3')
  ]).then(function(){ return true; }); })()`);
  await sleep(400);
}
const GK = 'xy-home-v2:default:garden-data';
async function plotCount() {
  return evalJs(`document.querySelectorAll('#page-garden .garden-plot:not(.empty)').length`);
}
async function openGarden() {
  await evalJs(`(function(){ var a=document.querySelector('.app[data-app="garden"]'); if(a){a.click();return true;} return false; })()`);
}
async function jsErrors() { return evalJs('JSON.stringify(window.__jsErrors || [])'); }

// ========== Case A：IDB 有老花园，首次读挂起 → 不许覆盖 + 重试后自动找回 ==========
await gotoPage(); // 首次加载仅用于播种
await seedDummies();
const seedOk = await evalJs(`(function(){
  localStorage.removeItem('${GK}');
  return window.idbSet('${GK}', ${JSON.stringify(oldGarden)});
})()`);
check('A0 种子：老花园(3株)只写 IDB，LS 移除', seedOk === true);
await sleep(500);

// 被测冷启动：手动分步，锁定窗口（挂起 1.5s + 真实重读）内采样
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(800); // 启动探测已发起；watchHome 的 checkPartnerPassive 也已在此窗口触发过
check('A1 慢IDB补丁已生效（首次读挂起）', await evalJs('!!window.__hangFired') === true);
const earlyIdb = await idbRaw(GK);
check('A2 锁定窗口内：IDB 老花园未被空档覆盖', earlyIdb.indexOf('"type":"rose"') >= 0,
  earlyIdb === 'null' ? 'IDB键没了' : earlyIdb.slice(0, 80));
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(700);
// 采样必须在进园之前：openGarden 里 partnerAct 的 harvestall（约 30% 概率）会把所有
// 已开花地块合法收进背包并置 null，进园后再断言「三株齐全」是在和应用自身的随机互动赛跑。
const lsAdopted = await waitFor(`(function(){var v=localStorage.getItem('${GK}')||'';return v.indexOf('"type":"rose"')>=0;})()`, 30, 300);
const afterIdb = await idbRaw(GK);
// 本用例要守的是「老花园没被 12 格全空的默认档覆盖」——默认档 p 全 null + exp 0 + inv 空，
// 老花园（种 3 株 / exp 120 / inv 有 rose）无论是否已被自动采摘都不会退化成那个形状。
const notEmptyDefault = await evalJs(`(function(){ return new Promise(function(res){ window.idbGet('${GK}').then(function(v){
  var g = null; try { g = JSON.parse(String(v)); } catch (e) {}
  if (!g || !g.p) { res('no-data'); return; }
  res(g.p.filter(Boolean).length > 0 || (g.exp || 0) > 0 || Object.keys(g.inv || {}).length > 0);
}).catch(function(){ res('err'); }); }); })()`);
check('A3 判定完成后：IDB 仍是老花园（未被 12 格全空默认档覆盖）', notEmptyDefault === true, 'notEmpty=' + notEmptyDefault + ' raw=' + String(afterIdb).slice(0, 60));
check('A4 找回的数据已回填 localStorage', lsAdopted === true);
await openGarden();
await sleep(2500);
check('A5 花园页渲染出非空地块 ≥2', (await plotCount()) >= 2, 'plots=' + (await plotCount()));
const errsA = JSON.parse(await jsErrors() || '[]');
check('A6 无 JS 运行时错误', errsA.length === 0, errsA.join('|'));

// ========== Case B：遗留自动备份副本 → 启动后自动清理 + 不再弹「从副本找回」 ==========
const SNAP = 'xy-home-v2:__auto-backup-snapshot';
await clearOrigin();
await gotoPage();
await seedDummies();
// 先等本轮启动的清理链收尾：purgeLegacySnapshot 会「删 → 2.5s 后复核 → 仍在则再删，最多 3 次」，
// 播种写进这条链里会被应用自己删掉（表现为 B0 偶发失败 + B1 因键本就不存在而白过）。
await sleep(11000);
const hasSnap = `(function(){ return new Promise(function(res){
  if (!window.idbHasKey) { res(false); return; }
  window.idbHasKey(${JSON.stringify(SNAP)}).then(function(h){ res(h === true); }).catch(function(){ res(false); });
}); })()`;
const seedSnap = async () => evalJs(`(function(){
  var snap = { version:'1.0', app:'mochi-zika', exportTime:new Date().toISOString(), ls:{}, idb:{} };
  snap.ls['${GK}'] = ${JSON.stringify(oldGarden)};
  var raw = JSON.stringify(snap);
  try { localStorage.setItem('${SNAP}', raw); } catch (e) {}
  try { window.idbSet('${SNAP}', raw); } catch (e) {}
  return true;
})()`);
// 连续两次读数都为「存在」（间隔 3s，覆盖复核窗口）才认定种子站稳
let snapSeeded = false;
for (let i = 0; i < 6 && !snapSeeded; i++) {
  await seedSnap();
  const first = await waitFor(hasSnap, 10, 300);
  await sleep(3000);
  const second = await evalJs(hasSnap);
  snapSeeded = first === true && second === true;
}
check('B0 种子：遗留副本已写入 IDB 且未被清理链删除', snapSeeded === true);
// 花园业务键清空 → 旧版本会在此场景弹「找回花园」（整包 JSON.parse 副本）
await evalJs(`(function(){ localStorage.removeItem('${GK}'); try { window.idbDelete('${GK}'); } catch (e) {} return true; })()`);
await sleep(600);

// 冷启动被测页：purgeLegacySnapshot 在数据就绪后 1.5s 执行；整段轮询窗口内同时盯弹窗
await cdp('Page.navigate', { url: baseUrl + '/' });
let purgedIdb = false;
let snapModal = '';
for (let i = 0; i < 45; i++) { // 最多 18s：覆盖导航提交 + 就绪后 1.5s 清理 + 旧代码两处副本弹窗时机
  if (!purgedIdb) purgedIdb = await evalJs(hasSnap) === false;
  const t = await evalJs(`(function(){ var m=document.getElementById('modal-mask'); if(!m||m.hidden) return ''; var x=document.getElementById('modal-title'); return x?String(x.textContent):''; })()`);
  const ts = String(t || '');
  if (ts.indexOf('找回') >= 0 || ts.indexOf('副本') >= 0 || ts.indexOf('数据可能丢失') >= 0) snapModal = ts;
  if (purgedIdb && snapModal) break;
  await sleep(400);
}
// idbHasKey 严格三态：false＝确认库里没有；true＝还在；null/未就绪＝不能下结论
check('B1 启动后遗留副本已从 IndexedDB 自动清理', snapSeeded === true && purgedIdb === true, 'seeded=' + snapSeeded + ' gone=' + purgedIdb);
check('B2 启动后遗留副本已从 localStorage 自动清理', await evalJs(`localStorage.getItem(${JSON.stringify(SNAP)}) === null`) === true);
check('B3 不再出现任何「从副本找回/数据丢失」弹窗', snapModal === '', 'title=' + snapModal);
const dummiesOk = await evalJs(`(function(){ return new Promise(function(res){ window.idbGetMany(['xy-home-v2:t-dummy-1','xy-home-v2:t-dummy-2','xy-home-v2:t-dummy-3']).then(function(m){ res(!!m && m['xy-home-v2:t-dummy-1'] === 'd1' && m['xy-home-v2:t-dummy-2'] === 'd2' && m['xy-home-v2:t-dummy-3'] === 'd3'); }).catch(function(){ res(false); }); }); })()`);
check('B4 清理只动副本键，业务键完好', dummiesOk === true);
const errsB = JSON.parse(await jsErrors() || '[]');
check('B5 无 JS 运行时错误', errsB.length === 0, errsB.join('|'));

// ========== Case C：正常路径回归（LS 有档 → 进园立即渲染，不受锁影响） ==========
await clearOrigin();
await gotoPage();
await seedDummies();
await evalJs(`(function(){ window.xyStore('xy-home-v2:default').set('garden-data', ${JSON.stringify(oldGarden)}); return true; })()`);
await sleep(600); // xyStore.set 双写 LS+IDB
await gotoPage();
const t0 = Date.now();
await openGarden();
await sleep(900);
check('C1 LS 有档：进园立即渲染（无锁卡顿）', (await plotCount()) >= 2, 'plots=' + (await plotCount()));
const cIdb = await idbRaw(GK);
check('C2 正常路径 IDB 数据完好', cIdb.indexOf('"type":"rose"') >= 0);
const errsC = JSON.parse(await jsErrors() || '[]');
check('C3 无 JS 运行时错误', errsC.length === 0, errsC.join('|'));

// ========== Case D：遗留副本只在 LS 时，不许被「LS 大键→IDB 迁移」复活 ==========
// 判据是 memoryCache（idbGetCached）：迁移循环命中该键时会 `memoryCache[k] = v` 全会话常驻，
// 修好后永远拿不到值。注意方向性——本用例对「已修」必然通过，对「未修」在 purge 先删掉 LS
// 的少数时序下可能漏报；漏报只影响抓 bug 的灵敏度，不会造成假失败。
await clearOrigin();
await gotoPage();
await seedDummies();
await sleep(11000); // 等本轮启动的清理链收尾（与 Case B 同理）
const bigSeed = await evalJs(`(function(){
  var pad = ''; while (pad.length < 420000) pad += '0123456789abcdef';
  var raw = JSON.stringify({ version: '1.0', app: 'mochi-zika', pad: pad });
  try { localStorage.setItem(${JSON.stringify(SNAP)}, raw); } catch (e) { return 'ls-fail'; }
  try { window.idbDelete(${JSON.stringify(SNAP)}); } catch (e) {}
  return raw.length;
})()`);
check('D0 种子：400KB 级副本只存在于 localStorage（超 LS_BIG_LIMIT）', Number(bigSeed) > 400000, 'len=' + bigSeed);
// 迁移标记是 sessionStorage（同标签页跨导航保留），不清掉就不会重跑迁移，用例会白过
await evalJs("(function(){ try { sessionStorage.removeItem('xy-ls-big-migrated'); } catch (e) {} return true; })()");
await gotoPage();
await sleep(7000); // 留足迁移写入窗口
const cachedSnap = await evalJs(`(function(){ try {
  var v = window.idbGetCached(${JSON.stringify(SNAP)}); // 同步：memoryCache 命中才返回，否则 undefined
  return v == null ? 'empty' : String(v).length;
} catch (e) { return 'no-api'; } })()`);
check('D1 迁移没有把整包副本常驻内存（memoryCache 里没有该键）', cachedSnap === 'empty', 'cached=' + cachedSnap);
check('D2 迁移没有把副本写回 IndexedDB', await evalJs(hasSnap) === false);
check('D3 副本已从 localStorage 清理', await evalJs(`localStorage.getItem(${JSON.stringify(SNAP)}) === null`) === true);
const dummiesD = await evalJs(`(function(){ return new Promise(function(res){ window.idbGetMany(['xy-home-v2:t-dummy-1','xy-home-v2:t-dummy-2','xy-home-v2:t-dummy-3']).then(function(m){ res(!!m && m['xy-home-v2:t-dummy-1'] === 'd1' && m['xy-home-v2:t-dummy-2'] === 'd2' && m['xy-home-v2:t-dummy-3'] === 'd3'); }).catch(function(){ res(false); }); }); })()`);
check('D4 业务键完好', dummiesD === true);
const errsD = JSON.parse(await jsErrors() || '[]');
check('D5 无 JS 运行时错误', errsD.length === 0, errsD.join('|'));

// ========== Case E：restore 整轮挂起（就绪标志/事件都拿不到）时，墙钟兜底仍要清理 ==========
// #83 之后 12 秒保险丝不再设 __mochiDataReady，这类设备上 mochi-restore-done 永不到达。
// 用 addScriptToEvaluateOnNewDocument 在任何页面脚本之前把就绪标志钉死为假 + 掐断事件，
// 忠实复现该场景：事件路径不可能清理，只剩 20 秒墙钟兜底这一条腿。
const blocker = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
  try { Object.defineProperty(window, '__mochiDataReady', { configurable: true, get: function () { return false; }, set: function () {} }); } catch (e) {}
  try { document.addEventListener('mochi-restore-done', function (e) { e.stopImmediatePropagation(); }, false); } catch (e) {}
  window.__eBlockRestore = true;
})();` });
await clearOrigin();
await gotoPage();
await seedDummies();
await sleep(11000);
await evalJs(`(function(){
  var raw = JSON.stringify({ version: '1.0', app: 'mochi-zika', ls: {}, idb: {} });
  try { localStorage.setItem(${JSON.stringify(SNAP)}, raw); } catch (e) {}
  try { window.idbSet(${JSON.stringify(SNAP)}, raw); } catch (e) {}
  return true;
})()`);
await sleep(1200);
const seededE = await evalJs(hasSnap) === true;
check('E0 种子：副本已在 IDB（挂起场景下等待清理）', seededE === true);
await coldStart({ ready: false });
const blocked = await evalJs('window.__eBlockRestore === true && window.__mochiDataReady === false');
check('E1 场景注入生效（就绪标志恒假 + 事件被掐断）', blocked === true);
await sleep(8000);
const stillThere = await evalJs(hasSnap) === true;
check('E2 事件路径确已失效：8 秒时副本仍在（清理只能靠墙钟兜底）', stillThere === true, 'stillThere=' + stillThere);
const purgedE = await waitFor(`(function(){ return new Promise(function(res){
  window.idbHasKey(${JSON.stringify(SNAP)}).then(function (h) { res(h === false); }).catch(function () { res(false); });
}); })()`, 70, 500);
check('E3 20 秒墙钟兜底完成清理', purgedE === true && stillThere === true);
check('E4 兜底清理未波及业务键', await evalJs(`(function(){ return new Promise(function(res){ window.idbGetMany(['xy-home-v2:t-dummy-1','xy-home-v2:t-dummy-2','xy-home-v2:t-dummy-3']).then(function(m){ res(!!m && m['xy-home-v2:t-dummy-1'] === 'd1'); }).catch(function(){ res(false); }); }); })()`) === true);
try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocker.identifier || blocker.id }); } catch (e) {}

// ========== 汇总 ==========
const fail = results.filter(r => !r.ok);
console.log('\n===== verify-garden-dataloss: ' + (results.length - fail.length) + '/' + results.length + ' =====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail.length ? 1 : 0);
