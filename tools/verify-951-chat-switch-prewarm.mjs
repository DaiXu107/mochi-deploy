// ===== 常驻回归：#951 切换桌面联系人后打开聊天「还是会闪屏一下才恢复正常、没有数据加载缓冲动画」=====
// 根因（纯 HEAD 无头实测取证，零机型分支、纯时序/数据量判据）：contact-switched 清空 msgs 并按
// #489 强制 windowStale=true，却从不碰 chat-body 的 DOM；而新桌面的权威数据在切换当口已被
// chatPrefetchIfLight→loadMsgs 预读进内存。于是「点聊天图标」那一刻必然整窗重建
// （inplacePatchIfSameWindow 因 stale＋windowRenderedPrefix 仍属旧桌面＝双重不可能命中）：
// body 先 innerHTML='' 再逐块建 → 可见空窗（实测 120 条：不节流 19ms、15× 节流 1148ms，快机上
// 进度条只活 19ms＝「没有缓冲动画」）；<80 条走同步路径虽无空窗，却是一记长任务把旧桌面画面
// 定格后整窗砸掉＝「闪一下才恢复正常」。
// 修法＝隐藏态预渲：本命名空间权威落定（authLoadedPrefix，不信会被 15 秒保险丝假置位的
// chatDbReady）且聊天页仍隐藏时，延后 600ms 按新数据整窗预渲一次 → enterChat 同窗补丁命中。
// 断言（每场景全新存储；15× CPU 节流＝中低端真机等效慢速）：
//  S 组＝产物源锚（红侧必红）：S1 预渲调度器＋就绪闸只认 authLoadedPrefix／S2 同窗补丁顶部
//      batchRendering 早退守卫（#951h）
//  P 组＝夹具前提（两侧同过）：切换前屏上确是 A 桌面、点开后台面确是 B 桌面且条数达标
//  A 组＝本批缺陷面（绿过红红）：A1 可见期无「removedNodes≥10 的整窗清空」／A2 可见期无
//      「屏上不足 10 条气泡」的帧／A3 可见期 chat-body 零新增节点（没有中途换装）／
//      A4 机制项：点开聊天之前（页面仍藏着）屏上末条已是新桌面的记录
//  B 组＝防修过头（两侧同过）：>8MB 账本＝大历史未预读 → 权威未就绪，预渲一律不动作——
//      点开前屏上仍是旧桌面（不拿旧画面冒充新桌面），点开后的空窗期进度条必须亮着（诚实反馈）
//  C 组＝既有契约不回归（两侧同过）：C1 落底且窗口尾贴最新／C2 用户手动上翻不被拽回（#162）／
//      C3 连续两次切换（A→B→A→B）第二次同样无可见空窗（预渲凭据可复用）
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-951-chat-switch-prewarm.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.env.SEED_N) || 120; // ≥RENDER_CHUNK_MIN(80) ⇒ 整窗重建走分帧路径（可见空窗）
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
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9910 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-951-' + Date.now()),
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
async function evalJsVerbose(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      const d = r.exceptionDetails;
      return 'EVAL_ERR:' + ((d.exception && d.exception.description) || d.text);
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'EVAL_ERR:' + e; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: 15 }); // 中低端安卓真机等效慢速

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1500);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(1000);
  // 15× 节流下开屏脚本仍在跑：等 createContact/activeStore 真的在场再继续（否则种子静默失败）
  for (let i = 0; i < 30; i++) { if (await evalJs("typeof window.createContact === 'function' && typeof window.activeStore === 'function'")) break; await sleep(400); }
}
// 两个桌面各种 N 条纯文本记录（前缀 A/B 内嵌正文＝「屏上这一份属于哪个桌面」可直接断言）。
// 关掉联系人主动发消息概率，消掉测量窗里随机长出来的新气泡。
async function resetAndSeed(opts) {
  const lazyB = !!(opts && opts.lazyB);
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await openPage();
  const raw = await evalJsVerbose(`(async function(){
    try {
      var t0 = Date.now() - 86400000;
      function arr(tag, n){ var a=[]; for (var i=0;i<n;i++) a.push({ side: i%2?'in':'out', text: tag+' 记录'+String(i).padStart(4,'0'), ts: t0 + i*60000 }); return a; }
      var cid = window.createContact('第二桌面');
      var pk = 'xy-home-v2:' + cid;
      var a = arr('A', ${N}), b = arr('B', ${N});
      localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(a));
      await window.idbSet('xy-home-v2:default:chat-msgs', a);
      localStorage.setItem(pk + ':chat-msgs', JSON.stringify(b));
      await window.idbSet(pk + ':chat-msgs', b);
      ${lazyB ? `// 大包门控夹具：只把账本 b 报成 9MB（超 CHAT_LAZY_BYTES=8MB），历史本体仍是 ${N} 条
      var meta = JSON.stringify({ n: ${N}, b: 9 * 1024 * 1024 });
      localStorage.setItem(pk + ':chat-meta', meta); await window.idbSet(pk + ':chat-meta', meta);` : ''}
      window.activeStore().set('cs-rp-auto-prob', '0');
      window.xyStore(pk).set('cs-rp-auto-prob', '0');
      return JSON.stringify({ cid: cid, ok: true });
    } catch (e) { return 'ERR:' + e; }
  })()`);
  let j = null; try { j = JSON.parse(raw || '{}'); } catch (e) {}
  if (!j || !j.cid) { console.error('种子失败: ' + raw); chrome.kill(); server.close(); process.exit(1); }
  await sleep(400);
  return j.cid;
}
async function reloadStable() { // 让两个桌面各自把种子读进权威（并稳定冷池）
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await openPage();
}
async function clickChat() { return await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()"); }
async function exitChat() { return await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();return true;})()"); }
// 探针：chat-body childList 变更（带「当时聊天页是否可见」）、进度条 hidden 翻转、逐帧采样
const PROBE_SRC = `(function(){
  var body=document.getElementById('chat-body'), bar=document.getElementById('chat-loading'), pg=document.getElementById('page-chat');
  if (!body || !pg) return 'NO_CTX';
  var t0 = performance.now();
  window.__p = { t0: t0, clearsVis: [], addsVis: 0, events: 0, visFrames: 0, emptyVisFrames: 0,
    barVisFrames: 0, frames: 0, stopped: false };
  new MutationObserver(function(muts){
    var vis = !pg.hidden;
    for (var i=0;i<muts.length;i++) {
      var m = muts[i];
      var rem = m.removedNodes ? m.removedNodes.length : 0, ad = m.addedNodes ? m.addedNodes.length : 0;
      window.__p.events++;
      if (rem >= 10 && vis) window.__p.clearsVis.push(Math.round(performance.now() - t0));
      if (ad && vis) window.__p.addsVis += ad;
    }
  }).observe(body, { childList: true });
  (function loop(){
    if (window.__p.stopped) return;
    window.__p.frames++;
    if (!pg.hidden) {
      window.__p.visFrames++;
      if (body.children.length < 10) window.__p.emptyVisFrames++;
      if (bar && !bar.hidden) window.__p.barVisFrames++;
    }
    window.requestAnimationFrame(loop);
  })();
  return true;
})()`;
async function installProbe() {
  for (let i = 0; i < 6; i++) {
    const r = await evalJs(PROBE_SRC);
    if (r === true) return true;
    await sleep(1000);
  }
  return false;
}
async function probe() { return JSON.parse(await evalJs('JSON.stringify(window.__p||null)') || 'null'); }
async function stopProbe() { await evalJs("(function(){if(window.__p)window.__p.stopped=true;return true;})()"); }
// 屏上画面属于哪个桌面：扫描气泡正文里的桌面标记（A/B 记录0119＝各自种下的最新一条）。
// 不用「末条文本」判定——聊天会被其他模块（寻踪/查岗提醒等）追加新气泡，末条未必是种子。
async function screenTail() {
  const raw = await evalJs(`(function(){
    var b=document.getElementById('chat-body');
    var hasA=false, hasB=false, idxs=[];
    for (var i=0;i<b.children.length;i++) {
      var el=b.children[i], t=el.textContent||'';
      if (t.indexOf('A 记录0119')>=0) hasA=true;
      if (t.indexOf('B 记录0119')>=0) hasB=true;
      if (el.dataset && el.dataset.idx!==undefined) idxs.push(Number(el.dataset.idx));
    }
    var last=b.lastElementChild, txt=last?(last.innerText||last.textContent||''):'';
    var asc=true; for (var k=1;k<idxs.length;k++) if (idxs[k]<=idxs[k-1]) { asc=false; break; }
    var pg=document.getElementById('page-chat');
    var shown=document.querySelector('.page:not([hidden])');
    return JSON.stringify({ kids: b.children.length, hasA: hasA, hasB: hasB, tail: txt.slice(0,20), asc: asc,
      lastIdx: idxs.length?idxs[idxs.length-1]:-1, maxIdx: idxs.length?Math.max.apply(null,idxs):-1,
      gap: Math.round(b.scrollHeight-b.scrollTop-b.clientHeight), vis: !pg.hidden, page: shown?shown.id:'' });
  })()`);
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}
async function switchTo(cid) { return await evalJs(`(function(){try{window.setActiveContact(${JSON.stringify(cid)});return window.activePrefix();}catch(e){return 'ERR:'+e;}})()`); }
// 轮询等待页面侧条件成立（第 2、3 次切换时 IDB 重读明显变慢，固定 sleep 会把「还没读到
// 权威」误判成「预渲没做」）；expr 必须在页面里求值为布尔
async function waitUntil(expr, maxMs, ivMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await evalJs(expr)) return true;
    await sleep(ivMs || 500);
  }
  return false;
}

