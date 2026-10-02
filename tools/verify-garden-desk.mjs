// ===== 花园多桌面独立回归验证 =====
// 背景：v3.10.x 按用户需求移除「全球园」合并视图（🌐 全部/重新合并按钮），各桌面（联系人）
//       花园数据恢复完全独立；启动时一次性清理旧合并缓存 xy-home-v2:garden-data-global。
// 覆盖：
//   A. 旧全球园缓存清理——根键 xy-home-v2:garden-data-global 启动后删除，
//      且未被 migrateLegacy 误迁进 default 桌面（default 命名空间无副本）；
//   B. 全球园按钮不再注入（.garden-ov-btn 不存在）；
//   C. 桌面隔离（读）——default 桌面花园=玫瑰/15EXP，ctest1 桌面=向日葵/28EXP，互不串数据；
//   D. 桌面隔离（写）——在 ctest1 桌面施肥只改 ctest1 键，default 键逐字节不变；
//   E. 切回 default 后玫瑰数据原样、无施肥记录。
// 种子数据带齐 lastLoginDay/lpc/watered/daily 等守卫字段 + Math.random 桩 0.99，
// 确保开园不触发登录奖励/梦角打理/访客/雨天浇水等随机写入，保证字节级对比稳定。
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
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gdesk-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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

const lsGet = (k) => evalJs(`localStorage.getItem(${JSON.stringify(k)})`);
const lsSet = (k, v) => evalJs(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
const lsSetJson = (k, obj) => evalJs(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(obj))})`);
const openGarden = () => evalJs(`(function(){ var i=document.querySelector('.app[data-app="garden"]'); if(!i) return 'no-icon'; i.click(); return 'ok'; })()`);

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- boot1：全新档案，先空跑一次让 migrated-v1 标记等初始化完成 ----
await gotoApp();

// ---- 种子：双联系人 + 各自花园 + 旧全球园缓存（顶层键） ----
const now = Math.floor(Date.now() / 1000);
const d = new Date();
const today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
function gardenSeed(type, exp) {
  return {
    p: [{ type: type, planted: now - 60, by: '\u6211', watered: now }],
    l: [{ who: '\u6211', act: '\u79cd\u4e0b\u4e86\u4e00\u68f5\u82b1', tm: now - 60 }],
    lpc: now, dex: {}, exp: exp, inv: {},
    st: { p: 1, w: 0, h: 0, f: 0, mp: 0, mw: 0, mh: 0, mf: 0 },
    decor: {}, visitor: null, achv: {},
    lastLoginDay: today, lastWaterDay: today, lvSeen: 2,
    daily: { day: today, w: 0, h: 0, f: 0, done: true, buffed: false }
  };
}
await lsSetJson('xy-home-v2:contacts', [{ id: 'default', name: '\u9ed8\u8ba4' }, { id: 'ctest1', name: '\u6d4b\u8bd5\u4e59' }]);
await lsSet('xy-home-v2:active-contact', 'default');
await lsSetJson('xy-home-v2:default:garden-data', gardenSeed('rose', 15));
await lsSetJson('xy-home-v2:ctest1:garden-data', gardenSeed('sunflower', 28));
await lsSet('xy-home-v2:garden-data-global', '{"legacy":true,"p":[],"exp":777}');

// ---- boot2：重载后断言 ----
await gotoApp(true);
await sleep(2000); // 等 mochi-restore-done 后的 migrateLegacy 等异步收尾跑完
await evalJs('Math.random = (function(){ var f = function(){ return 0.99; }; f.toString = function(){ return "function () { [native code] }"; }; return f; })()');

// A. 旧全球园缓存清理
const rootLegacy = await lsGet('xy-home-v2:garden-data-global');
const defLegacy = await lsGet('xy-home-v2:default:garden-data-global');
check('A1 根命名空间旧全球园缓存已清理', rootLegacy === null || rootLegacy === undefined, String(rootLegacy).slice(0, 40));
check('A2 未被 migrateLegacy 误迁进 default 桌面', !defLegacy, String(defLegacy || '').slice(0, 40));

// B. 全球园按钮不再注入
const ovBtn = await evalJs(`!!document.querySelector('.garden-ov-btn')`);
check('B1 全球园按钮（🌐全部/重新合并）不存在', ovBtn === false);

// C. 读隔离：default 桌面
const snapGarden = `(() => {
  var pg = document.getElementById('page-garden');
  var names = Array.prototype.map.call(document.querySelectorAll('#garden-grid .garden-plot .garden-plant-name'), function(n){ return n.textContent; });
  return {
    open: !!pg && !pg.hidden,
    plots: document.querySelectorAll('#garden-grid .garden-plot').length,
    names: names,
    lvl: (document.getElementById('garden-level-bar') || {}).textContent || ''
  };
})()`;
await openGarden(); await sleep(700);
let s = await evalJs(snapGarden);
check('C1 点图标打开 default 桌面花园', s && s.open, JSON.stringify(s && { open: s.open, plots: s.plots }));
check('C2 default 花园显示玫瑰 + 15 EXP', s && s.names.indexOf('\u73ab\u7470') >= 0 && s.lvl.indexOf('15 EXP') >= 0, s && s.names.join(',') + '/' + s.lvl);
const defRawBefore = await lsGet('xy-home-v2:default:garden-data');

// C/D. 切到 ctest1 桌面再开花园
await evalJs(`window.setActiveContact('ctest1')`); await sleep(500);
await openGarden(); await sleep(700);
s = await evalJs(snapGarden);
check('C3 ctest1 桌面花园显示向日葵 + 28 EXP（非 default 数据）', s && s.names.indexOf('\u5411\u65e5\u8475') >= 0 && s.names.indexOf('\u73ab\u7470') < 0 && s.lvl.indexOf('28 EXP') >= 0, s && s.names.join(',') + '/' + s.lvl);

// D. 写隔离：ctest1 施肥，default 键必须逐字节不变
const ctest1RawBefore = await lsGet('xy-home-v2:ctest1:garden-data');
await evalJs(`(function(){ var p=document.querySelector('#garden-grid .garden-plot[data-idx="0"]'); if(p) p.click(); return 'ok'; })()`); await sleep(200);
await evalJs(`(function(){ var b=document.querySelector('#garden-toolbar [data-tool="fertilize"]'); if(b) b.click(); return 'ok'; })()`); await sleep(500);
const ctest1RawAfter = await lsGet('xy-home-v2:ctest1:garden-data');
const defRawAfter = await lsGet('xy-home-v2:default:garden-data');
check('D1 ctest1 施肥已写入本桌键', ctest1RawAfter !== ctest1RawBefore && ctest1RawAfter.indexOf('\u65bd\u4e86\u80a5') >= 0, '');
check('D2 default 键未被波及（逐字节一致）', defRawAfter === defRawBefore, '');

// E. 切回 default：玫瑰原样、无施肥记录
await evalJs(`window.setActiveContact('default')`); await sleep(500);
await openGarden(); await sleep(700);
s = await evalJs(snapGarden);
const fertLeak = await evalJs(`(function(){ var els=document.querySelectorAll('#garden-log-list .garden-log-item'); for(var i=0;i<els.length;i++){ if(els[i].textContent.indexOf('\\u65bd\\u4e86\\u80a5')>=0) return true; } return false; })()`);
check('E1 切回 default 玫瑰仍在 + 无施肥记录串桌', s && s.open && s.names.indexOf('\u73ab\u7470') >= 0 && fertLeak === false, s && s.names.join(','));

const fail = results.filter((r) => !r.ok).length;
console.log('----\n' + (results.length - fail) + '/' + results.length + ' 通过');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
