// ===== 验证：#151 切联系人桌面三回归 =====
// 回归 v3.26.x（小米14U Edge 反馈，安卓多机型同族；用户报障 #151）：
//   1) 切联系人再切回，小组件被扫进隐藏池不归还（无布局桌面）/ 显示成上个桌面的排布
//   2) 上一桌面的 widget-opacity 等美化键残留（CSS 变量全局挂载，缺键不复位）→ 小组件隐身但仍可点
//   3) 壁纸 backgroundSize/Position 被锁进「图变才写」守卫（#147 引入）→ 定位/缩放不生效、
//      两桌面同图不同 pos 串用 → 背景不按比例铺满
//   4) 切桌面时 buildDeskPages 删页收缩把上一桌面排布写进新桌面 desk-layout（跨桌面污染持久化）
// 用法：node tools/verify-desk-switch.mjs（需先 node build.mjs，需本机 Chrome/Edge）
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
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-deskswitch-' + Date.now()),
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
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || '') };
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined && detail !== null ? '  [' + JSON.stringify(detail) + ']' : '')); }

await cdpConnect();
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
await ev(`(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.classList.add('hide');return 'ok';})()`);
await sleep(800);

// 组件位置工具：wid 是否在页面 slide 上（不在隐藏池）
const whereExpr = (wid) => `(function(){
  var pool=document.getElementById('desk-widget-pool');
  var nodes=document.querySelectorAll('[data-desk-widget="${wid}"]');
  for (var i=0;i<nodes.length;i++){
    var inPool = pool && pool.contains(nodes[i]);
    if (inPool) return 'pool';
    if (nodes[i].closest('#desktop-pages')) return 'page';
  }
  return 'missing';
})()`;

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ===== T1 无布局桌面切回：池内组件归还 + 模板排布还原 + A 布局键不被写 =====
const bid = await ev(`window.createContact ? String(window.createContact('验证B')) : null`);
check('T1-pre createContact 返回 id', !!bid && bid !== 'null', bid);
await sleep(1000);
await ev(`window.setActiveContact(${JSON.stringify(bid)})`);
await sleep(1300);
// 给 B 写本桌布局（不含 quote-row/checkin/music/weekend）
await ev(`(function(){
  var s=window.xyStore('xy-home-v2:'+(window.__activeCid||''));
  s.set('desk-layout', JSON.stringify([['apps','deco'],['p2apps','week'],['p3apps','memo-row']]));
  if (window.applyDeskLayout) window.applyDeskLayout();
  return 'ok';
})()`);
await sleep(400);
const bQuote = await ev(whereExpr('quote-row'));
check('T1-B 在B桌面：quote-row 按B布局进池', bQuote === 'pool', bQuote);
await ev(`window.setActiveContact('default')`);
await sleep(1500);
for (const wid of ['quote-row', 'checkin', 'music', 'weekend']) {
  const w = await ev(whereExpr(wid));
  check('T1 切回A：' + wid + ' 归还到页面（不在隐藏池）', w === 'page', w);
}
const dc = await ev(whereExpr('desk-clock'));
check('T1 切回A：desk-clock 保持模板池语义（可选组件不误归还）', dc === 'pool', dc);
const aLay = await ev(`window.xyStore('xy-home-v2:default').get('desk-layout')`);
check('T1 切回A：A 的 desk-layout 保持无布局（不被写串）', aLay === null || aLay === undefined || aLay === '', aLay);

// ===== T2 美化键缺键复位：A 设透明度 30%，B 无键；B 桌面必须复位 1（防 A 残留），切回 A 应用 0.3 =====
// 注意：所有键一律显式命名空间前缀读写，绝不依赖 __activeCid（脚本切换时机易错位）
await ev(`(function(){
  window.xyStore('xy-home-v2:default').set('widget-opacity','30');
  window.xyStore('xy-home-v2:${bid}').remove('widget-opacity');
  // 人为把全局变量污染成 0.5（模拟上一桌面残留）：B 桌面无键 → 应被复位为 1
  document.documentElement.style.setProperty('--widget-opacity','0.5');
  return 'ok';
})()`);
await ev(`window.setActiveContact(${JSON.stringify(bid)})`);
await sleep(1300);
let opv = await ev(`document.documentElement.style.getPropertyValue('--widget-opacity')`);
check('T2 在B桌面（无键）：残留 0.5 被复位为 1', opv === '1', opv);
await ev(`window.setActiveContact('default')`);
await sleep(1300);
opv = await ev(`document.documentElement.style.getPropertyValue('--widget-opacity')`);
check('T2 切回A（键=30）：应用 A 的 0.3', opv === '0.3', opv);
// 清场：A 键删除，变量回 1（不干扰 T3/T4）
await ev(`(function(){ window.xyStore('xy-home-v2:default').remove('widget-opacity'); document.documentElement.style.setProperty('--widget-opacity','1'); return 'ok'; })()`);

