// ===== 功能验证脚本：#572 页面内「先做这个」提示（复杂页首访自述 + 首选动作 + 空状态动作） =====
// 用法：node tools/verify-page-coach.mjs（需 node 21+ 与本机 Chrome/Edge）
// 背景（用户 2026-09-16「每个复杂页面里不知道先点哪儿」）：
//   ① 能说清「这是什么/从哪进」的只有设置页的功能大全与功能说明胶囊——人已经站在字卡库/美化页里
//      发懵时，答案在另一个页面后面；② 页面内层级平行（字卡库三 tab + 添加/批量导入/链接导入/分组），
//      没人说「先动这两项」；③ 空状态只陈述不动作。
// #572 做法：新模块 page-coach.js——每页首访在页面内插一条细提示（一句话「先做这个」+ 一键动作
//   + 可展开「这页还有什么（N）」，条目取自功能大全目录表 window.mochiHubItemsFor＝文案单一事实源）；
//   每页只提示一次（__coach-seen，已进 contacts.js EXCLUDE 免迁）；设置 → 工具 → 使用提示 可重置；
//   空状态补动作（#memo-empty-add / #feed-empty-pub / #dl-empty-put 委托既有入口）。
// 验证（无头 Chrome 384×752 真实产物）：S 层源码断言 + B 层行为断言——
//   B1 进字卡库出现提示条（含首选动作与索引 toggle）；B2 展开索引条目数正确可点；
//   B3 离开再进不再出现（已看标记生效）；B4 进美化页也提示；
//   B5 已经有字卡时字卡库不提示（need 门）；B6 设置里的「使用提示」行存在且点击开面板（#640 起：
//   面板逐页列出「提示什么 / 现在还会不会再提示 / 去看看」，重置结果常驻面板，0 位移、翻页/关面板锁均正常）；
//   B7 朋友圈空态带「我来发第一条」按钮（委托既有发布入口）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const chk = (name, ok, detail) => { if (ok) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); } };

// ---------- S 层：源码断言 ----------
// 读不到就当空串（文件被删/改名时按「断言红」报出，而不是让脚本崩掉——RED 基线要能跑完）
const readSrc = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
const pcSrc = readSrc('src/js/page-coach.js');
const hubSrc = readSrc('src/js/feature-hub.js');
const ctSrc = readSrc('src/js/contacts.js');
const bmSrc = readSrc('build.mjs');
const maSrc = readSrc('src/js/mobile-adapt.js');
const tbSrc = readSrc('src/js/tabs.js');
console.log('S 层（源码作用域）');
// #1421 换锚：旧针钉死 `page.insertBefore(buildBar(cfg), page.firstChild)`＝把条子写死在页首。
// 那条写法在「页自己不滚、滚动权在内层窗口」的页里＝条子常驻成第二层头部，实测把回复设置页的
// 列表窗口从 419px 挤到 298px、顶部 342px（360×640 的 54%）划不动。挂载点因此改成现算两路。
// 语义没变的那一半照旧钉：条子必须插在页面容器内，绝不是全局弹层。
chk('S1 提示条插入页面内（不是弹窗）', pcSrc.includes('mountBar(page, buildBar(cfg));') && !/document\.body\.appendChild\(bar\b/.test(pcSrc));
chk('S1b #1421 挂载点按「这一页自己滚不滚」分两路（缺＝内层窗口那族页又被挤窄一屏）', /function mountBar\s*\(\s*page\s*,\s*bar\s*\)/.test(pcSrc) && /page\.scrollHeight\s*-\s*page\.clientHeight\s*>\s*0/.test(pcSrc));
chk('S2 每页一次标记键', pcSrc.includes("const MARK = G + '__coach-seen';"));
chk('S3 功能大全目录表只读查询暴露（文案单一事实源）', hubSrc.includes('window.mochiHubItemsFor = function (sels) {'));
chk('S4 标记键进 contacts.js 免迁白名单', ctSrc.includes("'__coach-seen',"));
chk('S5 新模块登记进 build.mjs jsFiles', bmSrc.includes("'onboarding.js', 'page-coach.js'"));
chk('S6 设置页重置行 + 复位接口', pcSrc.includes('id="row-pagetips"') && pcSrc.includes('window.mochiPageTipsReset = resetAll;'));
// #592：原实现只调 window.toast（全项目从未赋值过）＝重置成功但零可见反馈
chk('S8 重置行点击有可见反馈通道（自绘 #cc-toast，不再只靠 window.toast）', pcSrc.includes("t.id = 'cc-toast'; document.body.appendChild(t);") && pcSrc.includes("tipToast('已重置"));
// #640（用户第二次报同一句「点击使用提示什么反应也没有，根本没有设计这个功能」）：行文案把「字卡库」
// 写在最前，而已有字卡的用户进字卡库按设计永不提示（REG.chatcard.need）＝承诺里最显眼那条不出现，
// 重置在屏幕上又只留一个 2.4 秒 toast ⇒ 点击改为开面板（哪几页有提示 / 提示什么 / 现在还会不会再提示 / 结果常驻）
chk('S9 新面板带 id 挂 body（id 形态＝可进 mobile-adapt FLOAT_SELECTORS）', pcSrc.includes("sheet.id = 'pc-sheet-mask';"));
chk('S10 面板登记进 mobile-adapt 背景滚动锁清单', maSrc.includes("'#pc-sheet-mask'"));
chk('S11 面板登记进 tabs.js 返回键浮层清单', tbSrc.includes("'pc-sheet-mask'"));
chk('S12 面板列出每页提示 + 状态 + 直达入口', pcSrc.includes('<div class="pc-sh-item" data-shgo="') && pcSrc.includes("cfg.skipText || '这页当前不需要提示'") && pcSrc.includes('去看看 →'));
chk('S13 重置结果常驻面板（不再只靠 toast）', pcSrc.includes('msg.textContent = n') && pcSrc.includes('msg.hidden = false;'));
const empties = [
  ['js/memo-app.js', 'memo-empty-add'],
  ['js/feed.js', 'feed-empty-pub'],
  ['js/drift-bottle.js', 'dl-empty-put'],
];
empties.forEach(function (e) {
  const src = readFileSync(join(root, 'src/' + e[0]), 'utf8');
  chk('S7 空状态动作 ' + e[1] + '（' + e[0] + '）', src.includes('id="' + e[1] + '"'));
});

// ---------- B 层：真实产物行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const profDir = join(process.env.TEMP || '/tmp', 'mochi-prof-' + Date.now());
const cdpPort = 9750 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profDir,
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 384, height: 752, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);

