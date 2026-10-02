// verify-1266：经期页暗色填色被压平 + 弹窗操作件被正文推出可视区（＝「按不动」）+ 功能自检盲区收口——A/B 行为尺（无头 CDP 真跑产物）
// 症状（iPhone 12 Pro Max／iOS 16.6 Safari 实报，多机型同现）：暗色下「填色的图标无法正常显示」
// （状态图标 rgb(85,85,85)、经期/排卵日历格与空白格同色、primary 主按钮无品牌底）；
// 「记录按钮按不动」而功能自检全绿（旧自检程序化 click 穿透遮罩、只查 pageVisible）。
// 同场取证第二条：每日备份提醒弹窗（big＋长 staticText）正文 715px 把胶囊行与「确定」顶到
// .modal 裁剪区外（胶囊 rect.top 873、「确定」923 ＞ 视口 844，elementFromPoint 取不到），
// 而 .modal 滚动条按 v3.25.x 偏好隐藏＝唯一遮罩长期在场＝整屏发灰、页面按钮按不动。
// 用法：node tools/verify-1266-period-dark-fill.mjs <产物目录>（必须显式传，缺省即退出＝防喂错产物）
// 断言：A 产物锚点｜B 暗色填色行为（红侧＝症状读数本体）｜B5 备份弹窗操作件免滚动可命中（红侧＝873/923）｜
//       C 浅色对照（两侧皆绿）｜D 遮罩真触摸撤除后经期页交互链（两侧皆绿＝没修过头）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';

