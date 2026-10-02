// ===== 验证 #578：设置页/美化页顶部搜索框「外框没有颜色区分」（手机端看不出是输入框）=====
// 用户报障：手机端设置里的顶部搜索栏外框没有颜色区分 UI。
// 根因（无头实测，零机型分支）：外观全部写死在 template 的内联 style 上，其中
//   border:1px solid var(--card-border,#ddd) / background:var(--bg-b,#fff)
// 是**带 var() 的简写**；安卓 mobile-adapt.js 的 ceConvert 把 input 转成 contenteditable
// `.ce-box` 时按【属性名】逐个复制内联样式，带 var() 的简写复制不过去 —— 可见的 .ce-box
// 实测 `border:0px none` ＋ `background:rgba(0,0,0,0)`：搜索框在手机上连边框带底色一起
// 消失（不是「淡」，是完全没有）。浅色下原本也只是白底压白底＋10% 黑细线，同样看不出。
// 修复：外观改走 setting.css 的 .theme-search 类样式 —— input 与它的 .ce-box 同吃一份
// 规则，明暗随主题变量切换、与转换前后无关。
//
// 断言（无头 Chrome，内存拼装 src、不写产物）：
//   A 组 安卓转换态（.ce-box 存在）：可见节点必须有边框、底色必须与页面底色分得开，明暗各一遍
//   B 组 未转换态（桌面/模拟器外壳，input 本体）：同样有边框＋底色（iOS 不转换，走这条）
//   C 组 占位文字不折行（ce-box 高度保持一行）
// RED 基线（复现原缺陷）：node tools/verify-set-search-frame.mjs --red
//   —— 内存 HTML 里把旧内联样式写回两个搜索框（等同修复前的 template），A/B 组应转红。
// 用法：node tools/verify-set-search-frame.mjs
//      node tools/verify-set-search-frame.mjs --product   # 直接验收已构建的根产物 index.html（手机实际加载的那份）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');
const RED = process.argv.includes('--red');
const PRODUCT = process.argv.includes('--product');

const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
let css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
let html = read('template.html').replace('__APP_VERSION__', 'v3.26.0-test');
if (RED) {
  // 复现修复前形态：① 把写死在内联 style 上的外观写回两个搜索框（含带 var() 的 border/background 简写）；
  // ② 去掉 .theme-search 类规则（修复前它不存在，留着会被类样式兜住、复现不出来）
  css = css.split('\n').filter((l) => l.indexOf('theme-search') < 0).join('\n');
  const legacy = ' style="width:100%;box-sizing:border-box;padding:8px 10px;font-size:13px;border:1px solid var(--card-border,#ddd);border-radius:9px;background:var(--bg-b,#fff);color:var(--ink,#111)"';
  for (const id of ['set-search-input', 'theme-search-input']) {
    const re = new RegExp('(id="' + id + '"[^>]*)>');
    if (!re.test(html)) { console.error('RED 模式找不到 ' + id); process.exit(1); }
    html = html.replace(re, '$1' + legacy + '>');
  }
}
if (PRODUCT) {
  // 直接验收构建产物：CSS/JS 已内联在 index.html 里，不再拼装 src
  html = readFileSync(join(root, 'index.html'), 'utf8');
} else {
  html = html.replace('</head>', '<style>' + css + '</style></head>');
  html = html.replace('</body>', '<script>' + js + '<\/script></body>');
}

