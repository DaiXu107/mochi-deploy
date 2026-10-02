// ===== 验证脚本：#1279 功能诊断「寻踪打卡」那行量错页＋凭空报不存在的授权（行为断言）=====
// 用法：node build.mjs && node tools/verify-1279-func-diag-checkin-row.mjs [被测根目录]
//   缺省被测根＝本脚本所在仓库的上一级（A/B 双副本时务必显式传根，别让两版跑同一产物）
// 覆盖：src/产物锚点（B1 图标真开寻踪页／B2~B3 诊断行给「打开✓」且不再出现「绑定 TA·授权定位」
//       B4~B5 关掉总开关后页面照开、那一行仍只许说「打开✓」（#1403 改约，旧版此处期望门控句）／S8 gated 已删／
//       C1 重新开启仍打开✓／Z1 零未捕获异常）
//   #1280 第二段（同族第二处）：S6~S7 两处静态锚点（群聊行不得再挂「群聊没开」门槛）＋
//       G1 点群聊图标真开 page-group-chat（默认未开启群聊时也照样开）／G2 诊断行给「打开✓」
//       G3 该行不再给「未开启」这种不存在的原因
import { readFileSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(process.argv[2] ? process.argv[2] : dirname(fileURLToPath(import.meta.url)) + '/..');
console.log('被测根目录 = ' + root);
if (!existsSync(join(root, 'index.html'))) { console.log('FAIL  根目录没有 index.html（喂错产物）'); process.exit(1); }
const FAKE = '可能需先绑定 TA/授权定位';
const FAKE_GC = '可能未开启群聊';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(d, ok, detail) { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + d + (detail ? '  [' + detail + ']' : '')); return ok; }

// ---- 静态锚点（src 与产物各一对）----
const srcDev = readFileSync(join(root, 'src/js/device.js'), 'utf8');
check('S1 src 登记表里寻踪量的是寻踪页 page-checkin', srcDev.includes("app: 'checkin', page: 'page-checkin', open: true"));
check('S2 src 里那句假授权措辞已清零', !srcDev.includes(FAKE));
const built = readFileSync(join(root, 'index.html'), 'utf8');
check('S3 产物（device.js 留内联）同一条锚点仍在', built.includes("app: 'checkin', page: 'page-checkin', open: true"), '命中 ' + (built.split("app: 'checkin', page: 'page-checkin', open: true").length - 1) + ' 次');
check('S4 产物里不再有「绑定 TA/授权定位」', !built.includes(FAKE));
// #1403：总开关不再拦寻踪页（桌面图标也不随它收起——位置感知唯一入口在这页），故 gated 那句
// 门槛已不可达、从登记表里删掉；留着它＝真出故障时诊断会拿「总开关已关闭」当借口。针 #1403f（删除型）。
check('S8 src 的寻踪行不再挂 gated 门槛', !srcDev.includes("page: 'page-checkin', open: true, gated"), srcDev.match(/page: 'page-checkin'[^\n]*/g)?.[0]?.slice(0, 90) || '');
// #1280：同一张表的「群聊」行——「开启群聊」开关只收图标不拦打开，gated 那句是凭空原因，已删
check('S6 src 群聊行在场且不再挂 gated 门槛', srcDev.includes("app: 'group-chat', page: 'page-group-chat', open: true") && !srcDev.includes(FAKE_GC));
check('S7 产物同一条锚点在场且无那句门槛', built.includes("app: 'group-chat', page: 'page-group-chat', open: true") && !built.includes(FAKE_GC));

// ---- 无头真跑 ----
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!exe) { console.log('SKIP  本机没有 Chrome/Edge，无法无头真跑'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0] || '/')));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (statSync(p).isDirectory()) p = join(p, 'index.html');
  try { res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9950 + Math.floor(Math.random() * 40);
const chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1279-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsErrs = [];
async function cdpConnect() {
  for (let i = 0; i < 60; i++) { try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      return; }
  } catch (e) {} await sleep(150); }
  try { chrome.kill(); } catch (e) {} server.close();
  throw new Error('no cdp');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }); return r && r.result ? r.result.value : null; } catch (e) { return null; } }
async function evAsync(expr) { try { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r && r.result ? r.result.value : null; } catch (e) { return null; } }
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4000);
// 开屏/引导层退场（常驻弹层会盖住桌面，程序化点按虽不受遮罩影响，但读数要干净）
await ev("(function(){var s=document.getElementById('splash');if(s)s.classList.add('hide');var m=document.getElementById('modal-mask');if(m)m.hidden=true;window.__mochiDataReady=true;return true;})()");
await sleep(600);

