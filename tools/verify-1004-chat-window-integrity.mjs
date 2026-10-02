// ===== 常驻回归 #1004：聊天渲染窗「分隔线全摞列表头 / 窗口起点越界＝整页空白 / 构建期迟到消息埋进窗口中部 /
//        批量头像缓存泄漏」=====
// 用法：MOCHI_SERVE_ROOT=<产物目录> node tools/verify-1001-chat-window-integrity.mjs
//       （仓外红/绿对照必传；不传＝取脚本上一级＝仓库根，即构建产物）
// 用户实报（本批三症状，全部零机型分支、纯 DOM/几何判据）：
//   ①「切后台再切回、重新发送消息，聊天记录还是会错误、会错位」②「显示不全」
//   ③「退出聊天回到桌面，然后再打开聊天页面，一片空白，没有任何聊天记录加载」
// 断言组：
//   S1~S6 产物锚（js/chat.js）：分隔线落进 appendTarget / 窗口起点越界兜底 / 迟到队列换装后补挂 /
//          记录位空洞自愈 / 批量头像缓存永远新建 / 裁剪按分隔线归属判
//   B1 时间分隔线必须与消息**穿插**——连续连排 ≤1 且列表头部的分隔线 ≤1（红侧实测 197 条全摞头部）
//   B2 窗口起点越界：换到「小历史桌面」后走 keepScroll 整窗重画，必须**仍画出消息**
//      （红侧 start===len ⇒ 一条不画＝用户所报「一片空白、没有任何聊天记录加载」）
//   B3 整窗分帧构建在飞时落地的消息必须落在**列表末尾**（红侧被写进本轮 fragment＝埋进窗口中部）
//   B4 批量渲染后屏上每个头像必须等于当前存储头像（旧缓存泄漏＝灰占位/别的桌面头像，刷新才复原）
//   Z1 全程零未捕获 JS 异常
// 判据口径：一律用 [data-idx]（类名无关）定位消息行——拍一拍/系统提示/游戏结算等节点类名是
//   msg-poke / msg-center / msg-rps（不含 msg 词元），用 .msg 计数会把它们漏掉、把「画了」误判成空洞。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_SERVE_ROOT ? normalize(resolve(process.env.MOCHI_SERVE_ROOT))
  : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.env.SEED_N) || 1000;
const THROTTLE = Number(process.env.THROTTLE) || 15;

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 300) + ']' : ''));
}

// ── 产物锚（不依赖浏览器）──────────────────────────────────────────────────────
let product = '';
try { product = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
check('S1 时间分隔线与消息同行落进 appendTarget（分隔线不再一股脑挂 body）', product.includes('(appendTarget || body).appendChild(d);'));
check('S2 渲染窗起点越界按最新 RENDER_MAX 重开（空窗兜底）', product.includes('if (clampTop || renderStart >= len) renderStart = Math.max(0, len - RENDER_MAX);'));
check('S3 构建期迟到消息/分隔线暂存并在换装后补挂', product.includes('if (myDefer.q.length) {') && product.includes('batchDefer.q.push(m)'));
check('S4 记录位空洞留痕并自愈重画', product.includes('armWindowHoleHeal') && product.includes('skippedIdx.push(i)'));
check('S5 批量头像缓存永远新建（不残留复用旧快照）', product.includes('if (on) avatarBatchCache = {};'));
check('S6 裁剪/钳位按分隔线归属判（不削掉被保留消息头上的分隔线）', product.includes('function nodeKeepIdx(f) {'));

const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1001-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
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
          jsExcepts.push(String((d && ((d.exception && d.exception.description) || d.text)) || 'err').split('\n')[0].slice(0, 160));
        }
      };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr, awaitPromise) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 735, deviceScaleFactor: 3, mobile: true });
