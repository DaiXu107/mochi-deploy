// ===== 常驻回归：#1441 聊天页「退出→回桌面→再进来」来回切换，数据总是重新加载并闪屏 =====
// 需求（作者直派「为什么退出聊天页面回到桌面，再重桌面回到聊天页面，来回切换，聊天页面的数据总是
// 会重新加载并闪屏」，红米 K80 Chrome；并点名「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现，
// 这个问题其他设备型号也有出现」；追问屏上形态＝顶上出现加载进度条／整屏背景或颜色闪一下，数据面＝
// 有配图语音＋历史很大＋开过美化）。
// 根因（判据零机型／零 UA 分支）：enterChat 每次进场都把「起不起权威重读」交给
// IDB_RELOAD_MIN_GAP(8s) 时间闸——「在桌面待够 8 秒」被当成「库里可能比内存新」的证据。可页内切页
// 根本没有外部写入面：桌面期 TA 的新消息本来就进 msgs；真后台回场有 #967／#1067／#1294 三条各自挂
// forceIdb 的路；切联系人与大历史未预读会把 authLoadedPrefix 归位。于是每次回来都白起一轮读库
// （本机实测：停 12 秒再进＝4 发 idbGet），读库期 chatAuthPending＝屏上那条进度条，读完的合并收尾
// 还可能再画一遍＝「数据重新加载＋闪」。
// 修法：进场这一发起读改由两条现成事实支配——① 本命名空间权威从未落定（authLoadedPrefix 不匹配＝
// 冷启动／切联系人／大历史懒读那一路，照旧真读、照旧进度条，#951「未预读就是诚实反馈」一字不动）；
// ② 跨桌面中转箱有货（#1200，同步可读的 LS 小键＝别处上下文写过的直接证据）。都不成立＝不读。
// 断言（每场景全新存储；6× CPU 节流＝中低端真机等效慢速）：
//  S 组＝产物源锚（红侧必红）：S1 判据两枚证据都在／S2 进场段恰两发起读且各带守卫（不再有裸的无条件那一发）
//  A 组＝本批缺陷面（绿过红红）：A1 同桌面·权威已落定·停留超 8s 后进场＝chat 侧零 idbGet／
//      A2 连续 3 趟来回切换全程零 idbGet／A3 再进场既没整窗重建、屏上那一条也逐字没变／
//      A4 再进场全程进度条零可见帧且遮罩零帧（「闪一下」的直接观感）
//  B 组＝防修过头，钉住「该读的照旧读」：B1 判据①②那一支源码仍在／B2 切联系人后进聊天当窗照旧真读
//      （本命名空间权威未落定＝行为面直证）／B3 中转箱有货时进场照旧真读并把那条并进屏上、箱排空／
//      B4 别的同源文档写过这一桌（storage 那一发）＝下一趟照旧真读，B4b 且这发证据被消费掉、不重复起读
//  C 组＝既有契约不回归（两侧同过）：C1 落定仍贴底／C2 全程零未捕获 JS 异常
// 用法：node tools/verify-1441-enter-evidence-read.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = Number(process.env.SEED_N) || 120;        // ≥RENDER_CHUNK_MIN(80) ⇒ 需要重建时走分帧那一路
const DWELL = Number(process.env.DWELL) || 12000;   // 桌面停留：必须跨过 IDB_RELOAD_MIN_GAP(8000)
const ROUNDS = Number(process.env.ROUNDS) || 3;
const THROTTLE = Number(process.env.THROTTLE) || 6;
const WINDOW_MS = 3000;                             // 一次进场的测量窗

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft Edge\\Application\\msedge.exe',
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9870 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1441-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
// 页面一启动就包 window.idbGet 计数：开屏期 chatPrefetchIfLight 那一发、以及切联系人当口的预读
// 都发生在「我装 DOM 观察器」之前，晚装一秒就会把诚实加载面的读数漏成 0（实测把 B2 误判成红）。
// idbGet 由 idb.js 在启动中段才挂上，故这里轮询到它出现为止（轮询只在自己文档里跑，导航即失效）。
const READ_HOOK = `(function(){
  window.__p1441Reads = window.__p1441Reads || [];
  var tries = 0;
  (function wrap(){
    if (++tries > 400) return;
    if (typeof window.idbGet === 'function' && !window.__p1441Wrapped) {
      var g = window.idbGet;
      window.idbGet = function (k) {
        try { if (/chat-msgs|chat-blk|chat-meta|chat-desk-inbox|chat-tail|chat-log/.test(String(k))) window.__p1441Reads.push({ t: Date.now(), k: String(k).replace('xy-home-v2:', '') }); } catch (e) {}
        return g.apply(this, arguments);
      };
      window.__p1441Wrapped = 1;
      return;
    }
    setTimeout(wrap, 30);
  })();
  return 'READ_HOOK';
})()`;
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
            jsExcepts.push(String((d && ((d.exception && d.exception.description) || d.text)) || 'err').split('\n').slice(0, 2).join(' | ').slice(0, 180));
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
async function ev(expr, awaitPromise) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'EVAL_ERR:' + e; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: READ_HOOK });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

