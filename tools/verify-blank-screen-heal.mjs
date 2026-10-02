// ===== 回归脚本：#815 整屏空白（切页后一个页面都不显示 / .phone 被内联高压没）=====
// 用法：node tools/verify-blank-screen-heal.mjs（MOCHI_ROOT 可指到仓外隔离副本的产物根）
// 用户实报（2026-09-19，华为 Nova 12 Pro + QQ 浏览器，明说其他机型也有）：
//   「经常会屏幕空白，还会闪，尤其是要输入文字的时候」。
// 该机自带屏幕诊断历史签名给出实锤：`[switch] ✗底部导航栏悬空 phone=647(底647) tab=106` 连捕
//   4 次——.phone 铺满 647 视口、底部导航却停在 106px ＝ flex 列里只剩状态栏＋导航栏，
//   **一个 .page 都没在显示**（base.css `.page[hidden]{display:none}`），即用户说的整屏空白。
// 根因（与机型无关）：① 全项目 30+ 处切页都是「先把所有 .page 打 hidden、再显目标页」的非原子
//   写法，中间落空（目标 id 取不到 / 外置 js 没拉进来＝#802 / render 抛错）就永久停在零可见页；
//   底部 tab 切页旧写法先关页再 getElementById(…).hidden=false，目标为 null 直接 TypeError。
//   ② 关页用的是 load 期静态快照，运行中才建的 .page（page-memo/page-market/page-eat…）关不掉
//   → 两页同显、各 flex:1 平分高度＝下半屏空白。③ 键盘期 .phone 内联高按 visualViewport.height
//   直写（散布十余处、无下限），内核瞬时上报 0/极小值即把整壳压成一条＝「要输入文字时空白、闪」。
// 断言：
//   A1 零可见页一帧内自愈（修复面本体）
//   A2 正常切页不误伤（自愈计数不涨·回归守卫，两侧同绿）
//   A3 动态建的 .page 也被关掉（不再两页同显）
//   A4 tab 目标页缺失时一页都不关（旧写法在这必抛并留下整屏空白）
//   A5 .phone 内联高被内核报没时 CSS 地板顶住，且正常键盘停靠值不被顶（地板只拦塌陷）
//   S1~S3 产物锚点（逻辑锚，删掉修复即消失）
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize((process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = 9890 + Math.floor(Math.random() * 50);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-blank-heal-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 240)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---- 开屏：进应用（与真机同路径：等数据就绪 → 强制点「进入」→ splash 退场） ----
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs(`(function(){
    try {
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
        var me = document.getElementById('splash-mandatory-enter'); if (me && !me.hidden) me.click();
        mm.hidden = true;
      }
      var sp = document.getElementById('splash');
      if (sp) { sp.classList.add('hide'); sp.hidden = true; }
      var mask = document.getElementById('modal-mask');
      if (mask && !mask.hidden) mask.hidden = true;
    } catch (e) {}
    return 1;
  })()`);
  await sleep(500);
}
const VISIBLE = `(function(){ var n=0,id=''; document.querySelectorAll('.page').forEach(function(p){ if(!p.hidden){n++; if(!id) id=p.id;} }); return JSON.stringify({n:n, id:id}); })()`;
const HEAL_N = `(function(){ var h = window.__mochiBlankHeal; return h && h.n ? h.n : 0; })()`;
const toObj = (s) => { try { return JSON.parse(s); } catch (e) { return { n: -1, id: 'parse-fail' }; } };

await boot();

// ---- A1 修复面本体：人为造出「零可见页」（＝切页中途落空后的死态）→ 一帧内必须自愈 ----
{
  const n0 = await evalJs(HEAL_N);
  await evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){ p.hidden = true; }); return 1; })()");
  await sleep(600);
  const v = toObj(await evalJs(VISIBLE));
  const n1 = await evalJs(HEAL_N);
  check('A1 零可见页（整屏空白死态）下一帧自愈：恰好一页可见且自愈计数 +1',
    v.n === 1 && n1 === n0 + 1, '可见页=' + v.n + '(' + v.id + ') heal ' + n0 + '→' + n1);
}

// ---- A2 回归守卫：正常切页（点底部 tab）不得误触自愈（两侧同绿） ----
{
  const n0 = await evalJs(HEAL_N);
  await evalJs("(function(){ var t=document.querySelector('.tab[data-page=\"page-setting\"]'); if(t) t.click(); return 1; })()");
  await sleep(400);
  const v1 = toObj(await evalJs(VISIBLE));
  await evalJs("(function(){ var t=document.querySelector('.tab[data-page=\"page-phone\"]'); if(t) t.click(); return 1; })()");
  await sleep(400);
  const v2 = toObj(await evalJs(VISIBLE));
  const n1 = await evalJs(HEAL_N);
  check('A2 正常切页：目标页可见、始终一页、自愈计数不动',
    v1.n === 1 && v1.id === 'page-setting' && v2.n === 1 && v2.id === 'page-phone' && n1 === n0,
    '设置页=' + v1.id + '/' + v1.n + ' 桌面=' + v2.id + '/' + v2.n + ' heal ' + n0 + '→' + n1);
}