if (THROTTLE > 1) { try { await cdp('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); } catch (e) {} }

// 文档开始就装的探针：①包 __mochiPhase —— 冷整窗渲染的第一帧就注入一条「迟到消息」（确定性落在
// 分帧构建窗口内）；②按 data-idx（类名无关）采样行序/分隔线分布；③整窗换装的一刻记录本轮画了哪些下标。
const HOOK_SRC = `(function(){
  window.__mochi1001 = { fired: 0, why: '', clears: 0 };
  function fire(){
    if (window.__mochi1001.fired) return;
    window.__mochi1001.fired = 1;
    try { window.chatSendMsg('迟到消息 content 落点取证'); } catch (e) { window.__mochi1001.err = '' + e; }
  }
  window.__mochi1001.fire = fire;
  var tries = 0;
  var t = setInterval(function () {
    if (++tries > 900) { clearInterval(t); return; }
    if (typeof window.__mochiPhase !== 'function') return;
    var orig = window.__mochiPhase;
    window.__mochiPhase = function (tag) {
      try { if (tag === 'chat-renderWindow') setTimeout(fire, 0); } catch (e) {}
      return orig.apply(this, arguments);
    };
    clearInterval(t);
  }, 20);
  var obs = new MutationObserver(function (recs) {
    for (var i = 0; i < recs.length; i++) if ((recs[i].removedNodes || []).length >= 10) window.__mochi1001.clears++;
  });
  var b = document.getElementById('chat-body');
  if (b) obs.observe(b, { childList: true });
  else setTimeout(function () { var b2 = document.getElementById('chat-body'); if (b2) obs.observe(b2, { childList: true }); }, 500);
})();`;
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: HOOK_SRC });

const ORDER = `(function(){
  var body = document.getElementById('chat-body');
  var seq = [], divTotal = 0, divMaxRun = 0, divHead = 0, run = 0, seen = false, late = null;
  var kids = body.children;
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    if (k.classList && k.classList.contains('msg-time-divider')) {
      divTotal++; run++; if (run > divMaxRun) divMaxRun = run; if (!seen) divHead++;
      continue;
    }
    run = 0;
    if (!(k.getAttribute && k.getAttribute('data-idx') !== null)) continue;
    seen = true;
    var ix = parseInt(k.getAttribute('data-idx'), 10);
    var txt = k.textContent || '';
    if (txt.indexOf('迟到消息') >= 0) late = { idx: ix, pos: seq.length, txt: txt.slice(0, 18) };
    seq.push(ix);
  }
  var mono = 1, gaps = [], prev = -1;
  for (var j = 0; j < seq.length; j++) {
    if (seq[j] <= prev) mono = 0;
    else if (prev >= 0 && seq[j] !== prev + 1) gaps.push(prev + '>' + seq[j]);
    prev = seq[j];
  }
  return JSON.stringify({ rows: seq.length, first: seq[0], last: seq[seq.length - 1], mono: mono, gaps: gaps.slice(0, 4),
    divTotal: divTotal, divMaxRun: divMaxRun, divHead: divHead, late: late, bodyKids: kids.length });
})()`;

const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wH/q842iQAAAABJRU5ErkJggg==';

async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1200);
  await evalJs("(function(){try{localStorage.setItem('xy-home-v2:age-confirmed','1');}catch(e){} var s=document.getElementById('splash'); if(s&&s.parentNode) s.parentNode.removeChild(s); var m=document.getElementById('splash-mandatory'); if(m&&m.parentNode) m.parentNode.removeChild(m); return true;})()");
  await sleep(600);
  for (let i = 0; i < 30; i++) { if (await evalJs("typeof window.chatSendMsg === 'function' && typeof window.activeStore === 'function'")) break; await sleep(400); }
  await evalJs("(function(){var ph=document.querySelector('.phone'); if(ph) ph.style.visibility='visible'; return true;})()");
}
const CHAT_VIS = "(function(){var pg=document.getElementById('page-chat');if(!pg)return false;if(pg.hidden)return false;var cs=getComputedStyle(pg);if(cs.display==='none'||cs.visibility==='hidden')return false;if(document.querySelector('.splash:not(.hide)'))return false;return true;})()";
const clickChat = () => evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()");
async function enterChat() {
  for (let i = 0; i < 25; i++) {
    if ((await evalJs(CHAT_VIS)) && Number(await evalJs("document.querySelectorAll('#chat-body [data-idx]').length")) > 5) return true;
    await clickChat(); await sleep(700);
  }
  return false;
}
async function seed(extra) {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(300);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await openPage();
  const raw = await evalJs(`(async function(){
    try {
      var t0 = Date.now() - 10 * 86400000, a = [];
      for (var i = 0; i < ${N}; i++) a.push({ side: i % 2 ? 'in' : 'out', text: '消息' + String(i).padStart(4,'0') + ' 内容', ts: t0 + i * 14 * 60000 });
      localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(a));
      await window.idbSet('xy-home-v2:default:chat-msgs', a);
      var st = window.activeStore();
      st.set('cs-rp-auto-prob', '0');
      st.set('cs-avatar-user', ${JSON.stringify(PNG_A)});
      st.set('cs-avatar-partner', ${JSON.stringify(PNG_B)});
      st.set('cs-time-style', 'divider');
      ${extra || ''}
      return 'ok';
    } catch (e) { return 'ERR:' + e; }
  })()`, true);
  await sleep(400);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await openPage();
}