let pass = 0, fail = 0; const reds = [];
function check(desc, ok, detail) {
  if (ok) pass++; else { fail++; reds.push(desc); }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function openPage(waitReady) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  for (let i = 0; i < 80; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1200);
  // 开屏与常驻引导弹层一律先摘掉（否则测量窗里混进别人的写入与遮罩）
  await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(800);
  for (let i = 0; i < 30; i++) { if (await ev("typeof window.createContact === 'function' && typeof window.activeStore === 'function'")) break; await sleep(400); }
  if (waitReady !== false) await sleep(1200);
}
// 全新存储 + 种两个桌面各 N 条文本记录（第二桌面给 B2 用）
async function freshSeed() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await openPage();
  const raw = await ev(`(async function(){
    try {
      var t0 = Date.now() - ${N} * 60000;
      function arr(tag, n){ var a=[]; for (var i=0;i<n;i++) a.push({ side: i%2?'in':'out', text: tag+'记录'+String(i).padStart(4,'0'), ts: t0+i*60000 }); return a; }
      var cid = window.createContact('第二桌面');
      var pk = 'xy-home-v2:' + cid;
      var a = arr('A', ${N}), b = arr('B', ${N});
      await window.idbSet('xy-home-v2:default:chat-msgs', a);
      localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(a));
      await window.idbSet(pk + ':chat-msgs', b);
      localStorage.setItem(pk + ':chat-msgs', JSON.stringify(b));
      window.activeStore().set('cs-rp-auto-prob', '0');
      window.xyStore(pk).set('cs-rp-auto-prob', '0');
      return JSON.stringify({ cid: cid, ok: true });
    } catch (e) { return 'ERR:' + e; }
  })()`, true);
  let j = null; try { j = JSON.parse(raw || '{}'); } catch (e) {}
  if (!j || !j.cid) { console.error('种子失败: ' + raw); chrome.kill(); server.close(); process.exit(1); }
  await sleep(400);
  return j.cid;
}
// 装表：① 数「chat 侧真起了几发读库」② 数整窗重建 ③ 逐帧看进度条/遮罩/屏上气泡 ④ 记末条文本
const HOOK = `(function(){
  var body=document.getElementById('chat-body'), bar=document.getElementById('chat-loading'), pg=document.getElementById('page-chat');
  if (!body || !pg || !bar) return 'NO_CTX';
  window.__p = { rebuilds: [], frames: [], clears: [], swaps: [], stopped: false };
  new MutationObserver(function (muts) {
    var vis = !pg.hidden;
    for (var i = 0; i < muts.length; i++) {
      var rem = muts[i].removedNodes ? muts[i].removedNodes.length : 0;
      var add = muts[i].addedNodes ? muts[i].addedNodes.length : 0;
      if (vis && rem >= 10) window.__p.clears.push({ t: Date.now(), rem: rem });
      if (vis && add >= 10) window.__p.swaps.push({ t: Date.now(), add: add });
    }
  }).observe(body, { childList: true });
  (function tick(){
    requestAnimationFrame(function(){
      if (!document.hidden && !window.__p.stopped) {
        var last = body.lastElementChild;
        window.__p.frames.push({
          t: Date.now(), vis: !pg.hidden, kids: body.children.length,
          bar: !bar.hidden, cover: pg.classList.contains('chat-loading-cover'),
          tail: last ? String(last.textContent || '').slice(0, 24) : ''
        });
        if (window.__p.frames.length > 9000) window.__p.frames.shift();
      }
      tick();
    });
  })();
  return 'ARMED';
})()`;
async function arm() { return await ev(HOOK); }
// nsNeedle＝只数「这一桌自己」的读库（进场判据管的是本命名空间）；别人家的键单独列出来，
// 免得把外人（跨桌面预取/统计）的读数误算成本批没修干净，也免得反过来把它藏掉。
async function windowStat(from, to, nsNeedle) {
  const RAW_EXPR = `JSON.stringify({ reads: window.__p1441Reads || [], frames: (window.__p && window.__p.frames) || [], clears: (window.__p && window.__p.clears) || [], swaps: (window.__p && window.__p.swaps) || [], phase: (window.__mochiPhaseLog || []).filter(function (x) { return /chat-renderWindow/.test(String(x.tag)); }).map(function (x) { return x.t; }) })`;
  // 读数取不回＝这一趟的判据全空，绝不拿「零」顶上去（零会假绿：reads=0 看着像修好了）。
  // 先重装表重试三次（读数通道断多半是自己那张观察器的表随页面态没了），仍不成就把原文喊出来。
  let d = null, raw = null;
  for (let tryN = 0; tryN < 3; tryN++) {
    raw = await ev(RAW_EXPR);
    try { d = JSON.parse(raw || '{}'); } catch (e) { d = null; }
    if (d && Array.isArray(d.frames) && d.frames.length) break;
    d = null;
    await arm();
    await sleep(400);
  }
  if (!d) {
    console.log('  ⚠ 读数三次仍失败（本趟判据作废，绝不拿零顶替＝零会假绿）: ' + String(raw).slice(0, 140));
    // 一律给「不可满足」的负值：所有 === 0 / >= 1 的判据据此落红，不会静默通过
    return { dead: true, reads: -1, readKeys: [], foreignReads: -1, rebuilds: -1, clears: -1, blankFrames: -1,
      coverFrames: -1, barFrames: -1, barMs: -1, jumps: -1, firstTail: 'DEAD', lastTail: 'DEAD',
      kidsFirst: -1, kidsLast: -1, atBottom: null };
  }
  const fr = (d.frames || []).filter((f) => f.t >= from && f.t <= to && f.vis);
  const inWin = (arr) => (arr || []).filter((x) => (typeof x === 'number' ? x : x.t) >= from && (typeof x === 'number' ? x : x.t) <= to);
  const keysIn = (arr) => Array.from(new Set(inWin(arr).map((x) => x.k || '?')));
  const ms = (arr) => arr.length ? (arr[arr.length - 1].t - arr[0].t + 16) : 0;
  return {
    reads: inWin(d.reads).filter((x) => String(x.k || '').indexOf(nsNeedle || 'default:') === 0).length,
    readKeys: Array.from(new Set(inWin(d.reads).map((x) => x.k || '?'))),
    foreignReads: inWin(d.reads).filter((x) => String(x.k || '').indexOf(nsNeedle || 'default:') !== 0).length,
    rebuilds: Math.max(inWin(d.swaps).length, inWin(d.phase).length),
    clears: inWin(d.clears).length,
    barFrames: fr.filter((f) => f.bar).length, barMs: ms(fr.filter((f) => f.bar)),
    coverFrames: fr.filter((f) => f.cover).length,
    blankFrames: fr.filter((f) => f.kids < 10).length,
    firstTail: (fr[0] || {}).tail || '', lastTail: (fr[fr.length - 1] || {}).tail || '',
    kidsFirst: (fr[0] || {}).kids || 0, kidsLast: (fr[fr.length - 1] || {}).kids || 0,
    atBottom: await ev('(function(){var b=document.getElementById("chat-body");return b?Math.abs(b.scrollHeight-b.scrollTop-b.clientHeight)<=2:null;})()')
  };
}
async function clickChat() { return await ev("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()"); }
async function exitChat() { return await ev("(function(){var b=document.getElementById('chat-back');if(b)b.click();return !!b;})()"); }
async function goDesk() { return await ev("(function(){var p=document.getElementById('page-phone');document.querySelectorAll('.page').forEach(function(x){if(!x.hidden)x.hidden=true;});if(p)p.hidden=false;return !!p;})()"); }

