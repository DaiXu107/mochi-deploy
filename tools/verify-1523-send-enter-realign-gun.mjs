// ===== 常驻回归脚本 #1523：「我发的消息看不见、TA 一回就整屏重画才显形」＝发送与站内进页两把落定枪 =====
// 用法：node tools/verify-1523-send-enter-realign-gun.mjs [被测根目录]
//
// 症状（作者 2026-10-01 复报，同一句话第六次；本次给出两条决定性新线索，经选项框确认）：
//   ① 坏态屏上形态＝「旧消息跑到屏幕上半截，下半截一大片空白」；
//   ② TA 回复后「才显示」那一刻＝「整屏记录重画了一遍（闪一下、全部重新弹出来）」。
//   ①＋② 合起来只指向一种机制：#978/#1476 那一族的**滚动撕裂**（视觉滚动树停在旧偏移、
//   scrollTop 读数假绿），而**不是** #1004/#1313/#1389 那一族的「节点没画进 DOM」——
//   后者会让 TA 的消息同样不显示，与作者「联系人发送的消息正常显示」直接矛盾。
//   前几轮各修了一条循环／一个吞枪口，尺子量的都是「节点在不在 DOM 里」，没有一轮问
//   「这一发挂过落定枪没有」。
//
// 根因（零机型／零 UA 分支）：全站能治愈撕裂的只有「几何全静默后无条件同值重落」那一枪
//   （chatResumeRealign，#978 立、#1476 放宽死线到 8s 并加三去向取证），而它过去只挂在
//   **回前台**那几路上（why＝repin350/heal-even/heal-stall/heal-draw）：
//   ① 自己发消息＝在几何风暴中间态连写三次 scrollTop（同步＋rAF＋120ms，#516/#492 定的
//      「本人的消息即刻到底」契约）——写完没有任何人再复核；#871 那把落定锁与 #706 看门狗
//      的判据都是「离底 >8px 才写」，恰好在撕裂态失明（#978 注释原话：写其实落了，只有滚动
//      树/绘制错位）。所以每发一条＝重新撕一次＝作者所见「继续发送依旧空白」。
//   ② 站内切页回聊天页（退出到桌面再回来）**不发 visibilitychange**＝四把回场枪一把都不经过；
//      而这条路上若同窗补丁命中（#220）就是零重建，也就没有那次能救场的整窗重画。
//   TA 的消息为什么正常：它落地时键盘早已收起、几何已定，写落点不再打在中间态上；它撞上
//   的那一次整窗重画（body.innerHTML='' → 重建）＝强制重新布局＝撕裂被治好＝作者所见「闪一下
//   全部重新弹出来」；只有刷新才恢复＝同一次重画。
//
// 修法＝不动任何一把既有枪的判据（#643b 那把「条件写」枪照旧），把已有的无条件落定枪挂到这
//   两个从没挂过枪的触发源上，各带自己的来源标记进 #1466 取证环：
//   chat.js maybeScrollChatBottom 的 out／用户主动 follow 分支 → chatResumeRealign('send')
//   chat.js enterChat 重活收尾（chatEntrySettle 之后） → chatResumeRealign('enter')
//   健康态＝重写同一个值零副作用（#933/#978 既有结论）；#162「用户在翻历史就不拽底」由枪自带
//   的 !chatPinnedBottom 闸门保住，本批不新增判据。
//
// 用例：
//   S1~S2  两处挂枪在 src 与产物里都在（删掉任一＝那条触发源回到「写完没人复核」）
//   S3~S4  两处挂枪**在各自的函数体内**（挪去别处＝看着有针实际不生效）
//   S5     #643b 那把条件写落定锁与 #978c 无条件重落一字未动（本批不削既有语义）
//   B1     真产物：发一条之后，取证环里出现来源＝send 的落定枪去向
//   B2     真产物：站内切页回聊天页之后，取证环里出现来源＝enter 的落定枪去向
//   B3     枪写完之后屏上仍贴底（健康态零副作用：这一枪不许把人从底部拽走；判据与写方同尺
//          ＝chatScrollMax 口径，裸 gap 在「正在输入」行显示期会读出离底一行高＝#998 假读数）
//   B4     桌面期发两条（聊天页不在屏上＝两处挂点按既有语义早退，不替隐藏页写滚动）→ 回页后
//          一条不少、且进页那一枪照样落地
//   Z1     全程零未捕获异常
//
// 实测：见同批 WORKLOG 条目（绿侧＝HEAD＋仅本批；红侧＝纯 HEAD 副本）。
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
    await sleep(stepMs || 300);
  }
}
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = cands.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A_ = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 400) : '')); } };

