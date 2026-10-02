// ===== 常驻回归脚本 #1300：iPhone 15 Pro Max + Safari 实报「ios 卡顿」——回前台那一帧的两处结构耗时 =====
// 用法：node tools/verify-1300-resume-frame.mjs [被测根目录]（首行打印被测根目录，防喂错产物）
// 症状（用户实报 2026-09-26，附件诊断单同一台机）：①「背景图要重启才显示／卡片是空的」；②切回前台／
//   切回桌面那一场卡顿（诊断单现场读数：切回桌面帧耗时 平均 1620ms / p90 3510ms / 最慢 25575ms，
//   DOM=35388 节点、img=931 张，30s 内被系统回收 96 次）。
// 根因（零机型／零 UA 分支，判据只取「动画目标在不在聊天消息列表子树内」「这个节点上还挂没挂着
//   上一帧留下的背景图」两个结构事实）：
//   B＝#1151c/#1181b 的回场落终态闸每次回前台跑 `document.getAnimations()` 取**全站**动画＋对每条
//     target 跑 `body.contains()`＝这道闸自己成了回场一帧的耗时项（与摘 #913 暂停类、#1195e 大键
//     释放、iOS 重开 IDB 连接全落在同一次可见性翻转里）。枚举面收到 chat-body 子树，被收的集合逐条
//     不变（旧写的过滤器本就是「body 的后代」）。
//   C＝#1195e 每次切后台按体积放掉 ≥256KB 大键的内存副本（iOS 内存压力下的正解，不动它），而
//     card-bg-*/page-bg-* 这些键 >200KB 时 localStorage 那份本就被大键规则剥掉（LS_BIG_LIMIT）⇒
//     回前台这一轮 store.get 必然同步读空。旧写法没有「回前台复核桌面大键背景」这一路（C2 在红侧读到
//     「帧还在」＝根本不是回前台那一瞬拆的），于是两种坏形态：① 用户下一次走进应用函数（回桌面/切桌面/
//     回填完成）时读空即当场把已画好的背景内联拆掉＝「卡片是空的」，等重启回填才恢复；② 一直走不到那条
//     路时图留在屏上却读不到值＝「非得重启一次才显示」。补 #1270/#1218 同族的那一枪：回前台主动走一遍
//     应用函数；读空但这一帧还挂着图＝保留最后一帧＋踢一次按需取回，落地后自己重铺；经 #695
//     whenDeskVisible 调度，用户回前台落在聊天页时不抢那一帧的解码预算。库里确切回话「这张图没了」时只
//     回一次头，不把「保帧→取回→仍没有→保帧」跑成死循环（否则幽灵帧钉在屏上＋反复敲库）。
// 断言（同一 tab，真实覆写 document.hidden 让 #913 暂停类与 #1195e 大键释放都落地）：
//   S1~S16 静态锚（src 与产物各八处）
//   C8 证人闸：桌面从没设过背景时，回前台一个 card-bg/page-bg 键都不敲（否则每次回前台对几十个空键
//      各敲一次库＋重跑应用函数＝把要治的那一帧拖得更重）
//   C0~C5 卡片背景：设成功且落库→切后台放掉内存→回前台同一瞬内联仍挂着 url(...)（C2＝判别核心）→
//      只踢一次取回且在途去重→取回落地不必重启→**先由库确证 'absent'**（C5a 前提；'unknown' 按
//      #1241 口径不许拆层）→那一帧该拆且只回一次头（不留幽灵帧）
//   P0~P3 整页背景（page-bg-0，同是大键、漏网的第二处）同款四问
//   B0~B3 动画闸：夹具真挂在 chat-body 内（B0a）＋被冻的一次性动画照旧落到终态（集合没缩小）＋窗外
//      （page-chat 内、chat-body 外）那一条绝不被收（范围没被放宽）＋无限循环者不动＋回前台那一路
//      document.getAnimations 增量＝0（B3＝判别核心，红侧≥1；夹具自己的读数走打桩前的原始函数）
//   D0~D2 接线与调度：主页可见时回前台那一枪当场重铺；主页不可见时改登记待办、回到桌面那一帧补跑
//   Z1 全程零未捕获 JS 异常
// 实测两侧读数（同一份脚本，两次复跑同分）＝绿 48/48 · 纯 HEAD 22/48：16 条静态锚全红（本批针不在
//   HEAD 里）＋行为 10 红 C2b/C2c/C3/C4/C5/P2b/P3/B3/D0/D2＝症状本体与接线缺失。两侧皆绿的 22 条＝
//   夹具真实（C0/C0b/C0c/C1/C1b/P0/P1/P2、B0~B2b、B0a、C5a、C8、D1、F0、Z1）＝本批没把旧契约改坏：
//   回前台那一瞬旧写法确实没拆层（它压根没有这一路），「被拆」的形状由红侧的 C4/C5/D2 给出。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
console.log('被测根目录: ' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, budgetMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    let v = false; try { v = await fn(); } catch (e) { v = false; }
    if (v) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 >= budgetMs) return { ok: false, ms: Date.now() - t0 };
    await sleep(stepMs || 200);
  }
}
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A_ = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 300) : '')); } };

