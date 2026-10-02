// ===== 专项验证：字卡库【我的添加】存量预设污染一次性清洗 =====
// 用户反馈：字卡库【可自定义字卡】的【桌面今日情话】【查岗日常】分类把系统预设字卡
// 错误显示在了可自定义字卡里。
// 根因：更早版本管理页删除/编辑时把默认库整库"转正"写进自定义键（v3.6.x 堵新没清存量）。
// 修复：quote-cards.js / p2-features.js 启动时按文本一次性剔除（幂等标记）。
// 用法：node tools/verify-cc-mine-clean.mjs（自组装 src 页面，不依赖构建产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 从 src 自组装测试页（与 verify-room 等同款：cssFiles/jsFiles 顺序见 build.mjs）----
function read(p) { return readFileSync(join(root, p), 'utf8'); }
const buildSrc = read('build.mjs');
function arrOf(name) {
  const m = buildSrc.match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
  return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let css = '', js = '';
for (const f of cssFiles) { try { css += '/* ' + f + ' */\n' + read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of jsFiles) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const tpl = read('src/template.html')
  .replace(/__APP_VERSION__/g, 'test');
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + tpl +
  '<scr' + 'ipt>window.__APP_VERSION__="test";</scr' + 'ipt>' +
  '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    if (req.url.split('?')[0] === '/blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>blank</body></html>'); return; }
    if (req.url.split('?')[0] === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
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

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const tmpDir = join(os.tmpdir(), 'mochi-cc-clean-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chromeLog = [];
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.on('data', d => chromeLog.push(String(d).slice(0, 200)));

let ws = null, msgId = 0;
const pend = new Map();
const excs = [];
async function cdpConnect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
          if (m.method === 'Runtime.exceptionThrown') excs.push(m.params.exceptionDetails.text);
        };
        return;
      }
    } catch (e) { if (i > 90) console.error('cdp retry ' + i + ': ' + (e && e.message || e)); }
    await sleep(150);
  }
  console.error('chrome stderr tail: ' + chromeLog.slice(-5).join(' | '));
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

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function seedAndLoad(seedExpr) {
  await cdp('Page.navigate', { url: baseUrl + '/blank.html' });
  await sleep(500);
  if (seedExpr) await evalJs(seedExpr);
  await cdp('Page.navigate', { url: baseUrl + '/test.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(400);
  await evalJs("(function(){var b=document.getElementById('splash-confirm-ok');if(b)b.click();return true;})()");
  await sleep(700);
}

const POLLUTE = `(function(){
  var P='xy-home-v2:default:';
  var quotes=['我偏爱你','我只对你这样','过来，让我抱一下','别走，再陪我一会儿','你是我的例外','用户自己写的一句情话呀'];
  localStorage.setItem(P+'quote-cards', JSON.stringify(quotes.map(function(t){return {t:t}})));
  var places=['在家','在公司','在咖啡店','用户加的秘密基地'];
  localStorage.setItem(P+'checkin-cards-place', JSON.stringify(places.map(function(t){return {t:t}})));
  var actions=['刷手机','看书','发呆','用户加的跳女团舞'];
  localStorage.setItem(P+'checkin-cards-action', JSON.stringify(actions.map(function(t){return {t:t}})));
  var msgs=['想你了','记得按时吃饭','今天也很喜欢你','早点休息','有空给我回消息','别太累','用户加的晚安暗号'];
  localStorage.setItem(P+'checkin-cards-msg', JSON.stringify(msgs.map(function(t){return {t:t}})));
  return 'seeded';
})()`;

// ============ A 组：污染存量清洗 ============
await seedAndLoad(POLLUTE);

const a1 = await evalJs(`(function(){
  var v=JSON.parse(localStorage.getItem('xy-home-v2:default:quote-cards')||'[]');
  return JSON.stringify(v);
})()`);
check('A1 情话自定义库：预设句剔除、用户句保留', a1 && JSON.parse(a1).length === 1 && JSON.parse(a1)[0].t === '用户自己写的一句情话呀', a1);

const a2 = await evalJs(`(function(){
  var g=function(k){return JSON.parse(localStorage.getItem('xy-home-v2:default:'+k)||'[]')};
  return JSON.stringify({p:g('checkin-cards-place'),a:g('checkin-cards-action'),m:g('checkin-cards-msg')});
})()`);
let a2ok = false;
try { const o = JSON.parse(a2); a2ok = o.p.length === 1 && o.p[0].t === '用户加的秘密基地' && o.a.length === 1 && o.a[0].t === '用户加的跳女团舞' && o.m.length === 1 && o.m[0].t === '用户加的晚安暗号'; } catch (e) {}
check('A2 查岗三分类自定义库：预设句剔除、用户句保留', a2ok, a2);

const a3 = await evalJs(`(function(){
  return JSON.stringify({q:localStorage.getItem('xy-home-v2:default:quote-mine-clean-v1'),ck:localStorage.getItem('xy-home-v2:default:ck-mine-clean-v1')});
})()`);
check('A3 幂等标记已落盘（两键均=1）', a3 === '{"q":"1","ck":"1"}', a3);

const a4 = await evalJs(`(function(){
  return JSON.stringify({ckMine:(document.getElementById('cc-checkin-count-mine')||{}).textContent,qMine:(document.getElementById('cc-quote-count-mine')||{}).textContent});
})()`);
check('A4 字卡库入口计数恢复真实自定义数（查岗3/情话1）', a4 === '{"ckMine":"3","qMine":"1"}', a4);

// 我的添加页只显示用户句
await evalJs("(function(){var e=document.getElementById('li-quote-cards-mine'); if(e) e.click(); return true;})()");
await sleep(300);
const a5 = await evalJs(`(function(){
  var rows=Array.prototype.map.call(document.querySelectorAll('#cq-mine-list .tc-qtext'),function(x){return x.textContent});
  return JSON.stringify(rows);
})()`);
check('A5 【今日情话·我的添加】页只剩用户句', a5 === '["用户自己写的一句情话呀"]', a5);

await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true});document.getElementById('page-chatcard').hidden=false;var e=document.getElementById('li-checkin-cards-mine'); if(e) e.click(); return true;})()");
await sleep(300);
const a6 = await evalJs(`(function(){
  var out={};
  ['place','action','msg'].forEach(function(k){
    var t=document.querySelector('#page-checkin-cards .fav-tab[data-cktab='+k+']');
    if(t) t.click();
    out[k]=Array.prototype.map.call(document.querySelectorAll('#cck-mine-list .tc-qtext'),function(x){return x.textContent});
  });
  return JSON.stringify(out);
})()`);
check('A6 【查岗日常·我的添加】三分类各只剩用户句', a6 === '{"place":["用户加的秘密基地"],"action":["用户加的跳女团舞"],"msg":["用户加的晚安暗号"]}', a6);

