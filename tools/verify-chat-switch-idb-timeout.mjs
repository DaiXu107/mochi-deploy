// ===== 回归：切换桌面联系人后聊天记录丢失（权威读取超时被当空历史） =====
// 用法：node build.mjs && node tools/verify-chat-switch-idb-timeout.mjs
// 根因（用户反馈「切换桌面联系人，联系人的聊天记录又丢失了」）：
//   idbGet 的 4s+4s 超时兜底（v3.9.x 防挂起）对「键存在但读取超时」也 resolve
//   undefined；真机切桌面瞬间几十模块并发抢 IDB，chat-msgs 大键易超时。原实现
//   把 undefined 当"无权威数据"分支：置 chatDbReady 并用内存（刚切完=空）/LS
//   有损快照覆盖 IDB → 全部历史被清。
// 修复断言：
//   T1 首读失败（键存在但返回 undefined）→ 不落盘、不置 ready、安排重试
//   T2 失败窗口内新消息到达 → IDB 历史不被覆盖；LS 快照不被写成 "[]"
//   T3 重试读回权威后 → 历史渲染回来，且与新消息合并落盘
//   T4 空数组守卫：从未读过权威前，任何模块触发保存都不写空数组进 IDB
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9910 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-swtimeout-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
async function openChat() {
  await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return !!app; })()`);
  await sleep(600);
}
async function closeChat() {
  await evalJs(`(function(){ var b=document.getElementById('chat-back'); if(b){b.click();return true;} var p=document.getElementById('page-chat'); if(p) p.hidden=true; return false; })()`);
  await sleep(250);
}
async function idbTexts(keyExpr) {
  const raw = await evalJs(`(function(){
    return new Promise(function(resolve){
      window.__rawIdbGetV('xy-home-v2:' + ${keyExpr}).then(function(v){
        resolve(JSON.stringify(v ? JSON.parse(v).map(function(m){ return m.text || ''; }).filter(Boolean) : null));
      }).catch(function(){ resolve('null'); });
    });
  })()`);
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// 种子：角色H 历史只写 IDB（LS 移除），并保存原始 idbGet 引用
const seed = JSON.parse(await evalJs(`(function(){
  try {
    var cid = window.createContact('角色T');
    var msgs = [
      { side: 'in', text: 'T线-历史消息1', ts: Date.now() - 300000 },
      { side: 'out', text: 'T线-历史消息2', ts: Date.now() - 290000 },
      { side: 'in', text: 'T线-历史消息3', ts: Date.now() - 280000 }
    ];
    window.idbSet('xy-home-v2:' + cid + ':chat-msgs', JSON.stringify(msgs));
    localStorage.removeItem('xy-home-v2:' + cid + ':chat-msgs');
    window.__rawIdbGetV = window.idbGet;
    return new Promise(function(resolve){
      // 等种子写入事务完成再返回，避免后续 getAllKeys 复核竞态
      setTimeout(function(){ resolve(JSON.stringify({ ok: true, cid: cid })); }, 500);
    });
  } catch(e) { return JSON.stringify({ ok: false, err: e.message }); }
})()`) || '{}');
check('种子：角色T 三条历史只写 IDB', seed.ok === true, JSON.stringify(seed));
if (!seed.ok) process.exit(1);
const cidT = seed.cid;

// 注入「超时型失败」：对 T 键的读取延迟后 resolve undefined（模拟 idbGet 超时兜底），
// 持续到 __tFailOff 置真为止——模拟真机切桌面后数秒内的事务争用窗口，
// 之后恢复正常，由重试链读回权威
await evalJs(`(function(){
  window.__tFailOff = false;
  window.idbGet = function (key) {
    if (!window.__tFailOff && typeof key === 'string' && key === ${JSON.stringify(cidT)} + ':chat-msgs') {
      return new Promise(function(resolve){ setTimeout(function(){ resolve(undefined); }, 400); });
    }
    return window.__rawIdbGetV(key);
  };
  return 'ok';
})()`);

console.log('\n--- T1/T2: 切到角色T 进聊天页（首读失败），失败窗口内注入消息 ---');
await evalJs(`window.setActiveContact(${JSON.stringify(cidT)})`);
await sleep(500);
await openChat();
await sleep(1200); // 首读已在 ~400ms 时失败；确认此窗口内无破坏性写盘

let hist = await idbTexts(`${JSON.stringify(cidT)} + ':chat-msgs'`);
check('T1 首读失败后 IDB 历史原封不动', Array.isArray(hist) && hist.filter(t => String(t).indexOf('T线-历史') >= 0).length === 3, JSON.stringify(hist));

// 失败窗口内 TA 消息到达（真实场景：日常问候/查岗/bg-keep 补发）
await evalJs(`(function(){ if (window.chatAddIn) window.chatAddIn('T2窗口内新消息'); return true; })()`);
await sleep(1200);
hist = await idbTexts(`${JSON.stringify(cidT)} + ':chat-msgs'`);
check('T2 失败窗口内新消息未覆盖 IDB 历史', Array.isArray(hist) && hist.filter(t => String(t).indexOf('T线-历史') >= 0).length === 3, JSON.stringify(hist));
const lsRawT = await evalJs(`localStorage.getItem('xy-home-v2:' + ${JSON.stringify(cidT)} + ':chat-msgs')`);
const lsOkT = (function () { try { const a = JSON.parse(lsRawT); return Array.isArray(a) && a.length >= 1; } catch (e) { return lsRawT == null; } })();
check('T2b LS 兜底快照未被写成空数组', lsOkT, String(lsRawT ? lsRawT.slice(0, 60) : 'null'));

console.log('\n--- T3: 解除争用，等待重试读回权威 ---');
await evalJs(`window.__tFailOff = true; true`);
let rendered = false;
for (let i = 0; i < 30; i++) {
  const n = await evalJs(`(function(){ var b=document.getElementById('chat-body'); return b ? b.textContent.indexOf('T线-历史消息1') >= 0 : false; })()`);
  if (n) { rendered = true; break; }
  await sleep(500);
}
check('T3 重试成功后历史渲染回聊天页', rendered, '');
await sleep(800);
hist = await idbTexts(`${JSON.stringify(cidT)} + ':chat-msgs'`);
const hasNew = Array.isArray(hist) && hist.some(t => String(t).indexOf('T2窗口内新消息') >= 0);
check('T3b 权威读回后新消息合并落盘', hasNew, JSON.stringify(hist));

console.log('\n--- T4: 空数组守卫（未读权威的联系人收到保存请求不写盘）---');
// 新建一个从未打开过聊天页的联系人，直接注入保存请求（内存为空）
const guardRes = JSON.parse(await evalJs(`(function(){
  return new Promise(function(resolve){
    var cid = window.createContact('角色G');
    var key = 'xy-home-v2:' + cid + ':chat-msgs';
    window.setActiveContact(cid);
    setTimeout(function(){
      try { if (window.chatAddIn) window.chatAddIn('G线-触发保存'); } catch(e){}
      setTimeout(function(){
        window.__rawIdbGetV(key).then(function(v){
          resolve(JSON.stringify({ v: v === undefined || v === null ? null : JSON.parse(v).length }));
        });
      }, 1000);
    }, 300);
  });
})()`) || '{}');
check('T4 未读权威前保存不把空/单条写坏既有键（键应不存在或含该消息且历史不受影响）', guardRes.v === null || guardRes.v >= 1, JSON.stringify(guardRes));

console.log('\n--- T5/T6: 跨桌面安全追加（call/feed/mail 共用通道）---');
// 建一个有历史的联系人 H5，停在 default 桌面（模拟 TA 在别的桌面发动态/来信/通话结束）
const t5 = JSON.parse(await evalJs(`(function(){
  return new Promise(function(resolve){
    var cid = window.createContact('角色X');
    var msgs = [
      { side: 'in', text: 'X线-历史消息1', ts: Date.now() - 200000 },
      { side: 'out', text: 'X线-历史消息2', ts: Date.now() - 190000 }
    ];
    var key = 'xy-home-v2:' + cid + ':chat-msgs';
    window.idbSet(key, JSON.stringify(msgs)).then(function(){
      localStorage.removeItem(key);
      resolve(JSON.stringify({ ok: true, cid: cid }));
    });
  });
})()`) || '{}');
check('T5 种子：角色X 两条历史', t5.ok === true, JSON.stringify(t5));
if (!t5.ok) process.exit(1);
const cidX = t5.cid;
// 注入对 X 键的持续读取失败，然后触发跨桌面追加
await evalJs(`(function(){
  window.__xFail = true;
  window.__rawIdbGetX = window.idbGet;
  window.idbGet = function (key) {
    if (window.__xFail && typeof key === 'string' && key === 'xy-home-v2:' + ${JSON.stringify(cidX)} + ':chat-msgs') {
      return new Promise(function(resolve){ setTimeout(function(){ resolve(undefined); }, 200); });
    }
    return window.__rawIdbGetX(key);
  };
  return 'ok';
})()`);
await evalJs(`window.chatAppendToDeskMsg(${JSON.stringify(cidX)}, 'X线-跨桌系统提示'); true`);
await sleep(1200);
let xHist = await idbTexts(`${JSON.stringify(cidX)} + ':chat-msgs'`);
check('T6a 读取失败期间跨桌追加不覆盖历史', Array.isArray(xHist) && xHist.filter(t => String(t).indexOf('X线-历史') >= 0).length === 2, JSON.stringify(xHist));
// 解除失败，等重试把提示补进去
await evalJs(`window.__xFail = false; true`);
let appended = false;
for (let i = 0; i < 12; i++) {
  xHist = await idbTexts(`${JSON.stringify(cidX)} + ':chat-msgs'`);
  if (Array.isArray(xHist) && xHist.some(t => String(t).indexOf('X线-跨桌系统提示') >= 0)) { appended = true; break; }
  await sleep(500);
}
check('T6b 读取恢复后系统提示重试落盘且历史完整', appended && Array.isArray(xHist) && xHist.filter(t => String(t).indexOf('X线-历史') >= 0).length === 2, JSON.stringify(xHist));
// 确认无历史键的联系人可直接创建
const t6c = JSON.parse(await evalJs(`(function(){
  return new Promise(function(resolve){
    var cid = window.createContact('角色Y');
    setTimeout(function(){
      window.chatAppendToDeskMsg(cid, 'Y线-首条跨桌提示');
      setTimeout(function(){
        window.__rawIdbGetX('xy-home-v2:' + cid + ':chat-msgs').then(function(v){
          resolve(JSON.stringify({ n: v ? JSON.parse(v).length : 0 }));
        });
      }, 600);
    }, 300);
  });
})()`) || '{}');
check('T6c 确认无历史的联系人可正常首建记录', t6c.n === 1, JSON.stringify(t6c));

const failed = results.filter(r => !r.ok);
console.log('\n===== 回归结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);
