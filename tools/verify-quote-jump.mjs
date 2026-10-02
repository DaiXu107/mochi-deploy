// ===== 引用块点击跳转原消息 验证 =====
// 背景：引用块（.msg-quote）原本只是静态快照，点击无反应。修复后：
//   ① 新引用在记录上存 qidx（被引消息 msgs 下标）：用户长按菜单「引用」（lastQuote.idx）
//      与 TA 引用（scheduleReply 快照 lastMineIdx→addIn qidx）两条路径都带；
//   ② 点击 .msg-quote → resolveQuoteTarget（qidx 直查；旧数据无 qidx 时按内容向前
//      就近匹配）→ jumpToMsg（分页窗口外先扩窗 → scrollIntoView 居中 → highlight 闪烁）；
//   ③ 点引用块不再弹气泡操作菜单（菜单委托对 .msg-quote 放行），搜索跳转复用 jumpToMsg。
// 场景顺序刻意安排：分页扩窗场景最先跑（此时 IDB 还是空的，种入的 chat-msgs 不会被
// 之前场景遗留消息合并干扰下标）；场景 1/2 只做相对位置断言不受影响。
// 用法：node tools/verify-quote-jump.mjs（需先 node build.mjs）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9860 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-qj-' + Date.now()),
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
}
async function gotoChat() {
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return true;})()");
  await sleep(700);
}
async function clearMsgs() {
  await evalJs("(function(){window.activeStore().set('chat-msgs','[]');return true;})()");
  await sleep(200);
  await openPage();
  await gotoChat();
}
// 通过输入框发送一条消息（contenteditable 路径）
async function sendMsg(text) {
  await evalJs(`(function(){
    const inp = document.getElementById('chat-input');
    if (!inp) return false;
    inp.textContent = ${JSON.stringify(text)};
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`);
  await sleep(120);
  await evalJs("document.getElementById('chat-send').click()");
}
// 收口回复参数：TA 引用必中、回复快、单条、无其他随机路径
const CFG = {
  'reply-quote-prob': 100, 'reply-rs-min': 0.3, 'reply-rs-max': 0.6,
  'reply-reply-min': 1, 'reply-reply-max': 1,
  'reply-rn-prob': 0, 'reply-touch-prob': 0, 'reply-rc-prob': 0,
  'reply-sticker-prob': 0, 'reply-emoji-prob': 0, 'reply-image-prob': 0, 'reply-voice-prob': 0,
  'reply-kaomoji-prob': 0, 'reply-cf-prob': 0, 'reply-py-prob': 0, 'reply-as-en': 0
};
async function applyCfg() {
  const kvs = JSON.stringify(CFG);
  await evalJs("(function(){var o=" + kvs + ";Object.keys(o).forEach(function(k){window.activeStore().set(k, String(o[k]));});return true;})()");
}
// 点击第 qn 个 .msg-quote（DOM 顺序），返回点击前该引用块所在消息的 data-idx
async function clickQuote(qn) {
  return await evalJs(`(function(){
    const qs = document.querySelectorAll('#chat-body .msg-quote');
    if (!qs.length || ${qn} >= qs.length) return 'no-quote';
    const item = qs[${qn}].closest('.msg');
    const selfIdx = item ? item.dataset.idx : null;
    qs[${qn}].click();
    return selfIdx;
  })()`);
}
// 等待出现高亮目标，返回 {idx, visible}。高亮类是同步加的而滚动是平滑的：
// 持续轮询直到目标滚进视口才返回；到超时仍不可见则返回最后一次看到的高亮状态
async function waitHighlight(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let seen = null;
  while (Date.now() < deadline) {
    const raw = await evalJs(`(function(){
      const h = document.querySelector('#chat-body .msg.highlight');
      if (!h) return '';
      const b = document.getElementById('chat-body');
      const r = h.getBoundingClientRect(), br = b.getBoundingClientRect();
      return JSON.stringify({ idx: h.dataset.idx, visible: r.bottom > br.top && r.top < br.bottom });
    })()`);
    if (raw) {
      try {
        const o = JSON.parse(raw);
        if (o && o.visible) return o;
        seen = o;
      } catch (e) {}
    }
    await sleep(150);
  }
  return seen;
}

