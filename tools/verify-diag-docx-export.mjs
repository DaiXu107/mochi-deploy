// ===== 回归脚本：屏幕适配诊断报告「导出docx」点了毫无反应（#382，v3.26.x 修复） =====
// 用法：node build.mjs && node tools/verify-diag-docx-export.mjs
// 背景（用户反馈：iQOO neo10pro Chrome 报障，明说其他设备型号也有）：#333 把诊断导出统一进
//   diagExportDocx（三级降级链）时，主诊断闭包里的函数被「屏幕适配诊断」闭包（#209/#176 域）
//   直接引用——跨 IIFE 不可见，点【导出docx】恒抛 ReferenceError 且被 openModal 按钮的
//   try/catch 吞掉＝毫无反应（无分享面板/无确认弹窗/无下载，全机型必现与设备无关）；
//   同调用还把 4 参（文案串+sdToast）传给 3 形参（failToast），legacy 分支必抛
//   「failToast is not a function」二次静默失败。
// 修复：device.js 挂 window.mochiDiagExportDocx 供跨闭包调用 + 形参收窄（failMsg, toastFn）。
// 验证（无头 Chrome 真实 UI 链路）：修复前 B2 红（mochiExportBlob 不被调、ReferenceError）；
//   修复后全绿——导出链走到三级降级、确认弹窗出现、确认后触发 a[download]、legacy 兜底回调正常。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    if (!p.startsWith(root)) p = join(root, 'index.html');
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9780 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-docxexport-' + Date.now()),
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
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

async function openScreenDiag() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 20; i++) {
    const ok = await evalJs(`!!document.getElementById('row-screen-diag') && document.readyState === 'complete'`);
    if (ok) break;
    await sleep(400);
  }
  // 开屏可能覆盖（本地 file/http 下 version.json 可达会自动退；兜底点「进入」按钮/直接隐藏）
  await evalJs(`(function(){ const b = document.getElementById('splash-enter') || document.querySelector('#splash button'); if (b) b.click(); const sp = document.getElementById('splash'); if (sp && !sp.hidden && getComputedStyle(sp).display !== 'none' && !document.querySelector('.phone')) sp.style.display='none'; return true; })()`);
  await sleep(300);
  const opened = await evalJs(`(function(){
    const row = document.getElementById('row-screen-diag');
    if (!row) return false;
    row.click();
    return true;
  })()`);
  // 屏幕适配诊断采集 ~60ms+，弹窗异步出现
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const st = await evalJs(`(function(){
      const mask = document.getElementById('modal-mask');
      const exp = document.getElementById('modal-export');
      return { open: !!mask && !mask.hidden, title: document.getElementById('modal-title') ? document.getElementById('modal-title').textContent : '', expVisible: !!exp && !exp.hidden };
    })()`);
    if (st && st.open && st.expVisible) return { opened, st };
  }
  return { opened, st: null };
}

console.log('[屏幕适配诊断 docx 导出 · 无头 360x640 触摸仿真]');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });

// B1 弹窗与按钮可达
const r1 = await openScreenDiag();
check('B1 屏幕适配诊断弹窗打开且【导出docx】按钮可见', r1.opened === true && !!r1.st, r1.st ? JSON.stringify(r1.st) : 'null');

// 挂探针：记录 mochiExportBlob 调用与 a[download] 触发
await evalJs(`(function(){
  window.__exp = { blob: 0, aclick: '', rej: [] };
  if (typeof window.mochiExportBlob === 'function') {
    const orig = window.mochiExportBlob;
    window.mochiExportBlob = function (blob, fname) {
      window.__exp.blob++;
      window.__exp.fname = fname;
      window.__exp.size = blob && blob.size;
      return orig.apply(this, arguments);
    };
  }
  const oc = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__exp.aclick = this.download || '(no download)'; return oc.call(this); };
  window.addEventListener('unhandledrejection', function (e) { window.__exp.rej.push(String(e.reason)); });
  return true;
})()`);