// ---- 主场景：种两桌面 → A 进聊天（画过一次）→ 退出 → 装探针 → 切到 B → 等预渲落定 → 点开聊天 ----
const HASB = "(function(){var b=document.getElementById('chat-body');return b.textContent.indexOf('B 记录0119')>=0;})()";
const HASA = "(function(){var b=document.getElementById('chat-body');return b.textContent.indexOf('A 记录0119')>=0;})()";
const HASB_FULL = `(function(){var b=document.getElementById('chat-body');return b.textContent.indexOf('B 记录0119')>=0 && b.children.length>=${N - 5};})()`;
async function scenarioSwitch(opts) {
  const cid = await resetAndSeed(opts);
  await reloadStable();
  await clickChat();
  await sleep(7000); // A 桌面首进：构建＋权威核对全部落定
  const a1 = await screenTail();
  await exitChat();
  await sleep(1500);
  if (opts && opts.roundTrip) {
    // 先完整走一遍 A→B→A（各自等隐藏态落定），让下面量的是「第二次切到 B」：
    // 屏上渲染凭据此时属 A，切回 B 必须重新预渲而不是被去重闸挡掉
    await switchTo(cid);
    await waitUntil(HASB, Number(process.env.PREWARM_WAIT) || 15000, 400);
    await switchTo('default');
    await waitUntil(HASA, Number(process.env.PREWARM_WAIT) || 15000, 400);
    await sleep(1500);
  }
  const okProbe = await installProbe();
  await switchTo(cid);
  let prewarmLanded = false;
  if (opts && opts.lazyB) {
    // 懒读桌面：预渲本就不该动作，短等即点开——等满轮询会跨过 15 秒就绪保险丝
    //（armReadyFuse 假置位 chatDbReady → #703 合法收起进度条，B2 就变成夹具自造的假红）
    await sleep(2500);
  } else {
    // 绿＝权威落定 +600ms 的隐藏态预渲画上 B；红＝永远不画（超时后照常量点开那一下）
    prewarmLanded = await waitUntil(HASB, Number(process.env.PREWARM_WAIT) || 15000, 400);
  }
  const before = await screenTail();
  await clickChat();
  const tFull = Date.now();
  // 上限 60s（原 30s）：本机同时挂着并行 Chrome 时，第 2/3 次权威重读在 15× 节流下可以跨过 30s，
  // 那时 after.hasB=false 是「还没读到」而不是「画坏了」（#1057 收口实测同产物 g 侧 15/1 即此形态）。
  const fullLanded = await waitUntil(HASB_FULL, Number(process.env.FULL_WAIT) || 60000, 500);
  const fullWaitMs = Date.now() - tFull;
  await sleep(1200); // #504 稳定窗落定
  const after = await screenTail();
  const p = await probe();
  await stopProbe();
  return { cid, okProbe, prewarmLanded, fullLanded, fullWaitMs, a1, before, after, p };
}