const ROW = "(function(){return (window.__collectFuncDiag?typeof window.__collectFuncDiag:'none');})()";
check('S5 功能诊断入口在产物里可用', (await ev(ROW)) === 'function', 'typeof=' + (await ev(ROW)));

// B1 图标真开的就是寻踪页（这一条两侧都该绿＝证明「未生效」是诊断量错页，不是功能坏了）
const vis = "(function(){var p=document.getElementById('page-checkin');return !!(p&&!p.hidden);})()";
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=p.id!=='page-phone';});var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
await sleep(200);
await ev("document.querySelector('.app[data-app=\"checkin\"]').click()");
await sleep(500);
check('B1 点桌面寻踪图标 → 寻踪页 page-checkin 可见', (await ev(vis)) === true, 'visible=' + (await ev(vis)));

async function diagRow() {
  const r = await evAsync('window.__collectFuncDiag().then(function(x){return x.rows;})');
  if (!Array.isArray(r)) return null;
  return r.filter((x) => x.indexOf('寻踪打卡') >= 0)[0] || '';
}
const row1 = await diagRow();
check('B2 寻踪总开关开着时，诊断那一行给「打开✓」', /打开✓/.test(row1), row1);
check('B3 诊断那一行不再出现不存在的授权', row1.indexOf('授权定位') < 0 && row1.indexOf('绑定 TA') < 0, row1);

// B4/B5（#1403 改约）关掉总开关之后：图标不再被收起、寻踪页照开（「TA在身边 · 位置感知」的
// 唯一入口就在这页），所以这一行仍然只许说「打开✓」，既不许凭空发明门槛、也不许拿总开关当借口
// ——旧版此处期望「打开未生效（寻踪总开关已关闭…）」，那是 #823 把「停生成」与「收入口」捆在一起
// 时代的口径，作者直派改版后已换向；gated 那句在 device.js 里已随之删除（针 #1403f 删除型）。
await ev("(function(){window.setCheckinEnabled(false);return true;})()");
await sleep(300);
await ev("document.querySelector('.app[data-app=\"checkin\"]').click()");
await sleep(500);
// 读数要在跑诊断之前取：__collectFuncDiag 自己会「点图标→看页面→点返回」把这一页关掉，
// 事后再问 vis 量到的是诊断收场的状态（＝恒假，与被测行为无关）
const openedOff = await ev(vis);
const row2 = await diagRow();
check('B4 关掉总开关后图标照点、页面照开，诊断那一行仍给「打开✓」（不得拿总开关当「未生效」的借口）',
  openedOff === true && /打开✓/.test(row2) && row2.indexOf('未生效') < 0, JSON.stringify({ openedOff, row2 }));
check('B5 那一行不含任何门槛措辞（总开关／授权定位／绑定 TA 都不是拦这一页的理由）',
  row2.indexOf('授权定位') < 0 && row2.indexOf('绑定 TA') < 0 && row2.indexOf('总开关') < 0, row2);

// C1 重新开启即恢复（没把功能本身改坏）
await ev("(function(){window.setCheckinEnabled(true);return true;})()");
await sleep(300);
await ev("document.querySelector('.app[data-app=\"checkin\"]').click()");
await sleep(500);
check('C1 重新开启总开关后图标照常打开寻踪页', (await ev(vis)) === true, 'visible=' + (await ev(vis)));

// ---- #1280 群聊行：开关只收图标不拦打开，行内不得再给不存在的门槛 ----
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=p.id!=='page-phone';});var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
await sleep(200);
await ev("document.querySelector('.app[data-app=\"group-chat\"]').click()");
await sleep(500);
const visGc = "(function(){var p=document.getElementById('page-group-chat');return !!(p&&!p.hidden);})()";
check('G1 点群聊图标 → page-group-chat 可见（默认未开启群聊时也照样打开）', (await ev(visGc)) === true, 'visible=' + (await ev(visGc)));
await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=p.id!=='page-phone';});var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
await sleep(200);
const gcRows = await evAsync('window.__collectFuncDiag().then(function(x){return x.rows;})');
const gcLine = (Array.isArray(gcRows) ? gcRows : []).filter((x) => x.indexOf('群聊') >= 0)[0] || '';
check('G2 群聊那行给「打开✓」', /打开✓/.test(gcLine), gcLine);
check('G3 群聊那行不再给「未开启」这种不存在的原因', gcLine.indexOf('未开启') < 0 && gcLine.indexOf(FAKE_GC) < 0, gcLine);

const errN = await ev("(window.__jsErrors||[]).length");
check('Z1 全程零未捕获 JS 异常', !errN, 'jsErrors=' + errN);

const pass = results.filter(Boolean).length;
console.log('\n合计 ' + pass + '/' + (results.length - pass) + '（PASS/FAIL） root=' + root);
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(results.every(Boolean) ? 0 : 1);
