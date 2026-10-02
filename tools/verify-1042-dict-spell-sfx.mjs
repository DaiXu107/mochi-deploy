// ===== 常驻回归脚本：#1042 词典「逐条连发」收件音效（用户实报「词典逐条连发时没有触发音效」） =====
// 跑法：node build.mjs && node tools/verify-1042-dict-spell-sfx.mjs
//   双基线取证：MOCHI_ROOT=<纯 HEAD 副本> node tools/verify-1042-dict-spell-sfx.mjs
// 根因（src/js/chat.js replyOnce 逐卡连发分支）：每条卡写 `silent: si > 0 ? true : …`，而这枚
//   silent 在 addIn 里同时压「桌面横幅/系统通知」与「收件音效」（#968 同族）⇒ 三张卡只响首条
//   一声；当该批落在「多字卡回复」第 2 条及以后（replyOnce 自身带 silent = i > 0）时整批零声。
//   实测（修复前＝纯 HEAD）：3 张卡 → playSfx('in') 1 次；回复条数 2 条×各 2 张卡 → 4 张卡仍 1 次。
// 修法：opts.sfx === true 单独放开音效闸门（silent 语义不动，横幅仍整批一次），连发每条带
//   sfx: !willRetractR（命中撤回的整批照旧全静默＝#553「内容会消失的本条不播音效」契约）。
// 断言面：S 组＝源码/产物锚；B 组＝无头真实链路（桩 quoteSpellPick + 点发送）数 playSfx('in') 次数；
//   对照组 B3/B4 保证 silent 的默认语义没被改宽（后台批量/静默通道不许跟着响）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS  ' : 'FAIL  ') + desc + (detail ? '  [' + detail + ']' : '')); }

const SRC = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const PROD = readFileSync(join(root, 'js/chat.js'), 'utf8');

// ===== S 组：源码/产物锚 =====
const GATE = "(!opts.silent || opts.sfx === true)";
const CARD = "sfx: !willRetractR,";
const count = (s, n) => s.split(n).length - 1;
check('S1 addIn 音效闸门与横幅解耦（src）', count(SRC, GATE) === 1, '命中 ' + count(SRC, GATE) + ' 处');
check('S2 逐卡连发每条带 sfx: !willRetractR（src）', count(SRC, CARD) === 1, '命中 ' + count(SRC, CARD) + ' 处');
check('S3 连发的 silent 仍原样透传（横幅/通知不许跟着刷屏）', count(SRC, "silent: si > 0 ? true : (silent || willRetractR),") === 1);
const _addRecLine = (SRC.match(/^[\t ]*return addRec\(\{ side: 'in'.*$/m) || [''])[0];
check('S4 addIn → addRec 仍透传 silent、且 sfx 不进记录（音效解耦没有把横幅闸门一起改宽，也不落库）',
  _addRecLine.indexOf('silent: opts.silent') >= 0 && _addRecLine.indexOf('sfx:') < 0, _addRecLine.slice(0, 90));
check('S5 产物已接入：闸门 + 连发每条 sfx 锚各一处', count(PROD, GATE) === 1 && count(PROD, CARD) === 1, 'gate=' + count(PROD, GATE) + ' card=' + count(PROD, CARD));

// ===== B 组：无头行为 =====
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，B 组无法执行'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const udd = join(process.env.TEMP || '/tmp', 'mochi-1042-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 80));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

// 种子：内置「联系人发消息」音效 + playSfx 计数包装（透传真实实现，不拦截播放）
const boot = `
(function () {
  localStorage.setItem('xy-home-v2:default:sfx-in-b', 'bubble');
  window.__sfxCalls = [];
  window.__pageErrors = [];
  window.addEventListener('error', function (e) { try { window.__pageErrors.push(String(e.message)); } catch (x) {} });
  var _impl = null;
  Object.defineProperty(window, 'playSfx', {
    configurable: true,
    get: function () { var f = _impl; if (!f) return function () {}; return function (type, opts) { try { window.__sfxCalls.push(String(type)); } catch (e) {} return f(type, opts); }; },
    set: function (fn) { _impl = fn; }
  });
})();
`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
await sleep(500);
await evalJs("(function(){var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var b=c.querySelector('#splash-confirm-ok');if(b)b.click();}return true;})()");
await sleep(900);
await evalJs("(function(){var a=document.querySelector('.tab[data-tab=\"chat\"]');if(a)a.click();return true;})()");
await sleep(800);
check('B0 进入聊天页（无头环境就绪）', await evalJs("!!document.getElementById('chat-body')"));

