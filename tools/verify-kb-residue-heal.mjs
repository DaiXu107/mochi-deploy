// ===== 验证脚本：#209 键盘收起焦点保留·停靠残留自愈（输入栏下方灰底「断截面」） =====
// 用法：node tools/verify-kb-residue-heal.mjs（构建后跑；修复未构建时 S0/S1 红=属预期）
// 需要：Node 21+（内置 fetch / WebSocket）+ 本机 Chrome/Edge（CHROME_PATH 可指定）
//
// 背景（FIX-REGRESSION #209）：安卓返回键/手势收键盘不派 blur（或 #197 族 focusout
// 丢失）时，healViewport 的无条件复原分支被 !foc 挡死 → 键盘期停靠残留（.phone
// 内联收缩高度/顶对齐）卡死 → 输入栏下方露出 body 底色灰条（红米 K70+Edge 实报，
// #141/#207 同族第 N 次复发）。修复 = 可视区双信号回满（vv.height 与 innerHeight
// 距无键盘基线 ≤12px）时，焦点在不在都走复原分支。
//
// 场景：
//   S0 逻辑锚点：产物含 #209 修复表达式（哨兵同源）
//   S1 【本 bug】聊天页焦点保留 + 停靠残留 → ≤4s 自愈贴底（旧产物必红=修复缺失）
//   S2 模拟键盘收缩态（412×455）残留不被误复原 + 视口还原后自愈（机器健康路径零回归）
//   S3 无焦点 + 残留 → 既有 !foc 复原路径仍生效（回归保护）
//   S4 健康态零写入（.phone 无内联残留、恒贴底）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- S0：逻辑锚点（与 build.mjs 哨兵同 needle）----
const FIX_NEEDLE = 'if (_hNow <= 0 || _hNow < _aH - 12) return;';
let built = '';
try { built = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
check('S0 产物含 #209 修复逻辑锚点', built.includes(FIX_NEEDLE), built.includes(FIX_NEEDLE) ? '在' : '缺（修复未构建属预期）');

// ---- 找浏览器 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

// ---- 静态服务器 ----
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

// ---- 无头 Chrome + CDP ----
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9300 + Math.floor(Math.random() * 500));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-kbheal-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(900);

// 进聊天页（tabs.js MutationObserver 自动挂 no-statusbar=贴底形态）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(600);

// 聚焦聊天输入框（contenteditable，触发 focusin；安卓真机收键盘后焦点常保留——本 bug 前提）
const foc = await evalJs("(function(){var i=document.getElementById('chat-input');if(!i)return 'no-input';i.focus();return document.activeElement===i?'focused':'not-focused';})()");

async function plantResidue() {
  return evalJs("(function(){var ph=document.querySelector('.phone');ph.style.height='455px';ph.style.alignSelf='flex-start';return true;})()");
}
async function residueState() {
  return evalJs("(function(){var ph=document.querySelector('.phone');var pr=ph.getBoundingClientRect();var ir=document.querySelector('#page-chat .chat-input-row');var rr=ir?ir.getBoundingClientRect():null;return JSON.stringify({inlineH:ph.style.height||'',inlineAS:ph.style.alignSelf||'',phoneBottom:Math.round(pr.bottom),inputBottom:rr?Math.round(rr.bottom):-1,inner:innerHeight});})()");
}
async function waitHeal(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = JSON.parse(await residueState() || '{}');
    if (!s.inlineH && !s.inlineAS) return true;
    await sleep(250);
  }
  return false;
}

// ---- S1：焦点保留 + 停靠残留 → 看门狗自愈贴底（本 bug；旧产物必红）----
check('S1 前提：输入框聚焦被保留', foc === 'focused', foc);
await plantResidue();
await sleep(200);
let s1 = JSON.parse(await residueState() || '{}');
check('S1 前提：残留已种上（.phone 底边悬空）', s1.phoneBottom < s1.inner - 100, 'bottom=' + s1.phoneBottom + '/inner=' + s1.inner);
const healed1 = await waitHeal(4000);
s1 = JSON.parse(await residueState() || '{}');
check('S1 残留内联样式 ≤4s 被清理', healed1, 'inlineH=' + JSON.stringify(s1.inlineH));
check('S1 .phone 贴回视口底（灰底消失）', Math.abs(s1.phoneBottom - s1.inner) <= 2, 'bottom=' + s1.phoneBottom + '/inner=' + s1.inner);
check('S1 聊天输入栏贴底', Math.abs(s1.inputBottom - s1.inner) <= 2, 'inputBottom=' + s1.inputBottom + '/inner=' + s1.inner);

// ---- S2：模拟键盘收缩态（resizes-content）残留不被误复原；还原后自愈 ----
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 455, deviceScaleFactor: 2.625, mobile: true });
await sleep(800); // 让 syncIosKb / _a 机器按真实事件接管
const planted2 = await plantResidue();
await sleep(1500);
let s2 = JSON.parse(await residueState() || '{}');
const stillDocked = (s2.inlineH && s2.inlineH !== '455px') || s2.phoneBottom <= s2.inner - 100; // 机器接管重写=正常停靠
check('S2 键盘收缩态残留未被误清（门控生效）', planted2 && (s2.inlineH !== '' || stillDocked), JSON.stringify({ inlineH: s2.inlineH, bottom: s2.phoneBottom, inner: s2.inner }));
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
await sleep(800);
const healed2 = await waitHeal(4000);
s2 = JSON.parse(await residueState() || '{}');
check('S2 视口还原后贴底复原', healed2 && Math.abs(s2.phoneBottom - s2.inner) <= 2, 'bottom=' + s2.phoneBottom + '/inner=' + s2.inner);

// ---- S3：无焦点 + 残留 → 既有 !foc 复原路径仍生效 ----
await evalJs("(function(){if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();return true;})()");
await sleep(300);
await plantResidue();
const healed3 = await waitHeal(4000);
let s3 = JSON.parse(await residueState() || '{}');
check('S3 无焦点残留仍走既有复原路径', healed3 && Math.abs(s3.phoneBottom - s3.inner) <= 2, 'bottom=' + s3.phoneBottom + '/inner=' + s3.inner);

// ---- S4：健康态零写入 ----
await sleep(1200);
const s4 = JSON.parse(await residueState() || '{}');
check('S4 健康态无内联残留、恒贴底', !s4.inlineH && !s4.inlineAS && Math.abs(s4.phoneBottom - s4.inner) <= 2, JSON.stringify(s4));

chrome.kill(); server.close();
const fails = results.filter((r) => !r.ok).length;
console.log('----\n' + (results.length - fails) + '/' + results.length + ' 通过');
process.exit(fails ? 1 : 0);
