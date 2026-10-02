// verify-perf-check-live.mjs — #770 卡顿自检运行时行为断言（无头 Chrome，测构建产物 index.html）
// 配套源级脚本 verify-perf-check.mjs（A1~A26+）。红米 K80 Chrome 实报复现：
//   ①旧码停在设置页自检，「掉帧集中」归因到桌面图标（该机报「占卜(100%)」）——本脚本在
//     桌面人为制造阻塞，断言掉帧归因为当前页（旧码在桌面也只会报某个图标名）；
//   ②阈值自适应 jankMs 落在 [24,34]；报告含平均 fps/正常帧间隔/采样页面分布；
//   ③判「流畅」但确有掉帧时结论说真话（可忽略），不再自称「未捕获掉帧」。
// —— #934 追加（红米 K80 Chrome 自检 docx：平均 24.2fps 与 16.4ms 自相矛盾；「掉帧集中：
//    朋友圈（该页 0.5% vs 全窗 1%）」把停留最久的页当集中页；后台占比提示恒不触发；最长
//    1630ms 无归因且 >250ms 的亮屏阻塞被当后台剔除）——
//   C1 亮屏下的 420ms 阻塞＝前台冻结：不再计入 hid，单独点名并进最慢帧现场（旧码恒 hid=1 隐身）
//   C2 长任务补归因：最长的三次带「第几秒·哪页」（旧码只有 N 次/最长两个孤数）
//   C3 集中页按「掉帧率」选（旧码按计数＝选中停留最久、掉帧率更低的页）
//   C5 fps/后台占比按「实测时长」（窗口 C 伪造 2.5s 后台：fps 分母＝前台，占比提示按秒触发）
//   C6 各页掉帧率相当 → 如实报「分散」而不是点名某页
// —— #941 追加（报告可读性三处：①现场图例按需＋补「键盘期」解释；②「与上次对比」行；
//    ③长任务按页面归总）——
//   D1 图例与现场标记一一对应（旧码恒附「切页后/前台冻结」解释、且「键盘期」标记无解释）
//   D2 长任务按页面归总行（窗口 B 两页各灌阻塞：归总数＝前台任务数、两页均点名）
//   E1 旧格式上次记录（无掉帧数）不出对比行＋跑完 LAST_KEY 升级为新格式；
//      无标记现场 → 图例整段不出现（旧码恒附解释＝有牙）
//   E2 新格式上次记录 → 对比行含掉帧/帧率/最慢/前台冻结/长任务 + 相对时间 + 时长档备注
// 用法：node build.mjs && node tools/verify-perf-check-live.mjs（隔离验证：MOCHI_ROOT=<副本目录>）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
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

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const cdpPort = 9900 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pchk-live-' + Date.now()),
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
function cdp(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EX:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'ERR:' + e.message; }
}
const READ_REP = `JSON.stringify((function(){var r=window.__perfRep||{};return{frames:r.frames,janky:r.janky,severe:r.severe,worst:r.worst,hid:r.hid,fz:r.fz,fzWorst:r.fzWorst,jankMs:r.jankMs,bgMs:r.bgMs,effMs:r.effMs,ms:r.ms,spanMs:r.spanMs,stopped:r.stopped,period:r.period,fps:r.fps,verdict:r.verdict,jankPct:r.jankPct,topPage:r.topPage,topCnt:r.topCnt,pages:r.pages,pageFrames:r.pageFrames,scene:r.scene,lt:r.lt?{ok:r.lt.ok,n:r.lt.n,worst:r.lt.worst,bgN:r.lt.bgN,agg:r.lt.agg||null,top:r.lt.top}:null,prev:r.prev||null,text:r.text||''};})())`;
async function waitRep(maxMs) {
  for (let i = 0; i < Math.ceil(maxMs / 300); i++) { await sleep(300); if (await evalJs('!!window.__perfRep') === true) return true; }
  return false;
}

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html?x=' + Date.now() });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(700);

const b1 = await evalJs("typeof window.mochiPerfCheck + '|' + typeof window.mochiPerfCheck.start");
ok(b1 === 'object|function', 'B1 桌面产物挂出 mochiPerfCheck.start', String(b1));

