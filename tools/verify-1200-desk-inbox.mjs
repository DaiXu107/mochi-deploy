// ===== 常驻回归：#1200 弹窗提示有互动卡、点进聊天却什么都没有（跨桌面追加分流 + 权威回填）=====
// 根因（零机型分支，任何机型该联系人历史 >4MB 分块后必现）：
//   ① #722 分块联系人整包键 :chat-msgs 已删除，读侧 loadMsgs 只认 :chat-blk-idx——
//     但跨桌面追加（查岗卡/求聊天/礼物卡 chatAppendDeskRec/chatAppendToDeskMsg）只会读写整包键；
//   ② 整包键缺失＋账本 n>0 → deskAppendMissGuard 重试 5 次后【静默丢弃】；而弹窗/通知在投递那刻已发。
//   合起来＝「弹窗说有互动卡片，点进聊天什么都没有」。
// 修法：整包缺失且检出分块索引 / 重试耗尽 / 读键持续抛错 → 落持久中转箱 :chat-desk-inbox，
//   loadMsgs 权威落定后 chatDeskInboxMerge 回填（去重）并入 msgs＋重渲；写箱时该桌面已切回＝就地排空。
// 断言（判别器＝HEAD 红侧必红）：
//   A1 分块桌面追加 → 秒级落入 :chat-desk-inbox（红＝永无此键，10s 后静默丢）
//   A2 分块桌面追加不得重建孤儿整包 :chat-msgs（防 #358 回归）
//   A3 切到该桌面进聊天 → 卡片出现在聊天消息里且中转箱被清空（红＝什么都没有＝原症状）
//   C1 「读整包键持续抛错」路径 → 同样落中转箱（红＝catch 里静默丢）
//   B1 全新空桌面（账本 0）追加 → 仍直建整包（守卫放行语义不变，两侧同绿＝回归护栏）
//   Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1200-desk-inbox.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
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
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-inbox-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            const desc = (d && ((d.exception && d.exception.description) || d.text)) || 'err';
            jsExcepts.push(String(desc).split('\n').slice(0, 3).join(' | ').slice(0, 200));
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'EVAL_ERR:' + e; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1000);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(1000);
  for (let i = 0; i < 30; i++) {
    if (await evalJs("typeof window.createContact === 'function' && typeof window.idbGet === 'function' && typeof window.idbSet === 'function'")) break;
    await sleep(400);
  }
}
async function reloadClean() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await openPage();
}
async function poll(asyncCheck, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await evalJs(asyncCheck);
    if (r === true) return true;
    if (typeof r === 'string' && r.startsWith('EVAL_ERR:')) { console.log('  poll-eval-err: ' + r.slice(0, 140)); return false; }
    await sleep(200);
  }
  return false;
}

await reloadClean();

// ---- 场景A：分块联系人（有 :chat-blk-idx、无整包键、账本>0）跨桌面追加 ----
const sA = await evalJs(`(async function(){
  try {
    var cid = window.createContact('分块桌面');
    var pk = 'xy-home-v2:' + cid;
    var t0 = Date.now() - 86400000;
    var blk = [
      { side: 'out', text: 'old1', ts: t0 },
      { side: 'in', text: 'old2', ts: t0 + 60000 }
    ];
    await window.idbSet(pk + ':chat-blk-0', JSON.stringify(blk));
    await window.idbSet(pk + ':chat-blk-idx', JSON.stringify({ v: 1, blocks: [{ k: 'chat-blk-0', bytes: 512, n: 2 }], total: 2, nextSeq: 1 }));
    var meta = JSON.stringify({ n: 2, b: 0 });
    await window.idbSet(pk + ':chat-meta', meta); localStorage.setItem(pk + ':chat-meta', meta);
    window.__inboxKey = pk + ':chat-desk-inbox';
    window.__pkMsgs = pk + ':chat-msgs';
    window.chatAppendDeskRec(cid, { side: 'in', special: 'ask-card', text: '你在干嘛呢', askQuestion: '你在干嘛呢', askType: 'text', ts: t0 + 7200000 });
    return JSON.stringify({ cid: cid, pk: pk, active: window.__activeCid || 'default' });
  } catch (e) { return 'ERR:' + e; }
})()`);
let JA = null; try { JA = JSON.parse(sA || '{}'); } catch (e) {}
if (!JA || !JA.pk) { console.error('场景A 建桌面失败: ' + sA); chrome.kill(); server.close(); process.exit(1); }
const INBOX_KEY = JSON.stringify(JA.pk + ':chat-desk-inbox');
const PK_MSGS = JSON.stringify(JA.pk + ':chat-msgs');
const inboxHas = `(function(){ return new Promise(function(res){
  window.idbGet(${INBOX_KEY}).then(function(v){
    var a = typeof v === 'string' ? JSON.parse(v) : v;
    res(Array.isArray(a) && a.some(function(m){ return m && m.text === '你在干嘛呢'; }));
  }).catch(function(){ res(false); });
}); })()`;
check('A1 分块桌面追加 → 落入 :chat-desk-inbox（红侧＝10s 重试后静默丢，永无此键）', !!(await poll(inboxHas, 9000)), '');
// A1 判定后 4 秒再验 A2：HEAD 红侧耗尽路径会 writeArr 孤儿整包或什么都不写；绿侧必须永不建整包
await sleep(4000);
const a2 = await evalJs(`(function(){ return new Promise(function(res){
  window.idbGet(${PK_MSGS}).then(function(v){
    var ls = null; try { ls = localStorage.getItem(${PK_MSGS}); } catch (e) {}
    res((v === undefined || v === null) && ls === null);
  }).catch(function(){ res(false); });
}); })()`);
check('A2 分块桌面追加不得重建孤儿整包 :chat-msgs（防 #358 覆盖族回归）', a2 === true, String(a2).slice(0, 60));