// ===== T3 壁纸 pos 刷新：A/B 同图不同 pos，切桌面 size 必须跟着桌面走 =====
await ev(`(function(){
  var px='${PX}';
  var a=window.xyStore('xy-home-v2:default');
  var b=window.xyStore('xy-home-v2:${bid}');
  a.set('phone-bg', px); a.set('phone-bg-size','150'); a.set('phone-bg-pos-x','0'); a.set('phone-bg-pos-y','0');
  b.set('phone-bg', px); b.remove('phone-bg-size'); b.remove('phone-bg-pos-x'); b.remove('phone-bg-pos-y');
  return 'ok';
})()`);
// 当前在 A：先把图层刷成 A 的状态（150%）
await ev(`(function(){ if(window.applyDeskLayout) window.applyDeskLayout(); return 'ok'; })()`);
await ev(`(function(){
  // 触发一次 A 的壁纸应用：借助 tab 点击监听外的途径——直接切一次 B 再回
  return 'ok';
})()`);
await ev(`window.setActiveContact(${JSON.stringify(bid)})`);
await sleep(1300);
let bgsz = await ev(`(function(){var l=document.getElementById('phone-bg-layer');return l?l.style.backgroundSize:null;})()`);
check('T3 在B桌面（同图无pos键）：图层 size 刷新为 cover（修复前残留 150%）', bgsz === 'cover', bgsz);
await ev(`window.setActiveContact('default')`);
await sleep(1300);
bgsz = await ev(`(function(){var l=document.getElementById('phone-bg-layer');return l?l.style.backgroundSize:null;})()`);
check('T3 切回A（pos-size=150）：图层 size 刷新为 150%', bgsz === '150%', bgsz);

// ===== T4 切桌面删页不污染：A 3页布局 / B 2页布局，切到 B 后 B 布局键不被写成 A 的排布 =====
await ev(`(function(){
  var a=window.xyStore('xy-home-v2:default');
  var b=window.xyStore('xy-home-v2:${bid}');
  a.set('desk-page-count','3');
  a.set('desk-layout', JSON.stringify([['deco','quote-row','checkin','apps'],['music','week','weekend','p2apps'],['desk-period','memo-row','p3apps']]));
  b.set('desk-page-count','2');
  b.set('desk-layout', JSON.stringify([['apps','deco'],['p2apps','week']]));
  if (window.applyDeskLayout) window.applyDeskLayout();
  return 'ok';
})()`);
await sleep(400);
await ev(`window.setActiveContact(${JSON.stringify(bid)})`);
await sleep(1500);
const bLayRaw = await ev(`window.xyStore('xy-home-v2:${bid}').get('desk-layout') || ''`);
let bPolluted = true, bLayParsed = [];
try { bLayParsed = JSON.parse(bLayRaw); bPolluted = JSON.stringify(bLayParsed).indexOf('quote-row') >= 0 || JSON.stringify(bLayParsed).indexOf('checkin') >= 0; } catch (e) { bPolluted = true; }
check('T4 切到B（2页）：B 的 desk-layout 未被写成 A 的排布', !bPolluted, bLayRaw.slice(0, 120));
await ev(`window.setActiveContact('default')`);
await sleep(1500);
const aLayRaw = await ev(`window.xyStore('xy-home-v2:default').get('desk-layout') || ''`);
check('T4 切回A：A 的 desk-layout 保持原样', aLayRaw.indexOf('quote-row') >= 0 && aLayRaw.indexOf('desk-period') >= 0, aLayRaw.slice(0, 120));
const qr = await ev(whereExpr('quote-row'));
check('T4 切回A：quote-row 在页面（有布局桌面正常归还）', qr === 'page', qr);

await chrome.kill();
server.close();
const fail = results.filter((r) => !r.ok).length;
console.log('\\n结果：' + (results.length - fail) + '/' + results.length + ' 通过' + (fail ? '  ← 有失败' : ''));
process.exit(fail ? 1 : 0);
