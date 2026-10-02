// ===== 引用图片/表情包消息验证：引用块只显示缩略图，不再重复显示「图片/表情包」占位文字 =====
// #149：场景 E 覆盖媒体池令牌——图片消息已令牌化（@@m:hash）时引用仍出缩略图、令牌串不进文本
// 用法：node tools/verify-quote-image.mjs（需先 node build.mjs）
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-qi-' + Date.now()),
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
  // #page-chat 默认 hidden，必须点击桌面「聊天」图标进入后才渲染消息列表
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return true;})()");
  await sleep(600);
}

// 1x1 透明 PNG dataURL（渲染 DOM 结构用）
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const HIST = [
  { side: 'out', text: '正文一', quote: { t: '图片', imgs: [IMG] }, qside: 'in', ts: Date.now() - 5000 },
  { side: 'out', text: '正文二', quote: { t: '表情包', imgs: [IMG] }, qside: 'in', ts: Date.now() - 4000 },
  { side: 'out', text: '正文三', quote: { t: '想你了', imgs: [IMG] }, qside: 'in', ts: Date.now() - 3000 },
];
const MSGS = HIST.concat([
  { side: 'out', text: IMG, type: 'image', parts: [{ k: 'img', v: IMG, sub: 'image' }], ts: Date.now() - 2000 },
  { side: 'in', text: IMG, type: 'sticker', parts: [{ k: 'img', v: IMG, sub: 'sticker' }], ts: Date.now() - 1000 },
  { side: 'out', text: '想你了 好想你', parts: [{ k: 'text', v: '想你了 好想你' }, { k: 'img', v: IMG, sub: 'image' }], ts: Date.now() - 500 },
]);

// 场景 A：历史消息里已存的引用块渲染——图片/表情包占位文案不再显示，组合消息文字保留
console.log('--- 场景 A：历史引用消息渲染 ---');
await openPage();
await evalJs("(function(){window.activeStore().set('chat-msgs', JSON.stringify(" + JSON.stringify(MSGS) + "));return true;})()");
await sleep(200);
await openPage();
await gotoChat();
const histA = await evalJs(`(function(){
  const qs = Array.from(document.querySelectorAll('.msg-quote'));
  return JSON.stringify(qs.map(function(q){
    const img = q.querySelector('.msg-quote-img');
    const t = q.querySelector('.msg-quote-text');
    return { hasImg: !!img, text: t ? t.textContent : null };
  }));
})()`) || '[]';
const histArr = JSON.parse(histA);
check('A1 历史引用块都带缩略图（3 条）', histArr.length === 3 && histArr.every(x => x.hasImg), histA);
check('A2 纯图片引用不显示「图片」占位文字', histArr[0] && histArr[0].text === null, 'text=' + (histArr[0] && histArr[0].text));
check('A3 纯表情包引用不显示「表情包」占位文字', histArr[1] && histArr[1].text === null, 'text=' + (histArr[1] && histArr[1].text));
check('A4 组合消息引用保留原文字（不误伤）', histArr[2] && histArr[2].text === '想你了', 'text=' + (histArr[2] && histArr[2].text));

