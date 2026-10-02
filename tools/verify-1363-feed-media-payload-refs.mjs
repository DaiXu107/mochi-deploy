// ===== 常驻回归脚本 #1363：朋友圈的每一格图片载荷都必须先是可自愈引用（落盘一处闸），主键才许叫「小键」 =====
// 用法：node tools/verify-1363-feed-media-payload-refs.mjs [被测根目录]（或 SERVE_ROOT=…）
//
// 现场（用户 2026-09-28 直派：「OPPOfindx9／Edge，朋友圈发的表情包消失，剩下那个贴纸，梦角朋友圈消失了
//   几条发过的朋友圈」，并明说「这个问题其他设备型号也有出现」「不要覆盖修改导致不同型号设备浏览器的 bug
//   反复出现」；诊断单 mochi-diag-2026-09-28-06-19-52…docx：PLJ110／Android 16／Edge 153（Chromium 153）／
//   standalone PWA／该页被系统回收 56 次·断流 51 次／my-emoji-groups 33.95MB·媒体池 504 条／存储已用
//   142.7MB／整份零 JS 异常＝写坏不是读崩）：
//   #1257 只给「我发布配图」、#1219 只给「贴纸」接了媒体池令牌化，其余每一条写入口（TA 自动发动态的配图、
//   评论/回复贴图、外部模块 feedAddPost、以后新增的任何一条）一直把整张 dataURL 原样塞进主键。
//   纯产物无头真跑（本脚本 F 组：只让 TA 自己发 6 条带表情包 的动态）量出这条链：
//   ①主键 244,455B 越过 LS 大键线 200KB ⇒ xyStore.set 把 localStorage 那份副本主动剥掉（lsLen=null），
//     「同步层交得出整包」从此不成立（切后台当场 store.get=NULL，而 __big-idx 证人写着 283,268B＝库里好好的）；
//   ②唯一兜底那一层（剥图快照）就此成了屏幕的来源，而它里面 48 张表情包一张都不剩（1,117B 对 244,455B）
//     ＝用户所见「表情包消失、剩下那个贴纸」（配图栏被剥空就画 .feed-imgs-blank 那张底纸）；
//   ③这一发大值此后只靠一次异步 IDB 事务活着，而这台机每小时被系统回收数次＝#1257 记过的老账「未提交的
//     IDB 值事务随进程一起没了」；小键那一档则有 localStorage 同步落盘，回收碰不掉。
//
// 改法（零机型／零 UA 分支＝判据只取「这一格存的是巨型载荷还是内容寻址引用」一个事实）：不逐入口补（那正是
//   用户说的覆盖式修补，而且永远补不完），把纪律收到落盘这一处闸——feed.js 新增 feedNormalizeMediaPass
//   （chat.js mediaNormalizePass / #186 同款模具，已入库验证过）：整包扫一遍，凡 ≥1024 的图片载荷一律换成
//   44 字符的 @@m:hash 引用，主键恒为小键 ⇒ ①②③同时不再成立，#667「快照保留令牌」那条口径到这里才真正
//   吃满（快照与权威同形）。存量一并自愈。纪律照抄 #186：池确认落盘之后才让引用落库，写池失败整批回滚原件；
//   <1024 的载荷媒体池本就不收，保持内联＝原样，不更坏。只动内存真相层 feedMem（它只由 save() 与非降级的
//   feedMergeFromIdb 抬起来），所以这一闸永远不会拿残缺读数去改写权威键。
//
// 断言：F1~F5 夹具诚实 · A1~A8 本批新契约（红侧读数即症状本体）· B1~B7 旧契约不许动 · S1~S6 逻辑锚 · Z 零异常
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
console.log('serve root = ' + root);
if (!existsSync(join(root, 'index.html'))) {
  console.error('✗ 被测根目录没有 index.html（喂错目录了：所有断言会一起红，看起来像"修复没生效"）');
  process.exit(2);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + JSON.stringify(x).slice(0, 300) + ']' : '')); } };

const K_MAIN = 'xy-home-v2:feed-posts';
const HANG_FLAG = '__v1363hang';
const LS_BIG = 200 * 1024;

