// ===== 验证：装修模式下第2/3页图标可换图（独立组件图标兜底 + 选图 input 挂 DOM） =====
// 回归 v3.15.x（vivo Edge 真机反馈：装修模式点第2/3页图标弹不出换图菜单）：
//   A. 被移出 .app-grid 的单个功能图标（data-desk-widget^="app-"）在编辑态自身 handler
//      return、网格监听器又不覆盖 → 谁都不处理。修复后由 #page-phone 委托兜底开菜单。
//   B. openIconMenu.pickFile 的 <input type=file> 未挂 DOM 即 click()——部分内核不弹
//      选择器。修复后先 appendChild 到 body。
// 用法：node tools/verify-desk-icon-decor.mjs（需先 node build.mjs）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
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
  '/usr/bin/google-chromium', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 400));
const userDataDir = join(process.env.TEMP || '/tmp', 'mochi-did-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + userDataDir,
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 无头下拦截文件选择器，防 input.click() 挂起
try { await cdp('Page.setInterceptFileChooserDialog', { enabled: true }); } catch (e) {}

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, configuration: 'mobile' });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(500);
await evalJs("(function(){var c=document.getElementById('splash-confirm-ok');if(c&&!c.hidden)c.click();return true;})()");
await sleep(800);
// #129 修正：应用关开屏是加 .hide class（节点保留在 DOM，不删），确认按钮受滑到底门控时兜底强制 hide
await evalJs("(function(){var s=document.getElementById('splash');if(s)s.classList.add('hide');return true;})()");
check('开屏已关闭进入桌面', await evalJs("(function(){var s=document.getElementById('splash');return !s||s.classList.contains('hide');})()"));

// T2 构造「用户装修过」状态：把第二页花园图标移出网格，直接挂在页面上（与装修库
// 「添加到此页」/拖拽移出同构的 DOM 状态），第三页网格内图标保持原位作对照组
const moved = await evalJs("(function(){var g=document.querySelector('.app-grid.p2-grid');if(!g)return 'no-p2grid';var a=g.querySelector('.app[data-app]');if(!a)return 'no-app';g.closest('.page-slide').appendChild(a);return a.dataset.app;})()");
check('已构造独立组件图标（移出 p2 网格）', typeof moved === 'string' && moved !== 'no-p2grid' && moved !== 'no-app', String(moved));
const standAloneSel = "(function(){var s=document.querySelectorAll('.page-slide .app[data-desk-widget^=\"app-\"]');for(var i=0;i<s.length;i++){if(!s[i].closest('.app-grid'))return s[i].dataset.app;}return '';})()";

// T3 进装修模式（真实入口：设置页 → 自定义手机桌面图标行）
const decorOn = await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-setting\"]');if(t)t.click();return true;})()");
await sleep(300);
await evalJs("(function(){var r=document.getElementById('row-custom-icon');if(r)r.click();return true;})()");
await sleep(500);
const st = JSON.parse(await evalJs("(function(){var p=document.getElementById('page-phone');var gs=Array.prototype.slice.call(document.querySelectorAll('.app-grid'));return JSON.stringify({decor:p?p.classList.contains('decor-on'):false,editing:gs.filter(function(g){return g.classList.contains('editing');}).length,bar:(function(){var b=document.getElementById('decor-bar');return b?!b.hidden:false;})()});})()") || '{}');
check('装修模式已开启（decor-on + 网格 editing + 装修条）', st.decor && st.editing >= 3 && st.bar, JSON.stringify(st));

// T4 关键用例：点【不在任何网格内】的独立图标 → 应弹出「图标设置」（修复前无反应）
await evalJs("(function(){var n=document.querySelector('.page-slide .app:not(.app-grid .app)');window.__sa=n?n.dataset.app:'';if(n)n.click();return true;})()");
await sleep(400);
const m4 = JSON.parse(await evalJs("(function(){var k=document.getElementById('modal-mask'),t=document.getElementById('modal-title');return JSON.stringify({open:k?!k.hidden:false,title:t?t.textContent:''});})()") || '{}');
check('点独立组件图标弹出「图标设置」菜单（本次修复主用例）', m4.open && m4.title === '图标设置', JSON.stringify(m4) + ' app=' + (await evalJs('window.__sa')));

// T5 取消后点第三页【网格内】图标 → 菜单照常弹出（原网格路径回归）
await evalJs("(function(){var c=document.getElementById('modal-cancel');if(c)c.click();return true;})()");
await sleep(300);
await evalJs("(function(){var g=document.querySelector('.app-grid.p3-grid');if(!g)return false;var a=g.querySelector('.app');if(!a)return false;a.click();return true;})()");
await sleep(400);
const m5 = JSON.parse(await evalJs("(function(){var k=document.getElementById('modal-mask'),t=document.getElementById('modal-title');return JSON.stringify({open:k?!k.hidden:false,title:t?t.textContent:''});})()") || '{}');
check('点第三页网格内图标仍弹出「图标设置」（回归）', m5.open && m5.title === '图标设置', JSON.stringify(m5));

// T6 选图路径：点「上传图片」胶囊 + 确定 → 选图 input 必须已挂到 document.body（部分内核
// 不挂 DOM 不弹选择器）；随后清理。顺带断言 accept=image/*
await evalJs("(function(){var ps=document.querySelectorAll('#modal-pills .pill');for(var i=0;i<ps.length;i++){if(ps[i].textContent.indexOf('上传图片')>=0||ps[i].textContent.indexOf('更换图片')>=0){ps[i].click();break;}}var ok=document.getElementById('modal-ok');if(ok)ok.click();return true;})()");
await sleep(400);
const pick = JSON.parse(await evalJs("(function(){var list=Array.prototype.slice.call(document.body.children).filter(function(n){return n.tagName==='INPUT'&&n.type==='file';});var i=list[list.length-1];if(!i)return '{}';var r={attached:i.parentNode===document.body,accept:i.accept};i.remove();return JSON.stringify(r);})()") || '{}');
check('选图 input 已挂载到 body 且 accept=image/*（修复用例）', pick.attached === true && pick.accept === 'image/*', JSON.stringify(pick));

// T7 退出装修模式后点同一独立图标 → 不再弹菜单（恢复正常功能点击）
await evalJs("(function(){var d=document.getElementById('decor-done');if(d)d.click();return true;})()");
await sleep(300);
await evalJs("(function(){var n=document.querySelector('.page-slide .app:not(.app-grid .app)');if(n)n.click();return true;})()");
await sleep(500);
const m7 = JSON.parse(await evalJs("(function(){var k=document.getElementById('modal-mask'),t=document.getElementById('modal-title');return JSON.stringify({open:k?!k.hidden:false,title:t?t.textContent:''});})()") || '{}');
check('退出装修后点独立图标不再弹「图标设置」', !(m7.open && m7.title === '图标设置'), JSON.stringify(m7));

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
