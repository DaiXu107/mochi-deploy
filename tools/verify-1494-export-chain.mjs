// ===== 回归脚本（#1494）：聊天记录导出与信箱导出必须走统一三级导出链 =====
// 症状（2026-09-30 全站导入/导出普查新发现，作者拍板修）：聊天设置→聊天记录管理「导出」
//   （cs-export-msgs）与 信箱数据管理「导出」（mail-export）都在裸用 blob + a[download]，
//   绕过统一三级导出链 mochiExportFile/mochiExportBlob（①系统分享面板→②保存框→③确认后下载）
//   ——裸 a[download] 在 iPhone 主屏安装（standalone 无下载管理器）与 #758 壳浏览器家族
//   静默无反应＝「点了导出没反应/存不了文件」（#172 修聊天美化导出时的同族症状，这两处漏改）。
// 断言面：
//   S1/S2 产物源码锚（两处主路调用）——纯 HEAD 必红＝判别面；
//   B0a   页面就绪＋聊天记录夹具（chatAddIn 一条）；
//   B1    点信箱「导出」→ mochiExportFile 被调用、参数正确（app:mochi-mail）、裸 a.click 不再触发；
//   B2    点聊天记录「导出」→ mochiExportBlob 被调用、拿到 Blob（流式 parts 产物）、文件名正确；
//   B3    两处裸腿仅在统一链缺席时才用（GREEN 侧 anchor click 计数为 0）；
//   Z1    零 window 报错。
// 用法：node tools/verify-1494-export-chain.mjs（MOCHI_ROOT=目录 可指向隔离副本）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
// verify-suite:timeout=120000
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，设 CHROME_PATH'); process.exit(1); }

// ---- S 组：产物源码锚（判别面：纯 HEAD 全红） ----
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' —— ' + String(detail).slice(0, 240) : '')); }
}
{
  let cs = '', ml = '';
  try { cs = readFileSync(join(root, 'js', 'chat-settings.js'), 'utf8'); } catch (e) {}
  try { ml = readFileSync(join(root, 'js', 'mail.js'), 'utf8'); } catch (e) {}
  check('S1 聊天记录导出走统一 Blob 三级链（mochiExportBlob 主路）', cs.includes("window.mochiExportBlob(blob, '聊天记录_'"), 'js/chat-settings.js 仍只有裸 a[download]');
  check('S2 信箱导出走统一小文件三级链（mochiExportFile 主路）', ml.includes("window.mochiExportFile(json, '信箱数据_'"), 'js/mail.js 仍只有裸 a[download]');
  check('S2b 信箱裸腿保留为兜底（链路不可用时仍有活路）', ml.includes("a.download = '信箱数据_'"), '裸兜底腿被删＝统一链缺席的设备彻底无路');
}

