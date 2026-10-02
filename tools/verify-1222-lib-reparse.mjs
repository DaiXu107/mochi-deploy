// ===== #1222 字卡库列表页反复进页不再强制整库 JSON.parse（iPhone 15 Pro Max / iOS 26.6.1 实报） =====
// 用户报障（2026-09-25，15 Pro Max + iOS 26.6.1 桌面 PWA，明说其他机型也有、不许按机型分支）：
//   「切换到添加字卡页面最卡」。同机 perfcheck 实锤：字卡库页前台冻结 10 次、最慢帧 1292ms、
//   掉帧 91.7% 集中在字卡库。根因（chatcard.js）：列表页每显示一次，page-chatcard 的
//   MutationObserver 就 refreshLibCounts(true) → 无条件 pubInvalidate() 盲清池视图 →
//   同一函数体内 pubGroupsRaw()/ownPoolRaw() 立刻把公用+专属两库原文整份同步 JSON.parse，
//   只为刷 4 个角标数字；重度用户两库 MB~百 MB 级＝每次进页一次秒级冻结。
// 修复（零机型分支）：数据变更的唯一入口是 xyStore.set，故 poolSrcChanged() 比对两把键
//   **原文串**是否变过：没变＝池视图仍最新，跳过失效（计数照常走 countOf 轻遍历）；变了/初始
//   ＝照旧整清重建。openCcPage 同一闸门。口径必须是**内容**不是对象身份——memoryCache 未命中
//   （#975/#1195e 切后台释放内存副本后）时 get 落到 localStorage.getItem，同一份数据每次返回
//   新字符串实例，按身份比会把「没变」判成「变了」＝闸门白装（T2d 守它）；等长改字也必须算变
//   （T3c 守它，故不许靠长度短路）。
// 断言（T2 在修复侧绿、在未含修复的纯 HEAD 副本红＝本批契约；T1/T3/T4/T5 两侧皆绿＝正确性对照）：
//   T1 产物含 poolSrcChanged 与 force 闸门锚点
//   T2a/b 两库有数据时首进各重建一次；**不改动数据**再进两次＝零次整库 parse（旧行为红）
//   T3 改数据后角标照新值、且确实重建（不许为绿把失效闸焊死）
//   T4 数据未变时重复消费回复池（getCustomCards×2）零整库 parse，且含新卡
//   Z  全程零未捕获 JS 错误
// 用法：node tools/verify-1222-lib-reparse.mjs   （MOCHI_ROOT=<隔离构建目录> 可指向副本产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT)
  : (process.env.SERVE_ROOT ? normalize(process.env.SERVE_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? '✅' : '❌') + ' ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
{
  let html = '';
  try { html = readFileSync(join(root, 'index.html'), 'utf8'); const jd = join(root, 'js'); for (const f of readdirSync(jd)) if (f.endsWith('.js')) html += `\n${readFileSync(join(jd, f), 'utf8')}`; } catch (e) {}
  check('T1a 产物含 poolSrcChanged 定义', html.includes('function poolSrcChanged()'), 'len=' + html.length);
  check('T1b 产物含 force 闸门（原文没变不盲清池视图）', html.includes('libCounts.fun = -1; libCounts.pubFun = -1; if (poolSrcChanged()) pubInvalidate();'));
}

const profileDir = join(process.env.TEMP || '/tmp', 'mochi-1222-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9970 + Math.floor(Math.random() * 25));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disk-cache-size=1048576',
  '--user-data-dir=' + profileDir,
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { chrome.kill(); } catch (e) {}
  try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

let ws = null, msgId = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(m, p = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); }); }
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