// 真实 PNG 卡（与评论贴图 compressCommentImg 同一形态），卡体落在 1024~4096：
//   ≥1024＝媒体池收得下（mochiMediaTokenize 那道闸门），<4096＝字卡库不会预先令牌化＝用户库里 表情包 的真实形态
const CARD_SRC = `
  window.__mkCards = function (n, target) {
    var cv = document.createElement('canvas'); cv.width = 96; cv.height = 96;
    var g = cv.getContext('2d'); var cards = [];
    for (var i = 0; i < n; i++) {
      for (var k = 0; k < 90; k++) {
        g.fillStyle = 'rgb(' + ((i * 37 + k * 7) % 256) + ',' + ((i * 91 + k * 13) % 256) + ',' + ((k * 29) % 256) + ')';
        g.fillRect((k * 13 + i) % 96, (k * 7 + i * 3) % 96, 8, 8);
      }
      var d = cv.toDataURL('image/png'); var guard = 0;
      while (d.length < target && guard++ < 400) { g.fillStyle = 'rgba(' + (guard % 200) + ',3,3,.5)'; g.fillRect(guard % 90, (guard * 7) % 88, 5, 5); d = cv.toDataURL('image/png'); }
      cards.push(d);
    }
    return cards;
  };`;

function initSrc(o) {
  return `(function(){
    // 库里那一发答不上来＝报障机同型条件（该页被系统回收 56 次、存储 142.7MB、IDB 挂起）。
    // 闸装在种子守卫之前＝reload 之后仍然挂着（用户口径的「重开朋友圈」正是下一场会话）
    (function () {
      var oGet = window.idbGet, oMany = window.idbGetMany;
      var on = function () { try { return localStorage.getItem('${HANG_FLAG}') === '1'; } catch (e) { return false; } };
      var hit = function (k) { return on() && String(k || '').indexOf('feed-posts') >= 0; };
      window.idbGet = function (k) { if (hit(k)) return new Promise(function () {}); return oGet.apply(this, arguments); };
      window.idbGetMany = function (ks) {
        var arr = (ks || []).map(String);
        if (on() && arr.some(function (k) { return k.indexOf('feed-posts') >= 0; })) return Promise.resolve({});
        return oMany ? oMany.apply(this, arguments) : Promise.resolve({});
      };
    })();
    window.__hangOn = function (v) { try { if (v) localStorage.setItem('${HANG_FLAG}', '1'); else localStorage.removeItem('${HANG_FLAG}'); } catch (e) {} };
    if (localStorage.getItem('__v1363seed') === '1') return;
    try { localStorage.clear(); } catch (e) {}
    localStorage.setItem('__v1363seed', '1');
    ${CARD_SRC}
    try { Object.defineProperty(window, 'nightModeActive', { configurable: true, get: function(){ return function(){ return false; }; }, set: function(){} }); } catch (e) {}
    var oST = window.setTimeout, oSI = window.setInterval;
    window.setTimeout = function (f, d) { return oST(f, (d >= 120000 && d <= 300000) ? 1200 : d); };
    window.setInterval = function (f, d) { return oSI(f, d === 60000 ? 2000 : d); };
    var hv = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return hv ? 'hidden' : 'visible'; } });
    Object.defineProperty(document, 'hidden', { configurable: true, get: function(){ return hv; } });
    window.__bg = function (v) { hv = !!v; document.dispatchEvent(new Event('visibilitychange')); };
    window.__cards = window.__mkCards(12, 3000);
    window.__small = 'data:image/png;base64,' + 'QUJD'.repeat(120);   // 502B＜1024＝媒体池不收，保持内联
    window.__fd = function (k, v) { localStorage.setItem('xy-home-v2:default:reply-' + k, String(v)); };
    window.__sched = function () { var st = window.storeFor('default'); st.set('feed-last', '0'); st.set('feed-next', '0'); st.set('feed-day-count', '0'); };
    window.__hush = function () { var st = window.storeFor('default'); st.set('reply-fd-post-en', '0'); st.set('feed-next', '600'); };
    ${o.setup || ''}
  })()`;
}

const SETUP_TA = `
    localStorage.setItem(${JSON.stringify(K_MAIN)}, '[]');
    var grp = { text: [['t', ['嘿', '好呀']]], kaomoji: [], emoji: [['e', ['😂']]], sticker: [['我的表情包', window.__cards]], image: [], poke: [], voice: [] };
    localStorage.setItem('xy-home-v2:cc-groups-public', JSON.stringify(grp));
    window.__fd('fd-post-en', 1); window.__fd('fd-post-prob', 100); window.__fd('fd-post-daily-max', 99);
    window.__fd('fd-min-interval', 0); window.__fd('fd-max-interval', 0);
    window.__fd('fd-post-sticker', 100); window.__fd('fd-post-image', 0);
    window.__fd('fd-min-cards-post', 8); window.__fd('fd-max-cards-post', 8);
    window.__fd('fd-post-kaomoji', 0); window.__fd('fd-post-emoji', 0);
`;

