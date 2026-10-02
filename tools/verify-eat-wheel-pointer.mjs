// ===== 回归脚本：#876 吃什么转盘「转盘抽取」中奖片不在指针下 ＋ #886 指针永远跟着显示的菜/切桌面复位/提醒键清扫 =====
// 用法：node build.mjs && node tools/verify-eat-wheel-pointer.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-eat-wheel-pointer.mjs   （红绿对照：测纯 HEAD 副本时本批应红）
// 背景：
//   #876（用户直派「抽取后转的东西不在顶部，默认菜单哪个标下方」）：中奖片公式把指针当作在转盘**右侧 0 角**，
//   而 .eat-pointer 钉在正上方（top:-12px、svg 尖朝下＝画布角 3π/2）。2~30 格×500 组随机角仿真 100% 错位。
//   修复＝eatIdxUnderPtr（指针 12 点几何），主转盘＋切菜单转盘两处接线。
//   #886（用户确认三项都修）：①「指针永远跟着显示的菜走」——打开/「换一个」/改菜单重抽（都走 eatPick）后把
//   显示菜扇区中线转到指针下（eatAlignWheelToDish）；②切桌面复位编辑菜单面板/切换菜单浮层（页内常驻节点
//   跨桌面残留）；③eat-remind-done「今日已提醒」键只留当天（开页＋每 4 分钟双接线清扫）。
// 断言面：S 产物锚（两代修复在位＋旧形态不回流＋指针几何前提）/ B1~B3 主转盘三轮种子化确定性抽取（期望菜名
//   ＝几何独立推算的指针下扇区；画布像素证明高亮白片就在指针下、退去后恢复本色）/ B5~B6 显示-指针一致性
//   （像素级：指针下颜色＝显示菜扇区本色；显示驱动、不依赖随机值）/ B4 切菜单转盘 / B7 切桌面复位 /
//   B8 提醒键清扫 / Z 全程零异常。
// 时序：旋转 3200ms（期间文字是 flashTick 闪烁假值，不作数）→ 停盘高亮 1200ms → 终值文案 +200ms 落定。
//   脚本在点击后 3600ms 读第一个终值、+500ms 复读比对。画布采样点在「字带外、边界线内」净空带
//   （菜名字形半角≈315/半径 度，扇区边线在中线 ±9° ⇒ 取中线 ±6.5°、半径 0.688r）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const art = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const IDX = art('index.html');                 // 内联产物（当前形态 p2-features.js 属 core 内联）
const P2_EXT = art('js/p2-features.js');       // 未来若外置则读外置件
const P2 = P2_EXT.includes('DEF_EAT_DISHES') ? P2_EXT : IDX;

