// ===== 专项验证 #660：媒体池令牌「读失败 ≠ 确认缺失」——朋友圈/聊天贴纸时有时无、很随机 =====
// 背景（用户报障，红米K70 Chrome，明说其他设备型号也有）：打开桌面【朋友圈】时照片上的贴纸
//   有时能看到、有时看不到，很随机。
// 根因（零机型/零内核分支）：贴纸来源是字卡库【表情包】，≥64KB 的大表情包经池视图令牌化后
//   在动态里存的就是 @@m:<hash> 令牌（#377/#455/#554），渲染时必须从媒体池读回真身。而
//   media-pool 的 resolveImg 把 idbGet 的 undefined 一律当成「确认缺失」：
//     ①已渲染的那张图不再重试、直接留成坏图；
//     ②mochiMediaTokenMissing 置位 → chatcard 的 isMediaImg 把该令牌字卡整条剔出
//       getMediaGroups('sticker') → 朋友圈「贴纸」面板里这张贴纸直接消失。
//   偏偏 undefined 有两种来源（idb.js）：键真不存在（onsuccess）与事务挂起超时/连接丢失
//   （本仓库记载多款安卓内核通病）——设备 IO 越慢越容易撞上 ⇒ 机型相关、会话随机，与用户
//   「其他设备型号也有」「很随机」完全吻合。
// 修复：#660a idbGet(key, info) 只增不改语义——读失败路径置 info.ambiguous=true；
//   #660 media-pool 只有「确认不存在」才拉黑，读失败走软占位（照常显示图片缺失占位、不发
//   无效请求）+ 有界重读自愈（不无限重试，防 #450 读槽饿死），成功即原位换回真图；
//   #660c 池引用面补 feed-posts(-snap)：只被朋友圈引用的令牌不再被「清理孤儿」当孤儿删掉。
// 用法：node tools/verify-media-ambig-read.mjs
//   RED 对照（修复前基线）：把修复前的 media-pool.js 存成临时文件后用
//     MOCHI_POOL_SRC=<该文件> node tools/verify-media-ambig-read.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createHash } from 'node:crypto';
import zlibMod from 'node:zlib';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function read(p) { return readFileSync(join(root, p), 'utf8'); }
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 240) + ']' : ''));
}

// ============ A 轴：源码级 ============
const idbSrc = read('src/js/idb.js');
const poolSrc = process.env.MOCHI_POOL_SRC ? readFileSync(process.env.MOCHI_POOL_SRC, 'utf8') : read('src/js/media-pool.js');

// A1 idbGet 接受可选 info 参数（返回值语义不变）
check('A1 idbGet 带可选 info 参数（window.idbGet = function (key, info)）',
  /window\.idbGet = function \(key, info\) \{/.test(idbSrc));
// A2 读失败路径（超时/连接丢失/打开失败）置歧义标记
check('A2 读失败路径置 info.ambiguous（含超时放弃与 open 失败）',
  (idbSrc.match(/amb\(\); finish\(undefined\);/g) || []).length >= 2 && /\.catch\(\(\) => \{ amb\(\); return undefined; \}\)/.test(idbSrc));
// A3 只有读失败置位：onsuccess（键不存在也走它）不得置位
check('A3 onsuccess 不带歧义标记（「键不存在」仍是确认缺失）',
  /req\.onsuccess = \(\) => finish\(req\.result\);/.test(idbSrc) && !/onsuccess[^\n]*amb\(\)/.test(idbSrc));
// A4 池侧三分支顺序：待落盘 → 读失败（软占位）→ 确认缺失（拉黑）
const iPending = poolSrc.indexOf('if (pending) {');
const iAmbig = poolSrc.indexOf('if (info.ambiguous) { softMissImg(img, h); return; }');
const iMissing = poolSrc.indexOf('missing.add(h); markMissing(h); return;');
check('A4 池侧按「待落盘 → 读失败软占位 → 确认缺失拉黑」三分支，读失败在拉黑之前',
  iPending > 0 && iAmbig > iPending && iMissing > iAmbig);
// A5 软占位的「同步段」不写 missing（贴纸/字卡列表不掉项的关键；重试回调里读到「确实没有」
//   才写 missing 是刻意保留的正确语义，故只断言 setTimeout 之前的同步段）
const softFn = /function softMissImg\(img, h\) \{[\s\S]*?\n  \}/.exec(poolSrc);
const softSync = softFn ? softFn[0].split('setTimeout(function () {')[0] : '';
check('A5 软占位同步段不写 missing（只登记占位 + 排重试）',
  !!softFn && !softSync.includes('missing.add') && softSync.includes('phImgs.set(h, set)'));
// A6 有界重试预算（防无限重试）
check('A6 读失败重试有界（SOFT_RETRY_MS 预算 + 用尽即停）',
  /const SOFT_RETRY_MS = \[[^\]]+\];/.test(poolSrc) && /if \(n >= SOFT_RETRY_MS\.length\) return;/.test(poolSrc));