// 噪声全关：只留「词典逐条连发」这一个变量
const NOISE = { 'rn-prob': 0, 'touch-prob': 0, 'sticker-prob': 0, 'emoji-prob': 0, 'image-prob': 0, 'voice-prob': 0,
  'kaomoji-prob': 0, 'quote-prob': 0, 'rc-prob': 0, 'rc-refix': 0, 'cf-prob': 0, 'as-en': 0, 'call-incoming': 0,
  'ckq-en': 0, 'ai-rps-en': 0, 'ai-game-en': 0, 'ai-cuddle-en': 0, 'ai-cc-en': 0, 'desk-call-prob': 0, 'py-punct-en': 0,
  'rs-min': 1, 'rs-max': 2, 'reply-min': 1, 'reply-max': 1, 'py-en': 0, 'csp-cust': 100 };

async function setup(spellExpr, over) {
  await evalJs('(function(){var o=' + JSON.stringify(Object.assign({}, NOISE, over || {})) + ';for(var k in o)window.saveReplyCfg(k,o[k]);' +
    'window.getCustomCards=function(){return [];};' +
    'window.getDefaultCards=function(){return {type:"text",text:"底层一张卡"};};' +
    'window.getReplyCard=function(){return "";};' +
    'window.quoteSpellPick=' + spellExpr + ';' +
    'window.dreamFreePick=function(){return null;};window.tryTaMoodShare=function(){return null;};' +
    'window.maybeMusicRequest=null;window.callMaybeTrigger=null;window.maybeAutoGift=null;window.periodCheckCare=null;' +
    'window.triggerEmotionChain=function(){return null;};window.periodWarmText=null;' +
    // 通话/系统卡等独立定时器通道（call.js 自己排期，不受 chat.js 的 callMaybeTrigger 桩约束）
    // 会在观测窗里往聊天塞非词典收件——本脚本判据一律按「词典卡数＋其它非静默收件数＝音效次数」
    // 的恒等式算，这里再把这路噪声直接从源头掐掉，观测面只剩被测链路。
    'window.chatAddSystem=function(){return null;};' +
    'return true;})()');
}
const fixed = (segs, one) => 'function(){return ' + JSON.stringify({ segs, one }) + ';}';
async function sendAndCollect(waitMs) {
  await evalJs('window.__sfxCalls = []; window.__sp = 0; true');
  const startIdx = await evalJs('(((window.getChatMsgs&&window.getChatMsgs())||[]).length)');
  await evalJs("(function(){document.getElementById('chat-input').innerText='在吗';document.getElementById('chat-send').click();return true;})()");
  await sleep(waitMs || 15000);
  const calls = JSON.parse(await evalJs('JSON.stringify(window.__sfxCalls||[])') || '[]');
  const bubbles = JSON.parse(await evalJs("(function(){var ms=(window.getChatMsgs&&window.getChatMsgs())||[];var out=[];for(var i=" + startIdx + ";i<ms.length;i++){var r=ms[i];if(!r||r.side!=='in')continue;out.push({t:String(r.text||'').slice(0,28),sp:r.special||'',silent:!!r.silent,chips:(r.mood||[]).map(function(md){return (md&&md.tag)||'';}).join('|')});}return JSON.stringify(out);})()") || '[]');
  // 「其它非静默收件」＝观测窗里除词典卡以外、自己会响一声的正规收件（撤回墓碑/已读回执这类
  // 空文本或 special:'read' 的占位气泡不响音效，不能算进来，否则恒等式在 B5 场景下自己误红）
  const _loud = (b) => b.chips.indexOf('词典') < 0 && !b.silent && b.sp !== 'read' && String(b.t).trim() !== '';
  return { inCnt: calls.filter((t) => t === 'in').length, calls: calls.join(','), bubbles, dictCards: bubbles.filter((b) => b.chips.indexOf('词典') >= 0), otherLoud: bubbles.filter(_loud).length };
}

// B1 核心：三张卡逐条连发 → 三条气泡各响一次（修复前＝只响 1 声）
await setup(fixed(['连发一号卡', '连发二号卡', '连发三号卡'], false));
let r1 = await sendAndCollect();
check('B1 逐条连发 3 张卡 → 收件音效响 3 次（修复前 1 次）', r1.inCnt === 3 + r1.otherLoud && r1.dictCards.length === 3,
  'in=' + r1.inCnt + ' 其它非静默收件=' + r1.otherLoud + ' 气泡=' + r1.bubbles.map((b) => b.t).join('/'));
check('B2 连发首条仍免横幅、后续条 silent 原样保留（只解音效不解横幅）',
  r1.dictCards.length === 3 && r1.dictCards[0].silent === false && r1.dictCards[1].silent === true && r1.dictCards[2].silent === true,
  r1.dictCards.map((b) => b.silent ? 'silent' : 'loud').join(','));