// ===== 窗口 A（8s，手机桌面）：B 组原有断言 + C1 前台冻结 + C2 长任务归因 =====
// 挂 1px 常驻动画保证持续出帧；0.6s/1.2s 各阻塞 80ms（长任务+掉帧），1.8s 阻塞 420ms（>BG_GAP＝前台冻结）
// 三次阻塞都排在窗口前 1/4：页面启动期 setTimeout 有 ~1s 延迟，且长任务条目在阻塞结束后才投递给
// 观察器——贴窗尾会被 finish() 的 disconnect 抢掉（实测踩过：条目丢了、掉帧还在）
await evalJs(`(function(){
  var st=document.createElement('style');st.textContent='@keyframes vk770{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';document.head.appendChild(st);
  var d=document.createElement('div');d.style.cssText='position:fixed;top:0;left:0;width:2px;height:2px;opacity:.01;z-index:99999;animation:vk770 1s linear infinite;';document.body.appendChild(d);
  setTimeout(function(){var t=Date.now();while(Date.now()-t<80){}},600);
  setTimeout(function(){var t=Date.now();while(Date.now()-t<80){}},1200);
  setTimeout(function(){var t=Date.now();while(Date.now()-t<420){}},1800);
  window.__perfRep=null;
  window.mochiPerfCheck.start(8000).then(function(r){window.__perfRep=r;});
  return true;
})()`);
await waitRep(11000);
const rep = JSON.parse(await evalJs(READ_REP));

ok(rep.frames > 100, 'B2 检测窗内持续采到帧（frames=' + rep.frames + '）');
ok(rep.janky >= 1, 'B3 人为阻塞被捕获为掉帧（janky=' + rep.janky + ' worst=' + rep.worst + 'ms）');
ok(rep.worst >= 60, 'B4 最慢帧 ≥60ms（worst=' + rep.worst + '）');
const pageKeys = Object.keys(rep.pages || {});
ok(pageKeys.length > 0 && pageKeys.every((k) => k === 'main'), 'B5 桌面上的掉帧归因为 main 而非桌面图标名（旧码永远报不出 main＝本条 RED 有牙）', 'pages=' + JSON.stringify(rep.pages));
ok(rep.pageFrames && rep.pageFrames.main > 0, 'B6 按页采样帧数入账（pageFrames.main=' + (rep.pageFrames && rep.pageFrames.main) + '）');
ok(rep.jankMs >= 24 && rep.jankMs <= 34, 'B7 自适应阈值落在 [24,34]ms（jankMs=' + rep.jankMs + ' period=' + rep.period + '）');
ok(rep.period >= 4 && rep.period <= 100, 'B8 实测刷新周期合理（period=' + rep.period + 'ms）');
ok(/平均 [\d.]+fps/.test(rep.text) && /正常帧间隔约 \d+(\.\d+)?ms/.test(rep.text), 'B9 报告含平均 fps 与正常帧间隔');
ok(rep.text.indexOf('掉帧 ' + rep.janky + ' 帧') >= 0, 'B10 掉帧统计行在（janky=' + rep.janky + '）');
if (rep.verdict === '流畅' && rep.janky > 0) {
  ok(rep.text.includes('可忽略') && !rep.text.includes('（本窗口未捕获掉帧）'), 'B11 判「流畅」但确有掉帧 → 结论说真话不再自称未捕获', rep.text.split('\n')[0]);
  ok(!rep.text.includes('属正常波动，无需处理') && /但窗口内有[^—]*前台冻结 1 次/.test(rep.text), 'B12 #934 零星掉帧但窗内有前台冻结/长任务 → 建议不武断「无需处理」并点名', rep.text.split('\n')[0]);
} else {
  ok(true, 'B11 本轮判级=' + rep.verdict + '（非「流畅+零星掉帧」组合，文案断言跳过）');
  ok(true, 'B12 跳过');
}
ok(rep.text.includes('采样期间主要在：手机桌面'), 'B13 报告含采样页面分布', rep.text.split('\n')[2] || '');
if (rep.janky < 3) ok(!rep.text.includes('掉帧集中：'), 'B14 少于 3 帧掉帧不输出「掉帧集中」页（janky=' + rep.janky + '）');
else ok(rep.text.includes('掉帧集中：手机桌面'), 'B14 ≥3 帧掉帧输出「掉帧集中」且归因 main（janky=' + rep.janky + '）', rep.text);

