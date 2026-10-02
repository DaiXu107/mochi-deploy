// ===== 常驻回归 #1443：LS 冻结期不许充当权威 ＋ 跨桌面写回必须认库回执 ＋ 通知按类别如实报、点击按归属跳 =====
// 用法：node tools/verify-1443-ls-frozen-write-ack.mjs
//   红绿对照：MOCHI_SERVE_ROOT=<纯底本产物目录>（缺省＝脚本所在仓库根产物；对照时必须显式传，
//   否则两侧喂同一份产物、断言全失真）。首行打印 serve root。MOCHI_CDP_PORT 逐支给不同端口。
//
// 报障现场（作者 2026-09-29 直派，iPhone 12 Pro／iOS 17.1.1／Safari 主屏幕模式，随附
// mochi-diag-2026-09-29-08-06-24138095445724639126.docx）：
//   ① 横幅「有 2 条新消息」，内容是联系人申请贴贴／查岗／跨桌面查岗，点进去却没有消息；
//   ② 横幅「某角色查岗：刚才有没有感觉到我？」，点进去所有角色页面都没有这条消息（以前有记录）；
//   ③ 更新后收藏夹内容消失了很多（聊天记录页正常）。
// 诊断单三条决定性读数：LS 整域 3187 键 ≈6.1MB、1 字节写探针就抛（这台机器每一次 LS 写都静默失败）；
//   fav-msgs 各桌面 LS 一律小于 IDB（311.7KB<328.4KB／162.0KB<175.9KB）＝LS 那本是冻结的旧快照；
//   本页被系统回收 26 次。
//
// 三条落点（判据一律零机型／零 UA 分支）：
//   L 组＝idb.js：启动一发同体积试写探针抛了 ⇒ 整层 LS 快照一律视同「已标脏」，回填／按需取回只认库
//     （旧规则「LS 有值且没标脏＝LS 最新」只认逐键标记，配额满之后再没人写过的键永远「没标脏」，
//     那本冻结旧账就永久赢）；残留清扫候选阈值随之从 200K 字符降到 32K（撑爆本机配额的 feed-cover-bg／
//     fav-msgs／feed-posts 那排每个只有 13万~18万字符，旧阈值一辈子不碰＝配额永久满），且冻结期
//     绝不把 LS 追平写进库、库比 LS 短时两份都留。
//   D 组＝chat.js：三处跨桌面整包写回改为认 idbSet 的 resolve 回执；未提交→追加类落 #1200 中转箱、
//     改写类重跑读-改-写（旧写法发完不管＝通知已弹、卡一个字没落，正是症状②）。
//   N 组＝bg-keep.js／sw.js：后台通知按类别分离记账，只有真进了聊天的才叫「新消息」；每一发带可回查
//     tag，点击凭 tag 找回归属桌面与落点页，认不出退回聊天页＝不比旧行为差。
//
// 断言：
//   L0 夹具真把 LS 撑到写不进（1 字节探针抛）／L1【症状③本体】冻结旧包不得顶掉库里新值（纯回填读数）／
//   L2 同一枚键走按需取回也是同一把尺／L7 健康对照：LS 写得进时旧语义一字不变（防修过头）／
//   L3 清扫夹具（4 万字符那两枚残留布好且探针判死）／L4 库里不短副本在 ⇒ 剥 LS 腾配额／
//   L5 库比 LS 短 ⇒ 两份都留（不赌）／L6 冻结期绝不把 LS 追平写进库
//   D1【症状②本体】idbSet 回 false 时这一发必须转中转箱（红＝箱里没货＝通知有、卡没有）／
//   D2 整包键不得被写坏或凭空重建／D3 切到归属桌面进聊天，那条卡在屏上且箱被清／
//   D4 健康对照：库回了话就不进箱，整包恰好 +1（不双落）
//   N1 每一发都带 nk 前缀 tag／N2 汇总分类如实（新消息·查岗·来信各归各）／
//   N3 未登记类别只写「提醒」且旧「N 条新消息」不得回流／N4 点击按 tag 切归属桌面并开信箱／
//   N5 认不出的 tag 退回进聊天页／N6 回收后开机补投只认 3 分钟内的点击
//   Z1 全程零未捕获 JS 异常
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
console.log('serve root = ' + root);
if (!existsSync(join(root, 'index.html'))) { console.error('✗ 被测根目录没有 index.html（喂错目录了）'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 25));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1443-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsExcepts.push(String((d && ((d.exception && d.exception.description) || d.text)) || 'err').split('\n')[0].slice(0, 150));
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'EVAL_ERR:' + e; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 通知侧只换「发」的那一手，其余照原样：桩 Notification 构造器 ＋ ServiceWorkerRegistration.prototype
// .showNotification（记下 title/body/tag），并把 serviceWorker.addEventListener 包一层拿到页面自己注册
// 的 message 处理器。**不整体替换 navigator.serviceWorker**——那会打断 pwa.js 的 register，把被测页面
// 弄成开机异常（第一版踩过这条：Z1 整支假红）。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: [
  'window.__notified = [];',
  'window.__swlisteners = {};',
  'try {',
  '  function MochiStubNotification(t, o) { window.__notified.push({ title: t, body: o && o.body, tag: o && o.tag }); }',
  "  Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: MochiStubNotification });",
  "  MochiStubNotification.requestPermission = function () { return Promise.resolve('granted'); };",
  "  MochiStubNotification.permission = 'granted';",
  '} catch (e) {}',
  'try {',
  '  function rec(t, o) { window.__notified.push({ title: t, body: o && o.body, tag: o && o.tag }); return Promise.resolve(); }',
  '  if (window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype) window.ServiceWorkerRegistration.prototype.showNotification = rec;',
  '} catch (e2) {}',
  'try {',
  '  if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {',
  '    var origAdd = navigator.serviceWorker.addEventListener.bind(navigator.serviceWorker);',
  '    navigator.serviceWorker.addEventListener = function (t, f, opt) { if (t === "message") window.__swlisteners.message = f; return origAdd(t, f, opt); };',
  '  }',
  '} catch (e3) {}',
  // LS「写得进／写不进」夹具开关：看 sessionStorage 那枚标记（标记只在下一场导航生效，布值那一趟照旧真写）。
  // 报障那台机的真实形态＝读得到、但每一发 setItem 都抛。拿真 fill 去撑 Chrome 配额量不出这一形态（实测填到它
  // 自己开始抛之后 1 字节探针照样成功＝它换了记账口径），故沿用 verify-call-hold 那一族既有的抛错桩。
  'try {',
  "  var _origSetItem = Storage.prototype.setItem;",
  "  Storage.prototype.setItem = function (k, v) {",
  "    var on = false; try { on = sessionStorage.getItem('__stub_ls_dead') === '1'; } catch (eS) {}",
  "    if (this === window.localStorage && on) { var err = new Error('QuotaExceededError(stub)'); err.name = 'QuotaExceededError'; throw err; }",
  "    return _origSetItem.call(this, k, v);",
  "  };",
  '} catch (e4) {}'
].join('\n') });

