// ===== 回归脚本：#1403 第二轮——站内「无限变长的历史记录」统一按月折叠＋按条删除 =====
// 用法：node tools/verify-1403-hist-fold-delete.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-1403-hist-fold-delete.mjs（A/B：测纯底本副本时本批应红）
// 作者口径两句，都要守住，缺一句就是做错了：
//   ①「不要封顶，我都要保存历史记录」＋「用户又不一定要保存那么多记录」＝**不许裁条目**，
//      折叠只改显示形状；要少，由用户自己一条一条删。
//   ②「每天只显示当天的，其他记录都月份按折叠起来」＋「这种无限变长的记录还需要有单独的删除功能」。
// 实现面（一把尺子量全站，不各页自造）：
//   共用件在 idb.js：mochiHistFold（当天直显＋更早按月折，样式皮复用 #1053 的 .dc-h-*）／
//   mochiHistDel（行内「删除」）／mochiHistDelBind（委托＋捕获阶段拦在行自己的 click 之前＋
//   删前 openModal 回显「删的是哪条」＋数据还在回填时不许删）。
// 消费者：寻踪记录（p2-features，行为断言在 verify-checkin-disable 的 A10/A11/A12）、
//   每日摸鱼值/打工值/摸鱼抓包（records.js）、提问记录五档（ta-ask.js）、心意柜（gift-shop.js）、
//   我们的时间线＋理解变化（memo-arc.js）。
// 刻意不给删除的两栏：主页「TA的关心」「红包记录」——它们是聊天记录现算出来的汇总视图，
//   删一条＝替用户改动聊天原文（站内删消息只在聊天页、且有「只允许删对方发来的」限制）。
//   本脚本 R5 原把「这两栏没有删除按钮」钉成断言；#1493 起关心栏的自有数组行（番茄陪伴）放开
//   单删、聊天回溯行与红包栏仍旧不给删（R5 已随批重锚为「自有行可删、且只有自有行可删」）。
// 不在本批：信箱 mail.js（并行批 #1402 正在做按周＋按月分组）、经期 period.js（并行批在途＋站内
//   已有行内删除）、听歌记录/占卜/心意币流水（作者这一轮点名的是「无限变长」那一组）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
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
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9950 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1403-hist-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
function cdp(method, params = {}) {
  const id = ++msgId;
  // 单发 CDP 也要有上限：并行会话把机器压满时整发不回来＝脚本一行读数都不打
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; pend.delete(id); res(v); };
    pend.set(id, finish);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (!done) { finish(null); console.log('  [cdp timeout] ' + method); } }, 60000);
  });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 200)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const toObj = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return {}; } };
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
console.log('被测根目录 = ' + root);

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 开屏（走产品真实链：必读滑到底→进入→等数据就绪） ----
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs(`(function(){
    try {
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll'); if (sc) { sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll')); }
        var me = document.getElementById('splash-mandatory-enter'); if (me) me.click();
        mm.hidden = true;
      }
      var sp = document.getElementById('splash'); if (sp) { sp.classList.add('hide'); sp.hidden = true; }
      var mask = document.getElementById('modal-mask'); if (mask && !mask.hidden) mask.hidden = true;
      var ae = document.getElementById('splash-enter'); if (ae) ae.click();
    } catch (e) {}
    return 1;
  })()`);
  await sleep(900);
  for (let i = 0; i < 20; i++) { if (await evalJs("(typeof window.activeStore === 'function' && !!window.__mochiDataReady) ? 1 : 0")) break; await sleep(300); }
  // 硬闸：开屏没真收掉＝整棵 .phone 还 visibility:hidden，后面所有读数都是夹具假象
  const vis = await evalJs("(function(){ var ph=document.querySelector('.phone'); if (!ph) return 'no-phone'; var cs=getComputedStyle(ph); return cs.visibility + '/' + cs.display; })()");
  check('B0 夹具前提：开屏已收掉、.phone 可见（读数为 ' + vis + '）', vis === 'visible/flex' || String(vis).indexOf('visible') === 0, 'visibility/display=' + vis);
}
// 主页某一栏：点桌面「主页」→点那一枚 tab（全程走产品链，不手摆 hidden）
async function openHomeTab(htab) {
  await evalJs(`(function(){
    var app = document.querySelector('.app[data-app="home"]'); if (app) app.click();
    return 1;
  })()`);
  await sleep(500);
  await evalJs(`(function(){ var t=document.querySelector('#page-home .fav-tab[data-htab="${htab}"]'); if (t) t.click(); return 1; })()`);
  await sleep(500);
}
// 读一栏的折叠形态：{rowsToday, blocks, openFlags, labels, dels, total}
const READ = (elId) => `(function(){
  var el = document.getElementById('${elId}');
  if (!el) return JSON.stringify({ missing: 1 });
  var today = 0;
  Array.prototype.forEach.call(el.children, function (c) { if (c.classList.contains('tc-listitem')) today++; });
  var ds = el.querySelectorAll('details.dc-h-more'), labels = [], opens = [], inner = 0;
  Array.prototype.forEach.call(ds, function (x) {
    labels.push(String((x.querySelector('.dc-h-more-sum') || {}).textContent || '').replace(/\\s+/g, ''));
    opens.push(x.open ? 1 : 0);
    inner += x.querySelectorAll('.tc-listitem').length;
  });
  return JSON.stringify({ today: today, blocks: ds.length, opens: opens.join(''), labels: labels, inner: inner, dels: el.querySelectorAll('.hist-del').length, txt: String(el.textContent || '').replace(/\\s+/g, ' ').slice(0, 60) });
})()`;

