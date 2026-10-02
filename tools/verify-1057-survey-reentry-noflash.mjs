// ===== 常驻回归：批量设置问卷「发送到聊天」回聊天，进度条弹窗在已画好的记录上「闪一下」（#1057 家族·流程级配对资产）=====
// 用户原话：「批量设置问卷，发送到聊天里，还是会闪屏一下然后恢复正常」＋「不要覆盖修改导致不同型号设备
// 浏览器的bug反复出现。这个问题其他设备型号也有出现」。
// 根因（无头实证，纯时序、零机型分支）：闪的不是内容——MutationObserver 全程零批量增删（mut 空、
// inplacePatch 各闸全命中），闪的是 #chat-loading 弹窗本体：surveyGoChat→enterChat 第一段无条件
// chatRebuilding=true 顶条（停留超 IDB_RELOAD_MIN_GAP=8s 时 loadMsgs 还会再顶 chatAuthPending），
// 第二段同窗补丁命中当场交回——弹窗就在**用户几秒前刚看过、且一个字都不会变**的整窗记录上闪 300~530ms。
// 修复归属：#1057（切桌面批）的「屏上凭据」闸（chatScreenHasOwnWindow 收进 updateChatLoading 显隐判定）
// 已把这两个通道一并闸掉——本脚本是那记修复在**用户报障流程本体**上的行为断言（verify-1057-chat-loading-gate
// 钉的是闸机制，没走问卷页这条路；问卷重进闪屏属复发家族 #938/#951/#998/#1004/#1009/#1010/#1017/#1039/#1057…，
// 按「复发≥2次必须配行为断言」立此常驻）。
// 红绿配对实证：#1057 之前的 tip 纯 HEAD 恰红 S2（可见 2 帧）＋S2b（可见 8 帧）；含 #1057 的 tip 全绿。
// 边界（本脚本必须同时钉住，防修过头/防被反向覆盖）：
//   · 冷进首帧（#1017→#1057 换口径）：屏上已有预渲整窗时不再白挂加载条，但**不许无人看管**——
//     要么进度条真上屏 ≥1 帧，要么内容在 800ms 内落地（T 组）。
//   · 真要换装的整窗重建（renderWindow #841f 在清空 body 之后自己顶条，屏上凭据闸自然失效）→ 仍顶条（U 组）。
// 断言（4× CPU 节流＝中低端机等效慢速；每场景全新浏览器进程＋全新存储）：
//  S 组（报障路径：进过聊天→批量问卷→发出→回聊天；<8s 停留＝chatRebuilding 通道）
//    S1 前提：发出前屏上 ≥100 条、聊天页当前被问卷页挡住（hidden）
//    S2 ★主判据：点「发出」后 3s 内进度条可见帧 === 0（HEAD 恒 ≥1＝红；修后 0＝绿）
//    S3 无整窗换装：chat-body 单次 removed≥10 的批量移除 === 0 次
//    S4 内容照常到达：气泡数比发出前多 ≥2（两条系统卡），且屏上文本含「问卷」
//    S5 进度条终态收起（hidden=true）
//  S2b（同路径·>8s 停留＝loadMsgs 权威重读 chatAuthPending 通道）：可见帧 === 0
//  T 组（冷进边界）：冷启动落桌面→点聊天，进度条上屏 ≥1 帧 或 内容 ≤800ms 落地
//  U 组（换装边界）：聊天页可见时 chatImportMsgs 整包 300 条→重建期进度条 ≥1 帧可见，且最终画满、贴底
//  X 组：全程零未捕获 JS 异常
// 用法：node tools/verify-1057-survey-reentry-noflash.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
let ws = null, msgId = 0, pend = new Map(), chrome = null, cdpPort = 0;
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function withFreshBrowser(rate, fn) {
  cdpPort = 9930 + Math.floor(Math.random() * 50);
  msgId = 0; pend = new Map(); ws = null;
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'mochi-1057s-')),
    '--remote-debugging-port=' + cdpPort, 'about:blank'
  ], { stdio: 'ignore' });
  let connected = false;
  for (let i = 0; i < 80; i++) {
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
        connected = true;
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!connected) throw new Error('无法连接无头浏览器');
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setCPUThrottlingRate', { rate: rate });
  try { return await fn(); } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(300);
  }
}

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