// ---- 几何真相（与页面代码完全独立，本脚本是裁判）----
function norm(a) { return (a % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); }
function idxUnderTopPointer(totalAngle, n) { const slice = 2 * Math.PI / n; return Math.floor(norm(3 * Math.PI / 2 - norm(totalAngle)) / slice) % n; }
function idxAtRightZero(totalAngle, n) { const slice = 2 * Math.PI / n; return Math.floor(norm(2 * Math.PI - norm(totalAngle) + slice / 2) / slice) % n; }
function spinTotal(startAngle, r1, r2) { return startAngle + (3 + r1 * 4) * Math.PI * 2 + r2 * Math.PI * 2; } // 与页面同表达式同结合序
const COLORS = ['#ff6b6b', '#ffa94d', '#69db7c', '#4dabf7', '#f06595', '#ffd43b', '#a9e34b', '#74c0fc', '#e599f7', '#ff922b'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

const mDish = P2.match(/const DEF_EAT_DISHES = \[([^\]]*)\]/);
const DISHES = mDish ? mDish[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : [];
const N = DISHES.length;

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---- S. 产物锚 ----
const NEEDLE_HELPER = 'function eatIdxUnderPtr(normalized, n, slice) { return Math.floor((((3 * Math.PI / 2 - normalized)';
check('S1 顶部指针几何函数在产物（画布角 3π/2 所在片＝指针压住的扇区）', P2.indexOf(NEEDLE_HELPER) >= 0);
check('S2 旧「右侧 0 角」公式不回流（2π-normalized+slice/2；回流＝高亮/菜名恒不在指针下）', P2.indexOf('2 * Math.PI - normalized + slice / 2') < 0);
check('S3 主转盘接线在位（eatSpinWheel → dishes.length）', P2.indexOf('eatIdxUnderPtr(normalized, dishes.length, slice)') >= 0);
check('S3b 切菜单转盘接线在位（eatSwitchSpin → names.length）', P2.indexOf('eatIdxUnderPtr(normalized, names.length, slice)') >= 0);
check('S4 指针几何前提未被挪动（.eat-pointer 仍钉在正上方 top:-12px；挪位则本脚本几何需随之换锚）', /\.eat-pointer\s*\{[^}]*top:-12px/.test(IDX));
check('S5 指针仍尖朝下（svg 多边形 (10,18) 尖、(3,2)(17,2) 底边在上）', P2.indexOf('points="10,18 3,2 17,2"') >= 0);
check('S0 默认菜单解析成功（≥2 道才可转）', N >= 2, 'n=' + N);
check('S7 #886 显示-指针对齐函数在产物（显示菜扇区中线转到 3π/2）',
  P2.indexOf('function eatAlignWheelToDish(dish) {') >= 0 && P2.indexOf('3 * Math.PI / 2 - (i + 0.5) * slice') >= 0);
check('S8 #886 提醒键清扫逻辑在产物（只留当天）', P2.indexOf("const scan = pfx + ':eat-remind-done:';") >= 0);
check('S9 #886 切桌面复位接线在产物（停转＋关浮层＋收编辑面板）',
  P2.indexOf("eatClearSpin(); eatSwitchClose(); const mp = document.getElementById('eat-menu-panel'); if (mp) mp.hidden = true;") >= 0);

// ---- 无头浏览器 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-eat-wheel-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') jsErrors.push(String(m.params && m.params.exceptionDetails && m.params.exceptionDetails.text).slice(0, 120));
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.log('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 200)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// seed：与点图标同一 eval 原子执行（中间不能让后台定时器插队消费随机数）
async function bootAndOpenEat(seed) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1000);
  await evalJs(`(function(){ var s=document.querySelector('.splash'); if(s) s.classList.add('hide'); var q=document.getElementById('qa-close'); if(q) q.click(); })()`);
  await sleep(500);
  for (let i = 0; i < 25; i++) { if (await evalJs('!!document.querySelector(\'.app[data-app="eat"]\')')) break; await sleep(200); }
  const seedCode = seed && seed.length ? 'var __sq=' + JSON.stringify(seed) + '; Math.random=function(){ return __sq.length ? __sq.shift() : 0.42; };' : '';
  await evalJs(`(function(){ var a=document.querySelector('.app[data-app="eat"]'); if(!a) return; ${seedCode} a.click(); })()`);
  await sleep(700);
  return evalJs(`(function(){ var p=document.getElementById('page-eat'); return p ? !p.hidden : false; })()`);
}