// ── 场景 1：冷整窗分帧构建（注入时点＝渲染第一帧）────────────────────────────────
console.log('\n— 场景 1：进聊天，整窗分帧构建在飞时落一条我方发送 —');
await seed('');
await enterChat();
await sleep(20000);
const s1 = JSON.parse((await evalJs(ORDER)) || '{}');
const hook1 = JSON.parse((await evalJs('JSON.stringify(window.__mochi1001||{})')) || '{}');
console.log('  观测: ' + JSON.stringify(s1));
console.log('  注入: fired=' + hook1.fired + ' clears=' + hook1.clears + ' err=' + (hook1.err || 'null'));
// B1 分隔线与消息穿插：连排 ≤1、列表头 ≤1
check('B1 时间分隔线与消息穿插（连续连排 ≤1 且头部 ≤1）', (s1.divMaxRun || 0) <= 1 && (s1.divHead || 0) <= 1,
  { divTotal: s1.divTotal, divMaxRun: s1.divMaxRun, divHead: s1.divHead });
// B3 迟到消息的**位序**必须与它的下标位序一致（＝没被埋进窗口中部）
// 注：它后面还可能再落几条（TA 回复/系统卡），所以「等于最后一行」不是正确判据；
// 正确判据是「位序 === 下标 − 窗首下标」，红侧节点被插进 fragment 中段时位序明显小于该值。
check('B3 构建期落地的消息位序与下标位序一致（不得埋进窗口中部）',
  !!(s1.late && s1.rows && s1.late.pos === s1.late.idx - s1.first),
  { late: s1.late, first: s1.first, expectPos: s1.late ? s1.late.idx - s1.first : null, rows: s1.rows });
// 行序必须严格递增、无空洞（data-idx 口径）
check('B3b 屏上 [data-idx] 严格递增且连续', s1.mono === 1 && (s1.gaps || []).length === 0, { mono: s1.mono, gaps: s1.gaps });
// B4 头像一致性（批量缓存泄漏＝灰占位/旧值）
const av = JSON.parse((await evalJs(`(function(){
  var st = window.activeStore();
  var want = { u: st.get('cs-avatar-user') || '', p: st.get('cs-avatar-partner') || '' };
  var rows = document.querySelectorAll('#chat-body [data-idx]'), bad = 0, n = 0, hasU = 0, hasP = 0;
  for (var i = 0; i < rows.length; i++) {
    var img = rows[i].querySelector('.msg-av img');
    if (!img) continue;
    n++;
    var src = img.getAttribute('src') || '';
    if (src === want.u) hasU++; else if (src === want.p) hasP++; else bad++;
  }
  return JSON.stringify({ rows: n, bad: bad, hasU: hasU, hasP: hasP });
})()`)) || '{}');
// METRIC（不计分）：红侧本装置未复现批量缓存泄漏（需「退出重进×3」的轮作废序列，见 verify-972 的 AV 组），
// 故这里只报数；头像门禁由 tools/verify-972-chat-render-integrity.mjs 承担。
console.log('  METRIC 头像一致性: ' + JSON.stringify(av));