// A9 确认缺失的占位真能落地（#660d：Array.prototype.slice.call(Set) 恒空数组＝占位从未生效）
check('A9 攒批占位用 Array.from(Set)（slice.call(Set) 恒空＝占位失效）',
  /const list = Array\.from\(markQueue\);/.test(poolSrc) && !/Array\.prototype\.slice\.call\(markQueue\)/.test(poolSrc));
// A7 池引用面含朋友圈两键（贴纸令牌不被当孤儿删）
const refsCount = (poolSrc.match(/feed-posts\(\?:-snap\)\?/g) || []).length;
check('A7 GC/Coverage 引用面含 feed-posts(-snap)（两处同口径）', refsCount === 2, 'refsCount=' + refsCount);

// A8 行为级：真实 idbGet 在「事务挂起 + 重开连接失败」时给出 ambiguous，而「键不存在」不给
{
  const stmt = /window\.idbGet = function \(key, info\) \{[\s\S]*?\n  \};/.exec(idbSrc)[0];
  const hangDb = { transaction() { return { objectStore() { return { get() { return {}; } }; } }; } };
  let openCalls = 0;
  const fakeOpen = () => { openCalls++; return openCalls === 1 ? Promise.resolve(hangDb) : Promise.reject(new Error('open 挂了')); };
  const mkGet = new Function('window', 'open', 'STORE', 'connLost',
    'let dbPromise = null;\n' + stmt + '\nreturn window.idbGet;');
  const idbGet = mkGet({}, fakeOpen, 'store', () => false);
  const t0 = Date.now();
  const infoHang = {};
  const hangVal = await idbGet('k', infoHang);
  const ms = Date.now() - t0;
  check('A8a 事务挂起（4s+重开失败）→ undefined 且 info.ambiguous=true',
    hangVal === undefined && infoHang.ambiguous === true, 'ms=' + ms);
  // 「键不存在」：onsuccess 拿到 undefined
  const missDb = { transaction() { return { objectStore() { return { get() { const r = {}; setTimeout(() => { r.onsuccess && r.onsuccess(); }, 0); return r; } }; } }; } };
  const idbGet2 = mkGet({}, () => Promise.resolve(missDb), 'store', () => false);
  const infoMiss = {};
  const missVal = await idbGet2('k', infoMiss);
  check('A8b 键不存在（onsuccess）→ undefined 且 info.ambiguous 未置位',
    missVal === undefined && infoMiss.ambiguous === undefined);
  // 不传 info 的既有调用方：行为与旧版一致（不抛错）
  const plain = await idbGet2('k');
  check('A8c 不传 info 的既有调用方零影响（仍 resolve undefined）', plain === undefined);
}

