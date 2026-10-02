// #937 常驻行为回归：功能探索提醒（用户 2026-09-20「功能太多，有很多设计用户不知道有、没发现也没使用」）
// 机制口径（判据全部由此推出）：
//   · 到达埋点收在「真实入口被点到」：document 捕获阶段一个监听器对照目录登记表
//     （.app[data-app] 桌面图标 / #row-* 设置行 / 面板动作按钮 id），与是否从功能大全进入无关；
//   · 多段链条目只标**末段**（点进聊天 ≠ 试过聊天里每个按钮）；同选择器的多条目一起标；
//   · 展示面：功能大全首页「还没试过：N 个功能」横幅 + 设置 → 功能大全行角标 + unseen 过滤视图
//     （行沿用 entryRow，点一条即直达并离开名单）；
//   · fhub-freq / fhub-seen 都是全局根键（contacts.js EXCLUDE + migrateLegacy 存量回收）。
// 断言：
//   S1~S5 源码/产物锚（SEEN_KEY 埋点、捕获监听、横幅渲染、横幅样式、contacts 全局键登记）；
//   B0 横幅文案形态（未就绪/无数据时不渲染假数字）；
//   B1 全新环境：横幅显示 N＝目录未到达条目数（与 seen 集合对账）；
//   B2 桌面图标点击＝标记该 app 全部同选择器条目，且计数恰 -N、刷新后仍在；
//   B3 横幅点开＝unseen 过滤视图，行数与横幅计数一致，组标题带「N 个没试过」；
//   B4 多段链只标末段（点聊天图标＋点聊天设置按钮 → 标 4 条，子设置条目一条不标＝防修过头）；
//   B5 unseen 行点一条 → 离开 hub 直达目标页且该行出名单；
//   B5c 点掉一条后仍停在 unseen 视图（视闩不被 renderSeen 翻回首页、该行出过滤列表）；
//   B6 fhub-freq 误迁进 default 的存量副本被写回根键（EXCLUDE + 回收在位）；
//   Z 全程零 JS 异常。
// 用法：node tools/verify-fhub-unseen.mjs [被测根目录]（缺省＝脚本所在仓库）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) { console.error('产物不在：' + root); process.exit(2); }
console.log('被测产物：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

// ---- S 组：锚点（外置件 js/<file> 与内联 index.html 两种落点都认）----
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const srcOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const hubCode = srcOf('feature-hub.js') + indexHtml;
const contactsCode = srcOf('contacts.js') + indexHtml;
console.log('S 源码/产物锚');
ok('S1 fhub-seen 到达埋点总闸在位', hubCode.includes("const SEEN_KEY = 'xy-home-v2:fhub-seen';"));
ok('S2 捕获阶段入口登记表监听在位', hubCode.includes("t.closest('[data-app]')"));
ok('S3 「还没试过」横幅渲染在位', hubCode.includes("'还没试过：' + n"));
ok('S4 横幅样式规则在位', hubCode.includes('.fhub-seen-bar{display:flex;align-items:center;gap:10px;'));
ok('S5 fhub 两键登记全局根键（EXCLUDE）', contactsCode.includes("'fhub-freq', 'fhub-seen'];"));

// ---- 无头浏览器 ----
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-937-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
try {
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
  if (!ws) throw new Error('无法连接无头浏览器');
} catch (e) { console.error('SKIP: ' + e.message); chrome.kill(); server.close(); process.exit(2); }

function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (r && r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 随机弹层（TA 询问/通话/看图）会把点击吞掉——每 300ms 清一遍遮罩（仅测试环境）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){var ids=['qa-mask','tc-mask','call-mask','img-view-mask'];var sweep=function(){for(var i=0;i<ids.length;i++){var e=document.getElementById(ids[i]);if(e&&!e.hidden)e.hidden=true;}};setInterval(sweep,300);document.addEventListener('DOMContentLoaded',sweep);})()" });

async function openCold(withProbe) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(800);
  if (withProbe) await evalJs(`window.__937wr=[];var _si=localStorage.setItem.bind(localStorage);localStorage.setItem=function(k,v){if(String(k).indexOf('fhub-seen')>=0)window.__937wr.push(String(v));return _si(k,v);};return true;`);
}
const barInfo = () => evalJs(`
  var bar = document.getElementById('fhub-seen-bar');
  var badge = document.querySelector('#row-featurehub .fhub-badge');
  var m = bar ? (/还没试过：(\\d+)/.exec(bar.textContent) || [])[1] : null;
  return { exists: !!bar, shown: !!bar && getComputedStyle(bar).display !== 'none',
    n: m === null ? null : Number(m), text: bar ? bar.textContent : '', badge: badge ? badge.textContent : null };
`);
const seenObj = () => evalJs(`return JSON.parse(localStorage.getItem('xy-home-v2:fhub-seen')||'{}');`);
const hubTotal = () => evalJs(`
  var n = 0; document.querySelectorAll('#fhub-body .set-group .set-row').forEach(function(){ n++; });
  return n; // 分组列表常驻 DOM（隐藏与否都算）＝目录条目总数
`);