// 大库种子：**页面就绪后**经 xyStore.set 写入（启动期写 LS 会被 idbRestore 用出厂公用库覆盖，实测踩过）
// 两库原文各 ≈80KB——刻意留在 200KB 大键阈值之下：>200KB 走 IDB-only 通道，会被启动期
// 语音体检/令牌化等回写路径换掉内存里的原文串（实测 250KB 种子进页后读回 null、角标归 0），
// 而 60KB 探针阈值照样数得到每一次整库重建（出厂库与种子都远超 60KB）。
// ⚠️ 公用库前缀是 `xyStore('xy-home-v2')`（**不带**尾冒号，见 chatcard.js PUB_PREFIX）——
// 写成 'xy-home-v2:' 会种出 `xy-home-v2::cc-groups-public` 这个没人读的键，角标恒 0（实测踩过）。
const SEED_FN = `(function(){ try {
  var pad = '重复内容填充字卡正文'.repeat(60); // 720 字符
  var mk = function (tag) {
    var arr = []; for (var i = 0; i < 110; i++) arr.push(tag + '卡' + i + '-' + pad);
    return { text: [[tag + '甲组', arr], [tag + '乙组', []]], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] };
  };
  var pub = window.xyStore('xy-home-v2');                   // 公用库＝根命名空间全局键
  var own = (window.activeStore && window.activeStore()) || window.xyStore('xy-home-v2:default'); // 专属键随当前桌面
  pub.set('cc-groups-public', JSON.stringify(mk('A')));
  own.set('cc-groups', JSON.stringify(mk('B')));
  return 'pub=' + (pub.get('cc-groups-public') || '').length + ',own=' + (own.get('cc-groups') || '').length;
} catch(e){ return 'err:' + String(e); } })()`;
// JSON.parse 探针：统计 ≥60KB 字符串的解析次数（两库原文 ≈80KB；库内杂项小 JSON 不算）
const INSTR = `(function(){
  window.__bigParses = 0;
  var orig = JSON.parse;
  JSON.parse = function(s){ if (typeof s === 'string' && s.length >= 60000) window.__bigParses++; return orig.apply(JSON, arguments); };
})();`;

await connect();
await cdp('Page.enable'); await cdp('Runtime.enable');
let initScriptIds = [];
async function openPage(initScripts) {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  for (const id of initScriptIds) { try { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); } catch (e) {} }
  initScriptIds = [];
  for (const src of initScripts) {
    const r = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: src });
    if (r && r.identifier) initScriptIds.push(r.identifier);
  }
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(700);
  await ev("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
}
const tapTab = (page) => ev(`(function(){var t=document.querySelector('.tab[data-page=${page}]');if(t)t.click();return true;})()`);
const bigCount = async () => Number(await ev('window.__bigParses') || 0);
async function badge(id) {
  for (let i = 0; i < 10; i++) {
    const v = await ev(`(function(){var e=document.getElementById('${id}');return e?e.textContent:'?'})()`);
    if (v && v !== '…' && v !== '?') return v;
    await sleep(300);
  }
  return await ev(`(function(){var e=document.getElementById('${id}');return e?e.textContent:'?'})()`);
}
async function enterLib() { await tapTab('page-home'); await sleep(500); await tapTab('page-chatcard'); await sleep(1400); }

console.log('--- 准备：探针注入 → 页面就绪 → 内存种大库 ---');
await openPage([INSTR]);
// 等启动期字卡库恢复链（idbGet 重试 800/1600/2400ms）耗尽再播种，否则「IDB 卡数更多才覆盖」
// 会把种子换回出厂库（夹具公用库 160 张 < 种子 200 张，链耗尽后不再回来）
await sleep(11000);
const seedInfo = await ev(SEED_FN);
const mSeed = /^pub=(\d+),own=(\d+)$/.exec(String(seedInfo));
check('T0 两库种子写入且各 ≥60KB（xyStore 内存通道）', !!mSeed && Number(mSeed[1]) >= 60000 && Number(mSeed[2]) >= 60000, String(seedInfo));

console.log('--- T2 首次进页重建；数据不动再进两次＝零整库 parse ---');
await ev('window.__bigParses = 0; true;');
await enterLib();
const p1 = await bigCount();
const pubB1 = await badge('cc-pub-count');
const ownB1 = await badge('cc-list-count');
await ev('window.__bigParses = 0; true;');
await enterLib();
const p2 = await bigCount();
// T2d：把两键的**内存副本**放掉（＝#975/#1195e 切后台后的状态）再进一次——此后 xyStore.get 落到
// localStorage.getItem，同一份数据每次返回新字符串实例。闸门若按引用比对就会在这里漏（白 parse 一遍），
// 必须按内容比对才算修对。
await ev(`(function(){ try {
  if (window.idbMemoDrop) { window.idbMemoDrop('xy-home-v2:cc-groups-public'); window.idbMemoDrop('xy-home-v2:default:cc-groups'); }
  return true; } catch(e){ return false; } })()`);
