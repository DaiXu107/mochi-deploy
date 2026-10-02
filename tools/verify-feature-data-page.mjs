// ===== #679 各功能页内的「数据管理」卡验证（feature-data.js 注入的 data-fbar）=====
// 用户报障原话：「每一个单独的桌面的功能的导出数据，导入数据，清空数据，现在没有在每个功能
// 里面显示啊，只显示在了集中里」。本脚本断言的就是「功能页里真的有」这件事本身：
//   A 静态：产物含注入引擎与样式类；
//   B 注入扫描：所有登记了 page 且没有自带三行入口的功能，其页面内必须有 data-fbar 卡
//     （卡必须是那个 .page 的后代——页面 hidden 时随之隐藏，不会跑到桌面首页）；
//   C 不重复：已自带导出/导入/清空的功能页（聊天设置/信箱/朋友圈）里不得再出现第二套；
//   D 真实点选：进花园页 → 点卡上「导出数据」→ 导出弹窗（含功能名与作用范围）；
//   E 真实点选：点「清空数据」→ 确认弹窗点明不可恢复；取消后数据仍在；
//   F 零 JS 异常。
// 需要已构建产物；用法：MOCHI_ROOT=<构建目录> node tools/verify-feature-data-page.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
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

const built = readFileSync(join(root, 'index.html'), 'utf8');
// #1488 尺子重基线：同 verify-feature-data——注入引擎在外置 js/feature-data.js，两基底并认。
const builtFd = (() => { try { return readFileSync(join(root, 'js', 'feature-data.js'), 'utf8'); } catch (e) { return ''; } })();
const builtAll = built + '\n' + builtFd;
const staticChecks = [
  ['S1 注入引擎在产物里（mountFdBars / data-fbar）', builtAll.includes('mountFdBars') && builtAll.includes("setAttribute('data-fbar'")],
  ['S2 功能页数据卡样式类在产物里', built.includes('.fd-fbar')],
  ['S3 已有自带入口的功能页会被跳过（f.btns 判定）', builtAll.includes('if (!f.page || f.btns) return;')],
];
let allOk = true;
for (const [d, ok] of staticChecks) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + d); if (!ok) allOk = false; }

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (10100 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fdp-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const json = async (expr) => { try { return JSON.parse(await evalJs(expr) || 'null'); } catch (e) { return null; } };

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1200);
// 走真实开屏（与 verify-feature-data 同一条路）
await evalJs(`(function(){
  try { localStorage.setItem('xy-home-v2:age-confirmed','1'); } catch (e) {}
  var c = document.getElementById('splash-age-check'); if (c) { c.checked = true; c.dispatchEvent(new Event('change')); }
  var box = document.getElementById('splash-box'); if (box) box.scrollTop = box.scrollHeight;
  var e = document.getElementById('splash-enter'); if (e) e.click();
  return true;
})()`);
await sleep(500);
await evalJs(`(function(){
  var sc = document.getElementById('splash-mandatory-scroll'); if (sc) { sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll')); }
  var m = document.getElementById('splash-mandatory-enter'); if (m) m.click();
  return true;
})()`);
await sleep(900);
const entered = await evalJs("(function(){var s=document.getElementById('splash');return !s || s.classList.contains('hide') ? 'in' : 'stuck';})()");
check('A0 开屏可正常进入', entered === 'in', String(entered));
await evalJs('window.__mochiFdNoReload = true;');

// ---------- B 组：注入扫描（卡必须在各自 .page 里面） ----------
// 期望集合＝登记了 page 的功能 − 自带三行入口的（chat/字卡库/信箱/朋友圈，自己有）− 刻意跳过的
// （房间：固定全屏场景 overflow:hidden；群聊：#gc-body 是消息列表，卡会混进消息流。见 FD_SKIP）。
const EXPECT_NO_BAR = ['room', 'gc'];
const sweep = await json(`(function(){
  var M = window.mochiFeatureData;
  var feats = M.features;
  var skip = ${JSON.stringify(EXPECT_NO_BAR)};
  var missing = [], inside = 0, reports = [];
  feats.forEach(function (f) {
    if (!f.page) return;
    if (f.btns) return;                      // 自带三行入口的功能页不注入
    if (skip.indexOf(f.id) >= 0) return;     // 刻意跳过（见 FD_SKIP）
    var page = document.getElementById(f.page);
    if (!page) { missing.push({ id: f.id, why: 'noPage' }); return; }
    var bar = page.querySelector('[data-fbar="' + f.id + '"]');
    if (!bar) { missing.push({ id: f.id, why: 'noBar' }); return; }
    inside++;
    reports.push(f.id + '→' + (bar.parentNode === page ? 'page' : (bar.parentNode.className || bar.parentNode.tagName)));
  });
  return JSON.stringify({ missing: missing, inside: inside, reports: reports,
    withPage: feats.filter(function(f){return !!f.page;}).length,
    skippedOwn: feats.filter(function(f){return !!f.page && !!f.btns;}).map(function(f){return f.id;}) });
})()`);
check('B1 每个该有的功能页里都有数据管理卡（缺失 0，25 处）',
  sweep && sweep.missing.length === 0 && sweep.inside >= 25,
  JSON.stringify({ inside: sweep && sweep.inside, missing: sweep && sweep.missing }));
