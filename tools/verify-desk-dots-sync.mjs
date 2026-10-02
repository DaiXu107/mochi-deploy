// ===== 验证 #580：桌面翻页圆点与滑动同步（滚动中每帧跟随 + 每帧零查询零样式读取） =====
// 用户反馈：「桌面里切换 1/2/3 的桌面页时，图标按钮底部的导航按钮（分页圆点）反应慢，
// 没有与我滑动完全同步」。
// 根因：desktop-slider.js 的 scroll 监听 clearTimeout + setTimeout(sync,120)，每次滚动
// 事件都把同步推进 120ms 后 = 滚动全程圆点被冻结、松手吸附结束才跳一次（实测滞后 127ms），
// 再叠加圆点变形动画 250ms ≈ 0.4s 迟到感。
// 修好后圆点必须：①滚动中过半即翻转（不等松手）；②滑动全程单调不抖；
// ③逐帧同步不得引入卡顿——滚动的每一帧不许有 DOM 查询 / 样式读取（gap 与圆点走缓存）。
// 内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测，构建前后都可跑。
// 用法：node tools/verify-desk-dots-sync.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
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

let fail = 0;
const T = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

// —— 静态断言（不依赖浏览器） ——
const sliderSrc = read('js/desktop-slider.js');
const homeCss = read('css/home.css');
T('S1 滚动中走 rAF 每帧跟随（改回松手后 setTimeout = 用户报的「不同步」复发）',
  sliderSrc.indexOf('if (!rafId) rafId = requestAnimationFrame(syncFrame);') >= 0);
T('S2 步长 gap 走缓存、不逐帧 getComputedStyle（删缓存 = 每帧强制样式重算，安卓掉帧）',
  sliderSrc.indexOf('if (gapCache === null) gapCache = parseFloat(getComputedStyle(pages).columnGap) || 0;') >= 0);
T('S3 旧的「滚动期间冻结圆点」的延时同步已移除',
  !/scrollTimer\s*=\s*setTimeout\(sync,\s*120\)/.test(sliderSrc));
T('S4 圆点容器 contain:layout 隔离变形动画的布局抖动', homeCss.indexOf('contain:layout;') >= 0);
// 只卡上界（< .2s）：允许后续微调时长，但退回 .25s 的老值＝跟手后仍有一段迟到尾巴，判红
const dotTrans = (/\.dot\s*\{[^}]*transition:width\s*\.(\d+)s/.exec(homeCss) || [])[1];
T('S5 圆点过渡已缩短到 .2s 以内（.25s = 跟手后还有一段迟到尾巴）',
  dotTrans !== undefined && parseFloat('0.' + dotTrans) < 0.2, dotTrans !== undefined ? 'transition:width .' + dotTrans + 's' : '未匹配到');
