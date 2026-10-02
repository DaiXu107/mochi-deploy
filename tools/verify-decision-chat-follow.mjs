// ===== #492 帮我决定/多人决定结果发到聊天后，聊天记录自动滑到最新消息 =====
// 用户报障（2026-09-15，多机型同报、要求不要覆盖修改引发跨机型回归）：
//   「使用【帮我决定】和【群聊决定】发送答案至聊天，聊天里的聊天记录位置没有自动滑动至最新消息」
// 根因（src/js/chat.js + decision.js + group-decision.js，零机型分支）：决策结果经
//   chatAddIn({enter,silent}) 走 in 侧通道，maybeScrollChatBottom 的 in 侧钉住闸
//   (#162/#378/#416「用户在看历史就别打扰」) 把它当 TA 自发消息——真机用户上翻过聊天
//   （解钉态）时结果气泡永远落在视口下方不跟随。决策结果是用户当下操作的直接产物，
//   应与「自己发消息」(out 侧必跟底) 和群聊结果 (followGcBottom(true) 强制跟底) 同权。
// 修复：chatAddIn 增 opts.follow 用户主动通道（一次性标记 chatUserFollowScroll），
//   maybeScrollChatBottom 消费后按 out 侧同权三连写跟底；TA 自发消息零改动。
// 场景（修复前 A1/A2 红，修复后全绿；G 组守 #162/#378/#416 不打扰契约不回退）：
//   G2 贴底钉住态：普通来消息照旧跟底（既有行为）
//   G1 解钉态（wheel+上翻）：普通来消息不打扰、不拽底（#378 契约守卫）
//   A1 解钉态：帮我决定结果发到聊天 → 跟底（修前不跟底＝症状）
//   A2 解钉态：多人决定结果发到聊天 → 跟底（修前不跟底＝症状）
// 用法：node tools/verify-decision-chat-follow.mjs（需先 node build.mjs）
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9640 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dcf-' + Date.now()),
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
const CFG = {
  'reply-rs-min': 9999, 'reply-rs-max': 9999, 'reply-reply-min': 0, 'reply-reply-max': 0,
  'reply-rn-prob': 0, 'reply-touch-prob': 0, 'reply-rc-prob': 0,
  'reply-sticker-prob': 0, 'reply-emoji-prob': 0, 'reply-image-prob': 0, 'reply-voice-prob': 0,
  'reply-kaomoji-prob': 0, 'reply-cf-prob': 0, 'reply-py-prob': 0, 'reply-as-en': 0,
  'reply-quote-prob': 0
};
async function applyCfg() {
  const kvs = JSON.stringify(CFG);
  await evalJs("(function(){var o=" + kvs + ";Object.keys(o).forEach(function(k){window.activeStore().set(k, String(o[k]));});return true;})()");
}
async function seedMsgs(n) {
  await evalJs(`(function(){
    const now = Date.now();
    const arr = [];
    for (let i = 0; i < ${n}; i++) arr.push({ side: i % 2 ? 'in' : 'out', text: '历史消息 ' + (i + 1) + '，内容长一点用来撑高度测滚动', ts: now - (${n} - i) * 60000 });
    window.activeStore().set('chat-msgs', JSON.stringify(arr));
    return true;
  })()`);
  await sleep(300);
}
async function measure() {
  return JSON.parse(await evalJs(`(function(){
    var cb = document.getElementById('chat-body');
    if (!cb) return JSON.stringify({ gap: -999, last: '(no-chat-body)' });
    var msgs = cb.querySelectorAll('.msg');
    var last = msgs.length ? String(msgs[msgs.length - 1].textContent || '').replace(/\\s+/g, ' ').slice(0, 30) : '';
    return JSON.stringify({ gap: Math.round(cb.scrollHeight - cb.scrollTop - cb.clientHeight), last: last });
  })()`) || '{"gap":-999,"last":"(eval-null)"}');
}
// 解钉 + 上翻 300px＝模拟真机「看过历史」状态（wheel 触发 #378 unpinChatAndAnchor 监听）
async function unpinAndScrollUp() {
  await evalJs(`(function(){
    var cb = document.getElementById('chat-body');
    if (!cb) return false;
    cb.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }));
    cb.scrollTop = Math.max(0, cb.scrollHeight - cb.clientHeight - 300);
    return true;
  })()`);
  await sleep(700); // G2 消息的 rAF/150ms 平滑跟底兜底若仍在飞会重设钉住，等它落定再解钉（只放宽测试等待，不改断言）
}
// 轮询等贴底（gap≤8）；返回 {ok, gap}
async function waitAtBottom(timeoutMs) {
  const t0 = Date.now();
  let gap = -1;
  while (Date.now() - t0 < timeoutMs) {
    const m = await measure();
    gap = m.gap;
    if (gap <= 8 && gap >= -8) return { ok: true, gap };
    await sleep(300);
  }
  return { ok: false, gap };
}

