// ===== 验证 #584：卡顿被用户误判为 bug 的两处性能修（均在 src/js/chatcard.js） =====
// 用户诉求原话：「还有没有什么没做加载动画的，然后卡顿让用户以为是 bug，需要优化」。
// 两条都是「同一形状的复发」——项目已有两个先例：
//   · #398 ccTokenizeGiantMedia 对公用库每张 >64KB 并发发起 SHA-256，几百张同挤主线程＝
//     iPhone 14 Pro 持续卡顿（已改串行 + setTimeout(0) 让出）；
//   · v3.6.x 给「自定义字卡管理页」搜索加了 120ms 防抖（注释原话「字卡多时每敲一个字全量
//     渲染会卡」），但「字卡库列表页」的搜索框漏加，每敲一键仍全量重扫 7k+ 预设字卡。
// 本脚本断言两件事：①列表页搜索真的走防抖、慢搜索时用户看得见「搜索中…」；
// ②预压缩真的串行化——同一时刻只压一张，而不是把整池并发摊到主线程上。
//
// 三段结构：A/B 静态锚点（不依赖浏览器）→ C 纯 Node 行为（把真实 warmShrunkCache 抽出来跑，
// 含 RED 对照证明指标抓得到并发）→ D 无头行为（真实 DOM 里打点验证搜索节奏与提示可见性）。
// 用法：node tools/verify-cc-jank-fix.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

let fail = 0;
const T = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

const cc = read('js/chatcard.js');

// —— A. 静态：列表页搜索防抖 + 搜索中提示 ——
T('A1 列表页搜索 input 走防抖包装、旧直连已移除',
  cc.indexOf("searchInput2.addEventListener('input', ccSearchInput);") >= 0 &&
  cc.indexOf("searchInput2.addEventListener('input', filterEntries);") < 0);
T('A2 防抖时长 150ms 在位', /\}, 150\);/.test(cc) && cc.indexOf('ccSearchTimer = setTimeout(function () {') >= 0);
T('A3 慢搜索才亮提示的判据在位（轻库不闪）',
  cc.indexOf('if (ccSearchLast < 120) { ccSearchRun(); return; }') >= 0);
T('A4 提示先上屏一拍再跑同步搜索（删掉＝提示画不出来，等于没加）',
  cc.indexOf('ccSearchPost = setTimeout(ccSearchRun, 32);') >= 0);
T('A5 用户可见的「搜索中…」文案在位', cc.indexOf('>搜索中…</div>') >= 0);
T('A6 清空输入不等防抖（退格到空立即复原分类列表）',
  cc.indexOf("if (!String(searchInput2.value || '').trim()) { ccSearchRun(); return; }") >= 0);

// —— B. 静态：预压缩串行化 ——
T('B1 先收集成 jobs 再跑（不再在采集循环里直接发起压缩）', cc.indexOf('jobs.push(media);') >= 0);
T('B2 世代计数守卫在位（切联系人时旧轮作废）', cc.indexOf('const gen = ++ccShrinkGen;') >= 0);
T('B3 每张之间让出主线程', cc.indexOf('await new Promise(function (res) { setTimeout(res, 0); });') >= 0);
T('B4 单张兜底超时在位（坏 dataURL 不卡住整轮）', cc.indexOf('setTimeout(fin, 3000);') >= 0);

if (fail) { console.log('静态断言失败 ' + fail + ' 条，跳过行为部分'); process.exit(1); }

