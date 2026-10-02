// ===== 专项验证：#917 信息诊断「显示有很多错误」去噪（vivo X200S+Edge 独立应用实报，零机型分支） =====
// verify-suite:timeout=420000（B5 两拍配对确认 + B6 两段「轮询到汇总条出现为止」（窗长随自愈阶梯演进：20s→#1035 后 34s），全程约 2~4 分钟）
// 用户实证三类假错误（第二份华为 NOH-AN01 Edge 诊断同形）：
//  ① 4 条 [屏幕适配]「phone底=714/766」= inner∓26——恰是本机「屏幕位置设置」手调轴值，
//     判定器/自动采集不知道手调轴存在，把用户亲手调的几何当布局缺陷每 5s 刷错误环；
//  ② 18 条「资源加载失败 <script> js/*.js」同一秒成片（弱网首拉），#802 自愈后体检 82/82 全到位；
//  ③ 6 条「./version.json 网络失败」= 断网期轮询；另有切后台回前台用后台前坏签名直接确认入环的口子。
// 本脚本按「修前必红、修后必绿」组织断言：S 组查产物锚，B 组驱动真实页面行为（含反向对照——
// 手调整体为 0 时的真缺陷必须照报、有响应码的网络失败必须照记）。
// 用法：node tools/verify-diag-noise.mjs（需先 node build.mjs；MOCHI_ROOT 可指仓外副本）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const target = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : root;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? '  ← ' + extra : '')); }
};

const ERR_KEY = 'xy-home-v2:__diag-errs';   // 错误环（[屏幕适配] 与 JS 错误同键）
const NET_KEY = 'xy-home-v2:__diag-net';    // 网络失败环（6 条）
const HIST_KEY = 'xy-home-v2:screen-diag-hist'; // 屏幕适配快照时间线（B5 用其新条目做 tick 相位信号）

// ---- S 组：产物静态锚（device.js 是 core 内联件 → 落 index.html） ----
let idx = '';
try { idx = readFileSync(join(target, 'index.html'), 'utf8'); } catch (e) {}
ok('S1 判定器读手调轴探针在产物（inp.adj = (function () {）', idx.includes('inp.adj = (function () {'));
ok('S2 整体位移轴折算底部期望在产物（const expB = expBase + adjShift;）', idx.includes('const expB = expBase + adjShift;'));
ok('S3 页面高度轴跳过底部贴合的文案在产物（底部·已手动微调 h=）', idx.includes("'底部·已手动微调 h='"));
ok('S4 底部导航栏期望折算在产物（const expTB = expBase - (inp.envBottom || 0) + adjShift;）', idx.includes('const expTB = expBase - (inp.envBottom || 0) + adjShift;'));
ok('S5 手调轴串函数在产物（function sdAdjStr(a) {）', idx.includes('function sdAdjStr(a) {'));
ok('S6 外置包首拉失败聚合在产物（function extFailNote(name) {）', idx.includes('function extFailNote(name) {'));
ok('S7 离线期网络失败放行在产物（if (!status && navigator.onLine === false) return;）', idx.includes('if (!status && navigator.onLine === false) return;'));
ok('S8 跨后台配对复位在产物（function sdPendBreak() {）', idx.includes('function sdPendBreak() {'));
ok('S9 报告自证行在产物（本机手调（屏幕位置设置））', idx.includes('本机手调（屏幕位置设置）'));

