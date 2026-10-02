// ===== 常驻回归 #1478：#1435 的「后台挂起查岗」必须活过页面回收 =====
// 用法：node tools/verify-1478-checkin-hold-cold-read.mjs
//   红绿对照：MOCHI_SERVE_ROOT=<纯底本产物目录>（缺省＝本仓库根产物；对照时务必显式传，首行打印 serve root）。
//   MOCHI_CDP_PORT 逐支给不同端口。
//
// 现场（作者 2026-09-30 直派，与 #1443 同一台机：iPhone 12 Pro／iOS 17.1.1／Safari 主屏幕模式）：
//   诊断单三条决定性读数——LS 每一次写都抛（整域 ≈6.1MB、1 字节探针就抛）、本页被系统回收 26 次、
//   重载后「跨桌面来消息体检」pending=0。#1435 把「后台命中跨桌面查岗」改成只发通知＋挂起等待
//   （3 分钟＝CK_BG_HOLD_MS，作者点名「没点【确认】就不进聊天」），而那份挂起活在根键
//   xy-home-v2:incoming-requests 上：读走 xyStore.get（内存→LS 同步路），写是「整包读-改-写」。
//   于是只要那一发发生在「库里这一格还没回话」的窗口里（回填是逐批异步跑的），整包写回就把库里
//   那条正在等用户回来的挂起抹平；冷启动又不派发 visibilitychange ⇒ 回前台那条收尾路径根本不跑，
//   超时收尾一起没了＝「横幅说了有，点进去没有，主页那一栏也没有」。
//
// 修法（判据一律零机型／零 UA 分支，只问「这一键库回没回话」一个事实）：
//   ① 三态闸：沿用 #1309/#1361 的 info.ambiguous 口径（有值＝读到、undefined＝库里确无、ambiguous＝没
//      读出来就继续等有界重试 1.5/4/9/16s）；没回话期间 saveQ 只暂存内存，回话后按 cid|kind|ts 与库里
//      那本【并集】落盘（库里排前＝它的 status 说话算数）；投递路径与 queue() 的孤儿自愈路径共用同一道
//      闸（后者原来直接 rootSet＝旁路）。库里确无（absent，新装）时照旧放行，闸门不许变成「存不进去」。
//   ② 权威问话与首拍挂到「数据就绪」之后（12 秒那拍留作兜底；startIncomingTick 自带 started 闩）。
//   ③ deskQSeenRecently 不再只认裸 LS 的 chat-msgs 快照（本机恒旧／恒空，且 chat-msgs 被排除在回填之外）；
//      改以 #1435 自己落的 records-care（普通键，跨回收存活）为权威事实，原聊天快照判定原样保留。
//
// 断言：
//   P0 探针新增 auth 读数在册（红侧＝没这个读数）
//   H1 库「没读出来」期间的一次投递，不得把库里那条挂起整包抹掉（红＝抹平只剩新那条）
//   H2 问话回来后按身份并集落盘：旧挂起仍 pending、新投递也进账（谁都不许顶掉谁）
//   H3 库里确无此键（新装）时首投照常落盘——闸门不变成「存不进去」
//   H4 deskQSeenRecently 以 records-care 为权威（LS 快照没了也判得出「最近见过」）
//   H5 超时收尾活过回收：重载后那条过期挂起被记成 res='missed'，且聊天里不落卡（#1435 口径不破）
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1478-' + Date.now()),
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
        ws.onmessage = (ev2) => {
          const m = JSON.parse(ev2.data);
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
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'EVAL_ERR:' + e; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 「库读不出来」的桩：文档最前面开始轮等 window.idbGet 出现（idb.js 解析时才定义，直接包会包不到），
// 出现后换成一枚「按 sessionStorage 标记决定要不要报 ambiguous」的壳，并把原始口留在 __qRawGet，
// 让尺子自己还能读到库真相。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: [
  'function wrap() {',
  "  if (!window.idbGet || window.idbGet.__qamb) { setTimeout(wrap, 0); return; }",
  "  var orig = window.idbGet;",
  "  window.__qRawGet = function (k) { return orig(k); };",
  "  function wrapped(k, info) {",
  "    var on = false; try { on = sessionStorage.getItem('__q_amb') === '1'; } catch (e) {}",
  "    if (on && String(k).indexOf(':incoming-requests') >= 0) {",
  "      if (info && typeof info === 'object') info.ambiguous = true;",
  "      return Promise.resolve(undefined);",
  "    }",
  "    return orig(k, info);",
  "  }",
  "  wrapped.__qamb = true;",
  "  window.idbGet = wrapped;",
  '}',
  'setTimeout(wrap, 0);'
].join('\n') });