await boot();

// ================= 一、共用件在位（产物面） =================
{
  const art = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
  const built = art(join('js', 'idb.js')) || art('index.html'); // idb 可能内联，与 build.mjs 的 artifactText 同口径
  const c = (n) => built.split(n).length - 1;
  check('S1 共用折叠尺子在产物里（mochiHistFold／mochiHistDel／mochiHistDelBind 三件齐）',
    c('window.mochiHistFold = function') >= 1 && c('window.mochiHistDel = function') >= 1 && c('window.mochiHistDelBind = function') >= 1);
  check('S1b 删除的两道闸在产物里（回填未完不许删＋捕获阶段委托）',
    c("if (typeof window.mochiDataPending === 'function' && window.mochiDataPending())") >= 1 && c('}, true);') >= 1);
  const P2 = art(join('js', 'p2-features.js')), REC = art(join('js', 'records.js')), ASK = art(join('js', 'ta-ask.js')), GS = art(join('js', 'gift-shop.js')), MA = art(join('js', 'memo-arc.js'));
  check('S2 六个消费方都接上同一把尺子（寻踪/主页/提问五档/心意柜/时间线＋理解变化）',
    P2.indexOf('window.mochiHistFold(') >= 0 && REC.indexOf('window.mochiHistFold(') >= 0 && ASK.indexOf('window.mochiHistFold(') >= 0 &&
    GS.indexOf('window.mochiHistFold(rows, {') >= 0 && MA.indexOf('window.mochiHistFold(items') >= 0 && MA.indexOf('window.mochiHistFold(idx.map') >= 0,
    JSON.stringify({ p2: P2.indexOf('window.mochiHistFold(') >= 0, rec: REC.indexOf('window.mochiHistFold(') >= 0, ask: ASK.indexOf('window.mochiHistFold(') >= 0, gs: GS.indexOf('window.mochiHistFold(rows, {') >= 0, ma: MA.indexOf('window.mochiHistFold(items') >= 0 }));
  check('S3 不裁条目：五档提问记录把整条数组交给尺子、没有先 slice 截断（作者「我都要保存历史记录」＝不许封顶）',
    REC.indexOf('window.mochiHistFold(list.map((x, n) =>') >= 0 && !/askListRender\([^)]*h\.slice/.test(ASK) && ASK.indexOf('h.map(function (x)') >= 0,
    'askListRender(h.slice 命中=' + (/askListRender\([^)]*h\.slice/.test(ASK) ? 1 : 0));
}

