// #1315 常驻行为回归：把「整组停用」补到其余 12 个系统预设字卡入口，并让「关空」不被内置兜底回灌
// 需求（用户实报「字卡库的系统预设字卡 / 其他互动功能字卡 的单独分组无法选择关闭使用」，追问时点名
// 「有些页压根没有整组开关」）：#926 的分组开关只覆盖 mountCardView 那四个列表（默认聊天字卡/词典/
// 功能字卡/跨桌面查岗）；【系统预设字卡】入口下另有 12 个由各页自渲染的预设池（情绪/回应/TA的心情/
// 寻踪日常/位置卡/TA 的询问·小问题·好奇·吐槽·查岗·邀请），此前只有逐张开关——一个分组几十上百张时
// 想停掉整组只能一张张点，等于够不到「关闭使用」。
// 机制口径（断言全部由此推出）：
//   · 共用件＝default-cards.js 的 window.presetGroup，存 <桌面>:pg-groups-off = { "<页>": [分组名] }；
//     与 #926 的 dc-groups-off 分开存——那张键的语义已被 #926 的针与 #932 的自检账绑在 mountCardView
//     的分类名单上，塞进别的页面＝改动邻居批的口径。
//   · 各页把自己已有的单卡判据当唯一出口叠一层（typeOff / rcOff / ta-mood isCardOff / isCkCardOff /
//     loc isOff / 各 pick 的过滤），组内逐张开关的存值一字不改，重新启用分组即恢复原状。
//   · 「用户关空」与「库里没数据」是两件事：旧写法在池被关空后拿【没过闸】的内置常量填空池
//     （TC_DEFAULT / TCU_DEFAULT / TR_DEFAULT / DEF_PLACES 三空兜底 / 自动换位的陪伴句字面量），
//     于是整组停用看着生效（徽标「已停用」、键写进去了）实际照发＝装饰。本批把这些兜底改成只补真缺数据。
//   · 零机型／零 UA 分支：判据只问「这一组被停用没有」「这一发是不是用户主动关的」。
// 断言：S1~S8 源码/产物锚；A1~A9 情绪/回应/TA的心情（真分组头）；B1~B5 寻踪/位置卡；
//       C1~C9 TA 六类页；X1 跨桌面隔离；Z1 全程零未捕获异常。
// 用法：node tools/verify-1315-preset-group-off.mjs [被测根目录]（缺省＝脚本所在仓库）
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
const code = (f) => srcOf(f) + indexHtml;
const dcCode = code('default-cards.js'), mrcCode = code('mood-reply-cards.js'), tmCode = code('ta-mood.js');
const askCode = code('ta-ask.js'), ckqCode = code('ck-question.js'), tiCode = code('ta-invite.js');
const p2Code = code('p2-features.js'), locCode = code('loc-lib.js');
console.log('S 源码/产物锚');
ok('S1 共用件出口与独立键（pg-groups-off，不与 #926 的 dc-groups-off 混用）',
  dcCode.includes("const PG_KEY = 'pg-groups-off';") && dcCode.includes('window.presetGroup = {'));
ok('S2 开关形态复用 #926 皮肤（ccg-switch 接线凭据 ＋ 已停用徽标）',
  dcCode.includes('class="toggle ccard-toggle ccg-switch"') && dcCode.includes('<em class="ccg-off-tag">已停用</em>'));
ok('S3 情绪页：组闸叠在 typeOff 出口（单卡「重新打开」不许越过整组停用）',
  mrcCode.includes('if (pgOff(type, content)) return true;'));
ok('S4 情绪链选组处按组过滤 ＋ 回应页 rcOff 合并判据',
  mrcCode.includes('presetGroup.isOff(PG_ID_MC.mood, g.group)') && mrcCode.includes("function rcOff(cat, t) {"));
ok('S5 TA的心情：组闸叠在自己的 isCardOff 出口（选组处同源）',
  tmCode.includes("if (window.presetGroup && window.presetGroup.isOff('tm', g)) return true;"));
ok('S6 寻踪：整类停用叠在 isCkCardOff，且 genCheckin 三空兜底重新过闸',
  p2Code.includes("isCkCardOff(k, x) { return store.get('ck-off-' + k + ':' + x) === '1' ||") &&
  p2Code.includes("place = places.filter(p => !isCkCardOff('place', p.t));"));
