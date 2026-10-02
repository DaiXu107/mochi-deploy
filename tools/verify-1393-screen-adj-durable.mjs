// ===== 回归脚本 #1393：屏幕适配微调「调了就跳」与「调了不保存」，同一根因＝同一格两个主人 =====
// 用法：node tools/verify-1393-screen-adj-durable.mjs [--root <目录>]（需本机 Chrome/Edge）
//
// 实报（用户原话，iPhone 17 Pro／iOS27 Safari，「桌面打开」＝standalone；随附
// mochi-diag 同名导出件 mochi-screen-diag-2026-09-28-15-30-4213809377062.docx，那张单自己写着
// 「本机手调（屏幕位置设置）：bottom+8」与「--mochi-safe-bottom=calc(34px + 8px)…」、
// 键盘时间线 inner 恒 874 而 vv 在 874↔456 之间反复）：
//   ①「键盘及屏幕最底端上下跳动」
//   ②「在我自己调整了【屏幕适配微调】后屏幕也会莫名其妙抖动跳动，但是不调整【屏幕适配微调】，
//      就用默认状态，是正常的」
//   ③「【屏幕适配微调】设置后会没有保存，刷新重新进入网站就恢复默认状态」
// 并点名「这个问题其他设备型号也有出现」「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现」。
//
// ①② 是 #1318 那批（2026-09-27 做过、验证过、从未入库）病灶的键盘期那一面：#707 把「系统基准＋
// 本机偏移」做在写入方【外面】——一条 setInterval(applyBottom,1000) 往 --mochi-safe-bottom 写
// calc(env()+偏移)，而 #556/#530 两位系统写入方在键盘期钉 '0px'、收键后 removeProperty 回落
// env()。落值在两个值之间交替＝聊天输入栏/底部导航那一条 padding-bottom 每秒换一次档＝用户所见
// 的「键盘及屏幕最底端上下跳动」；偏移=0 时复述循环整条不写＝「不调就正常」逐字对上。
// 本批把 #1318 整件重放到干净底本（包装层与复述定时器整体删除，偏移由 screenVarPx／bottomSafeCss
// 在写入方内部叠加＝一个属性只剩一个主人）；跳动的通用两面（standalone 回落支／高度轴迟滞）由
// tools/verify-1318-screen-adj-single-owner.mjs 守，本脚本 A 组补的是**键盘在场那一段**——
// 因为用户那句原话里跳动的时机就是打字时，而那条尺子的采样窗不含键盘。
//
// ③ 是本批新收的一半：七轴的落库是全站唯一走【裸 localStorage.setItem ＋ 吞异常 try】的用户设置。
// LS 写不进去时（同源 github.io 的存储配额被别的站点吃满／隐私模式／Edge·荣耀杀进程回滚最后一次
// 磁盘提交／iOS 系统级清空网站数据——站内那条定期备份提醒就是为最后这条设的）面板当场见效、
// mochiScreenAdj.set() 照报成功，下一次冷启读回旧值/默认＝「设置后会没有保存，刷新就恢复默认」。
// 改法＝键名一字不改地把读写挪到数据层那条唯一的轨（内存缓存＋LS＋IndexedDB＋小键写日志），
// 回填迟到的那一份按 mochi-restore-done 重读补回。
//
// 夹具纪律（违反任一条都会在纯 HEAD 侧假绿）：
//   · G0 环境硬闸：真走完 开屏→必读公告滑到底→【确认进入】，.phone 的计算可见性必须是 visible，
//     且聊天输入栏那一条量得到 padding-bottom——base.css:108 有 .splash:not(.hide) ~ .phone
//     {visibility:hidden}，开屏没dismissed 时整棵 .phone 是 hidden 的（同族尺子踩过：读数全是 0
//     而看起来「没跳动」）。不过闸直接 exit 2 判「环境不满足」，不给后面读数打分。
//   · 判据只读【DOM 事实＋库里的值】：给 CSSStyleDeclaration.prototype.setProperty 装写计数器、
//     内联 --mochi-safe-bottom、.chat-input-row 的计算 padding-bottom 与底边、window.idbGet 的
//     回执、刷新后 mochiScreenAdj.all()。不读任何本批新加的 window 探针——否则纯 HEAD 侧红在
//     「没有这个 API」上，那就不是同一把尺子，也证明不了症状。
//   · 键盘在场用 visualViewport.height 覆写模拟（与 verify-ios-safe-bottom-kb.mjs 同款垫片），
//     判据取「vv 相对基线收缩 ≥60」这一个代码事实，零机型／零 UA 分支。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const root = normalize(arg('--root', dirname(new URL(import.meta.url).pathname.slice(1)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('被测根目录：' + root);

