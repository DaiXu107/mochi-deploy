// ===== 回归脚本：真我 Edge 切联系人后聊天记录消失（IDB 事务挂起） =====
// 用法：node build.mjs && node tools/verify-chat-switch-idb-hang.mjs
// 复现路径（用户反馈「真我手机 Edge，切换联系人桌面再切换回来，聊天记录消失」）：
//   核心场景：联系人聊天记录只在 IDB（LS 快照空），第一次进聊天页 IDB 读取成功
//   渲染，但原实现不写 LS 快照 → 切走再切回时 IDB 事务挂起 + LS 空 → 永久消失。
//   修复 3：IDB 读取成功后同步写 LS 快照 → 切回时 LS 兜底渲染，不消失。
//   修复 1：idbGet 超时保护，避免永久挂死。
//   修复 2：保险丝触发时重渲染兜底。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9920 + Math.floor(Math.random() * 70));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-chat-hang-' + Date.now()),
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

// ============================================================
// 场景一（核心）：只在 IDB（LS 空）的联系人，查看后切走再切回，IDB 挂起，不消失
// ============================================================
const seed = JSON.parse(await evalJs(`(function(){
  try {
    var cid = window.createContact('角色X');
    var msgs = [
      { side: 'in', text: '你好呀', ts: Date.now() - 300000 },
      { side: 'out', text: '在的~', ts: Date.now() - 290000 },
      { side: 'in', text: '今天一起吃饭吗', ts: Date.now() - 280000 }
    ];
    var data = JSON.stringify(msgs);
    var prefix = 'xy-home-v2:' + cid;
    window.idbSet(prefix + ':chat-msgs', data);
    var lsEmpty = !localStorage.getItem(prefix + ':chat-msgs');
    return JSON.stringify({ cid: cid, ok: true, n: msgs.length, lsEmpty: lsEmpty });
  } catch(e) { return JSON.stringify({ ok: false, err: e.message }); }
})()`) || '{}');
check('种子：cX 聊天记录只写 IDB（LS 快照空）', seed.ok === true && seed.lsEmpty === true, JSON.stringify(seed));
if (!seed.ok || !seed.cid) process.exit(1);
const cid = seed.cid;
const cxPrefix = 'xy-home-v2:' + cid;

// 切到 cX，进聊天页 → IDB 读取成功 → 修复3 应写 LS 快照
await evalJs(`(function(){ window.setActiveContact(${JSON.stringify(cid)}); return true; })()`);
await sleep(400);
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return true; })()`);
await sleep(1500);
for (let i = 0; i < 30; i++) { const ready = await evalJs('(function(){try{return document.getElementById("chat-body").children.length>0;}catch(e){return false;}})()'); if (ready) break; await sleep(300); }
await sleep(600);

const firstView = JSON.parse(await evalJs(`(function(){
  var body = document.getElementById('chat-body');
  return JSON.stringify({
    childCount: body ? body.children.length : -1,
    hasContent: body ? body.children.length > 0 : false,
    lsSnap: !!localStorage.getItem(${JSON.stringify(cxPrefix)} + ':chat-msgs')
  });
})()`) || '{}');
console.log('  [第一次进 cX 聊天页]', JSON.stringify(firstView));
check('第一次进 cX 聊天页 IDB 读取成功渲染', firstView.hasContent === true, 'childCount=' + firstView.childCount);
check('修复3：IDB 读取成功后写 LS 快照', firstView.lsSnap === true, 'lsSnap=' + firstView.lsSnap);

// 切到 default
await evalJs(`(function(){ window.setActiveContact('default'); return true; })()`);
await sleep(400);

// 注入挂起 IDB：cX 的 chat-msgs 读取永不返回（模拟真我 Edge 事务挂起）
const patchOk = await evalJs(`(function(){
  if (!window.idbGet) return 'no idbGet';
  window.__origIdbGetFixed = window.idbGet;
  window.idbGet = function (key) {
    if (typeof key === 'string' && key.indexOf(${JSON.stringify(cxPrefix)}) >= 0 && key.indexOf(':chat-msgs') >= 0) {
      return new Promise(function(){});
    }
    return window.__origIdbGetFixed(key);
  };
  return 'ok';
})()`);
check('注入挂起 IDB（cX chat-msgs 读取永不返回）', patchOk === 'ok', String(patchOk));
if (patchOk !== 'ok') process.exit(1);

// 切回 cX，进聊天页 → IDB 挂起，但 LS 快照（修复3 写的）应同步渲染兜底
await evalJs(`(function(){ window.setActiveContact(${JSON.stringify(cid)}); return true; })()`);
await sleep(400);
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return true; })()`);
await sleep(1500);

const secondView = JSON.parse(await evalJs(`(function(){
  var body = document.getElementById('chat-body');
  var text = body ? body.textContent : '';
  return JSON.stringify({
    visible: !!document.getElementById('page-chat') && !document.getElementById('page-chat').hidden,
    childCount: body ? body.children.length : -1,
    hasContent: body ? body.children.length > 0 : false,
    sample: text.slice(0, 80),
    lsSnap: !!localStorage.getItem(${JSON.stringify(cxPrefix)} + ':chat-msgs')
  });
})()`) || '{}');
console.log('  [切回 cX 聊天页（IDB 挂起）]', JSON.stringify(secondView));
check('切回 cX 聊天页可见', secondView.visible === true, 'visible=' + secondView.visible);
check('聊天记录不消失（LS 快照兜底渲染）', secondView.hasContent === true, 'childCount=' + secondView.childCount);
check('LS 快照仍在（兜底数据未丢）', secondView.lsSnap === true, 'lsSnap=' + secondView.lsSnap);

// ============================================================
// 场景二：idbGet 超时保护不破坏正常读取
// ============================================================
await evalJs(`(function(){ window.idbGet = window.__origIdbGetFixed; return true; })()`);
const normalRead = JSON.parse(await evalJs(`(function(){
  return new Promise(function(resolve){
    window.idbGet(${JSON.stringify(cxPrefix)} + ':chat-msgs').then(function(v){
      resolve(JSON.stringify({ ok: true, hasData: !!v, len: v ? (typeof v === 'string' ? v.length : -1) : 0 }));
    });
    setTimeout(function(){ resolve(JSON.stringify({ ok: false, timeout: true })); }, 10000);
  });
})()`) || '{}');
check('idbGet 正常键仍能返回数据（超时修复不破坏正常读取）', normalRead.ok === true && normalRead.hasData === true, 'len=' + normalRead.len);

const notExistRead = JSON.parse(await evalJs(`(function(){
  return new Promise(function(resolve){
    var t0 = Date.now();
    window.idbGet('xy-home-v2:__nonexist_hang_test__:chat-msgs').then(function(v){
      resolve(JSON.stringify({ ok: true, v: v, elapsed: Date.now() - t0 }));
    });
    setTimeout(function(){ resolve(JSON.stringify({ ok: false, timeout: true })); }, 10000);
  });
})()`) || '{}');
check('idbGet 不存在键快速返回 undefined（不误伤）', notExistRead.ok === true && notExistRead.v === undefined, 'elapsed=' + notExistRead.elapsed + 'ms');

const failed = results.filter(r => !r.ok);
console.log('\n===== 回归结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);