// —— C. 行为（纯 Node）：抽出真实 warmShrunkCache 跑，断言同刻只压一张 ——
const iGen = cc.indexOf('var ccShrinkGen = 0;');
const iFn = cc.indexOf('function warmShrunkCache() {', iGen);
if (iGen < 0 || iFn < 0) { console.log('FAIL C0 无法从源码抽取 warmShrunkCache（结构已被改动？）'); process.exit(1); }
let depth = 0, end = -1;
for (let i = cc.indexOf('{', iFn); i < cc.length; i++) {
  if (cc[i] === '{') depth++;
  else if (cc[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
}
if (end < 0) { console.log('FAIL C0 无法定位 warmShrunkCache 结尾'); process.exit(1); }
const warmSrc = cc.slice(iGen, end);
const makeWarm = new Function('replyPoolGroups', 'window', 'setTimeout', warmSrc + '\nreturn warmShrunkCache;');

const N = 16;
const poolOf = (tag) => {
  const items = Array.from({ length: N }, (_, i) => 'data:image/png;base64,' + tag + '-media-' + i);
  return { __tag: tag, __items: items, sticker: [['s-' + tag, items]], image: [['m-' + tag, []]] };
};

// 一次受控运行：记录同时在压的张数、完成数、缓存内容
async function runWarm(pools, settleMs) {
  const st = { inflight: 0, maxInflight: 0, done: 0, byTag: {} };
  const cache = {};
  const tagOf = {};
  pools.forEach(function (p) { if (p && p.__items) p.__items.forEach(function (m) { tagOf[m] = p.__tag; }); });
  const win = {
    _shrunkStickerCache: cache,
    // 桩要回传「更小的版本」：真实 shrinkMediaUrl 只在压小了才被缓存（small !== media），
    // 回传原值会让缓存断言恒为空，测不出东西
    shrinkMediaUrl: function (src, cb) {
      st.inflight++;
      if (st.inflight > st.maxInflight) st.maxInflight = st.inflight;
      const tag = tagOf[src] || '?';
      setTimeout(function () { st.inflight--; st.done++; st.byTag[tag] = (st.byTag[tag] || 0) + 1; cb(src + '#small'); }, 4);
    }
  };
  const warm = makeWarm(() => pools.shift(), win, setTimeout);
  for (let i = 0; i < (pools.args || 1); i++) warm();
  await sleep(settleMs);
  return { st, cache };
}

// C1/C2：单轮 16 张——串行（同刻 1 张）且一张不丢
{
  const pools = [poolOf('a')]; pools.args = 1;
  const { st, cache } = await runWarm(pools, 1200);
  T('C1 单轮预热串行执行：同一时刻只压 1 张', st.maxInflight === 1, 'maxInflight=' + st.maxInflight);
  T('C2 16 张一张不丢（串行化没有丢完成回调）', st.done === N, 'done=' + st.done + '/' + N);
  T('C2b 结果正常写入压缩缓存', Object.keys(cache).length === N, 'cache=' + Object.keys(cache).length);
}

// C3：RED 对照——按修复前的形态（采集循环里直接并发发起）跑同一批，必须能抓到 >1 并发
{
  const st = { inflight: 0, maxInflight: 0 };
  const pool = poolOf('red');
  ['sticker', 'image'].forEach(function (t) {
    (pool[t] || []).forEach(function (e) {
      (e[1] || []).forEach(function (m) {
        if (typeof m !== 'string' || m.indexOf('data:') !== 0) return;
        st.inflight++;
        if (st.inflight > st.maxInflight) st.maxInflight = st.inflight;
        setTimeout(function () { st.inflight--; }, 4);
      });
    });
  });
  T('C3 RED 对照：旧并发形态确被同一指标抓到（证明 C1 不是恒真）', st.maxInflight > 1, '旧形态 maxInflight=' + st.maxInflight);
}

// C4：世代守卫——连发两轮，第一轮（池 A）应立即作废，第二轮（池 B）全量完成
{
  const pools = [poolOf('a'), poolOf('b')]; pools.args = 2;
  const { st } = await runWarm(pools, 1200);
  const aDone = st.byTag['a'] || 0, bDone = st.byTag['b'] || 0;
  T('C4 世代守卫：切池后旧一轮立即作废（池 A 至多压 1 张）', aDone <= 1, 'A 处理=' + aDone);
  T('C4b 新一轮全量完成（池 B 16 张）', bDone === N, 'B 处理=' + bDone + '/' + N);
}

if (fail) { console.log('行为（Node）断言失败 ' + fail + ' 条，跳过无头部分'); process.exit(1); }

// —— D. 行为（无头 DOM）：真实页面里打点验证搜索节奏与「搜索中…」可见性 ——
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
let js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
// RED 自检（CCJANK_RED=1 node tools/verify-cc-jank-fix.mjs）：只在内存里把接线还原成修复前的
// 「input 直连 filterEntries」，D1/D3 必须转红——证明这两条断言守的是防抖本身，不是恒真。
if (process.env.CCJANK_RED) {
  const before = js;
  js = js.replace("searchInput2.addEventListener('input', ccSearchInput);",
                  "searchInput2.addEventListener('input', filterEntries);");
  console.log(js === before ? '⚠️ RED 注入未命中（锚点文字已变）' : '（RED 模式：已还原修复前接线）');
}
let html = read('template.html').replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  const map = { '/manifest.json': 'pwa/manifest.json', '/notice.json': 'pwa/notice.json', '/sw.js': 'pwa/sw.js', '/version.json': null };
  if (url in map && map[url]) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(read(map[url])); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-ccjank-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 150));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=390,844', '--user-data-dir=' + profileDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => {
  try { chrome.kill(); } catch (e) {}
  server.close();
  // 自清临时 profile（C 盘紧张 + TEMP 里残留过上百个无头 profile，见 WORKLOG 2026-09-16）
  try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
});

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (evt) => { const m = JSON.parse(evt.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2800);
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove();
  document.querySelectorAll('.onboard-mask,.mg-guide-mask').forEach(n=>{ try{n.hidden=true;}catch(e){} }); })()`);

// 夹具：打开字卡库页、把跨模块搜索注册表换成计数打点桩、装「搜索中…」出现记录器
const setup = await ev(`(()=>{
  const page = document.getElementById('page-chatcard'); if (page) page.hidden = false;
  const inp = document.getElementById('chatcard-search');
  if (!inp) return { ok:false, why:'找不到 #chatcard-search' };
  window.__calls = 0; window.__slow = false;
  window.__cardSearchFns = [{ name: '测试桩', fn: function (kw) {
    window.__calls++;
    if (window.__slow) { const t = Date.now(); while (Date.now() - t < 160) {} }
    return [{ t:'晚安', cat:'g' }, { t:'晚安呀', cat:'g' }, { t:'今天也要开心', cat:'g' }];
  } }];
  window.__sawHint = false;
  const el = document.querySelector('.cc-search-result');
  if (el) { window.__hintObs = new MutationObserver(function () {
    if (el.textContent.indexOf('搜索中') >= 0) window.__sawHint = true;
  }); window.__hintObs.observe(el, { childList:true, subtree:true, characterData:true }); }
  window.__type = function (v) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles:true })); };
  return { ok:true, tag: inp.tagName, hasResultEl: !!el };
})()`);
T('D0 前置：字卡库搜索框与结果容器就位', !!(setup && setup.ok && setup.hasResultEl), JSON.stringify(setup));

if (setup && setup.ok) {
  // D1 防抖：敲一下 60ms 内一次都不该搜（旧实现此时已搜过）
  await ev(`window.__type('晚')`);
  await sleep(60);
  const c1 = await ev(`window.__calls`);
  T('D1 打字后 60ms 内未发起搜索（防抖生效，旧实现此处已全量重扫）', c1 === 0, 'calls=' + c1);

  // D2 停顿后恰好搜一次
  await sleep(260);
  const c2 = await ev(`window.__calls`);
  T('D2 停顿 150ms 后恰好搜索 1 次', c2 === 1, 'calls=' + c2);

  // D3 连打 4 个字只搜 1 次（旧实现 = 4 次）
  await ev(`window.__type('晚安'); window.__type('晚安啊'); window.__type('晚安啊哈'); window.__type('晚安啊哈哈')`);
  await sleep(320);
  const c3 = await ev(`window.__calls`);
  T('D3 连打 4 个字仍只搜索 1 次（旧实现 4 次）', c3 === 2, 'calls=' + c3 + '（期望 2）');

  // D4 命中的关键字要正常出结果（D3 的「晚安啊哈哈」按 AND 语义本就该 0 命中，不能拿它验渲染）
  await ev(`window.__type('晚安')`);
  await sleep(320);
  const rendered = await ev(`(document.querySelector('.cc-search-result')||{}).textContent || ''`);
  T('D4 命中时正常渲染（命中数 + 分级标题）', /找到 [1-9]\d* 张含「晚安」的字卡/.test(rendered) && /命中/.test(rendered), rendered.slice(0, 48));

  // D5 慢搜索时用户看得见「搜索中…」：先跑一次慢搜索垫高上轮耗时，再搜一次看提示
  await ev(`window.__slow = true; window.__sawHint = false; window.__type('慢')`);
  await sleep(600);                       // 让慢搜索跑完（垫高 ccSearchLast）
  await ev(`window.__sawHint = false; window.__type('慢一点')`);
  await sleep(600);
  const sawHint = await ev(`window.__sawHint`);
  T('D5 上一轮慢搜索后，本轮先显示「搜索中…」再出结果', sawHint === true, 'sawHint=' + sawHint);

  // D6 清空输入立即复原（不等防抖）
  await ev(`window.__slow = false; window.__type('')`);
  await sleep(40);
  const d6 = await ev(`(()=>{ const el = document.querySelector('.cc-search-result'); return { hidden: !!(el && el.hidden), calls: window.__calls }; })()`);
  T('D6 退格到空立即复原分类列表（不等 150ms 防抖）', d6.hidden === true, JSON.stringify(d6));
}

console.log(fail ? ('❌ cc-jank-fix 断言失败 ' + fail + ' 条') : '✅ cc-jank-fix 全部断言通过');
process.exit(fail ? 1 : 0);
