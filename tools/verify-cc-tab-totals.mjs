// ===== 专项验证：字卡库顶部【可自定义字卡】【系统预设字卡】tab 显示字卡总数徽标 =====
// 需求：两大分类 tab 显示各自分区字卡数字的总和（随各模块动态计数自动刷新）。
// 实现：chatcard.js ccTopTabTotals——MutationObserver 监听两分区 .t 计数变化，防抖重算，
//       徽标复用 .cc-tab-n 样式（含暗色 .zero 灰化）。
// 用法：node tools/verify-cc-tab-totals.mjs（自组装 src 页面，不依赖构建产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function read(p) { return readFileSync(join(root, p), 'utf8'); }
const buildSrc = read('build.mjs');
function arrOf(name) {
  const m = buildSrc.match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
  return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let css = '', js = '';
for (const f of cssFiles) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of jsFiles) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const tpl = read('src/template.html');
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + tpl +
  '<scr' + 'ipt>window.__APP_VERSION__="test";</scr' + 'ipt>' +
  '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';

const server = createServer((req, res) => {
  try {
    if (req.url.split('?')[0] === '/blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>blank</body></html>'); return; }
    if (req.url.split('?')[0] === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
    res.writeHead(404); res.end('nf');
  } catch (e) { res.writeHead(500); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const tmpDir = join(os.tmpdir(), 'mochi-cc-totals-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const excs = [];
async function cdpConnect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) {
        ws = new WebSocket(pg.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
          if (m.method === 'Runtime.exceptionThrown') excs.push(m.params.exceptionDetails.text);
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
    if (r && r.exceptionDetails) { return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text) }; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail && !ok ? '  [' + String(detail).slice(0, 300) + ']' : '')); }

async function loadApp(seedExpr) {
  await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
  await sleep(500);
  if (seedExpr) await evalJs(seedExpr);
  await cdp('Page.navigate', { url: baseUrl + '/test.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(800);
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ============ A 组：徽标渲染与总和正确 ============
await loadApp();

const a1 = await evalJs(`(function(){
  var bs=document.querySelectorAll('.cc-top-tabs .cc-tab[data-ccsect]');
  var out={n:bs.length};
  bs.forEach(function(b){out[b.getAttribute('data-ccsect')]=!!b.querySelector('.cc-tab-n')});
  return JSON.stringify(out);
})()`);
check('A1 两个顶部 tab 都有总数徽标', a1 === '{"n":2,"custom":true,"preset":true}', a1);

const a2 = await evalJs(`(function(){
  function sum(sel){var n=0;document.querySelectorAll(sel+' .chat-item .t').forEach(function(t){var v=parseInt(String(t.textContent).replace(/[^\\d]/g,''),10);if(!isNaN(v)&&v>0)n+=v});return n}
  var pc=sum('#cc-sect-preset'), cc=sum('#cc-sect-custom');
  var pb=document.querySelector('.cc-top-tabs .cc-tab[data-ccsect=preset] .cc-tab-n');
  var cb=document.querySelector('.cc-top-tabs .cc-tab[data-ccsect=custom] .cc-tab-n');
  return JSON.stringify({pSum:pc,pBadge:pb?pb.textContent:null,cSum:cc,cBadge:cb?cb.textContent:null});
})()`);
let a2ok = false;
try { const o = JSON.parse(a2); a2ok = o.pSum > 0 && String(o.pSum) === String(o.pBadge) && String(o.cSum) === String(o.cBadge); } catch (e) {}
check('A2 徽标数字 = 分区内全部条目计数之和（预设 ' + (() => { try { return JSON.parse(a2).pSum } catch (e) { return '?' } })() + '）', a2ok, a2);

const a3 = await evalJs(`(function(){
  var cb=document.querySelector('.cc-top-tabs .cc-tab[data-ccsect=custom] .cc-tab-n');
  return JSON.stringify({t:cb.textContent,zero:cb.classList.contains('zero')});
})()`);
check('A3 全新用户：可自定义总和为 0 且灰化(.zero)', a3 === '{"t":"0","zero":true}', a3);

// ============ B 组：动态刷新（真实链路） ============
// B1 批量添加 2 句情话 → 可自定义总和 +2
await evalJs("(function(){var e=document.getElementById('li-quote-cards-mine'); if(e) e.click(); return true;})()");
await sleep(300);
await evalJs("(function(){var ta=document.getElementById('cq-batch'); if(ta) ta.value='测试情话一\\n测试情话二'; var b=document.getElementById('cq-batch-add'); if(b) b.click(); return true;})()");
await sleep(500);
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true});document.getElementById('page-chatcard').hidden=false;return true;})()");
await sleep(400);
const b1 = await evalJs(`(function(){
  function sum(sel){var n=0;document.querySelectorAll(sel+' .chat-item .t').forEach(function(t){var v=parseInt(String(t.textContent).replace(/[^\\d]/g,''),10);if(!isNaN(v)&&v>0)n+=v});return n}
  var cb=document.querySelector('.cc-top-tabs .cc-tab[data-ccsect=custom] .cc-tab-n');
  return JSON.stringify({sum:sum('#cc-sect-custom'),badge:cb?cb.textContent:null,zero:cb?cb.classList.contains('zero'):null});
})()`);
check('B1 批量添加2句情话后可自定义总和实时 +2（=2，取消灰化）', b1 === '{"sum":2,"badge":"2","zero":false}', b1);

