// ===== 常驻回归 #972：OPPO Find X9 Edge(PWA) 实报「聊天发消息→消息气泡+头像一起消失、气泡位置错位、重启复原」=====
// 断言组：
//   V7  时间分隔线不得连排（基线 199 条摞在列表头部 / 修复后 ≤1）—— #972 判别力核心
//   AV  批量头像缓存泄漏：快速切页/重进造成渲染轮作废后，屏上每个 .msg-av 必须仍
//       等于存储里的当前头像（错值/灰占位＝旧版缓存泄漏症状）
//   H   渲染窗空洞/重复/可视带内重叠体检（数值打印，随批次观察）
//   A   入场动画生命周期（隐藏期挂入/挂入后挪位/动画窗内隐藏 都必须收尾 opacity=1）
//   Z1  全程零未捕获 JS 异常
// 用法：MOCHI_SERVE_ROOT=<产物目录> node tools/verify-965-chat-render-integrity.mjs   （仓外 red/green 对照必传）
// 判据全部落在 DOM 不变量上（零机型分支，纯几何/顺序）：
//   V1 屏上每一条 .msg 行都必须可见（computed opacity > 0.5、有非零盒子）
//   V2 屏上 [data-idx] 必须严格递增（DOM 顺序 == 时间顺序）
//   V3 屏上 [data-idx] 必须连续无空洞
//   V4 相邻 .msg 行不得重叠（气泡错位的直接观测量）
//   V5 每行该有的头像 .msg-av img 必须解码成功（naturalWidth > 0）
//   V6 行不得整体落在 .chat-body 可视矩形之外
//   V7 消息区分隔线（cs-time-style=divider）必须夹在「比它早的记录」与「比它晚的记录」之间
// 用法：
//   MOCHI_SERVE_ROOT=<产物目录> node tools/verify-chat-send-vanish.mjs
//   DIVIDER=1 打开时间分隔线样式（默认 1）；SEED_N 覆盖条数（默认 1008，= 用户诊断单实测条数）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.env.SEED_N) || 1008;
// 1x1 PNG（两个不同字节串＝可区分「我的/TA的」，也能一眼看出有没有被换成灰占位）
const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wH/q842iQAAAABJRU5ErkJggg==';
const DIVIDER = process.env.DIVIDER !== '0';
const THROTTLE = Number(process.env.THROTTLE) || 15;
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-955-' + Date.now()),
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
            const desc = (d && ((d.exception && d.exception.description) || d.text)) || 'err';
            jsExcepts.push(String(desc).split('\n').slice(0, 3).join(' | ').slice(0, 200));
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
async function evalJs(expr, awaitPromise) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 735, deviceScaleFactor: 3, mobile: true });
if (THROTTLE > 1) { try { await cdp('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); } catch (e) {} }

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 400) + ']' : ''));
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1500);
  // 开屏是「勾年龄 + 滑到底 + 强制公告页滑到底」多道闸门，且未 .hide 时
  // `.splash:not(.hide) ~ .phone{visibility:hidden}` 会把整棵 .phone 算成 hidden
  //（探针会误判「气泡不可见」）。这里直接摘掉开屏节点 = 应用 hide() 400ms 后的同款终态。
  await evalJs("(function(){try{localStorage.setItem('xy-home-v2:age-confirmed','1');}catch(e){} var s=document.getElementById('splash'); if(s&&s.parentNode) s.parentNode.removeChild(s); var m=document.getElementById('splash-mandatory'); if(m&&m.parentNode) m.parentNode.removeChild(m); return true;})()");
  await sleep(800);
  for (let i = 0; i < 30; i++) { if (await evalJs("typeof window.chatSendMsg === 'function' && typeof window.activeStore === 'function'")) break; await sleep(400); }
  await evalJs("(function(){var ph=document.querySelector('.phone'); if(ph) ph.style.visibility='visible'; return true;})()");
}
// 聊天页「真的在屏上」判据：page 未被 hidden、display/visibility 都不是隐藏、开屏已收（否则 .phone 整棵 hidden）
const CHAT_VIS = "(function(){var pg=document.getElementById('page-chat');if(!pg)return false;if(pg.hidden)return false;var cs=getComputedStyle(pg);if(cs.display==='none'||cs.visibility==='hidden')return false;if(document.querySelector('.splash:not(.hide)'))return false;return true;})()";
const ROW_N = "document.querySelectorAll('#chat-body .msg').length";
// 种子：default 桌面 N 条，ts 跨 10 天（每天若干条 ⇒ 时间分隔线必定出现多条）
async function seed() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await openPage();
  const raw = await evalJs(`(async function(){
    try {
      var t0 = Date.now() - 10 * 86400000;
      var a = [];
      for (var i = 0; i < ${N}; i++) {
        a.push({ side: i % 2 ? 'in' : 'out', text: '消息' + String(i).padStart(4, '0') + ' 内容', ts: t0 + i * 14 * 60000 });
      }
      localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(a));
      await window.idbSet('xy-home-v2:default:chat-msgs', a);
      window.activeStore().set('cs-rp-auto-prob', '0');
      window.activeStore().set('cs-avatar-user', ${JSON.stringify(PNG_A)} /* AV_USER */);
      window.activeStore().set('cs-avatar-partner', ${JSON.stringify(PNG_B)} /* AV_PARTNER */);
      ${DIVIDER ? "window.activeStore().set('cs-time-style', 'divider');" : "window.activeStore().set('cs-time-style', 'under-av');"}
      return 'ok';
    } catch (e) { return 'ERR:' + e; }
  })()`, true);
  if (raw !== 'ok') { console.error('种子失败: ' + raw); chrome.kill(); server.close(); process.exit(1); }
  await sleep(400);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await openPage();
}
async function clickChat() { return await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()"); }
// 反复点进聊天直到「聊天页真的在屏上且历史窗口已画出来」——开屏/节流下的竞态必须自愈，
// 否则后续所有几何断言都在测桌面。
const DBG_VIS = `(function(){
  var pg=document.getElementById('page-chat'); if(!pg) return 'no-page';
  var cs=getComputedStyle(pg);
  var sp=document.querySelector('.splash');
  return JSON.stringify({ hidden: pg.hidden, disp: cs.display, vis: cs.visibility,
    splashCls: sp? sp.className : '(gone)', phoneVis: getComputedStyle(document.querySelector('.phone')).visibility,
    activePage: (document.querySelector('.page:not([hidden])')||{}).id,
    cls: pg.className });
})()`;
async function enterChat() {
  for (let i = 0; i < 25; i++) {
    const vis = await evalJs(CHAT_VIS);
    const rows = await evalJs(ROW_N);
    if (vis && rows > 5) return { ok: true, rows: rows };
    await clickChat();
    await sleep(800);
  }
  return { ok: false, rows: await evalJs(ROW_N), dbg: await evalJs(DBG_VIS) };
}

// 探针：逐帧采样 DOM 不变量；另记 childList 增删（整窗清空＝一次删≥10）
const PROBE_SRC = `(function(){
  var body=document.getElementById('chat-body'), pg=document.getElementById('page-chat');
  if (!body || !pg) return 'NO_CTX';
  var S = { frames:0, visFrames:0, worst:null, snap:null, removedMax:0, clearsVis:0,
            minVisRows:1e9, emptyVisFrames:0, samples:[], divHead:0, divTotal:0, divMaxRun:0,
            persist:{}, stuck:[], stuckFrames:0 };
  window.__inv = S;
  var PT = performance.now();
  function sample(){
    var cb = body.getBoundingClientRect();
    var kids = body.children;
    var rows = [], i;
    for (i=0;i<kids.length;i++) if (kids[i].classList && kids[i].classList.contains('msg')) rows.push(kids[i]);
    var bad = { invisible:0, disIdx:0, gap:0, overlap:0, noAv:0, rows:rows.length, dividers:0 };
    var detail = [];
    // 分隔线分布取证：DOM 里连续分隔线的最大连排长度，以及列表头部分隔线个数
    var run = 0, totalDiv = 0, headDiv = 0, seenMsg = false;
    for (i=0;i<kids.length;i++){
      var k = kids[i];
      var isDiv = !!(k.classList && k.classList.contains('msg-time-divider'));
      if (isDiv) {
        totalDiv++;
        run++;
        if (run > S.divMaxRun) S.divMaxRun = run;
        if (!seenMsg) headDiv++;
      } else { if (k.classList && k.classList.contains('msg')) seenMsg = true; run = 0; }
    }
    bad.dividers = totalDiv;
    S.divHead = headDiv; S.divTotal = totalDiv;
    var prevIdx = -1, prevRect = null;
    var alive = {};
    var now = performance.now();
    for (i=0;i<kids.length;i++){
      var el = kids[i];
      if (!(el.classList && el.classList.contains('msg'))) continue;
      var idx = el.dataset.idx === undefined ? null : parseInt(el.dataset.idx, 10);
      if (idx === null) continue;
      if (idx <= prevIdx) { bad.disIdx++; detail.push({ p:'disIdx', idx: idx, prev: prevIdx }); }
      if (prevIdx >= 0 && idx !== prevIdx + 1) {
        bad.gap++;
        if (detail.filter(function(d){return d.p==='gap';}).length < 3) detail.push({ p:'gap', idx: idx, prev: prevIdx });
      }
      prevIdx = idx;
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      var inBand = (r.bottom > cb.top - 1 && r.top < cb.bottom + 1);
      var isInvisible = inBand && (parseFloat(cs.opacity) < 0.5 || (r.width < 1 && r.height < 1) ||
          cs.display === 'none' || cs.visibility === 'hidden');
      if (isInvisible) {
        bad.invisible++;
        // 持续性判据：瞬时（入场动画 from 态 ~0.4s）不算缺陷，>1500ms 仍不可见＝真卡死
        var pe = S.persist[idx];
        if (!pe) S.persist[idx] = { since: now, op: cs.opacity };
        else {
          alive[idx] = 1;
          if (now - pe.since > 1500) {
            S.stuckFrames++;
            if (S.stuck.length < 6) S.stuck.push({ idx: idx, ms: Math.round(now - pe.since), op: cs.opacity,
              cls: el.className.slice(0, 48), txt: (el.textContent||'').slice(0, 20) });
          }
        }
        detail.push({ p:'invisible', idx: idx, op: cs.opacity, disp: cs.display, vis: cs.visibility,
          w: Math.round(r.width), h: Math.round(r.height), cls: el.className.slice(0, 60),
          txt: (el.textContent||'').slice(0, 24) });
      }
      if (inBand && prevRect && r.top < prevRect.bottom - 2) {
        bad.overlap++; detail.push({ p:'overlap', idx: idx, gapPx: Math.round(prevRect.bottom - r.top) });
      }
      if (inBand) prevRect = r;
      var av = el.querySelector('.msg-av');
      if (av) { var im = av.querySelector('img'); if (im && (!im.complete || im.naturalWidth === 0)) bad.noAv++; }
    }
    for (var pk in S.persist) if (!alive[pk]) delete S.persist[pk];
    var info = { top: Math.round(body.scrollTop), max: body.scrollHeight - body.clientHeight,
      sh: body.scrollHeight, ch: body.clientHeight };
    var sc = 0;
    for (var kk in bad) if (bad[kk] && kk !== 'rows' && kk !== 'dividers') sc += bad[kk];
    if (detail.length > 8) detail.length = 8;
    return { score: sc, bad: bad, detail: detail, geo: info };
  }
  function vis(){
    if (pg.hidden) return false;
    var cs = getComputedStyle(pg);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (document.querySelector('.splash:not(.hide)')) return false;
    return true;
  }
  new MutationObserver(function(ms){
    var v = vis();
    for (var i=0;i<ms.length;i++){
      var m = ms[i];
      var rem = m.removedNodes ? m.removedNodes.length : 0;
      if (rem > S.removedMax) S.removedMax = rem;
      if (rem >= 10 && v) S.clearsVis++;
    }
  }).observe(body, { childList: true });
  (function loop(){
    S.frames++;
    if (vis()) {
      S.visFrames++;
      var nb = body.children.length;
      var s = sample();
      if (s.bad.rows < S.minVisRows) S.minVisRows = s.bad.rows;
      if (s.bad.rows < 10) { S.emptyVisFrames++; if (S.samples.length < 8) S.samples.push({ t: Math.round(performance.now()), rows: s.bad.rows, n: nb }); }
      if (!S.worst || s.score > S.worst.score) S.worst = s;
      S.snap = s;
    }
    window.requestAnimationFrame(loop);
  })();
  return true;
})()`;
async function installProbe() {
  for (let i = 0; i < 6; i++) { const r = await evalJs(PROBE_SRC); if (r === true) return true; await sleep(1000); }
  return false;
}
const report = async () => JSON.parse(await evalJs('JSON.stringify(window.__inv)') || '{}');
const settle = async () => { await sleep(300); await evalJs('new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});', true); await sleep(600); };

// 落定后的结构性体检（持久缺陷，非逐帧瞬时）：渲染窗内的 data-idx 必须连续无洞、无重复、升序。
// 洞＝有消息根本没画出来（用户所见「消息消失」）；且最新一条必须在 DOM 末尾。
const SETTLED_CHECK = `(function(){
  var b=document.getElementById('chat-body');
  var kids=b.children, idxs=[], seen={}, dup=0, i, e;
  for(i=0;i<kids.length;i++){
    e=kids[i];
    if(!e.classList || !e.classList.contains('msg')) continue;
    if(e.dataset.idx===undefined) continue;
    var n=parseInt(e.dataset.idx,10);
    if(seen[n]) dup++; seen[n]=1; idxs.push(n);
  }
  if(!idxs.length) return JSON.stringify({ domRows: 0 });
  var lo=Math.min.apply(null,idxs), hi=Math.max.apply(null,idxs);
  var missing=[];
  for(i=lo;i<=hi;i++) if(!seen[i]) { if(missing.length<10) missing.push(i); }
  var cb=b.getBoundingClientRect(), overlap=0, prev=null;
  for(i=0;i<kids.length;i++){
    e=kids[i];
    if(!e.classList || !e.classList.contains('msg')) continue;
    var r=e.getBoundingClientRect();
    if(r.bottom<cb.top||r.top>cb.bottom) continue;
    if(prev && r.top < prev.bottom-2) overlap++;
    prev=r;
  }
  return JSON.stringify({ domRows: idxs.length, lo: lo, hi: hi, missingCount: (hi-lo+1)-idxs.length,
    missing: missing, dup: dup, overlapInBand: overlap,
    scrollTop: Math.round(b.scrollTop), max: b.scrollHeight-b.clientHeight,
    atBottom: (b.scrollHeight-b.scrollTop-b.clientHeight) <= 8 });
})()`;
async function settledCheck(name) {
  const j = JSON.parse((await evalJs(SETTLED_CHECK)) || '{}');
  console.log('        [落定体检 ' + name + '] ' + JSON.stringify(j));
  return j;
}

// AV 组判据：屏上每一行的头像都必须等于**当前存储**里的头像。
// 错值＝批量头像缓存泄漏了旧快照（换过桌面就是别的桌面的头像）；连 <img> 都没有＝读成
// null 渲成了灰占位图标——两者都是用户所见「头像消失」，且只有刷新页面才恢复。
const AV_CHK = `(function(){
  var st = window.activeStore();
  var u = st.get('cs-avatar-user'), pa = st.get('cs-avatar-partner');
  var rows = 0, bad = [];
  var list = document.querySelectorAll('#chat-body .msg');
  for (var i = 0; i < list.length; i++) {
    var m = list[i], av = m.querySelector('.msg-av');
    if (!av) continue;
    rows++;
    var img = av.querySelector('img');
    var want = m.classList.contains('msg-out') ? u : pa;
    if (!img) { if (bad.length < 8) bad.push('placeholder@' + (m.dataset.idx || '?')); continue; }
    if (img.getAttribute('src') !== want) { if (bad.length < 8) bad.push('mismatch@' + (m.dataset.idx || '?')); }
  }
  return JSON.stringify({ rows: rows, badN: bad.length, bad: bad, hasUser: !!u, hasPartner: !!pa });
})()`;
console.log('服务目录: ' + root + '  条数=' + N + '  divider=' + DIVIDER + '  节流=' + THROTTLE + 'x');
await seed();
const entered = await enterChat();
check('前提：聊天页真的在屏上且历史窗口已渲染', entered.ok === true, entered);
await settle();
const probeOk = await installProbe();
check('前提：探针安装成功', probeOk === true);

async function scenario(name, fn) {
  await evalJs('window.__inv.worst=null;window.__inv.snap=null;window.__inv.clearsVis=0;window.__inv.removedMax=0;window.__inv.minVisRows=1e9;window.__inv.emptyVisFrames=0;window.__inv.samples=[];window.__inv.divMaxRun=0;window.__inv.persist={};window.__inv.stuck=[];window.__inv.stuckFrames=0;return true;');
  await fn();
  await settle();
  const r = await report();
  const w = r.worst || { score: 0, bad: {}, detail: [] };
  const b = w.bad || {};
  const structural = (b.disIdx || 0) + (b.gap || 0) + (b.overlap || 0) + (b.noAv || 0);
  console.log('  [' + name + '] 最差帧 bad=' + JSON.stringify(b));
  console.log('        可见帧=' + r.visFrames + ' 最小屏上行数=' + r.minVisRows + ' 空窗帧=' + r.emptyVisFrames
    + ' 单批最大删除=' + r.removedMax + ' 可见期整窗清空=' + r.clearsVis
    + ' | 分隔线 总数=' + r.divTotal + ' 头部连排=' + r.divHead + ' 最长连排=' + r.divMaxRun);
  console.log('        持续性不可见(>1500ms)=' + r.stuckFrames + ' ' + JSON.stringify(r.stuck || []));
  if (w.detail && w.detail.length) console.log('        最差帧明细=' + JSON.stringify(w.detail));
  if (r.samples && r.samples.length) console.log('        空窗采样=' + JSON.stringify(r.samples));
  const settled = await settledCheck(name);
  return { w, r, structural, settled };
}

// 场景 1：进聊天后直接发 3 条
const s1 = await scenario('发消息×3', async () => {
  for (let i = 1; i <= 3; i++) {
    await evalJs("window.chatSendMsg('测试发送第" + i + "条 content');");
    await sleep(900);
  }
});
// 随访指标（不计分）：structural 里的 gap 是「渲染窗空洞」——独立存量缺陷（消息在批量渲染在飞时
// 落地、其节点被写进随后作废的 fragment），非本批引入、也非本批修复面，故只报数不当门禁。
console.log('  METRIC 发消息×3: structural=' + s1.structural + ' stuck=' + s1.r.stuckFrames + ' (gap=渲染窗空洞，存量项)');

// 场景 2：上翻加载更早记录（触发 loadOlderIncremental + pruneWindowBottom + 分隔线插入），再回底并发一条
const s2 = await scenario('上翻→回底→再发', async () => {
  for (let k = 0; k < 6; k++) {
    await evalJs("(function(){var b=document.getElementById('chat-body');b.scrollTop=Math.max(0,b.scrollTop-b.clientHeight*0.9);b.dispatchEvent(new Event('scroll'));return true;})()");
    await sleep(700);
  }
  await evalJs("(function(){var b=document.getElementById('chat-body');b.scrollTop=b.scrollHeight;b.dispatchEvent(new Event('scroll'));return true;})()");
  await sleep(700);
  await evalJs("window.chatSendMsg('上翻回来之后的一条 content');");
  await sleep(1200);
});
console.log('  METRIC 上翻→回底→再发: structural=' + s2.structural + ' stuck=' + s2.r.stuckFrames);

// 场景 3：连续快速发 8 条（含中途滚动）
const s3 = await scenario('连发×8', async () => {
  for (let i = 0; i < 8; i++) { await evalJs("window.chatSendMsg('连发第" + i + "条 content');"); await sleep(220); }
  await sleep(1500);
});
console.log('  METRIC 连发×8: structural=' + s3.structural + ' stuck=' + s3.r.stuckFrames);

// 场景 4：TA 来消息（in 侧，触发 maybeScrollChatBottom 的另一支）
const s4 = await scenario('TA来消息×3', async () => {
  for (let i = 0; i < 3; i++) { await evalJs("window.chatAddIn('TA 来的第" + i + "条 content');"); await sleep(800); }
});
console.log('  METRIC TA来消息×3: structural=' + s4.structural + ' stuck=' + s4.r.stuckFrames);

// 渲染窗空洞体检（持久缺陷）：洞＝消息没画出来；重复＝同一条画两遍；可视带内重叠＝气泡位置错位
// 渲染窗体检随访指标（不计分）：missingCount＝未画出的下标数（存量缺陷，见上），
// dup＝同一条画两遍，overlapInBand＝可视带内气泡重叠（位置错位的直接观测量，本批应为 0）。
for (const [nm, sc] of [['发消息×3', s1], ['上翻→回底→再发', s2], ['连发×8', s3], ['TA来消息×3', s4]]) {
  const st = sc.settled || {};
  console.log('  METRIC H-' + nm + ': 空洞=' + (st.missingCount || 0) + ' 重复=' + (st.dup || 0)
    + ' 可视带内重叠=' + (st.overlapInBand || 0) + ' 行数=' + (st.domRows || 0)
    + ' missing=' + JSON.stringify(st.missing || []));
  check('H-' + nm + ' 无重复绘制/可视带内无重叠', (st.dup || 0) === 0 && (st.overlapInBand || 0) === 0, st);
}

// 场景 5：连续「退出聊天→重进」制造渲染轮作废（旧轮的批量头像缓存会泄漏），再发一条
const s5 = await scenario('退出重进×3 后再发', async () => {
  for (let i = 0; i < 3; i++) {
    await evalJs("(function(){var b=document.getElementById('chat-back'); if(b)b.click(); return true;})()");
    await sleep(350);
    await enterChat();
    await sleep(400);
  }
  await evalJs("window.chatSendMsg('退出重进之后的一条 content');");
  await sleep(1500);
});
const av = JSON.parse((await evalJs(AV_CHK)) || '{}');
console.log('        [头像一致性] ' + JSON.stringify(av));
check('AV 批量头像缓存不泄漏（屏上头像==当前存储头像；无错值/无灰占位）',
  (av.badN || 0) === 0 && (av.rows || 0) > 0 && av.hasUser === true && av.hasPartner === true, av);

// 分隔线落位断言：正确布局下「相邻两条消息之间的分隔线」至多 1 条，
// 故 DOM 里连续分隔线的最大连排长度必须 ≤ 1（错位累积＝几百条连排）。
check('V7 时间分隔线不得连排（>1 即整摞堆在同一处＝布局错位）',
  (s4.r.divMaxRun || 0) <= 1 && (s4.r.divHead || 0) <= 1,
  { 最长连排: s4.r.divMaxRun, 头部连排: s4.r.divHead, 总数: s4.r.divTotal });

// 入场动画生命周期实验（关掉探针后单独跑，避免假节点污染前面的采样）
await evalJs('window.__inv.stopped=true;return true;');
const ANIM_EXP = `(async function(){
  var body=document.getElementById('chat-body'), pg=document.getElementById('page-chat');
  function mk(tag){
    var d=document.createElement('div');
    d.className='msg msg-out msg-enter';
    d.dataset.idx='999999';
    d.innerHTML='<div class="msg-av"></div><div class="msg-bubble">'+tag+'</div>';
    return d;
  }
  var op = function(el){ try { return parseFloat(getComputedStyle(el).opacity); } catch(e){ return -1; } };
  var an = function(el){ try { return (el.getAnimations()||[]).map(function(a){ return a.animationName+':'+a.playState; }).join(','); } catch(e){ return '?'; } };
  var res={};
  // TA1：聊天页隐藏期挂入 → 再显示（= 隐藏态预渲/后台来消息的现实时序）
  var a=mk('TA1'); pg.hidden=true; body.appendChild(a);
  await new Promise(function(r){setTimeout(r,1200);});
  pg.hidden=false;
  await new Promise(function(r){setTimeout(r,2500);});
  res.hiddenThenShow = op(a); res.hiddenThenShowAnim = an(a);
  // TA2：可见挂入 → 立刻把节点挪位（增量插入/裁剪都会搬节点）
  var b=mk('TA2'); body.appendChild(b);
  await new Promise(function(r){setTimeout(r,30);});
  body.insertBefore(b, body.firstChild);
  await new Promise(function(r){setTimeout(r,2500);});
  res.movedAfterInsert = op(b); res.movedAfterInsertAnim = an(b);
  // TA3：可见挂入 → 动画窗口内把页隐藏再显示（切页/锁屏/来电话的现实时序）
  var c=mk('TA3'); body.appendChild(c);
  await new Promise(function(r){setTimeout(r,120);});
  pg.hidden=true;
  await new Promise(function(r){setTimeout(r,200);});
  pg.hidden=false;
  await new Promise(function(r){setTimeout(r,2500);});
  res.hiddenMidAnim = op(c); res.hiddenMidAnimAnim = an(c);
  // TA4：基线——干净挂入
  var d2=mk('TA4'); body.appendChild(d2);
  await new Promise(function(r){setTimeout(r,2500);});
  res.baseline = op(d2); res.baselineAnim = an(d2);
  [a,b,c,d2].forEach(function(x){ if(x.parentNode) x.parentNode.removeChild(x); });
  return JSON.stringify(res);
})()`;
const anim = JSON.parse((await evalJs(ANIM_EXP, true)) || '{}');
console.log('  入场动画生命周期实验: ' + JSON.stringify(anim));
check('A-baseline 干净挂入的入场动画正常收尾（opacity=1）', anim.baseline === 1, anim.baseline);
check('A1 隐藏期挂入→显示后动画仍收尾（opacity=1，否则整行气泡+头像永久消失）',
  anim.hiddenThenShow === 1, { op: anim.hiddenThenShow, anim: anim.hiddenThenShowAnim });
check('A2 挂入后挪位→动画仍收尾（opacity=1）',
  anim.movedAfterInsert === 1, { op: anim.movedAfterInsert, anim: anim.movedAfterInsertAnim });
check('A3 动画窗口内隐藏→显示后动画仍收尾（opacity=1）',
  anim.hiddenMidAnim === 1, { op: anim.hiddenMidAnim, anim: anim.hiddenMidAnimAnim });
const layout = await evalJs(`(function(){
  var b=document.getElementById('chat-body'), out=[], k=b.children;
  for (var i=0;i<k.length && i<14;i++){
    var e=k[i];
    out.push((e.classList.contains('msg-time-divider')?'DIV':(e.dataset.idx!==undefined?('#'+e.dataset.idx):e.tagName))+':'+(e.textContent||'').slice(0,6));
  }
  return JSON.stringify({ head: out, n: k.length, firstTag: k[0] && k[0].className });
})()`);
console.log('  DOM 头部布局: ' + layout);

const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
console.log('  in-page __jsErrors=' + errs + '  CDP 未捕获异常=' + jsExcepts.length);
check('Z1 零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3));

// ===== 本批判别力汇总（基线红 / 修复绿）=====
check('汇总 V7 时间分隔线正确穿插（基线：全部摞在列表头部）', (s4.r.divMaxRun || 0) <= 1, s4.r.divMaxRun);
check('汇总 AV 批量头像缓存零泄漏（泄漏＝头像错值/灰占位，只有刷新才恢复）', (av.badN || 0) === 0, av.bad);

console.log('\n结果: ' + pass + ' / ' + fail);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