// ---------- B0/B1：冷启动横幅形态与全新环境计数 ----------
console.log('B 行为断言');
await openCold(true);
await evalJs("localStorage.removeItem('xy-home-v2:fhub-seen'); try { if (window.idbDelete) await window.idbDelete('xy-home-v2:fhub-seen'); } catch(e){} return true;");
await openCold(true);
let bar = await barInfo();
ok('B0 横幅文案形态（无「undefined/NaN」占位）', bar.exists === true && /^还没试过：\d+ 个功能/.test(bar.text), JSON.stringify(bar));
// #1452（阶段 A）：目录行改「首开才建」——先走一次真实入口（设置行）把目录行建出来，再对账总数；
// 随后回桌面，保持 B2「从桌面点图标」的起始态（契约不变：开页后仍是全量行）。
// 注：横幅/角标本身仍随启动就位，故 B0 的 bar.exists/badge 不受影响。
await evalJs("document.getElementById('row-featurehub').click(); return true;");
await sleep(500);
const total = await hubTotal();
await evalJs("document.querySelector('.tab[data-page=\"page-phone\"]').click(); return true;");
await sleep(400);
let seen = await seenObj();
ok('B1 全新环境横幅计数＝目录条目数（N=total−已到达，与 seen 集合对账）',
  bar.n !== null && bar.n >= 1 && total - Object.keys(seen).length === bar.n, 'total=' + total + ' seen=' + Object.keys(seen).length + ' n=' + bar.n);

// ---------- B2：桌面图标点击＝标记同选择器全部条目，计数同步下降且刷新仍在 ----------
await evalJs("document.querySelector('.app[data-app=\"garden\"]').click(); return true;");
await sleep(700);
await evalJs("var bs=document.querySelectorAll('[id$=\"-back\"]'); for (var i=0;i<bs.length;i++){ try{ bs[i].click(); }catch(e){} } document.getElementById('row-featurehub').click(); return true;");
await sleep(700);
const bar2 = await barInfo();
seen = await seenObj();
ok('B2a 点桌面图标即写 fhub-seen（同选择器多条目一起标）',
  !!seen['花园（桌面图标）'] && !!seen['花园'], JSON.stringify(Object.keys(seen)));
ok('B2b 横幅计数恰下降（＝本次新标记条数）且角标同步',
  bar.n - bar2.n === 2 && bar2.badge === bar2.n + ' 个没试过', 'before=' + bar.n + ' after=' + bar2.n + ' badge=' + bar2.badge);
await openCold(true);
const bar2b = await barInfo();
ok('B2c 标记持久：刷新后计数不回弹', bar2b.n === bar2.n && bar2b.n >= 1, 'after reload n=' + bar2b.n + ' expected=' + bar2.n);

// ---------- B3：横幅点开＝unseen 过滤视图，行数与计数一致 ----------
await evalJs("document.getElementById('row-featurehub').click(); return true;");
await sleep(600);
await evalJs(`document.getElementById('fhub-seen-bar').click(); return true;`);
await sleep(500);
const unseenView = await evalJs(`
  var vis = 0; document.querySelectorAll('#fhub-body .set-row').forEach(function (r) { if (r.offsetParent) vis++; });
  var titles = []; document.querySelectorAll('#fhub-body .gs-title').forEach(function (t) { if (t.offsetParent) titles.push(t.textContent); });
  var bar = document.getElementById('fhub-seen-bar');
  var homeEl = null; for (var e = bar; e && e !== document.body; e = e.parentElement) { if (e.parentElement && e.parentElement.id === 'fhub-body') homeEl = e; }
  // 「让位」＝横幅不再出现在屏幕上。横幅随首页容器整体隐藏（父级 display:none），此时它自己的
  // computed display 仍是 flex（getComputedStyle 给的是计算值不是渲染值）——只能按 offsetParent 判可见性。
  return { vis: vis, titles: titles.slice(0, 2), barHidden: !bar || !bar.offsetParent || getComputedStyle(bar).display === 'none',
    homeHidden: !homeEl || getComputedStyle(homeEl).display === 'none', barText: bar ? bar.textContent : '',
    input: (document.getElementById('fhub-search') || {}).value };
`);
ok('B3 unseen 视图行数＝横幅计数，组标题带计数，横幅让位',
  unseenView.vis === bar2b.n && /\d+ 个没试过/.test(unseenView.titles[0] || '') && unseenView.barHidden === true, JSON.stringify(unseenView));