const seeded = await evalJs(`(function () {
  try { localStorage.setItem('xy-home-v2:cc-scope-migrated', '1'); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:__coach-seen'); } catch (e) {}
  try { localStorage.removeItem(window.activePrefix() + 'cc-groups'); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:cc-groups-public'); } catch (e) {}
  return !!document.querySelector('.tab[data-page="page-chatcard"]');
})()`);
chk('B0 就绪（全新环境无字卡 + 字卡库 tab 存在）', seeded === true, String(seeded));

const openCards = `(function () {
  const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click();
  const c = document.querySelector('.tab[data-page="page-chatcard"]'); if (c) c.click();
  return 1;
})()`;
const openPhone = `(function () { const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click(); return 1; })()`;

// B1 进字卡库 → 提示条
await evalJs(openCards);
await sleep(900);
const b1 = await evalJs(`(function () {
  const bar = document.querySelector('.pc-bar[data-pc="chatcard"]');
  if (!bar) return { bar: false, hasApi: typeof window.mochiHubItemsFor };
  return {
    bar: true,
    inPage: !!document.querySelector('#page-chatcard > .pc-bar'),
    tip: /公用字卡/.test(bar.textContent),
    act: !!bar.querySelector('[data-pcact]'),
    actLabel: (bar.querySelector('[data-pcact]') || {}).textContent || '',
    toggle: !!bar.querySelector('[data-pctoggle]'),
    toggleTxt: (bar.querySelector('[data-pctoggle]') || {}).textContent || ''
  };
})()`);
chk('B1 进字卡库出现页面内提示条（含「先做这个」文案）', b1 && b1.bar && b1.tip, JSON.stringify(b1));
chk('B1.1 提示条插在页面内（#page-chatcard 首子节点）', b1 && b1.inPage, JSON.stringify(b1 && b1.inPage));
chk('B1.2 带首选动作按钮与「这页还有什么」索引', b1 && b1.act && b1.toggle, JSON.stringify(b1));

