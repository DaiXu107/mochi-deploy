// ===== 专项验证：联系人聊天头像与桌面第一页小组件头像解耦 =====
// 用户反馈：触发联系人更换「聊天头像」后，桌面 deco-widget 头像仍被同步覆盖。
// 根因：avatar-lib.js 换头像走 setAvatarBoth 同时写 avatar-partner（桌面键）+ cs-avatar-partner（聊天键）。
// 修复后行为：
//   A. 手动点击头像池图片直接切换 → 只写 cs-avatar-partner，avatar-partner 桌面键不动
//   B. TA 回应拒绝（邀请分支未命中同意）→ 聊天键换回，桌面键仍不动
//   C. 定时随机换（启动即触发路径）→ 只写 cs-avatar-partner，桌面键仍不动
//   D. 头像池网格高亮当前生效的聊天头像（cs 未设回退桌面）
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
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9860 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-avdc-' + Date.now()),
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
const BLUE = svg('2255ff');   // 桌面小组件头像
const RED = svg('ff2255');
const GOLD = svg('ffaa22');

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await gotoApp();

// ---- 准备：桌面 avatar-partner=蓝；聊天 cs-avatar-partner 未设；联系人池=[红]，开关开，
//      随机换计时推远（防启动自动换干扰 A/B 阶段）
await evalJs(`(function(){
  const s = window.activeStore();
  s.set('avatar-partner', ${JSON.stringify(BLUE)});
  s.remove('cs-avatar-partner');
  s.set('avatar-lib', JSON.stringify([${JSON.stringify(RED)}]));
  s.set('avatar-lib-enabled', '1');
  s.set('avatar-lib-last', String(Date.now()));
  s.set('avatar-lib-next', '8');
  Array.from(document.querySelectorAll('.page')).forEach(p=>p.hidden=true);
  document.getElementById('page-chat').hidden=false;
  return true;
})()`);
await sleep(500);

check('P0 初始聊天顶部头像回退显示桌面头像(蓝)', (() => true)(), '');
{
  const top = await evalJs(`(function(){ const a=document.getElementById('chat-partner-av'); return a? a.innerHTML:''; })()`);
  check('A0 初始聊天顶栏头像=桌面蓝图（回退）', String(top).indexOf('2255ff') >= 0, String(top).slice(0, 80));
}

// ---- A 组：手动点击池图直接切换（Math.random 钉死 ≥0.5 → 不触发邀请回应分支）
{
  const r = await evalJs(`(function(){
    window.openAvlib();
    const grid = document.getElementById('avlib-grid');
    const img = grid && grid.querySelector('.avlib-cell img');
    if (!img) return { err: 'no-img' };
    const src = img.getAttribute('src');
    const origRandom = Math.random;
    Math.random = function(){ return 0.99; };
    let clickErr = '';
    try { img.click(); } catch (e) { clickErr = String(e && e.message); }
    Math.random = origRandom;
    const s = window.activeStore();
    return {
      clickedRed: src.indexOf('ff2255') >= 0,
      clickErr,
      cs: s.get('cs-avatar-partner'),
      desk: s.get('avatar-partner'),
      nowCell: !!(grid.querySelector('.avlib-cell.avlib-now img[src*="ff2255"]'))
    };
  })()`);
  check('A1 点击池图成功触发切换', !!r && r.clickedRed && !r.clickErr, JSON.stringify(r));
  check('A2 聊天键 cs-avatar-partner=红（新头像已生效）', !!r && String(r.cs).indexOf('ff2255') >= 0, String(r && r.cs).slice(0, 60));
  check('A3 桌面键 avatar-partner 保持蓝色不被同步（核心）', !!r && String(r.desk).indexOf('2255ff') >= 0 && String(r.desk).indexOf('ff2255') < 0, String(r && r.desk).slice(0, 60));
  const doms = await evalJs(`(function(){
    const chatAv = document.getElementById('chat-partner-av');
    const deskRing = document.querySelector('#avatar-partner .ring');
    return { chat: chatAv ? chatAv.innerHTML : '', desk: deskRing ? deskRing.innerHTML : '' };
  })()`);
  check('A4 聊天顶栏 DOM 已更新为新红图', String(doms && doms.chat).indexOf('ff2255') >= 0, String(doms && doms.chat).slice(0, 80));
  check('A5 桌面小组件 ring DOM 仍是蓝图未被改动', String(doms && doms.desk).indexOf('2255ff') >= 0 && String(doms && doms.desk).indexOf('"data:image/svg+xml;utf8,%7B%22width%22:8%22height%22') < 0 && String(doms && doms.desk).indexOf('ff2255') < 0, String(doms && doms.desk).slice(0, 80));
  check('A6 头像池网格高亮当前生效的聊天头像', !!r && r.nowCell, '');
}