// —— C1：420ms 亮屏阻塞＝前台冻结（旧码按「后台冻结」剔除＝hid=1、报告里隐身）——
ok(rep.hid === 0, 'C1a #934 亮屏下的 >250ms 阻塞不再被当「后台冻结」剔除（hid=' + rep.hid + '；旧码此处恒为 1）');
ok(rep.fz >= 1 && rep.fzWorst >= 400, 'C1b #934 识别为前台冻结并记最长（fz=' + rep.fz + ' fzWorst=' + rep.fzWorst + 'ms）');
ok(rep.text.includes('· 前台冻结'), 'C1c #934 报告单独点名前台冻结');
ok((rep.scene || []).some((s) => s && s.fz === 1) && rep.text.includes('·前台冻结'), 'C1d #934 最慢帧现场带「前台冻结」标记', JSON.stringify(rep.scene));

// —— C2：长任务归因（旧码只有「N 次/最长 Xms」两个孤数）——
ok(!!(rep.lt && rep.lt.ok && rep.lt.n >= 1), 'C2a 长任务照常观测（n=' + (rep.lt && rep.lt.n) + '）');
const lt0 = rep.lt && rep.lt.top && rep.lt.top[0];
ok(!!(lt0 && lt0.ms >= 400 && lt0.pg === 'main'), 'C2b #934 最长长任务带「第几秒/哪页」归因（' + JSON.stringify(lt0) + '）');
ok(/最长的 \d+ 次：第[\d.]+秒 手机桌面 \d+ms/.test(rep.text), 'C2c #934 报告正文含「第X秒 手机桌面」归因', rep.text);

// —— D1：图例按需（#941）——旧码无条件恒附「切页后/前台冻结」两段解释、且「键盘期」标记没有
//      对应解释；断言图例集合与现场真出现过的标记集合一一对应（窗口 A：有前台冻结，无切页后/键盘期）——
const scA = rep.scene || [];
const mkFz = scA.some((s) => s && s.fz === 1), mkKb = scA.some((s) => s && s.kb === 1), mkSw = scA.some((s) => s && s.sw === 1);
const lgFz = rep.text.includes('「前台冻结」＝'), lgKb = rep.text.includes('「键盘期」＝'), lgSw = rep.text.includes('「切页后」＝');
ok(mkFz === lgFz && mkKb === lgKb && mkSw === lgSw, 'D1 #941 图例与现场标记一一对应（标记 fz/kb/sw=' + [mkFz, mkKb, mkSw] + '；图例=' + [lgFz, lgKb, lgSw] + '）', rep.text);
ok(mkFz && lgFz, 'D1b 有前台冻结标记 → 对应解释在（防修过头：按需过滤不得连真标记的解释一起删）');
ok(!lgSw, 'D1c 本窗口无「切页后」标记 → 该解释不出现（旧码无条件恒附＝本条有牙）', (rep.text.split('\n').find((l) => l.includes('最慢帧现场')) || '（未捕获现场行）'));

