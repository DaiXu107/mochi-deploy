// ===== 回归验证：#675 打开聊天「消息全部弹一下，然后再恢复正常」（同族第五轮） =====
// 症状：打开聊天 ~250ms 后整个消息区（200 气泡连同全部 img 节点）整批销毁重建、图片逐张
// 重新解码＝肉眼「全部弹一下再恢复」。根因：后台归一化（runDeferredNormalization）删相邻
// 重复（normCollapseRange，removedAll>0）时 finish 仍走 renderWindow 整窗重建——#402 只收了
// 「无结构删除」的字段级路径，本条是同族最后一条整窗路径。
// 修复：patchNormRemovalsInPlace 按「记录 → 原始下标」原地删节点 + 幸存 data-idx 回推，
// 零整窗重建（图片不重新解码）。
// 断言（真实点击聊天图标进入，MutationObserver + 逐帧采样）：
//   J1 首渲之后零整窗拆建：无 removedNodes>=50 的批（修复前=finish 整窗 rm200）
//   J2 结构删除确实原位生效：终态 DOM data-idx 连续、尾条=权威末条、无相邻重复文本残留
//   J3 贴底契约：采样末帧仍贴底（gap<=8，原位删节点不破坏 #504/#162 贴底语义）
//   J4 重开聊天零重建（#220/#241 不回归）
//   A1~A4 静态锚：#675a~d 四条逻辑锚在 src/js/chat.js
// 用法：node tools/verify-chat-norm-tear.mjs（默认对仓库根产物；MOCHI_SERVE_ROOT=<目录> 可对
//       临时构建产物做红绿对照）。需要 Node 21+ 与本机 Chrome/Edge。
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
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9660 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-674-' + Date.now()),
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
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
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(500);
}
// 种 320 条历史，其中每 20 条埋一对相邻重复（同 ts|side|同文本）——归一化必删（结构性删除）
const SEED_N = 320;
async function seed() {
  await openPage();
  await evalJs(`(function(){
    const now = Date.now(); const arr = [];
    for (let i = 0; i < ${SEED_N}; i++) {
      const m = { ts: now - (${SEED_N} - i) * 60000, side: i % 2 ? 'in' : 'out', text: (i % 2 ? '对方消息' : '我的消息') + i };
      arr.push(m);
      if (i % 20 === 0 && i > 0) arr.push(Object.assign({}, m));
    }
    window.activeStore().set('chat-msgs', JSON.stringify(arr));
    return arr.length;
  })()`);
  await sleep(300);
}

async function enterAndObserve(ms = 4000) {
  await evalJs("(function(){window.__tearBatches=[];window.__endGap=null;var b=document.getElementById('chat-body');var mo=new MutationObserver(function(recs){var rm=0,ad=0;recs.forEach(function(r){rm+=r.removedNodes.length;ad+=r.addedNodes.length;});if(rm||ad)window.__tearBatches.push({t:Math.round(performance.now()),rm:rm,ad:ad});});mo.observe(b,{childList:true,subtree:false});var a=document.querySelector('.app[data-app=\"chat\"]');a.click();setTimeout(function(){window.__endGap=b.scrollHeight-b.scrollTop-b.clientHeight;mo.disconnect();window.__idxSeq=Array.prototype.map.call(b.querySelectorAll('[data-idx]'),function(e){return Number(e.dataset.idx);});window.__lastTexts=Array.prototype.slice.call(b.querySelectorAll('.msg[data-idx]'),-6).map(function(e){return (e.textContent||'').trim();});},Math.round(" + ms + "));return true;})()");
  await sleep(ms + 800);
  const r = await evalJs('JSON.stringify({b:window.__tearBatches||[],gap:window.__endGap,idx:(window.__idxSeq||[]).length,first:(window.__idxSeq||[])[0],last:(window.__idxSeq||[])[(window.__idxSeq||[]).length-1],txt:window.__lastTexts||[]})');
  return JSON.parse(r || '{}');
}

// ---- 静态锚 A1~A4（源码逻辑锚，判别「修复逻辑在不在」）----
const src = readFileSync(normalize(dirname(fileURLToPath(import.meta.url)) + '/../src/js/chat.js'), 'utf8');
check('A1 静态锚：删除原位收敛函数在源（#675a）', src.includes('function patchNormRemovalsInPlace(removedRecs) {'));
check('A2 静态锚：归一化原始下标映射在源（#675b）', src.includes('normOrigIdx.set(msgs[_oi], _oi); } catch (e) { normOrigIdx = null; }'));
check('A3 静态锚：删除记录对象登记在源（#675c）', src.includes('try { if (normRemovedRecs) normRemovedRecs.push(a); } catch (e) {} // FIX #675'));
check('A4 静态锚：收尾删除路径接线在源（#675d）', src.includes('patched = patchChangedInPlace(newIdxs, renderStart);'));

// ---- J1~J3 首次进入（带相邻重复的大历史）----
await seed();
const r1 = await enterAndObserve();
const bigTear = (r1.b || []).filter((x) => x.rm >= 50);
const expectDupPairs = 15; // i=20,40,...,280,300 共 15 对（i%20===0 且 i>0，i<320）
check('J1 首渲后零整窗拆建（无 rm>=50 批）', bigTear.length === 0, JSON.stringify({ batches: (r1.b || []).length, big: bigTear.slice(0, 4) }));
let idxOk = false, dupLeft = true;
if ((r1.idx || 0) > 1) {
  idxOk = true;
  const seqSrc = await evalJs('(function(){var b=document.getElementById("chat-body");var s=[];for(var k=0;k<b.children.length;k++){var e=b.children[k];if(e.dataset&&e.dataset.idx!==undefined)s.push(Number(e.dataset.idx));}for(var j=1;j<s.length;j++)if(s[j]!==s[j-1]+1)return false;return true;})()');
  idxOk = !!seqSrc;
  const dupRes = await evalJs('(function(){var b=document.getElementById("chat-body");var ms=b.querySelectorAll(".msg[data-idx]");var n=0;for(var k=1;k<ms.length;k++){var a=(ms[k-1].textContent||"").trim(),c=(ms[k].textContent||"").trim();if(a&&a===c)n++;}return n;})()');
  dupLeft = Number(dupRes) === 0;
}
check('J2a 终态 data-idx 连续有序（原位删节点+下标回推未破坏窗口对账）', idxOk);
check('J2b 终态无相邻重复文本残留（结构删除确实生效）', dupLeft, 'last=' + JSON.stringify((r1.txt || []).slice(-3)));
check('J2c 权威末段已渲染在屏（尾条 idx ≥ 种子末条；应用自身启动期消息允许追加）', typeof r1.last === 'number' && r1.last >= SEED_N - 1, 'last=' + r1.last);
check('J3 首次进入末帧仍贴底（gap<=8）', r1.gap !== null && r1.gap <= 8, 'gap=' + r1.gap);

// ---- J4 退出再进入（#220/#241 同窗补丁不回归）----
await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();return true;})()");
await sleep(600);
const r2 = await enterAndObserve(2500);
const bigTear2 = (r2.b || []).filter((x) => x.rm >= 50);
check('J4 重开聊天零整窗拆建', bigTear2.length === 0, JSON.stringify(bigTear2.slice(0, 3)));
check('J4b 重开末帧仍贴底（gap<=8）', r2.gap !== null && r2.gap <= 8, 'gap=' + r2.gap);

chrome.kill(); server.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
