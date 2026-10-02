// ===== #575 同类面补齐：等数据取回时也有加载态（不再让空态/角标 0 冒充「没数据」）=====
// 用户指令（2026-09-16）：「那还有需要补的吗，都补一下，不然用户误会是 bug」——承接 #574
// （字卡库管理页空白干等 IDB），把同一类面补齐：
//   ① 聊天页【表情包面板】【拍一拍面板】、②【我的表情包】、③ 字卡库列表页两行角标、
//   ④ 设置→字卡使用状态自检页。
// 现状（#575 前）：这些面在等 IndexedDB 取回时（iOS 挂后台杀连接 → 单次 6s、重试链 14s）
//   要么显示「暂无…」空态、要么角标显 0、要么只有一句转瞬 toast——用户会当成「字卡丢了」。
// 修法：#574 同款「取回中先出占位行」（.mochi-load-row + 旋转指示），取回落定由各 render
//   覆写；角标位改显「…」+ 脉冲类，刷新真值时摘掉。健康设备（本机有数据）不进这些分支。
// 断言：
//   S1 产物含共用加载行样式与各处占位文案
//   A1 表情包面板：字卡挂起取回中 → 出「正在加载表情包…」占位（修前＝「暂无表情包」空态）
//   A2 拍一拍面板：同上 → 出「正在加载该分组拍一拍…」/「正在加载拍一拍字卡…」占位
//   A3 字卡库列表页角标：字卡挂起取回中 → 两行角标显「…」且带脉冲类（修前＝0）
//   B1 健康路径（本地有数据）：表情包面板照常出内容、全程无占位行（零闪动）
//   Z  全程零未捕获 JS 错误
// 用法：node tools/verify-cc-loading-surfaces.mjs
//   SERVE_ROOT=<dir> 指向隔离构建目录（如 /tmp/mochi575）即可先于根产物验证
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.SERVE_ROOT ? normalize(process.env.SERVE_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
{
  let html = '';
  try { html = readFileSync(join(root, 'index.html'), 'utf8'); const jd=join(root,'js'); for (const f of readdirSync(jd)) if (f.endsWith('.js')) html += `\n${readFileSync(join(jd,f),'utf8')}`; } catch (e) {}
  check('S1 产物含共用加载行样式与占位文案',
    html.indexOf('.mochi-load-row') >= 0 && html.indexOf('正在加载表情包…') >= 0 && html.indexOf('cc-cnt-loading') >= 0,
    'len=' + html.length);
}

const profileDir = join(process.env.TEMP || '/tmp', 'mochi-575-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disk-cache-size=1048576', '--user-data-dir=' + profileDir,
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
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; }
  } catch (e) {}
  if (!ws) await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(m, p = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); }); }
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');

// 挂起桩：cc-* 与 my-emoji-groups 的 get 永不回调（=iOS 挂后台杀 IDB 连接后的首读卡住）
const HANG_SRC = `(function(){
  window.__hangIdb = true;
  var origGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function(k){
    var key = String(k);
    if (window.__hangIdb && (key.indexOf('cc-') >= 0 || key.indexOf('my-emoji') >= 0)) return { onsuccess: null, onerror: null, result: undefined, error: null };
    return origGet.call(this, k);
  };
})();`;
const SEED_PUB = `(function(){ try {
  var out = { text: [['日常', ['字卡一','字卡二']]], sticker: [['公用组', [] ]] };
  localStorage.setItem('xy-home-v2:cc-groups-public', JSON.stringify(out));
  localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['默认分组', []]]));
} catch(e){} })();`;

// 挂起大键名单（让 libScopesDeferred 命中＝走「取回中」分支）
const DEFER_MARK = `(function(){
  window.__xyIdbDeferredKeys = ['xy-home-v2:cc-groups-public', 'xy-home-v2:default:cc-groups'];
})();`;

let initIds = [];
async function openPage(scripts) {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  for (const id of initIds) { try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); } catch (e) {} }
  initIds = [];
  for (const s of scripts) { const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: s }); if (r && r.identifier) initIds.push(r.identifier); }
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(700);
  await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
  // 进聊天页
  await ev("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(900);
}
const setDeferred = () => ev(DEFER_MARK + '; true');

console.log('--- A1 表情包面板：字卡取回中应出占位（修前＝「暂无表情包」空态） ---');
await openPage([HANG_SRC]);
{
  await setDeferred();
  const r = await ev(`(function(){
    var btn = document.getElementById('chat-emoji-btn');
    if (btn) btn.click();
    return new Promise(function(resolve){
      var iv = setInterval(function(){
        var list = document.getElementById('emoji-list');
        var row = list ? list.querySelector('.mochi-load-row') : null;
        var txt = row ? row.textContent.trim() : '';
        var empty = list ? /暂无/.test(list.textContent) : false;
        if (row || empty) { clearInterval(iv); resolve(JSON.stringify({ loadingRow: !!row, txt: txt, emptyState: empty })); }
      }, 100);
      setTimeout(function(){ clearInterval(iv); var list=document.getElementById('emoji-list'); resolve(JSON.stringify({ loadingRow:false, txt:'', timeout:true, html: list? list.textContent.slice(0,40):'' })); }, 2500);
    });
  })()`);
  const j = JSON.parse(r || '{}');
  check('A1 表情包面板出「正在加载表情包…」占位', j.loadingRow && /正在加载表情包/.test(j.txt), r);
}

