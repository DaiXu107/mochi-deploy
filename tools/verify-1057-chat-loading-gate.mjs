// ===== 常驻回归：#1057 切桌面来回切「加载进度条还是不完整、来回切看着像 bug」=====
// 用户报障原话：#951 上线后「问题依旧没有解决。那这个加载进度条还是不完整啊，就是因为这样切换，
// 来回切换用户就会以为是 bug」。15× 节流逐帧取证（本机 origin/main 产物）量出三处形态，共同根因＝
// 进度条只回答「标志位有没有置起」，从不回答「屏上现在是什么」：
// ①同桌面「退出→再点开」进度条照挂 1208ms，而屏上明明已经有本桌面这一窗（#951 预渲成果被浪费）；
// ②切桌面后 120ms 内点开：进度条浮在**上一个桌面**的 123 条气泡上 915ms（#489 清 msgs 不清 DOM）
//   ＝「闪一下」本体，拿别人的聊天记录当加载背景不是诚实反馈；
// ③内容画好后条再挂 ~1190ms 然后瞬间消失（无收场）。
// 修法（零机型分支，判据全是屏上凭据与既有标志）：A 显隐并入「屏上有没有本桌面这一窗」
// chatScreenHasOwnWindow()；B 真在加载且屏上不是本桌面的窗 → #page-chat.chat-loading-cover 把
// .chat-body 整块 visibility:hidden（保留滚动几何，不伤 #1039 首帧贴底）；C 收场走 160ms 淡出
// （.chat-loading-out）＋卡片内三行幽灵气泡占位。
// 断言（每场景全新存储、15× CPU 节流＝中低端真机等效慢速、种两桌面各 120 条纯文本）：
//  S 组 产物源锚（红侧必红）：S1 chat.js 的屏上凭据闸／S2 CSS 的遮罩规则
//  V3 组（主判别面）同桌面「进→退→再进」：E1 加载条可见 <300ms（红 1208ms）／E2 全程遮罩不挂
//     （屏上就是本桌面的窗，没有任何该遮的东西）／E3 屏上气泡数不塌（≥100，防把免提示做成强重建）
//  V2 组（#951 最佳情况补完）切桌面→等隐藏态预渲落定→点开：D0 夹具前提（点开前屏上已是新桌面）／
//     D1 加载条可见 <300ms（红 935ms＝预渲做了、条照样挂）／D2 不挂遮罩且气泡数不塌
//  V1 组（主判别面）切桌面后 120ms 就点开：F1 屏上仍是上一桌面内容且**未被遮罩遮住**的时长 <200ms
//     （红 915ms 裸暴露）／F2 遮罩确实在位过（>300ms，证机制真参与而非指标碰巧变好）／
//     F2b 内容画好后条会收场（8s 内 hidden）／
//     F3 收场有淡出窗口（「.chat-loading-out 已挂而 DOM 尚未撤」的帧 ≥1，红侧 hidden 瞬撤＝0）／
//     F4 最终屏上是新桌面且贴最新（既有契约）
//  VL 组（防修过头）新桌面账本 >8MB＝大历史未预读：G1 加载条仍可见 ≥400ms（屏上没有本桌面的窗＝
//     诚实反馈不许被 ownWin 关掉）／G2 「空列表且无条」的可见帧 ≤150ms
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1057-chat-loading-gate.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.env.SEED_N) || 120; // ≥RENDER_CHUNK_MIN(80) ⇒ 整窗重建走分帧路径
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9920 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1057-' + Date.now()),
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
  for (let i = 0; i < 30; i++) { if (await evalJs("typeof window.createContact === 'function' && typeof window.activeStore === 'function'")) break; await sleep(400); }
}
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
      ${lazyB ? `// 大包门控夹具：账本 b 报成 9MB（超 CHAT_LAZY_BYTES=8MB）→ 未预读→预渲一律不动作
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
async function clickChat() { return await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()"); }
async function exitChat() { return await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();return true;})()"); }
async function switchTo(cid) { return await evalJs(`(function(){try{window.setActiveContact(${JSON.stringify(cid)});return window.activePrefix();}catch(e){return 'ERR:'+e;}})()`); }
async function waitUntil(expr, maxMs, ivMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await evalJs(expr)) return true;
    await sleep(ivMs || 500);
  }
  return false;
}
// 逐帧时间线：条/遮罩/淡出透明度/屏上气泡数/属于哪个桌面/ownWin 凭据
const TL_SRC = `(function(){
  var body=document.getElementById('chat-body'), bar=document.getElementById('chat-loading'), pg=document.getElementById('page-chat');
  if(!body||!pg||!bar) return 'NO_CTX';
  var t0=performance.now(), last=t0;
  window.__tl=[];
  (function loop(){
    if(!window.__tl) return; // stopTl 之后自然收链（不停＝往 null 上 push，探针自己抛异常污染 Z1）
    var now=performance.now(), dt=now-last; last=now;
    var vis=!pg.hidden, kids=body.children.length;
    var txt=(vis && kids<400)?body.textContent:'';
    window.__tl.push({ t:Math.round(now-t0), dt:Math.round(dt), vis:vis?1:0, bar:(!bar.hidden)?1:0,
      op:Number(getComputedStyle(bar).opacity), kids:kids, cv:pg.classList.contains('chat-loading-cover')?1:0,
      oc:bar.classList.contains('chat-loading-out')?1:0,
      a:txt.indexOf('A 记录${String(N - 1).padStart(4, '0')}')>=0?1:0, b:txt.indexOf('B 记录${String(N - 1).padStart(4, '0')}')>=0?1:0 });
    if(window.__tl.length<8000) window.requestAnimationFrame(loop);
  })();
  return true;
})()`;
async function startTl() { for (let i = 0; i < 6; i++) { if (await evalJs(TL_SRC) === true) return true; await sleep(1000); } return false; }
async function stopTl() { return JSON.parse(await evalJs('(function(){var a=window.__tl||[];window.__tl=null;return JSON.stringify(a);})()') || '[]'); }
function metrics(tl) {
  const m = { barMs: 0, blankMs: 0, staleBareMs: 0, coverMs: 0, fadeFrames: 0, outFrames: 0, minKids: 1e9, visFrames: 0, barLast: -1, lastT: 0, minOp: 2 };
  for (const f of tl) {
    if (!f.vis) continue;
    m.visFrames++;
    m.lastT = f.t;
    if (f.bar) { m.barMs += f.dt; m.barLast = f.t; if (f.op < m.minOp) m.minOp = f.op; }
    if (f.bar && f.oc) m.outFrames++; // 淡出窗口（class 已挂、DOM 还没撤）落在采样里＝收场不是瞬撤
    if (f.kids < 10 && !f.bar) m.blankMs += f.dt;
    if (f.a && !f.b && !f.cv) m.staleBareMs += f.dt;
    if (f.cv) m.coverMs += f.dt;
    if (f.bar && f.op > 0 && f.op < 0.95) m.fadeFrames++;
    if (f.kids < m.minKids) m.minKids = f.kids;
  }
  m.barMs = Math.round(m.barMs); m.blankMs = Math.round(m.blankMs);
  m.staleBareMs = Math.round(m.staleBareMs); m.coverMs = Math.round(m.coverMs);
  return m;
}
const BAR_HIDDEN = "(function(){var b=document.getElementById('chat-loading');return !!b && b.hidden;})()";
async function screenNow() {
  const raw = await evalJs(`(function(){
    var b=document.getElementById('chat-body'), pg=document.getElementById('page-chat');
    var t=b.textContent||'';
    return JSON.stringify({ kids:b.children.length, hasA:t.indexOf('A 记录')>=0, hasB:t.indexOf('B 记录')>=0,
      tailNew:t.indexOf(${JSON.stringify('B 记录' + String(N - 1).padStart(4, '0'))})>=0,
      gap:Math.round(b.scrollHeight-b.scrollTop-b.clientHeight), vis:!pg.hidden });
  })()`);
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}
async function setupPainted(opts) { // 全新存储 → 种两桌面 → 重载稳定 → 在 A 桌面把聊天画过一次并退回桌面
  const cid = await resetAndSeed(opts);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await openPage();
  await clickChat(); await sleep(7000); await exitChat(); await sleep(1500);
  return cid;
}

// ---- S 组：产物源锚（红侧必红）----
let artChat = '', artCss = '';
try { artChat = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
try { artCss = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
check('S1 chat.js 有「屏上有没有本桌面这一窗」凭据闸（#1057a）', artChat.indexOf('const ownWin = chatScreenHasOwnWindow();') >= 0);
check('S2 CSS 有「加载中遮掉非本桌面残留」规则（#1057b）', artCss.indexOf('#page-chat.chat-loading-cover .chat-body') >= 0);
check('S3 CSS 淡出两端都在位（.chat-loading 的 opacity 过渡＋.chat-loading-out 目标态；缺任一＝收场仍是瞬撤）', artCss.indexOf('transition:opacity .16s ease;') >= 0 && artCss.indexOf('.chat-loading-out { opacity:0; }') >= 0);
check('S4 撤条前问一句「视口还有未解码图吗」（#1057e：本批不许削掉 #1010 的持有契约，缺了 verify-1010 B1 当场红）', artChat.indexOf('if (withdraw && flagsUp && chatMediaPendingCount() > 0)') >= 0);

// ---- V3：同桌面「进→退→再进」（主判别面：不该有加载画面）----
{
  await setupPainted();
  await startTl();
  await clickChat(); await sleep(6000);
  const m = metrics(await stopTl());
  check('E1 同桌面再进：加载条可见 <300ms（红＝屏上明明已有本桌面这一窗仍照挂 1208ms）', m.barMs < 300, 'bar ' + m.barMs + 'ms');
  check('E2 同桌面再进：遮罩全程不挂（屏上就是本桌面的窗，没有该遮的东西）', m.coverMs === 0, 'cover ' + m.coverMs + 'ms');
  check('E3 同桌面再进：屏上气泡数不塌（≥100，免提示不是靠强重建做到）', m.minKids >= 100, 'minKids ' + m.minKids);
}

// ---- V2：切桌面→等隐藏态预渲落定→再点开（#951 的最佳情况，本批要把它做到「零加载画面」）----
{
  const cid = await setupPainted();
  await switchTo(cid);
  const warmed = await waitUntil(`(function(){var b=document.getElementById('chat-body');return b.textContent.indexOf('B 记录${String(N - 1).padStart(4, '0')}')>=0;})()`, 20000, 400);
  await startTl();
  await clickChat(); await sleep(5000);
  const m = metrics(await stopTl());
  check('D0 夹具前提：预渲在点开之前就把新桌面画上了屏', warmed);
  check('D1 预渲落定后点开：加载条可见 <300ms（红 935ms＝#951 预渲做了、进度条却照样挂，白做一半）', m.barMs < 300, 'bar ' + m.barMs + 'ms');
  check('D2 预渲落定后点开：不挂遮罩、气泡数不塌（零重建零空窗）', m.coverMs === 0 && m.minKids >= 100, 'cover ' + m.coverMs + 'ms / minKids ' + m.minKids);
}

// ---- V1：切桌面后 120ms 就点开（真机最常见＝预渲来不及）----
{
  const cid = await setupPainted();
  await startTl();
  await switchTo(cid);
  await sleep(120);
  await clickChat();
  await waitUntil(`(function(){var b=document.getElementById('chat-body');return b.textContent.indexOf('B 记录${String(N - 1).padStart(4, '0')}')>=0;})()`, 20000, 400);
  const gone = await waitUntil(BAR_HIDDEN, 8000, 200); // 等条真收场（淡出帧要落在采样里）
  await sleep(400);
  const m = metrics(await stopTl());
  const now = await screenNow();
  check('F1 切换后点开：屏上仍是上一桌面内容且未被遮罩盖住的时长 <200ms（红 915ms 裸暴露＝「闪一下」本体）', m.staleBareMs < 200, 'staleBare ' + m.staleBareMs + 'ms');
  check('F2 遮罩确实在位过（>300ms＝机制真参与，不是指标碰巧变好）', m.coverMs > 300, 'cover ' + m.coverMs + 'ms');
  check('F2b 内容画好后加载条会收场（8s 内 hidden）', gone, 'barLast ' + m.barLast + 'ms / 采样末 ' + m.lastT + 'ms');
  check('F3 加载条收场走淡出（存在「.chat-loading-out 已挂、DOM 尚未撤」的帧；红侧 hidden 瞬撤＝0 帧）', m.outFrames >= 1, 'out ' + m.outFrames + ' 帧 / 采样到最低透明度 ' + m.minOp);
  check('F4 最终屏上是新桌面且贴最新（既有契约不回归）', !!now.tailNew && now.gap <= 4 && now.kids >= N - 10, JSON.stringify(now));
}

// ---- VL：大历史未预读（防修过头——诚实反馈不许被 ownWin 关掉）----
{
  const cid = await setupPainted({ lazyB: true });
  await startTl();
  await switchTo(cid);
  await sleep(120);
  await clickChat();
  await sleep(9000);
  const m = metrics(await stopTl());
  check('G1 屏上没有本桌面的窗时加载条照旧亮着（≥400ms，ownWin 不许把真加载也关掉）', m.barMs >= 400, 'bar ' + m.barMs + 'ms');
  check('G2 「空列表且无进度条」的可见帧 ≤150ms（不许出现无人看管的白屏）', m.blankMs <= 150, 'blank ' + m.blankMs + 'ms');
}

check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 2).join(' || '));
console.log(`\n产物根：${root}`);
console.log(`\n结果 ${pass} 通过 / ${fail} 失败（SEED_N=${N}、15× CPU 节流）`);
chrome.kill(); server.close(); process.exit(fail ? 1 : 0);