const PROBE = `(function(){
  var s = null; try { s = window.xyStore('xy-home-v2').get('feed-posts'); } catch (e) { s = 'ERR'; }
  var arr = []; try { arr = JSON.parse((s === null || s === 'ERR') ? '[]' : s); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  var RE_RAW = /data:image\\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*)?,[^\\s"'<>]+/g;
  var RE_TOK = /@@m:[0-9a-f]{32}/g;
  function bigN(strs) { var n = 0; (strs || []).forEach(function (x) { var t = String(x == null ? '' : x); if (t.indexOf('data:image') === 0 && t.length >= 1024) n++; }); return n; }
  var o = { storeNull: s === null, keyLen: (typeof s === 'string' ? s.length : -1), posts: arr.length, taPosts: 0, rawImgs: 0, tokImgs: 0, rawStk: 0, tokStk: 0, rawCmt: 0, tokCmt: 0, shortRaw: 0 };
  function scanStr(str) {
    var t = String(str == null ? '' : str), m;
    var r1 = new RegExp(RE_RAW.source, 'g');
    while ((m = r1.exec(t))) { if (m[0].length >= 1024) o.rawCmt++; else o.shortRaw++; }
    var r2 = new RegExp(RE_TOK.source, 'g');
    while ((m = r2.exec(t))) o.tokCmt++;
  }
  arr.forEach(function (p) {
    if (!p || typeof p !== 'object') return;
    if ((p.role || p.by) === 'ta') o.taPosts++;
    o.rawImgs += bigN(p.imgs);
    (p.imgs || []).forEach(function (u) { var t = String(u == null ? '' : u); if (t.indexOf('data:image') === 0 && t.length < 1024) o.shortRaw++; });
    o.tokImgs += (p.imgs || []).filter(function (u) { return /^@@m:[0-9a-f]{32}$/.test(String(u)); }).length;
    o.rawStk += bigN((p.stickers || []).map(function (k) { return k && k.src; }));
    o.tokStk += (p.stickers || []).filter(function (k) { return /^@@m:[0-9a-f]{32}$/.test(String(k && k.src)); }).length;
    scanStr(p.content);
    (p.comments || []).forEach(function (c) { scanStr(c && c.content); ((c && c.replies) || []).forEach(function (r) { scanStr(r && r.content); }); });
  });
  var ls = null; try { ls = localStorage.getItem('xy-home-v2:feed-posts'); } catch (e) {}
  o.lsLen = ls === null ? null : ls.length;
  var sn = null; try { sn = localStorage.getItem('xy-home-v2:default:feed-posts-snap'); } catch (e) {}
  o.snapN = -3; o.snapLen = sn === null ? null : sn.length; o.snapImgTok = 0; o.snapImgRaw = 0;
  try {
    var sa = JSON.parse(sn || '[]'); o.snapN = sa.length;
    sa.forEach(function (p) {
      o.snapImgTok += (p.imgs || []).filter(function (u) { return /^@@m:[0-9a-f]{32}$/.test(String(u)); }).length;
      o.snapImgRaw += bigN(p.imgs);
      o.snapImgTok += (p.stickers || []).filter(function (k) { return /^@@m:[0-9a-f]{32}$/.test(String(k && k.src)); }).length;
      o.snapImgRaw += bigN((p.stickers || []).map(function (k) { return k && k.src; }));
    });
  } catch (e) {}
  try { o.bigIdx = window.idbBigIdxSize ? window.idbBigIdxSize('feed-posts') : 'no-api'; } catch (e) { o.bigIdx = 'ERR'; }
  o.domPosts = document.querySelectorAll('#feed-list .feed-post').length;
  var im = Array.prototype.slice.call(document.querySelectorAll('#feed-list .feed-imgs img'));
  o.domImgN = im.length;
  o.domImgData = im.filter(function (i) { return /^data:image/.test(i.getAttribute('src') || ''); }).length;
  o.domTokUnresolved = im.filter(function (i) { return /^@@m:/.test(i.getAttribute('src') || ''); }).length;
  o.domMissing = im.filter(function (i) { return i.classList.contains('media-tok-missing'); }).length;
  o.domBlank = document.querySelectorAll('#feed-list .feed-imgs-blank').length;
  o.empty = !!document.querySelector('#feed-list .ta-empty');
  o.mark = { n: 0, raw: 0, tok: 0 };
  arr.forEach(function (p) {
    var xs = (p.comments || []).concat((p.comments || []).reduce(function (x, c) { return x.concat((c && c.replies) || []); }, []));
    xs.forEach(function (c) {
      var t = String((c || {}).content || '');
      if (t.indexOf('ZZ1363B') < 0) return;
      o.mark.n++;
      var m, r1 = new RegExp(RE_RAW.source, 'g');
      while ((m = r1.exec(t))) { if (m[0].length >= 1024) o.mark.raw++; }
      var r2 = new RegExp(RE_TOK.source, 'g');
      while ((m = r2.exec(t))) o.mark.tok++;
    });
  });
  return o;
})()`;

