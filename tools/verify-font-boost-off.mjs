// ===== 回归脚本：#827 关壳内核「智能字体放大」（base.css 通配双保险：前缀 none＋标准 100%） =====
// 背景（用户实报）：「屏幕适配微调→按住看默认」后全部字体变大且无法恢复原状——面板各轴 CSS 变量
//   只作用气泡/输入框/设置行，管不到「全部字体」；源头是壳内核（X5/XWeb 等）按文本块逐个计算的
//   字号膨胀（font boosting / text autosizing），按住期间全轴归零的布局跳变点亮大档、松手后不回。
//   text-size-adjust 可继承，html,body 的 100% 已护住标准引擎全站；老壳内核（X5/XWeb 系）字体漫游认
//   带前缀的 none、新 Chromium 解析期丢弃 none 令牌 → 通配双保险：前缀 none 给老壳、标准 100% 给新引擎。
// 断言：
//   S1 产物含通配规则 `* { -webkit-text-size-adjust:none; text-size-adjust:100%; }`（恰 1 处；判别力主锚——新引擎丢弃 none 令牌，运行时 computed 两侧同值，唯产物锚可分红绿）。
//   S2 v3.5.105 的 html,body 100% 行仍在（iOS 横竖屏防线不 regress）。
//   A1 运行时：抽查后代元素 computed 全为 100%（新引擎落标准钉、放大无落点；老壳私有实现无头证不了）。
//   A2 运行时：html 自身仍为 100%（两条规则互不踩踏）。
//   A3 零视觉差：设置行文字 computed fontSize 仍 14px（关放大不改页面自身字号）。
//   Z  全程无新增 JS 异常。
// 用法：node tools/verify-font-boost-off.mjs [--root <目录>]（需本机 Chrome/Edge，CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArgIdx = process.argv.indexOf('--root');
const root = normalize((rootArgIdx > -1 ? process.argv[rootArgIdx + 1] : dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fb827-' + Date.now()),
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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const RULE = '* { -webkit-text-size-adjust:none; text-size-adjust:100%; }';
const built = readFileSync(join(root, 'index.html'), 'utf8');
const hits = built.split('\n').filter((l) => l.trim() === RULE).length;
check('S1 产物含通配双保险规则（前缀 none＋标准 100%，恰 1 处）', hits === 1, 'count=' + hits);
check('S2 html,body 100% 行仍在（iOS 横竖屏防线不 regress）', built.includes('-webkit-text-size-adjust:100%; text-size-adjust:100%;'));

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 30; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
const probe = await evalJs(`(function(){
  var g = function (el) { return el ? getComputedStyle(el) : null; };
  var samples = [
    document.querySelector('.set-row .txt'),
    document.querySelector('.app-label, #app-grid > *, .widget'),
    document.querySelector('.phone'),
    document.querySelector('.ch-name, .tabbar button, .tabbar')
  ].filter(Boolean);
  var sa = samples.map(function (el) { return g(el).webkitTextSizeAdjust || g(el).getPropertyValue('-webkit-text-size-adjust'); });
  var htmlSA = g(document.documentElement).webkitTextSizeAdjust;
  var txt = document.querySelector('.set-row .txt');
  return JSON.stringify({
    sa: sa, n: samples.length, htmlSA: htmlSA,
    txtFs: txt ? g(txt).fontSize : null,
    errs: (window.__jsErrors || []).length
  });
})()`);
const v = JSON.parse(probe || '{}');
check('A1 后代元素 computed 全为 100%（新引擎落标准钉、放大无落点）', v.n >= 3 && v.sa && v.sa.every((x) => x === '100%'), probe);
check('A2 html 自身仍 100%（两条规则互不踩踏）', v.htmlSA === '100%', 'html=' + v.htmlSA);
check('A3 零视觉差：设置行文字仍 14px', v.txtFs === '14px', 'fontSize=' + v.txtFs);
check('Z 全程无新增 JS 异常', v.errs === 0, 'errors=' + v.errs);

server.close();
chrome.kill();
const pass = results.filter(r => r.ok).length;
console.log('---');
console.log('通过 ' + pass + '/' + results.length);
process.exit(pass === results.length ? 0 : 1);