// ---- 场景C：读整包键持续抛错 → 中转箱（catch 支路）----
const sC = await evalJs(`(async function(){
  try {
    var cid2 = window.createContact('抛错桌面');
    var pk2 = 'xy-home-v2:' + cid2;
    var meta = JSON.stringify({ n: 5, b: 0 });
    await window.idbSet(pk2 + ':chat-meta', meta); localStorage.setItem(pk2 + ':chat-meta', meta);
    var orig = window.idbGet;
    window.__origIdbGet = orig;
    window.__cKey = pk2 + ':chat-msgs';
    window.idbGet = function (k) { if (k === window.__cKey) return Promise.reject(new Error('boom')); return orig.apply(null, arguments); };
    window.chatAppendDeskRec(cid2, { side: 'in', special: 'poke', text: '来陪我聊聊天', ts: Date.now() });
    return JSON.stringify({ pk2: pk2 });
  } catch (e) { return 'ERR:' + e; }
})()`);
let JC = null; try { JC = JSON.parse(sC || '{}'); } catch (e) {}
const cHas = JC && JC.pk2 ? `(function(){ return new Promise(function(res){
  var a = null; try { a = JSON.parse(localStorage.getItem(${JSON.stringify(JC.pk2 + ':chat-desk-inbox')}) || 'null'); } catch (e) {}
  res(!!(Array.isArray(a) && a.some(function(m){ return m && m.text === '来陪我聊聊天'; })));
}); })()` : 'false';
check('C1 读键持续抛错 → 落中转箱（红侧＝catch 只排 3 次重试后静默丢）', !!(await poll(cHas, 12000)), '');
await evalJs("(function(){ try { if (window.__origIdbGet) window.idbGet = window.__origIdbGet; } catch(e){} return true; })()");

// ---- 场景B：全新空桌面（账本 0）仍走旧「守卫放行直建整包」——两侧同绿＝语义不变 ----
const sB = await evalJs(`(async function(){
  try {
    var cid3 = window.createContact('空桌面B');
    var pk3 = 'xy-home-v2:' + cid3;
    window.chatAppendDeskRec(cid3, { side: 'in', text: 'only', ts: Date.now() });
    return JSON.stringify({ pk3: pk3 });
  } catch (e) { return 'ERR:' + e; }
})()`);
let JB = null; try { JB = JSON.parse(sB || '{}'); } catch (e) {}
const bHas = JB && JB.pk3 ? `(function(){ return new Promise(function(res){
  window.idbGet(${JSON.stringify(JB.pk3 + ':chat-msgs')}).then(function(v){
    var a = typeof v === 'string' ? JSON.parse(v) : v;
    res(Array.isArray(a) && a.length === 1 && a[0].text === 'only');
  }).catch(function(){ res(false); });
}); })()` : 'false';
check('B1 全新空桌面追加仍直建整包（守卫放行语义零变化）', !!(await poll(bHas, 6000)), '');

// ---- 场景A3：切到分块桌面进聊天 → 卡片回填上屏＋中转箱清空（症状本体）----
const sw = await evalJs(`(async function(){
  try {
    if (window.setActiveContact) window.setActiveContact(${JSON.stringify(JA.cid)});
    var tries = 0;
    while (tries++ < 120 && !(window.__chatDbReady && window.__chatDbReady())) await new Promise(function(r){ setTimeout(r, 250); });
    if (window.enterChat) window.enterChat();
    return JSON.stringify({ ready: !!(window.__chatDbReady && window.__chatDbReady()) });
  } catch (e) { return 'ERR:' + e; }
})()`);
const a3 = await poll(`(function(){ try {
  var arr = window.getChatMsgs ? window.getChatMsgs() : [];
  return Array.isArray(arr) && arr.some(function(m){ return m && m.text === '你在干嘛呢' && m.special === 'ask-card'; });
} catch (e) { return false; } })()`, 15000);
check('A3 切进该桌面聊天后卡片在消息里（红侧＝「弹窗说有卡、点进聊天空」原症状）', !!a3, sw);
const a3b = await poll(`(function(){
  var v1 = false, v2 = false;
  try { v1 = localStorage.getItem(${INBOX_KEY}) === null; } catch (e) {}
  return new Promise(function(res){
    window.idbGet(${INBOX_KEY}).then(function(v){ v2 = (v === undefined || v === null); res(v1 && v2); }).catch(function(){ res(v1); });
  });
})()`, 6000);
check('A3b 回填后中转箱已清空（LS+IDB 双面）', !!a3b, '');

check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' | '));

console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail + (jsExcepts.length ? '  异常记录 ' + jsExcepts.length : ''));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail > 0 ? 1 : 0);
