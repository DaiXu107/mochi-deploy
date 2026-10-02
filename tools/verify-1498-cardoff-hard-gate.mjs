// #1498 行为回归尺：「字卡库里逐张关闭 / 整组停用」必须对**所有**使用方生效。
// 用户报障（荣耀畅玩40 Plus / 夸克，明说其他设备型号也有出现）：
//   「有的字卡和有的字卡分组或单独字卡，我设置了禁止使用的字卡，联系人还是能使用」。
// 本尺钉的是四处「禁了还在用」的口子（全部机型无关，纯判据缺失）：
//   ① 裸抽调 getInteractPool 的 8 个模块（拍卖/五子棋/连线/消消乐/四子棋/记忆/钓鱼/音乐）+
//      chat.js「吐槽·回应」/ ta-ask.js「询问·回应」——getLibPool 只「取组」不过闸；
//   ② 各功能模块「过闸后为空 ⇒ 回落内置兜底」，而兜底常与数据组逐字同文（花园悄悄话 7/7、
//      喝水催喝 6/6 重合）＝全关等于没关；
//   ③ room.js 的「过滤后非空才采用」（if (f.length) arr = f）＝全关时整个未过滤池被留下；
//   ④ gift-shop.js 礼物寄语池直接扫 DEFAULT_CARD_DATA.main 全量，零闸。
// 断言：
//   S1~S6 源码/产物锚（总闸下沉、兜底出口、四处消费点接线）；
//   B1 逐张关闭「互动回应」一张 ⇒ getInteractPool 不再吐它（同组其它卡仍在＝没误伤）；
//   B2 整组停用「游戏平局·回应」⇒ 该组进入 getInteractPool 的条目为 0；
//   B3 getLibPool 过闸（room 全关 ⇒ 空）；对照组：同组未关时非空；
//   B4 gateCardFallback：全关 ⇒ 空；部分关 ⇒ 只掉被关的那几张；
//   B5 礼物寄语池不含被禁主字卡、且未禁的仍在（不误伤）；
//   B6 幂等：已自行过滤的调用方（getDeskCheckPool）结果与基座一致＝重复过滤不改行为；
//   B7 未做任何关闭时，getInteractPool / getLibPool / 礼物池与「无闸口径」逐条一致（零误伤）；
//   Z 全程零 JS 异常。
// 用法：node tools/verify-1498-cardoff-hard-gate.mjs [被测根目录]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(resolve(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..'));
if (!existsSync(join(root, 'index.html'))) { console.error('产物不在：' + root); process.exit(2); }
console.log('被测产物：' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' ← ' + detail : '')); }
};

// ---- S 组：源码/产物锚（外置 js/<file> 与内联 index.html 两种落点都认）----
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const srcOf = (f) => { try { return readFileSync(join(root, 'js', f), 'utf8'); } catch (e) { return ''; } };
const dc = srcOf('default-cards.js') + indexHtml;
const roomCode = srcOf('room.js') + indexHtml;
const gardenCode = srcOf('garden.js') + indexHtml;
const musicCode = srcOf('music-player.js') + indexHtml;
const giftCode = srcOf('gift-shop.js') + indexHtml;
console.log('S 源码/产物锚');
ok('S1 getLibPool 内置同源池过 isDefaultCardOff 总闸', dc.includes('if (off) arr = arr.filter(c => !off(cat, c));'));
ok('S2 兜底池统一出口 gateCardFallback 在位', dc.includes('window.gateCardFallback = function (cat, fallback) {'));
ok('S3 room.js：兜底过闸 + 过滤结果一律采用（不再「非空才采用」）',
  roomCode.includes("window.gateCardFallback('room'") && !roomCode.includes('if (f.length) arr = f;'));
ok('S4 garden.js：悄悄话兜底过闸 + 空则不发音',
  gardenCode.includes("window.gateCardFallback(\"garden\", WM)") && gardenCode.includes('if (wmPool.length) {'));
ok('S5 music-player.js：听歌字卡兜底过闸', musicCode.includes("window.gateCardFallback('music', fallback)"));
ok('S6 gift-shop.js：礼物寄语池过闸 + 只读探针', giftCode.includes("!(off && off('main', x))") && giftCode.includes('window.__giftCardPool = function ()'));

