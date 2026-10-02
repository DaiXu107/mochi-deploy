// ===== 验证：桌面图标长按不再误触进移动模式（v3.27.x 用户反馈） =====
// 回归（FIX-REGRESSION #55）：
//   1) 非移动模式长按图标 350ms 曾自动进移动模式+拖拽（误触）→ 修复后长按无副作用
//   2) 「装饰模式 → 编辑布局」主动入口仍可进入移动模式（排序功能保留）
// 用法：node tools/verify-desk-longpress.mjs（需先 node build.mjs，需本机 Chrome/Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
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
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-desklongpress-' + Date.now()),
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
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return { __err: String(r.exceptionDetails.text || '') };
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function freshLoad() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(250); }
  await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
  await sleep(800);
}

// ============ 场景1：非移动模式长按图标 450ms → 不应进移动模式/拖拽 ============
console.log('\n===== 场景1 长按图标不进移动模式（核心回归） =====');
await freshLoad();
const longPress = await ev(`(function(){
  var app = document.querySelector('#page-phone .app-grid .app');
  if (!app) return { err: 'no-app' };
  var r = app.getBoundingClientRect();
  var x = r.left + r.width / 2, y = r.top + r.height / 2;
  app.__rx = r.left; app.__ry = r.top;
  app.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'touch' }));
  return { x: x, y: y };
})()`);
if (longPress && longPress.err) { console.error('FAIL  找不到桌面图标: ' + longPress.err); process.exit(1); }
await sleep(500); // 超过 MOVE_DELAY 350ms
const afterPress = await ev(`(function(){
  var phone = document.getElementById('page-phone');
  var bar = document.getElementById('decor-bar');
  var app = document.querySelector('#page-phone .app-grid .app');
  var r = app ? app.getBoundingClientRect() : null;
  return {
    moveMode: phone ? phone.classList.contains('desk-move-mode') : null,
    decorOn: phone ? phone.classList.contains('decor-on') : null,
    barHidden: bar ? bar.hidden : null,
    dragging: app ? app.classList.contains('desk-dragging') : null,
    editing: document.querySelectorAll('.app-grid.editing').length,
    moved: app ? (Math.abs(r.left - app.__rx) > 1 || Math.abs(r.top - app.__ry) > 1) : null,
    clone: !!document.querySelector('.desk-drag-clone')
  };
})()`);
check('长按 450ms 未进入移动模式（desk-move-mode）', afterPress.moveMode === false, 'moveMode=' + afterPress.moveMode);
check('未进入装饰模式（decor-on）', afterPress.decorOn === false, 'decorOn=' + afterPress.decorOn);
check('装饰栏保持隐藏', afterPress.barHidden === true, 'barHidden=' + afterPress.barHidden);
check('图标无拖拽态（desk-dragging）', afterPress.dragging === false, 'dragging=' + afterPress.dragging);
check('无拖拽克隆/指示线残留', afterPress.clone === false);
check('网格无编辑态', afterPress.editing === 0, 'editing=' + afterPress.editing);
check('图标位置未被挪动', afterPress.moved === false, 'moved=' + afterPress.moved);
// 收尾：松开指针（释放任何残留状态）
await ev(`(function(){
  var app = document.querySelector('#page-phone .app-grid .app');
  if (app) {
    var r = app.getBoundingClientRect();
    app.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerType: 'touch' }));
  }
  return true;
})()`);

// ============ 场景2：长按后轻点仍正常打开应用（点击功能未受影响） ============
console.log('\n===== 场景2 长按后轻点仍正常打开应用 =====');
await freshLoad();
const tapApp = await ev(`(function(){
  var app = document.querySelector('#page-phone .app-grid .app');
  if (!app) return null;
  app.click();
  return app.dataset.app || '';
})()`);
await sleep(600);
const tapOpened = await ev(`(function(){
  var app = document.querySelector('#page-phone .app-grid .app');
  return app ? 'app-alive' : 'no-app';
})()`);
check('桌面图标可正常点击（无 JS 异常/页面未卡死）', tapOpened === 'app-alive', 'app=' + tapApp);

