// ===== 专项验证 #546：房间夜间黑屏（进房间场景 brightness(0) 纯黑）=====
// 根因：lum() 夜间基础亮度曾为 0，新档无点灯时 --room-bright=0 → .r-scene 整体
// brightness(0)＝19:00~6:00 进屋且没开灯必现纯黑（时段相关、任何机型）。
// 修复：基础亮度昼夜恒 1（点灯叠加 +0.12 封顶 1.3）；CSS 侧 brightness(max(...,.45))
// 结构兜底；夜晚氛围仍由既有 .night 分层调暗（.r-wall .52 / .r-floor .55）表达。
// #546 复发复核升级（2026-09-16 二次报障：全设备「正常显示约 1 秒后黑屏、点按钮图像区仍黑」
// ＝用户设备停留在 SW 旧缓存，非源码回归；线上 version.json 确认修复版已部署）：
//   B6 瞬态扫描——.room-in 入场动画 0.95s 结束 + filter .6s 过渡落定前后
//      （T+1.2s/T+1.7s/T+2.5s）逐点采样 computed filter，任何一点不得出现 brightness(0)
//      （旧版在 T+1.2s 即 brightness(0)＝用户「1 秒后黑屏」现场；新版恒 1）；
//   B7 交互后仍可见——点「家具仓」开全站弹窗、取消关闭，场景亮度必须不变黑
//      （复刻用户「点击下方交互按钮图像区仍黑屏」症状类）。
// 用法：node tools/verify-room-night-brightness.mjs（需先 node build.mjs）
//       MOCHI_VERIFY_ROOT=<目录> 时对该目录的 index.html 跑行为组（旧产物 RED 基线用，跳过 A 组）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const altRoot = !!process.env.MOCHI_VERIFY_ROOT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-room-nb-' + Date.now()),
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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ================= A 组：静态断言（源文件 + 产物；MOCHI_VERIFY_ROOT 指向旧产物目录时跳过） =================
if (!altRoot) {
{
  const roomJs = readFileSync(join(root, 'src/js/room.js'), 'utf8');
  const roomCss = readFileSync(join(root, 'src/css/room.css'), 'utf8');
  const built = readFileSync(join(root, 'index.html'), 'utf8');
  check('A1 lum() 基础亮度恒 1（不再夜间从 0 起算）', roomJs.includes('let v = 1;') && !roomJs.includes('isNight() ? 0'));
  check('A2 CSS 兜底：brightness(max(--room-bright,.45)) 在源码', roomCss.includes('brightness(max(var(--room-bright, 1), .45))'));
  check('A3 产物含 A1 逻辑锚（room.js 已接入构建）', built.includes('let v = 1;'));
  check('A4 产物含 A2 兜底锚（room.css 已接入构建）', built.includes('brightness(max(var(--room-bright, 1), .45))'));
  check('A5 夜间氛围仍在（.night 分层调暗规则未被顺手删）', /\.r-scene\.night \.r-wall[^}]*brightness\(\.52\)/.test(roomCss) && /\.r-scene\.night \.r-floor[^}]*brightness\(\.55\)/.test(roomCss));
}
}

// ================= B 组：无头运行时（真实产物 + 强制夜间时段） =================
await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// URL 带 ?nh=day 时把时钟拨到正午，否则拨到 23 点（夜间分支）；必须在文档脚本阶段注入
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: "(function(){var h=(location.search.indexOf('nh=day')>=0)?12:23;Date.prototype.getHours=function(){return h;};})();"
});

async function readyPage(q) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (q || '') });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
}
async function clearRoom() {
  // xyStore.get 优先读内存缓存：只清 LS/IDB 不够，得把缓存值也置空（置 '' → load 判 falsy 走 fresh）
  return evalJs("(async function(){var cid=window.__activeCid||'default';var fk='xy-home-v2:'+cid+':room-data';try{localStorage.removeItem(fk);}catch(e){}try{if(window.idbDelete)await window.idbDelete(fk);}catch(e){}try{window.storeFor(cid).set('room-data','');}catch(e){}return true;})()");
}
async function openRoomFresh(q) {
  // 清档后必须整页重载再测：boot 期「IDB→LS 回填」可能晚于清档落地，
  // 不重载的话 in-flight 回填会把刚删的数据又写回来（xyStore 恢复时序，AGENTS 有载）
  await clearRoom();
  await sleep(600);
  await readyPage(q);
  await clearRoom(); // 新文档 boot 后再清一次（此时 IDB 已空，回填无从谈起）
  await evalJs("(function(){if(window.closeRoom)window.closeRoom();document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var h=document.getElementById('page-phone');if(h)h.hidden=false;return true;})()");
  await evalJs("(function(){window.openRoom();return true;})()");
  await sleep(1800); // 等 .room-in 动画与 filter .6s 过渡完全落定，别读到过渡中间值
}
function brightnessOf(filterStr) {
  const m = /brightness\(([\d.]+)\)/.exec(String(filterStr || ''));
  return m ? parseFloat(m[1]) : -1;
}