const results = [];
let envFail = null;
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? '  ✓ ' : '  ✗ ') + desc + (detail !== undefined ? '   [' + JSON.stringify(detail) + ']' : ''));
  return !!ok;
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cands = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
const chromePath = cands.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + Math.floor(Math.random() * 80));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1393-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); server.close(); chrome.kill(); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
// 每一发 CDP 调用都有上限：并行会话把机器压满时 Page.navigate/Runtime.evaluate 会整发不回来，
// 而「挂住」比「读数为红」更糟——挂住的脚本一行读数都不打，看上去和全绿一模一样。
const CDP_TIMEOUT_MS = Number(process.env.MOCHI_CDP_TIMEOUT || 60000);
const cdp = (method, params = {}) => new Promise((res) => { const id = ++msgId; let done = false; const t = setTimeout(() => { if (!done) { done = true; pend.delete(id); res({ __cdpTimeout: method }); } }, CDP_TIMEOUT_MS); pend.set(id, (r) => { if (done) return; done = true; clearTimeout(t); res(r); }); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.__cdpTimeout) { console.log('  [cdp timeout] ' + r.__cdpTimeout); return null; }
  if (r && r.exceptionDetails) {
    const t = ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || '').slice(0, 160);
    console.log('  [eval err] ' + t);
    return { __err: t };
  }
  return r && r.result ? r.result.value : null;
}

// ---------- S 组：逻辑锚（读产物源码——本批改的是「谁有资格往这一格落值／这一格落在哪条轨」） ----------
const ma = readFileSync(join(root, 'js', 'mobile-adapt.js'), 'utf8');
check('S1 七轴读数优先走数据层那条唯一的轨（xyStore.get＝内存缓存＋LS＋回填到的权威值）',
  ma.includes('raw = window.xyStore(GROOT).get(KEYS[k])'));
check('S2 七轴落库走同一条轨（0＝交回 remove 销账，非 0＝set 同写 LS＋IndexedDB＋小键日志）',
  ma.includes('if (v) s.set(KEYS[k], String(v)); else s.remove(KEYS[k]);'));
check('S3 回填迟到的那一份挂在 mochi-restore-done 上重读补回（LS 被清空过的设备当拍就见效，不等下次刷新）',
  ma.includes('try { adoptStored(); } catch (e) {} });'));