const rawIdb = (page, key) => page.evaluate(k => new Promise(res => {
  let rq; try { rq = indexedDB.open('mochi-db', 1); } catch (e) { return res('ERR'); }
  rq.onsuccess = () => {
    try {
      const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get(k);
      g.onsuccess = () => res(g.result === undefined ? null : g.result);
      g.onerror = () => res('ERR');
    } catch (e) { res('ERR'); }
  };
  rq.onerror = () => res('OPENERR');
}), key);
const countIn = raw => {
  let a = []; try { a = JSON.parse(typeof raw === 'string' ? raw : '[]'); } catch (e) { }
  if (!Array.isArray(a)) a = [];
  let rawN = 0, tokN = 0;
  const tally = s => { s = String(s == null ? '' : s); if (s.indexOf('data:image') === 0 && s.length >= 1024) rawN++; else if (/^@@m:[0-9a-f]{32}$/.test(s)) tokN++; };
  const tallyStr = s => {
    s = String(s == null ? '' : s);
    (s.match(/data:image\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]*)?,[^\s"'<>]+/g) || []).forEach(x => { if (x.length >= 1024) rawN++; });
    (s.match(/@@m:[0-9a-f]{32}/g) || []).forEach(() => tokN++);
  };
  a.forEach(p => {
    (p.imgs || []).forEach(tally);
    (p.stickers || []).forEach(k => tally(k && k.src));
    tallyStr(p.content);
    (p.comments || []).forEach(c => { tallyStr(c && c.content); ((c && c.replies) || []).forEach(r => tallyStr(r && r.content)); });
  });
  return { n: a.length, raw: rawN, tok: tokN, len: typeof raw === 'string' ? raw.length : -1 };
};
const enter = async (page) => {
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 40000 }).catch(() => { });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('.splash,.splash-notice,.splash-box,.backup-remind-bar,.ver-update-bar').forEach(n => { n.classList.add('hide'); n.style.display = 'none'; });
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
  });
  await page.waitForTimeout(800);
};
const openFeed = page => page.evaluate(() => { const el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; });
const probe = page => page.evaluate(PROBE);
// 让 TA 真发若干条：只把调度键复位（＝跳过发帖冷却），产品一行逻辑不动
async function taPost(page, want) {
  for (let i = 0; i < 18; i++) {
    await page.evaluate(() => window.__sched());
    await page.waitForTimeout(2100);
    const p = await probe(page);
    if (p.posts >= want) return p;
  }
  return probe(page);
}

const browser = await chromium.launch({ headless: true });
const errs = [];
async function session(o) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 751 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 160)));
  await ctx.addInitScript({ content: initSrc(o) });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(page);
  return { ctx, page };
}

