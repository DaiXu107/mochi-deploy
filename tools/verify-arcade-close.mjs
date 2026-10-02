// ===== 专项验证：游乐室半框 × 必须能关掉（#308）=====
// 用法：node tools/verify-arcade-close.mjs   （跑的是仓库根目录产物 index.html；未构建时本脚本会红，红的是产物不是源码）
//
// 背景（#308，2026-09-11 用户报「游乐室右边的×点击关不掉」，多机型复现）：
//   arcade.js 取到了 #arc-close（closeBtn）却从未给它绑 click 事件——按钮纯摆设，
//   与设备/机型无关，任何浏览器都关不掉（点 × 面板不动）。其余半框（红包/猜拳/
//   游戏九连）都在各自文件里绑了 close 按钮，唯独游乐室漏绑。
// 断言：
//   A 静态：src/js/arcade.js 里有 closeBtn click 绑定逻辑锚；
//   B 行为：more-arcade 开面板 → 点 #arc-close → panel.hidden=true；
//     再开 → 再点 × → 仍能关（关闭后重开链路不坏）；旁边红包面板的 × 不受影响（对照）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- A 组：静态断言（src 层逻辑锚，有牙：删绑定立刻红） ----
const arcSrc = readFileSync(join(root, 'src', 'js', 'arcade.js'), 'utf8');
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const BOUND = "closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });";
check('A1 src/js/arcade.js 有 #arc-close click 绑定（删则 × 点了没反应）', arcSrc.indexOf(BOUND) >= 0);
check('A2 closePanel 仍挂 window.closeArcadePanel（别处可能的关闭入口不回归）', arcSrc.indexOf('window.closeArcadePanel = closePanel') >= 0);

// ---- 行为断言跑产物 ----
let artifactFresh = true;
try {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  artifactFresh = html.indexOf(BOUND) >= 0;
  if (!artifactFresh) console.log('⚠️  产物 index.html 不含 #308 关闭绑定（旧产物）——先 node build.mjs 再看 B 组结果');
} catch (e) { artifactFresh = false; }

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

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket），当前 ' + process.version); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-arc-close-' + Date.now()),
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(700);

// ---- B 组：行为断言（产物） ----
// v3.26.x：游乐室入口已从「聊天更多功能 more-arcade 半框」改为「主页页入口卡 → 独立全屏页 page-arcade」，
// 旧半框 #chat-arcade-panel 已废弃——本组改测新路径：主页入口卡打开 → page-arcade 显 → arcade-back 返回 → 重开。
const goHome = "(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-phone');});return true;})()";
const openArc = goHome + ";(function(){var e=document.getElementById('home-arcade-entry');if(e)e.click();return true;})()";
await evalJs(openArc);
await sleep(500);
let r = J(await evalJs("(function(){var pg=document.getElementById('page-arcade'),bk=document.getElementById('arcade-back');return JSON.stringify({open:pg&&!pg.hidden,back:!!bk,backVisible:!!bk&&bk.offsetParent!==null});})()"));
check('B1 主页入口卡打开游乐室全屏页、返回按钮在且可见', r.open === true && r.back === true && r.backVisible === true, JSON.stringify(r));

r = J(await evalJs("(function(){var bk=document.getElementById('arcade-back');bk.click();var pg=document.getElementById('page-arcade');return JSON.stringify({hidden:pg.hidden});})()"));
await sleep(150);
r = J(await evalJs("(function(){var pg=document.getElementById('page-arcade');return JSON.stringify({hidden:pg.hidden});})()"));
check('B2 点返回全屏页收起（关闭链路不坏）', r.hidden === true, JSON.stringify(r));

await evalJs(openArc);
await sleep(500);
r = J(await evalJs("(function(){var pg=document.getElementById('page-arcade');var bk=document.getElementById('arcade-back');var wasOpen=!pg.hidden;bk.click();return JSON.stringify({reopen:wasOpen,hiddenAfter:pg.hidden});})()"));
check('B3 关掉后能重开、再点返回仍能关', r.reopen === true && r.hiddenAfter === true, JSON.stringify(r));

// 对照组：旁边红包面板的 × 不受影响（同款 .poke-card-close 既有链路）
await evalJs("(function(){document.getElementById('chat-more-panel').hidden=false;var b=document.getElementById('more-rps');if(b)b.click();return true;})()");
await sleep(350);
r = J(await evalJs("(function(){var p=document.getElementById('chat-rps-panel');return JSON.stringify({rpsOpen:p&&!p.hidden});})()"));
check('B4 对照：猜拳半框照常打开（相邻功能没被改坏）', r.rpsOpen === true, JSON.stringify(r));

const errs = J(await evalJs('JSON.stringify(window.__jsErrors || [])'));
check('C1 运行期零未捕获 JS 错误', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs).slice(0, 200));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fail = results.filter((x) => !x.ok).length;
console.log(fail ? '\n✗ ' + fail + '/' + results.length + ' 断言失败' : '\n✓ ' + results.length + '/' + results.length + ' 断言全过');
process.exit(fail ? 1 : 0);
