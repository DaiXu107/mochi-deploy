// ===== 专项验证 #581：图标图片「缩放 + 位置」可调 + 边看边调里的批量上传入口（无头 Chrome） =====
// 背景（用户原话）：「【边看边调】功能里缺少批量上传桌面图标按钮」「桌面美化的装修模式和边看边调，
// 上传了图标按钮图片后，需要可以只移动按钮里图片的位置，不用重新上传」。
// 本脚本锁定四条不可回退的性质：
//   A. 边看边调抽屉里有「图标」分区：批量上传桌面图标图片（复用设置页链路）+ 调整图标图片位置；
//   B. 三个入口都能打开位置面板（抽屉 / 设置页行 / 装修模式图标菜单），点哪个图标就调哪个；
//   C. 缩放/位置写进 app-icon-zoom/pos-x/pos-y-<key>，即时生效且刷新后仍在（不碰图片本体）；
//   D. 两支渲染都不露底色：未放大走 object-position，放大后走 translate+scale 并给 .app-ico 裁边。
// 用法：node tools/verify-icon-img-fit.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function read(p) { return readFileSync(join(root, p), 'utf8'); }
const b = read('build.mjs');
function arrOf(n) { const m = b.match(new RegExp('const ' + n + '\\s*=\\s*\\[([\\s\\S]*?)\\]')); return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []; }
let css = '', js = '';
for (const f of arrOf('cssFiles')) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of arrOf('jsFiles')) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + read('src/template.html') +
  '<scr' + 'ipt>window.__APP_VERSION__="t";</scr' + 'ipt><scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';
const server = createServer((q, r) => {
  try {
    const p = q.url.split('?')[0];
    if (p === '/test.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(page); return; }
    if (p === '/blank.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html><body>b</body></html>'); return; }
    r.writeHead(404); r.end();
  } catch (e) {}
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const cp = cands.find(p => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const tmp = join(os.tmpdir(), 'mochi-iconfit-' + Date.now()); const port = 13200 + Math.floor(Math.random() * 90);
const ch = spawn(cp, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmp, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 100; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const pg = l.find(t => t.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
const cdp = (m, p = {}) => { const i = ++id; return new Promise(r => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); }); };
async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r && r.result ? r.result.value : null; }
const results = [];
const chk = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  [' + String(d).slice(0, 320) + ']')); };
await cdp('Page.enable'); await cdp('Runtime.enable');
try { await cdp('Page.setInterceptFileChooserDialog', { enabled: true }); } catch (e) {}
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: base + '/blank.html' }); await sleep(400);
// 预置一张自定义图标图（1×1 gif）——页面加载期 restoreAppIcons 会把它渲染成 <img>
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
await ev("(function(){try{localStorage.setItem('xy-home-v2:default:app-icon-chat','" + GIF + "');}catch(e){return 'ERR:'+e.message;}return 'ok';})()");
const dismiss = async () => {
  await ev("(function(){var sp=document.getElementById('splash');if(sp){sp.classList.add('hide');sp.hidden=true;}var m=document.getElementById('modal-mask');if(m){m.hidden=true;m.style.display='none';}return true;})()");
  await sleep(300);
};
await cdp('Page.navigate', { url: base + '/test.html' }); await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady') === true) break; await sleep(300); }
await dismiss();

chk('A0 预置的自定义图标图片已渲染成 <img>', await ev("!!document.querySelector('.app[data-app=\"chat\"] .app-ico img')") === true);