// ---- B 组：TA 回应拒绝路径（邀请概率命中 + 同意概率未命中 → 换回 before）
{
  // 池里加第二张金图并重开半框
  await evalJs(`(function(){
    const s = window.activeStore();
    s.set('avatar-lib', JSON.stringify([${JSON.stringify(RED)}, ${JSON.stringify(GOLD)}]));
    window.openAvlib();
    return true;
  })()`);
  await sleep(200);
  const r = await evalJs(`(function(){
    const grid = document.getElementById('avlib-grid');
    const imgs = grid.querySelectorAll('.avlib-cell img');
    let gold = null;
    imgs.forEach(function(im){ if (im.getAttribute('src').indexOf('ffaa22') >= 0) gold = im; });
    if (!gold) return { err: 'no-gold' };
    let seq = [0.5, 0.1, 0.95]; // 第1掷：重置随机计时；第2掷 <50% 触发回应；第3掷 ≥70% 判拒绝
    const origRandom = Math.random;
    Math.random = function(){ return seq.length ? seq.shift() : 0.5; };
    let clickErr = '';
    try { gold.click(); } catch (e) { clickErr = String(e && e.message); }
    Math.random = origRandom;
    const s = window.activeStore();
    return {
      clickErr,
      cs: s.get('cs-avatar-partner'),   // 拒绝 → 换回红
      desk: s.get('avatar-partner')     // 全程不动 → 蓝
    };
  })()`);
  check('B1 拒绝分支执行成功', !!r && !r.err && !r.clickErr, JSON.stringify(r));
  check('B2 拒绝后聊天键换回原红图', !!r && String(r.cs).indexOf('ff2255') >= 0, String(r && r.cs).slice(0, 60));
  check('B3 拒绝后桌面键仍是蓝色（核心）', !!r && String(r.desk).indexOf('2255ff') >= 0, String(r && r.desk).slice(0, 60));
}

// ---- C 组：定时随机换——把计时归零后刷新页面，启动检查立即触发
{
  await evalJs(`(function(){
    const s = window.activeStore();
    s.set('avatar-lib', JSON.stringify([${JSON.stringify(GOLD)}])); // 池里只剩金图（≠当前红）→ 必换
    s.set('avatar-lib-last', '0');
    s.set('avatar-lib-next', '0');
    return true;
  })()`);
  await gotoApp();
  await sleep(800);
  const r = await evalJs(`(function(){
    Array.from(document.querySelectorAll('.page')).forEach(p=>p.hidden=true);
    document.getElementById('page-chat').hidden=false;
    const s = window.activeStore();
    const chatAv = document.getElementById('chat-partner-av');
    const sysMsgs = (window.getChatMsgs ? window.getChatMsgs() : []).filter(function(m){ return m && m.special==='poke' && /更换了头像/.test(String(m.text||'')); });
    return {
      cs: s.get('cs-avatar-partner'),
      desk: s.get('avatar-partner'),
      chatDom: chatAv ? chatAv.innerHTML : '',
      lastMsgImg: sysMsgs.length ? String(sysMsgs[sysMsgs.length-1].img||'').slice(0,60) : ''
    };
  })()`);
  check('C1 启动随机换只写聊天键 cs-avatar-partner=金', !!r && String(r.cs).indexOf('ffaa22') >= 0, String(r && r.cs).slice(0, 60));
  check('C2 启动随机换后桌面键 avatar-partner 仍是蓝色（核心）', !!r && String(r.desk).indexOf('2255ff') >= 0 && String(r.desk).indexOf('ffaa22') < 0, String(r && r.desk).slice(0, 60));
  check('C3 聊天顶栏 DOM 显示新金图', String(r && r.chatDom).indexOf('ffaa22') >= 0, r && r.chatDom);
}

// ---- D 组：cs 未设时网格高亮回退桌面头像
{
  const r = await evalJs(`(function(){
    const s = window.activeStore();
    s.remove('cs-avatar-partner');
    s.set('avatar-lib', JSON.stringify([${JSON.stringify(BLUE)}, ${JSON.stringify(GOLD)}]));
    window.openAvlib();
    const grid = document.getElementById('avlib-grid');
    const cell = grid.querySelector('.avlib-cell img[src*="2255ff"]');
    const cellDiv = cell && cell.closest('.avlib-cell');
    return { hl: !!(cellDiv && cellDiv.className.indexOf('avlib-now') >= 0), cs: s.get('cs-avatar-partner') };
  })()`);
  check('D1 cs 未设时网格按桌面头像高亮（回退口径）', !!r && r.hl, JSON.stringify(r));
}

const passed = results.filter((x) => x.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill();
server.close();
process.exit(passed === results.length ? 0 : 1);
