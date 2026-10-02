// ===== 常驻回归 #1053：帮我决定 / 多人决定「历史记录」当天直显、更早默认折叠 =====
// 用户口径：「历史记录没有分页加载，我要当天只显示当天的，其他时间的默认折叠」。
// 实现只在渲染层做（数据层仍全量保存）：当天记录平铺，更早记录按天分组收进一枚原生
// <details class="dc-h-more">「更早记录 N 条」，默认收起、点开才渲染到屏上。
// 断言（红侧＝纯 HEAD 产物：整屏一次平铺几百条，无分组无折叠）：
//   S 组 产物源锚（两件外置 js 里分组逻辑在位）
//   D 组 帮我决定：D1 直显条数＝当天条数 / D2 默认折叠 / D3 折叠块标题带总条数
//                 D4 折叠体内按天分组且当天不重复出现 / D5 点开后全量上屏 / D6 无当天时给占位文案
//   G 组 多人决定：同口径（G1~G3），并断每人一行结果不被分组弄丢
//   Z 组 全程零未捕获 JS 异常
// 用法：node tools/verify-1053-history-day-collapse.mjs [被测根目录]
//   不带参数＝跑仓库根产物；带参数＝跑仓外隔离副本（红绿对照用）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = chromeCandidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const read = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail === undefined ? '' : '  [' + String(JSON.stringify(detail)).slice(0, 300) + ']'));
}

console.log('--- S 组：产物源锚（分组渲染逻辑真进了外置件）---');
{
  const d = read('js/decision.js'), g = read('js/group-decision.js');
  check('S1 帮我决定产物有「更早记录」折叠块与按天分组（无则本批整块被回退）', d.indexOf('更早记录') >= 0 && d.indexOf('fmtDayKey') >= 0 && d.indexOf('dc-h-more') >= 0, [d.indexOf('更早记录'), d.indexOf('fmtDayKey'), d.indexOf('dc-h-more')]);
  check('S2 多人决定产物同款（同 #1053 口径）', g.indexOf('更早记录') >= 0 && g.indexOf('fmtDayKey') >= 0 && g.indexOf('dc-h-more') >= 0, [g.indexOf('更早记录'), g.indexOf('fmtDayKey'), g.indexOf('dc-h-more')]);
  check('S3 折叠样式在产物里（details 无样式＝折叠块观感回退）', read('index.html').indexOf('.dc-h-more') >= 0);
}

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 90));
const profile = join(process.env.TEMP || '/tmp', 'mochi-1053-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(2); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
// 夹具坑（同 #857）：不先 Page.enable，addScriptToEvaluateOnNewDocument 静默不注入＝预置历史全空、D/G 组假红
await cdp('Page.enable');
const evalJs = async (expr) => {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 260)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
};