// ---- B 组：无头行为（移动仿真 390×844） ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，跳过 B 组'); process.exit(fail ? 1 : 0); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
let pinJsFail = null; // B6 期间置为某个外置包文件名＝它的裸地址与换址地址一律 404
const server = createServer((req, res) => {
  try {
    let p = normalize(join(target, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(target)) { res.writeHead(403); res.end(); return; }
    // #1035：B6 用——把某件外置包的**真身**地址也钉成 404。汇总窗挪到换址逃生波之后（34s）后，
    // 人为「摘掉 __mochiLoaded」的文件会被真阶梯在 26s 那波重新取回并跑完＝「真失败」场景自己
    // 愈合、B6c 判不到条；只有让它的地址持续取不到，才复现「按 URL 钉死、怎么试都不回来」那一类。
    if (pinJsFail && decodeURIComponent(req.url.split('?')[0]) === '/js/' + pinJsFail) { res.writeHead(404); res.end('nf'); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-diag-noise-' + Date.now()),
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
  throw new Error('CDP 连接失败');
}
const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
// 环读取：返回指定前缀的条目数组
const ringOf = (key, prefix) => evalJs(`(function(){try{var a=JSON.parse(localStorage.getItem('${key}')||'[]');if(!Array.isArray(a))a=[];
  return a.filter(function(it){return it&&String(it.msg||'').indexOf('${prefix}')===0;}).map(function(it){return String(it.msg||'');});}catch(e){return ['<read-err>'];}})()`);

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  // 移动仿真：390×844（isMobile 判据=matchMedia(max-width:900px)，与真机一致的「手机布局」分支）
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  // 等数据就绪 + 关开屏（sdTick 的自动采集守卫：开屏已关 + __mochiDataReady）。
  // 开屏进入门控（clock.js）：年龄确认 + 开屏本体滑到底 + 强制公告页滑到底，
  // 缺一步「点击进入」就出不来（纯 s.click() 在全新 profile 上必失败——
  // sdTick 因守卫早退，B5 会假红）。
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1200);
  const dismiss = `(function(){
    try{localStorage.setItem('xy-home-v2:age-confirmed','1');}catch(e){}
    var ac=document.getElementById('splash-age-check'); if(ac&&!ac.checked){ac.checked=true;ac.dispatchEvent(new Event('change',{bubbles:true}));}
    var box=document.getElementById('splash-box'); if(box){box.scrollTop=box.scrollHeight;box.dispatchEvent(new Event('scroll'));}
    var e1=document.getElementById('splash-enter'); if(e1&&!e1.hidden&&!e1.classList.contains('is-disabled'))e1.click();
    var ms=document.getElementById('splash-mandatory-scroll'); if(ms){ms.scrollTop=ms.scrollHeight;ms.dispatchEvent(new Event('scroll'));}
    var e2=document.getElementById('splash-mandatory-enter'); if(e2&&!e2.classList.contains('is-disabled'))e2.click();
    var s=document.getElementById('splash');return s?(s.classList.contains('hide')?'hide':'shown'):'removed';})()`;
  let splashState = '';
  for (let i = 0; i < 12; i++) { splashState = await evalJs(dismiss); if (splashState === 'hide' || splashState === 'removed') break; await sleep(700); }
  if (splashState !== 'hide' && splashState !== 'removed') console.log('⚠ 开屏未关（' + splashState + '），B5 依赖 sdTick 将不可靠');
  await sleep(600);

  // ---- B1 手调轴探针：设置页写入的手调值必须被采集读到（读不到＝判定器无从同口径，后续全白搭） ----
  await evalJs("window.mochiScreenAdj.set('shift', 26); window.mochiScreenAdj.set('h', -26); true");
  const adj1 = await evalJs('JSON.stringify(window.__collectScreenDiag().inp.adj)');
  ok('B1a 手调轴进采集 inp.adj（shift=26/h=-26）', /"shift":26/.test(adj1) && /"h":-26/.test(adj1), adj1);
  await evalJs("window.mochiScreenAdj.set('shift', 0); window.mochiScreenAdj.set('h', 0); true");
  const adj0 = await evalJs('JSON.stringify(window.__collectScreenDiag().inp.adj)');
  ok('B1b 轴归零后读数为 0（判定器回全自动口径）', /"shift":0/.test(adj0) && /"h":0/.test(adj0), adj0);

  // ---- B2 整体位移轴折叠：shift=+26 时 .phone 整体下移 26px，修前必报「底部超出 26px」假错误 ----
  await evalJs("window.mochiScreenAdj.set('shift', 26); true");
  const r2 = await evalJs(`(function(){var r=window.__collectScreenDiag();
    var bot=r.findings.filter(function(f){return /^底部/.test(f.name);});
    return JSON.stringify({bad:bot.filter(function(f){return !f.ok;}).map(function(f){return f.name;}),
      fit:bot.filter(function(f){return f.ok&&/底部贴合/.test(f.name);}).map(function(f){return f.name;})});})()`);
  const r2o = JSON.parse(r2 || '{}');
  ok('B2a shift=26 下无「底部✗」假错误（少填/超出/导航栏被裁）', (r2o.bad || []).length === 0, r2);
  ok('B2b 底部判定按手调折算后仍给 ✓ 且注明折算', (r2o.fit || []).some((n) => /shift=26/.test(n)), r2);
  await evalJs("window.mochiScreenAdj.set('shift', 0); true");

  // ---- B3 反向对照：真缺陷（.phone 内联高被压到 400px）必须照报，折算不得把真错也吞了 ----
  await evalJs("(function(){document.querySelector('.phone').style.height='400px';return true;})()");
  const r3a = await evalJs("JSON.stringify(window.__collectScreenDiag().findings.filter(function(f){return !f.ok&&/^底部少填/.test(f.name);}).map(function(f){return f.name;}))");
  ok('B3a 轴全 0 时真缺陷照报（底部少填）', /底部少填/.test(r3a || ''), r3a);
  await evalJs("window.mochiScreenAdj.set('shift', 26); true");
  const r3b = await evalJs("JSON.stringify(window.__collectScreenDiag().findings.filter(function(f){return !f.ok&&/^底部少填/.test(f.name);}).map(function(f){return f.name;}))");
  ok('B3b shift=26 时真缺陷仍照报（折算只抵平移，不吞真错）', /底部少填/.test(r3b || ''), r3b);
  await evalJs("window.mochiScreenAdj.set('shift', 0); document.querySelector('.phone').style.height=''; true");

  // ---- B4 页面高度轴（复刻报障现场：.phone 比可视高矮 26px = 报告里的 phone底=714/766）----
  // 基准 --mochi-ios-h=844（syncVvFit 写的实测可视高）+ ios-vv-fit 类（安卓/iOS 同款 CSS 闸）→ 实测底 818
  await evalJs("document.documentElement.classList.add('ios-vv-fit'); document.documentElement.style.setProperty('--mochi-ios-h','844px'); window.mochiScreenAdj.set('h', -26); true");
  const r4 = await evalJs(`(function(){var r=window.__collectScreenDiag();
    var line=''; r.text.split('\\n').forEach(function(s){ if (s.indexOf('本机手调（屏幕位置设置）')===0) line=s; });
    return JSON.stringify({pb:r.inp.phoneBottom, adj:r.inp.adj,
      bad:r.findings.filter(function(f){return !f.ok&&/^底部/.test(f.name);}).map(function(f){return f.name;}),
      skip:r.findings.filter(function(f){return f.ok&&/已手动微调 h=-26/.test(f.name);}).map(function(f){return f.name;}),
      txt:line});})()`);
  const r4o = JSON.parse(r4 || '{}');
  ok('B4a 复刻现场：h 轴下 .phone 实测底真低于可视高（缺口存在才会被判 ✗）', (844 - (r4o.pb || 0)) >= 6,
    'phoneBottom=' + r4o.pb + '（真机缺口=26=轴值；无头下 .phone 垂直居中使实测缺口折半为 13，仍 >2 判据）');
  ok('B4b h=-26 下无「底部✗」假错误（少填/超出回流被豁免）', (r4o.bad || []).length === 0, r4);
  ok('B4c 跳过判定如实注明 h 轴值', (r4o.skip || []).length > 0, r4);
  ok('B4d 报告自证行带 手调 h-26', /h-26/.test(String(r4o.txt || '')), String(r4o.txt || ''));
  // 反向对照一：轴归零、基准仍是 818（= 真缺陷口径）→ 少填 26px 必须照报
  await evalJs("window.mochiScreenAdj.set('h', 0); document.documentElement.style.setProperty('--mochi-ios-h','818px'); true");
  const r4c = await evalJs("JSON.stringify(window.__collectScreenDiag().findings.filter(function(f){return !f.ok&&/^底部少填/.test(f.name);}).map(function(f){return f.name;}))");
  ok('B4e 反向对照：h=0 同几何必须报真缺陷（豁免是轴驱动、不是几何驱动）', /底部少填/.test(r4c || ''), r4c);
  // 反向对照二：h=0 + 基准 844（几何本来就对）→ 全 ✓
  await evalJs("document.documentElement.style.setProperty('--mochi-ios-h','844px'); true");
  const r4d = await evalJs("JSON.stringify(window.__collectScreenDiag().findings.filter(function(f){return !f.ok&&/^底部/.test(f.name);}).map(function(f){return f.name;}))");
  ok('B4f 反向对照：h=0 且几何正常 → 底部无 ✗', JSON.parse(r4d || '[]').length === 0, r4d);
  await evalJs("document.documentElement.style.removeProperty('--mochi-ios-h'); document.documentElement.classList.remove('ios-vv-fit'); true");

  // ---- B5 切后台断二次确认配对（修前：回前台首个 tick 拿后台前暂存的过期快照直接入环）----
  // 载体＝--mochi-ios-h 假缺陷（真缺口>2px 必判 ✗ 少填；内联高会被 1s 看门狗清扫，不可用）。
  // 口径不依赖 tick 相位：先等首个坏拍把配对装进暂存（相位信号＝screen-diag-hist 新条目，
  // 检出瞬刻就切后台＝保证藏前配对「未确认」）→ 藏中把几何改另一档（坏名单同名，快照数值
  // 不同：807→837）→ 回前台等首条入环：修后=回前台新几何（phone底≈837）；修前=后台前旧
  // 几何（phone底≈807）＝红。先回好状态等一拍，确保配对从干净态起步（B3/B4 可能留坏签名）。
  await evalJs("document.documentElement.classList.remove('ios-vv-fit'); document.documentElement.style.removeProperty('--mochi-ios-h'); document.querySelector('.phone').style.height=''; true");
  await sleep(6500);   // ≥1 个 5s tick 见全绿 → _sdLastBad/_sdPend 复位到干净态
  await evalJs(`(function(){try{localStorage.removeItem('${ERR_KEY}');localStorage.removeItem('${HIST_KEY}');}catch(e){}return true;})()`);
  await evalJs("document.documentElement.classList.add('ios-vv-fit'); document.documentElement.style.setProperty('--mochi-ios-h','770px'); true");
  const badA = await evalJs("JSON.stringify(window.__collectScreenDiag().findings.filter(function(f){return !f.ok;}).map(function(f){return f.name;}))");
  ok('B5a 假缺陷就位（A 档 pB=807，坏名单仅「底部少填」＝切档后签名不变）',
    /底部少填/.test(badA || '') && JSON.parse(badA || '[]').length === 1, badA);
  let tick1 = false;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    const h = await evalJs(`(function(){try{return String((JSON.parse(localStorage.getItem('${HIST_KEY}')||'[]')).length);}catch(e){return '0';}})()`);
    if (h !== '0') { tick1 = true; break; }
  }
  ok('B5b 首坏拍已入档（相位信号；藏前配对确认尚未发生）', tick1, '12s 内未见 screen-diag-hist 新条目');
  await evalJs("Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'hidden';}}); document.dispatchEvent(new Event('visibilitychange')); true");
  const ringAtHide = await evalJs(`(function(){try{return String((JSON.parse(localStorage.getItem('${ERR_KEY}')||'[]')).length);}catch(e){return '-1';}})()`);
  ok('B5c 藏前配对未被确认（环仍空＝pend 在位，判别前提成立）', ringAtHide === '0', '环条目数=' + ringAtHide);
  await sleep(1000);
  await evalJs("document.documentElement.style.setProperty('--mochi-ios-h','830px'); true");
  await evalJs("Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'visible';}}); document.dispatchEvent(new Event('visibilitychange')); true");
  let sdMsg5 = '';
  for (let i = 0; i < 36; i++) {
    const arr = await ringOf(ERR_KEY, '[屏幕适配]');
    if (arr.length) { sdMsg5 = arr[0]; break; }
    await sleep(500);
  }
  ok('B5d 回前台后持续真缺陷仍入环（不是把整类判定关掉）', !!sdMsg5, '18s 内未见 [屏幕适配] 条目');
  ok('B5e 入环快照＝回前台后的新几何（phone底≈837；修前是后台前 807 的过期快照）',
    /phone底=83\d(\.|｜|\s|$)/.test(sdMsg5), sdMsg5.slice(0, 220));
  await evalJs("document.documentElement.classList.remove('ios-vv-fit'); document.documentElement.style.removeProperty('--mochi-ios-h'); try{localStorage.removeItem('" + ERR_KEY + "');}catch(e){} true");
  await sleep(600);

  // ---- B6 外置功能包首拉失败聚合（修前：一发一条「资源加载失败 <script>」，18 条塞满 20 条环）----
  const pre6 = await evalJs("(function(){return JSON.stringify({ext:(window.__mochiExtFiles||[]).length, has:['chat.js','feed.js'].every(function(f){return (window.__mochiExtFiles||[]).indexOf(f)>=0;}), loaded:(window.__mochiLoaded||[]).length});})()");
  ok('B6pre 外置包清单可读（chat.js/feed.js 均在外置集合）', /"has":true/.test(pre6 || ''), pre6);
  const inject = (names) => evalJs(`(function(){var ns=${JSON.stringify(names)};
    ns.forEach(function(n){var s=document.createElement('script');s.src='/x/js/'+n;
      s.onerror=function(){window.__mochiExtFail=(window.__mochiExtFail||[]).concat(n);};
      document.head.appendChild(s);});
    return true;})()`);
  // 波 1：chat.js 自愈到位（进 __mochiLoaded）、feed.js 真失败（从 loaded 摘掉＋把它真身地址钉成
  // 404＝模拟从未加载成功且怎么重试都取不到；#1035 后真阶梯会在 26s 那波把裸址成功的文件真取回，
  // 只摘 loaded 已经造不出「真失败」了）
  pinJsFail = 'feed.js';
  await evalJs("(function(){window.__mochiLoaded=(window.__mochiLoaded||[]).filter(function(f){return f!=='feed.js';});return true;})()");
  await inject(['chat.js', 'feed.js']);
  await sleep(1500);
  const r6a = await ringOf(ERR_KEY, '资源加载失败');
  const r6b = await ringOf(ERR_KEY, '[外置包');
  ok('B6a 首拉失败不逐条进错误环（无「资源加载失败 <script>」条目）', r6a.length === 0, JSON.stringify(r6a).slice(0, 200));
  ok('B6b 静默窗内不出汇总条（聚合窗未到时不打扰）', r6b.length === 0, JSON.stringify(r6b).slice(0, 200));
  // 汇总窗长度随自愈阶梯演进（#802 三波 20s → #1035 加换址逃生首波后 34s），这里不写死睡到某个
  // 秒数，只「等到条出现为止」——同一条断言在两种窗口下都成立，红/绿副本共用一份脚本。
  let r6c = [];
  for (let i = 0; i < 90; i++) {
    r6c = await ringOf(ERR_KEY, '[外置包');
    if (r6c.length) break;
    await sleep(500);
  }
  ok('B6c 汇总恰一条「真失败」且只点名未到位文件（feed.js；chat.js 已自愈不点名）',
    r6c.length === 1 && /真失败/.test(r6c[0] || '') && /feed\.js/.test(r6c[0] || '') && !/chat\.js/.test(r6c[0] || ''),
    JSON.stringify(r6c).slice(0, 240));
  pinJsFail = null; // 波 1 判完即放开：feed.js 回到「正常可取」，后面波次/还原按真实状态走
  // 波 2：两个早已加载到位的外置包「首拉失败后又自愈」→ 汇总一条「已自愈」
  const healed = JSON.parse(await evalJs("JSON.stringify((window.__mochiExtFiles||[]).filter(function(f){return (window.__mochiLoaded||[]).indexOf(f)>=0;}).slice(0,2))") || '[]');
  await inject(healed);
  let r6d = await ringOf(ERR_KEY, '[外置包');
  for (let i = 0; i < 90 && r6d.length < 2; i++) {
    await sleep(500);
    r6d = await ringOf(ERR_KEY, '[外置包');
  }
  ok('B6d 自愈路径汇总一条「已自愈」且条数不随文件数膨胀（2 文件 = 1 条）',
    r6d.length === 2 && /已自愈/.test(r6d[1] || '') && /2 个功能包/.test(r6d[1] || ''),
    JSON.stringify(r6d).slice(0, 300));
  ok('B6e 全程零「资源加载失败」逐条噪音', (await ringOf(ERR_KEY, '资源加载失败')).length === 0);
  // 还原人为失败态：feed.js 记回已加载、注入名清出 __mochiExtFail——
  // #802 自愈引擎波次跟 load 事件（夹具里 load 偏晚），波次落进本窗口时会看到
  // 人为缺口而如实补 [ext-recovery]（产品行为正确，见 Z 处说明）。
  await evalJs("(function(){window.__mochiLoaded=(window.__mochiLoaded||[]).concat(['feed.js']);window.__mochiExtFail=(window.__mochiExtFail||[]).filter(function(f){return f!=='feed.js'&&f!=='chat.js';});return true;})()");

  // ---- B7 断网期网络失败不记（修前：version.json 轮询刷 6 条「网络失败」） + 反向对照 ----
  await evalJs("try{localStorage.removeItem('" + NET_KEY + "');}catch(e){} true");
  await evalJs("Object.defineProperty(navigator,'onLine',{configurable:true,get:function(){return false;}}); true");
  await evalJs("fetch('http://127.0.0.1:59999/mochi917-off').then(function(){return 'ok';},function(){return 'err';})");
  const n7a = await ringOf(NET_KEY, '');
  // 网络失败环条目无 msg 字段（{t,u,s}）→ 直接按 u 过滤
  const n7aU = await evalJs("(function(){try{var a=JSON.parse(localStorage.getItem('" + NET_KEY + "')||'[]');return JSON.stringify((a||[]).map(function(x){return x&&x.u;}).filter(function(u){return /mochi917-off/.test(String(u));}));}catch(e){return '[]';}})()");
  ok('B7a 浏览器自报离线时的网络失败不记（onLine=false + status 0）', JSON.parse(n7aU || '[]').length === 0, '环=' + JSON.stringify(n7a).slice(0, 120) + ' 命中=' + n7aU);
  await evalJs("try{delete navigator.onLine;}catch(e){} true");
  await evalJs("fetch('http://127.0.0.1:59999/mochi917-on').then(function(){return 'ok';},function(){return 'err';})");
  const n7bU = await evalJs("(function(){try{var a=JSON.parse(localStorage.getItem('" + NET_KEY + "')||'[]');return JSON.stringify((a||[]).map(function(x){return x&&x.u;}).filter(function(u){return /mochi917-on/.test(String(u));}));}catch(e){return '[]';}})()");
  ok('B7b 反向对照：在线时同类失败照记（不放走真网络故障）', JSON.parse(n7bU || '[]').length === 1, '命中=' + n7bU);
  // 有响应码的失败（404）离线也照记：离线放行只针对 status=0
  await evalJs("Object.defineProperty(navigator,'onLine',{configurable:true,get:function(){return false;}}); true");
  await evalJs("fetch('/mochi917-404-none').then(function(r){return r.status;},function(){return 'err';})");
  const n7cU = await evalJs("(function(){try{var a=JSON.parse(localStorage.getItem('" + NET_KEY + "')||'[]');return JSON.stringify((a||[]).map(function(x){return x&&x.u;}).filter(function(u){return /mochi917-404-none/.test(String(u));}));}catch(e){return '[]';}})()");
  ok('B7c 有响应码的失败（404）不受离线放行影响，照记', JSON.parse(n7cU || '[]').length === 1, '命中=' + n7cU);
  await evalJs("try{delete navigator.onLine;}catch(e){} true");

  // ---- Z 零 JS 异常 ----
  // B6 人为把 feed.js 钉成「永失败」，#802 自愈引擎按设计会往 __jsErrors 补一条
  // [ext-recovery] 点名（真实用户场景里外置包是「首拉失败后自愈」，不会走这条），
  // 属夹具诱发的预期行；Z 只看除它之外的异常。
  const errs = await evalJs('window.__jsErrors ? window.__jsErrors.length : -1');
  const extRec = errs > 0 ? (await evalJs("JSON.stringify((window.__jsErrors||[]).filter(function(e){return /^\\[ext-recovery\\]/.test(String(e));}))") || '[]') : '[]';
  const extN = JSON.parse(extRec || '[]').length;
  const errList = errs > 0 ? await evalJs("JSON.stringify((window.__jsErrors||[]).filter(function(e){return !/^\\[ext-recovery\\]/.test(String(e));}))") : '';
  ok('Z 页面零 JS 异常（__jsErrors=' + errs + '，其中夹具诱发 [ext-recovery] ' + extN + ' 条）', errs === -1 || JSON.parse(errList || '[]').length === 0, errList);
} catch (e) {
  fail++;
  console.error('❌ B 组执行异常：' + (e && e.message));
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}

console.log('\n#917 verify-diag-noise：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
