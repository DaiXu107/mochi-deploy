// ===== 验证电池 #1182：开屏第二页（作者必读公告）白屏根治 =====
// 用户实报「为什么开屏第二页的公告变成白屏了」。根因＝#913 后台暂停类（body.mochi-bg-pause，
// document.hidden 时暂停所有 CSS 动画）把第二页卡片的 splash-fade-up 入场淡入冻在全透明第 0 帧
// ＝5 张卡全隐＝整页白、滑不到底进不去（部分内核 hidden 误判时前台也中招）。
// 修复＝删除该卡入场动画（可见性不再依赖动画播完）。
// 判别面：同一操作序列（先挂暂停类→再显示第二页→量卡片 opacity）在修复前红（opacity:0＝白屏
// 复现）、修复后绿（opacity:1）。跑法：node tools/verify-1182-splash-p2-white.mjs（在本目录根）。
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
];
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(2); }

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// —— 静态断言（不依赖浏览器）——
const html = readFileSync(join(root, 'index.html'), 'utf8');
check('A1 产物里第二页卡的入场淡入行已删（absent 面，与 build.mjs #1182a 同锚）',
  !html.includes('animation:splash-fade-up .5s ease backwards;'));
check('A2 第二页结构完整：必读卡一张没少（防「整块删卡」假绿；张数会随内容批次增长，故按「至少五张＋五张原始标题都在」判）',
  (() => {
    const seg = html.slice(html.indexOf('id="splash-mandatory"'), html.indexOf('splash-mandatory-foot', html.indexOf('id="splash-mandatory"')));
    const n = (seg.match(/splash-mandatory-card/g) || []).length;
    const titles = ['月底停更，说点心里话', '关于不再更新网站后的建议', '关于让 AI 修，先说清楚几句', '一些其他事情', '关于「收费」，一并说清楚'];
    return n >= 5 && titles.every((t) => seg.includes(t));
  })(), 'card=' + (html.slice(html.indexOf('id="splash-mandatory"'), html.indexOf('splash-mandatory-foot', html.indexOf('id="splash-mandatory"'))).match(/splash-mandatory-card/g) || []).length);
check('A3 splash-fade-up 关键帧与 #913 暂停机制未被动过（只摘本页依赖，不伤别处入场/省电）',
  html.includes('@keyframes splash-fade-up') && html.includes('body.mochi-bg-pause *'));

// —— 行为断言（无头 Chrome 真渲染）——
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

const cdpPort = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1182-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) { try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
  } catch (e) {} await sleep(150); }
  try { server.close(); } catch (e) {} try { chrome.kill(); } catch (e) {}
  console.error('无法连接无头浏览器'); process.exit(2);
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return null; return r && r.result ? r.result.value : null; } catch (e) { return null; } }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

// B1 复现路径：先挂后台暂停类（模拟 hidden 误判/后台期显示），再显示第二页 → 卡片必须全部可见
const paused = await evalJs(`(function(){
  document.body.classList.add('mochi-bg-pause');
  var m=document.getElementById('splash-mandatory'); m.hidden=false;
  return new Promise(function(res){ setTimeout(function(){
    var cards=[].slice.call(document.querySelectorAll('#splash-mandatory .splash-mandatory-card'));
    res(JSON.stringify(cards.map(function(c){return getComputedStyle(c).opacity;})));
  }, 900); });
})()`);
let ops = []; try { ops = JSON.parse(paused || '[]'); } catch (e) {}
check('B1 暂停类挂上时显示第二页：所有必读卡 opacity 全为 1（白屏复现面＝红侧为 0；#1215b 起卡片张数随批次增长，按 ≥5 判，折叠块内的卡收起时不渲染但仍须为 1）',
  ops.length >= 5 && ops.every((o) => Number(o) === 1), (ops.join(',') || 'no-data'));

// B2 到底判定可用：滑到底后确认按钮解除置灰（白屏时用户卡死的那道门）
const gate = await evalJs(`(function(){
  var sc=document.getElementById('splash-mandatory-scroll'); sc.scrollTop=sc.scrollHeight;
  sc.dispatchEvent(new Event('scroll'));
  return new Promise(function(res){ setTimeout(function(){
    var en=document.getElementById('splash-mandatory-enter');
    res(JSON.stringify({disabled:en.classList.contains('is-disabled'), sh:sc.scrollHeight>0}));
  }, 300); });
})()`);
let g = {}; try { g = JSON.parse(gate || '{}'); } catch (e) {}
check('B2 滑到底后「我已阅读并确认进入」解除置灰（门控可用，不因渲染问题卡死）',
  g.sh === true && g.disabled === false, gate || 'no-data');

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