let pass = 0, fail = 0; const reds = [];
function check(desc, ok, detail) {
  if (ok) pass++; else { fail++; reds.push(desc); }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''));
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(1200);
  for (let i = 0; i < 30; i++) {
    if (await evalJs("typeof window.createContact === 'function' && typeof window.idbGet === 'function'")) break;
    await sleep(400);
  }
}
async function reloadClean() {
  await cdp('Page.navigate', { url: 'about:blank' });
  // 「LS 写不进」那枚夹具标记活在 sessionStorage（clearDataForOrigin 只清 LS＋IDB）——不清掉它，
  // 下一段夹具会连带写不进任何值，把后面每一条断言都变成假红（L3/L7 第一版就是这么红的）
  await evalJs("(function(){ try { sessionStorage.removeItem('__stub_ls_dead'); return 'off'; } catch (e) { return 'ERR'; } })()");
  await sleep(300);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await openPage();
}
async function poll(expr, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await evalJs(expr);
    if (r === true) return true;
    if (typeof r === 'string' && r.indexOf('EVAL_ERR:') === 0) { console.log('  poll-eval-err ' + r.slice(0, 120)); return false; }
    await sleep(200);
  }
  return false;
}
// 把整域 LS 撑到「连 1 字节都写不进」＝报障那台机的真实形态（诊断单：整域 ≈6.1MB、写探针抛）
const FILL_UNTIL_DEAD = `(function(){
  // 两阶段填：先用 64KB 大块撞到总量墙，再用 1KB 小块把余量榨干——直到【连 1 字节都写不进】。
  // 只做大块会停在 #1335 那台机的「半死」形态（大值抛、1 字节探针照旧成功），量不出报障那台机的状态。
  var dead1 = false, n1 = 0, chunk = new Array(65537).join('x');
  for (; n1 < 300; n1++) { try { localStorage.setItem('__fill_a' + n1, chunk); } catch (e) { dead1 = true; break; } }
  var n2 = 0, small = new Array(1025).join('y');
  for (; n2 < 4000; n2++) { try { localStorage.setItem('__fill_b' + n2, small); } catch (e2) { break; } }
  var probe = 'ok';
  try { localStorage.setItem('__probe_after_fill', 'x'); } catch (e3) { probe = (e3 && e3.name) || 'throw'; }
  return JSON.stringify({ bigN: n1, smallN: n2, deadBig: dead1, probe: probe });
})()`;