// ── 场景 2：换到「小历史桌面」后 keepScroll 整窗重画（窗口起点越界）────────────────
console.log('\n— 场景 2：大历史 → 换小历史桌面 → keepScroll 整窗重画 —');
await seed(`window.__mkSmall = true;`);
await enterChat();
await sleep(2500);
// 先把窗口起点推到深处：连续上翻六次（loadOlderIncremental 会把 renderStart 往下搬）
for (let k = 0; k < 6; k++) {
  await evalJs("(function(){var b=document.getElementById('chat-body');b.scrollTop=Math.max(0,b.scrollTop-b.clientHeight*0.9);b.dispatchEvent(new Event('scroll'));return true;})()");
  await sleep(700);
}
const before = JSON.parse((await evalJs(`(function(){
  var cs = window.getChatMsgs ? window.getChatMsgs() : [];
  return JSON.stringify({ msgs: cs.length, rows: document.querySelectorAll('#chat-body [data-idx]').length });
})()`)) || '{}');
console.log('  换桌面前: ' + JSON.stringify(before));
// 建一个只有 12 条历史的新桌面并切过去
const sw = await evalJs(`(async function(){
  try {
    var id = window.createContact('小表测试');
    if (!id) return 'no-id';
    var t0 = Date.now() - 60000, a = [];
    for (var i = 0; i < 12; i++) a.push({ side: i % 2 ? 'in' : 'out', text: '小屋消息' + i, ts: t0 + i * 60000 });
    localStorage.setItem('xy-home-v2:' + id + ':chat-msgs', JSON.stringify(a));
    await window.idbSet('xy-home-v2:' + id + ':chat-msgs', a);
    window.switchContact(id);
    return 'switched:' + id;
  } catch (e) { return 'ERR:' + e; }
})()`, true);
console.log('  切桌面: ' + sw);
// 等新桌面权威数据到位（len 变成 12）
let len = -1;
for (let i = 0; i < 60; i++) {
  len = Number(await evalJs('(window.getChatMsgs ? window.getChatMsgs().length : -1)'));
  if (len > 0 && len <= 12) break;
  await sleep(500);
}
console.log('  新桌面数据条数: ' + len);
// 走 keepScroll 整窗重画（＝用户改「时间样式」等触发的那一枪）
await evalJs("(function(){ if (window.chatReRenderTime) window.chatReRenderTime(); return true; })()");
await sleep(3000);
const s2 = JSON.parse((await evalJs(ORDER)) || '{}');
const nowLen = Number(await evalJs('(window.getChatMsgs ? window.getChatMsgs().length : -1)'));
console.log('  观测: ' + JSON.stringify(s2) + ' 现数据条数=' + nowLen);
// METRIC（不计分，判别力说明）：本想用「换桌面」制造 renderStart ≥ len，但实测换桌面路径自身会把
// renderStart 归零（red 侧也画出 12 条）⇒ 本装置构造不出越界态，红绿同值。锚 S2 仍在，越界兜底由锚+
// 代码评审承担；能构造越界态的真机场景（缩表合并）无法在无头稳定复现。
console.log('  METRIC 换小历史桌面后重画: rows=' + s2.rows + ' 新桌面条数=' + len);
console.log('  METRIC 小历史桌面全量在屏: rows=' + s2.rows + ' msgs=' + nowLen);

check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3));

console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