check('B2b 连发每条气泡的「词典｜词典逐卡连发」chip 不受本批影响（#843/#726 口径）',
  r1.dictCards.length === 3 && r1.dictCards.every((b) => b.chips === '词典|词典逐卡连发'), r1.dictCards.map((b) => b.chips).join(','));

// B3/B4 对照组：silent 的默认语义不许被改宽
let n3 = await evalJs("(function(){window.__sfxCalls=[];window.chatAddIn('静默批量消息',{silent:true});var a=(window.__sfxCalls||[]).length;window.chatAddIn('普通收件消息');var b=(window.__sfxCalls||[]).length;return JSON.stringify([a,b]);})()");
let r34 = JSON.parse(n3 || '[]');
check('B3 silent 通道照旧不响（后台批量/静默通知默认仍免音效）', r34[0] === 0, 'count=' + r34[0]);
check('B4 不传 silent 的普通收件照常响一次（未被改坏）', r34[1] === 1, 'count=' + r34[1]);
let b4 = await evalJs("(function(){window.__sfxCalls=[];window.chatAddIn('免横幅但要音效',{silent:true,sfx:true});return JSON.stringify({n:(window.__sfxCalls||[]).length,silent:!!((window.getChatMsgs&&window.getChatMsgs())||[]).slice(-1)[0].silent});})()");
let r4 = JSON.parse(b4 || '{}');
check('B4b opts.sfx:true 单独放开音效、rec.silent 仍真（横幅仍免）', r4.n === 1 && r4.silent === true, JSON.stringify(r4));

// B5 撤回契约：命中部分撤回的连发整批静默（#553 不许回归）
await setup(fixed(['撤回甲一号卡', '撤回甲二号卡'], false), { 'rc-prob': 100 });
let r5 = await sendAndCollect(12000);
check('B5 命中撤回（rc-prob=100）的连发卡整批不响（#553 契约保持）',
  r5.dictCards.length === 2 && r5.dictCards.every((b) => b.silent === true) && r5.inCnt === r5.otherLoud,
  'in=' + r5.inCnt + ' 其它非静默收件=' + r5.otherLoud + ' calls=' + r5.calls + ' 本批落地=' + JSON.stringify(r5.bubbles.map((b) => b.t.slice(0, 12) + (b.silent ? '(s)' : ''))));

// B6 连发落在「多字卡回复」第 2 条及以后：旧版整批零声，现在每条都响
await setup("function(){window.__sp=(window.__sp||0)+1;return {segs:window.__sp===1?['连发甲一号卡','连发甲二号卡']:['连发乙一号卡','连发乙二号卡'],one:false};}",
  { 'py-en': 1, 'py-prob': 100, 'py-min': 2, 'py-max': 2, 'reply-min': 2, 'reply-max': 2 });
let r6 = await sendAndCollect(20000);
check('B6 两批各 2 张卡的连发 → 每条都响（修复前只响第 1 批首条 1 声）',
  r6.dictCards.length === 4 && r6.inCnt === r6.dictCards.length + r6.otherLoud,
  'in=' + r6.inCnt + ' 词典卡=' + r6.dictCards.length + ' 其它非静默收件=' + r6.otherLoud + ' 本批落地=' + JSON.stringify(r6.bubbles.map((b) => b.t.slice(0, 12) + (b.silent ? '(s)' : ''))));

// B7 词典单气泡拼字形态不受影响（一条气泡一声）
await setup(fixed(['拼字一号卡', '拼字二号卡'], true));
let r7 = await sendAndCollect(10000);
check('B7 词典单气泡拼字仍只响一次（一条气泡一声，未被本批改出双声）',
  r7.dictCards.length === 1 && r7.inCnt === 1 + r7.otherLoud,
  'in=' + r7.inCnt + ' 其它非静默收件=' + r7.otherLoud + ' calls=' + r7.calls + ' 本批落地=' + JSON.stringify(r7.bubbles.map((b) => b.t.slice(0, 12) + (b.silent ? '(s)' : ''))));

check('B8 全程零页面异常', (async () => true) && await evalJs('(window.__pageErrors||[]).length === 0'), await evalJs('JSON.stringify((window.__pageErrors||[]).slice(0,3))'));

try { chrome.kill(); } catch (e) {}
server.close();
try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
const failed = results.filter((r) => !r.ok);
console.log('\n结果：' + (results.length - failed.length) + '/' + results.length + ' 通过');
if (failed.length) { console.log('未通过：' + failed.map((f) => f.desc).join(' | ')); process.exit(1); }