console.log('--- A2 拍一拍面板：字卡取回中应出占位 ---');
{
  await setDeferred();
  const r = await ev(`(function(){
    // 拍一拍面板入口＝聊天页「更多」面板里的 #more-poke（默认 tab='ta'，数据来自字卡池）
    var mb = document.getElementById('chat-more-btn');
    if (mb) mb.click();
    var poke = document.getElementById('more-poke');
    if (poke) poke.click();
    return new Promise(function(resolve){
      var iv = setInterval(function(){
        var list = document.getElementById('poke-list');
        var row = list ? list.querySelector('.mochi-load-row') : null;
        if (row) { clearInterval(iv); resolve(JSON.stringify({ loadingRow: true, txt: row.textContent.trim() })); }
      }, 100);
      setTimeout(function(){ clearInterval(iv); var list=document.getElementById('poke-list'); resolve(JSON.stringify({ loadingRow:false, html: list? list.textContent.trim().slice(0,40):'' })); }, 2500);
    });
  })()`);
  const j = JSON.parse(r || '{}');
  check('A2 拍一拍面板出取回占位行', j.loadingRow && /正在加载/.test(j.txt || ''), r);
}

console.log('--- A3 字卡库列表页角标：取回中应显「…」而非 0 ---');
{
  await setDeferred();
  const r = await ev(`(function(){
    var t = document.querySelector('.tab[data-page=page-chatcard]');
    if (t) t.click();
    return new Promise(function(resolve){
      var iv = setInterval(function(){
        var pe = document.getElementById('cc-pub-count');
        var oe = document.getElementById('cc-list-count');
        var loading = pe && pe.classList.contains('cc-cnt-loading');
        if (loading || (pe && pe.textContent === '…')) {
          clearInterval(iv);
          resolve(JSON.stringify({ pub: pe ? pe.textContent : null, own: oe ? oe.textContent : null, cls: !!(pe && pe.classList.contains('cc-cnt-loading')) }));
        }
      }, 100);
      setTimeout(function(){
        clearInterval(iv);
        var pe = document.getElementById('cc-pub-count');
        resolve(JSON.stringify({ pub: pe ? pe.textContent : null, loading:false }));
      }, 2500);
    });
  })()`);
  const j = JSON.parse(r || '{}');
  check('A3 两行角标取回中显示「…」+脉冲类', j.pub === '…' && j.cls === true, r);
}

console.log('--- A4 我的表情包：大键取回中应出占位 ---');
{
  const r = await ev(`(function(){
    // 面板已开（A1 步骤），切到「我的」tab；my-emoji-groups 在挂起桩里永不回调
    var t = document.querySelector('#emoji-panel .emoji-tab[data-etab="mine"]');
    if (t) t.click();
    var btn = document.getElementById('chat-emoji-btn');
    if (btn && document.getElementById('emoji-panel').hidden) btn.click();
    return new Promise(function(resolve){
      var iv = setInterval(function(){
        var list = document.getElementById('emoji-list');
        var row = list ? list.querySelector('.mochi-load-row') : null;
        if (row && /我的表情包/.test(row.textContent)) { clearInterval(iv); resolve(JSON.stringify({ loadingRow: true, txt: row.textContent.trim() })); }
      }, 100);
      setTimeout(function(){ clearInterval(iv); var list=document.getElementById('emoji-list'); resolve(JSON.stringify({ loadingRow:false, html: list? list.textContent.trim().slice(0,46):'' })); }, 2500);
    });
  })()`);
  const j = JSON.parse(r || '{}');
  check('A4 我的表情包取回占位（正在加载我的表情包…）', j.loadingRow === true, r);
}

console.log('--- B1 健康路径（本机有数据）：表情包面板照常、全程无占位行 ---');
await openPage([SEED_PUB]);
{
  const r = await ev(`(function(){
    var btn = document.getElementById('chat-emoji-btn');
    if (btn) btn.click();
    var sawRow = false;
    var iv = setInterval(function(){
      if (document.querySelector('#emoji-list .mochi-load-row')) sawRow = true;
    }, 50);
    return new Promise(function(resolve){
      setTimeout(function(){
        clearInterval(iv);
        var list = document.getElementById('emoji-list');
        resolve(JSON.stringify({ sawRow: sawRow, text: list ? list.textContent.trim().slice(0, 40) : '' }));
      }, 1600);
    });
  })()`);
  const j = JSON.parse(r || '{}');
  check('B1 健康路径不出现占位行（零闪动）', j.sawRow === false, r);
}

console.log('--- Z 组：零未捕获错误 ---');
{
  const errs = await ev('JSON.stringify(window.__jsErrors || [])');
  let n = 0;
  try { n = JSON.parse(errs || '[]').length; } catch (e) {}
  check('Z1 无未捕获 JS 错误', n === 0, 'n=' + n);
}

cleanup();
const fail = results.filter(r => !r.ok).length;
console.log('== 结果：' + (results.length - fail) + '/' + results.length + (fail ? '  FAIL=' + fail : '  全绿'));
process.exit(fail ? 1 : 0);