// B2 关掉一张查岗系统预设卡 → 系统预设总和 -1
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true});document.getElementById('page-chatcard').hidden=false;var e=document.getElementById('li-checkin-cards');if(e)e.click();var t=document.querySelector('#page-checkin-cards .fav-tab[data-cktab=place]');if(t)t.click();return true;})()");
await sleep(300);
const before = await evalJs(`(function(){
  var pb=document.querySelector('.cc-top-tabs .cc-tab[data-ccsect=preset] .cc-tab-n');
  return pb?parseInt(pb.textContent,10):null;
})()`);
await evalJs("(function(){var i=document.querySelector('#cck-sys-list .ccard-toggle input'); if(i) i.click(); return true;})()");
await sleep(500);
const b2 = await evalJs(`(function(){
  var pb=document.querySelector('.cc-top-tabs .cc-tab[data-ccsect=preset] .cc-tab-n');
  return pb?parseInt(pb.textContent,10):null;
})()`);
check('B2 关闭一张查岗预设卡后系统预设总和 -1（' + before + ' → ' + b2 + '）', typeof before === 'number' && typeof b2 === 'number' && b2 === before - 1, before + '->' + b2);

// ============ C 组：污染存量清洗后总和正确（与 verify-cc-mine-clean 联动） ============
// 注意：wipe+种污染必须在同一次加载前完成——清洗 IIFE 在空数据下也会落标记，
// 若先空载跑一次再种污染，标记已=1 会导致清洗跳过（假阳性）。
await loadApp(`(function(){
  localStorage.clear(); try{indexedDB.deleteDatabase('mochi-db')}catch(e){};
  var P='xy-home-v2:default:';
  var quotes=['我偏爱你','我只对你这样','用户自己写的一句情话呀'];
  localStorage.setItem(P+'quote-cards', JSON.stringify(quotes.map(function(t){return {t:t}})));
  var places=['在家','在公司','用户加的秘密基地'];
  localStorage.setItem(P+'checkin-cards-place', JSON.stringify(places.map(function(t){return {t:t}})));
  var actions=['刷手机','用户加的跳女团舞'];
  localStorage.setItem(P+'checkin-cards-action', JSON.stringify(actions.map(function(t){return {t:t}})));
  return 'seeded';
})()`);
const c1 = await evalJs(`(function(){
  function sum(sel){var n=0;document.querySelectorAll(sel+' .chat-item .t').forEach(function(t){var v=parseInt(String(t.textContent).replace(/[^\\d]/g,''),10);if(!isNaN(v)&&v>0)n+=v});return n}
  var cb=document.querySelector('.cc-top-tabs .cc-tab[data-ccsect=custom] .cc-tab-n');
  return JSON.stringify({sum:sum('#cc-sect-custom'),badge:cb?cb.textContent:null});
})()`);
check('C1 污染存量清洗后：可自定义总和=真实自定义数（情话1+查岗地点1+在做什么1=3）', c1 === '{"sum":3,"badge":"3"}', c1);

check('D1 全程无 JS 异常', excs.length === 0, excs.join(' | '));

server.close();
try { chrome.kill(); } catch (e) {}
try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
const pass = results.filter(r => r.ok).length;
console.log('----');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