check('S4 删除型：落库不得退回「裸 localStorage 单写＋吞异常」那一条（＝本批③的病灶本体）',
  !/function lsSet\(k, v\) \{ try \{ if \(v\) localStorage\.setItem/.test(ma));
check('S5 删除型：按秒复述底部 calc 的那条定时器不得回来（#1318k 同一条，本批重放后仍在位）',
  !/setInterval\(applyBottom/.test(ma));
check('S6 底部唯一的尺子在位（键盘期钉 0 与偏移让位由同一支算，不由第二只手补）',
  ma.includes('function bottomSafeCss(base) {') && ma.includes("if (base === 'pin') return '0px';"));
check('S7 顶部/高度两轴由写入方叠加（漏一支＝摘掉包装层后系统每轮覆盖重校把用户调的偏移抹平）',
  ma.includes("screenVarPx('--mochi-safe-top', _safeTop)") && ma.includes("var _wantN = screenVarNum('--mochi-ios-h', vh);"));

// ---------- 页面夹具（写钩子与 LS 失败注入只在首次导航装一次；注入是否生效由 URL 决定，
//           避免 addScriptToEvaluateOnNewDocument 逐次累积把写计数器翻倍） ----------
let scriptArmed = false;
async function boot(mode) {
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 3, mobile: true, touch: true });
  if (!scriptArmed) {
    scriptArmed = true;
    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function(){
  window.__jsErrors=[];
  try { Object.defineProperty(navigator,'standalone',{configurable:true,value:true}); } catch(e){}
  if (location.search.indexOf('lsdead') >= 0) {
    var _si=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){ if(String(k).indexOf('xy-home-v2:')===0){ var e=new Error('QuotaExceededError'); e.name='QuotaExceededError'; e.code=22; throw e; } return _si.apply(this,arguments); };
  }
  window.__w=[]; window.__bottomWrites=0;
  var P=CSSStyleDeclaration.prototype, _sp=P.setProperty;
  P.setProperty=function(n,v){ if(String(n)==='--mochi-safe-bottom'){ window.__bottomWrites++; window.__w.push({t:Date.now(),v:String(v)}); } return _sp.apply(this,arguments); };
  window.__st=function(){ return document.documentElement.style.getPropertyValue('--mochi-safe-bottom'); };
  window.__row=function(){
    var els=document.querySelectorAll('.chat-input-row'), best=null;
    for(var i=0;i<els.length;i++){ var r=els[i].getBoundingClientRect(); if(r.width>50 && (!best || r.bottom>best.bottom)) best=els[i]; }
    if(!best) return null;
    var r2=best.getBoundingClientRect(), cs=getComputedStyle(best);
    return {b:Math.round(r2.bottom),pb:cs.paddingBottom};
  };
  window.__vv=function(){ var vv=window.visualViewport;
    Object.defineProperty(vv,'height',{configurable:true,get:function(){return window.__kbH||window.innerHeight;}});
    Object.defineProperty(vv,'offsetTop',{configurable:true,get:function(){return window.__kbOff||0;}}); return 1; };
})();`
    });
  }
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (mode === 'lsdead' ? '?lsdead=1' : '') });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  // 真走完开屏：点「进入」→ 必读公告滑到底 → 「确认进入」（不走完＝整棵 .phone 是 hidden）
  await ev("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return 1;})()");
  await sleep(1200);
  await ev(`(function(){
    var sc=document.getElementById('splash-mandatory-scroll');
    if(sc){ sc.scrollTop=sc.scrollHeight-sc.clientHeight; sc.dispatchEvent(new Event('scroll',{bubbles:true})); }
    var e=document.getElementById('splash-mandatory-enter'); if(e&&!e.hidden) e.click(); return 1; })()`);
  await sleep(1600);
  await ev("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return 1;})()");
  await sleep(900);
  await ev("(function(){ var app=document.querySelector('.app[data-app=\"chat\"]'); if(app) app.click(); return !!app; })()");
  await sleep(1200);
  await ev('window.__vv()');
}
const readState = async () => JSON.parse(await ev(`(function(){
  return JSON.stringify({
    inline: window.__st(),
    all: window.mochiScreenAdj ? window.mochiScreenAdj.all() : null,
    ls: (function(){try{return localStorage.getItem('xy-home-v2:screen-adj-bottom');}catch(e){return 'throw';}})(),
    row: window.__row(),
    writes: window.__bottomWrites
  });})()`));
async function kb(on) {
  if (on) return await ev(`(function(){ var i=document.getElementById('chat-input'); if(!i) return 'no-input';
    try { i.dispatchEvent(new TouchEvent('touchstart',{bubbles:true})); } catch(e){}
    i.focus(); i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
    window.__kbH = Math.round(window.innerHeight * 0.52);
    window.dispatchEvent(new Event('resize'));
    if (window.visualViewport) window.visualViewport.dispatchEvent(new Event('resize'));
    return 'opened'; })()`);
  return await ev(`(function(){ var i=document.getElementById('chat-input');
    if(i){ i.blur(); i.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); }
    window.__kbH=null; window.dispatchEvent(new Event('resize'));
    if (window.visualViewport) window.visualViewport.dispatchEvent(new Event('resize'));
    return 'closed'; })()`);
}

await boot('plain');
// ---------- G 组：环境硬闸（不过闸就不给后面读数打分） ----------
const g0 = await ev(`(function(){ var ph=document.querySelector('.phone');
  return JSON.stringify({vis:getComputedStyle(ph).visibility,standalone:document.documentElement.classList.contains('ios-pwa-standalone'),
    row:window.__row(),adj:!!window.mochiScreenAdj,inInput:!!document.getElementById('chat-input')}); })()`);
const gv = JSON.parse(g0);
check('G0 环境：开屏已 dismissed、.phone 计算可见性=visible（否则整棵子树 hidden，读数全是假绿）', gv.vis === 'visible', gv);
check('G0b 环境：被 App 认成 iOS standalone 形态', gv.standalone === true, { cls: gv.standalone });
check('G0c 环境：聊天输入栏量得到几何（.chat-input-row 就是用户口中「屏幕最底端」那一条）', !!gv.row && gv.row.b > 0, gv.row);
if (gv.vis !== 'visible' || !gv.row || !(gv.row.b > 0)) {
  envFail = '环境不满足（开屏/几何闸未过）：' + g0;
  console.log('\n' + envFail + ' —— 本脚本不打分，请先修夹具');
  server.close(); chrome.kill(); process.exit(2);
}

// ---------- A 组：底部轴≠0 且键盘在场那一段只剩一个值（＝用户①②那两句） ----------
await ev("(function(){ return window.mochiScreenAdj.set('bottom', 8); })()");
await sleep(500);
const aPre = await readState();
check('A0 前提：底部轴=8 当场落到「env 基准＋8px」那一支', /calc\(env\(safe-area-inset-bottom.*\+ *8px/.test(String(aPre.inline)), aPre);
await ev("(function(){ window.__w.length=0; window.__bottomWrites=0; return 1; })()");
check('A0b 前提：键盘开合这一发走通了', (await kb(true)) === 'opened');
await sleep(1200); // 让停靠/收缩先落定，再开始采样（键盘开启那一次换位不是本批要量的跳动）
const kbSamples = [];
// 120ms × 40 ≈ 4.8s：旧写法那一条复述循环是 1Hz，采样必须明显快于它，否则会漏掉一次翻转
// （实测漏过一轮＝红侧从 13 条抖成 12 条，红数本身无意义，两侧同尺才有意）
for (let i = 0; i < 40; i++) { await sleep(120); kbSamples.push(await readState()); }
const kbIn = Array.from(new Set(kbSamples.map((s) => s.inline || '(空→回落 env)')));
const kbPb = Array.from(new Set(kbSamples.map((s) => s.row && s.row.pb)));
const kbB = Array.from(new Set(kbSamples.map((s) => s.row && s.row.b)));
const wlog = JSON.parse(await ev('JSON.stringify(window.__w)'));
const wVals = Array.from(new Set(wlog.map((x) => x.v)));
check('A1 键盘期那一段内联值只剩一个（两个主人交替落值＝本症状本体；旧写法此窗内 0px 与 calc(env+8px) 来回翻）',
  wVals.length <= 1, { 值集合: wVals, 写入次数: wlog.length });
check('A2 键盘期那一个是「钉 0 且偏移让位」那一支（#556/#530 语义未动，不是都不写）',
  wVals.length <= 1 && (wVals[0] === '0px' || wVals.length === 0), { 值集合: wVals });
check('A3 前提：这一段时间里底部那一格确实被系统写入方经手过（否则 A1 是假绿）', wlog.length >= 1, { 写入次数: wlog.length });
check('A4 聊天输入栏的计算 padding-bottom 全程一个值（用户肉眼看的那一条底边）', kbPb.length <= 1, { pb: kbPb, 底边: kbB });
await kb(false);
await sleep(2500);
const back = await readState();
check('A5 收键盘后落回「env 基准＋本机偏移」那一支（不丢用户调的 8px）', /calc\(env\(safe-area-inset-bottom.*\+ *8px/.test(String(back.inline)), back);
await ev("(function(){ window.__w.length=0; window.__bottomWrites=0; return 1; })()");
await sleep(3000);
const idleW = JSON.parse(await ev('JSON.stringify(window.__w)'));
check('A6 对照组：稳态 3s 内底部那一格零重写（同值不写＝#969 那份省样式失效的职责还在，夹具也不制造写）', idleW.length === 0, { 写入次数: idleW.length });

// ---------- D 组：屏幕适配诊断那一行报的是不是事实（＝作者点名要修的这一件） ----------
const dTxt = await ev("(function(){ try { var r=window.__collectScreenDiag && window.__collectScreenDiag(); return r && r.text ? r.text : '(没有 text)'; } catch(e){ return 'throw:'+e.message; } })()");
const sbLine = String(dTxt).split('\n').filter(function (l) { return l.indexOf('--mochi-safe-bottom=') >= 0; })[0] || '';
const dVal = (/--mochi-safe-bottom=([^\n]*)/.exec(sbLine) || [])[1] || '';
check('D1 前提：屏幕适配诊断能现场出报告（window.__collectScreenDiag 在位且带出那一行）',
  String(dTxt).includes('【屏幕适配诊断】') && !!sbLine, { 那一行: sbLine.slice(0, 96) });
check('D2 那一行不再报出产物里不存在的值（自定义属性自带单位或本就是一条 calc，照原样写才是事实）',
  !/pxpx/.test(dVal) && !/\)px/.test(dVal), { 读数: dVal });
check('D3 对照组：那一行如实带着用户的偏移（8px 在 calc 里；红侧也过＝它只是多带了个假后缀）',
  /8px/.test(dVal), { 读数: dVal });

// ---------- P 组：落库那一半（＝用户③那句「设置后会没有保存，刷新就恢复默认状态」） ----------
async function reloadReady(mode, waitMs) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' + (mode === 'lsdead' ? '?lsdead=1' : '') });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(waitMs || 2500);
}
await ev("(function(){ return window.mochiScreenAdj.set('bottom', 12); })()");
await sleep(400);
await reloadReady('plain', 2500);
const p1 = await readState();
check('P1 对照组：LS 健康时调 bottom=12 → 刷新后仍是 12（旧语义一字未动）', p1.all && p1.all.bottom === 12 && p1.ls === '12', p1);
check('P2 对照组：刷新后那一格落的仍是「env＋12px」（值真在 DOM 上，不是只活在内存里）', /calc\(env\(safe-area-inset-bottom.*\+ *12px/.test(String(p1.inline)), { inline: p1.inline });

// P3～P6：LS 写不进去那一档——配额满／隐私模式／系统清空网站数据这类设备的通用形状
await boot('lsdead');
const p0 = await ev("(function(){ try { localStorage.setItem('xy-home-v2:__probe1393','1'); return 'wrote'; } catch(e){ return 'throws:'+e.name; } })()");
check('P0 前提：LS 写失败注入生效（setItem 抛而 getItem 照常；判据＝这一发抛没抛，零机型分支）', /^throws/.test(String(p0)), p0);
await ev("(function(){ try { window.xyStore('xy-home-v2').set('__probe1393b','ctrl-ok'); } catch(e){} return 1; })()");
const setRes = await ev("(function(){ return String(window.mochiScreenAdj.set('bottom', 24)); })()");
await sleep(500);
const inDom = await readState();
check('P3 前提：当场确实见效（面板所见没错，用户才会更困惑「怎么没保存」）', setRes === 'true' && /24px/.test(String(inDom.inline)), { set: setRes, inline: inDom.inline });
await reloadReady('lsdead', 4000); // 等 IndexedDB 回填与 mochi-restore-done 那一次补读（这一档 LS 仍写不进去）
const p4 = await readState();
check('P4 LS 写不进去的设备：调 bottom=24 刷新后仍回到 24（红侧读数停在上一档旧值＝用户那句「刷新就恢复默认」本体）',
  p4.all && p4.all.bottom === 24, { 读回: p4.all && p4.all.bottom, ls: p4.ls, inline: p4.inline });
check('P5 补回的那一份真的落到 DOM（不是内存里改了个数）', /calc\(env\(safe-area-inset-bottom.*\+ *24px/.test(String(p4.inline)), { inline: p4.inline });
const ctrl = await ev("(function(){ try { return window.xyStore('xy-home-v2').get('__probe1393b') || '(无)'; } catch(e){ return 'throw'; } })()");
check('P6 对照：同一条轨上的另一枚键在同一次注入失败里照样回来（＝证明「那条轨本来就好」，七轴此前没上去）', ctrl === 'ctrl-ok', { 对照键: ctrl });
const idbAxis = await ev("(function(){ return window.idbGet('xy-home-v2:screen-adj-bottom').then(function(v){ return (v===null||v===undefined)?'(库里没有)':String(v); }, function(){ return '(问不出)'; }); })()");
check('P7 轴那一份在 IndexedDB 里有副本（与站内其余每一条设置同一条轨；旧写法库里从不落＝清完 LS 就永久没了）', String(idbAxis) === '24', { idb: idbAxis });

// P8 归零语义：设回 0 之后不留鬼值（remove 那条腿走通，别把默认值写成一份永久的旧值）。
// 刻意在 LS 恢复健康之后走这一段：LS 写不进去的那一档里小键日志（__wr-journal 本身也住 LS）
// 同样写不动，此时上一档成功过的旧值会被回放进 LS——那是数据层对**所有**小键的既有行为，
// 不是本批新增的第二套规则（本批只是把七轴挪到同一条轨上；见台账「同族残余」）。
await boot('plain');
await ev("(function(){ window.mochiScreenAdj.set('bottom', 0); return 1; })()");
await sleep(400);
await reloadReady('plain', 2500);
const p8 = await readState();
check('P8 归零之后刷新仍是默认（既不留在 DOM 上，也不留在库里当旧值）', p8.all && p8.all.bottom === 0 && !/calc\(/.test(String(p8.inline)), p8);
const errs = await ev('(window.__jsErrors||[]).length');
check('Z1 全程零未捕获异常', errs === 0, { errs: errs });

const pass = results.filter((r) => r.ok).length;
console.log('\n读数：绿 ' + pass + ' / 红 ' + (results.length - pass) + '   （被测：' + root + '）');
server.close(); chrome.kill();
process.exit(pass === results.length ? 0 : 1);