await evalJs(`document.getElementById('modal-export').click()`);
await sleep(1200);
const st2 = await evalJs(`(function(){
  return {
    title: document.getElementById('modal-title').textContent,
    blob: window.__exp.blob, fname: window.__exp.fname || '', size: window.__exp.size || 0,
    rej: window.__exp.rej
  };
})()`);
check('B2 点【导出docx】走到导出链（mochiExportBlob 被调、docx 包已打包）', !!st2 && st2.blob > 0 && st2.size > 100, st2 ? JSON.stringify(st2) : 'null');
check('B3 文件名带 mochi-screen-diag- 前缀（调用方参数接通）', !!st2 && /mochi-screen-diag-.*\.docx$/.test(st2.fname || ''), st2 ? st2.fname : 'null');
check('B4 降级确认弹窗「文件已打包」出现（headless 无 share/保存框 → blocked 分支）', !!st2 && st2.title.indexOf('文件已打包') === 0, st2 ? 'title=' + st2.title : 'null');

// 点确定 → a[download] 触发
await evalJs(`(function(){ const ok = document.getElementById('modal-ok'); if (ok && !ok.hidden) ok.click(); return true; })()`);
await sleep(800);
const ac = await evalJs(`window.__exp.aclick`);
check('B5 确认后 a[download] 下载触发', !!ac && ac.indexOf('.docx') > 0, 'aclick=' + ac);

// ===== B5b~B5e：#758 壳浏览器（夸克/华为）「下载静默被丢弃」的第二条活路 =====
// 用户直派（小米 civi4pro 夸克「导出docx也无法下载」）：合成 a[download]（blob:）没有成功回调，
//   壳浏览器静默丢弃时用户彻底没辙。修复＝brokenFileShare 内核在下载触发后多给一个
//   「没开始下载？换一种方式」按钮（真实手势走系统分享面板 → 退 data: URL 直下）。
await sleep(700); // afterDownloadAttempt 里的 700ms 延迟
const b5b = await evalJs(`(function(){
  const mask = document.getElementById('modal-mask');
  const exp = document.getElementById('modal-export');
  return JSON.stringify({ open: !!mask && !mask.hidden,
    title: document.getElementById('modal-title').textContent,
    expVisible: !!exp && !exp.hidden, expLabel: exp ? exp.textContent : '' });
})()`);
let oo = null; try { oo = JSON.parse(b5b); } catch (e) {}
check('B5b 普通浏览器（非 brokenFileShare）不多这一步：下载后不弹追问弹窗',
  oo && oo.title !== '文件已保存了吗？', b5b);

// 打开追问名单环境（#815：闸门改读 env.downloadAsk＝壳家族∪能力缺口∪iOS 独立容器；夸克/华为仍在名单内）
// 后重走一遍：确认弹窗 → 确定 → 追问弹窗 + 换路按钮
await evalJs(`(function(){
  try { window.mochiDevice.env.downloadAsk = true; } catch(e){}
  return true;
})()`);
await evalJs(`(function(){ (window.mochiDiagExportDocx || function(){})( '壳浏览器换路测试正文', 'mochi-docx-alt-', '失败文案', function(){}); return true; })()`);
await sleep(900);
await evalJs(`(function(){ const ok = document.getElementById('modal-ok'); if (ok && !ok.hidden) ok.click(); return true; })()`);
await sleep(1400);
const b5c = await evalJs(`(function(){
  const mask = document.getElementById('modal-mask');
  const exp = document.getElementById('modal-export');
  return JSON.stringify({ open: !!mask && !mask.hidden,
    title: document.getElementById('modal-title').textContent,
    expVisible: !!exp && !exp.hidden, expLabel: exp ? exp.textContent : '' });
})()`);
oo = null; try { oo = JSON.parse(b5c); } catch (e) {}
check('B5c 追问名单内核（#815 downloadAsk）：下载后弹「文件已保存了吗？」并给出换路按钮',
  oo && oo.title === '文件已保存了吗？' && oo.expVisible && (oo.expLabel || '').indexOf('换一种方式') >= 0, b5c);

// 点换路按钮：分享面板可用 → 必须把 docx 作为 File 交给 navigator.share（#333 该类内核唯一可靠通道）
const b5d = await evalJs(`(function(){
  return new Promise(function (res) {
    window.__alt = { share: 0, name: '', type: '' };
    const okShare = navigator.canShare, oShare = navigator.share;
    navigator.canShare = function () { return true; };
    navigator.share = function (o) {
      window.__alt.share++;
      window.__alt.name = (o && o.files && o.files[0] && o.files[0].name) || '';
      window.__alt.type = (o && o.files && o.files[0] && o.files[0].type) || '';
      return Promise.resolve();
    };
    const exp = document.getElementById('modal-export');
    if (!exp || exp.hidden) { navigator.canShare = okShare; navigator.share = oShare; res(JSON.stringify({ err: 'no-btn' })); return; }
    exp.click();
    setTimeout(function () {
      navigator.canShare = okShare; navigator.share = oShare;
      res(JSON.stringify(window.__alt));
    }, 800);
  });
})()`);
oo = null; try { oo = JSON.parse(b5d); } catch (e) {}
check('B5d 换路按钮 → 真实手势调 navigator.share 交出 .docx File（系统分享面板）',
  oo && oo.share === 1 && /\.docx$/.test(oo.name || '') && (oo.type || '').indexOf('wordprocessingml') >= 0, b5d);

