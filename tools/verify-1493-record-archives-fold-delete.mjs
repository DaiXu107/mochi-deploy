// ===== 常驻回归脚本 #1493：记录四本账「保全部＋按日/按月折叠＋单条删除」＋写路闸 =====
// 用法：node tools/verify-1493-record-archives-fold-delete.mjs（MOCHI_ROOT=<已构建目录>；A/B 测纯底本时本批应红）
// 作者口径（2026-09-30 直派）：「要保存所有记录，但是要按日期折叠起来分页加载，还要能单独删除数据」——
//   三句都要守住：不封顶（一条不裁）、折叠/分页只是显示形状、每一条都能单独删。
// 现状（#1403 已铺过一半）：寻踪记录/抓包/贴贴三处早已折叠＋单删；本批补的是——
//   ① 定位时间线单条删除（此前只有按日切换）；② 情话存档整本列表（此前只在日历按天可查）；
//   ③ 关心记录拆掉 slice(0,100) 封顶（错过的跨桌面查岗「只落 records-care 不进聊天＝唯一留痕」，
//      封顶＝静默丢留痕）＋番茄陪伴自有数组行放开单删（聊天回溯行仍不给删＝删原文回聊天页）；
//   ④ 五本账写路接 #1488 同款闸（大键化后冷读空不许整包写回——「保所有」在大键化之后仍然成立）。
// 断言（两侧同一把尺；纯 HEAD 侧应当红的＝S1~S10、R1、R2、R3、R4、R5b、R6，其余为控制项）：
//   S1~S10 产物逻辑锚
//   R1 关心记录拆封顶：seed 130 条＋再落 1 条＝库里 131（红侧被 slice(0,100) 裁成 100）
//   R2 关心栏：折叠生效＋番茄行有删除件＋删一条只少一条
//   R3 定位时间线：每行删除件＋删一条只少那一条（按值认，不是按序号）
//   R4 情话存档：整本列表＋今日自动存档恰好一条＋单删一条
//   R5/R5b/R5c 【保所有的根】records-care 大键化（285KB）＋切后台放掉后：
//     R5 awaitingBigKey=true（数据层事实，两侧同绿）
//     R5b 读空那一发追加不许顶库（整场最低读数＝seed 数；红侧顶成 1 条＝症状本体）
//     R5c 值回来再追加照常 +1（绿侧；红侧结构性跳过）
//   Z 全程零未捕获 JS 异常
// 量具自律（#1488 同款）：开枪前读数只走 awaitingBigKey；库读数走 rawGet 直读 IndexedDB；
//   破坏判「整场最低读数」；种库后等 idbListKeys 收齐再 reload。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.MOCHI_ROOT || process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..');
console.log('被测根目录 = ' + root);
if (!existsSync(join(root, 'index.html'))) { console.error('✗ 被测根目录没有 index.html'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9860 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1493-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const exc = [];
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') exc.push(String(JSON.stringify(m.params.exceptionDetails)).slice(0, 160)); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { let done = false; const fin = (v) => { if (done) return; done = true; pend.delete(id); res(v); }; pend.set(id, fin); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => fin(null), 60000); });
}
async function evalJs(expr) {
  try { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; } catch (e) { return null; }
}
const toObj = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return {}; } };
let pass = 0, fail = 0, skip = 0;
const ok = (c, n, x) => { if (c === 'skip') { skip++; console.log('  ~ ' + n + (x ? '  [' + String(x).slice(0, 200) + ']' : '')); } else if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 300) + ']' : '')); } };
const rawGet = (k) => evalJs(`(function(){ return new Promise(function(res){ var rq=indexedDB.open('mochi-db',1); rq.onsuccess=function(){ try{ var tx=rq.result.transaction('kv','readonly'), g=tx.objectStore('kv').get(${JSON.stringify(k)}); g.onsuccess=function(){ try{rq.result.close()}catch(e){} res(g.result===undefined?null:String(g.result)); }; g.onerror=function(){ res('ERR'); }; }catch(e){ res('ERR'); } }; rq.onerror=function(){ res('ERR'); }; }); })()`);
const nOf = (raw) => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.length : -1; } catch (e) { return raw === null ? 0 : -9; } };
const KEY = (k) => 'xy-home-v2:default:' + k;

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs(`(function(){
    try {
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) { var sc=document.getElementById('splash-mandatory-scroll'); if(sc){sc.scrollTop=sc.scrollHeight;sc.dispatchEvent(new Event('scroll'));} var me=document.getElementById('splash-mandatory-enter'); if(me) me.click(); mm.hidden=true; }
      var sp = document.getElementById('splash'); if (sp) { sp.classList.add('hide'); sp.hidden = true; }
      var mask = document.getElementById('modal-mask'); if (mask && !mask.hidden) mask.hidden = true;
      var ae = document.getElementById('splash-enter'); if (ae) ae.click();
    } catch (e) {}
    return 1;
  })()`);
  await sleep(900);
  const vis = await evalJs("(function(){ var ph=document.querySelector('.phone'); if (!ph) return 'no-phone'; return getComputedStyle(ph).visibility; })()");
  return vis;
}
async function openHomeTab(htab) {
  await evalJs(`(function(){ var app=document.querySelector('.app[data-app="home"]'); if(app) app.click(); return 1; })()`);
  await sleep(500);
  await evalJs(`(function(){ var t=document.querySelector('#page-home .fav-tab[data-htab="${htab}"]'); if(t) t.click(); return 1; })()`);
  await sleep(500);
}
const READ = (elId) => `(function(){
  var el = document.getElementById('${elId}');
  if (!el) return JSON.stringify({ missing: 1 });
  var today = 0;
  Array.prototype.forEach.call(el.children, function (c) { if (c.classList.contains('tc-listitem')) today++; });
  var ds = el.querySelectorAll('details.dc-h-more'), blocks = ds.length, inner = 0;
  Array.prototype.forEach.call(ds, function (x) { inner += x.querySelectorAll('.tc-listitem').length; });
  return JSON.stringify({ today: today, blocks: blocks, inner: inner, dels: el.querySelectorAll('.hist-del').length });
})()`;
const seedAll = async (fnBody) => { await evalJs(`(function(){ var st = window.activeStore(); ${fnBody} return 1; })()`); 
  // 等 IDB 落库收齐（idbSet fire-and-forget）
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const seen = await evalJs(`(function(){ return new Promise(function(res){ window.idbListKeys().then(function(keys){ res(Array.isArray(keys)); }, function(){ res(false); }); }); })()`);
    if (seen) break;
    await sleep(300);
  }
  await sleep(600);
};
const goHidden = () => evalJs(`(function(){ return new Promise(function(res){ Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'hidden'}}); Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true}}); document.dispatchEvent(new Event('visibilitychange')); setTimeout(function(){res(1)},700); }); })()`);
const comeBack = () => evalJs(`(function(){ return new Promise(function(res){ Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'visible'}}); Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false}}); document.dispatchEvent(new Event('visibilitychange')); setTimeout(function(){res(1)},300); }); })()`);
const blindAwait = (k) => evalJs(`(function(){ try { return window.activeStore().awaitingBigKey(${JSON.stringify(k)}) === true; } catch(e){ return 'ERR'; } })()`);
const libMin = async (k, times, gap) => { let min = 9e9; for (let i = 0; i < (times || 4); i++) { const n = nOf(await rawGet(k)); if (n >= 0 && n < min) min = n; await sleep(gap || 400); } return min === 9e9 ? -9 : min; };