// ---------- S 组：产物源锚（读产物源码，不读工作树） ----------
// 锚点取「进场第二段」那一处调用（chatEnterPaintThen(function () { ... }），从这里往后 5000 字符
// 就是重活整段——比从函数定义处切更准，也不会把相邻函数的读数混进来。
let segA = '';
{
  const src = (() => { try { return readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) { return ''; } })();
  const at = src.indexOf('chatEnterPaintThen(function () {');
  segA = at < 0 ? '' : src.slice(at, at + 5000);
  const calls = (segA.match(/loadMsgs\(\);/g) || []).length;
  const ev1 = /csAuthHere = authLoadedPrefix === window\.activePrefix\(\) && msgs\.length > 0 && !chatXtxWriteSeen;/.test(segA);
  const ev2 = /chat-desk-inbox/.test(segA);
  const ev3 = /chatXtxWriteSeen = true;/.test(src);
  const g1 = /if \(!csAuthHere\) \{ chatXtxWriteSeen = false; loadMsgs\(\); \}/.test(segA);
  const g2 = /if \(csInboxHas\) loadMsgs\(\);/.test(segA);
  check('S1 产物锚：判据四枚证据都在（权威落定／内存有这一桌／外部上下文没写过／中转箱空）', ev1 && ev2 && ev3, JSON.stringify({ crit: ev1, inbox: ev2, storage: ev3 }));
  check('S2 产物锚：进场段里的起读只从这两支配出去（恰两发且各带守卫；退回裸的一发＝时间闸又在替用户决定读不读）', g1 && g2 && calls === 2, JSON.stringify({ g1: g1, g2: g2, calls: calls }));
}