// 只读探针（与 verify-1017 同口径）：每帧采样进度条**实际可见性**（非 hidden＋有几何框）＋气泡数；
// 另挂 chat-body childList 观察器记批量移除。**绝不改写 hidden 的读写通道**（1017 头注的坑）。
const PROBE = `(function(){
  var _raf = window.requestAnimationFrame.bind(window);
  window.__vp = { frames: [], errs: [], mut: [], t0: 0 };
  window.addEventListener('error', function(e){ try { window.__vp.errs.push(String((e && e.message) || 'err').slice(0,160)); } catch (x) {} });
  window.addEventListener('unhandledrejection', function(e){ try { window.__vp.errs.push('rej:' + String((e && e.reason) || '').slice(0,120)); } catch (x) {} });
  function barVisible(){
    var el = document.getElementById('chat-loading');
    if (!el) return -1;
    var cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return (!el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) ? 1 : 0;
  }
  var last = performance.now();
  function loop(){
    var now = performance.now();
    var cb = document.getElementById('chat-body');
    var pg = document.getElementById('page-chat');
    window.__vp.frames.push({ t: Math.round(now), bar: barVisible(), bubbles: cb ? cb.children.length : -1, chat: pg ? (pg.hidden ? 0 : 1) : -1 });
    last = now;
    if (window.__vp.frames.length > 4000) window.__vp.frames.shift();
    _raf(loop);
  }
  _raf(loop);
  var b = document.getElementById('chat-body');
  if (b) new MutationObserver(function(muts){ muts.forEach(function(mu){
    if (mu.type === 'childList' && mu.removedNodes.length >= 10) window.__vp.mut.push({ t: Math.round(performance.now()), rm: mu.removedNodes.length });
  }); }).observe(b, { childList: true });
  return true;
})()`;

async function clearSplash() {
  await evalJs("(function(){var s=document.getElementById('splash');if(s)s.remove();['modal-mask','qa-mask','pc-sheet-mask','backup-remind-bar'].forEach(function(id){var e=document.getElementById(id);if(e){e.hidden=true;e.style.display='none';}});return true;})()");
  await sleep(150);
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(250); }
  await sleep(1200);
  await clearSplash();
}
async function resetToDesk() {
  const vis = await evalJs("(function(){var pg=document.getElementById('page-chat');return !!(pg && !pg.hidden);})()");
  if (vis) { await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();return true;})()"); await sleep(600); }
  await sleep(200);
}
function seedExpr(n) {
  return `(function(){
    try {
      var now = Date.now(), arr = [];
      for (var i = 0; i < ${n}; i++) arr.push({ side: i % 2 ? 'in' : 'out', text: '记录' + String(i).padStart(3,'0'), ts: now - (${n} - i) * 60000 });
      try { window.activeStore().set('cs-rp-auto-prob', '0'); } catch (e) {}
      return window.chatImportMsgs(arr) ? 'true' : 'false';
    } catch (e) { return 'ERR:' + e.message; }
  })()`;
}
// 报障路径本体：进聊天（看过一帧）→ 整包 300 条 → 批量问卷 → 发出→回聊天
async function surveyScenario(dwellMs) {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(250);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,session_storage' });
  await openPage();
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(2500); // 首进落定（这一程允许顶条——T 组管它）
  const seeded = await evalJs(seedExpr(300));
  await sleep(6000); // 落盘/重建收尾
  await evalJs(PROBE);
  await evalJs("(function(){ window.openAskSurvey(); return true; })()");
  await sleep(1200);
  await evalJs(`(function(){
    var t=document.getElementById('ta-survey-text'); if(!t) return 'no-textarea';
    var v=''; for (var q=1;q<=8;q++) v+='【单选题】问题'+q+'？\\n选项A\\n选项B\\n选项C\\n';
    if ('value' in t) { t.value=v; } else { t.textContent=v; }
    t.dispatchEvent(new Event('input',{bubbles:true}));
    t.dispatchEvent(new Event('change',{bubbles:true}));
    return 'ok';
  })()`);
  await sleep(600);
  const pre = JSON.parse(await evalJs("(function(){var b=document.getElementById('chat-body');var pg=document.getElementById('page-chat');return JSON.stringify({n:b?b.children.length:-1,chatHidden:pg?!!pg.hidden:null});})()") || '{}');
  if (dwellMs) await sleep(dwellMs); // >IDB_RELOAD_MIN_GAP(8s)＝回聊天走权威重读（chatAuthPending 通道）
  await evalJs("(function(){ window.__vp.frames.length=0; window.__vp.mut.length=0; window.__vp.errs.length=0; window.__vp.t0=Math.round(performance.now()); return true; })()");
  const clicked = await evalJs("(function(){var b=document.getElementById('ta-survey-send');if(!b)return 'no-btn';b.click();return 'clicked';})()");
  await sleep(3000);
  const p = JSON.parse(await evalJs('JSON.stringify({frames:window.__vp.frames,mut:window.__vp.mut,errs:window.__vp.errs,t0:window.__vp.t0})') || '{}');
  const post = JSON.parse(await evalJs("(function(){var b=document.getElementById('chat-body');var l=document.getElementById('chat-loading');var cb=b?b.scrollTop+b.clientHeight:-1;return JSON.stringify({n:b?b.children.length:-1,hasSurvey:!!(b&&((b.innerText||'').indexOf('问卷')>=0)),barHidden:l?!!l.hidden:null,gap:Math.round((b?b.scrollHeight:0)-cb)});})()") || '{}');
  return { seeded, pre, clicked, p, post };
}