check('B2 卡在其所在 .page 内（页面隐藏时随之隐藏，不会跑到桌面首页）',
  sweep && sweep.missing.length === 0 && sweep.reports.every(function (r) { return r.indexOf('→') > 0; }),
  (sweep && sweep.reports || []).slice(0, 6).join(' | '));
console.log('     注入明细（' + (sweep && sweep.inside) + ' 处）：' + ((sweep && sweep.reports) || []).join(' | '));
check('B3 卡上三枚按钮齐全（导出/导入/清空）',
  await evalJs(`(function(){
    var bar = document.querySelector('[data-fbar="garden"]');
    if (!bar) return false;
    var ops = bar.querySelectorAll('.fd-btn');
    if (ops.length !== 3) return false;
    var want = ['export','import','clear'];
    for (var i=0;i<3;i++) if (ops[i].getAttribute('data-op') !== want[i]) return false;
    return true;
  })()`) === true);

// ---------- B4 生存性：被功能模块整块 innerHTML 重写的容器里，卡必须还在 ----------
// 根因实录（2026-09-17 检查发现）：#myarc-root 每次打开「我的档案」都被 my-arc.js
// `root.innerHTML = h` 整块重写，卡被冲掉＝用户根本看不到入口（首轮脚本只查「卡在 DOM 里」，
// 漏掉了这一层）。watchBarHost 用 childList 观察者按需补挂。这里用真实点桌面图标 + 离开 + 再进
// 来复现/守住：只靠 DOM 扫描（B1）测不出这个回归。
{
  const surv = await json(`(function(){
    var out = [];
    return Promise.resolve().then(function () {
      var p = document.getElementById('page-my-arc');
      var icon = document.querySelector('.app[data-app="my-arc"]');
      if (icon) icon.click();
      return new Promise(function (res) { setTimeout(res, 700); });
    }).then(function () {
      var p = document.getElementById('page-my-arc');
      out.push(!!(p && p.querySelector('[data-fbar="myarc"]')));
      document.querySelectorAll('.page').forEach(function (pg) { pg.hidden = true; });
      return new Promise(function (res) { setTimeout(res, 250); });
    }).then(function () {
      var icon = document.querySelector('.app[data-app="my-arc"]');
      if (icon) icon.click();
      return new Promise(function (res) { setTimeout(res, 700); });
    }).then(function () {
      var p = document.getElementById('page-my-arc');
      out.push(!!(p && p.querySelector('[data-fbar="myarc"]')));
      document.querySelectorAll('.page').forEach(function (pg) { pg.hidden = true; });
      return JSON.stringify({ first: out[0], second: out[1] });
    });
  })()`);
  check('B4 「我的档案」页被模块 innerHTML 重写后卡仍在（两次进入都在）',
    surv && surv.first === true && surv.second === true, JSON.stringify(surv));
}


// ---------- C 组：已有自带入口的功能页不得重复注入 ----------
{
  const dup = await json(`(function(){
    var bad = [];
    window.mochiFeatureData.features.forEach(function (f) {
      if (!f.btns || !f.page) return;
      var page = document.getElementById(f.page);
      if (page && page.querySelector('[data-fbar]')) bad.push(f.id);
    });
    return JSON.stringify(bad);
  })()`);
  check('C1 聊天设置/字卡库/信箱/朋友圈等自带入口的页面内不再出现第二套数据卡',
    Array.isArray(dup) && dup.length === 0, JSON.stringify(dup));
  check('C2 这些功能自己的原入口仍在（未被本批改动）',
    await evalJs(`(function(){
      var ids = ['cs-export-msgs','cs-import-msgs','cs-clear-msgs','mail-export','mail-import','mail-clear','feed-clear-all','cc-export','cc-import-data','cc-clear-all'];
      var miss = ids.filter(function (i) { return !document.getElementById(i); });
      return miss.length === 0 ? 'ok' : ('missing:' + miss.join(','));
    })()`) === 'ok',
    String(await evalJs(`(function(){return ['cs-export-msgs','mail-export','feed-clear-all','cc-export'].map(function(i){return i+'='+!!document.getElementById(i);}).join(' ');})()`)));
}

