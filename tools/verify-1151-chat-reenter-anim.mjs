// ===== 常驻回归：#1151「退出聊天回桌面 → 再进聊天，记录弹闪一下才恢复正常」（红米K80 Chrome 实报，多机型同现）=====
// 根因（与机型无关的通用 CSS 行为）：CSS 动画在元素 display:none → block 时**从头重播**，而切页面正是
//   整页 hidden 翻转。chat.js 的 appendMsg 给当场新增的消息节点挂上一次性入场动画类 .msg-enter 后
//   **永不摘除**，于是重进聊天那一瞬，屏上所有曾当场新增过的气泡集体重放淡入+上浮
//   （from{opacity:0;transform:translateY(8px)scale(.98)}）＝用户所见「弹闪一下然后恢复正常」。
//   无头实证（同负载两侧对照）：重进后可见帧里 msgInPop/msgOutPop/msgPopIn 由 finished 变回 running、
//   currentTime 归零；而 chat-body 节点数与 scrollTop 不变＝DOM 一字未动，所以历次针对「重渲链」的
//   修复与 MutationObserver 探针都测不到这一面。
// 修复：①动画播完（animationend，只看自身，子节点冒泡不算）立即摘掉 .msg-enter；
//       ②聊天页藏着时到达的消息不再挂入场类（用户没看着＝没有「入场」可言，否则攒成回场一帧集体弹）；
//       ③回场总闸（#1151c）：聊天页 hidden 翻回可见的同一任务内（微任务＝绘制之前）把窗口内正在重播的
//         一次性 CSS 动画直接 finish() 到终态——摘类治不到「挂在身份类上」的那一批（猜拳/小花/跳转高亮）。
// 断言（每场景全新存储；THROTTLE 缺省 6×＝中端安卓真机等效慢速）：
//   S 组 静态锚：S1 摘类接线／S2 可见闸／S3 回场总闸落终态（本批判别面，红侧必红）
//   B 组 防修过头（两侧同绿）：B1 页面可见时真发的消息**确实播放**入场动画（同一次 eval 内读，
//      防往返超时）／B3 摘类只发生在播完之后（300ms 时仍在播、1500ms 后停）＝不是把动画改成不出现
//   A 组 本批判别面（绿过红红）：A1 重进聊天后可见帧零「在跑的入场动画」／A2 重进后屏上不再残留
//      .msg-enter／A3 隐藏期到达的 5 条回场时不集体弹，且一条不丢／A5 合成一次性动画回场被落终态
//      （P4＝其前提：注入后确实在播；节点被整窗重建顶掉时 A5 直接报夹具失效）
//      另打一行信息：回场可见帧里窗口内在播的「非入场」动画名清单＝残留重播向量体检表
//   C 组 契约不回归（两侧同绿）：C1 重进期间零整窗清空、节点数不随重进变化（证明确实不是重渲面）／
//      C2 重进落定仍在最底（贴底语义不削）
//   Z1 全程零未捕获 JS 异常
// 用法：MOCHI_SERVE_ROOT=<副本目录> node tools/verify-1151-chat-reenter-anim.mjs
//       （缺省回退仓库根产物＝对照时会两版跑同一产物、对照全失真，做 A/B 务必显式传）。需 Node 21+。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED_N = Number(process.env.SEED_N) || 800;
const THROTTLE = Number(process.env.THROTTLE) || 6;
const FAM = ['msgPopIn', 'msgInPop', 'msgOutPop'];
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9861 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1151-' + Date.now()),
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
            jsExcepts.push(String((d && ((d.exception && d.exception.description) || d.text)) || 'err').split('\n').slice(0, 3).join(' | ').slice(0, 200));
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
    if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exception && r.exception.description) || r.text);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'EVAL_ERR:' + e; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 404, height: 783, deviceScaleFactor: 2.67, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

