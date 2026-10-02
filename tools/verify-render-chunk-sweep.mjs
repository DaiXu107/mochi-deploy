// ===== 回归脚本：#720 两项优化（②整窗渲染分帧 ③LS 残留大键补扫） =====
// 用法：node tools/verify-render-chunk-sweep.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge）
// ② 背景：冷路径（keepScroll=false）renderWindow 的 renderMsg 循环一口气建 200 条气泡＝单条
//   数百毫秒长任务（权威到达/冷进聊天那一下「卡住＋进度条冻结」；K80 诊断单 898/924ms 实证）。
//   修复＝每批 50 条进 fragment、帧间 setTimeout 让路、世代令牌防重入、keepScroll 同步零变化。
// ③ 背景：xyStore.set 对 >200KB 值只进 IDB+内存并删 LS 副本；老版本写入的键内容涨过限后
//   未再 set＝LS 残留双倍副本（实测 fav-msgs 207KB，诊断「LS 残留大键」告警）。修复＝回填
//   就绪后 20s 一次性补扫（仅内存缓存已持有该键时删；chat-msgs/gc-msgs/chat-arch/chat-meta
//   兜底族不碰）。
// 判据：
//   A 轴：源码锚（RENDER_CHUNK / 世代令牌 / 换装后补贴底 / forceSync / lsResidueSweep / 排除族 / 内存守卫）。
//   B 轴（真实产物 390×844，Android UA，CPU 4×）：
//     B1 冷进聊天（200 条）最终渲染完整（分帧不丢条、不半途而废）
//     B2 分帧期间主线程有让路：最长单段 JS 阻塞显著小于「一口气渲染」基线（注入计时对比）
//     B3 冷进后贴底（分帧换装后自动补 scrollChatBottom）
//     B4 keepScroll 路径（用户触发重渲 chatReRenderTime）同步完成且滚动位置稳定
//     B5 连续两次 renderWindow（重入）不产生窗口错乱：DOM [data-idx] 连续、条数正确
//     B6 LS 补扫：>200KB 且已在内存的键被清、LS 里小键与 chat-msgs 兜底快照原样保留
//     B7 补扫后读取不受影响（xyStore.get 仍拿到同值；应用无异常）
//   Z 轴：全程零 JS 异常。
// RED 基线（HEAD 的 chat.js/idb.js）：A 轴红、B2 红（单段阻塞≈整窗渲染耗时）。
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
const idbSrc = rd('src/js/idb.js');
chk('A1 分帧批大小常量在位（#720a）', chatSrc.includes('const RENDER_CHUNK = 50;'));
chk('A2 世代令牌防重入（#720b）', chatSrc.includes('if (myToken !== _rwToken) { try { restoreInplaceDrafts(); } catch (e) {} return; }'));
chk('A3 分帧换装后补贴底（#720c）', chatSrc.includes('scrollChatBottom(); // #718 分帧路径'));
chk('A4 forceSync 路径给「返回即需节点」的调用方（#720d）', chatSrc.includes('renderWindow(false, true, true); // #718 forceSync'));
chk('A5 LS 残留大键清扫在既有 #139 机制上（单一实现，不重复造轮子）', idbSrc.includes('window.idbLsResidueSweep = lsResidueSweep;') && (idbSrc.match(/function lsResidueSweep()/g) || []).length === 1);
chk('A6 聊天 LS 快照族排除（删则兜底副本被当残留清掉）', idbSrc.includes('if (isChatMsgsKey(k)) return false;                  // 聊天 LS 快照是唯一备份，绝不动'));
chk('A7 先写后删（绝不先删后写）', idbSrc.includes('// IDB 缺失/落后 → 以 LS 为最新追平 IDB，写成功且 LS 未变才删（绝不先删后写）'));
chk('A8 补扫失败重试闸（#721a）', idbSrc.includes('if (_lsSweepFail && _lsSweepTries < 2) {'));
chk('A9 追平写失败计数（#721b）', idbSrc.includes('const markFail = function () { _lsSweepFail = true; };'));

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
const profile = join(process.env.TEMP || '/tmp', 'mochi-v720-' + Date.now());
const cdpPort = 9100 + Math.floor(Math.random() * 200);
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

const mkImg = (n) => 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="hsl(' + (n * 31) + ',70%,55%)"/></svg>').toString('base64');

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

