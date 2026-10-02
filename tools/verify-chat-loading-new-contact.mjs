// ===== 回归：#526 新建联系人首次进聊天不再显示「正在加载聊天记录…」进度条 =====
// 用法：node build.mjs && node tools/verify-chat-loading-new-contact.mjs
// 根因（用户反馈「新建桌面联系人第一次聊天，没有任何数据，却显示正在加载聊天记录的进度条」）：
//   chat.js 的进度条显隐条件原为 `chatVisible() && !chatDbReady && !msgs.length`，无法区分
//   「新联系人本来就没有历史」与「有历史的桌面正在异步读库」。新建联系人走空库分支时，
//   loadMsgs 要等 2.5s 空库二次复核才置 chatDbReady，这段时间进度条一直显示。
// 修复：新增 chatKnownEmpty（账本 0 + 探测确认 miss / 确认空库时置真），进度条已知空库不显示。
// 断言：
//   S1（对照，不能误伤）有历史的桌面（仅 IDB 历史、LS 无快照）读库期间进度条仍在显示
//   S2 新建联系人（无任何数据）进聊天：进度条自始至终不显示
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-526-' + Date.now()),
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
async function loadingShown() {
  return await evalJs("(function(){ var el=document.getElementById('chat-loading'); return !!(el && !el.hidden); })()");
}
async function openChat() {
  await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return !!app; })()`);
}
async function closeChat() {
  await evalJs(`(function(){ var b=document.getElementById('chat-back'); if(b){b.click();return true;} var p=document.getElementById('page-chat'); if(p) p.hidden=true; return false; })()`);
  await sleep(250);
}

check('静态：模板含 #chat-loading 进度条元素', await evalJs("!!document.getElementById('chat-loading')") === true, '');

// —— S1 对照：有历史的桌面（仅 IDB，无 LS 快照）读库期间进度条应显示 ——
console.log('\n--- S1: 有历史的桌面读库期间进度条仍显示（防误伤）---');
const s1 = JSON.parse(await evalJs(`(function(){
  return new Promise(function(resolve){
    try {
      var cid = window.createContact('526有历史');
      var msgs = [
        { side: 'in', text: '历史消息1', ts: Date.now() - 300000 },
        { side: 'out', text: '历史消息2', ts: Date.now() - 290000 }
      ];
      var key = 'xy-home-v2:' + cid + ':chat-msgs';
      window.__raw526 = window.idbGet;
      // createContact 会切到新桌面并触发一次早读，先切回 default 复位数状态，
      // 再切到目标桌面时才是「首读」路径（否则触发 skipRead 时间闸读不到补写的种子）
      window.setActiveContact('default');
      window.idbSet(key, JSON.stringify(msgs)).then(function(){
        localStorage.removeItem(key);
        resolve(JSON.stringify({ ok: true, cid: cid, key: key }));
      });
    } catch(e) { resolve(JSON.stringify({ ok:false, err:e.message })); }
  });
})()`) || '{}');
check('S1 种子：有历史联系人（仅 IDB）', s1.ok === true, JSON.stringify(s1));
if (!s1.ok) { chrome.kill(); server.close(); process.exit(1); }

// 注入读延迟，制造可观测的读库窗口
await evalJs(`(function(){
  window.__d526 = true;
  window.idbGet = function (key) {
    if (window.__d526 && key === ${JSON.stringify(s1.key)}) {
      return new Promise(function(resolve){ setTimeout(function(){ resolve(window.__raw526(key)); }, 2500); });
    }
    return window.__raw526(key);
  };
  return 'ok';
})()`);
await sleep(300);
await evalJs(`window.setActiveContact(${JSON.stringify(s1.cid)})`);
await sleep(400);
await openChat();
// 读库延迟 2.5s，窗口很宽：轮询采样期间只要出现过一次进度条即算对照生效
let shownDuring = false;
for (let i = 0; i < 12; i++) {
  if (await loadingShown() === true) { shownDuring = true; break; }
  await sleep(120);
}
check('S1 有历史桌面读库期间进度条显示', shownDuring === true, 'shown=' + shownDuring);
// 等读取完成 + 渲染
let rendered = false;
for (let i = 0; i < 30; i++) {
  const has = await evalJs("(function(){var b=document.getElementById('chat-body');return !!b && b.textContent.indexOf('历史消息1')>=0;})()");
  if (has) { rendered = true; break; }
  await sleep(400);
}
check('S1 读库完成后历史渲染', rendered === true, '');
check('S1 读库完成后进度条隐藏', (await loadingShown()) === false, '');
await evalJs('window.__d526 = false; window.idbGet = window.__raw526; true');
await closeChat();

// —— S2：新建联系人（无任何数据）进聊天：进度条自始至终不显示 ——
console.log('\n--- S2: 新建联系人首次进聊天进度条不显示 ---');
const s2 = JSON.parse(await evalJs(`(function(){
  try { var cid = window.createContact('526空桌面'); return JSON.stringify({ ok:true, cid:cid }); }
  catch(e){ return JSON.stringify({ ok:false, err:e.message }); }
})()`) || '{}');
check('S2 新建联系人', s2.ok === true, JSON.stringify(s2));
if (!s2.ok) { chrome.kill(); server.close(); process.exit(1); }

await evalJs(`window.setActiveContact(${JSON.stringify(s2.cid)})`);
await sleep(150);
await openChat();
await sleep(120);
const earlyShown = await loadingShown();
const earlyReady = await evalJs('!!(window.__chatDbReady && window.__chatDbReady())');
const samples = [{ at: 120, shown: earlyShown }];
let elapsed = 120;
for (const t of [250, 400, 800, 1600, 3000]) {
  await sleep(t - elapsed);
  elapsed = t;
  samples.push({ at: t, shown: await loadingShown() });
}
// 判别力：早期 chatDbReady 仍为 false（旧条件会显示进度条）而进度条实际不显示＝修复生效
check('S2 早期仍处未就绪窗口（旧条件本会显示进度条）', earlyReady === false, 'ready=' + earlyReady);
const anyShown = samples.some(s => s.shown === true);
check('S2 新建联系人进聊天进度条全程不显示', anyShown === false, JSON.stringify(samples));
const chatEmptyOk = await evalJs("(function(){var b=document.getElementById('chat-body');return !!b && b.children.length===0;})()");
check('S2 新联系人消息区为空（无历史）', chatEmptyOk === true, 'children=' + chatEmptyOk);

const failed = results.filter(r => !r.ok);
console.log('\n===== 回归结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);
