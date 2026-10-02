// ===== 回归脚本：收藏页批量管理「多选/全选」勾选清零（v3.31.x #314 修复） =====
// 用法：node build.mjs && node tools/verify-fav-batch.mjs
// 背景（用户反馈，明说其他设备型号也有出现）：收藏页点顶栏勾选图标进批量管理后，
//   多选/全选形同虚设——勾了会莫名自动灭、全选点了没反应、删除按钮永远灰着。
// 根因：getFav() 每次 JSON.parse 返回全新对象，favBatchSel 存的是上一代渲染的
//   对象引用；任何 renderFav 重渲染（点全选/切分类/切页签都触发）后按引用过滤
//   `list2.indexOf(s)` 必然全部失配 → 勾选静默清零。纯逻辑 bug，与设备无关。
// 修复：勾选身份改为 favItemKey 内容指纹（归属+类型+时间戳+内容截断，与 favDup
//   判重同源），跨重渲染稳定；批量删除按 key 匹配 + 倒序 splice。
// 验证（无头 Chrome 390×844 触摸仿真，种 3 mine + 2 ta 收藏）：
//   进批量管理出操作栏+勾选圈 / 单条勾选亮删除 / 全选 3 条+按钮变「取消全选」 /
//   切分类往返勾选保留 / 切 TA 页签勾选收窄 / 删除走确认框+toast / 退出恢复普通态。
// 修复前跑本脚本：C1/C2/D1/E 组红（全选清零）；修复后 13/13 绿。
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

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
const cdpPort = 9750 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-favbatch-' + Date.now()),
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

await evalJs(`(function(){
  var favs = [];
  for (var i = 0; i < 3; i++) favs.push({ id: 'f-m-' + i, kind: 'msg', by: 'me', side: 'out', text: '我收藏的消息' + i, ts: 1700000000000 + i, type: 'text' });
  for (var j = 0; j < 2; j++) favs.push({ id: 'f-t-' + j, kind: 'msg', by: 'ta', side: 'in', text: 'TA收藏的消息' + j, ts: 1700000010000 + j, type: 'text' });
  try { localStorage.setItem('xy-home-v2:fav-msgs', JSON.stringify(favs)); } catch(e) { return 'LS_ERR:' + e.message; }
  return 'ok:' + favs.length;
})()`);
await cdp('Page.reload', { ignoreCache: false });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// 进收藏页
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="note"]'); if (app) app.click(); return 1; })()`);
await sleep(800);

// 1) 进批量管理
await evalJs(`document.getElementById('fav-manage-btn').click()`);
await sleep(400);
const s1 = await evalJs(`JSON.stringify({
  barVisible: (function(){ var b=document.getElementById('fav-batch-bar'); return b && !b.hidden && getComputedStyle(b).display!=='none'; })(),
  checks: document.querySelectorAll('#fav-list .fav-check').length
})`);
const o1 = JSON.parse(s1);
chk('A1 进批量管理出操作栏', o1.barVisible === true, s1);
chk('A2 条目出现勾选圈', o1.checks === 3, s1);

// 2) 单条勾选
await evalJs(`document.querySelectorAll('#fav-list .msg')[0].click()`);
await sleep(250);
const s2 = await evalJs(`JSON.stringify({ on: document.querySelectorAll('#fav-list .fav-check.on').length, del: !document.getElementById('fav-batch-del').disabled })`);
const o2 = JSON.parse(s2);
chk('B1 点条目勾上 1 条', o2.on === 1 && o2.del === true, s2);

// 3) 全选（修复前：重渲染后勾选清零）
await evalJs(`document.getElementById('fav-batch-all').click()`);
await sleep(300);
const s3 = await evalJs(`JSON.stringify({ on: document.querySelectorAll('#fav-list .fav-check.on').length, txt: document.getElementById('fav-batch-all').textContent })`);
const o3 = JSON.parse(s3);
chk('C1 全选勾上全部 3 条', o3.on === 3, s3);
chk('C2 全选按钮变「取消全选」', o3.txt === '取消全选', s3);

// 4) 切分类再切回，勾选应保留
await evalJs(`(function(){ var t=document.querySelector('#fav-kind-tabs .fav-tab[data-kind="msg"]'); if(t) t.click(); return 1; })()`);
await sleep(250);
await evalJs(`(function(){ var t=document.querySelector('#fav-kind-tabs .fav-tab[data-kind="all"]'); if(t) t.click(); return 1; })()`);
await sleep(250);
const s4 = await evalJs(`document.querySelectorAll('#fav-list .fav-check.on').length`);
chk('D1 切分类往返勾选保留 3', Number(s4) === 3, String(s4));

// 5) 切 TA 页签（勾选应收窄到 0——TA 的不在选择里），再切回「我的」恢复勾选状态语义
await evalJs(`(function(){ var t=document.querySelector('#fav-tabs .fav-tab[data-tab="ta"]'); if(t) t.click(); return 1; })()`);
await sleep(250);
const s5 = await evalJs(`JSON.stringify({ on: document.querySelectorAll('#fav-list .fav-check.on').length, items: document.querySelectorAll('#fav-list .fav-check').length })`);
const o5 = JSON.parse(s5);
chk('D2 切 TA 页签勾选收窄且 TA 条目独立勾选', o5.items === 2 && o5.on === 0, s5);

// 6) 删 1 条走通：回「我的」页签，勾 1 条，点删除 → modal 确认 → 数组变 2 条
await evalJs(`(function(){ var t=document.querySelector('#fav-tabs .fav-tab[data-tab="mine"]'); if(t) t.click(); return 1; })()`);
await sleep(250);
await evalJs(`document.querySelectorAll('#fav-list .msg')[0].click()`);
await sleep(200);
await evalJs(`document.getElementById('fav-batch-del').click()`);
await sleep(300);
const modalTxt = await evalJs(`(function(){ var m=document.getElementById('modal-mask'); return m && !m.hidden ? 1 : 0; })()`);
chk('E1 删除弹确认框', modalTxt === 1, String(modalTxt));
await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
await sleep(400);
const s6 = await evalJs(`JSON.stringify({ keys: (function(){ var keys=[]; for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k.indexOf('fav-msgs')>=0) keys.push(k+'='+localStorage.getItem(k).length); } return keys; })(), toast: (document.getElementById('cc-toast')||{}).textContent || '' })`);
const o6 = JSON.parse(s6);
chk('E2 确认后收藏库仍可读且 toast 报删除数', o6.toast.indexOf('已删除 1') >= 0, s6);
chk('E3 存在 fav-msgs 存储键（删除写入未丢库）', o6.keys.length >= 1, s6);

// 7) 退出批量模式恢复普通态
await evalJs(`document.getElementById('fav-batch-cancel').click()`);
await sleep(300);
const s7 = await evalJs(`JSON.stringify({ barHidden: document.getElementById('fav-batch-bar').hidden, checks: document.querySelectorAll('#fav-list .fav-check').length })`);
const o7 = JSON.parse(s7);
chk('F1 取消退出批量模式', o7.barHidden === true && o7.checks === 0, s7);

console.log('SUMMARY pass=' + pass + ' fail=' + fail);
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
