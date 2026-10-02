// #926 常驻行为回归：系统预设字卡「整组停用/启用」开关（用户直派「默认聊天字卡与词典里缺少
// 关闭某个分组的字卡使用，现在只有关闭单独字卡使用的功能」；零机型分支）。
// 机制口径（判据全部由此推出）：
//   · 存 <桌面>:dc-groups-off = { 分类: [分组名,...] }，生效收在 isOff 这一个消费端总闸上
//     ——凡走 window.isDefaultCardOff / defaultCardApiFor(st).isOff 的池（聊天混入/群聊/写信/
//     朋友圈/日历/词典拼字/梦角造句/各功能同源池）自动跟上；
//   · 分组开关只叠一层：组内单卡开关（dc-off-<分类>:<内容>）的存值一字不改，重新启用分组即恢复；
//   · 开关按联系人桌面独立保存（同 dc-off-*）：A 桌面停用不影响 B 桌面。
// 断言：
//   S1~S5 产物/源码锚（双闸 isOff、写键、分组头开关 markup、.preset-list 容器锚、CSS 规则）；
//   B0 默认聊天字卡页分组头有开关且容器带 .preset-list；
//   B1 点分组头开关＝写对键＋该组全部卡停用＋别组不受影响＋分组头出现「已停用」；
//   B2 叠一层不改单卡值（组内先关一张→停组→重新启用分组→那张仍关、其余恢复）；
//   B3 抽取真的避开停用组（只留一个分组，连抽 60 次全落在该组内）；
//   B4 词典独立页同款开关可用（停用「语录」→ 语录全停、词库不受影响）；
//   B5 跨桌面隔离（当前桌面停用＝true，另一桌面 storeFor 读＝false）；
//   B6 停用后滚动虚拟窗口照常推进（不空白、不换页）；
//   B7 单卡开关回归（既有能力未被顶掉）；
//   Z 全程零 JS 异常。
// 用法：node tools/verify-dc-group-off.mjs [被测根目录]（缺省＝脚本所在仓库）
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
const srcOf = (f) => {
  try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; }
};
const dcCode = srcOf('default-cards.js') + indexHtml;
const cssCode = indexHtml;
console.log('S 源码/产物锚');
ok('S1 isOff 总闸串了分组停用（单卡闸 + groupOffFor 双闸）', dcCode.includes('return groupOffFor(cat, c, st);'));
ok('S2 分组停用写当前桌面键 dc-groups-off', dcCode.includes("ls.set(GOFF_KEY, JSON.stringify(next));") && dcCode.includes("const GOFF_KEY = 'dc-groups-off';"));
ok('S3 分组头渲染带整组开关（toggle.ccard-toggle + 已停用徽标）', dcCode.includes('<label class="toggle ccard-toggle" title="') && dcCode.includes('ccg-off-tag'));
ok('S4 预设字卡列表容器打 .preset-list 样式锚', dcCode.includes("viewList.classList.add('preset-list');"));
ok('S5 CSS 分组开关规则在位（只作用于 .preset-list，不碰 emoji/poke 列表）', cssCode.includes('.preset-list .cc-group-header .ccard-toggle { width:36px; height:21px; flex-shrink:0; }'));

// ---- 无头浏览器 ----
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9980 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-926-' + Date.now()),
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