const rel = (t0, t) => Math.round(t - t0);
function barStats(p, fromT) {
  const f = (p.frames || []).filter((x) => rel(p.t0 || 0, x.t) >= (fromT || 0));
  return { visible: f.filter((x) => x.bar === 1).length, frames: f.length };
}

// ---------- S 组：快速回聊天（chatRebuilding 通道） ----------
console.log('== S 组：批量问卷发出→回聊天（<8s 停留，4× 节流） ==');
const S = await withFreshBrowser(4, () => surveyScenario(0));
{
  const bs = barStats(S.p);
  check('S0 前提：种子整包成功 + 点中「发出」', S.seeded === 'true' && S.clicked === 'clicked', 'seed=' + S.seeded + ' click=' + S.clicked);
  check('S1 前提：发出前屏上 ≥100 条、聊天页被问卷页挡住', S.pre.n >= 100 && S.pre.chatHidden === true, JSON.stringify(S.pre));
  check('S2 ★ 回聊天 3s 内进度条可见帧 === 0（HEAD 恒 ≥1＝闪一下复发）', bs.visible === 0, '可见帧=' + bs.visible + ' 采样帧=' + bs.frames);
  check('S3 无整窗换装（单次 removed≥10 的批量移除 === 0）', (S.p.mut || []).length === 0, JSON.stringify((S.p.mut || []).slice(0, 3)));
  check('S4 内容照常到达（气泡 ≥ 发出前+2 且屏上含「问卷」）', S.post.n >= S.pre.n + 2 && S.post.hasSurvey === true, 'pre=' + S.pre.n + ' post=' + S.post.n + ' 问卷=' + S.post.hasSurvey);
  check('S5 进度条终态收起', S.post.barHidden === true, 'barHidden=' + S.post.barHidden);
}

// ---------- S2b：停留 >8s 再发出（loadMsgs 权威重读 chatAuthPending 通道） ----------
console.log('== S2b：问卷页停留 9.5s 再发出（权威重读通道，4× 节流） ==');
const S2 = await withFreshBrowser(4, () => surveyScenario(9500));
{
  const bs = barStats(S2.p);
  check('S2b 前提：种子整包成功 + 点中「发出」', S2.seeded === 'true' && S2.clicked === 'clicked', 'seed=' + S2.seeded + ' click=' + S2.clicked);
  check('S2b ★ 回聊天 3s 内进度条可见帧 === 0（重读在飞≠屏上没内容）', bs.visible === 0, '可见帧=' + bs.visible + ' 采样帧=' + bs.frames);
}