// ---- A3 动态建的 .page 也被关掉（旧写法用 load 期静态快照，关不到运行中新增的页） ----
{
  await evalJs(`(function(){
    var old = document.getElementById('page-verify-dyn');
    if (old) old.remove();
    var pg = document.createElement('div');
    pg.className = 'page'; pg.id = 'page-verify-dyn';
    document.querySelector('.phone').appendChild(pg);
    document.querySelectorAll('.page').forEach(function(p){ if(!p.hidden) p.hidden = true; });
    pg.hidden = false;
    return 1;
  })()`);
  await sleep(300);
  const before = toObj(await evalJs(VISIBLE));
  await evalJs("(function(){ var t=document.querySelector('.tab[data-page=\"page-phone\"]'); if(t) t.click(); return 1; })()");
  await sleep(400);
  const after = toObj(await evalJs(VISIBLE));
  check('A3 动态页在显示时点底部 tab＝只留一页（旧写法两页同显、各占半屏）',
    before.n === 1 && before.id === 'page-verify-dyn' && after.n === 1 && after.id === 'page-phone',
    '切页前=' + before.n + '(' + before.id + ') 切页后=' + after.n + '(' + after.id + ')');
  await evalJs("(function(){ var p=document.getElementById('page-verify-dyn'); if(p) p.remove(); return 1; })()");
}

// ---- A4 tab 目标页缺失＝一页都不关（旧写法关完全部再抛 TypeError＝整屏空白卡死） ----
{
  const err0 = await evalJs("(function(){ return (window.__jsErrors||[]).length; })()");
  await evalJs("(function(){ var p=document.getElementById('page-setting'); if(p) p.id='page-setting-hidden-for-test'; return 1; })()");
  await evalJs("(function(){ var t=document.querySelector('.tab[data-page=\"page-setting\"]'); if(t) t.click(); return 1; })()");
  await sleep(600);
  const v = toObj(await evalJs(VISIBLE));
  const err1 = await evalJs("(function(){ return (window.__jsErrors||[]).length; })()");
  await evalJs("(function(){ var p=document.getElementById('page-setting-hidden-for-test'); if(p) p.id='page-setting'; return 1; })()");
  check('A4 目标页取不到：不关任何页（仍有可见页）且留一笔现场',
    v.n === 1 && err1 > err0, '可见页=' + v.n + '(' + v.id + ') jsErrors ' + err0 + '→' + err1);
}

// ---- A5 .phone 内联高地板：内核把高度报没时塌不成形；正常键盘停靠值原样放行 ----
{
  const geo = await evalJs(`(function(){
    var ph = document.querySelector('.phone');
    var out = {};
    var prev = ph.style.height;
    ph.style.height = '0px';
    out.collapsed = Math.round(ph.getBoundingClientRect().height);
    ph.style.height = '260px';
    out.docked = Math.round(ph.getBoundingClientRect().height);
    ph.style.height = prev;
    out.full = Math.round(ph.getBoundingClientRect().height);
    out.inner = window.innerHeight;
    return JSON.stringify(out);
  })()`);
  const g = toObj(geo);
  check('A5 内联高被报成 0 时 CSS 地板顶住（≥80px），而正常键盘停靠高 260px 不被顶',
    g.collapsed >= 80 && g.docked === 260, JSON.stringify(g));
}

// ---- S1~S3 产物锚点（逻辑锚：修复被覆盖即消失） ----
{
  const html = (function(){ let pool=''; try { pool = readFileSync(join(root,'index.html'),'utf8');
    const jd=join(root,'js'); for (const f of readdirSync(jd)) if (f.endsWith('.js')) pool += '\n' + readFileSync(join(jd,f),'utf8'); } catch(e){} return pool; })();
  check('S1 产物含零可见页自愈调用（syncChrome 扫到零可见必走 healBlank）',
    html.indexOf('else healBlank();') >= 0 && html.indexOf('function healBlank()') >= 0);
  check('S2 产物含切页实时关页＋目标页前置（hideAllPages 与 target 判定）',
    html.indexOf('function hideAllPages()') >= 0 && html.indexOf('if (!target) {') >= 0);
  check('S3 产物含 .phone 整屏空白地板（min-height 退化阶梯两条）',
    html.indexOf('min-height:min(120px, 18vh);') >= 0 && html.indexOf('min-height:min(120px, 18dvh);') >= 0);
}

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过' + (failed.length ? '；失败：' + failed.map((f) => f.desc).join(' | ') : ''));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(failed.length ? 1 : 0);