// B2 展开索引
const n = await evalJs(`(function () {
  const m = (document.querySelector('.pc-bar[data-pc="chatcard"] .pc-toggle').textContent.match(/（(\\d+)）/) || [])[1];
  return m ? parseInt(m, 10) : -1;
})()`);
const b2 = await evalJs(`(async function () {
  const bar = document.querySelector('.pc-bar[data-pc="chatcard"]');
  bar.querySelector('[data-pctoggle]').click();
  await new Promise(r => setTimeout(r, 200));
  const more = bar.querySelector('.pc-more');
  return { opened: more && !more.hidden, items: bar.querySelectorAll('.pc-item').length, sample: (bar.querySelector('.pc-item .pc-n') || {}).textContent || '' };
})()`);
chk('B2 展开「这页还有什么」后条目数与该页功能数一致', b2 && b2.opened && n > 0 && b2.items === n, JSON.stringify({ n: n, b2: b2 }));

// B3 离开再进不再出现
await evalJs(openPhone);
await sleep(400);
const b3pre = await evalJs(`(function () { return (localStorage.getItem('xy-home-v2:__coach-seen') || '') ; })()`);
await evalJs(openCards);
await sleep(800);
const b3 = await evalJs(`(function () { return { bars: document.querySelectorAll('.pc-bar[data-pc="chatcard"]').length }; })()`);
chk('B3 已看标记写入（含 chatcard）', /chatcard/.test(String(b3pre)), String(b3pre));
chk('B3.1 再进字卡库不再出现（只提示一次）', b3 && b3.bars === 0, JSON.stringify(b3));

// B4 美化页也提示
const b4 = await evalJs(`(async function () {
  const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click();
  await new Promise(r => setTimeout(r, 300));
  const row = document.getElementById('row-appearance');
  if (!row) return { row: false };
  row.click();
  await new Promise(r => setTimeout(r, 900));
  const bar = document.querySelector('.pc-bar[data-pc="theme"]');
  return { row: true, bar: !!bar, inPage: !!(bar && bar.closest('#page-theme')), act: !!(bar && bar.querySelector('[data-pcact]')) };
})()`);
chk('B4 进桌面美化页出现提示条（含「先套用方案」动作）', b4 && b4.bar && b4.inPage && b4.act, JSON.stringify(b4));

// B5 已经有字卡时字卡库不提示（need 门）
const b5 = await evalJs(`(async function () {
  window.mochiPageTipsReset(); // 清标记，制造「会提示」的条件
  const json = JSON.stringify({ text: [['G1', ['随便一张卡']]], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] });
  window.xyStore(window.activePrefix()).set('cc-groups', json);
  const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click();
  await new Promise(r => setTimeout(r, 200));
  const c = document.querySelector('.tab[data-page="page-chatcard"]'); if (c) c.click();
  await new Promise(r => setTimeout(r, 900));
  return { bars: document.querySelectorAll('.pc-bar[data-pc="chatcard"]').length };
})()`);
chk('B5 已有字卡时字卡库不再提示（不打扰已完成用户）', b5 && b5.bars === 0, JSON.stringify(b5));

// B5.1（#640 的诚实状态）：同一情形下面板必须**说出**这条不再提示，而不是让用户去字卡库白等一场
//（用户「点击什么反应也没有」的一半成因：行文案把字卡库列最前，而它按设计永远不出现）
const b5p = await evalJs(`(async function () {
  const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click();
  await new Promise(r => setTimeout(r, 250));
  const st = document.querySelector('.tab[data-page="page-setting"]'); if (st) st.click();
  await new Promise(r => setTimeout(r, 500));
  const tt = document.querySelector('#set-tabs .them-tab[data-tab="tools"]'); if (tt) tt.click();
  await new Promise(r => setTimeout(r, 400));
  const row = document.getElementById('row-pagetips');
  if (!row) return { row: false };
  row.click();
  await new Promise(r => setTimeout(r, 400));
  const sh = document.getElementById('pc-sheet-mask');
  if (!sh || sh.hidden) return { row: true, panel: false };
  const items = sh.querySelectorAll('.pc-sh-item');
  const st0 = (items[0].querySelector('.pc-sh-st') || {}).textContent || '';
  sh.querySelector('[data-shreset]').click();
  await new Promise(r => setTimeout(r, 400));
  const msg = (sh.querySelector('.pc-sh-msg') || {}).textContent || '';
  sh.querySelector('[data-shclose]').click();
  return { row: true, panel: true, status0: st0, msg: msg };
})()`);
chk('B5.1 已有字卡时面板对字卡库明说「这页不再提示」（不明说＝用户以为功能坏了）',
  b5p && b5p.panel && /不再提示/.test(b5p.status0 || '') && /已经有字卡/.test(b5p.status0 || ''), JSON.stringify(b5p));