// #1436 随动：换位那一发从 doLocAuto 抽成了 emitLocChange(avoidText)（给方位感知【感知一下】复用），
// 「词源关空＝这一发不发」那一行整句搬了过去并返回 false（调用方据此知道没发），判据一字未改。
ok('S7 位置卡：组闸叠在 isOff ＋ 硬编码陪伴句按分类反查 ＋ 词源关空不再硬塞「在你身边」',
  locCode.includes("isOff(cat, text) { return store.get('loc-off-' + cat + ':' + text) === '1' ||") &&
  locCode.includes('window.locLibTextOff') && p2Code.includes('if (!all.length) return false;') &&
  !p2Code.includes("all.push('在你身边')"));
ok('S8 TA 六类：类闸＋内置兜底只补「库里没预设数据」＋六页都挂整类停用条',
  askCode.includes('function presetCatOpen(ns, q) {') &&
  askCode.includes('const presetInStore = d.questions.some(q => q.isPreset === true && ready(q));') &&
  (askCode.match(/presetGroup\.catBar\('/g) || []).length === 4 &&
  ckqCode.includes("catBar('ta-checkin'") && tiCode.includes("catBar('ta-invite'"));

// ---- 无头浏览器 ----
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const mtypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': mtypes[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1315-' + Date.now()),
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
// 随机弹层（TA 询问/通话/看图）会吞掉点按——每 300ms 清一遍遮罩（仅测试环境）
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){var ids=['qa-mask','tc-mask','call-mask','img-view-mask'];var sweep=function(){for(var i=0;i<ids.length;i++){var e=document.getElementById(ids[i]);if(e&&!e.hidden)e.hidden=true;}};setInterval(sweep,300);document.addEventListener('DOMContentLoaded',sweep);})()" });

