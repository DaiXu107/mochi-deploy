// ===== 验证：#393 群聊模式占卜图标「装修组件库显式加回」+ 组件库摸鱼小组件命名 =====
// 回归 v3.26.x #393（多机型用户实报：开启群聊后占卜图标用装修模式拉不出来/加了也被收回；
// 装修模式小组件里按「摸鱼」找不到组件）：
//   A. 群聊开启 → 占卜默认收隐藏池（#156 语义保持）；
//   B. 装修组件库点「占卜」添加 → 退出装修后仍留在桌面（divination-desk-pin 意图标记豁免）；
//   C. 关闭群聊 → 清标记、占卜回首页图标组默认位（v3.8 语义恢复）；
//   D. 组件库小组件列表含「摸鱼倒计时（周末）」且 weekend 可添加到当前页。
// 用法：node tools/verify-gc-divination-pin.mjs（需先 node build.mjs）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 400));
const userDataDir = join(process.env.TEMP || '/tmp', 'mochi-gcdiv-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + userDataDir,
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return null;
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(500);
await evalJs("(function(){var c=document.getElementById('splash-confirm-ok');if(c&&!c.hidden)c.click();return true;})()");
await sleep(500);
await evalJs("(function(){var s=document.getElementById('splash');if(s)s.classList.add('hide');return true;})()");
await sleep(800);

const results = [];
function check(desc, ok, detail) { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 位置描述：POOL=隐藏池；pageN(grid)=第N页图标网格；pageN(widget)=第N页小组件；MISSING=不存在
const whereExpr = `(function(){
  function where(n){ if(!n) return 'MISSING'; if(!n.parentNode) return 'ORPHAN';
    var pool=document.getElementById('desk-widget-pool'); if(pool&&n.parentNode===pool) return 'POOL';
    var s=n.closest('.page-slide'); return s? 'page'+Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'),s)+(n.closest('.app-grid')?'(grid)':'(widget)') : 'other'; }
  return { div: where(document.querySelector('.app[data-app="divination"]')),
           gc: where(document.querySelector('.app[data-app="group-chat"]')) };
})()`;
const pos = () => evalJs(whereExpr);

// T1 初始（群聊关）：占卜在首页图标网格
let p = await pos();
check('T1 群聊关：占卜图标在首页图标网格', p && p.div === 'page0(grid)', p && JSON.stringify(p));

// T2 开群聊：占卜收进隐藏池、群聊按钮上桌
await evalJs(`(function(){ window.xyStore('xy-home-v2').set('group-chat-enabled','1'); document.dispatchEvent(new Event('group-chat-mode-changed')); return 1; })()`);
await sleep(500);
p = await pos();
check('T2 群聊开：占卜默认收隐藏池（#156 语义保持）', p && p.div === 'POOL', p && JSON.stringify(p));
check('T2b 群聊开：群聊按钮在首页网格且可见', p && p.gc === 'page0(grid)', p && JSON.stringify(p));

// T3 装修模式开组件库：小组件含「摸鱼倒计时（周末）」、图标含「占卜」
await evalJs(`(function(){ var r=document.getElementById('row-custom-icon'); if(r) r.click(); return !!r; })()`);
await sleep(600);
await evalJs(`(function(){ var b=document.getElementById('decor-add-widget'); if(b) b.click(); return !!b; })()`);
await sleep(600);
const lib = await evalJs(`(function(){
  var l=document.querySelector('.desk-lib'); if(!l) return null;
  return { items: [].slice.call(l.querySelectorAll('.desk-lib-item .dl-name')).map(function(e){return e.textContent;}),
           icons: [].slice.call(l.querySelectorAll('.desk-lib-icon .dli-name')).map(function(e){return e.textContent;}) };
})()`);
check('T3 组件库小组件含「摸鱼倒计时（周末）」', !!lib && lib.items.some(n => n.indexOf('摸鱼倒计时') >= 0), lib && JSON.stringify(lib.items));
check('T3b 组件库图标含「占卜」', !!lib && lib.icons.some(n => n.indexOf('占卜') >= 0), lib && JSON.stringify(lib.icons));

// T4 组件库点「占卜」添加到当前页（装修中即上桌）
const addOk = await evalJs(`(function(){
  var l=document.querySelector('.desk-lib'); if(!l) return -1;
  var t=[].slice.call(l.querySelectorAll('.desk-lib-icon')).find(function(x){return (x.textContent||'').indexOf('占卜')>=0;});
  if(!t) return -2; t.click(); return 1;
})()`);
await sleep(600);
p = await pos();
check('T4 装修中添加占卜成功（在首页网格）', addOk === 1 && p && p.div === 'page0(grid)', 'add=' + addOk + ' ' + (p && JSON.stringify(p)));

// T5 退出装修：占卜仍在桌面（#393 核心回归——修复前此处被收回 POOL）
await evalJs(`(function(){ if(window.exitDecor) window.exitDecor(); return 1; })()`);
await sleep(600);
p = await pos();
check('T5 退出装修后占卜仍在桌面（意图标记豁免收池）', p && p.div === 'page0(grid)', p && JSON.stringify(p));
const pin = await evalJs(`(function(){ try { return window.xyStore ? (window.activeStore().get('divination-desk-pin') || '') : ''; } catch(e){ return 'ERR'; } })()`);
check('T5b 意图标记 divination-desk-pin=1 已落盘', pin === '1', 'pin=' + pin);

// T6 关群聊：清标记 + 占卜回首页默认位（v3.8 语义）
await evalJs(`(function(){ window.xyStore('xy-home-v2').set('group-chat-enabled','0'); document.dispatchEvent(new Event('group-chat-mode-changed')); return 1; })()`);
await sleep(500);
p = await pos();
const pin2 = await evalJs(`(function(){ try { return window.activeStore().get('divination-desk-pin') || ''; } catch(e){ return 'ERR'; } })()`);
check('T6 关群聊：占卜回首页图标网格默认位', p && p.div === 'page0(grid)', p && JSON.stringify(p));
check('T6b 关群聊：意图标记已清除', pin2 !== '1', 'pin=' + pin2);
check('T6c 关群聊：群聊按钮回隐藏池', p && p.gc === 'POOL', p && JSON.stringify(p));

// T7 重新开群聊：占卜重新默认隐藏（清标记后恢复 #156 语义，可再次显式加回）
await evalJs(`(function(){ window.xyStore('xy-home-v2').set('group-chat-enabled','1'); document.dispatchEvent(new Event('group-chat-mode-changed')); return 1; })()`);
await sleep(500);
p = await pos();
check('T7 重开群聊：占卜重新默认收池（清标记后语义复原）', p && p.div === 'POOL', p && JSON.stringify(p));

// T8 摸鱼小组件（weekend）可从组件库添加到当前页
await evalJs(`(function(){ var r=document.getElementById('row-custom-icon'); if(r) r.click(); return 1; })()`);
await sleep(500);
await evalJs(`(function(){ var b=document.getElementById('decor-add-widget'); if(b) b.click(); return 1; })()`);
await sleep(500);
const weAdd = await evalJs(`(function(){
  var l=document.querySelector('.desk-lib'); if(!l) return -1;
  var it=[].slice.call(l.querySelectorAll('.desk-lib-item')).find(function(x){return (x.textContent||'').indexOf('摸鱼倒计时')>=0;});
  if(!it) return -2; var b=it.querySelector('.dl-btn'); if(!b||b.disabled) return -3; b.click(); return 1;
})()`);
await sleep(600);
const wePos = await evalJs(`(function(){ var n=document.querySelector('[data-desk-widget="weekend"]'); if(!n) return 'MISSING';
  var s=n.closest('.page-slide'); return s?'page'+Array.prototype.indexOf.call(document.querySelectorAll('.page-slide'),s):'other'; })()`);
check('T8 摸鱼小组件可添加到当前页', weAdd === 1 && wePos === 'page0', 'add=' + weAdd + ' weekend@' + wePos);

chrome.kill();
server.close();
const pass = results.filter(Boolean).length;
console.log('\\n' + pass + '/' + results.length + ' 断言通过');
process.exit(pass === results.length ? 0 : 1);