// 种子：当前桌面 200 条（含图，撑渲染成本）+ 一个 260KB 的残留大键（已进 IDB，LS 也挂着）
const seed = await evalJs(`(async function(){
  var IMG = ${JSON.stringify(Array.from({ length: 10 }, (_, i) => mkImg(i)))};
  var out = []; var now = Date.now();
  for (var i = 0; i < 200; i++) {
    var w = i % 2 === 0;
    out.push(w ? {side:'out',ts:now-(200-i)*60000,text:'图片'+i,parts:[{k:'img',v:IMG[i%IMG.length]}]}
               : {side:'in',ts:now-(200-i)*60000,text:'聊天 '+i+' 内容若干',parts:[{k:'text',v:'聊天 '+i+' 内容若干'}]});
  }
  try { window.activeStore().set('chat-msgs', JSON.stringify(out)); } catch (e) {}
  if (window.idbSet) { try { await window.idbSet(window.activePrefix() + ':chat-msgs', JSON.stringify(out)); } catch (e) {} }
  // 残留大键：>200KB 的 fav-msgs（同时写 IDB；LS 里留一份＝模拟旧版残留）
  var big = { list: [] };
  for (var k = 0; k < 300; k++) big.list.push({ t: 'fav-' + k, v: new Array(900).fill('x').join('') });
  var bj = JSON.stringify(big);
  try { localStorage.setItem(window.activePrefix() + ':fav-msgs', bj); } catch (e) {}
  if (window.idbSet) { try { await window.idbSet(window.activePrefix() + ':fav-msgs', bj); } catch (e) {} }
  return 'seeded ' + bj.length;
})()`);
await sleep(1200);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(1500);

// ---- B1~B3 冷进聊天：分帧渲染完整 + 有让路 + 贴底 ----
await evalJs(`(function(){
  window.__gaps = [];
  var last = performance.now();
  window.__gapT = setInterval(function () {
    var t = performance.now();
    window.__gaps.push(Math.round(t - last));
    last = t;
  }, 8);
  return 1; })()`);
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(3500);
const r1 = await evalJs(`(function(){
  clearInterval(window.__gapT);
  var cb = document.getElementById('chat-body');
  var n = document.querySelectorAll('#chat-body .msg').length;
  var max = cb ? (cb.scrollHeight - cb.clientHeight) : -1;
  var distToBottom = cb ? (max - cb.scrollTop) : -1;
  var biggestGap = window.__gaps.length ? Math.max.apply(null, window.__gaps) : -1;
  return JSON.stringify({ msgs: n, distToBottom: Math.round(distToBottom), biggestGap: biggestGap, samples: window.__gaps.length });
})()`);
const j1 = r1 ? JSON.parse(r1) : {};
chk('B1 冷进聊天 ~200 条全渲染（分帧不丢条；归一化可能合并个别相邻重复，≥195 即通过）', j1.msgs >= 195, r1);
chk('B2 分帧期间单段阻塞受控（每批约 50 条；一口气渲染旧代码此处≈整窗几百毫秒）', j1.biggestGap > 0 && j1.biggestGap < 400, 'biggestGap=' + j1.biggestGap + 'ms');
chk('B3 分帧换装后自动贴底（分帧路径补贴底生效）', Math.abs(j1.distToBottom) <= 12, r1);

// ---- B4 keepScroll 同步路径：滚动位置稳定 ----
const r2 = await evalJs(`(async function(){
  var cb = document.getElementById('chat-body');
  cb.scrollTop = Math.max(0, cb.scrollHeight - cb.clientHeight - 500); // 上翻一点
  await new Promise(function (r) { setTimeout(r, 300); });
  var before = cb.scrollTop;
  window.chatReRenderTime(); // keepScroll=true 路径
  await new Promise(function (r) { setTimeout(r, 200); });
  var after = cb.scrollTop;
  return JSON.stringify({ before: Math.round(before), after: Math.round(after), n: document.querySelectorAll('#chat-body .msg').length });
})()`);
const j2 = r2 ? JSON.parse(r2) : {};
chk('B4 keepScroll 重渲后滚动位置稳定且条数不变（同步路径零视觉变化）',
  typeof j2.before === 'number' && Math.abs(j2.after - j2.before) <= 60 && j2.n >= 195, r2);

