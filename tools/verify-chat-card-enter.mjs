// ===== 回归验证：#878「聊天里发送的礼物卡片没有任何动画缓冲突然出现很突兀；互动卡片同病」（用户直派，零机型分支） =====
// 根因：renderMsg 在建节点时加 msg-enter 入场动画类，但礼物/互动卡/文本等所有分支随后都以
//   m.className = 'msg-gift'/'msg-ask'/'msg …' 整体覆盖 className＝类在挂载前被抹掉，动画从未触发。
// 修复：类的补加挪到 appendMsg 挂载前（恒在各分支覆盖之后），batchRendering 闸口径不变。
// 断言：
//   S1 静态锚：appendMsg 函数体内、appendChild 之前必补入场动画（#1151 换锚，见下方注释）
//   S2 全文件 classList.add('msg-enter') 恰一处（建节点处旧死代码已除，防两处并存假象）
//   B1 礼物卡：新挂载的 .msg-gift 带 msg-enter 且 computed animation-name = msgPopIn
//   B2 互动卡（ask 提问卡）：.msg-ask 同上
//   B3 文本消息：.msg-in/.msg-out 带 msg-enter 且吃到 per-side 动画（msgInPop/msgOutPop）
//   B4 批量渲染不复活：刷新后历史窗口内所有节点都无 msg-enter、无 running 动画
//   Z1 全程零 JS 异常
// 用法：node tools/verify-chat-card-enter.mjs（默认对仓库根产物；MOCHI_SERVE_ROOT=<目录> 指向
//       红/绿副本产物做对照——注意必须用 env 传，别指望位置参数）。需 Node 21+ 与本机 Chrome/Edge。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
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

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- S 组：静态锚（对 src/js/chat.js） ----
const src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
// #1151 换锚：原写法把「补类＋挂载」钉成同一行，而 #972 起 appendMsg 就是多行体——此后两侧恒红＝哑锚。
// 改认逻辑本体：从 appendMsg 头部到「第一次真正挂进聊天窗口」之间＝挂载前那段，必须有入场动画的补类动作
// （直挂类，或走 #1151 的 enterMsgOnce 包装，都算——被改回在建节点处挂类才是本脚本要拦的）。
const amStart = src.indexOf('function appendMsg(m) {');
const amPre = amStart < 0 ? '' : src.slice(amStart, amStart + 1200);
const amMount = amPre.indexOf('.appendChild(m);');
const amAttach = ["m.classList.add('msg-enter')", 'enterMsgOnce(m)'].map((k) => amPre.indexOf(k)).filter((i) => i >= 0);
check('S1 appendMsg 在挂载前补入场动画（#1151 换锚：认「挂载行之前必有 msg-enter 补类／enterMsgOnce」，两种形态均可）',
  amStart >= 0 && amMount >= 0 && amAttach.length > 0 && Math.min(...amAttach) < amMount,
  JSON.stringify({ attach: amAttach, mount: amMount, head: amPre.slice(0, 46) }));
check('S2 classList.add(\'msg-enter\') 全文件恰一处（旧建节点处死代码已除）',
  (src.match(/classList\.add\('msg-enter'\)/g) || []).length === 1);

// ---- 无头浏览器（真实产品链路） ----
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9780 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-878v-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
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
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var s=document.querySelector('.splash');if(s)s.classList.add('hide');var q=document.getElementById('qa-close');if(q)q.click();return true;})()");
await sleep(500);
await ev("(function(){var ok=document.getElementById('modal-ok');var m=document.getElementById('modal-mask');if(m&&!m.hidden){if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}return true;})()");
await ev("(function(){var bar=document.getElementById('backup-remind-bar');if(bar)bar.remove();return true;})()");
await sleep(400);
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(800);
// 关自动回复：防刷新后 TA 的随机回复走实时追加通道，污染 B4 批量渲染断言
await ev("(function(){var st=window.activeStore();st.set('reply-rs-min','9999');st.set('reply-rs-max','9999');st.set('reply-rn-prob','0');st.set('reply-as-en','0');return true;})()");