// B1 强制夜间 23 点 + 全新档（无点灯）进屋：--room-bright 必须是可见亮度 1（修复前为 0＝黑屏）
await readyPage();
await openRoomFresh();check('B1 夜间无灯进屋 --room-bright=1（修复前=0 纯黑）',
  (await evalJs("document.getElementById('room-scene').style.getPropertyValue('--room-bright')")) === '1');
const sceneFilter = await evalJs("getComputedStyle(document.getElementById('room-scene')).filter");
check('B2 场景计算亮度 > 0（不许出现 brightness(0)）', brightnessOf(sceneFilter) > 0.4, sceneFilter);

// B3 夜间氛围未丢：.night 分层调暗仍生效（墙面 .52 / 地板 .55）——防「修死成白天」
check('B3 场景带 night 类', await evalJs("document.getElementById('room-scene').classList.contains('night')"));
const wallB = brightnessOf(await evalJs("getComputedStyle(document.getElementById('room-wall')).filter"));
const floorB = brightnessOf(await evalJs("getComputedStyle(document.getElementById('room-floor')).filter"));
check('B3b 夜间墙面/地板调暗仍生效（.52/.55）', Math.abs(wallB - 0.52) < 0.01 && Math.abs(floorB - 0.55) < 0.01, 'wall=' + wallB + ' floor=' + floorB);

// B6/B7 #546 复发复核（2026-09-16 二次报障）：全新档重新进屋逐点采样——
// 入场动画 0.95s 结束 + filter .6s 过渡落定前后不得出现 brightness(0)；交互后仍可见。
await clearRoom();
await readyPage();
await clearRoom();
await evalJs("(function(){if(window.closeRoom)window.closeRoom();document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var h=document.getElementById('page-phone');if(h)h.hidden=false;return true;})()");
await evalJs("(function(){window.openRoom();return true;})()");
const trans = [];
await sleep(1200); trans.push(brightnessOf(await evalJs("getComputedStyle(document.getElementById('room-scene')).filter")));
await sleep(500);  trans.push(brightnessOf(await evalJs("getComputedStyle(document.getElementById('room-scene')).filter")));
await sleep(800);  trans.push(brightnessOf(await evalJs("getComputedStyle(document.getElementById('room-scene')).filter")));
check('B6 入场动画结束瞬态不黑屏（T+1.2/1.7/2.5s 采样全部 >0.4；旧版 T+1.2s 即 brightness(0)＝「1 秒后黑屏」现场）',
  trans.length === 3 && trans.every(v => v > 0.4), 'samples=' + trans.join(','));
await evalJs("(function(){document.getElementById('room-btn-inv').click();return true;})()");
await sleep(500);
const modalOpen = await evalJs("!document.getElementById('modal-mask').hidden");
const bOpen = brightnessOf(await evalJs("getComputedStyle(document.getElementById('room-scene')).filter"));
await evalJs("(function(){document.getElementById('modal-cancel').click();return true;})()");
await sleep(400);
const bClose = brightnessOf(await evalJs("getComputedStyle(document.getElementById('room-scene')).filter"));
check('B7a 点「家具仓」全站弹窗照常打开（按钮有响应）', !!modalOpen);
check('B7b 弹窗开/关全程场景仍可见（不因交互变黑；旧版交互后恒 brightness(0)＝「点按钮图像区仍黑」现场）',
  bOpen > 0.4 && bClose > 0.4, 'open=' + bOpen + ' close=' + bClose);

// B4 点灯仍会增亮（#527 灯光功能保留，未因修复失去意义）：desklamp 亮着 → 1.12
// 写入必须走 storeFor().set（xyStore.get 优先读内存缓存，直写 localStorage 会被遮蔽）
await evalJs("(function(){var cid=window.__activeCid||'default';var raw=window.storeFor(cid).get('room-data');var o=JSON.parse(raw||'{}');o.lit={desklamp:true};window.storeFor(cid).set('room-data',JSON.stringify(o));window.openRoom();return true;})()");
await sleep(700);
check('B4 点灯叠加亮度仍生效（1+0.12=1.12）',
  (await evalJs("document.getElementById('room-scene').style.getPropertyValue('--room-bright')")) === '1.12');

// B5 白天路径不变：拨回正午 + 全新档 → 1（与修复前白天一致，防误伤白天观感）
await readyPage('?nh=day');
await openRoomFresh('?nh=day');
check('B5 白天进屋 --room-bright=1（白天观感不变）',
  (await evalJs("document.getElementById('room-scene').style.getPropertyValue('--room-bright')")) === '1',
  await evalJs("document.getElementById('room-scene').style.getPropertyValue('--room-bright') + ' | raw=' + String(window.storeFor(window.__activeCid||'default').get('room-data')).slice(0,160)"));
check('B5b 白天不带 night 类', await evalJs("!document.getElementById('room-scene').classList.contains('night')"));

const pass = results.filter(r => r.ok).length;
console.log('----\n' + pass + '/' + results.length + ' 通过');
chrome.kill(); server.close();
process.exit(pass === results.length ? 0 : 1);
