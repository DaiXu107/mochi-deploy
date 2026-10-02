// ===== 排查：同一条消息显示成两条一模一样的（vivo Edge 用户反馈） =====
// 场景：
//   S1 正常发送（点发送按钮）→ DOM/内存/存储 各有几条？
//   S2 刷新后重进聊天（走 IDB 权威合并）→ 会不会翻倍？
//   S3 连续快速发 3 条 → 有无重复？
//   S4 慢 IDB 模式（模拟 vivo Edge：indexedDB.open 延迟 12s 才返回 →
//      idbGet 超时 undefined / chatDbReady 保险丝路径）→ 发送后会不会重复？
//   S5 TA 回复链有无连续相同内容？
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const cdpPort = 9900 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dup-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

const results = [];
function check(desc, ok, detail) { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : '')); }

// 统计：DOM 气泡数 / 内存数组条数 / 相邻重复对
async function countMarker(marker) {
  const expr = `(() => {
  const mk = ${JSON.stringify(marker)};
  const nodes = Array.from(document.querySelectorAll('#chat-body .msg-out, #chat-body .msg-in'));
  const domHits = nodes.filter(n => (n.textContent || '').indexOf(mk) >= 0).length;
  const arr = (window.getChatMsgs ? window.getChatMsgs() : []) || [];
  const arrHits = arr.filter(m => m && typeof m.text === 'string' && m.text.indexOf(mk) >= 0).length;
  let adjDup = 0; const dupSamples = [];
  for (let i = 1; i < arr.length; i++) {
    const a = arr[i-1], b = arr[i];
    if (a && b && a.side === b.side && a.text === b.text && Math.abs((a.ts||0) - (b.ts||0)) < 5000) {
      adjDup++; if (dupSamples.length < 3) dupSamples.push(String(b.text).slice(0, 24) + '@ts' + b.ts);
    }
  }
  return { domHits, arrLen: arr.length, arrHits, adjDup, dupSamples };
})()`;
  return evalJs(expr);
}

async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(800);
}
async function enterChatAndSend(text, viaEnter) {
  return evalJs(`(function(){
    try {
      window.enterChat();
      var inp = document.getElementById('chat-input');
      inp.textContent = ${JSON.stringify(text)};
      var ev = new Event('input', { bubbles: true }); inp.dispatchEvent(ev);
      if (${viaEnter ? 'true' : 'false'}) {
        var ke = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
        inp.dispatchEvent(ke);
      } else {
        document.getElementById('chat-send').click();
      }
      return 'sent';
    } catch (e) { return 'err:' + e.message; }
  })()`);
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ================= S1 正常发送 =================
await gotoApp();
await enterChatAndSend(' DUPTEST-S1-甲 ', false);
await sleep(600);
let c = await countMarker('DUPTEST-S1-甲');
check('S1 点按钮发送：DOM 1 条', c.domHits === 1, JSON.stringify(c));
check('S1 内存数组 1 条', c.arrHits === 1, 'arrHits=' + c.arrHits);

// ================= S2 刷新后重进（IDB 合并） =================
await gotoApp();
await sleep(1200);
await evalJs('window.enterChat(); "ok"');
await sleep(1200);
c = await countMarker('DUPTEST-S1-甲');
check('S2 刷新重进：DOM 仍 1 条', c.domHits === 1, JSON.stringify(c));
check('S2 内存数组仍 1 条（合并没有翻倍）', c.arrHits === 1, 'arrHits=' + c.arrHits);

// ================= S3 连续快速 3 条 =================
await enterChatAndSend(' DUPTEST-S3-A ', false);
await sleep(80);
await enterChatAndSend(' DUPTEST-S3-B ', false);
await sleep(80);
await enterChatAndSend(' DUPTEST-S3-C ', false);
await sleep(900);
for (const mk of ['DUPTEST-S3-A', 'DUPTEST-S3-B', 'DUPTEST-S3-C']) {
  c = await countMarker(mk);
  check('S3 快速连发 ' + mk.slice(-1) + '：DOM 1 条 / 数组 1 条', c.domHits === 1 && c.arrHits === 1, JSON.stringify(c));
}

// ================= S5 TA 回复链相邻重复检测 =================
await sleep(14000); // 等回复轮跑完
c = await evalJs(`(() => {
  const arr = (window.getChatMsgs ? window.getChatMsgs() : []) || [];
  let adjDup = 0; const samples = [];
  for (let i = 1; i < arr.length; i++) {
    const a = arr[i-1], b = arr[i];
    if (a && b && a.side === b.side && a.text === b.text && Math.abs((a.ts||0)-(b.ts||0)) < 5000) {
      adjDup++; samples.push(String(b.text).slice(0,20)+'#'+b.ts);
    }
  }
  return { total: arr.length, adjDup, samples };
})()`);
check('S5 全程无相邻完全重复消息', c && c.adjDup === 0, JSON.stringify(c));

// ================= S4 慢 IDB（vivo Edge 模拟） =================
// indexedDB.open 的 onsuccess 延迟 12 秒触发 → idbGet 必超时(undefined)、15s 保险丝路径全走到
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function () {
  const DELAY = 12000;
  const origOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function () {
    const req = origOpen.apply(this, arguments);
    let userFn = null;
    Object.defineProperty(req, 'onsuccess', {
      get: function () { return userFn; },
      set: function (f) { userFn = function (ev) { setTimeout(function () { f.call(req, ev); }, DELAY); }; }
    });
    return req;
  };
})();` });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500); // 此时 IDB 还没就绪（挂起中），直接进聊天发消息
await evalJs('window.enterChat(); "ok"');
await enterChatAndSend(' DUPTEST-S4-慢IDB ', false);
await sleep(1000);
c = await countMarker('DUPTEST-S4-慢IDB');
check('S4a IDB 挂起期间发送：内存数组 1 条', c.arrHits <= 1, JSON.stringify(c));
await sleep(17000); // 跨过 open 12s 返回 + idbGet 4+4s 超时 + 15s 保险丝，等合并全部落定
c = await countMarker('DUPTEST-S4-慢IDB');
check('S4b 合并落定后 DOM 1 条', c.domHits === 1, JSON.stringify(c));
check('S4b 数组 1 条（慢 IDB 合并不翻倍）', c.arrHits === 1, 'arrHits=' + c.arrHits);

// 再刷新一次（此时 IDB 已有数据、不再延迟），验证最终持久化无重复
await gotoApp();
await evalJs('window.enterChat(); "ok"');
await sleep(1200);
c = await countMarker('DUPTEST-S4-慢IDB');
check('S4c 再次刷新重进：DOM 1 条', c.domHits === 1, JSON.stringify(c));

chrome.kill();
const pass = results.filter(Boolean).length;
console.log('---');
console.log(pass + '/' + results.length + ' 通过');
process.exit(pass === results.length ? 0 : 1);