// ---------- A 组：本批缺陷面（同桌面·权威已落定·停留超 8s） ----------
{
  await freshSeed();
  await openPage();
  await arm();
  // 第一趟：冷进聊天（权威未达＝必须真读，这条留给 B 组口径核对），落定后再做「停留→再进」
  await clickChat(); await sleep(4000); await exitChat();
  const cold = await windowStat(0, Date.now(), 'default:');
  check('A0 夹具前提：这一桌的权威在进场之前真读过（开屏预读或第一趟，累计≥1）、屏上已有 A 桌面这一窗', cold.reads >= 1 && cold.blankFrames === 0 && cold.kidsLast >= N - 5, JSON.stringify({ reads: cold.reads, blank: cold.blankFrames, kids: cold.kidsLast }));
  const tails = [];
  let totalReads = 0, worstBar = 0, worstCover = 0, worstRebuild = 0, worstBlank = 0;
  for (let r = 1; r <= ROUNDS; r++) {
    await exitChat();
    await sleep(DWELL);
    const t0 = Date.now();
    await clickChat();
    await sleep(WINDOW_MS);
    const st = await windowStat(t0, Date.now(), 'default:');
    totalReads += st.reads; worstBar = Math.max(worstBar, st.barMs); worstCover = Math.max(worstCover, st.coverFrames);
    worstRebuild = Math.max(worstRebuild, st.rebuilds); worstBlank = Math.max(worstBlank, st.blankFrames);
    tails.push(st);
    if (r === 1) {
      check('A1 同桌面·停留 ' + DWELL + 'ms（超 8s 时间闸）后再进场：本桌 chat 侧零 idbGet＝不再「重新加载」', st.reads === 0, JSON.stringify({ reads: st.reads, foreign: st.foreignReads, keys: st.readKeys, bar: st.barMs }));
      check('A3 同一趟：既没有整窗重建，也没有可见空窗／一记整窗清空', st.rebuilds === 0 && st.blankFrames === 0 && st.clears === 0, JSON.stringify({ rebuilds: st.rebuilds, blank: st.blankFrames, clears: st.clears }));
      check('A4 同一趟：进度条与遮罩全程零帧（顶上那条不再闪一下）', st.barMs === 0 && st.coverFrames === 0, JSON.stringify({ barMs: st.barMs, barF: st.barFrames, coverF: st.coverFrames }));
    }
    await exitChat();
  }
  check('A2 连续 ' + ROUNDS + ' 趟「退出→停 ' + DWELL + 'ms→再进」本桌全程零 idbGet', totalReads === 0, JSON.stringify({ total: totalReads, foreign: tails.reduce((a, st) => a + st.foreignReads, 0), keys: Array.from(new Set([].concat.apply([], tails.map((st) => st.readKeys || [])))) }));
  check('A5 ' + ROUNDS + ' 趟里最坏值：重建/空窗/遮罩/进度条全为 0', worstRebuild === 0 && worstBlank === 0 && worstCover === 0 && worstBar === 0, JSON.stringify({ rebuild: worstRebuild, blank: worstBlank, cover: worstCover, barMs: worstBar }));
  // 「数据没被换一遍」＝屏上这一段只可能长气泡、绝不整屏摘掉，且种进去的记录一条没丢。
  // （不比末条文本：TA 在桌面期本来就会自己冒新消息，那属正常增量，不是重新加载。）
  const stillThere = await ev("(function(){var b=document.getElementById('chat-body');if(!b)return false;var t=String(b.textContent);return t.indexOf('A记录0000')>=0||t.indexOf('A记录0119')>=0;})()");
  const onlyGrow = tails.every((st) => st.kidsLast >= st.kidsFirst && st.clears === 0);
  check('A6 每趟屏上条数只增不减、全程零整屏摘除（数据没被换一遍）', onlyGrow === true, JSON.stringify(tails.map((st) => st.kidsFirst + '->' + st.kidsLast)));
  check('A7 三趟之后种进去的记录仍在屏上（没被读库覆盖成半截）', stillThere === true, JSON.stringify({ stillThere: stillThere }));
  const allKeys = Array.from(new Set([].concat.apply([], tails.map((st) => st.readKeys || []))));
  check('A1b 三趟里若仍有读库，必须点得出是谁读的（键名清单）', true, JSON.stringify(allKeys));
}

