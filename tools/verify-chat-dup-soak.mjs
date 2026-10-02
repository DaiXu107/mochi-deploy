// ===== 复现/回归：长会话「一条变多条」浸泡测试（vivo X200 Edge / Android 16 / Edge 151 实报画像）=====
// 用法：node build.mjs && node tools/verify-chat-dup-soak.mjs
// 场景画像（取自 2026-09-18 18:45 真机诊断）：约 800 条历史 / LS chat-msgs 2.7MB（未触发 #722
// 分块）、PWA standalone、保活在场但「后台终止 10 次」＝页面被反复冻结/回收、Edge 151 安卓。
// 每轮跑一遍真实用户动作序列，逐步计数，任何一条消息在【内存/屏上】出现两次即红。
//   R1 常规：发送 + TA 来消息 + 切后台回前台 + 退出聊天再进
//   R2 重载：整页刷新（权威读库链）后再发一条
//   R3 慢 IDB：indexedDB.open 延迟 12s（读库超时→保险丝→有损快照→IDB 迟到合并）整轮
//   R4 深翻：上翻历史触发裁窗 → 回底补画（#766 渲染层通道）
// 断言口径：按「本轮唯一标记文本」逐条计数（开屏会注入当日提醒，绝对总条数不可用）。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dupsoak-' + Date.now()),
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
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 361, height: 801, deviceScaleFactor: 3.5, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
  return !!ok;
}

const KEY = 'xy-home-v2:default:chat-msgs';
const TAIL = 'xy-home-v2:default:chat-tail';
const ARCH = 'xy-home-v2:default:chat-arch';
const NSEED = 800;
// 种子：800 条混合历史（纯文本为主 + 每 40 条一张图 + 每 55 条一张互动卡），近似真机 2.7MB 体量
function seed() {
  const t = Date.now() - NSEED * 60000;
  const recs = [];
  for (let i = 0; i < NSEED; i++) {
    const side = i % 2 ? 'in' : 'out';
    const ts = t + i * 60000;
    if (i % 40 === 7) { recs.push({ side, text: '历史#' + i, img: 'data:image/jpeg;base64,' + 'Q'.repeat(3000), ts }); continue; }
    if (i % 55 === 13) { recs.push({ side: 'in', special: 'ask-card', text: '历史#' + i, askQuestion: '历史问题#' + i, askType: 'text', askStatus: 'pending', ts }); continue; }
    recs.push({ side, text: '历史#' + i + '：' + ('填充'.repeat(60)), ts });
  }
  return JSON.stringify(recs);
}