async function openCold() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(600);
}
// 夹具：二级锁必须为 open（锁定＝系统预设字卡整体视为不存在，全部断言会走空池假绿）
async function fixture() {
  return evalJs(`
    window.xyStore('xy-home-v2').set('cardlock-state', 'open');
    var s = window.activeStore();
    s.remove('pg-groups-off'); s.remove('dc-groups-off');
    s.set('dc-enabled', '1'); s.set('dc-use-chat', '1'); s.set('dc-overall-chat', '100');
    if (window.moodSystemState) { ['mood','heart','intent'].forEach(function (k) { window.moodSystemState.setEnabled(k, true); }); }
    s.set('rc-enabled', '1'); s.set('tm-enabled', '1'); s.set('tm-prob', '100'); s.remove('tm-cd-left'); s.set('tm-history', '[]');
    s.set('loc-lib-default', '1'); s.set('checkin-cards-default', '1'); s.set('checkin-en', '1');
    s.set('quote-cards-default', '1');
    return (window.cardLockOpen && window.cardLockOpen()) === true;
  `);
}
const openPage = (li) => evalJs(`var e=document.getElementById('${li}');if(e)e.click();return true;`);
const sleep7 = () => sleep(750);
// 某些页的预设列表只在「系统预设」tab 被点过后才渲染——先点一次再探测（否则会把「没渲染」误判成「没开关」）
const ensureSysTab = (pageId) => evalJs(`
  var p = document.getElementById('${pageId}');
  if (!p) return 'no-page';
  var t = p.querySelector('.cc-tab[data-tab="sys"]');
  if (t) { try { t.click(); } catch (e) {} return 'clicked'; }
  return 'no-tab';
`);
const clickHeaderSwitch = (listSel, i) => evalJs(`
  var hs = document.querySelectorAll('${listSel} .cc-group-header');
  if (hs.length <= ${i}) return 'no-header:' + hs.length;
  var cb = hs[${i}].querySelector('.ccg-switch input');
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
const clickBar = (sel) => evalJs(`
  var b = document.querySelector('${sel} .preset-cat-bar .ccg-switch input');
  if (!b) return 'no-bar';
  b.click();
  return 'ok';
`);
const barState = (sel) => evalJs(`
  var b = document.querySelector('${sel} .preset-cat-bar');
  if (!b) return null;
  var cb = b.querySelector('.ccg-switch input');
  return { label: (b.querySelector('.gs-row span').textContent || '').trim(), checked: cb ? cb.checked : null, tag: !!b.querySelector('.ccg-off-tag') };
`);
const pgKey = () => evalJs(`return window.activeStore().get('pg-groups-off');`);
const clearOff = () => evalJs(`window.activeStore().remove('pg-groups-off'); return true;`);

console.log('A/B/C 行为断言（390×844 无头真点按）');
await openCold();
if ((await fixture()) !== true) { console.error('SKIP: 夹具不可用（二级锁没能置为 open＝断言会走空池假绿）'); chrome.kill(); server.close(); process.exit(2); }
console.log('ℹ 被测构建含 window.presetGroup：' + JSON.stringify(await evalJs('return !!window.presetGroup;')) + '（纯 HEAD＝false，下面本批新契约应当逐条红＝红得应当）');

// ================= A 组：情绪字卡 / 回应字卡 / TA的心情（列表里有真分组头）=================
await openPage('li-mood-cards'); await sleep7();
const a1 = await evalJs(`
  var l = document.getElementById('mc-list');
  var hs = l.querySelectorAll('.cc-group-header');
  return { preset: l.classList.contains('preset-list'), heads: hs.length,
    sw: l.querySelectorAll('.cc-group-header .ccg-switch input').length,
    name: hs[0] && hs[0].querySelector('.ccg-name').textContent.replace('已停用', '') };
`);
ok('A1 情绪字卡页每个分组头带整组开关（容器打 .preset-list）',
  a1 && a1.preset === true && a1.heads >= 5 && a1.sw === a1.heads && a1.sw > 0, JSON.stringify(a1));
// 先落一张单卡关闭（A4 用它验「叠一层不改单卡值」）
const a2 = await evalJs(`
  var D = window.MOOD_FOLLOWUP_DATA || {}; var g0 = (D.mood || [])[0] || { cards: [] };
  return { grp: g0.group, n: (g0.cards || []).length, second: ((g0.cards || [])[1] || {}).content };
`);
const pre = await clickCardSwitch('#mc-list', 1); await sleep7();
const a3pre = await evalJs(`return window.activeStore().get('mc-off-mood:' + ${JSON.stringify(a2.second)});`);
ok('A4a 前置：组内那张单卡关闭真落了键（否则 A4 的空转）', pre === 'ok' && a3pre === '1', pre + ' key=' + a3pre);
const a4 = await clickHeaderSwitch('#mc-list', 0); await sleep7();
const a5 = await evalJs(`
  var D = window.MOOD_FOLLOWUP_DATA || {}; var g0 = (D.mood || [])[0] || { cards: [] };
  var texts = (g0.cards || []).map(function (c) { return c.content; });
  var allOff = texts.every(function (t) { return window.moodCardOffState('mood', t) === true; });
  var h = document.querySelector('#mc-list .cc-group-header');
  var hits = 0, drawn = 0;
  for (var i = 0; i < 300; i++) { var m = window.getMoodCard(); if (!m) continue; drawn++; if (m.group === g0.group) hits++; }
  return { allOff: allOff, headOff: h.classList.contains('off'), tag: !!h.querySelector('.ccg-off-tag'),
    hits: hits, drawn: drawn, key: window.activeStore().get('pg-groups-off'), grp: g0.group };
`);
ok('A2 点整组开关＝该组全部字卡判关＋分组头标「已停用」＋写对键',
  a4 === 'ok' && a5 && a5.allOff === true && a5.headOff === true && a5.tag === true &&
  String(a5.key).indexOf('"mc:mood"') >= 0 && String(a5.key).indexOf(a2.grp) >= 0, a4 + ' ' + JSON.stringify(a5));
ok('A3 停用分组不参与抽取（连抽 300 次不出该组；非空转＝确有抽出别组）',
  a5 && a5.hits === 0 && a5.drawn >= 20, JSON.stringify(a5));
const a6 = await evalJs(`
  return { stillOff: window.moodCardOffState('mood', ${JSON.stringify(a2.second)}) === true,
    key: window.activeStore().get('mc-off-mood:' + ${JSON.stringify(a2.second)}) };
`);
ok('A4 组闸只叠一层（前置＝分组确实在停用态）：组内那张单卡关闭的字卡存值一字未改', a6 && a6.stillOff === true && a6.key === '1' && a5 && a5.headOff === true, JSON.stringify(a6) + ' a5=' + JSON.stringify(a5));
await clickHeaderSwitch('#mc-list', 0); await sleep7();
const a7 = await evalJs(`
  var D = window.MOOD_FOLLOWUP_DATA || {}; var g0 = (D.mood || [])[0] || { cards: [] };
  var texts = (g0.cards || []).map(function (c) { return c.content; });
  var back = texts.filter(function (t) { return window.moodCardOffState('mood', t) === false; }).length;
  var h = document.querySelector('#mc-list .cc-group-header');
  return { back: back, total: texts.length, off: h.classList.contains('off'), key: window.activeStore().get('pg-groups-off') };
`);
ok('A5 重新启用＝该组恢复（仅用户自己关的那张仍关）＋名单清空不留垃圾键',
  a7 && a7.back === a7.total - 1 && a7.off === false && (!a7.key || a7.key === '{}') && a5 && a5.headOff === true, JSON.stringify(a7));

await openPage('li-reply-cards'); await sleep7();
const b1 = await evalJs(`
  var l = document.getElementById('rc-list');
  return { heads: l.querySelectorAll('.cc-group-header').length, sw: l.querySelectorAll('.cc-group-header .ccg-switch input').length,
    name: (l.querySelector('.ccg-name') || {}).textContent };
`);
ok('A6 回应字卡页分组头带整组开关（8 个连接词类）', b1 && b1.heads >= 5 && b1.sw === b1.heads, JSON.stringify(b1));
const b2 = await clickHeaderSwitch('#rc-list', 0); await sleep(500);
const b3 = await evalJs(`
  var f = (window.MOOD_FOLLOWUP_DATA || {}).followup || {};
  var others = {}; Object.keys(f).forEach(function (k) { if (k !== 'echo') (f[k] || []).forEach(function (t) { others[t] = 1; }); });
  var only = (f.echo || []).filter(function (t) { return !others[t]; });   // 跨类同文案不算本类命中
  var hits = 0, drawn = 0;
  for (var i = 0; i < 300; i++) { var c = window.getReplyCard(); if (!c) continue; drawn++; if (only.indexOf(c) >= 0) hits++; }
  var fw = 0;
  for (var j = 0; j < 300; j++) { var w = window.getFollowupWord('好的'); if (w && only.indexOf(w) >= 0) fw++; }
  return { only: only.length, hits: hits, drawn: drawn, fw: fw, key: window.activeStore().get('pg-groups-off') };
`);
ok('A7 停用「接话」类＝整条替换与连接词追加都不再出该类（独占句判据）',
  b2 === 'ok' && b3 && b3.only >= 5 && b3.hits === 0 && b3.drawn >= 20 && b3.fw === 0, b2 + ' ' + JSON.stringify(b3));
ok('A7b 存储＝pg-groups-off 里的 rc 一条', b3 && String(b3.key).indexOf('"rc"') >= 0, String(b3 && b3.key));
await clearOff(); await sleep(300);

await openPage('li-ta-mood'); await sleep7();
const c1 = await evalJs(`
  var l = document.getElementById('tm-list');
  return { heads: l.querySelectorAll('.cc-group-header').length, sw: l.querySelectorAll('.cc-group-header .ccg-switch input').length,
    grp: ((window.TA_MOOD_DATA || {}).groups || [])[0].group };
`);
ok('A8 TA的心情页分组头带整组开关', c1 && c1.heads >= 5 && c1.sw === c1.heads, JSON.stringify(c1));
const c2 = await clickHeaderSwitch('#tm-list', 0); await sleep(500);
const c3 = await evalJs(`
  var TM = window.TA_MOOD_DATA || {}; var g = TM.groups[0].group;
  var texts = (TM.cards || []).filter(function (c) { return c.group === g; }).map(function (c) { return c.content; });
  var allOff = texts.length > 0 && texts.every(function (t) { return window.taMoodApi.isCardOff(g, t) === true; });
  return { g: g, n: texts.length, allOff: allOff, key: window.activeStore().get('pg-groups-off') };
`);
ok('A9 停用 TA 的心情某一组＝该组全部判关（选组处与冷却同源这一把闸）',
  c2 === 'ok' && c3 && c3.allOff === true && String(c3.key).indexOf('"tm"') >= 0, c2 + ' ' + JSON.stringify(c3));
await clearOff(); await sleep(300);

// ================= B 组：寻踪日常 / 位置卡（扁平分类 tab）=================
await openPage('li-checkin-cards'); await ensureSysTab('page-checkin-cards'); await sleep7();
const d1 = await barState('#cck-sys-list');
ok('B1 寻踪日常字卡页有整类停用条', d1 && d1.checked === true && d1.label.indexOf('整组停用') === 0, JSON.stringify(d1));
const d2 = await clickBar('#cck-sys-list'); await sleep(500);
const d3 = await evalJs(`
  var s = window.activeStore();
  s.set('dcf-checkin', '100');
  var btn = document.getElementById('ck-refresh');
  var before = s.get('checkin-current');
  if (btn) btn.click();
  return { key: s.get('pg-groups-off'), tag: !!document.querySelector('#cck-sys-list .ccg-off-tag'),
    btn: !!btn, cur0: before };
`);
await sleep(900);
const d4 = await evalJs(`
  var s = window.activeStore();
  var one = JSON.parse(s.get('checkin-current') || '{}');
  // 三类全停用 → 手动刷新后不得由兜底凭空生成（旧写法把三个未过滤整表塞回来）
  window.presetGroup.set('cck', 'place', true); window.presetGroup.set('cck', 'action', true); window.presetGroup.set('cck', 'msg', true);
  return { placeOffByDef: !!(one.place), one: one };
`);
// ck-refresh 自带 5 秒节流（连点会在聊天里刷出多条「更新日常」）——不等够就是假读数
await sleep(5600);
const d5 = await evalJs(`
  var btn = document.getElementById('ck-refresh'); if (btn) btn.click();
  return true;
`);
await sleep(900);
const d6 = await evalJs(`
  var one = JSON.parse(window.activeStore().get('checkin-current') || '{}');
  return { keys: Object.keys(one).length, one: one, key: window.activeStore().get('pg-groups-off') };
`);
ok('B2 点停用条＝写键 pg-groups-off["cck"]＋标「已停用」', d2 === 'ok' && d3 && d3.tag === true && String(d3.key).indexOf('"cck"') >= 0, d2 + ' ' + JSON.stringify(d3));
ok('B2a 前置非空转：只停一类时手动刷新仍生成得出日常', d4 && d4.one && (d4.one.action || d4.one.msg) !== undefined, JSON.stringify(d4));
ok('B3 三类全停用＝不再由兜底凭空生成日常（旧写法把三个未过滤整表塞回来）',
  d6 && d6.keys === 0, JSON.stringify(d6));
await clearOff(); await sleep(300);

await openPage('li-loc-cards'); await ensureSysTab('page-loc-cards'); await sleep7();
const e1 = await barState('#cloc-sys-list');
ok('B4 位置卡页有整类停用条（九个分类各是一个分组）', e1 && e1.checked === true, JSON.stringify(e1));
const e2 = await clickBar('#cloc-sys-list'); await sleep(500);
const e3 = await evalJs(`
  var offDir = window.presetGroup.isOff('loc', 'dir');
  var sysDir = ((window.locLibGetSys() || {}).dir || []).length;
  var all = window.locLibAllEnabled() || [];
  var dirSamples = ['在你左边', '在你右边', '在你身后', '在你前面'];
  var leaked = all.filter(function (t) { return dirSamples.indexOf(t) >= 0; }).length;
  // 自动换位那条硬编码陪伴句：停用「状态/感知」后必须按所属分类反查到闸
  window.presetGroup.set('loc', 'state', true); window.presetGroup.set('loc', 'sense', true);
  var hard = ['在你身边', '一直没走远', '隔着世界在你身边', '隐约在你身旁', '在你看不到的地方'];
  var blocked = hard.every(function (t) { return window.locLibTextOff(t) === true; });
  var before = window.activeStore().get('checkin-current');
  return { offDir: offDir, sysDir: sysDir, leaked: leaked, blocked: blocked, key: window.activeStore().get('pg-groups-off') };
`);
ok('B5 停用「方位」＝该类预设卡从面板词源里消失（同一判据收口）',
  e2 === 'ok' && e3 && e3.offDir === true && e3.sysDir === 0 && e3.leaked === 0, e2 + ' ' + JSON.stringify(e3));
ok('B6 自动换位的硬编码陪伴句按所属分类过同一条闸（旧写法从不过闸）',
  e3 && e3.blocked === true, JSON.stringify(e3));
await clearOff(); await sleep(300);

// ================= C 组：TA 的六类页（询问/小问题/好奇/吐槽/查岗/邀请）=================
// C1/C2 每页都有整类停用条且写对自己的命名空间
const sixPages = [
  ['li-ta-ask', 'page-ta-ask', '#ta-ask-sys-cats', 'ta-ask'],
  ['li-ta-choose', 'page-ta-choose', '#tc-sys-cats', 'ta-choose'],
  ['li-ta-curious', 'page-ta-curious', '#tcu-sys-cats', 'ta-curious'],
  ['li-ta-roast', 'page-ta-roast', '#tr-sys-cats', 'ta-roast'],
  ['li-ta-checkin', 'page-ta-checkin', '#ckq-sys-cats', 'ta-checkin'],
  ['li-ta-invite', 'page-ta-invite', '#ti-sys-cats', 'ta-invite']
];
const sixUi = [], sixKey = [];
for (const [li, pageId, sel, ns] of sixPages) {
  await openPage(li); await ensureSysTab(pageId); await sleep7();
  const st = await barState(sel);
  sixUi.push([ns, !!(st && st.checked === true && st.label.indexOf('整组停用') === 0)]);
  const clicked = st ? await clickBar(sel) : 'no-bar';
  await sleep(450);
  const k = await pgKey();
  sixKey.push([ns, clicked === 'ok' && String(k).indexOf('"' + ns + '"') >= 0]);
  await clearOff(); await sleep(200);
}
ok('C1 六类页各自带整类停用条', sixUi.every((x) => x[1]), JSON.stringify(sixUi));
ok('C2 点停用条＝按本页命名空间写键（六个 ns 全中）', sixKey.length === 6 && sixKey.every((x) => x[1]), JSON.stringify(sixKey));

// C3~C9 行为：分类与题目一律从页面本身取（预设题是运行时合并进内存的，直接读存盘会假空转），
// 再拦 window.chatAddSystem 数「TA 到底发没发」——比读 DOM 猜更硬。
async function drawGate(btnId, sel, ns) {
  return evalJs(`
    var box = document.querySelector('${sel}');
    if (!box) return { skip: '无容器' };
    var tabs = [].slice.call(box.querySelectorAll('.cc-tab[data-cat]'));
    if (tabs.length < 2) return { skip: '分类不足', keys: tabs.length };
    var cats = {};
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].click();
      await new Promise(function (r) { setTimeout(r, 160); });
      cats[tabs[t].dataset.cat] = [].slice.call(box.querySelectorAll('.ta-row .ta-txt, .tc-qrow .tc-qtext, .ta-row .tc-qtext')).map(function (el) {
        return String((el.firstChild && el.firstChild.textContent) || '').trim();
      }).filter(Boolean);
    }
    tabs[0].click();
    await new Promise(function (r) { setTimeout(r, 160); });
    var keys = Object.keys(cats).filter(function (k) { return cats[k].length; });
    if (keys.length < 2) return { skip: '有题分类不足', keys: keys.length };
    var owner = {}; keys.forEach(function (k) { cats[k].forEach(function (tx) { if (owner[tx] === undefined) owner[tx] = k; }); });
    var keep = keys[keys.length - 1];
    var spy = [];
    var orig = window.chatAddSystem;
    window.chatAddSystem = function (t) { spy.push(String(t || '')); return orig.apply(window, arguments); };
    var btn = document.getElementById('${btnId}');
    // ① 只留最后一个分类：连点 14 次，发出来的题必须全部属于该分类
    keys.forEach(function (k) { window.presetGroup.set('${ns}', k, k !== keep); });
    for (var i = 0; i < 14; i++) { try { btn && btn.click(); } catch (e) {} }
    await new Promise(function (r) { setTimeout(r, 400); });
    var got1 = spy.filter(function (t) { return owner[t] !== undefined; });
    var wrong1 = got1.filter(function (t) { return owner[t] !== keep; });
    // ② 连最后一个分类也停用：一次都不该再发（旧写法在这里会回灌内置题库）
    spy = [];
    keys.forEach(function (k) { window.presetGroup.set('${ns}', k, true); });
    for (var j = 0; j < 10; j++) { try { btn && btn.click(); } catch (e) {} }
    await new Promise(function (r) { setTimeout(r, 400); });
    var got2 = spy.filter(function (t) { return owner[t] !== undefined; });
    window.chatAddSystem = orig;
    window.activeStore().remove('pg-groups-off');
    return { cats: keys.length, keep: keep, keepN: cats[keep].length, drawn1: got1.length, wrong1: wrong1.length,
      drawn2: got2.length, sample1: got1.slice(0, 2), sample2: got2.slice(0, 2) };
  `);
}
await openPage('li-ta-ask'); await ensureSysTab('page-ta-ask'); await sleep7();
const gAsk = await drawGate('ta-ask-now', '#ta-ask-sys-cats', 'ta-ask');
ok('C3 询问：停用其余分类后只从剩余分类出题', gAsk && gAsk.wrong1 === 0 && gAsk.drawn1 >= 3, JSON.stringify(gAsk));
ok('C4 询问：全部分类停用后一次都不再发问', gAsk && gAsk.drawn2 === 0, JSON.stringify(gAsk));
await openPage('li-ta-choose'); await ensureSysTab('page-ta-choose'); await sleep7();
const gChoose = await drawGate('tc-now', '#tc-sys-cats', 'ta-choose');
ok('C5 小问题：整类停用只从剩余分类出题', gChoose && gChoose.wrong1 === 0 && gChoose.drawn1 >= 3, JSON.stringify(gChoose));
ok('C6 小问题：全类停用＝不回灌 TC_DEFAULT（＝用户所见「关不掉」本体）', gChoose && gChoose.drawn2 === 0, JSON.stringify(gChoose));
await openPage('li-ta-curious'); await ensureSysTab('page-ta-curious'); await sleep7();
const gCurious = await drawGate('tcu-now', '#tcu-sys-cats', 'ta-curious');
ok('C7 好奇：整类停用生效且全类停用不回灌 TCU_DEFAULT', gCurious && gCurious.wrong1 === 0 && gCurious.drawn2 === 0, JSON.stringify(gCurious));
await openPage('li-ta-roast'); await ensureSysTab('page-ta-roast'); await sleep7();
const gRoast = await drawGate('tr-now', '#tr-sys-cats', 'ta-roast');
ok('C8 吐槽：整类停用生效且全类停用不回灌 TR_DEFAULT', gRoast && gRoast.wrong1 === 0 && gRoast.drawn2 === 0, JSON.stringify(gRoast));
await openPage('li-ta-checkin'); await ensureSysTab('page-ta-checkin'); await sleep7();
const gCk = await drawGate('ckq-now', '#ckq-sys-cats', 'ta-checkin');
ok('C9 查岗题库：整类停用只从剩余分类出题（本题库无内置回灌，全类停用应当零发送）',
  gCk && gCk.wrong1 === 0 && gCk.drawn2 === 0, JSON.stringify(gCk));

// 邀请页走的是 chat.js 的门（taInviteDraw），单独按返回值判
const gInvite = await evalJs(`
  var box = document.querySelector('#ti-sys-cats');
  if (!box || !window.triggerTaInviteNow || !window.presetGroup) return { noPg: true };
  // 分类与题面从页面本身取（预设题是运行时合并进内存的，直接读存盘会假空转）
  var tabs = [].slice.call(box.querySelectorAll('.cc-tab[data-cat]'));
  var kinds = [];
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].click();
    await new Promise(function (r) { setTimeout(r, 160); });
    if (box.querySelectorAll('.ta-row').length > 0) kinds.push(tabs[t].dataset.cat);
  }
  tabs[0].click();
  await new Promise(function (r) { setTimeout(r, 160); });
  if (!kinds.length) return { kinds: 0 };
  // 全部邀请分类停用 → 那道门一次都不该起
  kinds.forEach(function (k) { window.presetGroup.set('ta-invite', k, true); });
  var firedAllOff = 0;
  for (var i = 0; i < 12; i++) { try { if (window.triggerTaInviteNow()) firedAllOff++; } catch (e) { return { err: String(e).slice(0, 90), kinds: kinds.length }; } }
  // 只留第一个分类 → 必须还能起（非空转）
  window.activeStore().remove('pg-groups-off');
  kinds.forEach(function (k, idx) { window.presetGroup.set('ta-invite', k, idx !== 0); });
  var firedOneOn = 0;
  for (var j = 0; j < 12; j++) { try { if (window.triggerTaInviteNow()) firedOneOn++; } catch (e) {} }
  window.activeStore().remove('pg-groups-off');
  return { kinds: kinds.length, firedAllOff: firedAllOff, firedOneOn: firedOneOn };