async function openCold() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(600);
}
// 夹具：二级锁必须为 open（锁定＝系统预设字卡整体视为不存在，全部断言会走空池假绿）
async function setupFixture() {
  return evalJs(`
    var g = window.xyStore('xy-home-v2');
    g.set('cardlock-state', 'open');
    var s = window.activeStore();
    s.remove('dc-groups-off');
    s.set('dc-enabled', '1'); s.set('dc-use-chat', '1');
    s.set('dc-overall-chat', '100'); s.set('reply-dcp-all', '100');
    s.set('dc-prob-main', '100'); s.set('dc-prob-kaomoji', '0');
    s.set('dc-prob-emoji', '0'); s.set('dc-prob-touch', '0');
    return (window.cardLockOpen && window.cardLockOpen()) === true;
  `);
}
const openPage = (li) => evalJs(`var e=document.getElementById('${li}');if(e)e.click();return true;`);
const sleep7 = () => sleep(700);
// 取某分类的分组成员（页面数据源＝消费端同一份）
const groupsOf = (cat) => evalJs(`return (window.DEFAULT_CARD_DATA['${cat}']||[]).map(function(g){return [g[0], g[1].slice()];});`);
// 通过 UI 点第 i 个分组头的整组开关
const clickGroupSwitch = (listSel, i) => evalJs(`
  var hs = document.querySelectorAll('${listSel} .cc-group-header');
  if (hs.length <= ${i}) return 'no-header:' + hs.length;
  var cb = hs[${i}].querySelector('.ccard-toggle input');
  if (!cb) return 'no-switch';
  cb.click();
  return 'ok';
`);
const clickCardSwitch = (listSel, i) => evalJs(`
  var its = document.querySelectorAll('${listSel} .cc-item');
  if (its.length <= ${i}) return 'no-item:' + its.length;
  var cb = its[${i}].querySelector('input');
  if (!cb) return 'no-switch';
  cb.click();
  return 'ok';
`);
const headerState = (listSel, i) => evalJs(`
  var hs = document.querySelectorAll('${listSel} .cc-group-header');
  var h = hs[${i}];
  if (!h) return null;
  var cb = h.querySelector('.ccard-toggle input');
  return { off: h.classList.contains('off'), tag: !!h.querySelector('.ccg-off-tag'),
    checked: cb ? cb.checked : null, name: (h.querySelector('.ccg-name').textContent || '').replace('已停用', '') };
`);
const offMap = () => evalJs(`return window.activeStore().get('dc-groups-off');`);
// 「名单已清空」＝没有键（null / '' / '{}' 都算），别把字符串 '{}' 当真值判成未清空
const isCleared = async () => {
  const raw = await offMap();
  if (raw === null || raw === undefined || raw === '') return true;
  try { const o = JSON.parse(raw); return !!o && typeof o === 'object' && Object.keys(o).length === 0; } catch (e) { return false; }
};
const isOff = (cat, txt) => evalJs(`return window.isDefaultCardOff('${cat}', ${JSON.stringify(txt)}) === true;`);

console.log('B 行为断言（390×844 无头）');
await openCold();
if ((await setupFixture()) !== true) { console.error('SKIP: 二级锁夹具未能置为 open（断言会走空池假绿）'); chrome.kill(); server.close(); process.exit(2); }
await openCold();

// ---- B0 默认聊天字卡页：分组头有整组开关 ----
await openPage('li-default-cards');
await sleep7();
const b0 = await evalJs(`
  var l = document.getElementById('dc-list');
  return { preset: !!(l && l.classList.contains('preset-list')),
    heads: l ? l.querySelectorAll('.cc-group-header').length : -1,
    sw: l ? l.querySelectorAll('.cc-group-header .ccard-toggle input').length : -1,
    vis: !document.getElementById('page-default-cards').hidden };
`);
ok('B0 默认聊天字卡页分组头带整组开关（容器 .preset-list）', b0 && b0.vis && b0.preset && b0.heads >= 2 && b0.sw === b0.heads, JSON.stringify(b0));
const h0 = await headerState('#dc-list', 0);
const grps = await groupsOf('main');
const g0name = grps && grps[0] ? grps[0][0] : '';
const g1name = grps && grps[1] ? grps[1][0] : '';
ok('B0b 首个分组头即主字卡第一个分组（可见性前置）', h0 && h0.name === g0name && h0.off === false && h0.checked === true, JSON.stringify(h0) + ' vs ' + g0name);

// ---- B7 先落一张单卡关闭（后面 B2 用它验「叠一层不改单卡值」） ----
const g0cards = (grps[0] && grps[0][1]) || [];
const victim = g0cards.length > 1 ? g0cards[1] : '';
const pre7 = await clickCardSwitch('#dc-list', 1);
await sleep7();
ok('B7 单卡开关照常可用（组内第二张单独关闭）', pre7 === 'ok' && (await isOff('main', victim)) === true &&
  (await evalJs(`return window.activeStore().get('dc-off-main:' + ${JSON.stringify(victim)});`)) === '1', pre7 + ' victim=' + victim);

