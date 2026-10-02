// ===== #745 帮我决定/多人决定「出答案两拍化」行为验证 =====
// 用户报障（2026-09-18）：「决定和群聊决定出答案会卡住几秒，思考时间只设了 1 秒」。
// 根因（src/js/decision.js + group-decision.js，零机型分支）：倒计时结束的同一拍里做
//   「历史全量重写」（≤1000 条 parse+stringify+同步 setItem）＋聊天投递（chatAddIn /
//   gcSendDecisionText 级联 schedulePersist：msgsBytes 全量遍历 + 快照/整包 stringify，
//   大记录桌面主线程秒级冻结）——用户视角「答案出不来/出了页面卡死」。
// 修复：答案渲染（第一拍，立即上屏）与重活（settle：历史写+投递+toast，第二拍）拆分，
//   settle 走 requestIdleCallback(timeout 600) + 80ms 定时器兜底双通道，先到先得。
// 本脚本断言行为语义（textContent 口径，不依赖 innerText 布局采样——verify-group-decision
//   T6 的 chatCnt 断言在无头环境不稳定，本脚本补可靠版）：
//   A/B 各三断言：① done class 在点击后 ≤1.8s 出现（答案上屏不被重活拖住）
//                 ② 聊天 DOM（textContent）在 5s 内出现决定消息（settle 投递完成）
//                 ③ 历史键条数 +1（settle 落库完成）
//   并注入 300 条大历史（≈几百 KB）模拟重度用户，验证大历史下两拍仍按时完成。
// 用法：node tools/verify-decision-two-phase.mjs（需先 node build.mjs）
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9740 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-2p-' + Date.now()),
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
async function gotoChat() {
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(700);
}
// 大历史注入：300 条 × 约 1KB ≈ 300KB 字符串（重度用户量级，加重 settle 的 stringify/setItem 负担）
async function seedBigHistory(key, maker) {
  await evalJs(`(function(){
    var now = Date.now(); var arr = [];
    for (var i = 0; i < 300; i++) {
      var pad = ''; for (var j = 0; j < 60; j++) pad += '纠结选项测试数据'[(i + j) % 8];
      arr.push((${maker})(i, pad, now - (i + 1) * 60000));
    }
    try { localStorage.setItem('xy-home-v2:' + '${key}', JSON.stringify(arr)); } catch (e) {}
    try { var s = window.xyStore('xy-home-v2'); s.set('${key}', JSON.stringify(arr)); } catch (e) {}
    return (JSON.parse(localStorage.getItem('xy-home-v2:' + '${key}') || '[]')).length;
  })()`);
}
// 轮询直到 expr 为真；返回 {ok, t}（t=从 t0 起的耗时 ms）
async function pollUntil(expr, t0, timeoutMs, gapMs) {
  let t = 0;
  while (t < timeoutMs) {
    await sleep(gapMs || 50); t += (gapMs || 50);
    if (await evalJs(expr)) return { ok: true, t: t };
  }
  return { ok: false, t: t };
}
async function openPanel(moreId) {
  await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
  await sleep(350);
  await evalJs("(function(){var b=document.getElementById('" + moreId + "');if(b)b.click();return true;})()");
  await sleep(350);
}

console.log('--- 环境就绪 ---');
await openPage();
await applyCfg();
await gotoChat();
// 关闭收件侧可能干扰的自动回复（CFG 已关），并清两个历史键从零计数
await evalJs("(function(){try{window.xyStore('xy-home-v2').remove('decision-history');window.xyStore('xy-home-v2').remove('gdec-history');}catch(e){}return true;})()");