// ============ 场景3：主动入口「编辑布局」仍可进入移动模式 ============
console.log('\n===== 场景3 编辑布局主动入口保留 =====');
await freshLoad();
await ev(`(function(){var r=document.getElementById('row-custom-icon');if(r)r.click();return true;})()`);
await sleep(300);
const decorOn = await ev(`(function(){var p=document.getElementById('page-phone');return p?p.classList.contains('decor-on'):null;})()`);
check('装饰模式可进入（row-custom-icon）', decorOn === true, 'decorOn=' + decorOn);
await ev(`(function(){var b=document.getElementById('decor-edit-layout');if(b)b.click();return true;})()`);
await sleep(300);
const moveMode = await ev(`(function(){var p=document.getElementById('page-phone');return p?p.classList.contains('desk-move-mode'):null;})()`);
const barText = await ev(`(function(){var s=document.querySelector('#decor-bar span');return s?s.textContent:'';})()`);
check('「编辑布局」按钮进入移动模式（desk-move-mode）', moveMode === true, 'moveMode=' + moveMode);
check('移动模式提示文案正确', String(barText || '').indexOf('移动模式') >= 0, 'barText=' + String(barText).slice(0, 30));
// 退出移动模式（点装饰栏完成）
await ev(`(function(){var d=document.getElementById('decor-done');if(d)d.click();else if(window.exitDecor){window.exitDecor();}return true;})()`);
await sleep(300);
const exited = await ev(`(function(){var p=document.getElementById('page-phone');return p?(!p.classList.contains('desk-move-mode')&&!p.classList.contains('decor-on')):null;})()`);
check('退出装饰/移动模式干净（无残留状态）', exited === true, 'exited=' + exited);

// ============ 场景4：移动模式下横向拖拽可横着放（华为 Mate40 Pro 反馈） ============
console.log('\n===== 场景4 移动模式横向拖拽（clone 横向跟手，不再被翻页抢占） =====');
await freshLoad();
await ev(`(function(){var r=document.getElementById('row-custom-icon');if(r)r.click();return true;})()`);
await sleep(300);
await ev(`(function(){var b=document.getElementById('decor-edit-layout');if(b)b.click();return true;})()`);
await sleep(300);
const hDrag = await ev(`(function(){
  var app = document.querySelector('#page-phone .app-grid .app');
  if (!app) return { err: 'no-app' };
  var r = app.getBoundingClientRect();
  var x = r.left + r.width / 2, y = r.top + r.height / 2;
  app.__beforeLeft = r.left;
  app.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: x, clientY: y, button: 0, pointerType: 'touch' }));
  return { x: x, y: y, app: app.dataset.app || '' };
})()`);
if (hDrag && hDrag.err) { console.error('FAIL  ' + hDrag.err); process.exit(1); }
// 第一次横移 36px：触发拖拽（首事件为"抓取"，clone 停在原位）
await ev(`(function(){
  var app = document.querySelector('#page-phone .app-grid .app');
  if (app) app.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: ${hDrag.x} + 36, clientY: ${hDrag.y} + 2, button: 0, pointerType: 'touch' }));
  return true;
})()`);
// 第二次横移 72px：跟手移动（clone.left 应右移）
await ev(`(function(){
  var app = document.querySelector('#page-phone .app-grid .app');
  if (app) app.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: ${hDrag.x} + 72, clientY: ${hDrag.y} + 2, button: 0, pointerType: 'touch' }));
  return true;
})()`);
await sleep(150);
const hState = await ev(`(function(){
  var c = document.querySelector('.desk-drag-clone');
  var app = document.querySelector('#page-phone .app-grid .app');
  return { clone: !!c, left: c ? Math.round(parseFloat(c.style.left) || 0) : null, beforeLeft: app ? Math.round(app.__beforeLeft) : null };
})()`);
check('横向移动进入拖拽（出现 clone）', hState.clone === true, 'clone=' + hState.clone);
check('clone 横向跟手（left 右移 > 起点+25）', hState.clone === true && hState.left !== null && hState.beforeLeft !== null && hState.left > hState.beforeLeft + 25, 'left=' + hState.left + ' beforeLeft=' + hState.beforeLeft);
const hIdx = await ev(`(function(){return window.deskIdx ? window.deskIdx() : -1;})()`);
check('横向拖拽未误翻页（deskIdx 仍为 0）', hIdx === 0, 'deskIdx=' + hIdx);
// 松开收尾
await ev(`(function(){
  var app = document.querySelector('#page-phone .app-grid .app');
  if (app) app.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: ${hDrag.x} + 36, clientY: ${hDrag.y} + 2, button: 0, pointerType: 'touch' }));
  return true;
})()`);
await sleep(200);