// ---- B1 停用整组 ----
const pre1 = await clickGroupSwitch('#dc-list', 0);
await sleep7();
const b1map = await offMap();
const b1head = await headerState('#dc-list', 0);
let allG0Off = true;
for (const c of g0cards.slice(0, 12)) { if ((await isOff('main', c)) !== true) { allG0Off = false; break; } }
const otherCard = ((grps[1] && grps[1][1]) || [])[0] || '';
const otherOff = otherCard ? await isOff('main', otherCard) : null;
let b1ok = pre1 === 'ok' && allG0Off && b1head && b1head.off === true && b1head.tag === true && b1head.checked === false;
ok('B1 点分组头开关＝该组全部字卡停用＋分组头标「已停用」', b1ok, pre1 + ' allG0Off=' + allG0Off + ' head=' + JSON.stringify(b1head));
ok('B1b 只停本组：别组第一张仍可用', otherOff === false, 'otherOff=' + otherOff + ' (' + g1name + ')');
try {
  const rec = JSON.parse(b1map || '{}');
  ok('B1c 存储＝桌面键 dc-groups-off = {main:[分组名]}', Array.isArray(rec.main) && rec.main.length === 1 && rec.main[0] === g0name, String(b1map));
} catch (e) { ok('B1c 存储＝桌面键 dc-groups-off = {main:[分组名]}', false, String(b1map)); }

// ---- B2 停组只是叠一层：单卡值不动，重新启用即恢复 ----
await clickGroupSwitch('#dc-list', 0);
await sleep7();
const b2head = await headerState('#dc-list', 0);
ok('B2 重新启用分组＝分组头复位（徽标消失、开关回勾）', b2head && b2head.off === false && b2head.tag === false && b2head.checked === true, JSON.stringify(b2head));
ok('B2b 组内那张单卡关闭的卡仍是关闭（单卡值一字未改）', (await isOff('main', victim)) === true &&
  (await evalJs(`return window.activeStore().get('dc-off-main:' + ${JSON.stringify(victim)});`)) === '1');
ok('B2c 其余同组卡恢复可用', g0cards[0] ? (await isOff('main', g0cards[0])) === false : false);
ok('B2d 停用名单已清空（不留空数组垃圾键）', await isCleared(), String(await offMap()));

// ---- B3 抽取真的避开停用组：只留第一个分组，连抽 60 次 ----
const keepSet = await evalJs(`
  var grps = window.DEFAULT_CARD_DATA.main || [];
  var s = window.activeStore();
  var off = [];
  for (var i = 1; i < grps.length; i++) off.push(grps[i][0]);
  s.set('dc-groups-off', JSON.stringify({ main: off }));
  var keep = {};
  (grps[0][1] || []).forEach(function (t) { keep[t] = 1; });
  var hit = 0, out = 0, sample = '';
  for (var k = 0; k < 60; k++) {
    var r = window.getDefaultCards('chat');
    if (!r || !r.text) continue;
    hit++;
    if (!keep[r.text]) { out++; if (!sample) sample = r.text; }
  }
  return { hit: hit, out: out, sample: sample, groups: grps.length, offN: off.length };
`);
ok('B3 停用分组不参与抽取（只留一组时连抽 60 次全部落在该组）', keepSet && keepSet.hit >= 30 && keepSet.out === 0, JSON.stringify(keepSet));
ok('B3b 前置非空转：停用名单覆盖其余全部分组', keepSet && keepSet.offN === keepSet.groups - 1 && keepSet.groups > 50, JSON.stringify(keepSet));

// ---- B5 跨桌面隔离 ----
const b5 = await evalJs(`
  var grps = window.DEFAULT_CARD_DATA.main || [];
  var txt = (grps[1] && grps[1][1] && grps[1][1][0]) || '';
  var cur = window.defaultCardApiFor(window.activeStore()).isOff('main', txt);
  var other = window.defaultCardApiFor(window.storeFor('c999zzz')).isOff('main', txt);
  return { cur: cur, other: other, txt: txt };
`);
ok('B5 按桌面独立：当前桌面停用＝不抽取，另一桌面读同一条＝仍可用', b5 && b5.cur === true && b5.other === false, JSON.stringify(b5));
await evalJs(`window.activeStore().remove('dc-groups-off'); return true;`);
await sleep(400);

