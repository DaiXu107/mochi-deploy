// ===== 验证：#156 群聊模式没隐藏桌面占卜图标 =====
// 用户反馈：开启群聊模式后，桌面【占卜】图标没有隐藏。
// 根因（personalize.js applyGroupChatMode）：原逻辑只在占卜图标仍位于第一页 app-grid
//（模板原位）时才收进隐藏池；装修过桌面（desk-layout 把 app-divination 排在任意页顶层）
// 或从组件库加回后，图标一直显示。配套防线：applyDeskLayout 末尾重应用群聊模式
//（防 bare 布局应用把占卜从池里按 desk-layout 复活回桌面）。
// 用法：node tools/verify-group-desk-icon.mjs（需先 node build.mjs，需本机 Chrome/Edge）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-gcdeskicon-' + Date.now()),
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
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || '') };
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined && detail !== null ? '  [' + JSON.stringify(detail) + ']' : '')); }

await cdpConnect();
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
await ev(`(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.classList.add('hide');return 'ok';})()`);
await sleep(800);

// 位置工具：wid 在隐藏池 / 页面 / 缺失；及所在页序号
const whereExpr = (wid) => `(function(){
  var pool=document.getElementById('desk-widget-pool');
  var nodes=document.querySelectorAll('[data-desk-widget="${wid}"]');
  for (var i=0;i<nodes.length;i++){
    if (pool && pool.contains(nodes[i])) return 'pool';
    if (nodes[i].closest('#desktop-pages')) return 'page';
  }
  return 'missing';
})()`;
const slideIdxExpr = (wid) => `(function(){
  var n=document.querySelector('[data-desk-widget="${wid}"]');
  if(!n) return -1;
  var s=n.closest('.page-slide'); if(!s) return -2;
  var all=document.querySelectorAll('#desktop-pages .page-slide');
  return Array.prototype.indexOf.call(all,s);
})()`;
const inMainGridExpr = `(function(){
  var n=document.querySelector('[data-desk-widget="app-divination"]');
  return !!(n && n.closest('.app-grid[data-app="main"]'));
})()`;

// 布局工具：模拟用户在装修模式把占卜图标拖出图标组、放到第 2 页顶层并保存布局
//（注意：desk-layout 对「仍在 app-grid 内」的图标不生效——由网格管理规则跳过，
// 必须先真实移动 DOM 再落盘，与装修保存 saveDeskLayout 的语义一致）
const SET_LAYOUT = `(function(){
  var cid = window.__activeCid || 'default';
  var n = document.querySelector('[data-desk-widget="app-divination"]');
  var slide = document.querySelectorAll('#desktop-pages .page-slide')[1];
  var add = slide.querySelector('.desk-page-add');
  if (add) slide.insertBefore(n, add); else slide.appendChild(n);
  var s = window.xyStore('xy-home-v2:' + cid);
  s.set('desk-layout', JSON.stringify([['apps'],['p2apps','week','app-divination']]));
  if (window.applyDeskLayout) window.applyDeskLayout();
  return 'ok';
})()`;
const GC = (v) => `(function(){
  window.xyStore('xy-home-v2').set('group-chat-enabled', '${v}');
  document.dispatchEvent(new Event('group-chat-mode-changed'));
  return 'ok';
})()`;

// ===== T1 基线：群聊关（默认），无布局 → 占卜在首页图标组 =====
let w = await ev(whereExpr('app-divination'));
check('T1 群聊关·无布局：占卜在桌面（首页图标组内）', w === 'page' && (await ev(inMainGridExpr)) === true, { where: w, inMainGrid: await ev(inMainGridExpr) });

// ===== T2 bug 场景：desk-layout 把占卜排在第 2 页 → 开群聊必须收进隐藏池 =====
await ev(SET_LAYOUT);
await sleep(400);
w = await ev(whereExpr('app-divination'));
const p2 = await ev(slideIdxExpr('app-divination'));
check('T2-pre 布局生效：占卜被排到第 2 页顶层', w === 'page' && p2 === 1, { where: w, slide: p2 });
await ev(GC('1'));
await sleep(500);
w = await ev(whereExpr('app-divination'));
check('T2 开群聊：占卜收进隐藏池（修复前停在桌面=FAIL）', w === 'pool', w);

// ===== T3 复活防线：群聊开着，bare applyDeskLayout 后占卜必须仍在池 =====
await ev(`(function(){ if (window.applyDeskLayout) window.applyDeskLayout(); return 'ok'; })()`);
await sleep(400);
w = await ev(whereExpr('app-divination'));
check('T3 群聊开着·bare applyDeskLayout：占卜不被复活回桌面（无防线时=FAIL）', w === 'pool', w);

// ===== T4 关群聊恢复：占卜回到首页图标组默认位（v3.8 原语义「关闭恢复原样」） =====
await ev(GC('0'));
await sleep(600);
w = await ev(whereExpr('app-divination'));
const g4 = await ev(inMainGridExpr);
check('T4 关群聊：占卜回到首页图标组默认位（不留在池/不丢）', w === 'page' && g4 === true, { where: w, inMainGrid: g4 });

// ===== T5 清场恢复默认：删布局+关群聊 → 占卜回首页图标组 =====
await ev(`(function(){
  var cid = window.__activeCid || 'default';
  window.xyStore('xy-home-v2:' + cid).remove('desk-layout');
  window.xyStore('xy-home-v2').remove('group-chat-enabled');
  document.dispatchEvent(new Event('group-chat-mode-changed'));
  return 'ok';
})()`);
await sleep(600);
w = await ev(whereExpr('app-divination'));
check('T5 清场：占卜回首页图标组原位', w === 'page' && (await ev(inMainGridExpr)) === true, { where: w, inMainGrid: await ev(inMainGridExpr) });

const fails = results.filter(r => !r.ok).length;
console.log('----');
console.log(fails === 0 ? '✅ verify-group-desk-icon ' + results.length + '/' + results.length : '❌ ' + fails + ' 项失败');
chrome.kill(); server.close();
process.exit(fails === 0 ? 0 : 1);