// ---------- L 组：LS 冻结期，库里那本才是权威（症状③本体＝数据层那把尺） ----------
await reloadClean();
const lseed = await evalJs(`(async function(){
  try {
    var pre = 'xy-home-v2:' + (window.__activeCid || 'default');
    var stale = JSON.stringify([{ q: 'LS 旧账', ts: 1 }]);
    var newer = JSON.stringify([{ q: 'LS 旧账', ts: 1 }, { q: '库里新增', ts: 2 }]);
    localStorage.setItem(pre + ':probe-key', stale);   // 这枚键在配额满之后再没人写过＝旧规则里永远「没标脏」
    await window.idbSet(pre + ':probe-key', newer);   // 库里那本才是最新的
    localStorage.setItem(pre + ':fav-msgs', stale);
    await window.idbSet(pre + ':fav-msgs', newer);
    return JSON.stringify({ pre: pre });
  } catch (e) { return 'ERR:' + e; }
})()`);
let LS0 = null; try { LS0 = JSON.parse(lseed); } catch (e) {}
if (!LS0 || !LS0.pre) { console.error('L 组夹具失败：' + lseed); chrome.kill(); server.close(); process.exit(1); }
const markDead = await evalJs("(function(){ try { sessionStorage.setItem('__stub_ls_dead','1'); return 'on'; } catch (e) { return 'ERR:' + e; } })()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(1500);
const fillA = await evalJs("(function(){ var probe='ok'; try { localStorage.setItem('__stub_probe','x'); } catch (e) { probe = (e && e.name) || 'throw'; } return JSON.stringify({ marker: 'on', probe: probe, dead: window.xyLsWriteDead ? window.xyLsWriteDead() : '无探针口' }); })()");
let FA = null; try { FA = JSON.parse(fillA); } catch (e) {}
check('L0 夹具真把 LS 撑到「连 1 字节都写不进」，且应用自己的探针口同意（与报障那台机同一形态）',
  !!FA && FA.marker === 'on' && FA.probe !== 'ok' && FA.dead === true, String(fillA).slice(0, 120));
// 重开＝页面被系统回收后重启（内存缓存清空，一切按 LS／库重新判定），这才是真现场
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(2000);
const l1 = await evalJs(`(function(){
  try {
    var pre = 'xy-home-v2:' + (window.__activeCid || 'default');
    var v = window.xyStore(pre).get('probe-key');
    var a = null; try { a = JSON.parse(v || '[]'); } catch (e) { return 'PARSE_ERR'; }
    return JSON.stringify({ n: Array.isArray(a) ? a.length : -1, last: a && a[a.length - 1] && a[a.length - 1].q, dead: window.xyLsWriteDead ? window.xyLsWriteDead() : '无探针口' });
  } catch (e) { return 'ERR:' + e; }
})()`);
let L1 = null; try { L1 = JSON.parse(l1); } catch (e) {}
check('L1【症状③本体】冻结机上同步读数＝库里那本 2 条（红侧＝LS 那本「没标脏」的旧账顶掉库里新值）',
  !!L1 && L1.n === 2 && L1.last === '库里新增' && L1.dead === true, String(l1).slice(0, 130));
const l2 = await evalJs(`(function(){ return new Promise(function(res){
  var pre = 'xy-home-v2:' + (window.__activeCid || 'default');
  try { window.idbHydrateKey(pre + ':fav-msgs'); } catch (e) {}
  setTimeout(function () {
    var v = null; try { v = window.xyStore(pre).get('fav-msgs'); } catch (e) {}
    var a = null; try { a = JSON.parse(v || '[]'); } catch (e2) {}
    res(JSON.stringify({ n: Array.isArray(a) ? a.length : -1 }));
  }, 1500);
}); })()`);
let L2 = null; try { L2 = JSON.parse(l2); } catch (e) {}
check('L2 同一枚键走按需取回也是同一把尺（fav 那本读到 2 条）', !!L2 && L2.n === 2, String(l2).slice(0, 90));
// 残留清扫：候选阈值降到 32K 字符（旧阈值下这批 4 万字符的快照永远清不掉，配额永久满）
// —— 先撤掉上一段立的「写不进」标记再干净重开：标记在同一场 sessionStorage 里会一路带下去，
// 带着它布夹具必然「布不了」（第一版就是这条把 L3～L7 全污染的）
await evalJs("(function(){ try { sessionStorage.removeItem('__stub_ls_dead'); return 'off'; } catch (e) { return 'ERR'; } })()");
await reloadClean();
const sw1 = await evalJs(`(async function(){
  try {
    var pre = 'xy-home-v2:' + (window.__activeCid || 'default');
    var big = new Array(40001).join('k');           // 4 万字符：> 32K 新阈值、< 200K 旧阈值
    var kA = pre + ':sweep-eq', kB = pre + ':sweep-shorter';
    try { localStorage.setItem(kA, big); localStorage.setItem(kB, big); } catch (e) { return 'ERR:布不了'; }
    await window.idbSet(kA, big + 'tail');          // 库里不短 ⇒ 该剥 LS
    await window.idbSet(kB, big.slice(0, 500));     // 库里更短 ⇒ 两份都留
    return JSON.stringify({ dead: window.xyLsWriteDead ? window.xyLsWriteDead() : '无探针口', aIn: !!localStorage.getItem(kA) });
  } catch (e) { return 'ERR:' + e; }
})()`);
let SW1 = null; try { SW1 = JSON.parse(sw1); } catch (e) {}
check('L3 夹具：4 万字符那两枚残留布好（LS 还能写得进时布）', !!SW1 && SW1.aIn === true, String(sw1).slice(0, 90));
if (SW1 && SW1.aIn === true) {
  await evalJs("(function(){ try { sessionStorage.setItem('__stub_ls_dead','1'); return 'on'; } catch (e) { return 'ERR'; } })()");
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1200);
}
await evalJs("(function(){ try { if (window.idbLsResidueSweep) { window.idbLsResidueSweep(); window.idbLsResidueSweep(); } return true; } catch (e) { return 'ERR:' + e; } })()");
await sleep(3500);
const sw2 = await evalJs(`(function(){
  var pre = 'xy-home-v2:' + (window.__activeCid || 'default');
  var g = function (k) { try { return localStorage.getItem(k); } catch (e) { return 'THROW'; } };
  return new Promise(function(res){
    window.idbGet(pre + ':sweep-shorter').then(function (v) {
      var s = typeof v === 'string' ? v : '';
      res(JSON.stringify({ a: g(pre + ':sweep-eq') === null ? '剥掉' : '留着', b: g(pre + ':sweep-shorter') === null ? '剥掉' : '留着', idbShortLen: s.length }));
    }, function () { res('{"a":"读失败"}'); });
  });
})()`);
let SW2 = null; try { SW2 = JSON.parse(sw2); } catch (e) {}
check('L4 冻结期把「库里已有不短副本」的 LS 残留请出去腾配额（旧阈值这一型一辈子清不掉）', !!SW2 && SW2.a === '剥掉', String(sw2).slice(0, 110));
check('L5 库比 LS 短时两份都留（不拿「谁新」赌数据）', !!SW2 && SW2.b === '留着', String(SW2 && SW2.b).slice(0, 40));
check('L6 冻结期绝不把 LS 追平写进库（库里那本仍是 500 字符那份）', !!SW2 && SW2.idbShortLen === 500, String(SW2 && SW2.idbShortLen).slice(0, 40));
// 健康对照：LS 写得进的同一夹具，旧语义必须原样（防修过头）
await evalJs("(function(){ try { sessionStorage.removeItem('__stub_ls_dead'); return 'off'; } catch (e) { return 'ERR'; } })()");
await reloadClean();
const l4 = await evalJs(`(async function(){
  try {
    var pre = 'xy-home-v2:' + (window.__activeCid || 'default');
    var stale = JSON.stringify([{ q: 'LS 最新那本', ts: 9 }]);
    localStorage.setItem(pre + ':probe-key2', stale);
    await window.idbSet(pre + ':probe-key2', JSON.stringify([{ q: '库里的旧版本', ts: 1 }]));
    try { localStorage.setItem(pre + ':probe-key2', stale); } catch (e) {}
    return JSON.stringify({ alive: localStorage.getItem(pre + ':probe-key2') === stale, dead: window.xyLsWriteDead ? window.xyLsWriteDead() : '无探针口' });
  } catch (e) { return 'ERR:' + e; }
})()`);
let L4 = null; try { L4 = JSON.parse(l4); } catch (e) {}
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(1500);
const l4b = await evalJs(`(function(){
  try {
    var pre = 'xy-home-v2:' + (window.__activeCid || 'default');
    var v = window.xyStore(pre).get('probe-key2');
    var a = null; try { a = JSON.parse(v || '[]'); } catch (e) {}
    return JSON.stringify({ first: a && a[0] && a[0].q, dead: window.xyLsWriteDead ? window.xyLsWriteDead() : '无探针口' });
  } catch (e) { return 'ERR:' + e; }
})()`);
let L4B = null; try { L4B = JSON.parse(l4b); } catch (e) {}
check('L7 健康对照：LS 写得进时旧语义一字不变（LS 那本仍是权威、探针判「活」）',
  !!L4 && !!L4B && L4.alive === true && L4.dead === false && L4B.first === 'LS 最新那本' && L4B.dead === false, String(l4b).slice(0, 120));

