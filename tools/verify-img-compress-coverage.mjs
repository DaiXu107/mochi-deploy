// ===== 压缩图片功能·覆盖面实测（img-compress.js #633）=====
// 用法：先 `node build.mjs`，再 `node tools/verify-img-compress-coverage.mjs`
//（可用 MOCHI_ARTIFACT=<路径> 指定别的产物文件）
// 被测对象是产物 index.html（用户实际打开的那一份）。
// 用户原话：「压缩图片功能打开，里面无法扫描所有桌面；而且里面不显示公用字卡+专属字卡里
// 上传的图片、头像互动的头像库的图片」。三条根因各配断言：
//   S1  扫描覆盖「注册表里没有但键在」的桌面（孤儿桌面 c999888777 的字卡库图文被算进 cc.n）
//   S2  字卡库里已被 #554 令牌化的图片（@@m:）解析到媒体池条目一起算（scan.cc.pool ≥ 2）
//   S3  头像互动的头像库（avatar-lib / avatar-me-lib）进扫描（scan.avatar.n ≥ 2）
//   S4  阈值口径不放松：头像库里的小图（<80KB）不算（只两条大图进 avatar.n）
//   C1  真压：内联字卡图 / 孤儿桌面图 / 池条目 / 头像库条目都被替换（processed ≥ 4）
//   C2  池条目「同键换值」：值变小、键不变、令牌仍解得出图（mochiMediaExpand 命中压缩后新值）
//   C3  头像库条目压到 ≤256px 且仍是合法 data:image
//   C4  媒体池完整性：替换后 Coverage 仍报 missing=0、GC 不把被引用的池条目当孤儿
//   C5  孤儿桌面（不在联系人注册表）的图片确实被写小（不是只算了数）
//   A1  全程无 JS 运行时错误
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const artifactPath = process.env.MOCHI_ARTIFACT || join(root, 'index.html');
const artifact = readFileSync(artifactPath, 'utf8');
if (artifact.indexOf('window.mochiImgCompress') < 0) {
  console.log('ENV  产物里还没有压缩图片功能——请先执行 node build.mjs 再跑本脚本');
  process.exit(2);
}
if (artifact.indexOf('window.mochiMediaReplace') < 0) {
  // 不提前退出：老产物上这些断言应当直接判红（RED 基线），比「环境不满足」更能说明问题
  console.log('WARN 产物里没有 #633 的池条目替换接口（mochiMediaReplace）——本产物是修复前的版本，C 组断言预期判红');
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(artifact);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 9));
// #620 环境纪律：headless Chrome 的 user-data-dir 用完即删（历次 verify 脚本只 kill 不删，
// %TEMP% 曾堆到 60GB+ 把 C 盘写满）
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-verify-img-cov-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profileDir,
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
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function waitFor(expr, tries = 60, step = 250) {
  for (let i = 0; i < tries; i++) { if (await evalJs(expr)) return true; await sleep(step); }
  return false;
}
let navSeq = 0;
async function coldStart() {
  const token = 'nav' + Date.now().toString(36) + '-' + (++navSeq);
  await evalJs(`window.__navToken = ${JSON.stringify(token)}; true`);
  await cdp('Page.navigate', { url: baseUrl + '/' });
  await waitFor(`window.__navToken !== ${JSON.stringify(token)}`, 60, 250);
  await sleep(2500);
  await waitFor("typeof window.xyStore === 'function' && typeof window.idbListKeys === 'function'");
  await waitFor('!!window.__mochiDataReady');
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(800);
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const HASH_A = 'abcdef0123456789abcdef0123456789'; // 字卡库里被令牌化的图（真身在媒体池）
const HASH_B = '0123456789abcdef0123456789abcdef'; // 第二个令牌（跨桌面共用同一张图）
const TOK_A = '@@m:' + HASH_A;
const TOK_B = '@@m:' + HASH_B;
const ORPHAN = 'c999888777';                       // 只存在于键清单、不在联系人注册表里的桌面

await coldStart();
const seeded = await evalJs(`(async function(){
  // 「照片感」图（平滑渐变 + 山丘 + 稀疏细节；不能是海量随机噪点，那是 JPEG 最不擅长的纹理）
  function photo(w, h, detail) {
    detail = detail || 500;
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#4a90d9'); g.addColorStop(.45, '#8ec5f0'); g.addColorStop(1, '#f0e8d8');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (var s = 0; s < 30; s++) {
      x.fillStyle = 'rgba(90,138,90,.9)';
      x.beginPath(); x.moveTo(0, h*.6 + s*7);
      for (var px = 0; px <= w; px += 40) x.lineTo(px, h*.6 + s*7 + Math.sin(px*.006+s)*30);
      x.lineTo(w, h); x.lineTo(0, h); x.closePath(); x.fill();
    }
    for (var i = 0; i < detail; i++) {
      x.fillStyle = 'rgba(' + ((i*29)%60+50) + ',' + ((i*13)%80+90) + ',' + ((i*7)%60+40) + ',.85)';
      x.beginPath(); x.arc(Math.random()*w, (h*.4) + Math.random()*h*.55, 1+Math.random()*2.5, 0, Math.PI*2); x.fill();
    }
    return c.toDataURL('image/jpeg', 0.95);
  }
  var G = window.xyStore('xy-home-v2');
  var bigPhoto = photo(2000, 1500, 900);   // ~200KB base64（字卡图阈值 100KB）
  var poolImg  = photo(1800, 1350, 900);   // 池条目真身（阈值同 100KB）
  var avatarBig = photo(900, 900, 700);    // ~120KB（头像库阈值 80KB）
  var wallBig  = photo(3000, 2000, 4000);  // >400KB（壁纸阈值 400KB）
  // 头像库里的小图（32x32 纯色）：阈值 80KB 以内不该被算进来（S4 口径不放松）
  var cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
  cv.getContext('2d').fillStyle = '#334455'; cv.getContext('2d').fillRect(0, 0, 32, 32);
  var avatarSmall = cv.toDataURL('image/jpeg', 0.85);
  // 公用字卡库：内联大图 + 透明 PNG 表情 + 一张已令牌化的图
  var ply = photo(600, 600, 200);
  var stk = document.createElement('canvas'); stk.width = 480; stk.height = 480;
  var sx = stk.getContext('2d');
  for (var q = 0; q < 30000; q++) { sx.fillStyle = 'rgba(' + Math.floor(Math.random()*256) + ',' + Math.floor(Math.random()*256) + ',' + Math.floor(Math.random()*256) + ',1)'; sx.fillRect(Math.random()*480, Math.random()*480, 2, 2); }
  var stkUrl = stk.toDataURL('image/png');
  G.set('cc-groups-public', JSON.stringify({
    text: 'x',
    image: [['公用组', [bigPhoto, '${TOK_A}']]],
    sticker: [['表情组', [stkUrl]]]
  }));
  // 「小美」专属库：库内只剩令牌（#554 令牌化后的真实形态）
  G.set('c111222333:cc-groups', JSON.stringify({ text: 'x', image: [['专属组', ['${TOK_B}', '${TOK_A}']]], sticker: [] }));
  // 孤儿桌面：键在 IDB、不在联系人注册表里（历史改名/删除残留、导入他人数据）
  G.set('${ORPHAN}:cc-groups', JSON.stringify({ text: 'x', image: [['孤儿组', [bigPhoto]]], sticker: [] }));
  // 媒体池真身（内容寻址键；本条测试不校验哈希与内容一致，只看「同键换值」）
  G.set('media:${HASH_A}', poolImg);
  G.set('media:${HASH_B}', poolImg);
  // 头像互动头像库（各桌面 + 小图各一条）
  G.set('default:avatar-lib', JSON.stringify([avatarBig, avatarSmall]));
  G.set('c111222333:avatar-me-lib', JSON.stringify([avatarBig]));
  // 美化壁纸
  G.set('phone-bg', wallBig);
  // 联系人注册表：只有 default 与 c111222333（c999888777 故意不在册）
  G.set('contacts', JSON.stringify([{ id: 'default', name: '默认' }, { id: 'c111222333', name: '小美' }]));
  window.__seedLens = { big: bigPhoto.length, pool: poolImg.length, av: avatarBig.length, avSm: avatarSmall.length, wall: wallBig.length, stk: stkUrl.length };
  window.__seedBig = bigPhoto;
  // 大值经 xyStore.set 是「内存+LS+IDB 异步发出」，且 >200KB 只落 IDB——播种必须显式等落盘，
  // 否则随后的复用/刷新会丢掉刚播的键（实测过：同一份脚本两次跑，关键词一个在、一个没在）。
  var exp = {
    'xy-home-v2:cc-groups-public': 1, 'xy-home-v2:c111222333:cc-groups': 1,
    'xy-home-v2:${ORPHAN}:cc-groups': 1,
    'xy-home-v2:default:avatar-lib': 1, 'xy-home-v2:c111222333:avatar-me-lib': 1,
    'xy-home-v2:phone-bg': 1, 'xy-home-v2:media:${HASH_A}': 1, 'xy-home-v2:media:${HASH_B}': 1,
    'xy-home-v2:contacts': 1
  };
  var vals = {};
  vals['xy-home-v2:cc-groups-public'] = G.get('cc-groups-public');
  vals['xy-home-v2:c111222333:cc-groups'] = G.get('c111222333:cc-groups');
  vals['xy-home-v2:${ORPHAN}:cc-groups'] = G.get('${ORPHAN}:cc-groups');
  vals['xy-home-v2:default:avatar-lib'] = G.get('default:avatar-lib');
  vals['xy-home-v2:c111222333:avatar-me-lib'] = G.get('c111222333:avatar-me-lib');
  vals['xy-home-v2:phone-bg'] = G.get('phone-bg');
  vals['xy-home-v2:media:${HASH_A}'] = G.get('media:${HASH_A}');
  vals['xy-home-v2:media:${HASH_B}'] = G.get('media:${HASH_B}');
  vals['xy-home-v2:contacts'] = G.get('contacts');
  var bad = 0;
  for (var k in exp) {
    if (!exp[k]) continue;
    var ok = false;
    try { ok = await window.idbSet(k, vals[k]); } catch (e) { ok = false; }
    if (!ok) bad++;
  }
  return bad ? ('writefail:' + bad) : true;
})()`);
check('S0 播种成功并确认落盘（内联字卡大图 + 令牌化字卡 + 孤儿桌面 + 池条目 + 头像库 + 壁纸）', seeded === true, seeded);
const lens = (await evalJs('window.__seedLens || null')) || {};
console.log('  播种 base64 长度：字卡=' + (lens && lens.big) + ' 池图=' + (lens && lens.pool) + ' 头像=' + (lens && lens.av) + ' 头像小图=' + (lens && lens.avSm) + ' 壁纸=' + (lens && lens.wall) + '（阈值 字卡/池 102400 · 头像 81920 · 壁纸 409600）');

// 不刷新：播种发生在应用启动之后，键已在内存+LS+IDB 三处；刷新反而会触发启动期的
// 内存令牌化/懒加载，把播种状态搅成不确定（实测：刷新后关键词时有时无）。
// 这里只等 IDB 清单与取值都就绪，再进扫描。
let seedReady = false;
for (let i = 0; i < 40; i++) {
  const n = await evalJs(`(async function(){
    var ks = await window.idbListKeys(); if (!Array.isArray(ks)) return -1;
    var need = ['xy-home-v2:cc-groups-public','xy-home-v2:c111222333:cc-groups','xy-home-v2:${ORPHAN}:cc-groups','xy-home-v2:default:avatar-lib','xy-home-v2:c111222333:avatar-me-lib','xy-home-v2:phone-bg','xy-home-v2:media:${HASH_A}','xy-home-v2:media:${HASH_B}','xy-home-v2:contacts'];
    var miss = 0;
    for (var i2 = 0; i2 < need.length; i2++) if (ks.indexOf(need[i2]) < 0) miss++;
    if (miss) return -miss;
    var v = await window.idbGet('xy-home-v2:cc-groups-public');
    return (typeof v === 'string' && v.length > 100) ? 1 : -1;
  })()`);
  if (n === 1) { seedReady = true; break; }
  await sleep(500);
}
check('S0b 播种键已全部落盘（清单 + 取值双确认）', seedReady === true);

// ===== 扫描覆盖 =====
const scan = JSON.parse(await evalJs('window.mochiImgScan().then(function(r){ return JSON.stringify(r); })') || '{}');
const det = (scan && scan.detail) || [];
const detOf = (frag) => det.filter((d) => String(d.label).indexOf(frag) >= 0)[0] || null;
check('S1 扫描覆盖孤儿桌面（键在、联系人注册表里没有的桌面也算进来）',
  scan.ok === true && (scan.desksN || 0) >= 3 && !!detOf(ORPHAN) && (detOf(ORPHAN).n || 0) >= 1,
  'desksN=' + (scan.desksN || 0) + ' 孤儿来源=' + JSON.stringify(detOf(ORPHAN)));
check('S2 字卡库里的令牌（@@m:）解析到媒体池条目一起统计',
  (scan.cc && scan.cc.pool || 0) >= 2,
  'cc.n=' + (scan.cc && scan.cc.n) + ' pool=' + (scan.cc && scan.cc.pool));
check('S3 头像互动的头像库进扫描（avatar-lib / avatar-me-lib）',
  (scan.avatar && scan.avatar.n) >= 2 && !!detOf('头像库'),
  'avatar.n=' + (scan.avatar && scan.avatar.n) + ' 来源=' + det.filter((d) => String(d.label).indexOf('头像库') >= 0).map((d) => d.label + ':' + d.n).join(' / '));
check('S4 阈值口径不放松：头像库里 32x32 的小图不算（两条大图才算）',
  (scan.avatar && scan.avatar.n) === 2,
  'avatar.n=' + (scan.avatar && scan.avatar.n));
check('S5 公用字卡库内联大图 + 表情 PNG + 壁纸仍在扫描面内（原能力未被改坏）',
  (scan.cc && scan.cc.n) >= 4 && (scan.beauty && scan.beauty.n) >= 1,
  'cc.n=' + (scan.cc && scan.cc.n) + ' beauty.n=' + (scan.beauty && scan.beauty.n));

// ===== U1/U2 UI：设置行入口点开后用户实际看到的那一屏（#633 的可见收益：报来源、报桌面数）=====
await evalJs("(function(){var r=document.getElementById('row-img-compress'); if(r) r.click(); return !!r;})()");
let uiTxt = '';
for (let i = 0; i < 60; i++) {
  uiTxt = (await evalJs("(function(){var e=document.getElementById('modal-static'); return e?e.textContent:'';})()")) || '';
  if (uiTxt.indexOf('字卡库上传的图片') >= 0) break;
  await sleep(500);
}
check('U1 扫描弹窗按来源分行报数，并逐条列出已扫描来源（含键在、注册表里没有的桌面）',
  uiTxt.indexOf('字卡库上传的图片') >= 0 && uiTxt.indexOf('头像互动的头像库') >= 0 &&
  uiTxt.indexOf('已扫 ') >= 0 && uiTxt.indexOf(ORPHAN) >= 0 && uiTxt.indexOf('已扫描的来源') >= 0,
  '文案长度=' + uiTxt.length);
const pills = await evalJs("(function(){var p=document.getElementById('modal-pills');if(!p)return '[]';return JSON.stringify(Array.prototype.map.call(p.querySelectorAll('button,.mp-item,[class*=pill]'),function(x){return x.textContent;}));})()");
check('U2 压缩范围选项含「仅头像库+美化」（头像库与美化同类）', String(pills).indexOf('仅头像库+美化') >= 0, String(pills));
await evalJs("(function(){var m=document.getElementById('modal-mask'); if(m) m.hidden=true; return true;})()");

// ===== 真压 =====
const cmp = JSON.parse(await evalJs('window.mochiImgCompress("all").then(function(r){ return JSON.stringify(r); })') || '{}');
check('C1 压缩实际生效（内联字卡图/孤儿桌面图/池条目/头像库条目都换了更小产物）',
  cmp.ok === true && (cmp.processed || 0) >= 4,
  'processed=' + (cmp.processed || 0) + ' saved=' + ((cmp.saved || 0) / 1048576).toFixed(2) + 'MB skipped=' + (cmp.skipped || 0) + ' reason=' + (cmp.reason || ''));

const after = JSON.parse(await evalJs(`(async function(){
  var G = window.xyStore('xy-home-v2');
  var pub = JSON.parse(G.get('cc-groups-public') || '{}');
  var own = JSON.parse(G.get('c111222333:cc-groups') || '{}');
  var orph = JSON.parse(G.get('${ORPHAN}:cc-groups') || '{}');
  var av = JSON.parse(G.get('default:avatar-lib') || '[]');
  var avMe = JSON.parse(G.get('c111222333:avatar-me-lib') || '[]');
  // 池键只经 idbGet/idbSet 读写（media-pool 全模块不用 xyStore）——读回必须走 idbGet，
  // 走 xyStore 内存缓存会读到播种时的旧副本，误判成「没压」
  var poolA = await window.idbGet('xy-home-v2:media:${HASH_A}');
  var poolB = await window.idbGet('xy-home-v2:media:${HASH_B}');
  function sizeOf(u) { return new Promise(function (res) { var i = new Image(); i.onload = function () { res({ w: i.width, h: i.height, fmt: String(u).slice(0, 22) }); }; i.onerror = function () { res(null); }; i.src = u; }); }
  var avSize = await sizeOf(av[0]);
  var poolSize = await sizeOf(poolA);
  var avSmSize = await sizeOf(av[1]);
  return JSON.stringify({
    pubImg: pub.image[0][1][0].length,
    pubImgPrefix: String(pub.image[0][1][0]).slice(0, 22),
    pubTok: pub.image[0][1][1],
    ownTok0: own.image[0][1][0], ownTok1: own.image[0][1][1],
    orphImg: orph.image[0][1][0].length,
    orphPrefix: String(orph.image[0][1][0]).slice(0, 22),
    poolA: poolA ? poolA.length : -1, poolB: poolB ? poolB.length : -1,
    poolAPrefix: String(poolA || '').slice(0, 22), poolSize: poolSize,
    av0: av[0].length, av1Len: String(av[1]).length, av1Prefix: String(av[1]).slice(0, 22), avSize: avSize, avSmSize: avSmSize,
    avMe: avMe[0] ? avMe[0].length : -1,
    // 媒体池展开：令牌是否仍解得出图、且拿到的是压缩后的新值（热缓存已同步）
    expandA: String(window.mochiMediaExpand('${TOK_A}') || '').slice(0, 22),
    expandALen: String(window.mochiMediaExpand('${TOK_A}') || '').length
  });
})()`) || '{}');
const cov = JSON.parse(await evalJs('window.mochiMediaCoverage().then(function(r){ return JSON.stringify(r); })') || '{}');
const gc = JSON.parse(await evalJs('window.mochiMediaGC().then(function(r){ return JSON.stringify(r); })') || '{}');

check('C2 媒体池条目「同键换值」：池值变小、库里的令牌一字未动',
  !!after && after.poolA > 0 && after.poolA < lens.pool * 0.9 &&
  after.pubTok === TOK_A && after.ownTok0 === TOK_B && after.ownTok1 === TOK_A,
  'pool ' + (lens && lens.pool) + '→' + (after && after.poolA) + ' 令牌=' + (after && after.pubTok));
check('C2b 令牌解析拿到的正是压缩后的新池值（不是旧大图、不是 null，热缓存已同步）',
  !!after && after.expandALen > 0 && after.expandALen === after.poolA && after.expandA.indexOf('data:image') === 0,
  'expand=' + (after && after.expandA) + ' len=' + (after && after.expandALen) + ' pool=' + (after && after.poolA));
check('C3 内联字卡图被替换且仍是合法图片（公用库 + 孤儿桌面库都写小了）',
  !!after && after.pubImg < lens.big * 0.9 && after.pubImgPrefix.indexOf('data:image') === 0 &&
  after.orphImg < lens.big * 0.9 && after.orphPrefix.indexOf('data:image') === 0,
  '公用 ' + (lens && lens.big) + '→' + (after && after.pubImg) + ' 孤儿 ' + (after && after.orphImg));
check('C4 头像库条目被压到 ≤256px（仍是合法图；小图原样保留、条目数不变）',
  !!after && after.av0 < lens.av * 0.9 && !!after.avSize && Math.max(after.avSize.w, after.avSize.h) <= 256 && after.avSize.fmt.indexOf('data:image') === 0 &&
  after.avMe > 0 && after.avMe < lens.av * 0.9 && after.av1Len === lens.avSm,
  '头像 ' + (lens && lens.av) + '→' + (after && after.av0) + ' 尺寸=' + JSON.stringify(after && after.avSize) + ' 小图 ' + (after && after.av1Len) + '/' + (lens && lens.avSm) + ' 我的池 ' + (after && after.avMe));
check('C5 媒体池完整性：替换后 Coverage 无缺失（missing=0）且令牌仍算「池内在」',
  cov.ok === true && (cov.missing || 0) === 0 && (cov.inPool || 0) >= 2,
  'referenced=' + cov.referenced + ' inPool=' + cov.inPool + ' missing=' + cov.missing + ' reason=' + (cov.reason || ''));
check('C6 媒体池 GC 不误删被字卡库引用的池条目（令牌仍在 cc-groups 里＝引用面认得）',
  gc.ok === true && (gc.orphans || []).indexOf('xy-home-v2:media:' + HASH_A) < 0 && (gc.orphans || []).indexOf('xy-home-v2:media:' + HASH_B) < 0,
  'poolN=' + gc.poolN + ' orphans=' + ((gc.orphans || []).length) + ' reason=' + (gc.reason || ''));
check('C7 池条目压缩后仍是合法图片且最长边 ≤720px（与聊天发图同标准，不额外降规格）',
  !!after && after.poolAPrefix.indexOf('data:image') === 0 && !!after.poolSize && Math.max(after.poolSize.w, after.poolSize.h) <= 720,
  '前缀=' + (after && after.poolAPrefix) + ' 尺寸=' + JSON.stringify(after && after.poolSize));

const errs = JSON.parse(await evalJs("(function(){ return JSON.stringify((window.__jsErrors||[]).slice(0,8)); })()") || '[]');
check('A1 全程无 JS 运行时错误', errs.length === 0, errs.join('|'));

const fail = results.filter((r) => !r.ok);
console.log('\n===== verify-img-compress-coverage: ' + (results.length - fail.length) + '/' + results.length + ' =====');
try { chrome.kill(); } catch (e) {}
server.close();
try { (await import('node:fs')).rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail.length ? 1 : 0);