chk('B5.2 重置结果按「真正还会提示的页数」报数（已有字卡＝2 页，不是照抄 3 页）',
  b5p && b5p.panel && /的 2 个页面/.test(b5p.msg || ''), JSON.stringify(b5p));

// B6 设置里的重置行（#592 行要真的在「工具」省区里可见+点击有可见反馈；#640 起点击＝开面板）
const b6 = await evalJs(`(async function () {
  window.mochiPageTipsReset();
  const t = document.querySelector('.tab[data-page="page-setting"]');
  if (t) t.click();
  await new Promise(r => setTimeout(r, 500));
  const tt = document.querySelector('#set-tabs .them-tab[data-tab="tools"]');
  if (tt) tt.click();
  await new Promise(r => setTimeout(r, 400));
  const row = document.getElementById('row-pagetips');
  if (!row) return { row: false };
  const rect = row.getBoundingClientRect();
  row.click();
  await new Promise(r => setTimeout(r, 400));
  const sh = document.getElementById('pc-sheet-mask');
  const cs = sh ? getComputedStyle(sh) : null;
  const r2 = sh ? sh.getBoundingClientRect() : null;
  const items = sh ? sh.querySelectorAll('.pc-sh-item') : [];
  const txt = (el, sel) => { const x = el && el.querySelector(sel); return x ? x.textContent : ''; };
  return {
    row: true,
    sec: row.closest('.them-sec') ? row.closest('.them-sec').getAttribute('data-sec') : null,
    visible: !!(row.offsetParent || row.getClientRects().length) && rect.height > 0,
    panelShown: !!(sh && !sh.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || 1) > 0.05),
    panelInView: !!(r2 && r2.height > 0 && r2.top >= 0 && r2.bottom <= innerHeight + 1),
    items: items.length,
    names: Array.prototype.map.call(items, x => txt(x, '.pc-sh-h span')),
    statuses: Array.prototype.map.call(items, x => txt(x, '.pc-sh-st')),
    goes: Array.prototype.filter.call(items, x => x.querySelector('.pc-sh-go')).length,
    resetBtn: !!sh && !!sh.querySelector('[data-shreset]'),
    floats: (window.__mochiStuckProbe ? (window.__mochiStuckProbe() || {}).openFloats : null) || []
  };
})()`);
chk('B6 设置 → 工具存在「使用提示」重置行', b6 && b6.row, JSON.stringify(b6));
chk('B6.0 该行在「工具」省区内且真实可见（有高度、非 display:none）', b6 && b6.visible && b6.sec === 'tools', JSON.stringify(b6));
chk('B6.3 点击该行出现「使用提示」面板且完整落在屏幕内（#640·修前点击只闪一个 toast）', b6 && b6.panelShown && b6.panelInView, JSON.stringify(b6));
chk('B6.4 面板逐页列出「哪页有提示 / 现在还会不会再提示 / 去看看」', b6 && b6.items === 3 && b6.goes === 3 && b6.statuses.every(s => s.length > 0) && b6.names.join('|').indexOf('字卡库') >= 0, JSON.stringify(b6));
// 注：新生环境的「全新环境·导入备份」等首访浮层本身就会一直持有背景滚动锁，故这里断言「面板在
// mobile-adapt 的浮层清单里被识别为打开」（=登记生效），而不是裸看 body.scroll-lock。
chk('B6.5 面板被 mobile-adapt 认作打开中的浮层（#pc-sheet-mask 已进 FLOAT_SELECTORS＝背景会被锁）', b6 && b6.floats.indexOf('#pc-sheet-mask') >= 0, JSON.stringify(b6));