// 分享面板也不可用/被系统拒绝（夸克式「面板不弹直接拒」）→ 退 data: URL 直下（不经 blob:）
const b5e = await evalJs(`(function(){
  return new Promise(function (res) {
    const okShare = navigator.canShare, oShare = navigator.share;
    let dataHref = '';
    const oc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (String(this.href).indexOf('data:') === 0) dataHref = this.download; return oc.call(this); };
    navigator.canShare = function () { return true; };
    navigator.share = function () { return Promise.reject(new Error('NotAllowedError')); };
    (window.mochiDiagExportDocx || function(){})( 'dataURL 换路测试', 'mochi-docx-alt2-', '失败文案', function(){});
    setTimeout(function () {
      const ok = document.getElementById('modal-ok');
      if (ok && !ok.hidden) ok.click();
      setTimeout(function () {
        const exp = document.getElementById('modal-export');
        if (exp && !exp.hidden) exp.click();
        setTimeout(function () {
          navigator.canShare = okShare; navigator.share = oShare;
          HTMLAnchorElement.prototype.click = oc;
          res(JSON.stringify({ dataHref: dataHref }));
        }, 900);
      }, 1200);
    }, 700);
  });
})()`);
oo = null; try { oo = JSON.parse(b5e); } catch (e) {}
check('B5e 分享也不可用 → 退 data: URL 直下（与 blob: 不同的取数路径，壳浏览器第二条活路）',
  oo && /\.docx$/.test(oo.dataHref || ''), b5e);

// B6 legacy 兜底：mochiExportBlob 不可用时走裸下载+回调提示（形参收窄后不再抛 failToast is not a function）
const b6 = await evalJs(`(function(){
  return new Promise(function (res) {
    const keep = window.mochiExportBlob;
    delete window.mochiExportBlob;
    let clicked = '', toastMsg = '';
    const oc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicked = this.download; };
    try {
      window.mochiDiagExportDocx('测试正文', 'mochi-diag-test-', '当前内核不支持下载，请长按报告手动复制。', function (m) { toastMsg = m; });
    } catch (e) { res({ err: String(e), clicked: clicked, toastMsg: toastMsg }); return; }
    setTimeout(function () {
      window.mochiExportBlob = keep;
      HTMLAnchorElement.prototype.click = oc;
      res({ clicked: clicked, toastMsg: toastMsg });
    }, 1200);
  });
})()`);
check('B6 legacy 兜底：裸下载触发+提示回调送达（不抛 failToast TypeError；无头里下载成功故提示为成功文案，失败文案分支走 failMsg）', !!b6 && !b6.err && b6.clicked && b6.clicked.indexOf('.docx') > 0 && !!b6.toastMsg, b6 ? JSON.stringify(b6) : 'null');

// B7 主诊断弹窗（复制诊断信息）导出链不回归——同 IIFE 内调用保持可用
await evalJs(`(function(){
  window.__exp.blob = 0;
  const row = document.getElementById('row-diagnostics');
  if (row) row.click();
  return true;
})()`);
await sleep(2500);
const hasDiagExp = await evalJs(`!document.getElementById('modal-export').hidden`);
let b7ok = false;
if (hasDiagExp) {
  await evalJs(`document.getElementById('modal-export').click()`);
  await sleep(1000);
  b7ok = await evalJs(`window.__exp.blob > 0`);
}
check('B7 主诊断弹窗【导出docx】链路不回归', b7ok === true, 'blobCalled=' + b7ok);

const errs = await evalJs(`(window.__jsErrors||[]).length`);
check('B8 零 JS 报错', errs === 0, 'errs=' + errs);

chrome.kill();
server.close();
console.log('\n结果: ' + pass + ' 过 / ' + fail + ' 败');
process.exit(fail ? 1 : 0);
