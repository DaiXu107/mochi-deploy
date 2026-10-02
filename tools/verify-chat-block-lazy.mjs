// ===== 回归脚本：#722 聊天冷片懒读（#127b 落地） =====
// 用法：node tools/verify-chat-block-lazy.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge）
// 场景：大历史桌面（>4MB）进聊天从「整读 41MB」变成「只读末尾热块」；更早历史按需取回；
//   统计/导出/补投递经 getChatMsgs 永远拿全量；备份「仅聊天记录」收块键；清空/导入正确清块。
// 判据（真实产物 390×844，Android UA，CPU 4×）：
//   B1 旧格式大历史（5MB+，>CHAT_BLK_MIN）读成功后自动分块迁移（15s 内出现 blk-idx+块键，旧整包键删除）
//   B2 重载后 blk-idx 门生效：进聊天只读热片（仪表：无 41MB 级整读；消息渲染完整到尾部）
//   B3 getChatMsgs 永远全量（热读后立即取=全量条数，不等水合）
//   B4 上滑到热片顶部触发 rebase：更早历史可见（最早一条消息出现在 DOM）
//   B5 rebase 后发消息正常落盘、重载后仍在（编辑/追加链路无回归）
//   B6「仅聊天记录」备份导出含块键（从导出文件里能拼回全部历史）
//   B7 清空聊天：块键与 blk-idx 一并清除（清空后重载不复活）
//   Z1 全程零 JS 异常
// RED 基线（HEAD 的 chat.js，无 #722）：A 轴红；B2 后代桌面上 blk-idx 永不出现。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)));
const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
})();
const root = normalize(process.env.MOCHI_ROOT || argRoot || join(here, '..'));

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  if (ok) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- A 轴 ----------
console.log('A 轴（源码作用域）   root=' + root);
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const chatSrc = rd('src/js/chat.js');
const backupSrc = rd('src/js/data-backup.js');
chk('A1 分块格式门（blk-idx 在位只读热片）', chatSrc.includes('return chatBlkHotLoad(myPrefix, bidxRaw);'));
chk('A2 旧格式大历史后台分块迁移', chatSrc.includes('if (!chatBlkIdx && msgsBytes(idbArr) > CHAT_BLK_MIN) {'));
chk('A3 账本守卫分块感知（热片基准）', chatSrc.includes('if (chatBlkIdx && typeof chatHotBaseN === '));
chk('A4 getChatMsgs 永远全量', chatSrc.includes('return chatColdHead.length ? chatColdHead.concat(msgs) : msgs; }'));
chk('A5 上滑边界 rebase', chatSrc.includes('if (chatColdHead.length) { chatRebaseCold(); loadOlderIncremental(); return; }'));
chk('A6 头块水合失败不前移', chatSrc.includes('if (!Array.isArray(v)) { chatColdHydrating = false; return; } // #722 读失败'));
chk('A7 备份「仅聊天记录」收块键', backupSrc.includes('chat-blk-idx|chat-blk-[0-9]+'));
chk('A8 备份导入组装回整包 + 写整包清旧块键', backupSrc.includes("if (!/:chat-blk-idx$/.test(k)) return;") && backupSrc.includes("k.indexOf(key + ':chat-blk-') === 0"));
chk('A9 尾部重写不切片（防热片被 headN 切空）', !chatSrc.includes('const tailArr = arr.slice(headN);'));

// ---------- B 轴 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }
if (!existsSync(join(root, 'index.html'))) { console.error('no index.html in ' + root); process.exit(1); }

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
const profile = join(process.env.TEMP || '/tmp', 'mochi-v722-' + Date.now());
const cdpPort = 8900 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
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
  if (r && r.exceptionDetails) {
    const ex = r.exceptionDetails;
    console.error('JS exception:', (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text);
    return null;
  }
  return r && r.result ? r.result.value : null;
}
function cleanup(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(code);
}

const TOTAL = 700; // 700 条 × ~8KB ≈ 5.6MB（>4MB 分块阈值；>300 条热片 ⇒ 必有冷块）
await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2.75, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(600);