// ---------- D 组：跨桌面写回认库回执（症状②） ----------
await reloadClean();
const dseed = await evalJs(`(async function(){
  try {
    var cidB = window.createContact('写中止桌面');
    var pkB = 'xy-home-v2:' + cidB;
    var base = [{ side: 'in', text: '历史一', ts: 1700000000000 }, { side: 'out', text: '历史二', ts: 1700000001000 }];
    await window.idbSet(pkB + ':chat-msgs', JSON.stringify(base));
    var meta = JSON.stringify({ n: 2, b: 0 });
    await window.idbSet(pkB + ':chat-meta', meta);
    try { localStorage.setItem(pkB + ':chat-meta', meta); } catch (e) {}
    window.__cidB = cidB;
    window.__abortKey = pkB + ':chat-msgs';
    window.__inboxKey = pkB + ':chat-desk-inbox';
    window.__origIdbSet = window.idbSet;
    // 事务中止的内核事实＝idbSet resolve(false)（iOS 冻结／回收页面时最容易撞上这一发）
    window.idbSet = function (k, v) {
      if (k === window.__abortKey) return Promise.resolve(false);
      return window.__origIdbSet(k, v);
    };
    return JSON.stringify({ cidB: cidB });
  } catch (e) { return 'ERR:' + e; }
})()`);
let DS = null; try { DS = JSON.parse(dseed); } catch (e) {}
if (!DS || !DS.cidB) { console.error('D 组夹具失败：' + dseed); chrome.kill(); server.close(); process.exit(1); }
const dpush = await evalJs(`(function(){
  try {
    window.chatAppendDeskRec(window.__cidB, { side: 'in', special: 'ask-card', text: '刚才有没有感觉到我？', askQuestion: '刚才有没有感觉到我？', askType: 'single', deskCk: true, ts: 1700000009000 });
    return 'sent';
  } catch (e) { return 'ERR:' + e; }
})()`);
const inboxHas = `(function(){ return new Promise(function(res){
  window.idbGet(window.__inboxKey).then(function(v){
    var a = typeof v === 'string' ? JSON.parse(v) : v;
    res(!!(Array.isArray(a) && a.some(function(m){ return m && m.text === '刚才有没有感觉到我？'; })));
  }).catch(function(){ res(false); });
}); })()`;
check('D1【症状②本体】库回了 false 时这一发必须转中转箱（红侧＝箱里没货＝通知有、卡没有）',
  dpush === 'sent' && await poll(inboxHas, 10000), String(dpush));
