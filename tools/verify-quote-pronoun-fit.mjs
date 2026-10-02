// ===== #490 引用预览条与气泡同轨显示（「联系人发的消息，引用后看到的和引用的不一致」
// EC-PAD01 SE Chrome 等多机型同报）=====
// 排查路径：气泡菜单「引用」→ lastQuote = quoteTextOf(rec)（存储原文）→ renderQuoteBar 直出；
// 而气泡正文走 renderMsg 的 T()＝in 侧 taFit 称呼替换（字卡以 ta/TA/他 作人称占位）+ {ta}/{me}
// 昵称回填——两轨显示不同＝「看到的和引用的不一致」；发送后引用块 quoteHtml 又走 taFit，
// 预览与落定引用块也对不上。修复=quoteDisplayFit(quoteTextSafe(...), side) 接入预览条。
// 场景（修复前 P1/P2/P4/P5 红，修复后全绿）：
//   P1 性别=她：in 消息含「ta」→ 预览=「她…」（修前直出「ta…」）
//   P2 默认称呼：in 消息含「他」→ 预览=「TA…」与气泡一致（修前直出「他」）
//   P3 out 消息含「ta」→ 预览保持原文（不过 taFit，防过度替换回归哨）
//   P4 性别=她 + {ta} 占位符 → 预览回填昵称「宝贝…」（修前直出「{ta}…」）
//   P5 端到端：引用 in 消息后发送，气泡上引用块文本 == 预览条文本（修前两轨不等）
// 用法：node tools/verify-quote-pronoun-fit.mjs（需先 node build.mjs）
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-qpf-' + Date.now()),
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
// 按文案列表播种（side: in/out），末条 ts≈当前
async function seedMsgs(items) {
  await evalJs(`(function(){
    const now = Date.now();
    const arr = ${JSON.stringify(items)}.map(function(it, i){
      return { side: it.side, text: it.text, ts: now - (${items.length} - i) * 60000 };
    });
    window.activeStore().set('chat-msgs', JSON.stringify(arr));
    return true;
  })()`);
  await sleep(300);
}
// 点指定 data-idx 的气泡 → 菜单「引用」→ 返回 {preview, bubble}（预览条文本 / 气泡文本）
async function quoteViaMenu(idx) {
  return await evalJs(`(function(){
    const item = document.querySelector('#chat-body .msg[data-idx="' + ${idx} + '"]');
    if (!item) return JSON.stringify({ err: 'no-el' });
    const b = item.querySelector('.msg-bubble');
    if (!b) return JSON.stringify({ err: 'no-bubble' });
    const bubbleTxt = String(b.textContent || '').trim();
    b.click();
    const menu = document.getElementById('msg-actions');
    if (!menu || menu.hidden) return JSON.stringify({ err: 'no-menu', bubbleTxt: bubbleTxt });
    const btn = menu.querySelector('.ma-btn[data-act="quote"]');
    if (!btn) return JSON.stringify({ err: 'no-btn', bubbleTxt: bubbleTxt });
    btn.click();
    const bar = document.getElementById('chat-draft-quote');
    const txt = bar && !bar.hidden ? (bar.querySelector('.chat-draft-quote-text') || {}).textContent || '' : '(hidden)';
    return JSON.stringify({ preview: txt, bubble: bubbleTxt });
  })()`);
}

// ---- P1 性别=她：in 消息含 ta → 预览与气泡同轨显示「她…」 ----
console.log('--- P1 性别=她：ta 占位预览同轨 ---');
await openPage();
await applyCfg();
await evalJs("(function(){window.activeStore().set('partner-gender','she');window.activeStore().set('cs-lbl-partner','');window.activeStore().set('chat-msgs','[]');return true;})()");
await sleep(200);
await seedMsgs([{ side: 'out', text: '在忙什么' }, { side: 'in', text: 'ta想你了，晚上一起吃饭吗' }]);
await openPage();
await gotoChat();
await sleep(600);
const p1 = JSON.parse(await quoteViaMenu(1));
check('P1 预览=「她想你了…」与气泡一致', !p1.err && p1.preview === '她想你了，晚上一起吃饭吗', JSON.stringify(p1));
check('P1b 气泡确实显示了替换词「她…」（前提成立）', !p1.err && p1.bubble === '她想你了，晚上一起吃饭吗', JSON.stringify(p1));