// 采样转盘顶部扇区一点（半径 0.688r、偏离文字射线 0.361 slice＝字带之外、边界线之内）周围 5×5 像素
async function sampleTopSlice(n, offFrac) {
  return evalJs(`(function(){
    var c=document.getElementById('eat-wheel'); if(!c) return null;
    var ctx=c.getContext('2d'); var dpr=window.devicePixelRatio||1;
    var cx=120, cy=120, r=116; var slice=2*Math.PI/${n}; var a=3*Math.PI/2 + ${offFrac}*slice;
    var R=0.688*r; var x=Math.round((cx+R*Math.cos(a))*dpr)-2, y=Math.round((cy+R*Math.sin(a))*dpr)-2;
    var d=ctx.getImageData(x, y, 5, 5).data; var white=0, acc=[0,0,0], tot=25;
    for(var i=0;i<d.length;i+=4){ acc[0]+=d[i]; acc[1]+=d[i+1]; acc[2]+=d[i+2]; if(d[i]>=235&&d[i+1]>=235&&d[i+2]>=235) white++; }
    return { w: white/tot, c: [Math.round(acc[0]/tot), Math.round(acc[1]/tot), Math.round(acc[2]/tot)] };
  })()`);
}
const near = (a, b, tol) => Array.isArray(a) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
// 转盘停稳后中奖片在指针下的偏移是随机的（可贴近任一边界），且片内白色字形/描边会污染均色采样：
// 扇形四点＝指针 ±0.15 slice × 半径 0.62/0.88（无论停偏必有两点落在中奖片内），逐像素分类：
// 高亮期判白占比（高亮片＝白底＋彩色字），退色后判期望色像素数（邻格填色互异＋白字形不计入＝不误命中）
async function sampleTopSliceFan(n, expRgb) {
  return evalJs(`(function(){
    var c=document.getElementById('eat-wheel'); if(!c) return null;
    var ctx=c.getContext('2d'); var dpr=window.devicePixelRatio||1;
    var cx=120, cy=120, r=116; var slice=2*Math.PI/${n}; var out=[];
    var exp=${JSON.stringify(expRgb)};
    var offs=[0.15,-0.15]; var rads=[0.62,0.88];
    for (var oi=0;oi<offs.length;oi++) for (var ri=0;ri<rads.length;ri++){
      var a=3*Math.PI/2 + offs[oi]*slice; var R=rads[ri]*r;
      var x=Math.round((cx+R*Math.cos(a))*dpr)-2, y=Math.round((cy+R*Math.sin(a))*dpr)-2;
      var d=ctx.getImageData(x, y, 5, 5).data; var white=0, nExp=0, tot=25, acc=[0,0,0];
      for(var i=0;i<d.length;i+=4){
        acc[0]+=d[i]; acc[1]+=d[i+1]; acc[2]+=d[i+2];
        if(d[i]>=235&&d[i+1]>=235&&d[i+2]>=235) white++;
        if(exp && Math.abs(d[i]-exp[0])<=60 && Math.abs(d[i+1]-exp[1])<=60 && Math.abs(d[i+2]-exp[2])<=60) nExp++;
      }
      out.push({ w: white/tot, c: [Math.round(acc[0]/tot), Math.round(acc[1]/tot), Math.round(acc[2]/tot)], nExp: nExp });
    }
    return out;
  })()`);
}

async function dishText() { return evalJs(`document.getElementById('eat-dish').textContent`); }

// ---- B5. 打开页面：指针指着显示的菜（#886；种子 0.5 定死初始抽取，红侧可判定）----
let opened1 = false;
{
  opened1 = await bootAndOpenEat([0.5]);
  if (opened1) {
    let txt = '';
    for (let i = 0; i < 20; i++) { txt = await dishText(); if (txt && txt !== '…') break; await sleep(200); }
    const expIdx = Math.floor(0.5 * N) % N;
    const gotIdx = DISHES.indexOf(txt);
    check('B5 打开页面显示菜 = 种子抽取（0.5 → 「' + DISHES[expIdx] + '」）', txt === DISHES[expIdx], '实际=' + txt);
    const s5 = await sampleTopSlice(N, 0.361);
    check('B5b 指针下颜色 = 显示菜扇区本色（未高亮；对齐缺失时指针停在静置位＝判红）',
      !!s5 && gotIdx >= 0 && near(s5.c, COLORS[gotIdx % 10], 45) && s5.w < 0.7,
      s5 ? '指针下avg=' + s5.c.join(',') + ' 期望=' + COLORS[(gotIdx >= 0 ? gotIdx : 0) % 10].join(',') + ' whiteFrac=' + s5.w.toFixed(2) : 'null');
  }
}
check('B5 吃什么页打开', opened1);