// ---- A. 边看边调里的「图标」分区 ----
await ev("(function(){var r=document.getElementById('row-appearance');if(r)r.click();return true;})()");
await sleep(400);
await ev("(function(){var b=document.getElementById('dq-drawer');if(b)b.click();return true;})()");
await sleep(700);
const mA = await ev(`(function(){
  var d=document.getElementById('beauty-drawer'); if(!d) return JSON.stringify({miss:'no-drawer'});
  var chips=[], btns=[];
  Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){ btns.push(b.textContent); });
  chips = btns.filter(function(t){return t==='颜色'||t==='尺寸'||t==='背景'||t==='图标';});
  return JSON.stringify({ chips:chips, hasBatch: btns.some(function(t){return t.indexOf('批量上传桌面图标图片')>=0;}),
    hasFit: btns.some(function(t){return t.indexOf('调整图标图片位置')>=0;}) });
})()`);
const oA = JSON.parse(String(mA));
chk('A1 抽屉新增「图标」分区胶囊（4 个分区）', oA.chips && oA.chips.length === 4 && oA.chips.indexOf('图标') >= 0, mA);
// 切到「图标」分区
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent==='图标')b.click();});return true;})()");
await sleep(400);
const mA2 = await ev(`(function(){
  var d=document.getElementById('beauty-drawer'); var t=d.textContent||'';
  return JSON.stringify({ hasBatch:/批量上传桌面图标图片/.test(t), hasFit:/调整图标图片位置/.test(t),
    hasHint:/不用重新上传/.test(t) });
})()`);
const oA2 = JSON.parse(String(mA2));
chk('A2「图标」分区含批量上传桌面图标图片 + 调整图标图片位置（带说明）', oA2.hasBatch === true && oA2.hasFit === true && oA2.hasHint === true, mA2);

// ---- B. 抽屉 → 批量上传：复用设置页 #row-icon-batch 链路 ----
await ev("(function(){window.__batchHit=0;var r=document.getElementById('row-icon-batch');if(r)r.addEventListener('click',function(){window.__batchHit++;});return true;})()");
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent.indexOf('批量上传桌面图标图片')>=0)b.click();});return true;})()");
await sleep(500);
const mB = await ev("(function(){var d=document.getElementById('beauty-drawer');return JSON.stringify({hits:window.__batchHit, drawerHidden:getComputedStyle(d).display==='none'});})()");
const oB = JSON.parse(String(mB));
chk('B1 抽屉的批量上传按钮 → 抽屉收起且命中设置页行（不重复实现）', oB.hits === 1 && oB.drawerHidden === true, mB);