`);
ok('C10 邀请：全类停用＝一次都不发起；只留一类＝照常发起（非空转）',
  gInvite && gInvite.kinds >= 1 && gInvite.firedAllOff === 0 && gInvite.firedOneOn >= 1, JSON.stringify(gInvite));
// ================= F 组：夹具真实／旧契约未动（两侧都应当绿）=================
// 这一组刻意不碰本批任何新契约：只证「页面真渲染了、逐张开关真的在、不判关时真的能发」——
// 否则 A3/B3/C4 那几条「停用后 0 命中／0 发送」可能只是压根没发（假绿），基线也就无从对照。
await openPage('li-mood-cards'); await sleep7();
const f1 = await evalJs(`
  var out = {};
  var l = document.getElementById('mc-list');
  out.mcItems = l.querySelectorAll('.cc-item').length;
  out.mcSwitches = l.querySelectorAll('.cc-item input[type="checkbox"]').length;
  var drawn = 0;
  for (var i = 0; i < 300; i++) { if (window.getMoodCard()) drawn++; }
  out.moodDrawn = drawn;
  return out;
`);
ok('F1 情绪字卡页逐张开关照常在（旧契约未被顶掉）', f1 && f1.mcItems >= 10 && f1.mcSwitches === f1.mcItems, JSON.stringify(f1));
ok('F2 不判关时情绪卡真抽得出（后面 A3 的 0 命中才是"挡住了"而非"压根没发"）', f1 && f1.moodDrawn >= 20, JSON.stringify(f1));
const f3 = await evalJs(`
  var f = (window.MOOD_FOLLOWUP_DATA || {}).followup || {};
  var others = {}; Object.keys(f).forEach(function (k) { if (k !== 'echo') (f[k] || []).forEach(function (t) { others[t] = 1; }); });
  var only = (f.echo || []).filter(function (t) { return !others[t]; });
  var hits = 0;
  for (var i = 0; i < 400; i++) { var c = window.getReplyCard(); if (c && only.indexOf(c) >= 0) hits++; }
  for (var j = 0; j < 400; j++) { var w = window.getFollowupWord('好的'); if (w && only.indexOf(w) >= 0) hits++; }
  return { only: only.length, hits: hits };
