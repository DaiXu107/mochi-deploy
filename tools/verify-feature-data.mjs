// ===== 各功能数据 单独导出 / 导入 / 清空 验证（feature-data.js） =====
// 覆盖：静态接线（设置入口行 / 独立页 / 模块产物 / 样式）＋ 键归属与作用域
//       （本桌面键归属、别桌面键不归属、全局键归属、媒体池与字体包不被任何功能认领）
//       ＋ 真实 UI 链路（进页面渲染计数 / 导出拿到 JSON / 导入替换且跨功能键被过滤 /
//       清空只删本功能且保留媒体池与其他桌面数据）。
// 运行前需已执行 node build.mjs（验证对象是构建产物 index.html）；本脚本不触发构建。
// 用法：MOCHI_ROOT=<已构建目录> node tools/verify-feature-data.mjs   （测临时构建副本）
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

// ---- 静态断言：产物含本功能接线 ----
const built = readFileSync(join(root, 'index.html'), 'utf8');
// #1488 尺子重基线：模块自 #860 起外置为 js/feature-data.js，S3/S5/S6 的锚在外置产物里——
// 旧写法只读 index.html＝恒红假锚。两基底并认（内联/外置 whichever 在）＝基底中立。
const builtFd = (() => { try { return readFileSync(join(root, 'js', 'feature-data.js'), 'utf8'); } catch (e) { return ''; } })();
const builtAll = built + '\n' + builtFd;
const staticChecks = [
  ['S1 设置页入口行 #row-feature-data 在位', built.includes('id="row-feature-data"')],
  ['S2 独立页面 #page-feature-data 在位', built.includes('id="page-feature-data"')],
  ['S3 模块已接入产物（window.mochiFeatureData）', builtAll.includes('window.mochiFeatureData = {')],
  ['S4 页面渲染容器与按钮样式类在位', built.includes('id="feature-data-body"') && built.includes('.fd-btn')],
  ['S5 媒体池/字体包排除逻辑在位（清空不得误删共享资源）', builtAll.includes("info.suffix.indexOf(MEDIA_PREFIX) === 0 || info.suffix.indexOf(BLOB_PREFIX) === 0")],
  ['S6 导入/清空后强制刷新（内存缓存与落盘一致）', builtAll.includes('function scheduleReload()')],
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fd-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
async function gotoApp() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
const json = async (expr) => { try { return JSON.parse(await evalJs(expr) || 'null'); } catch (e) { return null; } };

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await gotoApp();
// 真正走进应用（不用 DOM 直点绕过遮罩）：勾选确认 → 滑到底 → 点进入 → 公告页滑到底 → 进入
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
check('A0 开屏可正常进入（后续断言在真实已进入状态上执行）', entered === 'in', String(entered));
await evalJs('window.__mochiFdNoReload = true;'); // 只验数据写入/删除，不让页面刷新

// ---------- A 组：键归属与作用域（决定「清空会不会误伤别的功能/别的桌面」） ----------
{
  const r = await json(`(function(){
    var M = window.mochiFeatureData;
    var own = function (k, cid) { window.__activeCid = cid; var f = M.featureOfKey(k, cid); return f ? f.id : null; };
    var hash = '0123456789abcdef0123456789abcdef';
    var out = {
      gardenDesk: own('xy-home-v2:default:garden-data', 'default'),
      gardenTop: own('xy-home-v2:garden-data', 'default'),
      gardenOther: own('xy-home-v2:ctest12345:garden-data', 'default'),
      gardenOtherSelf: own('xy-home-v2:ctest12345:garden-data', 'ctest12345'),
      water: own('xy-home-v2:default:water-today', 'default'),
      cjian: own('xy-home-v2:cjian-state', 'default'),
      decision: own('xy-home-v2:decision-history', 'default'),
      decisionOtherDesk: own('xy-home-v2:decision-history', 'ctest12345'),
      waterOtherDesk: own('xy-home-v2:default:water-today', 'ctest12345'),
      media: own('xy-home-v2:media:' + hash, 'default'),
      fontBlob: own('xy-home-v2:font-blob-' + hash, 'default'),
      mailTop: own('xy-home-v2:default:mail-letters', 'default'),
      chatCsLbl: own('xy-home-v2:default:cs-lbl-partner', 'default'),
      identityLbl: own('xy-home-v2:default:lbl-partner', 'default'),
      calendarMemo: own('xy-home-v2:default:memo-2026-09-17', 'default'),
      memoApp: own('xy-home-v2:default:memo-app-items', 'default')
    };
    window.__activeCid = 'default';
    return JSON.stringify(out);
  })()`);
  check('A1a 本桌面功能键归属正确（garden/water/日历 memo/备忘录）',
    r && r.gardenDesk === 'garden' && r.gardenTop === 'garden' && r.water === 'water' && r.calendarMemo === 'calendar' && r.memoApp === 'memo',
    JSON.stringify(r && { g: r.gardenDesk, t: r.gardenTop, w: r.water, m: r.calendarMemo, ma: r.memoApp }));
  check('A1b 别桌面的键不归属当前桌面（清空不跨桌面）',
    r && r.gardenOther === null && r.gardenOtherSelf === 'garden' && r.waterOtherDesk === null,
    JSON.stringify(r && { o: r.gardenOther, os: r.gardenOtherSelf, wd: r.waterOtherDesk }));
  check('A1c 全局键在任何桌面都归属该功能（抉择/此间）',
    r && r.decision === 'decision' && r.decisionOtherDesk === 'decision' && r.cjian === 'cjian',
    JSON.stringify(r && { d: r.decision, dd: r.decisionOtherDesk }));
  check('A1d 媒体池与字体包不被任何功能认领（清空绝不误删共享资源）',
    r && r.media === null && r.fontBlob === null, JSON.stringify(r && { md: r.media, fb: r.fontBlob }));
  check('A1e 昵称/头像归「昵称与头像」而非聊天（清聊天不丢昵称）',
    r && r.identityLbl === 'identity' && r.chatCsLbl === 'identity' && r.mailTop === 'mail',
    JSON.stringify(r && { i: r.identityLbl, cs: r.chatCsLbl, ml: r.mailTop }));
}

// ---------- B 组：页面入口与渲染 ----------
await evalJs("(function(){try{var cv=document.getElementById('splash-cover');if(cv)cv.hidden=true;}catch(e){}return true;})()");
// 播种：本桌面花园 + 另一桌面花园 + 喝水 + 媒体池条目
await evalJs(`(function(){
  var g = window.xyStore('xy-home-v2:default');
  g.set('garden-data', JSON.stringify({ plants: [{ id: 'p1', sec: 60 }], note: '图 @@m:0123456789abcdef0123456789abcdef', st: {} }));
  window.xyStore('xy-home-v2:ctest12345').set('garden-data', JSON.stringify({ plants: [{ id: 'other', sec: 10 }] }));
  g.set('water-today', '3');
  window.xyStore('xy-home-v2').set('media:0123456789abcdef0123456789abcdef', 'data:image/png;base64,AAAA');
  return true;
})()`);
await sleep(400);
const opened = await evalJs(`(function(){
  var row = document.getElementById('row-feature-data');
  if (!row) return 'norow';
  row.click();
  var page = document.getElementById('page-feature-data');
  return (page && !page.hidden) ? 'ok' : 'nopage';
})()`);
await sleep(2500);
{
  const dom = await json(`(function(){
    var rows = document.querySelectorAll('#feature-data-body .fd-row');
    var garden = document.querySelector('#feature-data-body .fd-row[data-fid="garden"]');
    var cnt = garden ? garden.querySelector('[data-count]').textContent : '';
    var btns = garden ? garden.querySelectorAll('.fd-btn').length : 0;
    var groupTitles = document.querySelectorAll('#feature-data-body .fd-group-title').length;
    var scopeTag = garden ? garden.querySelector('.fd-scope').textContent : '';
    return JSON.stringify({ rows: rows.length, cnt: cnt, btns: btns, groups: groupTitles, scope: scopeTag,
      intro: (document.querySelector('#feature-data-body .fd-intro') || {}).textContent ? true : false });
  })()`);
  check('B1 点设置行进入独立页并渲染全部功能行',
    opened === 'ok' && dom && dom.rows >= 35 && dom.groups >= 3 && dom.intro === true,
    JSON.stringify({ opened, rows: dom && dom.rows, groups: dom && dom.groups }));
  check('B2 每功能三按钮（导出/导入/清空）且带短作用范围标记',
    dom && dom.btns === 3 && dom.scope === '本桌面', JSON.stringify({ btns: dom && dom.btns, scope: dom && dom.scope }));
  check('B3 计数显示本桌面数据量（花园 1 项）',
    dom && /1 项/.test(dom.cnt || ''), 'cnt=' + (dom && dom.cnt));
}

// ---------- C 组：导出 ----------
await evalJs(`(function(){ window.__fdCap = null;
  window.mochiExportFile = function (json, fname, title) { window.__fdCap = { json: json, fname: fname, title: title }; return Promise.resolve('ok'); };
  return true; })()`);
await evalJs(`(function(){ window.mochiFeatureData.exportFeature('garden'); return true; })()`);
await sleep(600);
const expText = await evalJs("(function(){return document.getElementById('modal-static')?document.getElementById('modal-static').textContent:'';})()");
await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
await sleep(700);
{
  const cap = await json("(function(){return JSON.stringify(window.__fdCap || null);})()");
  let payload = null;
  try { payload = cap ? JSON.parse(cap.json) : null; } catch (e) {}
  check('C1 导出前弹窗说明含体积与作用范围（用户看得见导了什么）',
    expText && /花园/.test(expText) && /作用范围/.test(expText) && /不会改动本机/.test(expText), String(expText).slice(0, 80));
  check('C2 导出只含本功能键（别桌面花园键在内，喝水/聊天键不在）',
    payload && payload.app === 'mochi-feature-data' && payload.feature === 'garden' &&
    !!payload.keys['xy-home-v2:default:garden-data'] && !payload.keys['xy-home-v2:default:water-today'] &&
    cap && /mochi花园_/.test(cap.fname),
    JSON.stringify({ keys: payload && Object.keys(payload.keys), fname: cap && cap.fname }));
  check('C3 导出按内容带上值里引用到的媒体池条目（换机后图片不丢）',
    payload && !!payload.keys['xy-home-v2:media:0123456789abcdef0123456789abcdef'],
    JSON.stringify(payload && Object.keys(payload.keys)));
}

// ---------- D 组：导入（替换模式 + 跨功能数据被过滤） ----------
{
  // 文件里混入聊天键与媒体池条目：聊天键必须被丢弃，媒体池条目必须写入
  const fileJson = JSON.stringify({
    app: 'mochi-feature-data', version: '1.0', feature: 'garden', cid: 'default',
    keys: {
      'xy-home-v2:default:garden-data': JSON.stringify({ plants: [{ id: 'p9', sec: 999 }] }),
      'xy-home-v2:default:water-today': '77',
      'xy-home-v2:media:0123456789abcdef0123456789abcdef': 'data:image/png;base64,AAAA'
    }
  });
  await evalJs(`(function(){
    window.__fdFile = new File([${JSON.stringify(fileJson)}], 'garden.json', { type: 'application/json' });
    window.mochiFeatureData.importFile('garden', window.__fdFile);
    return true;
  })()`);
  await sleep(700);
  const impText = await evalJs("(function(){return document.getElementById('modal-static')?document.getElementById('modal-static').textContent:'';})()");
  // 选「清空本功能后导入」pill 再确定
  await evalJs("(function(){var p=document.querySelector('#modal-pills .pill[data-value=\"replace\"]')||Array.prototype.filter.call(document.querySelectorAll('#modal-pills .pill'),function(b){return /清空/.test(b.textContent);})[0];if(p)p.click();return true;})()");
  await sleep(200);
  await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
  await sleep(1200);
  const after = await json(`(function(){
    var g = window.xyStore('xy-home-v2:default');
    var raw = g.get('garden-data') || '';
    return JSON.stringify({
      garden: raw, water: g.get('water-today'),
      media: window.xyStore('xy-home-v2').get('media:0123456789abcdef0123456789abcdef') || '',
      otherDeskGarden: window.xyStore('xy-home-v2:ctest12345').get('garden-data') || '',
      toast: (document.getElementById('cc-toast') || {}).textContent || ''
    });
  })()`);
  check('D1 导入前说明只算本功能数据（其他功能项已被忽略）',
    impText && /花园」的 1 项数据/.test(impText) && /另有 1 项其他功能/.test(impText), String(impText).slice(0, 110));
  check('D2 导入写入本功能新值（替换模式覆盖旧数据）',
    after && /p9/.test(after.garden || '') && !/p1"/.test(after.garden || ''), String(after && after.garden).slice(0, 70));
  check('D3 文件里其他功能的键被过滤，未写回（喝水仍是 3）',
    after && after.water === '3', 'water=' + (after && after.water));
  check('D4 媒体池条目按内容写入，别桌面数据不受影响',
    after && after.media === 'data:image/png;base64,AAAA' && /other/.test(after.otherDeskGarden || ''),
    JSON.stringify({ media: (after && after.media || '').slice(0, 20), other: (after && after.otherDeskGarden || '').slice(0, 24) }));
}

// ---------- E 组：清空（只删本功能 + 保留共享资源与其他桌面） ----------
await evalJs(`(function(){ window.mochiFeatureData.clearFeature('garden'); return true; })()`);
await sleep(700);
const clrText = await evalJs("(function(){return document.getElementById('modal-static')?document.getElementById('modal-static').textContent:'';})()");
await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
await sleep(1400);
{
  const after = await json(`(function(){
    var idb = window.idbGet('xy-home-v2:default:garden-data');
    return Promise.resolve(idb).then(function (v) {
      return JSON.stringify({
        ls: window.xyStore('xy-home-v2:default').get('garden-data'),
        idb: v === null || v === undefined ? null : String(v),
        water: window.xyStore('xy-home-v2:default').get('water-today'),
        media: window.xyStore('xy-home-v2').get('media:0123456789abcdef0123456789abcdef') || '',
        other: window.xyStore('xy-home-v2:ctest12345').get('garden-data') || '',
        toast: (document.getElementById('cc-toast') || {}).textContent || ''
      });
    });
  })()`);
  check('E1 清空前确认弹窗点明范围与不可恢复',
    clrText && /花园/.test(clrText) && /无法恢复/.test(clrText) && /当前桌面/.test(clrText), String(clrText).slice(0, 90));
  check('E2 清空后本功能键从 localStorage 与 IndexedDB 都删除',
    after && after.ls === null && after.idb === null, JSON.stringify({ ls: after && after.ls, idb: after && after.idb }));
  check('E3 清空不误删其他功能数据（喝水仍在）',
    after && after.water === '3', 'water=' + (after && after.water));
  check('E4 清空不误删媒体池与别的桌面数据（图片/另一个桌面花园仍在）',
    after && after.media === 'data:image/png;base64,AAAA' && /other/.test(after.other || ''),
    JSON.stringify({ media: (after && after.media || '').slice(0, 20), other: (after && after.other || '').slice(0, 24) }));
}

// ---------- F 组：无回归副作用 ----------
{
  const errs = await evalJs('JSON.stringify(window.__jsErrors || [])');
  check('F1 全程无 JS 异常', errs === '[]' || errs === null, String(errs).slice(0, 160));
  const still = await evalJs("(function(){var row=document.getElementById('row-feature-data');var p=document.getElementById('page-feature-data');return row&&p&&!p.hidden?'ok':'bad';})()");
  check('F2 本页仍在，未把设置页原入口/页面结构破坏', still === 'ok', String(still));
}

try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const staticPass = staticChecks.filter((c) => c[1]).length;
const pass = results.filter((r) => r.ok).length;
const total = results.length + staticChecks.length;
console.log('\n' + (pass + staticPass) + '/' + total + ' 通过' + (allOk && pass === results.length ? '（全绿）' : '（有失败项）'));
process.exit(allOk && pass === results.length ? 0 : 1);