// ---- B2. 抽屉 → 调整图片位置 → 点图标即开面板 ----
await ev("(function(){var b=document.getElementById('dq-drawer');if(b)b.click();return true;})()");
await sleep(500);
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent==='图标')b.click();});return true;})()");
await sleep(300);
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent.indexOf('调整图标图片位置')>=0)b.click();});return true;})()");
await sleep(500);
const mB2 = await ev(`(function(){
  var d=document.getElementById('beauty-drawer'); var p=document.getElementById('page-phone');
  var gs=document.querySelectorAll('.app-grid.editing');
  return JSON.stringify({ drawerHidden:getComputedStyle(d).display==='none', phoneVisible:!p.hidden,
    decor:p.classList.contains('decor-on'), editing:gs.length, pick:!!window.__iconAdjustPick });
})()`);
const oB2 = JSON.parse(String(mB2));
chk('B2 抽屉 → 调整图片位置：进装修模式并等待点图标', oB2.drawerHidden === true && oB2.phoneVisible === true && oB2.decor === true && oB2.editing >= 3 && oB2.pick === true, mB2);
await ev("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
await sleep(600);
const mB3 = await ev(`(function(){
  var p=document.getElementById('icon-fit-panel');
  return JSON.stringify({ open:!!p && getComputedStyle(p).display!=='none', title:p?p.textContent.slice(0,24):'',
    sliders:p?p.querySelectorAll('input[type=range]').length:0, pickConsumed:!window.__iconAdjustPick,
    bottomPinned: p? Math.abs(p.getBoundingClientRect().bottom-window.innerHeight)<=2 : false });
})()`);
const oB3 = JSON.parse(String(mB3));
chk('B3 点图标 → 打开位置面板（贴底、三根滑杆、标记已消费）', oB3.open === true && oB3.sliders === 3 && oB3.pickConsumed === true && oB3.bottomPinned === true, mB3);
chk('B4 面板标题带上图标名（聊天）', /聊天/.test(String(oB3.title)), mB3);

// ---- C. 滑杆即时生效 + 落库 ----
const setSlider = (label, val) => ev(`(function(){
  var p=document.getElementById('icon-fit-panel'); if(!p) return 'no-panel';
  var rows=p.querySelectorAll('div');
  for(var i=0;i<rows.length;i++){
    var lb=rows[i].firstChild;
    if(lb&&lb.textContent==='${label}'){ var inp=rows[i].querySelector('input[type=range]');
      if(inp){ inp.value='${val}'; inp.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; } }
  }
  return 'no-row';
})()`);
const imgState = () => ev(`(function(){
  var ico=document.querySelector('.app[data-app="chat"] .app-ico'); var img=ico?ico.querySelector('img'):null;
  return JSON.stringify({ transform: img?img.style.transform:'', objectPosition: img?img.style.objectPosition:'',
    overflow: ico?ico.style.overflow:'', z:localStorage.getItem('xy-home-v2:default:app-icon-zoom-chat'),
    x:localStorage.getItem('xy-home-v2:default:app-icon-pos-x-chat'),
    y:localStorage.getItem('xy-home-v2:default:app-icon-pos-y-chat') });
})()`);
chk('C0 面板滑杆可定位（缩放）', (await setSlider('缩放', 150)) === 'ok');
await sleep(250);
const c1 = JSON.parse(String(await imgState()));
chk('C1 缩放 150% 即时生效（transform scale + 图标裁边）', /scale\(1\.5\)/.test(c1.transform) && c1.overflow === 'hidden', JSON.stringify(c1));
chk('C2 缩放落库 app-icon-zoom-chat=150', c1.z === '150', JSON.stringify(c1));
chk('C3 未改位置时 translate 为 0', /translate\(0%?/.test(String(c1.transform)), String(c1.transform));
await setSlider('水平位置', 75);
await setSlider('垂直位置', 25);
await sleep(250);
const c4 = JSON.parse(String(await imgState()));
const tx = (String(c4.transform).match(/translate\((-?[\d.]+)%/) || [])[1];
const ty = (String(c4.transform).match(/, (-?[\d.]+)%\)/) || [])[1];
chk('C4 放大后位移走 translate，方向与壁纸定位同口径（值大＝看更靠右/靠下的一段→图片反向平移）', parseFloat(tx) < 0 && parseFloat(ty) > 0, c4.transform);
chk('C5 位置落库 pos-x=75 / pos-y=25', c4.x === '75' && c4.y === '25', JSON.stringify(c4));
// 重置 → 不放大只调位置：走 object-position 分支
await ev("(function(){var p=document.getElementById('icon-fit-panel');Array.prototype.forEach.call(p.querySelectorAll('button'),function(bb){if(bb.textContent==='重置为默认')bb.click();});return true;})()");
await sleep(300);
const r0 = JSON.parse(String(await imgState()));
chk('C6 重置为默认：三个键清空 + 内联样式复原', r0.z === null && r0.x === null && r0.y === null && r0.transform === '' && r0.objectPosition === '' && r0.overflow === '', JSON.stringify(r0));
await setSlider('水平位置', 70);
await sleep(250);
const c7 = JSON.parse(String(await imgState()));
chk('C7 未放大时位移走 object-position（70% 50%）', c7.objectPosition === '70% 50%' && c7.transform === '' && c7.x === '70', JSON.stringify(c7));

// ---- D. 装修模式图标菜单入口 ----
await ev("(function(){var p=document.getElementById('icon-fit-panel');if(p)p.style.display='none';window.__iconFitPanelOpen=false;return true;})()");
await sleep(300);
await ev("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
await sleep(500);
const mD = await ev(`(function(){
  var k=document.getElementById('modal-mask'); var t=document.getElementById('modal-title');
  return JSON.stringify({ open:k?!k.hidden:false, title:t?t.textContent:'', hasFitPill:/调整图片位置/.test(document.body.textContent||'') });
})()`);
const oD = JSON.parse(String(mD));
chk('D1 装修模式点图标：菜单里出现「调整图片位置」', oD.open === true && oD.title === '图标设置' && oD.hasFitPill === true, mD);
const pillHit = await ev(`(function(){
  var hit=false;
  Array.prototype.forEach.call(document.querySelectorAll('#modal-pills button'), function(b){
    if(!hit && (b.textContent||'').indexOf('调整图片位置')>=0){ b.click(); hit=true; }
  });
  return hit;
})()`);
await sleep(200);
// 图标菜单的胶囊是「选中 + 确定」口径（与更换图片/透明度等同款），按真实操作补一次确定
await ev("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(600);
const mD2 = await ev("(function(){var p=document.getElementById('icon-fit-panel');return JSON.stringify({open:!!p&&getComputedStyle(p).display!=='none',pillHit:" + JSON.stringify(pillHit) + "});})()");
chk('D2 点菜单项 + 确定 → 同一套位置面板打开', JSON.parse(String(mD2)).open === true, mD2);
await ev("(function(){var p=document.getElementById('icon-fit-panel');Array.prototype.forEach.call(p.querySelectorAll('button'),function(bb){if(bb.textContent==='\\u2715')bb.click();});return true;})()");
await sleep(300);

// ---- E. 设置页行入口 + 刷新持久化 ----
const mE = await ev("(function(){var r=document.getElementById('row-icon-fit');return JSON.stringify({exists:!!r, sub:r?(r.querySelector('.sub')||{}).textContent:''});})()");
const oE = JSON.parse(String(mE));
chk('E1 设置页新增「调整图标图片位置」行', oE.exists === true && /即时生效/.test(String(oE.sub)), mE);
// 写一组设置 → 刷新 → 应还原（不依赖任何会话内状态）
await ev("(function(){try{localStorage.setItem('xy-home-v2:default:app-icon-zoom-chat','160');localStorage.setItem('xy-home-v2:default:app-icon-pos-x-chat','80');}catch(e){}return true;})()");
await cdp('Page.navigate', { url: base + '/test.html' }); await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady') === true) break; await sleep(300); }
await dismiss();
const mF = JSON.parse(String(await imgState()));
chk('E2 刷新后位置设置仍在（从存储恢复，不依赖会话状态）', /scale\(1\.6\)/.test(mF.transform) && mF.overflow === 'hidden', JSON.stringify(mF));
const mE2 = await ev("(function(){var r=document.getElementById('row-icon-fit');if(!r)return 'no-row';r.click();return JSON.stringify({pick:!!window.__iconAdjustPick,decor:document.getElementById('page-phone').classList.contains('decor-on')});})()");
await sleep(400);
const oE2 = (typeof mE2 === 'string' && mE2.charAt(0) === '{') ? JSON.parse(mE2) : {};
chk('E3 设置页行点击 → 进装修模式并等待点图标', oE2.pick === true && oE2.decor === true, mE2);
chk('E4 全程零未捕获异常', (await ev("JSON.stringify(window.__jsErrors||[])")).length <= 2, await ev("JSON.stringify((window.__jsErrors||[]).slice(-3))"));

// ---- F. #696 装修模式「点桌面图标上传图片」失效（用户直派） ----
// 根因：__iconAdjustPick 悬空——点到的图标没有自定义图片时 openIconFitPanel 早退、标记没消费，
// 之后每次点图标都被劫持（有图弹位置面板 / 无图只弹提示），图标菜单再也不出现、整会话不自愈。
// 状态起点＝E3（row-icon-fit 已点，pick=true、decor-on）。断言前先把残留弹窗/标题清干净，
// 否则「标题仍是图标设置」会把空点击误判成通过。
const noImgKey = await ev(`(function(){
  var apps=document.querySelectorAll('.app[data-app]');
  for(var i=0;i<apps.length;i++){ if(!apps[i].querySelector('.app-ico img')) return apps[i].dataset.app; }
  return '';
})()`);
const clearOverlays = async () => {
  await ev("(function(){var k=document.getElementById('modal-mask');if(k)k.hidden=true;var t=document.getElementById('modal-title');if(t)t.textContent='';var p=document.getElementById('icon-fit-panel');if(p)p.style.display='none';window.__iconFitPanelOpen=false;return true;})()");
  await sleep(250);
};
// 点图标并拿到图标菜单状态。⚠️ 数据备份提醒等**定时弹窗**会随机插进来抢走这一次点击
//（实测踩到：标题变成「数据备份提醒」）——先关掉再点，若标题不是「图标设置」就关掉重点一次。
const clickIconForMenu = async (key) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await clearOverlays();
    await ev(`(function(){var a=document.querySelector('.app[data-app="${key}"]');if(a)a.click();return true;})()`);
    await sleep(550);
    const st = JSON.parse(String(await modalState()));
    // 只对「被别的弹窗抢走」重试。⚠️ 「没弹窗」/「弹的是位置面板」都是**被测行为本身**、
    // 必须原样返回——早先写成「非图标菜单就重来」时，第二次点击会把悬空标记顺手消费掉，
    // 于是 RED 基线从 4 红缩到 2 红（判别力被重试逻辑吃掉，实测踩到）。
    if (st.modalOpen && st.title !== '图标设置') continue;
    return st;
  }
  return JSON.parse(String(await modalState()));
};
const modalState = () => ev(`(function(){var k=document.getElementById('modal-mask');var t=document.getElementById('modal-title');
  var p=document.getElementById('icon-fit-panel');
  return JSON.stringify({ pick:!!window.__iconAdjustPick, modalOpen:k?!k.hidden:false, title:t?t.textContent:'',
    fitOpen:!!p&&getComputedStyle(p).display!=='none',
    pills:(function(){var o=[];Array.prototype.forEach.call(document.querySelectorAll('#modal-pills button'),function(bb){o.push(bb.textContent);});return o;})() });})()`);
chk('F0 找得到一个「没有自定义图片」的桌面图标（下面几条都拿它验证）', typeof noImgKey === 'string' && noImgKey.length > 0, noImgKey);
await clearOverlays();

// F1~F2：边看边调抽屉补「上传单个图标图片」入口（用户原话「边看边调功能不能上传单个图标的图片」）
await ev("(function(){var r=document.getElementById('row-appearance');if(r)r.click();return true;})()");
await sleep(400);
await ev("(function(){var b=document.getElementById('dq-drawer');if(b)b.click();return true;})()");
await sleep(600);
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent==='图标')b.click();});return true;})()");
await sleep(300);
const mF1 = await ev("(function(){var d=document.getElementById('beauty-drawer');var t=d.textContent||'';return JSON.stringify({hasOne:/上传单个图标图片/.test(t),hasBatch:/批量上传桌面图标图片/.test(t)});})()");
const oF1 = JSON.parse(String(mF1));
chk('F1 「图标」分区有「上传单个图标图片（点图标）」入口（＋原批量入口仍在）', oF1.hasOne === true && oF1.hasBatch === true, mF1);
await ev("(function(){var d=document.getElementById('beauty-drawer');Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){if(b.textContent.indexOf('上传单个图标图片')>=0)b.click();});return true;})()");
await sleep(500);
const mF2 = await ev("(function(){var d=document.getElementById('beauty-drawer');var p=document.getElementById('page-phone');return JSON.stringify({drawerHidden:getComputedStyle(d).display==='none',decor:p.classList.contains('decor-on'),pick:!!window.__iconAdjustPick});})()");
const oF2 = JSON.parse(String(mF2));
chk('F2 点它 → 抽屉收起、进装修模式、不带位置标记（点图标弹的是图标菜单）', oF2.drawerHidden === true && oF2.decor === true && oF2.pick === false, mF2);