`);
ok('F3 不判关时「接话」类照常出（A7 的 0 命中非空转）', f3 && f3.only >= 5 && f3.hits >= 20, JSON.stringify(f3));
const f4pre = await evalJs(`
  var s = window.activeStore();
  s.remove('checkin-current');
  return { btn: !!document.getElementById('ck-refresh') };
`);
// ck-refresh 的 5 秒节流（前面 B 组刚点过）——不等够这一发会被吞成假红
await sleep(5600);
const f4 = await evalJs(`var b = document.getElementById('ck-refresh'); if (b) b.click(); return !!b;`);
await sleep(900);
const f5 = await evalJs(`
  var one = JSON.parse(window.activeStore().get('checkin-current') || 'null');
  var sys = window.locLibGetSys() || {};
  return { has: !!one, keys: one ? Object.keys(one).length : 0, dir: (sys.dir || []).length };
`);
ok('F4 不判关时寻踪手动刷新能生成日常（B3 的 0 字段非空转）', f4 === true && f5 && f5.has === true && f5.keys === 3, JSON.stringify(f5));
ok('F5 不判关时位置卡「方位」类在面板词源里（B5 的 0 命中非空转）', f5 && f5.dir >= 3, JSON.stringify(f5));
const f6 = await openPage('li-ta-ask'); await ensureSysTab('page-ta-ask'); await sleep7();
const f7 = await evalJs(`
  var spy = [];
  var orig = window.chatAddSystem;
  window.chatAddSystem = function (t) { spy.push(String(t || '')); return orig.apply(window, arguments); };
  var btn = document.getElementById('ta-ask-now');
  for (var i = 0; i < 8; i++) { try { btn && btn.click(); } catch (e) {} }
  await new Promise(function (r) { setTimeout(r, 400); });
  window.chatAddSystem = orig;
  return { calls: spy.length };
