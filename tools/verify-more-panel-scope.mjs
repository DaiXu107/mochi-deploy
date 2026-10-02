// 回归：聊天「更多功能」各功能半框在宽屏（PC 预览）下必须收进 .phone 模拟框
// 根因：.more-panel/.poke-card/.call-mini 原 position:fixed 锚定浏览器窗口，
//       宽屏下 .phone 是居中手机框 → 打开的功能页全部掉到窗口底部灰底区。
// 修复：@media(min-width:901px) html:not(.force-mobile) 下改 position:absolute 锚定 .phone。
// 检查：
//   A. 1280×900：打开 帮我决定/搜索/通话/占卜/拍一拍/更多面板 → 面板矩形完全落在
//      .phone 内（水平），且底边不高于输入栏顶太多/不超出 .phone 底部
//   B. 390×844（手机端回归）：面板仍 fixed 原位（left=18、bottom=innerH-96），行为不变
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vmp-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
async function shot(name) { const s = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(root, 'tools', name), Buffer.from(s.data, 'base64')); }

let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('PASS', name, extra || ''); } else { fail++; console.log('FAIL', name, extra || ''); } }

await cdp('Page.enable'); await cdp('Runtime.enable');

// 打开聊天页 + 指定功能，返回 { phone, panel, inputRow } 矩形（首个可见 poke-card/more-panel）
const OPEN = `(async () => {
  const closeAll = () => ['chat-decision-panel','chat-search','chat-call-panel','chat-divine-panel','poke-card','chat-more-panel','emoji-panel'].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const phone = document.querySelector('.phone');
  const inputRow = document.querySelector('#page-chat .chat-input-row');
  const findPanel = () => {
    const ids = ['chat-decision-panel','chat-search','chat-call-panel','chat-divine-panel','poke-card','chat-more-panel'];
    for (const id of ids) { const el = document.getElementById(id); if (el && !el.hidden && getComputedStyle(el).display !== 'none') return el; }
    return null;
  };
  return { closeAll, rect, phone, inputRow, findPanel };
})()`;

async function openFeature(btnId) {
  await evalJs(`(function(){const ids=['chat-decision-panel','chat-search','chat-call-panel','chat-divine-panel','poke-card','chat-more-panel','emoji-panel'];ids.forEach(id=>{const el=document.getElementById(id);if(el)el.hidden=true;});})()`);
  await sleep(120);
  await evalJs(`document.getElementById('${btnId}')?.click()`);
  await sleep(600);
  return await evalJs(`(() => {
    const ids = ['chat-decision-panel','chat-search','chat-call-panel','chat-divine-panel','poke-card','chat-more-panel'];
    let panel = null;
    for (const id of ids) { const el = document.getElementById(id); if (el && !el.hidden && getComputedStyle(el).display !== 'none') { panel = el; break; } }
    if (!panel) return null;
    const r = panel.getBoundingClientRect();
    const ph = document.querySelector('.phone').getBoundingClientRect();
    const ir = document.querySelector('#page-chat .chat-input-row').getBoundingClientRect();
    return { panel: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, pos: getComputedStyle(panel).position }, phone: { left: ph.left, right: ph.right, top: ph.top, bottom: ph.bottom }, input: { top: ir.top, bottom: ir.bottom } };
  })()`);
}

const FEATS = [
  ['more-decide', '帮我决定', 18],
  ['more-search', '搜索记录', 36], // .chat-search 自身设计就是 left/right 36px（比其它半框窄）
  ['more-call', '通话', 18],
  ['more-divine', '占卜', 18],
  ['more-poke', '拍一拍', 18],
  ['chat-more-btn', '更多功能面板', 18],
];

// ---- A. 宽屏 1280×900 ----
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
await evalJs(`document.getElementById('splash-confirm-ok')?.click()`);
await sleep(800);
await evalJs(`(function(){document.querySelectorAll('.page').forEach(p=>p.hidden=true);document.getElementById('page-chat').hidden=false;})()`);
await sleep(400);
for (const [btn, label, exp] of FEATS) {
  const s = await openFeature(btn);
  if (!s) { check(`[宽屏] ${label} 面板打开`, false, '面板未出现'); continue; }
  const inPhoneH = s.panel.left >= s.phone.left - 1 && s.panel.right <= s.phone.right + 1;
  const abovePhoneBottom = s.panel.bottom <= s.phone.bottom + 1;
  const nearInput = s.panel.bottom <= s.input.bottom + 40; // 底边不深入输入栏以下超过容差
  check(`[宽屏] ${label} 收进手机框（水平）`, inPhoneH, `panel.left=${Math.round(s.panel.left)} right=${Math.round(s.panel.right)} phone.left=${Math.round(s.phone.left)} right=${Math.round(s.phone.right)}`);
  check(`[宽屏] ${label} 不超出手机框底部`, abovePhoneBottom, `panel.bottom=${Math.round(s.panel.bottom)} phone.bottom=${Math.round(s.phone.bottom)}`);
  check(`[宽屏] ${label} 贴在输入栏上方`, nearInput, `panel.bottom=${Math.round(s.panel.bottom)} input.bottom=${Math.round(s.input.bottom)}`);
  if (btn === 'more-decide') await shot('verify-mp-desktop-decide.png');
}

// ---- B. 手机端 390×844 回归（行为不变） ----
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
await evalJs(`document.getElementById('splash-confirm-ok')?.click()`);
await sleep(800);
await evalJs(`(function(){document.querySelectorAll('.page').forEach(p=>p.hidden=true);document.getElementById('page-chat').hidden=false;})()`);
await sleep(400);
for (const [btn, label, exp] of FEATS) {
  const s = await openFeature(btn);
  if (!s) { check(`[手机] ${label} 面板打开`, false, '面板未出现'); continue; }
  check(`[手机] ${label} 贴左 ${exp}px`, Math.abs(s.panel.left - exp) < 2, `left=${Math.round(s.panel.left)}`);
  check(`[手机] ${label} 底边在输入栏上方（bottom≈innerH-96）`, Math.abs(s.panel.bottom - (844 - 96)) < 6, `bottom=${Math.round(s.panel.bottom)}`);
}

console.log(`\\n${pass} pass, ${fail} fail`);
ws.close(); chrome.kill(); server.close(); process.exit(fail ? 1 : 0);