async function boot(seedFresh) {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1800);
  if (seedFresh) {
    const s = seed();
    const ok = await evalJs(`(async function(){
      try {
        localStorage.setItem('${KEY}', ${JSON.stringify(s)});
        await window.idbSet('${KEY}', ${JSON.stringify(s)});
        localStorage.removeItem('${TAIL}'); if (window.idbDelete) await window.idbDelete('${TAIL}');
        localStorage.removeItem('${ARCH}'); if (window.idbDelete) await window.idbDelete('${ARCH}');
        return true;
      } catch (e) { return false; }
    })()`);
    if (!ok) { console.error('种子写入失败'); process.exit(1); }
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(1800);
  }
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
  await sleep(1200); // 等权威合并 + 尾巴回放落定
}
async function openChat() {
  await evalJs("(function(){ if(window.enterChat) window.enterChat(); return 1; })()");
  await sleep(800);
}
async function backHome() {
  await evalJs("(function(){ var b=document.getElementById('chat-back'); if(b) b.click(); return 1; })()");
  await sleep(500);
}
async function send(text) {
  return evalJs(`(function(){
    try {
      var inp=document.getElementById('chat-input'), s=document.getElementById('chat-send');
      if(!inp||!s) return 'no controls';
      inp.innerText = ${JSON.stringify(text)};
      inp.dispatchEvent(new Event('input',{bubbles:true}));
      s.click();
      return 'sent';
    } catch(e){ return 'err:'+e.message; }
  })()`);
}
async function bgCycle(hideMs) {
  await evalJs(`(function(){
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'hidden';}});
    window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange'));
    return 1;
  })()`);
  await sleep(hideMs);
  await evalJs(`(function(){
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false;}});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'visible';}});
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
    return 1;
  })()`);
  await sleep(800);
}
// 按标记统计：内存条数 / 屏上气泡数 / 尾巴日志条数
function probe(mk) {
  return `(function(){
    var mk=${JSON.stringify(mk)};
    var a=(window.getChatMsgs?window.getChatMsgs():[])||[];
    var arr=0, arrTs=[];
    a.forEach(function(m){ if(m && String(m.text||'').indexOf(mk)>=0){ arr++; arrTs.push(m.ts); } });
    var body=document.getElementById('chat-body');
    var dom=0, domIdx=[];
    if(body){ body.querySelectorAll('[data-idx]').forEach(function(el){ if((el.textContent||'').indexOf(mk)>=0){ dom++; domIdx.push(el.dataset.idx); } }); }
    return JSON.stringify({ arr:arr, arrTs:arrTs, dom:dom, domIdx:domIdx, total:a.length });
  })()`;
}
// 全局不变量：①同 ts+side 出现两次＝身份级重复（任何回放通道产物都是这个形态）②屏上同一
// 文本两个气泡 ③tail 日志里已有身份在库里＝永不退休复发
function globalScan() {
  return `(function(){
    var a=(window.getChatMsgs?window.getChatMsgs():[])||[];
    var byId={}, idDup=[], seenC={}, txtDup=[];
    a.forEach(function(m){ if(!m) return;
      var id=(m.ts||0)+'|'+(m.side||'');
      if(byId[id]) idDup.push(id); else byId[id]=1;
      var k=(m.side||'')+'|'+String(m.text||'').slice(0,40);
      if(k!=='|') { if(seenC[k]) txtDup.push(k); else seenC[k]=1; }
    });
    var body=document.getElementById('chat-body'); var dupIdx=[];
    if(body){ var ix={}; body.querySelectorAll('[data-idx]').forEach(function(el){ var k=el.dataset.idx; ix[k]=(ix[k]||0)+1; }); Object.keys(ix).forEach(function(k){ if(ix[k]>1) dupIdx.push(k); }); }
    var tail=[]; try{ tail=JSON.parse(localStorage.getItem('${TAIL}')||'[]'); }catch(e){}
    var tailLive=0; try{ tail.forEach(function(j){ if(j && byId[((j.ts||0)+'|'+(j.side||''))]) tailLive++; }); }catch(e){}
    // 裸身份(ts|side)撞车**不等于**重复：应用自己就会在同一毫秒投两条不同消息（TA 状态卡 +
    // 查岗提醒同 tick），各带出生号＝合法批量。故判据取 #776 体检的 sus（共享副本键、或无出生号
    // 可分辨的多余份数），裸数只作参考 bareN。红的时候把可疑成对记录本体打出来（文本头/媒体长度/
    // 出生号）——uid 相同＝副本没收敛（判据漏），一边无号＝存量脏数据。
    var z = (window.__mochiDupCensus && window.__mochiDupCensus()) || {};
    var kindOf = function(m){ var t=(m.type==='text'||!m.type)?'':String(m.type||''); return (m.ts||0)+'|'+(m.side||'')+'|'+(m.special||'')+'|'+t; };
    var groups={}, idDupRecs=[], localSus=0;
    a.forEach(function(m,i){ if(!m) return; var id=kindOf(m); (groups[id]=groups[id]||[]).push({ m:m, i:i }); });
    Object.keys(groups).forEach(function(id){
      var g=groups[id]; if(g.length<2) return;
      var u0=g[0].m.uid;
      var sus=g.slice(1).filter(function(x){ return !(u0 && x.m.uid && x.m.uid!==u0); });
      if(!sus.length) return;
      localSus += sus.length;
      idDupRecs.push({ id:id, i:g[0].i, side:g[0].m.side||'', ts:g[0].m.ts||0, sp:g[0].m.special||'',
        t:String(g[0].m.text||'').slice(0,28), uid:u0||'' });
      sus.slice(0,2).forEach(function(x){
        idDupRecs.push({ id:id, i:x.i, side:x.m.side||'', ts:x.m.ts||0, sp:x.m.special||'',
          t:String(x.m.text||'').slice(0,28), img:(x.m.img||'').length, uid:x.m.uid||'' });
      });
    });
    return JSON.stringify({ total:a.length, idDup:idDup.slice(0,6), idDupN:(typeof z.sus==='number'? z.sus : localSus), localSus:localSus,
      bareN:idDup.length, sus:z.sus, same:z.same, uidc:z.uidc, drift:z.drift, batch:z.batch,
      idDupRecs:idDupRecs.slice(0,8),
      txtDup:txtDup.slice(0,6), txtDupN:txtDup.length, domDupIdx:dupIdx, tailN:tail.length, tailLive:tailLive,
      archOn: !!localStorage.getItem('${ARCH}') });
  })()`;
}