// ---------- B4：多段链只标末段（防修过头：点进聊天不标记聊天里所有子设置） ----------
await evalJs("var b=document.getElementById('fhub-back'); if(b) b.click(); return true;");
await sleep(400);
await evalJs("window.__937wr=[]; return true;");
await evalJs(`
  var before = JSON.stringify(Object.keys(JSON.parse(localStorage.getItem('xy-home-v2:fhub-seen')||'{}')));
  window.__937before = before;
  document.querySelector('.app[data-app="chat"]').click(); return true;
`);
await sleep(800);
await evalJs(`
  var b = document.getElementById('chat-settings-btn');
  if (b) b.click();
  return true;
`);
await sleep(900);
const b4 = await evalJs(`
  var s = JSON.parse(localStorage.getItem('xy-home-v2:fhub-seen')||'{}');
  var names = []; document.querySelectorAll('#fhub-body .set-row .txt').forEach(function (t) { names.push(t.firstChild.textContent); });
  return { hasChat: !!s['聊天'], hasChatIcon: !!s['聊天（桌面图标）'], hasHub: !!s['聊天设置'], hasHubEntry: !!s['聊天设置（总入口）'],
    hasUpload: !!s['上传聊天壁纸'], hasFontSize: !!s['聊天气泡字体大小'], hasOrder: !!s['输入栏按钮位置'],
    inCatalog: names.indexOf('上传聊天壁纸') >= 0 && names.indexOf('聊天气泡字体大小') >= 0 && names.indexOf('输入栏按钮位置') >= 0,
    csVisible: !document.getElementById('page-chat-settings').hidden };
`);
ok('B4a 点聊天图标只标 chat 两条 / 点设置按钮只标总入口两条', b4.hasChat && b4.hasChatIcon && b4.hasHub && b4.hasHubEntry && b4.csVisible, JSON.stringify(b4));
ok('B4b 同链下游子条目一条不标（防「进过父页=试过全部子功能」虚高；条目名先确认在目录里，防否定断言空转）',
  b4.inCatalog === true && !b4.hasUpload && !b4.hasFontSize && !b4.hasOrder, JSON.stringify(b4));

// ---------- B5：unseen 行点一条＝离开 hub 直达目标页并出名单 ----------
await evalJs("var bs=document.querySelectorAll('[id$=\"-back\"]'); for (var i=0;i<bs.length;i++){ try{ bs[i].click(); }catch(e){} } document.getElementById('row-featurehub').click(); return true;");
await sleep(600);
const b5 = await evalJs(`
  document.getElementById('fhub-seen-bar').click();
  var rows = []; document.querySelectorAll('#fhub-body .set-row').forEach(function (r) { if (r.offsetParent) rows.push(r); });
  if (!rows.length) return { err: 'none' };
  var nm = rows[0].querySelector('.txt').firstChild.textContent;
  rows[0].click();
  return { name: nm };
`);
await sleep(900);
const b5b = await evalJs(`
  var s = JSON.parse(localStorage.getItem('xy-home-v2:fhub-seen')||'{}');
  var vis = []; document.querySelectorAll('.page').forEach(function (p) { if (!p.hidden) vis.push(p.id); });
  return { seenName: !!s[${JSON.stringify(b5.name || '')}], pages: vis };
`);
ok('B5 unseen 行点击：直达目标页且该行记入 seen',
  !!b5.name && b5b.seenName === true && b5b.pages.length > 0 && b5b.pages.indexOf('page-featurehub') < 0, JSON.stringify({ b5, b5b }));

// B5c：点掉一条后仍停在 unseen 视图（视闩）——没有闩时 bumpSeen→renderSeen 会把 view 翻回 'home'、
// 横幅重现、整张过滤列表被替换。此刻 hub 页是隐藏的，判据只能取内联样式（offsetParent 恒空）。
const b5c = await evalJs(`
  var bar = document.getElementById('fhub-seen-bar');
  var homeEl = null; for (var e = bar; e && e !== document.body; e = e.parentElement) { if (e.parentElement && e.parentElement.id === 'fhub-body') homeEl = e; }
  var titles = []; document.querySelectorAll('#fhub-body .gs-title').forEach(function (t) { if (/个没试过/.test(t.textContent)) titles.push(t); });
  var names = [];
  titles.forEach(function (t) { var c = t.nextElementSibling; if (c) c.querySelectorAll('.set-row').forEach(function (r) { names.push(r.querySelector('.txt').firstChild.textContent); }); });
  return { stillUnseen: !!homeEl && homeEl.style.display === 'none', groups: titles.length, rows: names.length,
    gone: names.indexOf(${JSON.stringify(b5.name || '')}) < 0, barInline: bar ? bar.style.display : null };
`);
ok('B5c 点掉一条后停留在 unseen 视图且该行出名单（视闩：不被 renderSeen 翻回首页）',
  b5c.stillUnseen === true && b5c.groups >= 1 && b5c.rows >= 1 && b5c.gone === true, JSON.stringify(b5c));