// ============ B 组：系统预设池不受影响 ============
const b1 = await evalJs(`(function(){
  return JSON.stringify({q:typeof window.getQuoteOfDay==='function'?window.getQuoteOfDay():null});
})()`);
check('B1 系统预设开启时今日情话照常抽取', b1 && b1 !== '""' && JSON.parse(b1).q, b1);

await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true});document.getElementById('page-chatcard').hidden=false;var b=document.querySelector('.cc-top-tabs .cc-tab[data-ccsect=\\'preset\\']');if(b)b.click();var e=document.getElementById('li-quote-cards');if(e)e.click();return true;})()");
await sleep(300);
const b2 = await evalJs("document.querySelectorAll('#cq-sys-list .tc-qrow').length");
check('B2 系统预设情话页仍完整 46 句', b2 === 46, b2);

await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true});document.getElementById('page-chatcard').hidden=false;var e=document.getElementById('li-checkin-cards');if(e)e.click();var t=document.querySelector('#page-checkin-cards .fav-tab[data-cktab=place]');if(t)t.click();return true;})()");
await sleep(300);
const b3 = await evalJs("document.querySelectorAll('#cck-sys-list .tc-qrow').length");
check('B3 查岗系统预设页完整（地点≥10句；预设池后续扩容不算回归）', b3 >= 10, b3);