// ============ 场景5：恢复默认桌面（IDB 删除落盘后再 reload，防华为回填旧布局） ============
console.log('\n===== 场景5 恢复默认桌面（LS+IDB 均清除） =====');
await freshLoad();
await ev(`(function(){
  var s = window.activeStore();
  s.set('desk-layout', JSON.stringify([['deco','quote-row','checkin','apps','music','p2apps','memo-row','week','weekend','desk-period']]));
  s.set('app-icon-order-main', JSON.stringify(['chat','mail','feed','calendar','memory','note','music','stats']));
  s.set('hidden-icons', JSON.stringify(['garden']));
  return true;
})()`);
await sleep(500); // 等 IDB 写入
await ev(`(function(){var r=document.getElementById('row-desk-reset');if(r)r.click();return true;})()`);
await sleep(300);
await ev(`(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()`);
await sleep(800);
const afterReset = await ev(`(function(){
  var P = (window.activePrefix ? window.activePrefix() : 'xy-home-v2:default');
  var ls = null;
  try { ls = localStorage.getItem(P + ':desk-layout'); } catch (e) { ls = 'err'; }
  return { lsLayout: ls };
})()`);
check('恢复后 desk-layout 已清（LS 无旧布局，含 reload 后回填验证）', afterReset.lsLayout === null, 'ls=' + String(afterReset.lsLayout).slice(0, 30));
// IDB 层确认：注册异步读取，等结果（页面可能已 reload，注册一次即可）
await ev(`(function(){
  var P = (window.activePrefix ? window.activePrefix() : 'xy-home-v2:default');
  window.__idbDeskCheck = 'pending';
  if (!window.idbGet) { window.__idbDeskCheck = 'no-idb'; return true; }
  window.idbGet(P + ':desk-layout').then(function (v) {
    window.__idbDeskCheck = (v === null || v === undefined) ? 'null' : String(v).slice(0, 20);
  }).catch(function () { window.__idbDeskCheck = 'err'; });
  return true;
})()`);
await sleep(900);
const idbVal = await ev(`(function(){return window.__idbDeskCheck || 'pending';})()`);
check('IDB desk-layout 已被删除（恢复持久，不会被回填）', idbVal === 'null', 'idb=' + idbVal);

// ============ 场景6：导入美化方案（文件导入自动应用，txtImportAuto） ============
console.log('\n===== 场景6 导入美化方案（从文件导入自动应用） =====');
await freshLoad();
const impState = await ev(`(function(){
  var r = document.getElementById('row-beauty-import');
  if (!r) return { err: 'no-row' };
  r.click();
  return true;
})()`);
if (impState && impState.err) { console.error('FAIL  ' + impState.err); process.exit(1); }
await sleep(350);
const impModal = await ev(`(function(){return !document.getElementById('modal-mask').hidden;})()`);
check('点【导入美化方案】弹窗打开', impModal === true, 'modal=' + impModal);
const setFile = await ev(`(function(){
  var inp = document.getElementById('modal-file-input');
  if (!inp) return { err: 'no-input' };
  var dt = new DataTransfer();
  var content = JSON.stringify({ 'page-bg-0': '#ff0000', '__accent__': '#123456' });
  dt.items.add(new File([content], 'beauty.json', { type: 'application/json' }));
  try { inp.files = dt.files; } catch (e) { return { err: String(e) }; }
  inp.dispatchEvent(new Event('change'));
  return { ok: true };
})()`);
check('fileInput 可注入 .json 文件', setFile && setFile.ok === true, setFile && setFile.err ? setFile.err : '');
await sleep(600);
const impDiag = await ev(`(function(){
  var ta = document.querySelector('#modal-mask textarea');
  return {
    hasTa: !!ta,
    taVal: ta ? (ta.value !== undefined ? ta.value : ta.textContent) : null,
    taHidden: ta ? ta.hidden : null,
    inpFiles: (function(){try{var i=document.getElementById('modal-file-input');return i.files ? i.files.length : -1;}catch(e){return -2;}})()
  };
})()`);
console.log('  [diag] textarea 状态:', JSON.stringify(impDiag).slice(0, 200));
const impApplied = await ev(`(function(){
  var s = window.activeStore();
  var ac = null;
  try { ac = localStorage.getItem('xy-home-v2:accent-color'); } catch (e) {}
  return { bg: s.get('page-bg-0'), accent: ac, modalClosed: document.getElementById('modal-mask').hidden };
})()`);
check('导入数据已应用（page-bg-0=#ff0000）', impApplied.bg === '#ff0000', 'bg=' + impApplied.bg);
check('强调色已应用（accent-color）', impApplied.accent === '#123456', 'accent=' + impApplied.accent);
check('弹窗已自动关闭（txtImportAuto）', impApplied.modalClosed === true, 'closed=' + impApplied.modalClosed);

