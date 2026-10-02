// ===== #1271 切后台释放 #1222 押在闭包里的两库原文串引用（iPhone 16 Pro Max / Safari 实报「来回切换卡顿」配套闸） =====
// 背景（2026-09-25，perfcheck＋diag 实锤）：报障机 cc-groups-public 是【内存体检】头号驻留
//   （实测 14.5M 字符），本页被整页回收 91→115 次＝「来回切换卡顿」本体是内存压力→iOS 杀页→
//   切回冷启动。#1222 给字卡库角标闸配的记账变量把两库**原文串**押进 chatcard.js 闭包：
//   #975/#1195e 切后台通用闸放掉 memoryCache 大键副本时，这份引用却原地不放＝头号驻留换个
//   口袋继续挂着，回收照旧。零机型／零 UA 分支＝判据只有「页面可见性」这一个事件源。
// 修复：poolSrcRelease() 只丢引用不碰持久层，挂在既有 pagehide / visibilitychange(hidden)
//   链上与 flushCcSave 同列；回前台首读 NO_SRC≠任何真实读数＝按「变过」失效一次——正确性
//   优先（后台期哪怕真有别处写入也必被重建追上），与切后台前的既有行为同向、只会更省。
// 断言（三本产物对跑：g＝本批｜b＝tip+#1222 闸（无释放）｜r＝纯 tip）：
//   S1/S2 产物锚点（g 绿；b/r 红＝本批新契约）
//   S3 #1222 force 闸门仍在（g/b 绿、r 红＝叠批对照）
//   B1 数据不动重复进页零整库 parse（g/b 绿、r 红＝#1222 口径没被接线搞坏）
//   B2a 模拟切后台→回前台→首进**必须**重建一次（g 绿；b 红＝闭包钉住原文串、醒来零重建＝
//        释放没发生的直接证据；r 无闸门恒绿＝对照组）
//   B2b 醒来第二进回到零 parse（g/b 绿、r 红＝释放不是把闸门焊成每进必清）
//   B3 后台期改数据→回前台角标照新值且确实重建（三侧皆绿＝没把降级修成漏判）
//   B4 全程零未捕获 JS 错误（假 hidden 走的是真监听链，噪音由本行兜底）
// 用法：MOCHI_ROOT=<产物目录> node tools/verify-1271-poolsrc-release.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT)
  : (process.env.SERVE_ROOT ? normalize(process.env.SERVE_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..'));
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
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? '✅' : '❌') + ' ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
{
  let html = '';
  try { html = readFileSync(join(root, 'index.html'), 'utf8'); const jd = join(root, 'js'); for (const f of readdirSync(jd)) if (f.endsWith('.js')) html += `\n${readFileSync(join(jd, f), 'utf8')}`; } catch (e) {}
  check('S1 产物含 poolSrcRelease 定义（丢引用本体）', html.includes('function poolSrcRelease() { poolSrcPub = NO_SRC; poolSrcOwn = NO_SRC; }'), 'len=' + html.length);
  check('S2 释放挂在既有 hidden 链上（只定义不接线＝死代码）', html.includes("if (document.visibilityState === 'hidden') { flushCcSave(); poolSrcRelease(); }"));
  check('S3 #1222 force 闸门仍在（本批叠在其上，没被改写）', html.includes('libCounts.fun = -1; libCounts.pubFun = -1; if (poolSrcChanged()) pubInvalidate();'));
}

const profileDir = join(process.env.TEMP || '/tmp', 'mochi-1271-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 25));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disk-cache-size=1048576',
  '--user-data-dir=' + profileDir,
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { chrome.kill(); } catch (e) {}
  try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

let ws = null, msgId = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(m, p = {}) {
  const id = ++msgId;
  // 看门狗：高负载下并行清理工具可能整棵杀掉无头实例；缺它 ev() 永挂＝整支脚本假死
  return new Promise((res) => {
    const to = setTimeout(() => { pend.delete(id); res(null); }, 20000);
    pend.set(id, (r) => { clearTimeout(to); res(r); });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
}
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

// 种子与探针口径同 #1222：两库原文各 ≈80KB（刻意 <200KB 大键阈值，走 xyStore 内存通道）；
// 公用库前缀 'xy-home-v2' 不带尾冒号（PUB_KEY 全局根键）。
const SEED_FN = `(function(){ try {
  var pad = '重复内容填充字卡正文'.repeat(60); // 720 字符
  var mk = function (tag) {
    var arr = []; for (var i = 0; i < 110; i++) arr.push(tag + '卡' + i + '-' + pad);
    return { text: [[tag + '甲组', arr], [tag + '乙组', []], [tag + '丙组', []]], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] };
  };
  var pub = window.xyStore('xy-home-v2');
  var own = (window.activeStore && window.activeStore()) || window.xyStore('xy-home-v2:default');
  pub.set('cc-groups-public', JSON.stringify(mk('A')));
  own.set('cc-groups', JSON.stringify(mk('B')));
  return 'pub=' + (pub.get('cc-groups-public') || '').length + ',own=' + (own.get('cc-groups') || '').length;
} catch(e){ return 'err:' + String(e); } })()`;
const INSTR = `(function(){
  window.__bigParses = 0;
  var orig = JSON.parse;
  JSON.parse = function(s){ if (typeof s === 'string' && s.length >= 60000) window.__bigParses++; return orig.apply(JSON, arguments); };
})();`;

await connect();
await cdp('Page.enable'); await cdp('Runtime.enable');
let initScriptIds = [];
async function openPage(initScripts) {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  for (const id of initScriptIds) { try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); } catch (e) {} }
  initScriptIds = [];
  for (const src of initScripts) {
    const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: src });
    if (r && r.identifier) initScriptIds.push(r.identifier);
  }
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(700);
  await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
}
const tapTab = (page) => ev(`(function(){var t=document.querySelector('.tab[data-page=${page}]');if(t)t.click();return true;})()`);
const bigCount = async () => Number(await ev('window.__bigParses') || 0);
async function badge(id) {
  for (let i = 0; i < 10; i++) {
    const v = await ev(`(function(){var e=document.getElementById('${id}');return e?e.textContent:'?'})()`);
    if (v && v !== '…' && v !== '?') return v;
    await sleep(300);
  }
  return await ev(`(function(){var e=document.getElementById('${id}');return e?e.textContent:'?'})()`);
}
async function enterLib() { await tapTab('page-home'); await sleep(500); await tapTab('page-chatcard'); await sleep(1400); }
// 模拟切后台/回前台：改写 document.visibilityState/hidden 两个只读口再派发真事件——
// 走的是全站既有 visibility 监听链（含 #1195e 大键释放），不只喂 chatcard 一家。
const setVis = (v) => ev(`(function(){
  try {
    if (!window.__visPatched) {
      window.__visPatched = 1;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return window.__vs || 'visible'; } });
      Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return (window.__vs || 'visible') === 'hidden'; } });
    }
    window.__vs = ${JSON.stringify(v)};
    document.dispatchEvent(new Event('visibilitychange'));
    return 'ok';
  } catch (e) { return 'err:' + String(e); }
})()`);