// ============ S 组：产物逻辑锚 ============
console.log('\n== S 组：产物逻辑锚 ==');
{
  const art = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
  const P2 = art(join('js', 'p2-features.js')), REC = art(join('js', 'records.js')), PER = art(join('js', 'personalize.js')), IDX = art('index.html');
  const needles = [
    ['S1 定位时间线单删委托（删＝位置历史只能看不能删）', P2, 'window.mochiHistDelBind(body, {'],
    ['S2 位置历史写路闸（删＝大键化后冷读追加顶库）', P2, "function saveHist(list) { if (window.xyBigWriteHold && window.xyBigWriteHold(store, 'loc-history')) return;"],
    ['S3 查岗记录追加闸（删＝#1403 的折叠单删被空读整包顶掉）', P2, "function recordCheckin(ck) { if (window.xyBigWriteHold && window.xyBigWriteHold(store, 'checkin-history')) return;"],
    ['S4 查岗记录删除闸（删＝删除也是读改写）', P2, "function delCheckinHistory(key) { if (window.xyBigWriteBlocked && window.xyBigWriteBlocked(store, 'checkin-history', '寻踪记录')) return;"],
    ['S5 关心记录拆封顶＋闸（删＝错过的跨桌面查岗唯一留痕被裁）', REC, "function caresSave(list) { if (window.xyBigWriteHold && window.xyBigWriteHold(store, 'records-care')) return; store.set('records-care', JSON.stringify(list)); }"],
    ['S6 跨桌面查岗落账拆封顶（删＝addCareRecordFor 还在 slice(0,100)）', REC, "s.set('records-care', JSON.stringify(list)); // #1493 拆封顶"],
    ['S7 关心栏番茄行单删委托（删＝自有行「能单独删除」落空）', REC, "title: '删除这条番茄陪伴记录？',"],
    ['S8 情话存档面板（删＝整本依旧无处可看可删）', REC, 'function renderQuotePanel()'],
    ['S9 情话每日追加闸（删＝存档大键化后冷读 unshift 顶库）', PER, "if (!window.xyBigWriteHold || !window.xyBigWriteHold(store, 'quote-history')) {"],
    ['S10 情话存档入口进记录页（删＝无处可看）', IDX, 'data-htab="quotes"']
  ];
  for (const [n, src, nd] of needles) ok(src.indexOf(nd) >= 0, n, src.indexOf(nd) < 0 ? 'needle 不在产物' : '');
}