// 读回「页面自己那本账」（探针 qids＋auth＋两条计数）；读不到就如实报 ERR，不拿默认值冒充
async function probeReadout() {
  try {
    return String(await ev('(function(){ try { var q = window.__mochiIncomingProbe(); return q ? JSON.stringify({ auth: q.auth, pend: q.pending, holding: q.holding, qids: q.qids }) : "NOPROBE"; } catch (e) { return "ERR:" + e; } })()'));
  } catch (e) { return 'THROW:' + e; }
}

let pass = 0, fail = 0; const reds = [];
function check(desc, ok, detail) {
  if (ok) pass++; else { fail++; reds.push(desc); }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''));
}
const QKEY = 'xy-home-v2:incoming-requests';
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 90; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(900);
  await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(1200);
  for (let i = 0; i < 30; i++) {
    if (await ev("typeof window.createContact === 'function' && typeof window.idbGet === 'function' && typeof window.triggerIncomingCheckin === 'function'")) break;
    await sleep(400);
  }
}
async function reloadClean() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await ev("try { sessionStorage.removeItem('__q_amb'); } catch(e) {}");
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await openPage();
}
async function poll(expr, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await ev(expr);
    if (r === true) return true;
    if (typeof r === 'string' && r.indexOf('EVAL_ERR:') === 0) { console.log('  poll-eval-err ' + r.slice(0, 120)); return false; }
    await sleep(250);
  }
  return false;
}
const readRawLib = "(function(){ return new Promise(function(res){ window.__qRawGet(" + JSON.stringify(QKEY) + ").then(function(v){ var a=[]; try { a = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v)?v:[]); } catch(e){} res(JSON.stringify(Array.isArray(a)?a:[])); }, function(){ res('[]'); }); }); })()";

// ---------- P0 ＋ H1/H2：库读不回来时不得整包盖库，回话后并集 ----------
await reloadClean();
const cids = await ev(`(async function(){
  try {
    var a = window.createContact('挂起桌面甲');
    var b = window.createContact('挂起桌面乙');
    window.__cidA = a; window.__cidB = b;
    return JSON.stringify({ a: a, b: b });
  } catch (e) { return 'ERR:' + e; }
})()`);
let CD = null; try { CD = JSON.parse(cids); } catch (e) {}
if (!CD || !CD.a) { console.error('夹具（建桌面）失败：' + cids); chrome.kill(); server.close(); process.exit(1); }
const p0 = await ev("(function(){ var p = window.__mochiIncomingProbe ? window.__mochiIncomingProbe() : null; return p ? JSON.stringify(p) : 'NO'; })()");
let P0 = null; try { P0 = JSON.parse(p0); } catch (e) {}
check('P0 探针在册且新增 auth 读数（红侧＝没这个读数，闸也不在）', !!P0 && typeof P0.auth === 'string', 'auth=' + (P0 && P0.auth));
// 立起「读不出来」标记并重启：页面的权威问话从此一直拿不到回话（＝报障机上回填前那一窗的放大版）
await ev("try { sessionStorage.setItem('__q_amb','1'); } catch(e) {}");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(1500);
// 库里放一条「正在等用户回来」的挂起（走原始口，绕过内存与 LS ⇒ 页面的同步读必然看不见它）
const seeded = await ev(`(async function(){
  try {
    var hold = [{ cid: window.__cidA || ${JSON.stringify(CD.a)}, kind: 'checkin', text: '刚才，有没有感觉到我？', ts: Date.now(), status: 'pending', sid: 's-old-1', bgHold: 1 }];
    await window.idbSet(${JSON.stringify(QKEY)}, JSON.stringify(hold));
    return 'ok';
  } catch (e) { return 'ERR:' + e; }
})()`);
await ev("try { localStorage.removeItem(" + JSON.stringify(QKEY) + "); } catch(e) {}");
// 题库是异步回填的：那一格还没回来时 ckQuestionPickFor 交不出题面，trigger 会「点了没反应」地返回
// false（实测会搬家成 H1/H2 的偶发红）。这不是被测行为，先把「该桌面有题」量出来再按扳机。
const qReady = await poll("(function(){ try { var q = window.ckQuestionPickFor && window.ckQuestionPickFor(" + JSON.stringify(CD.b) + "); return !!(q && q.text); } catch (e) { return false; } })()", 15000);
const trig = await ev("(function(){ try { return String(window.triggerIncomingCheckin(" + JSON.stringify(CD.b) + ")); } catch (e) { return 'ERR:' + e; } })()");
await sleep(2000);
let LIB1 = []; try { LIB1 = JSON.parse(await ev(readRawLib)); } catch (e) {}
// 判据只认「这一颗种子（sid=s-old-1）还在不在库里」——自动查岗链路（1% 那一掷）偶尔会先替某桌面
// 投出一条同 cid 的挂起，那是页面正当行为，不该把「库里没被抹平」这条量成红。同理：若自动链路已经
// 投过乙，手动这一发按 #264「同一联系人未处理期间不重复投」返回 false 才是对的 ⇒ 两个读数二选一。
const keepA = LIB1.filter(function (x) { return x && x.sid === 's-old-1'; }).length;
const pageBBexpr = '(function(){ try { var p = window.__mochiIncomingProbe(); var q = (p && p.qids) || []; var key = ' + JSON.stringify(CD.b) + ' + ":pending"; return q.indexOf(key) >= 0; } catch (e) { return false; } })()';
const pageBB = await ev(pageBBexpr);
check('H1 库「没读出来」期间的一次投递不得整包覆盖（红＝把正在等的挂起抹平，只剩新那条）',
  seeded === 'ok' && keepA === 1 && (trig === 'true' || pageBB === true),
  '题库就绪=' + qReady + ' 触发=' + trig + ' 库里种子挂起=' + keepA + ' 总=' + LIB1.length + ' 页面已记乙=' + pageBB);