// A10 行为级 GC：只被朋友圈引用的池条目不得当孤儿（#660c）——vm 桩环境跑真实 mochiMediaGC
{
  const vm = await import('node:vm');
  const IMG = 'data:image/gif;base64,' + 'A'.repeat(200);   // GC 只认 data: 前缀，不需要真解码
  const m = new Map();
  const FULLK = 'xy-home-v2:media:';
  const hexA = createHash('sha256').update('feed-a', 'utf8').digest('hex').slice(0, 32);
  const hexZ = createHash('sha256').update('feed-orphan', 'utf8').digest('hex').slice(0, 32);
  m.set(FULLK + hexA, IMG);                                     // 只被朋友圈动态引用（贴纸令牌）
  m.set(FULLK + hexZ, IMG);                                     // 谁也不引用＝真孤儿
  m.set('xy-home-v2:default:feed-posts', JSON.stringify([{ id: 'p1', stickers: [{ src: '@@m:' + hexA }] }]));
  const sandbox = {
    console, crypto: globalThis.crypto, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class { observe() {} },
    document: { addEventListener() {}, readyState: 'complete', documentElement: {}, querySelectorAll: () => [] },
    localStorage: { length: 0, key: () => undefined, getItem: () => null },   // 沙箱必须给（GC 的 LS 引用面依赖它）
    idbListKeys: async () => Array.from(m.keys()),
    idbGet: async (k) => (m.has(k) ? m.get(k) : undefined),
    idbGetMany: async (ks) => { const o = {}; ks.forEach((k) => { if (m.has(k)) o[k] = m.get(k); }); return o; },
    idbSetAll: async (pairs) => { pairs.forEach((p) => m.set(p.k, p.v)); return true; },
    idbDelete: async (k) => m.delete(k),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(poolSrc, sandbox, { filename: 'media-pool.js' });
  const rep = await sandbox.mochiMediaGC();
  check('A10 GC 行为级：只被朋友圈动态引用的贴纸令牌不算孤儿（feed-posts 进引用面）',
    rep && rep.ok === true && rep.orphans.indexOf(FULLK + hexA) < 0 && rep.orphans.indexOf(FULLK + hexZ) >= 0,
    JSON.stringify({ ok: rep && rep.ok, orphans: rep && rep.orphans }));
}

// ============ B 轴：整机行为（自组装 src 页面）============
const buildSrc = read('build.mjs');
function arrOf(name) {
  const m = buildSrc.match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
  return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let css = '', js = '';
for (const f of cssFiles) { try { css += '/* ' + f + ' */\n' + read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of jsFiles) {
  try {
    // MOCHI_POOL_SRC：RED 对照用（喂修复前的 media-pool.js 副本）
    const body = (f === 'media-pool.js' && process.env.MOCHI_POOL_SRC) ? poolSrc : read('src/js/' + f);
    js += '/* ' + f + ' */\n' + body + '\n';
  } catch (e) {}
}
const tpl = read('src/template.html').replace(/__APP_VERSION__/g, 'test');
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + tpl +
  '<scr' + 'ipt>window.__APP_VERSION__="test";</scr' + 'ipt>' +
  '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';

// 夹具：两张**合法** PNG（脚本自造，避免非法 base64 让浏览器解码失败＝假红）
function pngOf(w, h, rgba) {
  const zlib = zlibMod;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) { const i = y * (w * 4 + 1) + 1 + x * 4; raw[i] = rgba[0]; raw[i + 1] = rgba[1]; raw[i + 2] = rgba[2]; raw[i + 3] = rgba[3]; }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'latin1');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return 'data:image/png;base64,' + Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const PNG = pngOf(1, 1, [255, 0, 0, 255]);
const PNG_B = pngOf(2, 2, [0, 200, 0, 255]);
const HASH = createHash('sha256').update(PNG, 'utf8').digest('hex').slice(0, 32);
const TOK = '@@m:' + HASH;
const HASH_B = createHash('sha256').update(PNG_B, 'utf8').digest('hex').slice(0, 32);
const TOK_B = '@@m:' + HASH_B;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const u = req.url.split('?')[0];
    const mode = (req.url.match(/[?&]mode=(\w+)/) || [])[1] || '';
    if (u === '/test.html') {
      // 池状态由 mode 决定：ok=池可读 / stall=读失败(undefined+ambiguous) / absent=确认缺失
      const boot = `<scr` + `ipt>(function(){
  var MODE = '${mode}';
  var store = {};
  var POOL = {};
  if (MODE !== 'absent') { POOL['xy-home-v2:media:${HASH}'] = '${PNG}'; POOL['xy-home-v2:media:${HASH_B}'] = '${PNG_B}'; }
  window.__mode = MODE;
  window.__poolReads = 0;
  window.__stall = (MODE === 'stall');
  function isMedia(k) { return String(k || '').indexOf(':media:') >= 0; }
  var gStub = function (k, info) {
    if (isMedia(k)) {
      window.__poolReads++;
      if (window.__stall) { if (info) info.ambiguous = true; return Promise.resolve(undefined); }
      return Promise.resolve(POOL[k]);
    }
    return Promise.resolve(store[k]);
  };
  var gmStub = function (keys) { var out = {}; (keys || []).forEach(function (k) { if (isMedia(k)) { window.__poolReads++; if (window.__stall) return; if (POOL[k] !== undefined) out[k] = POOL[k]; } else if (store[k] !== undefined) out[k] = store[k]; }); return Promise.resolve(out); };
  var sStub = function (k, v) { store[k] = v; return Promise.resolve(true); };
  var saStub = function (a) { (a || []).forEach(function (p) { if (p && p.k) store[p.k] = p.v; }); return Promise.resolve(true); };
  var dStub = function () { return Promise.resolve(true); };
  var lkStub = function () { return Promise.resolve(Object.keys(store).concat(Object.keys(POOL))); };
  function def(n, fn) { try { Object.defineProperty(window, n, { configurable: false, get: function () { return fn; }, set: function () {} }); } catch (e) {} }
  def('idbGet', gStub); def('idbGetMany', gmStub); def('idbSet', sStub); def('idbSetAll', saStub); def('idbDelete', dStub); def('idbListKeys', lkStub);
  try { if (navigator.serviceWorker) navigator.serviceWorker.register = function () { return Promise.resolve({ scope: '', addEventListener: function () {}, showNotification: function () { return Promise.resolve(); } }); }; } catch (e) {}
  var posts = [{ id: 'f_1700000000099_default', role: 'ta', owner: 'default', authorName: '小桃', taName: '小桃', content: '天空',
    imgs: ['${PNG}'], ts: Date.now() - 8000, likes: [], comments: [],
    stickers: [{ src: '${TOK}', x: 30, y: 40, ts: Date.now() - 7000, role: 'ta', owner: 'default', authorName: '小桃' },
               { src: '${TOK_B}', x: 70, y: 60, ts: Date.now() - 6000, role: 'ta', owner: 'default', authorName: '小桃' }] }];
  store['xy-home-v2:feed-posts'] = JSON.stringify(posts);
  try { localStorage.setItem('xy-home-v2:default:feed-posts-snap', JSON.stringify(posts)); } catch (e) {}
  store['xy-home-v2:default:cc-groups'] = JSON.stringify({ text: [], sticker: [['默认', ['${TOK}', '${TOK_B}']]], image: [], kaoamoji: [], emoji: [] });
  ['xy-home-v2:', 'xy-home-v2:default:'].forEach(function (pre) {
    localStorage.setItem(pre + 'reply-fd-comment-prob', '0');
    localStorage.setItem(pre + 'reply-fd-likeback-prob', '0');
    localStorage.setItem(pre + 'reply-fd-reply-prob', '0');
  });
})();</scr` + `ipt>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page.replace('</body>', boot + '</body>'));
      return;
    }
    let p = normalize(join(root, decodeURIComponent(u)));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); console.log('\n' + results.filter(r => r.ok).length + ' passed, ' + results.filter(r => !r.ok).length + ' failed（B 轴未跑）'); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(os.tmpdir(), 'mochi-ambig-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const excs = [];
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) {
        ws = new WebSocket(pg.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.method === 'Runtime.exceptionThrown') excs.push(JSON.stringify(m.params.exceptionDetails).slice(0, 200));
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Network.enable'); await cdp('Network.setBypassServiceWorker', { bypass: true }).catch(() => {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function boot(mode) {
  await cdp('Page.navigate', { url: baseUrl + '/test.html?mode=' + mode });
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1400);
  await evalJs(`document.querySelectorAll('.splash, .splash-notice, .splash-box').forEach(n => { n.classList.add('hide'); n.style.display = 'none'; }); true`);
  await sleep(200);
  await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
  await sleep(1300);
}
// 贴纸可选取性 / 照片上贴纸是否解出真图
const PROBE = `(function(){
  var listEl = document.getElementById('feed-list');
  var imgs = listEl ? Array.prototype.map.call(listEl.querySelectorAll('.feed-sticker img'), function (im) {
    var s = String(im.getAttribute('src') || '');
    return { tok: s.indexOf('@@m:') === 0, ok: s.indexOf('data:image/') === 0, nw: im.naturalWidth, missing: im.classList.contains('media-tok-missing') };
  }) : [];
  var inPool = false;
  try { inPool = (window.getMediaGroups('sticker') || []).some(function (g) { return (g[1] || []).indexOf('${TOK}') >= 0; }); } catch (e) {}
  return {
    spans: listEl ? listEl.querySelectorAll('.feed-sticker').length : -1,
    imgs: imgs, pickHasTok: inPool,
    tokMissing: window.mochiMediaTokenMissing ? window.mochiMediaTokenMissing('${TOK}') : 'no-api',
    tokMissingB: window.mochiMediaTokenMissing ? window.mochiMediaTokenMissing('${TOK_B}') : 'no-api',
    raw: listEl ? Array.prototype.map.call(listEl.querySelectorAll('.feed-sticker img'), function (im) { return String(im.getAttribute('src') || '').slice(0, 12); }) : [],
    poolReads: window.__poolReads
  };
})()`;

// B1 池正常：两张令牌贴纸都解出真图；贴纸面板含该令牌
await boot('ok');
let r = await evalJs(PROBE);
check('B1 池正常：照片上两张令牌贴纸都解出真图（naturalWidth>0）',
  r && r.spans === 2 && r.imgs.length === 2 && r.imgs.every(i => i.ok && i.nw > 0),
  JSON.stringify(r && r.imgs));
check('B1b 池正常：贴纸面板含该令牌（可选取入口不掉项）', r && r.pickHasTok === true);

// B2/B3 首屏池读失败（真实 idbGet 的歧义 undefined）→ 不拉黑、贴纸不掉项，池恢复后原位换回真图
await boot('stall');
let rStall = await evalJs(PROBE);
check('B2 读失败不拉黑：mochiMediaTokenMissing 仍为 false', rStall && rStall.tokMissing === false, JSON.stringify(rStall && rStall.tokMissing));
check('B2b 读失败不从贴纸面板剔项（getMediaGroups 仍含该令牌）', rStall && rStall.pickHasTok === true, JSON.stringify(rStall && { pick: rStall.pickHasTok, spans: rStall.spans }));
check('B2c 读失败时该图有软占位（不发无效请求，可见「图片缺失」）',
  rStall && rStall.imgs.length === 2 && rStall.imgs.every(i => i.missing === true),
  JSON.stringify(rStall && rStall.imgs));
// 记下占位节点引用：池恢复后必须由「同一个节点」换回真图（证明自愈而非重渲染换节点）
await evalJs(`window.__phImgs = Array.prototype.slice.call(document.querySelectorAll('.feed-sticker img')); true`);
await evalJs('window.__stall = false; true');   // 池恢复可读（设备卡顿结束）
await sleep(2600);                              // 首次软重试 1.2s
const heal = await evalJs(`(function(){
  return {
    sameNode: window.__phImgs.map(function (im) { return im.isConnected; }),
    srcs: window.__phImgs.map(function (im) { var s = String(im.getAttribute('src') || ''); return { ok: s.indexOf('data:image/') === 0, missing: im.classList.contains('media-tok-missing') }; }),
    probes: null,
    tokMissing: window.mochiMediaTokenMissing('${TOK}')
  };
})()`);
check('B3 池恢复后同一节点原位换回真图（软占位自愈，无需重渲染）',
  heal && heal.sameNode.every(Boolean) && heal.srcs.every(s => s.ok && !s.missing) && heal.tokMissing === false,
  JSON.stringify(heal));
let rAfter = await evalJs(PROBE);
check('B3b 自愈后照片上贴纸全部可见（naturalWidth>0）',
  rAfter && rAfter.imgs.length === 2 && rAfter.imgs.every(i => i.ok && i.nw > 0), JSON.stringify(rAfter && rAfter.imgs));

// B4 真缺失（键确实不在池里，非读失败）→ 维持旧行为：拉黑 + 从贴纸面板剔除（防过度修复）
await boot('absent');
let rAbs = await evalJs(PROBE);
check('B4 确认缺失仍按旧语义拉黑（mochiMediaTokenMissing=true）', rAbs && rAbs.tokMissing === true && rAbs.tokMissingB === true, JSON.stringify(rAbs));
check('B4c 确认缺失时打「图片缺失」占位、不再留令牌 src（不发 404 请求）#660d',
  rAbs && rAbs.imgs.length === 2 && rAbs.imgs.every(i => i.missing === true && i.tok === false && i.nw === 120),
  JSON.stringify(rAbs && rAbs.imgs));
check('B4b 确认缺失的令牌卡仍从贴纸面板剔出（无池数据设备不发白图卡）', rAbs && rAbs.pickHasTok === false, JSON.stringify(rAbs && { pick: rAbs.pickHasTok, spans: rAbs.spans }));

// B5 有界重试：读失败持续存在时不得无限重读（预算用尽即停）
await boot('stall');
const reads1 = await evalJs('window.__poolReads');
await sleep(16000);   // 覆盖 1.2s/4s/10s 三档重试预算
const reads2 = await evalJs('window.__poolReads');
check('B5 读失败重试有界（16s 内重读次数受限，不无限重试）',
  typeof reads1 === 'number' && typeof reads2 === 'number' && (reads2 - reads1) <= 12,
  'reads ' + reads1 + ' -> ' + reads2);
check('B6 全程零 JS 异常', excs.length === 0, excs.slice(0, 2).join(' | '));

await cdp('Browser.close').catch(() => {});
chrome.kill();
server.close();
const pass = results.filter(r => r.ok).length, fail = results.filter(r => !r.ok).length;
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