// ---- 行为夹具 ----
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1488-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接 CDP');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const clearGates = () => ev("(function(){var ids=['qa-mask','applock-mask','modal-mask','tc-mask','call-mask'];ids.forEach(function(id){var e=document.getElementById(id);if(e&&!e.hidden)e.hidden=true;});return true;})()");
async function drainModals() {
  for (let i = 0; i < 4; i++) {
    const st = await ev("(function(){var m=document.getElementById('modal-mask');if(!m||m.hidden)return 'closed';var bs=[].slice.call(document.querySelectorAll('#modal-mask button'));for(var i=0;i<bs.length;i++){if(/稍后|以后|取消|知道了|关闭/.test(bs[i].textContent||'')){bs[i].click();return 'clicked';}}var ok=document.getElementById('modal-ok');if(ok){ok.click();return 'clicked:ok';}return 'stuck';})()");
    await sleep(300);
    if (st === 'closed') break;
  }
  await clearGates();
}
// 统一链拦截器：抓 mochiExportFile/mochiExportBlob 的入参；同时给 a.click 计数（裸腿证据）
const INSTALL = `(function(){
  window.__exp={file:null,blob:null,anchors:0};
  var of=window.mochiExportFile, ob=window.mochiExportBlob;
  window.mochiExportFile=function(json,fname,title){ window.__exp.file={json:String(json).slice(0,2000),fname:fname,title:title}; return Promise.resolve('ok'); };
  window.mochiExportBlob=function(blob,fname,title){ window.__exp.blob={isBlob:blob instanceof Blob,size:blob?blob.size:-1,fname:fname,title:title}; return Promise.resolve('ok'); };
  if(!window.__aClickPatched){ window.__aClickPatched=true; var c=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ window.__exp.anchors++; return c.apply(this,arguments); }; }
  window.__exp.anchors=0;
  return 'installed';
})()`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(700);
await ev("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return true;})()");
await sleep(500);
await clearGates(); await drainModals();
// 聊天记录夹具：页内 API 加一条消息（单条不触 same-ms 闸）
{
  const added = await ev("(function(){ try { if (window.chatAddIn) { window.chatAddIn('导出链夹具的一句话'); return 'addin'; } return 'no-api'; } catch (e) { return 'err:' + (e && e.message); } })()");
  await sleep(900);
  const n = await ev("(function(){ try { var a = window.getChatMsgs ? window.getChatMsgs() : null; return Array.isArray(a) ? a.length : -1; } catch (e) { return -2; } })()");
  check('B0a 聊天记录夹具就绪（getChatMsgs ≥1 条）', typeof n === 'number' && n >= 1, 'add=' + added + ' n=' + n);
}

console.log('--- B1 信箱「导出」走统一链 ---');
{
  await clearGates(); await drainModals();
  await ev(INSTALL);
  await ev("(function(){var b=document.getElementById('mail-export');if(b)b.click();return !!b;})()");
  await sleep(1000);
  const r = JSON.parse(await ev("(function(){return JSON.stringify(window.__exp||{});})()") || '{}');
  const f = r.file;
  let appOk = false;
  try { appOk = !!f && JSON.parse(f.json).app === 'mochi-mail'; } catch (e) {}
  check('B1 信箱导出调用 mochiExportFile（主路）', !!f, JSON.stringify({ file: !!f, blob: !!r.blob, anchors: r.anchors }));
  check('B1b 参数正确：文件名 信箱数据_*.json、json.app=mochi-mail', !!f && /^信箱数据_\d{4}-\d{2}-\d{2}\.json$/.test(f.fname || '') && appOk, f && JSON.stringify({ fname: f.fname, head: f.json.slice(0, 80) }));
  check('B1c 裸 a[download] 不再触发（anchor click=0）', r.anchors === 0, 'anchors=' + r.anchors);
}

console.log('--- B2 聊天记录「导出」走统一链 ---');
{
  await clearGates(); await drainModals();
  await ev(INSTALL);
  await ev("(function(){var b=document.getElementById('cs-export-msgs');if(b)b.click();return !!b;})()");
  await sleep(1000);
  const r = JSON.parse(await ev("(function(){return JSON.stringify(window.__exp||{});})()") || '{}');
  const b = r.blob;
  check('B2 聊天记录导出调用 mochiExportBlob（主路）', !!b, JSON.stringify({ file: !!r.file, blob: !!b, anchors: r.anchors }));
  check('B2b 拿到的是流式 Blob 且非空、文件名 聊天记录_*.json', !!b && b.isBlob === true && b.size > 2 && /^聊天记录_\d{4}-\d{2}-\d{2}\.json$/.test(b.fname || ''), b && JSON.stringify({ isBlob: b.isBlob, size: b.size, fname: b.fname }));
  check('B2c 裸 a[download] 不再触发（anchor click=0）', r.anchors === 0, 'anchors=' + r.anchors);
}

console.log('--- Z 零异常 ---');
{
  const errs = await ev('(window.__jsErrors || []).slice(0, 6)');
  check('Z1 零 window 报错', !errs || errs.length === 0, errs && errs.length ? JSON.stringify(errs).slice(0, 240) : '');
}

console.log('\n===== ' + pass + ' 过 / ' + fail + ' 挂（#1494 导出链统一，产物：' + root + '）=====');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