console.log('\n— 主场景：只让 TA 自己发 6 条带表情包 的动态（报障机同型，全程真跑产物）—');
{
  const { ctx, page } = await session({ setup: SETUP_TA });
  const cards = await page.evaluate(() => window.__cards.map(c => c.length).slice(0, 3).join(',') + '|min=' + Math.min.apply(null, window.__cards.map(c => c.length)) + '|max=' + Math.max.apply(null, window.__cards.map(c => c.length)));
  const lensOk = await page.evaluate(() => window.__cards.every(c => c.length >= 1024 && c.indexOf('data:image/') === 0));
  ok(lensOk, 'F1 夹具诚实：表情包卡体全部 ≥1024（媒体池收得下）且是真实 PNG dataURL（' + cards + '）', { lensOk, cards });
  await openFeed(page); await page.waitForTimeout(1500);
  const a0 = await probe(page);
  ok(a0.lsLen !== null && a0.lsLen === a0.keyLen, 'F2 夹具诚实：起手主键在小键档、localStorage 那份副本在（' + a0.lsLen + 'B）', a0);

  const a = await taPost(page, 6);
  await page.waitForTimeout(7000);   // 等这一处闸跑完一轮（1.5s 去抖＋≥2.5s 合并写窗口）再取读数
  const aSet = await probe(page);
  ok(aSet.taPosts >= 6 && (aSet.rawImgs + aSet.tokImgs) >= aSet.taPosts * 6, 'F3 夹具诚实：TA 自动发动态真跑起来了，配图一格不落地进了主键（动态 ' + aSet.taPosts + ' 条·配图 ' + (aSet.rawImgs + aSet.tokImgs) + ' 张）', aSet);
  ok(aSet.rawImgs === 0 && aSet.tokImgs > 0, 'A1 落库的配图是内容寻址引用，不是巨型载荷（tok=' + aSet.tokImgs + ' raw=' + aSet.rawImgs + '；缺陷侧 6 条＝48 张原样 dataURL、0 张引用）', aSet);
  const ci = countIn(await rawIdb(page, K_MAIN));
  ok(ci.raw === 0 && ci.tok > 0, 'A1b 库里那一格同形：IDB 权威值里 0 张巨型载荷、' + ci.tok + ' 张引用（缺陷侧 idbRaw=' + ci.raw + '）', ci);
  ok(aSet.lsLen !== null && aSet.keyLen < LS_BIG, 'A4 发过 6 条带表情包 的动态之后主键仍在小键档＝同步层永远交得出整包（' + aSet.keyLen + 'B，LS=' + aSet.lsLen + 'B；缺陷侧 244,455B 越线、LS 副本被剥成 null）', aSet);
  const authImgs = aSet.rawImgs + aSet.tokImgs + aSet.rawStk + aSet.tokStk;
  ok(aSet.snapImgTok + aSet.snapImgRaw === authImgs && aSet.snapImgRaw === 0 && aSet.snapN >= aSet.posts, 'A5 兜底那层与权威同形：快照带着全部配图引用、一条不少（快照图=' + (aSet.snapImgTok + aSet.snapImgRaw) + '/' + authImgs + ' 快照条数=' + aSet.snapN + '/' + aSet.posts + '；缺陷侧快照 1,117B 里 48 张图一张没有＝「表情包消失、剩下那个贴纸」的载体）', aSet);

  await page.evaluate(() => window.__hush());
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__bg(true)); await page.waitForTimeout(900);
  const cold = await probe(page);
  await page.evaluate(() => window.__bg(false)); await page.waitForTimeout(1200);
  ok(cold.storeNull === false, 'A6 切后台放掉内存副本之后，同步层照旧交出整包（storeNull=' + cold.storeNull + ' LS=' + cold.lsLen + 'B；缺陷侧 NULL＝唯一来源只剩那份有损快照）', cold);
  // 症状本体那一发：库里那一发挂起来（＝那台机 IDB 慢/挂起的常态），切回来之后重进朋友圈强制重画——
  // 屏幕上还有没有图，全看「同步层那一份」是不是完整的
  await page.evaluate(() => window.__hangOn(true));
  await page.evaluate(() => window.__bg(true)); await page.waitForTimeout(900);
  await page.evaluate(() => window.__bg(false)); await page.waitForTimeout(1500);
  const reRender = async () => {
    await page.evaluate(() => { const c = document.querySelector('.app[data-app="chat"]'); if (c) c.click(); });
    await page.waitForTimeout(700);
    await openFeed(page);
    await page.waitForTimeout(2600);
    return probe(page);
  };
  const c2 = await reRender();
  const idbC2 = countIn(await rawIdb(page, K_MAIN));
  ok(c2.lsLen !== null && c2.storeNull === false, 'A6b 库里那一发挂起时，localStorage 那份完整副本照样交得出来（LS=' + c2.lsLen + 'B storeNull=' + c2.storeNull + '；缺陷侧两样都没有＝屏幕只能拿有损快照顶）', c2);
  ok(c2.domImgData > 0 && c2.domPosts >= c2.posts && c2.posts >= idbC2.n, 'A6c 同一场里重进朋友圈：配图照旧在屏上、条数不比别人少（屏上图=' + c2.domImgData + ' 屏上条数=' + c2.domPosts + '/' + c2.posts + ' 库里=' + idbC2.n + '；缺陷侧正是「屏上 0 图、只剩底纸」＝用户所见「表情包消失、剩下那个贴纸」）', { c2, idbC2 });
  ok(c2.domMissing === 0 && c2.domTokUnresolved === 0, 'A8 引用全部解得回真图：屏上没有一格停在「图片缺失」占位、也没有一格还挂着没解开的令牌（缺失=' + c2.domMissing + ' 未解=' + c2.domTokUnresolved + '＝池没落盘就换引用的后果）', c2);
  await page.evaluate(() => window.__hangOn(false));
  // 下一场会话（＝那台机每小时都在发生的那一发回收/重开）
  await page.evaluate(() => window.__hangOn(true));
  await page.reload({ waitUntil: 'load' });
  await enter(page);
  await openFeed(page); await page.waitForTimeout(3500);
  const b = await probe(page);
  const idbB = countIn(await rawIdb(page, K_MAIN));
  ok(b.lsLen !== null && b.storeNull === false && b.domImgData > 0 && b.posts >= idbB.n, 'A6e 重开一场（那台机每小时都在发生的那一发）：localStorage 那份完整副本直接顶上屏，配图与条数都不欠（LS=' + b.lsLen + 'B 屏上图=' + b.domImgData + ' 条数=' + b.posts + '/' + idbB.n + '；缺陷侧 LS 无副本＝只能拿有损快照顶屏）', { b, idbB });
  await page.evaluate(() => window.__hangOn(false));
  await page.close(); await ctx.close();
}