// ---------- D 组：真实点选——进花园页 → 卡上「导出数据」 ----------
{
  // 播种花园数据 + 点桌面图标进花园页（走真实入口，不用 DOM 直点卡）
  await evalJs(`(function(){
    try { window.xyStore('xy-home-v2:default').set('garden-data', JSON.stringify({ plants: [{ id: 'g1', sec: 60 }] })); } catch (e) {}
    return true;
  })()`);
  await sleep(300);
  const opened = await evalJs(`(function(){
    var icon = document.querySelector('.app[data-app="garden"]');
    if (!icon) return 'noicon';
    icon.click();
    var page = document.getElementById('page-garden');
    return (page && !page.hidden) ? 'ok' : 'nopage';
  })()`);
  await sleep(600);
  const vis = await json(`(function(){
    var bar = document.querySelector('[data-fbar="garden"]');
    var page = document.getElementById('page-garden');
    return JSON.stringify({
      opened: !!(page && !page.hidden),
      barVisible: !!(bar && bar.offsetParent !== null),
      cnt: (bar && bar.querySelector('[data-fcount]') ? bar.querySelector('[data-fcount]').textContent : '')
    });
  })()`);
  check('D1 点桌面花园图标进入花园页，且页内数据卡真实可见',
    opened === 'ok' && vis && vis.opened === true && vis.barVisible === true,
    JSON.stringify({ opened, vis }));
  check('D2 卡上计数显示本功能数据量（不是一直停在「统计中…」）',
    vis && /1\s*项/.test(vis.cnt || ''), 'cnt=' + (vis && vis.cnt));

  await evalJs(`(function(){ window.__fdCap = null;
    window.mochiExportFile = function (j, fname, title) { window.__fdCap = { json: j, fname: fname }; return Promise.resolve('ok'); };
    return true; })()`);
  await evalJs(`(function(){
    var bar = document.querySelector('[data-fbar="garden"]');
    bar.querySelector('.fd-btn[data-op="export"]').click();
    return true;
  })()`);
  await sleep(600);
  const expText = await evalJs("(function(){return document.getElementById('modal-static')?document.getElementById('modal-static').textContent:'';})()");
  await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
  await sleep(700);
  const cap = await json("(function(){return JSON.stringify(window.__fdCap || null);})()");
  let payload = null;
  try { payload = cap ? JSON.parse(cap.json) : null; } catch (e) {}
  check('D3 功能页内点「导出数据」＝走集中页同一条导出引擎（弹窗含功能名+作用范围，文件只含本功能键）',
    expText && /花园/.test(expText) && /作用范围/.test(expText) &&
    payload && payload.feature === 'garden' && !!payload.keys['xy-home-v2:default:garden-data'],
    JSON.stringify({ modal: String(expText).slice(0, 40), keys: payload && Object.keys(payload.keys) }));
}

// ---------- E 组：真实点选——卡上「清空数据」 ----------
{
  await evalJs(`(function(){
    var bar = document.querySelector('[data-fbar="garden"]');
    bar.querySelector('.fd-btn[data-op="clear"]').click();
    return true;
  })()`);
  await sleep(700);
  const clrText = await evalJs("(function(){return document.getElementById('modal-static')?document.getElementById('modal-static').textContent:'';})()");
  check('E1 功能页内点「清空数据」＝确认弹窗点明范围与不可恢复',
    clrText && /花园/.test(clrText) && /无法恢复/.test(clrText) && /当前桌面/.test(clrText),
    String(clrText).slice(0, 70));
  // 取消（不确认）：数据必须原样保留
  await evalJs("(function(){var b=document.querySelector('.modal-cancel,#modal-cancel');if(b)b.click();return true;})()");
  await sleep(500);
  const kept = await evalJs("(function(){try{return window.xyStore('xy-home-v2:default').get('garden-data')||'';}catch(e){return '';}})()");
  check('E2 取消后本功能数据原样保留（未有半删副作用）', /g1/.test(kept || ''), String(kept).slice(0, 40));
}

// ---------- F 组：零异常 ----------
{
  const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
  check('F1 全程无 JS 异常', errs === '[]' || errs === null, String(errs).slice(0, 160));
  const central = await evalJs("(function(){var r=document.getElementById('row-feature-data');var p=document.getElementById('page-feature-data');return !!(r&&p);})()");
  check('F2 集中页入口/页面结构未被破坏', central === true, String(central));
}

try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const staticPass = staticChecks.filter((c) => c[1]).length;
const pass = results.filter((r) => r.ok).length;
const total = results.length + staticChecks.length;
console.log('\n' + (pass + staticPass) + '/' + total + ' 通过' + (allOk && pass === results.length ? '（全绿）' : '（有失败项）'));
process.exit(allOk && pass === results.length ? 0 : 1);