let pass = 0, fail = 0; const reds = [];
function check(desc, ok, detail) {
  if (ok) pass++; else { fail++; reds.push(desc); }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function settleOpen() {
  await sleep(4000);
  for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1200);
  await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var q=document.getElementById('qa-close');if(q)q.click();return 1;})()");
  await sleep(800);
  await ev("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var ok=document.getElementById('modal-ok');if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}var bar=document.getElementById('backup-remind-bar');if(bar)bar.remove();return 1;})()");
  await sleep(400);
  for (let i = 0; i < 30; i++) { if (await ev("typeof window.chatAddIn === 'function' && typeof window.activeStore === 'function'")) break; await sleep(400); }
}
// 全新存储 + 种子：SEED_N 条纯文本，关自动回复噪声（重进期间屏上条目数必须恒定，随机新消息会污染 C1）
async function resetAndSeed() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await settleOpen();
  const raw = await ev(`(async function(){
    try {
      var t0 = Date.now() - 86400000, a = [];
      for (var i = 0; i < ${SEED_N}; i++) a.push({ side: i % 2 ? 'in' : 'out', text: '记录' + String(i).padStart(4, '0'), ts: t0 + i * 60000 });
      localStorage.setItem('xy-home-v2:default:chat-msgs', JSON.stringify(a));
      await window.idbSet('xy-home-v2:default:chat-msgs', a);
      var st = window.activeStore();
      st.set('cs-rp-auto-prob', '0'); st.set('reply-rn-prob', '0');
      return 'ok';
    } catch (e) { return 'ERR:' + e; }
  })()`);
  if (raw !== 'ok') { console.error('种子失败: ' + raw); chrome.kill(); server.close(); process.exit(1); }
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await settleOpen();
}
const clickChat = () => ev("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()");
const exitChat = () => ev("(function(){var b=document.getElementById('chat-back');if(b)b.click();return !!b;})()");

// ---- S 组：源码静态锚 ----
const srcChat = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
const artChat = readFileSync(join(root, 'js', 'chat.js'), 'utf8');
check("S1 入场动画播完摘类接线在位（m.classList.remove('msg-enter')）",
  srcChat.includes("m.classList.remove('msg-enter');") && artChat.includes("m.classList.remove('msg-enter');"));
check('S2 入场动画只在聊天页可见时挂（!batchRendering && chatVisible() → enterMsgOnce；#1181a 在同一行尾部追加 !document.hidden 后台闸，锚随之换到该行前段——摘掉可见闸即红）',
  srcChat.includes('!batchRendering && chatVisible() && !document.hidden') && artChat.includes('!batchRendering && chatVisible() && !document.hidden'));
check('S3 回场动画总闸在位（回聊天页时把窗口内在重播的一次性 CSS 动画落终态）',
  srcChat.includes('try { a.finish(); n++; } catch (e) {}') && artChat.includes('try { a.finish(); n++; } catch (e) {}'));
console.log('  [环境] root=' + root + ' 产物含 #1151a=' + artChat.includes("m.classList.remove('msg-enter');") +
  ' SEED_N=' + SEED_N + ' THROTTLE=' + THROTTLE + 'x');

await resetAndSeed();
check('P0 前提：进入聊天页且窗口已铺满（节点数 ≥ 100）', await (async () => { await clickChat(); await sleep(3000); return (await ev("(function(){var b=document.getElementById('chat-body');return b?b.children.length:0;})()")) >= 100; })());