console.log('\n— 评论贴图 / 外部发帖入口：同一道闸覆盖，不逐入口补 —');
{
  const { ctx, page } = await session({ setup: SETUP_TA });
  await openFeed(page); await page.waitForTimeout(1200);
  const seed = await page.evaluate(() => window.feedAddPost('外部入口带图 ZZ1363A', window.__cards.slice(0, 3)));
  await page.waitForTimeout(4500);
  const p1 = await probe(page);
  ok(typeof seed === 'string' && p1.rawImgs === 0 && p1.tokImgs >= 3, 'A3 外部模块 feedAddPost 发的图同样落成引用（tok=' + p1.tokImgs + ' raw=' + p1.rawImgs + '；缺陷侧 3 张原样 dataURL）', p1);

  // 真点：评论区打开 → 点「图片」触发系统选图（Playwright 接住 filechooser）→ compressCommentImg → 预览 → 发送
  await page.evaluate(() => { const btn = document.querySelector('#feed-list .feed-post .feed-act[data-comment]'); if (btn) btn.click(); });
  await page.waitForTimeout(800);
  const bigPng = await page.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 300;
    const g = cv.getContext('2d');
    for (let k = 0; k < 300; k++) { g.fillStyle = 'rgb(' + (k * 7 % 256) + ',' + (k * 13 % 256) + ',' + (k * 29 % 256) + ')'; g.fillRect(k % 300, (k * 3) % 300, 6, 6); }
    return cv.toDataURL('image/png');
  });
  const buf = Buffer.from(bigPng.split(',')[1], 'base64');
  // 真走入口：点评论条的「图片」＝mochiFilePick 建常驻 file input（#mochi-com-img-pick）并登记管线，
  // 再往那枚真 input 喂一张图 → onchange → FileReader → compressCommentImg(240px) → comImgData → 发送
  const mk = await page.evaluate(() => {
    const btn = document.getElementById('feed-comment-img');
    if (!btn) return 'no-btn';
    btn.click();
    return document.getElementById('mochi-com-img-pick') ? 'input-created' : 'input-missing';
  });
  let pick = mk;
  if (mk === 'input-created') {
    try {
      await page.setInputFiles('#mochi-com-img-pick', [{ name: 'v1363.png', mimeType: 'image/png', buffer: buf }]);
      pick = 'ok:' + buf.length + 'B';
    } catch (e) { pick = 'ERR:' + String(e.message || e).slice(0, 70); }
  }
  let pv = { pv: 0 };
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(700);
    pv = await page.evaluate(() => ({ pv: document.querySelectorAll('#feed-comment-pv img').length }));
    if (pv.pv >= 1) break;
  }
  const sent = await page.evaluate(() => {
    const inp = document.getElementById('feed-comment-input');
    const typed = '带图评论 ZZ1363B';
    if (inp) { inp.value = typed; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    const sb = document.getElementById('feed-comment-send');
    if (sb) sb.click();
    return { sent: !!sb, val: typed };
  });
  await page.waitForTimeout(9000);
  const p2 = await probe(page);
  ok(pick.indexOf('ok:') === 0 && pv.pv >= 1 && sent.sent && sent.val.indexOf('ZZ1363B') >= 0, 'F4 夹具诚实：评论贴图真走入口（选文件→压缩→预览 ' + pv.pv + ' 张→发送）不是手搓数据', { pick, pv, sent });
  ok(p2.mark.n >= 1 && (p2.mark.raw + p2.mark.tok) >= 1, 'F4b 夹具诚实：那一条标记评论里确实带着一份图片载荷（raw=' + p2.mark.raw + ' tok=' + p2.mark.tok + '）＝A2 不是空转', p2.mark);
  ok(p2.mark.raw === 0 && p2.mark.tok >= 1, 'A2 评论/回复里的贴图同样落成引用（那条标记评论：tok=' + p2.mark.tok + ' raw=' + p2.mark.raw + '；缺陷侧一次贴图＝几十 KB 原样进主键，正是把它顶过 200KB 的主力）', p2.mark);
  await page.close(); await ctx.close();
}

