// ===== 回归 #1522：花园年报「分享到朋友圈」必须走 feed.js 正路，不得裸读裸写 feed-posts =====
// 用法：node tools/verify-1522-garden-share-feedadd.mjs（内存拼装页面，不执行 build.mjs、不改产物）
// 症状族（FIX-REGRESSION 挂账残余①②，#1349 同型零闸盲写）：
//   旧实现 `JSON.parse(xyStore.get('feed-posts')) → unshift → 整包 st.set + idbSet`：
//   ①大键架构下 feed-posts >200KB 只进 IDB（LS 无副本，#187/#582），同步读拿到 null ⇒
//     unshift 后整包写回＝IDB 权威整本被一发顶掉＝朋友圈历史全丢；
//   ②LS 里若还有多兆副本，兆级 JSON.parse + JSON.stringify + 同步 setItem 全落在点击帧＝长任务。
// 修复＝改走 window.feedAddPost(text)（period.js 月报同款；内部 load/feedGuardWrite/feedMem
//   全套闸：冷读期增量留 pending、权威重读后合并，历史绝不丢）。
// 断言：
//   S1 分享走 feedAddPost（needle 在 src/js/garden.js 唯一）；S2/S3 裸读/裸写链已退役（absent）
//   B0 种子形态成立：>200KB feed 在 IDB、LS 无副本（大键不回填 LS＝红侧可复现抹库的前提）
//   B1 分享后：3 条历史标记帖全部存活（红侧＝被 1 条新年报顶掉，本条必红＝判别核心）
//   B2 分享后 ≤35s：新年报帖也进权威库（守卫拒写→权威重读合并链完成，增量也不丢）
//   B3 全程零 JS 运行时错误
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- S 组：静态断言（不进浏览器） ----------
const sResults = [];
function sCheck(desc, ok, detail) {
  sResults.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
const gardenSrc = readFileSync(join(root, 'src', 'js', 'garden.js'), 'utf8');
sCheck('S1 分享走 feedAddPost 正路', (gardenSrc.match(/!!window\.feedAddPost\(text\)/g) || []).length === 1);
sCheck('S2 裸读链已退役（JSON.parse(st.get(FK)) 不得回流）', gardenSrc.indexOf('JSON.parse(st.get(FK)') < 0);
sCheck('S3 整包盲写已退役（st.set(FK, raw) 不得回流）', gardenSrc.indexOf('st.set(FK, raw)') < 0);

// ---------- 浏览器 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'ck-question.js', 'ta-invite.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'loc-lib.js', 'p2-features.js', 'gift-shop.js', 'memo-app.js', 'memo-arc.js', 'period.js', 'accounting.js', 'garden.js', 'room.js', 'decision.js', 'pong.js', 'snake-game.js', 'breakout.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'cjian.js', 'mobile-adapt.js'];
const readSrc = (p) => readFileSync(join(root, 'src', p), 'utf8');
function wrapFile(f, code) {
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
}
let html = readSrc('template.html');
html = html.replace('/*__STYLES__*/', cssFiles.map((f) => readSrc(join('css', f))).join('\n'));
{
  // #187 熔断形态注入（决定红侧判别力）：启动期所有对 feed-posts 的 idbGet 一律 resolve(undefined)
  // ——等价真机「首发 idbGet 4s+4s 超时熔断」（iPad QQ浏览器族实病）。feed.js boot 读失败 ⇒ feedMem 冷
  // ＋feedAuthSeen=false：红侧盲写一发抹库后无热副本自愈（真机回收/退出正是这个窗口）；绿侧走
  // feedGuardWrite 冷读闸（增量留 pending／权威探针），分享后合并不丢历史。点分享前解除挂起。
  const holdChunk = `
;(function () {
  try {
    var RE = /:feed-posts$/;
    var og = window.idbGet;
    window.__holdFk = true;
    window.idbGet = function (k) {
      if (window.__holdFk && RE.test(String(k))) return Promise.resolve(undefined);
      return og(k);
    };
  } catch (e) {}
})();`;
  const chunks = [];
  for (const f of jsFiles) {
    chunks.push(wrapFile(f, readSrc(join('js', f))));
    if (f === 'idb.js') chunks.push(wrapFile('__hold-feed-read__', holdChunk));
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-1512-' + Date.now()),
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

const results = sResults.slice();
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
let navSeq = 0;
async function waitFor(expr, tries = 60, step = 300) {
  for (let i = 0; i < tries; i++) { if (await evalJs(expr)) return true; await sleep(step); }
  return false;
}
async function coldStart() {
  const token = 'nav' + Date.now().toString(36) + '-' + (++navSeq);
  await evalJs(`window.__navToken = ${JSON.stringify(token)}; true`);
  await cdp('Page.navigate', { url: baseUrl + '/' });
  await waitFor(`window.__navToken !== ${JSON.stringify(token)}`, 60, 250);
  await sleep(2200);
  await waitFor("typeof window.idbGet === 'function' && typeof window.idbSet === 'function'");
  await waitFor('!!window.__mochiDataReady');
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(700);
}
async function jsErrors() { return evalJs('JSON.stringify(window.__jsErrors || [])'); }

// ---------- 种子 ----------
const NOW = Math.floor(Date.now() / 1000);
const FK = 'xy-home-v2:feed-posts';
const GK = 'xy-home-v2:default:garden-data';
const oldGarden = JSON.stringify({
  p: [{ type: 'rose', planted: NOW - 86400 * 3 }, null, null, null, null, null, null, null, null, null, null, null],
  l: [], lpc: NOW - 3600, exp: 120, inv: {}, dex: {},
  st: { p: 1, w: 0, h: 0, f: 0, mp: 0, mw: 0, mh: 0, mf: 0 }, decor: {}, visitor: null
});
// 3 条带唯一标记的历史帖 + 1 条垫长帖：总载荷必须 >256KB（262144 字符）——
// LS 大键线是 200KB（保证 B0 的「LS 无副本」），但内存副本释放线是 256KB（#1195e
// MEMO_BG_DROP_BYTES）；低于它 idbMemoReleaseBig 不放行＝同步层永远热读＝红侧失判。
const pad = 'P'.repeat(300 * 1024);
const seedPosts = [
  { id: 'f_seed1', role: 'me', owner: 'default', authorName: '我', taName: 'TA', taAv: '', authorAv: '', content: '1522 历史帖一号标记', imgs: [], ts: NOW * 1000 - 3000, likes: [], comments: [] },
  { id: 'f_seed2', role: 'me', owner: 'default', authorName: '我', taName: 'TA', taAv: '', authorAv: '', content: '1522 历史帖二号标记', imgs: [], ts: NOW * 1000 - 2000, likes: [], comments: [] },
  { id: 'f_seed3', role: 'me', owner: 'default', authorName: '我', taName: 'TA', taAv: '', authorAv: '', content: '1522 历史帖三号标记', imgs: [], ts: NOW * 1000 - 1000, likes: [], comments: [] },
  { id: 'f_pad', role: 'me', owner: 'default', authorName: '我', taName: 'TA', taAv: '', authorAv: '', content: pad, imgs: [], ts: NOW * 1000, likes: [], comments: [] }
];
const seedRaw = JSON.stringify(seedPosts);

await coldStart(); // 首启仅用于播种
const seedOk = await evalJs(`(function(){
  localStorage.removeItem('${FK}');
  localStorage.removeItem('${GK}');
  return window.idbSet('${FK}', ${JSON.stringify(seedRaw)}).then(function (ok1) {
    return window.idbSet('${GK}', ${JSON.stringify(oldGarden)}).then(function (ok2) { return ok1 && ok2; });
  });
})()`);
check('B-1 种子：历史帖(>200KB)+老花园只写 IDB', seedOk === true);
await sleep(400);

// 被测冷启动：让应用以「feed 大键在 IDB、LS 无副本」的真实形态起跑
await coldStart();
const lsCopy = await evalJs(`(function(){ var v = localStorage.getItem('${FK}'); return v == null ? 'absent' : ('len=' + v.length); })()`);
check('B0 种子形态成立：LS 无 feed 大键副本', lsCopy === 'absent', lsCopy);

// 模拟真机「切过一次后台/首发读熔断」：boot 期 feed-posts 的 idbGet 全部 resolve(undefined)
//（#187 熔断形态＝feedMem 冷＋同步层读空）。分享前解除挂起——之后的权威重读恢复真实数据。
const held = await evalJs('window.__holdFk === true');
check('B-4 boot 期 feed 读挂起（#187 熔断形态）生效', held === true);

// 模拟真机「切过一次后台」：#1195e 按体积放掉 ≥256KB 的内存大键副本＋登记盲读名册——
// 这才是旧盲写拿到 null 的现场（同步层读空）。回填通道可能已把种子灌进内存，必须显式放掉。
const evict = await evalJs(`(function(){ try {
  var n = window.idbMemoReleaseBig ? window.idbMemoReleaseBig() : -1;
  var cold = window.idbGetCached && window.idbGetCached('xy-home-v2:feed-posts') === undefined;
  return 'dropped=' + n + '|' + (cold ? 'sync-cold' : 'sync-warm');
} catch (e) { return 'err:' + e.message; } })()`);
check('B-5 同步层冷读形态成立（≥256KB 内存副本已释放）', /sync-cold/.test(evict), evict);

// 写侧证人（判别核心）：包住 idbSet 与 localStorage.setItem，记录每一次对 feed-posts 的写入载荷长度。
// 旧盲写那一发≈700 字符（权威是 21 万字符＝抹库形态）；新路径要么被闸拒写（零次写入）、要么写并集。
// 端态可能被 feed.js 的权威重读合并链自愈（红侧无头实测会恢复成并集）⇒ 端态断言不具判别力，
// 写侧不变量才红得稳。
await evalJs(`(function(){
  window.__fkWrites = [];
  var os = window.idbSet;
  window.idbSet = function (k, v) {
    if (/:feed-posts$/.test(String(k))) {
      var s = ''; try { s = (typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {}
      window.__fkWrites.push(String(s).length);
    }
    return os.apply(this, arguments);
  };
  // xyStore 门面证人：旧盲写在点击时才取门面（window.xyStore(...)）→ 包住它的 .set；
  // 门面内部写腿是模块加载期捕获的引用，window.idbSet/LS 补丁都看不见，只有这一层截得住。
  try {
    var oxy = window.xyStore;
    if (typeof oxy === 'function') {
      window.xyStore = function (ns) {
        var f = oxy.apply(this, arguments);
        if (f && typeof f.set === 'function' && !f.__w1515) {
          var oset = f.set;
          f.set = function (k, v) {
            if (/feed-posts$/.test(String(k))) {
              var s = ''; try { s = (typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {}
              window.__fkWrites.push('XY:' + String(s).length);
            }
            return oset.apply(this, arguments);
          };
          try { f.__w1515 = true; } catch (e) {}
        }
        return f;
      };
    }
  } catch (e) {}
  return true;
})()`);

// 进花园 → 年报 tab → 点分享
const entered = await evalJs(`(function(){ var a=document.querySelector('.app[data-app="garden"]'); if(!a) return false; a.click(); return true; })()`);
await waitFor(`!document.getElementById('page-garden').hidden`, 20, 300);
const tabHit = await evalJs(`(function(){ var b=document.querySelector('.garden-tab[data-tab="report"]'); if(!b) return false; b.click(); return true; })()`);
const shareReady = await waitFor(`!!document.getElementById('garden-report-share')`, 20, 300);
check('B-2 年报页渲染出分享按钮', !!(entered && tabHit && shareReady), 'entered=' + entered + ' tab=' + tabHit + ' share=' + shareReady);
const clicked = await evalJs(`(function(){ window.__holdFk = false; var b=document.getElementById('garden-report-share'); if(!b) return false; b.click(); return true; })()`);
check('B-3 已解除读挂起并点分享', clicked === true);

// B1/B2：权威库里历史帖全存活 + 新年报帖最终也进库（守卫拒写→权威重读合并链 ≤35s）
const feedPoll = `(function(){ return new Promise(function(res){
  window.idbGet(${JSON.stringify(FK)}).then(function(v){
    var s = v == null ? '' : String(v);
    res({ n: s ? s.length : 0,
      has1: s.indexOf('1522 历史帖一号标记') >= 0, has2: s.indexOf('1522 历史帖二号标记') >= 0,
      has3: s.indexOf('1522 历史帖三号标记') >= 0, hasNew: s.indexOf('花园年报') >= 0 });
  }).catch(function(){ res(null); });
}); })()`;
let snap = null;
for (let i = 0; i < 70; i++) {
  snap = await evalJs(feedPoll);
  if (snap && snap.has1 && snap.has2 && snap.has3 && snap.hasNew) break;
  await sleep(500);
}
check('B1 分享后 3 条历史帖全部存活（端态）', !!(snap && snap.has1 && snap.has2 && snap.has3),
  snap ? ('len=' + snap.n + ' p1=' + snap.has1 + ' p2=' + snap.has2 + ' p3=' + snap.has3) : 'idbGet 失败');
check('B2 新年报帖 ≤35s 进权威库（增量不丢）', !!(snap && snap.hasNew), snap ? ('new=' + snap.hasNew) : '无读数');
// B1b＝判别核心：分享窗口**收尾**不得停在「抹库形态」——最后一发写入 <10k 字符＝权威库停在
// 残缺形态（红侧旧盲写 XY:274×3 → 必红）。绿侧偶见 feed.js 冷读合并链自己的瞬态小写（随后
// 即被并集覆写、端态完好）＝feed.js 域既有行为，按「看收尾」口径不误伤。
const writes = await evalJs('JSON.stringify(window.__fkWrites || [])') || '[]';
const wArr = JSON.parse(writes);
const lastW = wArr.length ? wArr[wArr.length - 1] : null;
const lastLen = typeof lastW === 'number' ? lastW : parseInt(String(lastW || '0').split(':')[1], 10);
check('B1b 分享收尾无「整本顶库」形态写入（最后一发 <10k 字符＝权威停在残缺形态）', lastLen >= 10000,
  'writes=' + wArr.join(',').slice(0, 160));
const errs = JSON.parse(await jsErrors() || '[]');
check('B3 全程零 JS 运行时错误', errs.length === 0, errs.join('|'));

// ---------- 汇总 ----------
const fail = results.filter(r => !r.ok);
console.log('\n===== verify-1522-garden-share-feedadd: ' + (results.length - fail.length) + '/' + results.length + ' =====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail.length ? 1 : 0);