const pkgState = await evalJs(`(function(){ return new Promise(function(res){
  window.idbGet(window.__abortKey).then(function(v){
    var a = typeof v === 'string' ? JSON.parse(v) : v;
    res(Array.isArray(a) ? a.length : -1);
  }).catch(function(){ res(-2); });
}); })()`);
check('D2 整包键不得被写坏或凭空重建（仍恰好是历史 2 条）', pkgState === 2, String(pkgState));
const drain = await evalJs(`(async function(){
  try {
    window.idbSet = window.__origIdbSet;              // 恢复正常内核
    window.setActiveContact(window.__cidB);
    await new Promise(function(r){ setTimeout(r, 700); });
    if (window.enterChat) window.enterChat();
    var ok = false;
    for (var i = 0; i < 70; i++) {
      await new Promise(function(r){ setTimeout(r, 300); });
      var el = document.getElementById('chat-body');
      var t = el ? (el.innerText || '') : '';
      if (t.indexOf('刚才有没有感觉到我？') >= 0) { ok = true; break; }
    }
    var left = await window.idbGet(window.__inboxKey);
    var la = null; try { la = typeof left === 'string' ? JSON.parse(left) : left; } catch (e2) {}
    var pkgAfter = await window.idbGet(window.__abortKey); var pa = null;
    try { pa = typeof pkgAfter === 'string' ? JSON.parse(pkgAfter) : pkgAfter; } catch (e3) {}
    var cb = document.getElementById('chat-body');
    return JSON.stringify({ onScreen: ok, inboxLeft: Array.isArray(la) ? la.length : (la ? 1 : 0), pkgAfter: Array.isArray(pa) ? pa.length : -1, bodyLen: cb ? String(cb.innerText || '').length : -1, chatHidden: !!((document.getElementById('page-chat') || {}).hidden) });
  } catch (e) { return 'ERR:' + e; }
})()`);
let DR = null; try { DR = JSON.parse(drain); } catch (e) {}
// 屏上那一格由 verify-1200 A3 钉（那支专做「切进聊天看得见」，两侧都在跑）；本支只认自己改的那半：
// 未提交的那一发最后必须进整包、且中转箱被清空（落库一次、不双落）
check('D3 切到归属桌面后箱被清、那条最终落进整包（恰好 3 条＝不双落）', !!DR && DR.inboxLeft === 0 && DR.pkgAfter === 3, String(drain).slice(0, 130));
const d4 = await evalJs(`(async function(){
  try {
    var cidC = window.createContact('写正常桌面');
    var pkC = 'xy-home-v2:' + cidC;
    await window.idbSet(pkC + ':chat-msgs', JSON.stringify([{ side: 'in', text: '只有历史', ts: 1700000000000 }]));
    var meta = JSON.stringify({ n: 1, b: 0 });
    await window.idbSet(pkC + ':chat-meta', meta);
    try { localStorage.setItem(pkC + ':chat-meta', meta); } catch (e) {}
    window.chatAppendDeskRec(cidC, { side: 'in', special: 'poke', text: '健康那一发', ts: 1700000009500 });
    await new Promise(function(r){ setTimeout(r, 2600); });
    var m = await window.idbGet(pkC + ':chat-msgs');
    var ib = await window.idbGet(pkC + ':chat-desk-inbox');
    var ma = null, ia = null;
    try { ma = typeof m === 'string' ? JSON.parse(m) : m; } catch (e) {}
    try { ia = typeof ib === 'string' ? JSON.parse(ib) : ib; } catch (e) {}
    return JSON.stringify({ n: Array.isArray(ma) ? ma.length : -1, inbox: Array.isArray(ia) ? ia.length : (ia ? 1 : 0) });
  } catch (e) { return 'ERR:' + e; }
})()`);
let D4 = null; try { D4 = JSON.parse(d4); } catch (e) {}
check('D4 健康对照：库回了话就不进箱，整包恰好 +1（不双落）', !!D4 && D4.n === 2 && D4.inbox === 0, String(d4).slice(0, 110));