console.log('静态断言:');
const read = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const SRC = { chat: read(join('src', 'js', 'chat.js')), pers: read(join('src', 'js', 'personalize.js')) };
const PRD = { chat: read(join('js', 'chat.js')), pers: read(join('js', 'personalize.js')) };
const ANCHORS = [
  ['S1', 'S2', '聊天回场动画闸枚举面收在 chat-body 子树', 'chat', 'const sub = body.getAnimations ? body.getAnimations({ subtree: true }) : null;'],
  ['S3', 'S4', '老内核问不出子树时落回全站枚举（宁多走一步也不静默不修）', 'chat', 'all = body.getAnimations && body.getAnimations().length ? sub : document.getAnimations();'],
  ['S5', 'S6', '卡片背景读空但这一帧还挂着图＝保帧＋按需取回（落地回调带 type 重跑本卡片）', 'pers', "hydrateDeskBgOnce('card-bg-' + type, el, () => applyCardBg(type))"],
  ['S7', 'S8', '整页背景同款闸', 'pers', "hydrateDeskBgOnce('page-bg-' + i, s, applyPageBgs)"],
  ['S9', 'S10', '取回只由「这一帧还挂着图」触发（证人闸＝不敲没画过的键）', 'pers', 'if (!el || !el.style.backgroundImage) return false;'],
  ['S11', 'S12', '回前台复核经 #695 whenDeskVisible 调度（固定引用作业＝Set 去重）', 'pers', 'whenDeskVisible(resumeDeskBgJob);'],
  ['S13', 'S14', '回前台双通道接线（visibilitychange→visible ＋ bg-keep 的 mochi-fg-resume）', 'pers', "document.addEventListener('mochi-fg-resume', resumeDeskBgWatch);"],
  ['S15', 'S16', '库里确切回话「没这张图」只回一次头（防幽灵帧＋防反复敲库）', 'pers', 'if (deskBgMissed[key]) return false;'],
];
for (const [tagSrc, tagProd, label, file, needle] of ANCHORS) {
  A_(tagSrc + ' ' + label + '（源）', SRC[file].includes(needle));
  A_(tagProd + ' ' + label + '（产物）', PRD[file].includes(needle));
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9931 + Math.floor(Math.random() * 40));
const profile = join(process.env.TEMP || '/tmp', 'mochi-1300-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile,
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

function mkClient(wsUrl, tag) {
  const c = { tag, pend: new Map(), id: 0, errors: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl); c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String(m.params.exceptionDetails.text || '').slice(0, 160)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  c.cdp = (method, params = {}) => { const id = ++c.id; return new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }); };
  // 单次求值 15s 封顶：页面若被 SW 换新/自动重载打断，Runtime.evaluate 的应答永远不回来＝整条电池
  // 僵在那儿（无头实测：P 组之后一条 eval 静默不回）。判成「读数缺失」而不是让脚本挂死。
  c.evalJs = async (expr) => {
    try {
      const r = await Promise.race([
        c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
        new Promise((res) => setTimeout(() => res({ __tmo: 1 }), 15000)),
      ]);
      if (r && r.__tmo) { console.error('  [eval timeout] ' + expr.slice(0, 70)); return '__TMO__'; }
      if (r && r.exceptionDetails) { console.error('  [eval err]', String((r.exceptionDetails.exception || {}).description || '').slice(0, 200)); return null; }
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  return c;
}

// —— 真实前后台夹具：覆写 document.hidden / visibilityState 后派发事件（#913 暂停类与 #1195e 大键
//    释放读的都是 document.hidden／visibilityState，夹具必须真触发它们，否则判的是空气）——
const HIDE = `(function(){
  try {
    window.__1300fix = { d: Object.getOwnPropertyDescriptor(Document.prototype,'hidden'), v: Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState') };
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'hidden';}});
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { return String(e && e.message || e); }
  return document.body.classList.contains('mochi-bg-pause') ? 'pause-on' : 'pause-missing';
})()`;
const SHOW = `(function(){
  try {
    if (window.__1300fix && window.__1300fix.d) Object.defineProperty(document,'hidden',window.__1300fix.d);
    if (window.__1300fix && window.__1300fix.v) Object.defineProperty(document,'visibilityState',window.__1300fix.v);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('mochi-fg-resume'));
  } catch (e) { return String(e && e.message || e); }
  return document.body.classList.contains('mochi-bg-pause') ? 'pause-off' : 'pause-stuck';
})()`;
const RESUME = "(function(){document.dispatchEvent(new Event('mochi-fg-resume'));return 1;})()";
const GO_HOME = "(function(){var t=document.querySelector('.tab[data-page=\"page-phone\"]');if(t)t.click();return !!t;})()";
const GO_CHAT = "(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()";

// 探针：document/元素级动画枚举计数＋idbEnsureBigKey 调用流水（读数一律取「增量」＝只算被测那一路）
// ⚠️ 夹具自己（下面的 SCAN）也数动画，必须走 window.__1300od＝打桩前那一份原始函数，否则尺子把
//    自己每次读数算成被测路径的全站枚举＝B3 恒红（无头实测 docDelta=5 全来自 SCAN 本身）。
const PROBE = `(function(){
  if (window.__1300p) return JSON.stringify({on:1});
  try {
    var body = document.getElementById('chat-body');
    var p = { docCalls: 0, bodyCalls: 0, bodySub: -1, ensure: [] };
    var od = document.getAnimations;
    window.__1300od = od;
    document.getAnimations = function(){ p.docCalls++; return od.apply(document, arguments); };
    if (body && body.getAnimations) {
      var ob = body.getAnimations;
      body.getAnimations = function(o){ p.bodyCalls++; var r = ob.apply(body, arguments); if (o && o.subtree) p.bodySub = r.length; return r; };
    }
    var oe = window.idbEnsureBigKey;
    if (oe) window.idbEnsureBigKey = function(k){ p.ensure.push(String(k)); return oe.apply(window, arguments); };
    window.__1300p = p;
  } catch (e) { return 'ERR:' + e.message; }
  return JSON.stringify({on:1});
})()`;
const MARK = `(function(){ var P=window.__1300p; return P ? JSON.stringify({doc:P.docCalls,body:P.bodyCalls,n:P.ensure.length}) : 'no'; })()`;
const SNAP = `(function(k){ var P=window.__1300p; if(!P) return 'no';
  var hits = P.ensure.filter(function(x){ return x.indexOf('card-bg-')>=0 || x.indexOf('page-bg-')>=0; });
  return JSON.stringify({bodySub:P.bodySub, hits:hits, k:hits.filter(function(x){return x.indexOf(k)>=0;}).length});
})`;
// 聊天消息列表内「一次性 CSS 动画」清单（无限循环者另计；全站枚举的**次数**由探针单独判）
// 读数走 window.__1300od（打桩前的原始函数）＝夹具不把自己这几次数落进被测计数里
const SCAN = `(function(){
  var b=document.getElementById('chat-body'); if(!b) return JSON.stringify({err:1});
  var od=window.__1300od||document.getAnimations; var all=od.call(document), out=[];
  for (var i=0;i<all.length;i++){ var a=all[i], ef=a.effect, tg=ef&&ef.target;
    if (typeof a.animationName!=='string') continue;
    if (!tg || (tg!==b && !b.contains(tg))) continue;
    var it=Infinity; try{ it=ef.getComputedTiming().iterations; }catch(e){}
    out.push([a.animationName, a.playState, it===Infinity?'inf':'once']);
  }
  var cnt=function(st,kind){ return out.filter(function(x){return x[1]===st && x[2]===kind;}).length; };
  return JSON.stringify({onceRunning:cnt('running','once'),oncePaused:cnt('paused','once'),onceFinished:cnt('finished','once'),
    infRunning:cnt('running','inf'),infPaused:cnt('paused','inf'),
    what:out.filter(function(x){return x[2]==='once'&&x[1]!=='finished';}).slice(0,4)});
})()`;
// 大键背景现场探针：mem＝内存/LS 读到的长度（store.get 读空给的是 null，不能当 0 用）；
// has＝这一帧内联里还挂着 url(...)；empty＝内联已清空
const bgProbe = (key, sel) => "(function(){ var st=window.activeStore(); var s=document.querySelector(" + JSON.stringify(sel) + "); var v=''; try{ v=st.get(" + JSON.stringify(key) + ")||''; }catch(e){}" +
  " return JSON.stringify({mem:v.length, has:s?String(s.style.backgroundImage).indexOf('url(')>=0:false, empty:s?!String(s.style.backgroundImage):false}); })()";
const valLen = (key, url) => "(function(){ try { var st=window.activeStore(); st.set(" + JSON.stringify(key) + "," + JSON.stringify(url) + "); return (st.get(" + JSON.stringify(key) + ")||'').length; } catch(e){ return 'ERR:'+e.message; } })()";
const rmKey = (key) => "(function(){ try { window.activeStore().remove(" + JSON.stringify(key) + "); return 1; } catch(e){ return 'ERR:'+e.message; } })()";
const memOf = (key) => "(function(){ try { return (window.activeStore().get(" + JSON.stringify(key) + ")||'').length; } catch(e){ return 0; } })()";

let C = null;
const CARD = '[data-card-bg=checkin]';
const CARD2 = '[data-card-bg=quote]';
const CARD3 = '[data-card-bg=week]';
const SLIDE = '#desktop-pages .page-slide';
// 300KB：>256KB（#1195e 放得掉）、>200KB（LS 本来就没那份）、<500KB（渲染防护允许画）
const BG300 = 'data:image/png;base64,' + 'A'.repeat(300 * 1024);
const BGPAGE = 'data:image/png;base64,' + 'B'.repeat(300 * 1024); // 与卡片那张不同底＝内联串可分辨，不会被「恒等跳过」误判
// 把「这一帧已经画好」这个前提用**两侧都存在**的既有通路做出来：桌面综合切换监听
//（document 'contact-switched' → #695 whenDeskVisible(refreshDeskVisuals)，主页可见即当场重铺，
// v3.6.x 起就在，与本批新接的回前台通道无关）。不走这条路，前提本身只在绿侧成立（无头首跑红侧
// C0/P0 的读数是「内联压根是空的」——单写 store.set 谁都不重铺，绿侧那一笔恰是本批新通道画的），
// 于是 C2/P2 判的成了「画没画过」而不是本批要判的「回前台那一瞬拆没拆」。
const paintViaDesk = async () => {
  const homeVis = await C.evalJs("(function(){var p=document.getElementById('page-phone');return !!(p&&p.hidden===false);})()");
  if (String(homeVis) !== 'true') { console.error('  [夹具] 主页不可见，paintViaDesk 会走延后分支'); }
  await C.evalJs("(function(){document.dispatchEvent(new Event('contact-switched'));return 1;})()");
  await sleep(1800);
};

try {
  let targets = [];
  for (let i = 0; i < 80; i++) { try { targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); if (targets.length) break; } catch (e) {} await sleep(200); }
  C = mkClient(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, 'C'); await C.connect();
  await C.cdp('Page.enable'); await C.cdp('Runtime.enable');
  await C.cdp('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await C.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await C.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(700);
  await C.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));st.set('cs-rp-auto-prob','0');}catch(e){}try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}return true;})()");
  // 夹具动画的一次性／无限循环关键帧（DOM 夹具要等进聊天页、消息重渲完之后再挂，否则被 innerHTML 抹掉）
  await C.evalJs("(function(){var st=document.createElement('style');st.textContent='@keyframes __t1300once{from{opacity:.2}to{opacity:1}}@keyframes __t1300inf{from{opacity:.2}to{opacity:1}}.t1300once{animation:__t1300once 6s both}.t1300inf{animation:__t1300inf 3s linear infinite}';document.head.appendChild(st);return true;})()");

  console.log('行为断言:');
  const probe = await C.evalJs(PROBE);
  A_('F0 探针装好（document/元素动画枚举计数＋idbEnsureBigKey 流水）', String(probe).indexOf('"on":1') >= 0, probe);
  await C.evalJs(GO_HOME);
  await sleep(400);

  // ---------- C8：证人闸（从没设过背景的桌面＝一个键都不该敲） ----------
  await C.evalJs(RESUME);
  await sleep(400);
  const c8b = JSON.parse(await C.evalJs(SNAP + "('__none__')") || '{}');
  A_('C8 桌面未设背景时回前台不敲任何 card-bg/page-bg 键（证人闸；否则每次回场对几十个空键各敲一次库＋重跑应用函数＝把要治的那一帧拖得更重）', (c8b.hits || []).length === 0, (c8b.hits || []).slice(0, 6));

  // ---------- C 组：卡片背景大键（症状本体＝「背景图要重启才显示」） ----------
  const seedLen = await C.evalJs(valLen('card-bg-checkin', BG300));
  await paintViaDesk();
  const c0 = JSON.parse(await C.evalJs(bgProbe('card-bg-checkin', CARD)) || '{}');
  A_('C0 前提：卡片背景设成功并被画上（内联有 url，值在内存）', c0.has === true && c0.mem > 250000, c0);
  A_('C0b 该值确是「大键」（>256KB＝#1195e 放得掉；<500KB＝渲染防护允许画）', c0.mem > 256 * 1024 && c0.mem < 500 * 1024, { seedLen, mem: c0.mem });
  const landed = await C.evalJs("(function(){ if(!window.idbBigKeyLanded) return 'skip'; return window.idbBigKeyLanded('card-bg-checkin').then(function(s){return String(s);}); })()");
  A_('C0c 那份图确已落库（IDB 有源头，按需取回才取得到）', landed !== 'missing', landed);

  const hide1 = String(await C.evalJs(HIDE));
  await sleep(400);
  const c1 = JSON.parse(await C.evalJs(bgProbe('card-bg-checkin', CARD)) || '{}');
  A_('C1 夹具真实：切后台后 #913 暂停类确在（pause-on）', hide1 === 'pause-on', hide1);
  A_('C1b 内存副本确被 #1195e 放掉（同步读空，而这一帧还挂着图）', c1.mem === 0 && c1.has === true, c1);

  await C.evalJs(SHOW);
  const c2 = JSON.parse(await C.evalJs(bgProbe('card-bg-checkin', CARD)) || '{}');
  A_('C2 【判别核心】回前台的同一瞬没有拆层（内联仍挂着 url(...)；旧写法＝当场清空＝用户看见的空卡片）', c2.has === true, c2);
  const snapC = JSON.parse(await C.evalJs(SNAP + "('card-bg-checkin')") || '{}');
  A_('C2b 命中证人后踢了一次按需取回（idbEnsureBigKey 恰 1 次；旧写法根本不敲库，直接拆层）', snapC.k === 1, snapC);
  await C.evalJs(RESUME);
  await C.evalJs(RESUME);
  await sleep(250);
  const snapC2 = JSON.parse(await C.evalJs(SNAP + "('card-bg-checkin')") || '{}');
  A_('C2c 取回在途时重复触发不叠加（同键去重＝一次可见性翻转里两个通道也只敲一遍）', snapC2.k === 1, { first: snapC.k, after: snapC2.k });
  const ready = await waitFor(async () => {
    const v = await C.evalJs(memOf('card-bg-checkin'));
    return typeof v === 'number' && v > 250000 ? v : false;
  }, 12000, 300);
  A_('C3 按需取回落地（≤12s 内内存又读到那张图＝不必重启即回位）', ready.ok, ready.ms);
  const c4 = JSON.parse(await C.evalJs(bgProbe('card-bg-checkin', CARD)) || '{}');
  A_('C4 取回后背景仍在（不是「先拆再补」的一闪）', c4.has === true && c4.mem > 250000, c4);

  await C.evalJs(rmKey('card-bg-checkin'));
  await sleep(1200); // store.remove 的 idbDelete 是 fire-and-forget，先让删除事务落地
  // 夹具前提：先让库自己确证「这张图没了」（三态里的 'absent'）。删完立刻 RESUME 时产品问出的可能
  // 是 'unknown'——按 #1241 口径那**不该**拆层（说「已丢失」才会害用户白重传），断言就判错了对象。
  // 取回若把刚删的那份复活（删除事务还没赶上读取），再删一次直到库里确切回话。
  const premise = await waitFor(async () => {
    const r = await C.evalJs("(function(){ var st=window.activeStore(), m=0; try{m=(st.get('card-bg-checkin')||'').length;}catch(e){}" +
      " return window.idbEnsureBigKey('card-bg-checkin').then(function(s){ return JSON.stringify({st:String(s),mem:m}); }); })()");
    if (!r || r === '__TMO__') return false;
    const o = JSON.parse(r);
    if (o.mem > 0) { await C.evalJs(rmKey('card-bg-checkin')); return false; }
    return o.st === 'absent' ? o : false;
  }, 20000, 600);
  A_('C5a 前提：库里确切回话「这张图没了」（idbEnsureBigKey→absent，非 unknown）', premise.ok, { ms: premise.ms, last: premise.ok ? 'absent' : 'never-absent' });
  const kPre5 = (JSON.parse(await C.evalJs(SNAP + "('card-bg-checkin')") || '{}').k) || 0;
  await C.evalJs(RESUME);
  const gone = await waitFor(async () => {
    const v = JSON.parse(await C.evalJs(bgProbe('card-bg-checkin', CARD)) || '{}');
    return v.empty === true ? true : false;
  }, 10000, 250);
  const snapMiss = JSON.parse(await C.evalJs(SNAP + "('card-bg-checkin')") || '{}');
  A_('C5 库里确切回话「这张图没了」＝这一帧该拆（不留幽灵帧钉在屏上）', gone.ok, { ms: gone.ms, last: JSON.parse(await C.evalJs(bgProbe('card-bg-checkin', CARD)) || '{}') });
  A_('C5b 且只回一次头（同一张已确认没了的图不再反复敲库；相对前提读数的增量）', (snapMiss.k || 0) - kPre5 <= 1, { kPre5, k: snapMiss.k });

  // ---------- P 组：整页背景（同是大键，漏网的第二处） ----------
  await C.evalJs(valLen('page-bg-0', BGPAGE));
  await paintViaDesk();
  const p0 = JSON.parse(await C.evalJs(bgProbe('page-bg-0', SLIDE)) || '{}');
  A_('P0 前提：整页背景设成功并画上 slide（内联有 url）', p0.has === true && p0.mem > 250000, p0);
  await C.evalJs(HIDE);
  await sleep(400);
  const p1 = JSON.parse(await C.evalJs(bgProbe('page-bg-0', SLIDE)) || '{}');
  A_('P1 整页背景内存副本确被放掉（同步读空而这一帧还挂着图）', p1.mem === 0 && p1.has === true, p1);
  await C.evalJs(SHOW);
  const p2 = JSON.parse(await C.evalJs(bgProbe('page-bg-0', SLIDE)) || '{}');
  const snapP = JSON.parse(await C.evalJs(SNAP + "('page-bg-0')") || '{}');
  A_('P2 【判别核心】回前台同一瞬整页背景没被拆成默认底色', p2.has === true, p2);
  A_('P2b 整页背景同样踢了一次按需取回（恰 1 次）', snapP.k === 1, snapP);
  const p3 = await waitFor(async () => {
    const v = await C.evalJs(memOf('page-bg-0'));
    return typeof v === 'number' && v > 250000 ? v : false;
  }, 12000, 300);
  A_('P3 整页背景取回落地（不必重启即回位）', p3.ok, p3.ms);
  await C.evalJs(rmKey('page-bg-0'));
  await C.evalJs(RESUME);
  await sleep(2500);

  // ---------- B 组：聊天回场动画闸（枚举面收到 chat-body，被收集合逐条不变） ----------
  const enter = await C.evalJs(GO_CHAT);
  await sleep(1800);
  const onChat = await C.evalJs("(function(){var pg=document.getElementById('page-chat');return !!(pg&&!pg.hidden);})()");
  A_('B0 前提：已切到聊天页', String(enter) === 'true' && String(onChat) === 'true', { enter, onChat });
  await C.evalJs("(function(){ try { var now=Date.now(), arr=[]; for (var i=0;i<30;i++) arr.push({side:'out',text:'底'+i,ts:now-(30-i)*60000}); return window.chatImportMsgs(arr)?'true':'false'; } catch(e){ return 'ERR:'+e.message; } })()");
  await sleep(1500);
  // 夹具 DOM 挂在这里（不是页面开头）：chatImportMsgs 会重渲 chat-body 的子节点，先挂的会被抹掉
  // ——无头实测过一次注入即 TypeError（t1300-loop 尚不存在），于是 B0b/B0c/B2b 判的是空气。
  const injectFx = "(function(){var b=document.getElementById('chat-body'),pg=document.getElementById('page-chat');if(!b||!pg)return'no';if(!document.getElementById('t1300-in')){var x=document.createElement('div');x.id='t1300-in';b.appendChild(x);}if(!document.getElementById('t1300-out')){var y=document.createElement('div');y.id='t1300-out';pg.insertBefore(y,pg.firstChild);}if(!document.getElementById('t1300-loop')){var z=document.createElement('div');z.id='t1300-loop';b.appendChild(z);}var m={};['t1300-in','t1300-out','t1300-loop'].forEach(function(id){var n=document.getElementById(id);if(!n)return;m[id]=!!n.closest('#chat-body');n.classList.add(id==='t1300-loop'?'t1300inf':'t1300once');});return JSON.stringify(m);})()";
  const fx = await C.evalJs(injectFx);
  A_('B0a 夹具挂上（in/loop 在 chat-body 内、out 在 page-chat 内 chat-body 外）', String(fx).indexOf('"t1300-in":true') >= 0 && String(fx).indexOf('"t1300-loop":true') >= 0 && String(fx).indexOf('"t1300-out":false') >= 0, fx);
  const restartFx = "(function(){var xs=document.querySelectorAll('.t1300once');for(var i=0;i<xs.length;i++){xs[i].classList.remove('t1300once');void xs[i].offsetWidth;xs[i].classList.add('t1300once');}return xs.length;})()";
  await C.evalJs(restartFx);
  await sleep(250);
  const beforeHide = JSON.parse(await C.evalJs(SCAN) || '{}');
  A_('B0b 夹具真跑：chat-body 内有正在播的一次性动画', beforeHide.onceRunning >= 1, beforeHide);
  await C.evalJs(restartFx);
  await sleep(200);
  const markBefore = JSON.parse(await C.evalJs(MARK) || '{}');
  const hide2 = String(await C.evalJs(HIDE));
  await sleep(700);
  const frozen = JSON.parse(await C.evalJs(SCAN) || '{}');
  A_('B0c 后台期它被冻住（#913 行为面：chat-body 内 paused 的一次性动画≥1）', hide2 === 'pause-on' && frozen.oncePaused >= 1, { hide2, frozen });

  await C.evalJs(SHOW);
  const afterShow = JSON.parse(await C.evalJs(SCAN) || '{}');
  A_('B1 被冻住的一次性动画照旧落到终态（chat-body 内既无 running 也无 paused 一次性＝被收集合没缩小）', afterShow.onceRunning === 0 && afterShow.oncePaused === 0, afterShow);
  const outSt = JSON.parse(await C.evalJs("(function(){var y=document.getElementById('t1300-out');if(!y)return JSON.stringify({err:1});var as=y.getAnimations?y.getAnimations():[];return JSON.stringify({n:as.length,st:as.map(function(a){return a.playState;}).join(',')});})()") || '{}');
  A_('B2 窗外那一条（page-chat 内、chat-body 外）没被收（范围没被放宽＝被收集合与旧写法逐条相同）', outSt.n >= 1 && String(outSt.st).indexOf('finished') < 0, outSt);
  const loop = JSON.parse(await C.evalJs("(function(){var z=document.getElementById('t1300-loop');if(!z)return '{}';var cs=getComputedStyle(z);return JSON.stringify({anim:cs.animationName,play:cs.animationPlayState});})()") || '{}');
  A_('B2b 无限循环者没被动（波形/打字点/加载圈照旧跑＝#1151c 那条守卫不回归）', String(loop.anim) === '__t1300inf' && String(loop.play) === 'running', loop);
  await sleep(2500);
  const markAfter = JSON.parse(await C.evalJs(MARK) || '{}');
  const snapB = JSON.parse(await C.evalJs(SNAP + "('__none__')") || '{}');
  const docDelta = (markAfter.doc || 0) - (markBefore.doc || 0);
  const bodyDelta = (markAfter.body || 0) - (markBefore.body || 0);
  A_('B3 【判别核心】回前台那一路零全站枚举（document.getAnimations 增量＝0，改在 chat-body 子树问≥1 次；红侧＝每次回场都全站扫一遍）', docDelta === 0 && bodyDelta >= 1 && snapB.bodySub >= 1, { docDelta, bodyDelta, bodySub: snapB.bodySub });

  // ---------- D 组：#1300e 接线＋#695 调度（回前台落在聊天页时不抢那一帧的解码预算） ----------
  await C.evalJs(GO_HOME);
  await sleep(700);
  await C.evalJs(valLen('card-bg-quote', BG300));
  await sleep(400);
  await C.evalJs(RESUME);
  const d0 = await waitFor(async () => {
    const v = JSON.parse(await C.evalJs(bgProbe('card-bg-quote', CARD2)) || '{}');
    return v.has === true ? true : false;
  }, 6000, 250);
  A_('D0 主页可见时回前台那一枪当场重铺（双通道接线；旧写法没有这一路＝图只能在库里）', d0.ok, d0.ms);
  await C.evalJs(rmKey('card-bg-quote'));

  await C.evalJs(GO_CHAT);
  await sleep(900);
  const dHomeHidden = await C.evalJs("(function(){var p=document.getElementById('page-phone');return !!(p&&p.hidden);})()");
  await C.evalJs(valLen('card-bg-week', BGPAGE));
  await sleep(400);
  await C.evalJs(RESUME);
  await sleep(600);
  const d1 = JSON.parse(await C.evalJs(bgProbe('card-bg-week', CARD3)) || '{}');
  A_('D1 主页不可见时不当场重铺（经 #695 登记待办＝回前台落在聊天页不抢那一帧解码预算）', String(dHomeHidden) === 'true' && d1.has === false, { dHomeHidden, d1 });
  await C.evalJs(GO_HOME);
  await sleep(1200);
  const d2 = JSON.parse(await C.evalJs(bgProbe('card-bg-week', CARD3)) || '{}');
  A_('D2 主页真正显示前补跑（回到桌面那一帧就看得见，不闪空卡片）', d2.has === true, d2);
  await C.evalJs(rmKey('card-bg-week'));

  A_('Z1 全程零未捕获 JS 异常', C.errors.length === 0, C.errors.slice(0, 3));
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
