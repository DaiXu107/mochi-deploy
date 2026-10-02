// ===== 验证 #305：功能大全页（feature-hub.js）=====
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测：分组/条目渲染数、
// 搜索过滤与恢复、设置行进入、链式跳转两类（桌面图标 page-garden / 聊天面板 chat-rps-panel）、
// where 条目位置提示、返回设置页。不依赖构建产物，构建前后都可跑。
// 用法：node tools/verify-feature-hub.mjs（需本机 Chrome/Edge）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

// —— 与 build.mjs 同序拼装（不压缩，仅拼接） ——
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
let html = read('template.html').replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  const map = { '/manifest.json': 'pwa/manifest.json', '/notice.json': 'pwa/notice.json', '/sw.js': 'pwa/sw.js', '/version.json': null };
  if (url in map && map[url]) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(read(map[url])); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = 9900 + Math.floor(Math.random() * 150);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fhub-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove(); const q=document.getElementById('qa-mask'); if(q) q.hidden=true; })()`);

let fail = 0;
// 诊断：页面是否起来、有无 JS 错误
console.log('diag readyState=', await ev('document.readyState'),
  '| fhub-body=', await ev('!!document.getElementById("fhub-body")'),
  '| row=', await ev('!!document.getElementById("row-featurehub")'),
  '| errs=', JSON.stringify(await ev('window.__jsErrors ? window.__jsErrors.slice(0,3).map(e=>e.msg||e) : null')));
const A = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

// #1452（阶段 A）：功能大全的目录行改「首次打开才建」——先走一次真实入口（设置行）把目录建出来，
// 再量渲染数。契约未变：开页后仍是 10 组 / 条目数下限；下面 A2 会再点一次入口（幂等）。
await ev(`document.getElementById('row-featurehub').click()`);
await sleep(150);

// A1 渲染：10 组 / 总条目数（v3.27.x 全量收口 194 条：聊天美化与设置+桌面美化与外观两新组+群聊子功能+通话背景；
// #865 桌面补全批新增【桌面应用】组 → 10 组）
const r1 = await ev(`(()=>{ const gs=document.querySelectorAll('#fhub-body .gs-title').length; const rows=document.querySelectorAll('#fhub-body .set-row').length; return gs+'|'+rows; })()`);
const [gCount, rowCount] = String(r1).split('|').map(Number);
A('A1 分组数=10（#865 新增【桌面应用】组）', gCount === 10, '实际 ' + gCount);
// 条目数只作**下限**判定（防整块丢失）：本仓多会话并行往目录里加条目，写死等值＝别人加一条
// 本脚本就假红（2026-09-19 #848 实测：213 基线在 HEAD 副本里已是 231）。收口批若删了条目，
// 这里照样红。
A('A1 条目数≥213（下限＝v3.27.x 全量收口后累计基线；并行批只增不减）', rowCount >= 213, '实际 ' + rowCount);

// A2 设置行进入功能大全页
await ev(`document.getElementById('row-featurehub').click()`);
await sleep(120);
A('A2 入口行打开功能大全', await ev(`!document.getElementById('page-featurehub').hidden`));

// A3 搜索「红包」只留命中（断言＝全部可见行都含「红包」＋不少于 3 条；写死条数会随并行批
// 新增红包相关条目假红，故只留下限与「无串项」两条真判据）
await ev(`(()=>{const i=document.getElementById('fhub-search'); i.value='红包'; i.dispatchEvent(new Event('input')); })()`);
await sleep(80);
const hit = await ev(`(()=>{const v=[...document.querySelectorAll('#fhub-body .set-row')].filter(r=>r.style.display!=='none'); return v.length+'|'+v.filter(r=>!r.textContent.includes('红包')).length; })()`);
const [vis, offTopic] = String(hit).split('|').map(Number);
A('A3 搜索红包→≥3 条且无串项', vis >= 3 && offTopic === 0, '命中 ' + vis + ' 条、非红包条目 ' + offTopic + ' 条');

// A4 清空搜索恢复
await ev(`(()=>{const i=document.getElementById('fhub-search'); i.value=''; i.dispatchEvent(new Event('input')); })()`);
await sleep(80);
const vis2 = await ev(`[...document.querySelectorAll('#fhub-body .set-row')].filter(r=>r.style.display!=='none').length`);
A('A4 清空搜索恢复到 A1 全量（往返等式，不写死条数）', vis2 === rowCount, '恢复 ' + vis2 + ' 条 / A1 ' + rowCount + ' 条');

// A5 链式跳转·桌面图标类（花园）——按首行名称精确匹配（描述里含「花园」的字卡行不应误命中）
await ev(`[...document.querySelectorAll('#fhub-body .set-row')].find(r=>{const t=r.querySelector('.txt'); return t&&t.firstChild&&t.firstChild.textContent.trim()==='花园';}).click()`);
await sleep(200);
A('A5 跳转花园页', await ev(`!document.getElementById('page-garden').hidden && document.getElementById('page-featurehub').hidden`));

// A6 链式跳转·聊天面板类（猜拳）——按首行名称精确匹配（v3.27.x 起「现在让 TA 邀请一次」等条目描述也含「猜拳」，模糊匹配会误命中）
await ev(`document.getElementById('row-featurehub').click()`);
await sleep(80);
await ev(`[...document.querySelectorAll('#fhub-body .set-row')].find(r=>{const t=r.querySelector('.txt'); return t&&t.firstChild&&t.firstChild.textContent.trim()==='猜拳';}).click()`);
await sleep(800); // #1471 守卫补点落在 600ms，窗口随之放宽（原 200ms）
A('A6 跳转猜拳面板（聊天页+面板可见）', await ev(`!document.getElementById('page-chat').hidden && !document.getElementById('chat-rps-panel').hidden`));

// A7 无直达条目：弹位置提示（引用回复）——同样按名称精确匹配
await ev(`document.getElementById('row-featurehub').click()`);
await sleep(80);
await ev(`[...document.querySelectorAll('#fhub-body .set-row')].find(r=>{const t=r.querySelector('.txt'); return t&&t.firstChild&&t.firstChild.textContent.trim()==='引用回复';}).click()`);
await sleep(80);
A('A7 where 条目出 toast', await ev(`(()=>{ const t=document.getElementById('cc-toast'); return !!t && t.className.includes('show') && t.textContent.includes('引用回复'); })()`));

// A8 返回设置
await ev(`document.getElementById('fhub-back').click()`);
await sleep(80);
A('A8 返回设置页', await ev(`!document.getElementById('page-setting').hidden`));

// A9 #543 桌面不再有功能大全图标——#542 曾提为桌面一级入口，用户反馈「影响我原本的布局」，
// 撤出桌面仅保留 设置 → 聊天 → 功能大全（A2~A8 已覆盖设置入口与返回）；此处反向断言防回流
await ev(`document.querySelector('.tab[data-page="page-phone"]').click()`);
await sleep(100);
A('A9 桌面已无功能大全图标（#543）', await ev(`!document.querySelector('.app[data-app="featurehub"]')`));

// A10 #542 设置页搜索：输入「功能大全」→ 只剩命中行；清空 → 恢复全部行显隐
await ev(`document.querySelector('.tab[data-page="page-setting"]').click()`);
await sleep(100);
const sBefore = await ev(`[...document.querySelectorAll('#page-setting .set-row')].filter(r=>r.style.display!=='none').length`);
await ev(`(()=>{const i=document.getElementById('set-search-input'); i.value='功能大全'; i.dispatchEvent(new Event('input'));})()`);
await sleep(100);
const sShown = await ev(`[...document.querySelectorAll('#page-setting .set-row')].filter(r=>r.style.display!=='none').length`);
const sAllHit = await ev(`[...document.querySelectorAll('#page-setting .set-row')].filter(r=>r.style.display!=='none').every(r=>{const t=r.querySelector('.txt'); return !t || t.textContent.indexOf('功能大全')>=0;})`);
A('A10 设置搜索过滤（有命中且均含关键词）', sShown > 0 && sShown < sBefore && sAllHit, 'before=' + sBefore + ' shown=' + sShown);
await ev(`(()=>{const i=document.getElementById('set-search-input'); i.value=''; i.dispatchEvent(new Event('input'));})()`);
await sleep(100);
const sRestored = await ev(`[...document.querySelectorAll('#page-setting .set-row')].filter(r=>r.style.display!=='none').length`);
A('A10b 清空恢复全部行显隐', sRestored >= sBefore, 'restored=' + sRestored);

console.log(fail === 0 ? '== 冒烟全部通过 ==' : ('== 失败 ' + fail + ' 项 =='));
process.exit(fail === 0 ? 0 : 1);