// ---- 无头浏览器 ----
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9980 + Math.floor(Math.random() * 20));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1497-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
try {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        break;
      }
    } catch (e) {}
    await sleep(150);
  }
  if (!ws) throw new Error('无法连接无头浏览器');
} catch (e) { console.error('SKIP: ' + e.message); chrome.kill(); server.close(); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: '(async()=>{' + expr.trim() + '})()', awaitPromise: true, returnByValue: true, userGesture: true });
    if (r && r.exceptionDetails) return { __err: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 300) };
    return r && r.result ? r.result.value : null;
  } catch (e) { return { __err: String(e).slice(0, 120) }; }
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 423, height: 853, deviceScaleFactor: 1.7, mobile: true });
// 二级锁（#319）必须在文档脚本之前解锁，否则 getLibPool/getDefaultCardGroups 一律空池＝断言假绿
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){try{localStorage.setItem('xy-home-v2:cardlock-state','open');localStorage.setItem('xy-home-v2:cardlock-pwver','2');}catch(e){}})()" });
let jsErr = 0;
ws.addEventListener('message', (ev) => {
  try { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') jsErr++; } catch (e) {}
});
async function openCold() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if ((await evalJs('return !!window.__mochiDataReady')) === true) break; await sleep(300); }
  await evalJs("var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}} return true;");
  await sleep(600);
}
// 夹具：解锁 + 清掉全部字卡关闭键（本尺自己造现场）。
// 解锁两条腿都走：①文档前种子（旧 tip：isOpen 读 LS 快照）；②`cardLockTryUnlock` 会话闸
//   （#1497 起「解锁态只活本页生命周期」，每次重载都要重解一次）。
const reset = () => evalJs(`
  try { if (window.cardLockTryUnlock) window.cardLockTryUnlock('990815'); } catch (e) {}
  var s = window.activeStore();
  ['dc-groups-off','cc-groups-off','pg-groups-off'].forEach(function (k) { try { s.remove(k); } catch (e) {} });
  try { window.xyStore('xy-home-v2').remove('cc-groups-public-off'); } catch (e) {}
  var ks = []; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i) || ''; if (k.indexOf(':dc-off-') >= 0) ks.push(k); } } catch (e) {}
  ks.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
  s.set('dc-enabled','1'); s.set('dc-use-chat','1');
  return { lock: (window.cardLockOpen && window.cardLockOpen()) === true, cleared: ks.length };
`);

console.log('B 行为断言（423×853 无头）');
await openCold();
const fx = await reset();
if (!fx || fx.lock !== true) { console.error('SKIP: 二级锁未能置为 open（断言会走空池假绿）: ' + JSON.stringify(fx)); chrome.kill(); server.close(); process.exit(2); }
await openCold();
await reset();

// ---- B7 基线互证：什么都没关时，三条取池口与「不过闸」逐条一致 ----
const b7 = await evalJs(`
  var out = {};
  var pg = window.getInteractPool('游戏胜利·回应');
  var grp = ((window.DEFAULT_CARD_DATA.interact||[]).find(function(x){return x[0]==='游戏胜利·回应';})||[])[1]||[];
  out.interactSame = pg.length === grp.length && grp.every(function(c){ return pg.indexOf(c) >= 0; });
  var rp = window.getLibPool('room','进门');
  var rgrp = ((window.DEFAULT_CARD_DATA.room||[]).find(function(x){return x[0]==='进门';})||[])[1]||[];
  out.roomSame = rp.length === rgrp.length;
  var all = []; (window.DEFAULT_CARD_DATA.main||[]).forEach(function(g){ (g[1]||[]).forEach(function(x){ all.push(x); }); });
  var gp = (window.__giftCardPool ? window.__giftCardPool() : null);
  out.giftSame = gp ? gp.length === all.length : null;
  return out;
`);
ok('B7 零关闭时三个口径与无闸口径一致（改动零误伤）',
  b7 && b7.interactSame === true && b7.roomSame === true && (b7.giftSame === true || b7.giftSame === null),
  JSON.stringify(b7));

// ---- B1 逐张关闭互动回应一张 ----
const b1 = await evalJs(`
  var s = window.activeStore();
  var grp = ((window.DEFAULT_CARD_DATA.interact||[]).find(function(x){return x[0]==='游戏胜利·回应';})||[])[1]||[];
  var victim = grp[0];
  s.set('dc-off-interact:' + victim, '1');
  var pool = window.getInteractPool('游戏胜利·回应');
  var lines = window.getPresetGroupLines('游戏胜利·回应');
  return { victim: victim, inRawPool: pool.indexOf(victim) >= 0, inGatedPool: lines.indexOf(victim) >= 0,
    othersKept: pool.length >= grp.length - 1, poolLen: pool.length, grpLen: grp.length };
`);
ok('B1 逐张关闭「互动回应」一张 ⇒ getInteractPool（8 个模块裸抽的正是它）不再吐它',
  b1 && b1.inRawPool === false, JSON.stringify(b1));
ok('B1b 同组其它卡仍在（只掉被关的那张，不误伤）', b1 && b1.othersKept === true, JSON.stringify(b1));
ok('B1c 对照组：官方过滤出口 getPresetGroupLines 同口径', b1 && b1.inGatedPool === false, JSON.stringify(b1));