// 工具：取 #chat-body 最后一个子节点的入场动画观测值
const probeLast = `(function(){
  var b=document.getElementById('chat-body');
  var el=b.lastElementChild; if(!el) return JSON.stringify({nf:1});
  var cs=getComputedStyle(el);
  return JSON.stringify({ cls: el.className, anim: cs.animationName, dur: cs.animationDuration, running: (el.getAnimations?el.getAnimations().length:0) });
})()`;
const probe = async () => JSON.parse(await ev('Promise.resolve(' + probeLast + ')') || '{}');

// ---- B1 礼物卡 ----
await ev(`window.chatAddGift({ side:'out', special:'gift', giftName:'验证礼物', giftEmoji:'🎁', giftPrice: 5.2, giftWish:'心意', ts: Date.now() });`);
let p1 = await probe();
check('B1 礼物卡挂载即带 msg-enter 且动画为 msgPopIn（修复前：className 覆盖后无任何动画）',
  /msg-gift/.test(p1.cls || '') && /(^|\s)msg-enter(\s|$)/.test(p1.cls || '') && p1.anim === 'msgPopIn', JSON.stringify(p1));

// ---- B2 互动卡（TA 的提问卡） ----
await ev(`window.chatAddIn('', { special:'ask-card', askQuestion:'互动卡动画验证？', options:['对','不对'] });`);
let p2 = await probe();
check('B2 互动卡挂载即带 msg-enter 且动画为 msgPopIn',
  /msg-ask/.test(p2.cls || '') && /(^|\s)msg-enter(\s|$)/.test(p2.cls || '') && p2.anim === 'msgPopIn', JSON.stringify(p2));

// ---- B3 文本消息（per-side 动画选择器吃到） ----
await ev(`window.chatAddIn('文本消息动画对照。');`);
let p3 = await probe();
check('B3 文本消息带 msg-enter 且吃到 per-side 动画 msgInPop',
  /(^|\s)msg-enter(\s|$)/.test(p3.cls || '') && /msg-in/.test(p3.cls || '') && p3.anim === 'msgInPop', JSON.stringify(p3));
await ev(`window.chatAddGift({ side:'out', text:'我发的文本对照。', ts: Date.now() });`); // chatAddGift 即 addRec 直通口，无 special 走文本分支
let p3b = await probe();
check('B3b 我方文本吃到 msgOutPop', /(^|\s)msg-enter(\s|$)/.test(p3b.cls || '') && /msg-out/.test(p3b.cls || '') && p3b.anim === 'msgOutPop', JSON.stringify(p3b));

// ---- B4 批量渲染不复活：刷新后整窗历史不得有 msg-enter/在跑动画 ----
await sleep(600);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var s=document.querySelector('.splash');if(s)s.classList.add('hide');return true;})()");
await ev("(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden){var ok=document.getElementById('modal-ok');if(ok)ok.click();m.hidden=true;m.style.display='none';}var bar=document.getElementById('backup-remind-bar');if(bar)bar.remove();return true;})()");
await sleep(500);
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return true;})()");
await sleep(1200);
const b4 = JSON.parse(await ev(`(function(){
  var b=document.getElementById('chat-body');
  var kids=b.children.length, withEnter=0, running=0;
  for (var i=0;i<b.children.length;i++){ var el=b.children[i];
    if (el.classList.contains('msg-enter')) withEnter++;
    if (el.getAnimations && el.getAnimations().length) running++;
  }
  return JSON.stringify({ kids:kids, withEnter:withEnter, running:running });
})()`) || '{}');
check('B4 批量渲染零入场动画（整窗节点无 msg-enter、无 running 动画）',
  b4.kids > 0 && b4.withEnter === 0 && b4.running === 0, JSON.stringify(b4));

// ---- Z1 零 JS 异常 ----
const errs = await ev('JSON.stringify((window.__jsErrors||[]).slice(0,3))');
check('Z1 全程零 JS 异常', !errs || errs === '[]', errs);

chrome.kill();
server.close();
const fails = results.filter((r) => !r.ok);
console.log('\\n==== ' + (fails.length ? fails.length + ' FAILED / ' : 'ALL PASS ') + results.length + ' checks (root=' + root + ') ====');
process.exit(fails.length ? 1 : 0);