// ===== 窗口 B（6s）：朋友圈期灌 4 次阻塞、手机桌面期灌 5 次 → 按计数选页会错选手机桌面（旧码），
//       按掉帧率选页正确落在朋友圈（C3）=====
await evalJs(`(function(){
  function blk(ms){var t=Date.now();while(Date.now()-t<ms){}}
  function showFeed(on){
    var f=document.getElementById('page-feed'); if(!f) return;
    if(on){ f.removeAttribute('hidden'); f.style.zIndex='9999'; }
    else { f.setAttribute('hidden',''); f.style.zIndex=''; }
  }
  window.__perfRep=null;
  window.mochiPerfCheck.start(6000).then(function(r){window.__perfRep=r;});
  setTimeout(function(){ showFeed(true); }, 700);
  setTimeout(function(){ blk(80); }, 900);
  setTimeout(function(){ blk(80); }, 1150);
  setTimeout(function(){ blk(80); }, 1400);
  setTimeout(function(){ blk(80); }, 1650);
  setTimeout(function(){ showFeed(false); }, 1900);
  setTimeout(function(){ blk(80); }, 2600);
  setTimeout(function(){ blk(80); }, 3200);
  setTimeout(function(){ blk(80); }, 3800);
  setTimeout(function(){ blk(80); }, 4400);
  setTimeout(function(){ blk(80); }, 5000);
  return true;
})()`);
await waitRep(9000);
const repB = JSON.parse(await evalJs(READ_REP));
// curPage() 归因输出的是页面显示名（'page-feed' → pageName → '朋友圈'；手机桌面特例仍为 'main'），
// 所以二级页在报告里的键是中文名——断言按显示名取
const FEED_KEY = '朋友圈';
const pjFeed = (repB.pages && repB.pages[FEED_KEY]) || 0, pjMain = (repB.pages && repB.pages.main) || 0;
const pfFeed = (repB.pageFrames && repB.pageFrames[FEED_KEY]) || 0, pfMain = (repB.pageFrames && repB.pageFrames.main) || 0;
ok(pjMain > pjFeed && pfFeed > 30, 'C3pre 场景成立：桌面掉帧计数更多、朋友圈样本足够（main ' + pjMain + '/' + pfMain + '，朋友圈 ' + pjFeed + '/' + pfFeed + '）');
ok(repB.topPage === FEED_KEY, 'C3a #934 集中页按掉帧率选（topPage=' + repB.topPage + '；旧码按计数会选 main）', JSON.stringify({ pages: repB.pages, pageFrames: repB.pageFrames }));
ok(repB.text.includes('掉帧集中：朋友圈') && !repB.text.includes('掉帧集中：手机桌面'), 'C3b #934 不再把停留最久（计数最多）的页当集中页', repB.text);

// —— D2：长任务按页面归总（#941）——窗口 B 两页各灌阻塞：归总数＝前台任务数、两页均点名、
//      计数与灌入对应（旧码只有「N 次/最长 Xms」两个孤数，29 次那种窗口看不出集中在哪页）——
const agB = (repB.lt && repB.lt.agg) || null;
const agPages = agB ? Object.keys(agB).filter((k) => agB[k] && agB[k].n > 0) : [];
const agN = agB ? agPages.reduce((s, k) => s + agB[k].n, 0) : 0;
ok(!!agB && agPages.includes('main') && agPages.includes(FEED_KEY) && agN >= 5, 'D2pre 场景成立：前台长任务按页归总、两页均有（' + JSON.stringify(agB) + '）');
ok(!!repB.lt && (repB.lt.n - (repB.lt.bgN || 0)) === agN, 'D2a #941 归总数＝前台长任务数、后台期不计入（lt.n=' + (repB.lt && repB.lt.n) + ' bgN=' + (repB.lt && repB.lt.bgN) + ' agg=' + agN + '）');
ok(!!agB && (agB[FEED_KEY] || {}).n >= 3 && (agB.main || {}).n >= 4, 'D2b #941 归总计数与灌入对应（朋友圈期灌 4 次、桌面期灌 5 次）', JSON.stringify(agB));
const agLine = repB.text.split('\n').find((l) => l.includes('· 长任务按页面：'));
ok(!!agLine && agLine.includes('手机桌面 ') && agLine.includes('朋友圈 '), 'D2c #941 报告出现按页面归总行且两页均点名', agLine || repB.text);

