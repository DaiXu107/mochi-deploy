// ===== 回归脚本：#815 导出下载追问名单「按内核点名」改「结构性判定」（#758 同族第三波复发熔断） =====
// 用法：node build.mjs && node tools/verify-download-ask.mjs
// 背景：#758 的「文件已保存了吗？」追问只认 env.brokenFileShare（夸克/华为），而 #603 已实证
//   小米 MIUI 自带浏览器同样静默丢 blob: 下载——按内核点名追问永远追不完（用户原话
//   「其他设备型号也有」）。#815 改 device.js env.downloadAsk 三类并集：
//   ①壳家族 UA（夸克/华为/小米/VIVO/OPPO/QQ/UC/百度/搜狗/微信…）②安卓能力缺口兜底
//   （不能分享文件又没有系统保存框＝裸 blob: 下载是唯一路，未来新壳免改名单）
//   ③iOS 主屏独立容器（navigator.standalone，#172 结论 a[download] 静默无反应）。
//   名单外（桌面 Chrome/Edge/三星/Firefox、iOS 浏览器内）零噪音不加步骤。
// 验证（无头 Chrome 真实导出链，Emulation.setUserAgentOverride 切内核）：
//   B1 桌面 Chrome 默认 UA＝名单外：下载后不弹追问（噪音守卫）
//   B2 MIUI UA（#603 同款）＝壳家族：下载后 ~700ms 弹「文件已保存了吗？」+「换一种方式」按钮
//   B3 B2 状态点「换一种方式」：把 .docx 作为 File 交给 navigator.share（#758b 唯一可靠通道不回退）
//   B4 未知安卓壳（Pixel Chrome UA＋强制无分享文件能力/无保存框）＝能力缺口兜底：照样弹追问
//   B5 Firefox Android（下载可靠显式排除）：不弹追问
//   B6 iPhone Safari 浏览器内（非独立容器）：不弹追问；主屏独立容器（standalone）：弹追问
//   S 段静态锚（直接读 src，不依赖产物）
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
check('S1 壳家族 UA 名单在位（device.js env.downloadAsk；收窄＝已实证的壳回到无补救状态）',
  devSrc.includes("if (/huaweibrowser|quark|miuibrowser|vivobrowser|heytapbrowser|opbrowser|mqqbrowser|qqbrowser|ucbrowser|baiduboxapp|baidubrowser|sogoumobilebrowser|micromessenger|microapp|obabrowser|dingtalk/i.test(_envUa)) return true;"));
check('S2 安卓能力缺口兜底在位（删掉＝未来新壳无覆盖）',
  devSrc.includes("return !(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }));"));
check('S3 iOS 独立容器分支在位（navigator.standalone）',
  devSrc.includes("navigator.standalone === true"));
check('S4 闸门接线（data-backup afterDownloadAttempt 读 downloadAskEnv）',
  bakSrc.includes('if (!downloadAskEnv()) return;'));
check('S5 downloadAskEnv 读 env.downloadAsk（断开＝名单失效）',
  bakSrc.includes('return !!((window.mochiDevice || {}).env || {}).downloadAsk;'));
check('S6 旧 brokenFileShareEnv 已退役（残留＝死代码且哨兵口径混乱）',
  !bakSrc.includes('brokenFileShareEnv'));

