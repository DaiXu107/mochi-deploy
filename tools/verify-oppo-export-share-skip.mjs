// ===== 回归脚本：#854 OPPO/HeyTap 自带浏览器导出必闪退（分享面板级故障） =====
// 用法：node tools/verify-oppo-export-share-skip.mjs（MOCHI_ROOT 可指仓外副本）
// 背景：OPPO A96 自带浏览器（HeyTapBrowser 内核）实报「任何需要导出数据的地方都无法导出，
//   还会闪退」——三级降级链第一步 navigator.share({files}) 弹系统分享面板，该内核的分享
//   面板是「进程闪退」级故障（弹一次崩一次，真用户手势也一样崩），且每个导出入口都先走
//   这一步＝每次导出都崩。#815 已把 heytapbrowser 收进 downloadAsk（下载后追问），但分享
//   面板本体没有跳过。修法（零机型分支，有实报证据才进名单）：
//   ①device.js brokenFileShare 加 heytapbrowser＝主链路跳分享面板直接「确定后下载」；
//   ②device.js 新增 shareSheetCrash 单列标志＝换路按钮（data-backup.js altSaveFile）也
//     跳过分享面板、直接 data: 直下/文字指引；夸克/华为不受影响（#758 真手势分享通道保留）。
// 验证（无头 Chrome 真实导出链，Emulation.setUserAgentOverride 切 HeyTap UA）：
//   S 段静态锚 ×3；B1 HeyTap UA 两个 env 标志生效；B2 主链路导出全程不碰 navigator.share
//   （stub canShare=true 仿真该内核「说谎的 canShare」，崩不崩由调用与否断言）且走到
//   「文件已打包」确认弹窗＝跳面板成立；B3 追问弹窗「换一种方式」后仍不碰 navigator.share
//   且触发 data: 直下（≤2MB 的诊断 docx）；B4 桌面 Chrome 噪音守卫（两标志恒 false）。
// 纯 HEAD 红基线：B1/B2/B3 红（主链路把 File 交给 stub 的 navigator.share 并 resolve 'ok'
//   ＝直接「已保存」假象，既不弹打包确认也不追问）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };

// ===== S 段：静态锚 =====
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + String(detail).slice(0, 300) : '')); }
}
const devSrc = read('src/js/device.js');
const bakSrc = read('src/js/data-backup.js');
check('S1 brokenFileShare 名单含 heytapbrowser（收窄＝OPPO 主链路回到分享面板闪退）',
  devSrc.includes('brokenFileShare: /huaweibrowser|quark|heytapbrowser/i.test(_envUa),'));
check('S2 shareSheetCrash 单列标志在位（与 brokenFileShare 语义分开，夸克/华为真手势分享不回退）',
  devSrc.includes('shareSheetCrash: /heytapbrowser/i.test(_envUa),'));
check('S3 altSaveFile 换路跳过分享面板（删＝「换一种方式」把 OPPO 用户再次带进闪退）',
  bakSrc.includes('if (!shareCrash && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {'));

const UA_OPPO = 'Mozilla/5.0 (Linux; U; Android 12; zh-CN; OPPO A96 Build/SKQ1.211006.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/107.0.5304.141 Mobile Safari/537.36 HeyTapBrowser/40.7.10.1';
const UA_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome：行为段跳过（静态段已跑）；' + pass + '/' + (pass + fail)); process.exit(fail ? 1 : 0); }
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
const cdpPort = 9880 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-oppskip-' + Date.now()),
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
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
async function setUA(ua) { await cdp('Emulation.setUserAgentOverride', { userAgent: ua }); }

// 仿真 HeyTap 的「说谎 canShare」：canShare 恒 true、share 只计数（真机上这里就是把浏览器搞崩的调用）
const STUB = `(function(){
  window.__shareCalls = 0; window.__clicks = [];
  navigator.canShare = function () { return true; };
  navigator.share = function (o) { window.__shareCalls++; return Promise.resolve(); };
  var oc = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__clicks.push(String(this.href || '').slice(0, 60)); return oc.apply(this, arguments); };
  return true;
})()`;

