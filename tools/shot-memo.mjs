// 临时：备忘录视觉截图（第三页图标 + 打开页 + 有数据态）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = 9900 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-shot-memo-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const page = list.find(t => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }); return r && r.result ? r.result.value : null; };
const shot = async (name) => {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(root, name), Buffer.from(r.data, 'base64'));
  console.log('saved ' + name);
};
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/index.html' });
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(800);
// 过开屏：点击进入 → 确认我已知晓
await ev(`(function () {
  var enter = document.getElementById('splash-enter');
  if (enter && !enter.hidden) enter.click();
  return 'enter-clicked';
})()`);
await sleep(600);
await ev(`(function () {
  var ok = document.getElementById('splash-confirm-ok');
  if (ok) ok.click();
  var splash = document.getElementById('splash');
  if (splash) splash.hidden = true;
  return 'confirm-clicked';
})()`);
await sleep(800);
// 滑到第三页
await ev(`(function () { var b = document.getElementById('desktop-pages'); b.scrollLeft = b.clientWidth * 2 + 20; return b.scrollLeft; })()`);
await sleep(600);
await shot('memo-shot-p3.jpg');
// 种两条数据再打开页面
await ev(`(function () {
  var s = window.xyStore('xy-home-v2');
  var today = new Date();
  var fmt = function (off) { var x = new Date(today.getTime() + off * 86400000); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  var items = [
    { id: 'a1', t: '周五晚上一起看电影', done: false, pin: true, due: null, ts: Date.now() - 3600000 },
    { id: 'a2', t: '给 TA 挑生日礼物', done: false, pin: false, due: fmt(0), ts: Date.now() - 7200000 },
    { id: 'a4', t: '还图书馆的书', done: false, pin: false, due: fmt(-2), ts: Date.now() - 3 * 86400000 },
    { id: 'a3', t: '把阳台的花浇水', done: true, pin: false, due: null, ts: Date.now() - 900000 }
  ];
  s.set('memo-app-items', JSON.stringify(items));
  document.querySelector('[data-app="memo"]').click();
  return 'ok';
})()`);
await sleep(500);
// 关掉与本功能无关的既有弹层（每日留言弹层 / 备份提醒条 / 查岗桌面留言浮卡）
await ev(`(function () {
  var g = document.getElementById('daily-greet'); if (g) g.remove();
  var b = document.getElementById('backup-remind-bar'); if (b) b.hidden = true;
  var c = document.getElementById('ver-update-bar'); if (c) c.hidden = true;
  var d = document.getElementById('desk-msg'); if (d) d.style.display = 'none';
  return 'cleaned';
})()`);
await sleep(600);
await shot('memo-shot-page.jpg');
// 返回桌面 → 翘到第二页拍首页徽标
await ev(`document.getElementById('memo-back').click()`);
await sleep(500);
await ev(`(function () { var b = document.getElementById('desktop-pages'); b.scrollLeft = b.clientWidth + 10; return b.scrollLeft; })()`);
await sleep(600);
await shot('memo-shot-badge.jpg');
chrome.kill(); server.close(); process.exit(0);