// ---- B1~B3. 主转盘三轮（种子化 Math.random；每轮刷新页面保持 eatSpinAngle 起点确定；旋转期闪烁值不作数）----
const ROUNDS = [
  { r1: 0.13, r2: 0.77 },
  { r1: 0.51, r2: 0.23 },
  { r1: 0.88, r2: 0.62 },
];
let pixelDone = false;
for (let k = 0; k < ROUNDS.length; k++) {
  const { r1, r2 } = ROUNDS[k];
  const opened = await bootAndOpenEat([0.5]);
  if (!opened) { check('B' + (k + 1) + ' 吃什么页打开', false, 'page-eat 未显示'); continue; }
  await evalJs(`(function(){ window.__sq=[${r1},${r2}]; Math.random=function(){ return window.__sq.length ? window.__sq.shift() : 0.42; }; })()`);
  const preTxt = await dishText();
  const i0 = DISHES.indexOf(preTxt);
  const base0 = norm(3 * Math.PI / 2 - (i0 + 0.5) * (2 * Math.PI / N)); // #886：打开页时已对齐到初始菜扇区中线

  await evalJs(`document.getElementById('eat-spin').click()`);
  await sleep(3600);                       // 旋转 3200ms＋终值 +200ms 落定，读的一定是终值
  const expIdx = idxUnderTopPointer(spinTotal(base0, r1, r2), N);
  const oldIdx = idxAtRightZero(spinTotal(base0, r1, r2), N);
  const txt1 = await dishText();
  if (k === 0) {
    const hl = await sampleTopSliceFan(N, null);
    const hlOk = !!hl && hl.some(function (p) { return p && p.w >= 0.6; });
    check('B1b 停盘瞬间中奖白片压在指针下（扇形四点任一命中）', hlOk, hl ? 'whiteFracs=' + hl.map(function (p) { return p.w.toFixed(2); }).join('/') : 'null');
    pixelDone = true;
  }
  await sleep(500);
  const txt2 = await dishText();
  const stable = txt1 === txt2;
  check('B' + (k + 1) + ' 「今天吃」终值 = 指针下扇区的菜（几何推算 idx=' + expIdx + '「' + DISHES[expIdx] + '」；旧公式会指 idx=' + oldIdx + '「' + DISHES[oldIdx] + '」）',
    stable && txt1 === DISHES[expIdx], '实际=' + txt2 + (stable ? '' : '（两次读数不同=' + txt1 + '/' + txt2 + '）'));
  if (k === 0) {
    await sleep(1400);                     // 高亮窗（停盘+1200ms）已过
    const rest = await sampleTopSliceFan(N, COLORS[expIdx % 10]);
    const restOk = !!rest && rest.some(function (p) { return p && p.nExp >= 5; });
    check('B1c 高亮退去后中奖片本色压在指针下 colors[' + (expIdx % 10) + ']（扇形四点任一命中期望色像素）', restOk, rest ? 'nExps=' + rest.map(function (p) { return p.nExp; }).join('/') : 'null');
  } else {
    await sleep(1200);
  }
}
check('B1b/B1c 像素采样已执行', pixelDone);

// ---- B6. 「换一个」后指针跟着显示的菜走（#886；override 恒回 0.42 → 抽 DISHES[floor(0.42N)]，红侧可判定）----
{
  const pre = await dishText();
  await evalJs(`document.getElementById('eat-change').click()`);
  let txt = '';
  for (let i = 0; i < 20; i++) { txt = await dishText(); if (txt && txt !== pre) break; await sleep(200); }
  const gotIdx = DISHES.indexOf(txt);
  const expIdx = Math.floor(0.42 * N) % N;
  check('B6 「换一个」显示菜 = 随机抽取（0.42 → 「' + DISHES[expIdx] + '」）', txt === DISHES[expIdx], '实际=' + txt);
  await sleep(300);
  const s6 = await sampleTopSlice(N, 0.361);
  check('B6b 换菜后指针跟着转到显示菜扇区（#886 像素级；缺失时指针原地不动＝判红）',
    !!s6 && gotIdx >= 0 && near(s6.c, COLORS[gotIdx % 10], 45) && s6.w < 0.7,
    s6 ? '指针下avg=' + s6.c.join(',') + ' 期望=' + COLORS[(gotIdx >= 0 ? gotIdx : 0) % 10].join(',') + ' whiteFrac=' + s6.w.toFixed(2) : 'null');
}