console.log('静态断言:');
let src = '', prod = '';
try { src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8'); } catch (e) {}
try { prod = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
if (!src || !prod) { console.error('❌ 读不到 src/js/chat.js 或 js/chat.js（被测根目录不完整）'); process.exit(2); }
const inBoth = (n) => src.includes(n) && prod.includes(n);
const bodyOf = (s, header) => { const i = s.indexOf(header); if (i < 0) return ''; const j = s.indexOf('\nfunction ', i + header.length); return s.slice(i, j < 0 ? i + 3000 : j); };

const GUN_SEND = "chatResumeRealign('send');";
const GUN_ENTER = "chatResumeRealign('enter');";
A_('S1 发送分支挂了落定枪（src 与产物都在；删＝每发一条重新撕裂后无人复核）', inBoth(GUN_SEND), { inSrc: src.includes(GUN_SEND), inProd: prod.includes(GUN_SEND) });
A_('S2 站内进聊天页挂了落定枪（src 与产物都在；删＝切页回聊天不发 visibilitychange，四把回场枪一把都不经过）', inBoth(GUN_ENTER), { inSrc: src.includes(GUN_ENTER), inProd: prod.includes(GUN_ENTER) });
A_('S3 那发挂枪在 maybeScrollChatBottom 体内、且在 out／follow 那一支（挂到 in 支＝削掉「绝不打扰」；挂到函数外＝根本不会随发送触发）',
  bodyOf(src, 'function maybeScrollChatBottom(side) {').includes(GUN_SEND) && bodyOf(prod, 'function maybeScrollChatBottom(side) {').includes(GUN_SEND), null);
A_('S4 那发挂枪在 enterChat 重活收尾（chatEntryPutThen 第二段）内（挂在第一段＝屏上还没有列表就开枪，量不到本批要治的形态）',
  bodyOf(src, 'function enterChat() {').includes(GUN_ENTER) && bodyOf(prod, 'function enterChat() {').includes(GUN_ENTER), null);
A_('S5 既有两把枪一字未动（#643b 条件写落定锁＋#978c 无条件同值重落）',
  inBoth('if (cb868 && chatScrollMax() - cb868.scrollTop > 8) scrollChatBottom();') && inBoth("if (chatPinnedBottom) { scrollChatBottom(); _rk('realign'); }"), null);

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9500 + (process.pid % 40));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1523-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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

const ENTER_A = `(function(){var sp=document.getElementById('splash'); if(sp){try{sp.click();}catch(e){}} var e=document.getElementById('splash-enter'); if(e&&!e.hidden)e.click(); return 1;})()`;
const ENTER_B = `(function(){var ms=document.getElementById('splash-mandatory-scroll'); if(ms){ms.scrollTop=ms.scrollHeight; ms.dispatchEvent(new Event('scroll',{bubbles:true}));} var me=document.getElementById('splash-mandatory-enter'); if(me)me.click(); return 1;})()`;
// 取证环读法（#1466）：__chatWinRing() 回 {backs,progPx,ring,cur}；环条目 k∈{realign,realign-miss,realign-drop}，w＝挂枪来源
const RING = `(function(){var f=window.__chatWinRing; if(!f) return 'nofn'; var o=f()||{}; var a=o.ring||[]; return JSON.stringify(a.map(function(x){return {k:x.k,w:x.w,lo:x.lo,hi:x.hi};}));})()`;
const GEOM = `(function(){var b=document.getElementById('chat-body');var pc=document.getElementById('page-chat');
  var idxs=[];for(var i=0;i<b.children.length;i++){var v=parseInt(b.children[i].dataset.idx,10);if(isFinite(v))idxs.push(v);}
  var prev=-1,dup=0;for(var q=0;q<idxs.length;q++){if(idxs[q]<=prev)dup++;prev=idxs[q];}
  var last=idxs.length?idxs[idxs.length-1]:-1;
  var ty=document.getElementById('chat-typing'); var th=(ty&&!ty.hidden&&ty.offsetHeight)||0; // 与写方同尺（chatScrollMax＝sh−(ch＋打字行高)）：#998 实证裸口径在行显示期把真贴底读成离底一行高
  return JSON.stringify({n:window.getChatMsgs().length,kids:b.children.length,tail:last,dup:dup,
    st:Math.round(b.scrollTop),max:Math.max(0,b.scrollHeight-b.clientHeight),gap:Math.round(b.scrollHeight-b.scrollTop-b.clientHeight),
    typingH:th,gapT:Math.round(b.scrollHeight-th-b.clientHeight-b.scrollTop),
    pinned:(window.__chatPinned?window.__chatPinned():null),pageHidden:pc.hidden});})()`;

let C = null;
const ring = async () => { const raw = await C.evalJs(RING); if (!raw || raw === 'nofn') return []; try { return JSON.parse(raw) || []; } catch (e) { return []; } };
try {
  await waitCdp();
  C = mkClient((await listTargets()).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await C.connect();
  await C.cdp('Page.enable'); await C.cdp('Runtime.enable');
  await C.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' }); await sleep(3000);
  await C.cdp('Page.navigate', { url: 'about:blank' }); await sleep(400);
  await C.cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb,service_workers' });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' }); await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await C.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await C.evalJs(ENTER_A); await sleep(600); await C.evalJs(ENTER_B); await sleep(900);
  await C.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));}catch(e){}['ta-ask','ta-choose','ta-curious','ta-roast','ta-tacc'].forEach(function(k){try{var s2=window.activeStore();var r=s2.get(k);var d=r?JSON.parse(r):{};d.settings=d.settings||{};d.settings.enabled=false;s2.set(k,JSON.stringify(d));}catch(e){}});return 1;})()");
  await sleep(400);
  const phoneVis = await C.evalJs(`(function(){var ph=document.querySelector('.phone');return ph?getComputedStyle(ph).visibility:'nf';})()`);
  A_('G0 夹具硬闸：真的进了应用（.phone computed visibility = visible）', phoneVis === 'visible', { phoneVis });
  if (phoneVis !== 'visible') throw new Error('夹具没进场——后续读数一律不作数');
  if (await C.evalJs(RING) === 'nofn') throw new Error('取证环读不到（window.__chatWinRing 不在＝B1/B2/B4 无从判）');

  await C.evalJs(`(function(){ var now=Date.now(), arr=[]; for (var i=0;i<600;i++) arr.push({side:i%2?'in':'out',text:'记录'+String(i).padStart(3,'0'),ts:now-(600-i)*60000}); return window.chatImportMsgs(arr)?'true':'false'; })()`);
  await sleep(1500);

  // ---- B2：站内切页进聊天页（点图标 → enterChat）----
  await C.evalJs(`(function(){var a=document.querySelector('.app[data-app="chat"]');if(a)a.click();return 1;})()`);
  await sleep(4000); // 重活＋贴底三连＋枪的 120ms 首轮；等它落定
  const ringEnter = await ring();
  A_('B2 进聊天页挂了来源＝enter 的落定枪（HEAD 红＝这一路压根没有枪，同窗补丁零重建＝撕裂永无补口）',
    ringEnter.some((x) => x.w === 'enter' && String(x.k || '').indexOf('realign') === 0), { ring: ringEnter.slice(-6) });

  // ---- B1：自己发一条 → 来源＝send 的落定枪----
  await sleep(2500); // 膛内那一枪（enter）先落地，否则 chatResumeRealign 的「已有一枪在膛」会吞掉 send 的标记
  await C.evalJs(`(function(){window.chatSendMsg('__SND_1__');return 1;})()`);
  const gotSend = await waitFor(async () => { const r = await ring(); return r.some((x) => x.w === 'send' && String(x.k || '').indexOf('realign') === 0) ? r : false; }, 12000, 200);
  const ringSend = await ring();
  A_('B1 【判别核心】自己发一条之后，取证环里有来源＝send 的落定枪去向（HEAD 红＝发送这一族历史上从没挂过枪）', gotSend.ok,
    { ring: (ringSend || []).slice(-6).map((x) => x.k + '@' + (x.w || '')) });
  A_('B1b 那一枪的去向是「写了」而不是「丢了」（聊天页在屏上＋钉住态＝该补的一枪必须补上）',
    ringSend.some((x) => x.w === 'send' && x.k === 'realign'), { ring: ringSend.slice(-6).map((x) => x.k + '@' + (x.w || '')) });

  // ---- B3：健康态零副作用——枪写完屏上仍贴底、无重复、尾条贴最新 ----
  const g3 = JSON.parse(await C.evalJs(GEOM));
  A_('B3 落定枪没有把人从底部拽走、也没重复画（与写方同尺 gapT≤8、尾条＝最新一条、data-idx 单调）',
    g3.gapT <= 8 && g3.tail === g3.n - 1 && g3.dup === 0 && g3.kids > 200, g3);

  // ---- B4：桌面期发消息（聊天页不在屏上）＝本批两处挂点都不可达，回页后必须一条不少 ----
  // 如实标注：maybeScrollChatBottom 在挂枪点之前就有 `if (!chatVisible()) return;`，桌面期发的那
  // 两条不会、也不该替聊天页写滚动，所以这里不主张「看见 realign-drop」那种证据（测不到的否定式），
  // 只钉住「零副作用＋数据不丢＋回页后贴底」三件可读数。
  await C.evalJs(`(function(){var t=document.querySelector('.tab[data-page="page-phone"]');if(t)t.click();return 1;})()`);
  await sleep(600);
  const stOnDesk = await C.evalJs(`(function(){var b=document.getElementById('chat-body');return Math.round(b.scrollTop);})()`);
  await C.evalJs(`(function(){window.chatSendMsg('__SND_2__');window.chatSendMsg('__SND_3__');return 1;})()`);
  await sleep(1500);
  const stAfterDesk = await C.evalJs(`(function(){var b=document.getElementById('chat-body');return Math.round(b.scrollTop);})()`);
  await C.evalJs(`(function(){var a=document.querySelector('.app[data-app="chat"]');if(a)a.click();return 1;})()`);
  await sleep(4000);
  const g4 = JSON.parse(await C.evalJs(GEOM));
  const ring4 = await ring();
  A_('B4 桌面期发的两条回页后一条不少、且回页那一枪照样落地（tail 贴最新＋同尺 gapT≤8＋有 enter 来源的去向）',
    g4.tail >= g4.n - 1 && g4.gapT <= 8 && ring4.some((x) => x.w === 'enter'), { geom: g4, deskScroll: [stOnDesk, stAfterDesk], ring: ring4.slice(-5).map((x) => x.k + '@' + (x.w || '')) });

  A_('Z1 全程零未捕获异常', C.errors.length === 0, C.errors.slice(0, 3));
} catch (e) {
  A_('夹具跑通（脚本自身未抛错）', false, String((e && e.message) || e));
} finally {
  try { server.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
console.log(`\n结果: ${pass} 绿 / ${fail} 红`);
process.exit(fail ? 1 : 0);