// ===== 窗口 C（4.5s）：伪造 0.9s~3.4s 为后台（document.hidden 假 getter + visibilitychange）
//       → fps 分母＝前台 2 秒、后台占比按秒触发（旧码 fps 分母＝整窗、占比提示恒不触发）=====
await evalJs(`(function(){
  window.__perfRep=null;
  window.mochiPerfCheck.start(4500).then(function(r){window.__perfRep=r;});
  setTimeout(function(){
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});
    document.dispatchEvent(new Event('visibilitychange'));
  }, 900);
  setTimeout(function(){
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  }, 3400);
  return true;
})()`);
await waitRep(8000);
const repC = JSON.parse(await evalJs(READ_REP));
const oldFps = Math.round(repC.frames * 1000 / repC.ms * 10) / 10;
ok(repC.bgMs >= 2200 && repC.bgMs <= 2800, 'C4a #934 后台时长实测入账（bgMs=' + repC.bgMs + ' 期望≈2500）');
ok(Math.abs(repC.effMs - (repC.spanMs - repC.bgMs)) <= 5 && repC.spanMs >= repC.ms,
  'C4b #934/#1412⑧ 前台有效时长＝「实测窗口－实测后台」（effMs=' + repC.effMs + ' spanMs=' + repC.spanMs + ' ms=' + repC.ms + ' bgMs=' + repC.bgMs + '）——旧式拿名义档位当被减数，提前结束与隐藏拖长两种情形下都会算歪',
  'eff=' + repC.effMs + ' span-bg=' + (repC.spanMs - repC.bgMs));
ok(repC.effMs > 0 && Math.abs(repC.fps - repC.frames * 1000 / repC.effMs) < 1.5, 'C4c #934 fps 按前台时长算（fps=' + repC.fps + '；整窗口径会是 ' + oldFps + '）');
const mC = repC.text.match(/约 ([\d.]+)% 时间在后台\/锁屏/);
ok(!!mC && repC.text.includes('已剔除、不影响判定'), 'C5a #934 后台占比过半按实测时长点名（旧码拿冻结段数与帧数比＝恒不触发）', repC.text);
ok(!!mC && Math.abs(parseFloat(mC[1]) - repC.bgMs / repC.ms * 100) <= 4, 'C5b 点位与 bgMs 口径一致（文案 ' + (mC && mC[1]) + '% vs 实测 ' + (Math.round(repC.bgMs / repC.ms * 1000) / 10) + '%）');
ok(/前台约 \d+ 秒，后台\/锁屏 \d+ 秒已剔除/.test(repC.text), 'C5c 采样行写明前台/后台秒数', repC.text.split('\n')[1] || '');

// ===== 窗口 D（5.6s）：两页掉帧「率」相当（朋友圈 4 次阻塞 / 桌面 8 次，各占各自停留时长的同一比例）
//       → 如实报「分散」而不是点名某页（旧码按计数会输出「掉帧集中：手机桌面」）=====
await evalJs(`(function(){
  function blk(ms){var t=Date.now();while(Date.now()-t<ms){}}
  function showFeed(on){
    var f=document.getElementById('page-feed'); if(!f) return;
    if(on){ f.removeAttribute('hidden'); f.style.zIndex='9999'; }
    else { f.setAttribute('hidden',''); f.style.zIndex=''; }
  }
  window.__perfRep=null;
  window.mochiPerfCheck.start(5600).then(function(r){window.__perfRep=r;});
  setTimeout(function(){ showFeed(true); }, 500);
  setTimeout(function(){ blk(80); }, 700);
  setTimeout(function(){ blk(80); }, 1050);
  setTimeout(function(){ blk(80); }, 1400);
  setTimeout(function(){ blk(80); }, 1750);
  setTimeout(function(){ showFeed(false); }, 2100);
  setTimeout(function(){ blk(80); }, 2500);
  setTimeout(function(){ blk(80); }, 2850);
  setTimeout(function(){ blk(80); }, 3200);
  setTimeout(function(){ blk(80); }, 3550);
  setTimeout(function(){ blk(80); }, 3900);
  setTimeout(function(){ blk(80); }, 4250);
  setTimeout(function(){ blk(80); }, 4600);
  setTimeout(function(){ blk(80); }, 4950);
  return true;
})()`);
await waitRep(9000);
const repD = JSON.parse(await evalJs(READ_REP));
const rjFeed = (repD.pages && repD.pages[FEED_KEY]) || 0, rjMain = (repD.pages && repD.pages.main) || 0;
const rfFeed = (repD.pageFrames && repD.pageFrames[FEED_KEY]) || 0, rfMain = (repD.pageFrames && repD.pageFrames.main) || 0;
ok(rjMain >= 3 && rjFeed >= 3 && rfFeed >= 30 && rfMain >= 30, 'C6pre 场景成立：两页各 ≥3 帧掉帧、样本足够（main ' + rjMain + '/' + rfMain + '，朋友圈 ' + rjFeed + '/' + rfFeed + '）');
ok(repD.text.includes('掉帧分散') && !repD.text.includes('掉帧集中：'), 'C6 #934 各页掉帧率相当 → 如实报「分散」而不是点名某页（旧码会点名计数最多的桌面）', repD.text);