// ================= 二、每日摸鱼值／打工值：折叠＋按条删（不动累计） =================
{
  await evalJs(`(function(){
    var st = window.activeStore();
    var d = 864e5, now = Date.now();
    var k = function (ts) { var x = new Date(ts); return x.getFullYear() + '-' + (x.getMonth() + 1) + '-' + x.getDate(); };
    var mk = function (ts, mine, ta) { return { date: k(ts), mine: mine, ta: ta }; };
    st.set('fish-day-add', JSON.stringify([mk(now, 3, 1), mk(now - 2 * d, 5, 2), mk(now - 70 * d, 9, 4)]));
    st.set('work-day-add', JSON.stringify([mk(now, 2, 0), mk(now - 65 * d, 7, 3)]));
    // 累计键是独立累加键，删除明细不许碰它——先记下现值
    st.set('fish-total', '777'); st.set('fish-total-ta', '888');
    return 1;
  })()`);
  await openHomeTab('fish');
  const f = toObj(await evalJs(READ('home-fish')));
  const thisMonth = String(await evalJs("(function(){ var d = new Date(); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月'; })()"));
  check('R1 每日摸鱼值：今天那一行直显、更早按月份折成块（新月份在前、默认折起、块上写条数），每行一枚删除',
    f.today === 1 && f.blocks === 2 && f.opens === '00' && (f.labels[0] || '').indexOf(thisMonth) === 0 && /1条$/.test(f.labels[0] || '') && /1条$/.test(f.labels[1] || '') && f.inner === 2 && f.dels === 3, JSON.stringify({ thisMonth, f }));
  // 删最旧月块那一条：确认框先弹、回显日期，确定后只少那一天的明细
  await evalJs("(function(){ var ds=document.querySelectorAll('#home-fish details.dc-h-more'); var b=ds[ds.length-1].querySelector('.hist-del'); if(b) b.click(); return 1; })()");
  await sleep(400);
  const conf = toObj(await evalJs(`(function(){
    var mask = document.getElementById('modal-mask');
    return JSON.stringify({ open: !!(mask && !mask.hidden), title: String((document.getElementById('modal-title') || {}).textContent || ''), stat: String((document.getElementById('modal-static') || {}).textContent || '') });
  })()`));
  check('R2 点「删除」先弹确认并回显是哪一天（标题点名摸鱼值）', conf.open === true && conf.title.indexOf('摸鱼值') >= 0 && /\d{4}-\d+-\d+/.test(conf.stat || ''), JSON.stringify(conf));
  await evalJs("(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()");
  await sleep(500);
  const after = toObj(await evalJs(`(function(){
    var st = window.activeStore(); var a = [];
    try { a = JSON.parse(st.get('fish-day-add') || '[]'); } catch (e) {}
    return JSON.stringify({ dates: a.map(function (x) { return x.date; }).join(','), total: st.get('fish-total'), totalTa: st.get('fish-total-ta'), blocks: document.querySelectorAll('#home-fish details.dc-h-more').length });
  })()`));
  check('R2b 确认之后：只少最旧那一天的明细，70 天前那条没了、其余两条原样；**累计键一条没动**（777/888）',
    after.dates.indexOf('-70') < 0 && after.dates.split(',').length === 2 && after.total === '777' && after.totalTa === '888' && after.blocks === 1, JSON.stringify(after));
  await openHomeTab('work');
  const w = toObj(await evalJs(READ('home-work')));
  check('R3 每日打工值同款（今天直显、更早按月折、每行可删）', w.today === 1 && w.blocks === 1 && w.dels === 2, JSON.stringify(w));
}

// ================= 三、摸鱼抓包记录：不封顶，只折叠＋按条删 =================
{
  await evalJs(`(function(){
    var st = window.activeStore(); var d = 864e5, now = Date.now();
    var mk = function (ts, t) { return { type: t, text: 'T' + t, ts: ts }; };
    st.set('records-fishcatch', JSON.stringify([mk(now, 'me'), mk(now - 3 * d, 'ta'), mk(now - 3 * d, 'me'), mk(now - 100 * d, 'ta')]));
    return 1;
  })()`);
  await openHomeTab('catch');
  const cc = toObj(await evalJs(READ('home-catch')));
  check('R4 摸鱼抓包记录：今天 1 条直显、更早 3 条折成 2 个月块（3 天前那个月 2 条、100 天前 1 条），每行可删',
    cc.today === 1 && cc.blocks === 2 && cc.inner === 3 && cc.dels === 4, JSON.stringify(cc));
  await evalJs("(function(){ var b=document.querySelector('#home-catch details.dc-h-more .hist-del'); if(b) b.click(); return 1; })()");
  await sleep(400);
  await evalJs("(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()");
  await sleep(500);
  const ccLeft = await evalJs("(function(){ try { return JSON.parse(window.activeStore().get('records-fishcatch') || '[]').length; } catch (e) { return -1; } })()");
  check('R4b 抓包记录删一条＝只少那一条（4→3），不是清空、也不是整月', ccLeft === 3, 'len=' + ccLeft);
}

// ================= 四、关心／红包：只折叠，刻意没有删除按钮 =================
{
  await evalJs(`(function(){
    var st = window.activeStore(); var d = 864e5, now = Date.now();
    st.set('records-care', JSON.stringify([
      { kind: 'pomo', ts: now, text: '今天陪TA专注' },
      { kind: 'pomo', ts: now - 40 * d, text: '上个月陪TA专注' }
    ]));
    return 1;
  })()`);
  await openHomeTab('care');
  const care = toObj(await evalJs(READ('home-care')));
  // #1493 重锚：关心栏两类行分开对待——自有数组行（番茄陪伴）行内有删除件（本夹具 seed 的两条都是
  //   pomo ⇒ dels 2），聊天回溯行（经期/喝水/吃饭/症状）仍然没有（删一条＝替用户改聊天原文，那条路在聊天页）。
  check('R5 主页「TA的关心」：按月折叠生效；自有数组行（番茄陪伴）有删除按钮（#1493 起；聊天回溯行仍不给删＝不是漏做）',
    care.blocks >= 1 && care.dels === 2, JSON.stringify(care));
}