// ---------- B7：未试名单被点空＝自动退出过滤视图（不留一张过期空列表给系统返回手势） ----------
const allNames = await evalJs(`
  var a = []; document.querySelectorAll('#fhub-body .set-group .set-row .txt').forEach(function (t) { a.push(t.firstChild.textContent); });
  return a;
`);
// 只留 B5 实证过「点了能直达、能记入 seen」的那条（入口不可达的条目点不中也不标记，会空转）
const lastOne = b5.name;
const seeded = {};
allNames.forEach(function (n) { if (n !== lastOne) seeded[n] = 1; });
await evalJs(`
  var o = ${JSON.stringify(seeded)};
  localStorage.setItem('xy-home-v2:fhub-seen', JSON.stringify(o));
  try { if (window.idbSet) await window.idbSet('xy-home-v2:fhub-seen', o); } catch (e) {}
  return true;
`);
await openCold(true);
await evalJs("document.getElementById('row-featurehub').click(); return true;");
await sleep(600);
const b7a = await barInfo();
await evalJs("document.getElementById('fhub-seen-bar').click(); return true;");
await sleep(500);
const b7b = await evalJs(`
  var rows = []; document.querySelectorAll('#fhub-body .set-row').forEach(function (r) { if (r.offsetParent) rows.push(r); });
  var nm = rows.length === 1 ? rows[0].querySelector('.txt').firstChild.textContent : null;
  if (rows.length) rows[0].click();
  return { rows: rows.length, name: nm };
`);
await sleep(900);
const b7c = await evalJs(`
  var bar = document.getElementById('fhub-seen-bar');
  var homeEl = null; for (var e = bar; e && e !== document.body; e = e.parentElement) { if (e.parentElement && e.parentElement.id === 'fhub-body') homeEl = e; }
  var stale = 0; document.querySelectorAll('#fhub-body .gs-title').forEach(function (t) { if (/个没试过/.test(t.textContent)) stale++; });
  var s = JSON.parse(localStorage.getItem('xy-home-v2:fhub-seen') || '{}');
  return { backHome: !!homeEl && homeEl.style.display !== 'none', staleTitles: stale, marked: !!s[${JSON.stringify(lastOne || '')}] };
`);
ok('B7 点空未试名单后自动退回宫格首页（不留过期空过滤列表）',
  b7a.n === 1 && b7b.rows === 1 && b7c.backHome === true && b7c.staleTitles === 0 && b7c.marked === true, JSON.stringify({ b7a, b7b, b7c }));

// ---------- B6：fhub-freq 存量误迁副本写回根键（EXCLUDE + migrateLegacy 回收） ----------
await evalJs("var bs=document.querySelectorAll('[id$=\"-back\"]'); for (var i=0;i<bs.length;i++){ try{ bs[i].click(); }catch(e){} } return true;");
await evalJs(`
  // 裸 LS 种子：xyStore 实例有内存缓存，boot 时已缓存住 B5 期间写回的值，跨实例 set/remove 不同步
  localStorage.setItem('xy-home-v2:default:fhub-freq', JSON.stringify({ '拍一拍': 7 }));
  localStorage.removeItem('xy-home-v2:fhub-freq');
  try { if (window.idbDelete) await window.idbDelete('xy-home-v2:fhub-freq'); } catch (e) {}
  return localStorage.getItem('xy-home-v2:default:fhub-freq');
`);
await openCold(false);
const b6 = await evalJs(`
  var parse = function (v) { try { return v === null ? null : JSON.parse(v); } catch (e) { return v; } };
  var idb = null; try { idb = await window.idbGet('xy-home-v2:fhub-freq'); } catch (e) {}
  return { root: parse(localStorage.getItem('xy-home-v2:fhub-freq')),
    dup: parse(localStorage.getItem('xy-home-v2:default:fhub-freq')),
    idb: typeof idb === 'string' ? JSON.parse(idb) : idb };
`);
ok('B6 default 误迁副本写回根键并删除（跨桌面「常用」行不再每次刷新清零）',
  !!b6.root && b6.root['拍一拍'] === 7 && (b6.dup === null || b6.dup === undefined), JSON.stringify(b6));

// ---------- Z：零 JS 异常 ----------
const errs = await evalJs(`return (window.__jsErrors||[]).slice(-5);`);
ok('Z 全程零 JS 异常', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