// ---- B4 词典独立页同款开关 ----
await openPage('li-dict-cards');
await sleep7();
const dictGrps = await groupsOf('dict');
const dName = dictGrps && dictGrps[0] ? dictGrps[0][0] : '';
const dCards = (dictGrps[0] && dictGrps[0][1]) || [];
const d2Cards = (dictGrps[1] && dictGrps[1][1]) || [];
const pre4 = await clickGroupSwitch('#d2-dict-list', 0);
await sleep7();
const b4head = await headerState('#d2-dict-list', 0);
const b4sample = dCards.slice(0, 8);
let allDOff = true;
for (const c of b4sample) { if ((await isOff('dict', c)) !== true) { allDOff = false; break; } }
ok('B4 词典页分组开关同款生效（' + dName + ' 全停）', pre4 === 'ok' && allDOff && b4head && b4head.off === true && b4head.tag === true,
  pre4 + ' allDOff=' + allDOff + ' head=' + JSON.stringify(b4head));
ok('B4b 词典另一分组（' + (dictGrps[1] ? dictGrps[1][0] : '') + '）不受影响', d2Cards.length ? (await isOff('dict', d2Cards[0])) === false : false);
await clickGroupSwitch('#d2-dict-list', 0);
await sleep7();
ok('B4c 重新启用后词典恢复（首条可用、键清空）', (b4sample[0] ? (await isOff('dict', b4sample[0])) === false : false) &&
  await isCleared(), 'firstOff=' + (b4sample[0] ? await isOff('dict', b4sample[0]) : 'n/a') + ' offMap=' + (await offMap()));

// ---- B6 停用后虚拟窗口照常滚动渲染（徽标换行不改窗口推进） ----
await openPage('li-default-cards');
await sleep7();
const b6 = await evalJs(`
  var l = document.getElementById('dc-list');
  // 该页真实滚动容器是 .page（列表自身不裁剪）：沿父级找「确实在裁剪内容」的元素，找不到才按视口
  var sc = null, el = l;
  while (el && el !== document.documentElement) {
    var oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) { sc = el; break; }
    el = el.parentElement;
  }
  var before = l.querySelectorAll('.cc-item').length;
  var firstBefore = l.querySelector('.cc-item') ? l.querySelector('.cc-item').textContent.slice(0, 12) : '';
  var yBefore = sc ? sc.scrollTop : window.pageYOffset;
  if (sc) { sc.scrollTop = yBefore + 9000; sc.dispatchEvent(new Event('scroll')); }
  else { window.scrollTo(0, 9000); document.dispatchEvent(new Event('scroll')); }
  return new Promise(function (res) { setTimeout(function () {
    var kids = l.children, items = l.querySelectorAll('.cc-item').length, heads = l.querySelectorAll('.cc-group-header').length;
    var first = l.querySelector('.cc-item');
    res({ before: before, items: items, heads: heads,
      top: !!(kids[0] && kids[0].className.indexOf('cc-vspace') >= 0),
      y: sc ? sc.scrollTop : (window.pageYOffset || document.documentElement.scrollTop),
      yBefore: yBefore, advanced: !!(first && first.textContent.slice(0, 12) !== firstBefore),
      box: sc ? (sc.className || sc.tagName) : 'win',
      firstTxt: first ? first.textContent.slice(0, 12) : '' });
  }, 700); });
`);
await evalJs(`window.scrollTo(0, 0); var e=document.querySelector('.page.active'); if (e) e.scrollTop = 0; return true;`);
ok('B6 停用分组后滚动仍渲染窗口条目（虚拟窗口未被打断）', b6 && b6.items >= 20 && b6.heads >= 1 && b6.top === true && b6.y > 500 && b6.advanced === true, JSON.stringify(b6));

// ---- Z 零异常 ----
const zerr = await evalJs(`return (window.__jsErrors || []).slice(-6).join(' | ');`);
ok('Z 全程零 JS 异常', !zerr, String(zerr));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
await cdp('Browser.close').catch(() => {});
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