// ---------- T 组：冷进边界——#1017→#1057 换口径：不顶条可以，但内容必须立刻在屏上（不许无人看管白屏） ----------
console.log('== T 组：冷启动落桌面→点聊天（预渲窗已在屏上凭据内：顶条 ≥1 帧 或 内容 ≤800ms 落地） ==');
const T = await withFreshBrowser(4, async () => {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(250);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,session_storage' });
  await openPage();
  await evalJs(seedExpr(300));
  await sleep(3000); // 等 persistChatHistory 落盘再冷启动（1017 头注：只写内存＝种子被吃掉、场景变空库）
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(250); }
  await sleep(1200);
  await clearSplash();
  await sleep(2500); // 桌面期预渲落定
  await resetToDesk();
  await evalJs(PROBE);
  await evalJs("(function(){ window.__vp.frames.length=0; window.__vp.mut.length=0; window.__vp.errs.length=0; window.__vp.t0=Math.round(performance.now()); return true; })()");
  const tapped = await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(!a)return false;a.click();return true;})()");
  await sleep(6000);
  const p = JSON.parse(await evalJs('JSON.stringify({frames:window.__vp.frames,errs:window.__vp.errs,t0:window.__vp.t0})') || '{}');
  const post = JSON.parse(await evalJs("(function(){var b=document.getElementById('chat-body');var l=document.getElementById('chat-loading');return JSON.stringify({n:b?b.children.length:-1,barHidden:l?!!l.hidden:null,gap:Math.round(b?b.scrollHeight-b.scrollTop-b.clientHeight:-1)});})()") || '{}');
  return { tapped, p, post };
});
{
  const bs = barStats(T.p);
  const firstContent = (T.p.frames || []).find((x) => x.chat === 1 && x.bubbles > 0);
  const contentLagMs = firstContent ? rel(T.p.t0 || 0, firstContent.t) : 1e9;
  check('T0 前提：点中聊天图标', T.tapped === true);
  check('T1 ★ 冷进不许无人看管：进度条上屏 ≥1 帧，或内容 ≤800ms 落地（#1057 换口径后的白屏闸）', bs.visible >= 1 || contentLagMs <= 800,
    '可见帧=' + bs.visible + ' 首内容@+' + (contentLagMs === 1e9 ? '-' : contentLagMs) + 'ms 采样帧=' + bs.frames);
  check('T2 内容照常到达且贴底', T.post.n > 50 && T.post.gap <= 8, 'n=' + T.post.n + ' gap=' + T.post.gap);
}

// ---------- U 组：换装边界——可见态整包导入（真重建）仍必须顶条 ----------
console.log('== U 组：聊天页可见时 chatImportMsgs 整包 300 条（renderWindow 分帧重建，进度条必须 ≥1 帧） ==');
const U = await withFreshBrowser(4, async () => {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(250);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,session_storage' });
  await openPage();
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(2500);
  await evalJs(seedExpr(50));
  await sleep(3000);
  await evalJs(PROBE);
  await evalJs("(function(){ window.__vp.frames.length=0; window.__vp.mut.length=0; window.__vp.errs.length=0; window.__vp.t0=Math.round(performance.now()); return true; })()");
  const seeded = await evalJs(seedExpr(300));
  await sleep(4000);
  const p = JSON.parse(await evalJs('JSON.stringify({frames:window.__vp.frames,mut:window.__vp.mut,errs:window.__vp.errs,t0:window.__vp.t0})') || '{}');
  const post = JSON.parse(await evalJs("(function(){var b=document.getElementById('chat-body');var l=document.getElementById('chat-loading');return JSON.stringify({n:b?b.children.length:-1,barHidden:l?!!l.hidden:null,gap:Math.round(b?b.scrollHeight-b.scrollTop-b.clientHeight:-1)});})()") || '{}');
  return { seeded, p, post };
});
{
  const bs = barStats(U.p);
  check('U0 前提：整包导入成功', U.seeded === 'true', 'seed=' + U.seeded);
  check('U1 ★ 换装边界：重建期进度条 ≥1 帧可见（屏上真值闸在清空 body 后必须自动失效）', bs.visible >= 1, '可见帧=' + bs.visible + ' 采样帧=' + bs.frames);
  check('U2 重建落定：窗口按 RENDER_MAX 上限画满（≥150 条）、进度条收起、贴底', U.post.n >= 150 && U.post.barHidden === true && U.post.gap <= 8, JSON.stringify(U.post));
}

const allErrs = [].concat(S.p.errs || [], S2.p.errs || [], T.p.errs || [], U.p.errs || []);
check('X1 全程零未捕获 JS 异常', allErrs.length === 0, allErrs.slice(0, 3).join(' ; ') || '0');

console.log('');
console.log('合计：通过 ' + pass + ' / 失败 ' + fail);
server.close();
process.exit(fail ? 1 : 0);