const serveRoot = resolve(process.argv[2] || '');
if (!serveRoot || !statSync(serveRoot + '/index.html', { throwIfNoEntry: false })) { console.error('必须显式传产物目录（含 index.html）'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到浏览器（环境不满足）'); process.exit(2); }

const results = [];
const t = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? '  <- ' + detail : '')); };
const skip = (name, why) => { results.push({ name, ok: null, detail: why }); console.log('SKIP ' + name + '  <- ' + why); };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => { try { let p = normalize(join(serveRoot, decodeURIComponent(req.url.split('?')[0]))); if (!p.startsWith(serveRoot)) { res.writeHead(403); res.end(); return; } if (statSync(p).isDirectory()) p = join(p, 'index.html'); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); } catch (e) { res.writeHead(404); res.end('nf'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const port = Number(process.env.MOCHI_CDP_PORT || (9300 + Math.floor(Math.random() * 500)));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v1266-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws; const pend = new Map(); let mid = 0;
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((x) => x.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res2, rej) => { ws.onopen = res2; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
if (!ws) { console.error('CDP 连不上（环境不满足）'); try { chrome.kill(); } catch (e) {} process.exit(2); }
const cdp = (method, params = {}) => new Promise((res2) => { const id = ++mid; pend.set(id, res2); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 300); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });

// ===== A 组：产物锚点（#1266a~f 与 build.mjs 登记表同源；CSS 针按 minify 后行形态） =====
const artHtml = readFileSync(join(serveRoot, 'index.html'), 'utf8');
const NEEDLES = [
  ['A1 #1266a 暗色阶段图标填色回收', '[data-theme="dark"] .period-status-ico.phase-period { background:#e85a8f; }'],
  ['A2 #1266b 暗色日历经期格填色回收', '[data-theme="dark"] .period-grid .pc-cell.ph-period { background:#e85a8f; color:#fff; border-color:#e85a8f; }'],
  ['A3 #1266c 暗色主按钮品牌底回收', '[data-theme="dark"] .period-btn.primary { background:#e85a8f; border-color:#e85a8f; color:#fff; }'],
  ['A4 #1266d 自检命中测试（device.js 内联件）', 'if (hit && (hit === el || el.contains(hit))) return true;'],
  ['A5 #1266e 自检经期填色断言', "const PHASE_BG = { period: 'rgb(232, 90, 143)', fertile: 'rgb(245, 166, 35)', safe: 'rgb(126, 198, 158)' };"],
  ['A6 #1266f 弹窗正文框高度上限', '.modal-static { max-height:38vh; overflow-y:auto; overscroll-behavior:auto; }']
];
for (const [name, needle] of NEEDLES) {
  const n = artHtml.split(needle).length - 1;
  t(name, n === 1, '命中 ' + n + ' 次（应恰 1＝存在且唯一）');
}

const dayKey = (n) => { const d0 = new Date(); d0.setDate(d0.getDate() - n); return d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0'); };
// 联系人键＝备份提醒 due() 的前提（本地确有数据可备）；不写 __last-backup＝今天该提醒
const seedFor = (theme) => 'try{' + Object.entries({
  'xy-home-v2:theme-mode': theme,
  'xy-home-v2:contacts': JSON.stringify([{ id: 'c1', name: '小星' }]),
  'xy-home-v2:period-migrated': '1',
  'xy-home-v2:period-cfg': JSON.stringify({ cycleLen: 28, periodLen: 5, lutealPhase: 14 }),
  'xy-home-v2:period-records': JSON.stringify([{ id: 'a', start: dayKey(40), end: dayKey(35) }, { id: 'b', start: dayKey(12), end: dayKey(8) }]),
  'xy-home-v2:applock-qaskip': '1'
}).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('') + '}catch(e){}';

const readState = `(function(){
  var gs=function(el){return el?getComputedStyle(el).backgroundColor:null;};
  var ico=document.getElementById('period-status-ico');
  var cells=function(ph){return [].slice.call(document.querySelectorAll('#period-grid .pc-cell.'+ph));};
  var reds=cells('ph-period'), fers=cells('ph-fertile'), nons=cells('ph-none');
  var prim=document.querySelector('.period-btn.primary:not([hidden])');
  return {
    themeAttr: document.documentElement.getAttribute('data-theme'),
    icoClass: ico?ico.className:null, icoBg: gs(ico),
    title: (document.getElementById('period-status-title')||{}).textContent||'',
    nPeriodCells: reds.length, periodCellBg: reds.length?gs(reds[0]):null,
    nFertileCells: fers.length, fertileCellBg: fers.length?gs(fers[0]):null,
    nNoneCells: nons.length, noneCellBg: nons.length?gs(nons[0]):null,
    primBg: gs(prim), primTop: (function(){if(!prim)return null;var r=prim.getBoundingClientRect();var e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e?e.tagName+'.'+String(e.className||'').slice(0,24):null;})()
  };
})()`;

// 弹窗几何读数：不做任何滚动，直接量操作件是否在可视区内、命中测试是否落在自己身上
const MODAL_GEO = `(function(){
  var m=document.getElementById('modal-mask'); if(!m||m.hidden) return null;
  var box=m.querySelector('.modal'); var ok=document.getElementById('modal-ok');
  var st=document.getElementById('modal-static');
  var pills=[].slice.call(m.querySelectorAll('.modal-pills .pill, .modal-pills button'));
  var rect=function(e){if(!e)return null;var r=e.getBoundingClientRect();return {t:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height)};};
  var hit=function(e){if(!e)return null;var r=e.getBoundingClientRect();var y=r.top+r.height/2;if(y<0||y>innerHeight)return 'offscreen';var ht=document.elementFromPoint(r.left+r.width/2,y);return (ht&&(ht===e||e.contains(ht)))?1:0;};
  return {
    title:(m.querySelector('.modal-title')||{}).textContent||'', innerH:innerHeight,
    box:rect(box), boxScroll: box?{top:box.scrollTop,sh:box.scrollHeight,ch:box.clientHeight}:null,
    st:rect(st), stScroll: st?{sh:st.scrollHeight,ch:st.clientHeight}:null,
    ok:rect(ok), okHit:hit(ok),
    pillHits:pills.map(function(p){return {txt:(p.textContent||'').trim(),rect:rect(p),hit:hit(p)};})
  };
})()`;

const okRectExpr = `(function(){var m=document.getElementById('modal-mask');if(!m||m.hidden)return null;var box=m.querySelector('.modal');if(box)box.scrollTop=box.scrollHeight;var ok=document.getElementById('modal-ok');var r=ok?ok.getBoundingClientRect():null;if(!r||r.width<2)return null;return {x:r.left+r.width/2,y:r.top+r.height/2}})()`;
const realTapAt = async (q) => { await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x, y: q.y }] }); await sleep(90); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };

async function loadPage(theme) {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(300);
  try { await cdp('Storage.clearDataForOrigin', { origin: base, storageTypes: 'localstorage,indexedDB' }); } catch (e) {}
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: seedFor(theme) });
  await cdp('Page.navigate', { url: base + '/index.html' });
  await sleep(3000);
  for (let i = 0; i < 80; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await ev(`(function(){try{var s=document.querySelector('#splash,.splash');if(s)s.remove();var q=document.querySelector('#qa-mask');if(q)q.remove();return 1}catch(e){return 0}})()`);
  return await ev(readState);
}

// ===== B5 组：每日备份提醒弹窗——操作件必须免滚动就在可视区内可命中 =====
await loadPage('dark');
let backup = null;
for (let i = 0; i < 40; i++) {
  const g = await ev(MODAL_GEO);
  if (g && String(g.title).indexOf('备份提醒') >= 0) { backup = g; break; }
  await sleep(500);
}
if (!backup) skip('B5 组', '备份提醒弹窗未出现（环境：due() 前提未满足）');
else {
  t('B5a 备份提醒弹窗在场（title 含「备份提醒」）', true, 'title=' + backup.title);
  t('B5b 「确定」未滚动即在视口内且命中测试落在自身（红侧＝rect.top 923＞视口 844＝offscreen＝按不动本体）', backup.okHit === 1, 'ok=' + JSON.stringify(backup.ok) + ' hit=' + backup.okHit + ' innerH=' + backup.innerH);
  const badPills = (backup.pillHits || []).filter((p) => p.hit !== 1);
  t('B5c 胶囊行（去备份／备份聊天／稍后）逐个免滚动可命中（红侧＝top 873 offscreen）', badPills.length === 0 && (backup.pillHits || []).length >= 2, 'pills=' + JSON.stringify(backup.pillHits));
  t('B5d 超长正文在正文框内自滚（红侧＝sh===ch 正文不内滚、把操作件顶出 .modal 裁剪区）', !!backup.stScroll && backup.stScroll.sh > backup.stScroll.ch, 'st=' + JSON.stringify(backup.st) + ' stScroll=' + JSON.stringify(backup.stScroll) + ' boxScroll=' + JSON.stringify(backup.boxScroll));
}