// ---- A5 前置：给窗口中段那条消息挂上「挂在身份节点上的一次性动画」合成探针 ----
// 摘类只能治 .msg-enter 这种纯动画类；真机上还有一类摘不得的（猜拳 rpsFadeIn、拍小花 flowerFloat、
// 跳转高亮 msg-flash——类一掉样式就丢）。这里用一个与它们同形态的一次性动画（linear 6s both、
// from{opacity:0}）来判「回场总闸」是否把它落到终态。只改 inline style、不动节点本身＝不触发整窗重建。
const inj = JSON.parse(await ev(`(function(){
  var b=document.getElementById('chat-body');
  if (!b || b.children.length < 10) return JSON.stringify({ err: '窗口太短' });
  if (!document.getElementById('t1151cStyle')) {
    var s = document.createElement('style'); s.id = 't1151cStyle';
    s.textContent = '@keyframes t1151cProbe{from{opacity:0}to{opacity:1}}';
    document.head.appendChild(s);
  }
  var el = b.children[Math.floor(b.children.length / 2)];
  el.setAttribute('data-t1151c', '1');
  el.style.animation = 't1151cProbe 6s linear both';
  var st = el.getAnimations ? el.getAnimations().map(function (a) { return a.animationName + ':' + a.playState; }) : [];
  return JSON.stringify({ st: st, op: Number(getComputedStyle(el).opacity) });
})()`) || '{}');
check('P4 前提：合成的一次性动画确实在播（否则总闸无从判别）',
  /t1151cProbe:(running|pending)/.test((inj.st || []).join(',')), JSON.stringify(inj));

// ---- B1：页面可见时真发的消息确实播放入场动画（同一次 eval 内追加＋读，防 CDP 往返超时）----
const b1 = JSON.parse(await ev(`(function(){
  window.chatAddIn('可见期真发的一条，用于确认入场动画没被改没。');
  var el = document.getElementById('chat-body').lastElementChild;
  var an = el && el.getAnimations ? el.getAnimations().map(function(a){ return a.animationName + ':' + a.playState; }).join(',') : '';
  var cs = el ? getComputedStyle(el) : null;
  return JSON.stringify({ cls: el ? el.className : '', anim: cs ? cs.animationName : '', run: an });
})()`) || '{}');
check('B1 可见期新发消息挂载即播入场动画（msg-enter + per-side 动画在跑）',
  /(^|\s)msg-enter(\s|$)/.test(b1.cls || '') && FAM.indexOf(b1.anim) >= 0 && /running|pending/.test(b1.run || ''), JSON.stringify(b1));
if (!/running|pending/.test(b1.run || '')) {
  console.log('[环境不满足] 入场动画根本没播放（reduced-motion 或合成被禁），本夹具无法判别，退出 2');
  chrome.kill(); server.close(); process.exit(2);
}
// ---- B3：摘类只发生在播完之后（300ms 仍在播＝没把动画改成「瞬间结束」）----
await sleep(300);
const b3 = JSON.parse(await ev("(function(){var n=document.querySelectorAll('#chat-body .msg-enter').length;return JSON.stringify({n:n});})()") || '{}');
check('B3 播完前（300ms）入场类仍在＝动画照常播放，不是「挂上就摘」的空壳', b3.n >= 1, JSON.stringify(b3));
await sleep(1600);
const b3b = JSON.parse(await ev("(function(){var n=document.querySelectorAll('#chat-body .msg-enter').length;return JSON.stringify({n:n});})()") || '{}');
check('B4 播完之后（≥1.5s）屏上不再残留 .msg-enter＝重播向量已归零', b3b.n === 0, JSON.stringify(b3b));