console.log('--- A 组：帮我决定（decision.js）出答案两拍化 ---');
{
  const seeded = await seedBigHistory('decision-history',
    "(function(i,pad,ts){return {id:'d_seed'+i,type:'typea',question:pad,result:'是',options:null,ts:ts};})");
  check('A0 大历史注入 300 条', seeded === 300, 'seeded=' + seeded);
  await openPanel('more-decide');
  await evalJs("(function(){var s=document.querySelector('#dec-think-a .stp-min');if(s){s.click();s.click();}return true;})()");
  await evalJs("(function(){var q=document.getElementById('dec-q-a');if(q)q.value='两拍验证纠结';return true;})()");
  await evalJs("(function(){var b=document.getElementById('dec-go-a');if(b)b.click();return true;})()");
  const t0 = Date.now();
  const r1 = await pollUntil("(function(){var el=document.getElementById('dec-result-a');return !!(el&&el.classList.contains('done'));})()", t0, 1800);
  check('A1 答案上屏 ≤1.8s（不被历史重写/投递拖住）', r1.ok, 't=' + r1.t + 'ms');
  const r2 = await pollUntil("(function(){var cb=document.getElementById('chat-body');return !!(cb&&cb.textContent.indexOf('【帮我决定】两拍验证纠结')>=0);})()", t0, 5000, 60);
  check('A2 聊天投递完成（textContent 口径，5s 内）', r2.ok, 't=' + r2.t + 'ms');
  await sleep(200);
  const histLen = await evalJs("(function(){try{return JSON.parse(window.xyStore('xy-home-v2').get('decision-history')||'[]').length;}catch(e){return -1;}})()");
  check('A3 历史落库 +1（301=300 注入+1 本轮）', histLen === 301, 'histLen=' + histLen);
  await evalJs("(function(){var b=document.getElementById('chat-decision-close');if(b)b.click();return true;})()");
  await sleep(250);
}

console.log('--- B 组：多人决定（group-decision.js）出答案两拍化 ---');
{
  const seeded = await seedBigHistory('gdec-history',
    "(function(i,pad,ts){return {id:'gd_seed'+i,type:'typea',question:pad,members:['成员A'],results:{'成员A':'是'},options:null,ts:ts};})");
  check('B0 大历史注入 300 条', seeded === 300, 'seeded=' + seeded);
  await openPanel('more-gdecide');
  await evalJs("(function(){var s=document.querySelector('#gd-think-a .stp-min');if(s){s.click();s.click();}return true;})()");
  await evalJs("(function(){var q=document.getElementById('gd-q-a');if(q)q.value='两拍验证群决';return true;})()");
  await evalJs("(function(){var b=document.getElementById('gd-go-a');if(b)b.click();return true;})()");
  const t0 = Date.now();
  const r1 = await pollUntil("(function(){var el=document.getElementById('gd-result-a');return !!(el&&el.classList.contains('done'));})()", t0, 1800);
  check('B1 答案上屏 ≤1.8s（不被历史重写/投递拖住）', r1.ok, 't=' + r1.t + 'ms');
  const r2 = await pollUntil("(function(){var cb=document.getElementById('chat-body');return !!(cb&&cb.textContent.indexOf('【多人决定】两拍验证群决')>=0);})()", t0, 5000, 60);
  check('B2 聊天投递完成（textContent 口径，5s 内）', r2.ok, 't=' + r2.t + 'ms');
  await sleep(200);
  const histLen = await evalJs("(function(){try{return JSON.parse(window.xyStore('xy-home-v2').get('gdec-history')||'[]').length;}catch(e){return -1;}})()");
  check('B3 历史落库 +1（301=300 注入+1 本轮）', histLen === 301, 'histLen=' + histLen);
  await evalJs("(function(){var b=document.getElementById('chat-gdecision-close');if(b)b.click();return true;})()");
  await sleep(250);
}

const pass = results.filter(r => r.ok).length;
console.log('');
console.log('=== verify-decision-two-phase: ' + pass + '/' + results.length + ' ===');
results.forEach(r => { if (!r.ok) console.log('  FAIL: ' + r.desc); });
chrome.kill();
server.close();
process.exit(pass === results.length ? 0 : 1);