// 撤标记 ⇒ 有界重试的下一次问话读得回来 ⇒ 暂存那一发要并集落盘（谁都不许顶掉谁）
await ev("try { sessionStorage.removeItem('__q_amb'); } catch(e) {}");
const unionExpr = "(function(){ return new Promise(function(res){ window.__qRawGet(" + JSON.stringify(QKEY) + ").then(function(v){ var a=[]; try { a = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v)?v:[]); } catch(e){} var S = a.filter(function(x){ return x && x.sid === 's-old-1'; }), B = a.filter(function(x){ return x && x.cid === " + JSON.stringify(CD.b) + "; }); res(!!(S.length === 1 && S[0].status === 'pending' && B.length >= 1)); }, function(){ res(false); }); }); })()";
const unionOk = await poll(unionExpr, 24000);
let LIB2 = []; try { LIB2 = JSON.parse(await ev(readRawLib)); } catch (e) {}
const pickStat = (cid) => JSON.stringify(LIB2.filter((x) => x && x.cid === cid).map((x) => x.kind + '/' + x.status + '/' + x.sid));
const pageView = await probeReadout();
check('H2 问话回来后按身份并集落盘：甲仍 pending 等着、乙也进账', unionOk === true,
  '库len=' + LIB2.length + ' 甲=' + pickStat(CD.a) + ' 乙=' + pickStat(CD.b) + ' 页面账=' + pageView);

// ---------- H3：库里确无此键（新装）时首投正常落盘 ----------
await reloadClean();
const h3 = await ev(`(async function(){
  try {
    var c = window.createContact('新装桌面丙');
    await new Promise(function(r){ setTimeout(r, 3200); }); // 等一次权威问话（absent 也算回话）
    var t = String(window.triggerIncomingCheckin(c));
    await new Promise(function(r){ setTimeout(r, 2600); });
    var v = await window.__qRawGet(${JSON.stringify(QKEY)});
    var a = []; try { a = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : []); } catch (e) {}
    var p = window.__mochiIncomingProbe ? window.__mochiIncomingProbe() : null;
    return JSON.stringify({ trig: t, n: Array.isArray(a) ? a.filter(function (x) { return x && x.cid === c; }).length : -1, auth: p && p.auth, pending: p && p.pending });
  } catch (e) { return 'ERR:' + e; }
})()`);
let H3 = null; try { H3 = JSON.parse(h3); } catch (e) {}
check('H3 库里确无此键时首投正常落盘（闸门不许变成「存不进去」）', !!H3 && H3.trig === 'true' && H3.n >= 1 && H3.auth !== 'pending', String(h3).slice(0, 130));

