// #1521 行为回归尺：跨桌面查岗题库写闸 ＋ 昵称池写闸（#1520 复审收口的最后两处同族洞）
// ① ck-question 的 ckLoadFrom 是**跨桌面**读-改-写（写目标桌面的 store）：盲窗里「跨桌面来消息」
//    抽题那一发自动写，把对方桌面的查岗题库顶成纯预设。修＝按目标桌面 store 接静默闸 + 读侧取回钩。
// ② 昵称池「添加」是读-改-写（bindNickAdd）：此前裸写，一行接闸（同族留洞收口）。
//    注：昵称池是小键、超 200KB 概率极低，本闸几乎永不触发 ⇒ 行为侧无稳定断言可造，只留锚点，
//        B2 只验「健康态不误拦」这个控制项，不假装能复现盲窗。
// 红侧（纯 9c3df96 产物）恰红：S1~S3 ＋ B1（对方桌面题库被顶成纯预设）。
import { readFileSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) { console.error('产物不在：' + root); process.exit(2); }
console.log('被测产物：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

const srcOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
console.log('S 产物锚');
ok('S1 #1521a 跨桌面查岗写闸（按目标桌面 store 问读全没有）',
  (srcOf('ck-question.js') + indexHtml).includes('!ckAutoHoldIn(s, KEY)) { try { s.set(KEY'));
ok('S2 #1521b 昵称池整包写闸', srcOf('avatar-lib.js').includes("xyBigWriteBlocked(store, 'nick-lib', '昵称池')"));
ok('S3 #1521c 添加昵称尊重闸结果', srcOf('avatar-lib.js').includes('if (saveFn(list) === false) return;'));

const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9150 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1521-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
try {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) throw new Error('无法连接无头浏览器');
} catch (e) { console.error('SKIP: ' + e.message); chrome.kill(); server.close(); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr.trim() + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (r && r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 423, height: 853, deviceScaleFactor: 1.7, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){try{localStorage.setItem('xy-home-v2:cardlock-state','open');localStorage.setItem('xy-home-v2:cardlock-pwver','2');}catch(e){}})()" });
let jsErr = 0;
ws.addEventListener('message', (ev) => {
  try { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErr++; } catch (e) {}
});
async function openCold() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(500);
  await evalJs("try { if (window.cardLockTryUnlock) window.cardLockTryUnlock('990815'); } catch (e) {} return true;");
}
const blindWindow = `(function(){var hd=Object.getOwnPropertyDescriptor(document,'visibilityState');
try{Object.defineProperty(document,'visibilityState',{get:function(){return 'hidden';},configurable:true});document.dispatchEvent(new Event('visibilitychange'));}catch(e){}
try{Object.defineProperty(document,'visibilityState',{get:function(){return 'visible';},configurable:true});document.dispatchEvent(new Event('visibilitychange'));}catch(e2){}
return true;})()`;

console.log('B 行为断言（423×853 无头）');
await openCold();
const fx = await evalJs("return { ready: !!window.xyStore && !!window.idbGet && !!window.ckQuestionPickFor };");
if (!fx || !fx.ready) { console.error('SKIP: 模块未就绪 ' + JSON.stringify(fx)); chrome.kill(); server.close(); process.exit(2); }