// ---- B4. 切菜单转盘（同一条公式第二处接线；modal 造第二个菜单后转；终值读法同主转盘）----
let b4 = false, b4detail = '未执行';
{
  const opened = await bootAndOpenEat();
  if (!opened) b4detail = 'page-eat 未显示';
  else {
    await evalJs(`document.getElementById('eat-menu-btn').click()`);
    await sleep(300);
    await evalJs(`document.getElementById('eat-menu-new').click()`);
    await sleep(400);
    await evalJs(`(function(){ var i=document.getElementById('modal-input'); if(i) i.value='夜宵菜单'; })()`);
    await evalJs(`document.getElementById('modal-ok').click()`);
    await sleep(400);
    await evalJs(`document.getElementById('eat-switch-menu').click()`);
    await sleep(400);
    const ovOpen = await evalJs(`(function(){ var o=document.getElementById('eat-switch-overlay'); return o ? !o.hidden : false; })()`);
    if (!ovOpen) b4detail = '切换菜单浮层未打开（第二个菜单没建成？）';
    else {
      const names = await evalJs(`(function(){ return [].slice.call(document.querySelectorAll('#eat-switch-chips .eat-chip')).map(function(x){ return x.textContent; }); })()`);
      const m = names && names.length >= 2 ? names.length : 0;
      if (m < 2) b4detail = 'chips<2';
      else {
        await evalJs(`(function(){ window.__sq=[0.31,0.66]; Math.random=function(){ return window.__sq.length ? window.__sq.shift() : 0.42; }; })()`);
        await evalJs(`document.getElementById('eat-switch-go').click()`);
        await sleep(3600);                 // 旋转 3200ms＋终值 +200ms；浮层在停盘 +1200ms 才关，读得到
        const expIdx = idxUnderTopPointer(spinTotal(0, 0.31, 0.66), m);
        const nm1 = await evalJs(`document.getElementById('eat-switch-name').textContent`);
        await sleep(400);
        const nm2 = await evalJs(`document.getElementById('eat-switch-name').textContent`);
        b4 = nm1 === nm2 && nm1 === names[expIdx];
        b4detail = '期望「' + names[expIdx] + '」(idx=' + expIdx + ') 实际「' + nm2 + '」' + (nm1 !== nm2 ? '（两次读数不同）' : '');
      }
    }
  }
}
check('B4 切菜单转盘中奖菜单 = 指针下扇区（同公式第二处）', b4, b4detail);

// ---- B7. 切桌面复位（#886：编辑面板/切换浮层不跨桌面残留）----
let b7 = false, b7detail = '未执行';
{
  await sleep(800);                        // 等 B4 浮层自关（停盘+1200ms）
  const panelVisible0 = await evalJs(`(function(){ var p=document.getElementById('eat-menu-panel'); return p ? !p.hidden : false; })()`);
  if (!panelVisible0) { await evalJs(`document.getElementById('eat-menu-btn').click()`); await sleep(300); }
  const panelVisible = await evalJs(`(function(){ var p=document.getElementById('eat-menu-panel'); return p ? !p.hidden : false; })()`);
  await evalJs(`document.dispatchEvent(new Event('contact-switched'))`);
  await sleep(400);
  const after = await evalJs(`(function(){ var p=document.getElementById('eat-menu-panel'); var o=document.getElementById('eat-switch-overlay'); return { p: p ? !!p.hidden : null, o: o ? !!o.hidden : null }; })()`);
  b7 = !!panelVisible && !!after && after.p === true && after.o === true;
  b7detail = '面板先开=' + panelVisible + ' 事件后面板hidden=' + (after && after.p) + ' 浮层hidden=' + (after && after.o);
}
check('B7 切桌面复位：编辑面板收起＋切换浮层关闭（跨桌面不残留）', b7, b7detail);

// ---- B8. 提醒键清扫（#886：eat-remind-done 只留当天；重进吃什么页触发清扫）----
let b8 = false, b8detail = '未执行';
{
  const r = await evalJs(`(function(){
    var pfx = window.activePrefix ? window.activePrefix() : 'xy-home-v2:default:';
    var d = new Date(); var today = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    var stale = pfx + ':eat-remind-done:breakfast:2020-01-01';
    var todayKey = pfx + ':eat-remind-done:lunch:' + today;
    try { localStorage.setItem(stale, '1'); localStorage.setItem(todayKey, '1'); } catch (e) { return { err: String(e) }; }
    var a = document.querySelector('.app[data-app="eat"]'); if (a) a.click();
    return { stale: stale, todayKey: todayKey };
  })()`);
  if (!r || r.err) { b8detail = '注入失败 ' + (r && r.err); }
  else {
    await sleep(600);
    const left = await evalJs(`(function(){ return { stale: localStorage.getItem(${JSON.stringify(r.stale)}), today: localStorage.getItem(${JSON.stringify(r.todayKey)}) }; })()`);
    b8 = !!left && left.stale === null && left.today === '1';
    b8detail = '历史键残留=' + JSON.stringify(left && left.stale) + ' 当天键保留=' + JSON.stringify(left && left.today);
  }
}
check('B8 提醒键清扫：历史 eat-remind-done 被清、当天保留', b8, b8detail);

// ---- Z. 抽取全程零 JS 异常 ----
check('Z 全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

chrome.kill(); server.close();
const fail = results.filter((r) => !r.ok).length;
console.log('==== ' + (results.length - fail) + '/' + results.length + ' PASS' + (fail ? '  (FAIL ' + fail + ')' : ''));
process.exit(fail ? 1 : 0);