// 预置历史：3 条今天 + 2 条昨天 + 2 条上周（数组序＝展示序，新在前，与生产写入的 unshift 同形）
// ?m1053past=1 时只留更早的，验「今天暂无记录」占位分支。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function () {
  var DAY = 86400000, now = Date.now();
  var pastOnly = /[?&]m1053past=1/.test(location.search);
  function mk(p, q, r) { return { id: 'd_' + p.ts, type: 'typea', question: q, result: r, options: null, ts: p.ts }; }
  var dec = [];
  if (!pastOnly) dec = [
    { ts: now - 60000, q: 'm1053今天A', r: '是' },
    { ts: now - 120000, q: 'm1053今天B', r: '否' },
    { ts: now - 180000, q: 'm1053今天C', r: '半对' }
  ].map(function (x) { return mk(x, x.q, x.r); });
  var y = [{ ts: now - DAY - 3600000, q: 'm1053昨天A', r: '这个我不选' }, { ts: now - DAY - 7200000, q: 'm1053昨天B', r: '是' }];
  var w = [{ ts: now - 6 * DAY, q: 'm1053上周A', r: '否' }, { ts: now - 6 * DAY - 90000, q: 'm1053上周B', r: '正在忙，暂未回复' }];
  var hist = dec.concat(y.map(function (x) { return mk(x, x.q, x.r); }), w.map(function (x) { return mk(x, x.q, x.r); }));
  function gmk(x) { return { id: 'gd_' + x.ts, type: 'typea', question: x.q, members: ['小一', '小二'], results: { '小一': x.r1, '小二': x.r2 }, options: null, ts: x.ts }; }
  var gdHist = (pastOnly ? [] : [
    { ts: now - 60000, q: 'm1053群今天A', r1: '是', r2: '否' },
    { ts: now - 120000, q: 'm1053群今天B', r1: '半对', r2: '是' }
  ]).concat(
    [{ ts: now - 2 * DAY, q: 'm1053群前天A', r1: '是', r2: '是' }].map(gmk),
    [{ ts: now - 7 * DAY, q: 'm1053群上周A', r1: '否', r2: '这个我不选' }].map(gmk)
  );
  if (pastOnly) gdHist = [{ ts: now - 3 * DAY, q: 'm1053群更早A', r1: '是', r2: '否' }].map(gmk);
  try {
    localStorage.setItem('xy-home-v2:decision-history', JSON.stringify(hist));
    localStorage.setItem('xy-home-v2:gdec-history', JSON.stringify(gdHist));
    localStorage.setItem('xy-home-v2:dec-global-migrated', '1');
    localStorage.setItem('xy-home-v2:gdec-global-migrated', '1');
  } catch (e) {}
})()` });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: 'about:blank' });
await sleep(300);
await cdp('Storage.clearDataForOrigin', { origin: new URL(baseUrl).origin, storageTypes: 'local_storage,indexed_db' }).catch(() => {});

async function boot(qs) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html?' + qs + '=' + Date.now() });
  for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady && typeof window.openDecision===\'function\' && typeof window.openGroupDecision===\'function\'')) break; await sleep(200); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e)e.click();return 1;})()");
  await sleep(500);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
  await evalJs("(function(){document.querySelectorAll('#qa-mask,#tc-mask,#modal-mask,.tc-mask,.modal-mask').forEach(function(m){m.hidden=true;});return 1;})()");
  await evalJs('(function(){var a=document.querySelector(\'.app[data-app="chat"]\');if(a)a.click();return 1;})()');
  await sleep(600);
}
// 打开面板 → 切历史 tab → 采样屏上结构（detH＝折叠块整块高度：收起时只剩一行 summary，
// 展开时才把记录撑出来。details 的收起子节点仍能被 querySelector 摸到、getClientRects 也非空，
// 所以判「到底看没看见」只能量高度，别退回用 DOM 存在性判折叠）
const probe = (openFn, scope, histId) => `(function(){
  window.${openFn}();
  document.querySelectorAll(${JSON.stringify(scope + ' .dc-tab')}).forEach(function(t){ if (t.dataset.dtab === 'history') t.click(); });
  var el = document.getElementById(${JSON.stringify(histId)}); if (!el) return { none: 1 };
  var det = el.querySelector('details.dc-h-more');
  var topItems = el.querySelectorAll(':scope > .tc-listitem').length;
  return {
    topItems: topItems,
    days: det ? det.querySelectorAll('.dc-h-day').length : 0,
    labels: det ? Array.prototype.map.call(det.querySelectorAll('.dc-h-day-label'), function (n) { return n.textContent; }).join('|') : '',
    detOpen: det ? !!det.open : null,
    sumText: det ? det.querySelector('summary').textContent.replace(/\\s+/g, '') : '',
    innerItems: det ? det.querySelectorAll('.tc-listitem').length : 0,
    detH: det ? Math.round(det.getBoundingClientRect().height) : null,
    visTop: el.querySelector(':scope > .tc-listitem') ? el.querySelector(':scope > .tc-listitem').getClientRects().length > 0 : null,
    total: el.querySelectorAll('.tc-listitem').length,
    hasTodayInDet: det ? /m1053今天|m1053群今天/.test(det.textContent) : null,
    dayEmpty: /今天暂无记录/.test(el.textContent)
  };
})()`;
const expand = (scope) => `(function(){
  var el = document.querySelector(${JSON.stringify(scope + ' details.dc-h-more')}); if (!el) return 'no-details';
  el.querySelector('summary').click();
  return 'open=' + !!el.open;
})()`;
// 就地复读（不再点 tab：点 tab 会 renderHistory 重建 innerHTML、把展开状态打回收起）
const recheck = (histId) => `(function(){
  var el = document.getElementById(${JSON.stringify(histId)}); if (!el) return { none: 1 };
  var det = el.querySelector('details.dc-h-more');
  return { detOpen: det ? !!det.open : null,
    detH: det ? Math.round(det.getBoundingClientRect().height) : null,
    total: el.querySelectorAll('.tc-listitem').length };
})()`;

console.log('--- D 组：帮我决定历史（当天直显 + 更早默认折叠）---');
await boot('m1053d');
const d0 = await evalJs(probe('openDecision', '#chat-decision-body', 'dec-history'));
check('D1 屏上直显的记录＝当天 3 条，且真渲染在屏上（更早的不在直显区）', d0 && d0.topItems === 3 && d0.visTop === true, d0);
check('D2 「更早记录」折叠块默认收起、内容不占屏（用户要的就是这条）', d0 && d0.detOpen === false && d0.detH < 80, d0 && [d0.detOpen, d0.detH]);
check('D3 折叠块标题写明「更早记录 4 条」', d0 && /更早记录4条/.test(d0.sumText), d0 && d0.sumText);
check('D4 折叠体内按天分组＝昨天/上周两组且带日期标题', d0 && d0.days === 2 && /\d+月\d+日/.test(d0.labels), d0 && [d0.days, d0.labels]);
check('D5 当天记录不重复出现在折叠块里', d0 && d0.hasTodayInDet === false, d0 && d0.hasTodayInDet);
const d1 = await evalJs(expand('#chat-decision-body'));
const d2 = await evalJs(recheck('dec-history'));
check('D6 点开 summary 后 4 条更早记录真上屏（合计 7 条一条不少、块高撑开）', d1 === 'open=true' && d2 && d2.detOpen === true && d2.total === 7 && d2.detH > d0.detH * 3, [d1, d0 && d0.detH, d2]);

console.log('--- G 组：多人决定历史（同口径）---');
const g0 = await evalJs(probe('openGroupDecision', '#chat-gdecision-body', 'gd-history'));
check('G1 屏上直显＝当天 2 条', g0 && g0.topItems === 2 && g0.visTop === true, g0);
check('G2 折叠块默认收起、标题带「更早记录 2 条」', g0 && g0.detOpen === false && g0.detH < 80 && /更早记录2条/.test(g0.sumText), g0 && [g0.detOpen, g0.detH, g0.sumText]);
const g1 = await evalJs(expand('#chat-gdecision-body'));
const gTxt = await evalJs("(function(){var e=document.getElementById('gd-history');return e?e.textContent:'';})()");
const g2 = await evalJs(recheck('gd-history'));
check('G3 点开 4 条全上屏', g1 === 'open=true' && g2 && g2.total === 4 && g2.detH > g0.detH * 3, [g1, g0 && g0.detH, g2]);
check('G4 每人一行结果不丢（分组没吞掉 members/results）', /小一：/.test(gTxt) && /小二：/.test(gTxt), gTxt.slice(-90));

console.log('--- E 组：今天没有记录时的占位（不能整屏空白）---');
await boot('m1053past');
const e0 = await evalJs(probe('openDecision', '#chat-decision-body', 'dec-history'));
check('E1 只有更早记录时：直显区 0 条 + 明确「今天暂无记录」+ 折叠块仍在', e0 && e0.topItems === 0 && e0.dayEmpty === true && e0.detOpen === false, e0);
const e1 = await evalJs(probe('openGroupDecision', '#chat-gdecision-body', 'gd-history'));
check('E2 多人决定同款占位', e1 && e1.topItems === 0 && e1.dayEmpty === true, e1);

const Z1 = await evalJs('(window.__jsErrors || []).slice(0, 4).join(" | ")');
check('Z1 全程零未捕获 JS 异常', !Z1, Z1);

const pass = results.filter((r) => r.ok).length;
console.log('— 合计 ' + pass + '/' + results.length + ' —');
await cdp('Browser.close').catch(() => {});
chrome.kill();
for (let i = 0; i < 5; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch (e) { await sleep(200); } }
server.close();
process.exit(pass === results.length ? 0 : 1);