const readLast = async () => { try { return JSON.parse(await evalJs("(function(){try{return localStorage.getItem('xy-home-v2:perf-check-last')||'null';}catch(e){return 'null';}})()")); } catch (e) { return null; } };

// ===== 窗口 E1（4s）：上次记录为旧格式（升级前的 {t,verdict,jankPct}，无掉帧数）→ 不出「与上次对比」
//       行；跑完后 LAST_KEY 升级为新格式（下轮起可对比）；本窗口通常无阻塞 → 现场无标记时图例整段不出现 =====
await evalJs(`(function(){
  try { localStorage.setItem('xy-home-v2:perf-check-last', JSON.stringify({ t: Date.now() - 300000, verdict: '流畅', jankPct: 0.5 })); } catch (e) {}
  window.__perfRep=null;
  window.mochiPerfCheck.start(4000).then(function(r){window.__perfRep=r;});
  return true;
})()`);
await waitRep(7000);
const repE1 = JSON.parse(await evalJs(READ_REP));
ok(!repE1.text.includes('与上次对比'), 'E1a #941 旧格式上次记录（无掉帧数）不输出对比行', repE1.text);
ok(!!repE1.prev && repE1.prev.janky === undefined && typeof repE1.prev.verdict === 'string', 'E1b 旧格式记录被读入 rep.prev、如实判为不可对比', JSON.stringify(repE1.prev));
const last1 = await readLast();
ok(!!last1 && typeof last1.janky === 'number' && typeof last1.ms === 'number', 'E1c 旧格式记录跑完后 LAST_KEY 升级为新格式（下轮起可对比）', JSON.stringify(last1));
const scE1 = repE1.scene || [];
const mkE1 = scE1.some((s) => s && (s.fz === 1 || s.kb === 1 || s.sw === 1));
if (scE1.length > 0) {
  ok(!mkE1 && !repE1.text.includes('「切页后」＝') && !repE1.text.includes('「前台冻结」＝') && !repE1.text.includes('「键盘期」＝'), 'E1d #941 现场无任何标记 → 图例整段不出现（旧码恒附「切页后/前台冻结」两段解释＝本条有牙）', repE1.text);
} else {
  ok(true, 'E1d 本窗口未捕获掉帧现场（场景不成立，跳过）');
}

// ===== 窗口 E2（5s）：上次记录为新格式 → 对比行含箭头各项＋相对时间＋时长档备注；
//       跑完摘要续写全字段（连续两轮对比可用）=====
await evalJs(`(function(){
  try { localStorage.setItem('xy-home-v2:perf-check-last', JSON.stringify({ t: Date.now() - 17*60000, verdict: '轻度', jankPct: 5, ms: 30000, frames: 1800, janky: 42, worst: 210, fz: 2, fzWorst: 430, fps: 57.3, ltN: 7, ltWorst: 320 })); } catch (e) {}
  window.__perfRep=null;
  window.mochiPerfCheck.start(5000).then(function(r){window.__perfRep=r;});
  setTimeout(function(){var t=Date.now();while(Date.now()-t<80){}},800);
  setTimeout(function(){var t=Date.now();while(Date.now()-t<80){}},1600);
  return true;
})()`);
await waitRep(8000);
const repE2 = JSON.parse(await evalJs(READ_REP));
ok(repE2.janky >= 1 && repE2.worst >= 60 && !!(repE2.lt && repE2.lt.n >= 1), 'E2pre 场景成立：本轮有掉帧与长任务（janky=' + repE2.janky + ' worst=' + repE2.worst + ' ltN=' + (repE2.lt && repE2.lt.n) + '）');
const e2line = repE2.text.split('\n').find((l) => l.includes('· 与上次对比'));
ok(!!e2line, 'E2a #941 新格式上次记录 → 出现「与上次对比」行', repE2.text);
ok(/约 17 分钟前/.test(repE2.text), 'E2b 对比行带相对时间（约 17 分钟前）', e2line || repE2.text);
ok(repE2.text.includes('掉帧 42→' + repE2.janky + ' 帧'), 'E2c 掉帧 X→Y 帧');
ok(repE2.text.includes('平均帧率 57.3→' + repE2.fps + 'fps'), 'E2d 平均帧率 A→Bfps');
ok(repE2.text.includes('最慢 210→' + repE2.worst + 'ms'), 'E2e 最慢 C→Dms');
ok(repE2.text.includes('前台冻结 2→' + repE2.fz + ' 次'), 'E2f 前台冻结 N→M 次（摘要新字段）');
ok(repE2.text.includes('长任务 7→' + repE2.lt.n + ' 次'), 'E2g 长任务 P→Q 次（摘要新字段）');
ok(repE2.text.includes('上次为 30 秒档，时长不同仅供粗略对照'), 'E2h 时长档不同 → 附「仅供粗略对照」备注');
const last2 = await readLast();
ok(!!last2 && typeof last2.janky === 'number' && typeof last2.fps === 'number' && typeof last2.ltN === 'number', 'E2i 本轮跑完 LAST_KEY 已是新格式全字段摘要（连续对比可用）', JSON.stringify(last2));