`);
ok('F6 不判关时「让 TA 问一次」真的发问（C4 的 0 发送非空转）', f7 && f7.calls >= 3, JSON.stringify(f7));

// ================= X1 跨桌面隔离 =================
const x1 = await evalJs(`
  var TM = window.TA_MOOD_DATA || {}; var g = TM.groups[0].group;
  var text = ((TM.cards || []).filter(function (c) { return c.group === g; })[0] || {}).content;
  window.presetGroup.set('tm', g, true);
  var cur = window.taMoodApi.isCardOff(g, text);
  var other = window.presetGroup.isOff('tm', g, window.storeFor('c1315zzz'));
  var rawOther = window.storeFor('c1315zzz').get('pg-groups-off');
  window.presetGroup.set('tm', g, false);
  return { cur: cur, other: other, rawOther: rawOther, hasText: !!text };
`);
ok('X1 按桌面独立：当前桌面停用＝判关，另一桌面读同一分组＝不受影响',
  x1 && x1.hasText === true && x1.cur === true && x1.other === false && (x1.rawOther === null || x1.rawOther === undefined || x1.rawOther === ''), JSON.stringify(x1));

// ================= Z1 零未捕获异常 =================
const z1 = await evalJs(`
  var e = (window.__jsErrors || []);
  return { n: e.length, sample: e.slice(0, 3).map(function (x) { return String(x && (x.msg || x.message) || x).slice(0, 120); }) };
`);
ok('Z1 全程零未捕获异常', z1 && z1.n === 0, JSON.stringify(z1));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
