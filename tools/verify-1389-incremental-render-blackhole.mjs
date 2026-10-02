// ===== 常驻回归脚本 #1389：增量补画循环抛错 ⇒ 渲染器被永久改道（「挂后台回来新消息不显示、只有刷新恢复」）=====
// 用法：node tools/verify-1389-incremental-render-blackhole.mjs [被测根目录]
//
// 症状（用户 2026-09-29 第五次复报同一句话，明说其他设备型号也有出现、要求不要覆盖式修补）：
//   「把浏览器挂着后台一段时间，然后回来，聊天里依旧不显示现在回来后新发的聊天消息，一片空白，
//    并且因为新消息一片空白不显示，页面看起来可以滑动飞出屏幕，要重新刷新网页才恢复正常。」
//
// 根因（零机型／零 UA 分支；判据只取「一条记录画不出来，会不会把渲染器从此改道」这一个代码事实）：
//   loadOlderIncremental（上翻补更早一批）与 loadNewerIncremental（补尾）这两个**同步增量轮**，与
//   renderWindow 的分帧轮同构——同样 `batchRendering = true`、同样把 `appendTarget` 改道进一块
//   DocumentFragment。但它们既没有 #919a/#1313 的逐条 try/catch，也没有 finally。一条记录把 renderMsg
//   弄抛（#919a 注释里留着真机 buildChunk→renderMsg「reading 'side'」的实锤），异常一路抛出函数外：
//     · batchRendering 永久为真 ⇒ 凡拿「让路给在飞的构建」当理由的早退全部永久生效（#874a/b/c 入口、
//       armWindowHoleHeal、回场复核 heal、#716 贴底看门狗、#841 进页收尾）；
//     · appendTarget 永久指向那块没人会挂上去的 fragment ⇒ 此后每一条新消息都被 appendMsg 写进黑洞
//       （appendMsg 结尾就是 `(appendTarget || body).appendChild(m)`）＝「新发的消息不显示」；
//   而 #1313 那轮的看门狗**结构上救不到这一发**：chatPumpStalled() 第一行
//   `if (!batchRendering || !chatPump) return false;` —— 泵只在分帧整窗轮登记（renderWindow 内），
//   同步增量轮根本没有泵，于是「在飞」恒真而「停滞」恒假。
//   前四轮（#1067/#1202/#1294/#1313）各补了一条循环（分帧、同步整窗、原位补丁两处），漏的正是这两条；
//   而且每一轮的尺子都绿——它们量的是「节点在不在 DOM 里」，没有一总量过「渲染器有没有被永久改道」。
//
// 修法＝把这两条循环补齐成与 #1313 同一形态：逐条 try/catch（坏记录跳过＋留证，口径同 threwIdx，刻意
//   不喂 armWindowHoleHeal＝免「重画→又抛→又排」的 700ms 空转）＋ finally 无条件交回
//   appendAvatarBatch／appendTarget／batchRendering，让「抛出去」不再是一种能持久的状态。
//
// 用例：
//   S1~S6  静态锚（两条循环各自的逐条守卫＋两处 finally＋#874b/#874c 入口闸一字未动＋#396 锚点补偿未动）
//   B0     前提：400 条进聊天只画尾窗（上翻才会走增量补画）
//   B1     坏记录那一条不画，**邻居照常补上屏**（HEAD 红：整批抛出＝kids 恒 200）
//   B2     【判别核心】抛错之后「在飞」不持久（flying:false；HEAD 红：true 永远挂着）
//   B3     【症状本体】抛过一条之后，新发的消息照样上屏（HEAD 红：n 在涨而屏上永不出现）
//   B4     事故留证（incr-older-throw 记账，不静默吞掉）
//   B5     不自愈空转（同一坏记录不引发反复重画：kids 稳定且记账不涨）
//   B6     不重复画（屏上 data-idx 单调无倒插、无同一条画两遍）
//   Z1     全程零未捕获异常（本批把抛错接住并留证，不是把它藏起来；HEAD 红＝那一发逃到 window.onerror）
//
// 实测（同一把尺子、同一 tip，两侧各跑一遍）：
//   纯 HEAD 基线＝9 绿 / 11 红，红的恰全本批新契约（S1~S4 缺锚＋B1/B2/B3/B3b/B4/B5/Z1）；
//   红侧读数逐字就是症状本体：flying:true 而 stalled:false（「在飞」恒真却没有泵可接管）·
//   n:402 而 kids:200、tail:399（两条新消息在内存里，屏上永不出现）· inc:[]（静默失败）·
//   "Uncaught"（那一发 renderMsg 抛到了 window.onerror）。带本批的副本＝20 绿 / 0 红。
//   两侧同绿＝夹具诚实、旧语义一字未动：G0/B0/B0b/B1b/B6 ＋ S5/S6/S6b/S6c（#874b／#874c 让路闸、
//   #396 锚点补偿那一行、#1313 的泵与看门狗都在原位）。
//   刻意不留「视口锚定」类行为断言：夹具自己把 scrollTop 写成 0，那一发读数两侧相同、量不出本批的
//   差别（第一版写过一条 B7，两侧同红＝无效断言，已删）。
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
console.log('被测根目录: ' + root);
try { statSync(join(root, 'index.html')); } catch (e) { console.error('❌ 被测根目录没有 index.html（产物未构建＝两侧都会假绿）'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, budgetMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 >= budgetMs) return { ok: false, ms: Date.now() - t0 };
    await sleep(stepMs || 400);
  }
}
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = cands.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A_ = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 320) : '')); } };