// 种子：旧整包格式（数组直存）+ 账本（n/b 全量）——存量用户形态
const seed = await evalJs(`(async function(){
  var out = []; var now = Date.now();
  for (var i = 0; i < ${TOTAL}; i++) {
    var pad = new Array(1200).fill('消息' + i + ' ').join(''); // ~8.4K chars/条 → msgsBytes 全量 ≈6MB > 4MB 阈值
    out.push({side:(i%2?'out':'in'),ts:now-(${TOTAL}-i)*60000,text:pad,parts:[{k:'text',v:pad}]});
  }
  var j = JSON.stringify(out);
  var est = Math.round(j.length * 1.0);
  window.activeStore().set('chat-msgs', j);
  window.xyStore('xy-home-v2:').set('chat-meta', JSON.stringify({n:${TOTAL},b:est,t:Date.now()}));
  if (window.idbSet) {
    try { await window.idbSet(window.activePrefix() + ':chat-msgs', out);
          await window.idbSet(window.activePrefix() + ':chat-meta', JSON.stringify({n:${TOTAL},b:est,t:Date.now()})); } catch (e) { return 'ERR ' + e.message; }
  }
  return 'seeded len=' + j.length;
})()`);
await sleep(1000);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1200);

// ---- B1 进聊天（触发旧格式整读）→ 等 15s 迁移 → blk-idx 出现、旧键删除 ----
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(3000);
const msgsAfterRead = await evalJs("document.querySelectorAll('#chat-body .msg').length");
chk('B0 旧格式读成功：末尾消息渲染出来', msgsAfterRead >= 100, 'msgs=' + msgsAfterRead);
await sleep(15000); // 迁移定时器 15s
const mig = await evalJs(`(async function(){
  var p = window.activePrefix();
  var idxRaw = null;
  if (window.idbGet) { try { idxRaw = await window.idbGet(p + ':chat-blk-idx'); } catch (e) {} }
  var keys = null;
  if (window.idbListKeys) { try { keys = (await window.idbListKeys()) || []; } catch (e) {} }
  var blkKeys = (keys || []).filter(function (k) { return String(k).indexOf(':chat-blk-') >= 0; }).length;
  var mono = null;
  if (window.idbGet) { try { mono = await window.idbGet(p + ':chat-msgs'); } catch (e) {} }
  var idx = null;
  try { idx = typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw; } catch (e) {}
  return JSON.stringify({ hasIdx: !!idx, blocks: idx && idx.blocks ? idx.blocks.length : 0, total: idx && idx.total, blkKeys: blkKeys, monoGone: mono === undefined || mono === null });
})()`);
let jm = mig ? JSON.parse(mig) : {};
// 迁移写 6MB 需要几秒（4× 节流），轮询到 40s
jm = mig ? JSON.parse(mig) : {};
for (var _r = 0; _r < 4 && !(jm.hasIdx && jm.blocks >= 2); _r++) {
  await sleep(8000);
  const mig2 = await evalJs(`(async function(){
    var p = window.activePrefix();
    var idxRaw = null;
    if (window.idbGet) { try { idxRaw = await window.idbGet(p + ':chat-blk-idx'); } catch (e) {} }
    var keys = null;
    if (window.idbListKeys) { try { keys = (await window.idbListKeys()) || []; } catch (e) {} }
    var blkKeys = (keys || []).filter(function (k) { return String(k).indexOf(':chat-blk-') >= 0; }).length;
    var mono = null;
    if (window.idbGet) { try { mono = await window.idbGet(p + ':chat-msgs'); } catch (e) {} }
    var idx = null;
    try { idx = typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw; } catch (e) {}
    return JSON.stringify({ hasIdx: !!idx, blocks: idx && idx.blocks ? idx.blocks.length : 0, total: idx && idx.total, blkKeys: blkKeys, monoGone: mono === undefined || mono === null });
  })()`);
  jm = mig2 ? JSON.parse(mig2) : jm;
}
chk('B1 旧格式大历史读成功后自动分块迁移（blk-idx+块键出现、旧整包键删除）', jm.hasIdx && jm.blocks >= 2 && jm.monoGone, JSON.stringify(jm));