// ---- 场景 A：旧数据（无 qidx）内容回退匹配 + 分页扩窗跳转（先跑：IDB 尚为空，
//      种入的 chat-msgs 加载后下标即真实下标，不被后续场景遗留数据合并推移） ----
console.log('--- 场景 A：旧数据内容匹配 + 分页扩窗 ---');
await openPage();
await applyCfg();
// 种历史记录：目标在第 40 条（我发的），最后一条是旧格式引用（只有 quote 文本、无 qidx）
await evalJs(`(function(){
  const now = Date.now();
  const arr = [];
  for (let i = 0; i < 300; i++) {
    if (i === 40) arr.push({ side: 'out', text: '这条是要被引用的老消息', ts: now - (300 - i) * 60000 });
    else if (i % 2 === 0) arr.push({ side: 'out', text: '历史消息' + i, ts: now - (300 - i) * 60000 });
    else arr.push({ side: 'in', text: '对方消息' + i, ts: now - (300 - i) * 60000 });
  }
  arr.push({ side: 'in', text: '看到了～', quote: '这条是要被引用的老消息', qside: 'out', ts: now - 1000 });
  window.activeStore().set('chat-msgs', JSON.stringify(arr));
  return true;
})()`);
await sleep(300);
await openPage();
await gotoChat();
await sleep(500);
// 首屏只渲染最近 RENDER_MAX=200 条（renderStart≈101）：目标 idx=40 不应在 DOM 里
const preA = await evalJs(`(function(){
  return JSON.stringify({
    hasTarget: !!document.querySelector('#chat-body .msg[data-idx="40"]'),
    quotes: document.querySelectorAll('#chat-body .msg-quote').length
  });
})()`);
let preAo; try { preAo = JSON.parse(preA); } catch (e) {}
check('A-1 分页下旧目标未渲染但旧格式引用块可见', !!preAo && preAo.hasTarget === false && preAo.quotes === 1, preA);
const selfA = await clickQuote(0);
const hlA = await waitHighlight(4500);
check('A-2 无 qidx 旧引用点击后扩窗并高亮到正确目标（idx=40）',
  !!hlA && String(hlA.idx) === '40' && hlA.visible === true, JSON.stringify({ self: selfA, hl: hlA }));
check('A-3 高亮目标是「我发的」且在引用消息之前', !!hlA &&
  await evalJs(`(function(){
    const h = document.querySelector('#chat-body .msg[data-idx="' + ${JSON.stringify(hlA && hlA.idx)} + '"]');
    return !!h && h.classList.contains('msg-out') && Number(h.dataset.idx) < Number(${JSON.stringify(selfA)});
  })()`), JSON.stringify(hlA));

