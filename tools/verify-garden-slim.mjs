// ===== #503 花园减负与 UI 重排回归验证 =====
// 背景：用户反馈「开垦的土地太多太扯淡」「花园太挤」「花园日志不显示联系人的全部打理记录」。
// 本脚本断言 #503 的六项行为（不是「代码还在」而是「行为正确」）：
//   A. 上限瘦身：开垦资格梯度 Lv.3/5/8 各 +2、Lv.12 +4（满配 22）——空档 plotN 迁移按新公式；
//   B. 资格缩小不裁已有地：plotN 高于资格时（老存档 30 块）加载后地块数一块不少，
//      且 syncPlots 不把尾部种了花的地块切掉（最容易被「顺手加回钳制」改坏的点）；
//   C. 手动收地：shrinkPlots 只收尾部连续空地、下限 4 块、遇有花地块立即止步；
//   D. 空地折叠：#528 起默认铺开全部地块 + 一块「空地×N」折叠砖，点折叠砖可收起/再展开；
//   E. 日志全量：容量 300 条，默认显示 20 条，「查看全部」展开后能看到更早的记录；
//   F. 日志独立 tab：garden-log 在「日志」分区内，标签栏含 7 个分区。
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
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gslim-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp(reload) {
  if (reload) await cdp('Page.reload', { ignoreCache: false });
  else await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const lsSet = (k, v) => evalJs(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
const lsSetJson = (k, obj) => evalJs(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(obj))})`);
const openGarden = () => evalJs(`(function(){ var i=document.querySelector('.app[data-app="garden"]'); if(!i) return 'no-icon'; i.click(); return 'ok'; })()`);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// boot1：全新档案空跑一次，让 migrateLegacy / IDB 初始化落定
await gotoApp();

const now = Math.floor(Date.now() / 1000);
const d0 = new Date();
const today = d0.getFullYear() + '-' + (d0.getMonth() + 1) + '-' + d0.getDate();
// 30 块地的老存档：前 3 块有花（第 3 块之后全是尾部空地），plotN=30 > 新资格上限 22
// 日志 120 条（其中联系人 TA 的记录 60 条），验证容量与「查看全部」全量
function bigSeed() {
  const p = new Array(30).fill(null);
  p[0] = { type: 'rose', planted: now - 600, by: '\u6211', watered: now };
  p[1] = { type: 'daisy', planted: now - 600, by: 'TA', watered: now };
  p[2] = { type: 'tulip', planted: now - 600, by: 'TA', watered: now };
  const l = [];
  for (let i = 0; i < 120; i++) {
    const mine = i % 2 === 0;
    l.push({ who: mine ? '\u6211' : 'TA', act: (mine ? '\u7ed9\u82b1\u6d47\u4e86\u6c34 #' : '\u6536\u83b7\u4e86\u4e00\u6735\u82b1 #') + i, tm: now - (120 - i) * 600 });
  }
  // #601e：pnUser=1＝用户手动开垦过 → load() 的「旧档尾部全空则收回 12 块」不生效，
  // 保证本用例（#446「已有地不裁」）仍在测；旧档无标记的收缩行为见 verify-garden-plotn.mjs
  return { p: p, plotN: 30, pnUser: 1, l: l, lpc: now, dex: {}, exp: 15, inv: {}, rareInv: {},
    st: { p: 3, w: 0, h: 0, f: 0, mp: 0, mw: 0, mh: 0, mf: 0 },
    decor: {}, visitor: null, achv: {},
    lastLoginDay: today, lastWaterDay: today, lvSeen: 2,
    daily: { day: today, w: 0, h: 0, f: 0, done: true, buffed: false } };
}
await lsSetJson('xy-home-v2:contacts', [{ id: 'default', name: '\u9ed8\u8ba4' }]);
await lsSet('xy-home-v2:active-contact', 'default');
await lsSetJson('xy-home-v2:default:garden-data', bigSeed());

await gotoApp(true);
await sleep(2000);
// 开园不触发登录奖励/梦角打理/访客/雨天浇水等随机写入，保证断言稳定
await evalJs('Math.random = (function(){ var f = function(){ return 0.99; }; f.toString = function(){ return "function () { [native code] }"; }; return f; })()');
await openGarden();
await sleep(1500);

// 取园内状态（数据只读，用于断言行为；不依赖内部函数名）
const st = () => evalJs(`(function(){
  var raw = JSON.parse(localStorage.getItem('xy-home-v2:default:garden-data') || '{}');
  var grid = document.getElementById('garden-grid');
  var ft = grid ? grid.querySelector('.garden-fold-tile') : null;
  var ftxt = ft ? ft.textContent : '';
  return JSON.stringify({
    foldTxt: ftxt,
    plotN: raw.plotN, planted: (raw.p||[]).filter(function(x){return !!x;}).length, arrLen: (raw.p||[]).length,
    logLen: (raw.l||[]).length, taLogs: (raw.l||[]).filter(function(e){return e.who==='TA';}).length,
    tilePlots: grid ? grid.querySelectorAll('.garden-plot').length : -1,
    foldTile: grid ? grid.querySelectorAll('.garden-fold-tile').length : -1,
    logItems: document.querySelectorAll('#garden-log-list .garden-log-item').length,
    logTabActive: !!document.querySelector('.garden-tab[data-tab="log"]'),
    logInLogPanel: !!document.querySelector('#garden-panel-log #garden-log'),
    tabs: document.querySelectorAll('.garden-tab').length,
    toggle: (document.getElementById('garden-log-toggle')||{}).textContent || ''
  });
})()`).then((s) => { try { return JSON.parse(s); } catch (e) { return null; } });

let s = await st();

// B. 资格缩小不裁已有地（本批最关键的防回归点）
check('B1 老存档 plotN=30 高于新资格上限也不被裁（地块数仍是 30）', s && s.plotN === 30, 'plotN=' + (s && s.plotN));
check('B2 三块有花的地一块不少（数组未被 syncPlots 切片）', s && s.planted === 3 && s.arrLen === 30, 'planted=' + (s && s.planted) + ' arrLen=' + (s && s.arrLen));

// F. 标签栏与日志分区
check('F1 标签栏 7 个分区（新增「日志」）', s && s.tabs === 7, 'tabs=' + (s && s.tabs));
check('F2 garden-log 已移入「日志」分区', s && s.logInLogPanel === true);

// D. 空地折叠（#528 起默认展开）：默认铺开全部 30 块地 + 1 块折叠砖
check('D1 默认铺开全部 30 块地 + 空地折叠砖', s && s.tilePlots === 30 && s.foldTile === 1 && /收起/.test(s.foldTxt), 'plots=' + (s && s.tilePlots) + ' fold=' + (s && s.foldTile) + ' txt=' + (s && s.foldTxt));
// 点折叠砖 → 收起空地，只剩 3 块有花地块
await evalJs(`(function(){ var t=document.querySelector('.garden-fold-tile'); if(t) t.click(); return 1; })()`);
await sleep(600);
s = await st();
check('D2 点折叠砖后收起空地（只剩 3 块有花地块 + 折叠砖）', s && s.tilePlots === 3 && s.foldTile === 1 && /点开/.test(s.foldTxt), 'plots=' + (s && s.tilePlots) + ' fold=' + (s && s.foldTile) + ' txt=' + (s && s.foldTxt));
// 再点一次 → 重新铺开
await evalJs(`(function(){ var t=document.querySelector('.garden-fold-tile'); if(t) t.click(); return 1; })()`);
await sleep(600);
s = await st();
check('D3 再次点折叠砖重新铺开全部 30 块地', s && s.tilePlots === 30 && s.foldTile === 1, 'plots=' + (s && s.tilePlots) + ' fold=' + (s && s.foldTile));

// E. 日志：容量 300 全留、默认 20 条、查看全部展开
check('E1 日志容量 300：120 条记录一条不丢', s && s.logLen === 120, 'logLen=' + (s && s.logLen));
check('E2 默认只显示最近 20 条', s && s.logItems === 20, 'items=' + (s && s.logItems));
check('E3 「查看全部」按钮带总数', !!(s && /查看全部/.test(s.toggle)), 'toggle=' + (s && s.toggle));
await evalJs(`(function(){ var b=document.getElementById('garden-log-toggle'); if(b) b.click(); return 1; })()`);
await sleep(600);
s = await st();
check('E4 展开后可见联系人 TA 的全部 60 条打理记录', s && s.logItems === 120 && s.taLogs === 60, 'items=' + (s && s.logItems) + ' ta=' + (s && s.taLogs));

// C. 手动收地：只收尾部空地、有花止步
const shrink = await evalJs(`(function(){
  var btn = document.getElementById('garden-tool-shrink');
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked';
})()`);
check('C1 工具条存在「收地」按钮', shrink === 'clicked', String(shrink));
await sleep(400);
// 确认弹窗 → 点「收回 N 块」
const confirmed = await evalJs(`(function(){
  var m = document.getElementById('modal-mask');
  if (!m) return 'no-modal';
  var btns = m.querySelectorAll('button');
  var picked = '';
  for (var i=0;i<btns.length;i++){ if (btns[i].className.indexOf('pill')>=0 && btns[i].textContent.indexOf('收回')>=0){ btns[i].click(); picked = btns[i].textContent; break; } }
  var ok = document.getElementById('modal-ok');
  if (ok) ok.click();
  return picked;
})()`);
check('C2 收地有确认弹窗（选「收回 N 块」+确定）', !!(confirmed && /收回/.test(confirmed)), String(confirmed));
await sleep(800);
s = await st();
check('C3 收地后缩到下限 4 块（尾部 26 块空地全收）', s && s.plotN === 4, 'plotN=' + (s && s.plotN));
check('C4 收地不动有花地块（3 块花仍在）', s && s.planted === 3, 'planted=' + (s && s.planted));
const shrinkLog = await evalJs(`(function(){
  var raw = JSON.parse(localStorage.getItem('xy-home-v2:default:garden-data') || '{}');
  return (raw.l||[]).some(function(e){ return String(e.act||'').indexOf('\\u6536\\u56de\\u4e86') >= 0; });
})()`);
check('C5 收地留日志（可追溯）', shrinkLog === true);

// 下限保护：已到有花地块后再点收地 → 不减少
await evalJs(`(function(){ var b=document.getElementById('garden-tool-shrink'); if(b) b.click(); return 1; })()`);
await sleep(400);
await evalJs(`(function(){ var ok=document.getElementById('modal-ok'); if(ok) ok.click(); return 1; })()`);
await sleep(300);
s = await st();
check('C6 到下限后再点收地不再收缩（plotN 仍 4，不裁花）', s && s.plotN === 4 && s.planted === 3, 'plotN=' + (s && s.plotN) + ' planted=' + (s && s.planted));

// A. 上限瘦身：公式一致性（读产物 index.html 静态断言——真正的回归形态是「公式漂移」或
//    「资格向下钳制被加回」，两者都不会报错、只会静默改地块数；行为面由 B1/B2 覆盖）
const built = readFileSync(join(root, 'index.html'), 'utf8');
const entExpr = 'return PLOTS + (lv >= 3 ? 2 : 0) + (lv >= 5 ? 2 : 0) + (lv >= 8 ? 2 : 0) + (lv >= 12 ? 4 : 0);';
// #601e：缺 plotN 的迁移默认改为 12 块，且 12 块之后已有花则保留到最远那株（绝不裁花）——
// 与「等级只解锁开垦资格」的本意一致；旧公式（按等级补到 22）会造成「远超 12 块」，已废弃。
const migExpr = 'd.plotN = _maxP >= PLOTS ? (_maxP + 1) : PLOTS;';
check('A1 开垦资格梯度＝Lv.3/5/8 各 +2、Lv.12 +4（满配 22）', built.includes(entExpr), built.includes(entExpr) ? 'found' : 'missing');
check('A2 空档迁移＝默认 12，12 块之后有花则保留到最远那株（不裁花；不再按等级补到 22）', built.includes(migExpr), built.includes(migExpr) ? 'found' : 'missing');
check('A3 资格不再向下钳制 plotN（防静默裁掉老玩家多种的地）', !/n > ent \? ent : n/.test(built) && built.includes('return data.plotN || PLOTS;'));
check('A4 养护放宽：浇水 48h / 凋谢 96h', built.includes('var WATER_SEC = 172800;') && built.includes('var WILT_SEC = 345600;'));

const passed = results.filter((r) => r.ok).length;
console.log('\n===== verify-garden-slim: ' + passed + '/' + results.length + ' =====');
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(passed === results.length ? 0 : 1);