// 场景 B：UI 交互——点图片消息 → 引用 → 预览条 → 发送 → 气泡引用块
console.log('--- 场景 B：引用纯图片消息 ---');
async function quoteAndSend(targetKind, sendText) {
  const targetSel = {
    img: "b.querySelector('.msg-img-big') && !b.querySelector('.msg-parts-imgs')",
    sticker: "b.querySelector('.msg-img-sm')",
    combo: "b.querySelector('.msg-parts-imgs')"
  }[targetKind];
  await evalJs(`(function(){
    const items = Array.from(document.querySelectorAll('.msg'));
    let target = null;
    for (let i = items.length - 1; i >= 0; i--) {
      const b = items[i].querySelector('.msg-bubble');
      if (b && (${targetSel})) { target = items[i]; break; }
    }
    if (!target) return 'no-target';
    target.querySelector('.msg-bubble').click();
    return 'ok';
  })()`);
  await sleep(300);
  const menuOk = await evalJs("(function(){var ma=document.getElementById('msg-actions'); if(!ma||ma.hidden) return 'menu-hidden'; var qb=ma.querySelector('.ma-btn[data-act=\"quote\"]'); if(!qb) return 'no-quote-btn'; qb.click(); return 'ok';})()");
  await sleep(300);
  const barRaw = await evalJs(`(function(){
    const bar = document.querySelector('.chat-draft-quote-bar');
    if (!bar) return 'no-bar';
    const img = bar.querySelector('.chat-draft-quote-img');
    const t = bar.querySelector('.chat-draft-quote-text');
    return JSON.stringify({ hasImg: !!img, text: t ? t.textContent : null });
  })()`);
  let bar = null;
  try { bar = JSON.parse(barRaw); } catch (e) { bar = barRaw; }
  await evalJs(`(function(){
    const inp = document.getElementById('chat-input');
    if (!inp) return false;
    inp.textContent = ${JSON.stringify(sendText)};
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`);
  await sleep(200);
  await evalJs("document.getElementById('chat-send').click()");
  await sleep(400);
  const last = await evalJs(`(function(){
    const items = Array.from(document.querySelectorAll('.msg'));
    const last = items[items.length - 1];
    if (!last) return 'no-msg';
    const q = last.querySelector('.msg-quote');
    if (!q) return 'no-quote';
    const img = q.querySelector('.msg-quote-img');
    const t = q.querySelector('.msg-quote-text');
    const body = last.querySelector('.msg-bubble') ? last.querySelector('.msg-bubble').textContent : '';
    return JSON.stringify({ hasImg: !!img, qText: t ? t.textContent : null, body: body });
  })()`);
  return { menuOk, bar, last: last ? JSON.parse(last) : null };
}
const b = await quoteAndSend('img', '收到图');
check('B1 图片消息点引用能打开菜单并点中「引用」', b.menuOk === 'ok', String(b.menuOk));
check('B2 引用预览条：有缩略图、无占位文字', b.bar && b.bar.hasImg && !b.bar.text, JSON.stringify(b.bar));
check('B3 发送后气泡引用块：有缩略图、无「图片」文字、正文保留', b.last && b.last.hasImg && !b.last.qText && b.last.body.indexOf('收到图') >= 0, JSON.stringify(b.last));

// 场景 C：UI 交互——点表情包消息 → 引用 → 发送
console.log('--- 场景 C：引用表情包消息 ---');
const c = await quoteAndSend('sticker', '收到表情');
check('C1 表情包消息点引用并选中', c.menuOk === 'ok', String(c.menuOk));
check('C2 引用预览条：有缩略图、无占位文字', c.bar && c.bar.hasImg && !c.bar.text, JSON.stringify(c.bar));
check('C3 发送后气泡引用块：有缩略图、无「表情包」文字、正文保留', c.last && c.last.hasImg && !c.last.qText && c.last.body.indexOf('收到表情') >= 0, JSON.stringify(c.last));

// 场景 D：UI 交互——组合消息（文字+图）引用 → 文字保留
console.log('--- 场景 D：引用组合消息（文字+图） ---');
const d = await quoteAndSend('combo', '收到图文');
check('D1 组合消息点引用并选中', d.menuOk === 'ok', String(d.menuOk));
check('D2 引用预览条：有缩略图、保留原文字「想你了 好想你」', d.bar && d.bar.hasImg && d.bar.text === '想你了 好想你', JSON.stringify(d.bar));
check('D3 发送后气泡引用块：缩略图 + 原文字都在', d.last && d.last.hasImg && d.last.qText === '想你了 好想你' && d.last.body.indexOf('收到图文') >= 0, JSON.stringify(d.last));

