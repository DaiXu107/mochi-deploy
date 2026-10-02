// ===== #586 经期温柔语态拼接处空一格（字卡与字卡之间不得首尾相接） =====
// 用户报障（2026-09-16，多机型同报，明说「其他设备型号也有出现」）：
//   ①「为什么有的人没开拼字卡的功能，联系人发送消息还是会使用拼字卡」；
//   ②「关于默认聊天字卡里的温柔动作：自动使用了拼字卡，并且没有空格隔开每一个字卡」。
// 根因（零机型分支，无头 CDP 实测）：温柔语态 period.js warmText 把「温柔前缀 / 正文 /
//   温柔动作」三张字卡用裸字符串拼接（p + text + s）——实测 800 次抽样中命中拼接触发的
//   222 条里有 183 条（82%）卡与卡之间没有任何空白，输出形如
//   「傻瓜，今天也要好好爱自己（握紧你的手）」（前缀+字卡+动作挤成一串）。这与单气泡
//   拼字的既定口径相反（#315/#370 定稿：字卡与字卡之间空一格），用户据此判定「拼字卡」
//   在自己的设备上自动生效了——而「字卡·拼字」三个开关（多字卡回复/词典拼字/梦角自由
//   造句）全关也拦不住它（温柔语态是独立功能，只有字卡库经期概率与逐张开关管得到）。
// 修复：period.js 新增唯一拼接点 warmJoin(a, b)（两端各留一格、空段不留孤立空格、
//   正文自带空白不重复），warmText 三个分支全部改走它；温柔动作池同时改为读
//   DEFAULT_CARD_DATA.period「温柔动作」分组（原来代码里抄死 6 条，字卡库已列 12 张，
//   后 6 张是哑开关）。
// 断言：
//   A1 抽样 800 次：所有「命中温柔化」的消息里，卡与卡之间一律有空白（修前 82% 无空白＝RED）
//   A2 只命中前缀时，前缀与正文之间有空白
//   A3 只命中动作时，正文与动作之间有空白
//   A4 双拼（前缀+正文+动作）时两端都有空白
//   B1 字卡库把「温柔前缀」逐张全关 → 结果不以空格开头（空段不留孤立空格）
//   B2 字卡库把「温柔动作」逐张全关 → 结果不以空格结尾
//   C1 温柔动作池＝数据分组全部 12 张：只留后 6 张（关掉前 6 张）时后 6 张能被拼出（修前恒不出现＝RED）
//   D1 经期字卡概率 0 → 不温柔化（#132 不回退）
//   D2 默认字卡总开关关 → 不温柔化（#157 不回退）
//   D3 默认字卡「聊天使用」关 → 不温柔化（#157 不回退）
//   Z  全程零未捕获 JS 错误
// 用法：node tools/verify-period-warm-spacing.mjs（需先 node build.mjs）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（可设 CHROME_PATH）'); process.exit(1); }
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const profile = join(process.env.TEMP || '/tmp', 'mochi-warms-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.log('  [页面异常] ' + JSON.stringify(r.exceptionDetails).slice(0, 200)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function finish(code) {
  try { chrome.kill(); } catch (e) {}
  // Windows 上 Chrome 刚被 kill 时 profile 目录仍被锁，立刻 rm 会静默失败（本机磁盘屡被测试
  // profile 占满过）——等一拍再删，删不掉也不影响结果。
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(code);
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
await sleep(500);

// 装机：今天在经期中（经期记录是全局键 xy-home-v2:period-records，不是 per-cid）
const today = await evalJs("(function(){var d=new Date(),p=function(n){return (n<10?'0':'')+n};return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());})()");
await evalJs("(function(){window.xyStore('xy-home-v2').set('period-records', JSON.stringify([{ start: '" + today + "', end: '" + today + "' }]));return true;})()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
const inPeriod = await evalJs('!!(window.periodStatus && window.periodStatus().inPeriod)');
if (!inPeriod) { console.error('环境不满足：无法把经期状态置为经期中（period-records 未生效）'); await finish(2); }

// 页面内探测器：抽样 periodWarmText，逐条判定「卡与卡之间是否有空白」
const probe = (n) => `(function(){
  var PREFIX = ['乖，','傻瓜，','我在呢','嘘…','宝贝，','嗯，','别担心，有我陪着你','这几天你说了算','难受的话，第一时间告诉我','今天你只负责舒服','先放下事，顾好自己','小肚子的事，交给我操心'];
  var ACT = ['（把你往怀里带了带）','（轻轻抵着你的额头）','（握紧你的手）','（摸了摸你发顶）','（语气柔下来）','（把热牛奶推到你手边）','（把热水袋递到你手里）','（帮你把毯子掖了掖）','（轻轻揉了揉你的小腹）','（把糖放在你够得到的地方）','（帮你把空调调高了一度）','（拍了拍身边的位置，让你躺下）'];
  var body = '今天也要好好爱自己';
  var o = { n: ${n}, hit: 0, glued: 0, rStartWs: 0, rEndWs: 0, preOnly: 0, actOnly: 0, both: 0,
            preGlued: 0, actGlued: 0, preSep: 0, actSep: 0, samples: [], actHits: {}, newActHits: 0 };
  var NEW = ACT.slice(6);
  for (var i = 0; i < ${n}; i++) {
    var t = window.periodWarmText(body);
    if (typeof t !== 'string') continue;
    if (t === body) continue;
    o.hit++;
    if (/^\\s/.test(t)) o.rStartWs++;
    if (/\\s$/.test(t)) o.rEndWs++;
    var p = null, a = null;
    for (var x = 0; x < PREFIX.length; x++) { if (t.indexOf(PREFIX[x]) === 0) { p = PREFIX[x]; break; } }
    for (var y = 0; y < ACT.length; y++) { if (t.slice(-ACT[y].length) === ACT[y]) { a = ACT[y]; break; } }
    if (a) { o.actHits[a] = (o.actHits[a] || 0) + 1; if (NEW.indexOf(a) >= 0) o.newActHits++; }
    if (p && a) o.both++; else if (p) o.preOnly++; else if (a) o.actOnly++;
    if (p) { var lead = t.charAt(p.length); if (/\\s/.test(lead)) o.preSep++; else o.preGlued++; }
    if (a) { var tail = t.charAt(t.length - a.length - 1); if (/\\s/.test(tail)) o.actSep++; else o.actGlued++; }
    if ((p && !/\\s/.test(t.charAt(p.length))) || (a && !/\\s/.test(t.charAt(t.length - a.length - 1)))) o.glued++;
    if (o.samples.length < 3 && p && a) o.samples.push(t);
  }
  return JSON.stringify(o);
})()`;

const RESET = `(function(){
  var st = window.activeStore();
  st.set('reply-qs-en', '1'); st.set('reply-py-en', '1'); st.set('reply-mjf-en', '1');
  st.set('dc-enabled', '1'); st.set('dc-use-chat', '1'); st.set('dcf-enabled', '1');
  st.set('dcf-period', '25');
  var g = (window.DEFAULT_CARD_DATA && window.DEFAULT_CARD_DATA.period) || [];
  g.forEach(function (grp) { (grp[1] || []).forEach(function (c) { st.set('dc-off-period:' + c, '0'); }); });
  return 'ok';
})()`;
const offGroup = (name) => `(function(){
  var st = window.activeStore(); var g = (window.DEFAULT_CARD_DATA.period || []);
  g.forEach(function (grp) { if (grp[0] === '${name}') (grp[1] || []).forEach(function (c) { st.set('dc-off-period:' + c, '1'); }); });
  return 'ok';
})()`;
const offList = (arr) => `(function(){
  var st = window.activeStore();
  ${JSON.stringify(arr)}.forEach(function (c) { st.set('dc-off-period:' + c, '1'); });
  return 'ok';
})()`;

const N = 800;
async function run(tag) {
  const o = JSON.parse((await evalJs(probe(N))) || '{}');
  return o;
}

console.log('--- A 组：拼接处空白分隔 ---');
await evalJs(RESET);
const a = await run('A');
console.log('  抽样 ' + N + ' 次：命中温柔化 ' + a.hit + ' 条（前缀+动作 ' + a.both + ' / 仅前缀 ' + a.preOnly + ' / 仅动作 ' + a.actOnly + '）');
if (a.samples && a.samples.length) console.log('  样例：' + a.samples.map((s) => '「' + s + '」').join(' '));
check('A1 命中温柔化的消息里卡与卡之间一律有空白（无空白 ' + a.glued + '/' + a.hit + '）', a.hit > 0 && a.glued === 0, 'glued=' + a.glued);
check('A2 前缀与正文之间有空白（裸拼接 ' + a.preGlued + ' 条）', a.preOnly + a.both > 0 && a.preGlued === 0, 'preGlued=' + a.preGlued + ' preSep=' + a.preSep);
check('A3 正文与动作之间有空白（裸拼接 ' + a.actGlued + ' 条）', a.actOnly + a.both > 0 && a.actGlued === 0, 'actGlued=' + a.actGlued + ' actSep=' + a.actSep);
check('A4 覆盖到双拼（前缀+正文+动作）形态', a.both > 0, 'both=' + a.both);

console.log('--- B 组：空段不留孤立空格 ---');
await evalJs(RESET); await evalJs(offGroup('温柔前缀'));
const b1 = await run('B1');
check('B1 前缀被逐张全关 → 结果不以空格开头（孤立空格 ' + b1.rStartWs + ' 条）', b1.rStartWs === 0, 'rStartWs=' + b1.rStartWs + ' hit=' + b1.hit);
await evalJs(RESET); await evalJs(offGroup('温柔动作'));
const b2 = await run('B2');
check('B2 动作被逐张全关 → 结果不以空格结尾（孤立空格 ' + b2.rEndWs + ' 条）', b2.rEndWs === 0, 'rEndWs=' + b2.rEndWs + ' hit=' + b2.hit);

console.log('--- C 组：温柔动作池＝数据分组（12 张） ---');
const OLD6 = ['（把你往怀里带了带）', '（轻轻抵着你的额头）', '（握紧你的手）', '（摸了摸你发顶）', '（语气柔下来）', '（把热牛奶推到你手边）'];
const NEW6 = ['（把热水袋递到你手里）', '（帮你把毯子掖了掖）', '（轻轻揉了揉你的小腹）', '（把糖放在你够得到的地方）', '（帮你把空调调高了一度）', '（拍了拍身边的位置，让你躺下）'];
await evalJs(RESET); await evalJs(offList(OLD6));
const c1 = await run('C1');
check('C1 只留字卡库后 6 张动作卡时它们能被拼出（后 6 张是哑开关＝本项红）', c1.newActHits > 0, 'newActHits=' + c1.newActHits + ' hits=' + JSON.stringify(c1.actHits));
await evalJs(RESET); await evalJs(offList(NEW6));
const c2 = await run('C2');
check('C2 关掉后 6 张 → 其中任何一张都不再出现（开关真的管用）', Object.keys(c2.actHits || {}).every((k) => NEW6.indexOf(k) < 0) && c2.actHits && Object.keys(c2.actHits).length > 0, 'hits=' + JSON.stringify(c2.actHits));

console.log('--- D 组：既有闸门不回退 ---');
await evalJs(RESET); await evalJs("window.activeStore().set('dcf-period','0'); 'ok'");
const d1 = await run('D1');
check('D1 字卡库「经期字卡概率」= 0 → 不温柔化（#132）', d1.hit === 0, 'hit=' + d1.hit);
await evalJs(RESET); await evalJs("window.activeStore().set('dc-enabled','0'); 'ok'");
const d2 = await run('D2');
check('D2 默认字卡总开关关 → 不温柔化（#157）', d2.hit === 0, 'hit=' + d2.hit);
await evalJs(RESET); await evalJs("window.activeStore().set('dc-use-chat','0'); 'ok'");
const d3 = await run('D3');
check('D3 默认字卡「聊天使用」关 → 不温柔化（#157）', d3.hit === 0, 'hit=' + d3.hit);
await evalJs(RESET); await evalJs(offGroup('温柔前缀')); await evalJs(offGroup('温柔动作'));
const d4 = await run('D4');
check('D4 前缀+动作逐张全关 → 完全不温柔化', d4.hit === 0, 'hit=' + d4.hit);

console.log('--- Z 组：零未捕获错误 ---');
const errs = JSON.parse((await evalJs('JSON.stringify(window.__jsErrors || [])')) || '[]');
check('Z1 无未捕获 JS 错误', errs.length === 0, 'n=' + errs.length);

const fail = results.filter((r) => !r.ok).length;
console.log('== 结果：' + (results.length - fail) + '/' + results.length + (fail ? '  FAIL=' + fail : '  全绿'));
await finish(fail ? 1 : 0);