// ================= R1 常规会话 + 切后台 =================
await boot(true);
await openChat();
{
  const r = await evalJs(globalScan());
  console.log('  基线 ' + r);
}
let bad = 0;
for (let i = 1; i <= 3; i++) {
  const mk = 'SOAK1-' + i;
  await send(mk + '-我发');
  await sleep(400);
  await evalJs(`window.chatAddIn(${JSON.stringify(mk + '-ta来')})`);
  await sleep(400);
  await bgCycle(1500);
  const p1 = JSON.parse(await evalJs(probe(mk)) || '{}');
  const ok = p1.arr === 2 && p1.dom === 2;
  if (!ok) bad++;
  check('R1-' + i + ' 发送+来消息+切后台：各 1 条（内存 2 / 屏上 2）', ok, JSON.stringify(p1));
}
{
  const r = JSON.parse(await evalJs(globalScan()) || '{}');
  check('R1 全局无可疑身份重复（出生号口径）', r.idDupN === 0, JSON.stringify(r).slice(0, 400));
  check('R1 屏上无重复 data-idx', Array.isArray(r.domDupIdx) && r.domDupIdx.length === 0, JSON.stringify(r.domDupIdx));
  // 注：会话进行中尾巴日志本来就该留着本轮消息（退休发生在下一次权威读库覆盖后），故 tailLive 只在 R2 重载后校验。
}

// ================= R2 连续重载：翻倍只在刷新后显形 =================
for (let i = 1; i <= 3; i++) {
  await boot(false);
  await openChat();
  const g = JSON.parse(await evalJs(globalScan()) || '{}');
  const p = JSON.parse(await evalJs(probe('SOAK1-1-我发')) || '{}');
  check('R2-' + i + ' 重载后 SOAK1-1 仍 1 条、无身份重复', p.arr === 1 && g.idDupN === 0, JSON.stringify(p) + ' idDupN=' + g.idDupN + ' tail=' + g.tailN + '/' + g.tailLive);
  check('R2-' + i + ' 重载后尾巴日志已退休（不留着已在库里的条目）', g.tailLive === 0, 'tailN=' + g.tailN + ' tailLive=' + g.tailLive);
}