// #640 重置动作在面板内：标记清空 + toast + 结果常驻面板
const b6r = await evalJs(`(async function () {
  try { localStorage.setItem('xy-home-v2:__coach-seen', JSON.stringify(['chatcard', 'theme'])); } catch (e) {}
  const sh = document.getElementById('pc-sheet-mask');
  const btn = sh && sh.querySelector('[data-shreset]');
  if (!btn) return { btn: false };
  btn.click();
  await new Promise(r => setTimeout(r, 400));
  const toast = document.getElementById('cc-toast');
  const cs = toast ? getComputedStyle(toast) : null;
  const msg = sh.querySelector('.pc-sh-msg');
  return {
    btn: true,
    cleared: !localStorage.getItem('xy-home-v2:__coach-seen'),
    toastShown: !!(toast && toast.className.indexOf('show') >= 0 && cs.opacity === '1' && toast.textContent.length > 0),
    toastText: toast ? toast.textContent : '',
    msgShown: !!(msg && !msg.hidden),
    msgText: msg ? msg.textContent : '',
    stillOpen: !sh.hidden
  };
})()`);
chk('B6.1 点「重新显示这些提示」后已看标记清空（可重新看提示）', b6r && b6r.cleared, JSON.stringify(b6r));
chk('B6.2 同一次点击有可见反馈（#cc-toast 出现·带 show·opacity=1·有文案；#592 修复前为死代码 window.toast）', b6r && b6r.toastShown, JSON.stringify(b6r));
chk('B6.6 重置结果常驻面板（不随 toast 消失；#640 修前屏上零落脚点）', b6r && b6r.msgShown && /已重新显示/.test(b6r.msgText), JSON.stringify(b6r));

// #640 面板内「去看看」＝关面板 + 切到该页（字卡库）
const b6go = await evalJs(`(async function () {
  const sh = document.getElementById('pc-sheet-mask');
  if (!sh || sh.hidden) { const r = document.getElementById('row-pagetips'); if (r) r.click(); await new Promise(r2 => setTimeout(r2, 400)); }
  const s2 = document.getElementById('pc-sheet-mask');
  const items = s2 ? s2.querySelectorAll('.pc-sh-item') : [];
  if (!items.length) return { items: 0 };
  items[0].click();
  await new Promise(r => setTimeout(r, 1000));
  const pg = document.getElementById('page-chatcard');
  const sh2 = document.getElementById('pc-sheet-mask');
  const floats = (window.__mochiStuckProbe ? (window.__mochiStuckProbe() || {}).openFloats : null) || [];
  return { items: items.length, closed: s2.hidden, pageOpen: !!(pg && !pg.hidden), sheetHidden: !!(sh2 && sh2.hidden), floats: floats };
})()`);
chk('B6.7 面板「去看看」关面板并切到对应页面（字卡库）', b6go && b6go.closed && b6go.pageOpen, JSON.stringify(b6go));
chk('B6.8 关面板后自己不再是「打开中的浮层」（残留＝设置页/字卡库滑不动，同 #527 家族）', b6go && b6go.sheetHidden && b6go.floats.indexOf('#pc-sheet-mask') < 0, JSON.stringify(b6go));

// B7 朋友圈空态带动作按钮（委托既有发布入口）
const b7 = await evalJs(`(async function () {
  const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click();
  await new Promise(r => setTimeout(r, 300));
  const app = document.querySelector('.app[data-app="feed"]');
  if (!app) return { app: false };
  app.click();
  await new Promise(r => setTimeout(r, 900));
  const btn = document.getElementById('feed-empty-pub');
  const pub = document.getElementById('feed-publish-btn');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 400));
  return { app: true, btn: !!btn, pub: !!pub, inPage: !!(btn && btn.closest('#page-feed')) };
})()`);
chk('B7 朋友圈空态出现「我来发第一条」按钮（位于动态页内）', b7 && b7.btn && b7.inPage, JSON.stringify(b7));
chk('B7.1 点击该按钮不报错且发布入口可达', b7 && b7.pub, JSON.stringify(b7));

const errs = await evalJs(`(window.__jsErrors || []).length`);
chk('B8 无页面 JS 错误', (errs || 0) === 0, 'errors=' + errs);

try { chrome.kill(); } catch (e) {}
await sleep(900);
try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {} // 退出即清 profile：单次约 40~50MB，累积会把盘写满（2026-09-16 实测 ENOSPC）
server.close();
console.log('');
console.log('==== verify-page-coach（#572）：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail ? 1 : 0);
