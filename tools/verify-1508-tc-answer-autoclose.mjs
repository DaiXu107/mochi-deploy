// #1508 行为回归尺：「TA的小问题」弹窗（tc-mask）作答后必须自动收起。
// 作者实报（多设备型号同现＝纯行为口径，零机型分支）：
//   「联系人发送的互动卡片弹窗，我已经选了答案，没有自动关闭收起来」。
// 本尺钉的口子：五类互动卡弹窗里唯独小问题（ask-choose / tc-mask）答完不收——
//   询问（openModal 确定 try/finally 必关）/好奇·吐槽（qa-mask 答完 hidden=true）/
//   查岗·互动回应（pillSubmit 点选即提交同路径关窗）/音乐「一起去听」（两按钮即收）
//   全都答完即收，唯小问题答完停在「结果页」等手动点「收起来」。
// 断言：
//   S1 关闭锚在位（submitTC 末尾收 tc-mask）；
//   S2 openTC 已答分支原样保留（renderTCResult 未被本批牵连删除）；
//   S3 submitTC 收尾不再是 renderTCResult（源/产物两形态的相邻性）；
//   B1 openTC 打开小问题弹窗：面板可见＋两个选项在位；
//   B2 点选项作答 ⇒ 弹窗立即自动收起（本批新契约；红侧恰在此红）；
//   B3 作答落地：卡片翻 answered＋你的选择/TA 回应两条消息进聊天；
//   B4 已答卡再点不重开弹窗（locateCardIdx 只认未答卡，不重复打扰）；
//   Z 全程零 JS 异常。
// 用法：node tools/verify-1503-tc-answer-autoclose.mjs [被测根目录]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
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

// ---- S 组：源码/产物锚（外置 js/<file> 与内联 index.html 两种落点都认）----
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const srcOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const taCode = srcOf('ta-ask.js') + indexHtml;
const taSrcOnly = srcOf('ta-ask.js');
console.log('S 源码/产物锚');
ok('S1 submitTC 答完即收锚在位', taCode.includes('if (tcMaskEl) tcMaskEl.hidden = true;'));
ok('S2 openTC 已答分支保留（renderTCResult 未被牵连删除）',
  taCode.includes("if (rec.choiceStatus === 'answered') { renderTCResult(msgIdx); return; }"));
ok('S3 submitTC 收尾不再是 renderTCResult（源/产物相邻性两形态）',
  !taSrcOnly.includes('refreshAskRecordsIfOpen();\n    renderTCResult(msgIdx);') &&
  !taCode.includes('refreshAskRecordsIfOpen();\nrenderTCResult(msgIdx);'));

// ---- 无头浏览器 ----
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9980 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1508-' + Date.now()),
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
// 二级锁（#319）必须在文档脚本之前解锁；#1497 起解锁态只活本页生命周期，双腿都走
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
  await sleep(600);
}

console.log('B 行为断言（423×853 无头）');
await openCold();
const fx = await evalJs(`
  try { if (window.cardLockTryUnlock) window.cardLockTryUnlock('990815'); } catch (e) {}
  return { lock: (window.cardLockOpen && window.cardLockOpen()) === true,
    ready: !!window.chatAddSystem && !!window.openTC && !!window.getChatMsgs };
`);
if (!fx || !fx.ready) { console.error('SKIP: 模块未就绪 ' + JSON.stringify(fx)); chrome.kill(); server.close(); process.exit(2); }

// 种卡：与 tcPush 同一入口 chatAddSystem（字段白名单透传 choice*），只种卡片不种提示语
const seed = await evalJs(`
  var el = window.chatAddSystem('TA的小问题·尺', { special: 'ask-choose', choiceQuestion: '今天想我了吗？',
    choiceOptions: [{ t: '想', reply: ['我也想你。'] }, { t: '不想', reply: ['哼，骗人。'] }], choicePref: 0, choiceCat: '' });
  if (!el) return { noEl: true };
  return { idx: Number(el.dataset.idx), len: (window.getChatMsgs ? window.getChatMsgs() : []).length };
`);
if (!seed || seed.noEl || !(seed.idx >= 0)) { console.error('SKIP: 种卡失败 ' + JSON.stringify(seed)); chrome.kill(); server.close(); process.exit(2); }
const idx = seed.idx;

// ---- B1 打开弹窗 ----
const b1 = await evalJs(`
  var mask = document.getElementById('tc-mask');
  var before = mask.hidden;
  window.openTC(${idx});
  mask = document.getElementById('tc-mask');
  var opts = document.querySelectorAll('#tc-body .tc-opt');
  var q = document.querySelector('#tc-body .tc-q');
  return { before: before, after: mask.hidden, opts: opts.length, q: q ? q.textContent : '' };
`);
ok('B1 openTC 打开小问题弹窗：面板可见＋两个选项在位',
  b1 && b1.before === true && b1.after === false && b1.opts === 2 && String(b1.q || '').indexOf('今天想我了吗') >= 0, JSON.stringify(b1));

// ---- B2 答完即收（本批契约）----
const b2 = await evalJs(`
  var opt = document.querySelector('#tc-body .tc-opt');
  if (!opt) return { noOpt: true };
  opt.click();
  return { hidden: document.getElementById('tc-mask').hidden };
`);
ok('B2 点选项作答 ⇒ 弹窗立即自动收起（本批契约；红侧恰在此红）', b2 && b2.hidden === true, JSON.stringify(b2));

// ---- B3 作答落地 ----
// TA 回应走 addInTyped「正在输入…」模拟（showTyping → 800–1400ms → addIn），延迟落条＝产品行为，
// 采样必须等它落地（实测点完立刻读只看得到 out 一条）
await sleep(2300);
const b3 = await evalJs(`
  var arr = window.getChatMsgs ? window.getChatMsgs() : [];
  var rec = arr[${idx}] || {};
  return { status: rec.choiceStatus || '', answer: rec.choiceAnswer || '', reply: rec.choiceReply || '', len: arr.length };
`);
ok('B3 作答落地：卡片翻 answered、记下所选', b3 && b3.status === 'answered' && b3.answer === '想', JSON.stringify(b3));
ok('B3b 你的选择＋TA 回应两条消息进聊天（回应文本在位）',
  b3 && b3.len === seed.len + 2 && String(b3.reply || '').length > 0, JSON.stringify(b3));

// ---- B4 已答卡再点不重开 ----
const b4 = await evalJs(`
  window.openTC(${idx});
  return { hidden: document.getElementById('tc-mask').hidden };
`);
ok('B4 已答卡再点不重开弹窗（不重复打扰）', b4 && b4.hidden === true, JSON.stringify(b4));

ok('Z 全程零未捕获 JS 异常', jsErr === 0, 'jsErr=' + jsErr);

try { ws.close(); } catch (e) {}
chrome.kill(); server.close();
console.log('—— 合计：' + pass + ' 绿 / ' + fail + ' 红 ——');
process.exit(fail ? 1 : 0);