// ===== 窗口 F（#1412）：卡屏自检长窗口的两条命——切后台到点照样结算 ＋ 提前结束有出口 =====
// 复现尺子＝真造隐藏态（另开一张标签页抢前台），不靠改 document.hidden 的属性骗自己。
const modalState = () => evalJs(`(function(){
  var m = document.getElementById('modal-mask'), t = document.getElementById('modal-title'),
      okB = document.getElementById('modal-ok');
  return { vis: !!(m && !m.hidden), title: t ? t.textContent : '', ok: okB ? okB.textContent : '' };
})()`);
const clickId = (id) => evalJs(`(function(){ var b = document.getElementById('${id}'); if (!b) return false; b.click(); return true; })()`);
let hideTarget = null;
async function hidePage() {
  const t = await cdp('Target.createTarget', { url: 'about:blank' });
  if (!t || !t.targetId) return false;
  hideTarget = t.targetId;
  const ses = await cdp('Target.attachToTarget', { targetId: hideTarget, flatten: true });
  const sid = ses && ses.sessionId;
  if (!sid) return false;
  await cdp('Page.enable', {}, sid);
  await cdp('Page.bringToFront', {}, sid);
  await sleep(300);
  return true;
}
async function showPage() {
  if (hideTarget) { try { await cdp('Target.closeTarget', { targetId: hideTarget }); } catch (e) {} hideTarget = null; }
  try { await cdp('Page.bringToFront'); } catch (e) {}
  await sleep(400);
}

await evalJs(`(function(){ window.__perfRep=null; window.__tHide=0; window.mochiPerfCheck.start(6000).then(function(r){ window.__perfRep=r; }); return true; })()`);
await sleep(800);
await hidePage();
await evalJs('window.__tHide = Date.now(); true');
const hidState = await evalJs('document.hidden');
ok(hidState === true, 'F0pre 夹具自证：切走后 document.hidden 当场读回 true（这格不成立则下面几条按环境不满足处理，不许算通过）', String(hidState));
// 隐藏期轮询 70 秒：Chromium 对隐藏页的定时器节流到分钟级（5 分钟后整页冻结），所以「兜底 timer
//   在不回前台的情况下多久落账」本身就是环境量——量得到就报数，量不到如实 SKIP，不判红
//   （同站内「无头拿不到的形态报 SKIP／exit 2，别判红」的规矩）。
let settledWhileHidden = null;
for (let i = 0; i < 35; i++) {
  await sleep(2000);
  if (await evalJs('!!window.__perfRep') === true) { settledWhileHidden = Date.now() - (await evalJs('window.__tHide')); break; }
  if (await evalJs('document.hidden') !== true) break; // 被别的东西抢回前台，本轮作废
}
if (settledWhileHidden !== null) {
  ok(true, 'F1 #1412⑧ 隐藏期兜底 timer 落账，实测不回的此刻已结算（' + settledWhileHidden + 'ms 后）＝不再需要用户回来才出报告');
} else {
  console.log('  - F1 SKIP：本机隐藏页定时器被内核节流到分钟级，70 秒内未落账＝无头拿不到这一形态，不判红');
}
await showPage();
await sleep(1200);
const f1 = JSON.parse(await evalJs('JSON.stringify((function(){var r=window.__perfRep;return{running:window.mochiPerfCheck.running(),got:!!r,spanMs:r?r.spanMs:null,bgMs:r?r.bgMs:null,effMs:r?r.effMs:null,ms:r?r.ms:null,text:r?r.text:""};})())'));
ok(f1.got === true && f1.running === false, 'F1b #1412⑧ 回到前台后 1 秒内一定结算（旧写法：窗口挂在 rAF 上，用户不回来就永远不出报告）', JSON.stringify({ got: f1.got, running: f1.running }));
ok(f1.spanMs > 0 && Math.abs(f1.effMs - (f1.spanMs - f1.bgMs)) <= 5,
  'F2 #1412⑧ 前台有效时长按「实测窗口－实测后台」算（spanMs 入账；旧账面拿名义档位当分母，隐藏期拖长后 bgMs 9664 甚至大于所选 ms 8000＝无从对账）',
  'span=' + f1.spanMs + ' bg=' + f1.bgMs + ' eff=' + f1.effMs + ' 所选=' + f1.ms);