// F3~F4：装修模式点「没有自定义图」的图标 → 图标菜单（含上传图片）→ 真能弹出文件选择器
const oF3 = await clickIconForMenu(noImgKey);
const mF3 = JSON.stringify(oF3);
chk('F3 点无自定义图的图标 → 弹图标菜单（含「上传图片」），不是位置面板', oF3.modalOpen === true && oF3.title === '图标设置' && oF3.fitOpen === false && oF3.pills.indexOf('上传图片') >= 0, mF3);
// ⚠️ 断言口径：template 里**本来就有**三个静态 <input type=file>（#modal-file-input / feed 两个），
// 所以「document 里存在 input[type=file]」恒为真、毫无判别力（本批初版就写成这样，已改）。
// 改为拦 HTMLInputElement.prototype.click，记下每次文件框点击的 accept / id / 内联样式，
// 再断言「点到的是一个动态创建（无 id、left:-9999px 离屏）且 accept=image/* 的输入框」。
await ev(`(function(){
  window.__filePicks = [];
  if (!window.__filePickHooked) {
    window.__filePickHooked = 1;
    var orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      try { if (this.type === 'file') window.__filePicks.push({ accept: this.accept || '', id: this.id || '', style: this.getAttribute('style') || '' }); } catch (e) {}
      try { return orig.apply(this, arguments); } catch (e) { return undefined; }
    };
  }
  return true;
})()`);
await ev("(function(){Array.prototype.forEach.call(document.querySelectorAll('#modal-pills button'),function(b){if((b.textContent||'')==='上传图片')b.click();});return true;})()");
await sleep(200);
await ev("(function(){var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(400);
const mF4 = await ev(`(function(){
  var picks = window.__filePicks || [];
  var dyn = picks.filter(function(p){ return /image\\//.test(p.accept) && p.id === '' && /-9999px/.test(p.style); });
  return JSON.stringify({ picks: picks.length, dynPicks: dyn.length, sample: picks.slice(-2) });
})()`);
chk('F4 选「上传图片」+确定 → 真的拉起了文件选择器（拦截到的动态 image/* 离屏输入框点击）', JSON.parse(String(mF4)).dynPicks >= 1, mF4);
await ev("(function(){var p=document.querySelectorAll('input[type=file]');Array.prototype.forEach.call(p,function(i){if(!i.id)i.remove();});return true;})()");

// F5：悬空标记回归——调整位置模式下点到无图图标，标记必须当场消费，后续点图标仍出菜单
await clearOverlays();
await ev("(function(){var r=document.getElementById('row-icon-fit');if(r)r.click();return true;})()");
await sleep(400);
const oF5 = await clickIconForMenu(noImgKey);
const mF5 = JSON.stringify(oF5);
chk('F5a 调整位置模式点到无图图标：退回图标菜单（modalOpen+标题）且标记已消费', oF5.modalOpen === true && oF5.title === '图标设置' && oF5.pick === false, mF5);
const oF5b = await clickIconForMenu('chat');
const mF5b = JSON.stringify(oF5b);
chk('F5b 紧接着点有自定义图的图标 → 仍是图标菜单（若标记悬空这里会变成位置面板＝用户报的「点图标上传图片失效」）', oF5b.modalOpen === true && oF5b.title === '图标设置' && oF5b.fitOpen === false, mF5b);
await clearOverlays();

// F6：点了「调整图片位置」却没点图标就退出装修 → 挂起状态与位置面板都要收掉，下次进装修点图标照常出菜单
await ev("(function(){var r=document.getElementById('row-icon-fit');if(r)r.click();return true;})()");
await sleep(400);
await ev("(function(){var d=document.getElementById('decor-done');if(d)d.click();return true;})()");
await sleep(400);
const mF6 = await ev("(function(){var p=document.getElementById('icon-fit-panel');return JSON.stringify({pick:!!window.__iconAdjustPick,panelOpen:!!p&&getComputedStyle(p).display!=='none',decor:document.getElementById('page-phone').classList.contains('decor-on')});})()");
const oF6 = JSON.parse(String(mF6));
chk('F6 退出装修收掉挂起标记 / 位置面板 / decor-on', oF6.pick === false && oF6.panelOpen === false && oF6.decor === false, mF6);
await ev("(function(){var r=document.getElementById('row-custom-icon');if(r)r.click();return true;})()");
await sleep(500);
const oF7 = await clickIconForMenu('chat');
const mF7 = JSON.stringify(oF7);
chk('F7 重新进装修点图标 → 照常弹图标菜单（「点桌面图标上传图片」没有失效）', oF7.modalOpen === true && oF7.title === '图标设置' && oF7.fitOpen === false, mF7);
chk('F8 全程零未捕获异常（含 F 段）', (await ev("JSON.stringify(window.__jsErrors||[])")).length <= 2, await ev("JSON.stringify((window.__jsErrors||[]).slice(-3))"));

ch.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} server.close();
const f = results.filter(x => !x).length;
console.log(f ? ('FAILED ' + f + '/' + results.length) : ('ALL PASS ' + results.length + '/' + results.length));
process.exit(f ? 1 : 0);