// ================= R3 慢 IDB（读库超时 → 有损快照 → 权威迟到合并） =================
const slowIdb = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(function () {
  const DELAY = 12000;
  const origOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function () {
    const req = origOpen.apply(this, arguments);
    let userFn = null;
    Object.defineProperty(req, 'onsuccess', {
      get: function () { return userFn; },
      set: function (f) { userFn = function (ev) { setTimeout(function () { f.call(req, ev); }, DELAY); }; }
    });
    return req;
  };
})();` });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
await openChat();
await send('SOAK3-慢IDB');
await evalJs(`window.chatAddIn('SOAK3-ta来')`);
await sleep(1200);
{
  const p = JSON.parse(await evalJs(probe('SOAK3')) || '{}');
  check('R3a IDB 挂起期发送+来消息各 1 条', p.arr === 2 && p.dom === 2, JSON.stringify(p));
}
await sleep(18000); // 跨过 open 延迟 + idbGet 超时 + 保险丝 + 迟到权威合并
{
  const p = JSON.parse(await evalJs(probe('SOAK3')) || '{}');
  const g = JSON.parse(await evalJs(globalScan()) || '{}');
  check('R3b 权威迟到合并后 SOAK3 仍各 1 条', p.arr === 2 && p.dom === 2, JSON.stringify(p));
  check('R3b 权威迟到合并未产生身份重复', g.idDupN === 0, 'sus=' + g.idDupN + ' bare=' + g.bareN + ' ' + JSON.stringify(g.idDupRecs).slice(0,300) + ' total=' + g.total);
}
if (slowIdb && slowIdb.identifier) await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: slowIdb.identifier });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
await sleep(1500);
await openChat();
{
  const p = JSON.parse(await evalJs(probe('SOAK3')) || '{}');
  const g = JSON.parse(await evalJs(globalScan()) || '{}');
  check('R3c 慢 IDB 落盘后重载仍各 1 条（未固化翻倍）', p.arr === 2 && p.dom === 2, JSON.stringify(p));
  check('R3c 重载后无身份重复', g.idDupN === 0, 'idDupN=' + g.idDupN + ' total=' + g.total);
}

// ================= R4 深翻历史 → 回底补画（渲染层通道） =================
{
  await evalJs(`(function(){ var b=document.getElementById('chat-body'); if(b){ b.scrollTop=0; } return 1; })()`);
  await sleep(600);
  for (let k = 0; k < 12; k++) { // 反复到顶触发上翻加载（renderStart>0 → 窗口裁尾）
    await evalJs(`(function(){ var b=document.getElementById('chat-body'); if(b){ b.scrollTop=0; b.dispatchEvent(new Event('scroll')); } return 1; })()`);
    await sleep(350);
  }
  await evalJs(`(function(){ var b=document.getElementById('chat-body'); if(b){ b.scrollTop=b.scrollHeight; b.dispatchEvent(new Event('scroll')); } return 1; })()`);
  await sleep(800);
  await evalJs(`(function(){ var b=document.getElementById('chat-body'); if(b){ b.scrollTop=b.scrollHeight-500; b.dispatchEvent(new Event('scroll')); b.scrollTop=b.scrollHeight; b.dispatchEvent(new Event('scroll')); } return 1; })()`);
  await sleep(900);
  const g = JSON.parse(await evalJs(globalScan()) || '{}');
  check('R4 深翻+回底补画后屏上无重复 data-idx', Array.isArray(g.domDupIdx) && g.domDupIdx.length === 0, JSON.stringify(g.domDupIdx).slice(0, 200));
  const p = JSON.parse(await evalJs(probe('SOAK1-1')) || '{}');
  check('R4 深翻回底后首轮消息内存仍各 1 条（屏上是否可见随裁窗，不作判据）', p.arr === 2 && g.idDupN === 0, JSON.stringify(p) + ' idDupN=' + g.idDupN);
}

// ================= R5 整包未落盘（进程被杀）→ 尾巴日志回放 =================
{
  await openChat();
  await send('SOAK5-甲');
  await sleep(120);
  await send('SOAK5-乙');
  await sleep(1200); // 尾巴日志同步写 LS 必达；整包落盘有 2.5s 节流
  // 抹掉权威包里这两条＝精确模拟「整包没来得及落盘进程就被杀回滚」，只留尾巴日志这份兜底副本
  const cut = await evalJs(`(async function(){
    try {
      var raw = await window.idbGet('${KEY}');
      var a = typeof raw === 'string' ? JSON.parse(raw) : raw;
      var n0 = a.length;
      a = a.filter(function(m){ return !m || String(m.text||'').indexOf('SOAK5-') !== 0; });
      await window.idbSet('${KEY}', JSON.stringify(a));
      try { localStorage.setItem('${KEY}', JSON.stringify(a)); } catch(e){}
      return JSON.stringify({ removed: n0 - a.length });
    } catch (e) { return 'err:' + e.message; }
  })()`);
  // 整包落盘有 ~2.5s 节流，切点时权威包里可能已经存下其中一条 ⇒ 只要求「至少缺一条」（缺的多＝
  // 现场更极端），真正判据是后面两条：回放补齐到 2 条、且不再补出第三份。
  const removedN = Number((String(cut).match(/"removed":(\d+)/) || [])[1] || 0);
  check('R5 已构造「权威缺尾部条目、尾巴日志仍留着」现场（缺 ≥1 条）', removedN >= 1, cut);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
  await sleep(2500);
  await openChat();
  const p1 = JSON.parse(await evalJs(probe('SOAK5-')) || '{}');
  check('R5 回放找回两条（丢失＝兜底失效）', p1.arr === 2, JSON.stringify(p1));
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
  await sleep(2500);
  await openChat();
  const p2 = JSON.parse(await evalJs(probe('SOAK5-')) || '{}');
  const g2 = JSON.parse(await evalJs(globalScan()) || '{}');
  check('R5 二次重载仍 2 条（回放已固化并退休，不再补第三份）', p2.arr === 2, JSON.stringify(p2));
  check('R5 二次重载无身份重复', g2.idDupN === 0, 'idDupN=' + g2.idDupN + ' tail=' + g2.tailN + '/' + g2.tailLive);
}

// ================= R6 存量脏数据自愈（已观测到的重复形态 + 出生号正反面各一对） =================
{
  const t0 = Date.now() - 300000;
  const dupSeed = [
    { side: 'out', text: 'DUP-A-相邻同文', ts: t0 },
    { side: 'out', text: 'DUP-A-相邻同文', ts: t0 },
    // B：同一条记录（同 ts+side）两份**不同正文形态**——回放通道产物常见（尾巴/增量日志里的正文
    // 与库内已被 normCell 换脸/改名/令牌化后的正文不一致），文本类签名判不出＝现有合并全漏
    { side: 'in', text: 'DUP-B-旧形态', ts: t0 + 5000 },
    { side: 'in', text: 'DUP-B-新形态（正文已被原地改写）', ts: t0 + 5000 },
    // C：同一条图片消息两份，一份是 LS 有损快照（img 被剥成空串）
    { side: 'out', text: 'DUP-C-带图', img: 'data:image/png;base64,' + 'Z'.repeat(200), ts: t0 + 9000 },
    { side: 'out', text: 'DUP-C-带图', img: '', ts: t0 + 9000 },
    // D：同一条（同 ts+side）被另一侧一条消息隔开＝非相邻，现有相邻判据看不见
    { side: 'in', text: 'DUP-D-同一条', ts: t0 + 13000 },
    { side: 'out', text: '中间夹的正常消息', ts: t0 + 13001 },
    { side: 'in', text: 'DUP-D-同一条', ts: t0 + 13000 },
    // E：同一条被**原地改过正文**、但两条都带着同一出生号 uid（v3.27 #776 之后新写的数据就是这个
    // 形状：addRec 打号 → 克隆/回放的副本把号一起带走）。正文不等、出生号相等＝认得出、该收敛。
    { side: 'out', text: 'DUP-E-旧形态', ts: t0 + 15000, uid: 'seedE-ts-1' },
    { side: 'out', text: 'DUP-E-新形态（正文已被原地改写）', ts: t0 + 15000, uid: 'seedE-ts-1' },
    // F：**同毫秒两条真消息**（一次点发送批量发两张图/多字卡＝逐条 addRec，各得不同出生号）。
    // 与 E 的唯一区别就是出生号不同 ⇒ 判据若退化到「同 ts+side 即同一份」会误删真消息。
    { side: 'out', text: 'DUP-F-批量第一张', ts: t0 + 17000, uid: 'seedF-ts-1' },
    { side: 'out', text: 'DUP-F-批量第二张', ts: t0 + 17000, uid: 'seedF-ts-2' },
    // G：同一条被存了**四份**（用户原话「甚至比三条还多」）⇒ 收敛必须一轮到 1，不是两两并完还剩 2
    { side: 'in', text: 'DUP-G-四份', ts: t0 + 19000 },
    { side: 'in', text: 'DUP-G-四份', ts: t0 + 19000 },
    { side: 'in', text: 'DUP-G-四份', ts: t0 + 19000 },
    { side: 'in', text: 'DUP-G-四份', ts: t0 + 19000 },
    // H：同一出生号的三份副本，三种漂移形态各一份（原文带图／有损快照剥图／改名清扫改写正文）
    //    ⇒ 三份都要认成同一条，且**留下的必须是有图那份**（chatRecIdScore 取信息更全者）。
    { side: 'out', text: 'DUP-H-三份', ts: t0 + 21000, img: 'data:image/png;base64,' + 'Y'.repeat(120), uid: 'seedH-ts-1' },
    { side: 'out', text: 'DUP-H-三份', ts: t0 + 21000, img: '', uid: 'seedH-ts-1' },
    { side: 'out', text: 'DUP-H-三份（改名清扫后的新形态）', ts: t0 + 21000, img: '', uid: 'seedH-ts-1' },
    // 合法重复：同文本、ts 相差 6s（远超任何去重窗）——不得被误删
    { side: 'out', text: '合法重发', ts: t0 + 20000 },
    { side: 'out', text: '合法重发', ts: t0 + 26000 },
    // 合法：同一秒内两侧各一条同文本（我发 + TA 回同样的话）——异侧，不得合并
    { side: 'out', text: '异侧同文', ts: t0 + 30000 },
    { side: 'in', text: '异侧同文', ts: t0 + 30500 }
  ];
  const KEY5 = 'xy-home-v2:default:chat-msgs';
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1600);
  await evalJs(`(async function(){
    try {
      localStorage.setItem('${KEY5}', ${JSON.stringify(JSON.stringify(dupSeed))});
      await window.idbSet('${KEY5}', ${JSON.stringify(JSON.stringify(dupSeed))});
      localStorage.removeItem('${TAIL}'); if (window.idbDelete) await window.idbDelete('${TAIL}');
      localStorage.removeItem('${ARCH}'); if (window.idbDelete) await window.idbDelete('${ARCH}');
      return 1;
    } catch (e) { return 0; }
  })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
  await sleep(3000); // 等后台归一化跑完
  const h = JSON.parse(await evalJs(`(function(){
    var a=(window.getChatMsgs&&window.getChatMsgs())||[];
    var c=function(p){ var n=0; a.forEach(function(m){ if(m && String(m.text||'').indexOf(p)===0) n++; }); return n; };
    var idSeen={}, idDup=0;
    a.forEach(function(m){ if(!m) return; var k=(m.ts||0)+'|'+(m.side||'')+'|'+(m.special||'')+'|'+((m.type==='text'||!m.type)?'':String(m.type||'')); if(idSeen[k]) idDup++; else idSeen[k]=1; });
    var z=(window.__mochiDupCensus&&window.__mochiDupCensus())||{};
    return JSON.stringify({ total:a.length, A:c('DUP-A'), B:c('DUP-B'), C:c('DUP-C'), D:c('DUP-D'),
      E:c('DUP-E'), F:c('DUP-F'), G:c('DUP-G'), H:c('DUP-H'), Him:(function(){ var n=0; a.forEach(function(m){ if(m && String(m.text||'').indexOf('DUP-H')===0 && (m.img||'').length) n++; }); return n; })(),
      legal:c('合法重发'), cross:c('异侧同文'), idDup:idDup,
      sus:z.sus, same:z.same, uidc:z.uidc, drift:z.drift, batch:z.batch });
  })()`) || '{}');
  check('R6-A 同 ts 同正文相邻重复收敛为 1', h.A === 1, JSON.stringify(h));
  check('R6-B 存量无出生号＋正文已漂移的一对：不收敛（宁漏不误删，与同毫秒批量数据同形）', h.B === 2, 'cnt=' + h.B);
  check('R6-C 同 ts、一份有损副本（img 被剥空）收敛为 1', h.C === 1, 'cnt=' + h.C);
  check('R6-D 同 ts 被异侧消息隔开（非相邻）收敛为 1', h.D === 1, 'cnt=' + h.D);
  check('R6-E 正文已漂移但同出生号（#776 后新数据）收敛为 1', h.E === 1, 'cnt=' + h.E);
  check('R6-F 同毫秒两条真消息（各带不同出生号）不得被误删', h.F === 2, 'cnt=' + h.F);
  check('R6-G 同一条存了四份（用户原话「比三条还多」）一轮收敛为 1', h.G === 1, 'cnt=' + h.G);
  check('R6-H 同一出生号三份（原文带图/有损剥图/改名改写）收敛为 1 且留有图那份', h.H === 1 && h.Him === 1, 'cnt=' + h.H + ' 带图=' + h.Him);
  check('R6 合法重复未被误删（同文隔 6s 两条 / 异侧同文两条）', h.legal === 2 && h.cross === 2, 'legal=' + h.legal + ' cross=' + h.cross);
  // 体检口径：收敛后只剩「一条存量无号漂移副本(B)＋一对同毫秒批量(F)」，前者记 drift、后者记 batch，
  // 任何 same/uidc 残留都说明该收的没收或收了没回写（真机报障就看这四个数分通道）。
  check('R6 体检探针在位且残留分类符合预期（same=0 uidc=0 drift=1 batch=1）',
    h.same === 0 && h.uidc === 0 && h.drift === 1 && h.batch === 1, JSON.stringify(h));
  // 自愈必须回写：再重载一次仍是最优条数（否则用户每次开聊天都看到重复）
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2000);
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide'))sp.click();return 1;})()");
  await sleep(3000);
  const h2 = JSON.parse(await evalJs(`(function(){
    var a=(window.getChatMsgs&&window.getChatMsgs())||[];
    var c=function(p){ var n=0; a.forEach(function(m){ if(m && String(m.text||'').indexOf(p)===0) n++; }); return n; };
    return JSON.stringify({ total:a.length, A:c('DUP-A'), B:c('DUP-B'), C:c('DUP-C'), D:c('DUP-D'), E:c('DUP-E'), F:c('DUP-F'), G:c('DUP-G'), H:c('DUP-H'), legal:c('合法重发'), cross:c('异侧同文') });
  })()`) || '{}');
  check('R6 自愈已回写（二次重载条数稳定）', h2.A === 1 && h2.B === 2 && h2.C === 1 && h2.D === 1 && h2.E === 1 && h2.F === 2 && h2.G === 1 && h2.H === 1 && h2.legal === 2 && h2.cross === 2, JSON.stringify(h2));
}

chrome.kill();
server.close();
const pass = results.filter(r => r.ok).length;
console.log('----');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