// ============ R1/R2：关心记录拆封顶＋番茄行单删 ============
console.log('\n== R1/R2：关心记录「保所有」＋单删 ==');
{
  const vis = await boot();
  ok(vis === 'visible' || String(vis).indexOf('visible') === 0, 'B0 夹具前提：开屏收掉、.phone 可见', String(vis));
  // 130 条小记录直种（跨 65 天＝月块才会出现）+ 再走一次真实落账（旧代码在此处 slice(0,100) 裁回 100）
  await seedAll(`var arr=[]; for (var i=0;i<130;i++) arr.push({kind:'pomo', text:'t'+i, ts: Date.now()-i*43200e3}); st.set('records-care', JSON.stringify(arr));`);
  await evalJs(`(function(){ window.addCareRecord('pomo', '探针一条'); return 1; })()`);
  await sleep(800);
  const n1 = nOf(await rawGet(KEY('records-care')));
  ok(n1 === 131, 'R1 关心记录拆封顶：130 直种＋再落 1 条＝131（红侧被裁成 100）', 'len=' + n1);
  await openHomeTab('care');
  const care = toObj(await evalJs(READ('home-care')));
  ok(care.blocks >= 1 && care.dels >= 1, 'R2a 关心栏折叠生效＋番茄行有删除件', JSON.stringify(care));
  await evalJs(`(function(){ var b=document.querySelector('#home-care details.dc-h-more .hist-del'); if(b) b.click(); return 1; })()`);
  await sleep(400);
  await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
  await sleep(600);
  const n2 = nOf(await rawGet(KEY('records-care')));
  ok(n2 === n1 - 1, 'R2b 删一条只少那一条（' + n1 + '→' + n2 + '），不是清空也不是整月', 'len=' + n2);
}

// ============ R3：定位时间线单删 ============
console.log('\n== R3：定位时间线单删 ==');
{
  await seedAll(`var now=Date.now(); st.set('loc-history', JSON.stringify([
    {type:'card', text:'在你身边', ts:now},
    {type:'card', text:'在你右边', ts:now-3600e3},
    {type:'card', text:'在公司', ts:now-7200e3},
    {type:'card', text:'在家里', ts:now-10800e3},
    {type:'card', text:'在路上', ts:now-14400e3}
  ]));`);
  await evalJs(`(function(){ if (window.locRefreshBody) window.locRefreshBody(); return 1; })()`);
  await sleep(400);
  const dels = await evalJs(`(function(){ var b=document.getElementById('loc-body'); if(!b) return -1; return b.querySelectorAll('.hist-del').length; })()`);
  ok(dels === 5, 'R3a 定位时间线每行有删除件（今天 5 条全在当天视图）', 'dels=' + dels);
  // 删「在公司」那条（按行文本找它行内的删除件）
  await evalJs(`(function(){ var b=document.getElementById('loc-body'); if(!b) return 0; var items=b.querySelectorAll('.loc-tl-item'); for (var i=0;i<items.length;i++){ if(items[i].textContent.indexOf('在公司')>=0){ var x=items[i].querySelector('.hist-del'); if(x){ x.click(); break; } } } return 1; })()`);
  await sleep(400);
  await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
  await sleep(600);
  const raw = await rawGet(KEY('loc-history'));
  const gone = String(raw || '').indexOf('在公司') < 0 && String(raw || '').indexOf('在家里') >= 0 && String(raw || '').indexOf('在你身边') >= 0;
  ok(nOf(raw) === 4 && gone, 'R3b 删「在公司」只少那一条（5→4，其余原样）', 'len=' + nOf(raw));
}