const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
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
const cdpPort = 9400 + Math.floor(Math.random() * 100);
const profile = join(process.env.TEMP || '/tmp', 'mochi-vssf-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} server.close(); });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }

let fail = 0;
const A = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

await cdp('Page.enable'); await cdp('Runtime.enable');

// 打开设置页（拿掉开屏/问答门/引导/弹层）
async function openSettings() {
  await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove();
    const q=document.getElementById('qa-mask'); if(q) q.hidden=true;
    const g=document.querySelector('.mg-guide-mask'); if(g) g.remove();
    const m=document.getElementById('modal-mask'); if(m) m.hidden=true;
    document.querySelectorAll('.page').forEach(p=>p.hidden=true);
    const sp=document.getElementById('page-setting'); if(sp) sp.hidden=false; })()`);
  await sleep(450);
}
// 量可见节点：安卓转换后是 .ce-box，未转换时是 input 本体
const MEASURE = `(()=>{ const inp=document.getElementById('set-search-input');
  const box=document.querySelector('#page-setting .ce-box[data-for="set-search-input"]')||document.querySelector('#page-setting .ce-box');
  const el=box||inp; if(!el) return {err:'no-el'};
  const cs=getComputedStyle(el); const b=el.getBoundingClientRect();
  const pageBg=(()=>{ const p=getComputedStyle(document.querySelector('.phone')).backgroundImage||'';
    const m=p.match(/rgba?\\([^)]+\\)/g); return m?m[0]:''; })();
  const rgb=(s)=>{ const m=String(s).match(/[\\d.]+/g); return m?m.slice(0,3).map(Number):null; };
  const alpha=(()=>{ const m=String(cs.backgroundColor).match(/rgba?\\(([^)]+)\\)/); if(!m) return 1;
    const p=m[1].split(',').map(x=>parseFloat(x)); return p.length>3?p[3]:1; })();
  const pageRgb=rgb(pageBg), fillRgb=rgb(cs.backgroundColor);
  // 底色合成到页面底色上后的通道差——全透明底（修复前）合成结果＝页面底色，差 0
  let delta=null;
  if (pageRgb && fillRgb) { const comp=fillRgb.map((c,i)=>Math.round(c*alpha + pageRgb[i]*(1-alpha)));
    delta=Math.max.apply(null, comp.map((c,i)=>Math.abs(c-pageRgb[i]))); }
  return { theme: document.documentElement.dataset.theme||'light', node: box?'ce-box(安卓转换后可见)':'input(未转换)',
    borderW: parseFloat(cs.borderTopWidth)||0, borderColor: cs.borderTopColor, fill: cs.backgroundColor, fillAlpha: alpha,
    pageBg, pageRgb, fillRgb, delta,
    h: Math.round(b.height), w: Math.round(b.width), radius: cs.borderRadius }; })()`;

const near = (a, b, d) => Math.abs(a - b) <= d;
const distinct = (x) => x && typeof x.delta === 'number' && x.delta >= 3; // 底色合成到页面上差 ≥3/255 才算「分得开」

// ---------- A 组：安卓转换态（窄屏手机）----------
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2600);
await openSettings();

let m = await ev(MEASURE);
A('A0 设置页搜索框可见节点已就绪', m && !m.err && m.w > 100, m && !m.err ? m.node + ' ' + m.w + 'x' + m.h : String(m && m.err));
A('A1 [浅色·转换后] 搜索框有可见外框（border-width > 0，修复前实测 0px none）', m.borderW > 0, 'border=' + m.borderW + 'px ' + m.borderColor + ' fillAlpha=' + m.fillAlpha);
A('A2 [浅色·转换后] 底色与页面底色分得开（修复前 fill 全透明＝合成后与 #fff 页面零差）', distinct(m), 'fill=' + m.fill + ' page=' + m.pageBg + ' Δ=' + m.delta);

await ev(`(()=>{ document.documentElement.dataset.theme='dark'; })()`);
await sleep(450);
let md = await ev(MEASURE);
A('A3 [深色·转换后] 搜索框有可见外框', md.borderW > 0, 'border=' + md.borderW + 'px ' + md.borderColor);
A('A4 [深色·转换后] 底色与页面底色分得开（修复前全透明＝压在 #1c1c1c 上看不出框）', distinct(md), 'fill=' + md.fill + ' page=' + md.pageBg + ' Δ=' + md.delta);
A('A5 [深色·转换后] 占位文字不折行（框高保持一行；折行＝补齐边框后差 2px 撑高到两行）', md.h <= 52, 'h=' + md.h + 'px');

// ---------- B 组：未转换态（桌面模拟器外壳，input 本体；iOS 不转换走这条）----------
await ev(`(()=>{ document.documentElement.dataset.theme='light'; })()`);
await cdp('Emulation.clearDeviceMetricsOverride');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2600);
await openSettings();
let mi = await ev(MEASURE);
A('B0 未转换态走 input 本体（桌面模拟器外壳）', mi && !mi.err && mi.node.indexOf('input') === 0, mi && !mi.err ? mi.node : String(mi && mi.err));
A('B1 [浅色·未转换] input 有可见外框', mi.borderW > 0, 'border=' + mi.borderW + 'px ' + mi.borderColor);
A('B2 [浅色·未转换] input 底色与页面底色分得开（修复前是纯白底压纯白页面）', distinct(mi), 'fill=' + mi.fill + ' page=' + mi.pageBg + ' Δ=' + mi.delta);
A('B3 [浅色·未转换] 圆角/尺寸与修复前一致（圆角 9px、宽度占满、高度单行）', mi.radius.indexOf('9px') === 0 && mi.w > 300 && mi.h <= 52, 'r=' + mi.radius + ' ' + mi.w + 'x' + mi.h);

console.log('----');
console.log((RED ? '[RED 基线] ' : '') + (fail ? fail + ' 项失败' : '全部通过'));
try { ws.close(); } catch (e) {}
process.exit(fail ? 1 : 0);
