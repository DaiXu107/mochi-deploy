// ===== 专项：番茄钟倒计时结束铃声提示 =====
// 用法：node tools/verify-pomo-bell.mjs
// 背景（用户反馈：番茄钟倒计时结束没有铃声提示）：
//   pomoComplete() 原本只 vibrate 不出声。修复=pomoComplete 里补播一声内置
//   温馨铃（复用 sfx.js 暴露的 window.playBuiltinSfx('ring-warm')，固定播、
//   不跟随联系人音效设置——闹钟类功能静音设置下也应出声）。
// 验证方式：
//   A 组静态断言源码接线；B 组运行时用「包装 playBuiltinSfx 计数 + 短暂把
//   Date.now 拨快」让 250ms tick 立即判到到点，验证专注结束与休息结束都会响铃，
//   且今日 🍅 计数/状态文案正常流转。
// 自组装临时站点（同 verify-mail-cfg-per-cid 先例）：不依赖也不触发 node build.mjs，
// 多会话并行可安全跑。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// ---- A 组：源码静态断言 ----
{
  const s = readFileSync(join(root, 'src', 'js', 'p2-features.js'), 'utf8');
  const m = s.match(/function pomoComplete\(\)[\s\S]*?\n  \}/);
  const body = m ? m[0] : '';
  check('A1 pomoComplete 内已接入 window.playBuiltinSfx 铃声（try/catch 守卫）',
    /playBuiltinSfx\(['"]ring-warm['"],\s*false\)/.test(body) && /try \{[^}]*playBuiltinSfx/.test(body));
  // 顺序合理即可，不锁死精确位置
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

// 组装临时站点：index.html 由 src 源文件现场拼接（文件清单从 build.mjs 提取，防手抄漂移）
const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-pomobell-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let outHtml = '';
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  if (!/playBuiltinSfx\('ring-warm', false\)/.test(jsAll)) { console.error('JS 拼接缺少 p2-features 铃声接线'); process.exit(1); }
  outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
}
writeFileSync(join(tmpSite, 'index.html'), outHtml);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[ext(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
function ext(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i); }
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pomo-bell-' + Date.now()),
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
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(2300);
await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
await sleep(400);

// ---- B 组：运行时——包装铃声 API 计数；拨快 Date.now 让 tick 立即判到点 ----
// 页面隐藏不影响：#pomo-start 的监听器在 DOM 上，程序化 click 照常走完整完成链路。
const b1 = await evalJs(`(function(){
  try {
    var btn = document.getElementById('pomo-start');
    if (!btn) return 'no-btn';
    window.__bellCount = 0;
    var orig = window.playBuiltinSfx;
    if (!orig) return 'no-api';
    window.__bellOrig = orig;
    window.playBuiltinSfx = function(){ window.__bellCount++; return orig.apply(this, arguments); };
    // 先点开始（endAt 按真实时间落点），再拨快时钟——顺序反了会把 endAt 一起拨快
    btn.click();
    window.__realNow = Date.now;
    Date.now = function(){ return window.__realNow() + 3600000; }; // 拨快 1 小时
    return 'ok';
  } catch(e) { return 'err:' + e.message; }
})()`);
check('B1 启动专注并挂上铃声计数探针', b1 === 'ok', b1);
await sleep(1400); // 等 250ms tick 判到点并走完 pomoComplete
const b2 = JSON.parse(await evalJs(`(function(){
  Date.now = window.__realNow;
  return JSON.stringify({
    bell: window.__bellCount,
    stats: (document.getElementById('pomo-stats')||{}).textContent || '',
    state: (document.getElementById('pomo-state')||{}).textContent || '',
    time: (document.getElementById('pomo-time')||{}).textContent || ''
  });
})()`));
check('B2 专注到点响铃一次', b2 && b2.bell >= 1, b2 && { bell: b2.bell });
check('B3 完成后记一个今日 🍅（stats 含 × 1）', b2 && /× 1\b/.test(b2.stats || ''), b2 && b2.stats);
check('B4 完成后自动切到休息档（准备小憩/长休）', b2 && /^准备(小憩|长休)/.test(b2.state || ''), b2 && b2.state);

// B5：休息档到点同样响铃（同一条 pomoComplete 路径的另一半）
const b5 = await evalJs(`(function(){
  try {
    document.getElementById('pomo-start').click();
    Date.now = function(){ return window.__realNow() + 7200000; };
    return 'ok';
  } catch(e) { return 'err:' + e.message; }
})()`);
await sleep(1400);
const b6 = JSON.parse(await evalJs(`(function(){
  Date.now = window.__realNow;
  return JSON.stringify({
    bell: window.__bellCount,
    state: (document.getElementById('pomo-state')||{}).textContent || ''
  });
})()`));
check('B5 休息档也能启动并到点', b5 === 'ok', b5);
check('B6 休息结束再次响铃（累计 ≥2 次），回到准备专注', b6 && b6.bell >= 2 && /^准备专注/.test(b6.state || ''), b6);

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);
