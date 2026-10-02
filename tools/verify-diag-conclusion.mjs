// ===== 回归：#528 诊断置顶结论聚合 + 桌面模拟器外壳底部几何误报豁免 =====
// 用法：node build.mjs && node tools/verify-diag-conclusion.mjs
// 背景：①PC 宽屏下 .phone 是「居中手机壳」（base.css min(844px, calc(100dvh - 48px))，
//   body 上下 padding 各 24px 属设计），但屏幕适配判定 expBase 取 innerH → 恒报
//   「底部少填 ~24px 白带」，桌面用户每次自动采集刷错误环。②错误/启动异常/模块未加载/
//   入口缺失/存储/屏幕适配 ✗ 散在十几节，用户看不出「到底坏没坏」。
// 修复：①screenDiagJudge 对 isMobileDev===false（桌面外壳）跳过底部贴合/底导航判定；
//   ②collectDiag 在【更新状态】前加【结论】行，snap 时按当前 L ＋屏幕适配 ✗ 重算。
// 断言（桌面 1432×841 无头）：
//   A1 屏幕适配判定出现「桌面模拟器外壳」豁免行（豁免生效）
//   A2 屏幕适配无「底部少填/底部超出/底部导航栏」误报
//   B1 诊断文本含【结论】段
//   B2 正常态结论为「未发现明显异常…」
//   C1 摘掉一个已加载模块后，结论转为「模块未加载 …chat.js」
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9970 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-528-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 桌面外壳：宽视口 + 非 mobile
await cdp('Emulation.setDeviceMetricsOverride', { width: 1432, height: 841, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(250); }
await evalJs("(function(){var s=document.getElementById('splash');if(s)s.click();return true;})()");
await sleep(800);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// A 段：桌面外壳豁免
const isMobileDev = await evalJs('!!(window.mochiDevice && window.mochiDevice.isMobile)');
check('A0 桌面视口下判定为非手机布局（前置条件）', isMobileDev === false, 'isMobile=' + isMobileDev);
const sd = JSON.parse(await evalJs("(function(){try{var r=window.__collectScreenDiag?window.__collectScreenDiag():null;if(!r)return 'null';var ok=(r.findings||[]).filter(function(f){return f.ok;}).map(function(f){return f.name;});var bad=(r.findings||[]).filter(function(f){return !f.ok;}).map(function(f){return f.name;});return JSON.stringify({ok:ok,bad:bad});}catch(e){return JSON.stringify({err:e.message});}})()") || 'null');
check('A1 屏幕适配出现「桌面模拟器外壳」豁免行',
  !!sd && Array.isArray(sd.ok) && sd.ok.some((n) => n.indexOf('桌面模拟器外壳') >= 0),
  sd ? JSON.stringify(sd.ok.filter((n) => n.indexOf('桌面') >= 0)) : 'null');
const badBottom = sd && Array.isArray(sd.bad) ? sd.bad.filter((n) => /底部少填|底部超出|底部导航栏/.test(n)) : ['<no-data>'];
check('A2 屏幕适配无「底部少填/底部超出/底部导航栏」误报', badBottom.length === 0, JSON.stringify(badBottom));

// 打开诊断并读取文本
async function openDiagText() {
  await evalJs("(function(){var r=document.getElementById('row-diagnostics');if(r)r.click();return !!r;})()");
  let txt = '';
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    txt = await evalJs("(function(){var t=document.getElementById('modal-textarea');return t&&!t.hidden?t.value:(window.__t528||'');})()") || '';
    if (txt.indexOf('【结论】') >= 0 && txt.indexOf('模块加载体检') >= 0 && txt.indexOf('读取中…') < 0) break;
  }
  return txt;
}
async function closeDiag() {
  await sleep(500);
  await evalJs("(function(){var m=document.getElementById('modal-mask');if(m)m.click();return true;})()");
  await sleep(400);
}
function conclusionLine(txt) {
  const lines = String(txt).split('\n');
  const i = lines.findIndex((l) => l.trim() === '【结论】');
  return i >= 0 ? (lines[i + 1] || '').trim() : null;
}
async function reloadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(250); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s)s.click();return true;})()");
  await sleep(700);
}

// B 段：结论存在且正常态
const txt1 = await openDiagText();
check('B1 诊断文本含【结论】段', txt1.indexOf('【结论】') >= 0, '');
const cl1 = conclusionLine(txt1);
check('B2 正常态结论为「未发现明显异常…」', cl1 !== null && cl1.indexOf('未发现明显异常') >= 0, cl1);

// C 段：重载后摘掉模块 → 结论聚合（重载保证弹窗状态干净、collectDiag 重新构建）
await reloadApp();
const spliced = await evalJs("(function(){try{var i=window.__mochiLoaded.indexOf('chat.js');window.__t528saved=i>=0?window.__mochiLoaded.splice(i,1)[0]:null;return !!window.__t528saved;}catch(e){return false;}})()");
check('C0 前置：已从 __mochiLoaded 摘掉 chat.js', spliced === true, '');
const txt2 = await openDiagText();
const cl2 = conclusionLine(txt2);
check('C1 摘掉 chat.js 后结论聚合出「模块未加载 …chat.js」',
  cl2 !== null && cl2.indexOf('模块未加载') >= 0 && cl2.indexOf('chat.js') >= 0, cl2);
check('C2 结论同样带「模块加载体检」明细行', txt2.indexOf('模块加载体检') >= 0 && /未加载\s*chat\.js/.test(txt2), '');
await evalJs("(function(){try{if(window.__t528saved)window.__mochiLoaded.push(window.__t528saved);return true;}catch(e){return false;}})()");

const failed = results.filter(r => !r.ok);
console.log('\n===== 回归结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);