// ---------- H4：去重判据改认 records-care（LS 快照没了也判得出「最近见过」）----------
// 第一步：只写库、并清掉 LS 那本。直写 IDB 不进内存缓存 ⇒ 必须重启一次让回填读回来，这才是真实读路。
const h4a = await ev(`(async function(){
  try {
    var cid = window.__activeCid || 'default';
    var care = [{ kind: 'desk-checkin', text: '刚才，有没有感觉到我？', ts: Date.now() - 120000, res: 'missed' }];
    await window.idbSet('xy-home-v2:' + cid + ':records-care', JSON.stringify(care));
    try { localStorage.removeItem('xy-home-v2:' + cid + ':records-care'); } catch (e) {}
    try { localStorage.removeItem('xy-home-v2:' + cid + ':chat-msgs'); } catch (e2) {}
    return JSON.stringify({ cid: cid });
  } catch (e) { return 'ERR:' + e; }
})()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4000);
for (let i4 = 0; i4 < 60; i4++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(1500);
const h4b = await ev(`(function(){
  try {
    var cid = window.__activeCid || 'default';
    var memo = null;
    try { memo = window.xyStore('xy-home-v2:' + cid).get('records-care'); } catch (e3) {}
    var probe = typeof window.__mochiDeskQSeenProbe === 'function'
      ? window.__mochiDeskQSeenProbe(cid, '刚才，有没有感觉到我？') : 'NO探针';
    return JSON.stringify({ seeded: true, memo: !!memo, probe: probe });
  } catch (e) { return 'ERR:' + e; }
})()`);
let H4 = null; try { H4 = JSON.parse(h4b); } catch (e) {}
check('H4 去重改认 records-care 这本（LS 快照没了也算「最近见过」；红侧＝只读裸 chat-msgs 判成没见过）',
  !!H4 && H4.memo === true && H4.probe === true, String(h4b).slice(0, 120));
// ---------- H5：超时收尾活过回收（记 missed，且聊天里不落卡＝#1435 口径不破） ----------
await reloadClean();
const h5 = await ev(`(async function(){
  try {
    var cid = window.createContact('超时桌面丁');
    var key = 'xy-home-v2:' + cid + ':records-care';
    await window.idbSet(key, '[]');
    var hold = [{ cid: cid, kind: 'checkin', text: '在干嘛呢？想你了。', ts: Date.now() - 4 * 60000, status: 'pending', sid: 's-old-2', bgHold: 1 }];
    await window.idbSet(${JSON.stringify(QKEY)}, JSON.stringify(hold));
    try { localStorage.removeItem(${JSON.stringify(QKEY)}); } catch (e) {}
    return JSON.stringify({ cid: cid });
  } catch (e) { return 'ERR:' + e; }
})()`);
let H5S = null; try { H5S = JSON.parse(h5); } catch (e) {}
if (H5S && H5S.cid) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  let done = false, lastProbe = '';
  for (let i5 = 0; i5 < 40; i5++) {
    lastProbe = String(await ev("(function(){ var p = window.__mochiIncomingProbe ? window.__mochiIncomingProbe() : null; return p ? JSON.stringify(p) : 'NO'; })()"));
    try { const o = JSON.parse(lastProbe); if (o && o.holding === 0 && o.auth !== 'pending') { done = true; break; } } catch (e9) {}
    await sleep(500);
  }
  const h5x = await ev(`(function(){ return new Promise(function(res){
    var mem = null, ls = null;
    try { mem = window.xyStore('xy-home-v2').get('incoming-requests'); } catch (e) {}
    try { ls = localStorage.getItem("xy-home-v2:incoming-requests"); } catch (e2) {}
    window.__qRawGet("xy-home-v2:incoming-requests").then(function (v) {
      res(JSON.stringify({ mem: mem, ls: ls, lib: (v === undefined ? 'UNDEF' : v) }));
    }, function () { res(JSON.stringify({ mem: mem, ls: ls, lib: 'ERR' })); });
  }); })()`);
  console.log('    H5 三份账本 = ' + String(h5x).slice(0, 420));
  const h5b = await ev(`(async function(){
    try {
      var cid = ${JSON.stringify(H5S.cid)};
      var v = await window.__qRawGet('xy-home-v2:' + cid + ':records-care');
      var a = []; try { a = typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : []); } catch (e) {}
      var hit = (a || []).filter(function (x) { return x && x.kind === 'desk-checkin' && x.res === 'missed'; }).length;
      var m = await window.__qRawGet('xy-home-v2:' + cid + ':chat-msgs');
      var arr = []; try { arr = typeof m === 'string' ? JSON.parse(m) : (Array.isArray(m) ? m : []); } catch (e2) {}
      var cards = (arr || []).filter(function (x) { return x && x.special === 'ask-card'; }).length;
      return JSON.stringify({ hit: hit, cards: cards });
    } catch (e3) { return 'ERR:' + e3; }
  })()`);
  let H5B = null; try { H5B = JSON.parse(h5b); } catch (e) {}
  check('H5 回收重启后过期挂起仍被收尾：记一条 res=missed，且聊天里不落卡（#1435 作者口径不破）',
    done === true && !!H5B && H5B.hit === 1 && H5B.cards === 0, String(h5b).slice(0, 110) + ' · done=' + done + ' · 末次探针=' + lastProbe.slice(0, 140));
} else {
  check('H5 回收重启后过期挂起仍被收尾：记一条 res=missed，且聊天里不落卡（#1435 作者口径不破）', false, '夹具失败 ' + h5);
}

console.log('');
console.log('合计 ' + pass + '/' + (pass + fail) + ' 通过' + (reds.length ? '；红：' + reds.join(' ／ ') : ''));
check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 2).join(' | ').slice(0, 150));
console.log('SUMMARY pass=' + pass + ' fail=' + fail);
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