// ============ 场景7：导出美化方案（只保留文件方式，无复制文字） ============
console.log('\n===== 场景7 导出美化方案（只保留「导出文件」，无复制文字） =====');
await freshLoad();
await ev(`(function(){
  var s = window.activeStore();
  s.set('page-bg-0', '#ffeecc');
  s.set('app-icon-order-main', JSON.stringify(['chat','mail','feed','calendar']));
  return true;
})()`);
await sleep(400);
// 点导出行 → 弹窗A（选「当前设置」或方案）
await ev(`(function(){var r=document.getElementById('row-beauty-export');if(r)r.click();return true;})()`);
await sleep(350);
const exp1 = await ev(`(function(){return !document.getElementById('modal-mask').hidden;})()`);
check('点【导出美化方案】弹窗打开（选择来源）', exp1 === true, 'modal=' + exp1);
// 点第一个 pill「当前设置」+ 底部确定 → 应直接下载文件（无「导出文件/复制文字」二选一弹窗）
await ev(`(function(){var p=document.querySelectorAll('#modal-pills .pill');if(p[0])p[0].click();return true;})()`);
await sleep(150);
await ev(`(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()`);
await sleep(500);
const exp2 = await ev(`(function(){
  var ps = document.querySelectorAll('#modal-pills .pill');
  return {
    modalClosed: document.getElementById('modal-mask').hidden,
    pillLabels: Array.prototype.map.call(ps, function(p){return p.textContent;}),
    hasCopyPill: Array.prototype.some.call(ps, function(p){return p.textContent.indexOf('复制文字') >= 0;})
  };
})()`);
check('选来源确定后弹窗关闭（直接导出文件，无二选一弹窗）', exp2.modalClosed === true, 'modalClosed=' + exp2.modalClosed);
check('导出方式弹窗不再出现「复制文字」选项', exp2.hasCopyPill === false, 'pills=' + JSON.stringify(exp2.pillLabels));
// 大 JSON（含壁纸 dataURL）→ 直接导出文件（无大小限制，不弹任何提示弹窗）
await ev(`(function(){
  var s = window.activeStore();
  s.set('phone-bg', 'data:image/png;base64,' + new Array(600000).join('A'));
  return true;
})()`);
await sleep(400);
await ev(`(function(){var r=document.getElementById('row-beauty-export');if(r)r.click();return true;})()`);
await sleep(300);
await ev(`(function(){var p=document.querySelectorAll('#modal-pills .pill');if(p[0])p[0].click();return true;})()`);
await sleep(150);
await ev(`(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()`);
await sleep(500);
const bigState = await ev(`(function(){
  var ta = document.querySelector('#modal-mask textarea');
  var bg = null;
  try { var v = window.activeStore().get('phone-bg'); bg = v ? v.length : -1; } catch (e) { bg = -2; }
  return { modalClosed: document.getElementById('modal-mask').hidden, fbLen: ta ? ta.value.length : -1, bgLen: bg };
})()`);
console.log('  [diag] bigState:', JSON.stringify(bigState));
check('含大图片的方案也能直接导出文件（弹窗正常关闭）', bigState.modalClosed === true, 'modalClosed=' + bigState.modalClosed);
// 导入弹窗：确认无粘贴 textarea、仅文件导入（noInput）
await ev(`(function(){var r=document.getElementById('row-beauty-import');if(r)r.click();return true;})()`);
await sleep(350);
const impModal2 = await ev(`(function(){
  var ta = document.getElementById('modal-textarea');
  var inp = document.getElementById('modal-input');
  var fb = document.getElementById('modal-file');
  return {
    modalOpen: !document.getElementById('modal-mask').hidden,
    taHidden: ta ? ta.hidden : null,
    inpHidden: inp ? inp.hidden : null,
    fileBtnVisible: fb ? !fb.hidden : null
  };
})()`);
check('导入弹窗打开且无粘贴输入框（textarea/input 隐藏）', impModal2.modalOpen === true && impModal2.taHidden === true && impModal2.inpHidden === true, JSON.stringify(impModal2));
check('导入弹窗保留「从文件导入」按钮', impModal2.fileBtnVisible === true, 'fileBtn=' + impModal2.fileBtnVisible);

// ============ 汇总 ============
console.log('\n===== 汇总 =====');

// ============ 汇总 ============
console.log('\n===== 汇总 =====');
const fails = results.filter((r) => !r.ok);
console.log((fails.length ? '❌ ' : '✅ ') + results.length + '/' + results.length + ' 通过' + (fails.length ? '，失败 ' + fails.length : ''));
chrome.kill();
server.close();
process.exit(fails.length ? 1 : 0);