console.log('--- G2 贴底钉住态：普通来消息照旧跟底（既有行为） ---');
await openPage();
await applyCfg();
await seedMsgs(25);
await openPage();
await gotoChat();
await sleep(600);
{
  await evalJs("(function(){window.chatAddIn('G2普通来消息', { silent: true }); return true;})()");
  const r = await waitAtBottom(3000);
  const m = await measure();
  check('G2 钉住态普通来消息跟底', r.ok && m.last.indexOf('G2普通来消息') >= 0, 'gap=' + r.gap + ' last=' + m.last);
}

console.log('--- G1 解钉态：普通来消息不打扰不拽底（#162/#378/#416 契约守卫，#492 不得破坏） ---');
await unpinAndScrollUp();
{
  await evalJs("(function(){window.chatAddIn('G1解钉态来消息', { silent: true }); return true;})()");
  await sleep(1000);
  const m = await measure();
  check('G1 解钉态普通来消息不拽底', m.gap > 30, 'gap=' + m.gap + ' last=' + m.last);
}

console.log('--- A1 解钉态：帮我决定结果发到聊天 → 跟底 ---');
await unpinAndScrollUp();
{
  await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('more-decide');if(b)b.click();return true;})()");
  await sleep(400);
  const hidden = await evalJs("(function(){var p=document.getElementById('chat-decision-panel');return p?String(p.hidden):'no-panel';})()");
  if (hidden !== 'false') {
    check('A1 帮我决定面板打开', false, 'hidden=' + hidden);
  } else {
    // 思考时间调到最短 1 秒（stepper min×2：3→2→1）
    await evalJs("(function(){var s=document.querySelector('#dec-think-a .stp-min');if(s){s.click();s.click();}return true;})()");
    await evalJs("(function(){var q=document.getElementById('dec-q-a');if(q)q.value='A1测试纠结';return true;})()");
    await sleep(150);
    await evalJs("(function(){var b=document.getElementById('dec-go-a');if(b)b.click();return true;})()");
    const r = await waitAtBottom(6000);
    const m = await measure();
    check('A1 帮我决定结果跟底', r.ok && m.last.indexOf('帮我决定') >= 0, 'gap=' + r.gap + ' last=' + m.last);
  }
  await evalJs("(function(){var b=document.getElementById('chat-decision-close');if(b)b.click();return true;})()");
  await sleep(300);
}

console.log('--- A2 解钉态：多人决定结果发到聊天 → 跟底 ---');
await unpinAndScrollUp();
{
  await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('more-gdecide');if(b)b.click();return true;})()");
  await sleep(400);
  const hidden = await evalJs("(function(){var p=document.getElementById('chat-gdecision-panel');return p?String(p.hidden):'no-panel';})()");
  if (hidden !== 'false') {
    check('A2 多人决定面板打开', false, 'hidden=' + hidden);
  } else {
    await evalJs("(function(){var s=document.querySelector('#gd-think-a .stp-min');if(s){s.click();s.click();}return true;})()");
    await evalJs("(function(){var q=document.getElementById('gd-q-a');if(q)q.value='A2测试纠结';return true;})()");
    await sleep(150);
    await evalJs("(function(){var b=document.getElementById('gd-go-a');if(b)b.click();return true;})()");
    const r = await waitAtBottom(6000);
    const m = await measure();
    check('A2 多人决定结果跟底', r.ok && m.last.indexOf('多人决定') >= 0, 'gap=' + r.gap + ' last=' + m.last);
  }
  await evalJs("(function(){var b=document.getElementById('chat-gdecision-close');if(b)b.click();return true;})()");
  await sleep(300);
}

const pass = results.filter(r => r.ok).length;
console.log('');
console.log('=== verify-decision-chat-follow: ' + pass + '/' + results.length + ' ===');
results.forEach(r => { if (!r.ok) console.log('  FAIL: ' + r.desc); });
chrome.kill();
server.close();
process.exit(pass === results.length ? 0 : 1);