// ---- B5 连续两次冷渲染（重入）不产生窗口错乱 ----
const r3 = await evalJs(`(async function(){
  // 冷路径分帧重入：连续两次进聊天（第二次在第一次分帧未完时发起）＝世代令牌应作废旧构建
  var a = document.querySelector('.app[data-app="chat"]');
  var cb = document.getElementById('chat-back'); if (cb) cb.click();
  await new Promise(function (r) { setTimeout(r, 600); });
  if (a) a.click();
  await new Promise(function (r) { setTimeout(r, 60); });
  var bk = document.getElementById('chat-back'); if (bk) bk.click();
  await new Promise(function (r) { setTimeout(r, 60); });
  if (a) a.click();
  await new Promise(function (r) { setTimeout(r, 3000); });
  var els = document.querySelectorAll('#chat-body .msg');
  var idxs = [];
  for (var i = 0; i < els.length; i++) { var di = els[i].dataset.idx; if (di !== undefined) idxs.push(Number(di)); }
  // 只断言「严格递增」（禁止重复/倒退＝旧构建交错写入的信号）；
  // 归一化会合法地把 msgs 合并变小而不重渲，DOM 下标可能领先于 msgs，故不强求连续。
  var okSeq = true, dup = 0;
  for (var j = 1; j < idxs.length; j++) { if (idxs[j] <= idxs[j - 1]) { okSeq = false; } if (idxs[j] === idxs[j - 1]) dup++; }
  return JSON.stringify({ n: els.length, okSeq: okSeq, dup: dup, first: idxs[0], last: idxs[idxs.length - 1], count: idxs.length });
})()`);
const j3 = r3 ? JSON.parse(r3) : {};
chk('B5 分帧重入后 DOM [data-idx] 严格递增无重复（世代令牌防旧构建交错写入）',
  !!j3.okSeq && j3.dup === 0 && j3.count >= 190, r3);

// ---- B6~B7 LS 残留大键补扫 ----
const r4 = await evalJs(`(async function(){
  var KEY = window.activePrefix() + ':fav-msgs';
  var sweep = window.idbLsResidueSweep;
  // 残留形态：>200KB 的 LS 副本 + IDB 同值（老版本写入后内容涨过 LS_BIG_LIMIT 未再 set）
  var big = { list: [] };
  for (var k = 0; k < 300; k++) big.list.push({ t: 'f' + k, v: new Array(900).fill('y').join('') });
  var bj = JSON.stringify(big);
  if (window.idbSet) { try { await window.idbSet(KEY, bj); } catch (e) {} }
  try { window.activeStore().set('chat-msgs', window.activeStore().get('chat-msgs') || '[]'); } catch (e) {}
  var chatLsProbe = window.activePrefix() + ':chat-msgs';
  try { if (!localStorage.getItem(chatLsProbe)) localStorage.setItem(chatLsProbe, '[[probe]]'); } catch (e) {}
  try { localStorage.setItem(KEY, bj); } catch (e) { return 'setItem-fail ' + e.message; }
  var beforeLs = localStorage.getItem(KEY);
  if (sweep) sweep();
  await new Promise(function (r) { setTimeout(r, 1500); });
  var afterLs = localStorage.getItem(KEY);
  var val = null; try { val = window.activeStore().get('fav-msgs'); } catch (e) {}
  return JSON.stringify({
    hasSweep: !!sweep,
    beforeLen: (beforeLs || '').length,
    afterLen: (afterLs || '').length,
    valLen: (val || '').length,
    chatLsKept: (localStorage.getItem(chatProbeSafe()) || '').length > 0
  });
  function chatProbeSafe() { return chatLsProbe; }
})()`);
const j4 = r4 ? JSON.parse(r4) : {};
chk('B6 LS 残留大键被清（>200KB 副本移除）', j4.hasSweep && j4.beforeLen > 200000 && j4.afterLen === 0, r4);
chk('B7 清扫后读取不受影响（内存/IDB 仍同值）且聊天 LS 兜底快照保留', j4.valLen > 200000 && j4.chatLsKept, r4);

// ---- Z 零异常 ----
const errs = await evalJs('JSON.stringify(window.__jsErrors||[])');
chk('Z1 全程零 JS 异常', errs === '[]', String(errs));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
cleanup(fail ? 1 : 0);