// 走一遍诊断 docx 导出链：开页→退开屏→开诊断弹窗→点【导出docx】→看是否弹「文件已打包」确认
async function exportFlow() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3500);
  for (let i = 0; i < 20; i++) {
    const ok = await evalJs(`!!document.getElementById('row-screen-diag') && document.readyState === 'complete'`);
    if (ok) break;
    await sleep(400);
  }
  await evalJs(`(function(){ const b = document.getElementById('splash-enter') || document.querySelector('#splash button'); if (b) b.click(); const sp = document.getElementById('splash'); if (sp && !sp.hidden && getComputedStyle(sp).display !== 'none' && !document.querySelector('.phone')) sp.style.display='none'; return true; })()`);
  await sleep(300);
  await evalJs(STUB);
  await evalJs(`(function(){ const r = document.getElementById('row-screen-diag'); if (r) r.click(); return true; })()`);
  let opened = false;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    opened = await evalJs(`(function(){ const m = document.getElementById('modal-mask'); return !!m && !m.hidden; })()`);
    if (opened) break;
  }
  if (!opened) return { opened: false, stage: 'diag-not-open' };
  await evalJs(`(function(){ const e = document.getElementById('modal-export'); if (e && !e.hidden) e.click(); return true; })()`);
  await sleep(1200);
  const packed = await evalJs(`(function(){ const t = document.getElementById('modal-title'); return t ? t.textContent : ''; })()`);
  const shareCalls = await evalJs(`window.__shareCalls`);
  return { opened: true, packed: packed || '', shareCalls: shareCalls == null ? -1 : shareCalls };
}

console.log('[OPPO/HeyTap 导出闪退 · 无头 360x640 · UA 仿真 HeyTapBrowser]');

// B1/B2/B3 HeyTapBrowser UA
{
  await setUA(UA_OPPO);
  const r = await exportFlow();
  check('B1 HeyTap UA：brokenFileShare 与 shareSheetCrash 双标志生效',
    await evalJs(`(function(){ var e = (window.mochiDevice || {}).env || {}; return !!(e.brokenFileShare && e.shareSheetCrash); })()`) === true);
  check('B2 前置：诊断 docx 导出链走通且弹「文件已打包」确认（跳过分享面板的标志＝确认弹窗）',
    r.opened && r.packed.indexOf('文件已打包') === 0, JSON.stringify(r).slice(0, 200));
  check('B2 主链路全程不碰 navigator.share（stub canShare=true 仿真 HeyTap；>0＝每次导出先弹分享面板＝闪退回归）',
    r.shareCalls === 0, 'shareCalls=' + r.shareCalls);
  // 确认下载 → HeyTap 在 downloadAsk 壳家族名单 → 700ms 后弹追问 → 点「换一种方式」
  await evalJs(`(function(){ const ok = document.getElementById('modal-ok'); if (ok && !ok.hidden) ok.click(); return true; })()`);
  await sleep(1400);
  const ask = await evalJs(`(function(){ const t = document.getElementById('modal-title'); return t ? t.textContent : ''; })()`);
  check('B3 追问弹窗弹出（heytapbrowser 在 downloadAsk 壳家族名单，#815 行为不回退）',
    ask === '文件已保存了吗？', JSON.stringify(ask).slice(0, 120));
  const b3 = await evalJs(`(function(){
    return new Promise(function (res) {
      window.__clicks = [];
      var before = window.__shareCalls;
      var exp = document.getElementById('modal-export');
      if (!exp || exp.hidden) { res({ err: 'no btn' }); return; }
      exp.click();
      setTimeout(function () { res({ before: before, after: window.__shareCalls, clicks: window.__clicks }); }, 1500);
    });
  })()`);
  check('B3 点「换一种方式」仍不碰 navigator.share（>0＝换路把用户再次带进闪退）',
    b3 && b3.after === 0, JSON.stringify(b3).slice(0, 200));
  check('B3 换路落 data: 直下（不经 blob: 与分享面板的第三条通道）',
    b3 && Array.isArray(b3.clicks) && b3.clicks.some(function (h) { return h.indexOf('data:') === 0; }), JSON.stringify(b3 && b3.clicks).slice(0, 200));
}

// B4 桌面 Chrome 噪音守卫：两标志恒 false（不添噪音、分享面板照常可用）
{
  await setUA(UA_CHROME);
  const r = await exportFlow();
  check('B4 桌面 Chrome（名单外）两标志恒 false',
    await evalJs(`(function(){ var e = (window.mochiDevice || {}).env || {}; return !e.brokenFileShare && !e.shareSheetCrash; })()`) === true);
  check('B4 桌面 Chrome（stub canShare=true）分享面板照常可用（名单外链路顺序零改动，不回退）',
    r.shareCalls === 1, JSON.stringify(r).slice(0, 200));
}

try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
console.log(fail ? 'verify-oppo-export-share-skip：' + fail + ' 断言失败' : 'verify-oppo-export-share-skip：' + pass + '/' + (pass + fail) + ' 全过');
process.exit(fail ? 1 : 0);