// 场景 E：#149 媒体池令牌——历史图片已令牌化（@@m:hash）时引用仍出缩略图、令牌串不进引用文本
// tokenize 要求载荷 ≥1024 字符，1x1 PNG 太短。
// #202 期望更新：产品现在对「解码失败的图」渲染占位（修无声空白气泡，iQOO12 实证），
// 旧的伪造截断 PNG（不可解码）会被换成占位导致 E3 找不到 .msg-img-sm——改用页内 canvas
// 生成真实可解码且 >1024 字符的 PNG 噪声图，保留本场景「令牌化+池解析」断言本意。
console.log('--- 场景 E：引用已令牌化的图片消息（#149） ---');
await openPage();
const imgBigRes = await cdp('Runtime.evaluate', {
  expression: "(async function(){var c=document.createElement('canvas');c.width=160;c.height=160;var x=c.getContext('2d');var d=x.createImageData(160,160);for(var i=0;i<d.data.length;i++){d.data[i]=(i*7919)&255;d.data[i*3+3]=255;}x.putImageData(d,0,0);return c.toDataURL('image/png');})()",
  returnByValue: true, awaitPromise: true
});
const IMG_BIG = imgBigRes && imgBigRes.result ? imgBigRes.result.value : null;
check('E-pre 场景图真实可解码且 ≥1024 字符', typeof IMG_BIG === 'string' && IMG_BIG.indexOf('data:image/png') === 0 && IMG_BIG.length >= 1024, String(IMG_BIG && IMG_BIG.length));
const tokRes = await cdp('Runtime.evaluate', {
  expression: "(async function(){var t=await window.mochiMediaTokenize(" + JSON.stringify(IMG_BIG) + ");await window.mochiMediaFlush();return t;})()",
  returnByValue: true, awaitPromise: true
});
const TOKEN = tokRes && tokRes.result ? tokRes.result.value : null;
check('E0 令牌生成（@@m:32位hex）', typeof TOKEN === 'string' && /^@@m:[0-9a-f]{32}$/.test(TOKEN), String(TOKEN));
await evalJs("(function(){window.activeStore().set('chat-msgs', JSON.stringify(" + JSON.stringify([
  { side: 'in', text: TOKEN, type: 'sticker', parts: [{ k: 'img', v: TOKEN, sub: 'sticker' }], ts: Date.now() - 800 },
  { side: 'out', text: '旧对象引用', quote: { t: TOKEN, imgs: [TOKEN] }, qside: 'in', ts: Date.now() - 700 },
  { side: 'out', text: '旧串引用', quote: TOKEN, qside: 'in', ts: Date.now() - 600 },
]) + "));return true;})()");
await sleep(200);
await openPage();
await gotoChat();
await sleep(1500); // 观察器异步从池解析令牌 src
const histE = await evalJs(`(function(){
  const qs = Array.from(document.querySelectorAll('.msg-quote'));
  return JSON.stringify(qs.map(function(q){
    const img = q.querySelector('.msg-quote-img');
    const t = q.querySelector('.msg-quote-text');
    return { hasImg: !!img, src: img ? img.getAttribute('src').slice(0, 10) : null, text: t ? t.textContent : null };
  }));
})()`) || '[]';
const eArr = JSON.parse(histE);
check('E1 历史坏数据 t=令牌：引用块有缩略图、无令牌文本', eArr[0] && eArr[0].hasImg && eArr[0].text === null && eArr[0].src && eArr[0].src.indexOf('@@m:') !== 0, histE);
check('E2 历史字符串令牌引用：渲染成缩略图', eArr[1] && eArr[1].hasImg && eArr[1].src && eArr[1].src.indexOf('@@m:') !== 0, histE);
const e = await quoteAndSend('sticker', '令牌收到图');
check('E3 令牌化表情包点引用并选中', e.menuOk === 'ok', String(e.menuOk));
check('E4 引用预览条：有缩略图、无令牌文本', e.bar && e.bar.hasImg && !e.bar.text, JSON.stringify(e.bar));
check('E5 发送后引用块：有缩略图、无「表情包」文字、正文保留', e.last && e.last.hasImg && !e.last.qText && e.last.body.indexOf('令牌收到图') >= 0, JSON.stringify(e.last));
const eSrc = await evalJs("(function(){const items=Array.from(document.querySelectorAll('.msg'));const last=items[items.length-1];const img=last&&last.querySelector('.msg-quote-img');return img?img.getAttribute('src').slice(0,10):'no-img';})()");
check('E6 发送后引用缩略图 src 已解析为池数据（不再是 @@m: 令牌）', typeof eSrc === 'string' && eSrc.indexOf('@@m:') !== 0 && eSrc !== 'no-img', String(eSrc));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