// ---- P2 默认称呼：in 消息含「他」→ 气泡与预览同为「TA…」 ----
console.log('--- P2 默认称呼：他→TA 同轨 ---');
await evalJs("(function(){window.activeStore().set('partner-gender','');window.activeStore().set('chat-msgs','[]');return true;})()");
await sleep(200);
await seedMsgs([{ side: 'in', text: '昨天在公园看到他放风筝' }, { side: 'out', text: '真的假的' }]);
await openPage();
await gotoChat();
await sleep(600);
const p2 = JSON.parse(await quoteViaMenu(0));
check('P2 预览=「…TA…」与气泡一致', !p2.err && p2.preview === '昨天在公园看到TA放风筝', JSON.stringify(p2));
check('P2b 气泡确实显示了「TA…」（前提成立）', !p2.err && p2.bubble === '昨天在公园看到TA放风筝', JSON.stringify(p2));

// ---- P3 out 消息：预览保持原文（不过 taFit） ----
console.log('--- P3 out 消息预览保持原文 ---');
await evalJs("(function(){window.activeStore().set('partner-gender','she');window.activeStore().set('chat-msgs','[]');return true;})()");
await sleep(200);
await seedMsgs([{ side: 'out', text: 'ta明天记得叫我起床' }]);
await openPage();
await gotoChat();
await sleep(600);
const p3 = JSON.parse(await quoteViaMenu(0));
check('P3 out 消息预览原文不变', !p3.err && p3.preview === 'ta明天记得叫我起床', JSON.stringify(p3));

// ---- P4 {ta} 占位符 + 昵称 → 预览回填昵称 ----
console.log('--- P4 {ta} 占位符回填昵称 ---');
await evalJs("(function(){window.activeStore().set('cs-lbl-partner','宝贝');window.activeStore().set('chat-msgs','[]');return true;})()");
await sleep(200);
await seedMsgs([{ side: 'in', text: '{ta}早点休息哦' }]);
await openPage();
await gotoChat();
await sleep(600);
const p4 = JSON.parse(await quoteViaMenu(0));
check('P4 预览=「宝贝早点休息哦」与气泡一致', !p4.err && p4.preview === '宝贝早点休息哦', JSON.stringify(p4));

// ---- P5 端到端：引用后发送，气泡上引用块文本 == 预览条文本 ----
console.log('--- P5 引用块与预览同轨 ---');
await evalJs("(function(){window.activeStore().set('cs-lbl-partner','');window.activeStore().set('chat-msgs','[]');return true;})()");
await sleep(200);
await seedMsgs([{ side: 'out', text: '在忙什么' }, { side: 'in', text: 'ta想你了，晚上一起吃饭吗' }]);
await openPage();
await gotoChat();
await sleep(600);
const p5q = JSON.parse(await quoteViaMenu(1));
await evalJs("(function(){var i=document.getElementById('chat-input');i.textContent='好呀';return true;})()");
await sleep(150);
await evalJs("(function(){document.getElementById('chat-send').click();return true;})()");
await sleep(800);
const p5blk = await evalJs(`(function(){
  const qs = document.querySelectorAll('#chat-body .msg-out .msg-quote .msg-quote-text');
  if (!qs.length) return '(no-quote-block)';
  return String(qs[qs.length - 1].textContent || '').trim();
})()`);
check('P5 发送后引用块文本 == 预览条文本', p5blk === p5q.preview, JSON.stringify({ preview: p5q.preview, block: p5blk }));

const fail = results.filter((r) => !r.ok).length;
console.log(fail === 0 ? '\nALL PASS ' + results.length + '/' + results.length : '\nFAILED ' + fail + '/' + results.length);
chrome.kill();
server.close();
process.exit(fail === 0 ? 0 : 1);