// ---------- N 组：分类如实报＋点击按归属跳（症状①） ----------
await reloadClean();
// 「后台通知」默认关着，而 notifyEnabled 是开机那一趟从存储读的（bg-keep.js:1957）——运行时写不算，
// 先按用户那一路把开关落进存储，再重开一次让它读到（否则每一发都被总闸挡掉＝整组空读数假红）。
await evalJs("(function(){ try { window.xyStore('xy-home-v2').set('bg-notify', '1'); return 'on'; } catch (e) { return 'ERR:' + e; } })()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4000);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(1200);
const n1 = await evalJs(`(async function(){
  try {
    // 汇总横幅只在「人不在聊天页」时补弹——先把聊天页藏掉，否则测不到那一句
    var cp = document.getElementById('page-chat'); if (cp) cp.hidden = true;
    window.__popups = [];
    var origPopup = window.showDeskPopup;
    window.showDeskPopup = function (o) { window.__popups.push((o && o.text) || ''); if (origPopup) return origPopup(o); };
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden'; } });
    // 后台通知默认是关的（新机第一屏不开＝产品默认），不发通知就全是空读数：先把开关按用户那一路打开
    try { window.xyStore('xy-home-v2').set('bg-notify', '1'); } catch (e0) {}
    try { window.xyStore('xy-home-v2').set('keep-alive', '1'); } catch (e1) {}
    window.__notified.length = 0;
    window.bgNotifyCheck('在吗', Date.now(), { name: '小雨', kind: 'msg', force: true });
    window.bgNotifyCheck('TA 来查岗了。刚才有没有感觉到我？', Date.now(), { name: '小雨查岗', kind: 'checkin', cid: window.__cidB || 'default', force: true });
    window.bgNotifyCheck('给你寄来了一封信', Date.now(), { name: '信箱', kind: 'mail', force: true });
    window.bgNotifyCheck('某件没登记过类别的事', Date.now(), { name: '某人', force: true });
    await new Promise(function(r){ setTimeout(r, 1500); });
    var tags = (window.__notified || []).map(function (s) { return s.tag || '无tag'; });
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(function(r){ setTimeout(r, 1500); });
    var summary = window.__popups.filter(function (t) { return t.indexOf('你不在的时候') >= 0; }).join(' || ');
    return JSON.stringify({ tags: tags, summary: summary, notified: (window.__notified || []).length });
  } catch (e) { return 'ERR:' + e; }
})()`);
let N1 = null; try { N1 = JSON.parse(n1); } catch (e) {}
const tags = (N1 && N1.tags) || [];
check('N1 每一发都带可回查 tag（nk|类别|归属桌面|号）', tags.length >= 4 && tags.every(function (t) { return String(t).indexOf('nk|') === 0; }), tags.join(',').slice(0, 130));
const summary = (N1 && N1.summary) || '';
check('N2 汇总分类如实：进了聊天的才叫新消息，查岗与来信各归各',
  /1 条新消息/.test(summary) && /1 次查岗/.test(summary) && /1 封来信/.test(summary), summary.slice(0, 150));
check('N3 未登记类别只写「提醒」，旧「N 条新消息」那句不得回流',
  /1 条提醒/.test(summary) && !/[234] 条新消息/.test(summary), summary.slice(0, 150));
const n4 = await evalJs(`(async function(){
  try {
    window.__route = { mail: 0, chat: 0 };
    var om = window.openMailPage; if (om) window.openMailPage = function () { window.__route.mail++; return om.apply(null, arguments); };
    var oc = window.enterChat; window.enterChat = function () { window.__route.chat++; if (oc) return oc.apply(null, arguments); };
    var target = window.__cidB || 'default';
    window.__before = window.__activeCid || 'default';
    var f = window.__swlisteners && window.__swlisteners.message;
    if (f) f({ data: { type: 'MOCHI_NOTIFY_CLICK', tag: 'nk|mail|' + target + '|zz' } });
    await new Promise(function(r){ setTimeout(r, 1500); });
    return JSON.stringify({ before: window.__before, after: window.__activeCid || 'default', target: target, route: window.__route, hasListener: !!f });
  } catch (e) { return 'ERR:' + e; }
})()`);
let N4 = null; try { N4 = JSON.parse(n4); } catch (e) {}
check('N4 点击按 tag 跳事件真正的归属：切到那条通知所属桌面，来信类开信箱而不是聊天页',
  !!N4 && N4.hasListener === true && N4.after === N4.target && N4.route && N4.route.mail >= 1, String(n4).slice(0, 130));
const n5 = await evalJs(`(async function(){
  try {
    window.__route2 = { chat: 0 };
    var oc2 = window.enterChat; window.enterChat = function () { window.__route2.chat++; if (oc2) return oc2.apply(null, arguments); };
    var f2 = window.__swlisteners && window.__swlisteners.message;
    if (f2) f2({ data: { type: 'MOCHI_NOTIFY_CLICK', tag: 'mochi-psync' } });
    await new Promise(function(r){ setTimeout(r, 1000); });
    return JSON.stringify(window.__route2);
  } catch (e) { return 'ERR:' + e; }
})()`);
let N5 = null; try { N5 = JSON.parse(n5); } catch (e) {}
check('N5 认不出的 tag（psync 那一路）退回进聊天页＝不比旧行为差', !!N5 && N5.chat >= 1, String(n5).slice(0, 90));
const n6 = await evalJs(`(async function(){
  try {
    var fresh = 'nk|checkin|' + (window.__cidB || 'default') + '|a1';
    await window.idbSet('xy-home-v2:__notify-click', JSON.stringify({ tag: fresh, ts: Date.now() }));
    var got = await window.xyPendingNotifyClick();
    var staleTag = 'nk|checkin|' + (window.__cidB || 'default') + '|a2';
    await window.idbSet('xy-home-v2:__notify-click', JSON.stringify({ tag: staleTag, ts: Date.now() - 4 * 60000 }));
    var got2 = await window.xyPendingNotifyClick();
    return JSON.stringify({ has: !!got, sameTag: !!(got && got.tag === fresh), stale: got2 ? String(got2.tag) : null });
  } catch (e) { return 'ERR:' + e; }
})()`);
let N6 = null; try { N6 = JSON.parse(n6); } catch (e) {}
check('N6 回收后开机补投只认 3 分钟内的点击（新鲜那条认得、过期那条不再跳）',
  !!N6 && N6.has === true && N6.sameTag === true && N6.stale === null, String(n6).slice(0, 130));

console.log('');
console.log('合计 ' + pass + '/' + (pass + fail) + ' 通过' + (reds.length ? '；红：' + reds.join(' ／ ') : ''));
check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 2).join(' | ').slice(0, 150));
console.log('SUMMARY pass=' + pass + ' fail=' + fail);
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