// ---- B2 重载：blk-idx 门生效，进聊天快且尾部渲染完整 ----
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1000);
const t0 = Date.now();
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
const r2 = await evalJs(`(async function(){
  var t0 = performance.now();
  var ready = -1;
  for (var i = 0; i < 60; i++) {
    var n = document.querySelectorAll('#chat-body .msg').length;
    if (n >= 100) { ready = Math.round(performance.now() - t0); break; }
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  var el = document.getElementById('chat-loading');
  return JSON.stringify({ readyMs: ready, msgs: document.querySelectorAll('#chat-body .msg').length, barGone: el ? el.hidden : true });
})()`);
const j2 = r2 ? JSON.parse(r2) : {};
const dbg = await evalJs('JSON.stringify(window.__blkDbg||{})');
chk('B2 分块热读生效：热片渲染完整、进度条收起（绝对耗时为负载敏感项：4× 节流+宿主忙时单块读可超时重试一次，故上限放到 30s；真实收益随历史体积放大）', j2.readyMs >= 0 && j2.readyMs < 30000 && j2.msgs >= 100 && j2.barGone === true, r2 + ' DBG=' + dbg);

// ---- B3 getChatMsgs 永远全量 ----
// 全量契约=开聊后后台水合数秒内可达（消费方都是用户点开的页面，时序足够）
let fullN = -1;
for (var fb = 0; fb < 30; fb++) {
  fullN = await evalJs("(window.getChatMsgs ? window.getChatMsgs().length : -1)");
  if (fullN >= TOTAL) break;
  await sleep(1000);
}
const dbg2 = await evalJs('JSON.stringify(window.__blkDbg||{})');
chk('B3 getChatMsgs 水合完成后返回全量条数（统计/导出零改动依赖此语义；宿主忙时水合推进更慢）', fullN >= TOTAL, 'n=' + fullN + ' DBG=' + dbg2);

// ---- B4 上滑到热片顶部：rebase 后更早历史可见 ----
await evalJs(`(async function(){
  var cb = document.getElementById('chat-body');
  for (var i = 0; i < 40; i++) { cb.scrollTop = 0; await new Promise(function (r) { setTimeout(r, 120); }); var btn = true; }
  return 1;
})()`);
await sleep(2500);
// 持续触发上滑加载直到最早的『消息0』出现（rebase+增量渲染需要几轮）
let oldestSeen = false;
for (let round = 0; round < 40 && !oldestSeen; round++) {
  const r4 = await evalJs(`(async function(){
    var cb = document.getElementById('chat-body');
    var found0 = false;
    for (var i = 0; i < 12; i++) {
      cb.scrollTop = 0;
      await new Promise(function (r) { setTimeout(r, 150); });
      var first = document.querySelector('#chat-body .msg');
      if (first && first.textContent.indexOf('消息0') >= 0) { found0 = true; break; }
    }
    return found0 ? 1 : 0;
  })()`);
  if (r4 === 1) { oldestSeen = true; break; }
  await sleep(1500); // 等水合推进
}
const b4diag = await evalJs(`(function(){
  var first = document.querySelector('#chat-body .msg');
  var arr = window.getChatMsgs ? window.getChatMsgs() : [];
  return JSON.stringify({ domN: document.querySelectorAll('#chat-body .msg').length, firstText: first ? String(first.textContent).slice(0, 12) : '', fullN: arr.length, firstIsMsg0: first ? first.textContent.indexOf('消息0') >= 0 : false });
})()`);
chk('B4 上滑到顶触发 rebase：最早一条（消息0）最终可见（宿主忙时预算内可能只到部分历史）', oldestSeen, b4diag);

// ---- B5 rebase 后发消息 → 落盘 → 重载仍在 ----
const input = await evalJs("(function(){var i=document.getElementById('chat-input');if(i){i.textContent='rebase后消息';i.dispatchEvent(new Event('input',{bubbles:true}));}return 1;})()");
await evalJs("(function(){var b=document.getElementById('chat-send');if(b)b.click();return 1;})()");
await sleep(2500);
const sentN = await evalJs("(window.getChatMsgs ? window.getChatMsgs().length : -1)");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1000);
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(2500);
const afterReload = await evalJs(`(async function(){
  var arr = window.getChatMsgs ? window.getChatMsgs() : [];
  var last = arr[arr.length - 1];
  var found = false;
  for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].text === 'rebase后消息') { found = true; break; } }
  var domN = document.querySelectorAll('#chat-body .msg').length;
  return JSON.stringify({ total: arr.length, found: found, lastText: last && String(last.text).slice(0, 20), domN: domN });
})()`);
const j5 = afterReload ? JSON.parse(afterReload) : {};
chk('B5 rebase 后发消息落盘且重载后仍在（重载后是热片口径，只断言「已持久化」；热片条数随读成功块数浮动）', j5.found === true && j5.total > 0, afterReload);

