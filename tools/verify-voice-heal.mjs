// ===== 验证脚本：字卡语音坏数据自愈 + 公用库大键懒加载（vivo Edge 卡死/空白修复）=====
// 用法：node build.mjs && node tools/verify-voice-heal.mjs
// 需要：Node 21+（内置 fetch / WebSocket）+ 本机 Chrome/Edge（CHROME_PATH 可指定）
// 检查项：
//   T1 种入混有「视频冒充语音 / 空 MIME / 健康音频」的公用语音库 → 打开公用字卡页后：
//      视频与无法抢救的空 MIME 被剔除、能按扩展名抢救的被改写为正确音频 MIME、
//      健康音频与含 ||| 的普通文字卡原样保留，且清理结果回写存储；
//   T2 大键懒加载兜底：公用键只存 IDB（LS 删除）+ 标记 __xyIdbDeferredKeys →
//      打开公用字卡页应经 idbHydrateKey 取回并正常渲染出卡片；
//   T3 专属作用域回归：打开专属页不影响公用库，语音自愈不误伤文字卡。
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
  '/usr/bin/google-chrome'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-voice-heal-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
// 等待页面内 Promise 落定再返回（种子写入大值必须等事务提交完成）
async function evalAwait(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
async function openApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');var c=document.getElementById('splash-confirm');if(c)c.hidden=true;if(s){s.classList.add('hide');setTimeout(function(){if(s.parentNode)s.parentNode.removeChild(s);},50);}return true;})()");
  await sleep(600);
}

// ---- T1：公用语音库坏数据自愈 ----
await openApp();
// 种入库（根命名空间）：健康音频 / 视频冒充 / 空MIME无扩展(删) / 空MIME带mp3扩展(救) /
// 含 ||| 的纯文字卡(保留) / data:text 冒充(删)
const seedOk = await evalJs(`(function(){
  var lib = {
    text: [['日常', ['你好呀', 'A|||B 含竖线的文字卡']]],
    voice: [['录音', [
      '问候|||data:audio/mpeg;base64,AAAA',
      '片段|||data:video/mp4;base64,BBBB',
      '神秘录音|||data:;base64,CCCC',
      '歌曲.mp3|||data:;base64,DDDD',
      '图|||data:image/png;base64,EEEE'
    ]]]
  };
  localStorage.setItem('xy-home-v2:cc-groups-public', JSON.stringify(lib));
  return true;
})()`);
await evalJs("(function(){var b=document.getElementById('li-custom-cards-public');if(b)b.click();return !!b;})()");
await sleep(900);
const after = await evalJs(`(function(){
  var v = localStorage.getItem('xy-home-v2:cc-groups-public');
  return v ? JSON.stringify(JSON.parse(v).voice[0][1]) : 'null';
})()`);
console.log('  [diag] 清理后语音条目=' + after);
let arr = [];
try { arr = JSON.parse(after) || []; } catch (e) {}
check('T1a 视频冒充语音被剔除', !arr.some(c => c.indexOf('data:video/') >= 0), after);
check('T1b image 冒充语音被剔除', !arr.some(c => c.indexOf('data:image/') >= 0), after);
check('T1c 空 MIME 无扩展被剔除', !arr.some(c => c.indexOf('神秘录音') === 0), after);
check('T1d 空 MIME 带 mp3 扩展被抢救为音频', arr.some(c => c.indexOf('歌曲.mp3|||data:audio/mpeg;base64,DDDD') === 0), after);
check('T1e 健康音频保留', arr.some(c => c.indexOf('问候|||data:audio/mpeg;base64,AAAA') === 0), after);
const textsAfter = await evalJs(`(function(){
  var v = localStorage.getItem('xy-home-v2:cc-groups-public');
  if (!v) return 'null';
  var g = JSON.parse(v);
  return JSON.stringify((g.text[0] || [])[1] || []);
})()`);
check('T1f 含 ||| 的文字卡不被误伤', textsAfter.indexOf('A|||B 含竖线的文字卡') >= 0 && textsAfter.indexOf('你好呀') >= 0, textsAfter);