console.log('--- 准备：探针注入 → 页面就绪 → 内存种大库 ---');
await openPage([INSTR]);
await sleep(11000); // 等启动期字卡库恢复链耗尽再播种（同 #1222：否则 IDB 回填把种子换回出厂库）
const seedInfo = await ev(SEED_FN);
const mSeed = /^pub=(\d+),own=(\d+)$/.exec(String(seedInfo));
check('T0 两库种子写入且各 ≥60KB（xyStore 内存通道）', !!mSeed && Number(mSeed[1]) >= 60000 && Number(mSeed[2]) >= 60000, String(seedInfo));

console.log('--- B1 基线：首进重建；数据不动再进＝零整库 parse（#1222 口径没被接线搞坏） ---');
await ev('window.__bigParses = 0; true;');
await enterLib();
const p0 = await bigCount();
const pubB0 = await badge('cc-pub-count');
await ev('window.__bigParses = 0; true;');
await enterLib();
const p1 = await bigCount();
check('B1a 首次进页整库重建发生（≥2＝公+专两库）', p0 >= 2, 'n=' + p0);
check('B1b 数据未变重复进页零整库 parse', p1 === 0, 'n=' + p1);

console.log('--- B2 模拟切后台→回前台：g 首进必须重建一次（释放发生的证据），b 恒零重建（钉住） ---');
const visHidden = await setVis('hidden');
await sleep(900); // 让 hidden 链上的异步释放/落盘走完
const visBack = await setVis('visible');
await ev('window.__bigParses = 0; true;');
await enterLib();
const p2 = await bigCount();
await ev('window.__bigParses = 0; true;');
await enterLib();
const p3 = await bigCount();
check('B2 后台/回前台事件派发成功', visHidden === 'ok' && visBack === 'ok', visHidden + '/' + visBack);
check('B2a 醒来首进重建一次（闭包原文串引用确已释放）', p2 >= 2, 'n=' + p2);
check('B2b 醒来第二进回到零整库 parse（没被焊成每进必清）', p3 === 0, 'n=' + p3);

console.log('--- B3 后台期改数据→回前台：角标照新值且确实重建（释放≠漏判） ---');
await setVis('hidden');
await ev(`(function(){ try {
  var pub = window.xyStore('xy-home-v2');
  var o = JSON.parse(pub.get('cc-groups-public'));
  o.text[2][1].push('后台新增卡一'); o.text[2][1].push('后台新增卡二'); o.text[2][1].push('后台新增卡三');
  pub.set('cc-groups-public', JSON.stringify(o));
} catch(e){} return true; })()`);
await sleep(900);
await setVis('visible');
await ev('window.__bigParses = 0; true;');
await enterLib();
const p4 = await bigCount();
const pubB1 = await badge('cc-pub-count');
check('B3a 后台期改数据后角标按新值（旧值+3）', String(Number(pubB0) + 3) === String(pubB1), pubB0 + '→' + pubB1);
check('B3b 后台期改数据确实重建（整库 parse ≥1）', p4 >= 1, 'n=' + p4);

console.log('--- B4 全程零未捕获 JS 错误（假 hidden 走真监听链） ---');
{
  const errs = await ev('JSON.stringify(window.__jsErrors || [])');
  let n = 0;
  try { n = JSON.parse(errs || '[]').length; } catch (e) {}
  check('B4 无未捕获 JS 错误', n === 0, 'n=' + n);
}

cleanup();
const fail = results.filter(r => !r.ok).length;
console.log('== 结果：' + (results.length - fail) + '/' + results.length + (fail ? '  FAIL=' + fail : '  全绿'));
process.exit(fail ? 1 : 0);