const memoDropped = await ev(`(function(){ var st=window.xyStore('xy-home-v2'); return (st.get('cc-groups-public')||'').length; })()`);
await ev('window.__bigParses = 0; true;');
await enterLib();
const p2d = await bigCount();
await ev('window.__bigParses = 0; true;');
await enterLib();
const p3 = await bigCount();
check('T2a 首次进页整库重建发生（≥2＝公+专两库）', p1 >= 2, 'n=' + p1);
check('T2b 第二进（数据未变）零整库 parse', p2 === 0, 'n=' + p2);
check('T2c 第三进（数据未变）零整库 parse', p3 === 0, 'n=' + p3);
check('T2d 内存副本释放后（LS 每次给新实例）再进仍零整库 parse', memoDropped >= 60000 && p2d === 0, 'memoLen=' + memoDropped + ' n=' + p2d);

console.log('--- T3 改数据后角标照新值、且确实重建（失效闸没被焊死） ---');
await ev(`(function(){ try {
  var pub = window.xyStore('xy-home-v2'); // 公用库＝根命名空间全局键（前缀不带尾冒号）
  var o = JSON.parse(pub.get('cc-groups-public'));
  o.text[1][1].push('新增卡一'); o.text[1][1].push('新增卡二'); o.text[1][1].push('新增卡三');
  pub.set('cc-groups-public', JSON.stringify(o));
} catch(e){} return true;})()`);
await ev('window.__bigParses = 0; true;');
await enterLib();
const p4 = await bigCount();
const pubB2 = await badge('cc-pub-count');
check('T3a 改数据后角标按新值（旧值+3）', String(Number(pubB1) + 3) === String(pubB2), pubB1 + '→' + pubB2);
check('T3b 改数据后确实重建（整库 parse ≥1）', p4 >= 1, 'n=' + p4);

console.log('--- T3c 等长改字（只比长度会漏）也必须失效 ---');
await ev(`(function(){ try {
  var pub = window.xyStore('xy-home-v2');
  var raw = pub.get('cc-groups-public');
  // 把某张卡的内容原地换成**等长**字符串：库总长一字节不变，只有内容变了
  var o = JSON.parse(raw);
  o.text[0][1][0] = '换掉的内容' + 'x'.repeat((o.text[0][1][0] || '').length - 5);
  pub.set('cc-groups-public', JSON.stringify(o));
  return (pub.get('cc-groups-public') || '').length;
} catch(e){ return -1; } })()`);
await ev('window.__bigParses = 0; true;');
await enterLib();
const p4c = await bigCount();
const poolC = await ev(`(function(){ try { return (window.getCustomCards()||[]).join('|').indexOf('换掉的内容') >= 0 ? 'yes' : 'no'; } catch(e){ return 'err'; } })()`);
check('T3c 等长改字触发重建（不靠长度短路）', p4c >= 1, 'n=' + p4c);
check('T3d 等长改字后池内容确实是新值', poolC === 'yes', String(poolC));

console.log('--- T4 数据未变时重复消费回复池：零整库 parse 且含新卡 ---');
await ev('window.__bigParses = 0; true;');
const pool = await ev(`(function(){ try {
  var a = window.getCustomCards().length; var b = window.getCustomCards().length;
  return JSON.stringify({ a: a, b: b, hasNew: window.getCustomCards().indexOf('新增卡一') >= 0 });
} catch(e){ return '{"err":' + JSON.stringify(String(e)) + '}' } })()`);
const p5 = await bigCount();
let poolObj = {}; try { poolObj = JSON.parse(pool || '{}'); } catch (e) {}
check('T4a 回复池读取成功且含新增卡', !poolObj.err && poolObj.hasNew === true, pool);
check('T4b 重复消费回复池零整库 parse（池视图未被盲清）', p5 === 0, 'n=' + p5);

console.log('--- Z 组：零未捕获错误 ---');
{
  const errs = await ev('JSON.stringify(window.__jsErrors || [])');
  let n = 0;
  try { n = JSON.parse(errs || '[]').length; } catch (e) {}
  check('Z1 无未捕获 JS 错误', n === 0, 'n=' + n);
}

cleanup();
const fail = results.filter(r => !r.ok).length;
console.log('== 结果：' + (results.length - fail) + '/' + results.length + (fail ? '  FAIL=' + fail : '  全绿'));
process.exit(fail ? 1 : 0);