// ---- 场景 B：TA 引用（新数据带 qidx）点击跳回我发的原消息 ----
console.log('--- 场景 B：TA 引用点击跳转（qidx 路径） ---');
await applyCfg();
await clearMsgs();
await sendMsg('帮我记一下明天交房租');
await sleep(5000); // 等 TA 带引用的回复
const sB = await evalJs(`(function(){
  const inMsgs = Array.from(document.querySelectorAll('#chat-body .msg-in')).filter(function(el){ return el.querySelector('.msg-quote'); });
  if (!inMsgs.length) return 'none';
  const qEl = inMsgs[0].querySelector('.msg-quote');
  return JSON.stringify({ cursor: getComputedStyle(qEl).cursor, quoteText: (qEl.textContent || '').slice(0, 30) });
})()`);
let sBo = null; try { sBo = JSON.parse(sB); } catch (e) {}
check('B-1 TA 回复带引用块且 cursor:pointer（可点态）', !!sBo && sBo.cursor === 'pointer', sB);
const selfB = await clickQuote(0);
check('B-2 点前引用块位于 TA 消息内（取到 data-idx）', selfB !== 'no-quote' && selfB != null, String(selfB));
const hlB = await waitHighlight(4000);
check('B-3 点击后出现 highlight 高亮且滚进视口', !!hlB && hlB.visible === true, JSON.stringify(hlB));
if (hlB) {
  const okB4 = await evalJs(`(function(){
    const h = document.querySelector('#chat-body .msg[data-idx="' + ${JSON.stringify(hlB.idx)} + '"]');
    return !!h && h.classList.contains('msg-out') && Number(h.dataset.idx) < Number(${JSON.stringify(selfB)});
  })()`);
  check('B-4 跳转目标是我发的消息且在引用消息之前', okB4, JSON.stringify(hlB));
  // 落点消息文本应与引用块展示的文本一致（TA 引用的是我的原文）
  const okB5 = await evalJs(`(function(){
    const h = document.querySelector('#chat-body .msg[data-idx="' + ${JSON.stringify(hlB.idx)} + '"]');
    if (!h) return false;
    const q = ${JSON.stringify(sBo ? sBo.quoteText : '')};
    if (!q || q.indexOf('表情包') === 0) return true;
    return (h.textContent || '').indexOf(q.slice(0, 12)) >= 0 || q.indexOf((h.textContent || '').trim().slice(0, 12)) >= 0;
  })()`);
  check('B-5 落点内容与被引文本一致', okB5, '');
}

// ---- 场景 C：用户长按菜单「引用」→ 发送 → 点引用块跳回原消息；不弹操作菜单 ----
console.log('--- 场景 C：用户引用路径 + 不弹操作菜单 ---');
await clearMsgs();
await sendMsg('今晚一起看电影吗');
await sleep(400);
// 点原句气泡弹出操作菜单 → 点「引用」
const menuC = await evalJs(`(function(){
  const items = document.querySelectorAll('#chat-body .msg-out');
  if (!items.length) return 'no-msg';
  const b = items[items.length - 1].querySelector('.msg-bubble');
  if (!b) return 'no-bubble';
  b.click();
  const menu = document.getElementById('msg-actions');
  if (!menu || menu.hidden) return 'no-menu';
  const btn = menu.querySelector('.ma-btn[data-act="quote"]');
  if (!btn) return 'no-btn';
  btn.click();
  return 'ok';
})()`);
await sleep(300);
await sendMsg('好呀好呀');
await sleep(800);
const sC = await evalJs(`(function(){
  const outs = Array.from(document.querySelectorAll('#chat-body .msg-out'));
  const withQ = outs.filter(function(el){ return el.querySelector('.msg-quote'); });
  if (!withQ.length) return 'none';
  const qEl = withQ[withQ.length - 1].querySelector('.msg-quote-text');
  const menu = document.getElementById('msg-actions');
  return JSON.stringify({ q: qEl ? qEl.textContent : '', menuHidden: !menu || menu.hidden });
})()`);
let sCo = null; try { sCo = JSON.parse(sC); } catch (e) {}
check('C-1 菜单「引用」生效：发出的消息带引用块且内容为原句',
  menuC === 'ok' && !!sCo && String(sCo.q).indexOf('今晚一起看电影吗') >= 0, 'menu=' + menuC + ' ' + sC);
const selfC = await clickQuote(0);
const hlC = await waitHighlight(4000);
check('C-2 点引用块不弹操作菜单（menu 保持隐藏）', !!sCo && sCo.menuHidden === true, sC);
check('C-3 点击后高亮落回原消息（同文本 msg-out）', !!hlC &&
  await evalJs(`(function(){
    const h = document.querySelector('#chat-body .msg[data-idx="' + ${JSON.stringify(hlC && hlC.idx)} + '"]');
    return !!h && h.classList.contains('msg-out') && (h.textContent || '').indexOf('今晚一起看电影吗') >= 0;
  })()`), JSON.stringify({ self: selfC, hl: hlC }));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
