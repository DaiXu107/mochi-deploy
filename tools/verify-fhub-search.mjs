// ===== 验证 #573：功能大全搜索精准化（#fhub-search → feature-hub.js update()）=====
// 优化前：整串子串匹配（多词「群聊 概率」被并成单串恒 0 命中）、命中行无匹配质量排序。
// 优化后：多词空格 AND + 组内按 精确→开头→包含 稳定重排 + 原始行序快照（清空还原）。
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测行为。
// 用法：node tools/verify-fhub-search.mjs（需本机 Chrome/Edge）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');
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
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = 9400 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vfh-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
  const g=document.querySelector('.mg-guide-mask'); if(g) g.remove(); const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);
await sleep(300);
// 从设置页点「功能大全」进入（真实入口路径）
await ev(`(()=>{ document.querySelectorAll('.page').forEach(p=>p.hidden=true);
  const sp=document.getElementById('page-setting'); if(sp) sp.hidden=false;
  const row=document.getElementById('row-featurehub'); if(row) row.click(); })()`);
await sleep(400);

let fail = 0;
const A = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };
const visRows = () => ev(`[...document.querySelectorAll('#fhub-body .set-row')].filter(r=>r.style.display!=='none'&&r.closest('.set-group').parentNode.style.display!=='none').map(r=>{const t=r.querySelector('.txt');return t?t.firstChild.textContent.trim():'';})`);
const search = async (q) => { await ev(`(()=>{ const i=document.getElementById('fhub-search'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return 1; })()`); await sleep(200); };

// F1 打开与基线
const groups = await ev(`document.querySelectorAll('#fhub-body .gs-title').length`);
const page0 = await ev(`document.getElementById('page-featurehub') && !document.getElementById('page-featurehub').hidden`);
A('F1 功能大全打开且分组渲染', page0 === true && groups > 0, 'groups=' + groups);

// F2 单词搜索：命中行全含词、空态隐藏
await search('红包');
let rows = await visRows();
A('F2 搜「红包」命中且逐行含词', rows.length > 0 && rows.every(t => t.includes('红包')), 'n=' + rows.length);

// F3 多词 AND：搜「群聊 概率」→ 含两词的行在列（群聊设置），不含「概率」的纯「群聊」行被排除
await search('群聊 概率');
rows = await visRows();
const setRow = rows.some(t => t === '群聊设置');
const pureGone = !rows.includes('群聊');
A('F3 多词「群聊 概率」AND（群聊设置在列、纯群聊行被排除）', rows.length > 0 && setRow && pureGone, 'n=' + rows.length + ' [' + rows.slice(0, 5).join(',') + ']');

// F4 排序：搜「群聊」→ 匹配质量分级只作用在**组内**（各组 card 各自重排，组间顺序恒定）。
// #865 后首组是【桌面应用】，其「群聊（桌面图标）」（rank1 开头）按组序先出现；
// 本断言钉的是「聊天传讯」组内精确整名「群聊」（rank0）排在该组其它命中之前。
await search('群聊');
rows = await visRows();
const gcIdx = rows.indexOf('群聊');
const gcSettingsIdx = rows.indexOf('群聊设置');
A('F4 组内精确条目置顶（「群聊」先于「群聊设置」等同组命中）', gcIdx >= 0 && gcSettingsIdx > gcIdx, '群聊@' + gcIdx + ' 群聊设置@' + gcSettingsIdx + ' first=' + (rows[0] || ''));

// F5 清空还原：显隐复位（无行残留 display:none）+ 原始行序还原；视图按 update() 语义回首页/单组
await search('');
const reset = await ev(`(()=>{ const rs=[...document.querySelectorAll('#fhub-body .set-row')];
  const g=document.querySelector('#fhub-body .set-group'); const r=g?g.querySelector('.set-row'):null;
  return JSON.stringify({ hidden: rs.filter(x=>x.style.display==='none').length, total: rs.length,
    first: r ? r.querySelector('.txt').firstChild.textContent.trim() : '' }); })()`);
// 原始行序首行＝HUB 首组首行（#865 后首组是【桌面应用】→「聊天（桌面图标）」）
A('F5 清空恢复显隐与原始行序', (() => { try { const o = JSON.parse(reset); return o.hidden === 0 && o.total > 0 && o.first === '聊天（桌面图标）'; } catch (e) { return false; } })(), reset);

// F6 零 JS 错误
const e = await ev('window.__jsErrors ? window.__jsErrors.length : -1');
A('F6 零 JS 错误', e === 0, 'errs=' + e);

console.log(fail === 0 ? 'ALL PASS' : 'FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