const UA_MIUI = 'Mozilla/5.0 (Linux; Android 16; 24129PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) XiaoMi/MiuiBrowser/20.27.1010901 Mobile Safari/537.36';
const UA_PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_FX = 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

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
const cdpPort = 9780 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dlask-' + Date.now()),
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
// 按导航 hash 注入测试前置（不污染无关导航）：#nocap＝无分享文件能力+无保存框；#iossa＝iOS 独立容器
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
  var h = location.hash || '';
  if (h.indexOf('nocap') >= 0) { try { window.showSaveFilePicker = undefined; } catch(e){} try { navigator.canShare = function(){ return false; }; } catch(e){} }
  if (h.indexOf('iossa') >= 0) { try { navigator.standalone = true; } catch(e){} }
})()` });

async function setUA(ua) { await cdp('Emulation.setUserAgentOverride', { userAgent: ua }); }

// 走一遍屏幕适配诊断的导出链：开页→退开屏→开诊断弹窗→点【导出docx】→点确认→看追问弹窗
async function exportFlow(tag) {
  // 先跳 about:blank 强制换文档——只改 hash 的导航是同文档导航，页面会停在上一轮导出后的状态
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (tag || '') });
  await sleep(3500);
  for (let i = 0; i < 20; i++) {
    const ok = await evalJs(`!!document.getElementById('row-screen-diag') && document.readyState === 'complete'`);
    if (ok) break;
    await sleep(400);
  }
  await evalJs(`(function(){ const b = document.getElementById('splash-enter') || document.querySelector('#splash button'); if (b) b.click(); const sp = document.getElementById('splash'); if (sp && !sp.hidden && getComputedStyle(sp).display !== 'none' && !document.querySelector('.phone')) sp.style.display='none'; return true; })()`);
  await sleep(300);
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
  if (!packed || packed.indexOf('文件已打包') !== 0) return { opened: true, packed: packed || '', stage: 'packed-mismatch' };
  await evalJs(`(function(){ const ok = document.getElementById('modal-ok'); if (ok && !ok.hidden) ok.click(); return true; })()`);
  await sleep(1400); // afterDownloadAttempt 里的 700ms 延迟 + 弹窗渲染
  const after = await evalJs(`(function(){
    const mask = document.getElementById('modal-mask');
    const exp = document.getElementById('modal-export');
    return JSON.stringify({ title: document.getElementById('modal-title') ? document.getElementById('modal-title').textContent : '',
      expVisible: !!exp && !exp.hidden, expLabel: exp ? exp.textContent : '' });
  })()`);
  let o = null; try { o = JSON.parse(after); } catch (e) {}
  return { opened: true, packed, after: o };
}

console.log('[导出下载追问名单 · 无头 360x640 · UA 仿真切内核]');

// B1 桌面 Chrome 默认 UA：名单外 → 不弹追问（噪音守卫）
{
  const r = await exportFlow('');
  check('B1 前置：桌面 Chrome 走完确认下载链', !!r.opened && typeof r.packed === 'string' && r.packed.indexOf('文件已打包') === 0, JSON.stringify(r).slice(0, 200));
  check('B1 桌面 Chrome（名单外）下载后不弹追问弹窗（零噪音）',
    r.after && r.after.title !== '文件已保存了吗？', (JSON.stringify(r.after) || 'undefined').slice(0, 200));
}

// B2/B3 MIUI（#603 同款）：壳家族 → 弹追问 + 换路按钮交给分享面板
{
  await setUA(UA_MIUI);
  const r = await exportFlow('');
  check('B2 前置：MIUI UA 下 env.downloadAsk 生效',
    await evalJs(`!!((window.mochiDevice || {}).env || {}).downloadAsk`) === true);
  check('B2 MIUI 浏览器（#603 实证静默丢下载）下载后弹「文件已保存了吗？」',
    r.after && r.after.title === '文件已保存了吗？', (JSON.stringify(r.after) || 'undefined').slice(0, 200));
  check('B2 追问弹窗带「换一种方式」按钮', r.after && r.after.expVisible && (r.after.expLabel || '').indexOf('换一种方式') >= 0, (JSON.stringify(r.after) || 'undefined').slice(0, 200));
  // B3 点换路：分享面板可用 → .docx 作为 File 交给 navigator.share
  const b3 = await evalJs(`(function(){
    return new Promise(function (res) {
      window.__b3 = { share: 0, name: '', type: '' };
      navigator.canShare = function () { return true; };
      navigator.share = function (o) {
        window.__b3.share++;
        window.__b3.name = (o && o.files && o.files[0] && o.files[0].name) || '';
        window.__b3.type = (o && o.files && o.files[0] && o.files[0].type) || '';
        return Promise.resolve();
      };
      const exp = document.getElementById('modal-export');
      if (!exp || exp.hidden) { res({ err: 'no btn' }); return; }
      exp.click();
      setTimeout(function () { res(window.__b3); }, 1200);
    });
  })()`);
  check('B3 点「换一种方式」→ .docx 以 File 交给系统分享面板（#758b 不回退）',
    b3 && b3.share > 0 && /\.docx$/.test(b3.name || '') && /wordprocessingml/.test(b3.type || ''), JSON.stringify(b3));
}

// B4 未知安卓壳（Pixel Chrome UA + 强制无分享文件能力/无保存框）＝能力缺口兜底 → 弹追问
{
  await setUA(UA_PIXEL);
  const r = await exportFlow('#nocap');
  check('B4 安卓无分享文件能力且无保存框（未来新壳长尾）下载后照样弹追问',
    r.after && r.after.title === '文件已保存了吗？', (JSON.stringify(r.after) || 'undefined').slice(0, 200));
}

// B5 Firefox Android：下载可靠显式排除 → 不弹追问
{
  await setUA(UA_FX);
  const r = await exportFlow('#nocap');
  check('B5 Firefox Android（下载可靠）不弹追问（不添噪音）',
    r.after && r.after.title !== '文件已保存了吗？', (JSON.stringify(r.after) || 'undefined').slice(0, 200));
}

// B6 iOS：浏览器内不弹；主屏独立容器弹
{
  await setUA(UA_IOS);
  const r1 = await exportFlow('');
  check('B6a iPhone 浏览器内（非独立容器）不弹追问',
    r1.after && r1.after.title !== '文件已保存了吗？', (JSON.stringify(r1.after) || 'undefined').slice(0, 200));
  const r2 = await exportFlow('#iossa');
  check('B6b iPhone 主屏独立容器（navigator.standalone）下载后弹追问',
    r2.after && r2.after.title === '文件已保存了吗？', (JSON.stringify(r2.after) || 'undefined').slice(0, 200));
}

try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
console.log(fail ? 'verify-download-ask：' + fail + ' 断言失败' : 'verify-download-ask：' + pass + '/' + (pass + fail) + ' 全过');
process.exit(fail ? 1 : 0);