// ---- S 组：源锚（读被服务产物文本；不依赖浏览器，红绿对照时最先见分晓）----
{
  let src = '';
  try { src = readFileSync(join(root, 'js/chat.js'), 'utf8'); } catch (e) { src = ''; }
  check('S1 预渲调度器在位且就绪闸只认本命名空间权威 authLoadedPrefix（用 chatDbReady 判就绪＝15 秒保险丝假就绪会按有损快照预渲）',
    src.indexOf('function scheduleChatPrewarm(prefix)') >= 0 && src.indexOf('if (!(chatDbReady && authLoadedPrefix === prefix)) return;') >= 0,
    src ? 'anchors ok' : '产物 js/chat.js 读不到: ' + join(root, 'js/chat.js'));
  check('S2 同窗补丁顶部分帧在飞守卫在位（#951h：删＝预渲重建中途被判成「已画好」，进度条就地收掉、闪白无提示）',
    src.indexOf('if (batchRendering) return false;') >= 0, src ? '' : '产物读不到');
}
// ---- P 组：夹具前提（两侧同过）----
{
  const s = await scenarioSwitch();
  check('P0 夹具：探针装成＋A 桌面首进确实画过 A 的记录', s.okProbe === true && s.a1.kids > 50 && s.a1.hasA === true, JSON.stringify(s.a1));
  check('P1 夹具：切到 B 并点开聊天后，屏上是 B 桌面的记录且条数达标', s.after.hasB === true && s.after.kids >= N - 5 && s.after.vis === true, JSON.stringify(s.after));
  check('P2 夹具：切走前聊天页已隐藏（测量窗＝从隐藏到点开这一段）', s.before.vis === false && s.a1.vis === true, JSON.stringify({ before: s.before.vis }));
  // ---- A 组：本批缺陷面 ----
  check('A1 可见期内 chat-body 没有「整窗清空」（removedNodes≥10）＝不闪屏', s.p && s.p.clearsVis.length === 0, JSON.stringify(s.p && s.p.clearsVis));
  check('A2 可见期内没有任何一帧「屏上不足 10 条气泡」＝无空窗', s.p && s.p.emptyVisFrames === 0, JSON.stringify({ emptyVisFrames: s.p && s.p.emptyVisFrames, visFrames: s.p && s.p.visFrames }));
  check('A3 可见期内 chat-body 零新增节点＝点开时没换装（同窗补丁命中）', s.p && s.p.addsVis === 0, JSON.stringify({ addsVis: s.p && s.p.addsVis, events: s.p && s.p.events }));
  check('A4 机制：点开之前（页面仍藏着）屏上已是 B 桌面的记录＝预渲在隐藏期做完了', s.before.hasB === true && s.before.hasA === false && s.before.kids >= N - 5, JSON.stringify(s.before));
  globalThis.__s951 = s;
}
// ---- B 组：防修过头（大历史未预读＝权威未就绪，预渲一律不动作）----
{
  const s = await scenarioSwitch({ lazyB: true });
  // B1/B2 原口径＝「固定 sleep(2500) 内预渲必然还没落地」，那是拿机器速度当判据：同一份产物两侧都会随机翻
  //（#1057 收口实测同 tip 连跑：g 14/2·16/0·16/0、r 16/0·15/1·16/0）。改成竞态无关的分支判据，牙齿不削：
  // 点开那一刻屏上只有两种合法形态——①仍是旧桌面（A）＝预渲未落地 ⇒ 这分支里 B2 照旧要求「必须亮过条」；
  // ②已是完整 B 窗（kids 达标）＝预渲提前落地 ⇒ 可以没有条，但必须证得「内容真的齐了」而不是屏上还空着。
  // 非法形态照旧拦：A/B 混屏（拿旧桌面冒充新桌面）、点开后屏上不是 B 的记录。
  const landedAtClick = s.before.hasB === true && s.before.hasA === false && s.before.kids >= N - 5;
  const staleAtClick = s.before.hasA === true && s.before.hasB === false;
  check('B1 大包懒读桌面：点开那一刻屏上要么仍是旧桌面（预渲未落地）要么已是完整 B 窗（提前落地），不得混屏冒充', (landedAtClick || staleAtClick) && s.after.hasB === true, JSON.stringify({ landedAtClick, staleAtClick, fullLanded: s.fullLanded, fullWaitMs: s.fullWaitMs, before: { kids: s.before.kids, hasA: s.before.hasA, hasB: s.before.hasB }, after: { hasB: s.after.hasB } }));
  check('B2 大包懒读桌面：预渲未落地时点开必须有进度条（真在读的诚实反馈没被削掉）；已落地则须证内容真齐（kids 达标）', !!s.p && (staleAtClick ? s.p.barVisFrames >= 1 : s.before.kids >= N - 5), JSON.stringify({ staleAtClick, barVisFrames: s.p && s.p.barVisFrames, kids: s.before.kids }));
}
// ---- C 组：既有契约不回归（两侧同过）----
{
  const s = globalThis.__s951;
  check('C1 进聊天落底且窗口尾贴最新（data-idx 升序）', s.after.lastIdx === s.after.maxIdx && s.after.asc === true && s.after.gap <= 8, JSON.stringify(s.after));
  await evalJs("(function(){var b=document.getElementById('chat-body');b.dispatchEvent(new Event('touchstart'));b.scrollTop=3000;b.dispatchEvent(new Event('scroll'));return true;})()");
  await sleep(2500);
  const c2 = await screenTail();
  const c2top = Number(await evalJs("(function(){var b=document.getElementById('chat-body');return Math.round(b.scrollTop);})()"));
  check('C2 落底后用户手动上翻不被拽回（#162 解钉契约）', c2top >= 2800 && c2.gap > 100, JSON.stringify({ top: c2top, gap: c2.gap }));
  await exitChat();
  await sleep(1200);
  // 连续切换 A→B→A→B（同一次运行里第二次切回 B）：预渲凭据在二次切换后仍要生效
  const s2 = await scenarioSwitch({ roundTrip: true });
  check('C3 前提：二次切换场景照常跑通（点开后台面为 B 且条数达标）', s2.okProbe === true && s2.after.hasB === true && s2.after.kids >= N - 5, JSON.stringify({ prewarmLanded: s2.prewarmLanded, after: s2.after }));
  check('C4 连续两次切换后，点开聊天仍无可见空窗（预渲凭据可复用）', s2.p && s2.p.clearsVis.length === 0 && s2.p.emptyVisFrames === 0, JSON.stringify(s2.p && { clears: s2.p.clearsVis, empty: s2.p.emptyVisFrames, adds: s2.p.addsVis }));
}
check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' | '));

chrome.kill(); server.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
