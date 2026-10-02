// ===== 专项验证：桌面弹窗（#desk-msg 横幅）头像跟随【聊天互动】换头像 =====
// 用户反馈：联系人已在聊天互动里换过头像，桌面弹窗仍显示旧头像。
// 根因：showDeskPopup 前台横幅只读桌面键 avatar-partner；v3.12.x 起头像互动只写
//       聊天专用键 cs-avatar-partner（与桌面解耦）→ 弹窗头像停留在旧图。
// 修复后行为：
//   A. cs-avatar-partner 已设（红）→ 弹窗显示红（跟随换头像），不再显示桌面蓝
//   B. cs 未设 → 回退显示桌面键蓝（独立设置的回退口径不变）
//   C. opts.av（跨桌面发布者头像）优先级不变——传金图显示金图
//   D. 后台分支（isHidden:true）不弹横幅、不动弹窗 DOM
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    if (process.env.MOCHI_AVATAR_SOURCE === '1' && p === join(root, 'index.html')) {
      const src = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
      const start = src.indexOf('function showDeskPopup(opts) {');
      const end = src.indexOf('function extractDeskMsg(rec) {', start);
      const html = readFileSync(p, 'utf8');
      const outStart = html.indexOf('function showDeskPopup(opts) {');
      const outEnd = html.indexOf('function extractDeskMsg(rec) {', outStart);
      if (start < 0 || end < start || outStart < 0 || outEnd < outStart) throw new Error('头像函数定位失败');
      res.end(html.slice(0, outStart) + src.slice(start, end) + html.slice(outEnd));
    } else {
      res.end(readFileSync(p));
    }
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dskav-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  throw new Error('cdp fail');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JSERR', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 160) + ']' : ''));
}
const svg = (hex) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#' + hex + '"/></svg>');
const BLUE = svg('2255ff');   // 桌面键 avatar-partner（旧头像）
const RED = svg('ff2255');    // 聊天键 cs-avatar-partner（聊天互动换的新头像）
const GOLD = svg('ffaa22');   // opts.av 发布者头像

// 触发一次前台弹窗并返回 #desk-msg-av 的 HTML
const popAndRead = `(function(av){
  if (!window.showDeskPopup) return { err: 'no-api' };
  window.hideDeskMsg && window.hideDeskMsg();
  window.showDeskPopup({ name: '测试TA', text: '你好呀', av: av || undefined, isHidden: false });
  const el = document.getElementById('desk-msg-av');
  return { html: el ? el.innerHTML : '', shown: !document.getElementById('desk-msg').hidden };
})`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await gotoApp();

// ---- 准备：桌面键=蓝（旧），聊天键=红（聊天互动已换的新头像）
await evalJs(`(function(){
  const s = window.activeStore();
  s.set('avatar-partner', ${JSON.stringify(BLUE)});
  s.set('cs-avatar-partner', ${JSON.stringify(RED)});
  s.remove('avatar-lib-next');
  return true;
})()`);
await sleep(300);

{
  const r = await evalJs(popAndRead + '()');
  check('A1 前台弹窗正常弹出', !!r && !r.err && r.shown === true, JSON.stringify(r));
  check('A2 弹窗头像=聊天键新红图（核心：跟随换头像）', !!r && String(r.html).indexOf('ff2255') >= 0, String(r && r.html).slice(0, 80));
  check('A3 弹窗头像不再是旧蓝图', !!r && String(r.html).indexOf('2255ff') < 0, String(r && r.html).slice(0, 80));
}

// ---- B 组：cs 未设 → 回退桌面键
{
  await evalJs(`window.activeStore().remove('cs-avatar-partner');`);
  await sleep(100);
  const r = await evalJs(popAndRead + '()');
  check('B1 cs 未设时弹窗头像回退显示桌面蓝图', !!r && String(r.html).indexOf('2255ff') >= 0 && String(r.html).indexOf('ff2255') < 0, String(r && r.html).slice(0, 80));
}

// ---- C 组：opts.av 发布者头像优先（跨桌面通知口径不变）
{
  const r = await evalJs(popAndRead + `(${JSON.stringify(GOLD)})`);
  check('C2 传入 opts.av 时弹窗头像用发布者金图', !!r && String(r.html).indexOf('ffaa22') >= 0, String(r && r.html).slice(0, 80));
}

// ---- D 组：后台分支不弹横幅、不改弹窗 DOM
{
  const before = await evalJs(`document.getElementById('desk-msg-av').innerHTML`);
  const r = await evalJs(`(function(){
    window.hideDeskMsg && window.hideDeskMsg();
    document.getElementById('desk-msg').hidden = true;
    window.showDeskPopup({ name: '后台', text: '后台消息', isHidden: true });
    const el = document.getElementById('desk-msg');
    return { shown: !el.hidden };
  })()`);
  const after = await evalJs(`document.getElementById('desk-msg-av').innerHTML`);
  check('D1 isHidden 分支不发前台横幅', !!r && r.shown === false, JSON.stringify(r));
  check('D2 isHidden 分支不改弹窗头像 DOM', before === after, '');
}

{
  await evalJs(`window.activeStore().set('cs-avatar-partner', ${JSON.stringify(RED)});`);
  const chat = await evalJs(popAndRead + '()');
  check('E1 聊天通知先显示当前聊天红图', !!chat && String(chat.html).includes('ff2255'));
  const feed = await evalJs(popAndRead + `(${JSON.stringify(GOLD)})`);
  check('E2 朋友圈通知独立显示金图', !!feed && String(feed.html).includes('ffaa22'));
  const nextChat = await evalJs(popAndRead + '()');
  check('E3 朋友圈之后的聊天通知恢复当前聊天红图', !!nextChat && String(nextChat.html).includes('ff2255'), nextChat && nextChat.html);
  check('E4 聊天通知不残留朋友圈金图', !!nextChat && !String(nextChat.html).includes('ffaa22'));
}

const passed = results.filter((x) => x.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill();
server.close();
process.exit(passed === results.length ? 0 : 1);