console.log('静态断言:');
let src = '', prod = '';
try { src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8'); } catch (e) {}
try { prod = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
const cnt = (s, n) => s.split(n).length - 1;
const bothHas = (needle) => src.includes(needle) && prod.includes(needle);
// 外置 js 产物会整行剥掉注释（#1372 已踩过）＝needle 一律取纯代码形态
const GUARD = 'catch (eThrow) { _incrThrew++; }';
const TEARDOWN = '} finally {\nappendAvatarBatch(false);\nappendTarget = null;\nbatchRendering = false;\n}';
const TEARDOWN_MIN = '}finally{appendAvatarBatch(!1),appendTarget=null,batchRendering=!1}';
A_('S1 两条增量循环各带逐条守卫（src 与产物都恰 2 处，少一条＝那条循环仍能带走整批）',
  cnt(src, GUARD) === 2 && (cnt(prod, GUARD) === 2 || cnt(prod, 'catch(eThrow){_incrThrew++}') === 2), { inSrc: cnt(src, GUARD), inProd: cnt(prod, GUARD) });
A_('S2 两处无条件交回（finally 把 appendTarget／batchRendering／头像批交回＝抛出去不再是持久状态）',
  (src.split(TEARDOWN).length - 1) === 2 && ((prod.split(TEARDOWN).length - 1) === 2 || (prod.split(TEARDOWN_MIN).length - 1) === 2),
  { inSrc: src.split(TEARDOWN).length - 1, inProd: prod.split(TEARDOWN).length - 1 });
A_('S3 上翻批的抛错留证走 #1313 同一本账（incr-older-throw，且只置作废凭据不排自愈）',
  bothHas("if (_incrThrew) { windowStale = true; chatRenderIncident('incr-older-throw', 0, _incrThrew); }"), null);
A_('S4 补尾批同理（incr-newer-throw）',
  bothHas("if (_incrThrew) { windowStale = true; chatRenderIncident('incr-newer-throw', 0, _incrThrew); }"), null);
A_('S5 守卫包住的是 renderMsg 那两行（把守卫挪去别处＝下标仍可能落空）',
  cnt(src, 'const m = renderMsg(msgs[i], i);') >= 2 && bothHas('m.dataset.idx = i;'), null);
// 旧契约一字未动（删任何一条＝本批把邻居的修复顺手改了）
A_('S6 #874b/#874c 两条入口让路闸仍在原位（本批不削让路语义）',
  bothHas('function loadOlderIncremental() {') && bothHas('function loadNewerIncremental(targetLen) {') && cnt(prod, 'if (batchRendering) return;') >= 2, { n: cnt(prod, 'if (batchRendering) return;') });
A_('S6b #396 上翻锚点前后差值补偿未动', bothHas('body.scrollTop = beforeTop + (anchor.offsetTop - anchorTopBefore);'), null);
A_('S6c #1313 分帧轮的泵与看门狗未动（本批不与之对打）', bothHas('chatPump = myPump; chatPumpArmWatch(myPump);') && bothHas('function chatPumpStalled() {'), null);

// ---- 浏览器夹具 ----
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9200 + (process.pid % 70);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1389-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
function mkClient(wsUrl) {
  const c = { pend: new Map(), id: 0, errors: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl); c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String((m.params.exceptionDetails || {}).text || (m.params.exceptionDetails.exception || {}).description || '').slice(0, 160)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  // 每个 CDP 调用带超时：本仓有两次探针被一个不回来的调用整支挂住的教训
  c.cdp = (method, params = {}, ms = 15000) => { const id = ++c.id; return Promise.race([new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }), sleep(ms).then(() => ({ __timeout: method }))]); };
  c.evalJs = async (expr) => {
    const r = await c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.__timeout) return null;
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  };
  return c;
}
const listTargets = async () => (await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json());
async function waitCdp() { for (let i = 0; i < 80; i++) { try { await listTargets(); return; } catch (e) { await sleep(200); } } throw new Error('no cdp'); }