// ---------- B 组：防修过头——该读的照旧要读 ----------
{
  // B1 判据①②的行为面由 B2/A 组守（切联系人＝本命名空间权威未落定，进场当窗必须真读）；
  // 这里只钉源码级形态：那一支必须还在带守卫地起读，不能被将来的「一律不读」简化掉。
  const rawReadBranch = /if \(!csAuthHere\) \{ chatXtxWriteSeen = false; loadMsgs\(\); \}/.test(segA);
  check('B1 判据①②这一支仍在：权威未落定或内存空＝照旧直接起读（不许被将来的「一律不读」简化掉）', rawReadBranch === true);
}
{
  // B2 切联系人：authLoadedPrefix 归位 → 进聊天照旧真读
  const cid = await freshSeed();
  await openPage();
  await arm();
  await clickChat(); await sleep(4000); // 先把 default 这一桌的权威拿到
  await exitChat();
  const t2 = Date.now(); // 切换当口 chatPrefetchIfLight 就把新桌面的权威预读进内存了——窗口必须从这一枪起算
  const sw = await ev(`(function(){try{window.setActiveContact(${JSON.stringify(cid)});return String(window.activePrefix());}catch(e){return 'ERR:'+e;}})()`);
  await sleep(3000);
  await goDesk();
  await clickChat();
  await sleep(3500);
  const st = await windowStat(t2, Date.now(), cid + ':');
  check('B2 切到第二桌面后进聊天照旧真读（判据①：本命名空间权威未落定）', String(sw) !== 'NONE' && st.reads >= 1, JSON.stringify({ sw: sw, reads: st.reads }));
  check('B2b 切过去屏上画的是第二桌面的整窗记录（不是白屏也不是上一桌的）', st.kidsLast >= N - 5 && String(st.lastTail).indexOf('B记录') >= 0, JSON.stringify({ kids: st.kidsLast, tail: st.lastTail }));
}
{
  // B4 判据③：别的同源文档写了这一桌的聊天（storage 事件是浏览器直接推给我们的读数，不轮询不定时）
  await freshSeed();
  await openPage();
  await arm();
  await clickChat(); await sleep(4500); await exitChat();
  await sleep(DWELL);
  let t4 = Date.now();
  await ev("(function(){window.dispatchEvent(new StorageEvent('storage',{key:'xy-home-v2:default:chat-msgs'}));return 1;})()");
  await clickChat(); await sleep(3000);
  const s4 = await windowStat(t4, Date.now(), 'default:');
  await exitChat(); await sleep(1500);
  t4 = Date.now();
  await clickChat(); await sleep(3000);
  const s5 = await windowStat(t4, Date.now(), 'default:');
  check('B4 外部上下文写过（storage 那一发）＝下一趟照旧真读（判据③不许被「一律不读」吃掉）', s4.reads >= 1, JSON.stringify({ reads: s4.reads }));
  check('B4b 这一发证据被消费掉：再往后一趟不因为它重复起读', s5.reads === 0, JSON.stringify({ reads: s5.reads, seen: await ev('String(window.chatXtxWriteSeenForDebug?window.chatXtxWriteSeenForDebug():null)') }));
}
{
  // B3 跨桌面中转箱有货：判据②——不读就永远排不空，这条必须照旧起读并把记录并进屏上
  await freshSeed();
  await openPage();
  await arm();
  await clickChat(); await sleep(4500); await exitChat();
  const INBOX = { side: 'in', text: '中转箱补发的一条记录', ts: Date.now() };
  await ev(`(function(){ localStorage.setItem('xy-home-v2:default:chat-desk-inbox', JSON.stringify(${JSON.stringify([INBOX])})); return true; })()`);
  await sleep(DWELL);
  const t3 = Date.now();
  await clickChat();
  await sleep(3500);
  const st = await windowStat(t3, Date.now(), 'default:');
  const boxEmpty = await ev("(function(){return localStorage.getItem('xy-home-v2:default:chat-desk-inbox')===null;})()");
  // 有界轮询而不是固定睡眠：中转箱的回填发生在「权威落定」那一段，读库链在 6× 节流下可达数秒，
  // 拿固定窗判＝计时边缘假红（同一把尺子在两侧都红过一次的实录）。两趟之内必须上屏。
  const SEEK = "(function(){var b=document.getElementById('chat-body');return b&&String(b.textContent).indexOf('中转箱补发的一条记录')>=0;})()";
  let seen = false;
  for (let k = 0; k < 24 && seen !== true; k++) { seen = await ev(SEEK); if (seen !== true) await sleep(500); }
  if (seen !== true) { await exitChat(); await sleep(1500); await clickChat(); for (let k = 0; k < 24 && seen !== true; k++) { seen = await ev(SEEK); if (seen !== true) await sleep(500); } }
  check('B3 中转箱有货时进场照旧真读（判据②：外部上下文写过的直接证据）', st.reads >= 1, JSON.stringify({ reads: st.reads }));
  check('B3b 那条最终被并进屏上且箱已排空（两趟＋有界轮询之内）', seen === true && boxEmpty === true, JSON.stringify({ seen: seen, boxEmpty: boxEmpty }));
}

// ---------- C 组：既有契约不回归 ----------
{
  await freshSeed();
  await openPage();
  await arm();
  await clickChat(); await sleep(4000);
  await exitChat(); await sleep(DWELL);
  await clickChat(); await sleep(2500);
  const st = await windowStat(Date.now() - 2600, Date.now(), 'default:');
  check('C1 再进场落定仍贴底（贴底语义不削）', st.atBottom === true, JSON.stringify({ atBottom: st.atBottom }));
  check('C2 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' | '));
}

console.log('合计 通过 ' + pass + ' / 失败 ' + fail + (reds.length ? '  红名: ' + reds.join('；') : ''));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