console.log('\n— 存量自愈（老动态里原样存着的载荷，下一轮落盘即换成引用）—');
{
  const setupOld = `(function(){
    var posts = [0,1,2,3].map(function(i){
      var c = window.__cards[i];
      return { id: 'old_' + i, role: 'ta', owner: 'default', authorName: '小桃', taName: '小桃', authorAv: '', taAv: '',
        content: '老的一条 ' + i + ' ' + c, imgs: [c], stickers: [{ src: c, emoji: '', x: 20, y: 30, ts: 1700000000000 + i, role: 'me', owner: 'me', authorName: '我' }],
        comments: [{ role: 'me', owner: 'me', authorName: '我', ts: 1700000009000 + i, content: '老的评论带图 ZZ1363B ' + c, replies: [{ role: 'ta', owner: 'default', authorName: '小桃', ts: 1700000019000 + i, content: '老的回复带图 ' + c, replies: [] }] }],
        likes: [], ts: Date.now() - i * 60000 };
    });
    var raw = JSON.stringify(posts);
    localStorage.setItem(${JSON.stringify(K_MAIN)}, raw);
    window.__seed0 = { n: posts.length, raw: (raw.match(/data:image\\//g) || []).length, len: raw.length };
    window.__fd('fd-post-en', 0);
  })()`;
  const { ctx, page } = await session({ setup: setupOld });
  const seed0 = await page.evaluate(() => window.__seed0 || { n: 0, raw: 0, len: 0 });
  ok(seed0.n === 4 && seed0.raw >= 12, 'F5 夹具诚实：种进去的存量每一格都存着原样巨型载荷（4 条·配图/贴纸/正文/评论/回复共 ' + seed0.raw + ' 张·' + seed0.len + 'B）', seed0);
  await openFeed(page); await page.waitForTimeout(7000);
  const s1 = await probe(page);
  ok(s1.rawImgs === 0 && s1.tokImgs >= 4 && s1.posts === 4 && s1.rawStk === 0 && s1.tokStk >= 4 && s1.rawCmt === 0 && s1.tokCmt >= 8, 'A7 自愈覆盖每一格：配图／贴纸／正文内联／评论与回复内联全部换成引用，条数一条不少（图引用=' + s1.tokImgs + ' 贴纸引用=' + s1.tokStk + ' 文字内联引用=' + s1.tokCmt + ' 残留巨型=' + (s1.rawImgs + s1.rawStk + s1.rawCmt) + ' 条数=' + s1.posts + '）', s1);
  const idbS = countIn(await rawIdb(page, K_MAIN));
  ok(idbS.raw === 0 && idbS.n === 4, 'A7b 库里那一格也换成引用且一条没丢（' + JSON.stringify(idbS) + '）', idbS);
  const domOk = await page.evaluate(() => { const im = Array.prototype.slice.call(document.querySelectorAll('#feed-list .feed-imgs img')); return { n: im.length, data: im.filter(i => /^data:image/.test(i.getAttribute('src') || '')).length, miss: im.filter(i => i.classList.contains('media-tok-missing')).length }; });
  ok(domOk.data > 0 && domOk.miss === 0, 'A7c 自愈之后屏幕上还是真图（解析回 data: 的 ' + domOk.data + '/' + domOk.n + '，缺失占位 ' + domOk.miss + '）', domOk);
  await page.close(); await ctx.close();
}