// 夹具纪律（v1 的教训，别再犯）：开屏没 dismissed 时 base.css:108 的
// `.splash:not(.hide) ~ .phone{visibility:hidden}` 会把整棵 .phone 藏起来——届时「每条消息
// visibility:hidden」在**稳态**也成立，任何按可见性下的断言都会假红/假绿。故本支进门就走
// 「点开屏 → 必读公告滑到底 → 确认进入」，并用 G0 硬闸守住「.phone 真的 visible」。
const ENTER_A = `(function(){var sp=document.getElementById('splash'); if(sp){try{sp.click();}catch(e){}} var e=document.getElementById('splash-enter'); if(e&&!e.hidden)e.click(); return 1;})()`;
const ENTER_B = `(function(){var ms=document.getElementById('splash-mandatory-scroll'); if(ms){ms.scrollTop=ms.scrollHeight; ms.dispatchEvent(new Event('scroll',{bubbles:true}));} var me=document.getElementById('splash-mandatory-enter'); if(me)me.click(); return 1;})()`;
const SNAP = `(function(){
  var b=document.getElementById('chat-body'), pc=document.getElementById('page-chat');
  var idxs=[]; for(var i=0;i<b.children.length;i++){var v=b.children[i].dataset?parseInt(b.children[i].dataset.idx,10):NaN; if(isFinite(v))idxs.push(v);}
  var prev=-1,dup=0; for(var q=0;q<idxs.length;q++){ if(idxs[q]<=prev)dup++; prev=idxs[q]; }
  return JSON.stringify({
    kids:b.children.length, head:idxs.length?idxs[0]:-1, tail:idxs.length?idxs[idxs.length-1]:-1, dup:dup,
    n:window.getChatMsgs?window.getChatMsgs().length:-1,
    flying:(window.__chatPumpDiag?window.__chatPumpDiag().flying:null),
    stalled:(window.__chatPumpDiag?window.__chatPumpDiag().stalled:null),
    inc:(window.__chatRenderIncidents||[]).map(function(x){return x.why;}),
    cover:pc.classList.contains('chat-loading-cover'), bodyVis:getComputedStyle(b).visibility,
    st:Math.round(b.scrollTop), sh:b.scrollHeight, ch:b.clientHeight
  });
})()`;