ok(f1.spanMs >= f1.ms, 'F2b 实测窗口不短于所选档位（隐藏期拖长的部分照样进账面，不再拿名义值冒充）', 'span=' + f1.spanMs + ' ms=' + f1.ms);
ok(/结论不可用/.test(f1.text), 'F3 整段被挂起的窗口如实判「结论不可用」，不拿剔完后台的空壳下结论', (f1.text || '').split('\n').find((l) => l.indexOf('结论不可用') >= 0) || (f1.text || '').split('\n')[0]);
await clickId('modal-cancel');
await sleep(300);

await evalJs(`(function(){ window.__perfRep=null; window.mochiPerfCheck.start(120000).then(function(r){ window.__perfRep=r; }); return true; })()`);
await sleep(2000);
const keysF = await evalJs("Object.keys(window.mochiPerfCheck).sort().join('/')");
ok(/stop/.test(keysF), 'F4 #1412⑨ 导出面有 stop（旧面实测＝LAST_KEY/running/start，2 分钟与 5 分钟档一开只能干等，而电量自测、发烫自测都有出口）', keysF);
const runOnF = await evalJs("window.mochiPerfCheck.running()");
await clickId('row-perf-check');
await sleep(300);
const mRun = await modalState();
ok(runOnF === true && mRun.vis && mRun.title === '卡顿自检进行中' && mRun.ok === '结束并出报告',
  'F5 #1412⑨ 测试中再点那一行＝给「结束并出报告」弹窗（旧写法静默 return＝屏上什么也不发生，用户只能猜它还在不在跑）', mRun.title + '|' + mRun.ok);
await clickId('modal-ok');
await sleep(600);
const f6 = JSON.parse(await evalJs('JSON.stringify((function(){var r=window.__perfRep||{};return{stopped:r.stopped,spanMs:r.spanMs,ms:r.ms,text:r.text||"",running:window.mochiPerfCheck.running()};})())'));
ok(f6.stopped === 1 && f6.spanMs > 0 && f6.spanMs < 60000 && /提前结束/.test(f6.text),
  'F6 #1412⑧⑨ 点「结束并出报告」＝当场结算并在报告里写明提前结束（120 秒档只跑 2 秒也得出数字）', 'span=' + f6.spanMs + ' stopped=' + f6.stopped);
ok(!/采样 120 秒/.test(f6.text), 'F7 #1412⑧ 报告不许再按名义档位报采样秒数（回流＝提前结束仍写「采样 120 秒」的假账面）',
  (f6.text || '').split('\n').find((l) => l.indexOf('采样') === 0) || '');
await clickId('modal-cancel');
await sleep(300);

console.log(fail ? ('FAIL ' + pass + '/' + (pass + fail)) : ('ALL PASS ' + pass + '/' + (pass + fail)));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