// ================= 五、提问记录五档：折叠＋按来源桌面删除 =================
{
  await evalJs(`(function(){
    var st = window.activeStore(); var d = 864e5, now = Date.now();
    var arr = [
      { q: '今天想我吗', a: '想', ts: now },
      { q: '上个月问的', a: '答过了', ts: now - 45 * d },
      { q: '再上个月', a: '也答了', ts: now - 80 * d }
    ];
    st.set('ta-ask', JSON.stringify({ history: arr }));
    if (window.renderAskRecords) window.renderAskRecords();
    return 1;
  })()`);
  await sleep(500);
  const a1 = toObj(await evalJs(READ('ar-ask')));
  check('T1 「TA的询问」：今天 1 条直显、更早 2 条按月份折成 2 块，每行一枚删除',
    a1.today === 1 && a1.blocks === 2 && a1.inner === 2 && a1.dels === 3, JSON.stringify(a1));
  await evalJs("(function(){ var ds=document.querySelectorAll('#ar-ask details.dc-h-more'); var b=ds[ds.length-1].querySelector('.hist-del'); if(b) b.click(); return 1; })()");
  await sleep(400);
  const tconf = toObj(await evalJs(`(function(){
    var mask = document.getElementById('modal-mask');
    return JSON.stringify({ open: !!(mask && !mask.hidden), title: String((document.getElementById('modal-title') || {}).textContent || '') });
  })()`));
  check('T1b 删除前先弹确认（标题点名「询问」）', tconf.open === true && tconf.title.indexOf('询问') >= 0, JSON.stringify(tconf));
  await evalJs("(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return 1; })()");
  await sleep(500);
  const tleft = toObj(await evalJs(`(function(){
    var d = null;
    try { d = JSON.parse(window.activeStore().get('ta-ask') || 'null'); } catch (e) {}
    var h = d && Array.isArray(d.history) ? d.history : [];
    return JSON.stringify({ n: h.length, qs: h.map(function (x) { return x.q; }).join('|') });
  })()`));
  check('T1c 按条删真的落在**来源桌面**那一份数组里：只剩 2 条、80 天前那条没了、题库对象壳（history 之外）没被写坏',
    tleft.n === 2 && tleft.qs.indexOf('再上个月') < 0 && tleft.qs.indexOf('今天想我吗') >= 0, JSON.stringify(tleft));
  // 对象壳保住了吗：这里再写一条进去、确认读回仍是对象形态（不是被写成裸数组）
  const shape = await evalJs("(function(){ var d=null; try { d = JSON.parse(window.activeStore().get('ta-ask')||'null'); } catch(e){} return d && !Array.isArray(d) && Array.isArray(d.history) ? 'obj' : (Array.isArray(d) ? 'arr' : 'null'); })()");
  check('T1d 写回口径＝对象档只换 history（题库/设置/分组同档字段不被动，与 #625 的清空同一条轴）', shape === 'obj', 'shape=' + shape);
}

// ================= 六、心意柜 / 梦角档案：结构面（行为面需真点进页面，交真机复核） =================
{
  const art = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
  const GS = art(join('js', 'gift-shop.js')), MA = art(join('js', 'memo-arc.js'));
  check('S4 心意柜：删除按钮在卡片里＋委托绑定带 invalidate（#985 回复以柜为源，漏失效会留下旧回复）',
    GS.indexOf('window.mochiHistDel(it.id, it.name)') >= 0 && GS.indexOf('boxMetaInvalidate();') >= 0);
  check('S5 理解变化：按条删的按钮走本文件 data-op 链，且写回前按「time＋text」再认一次',
    MA.indexOf("opBtn('del-hist', '删除'") >= 0 && MA.indexOf("case 'del-hist': delHist(Number(id)); break;") >= 0 && MA.indexOf('没有删掉任何内容') >= 0);
}

const errs = await evalJs("(function(){ return (window.__jsErrors || []).length; })()");
check('Z1 全程零未捕获 JS 异常', errs === 0, 'jsErrors=' + errs);

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过' + (failed.length ? '；失败：' + failed.map((f) => f.desc).join(' | ') : ''));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(failed.length ? 1 : 0);
