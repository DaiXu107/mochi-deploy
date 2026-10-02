// ===== 验证 #701：自定义字卡「全量导出点击没反应」（安卓壳前置 Promise 链挂起＝零反馈）＋导出/导入范围说明 =====
// 用户直派（2026-09-17，红米 Note 11 5G 夸克、多机型同现）：点「自定义字卡·全量导出」毫无反应——
// 根因是点击后的前置链（hydrateLibScopes IDB 取回 / ccExportExpandTokens 令牌还原）任一环挂起，
// .then 干等无 toast 无弹窗；且全量导出/导入缺「专属部分=当前桌面」范围说明。
// 断言：A1 点导出先弹范围说明（含专属归属）；A2 开始导出后全程有反馈并走到「文件已打包」确认；
//      A3 IDB 取回挂起（idbHydrateKey 永不落定）时 4s 兜底放行，仍能走到「文件已打包」＝不再静默。
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测行为。
// 用法：node tools/verify-cc-full-export.mjs（需本机 Chrome/Edge）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = ([\\s\\S]*?]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
// RED 对照：MOCHI_RED=1 时抠掉 #701 的超时兜底与说明弹窗（模拟修复前的 .then 干等旧逻辑）
let jsSrc = js;
if (process.env.MOCHI_RED) {
  jsSrc = jsSrc
    .replace(/ccFullWithTimeout\(Promise\.resolve\(hydrateLibScopes\(\['public', 'own'\]\)\)\.catch\(\(\) => \{\}\), 4000, null\)\.then\(build\)/, "Promise.resolve(hydrateLibScopes(['public', 'own'])).then(build)")
    .replace(/ccFullWithTimeout\(Promise\.resolve\(hydrateLibScopes\(\['public', 'own'\]\)\)\.catch\(\(\) => \{\}\), 4000, null\)\.then\(\(\) => \{ ccFullApply\(d, mode\); \}\)/, "Promise.resolve(hydrateLibScopes(['public', 'own'])).then(() => { ccFullApply(d, mode); })");
}
let html = read('template.html').replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + jsSrc + '<\/script></body>');
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vccfe-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} server.close(); });
let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2600);
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove(); const q=document.getElementById('qa-mask'); if(q) q.hidden=true;
  const g=document.querySelector('.mg-guide-mask'); if(g) g.remove();
  document.querySelectorAll('.page').forEach(p=>p.hidden=true);
  const p=document.getElementById('page-chatcard'); if(p) p.hidden=false; return 1; })()`);
await sleep(300);

let fail = 0;
const A = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };
const modalVisible = () => ev(`(()=>{ const m=document.getElementById('modal-mask'); return !!(m && !m.hidden && m.offsetParent !== null); })()`);
const modalText = () => ev(`(()=>{ const m=document.getElementById('modal-mask'); return m ? (m.textContent||'') : ''; })()`);

// A1 点「全量导出」→ 先弹范围说明弹窗（含「专属」归属说明），而不是静默
await ev(`document.getElementById('li-cc-full-export').click(); 1`);
await sleep(400);
A('A1 点全量导出先弹范围说明', await modalVisible());
const t1 = await modalText();
A('A1a 说明含专属归属（=当前桌面）', /专属/.test(t1) && /当前桌面/.test(t1));

// A2 点「开始导出」→ 有「正在准备导出…」反馈并最终走到「文件已打包」确认弹窗
// 点 pill+确定 后同步读 toast（无头环境导出极快，「正在准备导出…」会被成功 toast 覆盖）
const hasPrep = await ev(`(()=>{ const pills=[...document.querySelectorAll('#modal-pills button.pill')]; const b=pills.find(x=>/开始导出/.test(x.textContent)); if(b) b.click(); const ok=document.getElementById('modal-ok'); if(ok) ok.click(); const tt=(document.getElementById('cc-toast')||{}).textContent||''; return /正在准备导出|已导出全量字卡/.test(tt) ? tt : ''; })()`);
A('A2 点开始导出立刻有反馈 toast', !!hasPrep, hasPrep);
let packed = false;
for (let i = 0; i < 12; i++) { await sleep(500); const t = await modalText(); if (/文件已打包/.test(t)) { packed = true; break; } }
A('A2a 导出链走通到达「文件已打包」确认', packed);
// 关掉打包弹窗（点取消，不真下载）
await ev(`(()=>{ const c=[...document.querySelectorAll('#modal-mask button')].find(b=>/取消/.test(b.textContent)); if(c) c.click(); return 1; })()`);
await sleep(300);

// A3 挂起模拟：idbHydrateKey 永不落定＋把两把 cc 键标进挂起名单（绕过 hasData/absent 短路）→
// 旧代码 .then 干等＝零反应；新代码 4s 兜底放行，仍应走到「文件已打包」
await ev(`(()=>{ window.idbHydrateKey = function(){ return new Promise(function(){}); };
  window.__xyIdbDeferredKeys = ['xy-home-v2:cc-groups-public', (window.activePrefix?window.activePrefix():'xy-home-v2:default:')+'cc-groups'];
  return 1; })()`);
await ev(`document.getElementById('li-cc-full-export').click(); 1`);
await sleep(400);
A('A3 挂起态仍先弹说明弹窗', await modalVisible());
await ev(`(()=>{ const pills=[...document.querySelectorAll('#modal-pills button.pill')]; const b=pills.find(x=>/开始导出/.test(x.textContent)); if(b) b.click(); const ok=document.getElementById('modal-ok'); if(ok) ok.click(); return 1; })()`);
let packed2 = false;
for (let i = 0; i < 16; i++) { await sleep(500); const t = await modalText(); if (/文件已打包/.test(t)) { packed2 = true; break; } }
A('A3a IDB 取回挂起时超时兜底仍完成导出（≤8s）', packed2);

A('Z 无新增 JS 报错', ((await ev(`JSON.stringify(window.__jsErrors||[])`)) || '[]') === '[]');
console.log(fail ? 'FAIL ' + fail : 'ALL PASS');
process.exit(fail ? 1 : 0);