if (fail) { console.log('静态断言已有失败，跳过无头部分'); process.exit(1); }

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
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-dots-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=390,844', '--user-data-dir=' + profileDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => {
  try { chrome.kill(); } catch (e) {}
  server.close();
  // 自清临时 profile（C 盘紧张 + TEMP 里残留过上百个无头 profile，见 WORKLOG 2026-09-16）
  try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
});

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (evt) => { const m = JSON.parse(evt.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2800);
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove(); const q=document.getElementById('qa-mask'); if(q) q.hidden=true;
  document.querySelectorAll('.onboard-mask,.mg-guide-mask').forEach(n=>{ try{n.hidden=true;}catch(e){} }); })()`);

// 测试夹具：页步长 / 页数 / 当前圆点索引；吸附先关掉，才能停「两页中间」模拟手指拖到一半
const setup = await ev(`(()=>{
  const p=document.getElementById('desktop-pages');
  const dots=[...document.querySelectorAll('#desktop-dots .dot')];
  const step=p.clientWidth + (parseFloat(getComputedStyle(p).columnGap)||0);
  return { step, slides:p.querySelectorAll('.page-slide').length, dots:dots.length };
})()`);
const STEP = setup.step, N = setup.slides;
T('B0 前置：桌面多页 + 圆点数量与页数一致', STEP > 0 && N >= 3 && setup.dots === N, JSON.stringify(setup));

const settleTo = async (x, ms) => {
  await ev(`(()=>{const p=document.getElementById('desktop-pages'); p.style.scrollSnapType='none'; p.scrollLeft=${x};})()`);
  await sleep(ms);
};
const activeIdx = () => ev(`[...document.querySelectorAll('#desktop-dots .dot')].findIndex(d=>d.classList.contains('active'))`);

// B1 手指拖到一半（0.62 页）就应翻转圆点，不能等松手/吸附：等 3 帧（≈50ms，旧实现 120ms 才动手）
await settleTo(0, 260);
await ev(`(()=>{const p=document.getElementById('desktop-pages'); p.style.scrollSnapType='none'; p.scrollLeft=${(STEP * 0.62).toFixed(1)};})()`);
await ev(`new Promise(r=>{let n=0;const t=()=>{ if(++n>=3) return r(1); requestAnimationFrame(t); }; requestAnimationFrame(t); })`);
T('B1 滑到 62% 处圆点已跟到第 2 颗（旧实现要松手 +120ms 才动）', (await activeIdx()) === 1, 'active=' + (await activeIdx()));

// B2 每帧零 DOM 查询 / 零样式读取（逐帧同步的卡顿护栏：gap 与圆点必须走缓存）
let thin = null;
for (let i = 0; i < 3; i++) {
  const r = await ev(`(async()=>{
    const p=document.getElementById('desktop-pages');
    const oQ=Document.prototype.querySelectorAll, oG=window.getComputedStyle;
    let q=0,g=0;
    Document.prototype.querySelectorAll=function(){ q++; return oQ.apply(this,arguments); };
    window.getComputedStyle=function(){ g++; return oG.apply(this,arguments); };
    p.style.scrollSnapType='none';
    p.scrollLeft=0; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    q=0; g=0;                                   // 复位后只测「一次滚动引发的逐帧同步」
    p.scrollLeft=Math.round(p.clientWidth*0.62);
    await new Promise(r=>{let n=0;const t=()=>{ if(++n>=4) return r(1); requestAnimationFrame(t); }; requestAnimationFrame(t); });
    Document.prototype.querySelectorAll=oQ; window.getComputedStyle=oG;
    return { q, g };
  })()`);
  if (r && (r.q + r.g) === 0) { thin = r; break; }
  thin = thin === null ? r : (r.q + r.g < thin.q + thin.g ? r : thin);
}
T('B2 滚动中的帧内零 querySelectorAll / 零 getComputedStyle', !!thin && thin.q === 0 && thin.g === 0,
  thin ? `querySelectorAll=${thin.q} getComputedStyle=${thin.g}` : 'no-sample');

// B3 逐格推进（模拟手指连续拖动）：圆点必须单调跟进、中途不闪回
const trail = await ev(`(async()=>{
  const p=document.getElementById('desktop-pages');
  const step=p.clientWidth + (parseFloat(getComputedStyle(p).columnGap)||0);
  p.style.scrollSnapType='none';
  p.scrollLeft=0; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const idxs=[];
  for(let i=0;i<=12;i++){
    p.scrollLeft=(i/12)*step;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    idxs.push([...document.querySelectorAll('#desktop-dots .dot')].findIndex(d=>d.classList.contains('active')));
  }
  return idxs;
})()`);
const monotonic = trail.every((v, i) => i === 0 || v >= trail[i - 1]);
T('B4 拖动全程圆点单调跟进、中途不闪回', monotonic && trail[trail.length - 1] === 1, '轨迹=' + JSON.stringify(trail));

// B4 松手后吸附终点圆点仍正确（恢复 markdown 吸附，停到整页位置）
await ev(`(()=>{const p=document.getElementById('desktop-pages'); p.style.scrollSnapType=''; p.scrollLeft=0;})()`);
await sleep(260);
await ev(`(()=>{const p=document.getElementById('desktop-pages'); const step=p.clientWidth + (parseFloat(getComputedStyle(p).columnGap)||0); p.scrollLeft=step;})()`);
await sleep(300);
T('B5 吸附停稳在第 2 页后圆点仍在第 2 颗', (await activeIdx()) === 1, 'active=' + (await activeIdx()));

// B5 deskRebuild 重建圆点后跟随仍有效（缓存必须换成新节点，否则改的是脱离文档的旧圆点）
const rebuild = await ev(`(async()=>{
  const p=document.getElementById('desktop-pages');
  window.deskRebuild();
  const n=p.querySelectorAll('.page-slide').length, d=document.querySelectorAll('#desktop-dots .dot').length;
  p.style.scrollSnapType='none';
  p.scrollLeft=(n-1)*(p.clientWidth + (parseFloat(getComputedStyle(p).columnGap)||0));
  await new Promise(r=>{let k=0;const t=()=>{ if(++k>=4) return r(1); requestAnimationFrame(t); }; requestAnimationFrame(t); });
  const act=[...document.querySelectorAll('#desktop-dots .dot')].findIndex(x=>x.classList.contains('active'));
  p.style.scrollSnapType='';
  return { slides:n, dots:d, act };
})()`);
T('B6 deskRebuild 后圆点数=页数，且滑到末页点亮末颗（缓存换新节点）',
  rebuild.dots === rebuild.slides && rebuild.act === rebuild.dots - 1, JSON.stringify(rebuild));

// B6 点圆点切换：立即定位 + 圆点立即点亮
const click = await ev(`(async()=>{
  const p=document.getElementById('desktop-pages');
  const dots=[...document.querySelectorAll('#desktop-dots .dot')];
  dots[0].click();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const s0=p.scrollLeft, a0=[...document.querySelectorAll('#desktop-dots .dot')].findIndex(x=>x.classList.contains('active'));
  dots[Math.min(2,dots.length-1)].click();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const i=Math.min(2,dots.length-1);
  const a1=[...document.querySelectorAll('#desktop-dots .dot')].findIndex(x=>x.classList.contains('active'));
  const step=p.clientWidth + (parseFloat(getComputedStyle(p).columnGap)||0);
  return { s0, a0, a1, i, expect:i*step, got:p.scrollLeft };
})()`);
T('B7 点第 1 颗回到第 1 页（scrollLeft=0、圆点=0）', click.s0 < 2 && click.a0 === 0, JSON.stringify(click));
T('B8 点圆点立即切换（圆点与 scrollLeft 同步到目标页）',
  click.a1 === click.i && Math.abs(click.got - click.expect) < 2, `active=${click.a1} want=${click.i} scrollLeft=${click.got} expect=${click.expect}`);

console.log(fail === 0 ? '== 全部通过 ==' : ('== 失败 ' + fail + ' 项 =='));
try { process.exit(fail === 0 ? 0 : 1); } catch (e) {}