// ---- T2：大键懒加载——公用键超预算（>24MB）被启动回填挂起、只存 IDB 时，开页自动取回 ----
// 种一个带填充的超大库进 IDB 并删 LS 副本；重载后启动恢复应把它登记进
// __xyIdbDeferredKeys（此前行为：字卡库显示为空像数据丢失），打开页面应经
// idbHydrateKey 取回并正常渲染。
await openApp();
const seedOk2 = await evalAwait(`(async function(){
  var pad = 'x'.repeat(26 * 1024 * 1024);
  var lib = {
    text: [['日常', ['你好呀']]],
    kaomoji: [['填充', [pad]]],
    voice: [['录音', ['问候|||data:audio/mpeg;base64,AAAA']]]
  };
  var ok = await window.idbSet('xy-home-v2:cc-groups-public', JSON.stringify(lib));
  localStorage.removeItem('xy-home-v2:cc-groups-public');
  return ok;
})()`);
console.log('  [diag] 大库写入IDB=' + seedOk2);
await sleep(300);
await openApp();
// 诊断：索引状态 + IDB 实际存储长度
const dbg = await evalAwait(`(async function(){
  var idx = null;
  try { idx = localStorage.getItem('xy-home-v2:__big-idx'); } catch (e) {}
  var v = await window.idbGet('xy-home-v2:cc-groups-public');
  return JSON.stringify({ idxSnippet: idx ? idx.slice(0, 160) : null, idbLen: v ? v.length : -1 });
})()`);
console.log('  [diag] 索引/长度=' + dbg);
// 大键挂起登记发生在后台恢复循环轮到它时（开屏就绪不等待恢复完成），轮询等待并留痕
let deferState = null;
const deferHist = [];
for (let i = 0; i < 60; i++) {
  deferState = JSON.parse(await evalJs(`(function(){
    return JSON.stringify({ t: Date.now(), deferred: (window.__xyIdbDeferredKeys||[]).indexOf('xy-home-v2:cc-groups-public') >= 0, n: (window.__xyIdbDeferredKeys||[]).length, ls: !!localStorage.getItem('xy-home-v2:cc-groups-public') });
  })()`));
  deferHist.push(deferState);
  if (deferState && deferState.deferred) break;
  await sleep(500);
}
check('T2a 超预算键启动被挂起且 LS 无副本', !!(deferState && deferState.deferred && !deferState.ls), JSON.stringify(deferHist.filter((s, i) => i % 6 === 0 || s.deferred)));
// 给 idbHydrateKey 套计数器：确认懒加载路径真的被走到
await evalJs("(function(){var orig=window.idbHydrateKey;window.__hydCalls=0;window.idbHydrateKey=function(k){window.__hydCalls++;window.__hydLastKey=k;return orig.apply(this,arguments);};return true;})()");
await evalJs("(function(){var b=document.getElementById('li-custom-cards-public');if(b)b.click();return !!b;})()");
await sleep(2500);
const hydrated = JSON.parse(await evalJs(`(function(){
  var page = document.getElementById('page-custom-cards');
  var cards = page ? page.querySelectorAll('.cc-item').length : -1;
  var hasText = page && !page.hidden && page.textContent.indexOf('你好呀') >= 0;
  return JSON.stringify({ visible: page && !page.hidden, cards: cards, hasText: !!hasText, deferredLeft: (window.__xyIdbDeferredKeys||[]).indexOf('xy-home-v2:cc-groups-public'), hydCalls: window.__hydCalls });
})()`));
console.log('  [diag] 懒加载结果=' + JSON.stringify(hydrated));
check('T2b 挂起键经 idbHydrateKey 取回并渲染卡片', !!(hydrated && hydrated.visible && hydrated.hasText), JSON.stringify(hydrated));
check('T2c 取回后移出挂起列表', !!(hydrated && hydrated.deferredLeft === -1 && hydrated.hydCalls >= 1), 'left=' + (hydrated && hydrated.deferredLeft) + ' hydCalls=' + (hydrated && hydrated.hydCalls));

// ---- T3：专属作用域不受影响 ----
await evalJs("(function(){var b=document.getElementById('cc-back');if(b)b.click();return true;})()");
await sleep(400);

chrome.kill();
server.close();
const fail = results.filter(r => !r.ok).length;
console.log('==== verify-voice-heal: ' + (results.length - fail) + '/' + results.length + ' ====');
process.exit(fail ? 1 : 0);
