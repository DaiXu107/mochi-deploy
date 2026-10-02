// 回归：聊天半框（邀请TA/问问TA/搜索记录等 .poke-card 家族）在安卓键盘弹出后
// 必须仍停靠在输入栏上方，不得掉到输入栏下方（键盘后面）。
// 根因（v3.10.x 修复前）：.poke-card/.more-panel/.emoji-card 是 position:fixed——
//   安卓 interactive-widget=resizes-visual 下键盘只缩 visualViewport 不缩 layout
//   viewport；syncAndroidKb 把 .phone 收缩到可视高 → 输入栏上移停靠键盘上方，
//   而 fixed 半框仍锚定全高 layout viewport 原地不动 = 升起后的输入栏下方。
//   打开即自动聚焦的三个功能（邀请TA/问问TA 80ms、搜索记录 60ms）首当其冲：
//   面板一打开键盘就弹出，直接呈现「页面跑到输入栏下方」。
// 修复：三者基础规则改 position:absolute——锚定收缩中的 .phone/#page-chat，
//   键盘弹出时随容器一起停靠。手机满屏时 absolute 与 fixed 几何等价。
// 模拟方式：页面脚本运行前在真实 visualViewport 实例上盖可写 height（实例属性
//   遮蔽原型 getter，对象身份不变），改值后手动 dispatch resize 驱动真实键盘链路。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9640 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vkbd-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }); return r && r.result ? r.result.value : null; }

let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('PASS', name, extra || ''); } else { fail++; console.log('FAIL', name, extra || ''); } }

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  let h = vv.height;
  try {
    Object.defineProperty(vv, 'height', { get: () => h, configurable: true });
    window.__setVvHeight = (v) => { h = v; vv.dispatchEvent(new Event('resize')); };
  } catch (e) {}
})();
` });

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
await evalJs(`document.getElementById('splash-confirm-ok')?.click()`);
await sleep(800);
await evalJs(`(function(){document.querySelectorAll('.page').forEach(p=>p.hidden=true);document.getElementById('page-chat').hidden=false;})()`);
await sleep(400);

const MEASURE = `(() => {
  const el = ['chat-ask-panel','chat-search','chat-decision-panel'].map(id => document.getElementById(id)).find(e => e && !e.hidden && getComputedStyle(e).display !== 'none');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const ir = document.querySelector('#page-chat .chat-input-row').getBoundingClientRect();
  return { id: el.id, pos: getComputedStyle(el).position, pt: Math.round(r.top), pb: Math.round(r.bottom), it: Math.round(ir.top), ib: Math.round(ir.bottom) };
})()`;

for (const [btn, label] of [['more-invite', '邀请TA'], ['more-ask', '问问TA'], ['more-search', '搜索记录'], ['more-decide', '帮我决定(对照)']]) {
  // 复位：关全部面板 + 键盘收起（vv 高度还原）
  await evalJs(`['chat-ask-panel','chat-search','chat-decision-panel','poke-card','emoji-panel','chat-more-panel'].forEach(id=>{const el=document.getElementById(id);if(el)el.hidden=true;}); window.__setVvHeight && window.__setVvHeight(844);`);
  await sleep(500);
  await evalJs(`document.getElementById('${btn}')?.click()`);
  await sleep(600);
  const before = await evalJs(MEASURE);
  check(`[${label}] 无键盘时面板贴在输入栏上方`, before && before.pb <= before.it + 4 && before.pb >= before.ib - 200,
        before ? `bottom=${before.pb} input.top=${before.it}` : '面板未出现');
  check(`[${label}] 无键盘时为 absolute（修复标记）`, before && before.pos === 'absolute', before ? `pos=${before.pos}` : '');
  // 模拟键盘弹出（resizes-visual：只缩 visualViewport）→ syncAndroidKb 收缩 .phone
  await evalJs(`window.__setVvHeight && window.__setVvHeight(400)`);
  await sleep(800);
  const after = await evalJs(MEASURE);
  check(`[${label}] 键盘弹出后面板仍在输入栏上方`, after && after.pb <= after.it + 4,
        after ? `panel.bottom=${after.pb} input.top=${after.it}${after.pb > after.it + 4 ? ' <<< 掉到输入栏下方' : ''}` : '面板未出现');
}

console.log(`\n${pass} pass, ${fail} fail`);
ws.close(); chrome.kill(); server.close(); process.exit(fail ? 1 : 0);