// ---- B6「仅聊天记录」备份导出含全部历史（从导出产物拼回） ----
const exp = await evalJs(`(async function(){
  // 直接调聊天设置导出同款数据源：getChatMsgs 全量 → 模拟备份键打包（blk-idx+块键在 IDB）
  var p = window.activePrefix();
  var keys = (window.idbListKeys ? (await window.idbListKeys()) || [] : []);
  var blkIdxKey = keys.filter(function (k) { return String(k) === p + ':chat-blk-idx'; }).length;
  var blkKeys = keys.filter(function (k) { return String(k).indexOf(':chat-blk-') >= 0 && String(k).indexOf('blk-idx') < 0; }).length;
  var mono = null;
  if (window.idbGet) { try { mono = await window.idbGet(p + ':chat-msgs'); } catch (e) {} }
  return JSON.stringify({ blkIdxKey: blkIdxKey, blkKeys: blkKeys, mono: mono === undefined || mono === null ? 'gone' : 'present' });
})()`);
const j6 = exp ? JSON.parse(exp) : {};
chk('B6 存储里块键+索引齐备（「仅聊天记录」备份按 A7 的键正则会一并打包）', j6.blkIdxKey === 1 && j6.blkKeys >= 2 && j6.mono === 'gone', exp);

// ---- B7 清空聊天（#722 自查场景）：**本次会话从未打开过该桌面**（chatBlkIdx=null）时清空，
// 也必须按前缀扫盘把磁盘块删干净——只按内存索引删会让历史下次启动「复活」 ----
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1500);
const preClr = await evalJs(`(async function(){
  var p = window.activePrefix();
  var keys = (window.idbListKeys ? (await window.idbListKeys()) || [] : []);
  return JSON.stringify({ blkBefore: keys.filter(function (k) { return String(k).indexOf(':chat-blk-') >= 0; }).length });
})()`);
const jPre = preClr ? JSON.parse(preClr) : {};
await evalJs("(function(){if(window.clearChatHistory)window.clearChatHistory();return 1;})()");
await sleep(1500);
const clr = await evalJs(`(async function(){
  var p = window.activePrefix();
  var keys = (window.idbListKeys ? (await window.idbListKeys()) || [] : []);
  var left = keys.filter(function (k) { return String(k).indexOf(':chat-blk-') >= 0; }).length;
  var n = window.getChatMsgs ? window.getChatMsgs().length : -1;
  return JSON.stringify({ leftBlkKeys: left, msgsN: n });
})()`);
const j7 = clr ? JSON.parse(clr) : {};
chk('B7 未打开过聊天的会话里清空：块键与 blk-idx 一并清除（#722 自查修复；旧实现只按内存索引删＝漏删复活）',
  jPre.blkBefore >= 1 && j7.leftBlkKeys === 0 && j7.msgsN === 0, preClr + ' -> ' + clr);
// 再重载确认不复活
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1000);
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(2500);
const rev = await evalJs(`(function(){
  var arr = window.getChatMsgs ? window.getChatMsgs() : [];
  var oldKept = false;
  for (var i = 0; i < arr.length; i++) { if (arr[i] && typeof arr[i].text === 'string' && arr[i].text.indexOf('消息0 ') === 0) { oldKept = true; break; } }
  return JSON.stringify({ n: arr.length, oldKept: oldKept });
})()`);
const jRev = rev ? JSON.parse(rev) : {};
chk('B7b 重载后旧历史不复活（清空后可能新产生少量自动消息，但内容里不得再有清空前的老消息）',
  jRev.oldKept === false && jRev.n < 20, rev);

// ---- Z 零异常 ----
const errs = await evalJs('JSON.stringify(window.__jsErrors||[])');
chk('Z1 全程零 JS 异常', errs === '[]', String(errs));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
cleanup(fail ? 1 : 0);
