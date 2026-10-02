// verify-desk-layout-guard.mjs — #140 桌面小组件卡片整批消失回归验证
// 背景（#140 Huawei Pura70Pro+/Chrome 122 及安卓同族）：desk-layout 持久化值损坏/空壳
// 时，applyDeskLayout 会把布局外全部小组件卡扫进隐藏池（只剩图标网格，即用户反馈的
// 「桌面小组件的卡片大部分不显示」），坏键经 IndexedDB 回填每次启动复发。
// 修复：deskLayout() 完整性校验+坏键自愈清除、隐藏池不收「布局有名（列在缺失页）」
// 的组件、saveDeskLayout 写前防损坏、deskRebuild 页数钳制。
//
// 验证方式（无头 Chrome 加载构建产物；默认 DOM 启动后直接改 desk-layout 并调用
// window.applyDeskLayout()——与真实重排完全同一条代码路径，不依赖跨导航 LS 持久化）：
//   T1 空壳布局 [[],[],[]]        → 校验拒绝、坏键清除，默认卡不被扫进隐藏池
//   T2 截断布局 [[deco]]（页数<2） → 同上
//   T3 合法三页布局               → 布局应用，卡片按布局落位（防误伤装修用户）
//   T4 重复组件 id 布局           → 校验拒绝，默认卡不被扫进隐藏池
//   T5 合法布局但第三页被删（缺失页）→ 布局列在缺失页上的卡片不被扫进隐藏池
// 模板默认常驻隐藏池的 desk-clock/calendar/timer/anniv（app-group-chat）不计异常。
// 用法：node tools/verify-desk-layout-guard.mjs [仓库根目录]（默认当前仓库；产物须已构建）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArg = process.argv[2];
const root = rootArg
  ? normalize(rootArg)
  : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const indexHtml = join(root, 'index.html');
try { if (!statSync(indexHtml).isFile()) throw new Error('nf'); } catch (e) {
  console.error('找不到 ' + indexHtml + '——请先 node build.mjs（或传入已构建的仓库根目录）');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(2); }

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

const DEFAULT_CARDS = ['deco', 'quote-row', 'checkin', 'apps', 'music', 'week', 'weekend', 'p2apps', 'desk-period', 'memo-row', 'p3apps'];
const POOL_DEFAULTS = ['desk-clock', 'desk-calendar', 'desk-timer', 'desk-anniv', 'app-group-chat'];
const VALID_LAY = '[["deco","quote-row","checkin","apps"],["music","week","weekend","p2apps"],["desk-period","memo-row","p3apps"]]';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
};

async function runScenario(setupJs) {
  // 每场景独立 Chrome 实例（隔离 LS / 桌面 DOM 状态）
  const port = 9900 + Math.floor(Math.random() * 400);
  const proc = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vdlg-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)),
    '--remote-debugging-port=' + port, 'about:blank'
  ], { stdio: 'ignore' });
  const kill = () => { try { proc.kill(); } catch (e) {} };
  process.on('exit', kill);
  let ws = null, id = 0; const pend = new Map();
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) { kill(); throw new Error('no cdp'); }
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pend.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evl = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3800);
  const r = await evl(`(() => {
    ${setupJs}
    try { window.applyDeskLayout(); } catch (e) {}
    const pool = document.getElementById('desk-widget-pool');
    const poolIds = pool ? Array.from(pool.querySelectorAll('[data-desk-widget]')).map(n => n.getAttribute('data-desk-widget')) : [];
    const slides = Array.from(document.querySelectorAll('#desktop-pages .page-slide'));
    const loc = {};
    slides.forEach((s, i) => Array.from(s.querySelectorAll('[data-desk-widget]')).forEach(n => {
      loc[n.getAttribute('data-desk-widget')] = i;
    }));
    let layNow;
    try { layNow = localStorage.getItem('xy-home-v2:default:desk-layout'); } catch (e) {}
    return { poolIds, loc, layNow };
  })()`);
  kill();
  return r;
}

const pooledCore = (r) => DEFAULT_CARDS.filter(w => (r.poolIds || []).indexOf(w) >= 0);
const junkPool = (r) => (r.poolIds || []).filter(w => POOL_DEFAULTS.indexOf(w) < 0);

// T1 空壳布局 → 拒绝 + 清键 + 默认卡不被扫进隐藏池
{
  const r = await runScenario(`localStorage.setItem('xy-home-v2:default:desk-page-count','3');localStorage.setItem('xy-home-v2:default:desk-layout','[[],[],[]]');`);
  check('T1 空壳布局被拒绝（默认卡不在隐藏池）', pooledCore(r).length === 0, 'pooled=' + pooledCore(r).join(','));
  check('T1 隐藏池无异常组件', junkPool(r).length === 0, 'pool=' + junkPool(r).join(','));
  check('T1 空壳布局坏键已清除', r.layNow === null, 'layNow=' + r.layNow);
}
// T2 截断布局（1 页 < MIN 2）→ 同上
{
  const r = await runScenario(`localStorage.setItem('xy-home-v2:default:desk-page-count','3');localStorage.setItem('xy-home-v2:default:desk-layout','[["deco"]]');`);
  check('T2 截断布局被拒绝（默认卡不在隐藏池）', pooledCore(r).length === 0, 'pooled=' + pooledCore(r).join(','));
  check('T2 截断布局坏键已清除', r.layNow === null, 'layNow=' + r.layNow);
}
// T3 合法布局 → 应用并按布局落位（防误伤装修用户）
{
  const r = await runScenario(`localStorage.setItem('xy-home-v2:default:desk-page-count','3');localStorage.setItem('xy-home-v2:default:desk-layout',${JSON.stringify(VALID_LAY)});`);
  let ok = true, detail = '';
  DEFAULT_CARDS.forEach(w => { if ((r.poolIds || []).indexOf(w) >= 0) { ok = false; detail += w + ' 误进池; '; } });
  JSON.parse(VALID_LAY).forEach((page, pi) => page.forEach(w => { if (r.loc[w] !== pi) { ok = false; detail += w + '@' + r.loc[w] + '≠' + pi + '; '; } }));
  check('T3 合法布局应用并按布局落位', ok, detail);
  check('T3 合法布局未被误清', r.layNow === VALID_LAY, 'layNow=' + r.layNow);
}
// T4 重复组件 id 布局 → 拒绝
{
  const r = await runScenario(`localStorage.setItem('xy-home-v2:default:desk-page-count','3');localStorage.setItem('xy-home-v2:default:desk-layout','[["deco","deco"],["quote-row","checkin"],["apps"]]');`);
  check('T4 重复 id 布局被拒绝（默认卡不在隐藏池）', pooledCore(r).length === 0, 'pooled=' + pooledCore(r).join(','));
  check('T4 重复 id 布局坏键已清除', r.layNow === null, 'layNow=' + r.layNow);
}
// T5 合法布局但第三页不存在（页缺失）→ 缺失页上的卡不进隐藏池
{
  const r = await runScenario(`localStorage.setItem('xy-home-v2:default:desk-page-count','3');localStorage.setItem('xy-home-v2:default:desk-layout',${JSON.stringify(VALID_LAY)});
    const _sl = document.querySelectorAll('#desktop-pages .page-slide'); if (_sl[2]) _sl[2].parentNode.removeChild(_sl[2]);`);
  const bad = ['desk-period', 'memo-row', 'p3apps'].filter(w => (r.poolIds || []).indexOf(w) >= 0);
  check('T5 缺失页上的组件不被扫进隐藏池', bad.length === 0, 'pooled=' + bad.join(','));
}

console.log('=====');
console.log('结果：' + pass + ' 通过 ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