let C = null;
try {
  await waitCdp();
  C = mkClient((await listTargets()).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await C.connect();
  await C.cdp('Page.enable'); await C.cdp('Runtime.enable');
  await C.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  await C.cdp('Page.navigate', { url: 'about:blank' }); await sleep(400);
  await C.cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,service_workers' });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await C.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await C.evalJs(ENTER_A); await sleep(600); await C.evalJs(ENTER_B); await sleep(900);
  await C.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}['ta-ask','ta-choose','ta-curious','ta-roast','ta-tacc'].forEach(function(k){try{var s2=window.activeStore();var r=s2.get(k);var d=r?JSON.parse(r):{};d.settings=d.settings||{};d.settings.enabled=false;s2.set(k,JSON.stringify(d));}catch(e){}});return 1;})()");
  await sleep(400);
  const phoneVis = await C.evalJs(`(function(){var ph=document.querySelector('.phone');return ph?getComputedStyle(ph).visibility:'nf';})()`);
  A_('G0 夹具硬闸：真的进了应用（.phone computed visibility = visible）', phoneVis === 'visible', { phoneVis });
  if (phoneVis !== 'visible') throw new Error('夹具没进场——后续读数一律不作数');

  await C.evalJs(`(function(){ var now=Date.now(), arr=[]; for (var i=0;i<400;i++) arr.push({side:i%2?'in':'out',text:'记录'+String(i).padStart(3,'0'),ts:now-(400-i)*60000}); return window.chatImportMsgs(arr)?'true':'false'; })()`);
  await sleep(1500);
  await C.evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(3500);
  const b0 = JSON.parse(await C.evalJs(SNAP));
  // ⚠️ 别拿「恰 200 条」当前提：站内自发消息生成器（摸鱼小结／TA 心情／查岗那一族）会在铺数据到进聊天
  // 这几秒里自己补投递（本仓尺子的既有 flaky 指纹），读数就会是 201／202。判据取「尾窗已铺满且已贴到
  // 最新、且没有在飞」这三件本批真正依赖的事实，条数只按窗口上限以下界问。
  A_('B0 前提：400 条进聊天只画尾窗（≥200 条＝上翻才会走增量补画），屏上尾部已贴最新且此刻没有在飞', b0.kids >= 200 && b0.kids <= 210 && b0.head >= 197 && b0.tail === b0.n - 1 && b0.flying === false && b0.dup === 0, b0);

  // 把一条坏记录种在「上翻那一批会画到的区间」里（renderMsg 里 rec.mood.forEach 必抛＝#1313 同款夹具），
  // 且刻意落在尾窗之外——尾窗内它不会被画，重渲不会当场暴露，只有**增量补画**这一条路会撞上它。
  await C.evalJs(`(function(){ var a=window.chatExportMsgs(); a[150]={side:'in',ts:a[150].ts,text:'__BADREC__',mood:'不是数组'}; return window.chatImportMsgs(a)?1:0; })()`);
  await sleep(3500);
  const b1pre = JSON.parse(await C.evalJs(SNAP));
  A_('B0b 种记录之后屏上照旧（坏记录在尾窗之外，尚未被任何路径画到）', b1pre.kids >= 200 && b1pre.kids <= 212 && b1pre.flying === false, b1pre);

  // 触发增量补画：滚到顶 → loadOlderIncremental() 画 newStart..renderStart（含 150）
  await C.evalJs(`(function(){var b=document.getElementById('chat-body'); b.scrollTop=0; b.dispatchEvent(new Event('scroll')); return 1;})()`);
  await sleep(400);
  await C.evalJs(`(function(){var b=document.getElementById('chat-body'); b.scrollTop=0; b.dispatchEvent(new Event('scroll')); return 1;})()`);
  const b1got = await waitFor(async () => { const q = JSON.parse(await C.evalJs(SNAP)); return (q.head < b1pre.head && q.kids > b1pre.kids) ? q : false; }, 9000, 400);
  const b1 = JSON.parse(await C.evalJs(SNAP));
  A_('B1 一条坏记录不再带走整批：邻居照常补上屏（HEAD 红＝整批抛出，kids 恒 200、head 恒 200）', b1got.ok && b1.kids > b1pre.kids + 50 && b1.head < b1pre.head, { kids: b1.kids, head: b1.head, pre: b1pre.kids });
  const paintedBad = await C.evalJs(`(function(){var b=document.getElementById('chat-body');return b.textContent.indexOf('__BADREC__')>=0;})()`);
  A_('B1b 跳过的就是那一条（坏记录没画，不是整窗没画）', paintedBad === false, { paintedBad });

  A_('B2 【判别核心】抛错之后「在飞」不持久（HEAD 红：batchRendering 永久为真，而 stalled 恒假＝没有泵可接管）', b1.flying === false, { flying: b1.flying, stalled: b1.stalled });

  // 症状本体：黑洞形成后，新发的消息还能不能上屏
  const MARK1 = '__AFTER_STUCK_1__', MARK2 = '__AFTER_STUCK_2__';
  await C.evalJs(`(function(){ try { window.chatAddIn(${JSON.stringify(MARK1)}); window.chatAddIn(${JSON.stringify(MARK2)}); return 1; } catch(e){ return 0; } })()`);
  const seen = await waitFor(async () => { const t = await C.evalJs(`(function(){var b=document.getElementById('chat-body');return b&&(b.textContent.indexOf(${JSON.stringify(MARK1)})>=0&&b.textContent.indexOf(${JSON.stringify(MARK2)})>=0);})()`); return t ? true : false; }, 12000, 400);
  const b3 = JSON.parse(await C.evalJs(SNAP));
  A_('B3 【症状本体】撞过一条坏记录之后，新发的消息照样上屏（HEAD 红＝全写进没人挂的 fragment，n 在涨而屏上永不出现）', seen.ok, { n: b3.n, kids: b3.kids, tail: b3.tail });
  A_('B3b 而且写进的是屏上那棵子树，不是游离 fragment', b3.tail === b3.n - 1, { tail: b3.tail, n: b3.n, kids: b3.kids });

  A_('B4 事故被留证（incr-older-throw 记账＝接住而不是藏起来）', b3.inc.some((x) => /incr-older-throw/.test(x)), b3.inc);
  await sleep(6000); // > #1004 补画窗口 700ms 的多轮：抛错下标若被喂进自愈队列，这里会看到反复整窗重画
  const b5a = JSON.parse(await C.evalJs(SNAP));
  await sleep(4000);
  const b5b = JSON.parse(await C.evalJs(SNAP));
  const nOld = (s) => s.inc.filter((x) => /incr-older-throw/.test(x)).length;
  A_('B5 不自愈空转（同一坏记录不引发反复整窗重画：屏上内容稳定、记账不涨；条数只容 2 条以内＝站内自发投递）', Math.abs(b5b.kids - b5a.kids) <= 2 && nOld(b5b) <= nOld(b5a) + 1 && b5b.kids > 200, { kidsA: b5a.kids, kidsB: b5b.kids, incA: nOld(b5a), incB: nOld(b5b) });
  A_('B6 没有重复画（data-idx 单调、无同一条两遍）', b5b.dup === 0, { dup: b5b.dup, kids: b5b.kids });
  A_('Z1 全程零未捕获异常（HEAD 红＝那一发 renderMsg 抛到了 window.onerror）', C.errors.length === 0, C.errors.slice(0, 3));
} catch (e) {
  A_('夹具跑通（脚本自身未抛错）', false, String(e && e.message || e));
} finally {
  try { server.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
console.log(`\n结果: ${pass} 绿 / ${fail} 红`);
process.exit(fail ? 1 : 0);