console.log('\n— 旧契约（#1257/#1219/#1336/#187/#186 领地一字不许动）—');
{
  // B1 写池失败那一发＝整批退回内联（#186 那条顺序纪律），绝不出现「令牌先进库、图体只在内存」
  const { ctx, page } = await session({ setup: SETUP_TA });
  await page.evaluate(() => { window.idbSetAll = function () { return Promise.resolve(false); }; });
  await taPost(page, 4);
  await page.waitForTimeout(10000);
  const b1 = await probe(page);
  ok(b1.rawImgs > 0 && b1.posts >= 4 && b1.domMissing === 0, 'B1 池写不进时整批保持内联原件（raw=' + b1.rawImgs + ' 条数=' + b1.posts + '）＝不更坏，屏上没有一格因此变缺失（缺失=' + b1.domMissing + '）', b1);
  await page.close(); await ctx.close();
}
{
  // B2 小于 1024 的载荷：媒体池本就不收，保持内联（不硬塞、不判缺失）
  const setupB2 = `
    localStorage.setItem(${JSON.stringify(K_MAIN)}, JSON.stringify([{ id: 'tiny_1', role: 'me', owner: 'me', authorName: '我', authorAv: '', taName: '小桃', taAv: '', content: '小图一条 ZZ1363T', imgs: [window.__small], stickers: [], comments: [], likes: [], ts: Date.now() }]));
    window.__fd('fd-post-en', 0);
  `;
  const { ctx, page } = await session({ setup: setupB2 });
  await openFeed(page); await page.waitForTimeout(9000);
  const b2 = await probe(page);
  ok(b2.shortRaw === 1 && b2.rawImgs === 0 && b2.tokImgs === 0 && b2.domMissing === 0 && b2.posts === 1, 'B2 小于 1024 的载荷保持内联（池不收＝原样）内联小图=' + b2.shortRaw + ' 被吞=' + b2.rawImgs + ' 引用=' + b2.tokImgs + ' 缺失=' + b2.domMissing, b2);
  await page.close(); await ctx.close();
}
{
  // B3~B7：小键档链路照常（#496/#667）、残缺闸照旧拦得住（#1336）、快照预算照旧
  const { ctx, page } = await session({ setup: SETUP_TA });
  await openFeed(page);
  const a = await taPost(page, 4);
  await page.waitForTimeout(4500);
  const liked = await page.evaluate(() => { const btn = document.querySelector('#feed-list .feed-post .feed-act[data-like]'); if (!btn) return 'no-btn'; btn.click(); return 'clicked'; });
  await page.waitForTimeout(5000);
  const idbC = countIn(await rawIdb(page, K_MAIN));
  const c3 = await probe(page);
  ok(liked === 'clicked' && idbC.n >= 4 && c3.lsLen !== null && c3.lsLen === c3.keyLen, 'B3 一次普通点赞照常落库、主键的 LS 副本与权威同尺寸（库里 ' + idbC.n + ' 条·LS=' + c3.lsLen + 'B key=' + c3.keyLen + 'B）', { liked, idbC, ls: c3.lsLen, key: c3.keyLen });
  await page.evaluate(() => window.__hush());
  await page.waitForTimeout(6000);
  const before0 = countIn(await rawIdb(page, K_MAIN));
  await page.evaluate(() => window.__hangOn(true));
  await page.evaluate(() => window.__bg(true)); await page.waitForTimeout(900);
  await page.evaluate(() => window.__bg(false)); await page.waitForTimeout(1200);
  await page.evaluate(() => { const btn = document.querySelector('#feed-list .feed-post .feed-act[data-like]'); if (btn) btn.click(); });
  await page.waitForTimeout(7000);
  const afterCold = countIn(await rawIdb(page, K_MAIN));
  await page.evaluate(() => window.__hangOn(false));
  ok(afterCold.n >= before0.n && (afterCold.raw + afterCold.tok) >= (before0.raw + before0.tok), 'B7 库里那一发挂起时来一次点赞，库里条数与图引用一条不少（' + before0.n + '→' + afterCold.n + '·图 ' + (before0.raw + before0.tok) + '→' + (afterCold.raw + afterCold.tok) + '＝#1336 的残缺闸没被本批新增的写点绕开）', { before0, afterCold });
  const c5 = await probe(page);
  ok(c5.snapLen !== null && c5.snapLen <= LS_BIG, 'B5 剥图快照仍在 200KB 预算以内、照旧写得出（snapLen=' + c5.snapLen + 'B）', c5);
  await page.close(); await ctx.close();
}

console.log('\n— 逻辑锚（防「名字留着、逻辑被改坏」）—');
{
  const src = readFileSync(join(root, 'src/js/feed.js'), 'utf8');
  const prod = readFileSync(join(root, 'js/feed.js'), 'utf8');
  ok(/async function feedNormalizeMediaPass\(\)/.test(src), 'S1 一处闸在（feedNormalizeMediaPass）');
  ok(/if \(!changed\) return;[\s\S]{0,120}const okPool = await window\.mochiMediaFlush\(\);/.test(src), 'S2 池先落盘、引用后落库（#186 顺序没反）');
  ok(/_feedTokSig\.delete\(touched\[r\]\)/.test(src) && /scheduleFeedTokPass\(8000\)/.test(src), 'S3 写池失败整批回滚＋抹掉形状签名好重试（不是半套令牌进库）');
  ok(/if \(!feedMem \|\| feedMem\.length === 0\) \{ scheduleFeedTokPass\(6000\); return; \}/.test(src), 'S4 只认内存真相：手上没有整包就什么也不做（不旁路 #1336 那条自带整列表重绘的自愈链，也绝不拿残缺读数改写＝#667/#1336 口径）');
  ok(/if \(!_feedTokInPass\) scheduleFeedTokPass\(\);/.test(src) && /if \(!degraded\) scheduleFeedTokPass\(2500\);/.test(src), 'S5 每一写入口与启动合并都过同一道闸（不逐入口补）');
  ok(/if \(feedMem !== list\) \{ scheduleFeedTokPass\(1500\); return; \}/.test(src), 'S7 整包在飞期间易主＝本轮作废（绝不拿旧数组写回顶掉刚落下的那一格）');
  ok(prod.indexOf('feedNormalizeMediaPass') > 0 && prod.indexOf('scheduleFeedTokPass') > 0, 'S6 产物已接入本批（js/feed.js 内可见）');
}

console.log('\n结果：通过 ' + pass + ' · 失败 ' + fail + ' · 未捕获异常 ' + errs.length);
errs.slice(0, 8).forEach(e => console.log('  ! ' + e));
await browser.close(); server.close();
process.exit(fail > 0 || errs.length > 0 ? 1 : 0);