// ============ R4：情话存档 ============
console.log('\n== R4：情话存档列表＋单删 ==');
{
  // 自构「今天」串＝严格复刻 personalize fishToday 的补零格式（ 不补零会被判不同天＝假性追加，踩过）；
  // 二次启动验证 dedupe：list[0].date === today ⇒ renderQuoteOfDay 不再追加
  const todayStr = await evalJs(`(function(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
  await seedAll(`var d=864e5,now=Date.now(); var td=${JSON.stringify(todayStr)}; st.set('quote-history', JSON.stringify([
    {date:td, text:'今天那句', ts:now},
    {date:'2026-07-01', text:'七月那句', ts:now-90*d},
    {date:'2026-08-01', text:'八月那句', ts:now-60*d},
    {date:'2026-09-01', text:'九月那句', ts:now-29*d}
  ]));`);
  // 二次启动＝renderQuoteOfDay 再跑一遍：今天已在档（同一天不重复）⇒ 4 保持 4
  await boot();
  const n0 = nOf(await rawGet(KEY('quote-history')));
  ok(n0 === 4, 'R4a 情话存档：seed 4 条（含今天）后二次启动不重复追加＝4', 'len=' + n0);
    await openHomeTab('quotes');
    const q = toObj(await evalJs(READ('home-quotes')));
    ok(!q.missing && q.today === 1 && q.blocks === 3 && q.inner === 3 && q.dels === 4, 'R4b 情话存档面板：今天直显＋三个月块各 1 条、每行有删除件', JSON.stringify(q));
    await evalJs(`(function(){ var b=document.querySelector('#home-quotes details.dc-h-more .hist-del'); if(b) b.click(); return 1; })()`);
    await sleep(400);
    await evalJs(`(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()`);
    await sleep(600);
    const n1 = nOf(await rawGet(KEY('quote-history')));
    ok(n1 === n0 - 1, 'R4c 删一条只少那一条（' + n0 + '→' + n1 + '）', 'len=' + n1);
}

// ============ R5：大键化＋切后台放掉＝读空追加不许顶库（「保所有」的根） ============
console.log('\n== R5：records-care 大键化 × 读空追加 ==');
{
  // 重开一场冷读：种 400 条 ≈290KB（跨 200KB 大键线＋256KB 释放线）
  await seedAll(`var arr=[]; for (var i=0;i<400;i++) arr.push({kind:'pomo', text:'pad'+i+'|'+'y'.repeat(700), ts: Date.now()-(i+1)*60000}); st.set('records-care', JSON.stringify(arr));`);
  await boot();
  const n0 = nOf(await rawGet(KEY('records-care')));
  ok(n0 === 400, 'R5-前置 冷启动回填后 400 条在场（健康对照）', 'len=' + n0);
  await goHidden();
  await comeBack();
  const aw = await blindAwait('records-care');
  ok(aw === true, 'R5 切后台放掉后 awaitingBigKey=true（数据层事实）', String(aw));
  // 读空那一发追加（TA 自动落账的那条路，公开入口 addCareRecord）
  await evalJs(`(function(){ window.addCareRecord('pomo', '冷读探针'); return 1; })()`);
  const minN = await libMin(KEY('records-care'), 4, 400);
  ok(minN >= 400, 'R5b 读空那一发追加不许顶库（整场最低读数 ≥400＝一条不少；闸拦下或取回跑赢后的 healed-append 同样无损）', 'min=' + minN);
  // 值回来后再追加照常 +1（绿侧；红侧 E 组结构性跳过）
  await sleep(2500);
  const back = await blindAwait('records-care');
  if (back === false) {
    await evalJs(`(function(){ window.addCareRecord('pomo', '值回来探针'); return 1; })()`);
    await sleep(800);
    const n1 = nOf(await rawGet(KEY('records-care')));
    ok(n1 === n0 + 1 || n1 === n0 + 2, 'R5c 值回来后追加照常落库（400→401/402）', 'len=' + n1);
  } else {
    ok('skip', 'R5c 值还没回来（红侧或慢机器结构性跳过，不作判准）');
  }
}

console.log('\n== Z 组：全程零未捕获 JS 异常 ==');
ok(exc.length === 0, 'Z1 无 pageerror/未捕获异常', exc.slice(0, 3).join(' | '));

chrome.kill();
server.close();
console.log('\n通过 ' + pass + ' / 断言失败 ' + fail + ' / 跳过 ' + skip + (fail ? '  ✗ 有红' : '  ✓ 全绿'));
process.exit(fail ? 1 : 0);