// ---- 探针：逐帧记录「可见期在跑的入场动画数 / .msg-enter 数 / 节点数 / 滚动」＋整窗清空记录 ----
const PROBE = `(function(){
  var body=document.getElementById('chat-body'), pg=document.getElementById('page-chat');
  if (!body || !pg) return 'NO_CTX';
  var t0 = performance.now();
  var FAMJS = ${JSON.stringify(FAM)};
  window.__p = { t0: t0, reenterT: 0, frames: [], clears: [], stopped: false };
  new MutationObserver(function(muts){
    var vis = !pg.hidden;
    for (var i = 0; i < muts.length; i++) {
      var rem = muts[i].removedNodes ? muts[i].removedNodes.length : 0;
      if (rem >= 10 && vis) window.__p.clears.push(Math.round(performance.now() - t0));
    }
  }).observe(body, { childList: true });
  (function loop(){
    if (window.__p.stopped) return;
    var run = 0, names = [];
    try {
      var all = document.getAnimations ? document.getAnimations() : [];
      for (var i = 0; i < all.length; i++) {
        var a = all[i], nm = a.animationName;
        if (typeof nm !== 'string') continue;
        var tg = a.effect && a.effect.target;
        var inBody = !!tg && (tg === body || body.contains(tg));
        var playing = a.playState === 'running' || a.playState === 'pending';
        if (FAMJS.indexOf(nm) < 0) { if (inBody && playing && names.indexOf(nm) < 0) names.push(nm); continue; }
        if (playing) run++;
      }
    } catch (e) {}
    window.__p.frames.push({
      t: Math.round(performance.now() - t0), vis: !pg.hidden, run: run, names: names,
      enter: body.querySelectorAll('.msg-enter').length, kids: body.children.length,
      st: Math.round(body.scrollTop), sh: body.scrollHeight, ch: body.clientHeight
    });
    window.requestAnimationFrame(loop);
  })();
  return true;
})()`;
const probeOn = async () => { for (let i = 0; i < 8; i++) { if (await ev(PROBE) === true) return true; await sleep(800); } return false; };
check('P1 探针挂载成功', await probeOn() === true);

// ---- A3 前置：切回桌面（聊天页隐藏），隐藏期到达 5 条 ----
await exitChat();
await sleep(1500);
const hid = JSON.parse(await ev(`(function(){
  var ok = 0;
  for (var i = 0; i < 5; i++) { window.chatAddIn('隐藏期到达的第' + i + '条。'); ok++; }
  var pg = document.getElementById('page-chat');
  return JSON.stringify({ ok: ok, hidden: !!pg.hidden });
})()`) || '{}');
check('P2 前提：聊天页确已隐藏（整页 hidden 翻转＝重播发生的必要条件）', hid.hidden === true && hid.ok === 5, JSON.stringify(hid));
await sleep(1500);
// ---- 重进聊天：判别窗（同一 eval 内点击＋打时间戳，探针据此把「回场之后」的帧切出来）----
await ev("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();if(window.__p)window.__p.reenterT=Math.round(performance.now()-window.__p.t0);return 1;})()");
await sleep(3500);
const p1 = JSON.parse(await ev("(function(){return JSON.stringify({frames: window.__p.frames, clears: window.__p.clears, reenterT: window.__p.reenterT});})()") || '{}');
const vis1 = (p1.frames || []).filter(f => f.vis);
const back = vis1.filter(f => f.t >= (p1.reenterT || 0));
const maxRun = back.reduce((m, f) => Math.max(m, f.run), 0);
const maxEnter = back.reduce((m, f) => Math.max(m, f.enter), 0);
check('A1 重进聊天后可见帧里「在跑的消息入场动画」恒为 0（红侧＝屏上残留 .msg-enter 集体重播）', maxRun === 0 && back.length > 5, 'maxRun=' + maxRun + '/回场帧' + back.length + '/总可见帧' + vis1.length);
check('A2 重进聊天后屏上不再残留 .msg-enter（红侧＝隐藏期新增的 5 条＋可见期那几条全带着类）', maxEnter === 0, 'maxEnter=' + maxEnter);
const a3 = JSON.parse(await ev(`(function(){
  var body = document.getElementById('chat-body'), found = 0;
  for (var i = 0; i < 5; i++) {
    var hit = false;
    for (var k = 0; k < body.children.length; k++) {
      if ((body.children[k].textContent || '').indexOf('隐藏期到达的第' + i + '条') >= 0) { hit = true; break; }
    }
    if (hit) found++;
  }
  return JSON.stringify({ found: found });
})()`) || '{}');
check('A3 隐藏期到达的 5 条回场后一条不丢（不挂入场类不等于不画）', a3.found === 5, JSON.stringify(a3));
const lastVis = vis1[vis1.length - 1] || {};
check('C1 重进期间零整窗清空（无 removedNodes≥10 记录）＝这一面本来就不是重渲，别拿重渲链修它',
  (p1.clears || []).length === 0, JSON.stringify((p1.clears || []).slice(0, 4)));