// ---- B2 整组停用 ----
const b2 = await evalJs(`
  var s = window.activeStore();
  s.set('dc-groups-off', JSON.stringify({ interact: ['游戏平局·回应'] }));
  var pool = window.getInteractPool('游戏平局·回应');
  var grp = ((window.DEFAULT_CARD_DATA.interact||[]).find(function(x){return x[0]==='游戏平局·回应';})||[])[1]||[];
  var kept = ((window.DEFAULT_CARD_DATA.interact||[]).find(function(x){return x[0]==='游戏胜利·回应';})||[])[1]||[];
  var p2 = window.getInteractPool('游戏胜利·回应');
  return { poolLen: pool.length, grpLen: grp.length, otherGroupLen: p2.length, otherGrpLen: kept.length };
`);
ok('B2 整组停用「游戏平局·回应」⇒ 该组进池条目为 0', b2 && b2.poolLen === 0, JSON.stringify(b2));
ok('B2b 只停本组：别组不跟着空', b2 && b2.otherGroupLen > 0, JSON.stringify(b2));

// ---- B3 getLibPool 过闸（room 全关 ⇒ 空 / 未关 ⇒ 非空）----
const b3 = await evalJs(`
  var s = window.activeStore();
  s.remove('dc-groups-off');
  var before = window.getLibPool('room','进门').length;
  var grp = ((window.DEFAULT_CARD_DATA.room||[]).find(function(x){return x[0]==='进门';})||[])[1]||[];
  grp.forEach(function(c){ s.set('dc-off-room:' + c, '1'); });
  var after = window.getLibPool('room','进门').length;
  var fb = window.gateCardFallback('room', grp);
  return { before: before, grpLen: grp.length, after: after, gatedFb: fb.length };
`);
ok('B3 未关时 getLibPool 有货', b3 && b3.before > 0, JSON.stringify(b3));
ok('B3b 逐张关光 room「进门」组 ⇒ getLibPool 归零（原先照旧全量）', b3 && b3.after === 0, JSON.stringify(b3));
ok('B3c 兜底出口同口径：关了内置兜底也归零（原「全关回落兜底」＝禁用无效）', b3 && b3.gatedFb === 0, JSON.stringify(b3));

// ---- B4 gateCardFallback 部分关闭只掉被关的 ----
const b4 = await evalJs(`
  var s = window.activeStore();
  var WM = ["今天也辛苦啦，花花儿们也在努力长大哦","给你的小花浇了点水，要快快长大哦","看着花园里的花花，就想到你"];
  WM.forEach(function(c){ s.set('dc-off-garden:' + c, '1'); });
  return { allOff: window.gateCardFallback('garden', WM).length,
    partial: window.gateCardFallback('garden', WM.concat(['这条没被关'])).length };
`);
ok('B4 兜底出口：全关 ⇒ 0；只关一部分 ⇒ 只掉被关的', b4 && b4.allOff === 0 && b4.partial === 1, JSON.stringify(b4));

// ---- B5 礼物寄语池过闸 ----
const b5 = await evalJs(`
  var s = window.activeStore();
  var all = []; (window.DEFAULT_CARD_DATA.main||[]).forEach(function(g){ (g[1]||[]).forEach(function(x){ all.push(x); }); });
  var v1 = all[0], v2 = all[1];
  s.set('dc-off-main:' + v1, '1');
  s.set('dc-groups-off', JSON.stringify({ main: [((window.DEFAULT_CARD_DATA.main||[])[0]||[])[0]] }));
  var pool = window.__giftCardPool ? window.__giftCardPool() : null;
  if (!pool) return { noProbe: true };
  return { poolLen: pool.length, allLen: all.length, v1In: pool.indexOf(v1) >= 0, v2In: pool.indexOf(v2) >= 0 };
`);
ok('B5 礼物寄语池不含被逐张关闭的主字卡', b5 && b5.noProbe !== true && b5.v1In === false, JSON.stringify(b5));
ok('B5b 礼物寄语池不含被整组停用分组里的卡', b5 && b5.v2In === false, JSON.stringify(b5));
ok('B5c 池仍非空（只剔被禁的，不误伤）', b5 && b5.poolLen > 0 && b5.poolLen < b5.allLen, JSON.stringify(b5));

// ---- B6 幂等：已自行过滤的调用方结果不变 ----
const b6 = await evalJs(`
  var s = window.activeStore();
  s.remove('dc-groups-off');
  var all = []; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i) || ''; if (k.indexOf(':dc-off-') >= 0) all.push(k); } } catch (e) {}
  all.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
  return all.length;
`);
await openCold();
const b6b = await evalJs(`
  var dc = window.getDeskCheckPool('meToTa');
  var raw = window.getLibPool('deskcheck', '联系人申请我对联系人查岗');
  var off = window.isDefaultCardOff;
  var manual = raw.filter(function (c) { return !off('deskcheck', c); });
  return { a: dc.length, b: manual.length, same: dc.length === manual.length };
`);
ok('B6 幂等：getDeskCheckPool（自己已过滤一次）与手工单次过滤同长（重复过滤不改行为）',
  b6b && b6b.same === true, JSON.stringify(b6b));

ok('Z 全程零未捕获 JS 异常', jsErr === 0, 'jsErr=' + jsErr);

try { ws.close(); } catch (e) {}
chrome.kill(); server.close();
console.log('—— 合计：' + pass + ' 绿 / ' + fail + ' 红 ——');
process.exit(fail ? 1 : 0);