// ===== B 组：暗色填色行为 ＋ D 组：撤遮罩后真触摸交互链 =====
// 逐层撤罩：#1263 让路闸下引导弹时刻不再恒为「就绪+4s」＝尺子时序洞；改「每轮先撤可见弹窗（滚到底再点）、
// 直到送达账（storage-guide-shown=1250）落定」，不依赖具体弹出时刻，两侧同一把尺子。
async function clearOverlays() {
  let dismissed = 0;
  for (let i = 0; i < 60; i++) {
    const shown = await ev(`(function(){try{if(localStorage.getItem('xy-home-v2:storage-guide-shown')==='1250')return true}catch(e){}return window.__guideShownViaIdb===true})()`);
    if (shown) break;
    const q = await ev(okRectExpr);
    if (q) { await realTapAt(q); dismissed++; await sleep(1600); }
    else await sleep(500);
  }
  for (let k = 0; k < 4; k++) {
    await sleep(1200);
    const q2 = await ev(okRectExpr);
    if (!q2) break;
    await realTapAt(q2); dismissed++;
  }
  return dismissed;
}
await loadPage('dark');
const nDismissed = await clearOverlays();
await ev(`(function(){var a=document.querySelector('.app[data-app="period"]');if(a)a.click();return !!a})()`);
await sleep(800);
t('D0 弹窗可被真触摸逐层关闭至隐形（两侧皆绿＝关闭语义健康；本尺先滚到底再点）', await ev(`(function(){var m=document.getElementById('modal-mask');return m&&(m.hidden||getComputedStyle(m).display==='none')})()`) === true, 'OK 真触摸 ' + nDismissed + ' 次');
const S = await ev(readState);
t('B1 暗色·状态图标＝当前阶段品牌色（排卵窗应 rgb(245,166,35)；红侧＝压平读数 rgb(85,85,85)）', S.icoBg === 'rgb(245, 166, 35)', 'ico=' + S.icoClass + ' bg=' + S.icoBg);
if (S.nPeriodCells) t('B2 暗色·经期日历格＝品牌粉（红侧＝与空白格同 rgb(30,30,30)）', S.periodCellBg === 'rgb(232, 90, 143)', 'n=' + S.nPeriodCells + ' bg=' + S.periodCellBg);
else skip('B2', '当月无经期格样本（环境）');
if (S.nFertileCells && S.nNoneCells) t('B3 暗色·排卵格与空白格必须不同色（红侧＝同色＝整月无色）', S.fertileCellBg !== S.noneCellBg, 'fer=' + S.fertileCellBg + ' none=' + S.noneCellBg);
else skip('B3', '排卵/空白格样本不足（环境）');
t('B4 暗色·primary 主按钮品牌底（红侧＝卡面灰底压平）', S.primBg === 'rgb(232, 90, 143)', 'bg=' + S.primBg + ' top=' + S.primTop);
// D 链：真触摸 记录今天→浮层→排卵症状 chip→保存→落库
const tap = async (sel) => await ev(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;var r=el.getBoundingClientRect();if(r.width<2)return null;return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
const realTap = async (sel) => { const q = await tap(sel); if (!q) return false; await realTapAt(q); await sleep(500); return true; };
await realTap('#period-record-today');
t('D1 真触摸「记录今天」浮层出现（撤遮罩后两侧皆绿；遮罩在场时红＝按不动本体）', await ev(`!!document.getElementById('period-day-pop')`) === true, '');
await realTap('.dp-sym[data-sym="ovulation"]');
t('D2 真触摸「排卵症状」chip 置 on', await ev(`(function(){var el=document.querySelector('.dp-sym[data-sym="ovulation"]');return el&&el.classList.contains('on')})()`) === true, '');
await realTap('.dp-save');
t('D3 保存落库（period-daily 出现 ovulation 症状）', await ev(`(function(){try{var dd=JSON.parse(localStorage.getItem('xy-home-v2:period-daily')||'{}');for(var k in dd)if(dd[k].symptoms&&dd[k].symptoms.indexOf('ovulation')>=0)return true;return false}catch(e){return false}})()`) === true, '');
// ===== C 组：浅色对照（填色与修复前一致＝没修过头） =====
await loadPage('light');
await clearOverlays();
await ev(`(function(){var a=document.querySelector('.app[data-app="period"]');if(a)a.click();return !!a})()`);
await sleep(800);
const L = await ev(readState);
t('C1 浅色·状态图标品牌色（对照组，两侧皆绿）', L.icoBg === 'rgb(245, 166, 35)', 'bg=' + L.icoBg + ' top=' + L.primTop);
if (L.nPeriodCells) t('C2 浅色·经期格品牌粉（对照组，两侧皆绿）', L.periodCellBg === 'rgb(232, 90, 143)', 'bg=' + L.periodCellBg);
else skip('C2', '当月无经期格样本（环境）');
t('C3 浅色·primary 主按钮（对照组，两侧皆绿）', L.primBg === 'rgb(232, 90, 143)', 'bg=' + L.primBg);
t('C4 浅色·遮罩撤除后主按钮可命中（对照组）', String(L.primTop || '').indexOf('BUTTON') === 0, 'top=' + L.primTop);
const jsErr = await ev(`(window.__jsErrors||[]).length`);
t('E1 全程零 JS 异常（对照组）', jsErr === 0, 'jsErrors=' + JSON.stringify(await ev(`(window.__jsErrors||[]).slice(0,2)`)).slice(0, 200));

const pass = results.filter((r0) => r0.ok === true).length;
const fail = results.filter((r0) => r0.ok === false).length;
const sk = results.filter((r0) => r0.ok === null).length;
console.log('合计 ' + results.length + '：通过 ' + pass + '，断言失败 ' + fail + '，SKIP ' + sk);
try { chrome.kill(); } catch (e) {} server.close();
process.exit(fail ? 1 : (sk ? 2 : 0));