check('C2 重进落定仍在最底（贴底语义不削）', lastVis.sh - lastVis.st - lastVis.ch <= 2, JSON.stringify(lastVis));
const hasHidden = (p1.frames || []).some(f => !f.vis);
check('C3 夹具期间确实经历「隐藏 → 可见」（否则 A1/A2 无从判别）', hasHidden === true, '总帧=' + (p1.frames || []).length + ' 可见帧=' + vis1.length);

// ---- A5：回场总闸判别面（回场那一帧在绘制之前把重播的一次性动画落到终态）----
const a5 = JSON.parse(await ev(`(function(){
  var el = document.querySelector('#chat-body [data-t1151c]');
  if (!el) return JSON.stringify({ gone: true });
  var st = el.getAnimations ? el.getAnimations().map(function (a) { return a.animationName + ':' + a.playState + ':' + Math.round(a.currentTime || 0); }) : [];
  return JSON.stringify({ st: st, op: Number(getComputedStyle(el).opacity) });
})()`) || '{}');
if (a5.gone) {
  check('A5 回场时重播的一次性动画被落终态', false, '探针节点已不在窗口内（重进走了整窗重建＝夹具前提破了，请查 renderWindow/inplacePatch）');
} else {
  const a5Done = (a5.st || []).filter(s => /^t1151cProbe:/.test(s));
  check('A5 回场时重播的一次性动画被落终态（红侧＝t1151cProbe 由 finished 变回 running、currentTime 归零、opacity≈0＝那一行先透明再出现＝报障第二形态）',
    a5Done.length > 0 && a5Done.every(s => /:finished:/.test(s)) && a5.op > 0.9, JSON.stringify(a5));
}
// 探针清理：不留下额外的重播向量，后面二次往返只测产品自身形态
await ev("(function(){var el=document.querySelector('#chat-body [data-t1151c]');if(el){el.style.animation='';el.removeAttribute('data-t1151c');}var s=document.getElementById('t1151cStyle');if(s)s.remove();return 1;})()");
// 信息面：回场可见帧里聊天窗口内还在播的「非入场」动画名清单（残留重播向量的体检表，红绿两侧都打印）
const otherNames = Array.from(new Set([].concat.apply([], back.map(f => f.names || []))));
console.log('  [信息] 回场可见帧里窗口内在播的其它动画名：' + (otherNames.length ? otherNames.join(', ') : '（无）') +
  ' ／ 入场族峰值 run=' + maxRun + '、.msg-enter 峰值=' + maxEnter);

// ---- 二次往返：连续「退桌面 ↔ 进聊天」同样不该再弹（摘类是永久性的，不是只治第一次）----
await exitChat(); await sleep(1200);
await ev("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();if(window.__p)window.__p.reenterT2=Math.round(performance.now()-window.__p.t0);return 1;})()");
await sleep(2500);
const p2 = JSON.parse(await ev("(function(){window.__p.stopped=true;return JSON.stringify({frames:window.__p.frames,reenterT2:window.__p.reenterT2});})()") || '{}');
const back2 = (p2.frames || []).filter(f => f.vis && f.t >= (p2.reenterT2 || 0));
const maxRun2 = back2.reduce((m, f) => Math.max(m, f.run), 0);
const maxEnter2 = back2.reduce((m, f) => Math.max(m, f.enter), 0);
check('A4 第二次往返同样零弹闪', maxRun2 === 0 && maxEnter2 === 0 && back2.length > 5, 'maxRun=' + maxRun2 + '/maxEnter=' + maxEnter2 + '/帧' + back2.length);

const errs = await ev('JSON.stringify((window.__jsErrors || []).slice(0, 3))');
check('Z1 全程零未捕获 JS 异常', !errs || errs === '[]' || errs === 'null', errs);
console.log('\n==== ' + (fail ? fail + ' FAILED / ' : 'ALL PASS ') + (pass + fail) + ' checks (root=' + root + ') ====');
if (fail) console.log('红项：\n  ' + reds.join('\n  '));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