// ---- B1 跨桌面查岗题库写闸（判别核心）：盲窗里抽题那一发自动写不得把对方桌面题库顶成纯预设 ----
const b1 = await evalJs([
  "var ns = window.xyStore('xy-home-v2:default');",
  "var qs = [{ id: 'ck_custom_1', text: '自建查岗问题甲·今天有没有想我', cat: 'daily', enabled: true, isPreset: false }];",
  "for (var i = 0; i < 8000; i++) qs.push({ id: 'ck_pad_' + i, text: '查岗填充第' + i + '号·一整段用来把这一格撑过二十万字符的大文本内容一二三四五六七八九十', cat: 'daily', enabled: true, isPreset: true });",
  "ns.set('ta-checkin', JSON.stringify({ questions: qs, settings: { enabled: true, prob: 5, popupProb: 70, useDefault: true }, mergedIds: [] }));",
  "var ls0 = (localStorage.getItem('xy-home-v2:default:ta-checkin') || '').length;",
  "var warm = 0;",
  "for (var w = 0; w < 30; w++) { warm = (ns.get('ta-checkin') || '').length; if (warm > 260000) break; await new Promise(function (r0) { setTimeout(r0, 200); }); }",
  "var landed = 0;",
  "for (var t = 0; t < 30; t++) { try { var raw0 = await window.idbGet('xy-home-v2:default:ta-checkin'); landed = raw0 ? raw0.length : 0; } catch (e) {} if (landed > 260000) break; await new Promise(function (r1) { setTimeout(r1, 200); }); }",
  blindWindow,
  "var picked = null; try { picked = window.ckQuestionPickFor('default'); } catch (e2) { picked = { __err: String(e2).slice(0, 80) }; }",
  "await new Promise(function (r2) { setTimeout(r2, 700); });",
  "var raw = null; try { raw = await window.idbGet('xy-home-v2:default:ta-checkin'); } catch (e3) {}",
  "var d = null; try { d = JSON.parse(raw || 'null'); } catch (e4) {}",
  "var arr = (d && d.questions) || [];",
  "return { ls0: ls0, warm: warm, landed: landed, picked: picked && picked.text ? String(picked.text).slice(0, 12) : (picked ? 'null' : 'null'),",
  " n: arr.length, head: (arr[0] && arr[0].text) || '', hasCustom: arr.some(function (q) { return q && q.id === 'ck_custom_1'; }) };"
].join(String.fromCharCode(10)));
ok('B1a 查岗题库大键前提成立（LS 收走、库里落定、驻留可读）',
  b1 && b1.ls0 === 0 && b1.landed > 260000 && b1.warm > 260000, JSON.stringify(b1));
ok('B1 盲窗里跨桌面抽题＝那一发自动写被拦、对方桌面题库完好（控制项：盲窗读空这一形态本来就被既有 isNew 守卫护住；会顶库的是「读回旧值/半份表」形态，无头不可稳定复现，判别主锚＝S1）',
  b1 && b1.n > 7000 && b1.hasCustom === true && b1.head === '自建查岗问题甲·今天有没有想我', JSON.stringify(b1));
ok('B1b 闸拦下不影响抽题本身（仍能抽到一道题）', b1 && b1.picked && b1.picked !== 'null', JSON.stringify(b1 && b1.picked));

// ---- B2 昵称池控制项：健康态不误拦（小键，盲窗不可复现；判别主锚＝S2/S3）----
const b2 = await evalJs([
  "var ns = window.xyStore('xy-home-v2:default');",
  "ns.set('nick-lib', JSON.stringify(['小 nicknamed', '另一个昵称']));",
  "var v = null; try { v = ns.get('nick-lib'); } catch (e) {}",
  "var st = null; try { st = window.storeForCid ? window.storeForCid('default') : null; } catch (e2) {}",
  "var hold = null;",
  "if (st && window.xyBigWriteBlocked) { try { hold = window.xyBigWriteBlocked(st, 'nick-lib', '昵称池'); } catch (e3) {} }",
  "return { has: !!v, hold: hold };"
].join(String.fromCharCode(10)));
ok('B2 健康态（读得到）不误拦＝闸只对真读空生效', b2 && b2.has === true && b2.hold === false, JSON.stringify(b2));

ok('Z 全程零未捕获 JS 异常', jsErr === 0, 'jsErr=' + jsErr);

try { ws.close(); } catch (e) {}
chrome.kill(); server.close();
console.log('—— 合计：' + pass + ' 绿 / ' + fail + ' 红 ——');
process.exit(fail ? 1 : 0);