const b4 = await evalJs(`(function(){
  var ck=(function(){try{return JSON.parse(localStorage.getItem('xy-home-v2:default:checkin-current')||'null')}catch(e){return null}})();
  return JSON.stringify({hasPlace:ck&&!!ck.place,hasAction:ck&&!!ck.action,hasMsg:ck&&!!ck.msg});
})()`);
check('B4 查岗日常生成不受清洗影响（三字段齐全）', b4 === '{"hasPlace":true,"hasAction":true,"hasMsg":true}', b4);

// ============ C 组：幂等（刷新后不重复动、不复活） ============
await seedAndLoad(null); // 直接重新加载（不再种污染）
const c1 = await evalJs(`(function(){
  var g=function(k){return JSON.parse(localStorage.getItem('xy-home-v2:default:'+k)||'[]')};
  return JSON.stringify({q:g('quote-cards').length,p:g('checkin-cards-place').length,a:g('checkin-cards-action').length,m:g('checkin-cards-msg').length,mk:localStorage.getItem('xy-home-v2:default:ck-mine-clean-v1')});
})()`);
check('C1 刷新后清洗结果保持（IDB 回填不复活污染）', c1 === '{"q":1,"p":1,"a":1,"m":1,"mk":"1"}', c1);

// ============ D 组：干净用户零扰动 ============
// #129 修正：LS 清空之外必须连 IndexedDB 一并删库隔离——否则重载时 idbRestore 会把
// C 组残留（1 张卡）盖回 LS，D1 的 n===2 必红（同 D2 注释里的已知坑，此前只修了 D2）
await evalJs("(function(){var i=0;while(localStorage.length&&i++<500){localStorage.removeItem(localStorage.key(0))}try{indexedDB.deleteDatabase('mochi-db')}catch(e){};return 'cleared';})()");
await seedAndLoad(`(function(){
  var P='xy-home-v2:default:';
  localStorage.setItem(P+'quote-cards', JSON.stringify([{t:'纯用户句A'},{t:'纯用户句B',grp:'g1'}]));
  localStorage.setItem(P+'quote-cards-groups', JSON.stringify([{id:'g1',name:'我的分组'}]));
  return 'ok';
})()`);
const d1 = await evalJs(`(function(){
  var g=function(k){return JSON.parse(localStorage.getItem('xy-home-v2:default:'+k)||'null')};
  var q=g('quote-cards');
  return JSON.stringify({n:q.length,grp:q[1]&&q[1].grp,groups:g('quote-cards-groups'),mk:localStorage.getItem('xy-home-v2:default:quote-mine-clean-v1')});
})()`);
check('D1 干净自定义库零扰动（含分组字段与分组定义）', d1 && JSON.parse(d1).n === 2 && JSON.parse(d1).grp === 'g1' && Array.isArray(JSON.parse(d1).groups) && JSON.parse(d1).mk === '1', d1);

// 空自定义（全新用户）——LS + IndexedDB 一并隔离（idbRestore 会复活旧值，WORKLOG 已知坑）
await seedAndLoad("(function(){localStorage.clear();try{indexedDB.deleteDatabase('mochi-db')}catch(e){};return 'wiped';})()");
await sleep(500);
const d2 = await evalJs(`(function(){
  return JSON.stringify({q:localStorage.getItem('xy-home-v2:default:quote-cards'),ckp:localStorage.getItem('xy-home-v2:default:checkin-cards-place'),qMine:(document.getElementById('cc-quote-count-mine')||{}).textContent});
})()`);
check('D2 全新用户：自定义键保持为空、计数0', d2 === '{"q":null,"ckp":null,"qMine":"0"}', d2);

// 无 JS 异常
check('E1 全程无 JS 异常', excs.length === 0, excs.join(' | '));

server.close();
try { chrome.kill(); } catch (e) {}
try { require('node:fs').rmSync; } catch (e) {}
const fs = await import('node:fs');
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
const pass = results.filter(r => r.ok).length;
console.log('----');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
