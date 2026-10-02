// ===== 专项回归：朋友圈贴一张贴纸，凭什么把配图弄没了（#1219，v8.45） =====
// 用法：node tools/verify-1219-feed-sticker-snap.mjs [被测根目录]
//   首行打印被测根目录；同尺 A/B 分别指向「含本批的副本」与「纯 HEAD 副本」。
// 用户实报（vivo X200s / Edge，多机型同报）：朋友圈用了「贴纸」把贴纸贴在配图上，那张配图就
//   消失、只剩贴纸；新发的与旧发的动态都一样。
// 现场读数（纯 HEAD 产物、本脚本与探针同一把尺子量出来的事实）：
//   · 一张图片贴纸的 src 是一整串 dataURL；连贴 3 张 ⇒ 权威键 feed-posts 从 316 字符涨到
//     240,672 > LS_BIG_LIMIT(204,800) ⇒ idb.js xyStore.set 走大键分支把 localStorage 副本
//     removeItem 掉（实测：LS 无此键、IDB 240,672）＝动态整包只剩 IndexedDB 一份拷贝。
//   · 同一时刻剥图快照 feed-posts-snap 被 persistSnap 的预算裁成 "[]"（实测 snapLen=2）
//     ＝LS 侧最后一层兜底当场归零。
//   · 而 stripPostImg 对两栏的态度正好相反：imgs 整组清空（连 #1257 那 44 字符、能从媒体池
//     解回真图的 @@m: 令牌一起扔），stickers 一个字没动（巨型 dataURL 原样留在快照里）。
//     于是「主键读空 → 快照兜底」这条路径必然渲染成：照片没了、贴纸还在＝用户所见症状。
// 本批四处（零机型／零 UA 分支＝判据只取「这一栏存的是可自愈引用还是巨型载荷」这一个事实）：
//   ① stripPostImg：imgs 只剥 dataURL 载荷，保留 @@m: 令牌与外链（接上 #667 给正文定的同一口径）
//   ② stripPostImg：贴纸的 dataURL src 一并剥（纯图贴纸剥空后没有可显示形态，不留孤格子）
//   ③ 贴纸写入接上 #1257 那把尺子：先按内联上屏（点照片落位这一发要即时可见），媒体池确认落盘
//     后就地换成 44 字符令牌再存一轮；池没落盘就保持内联＝旧行为，不更坏
//   ④ deepMergePost：贴纸按「同一格」并集（ts+身份+落点+emoji，刻意不含 src），同格取还带得回
//     图的那一版——快照那一侧被剥空的格子不许盖掉完整载荷
// 断言分三类：S＝逻辑锚；B／F0a／P4／Z＝夹具真实性与旧契约（两侧皆绿才算数）；
//   P1~P3、F0~F2、M1＝本批新契约（HEAD 侧应当全红）。
const root = process.argv[2] || process.cwd();
console.log('被测根目录 = ' + root);
const { createServer } = await import('node:http');
const { readFileSync, statSync, existsSync } = await import('node:fs');
import { join, normalize, extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(normalize(root));
if (!existsSync(join(ROOT, 'index.html'))) { console.error('被测目录没有 index.html（先构建）'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(ROOT, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const artifact = readFileSync(join(ROOT, 'js', 'feed.js'), 'utf8');

// 一张真能解码的 BMP 贴纸（≈160K 字符 base64）——「贴几张就把主键顶过大键线」用的就是这量级
function stickerDataUrl(seed, w, h) {
  w = w || 200; h = h || 200;
  const row = w * 3, size = 54 + row * h;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0); buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10);
  buf.writeInt32LE(size, 18); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
  buf.fill((seed % 250) + 5, 54);
  return 'data:image/bmp;base64,' + buf.toString('base64');
}
const STK1 = stickerDataUrl(1), STK2 = stickerDataUrl(2), STK3 = stickerDataUrl(3);
const PHOTO = stickerDataUrl(9);
// 小载荷（~300 字符）：M 组要的是「两份都留在大键线以内」，这样 idbRestore 的「LS 有值以 LS 为准」
//   成立，合并两侧才是真的两份不同数据（用 160K 的那批会被回填顶成一份，测不到并集）
const SMALL = stickerDataUrl(5, 8, 8);
// #1434：朋友圈列表改成「本周＋按月」翻页折叠——种子动态必须落在默认那一页（本自然周）里，
//   否则「屏上看得到贴纸」那一类断言会被折到 2023 年 11 月那一页去（本尺测的是贴纸落盘与快照，
//   与这批数据是哪一年写的无关）
const T = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() + 60000; })();
const POST_ID = 'f_1219_probe';
const LS_MAIN = 'xy-home-v2:feed-posts';
const LS_SNAP = 'xy-home-v2:default:feed-posts-snap';
const LS_BIG = 204800;

const mkPost = (o) => Object.assign({
  id: POST_ID, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '',
  content: '今天的天空很好看', imgs: [PHOTO], stickers: [], ts: T, likes: [], comments: []
}, o);
const stk = (src, x, y, ts) => ({ src: src, emoji: '', x: x, y: y, ts: ts, role: 'me', owner: 'me', authorName: '我' });

const browser = await chromium.launch();
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}
const isTok = (s) => typeof s === 'string' && s.indexOf('@@m:') === 0;
const br = (arr) => (arr || []).map((s) => String((s && s.head) || s || '').slice(0, 10));

// —— 页内脚手架（每个上下文只登记一次；带 __v1219seed 幂等守卫，同上下文重启不重新种）——
function initSrc(seedMain, extraPairs, idbSeed) {
  return `(function(){
    var hv = false;
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return hv ? 'hidden' : 'visible'; } });
      Object.defineProperty(document, 'hidden', { configurable: true, get: function(){ return hv; } });
      window.__bg = function (v) { hv = !!v; document.dispatchEvent(new Event('visibilitychange')); };
    } catch (e) { window.__bg = function () {}; }
    ${idbSeed ? `var __iv = 0, __timer = setInterval(function(){ __iv++; if (window.idbSet) { clearInterval(__timer); try { window.idbSet(${JSON.stringify(LS_MAIN)}, ${JSON.stringify(idbSeed)}); } catch (e) {} } else if (__iv > 800) clearInterval(__timer); }, 5);` : ''}
    if (localStorage.getItem('__v1219seed') === '1') return;
    try { localStorage.clear(); } catch (e) {}
    localStorage.setItem('__v1219seed', '1');
    ${seedMain ? `localStorage.setItem(${JSON.stringify(LS_MAIN)}, ${JSON.stringify(seedMain)});` : ''}
    ${(extraPairs || []).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n    ')}
    localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['贴纸组', [${JSON.stringify(STK1)}, ${JSON.stringify(STK2)}, ${JSON.stringify(STK3)}]]]));
    ['reply-fd-comment-prob', 'reply-fd-likeback-prob', 'reply-fd-reply-prob', 'reply-fd-post-prob'].forEach(function (k) {
      localStorage.setItem('xy-home-v2:' + k, '0'); localStorage.setItem('xy-home-v2:default:' + k, '0');
    });
  })()`;
}
async function session(seedMain, extraPairs, idbSeed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await ctx.addInitScript(initSrc(seedMain, extraPairs, idbSeed));
  await enter(page);
  return { ctx, page, errs };
}
async function enter(page) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__mochiDataReady', null, { timeout: 30000 }).catch(() => {});
  await sleep(2200);
  await page.evaluate(`(function(){ document.querySelectorAll('.splash,.splash-notice,.splash-box').forEach(function(n){ n.classList.add('hide'); n.style.display='none'; }); var el=document.querySelector('.app[data-app="feed"]'); if(el) el.click(); })()`);
  await sleep(1200);
}
async function restart(page) { await page.reload({ waitUntil: 'domcontentloaded' }); await enter(page); }
// 真点：贴纸按钮 → 面板选第 n 项 → 点照片选位落下
async function paste(page, nth) {
  const a = await page.evaluate(`(function(){ var c=document.querySelector('#feed-post-${POST_ID}')||document.querySelector('.feed-post'); var b=c&&c.querySelector('.feed-act[data-sticker]'); if(!b) return 'no-btn'; b.click(); return 'ok'; })()`);
  await sleep(800);
  const b = await page.evaluate(`(function(){ var its=[].slice.call(document.querySelectorAll('#feed-sticker-list .emoji-item')); var d=its[${nth}]; if(!d) return 'none'; d.click(); return d.dataset.stkKind; })()`);
  await sleep(800);
  const c = await page.evaluate(`(function(){ var c=document.querySelector('#feed-post-${POST_ID}')||document.querySelector('.feed-post'); var box=c.querySelector('.feed-imgs'); if(!box.classList.contains('feed-sticker-picking')) return 'not-picking'; var r=box.getBoundingClientRect(); box.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*0.5,clientY:r.top+r.height*0.5})); return 'placed'; })()`);
  await sleep(1500);
  return a + '/' + b + '/' + c;
}
const domRead = (page) => page.evaluate(`(function(){
  var c = document.querySelector('#feed-post-${POST_ID}') || document.querySelector('.feed-post');
  var box = c && c.querySelector('.feed-imgs');
  var photos = box ? [].slice.call(box.querySelectorAll('img')).filter(function(i){ return !i.closest('.feed-sticker'); }) : [];
  return { hasCard: !!c, hasBox: !!box,
    photos: photos.map(function(i){ return String(i.getAttribute('src')||'').slice(0,12); }),
    stkTotal: box ? box.querySelectorAll('.feed-sticker').length : 0,
    stkImg: box ? box.querySelectorAll('.feed-sticker img').length : 0,
    stkEmoji: box ? box.querySelectorAll('.feed-sticker .feed-sticker-emoji').length : 0,
    blank: !!(box && box.classList.contains('feed-imgs-blank')) };
})()`);
const dataRead = (page) => page.evaluate(`(function(){
  var out = {};
  var mk = localStorage.getItem(${JSON.stringify(LS_MAIN)});
  out.mainLen = mk === null ? null : mk.length;
  try { var p = JSON.parse(mk)[0]; out.mainStk = (p.stickers||[]).map(function(s){ return { head: String(s.src||'').slice(0,10), len: (s.src||'').length }; }); out.mainImgs = (p.imgs||[]).map(function(u){ return String(u).slice(0,10); }); } catch (e) { out.mainErr = String(e); }
  var sn = localStorage.getItem(${JSON.stringify(LS_SNAP)});
  out.snapLen = sn === null ? null : sn.length;
  try { var q = JSON.parse(sn)[0] || null; out.snapImgs = q ? (q.imgs||[]).map(function(u){ return String(u).slice(0,10); }) : null; out.snapStk = q ? (q.stickers||[]).map(function(s){ return { head: String(s.src||'').slice(0,10), len: (s.src||'').length, emoji: s.emoji }; }) : null; } catch (e) { out.snapErr = String(e); }
  return out;
})()`);

// ================= S 组：四处改动各自的逻辑锚（产物侧） =================
check('S1 快照对配图只剥 dataURL 载荷（不再整组清空，令牌留住）', artifact.includes('c.imgs = c.imgs.filter(u => !isSnapPayload(u));'));
check('S2 快照对贴纸的 dataURL src 一并剥（纯图格子不留孤零）', artifact.includes('if (!isSnapPayload(s.src)) { acc.push(s); return acc; }'));
check('S3 贴纸写入接上媒体池令牌升级（先上屏、池确认后换引用）', artifact.includes('function feedStickerTokUpgrade(pid, rec) {'));
check('S4 合并时贴纸走并集（剥空的一格不许盖掉完整载荷）', artifact.includes('out.stickers = stkUnion;'));
check('S5 并集按「同一格」认人且认别串里刻意不含 src', artifact.includes(" + '|' + (s.emoji || '')"));

// ================= B 组：健康存储下的真点链路（夹具真实性＋旧契约不动） =================
{
  const { ctx, page, errs } = await session(JSON.stringify([mkPost({})]));
  const before = await domRead(page);
  check('B0 夹具真实：种子动态有 1 张配图、0 张贴纸', before.hasCard && before.photos.length === 1 && before.stkTotal === 0, before);
  const p1 = await paste(page, 0);
  const after1 = await domRead(page);
  check('B1 贴一张图片贴纸：贴纸立刻上屏，配图不会被这一次操作弄没', after1.stkTotal === 1 && after1.photos.length === 1, { p1, after1 });
  await paste(page, 3);   // 面板第 4 项＝emoji 贴纸
  const after2 = await domRead(page);
  check('B2 emoji 贴纸照常可贴（走 emoji 文本层、不进媒体池）', after2.stkEmoji === 1 && after2.stkTotal === 2 && after2.photos.length === 1, after2);
  await page.evaluate(`(function(){ var el=document.querySelector('#feed-post-${POST_ID} .feed-sticker[data-sticker-del]'); if(el) el.click(); })()`);
  await sleep(700);
  const modal = await page.evaluate(`(function(){ var b=document.querySelector('#modal-ok,#modal-confirm,.modal-ok,.modal-btn-ok,[data-mc]'); if(b){ b.click(); return b.id||b.className; } var m=document.querySelector('.modal,.open-modal,[id*=modal]'); return m? ('no-ok:'+m.id) : 'no-modal'; })()`);
  await sleep(1300);
  const after3 = await domRead(page);
  check('B3 用户主动撤回贴纸真落空（删一格少一格，配图不受牵连）', after3.stkTotal === 1 && after3.photos.length === 1, { modal, after3 });
  const d = await dataRead(page);
  check('B4 一张贴纸的量级下主键仍在 localStorage 且远在大键线内（两侧皆绿的控制组）', d.mainLen !== null && d.mainLen < LS_BIG, { mainLen: d.mainLen });
  check('Z1 健康链路全程零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

// ================= P 组：连贴 3 张大贴纸（用户报障那一发） =================
{
  const { ctx, page, errs } = await session(JSON.stringify([mkPost({})]));
  await paste(page, 0); await paste(page, 1); await paste(page, 2);
  await sleep(2600);   // 池确认落盘 → 引用换令牌；#496 合并写窗口 ≥2.5s
  const d = await dataRead(page);
  const dom = await domRead(page);
  check('P1 贴纸在权威键里落的是媒体池令牌，不是 16 万字符的内联载荷', d.mainStk && d.mainStk.length === 3 && d.mainStk.every((s) => isTok(s.head)), { heads: br(d.mainStk), lens: (d.mainStk || []).map((s) => s.len) });
  check('P2 连贴 3 张后主键仍在 localStorage（不再被大键分支剥成 IDB-only）', d.mainLen !== null && d.mainLen < LS_BIG, { mainLen: d.mainLen });
  check('P3 快照既不残留巨型贴纸载荷、也没被预算裁成空表', d.snapLen !== null && d.snapLen > 2 && d.snapLen < LS_BIG && (d.snapStk || []).every((s) => !/^data:/.test(s.head)), { snapLen: d.snapLen, snapStk: br((d.snapStk || []).map((s) => s.head)) });
  check('P4 三张贴纸在页面上照常都在（瘦身不是把贴纸抹掉）', dom.stkTotal === 3 && dom.photos.length === 1, dom);
  check('Z2 连贴链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

// ================= F 组：主键读空、只剩剥图快照时该看到什么（症状本体） =================
{
  const { ctx, page, errs } = await session(JSON.stringify([mkPost({})]));
  // ① 先按 #1257 的真实形态把配图搬进媒体池（动态里只留令牌），再重启一轮让朋友圈以该形态持有它
  const tok = await page.evaluate(`(async function(){
    var u = ${JSON.stringify(PHOTO)};
    return window.mochiMediaTokenize(u).then(function (t) { return window.mochiMediaFlush().then(function (ok) { return ok ? t : null; }); });
  })()`);
  check('F0a 夹具可用：媒体池收得下图体并回令牌', !!tok, tok && tok.slice(0, 10));
  if (tok) {
    await page.evaluate(`(function(){ var s = window.xyStore('xy-home-v2'); var arr = JSON.parse(s.get('feed-posts')); arr[0].imgs = [${JSON.stringify(tok)}]; s.set('feed-posts', JSON.stringify(arr)); })()`);
    await restart(page);
  }
  const r1 = await domRead(page);
  check('F0b 重启后这条动态以「令牌配图」的形态正常解出图（兜底测试的真身）', r1.photos.length === 1 && r1.photos[0].indexOf('data:') === 0, r1);
  await paste(page, 0);                                  // 真贴一张图片贴纸（本批会换成令牌）
  await page.evaluate(`(function(){ var b=document.querySelector('#feed-post-${POST_ID} .feed-act[data-like]'); if(b) b.click(); })()`);
  await sleep(1800);                                     // persistSnap 尾随 800ms
  const d = await dataRead(page);
  check('F0 快照里配图那一栏保住令牌引用（不被整组清空）', (d.snapImgs || []).length === 1 && isTok(d.snapImgs[0]), { snapImgs: br(d.snapImgs), mainImgs: br(d.mainImgs), snapLen: d.snapLen });
  check('F0c 快照里贴纸也保住令牌引用（贴纸不再是唯一活下来的那一栏）', (d.snapStk || []).length === 1 && isTok(d.snapStk[0].head), { snapStk: br((d.snapStk || []).map((s) => s.head)) });
  // ② 造真故障：LS 主键没了（大键被剥／LS 被清同形）＋内存副本释放＋切后台（#975）→ load() 只剩快照
  await page.evaluate(`(function(){ try { localStorage.removeItem(${JSON.stringify(LS_MAIN)}); } catch (e) {} try { window.idbMemoDrop(${JSON.stringify(LS_MAIN)}); } catch (e) {} })()`);
  await page.evaluate(`window.__bg(true)`); await sleep(500);
  await page.evaluate(`window.__bg(false)`); await sleep(500);
  await page.evaluate(`(function(){ var t=document.querySelector('.tab'); if(t) t.click(); })()`); await sleep(700);
  await page.evaluate(`(function(){ var el=document.querySelector('.app[data-app="feed"]'); if(el) el.click(); })()`); await sleep(1800);
  const dom = await domRead(page);
  check('F1 主键读空只剩剥图快照时，配图仍在（不是「照片消失、只剩贴纸」）', dom.photos.length === 1 && dom.photos[0].indexOf('data:') === 0, { degraded: dom });
  check('F2 这条兜底路径上贴纸照常显示（不是把贴纸一起抹掉的假绿）', dom.stkTotal === 1 && (dom.stkImg + dom.stkEmoji) === 1, dom);
  check('Z3 兜底渲染链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

// ================= M 组：权威（IDB）与本地（LS）两份贴纸按「同一格」并集 =================
{
  // 本地这一份＝被剥空载荷的降级形态：配图栏空、图贴纸格子只剩位置、另有一格 emoji 是本地后贴的
  const degraded = mkPost({ ts: T + 5000, imgs: [], stickers: [
    { src: '', emoji: '', x: 30, y: 40, ts: T + 1000, role: 'me', owner: 'me', authorName: '我' },
    { src: '', emoji: '❤️', x: 60, y: 60, ts: T + 3000, role: 'me', owner: 'me', authorName: '我' }
  ] });
  // 权威（IndexedDB）那一份＝完整载荷但比本地少一格（emoji 那格是本地后贴的）
  const full = mkPost({ ts: T, imgs: [SMALL], stickers: [
    { src: SMALL, emoji: '', x: 30, y: 40, ts: T + 1000, role: 'me', owner: 'me', authorName: '我' }
  ] });
  // 两份都小于大键线 ⇒ idbRestore 的「LS 有值就以 LS 为准」成立：合并两侧真的是两份不同数据
  const { ctx, page, errs } = await session(JSON.stringify([degraded]), null, JSON.stringify([full]));
  await sleep(2500);   // 等合并链走完（idbGet → feedMergeFromIdb → render）
  const pre = await dataRead(page);
  const dom = await domRead(page);
  check('M0 前提成立：权威那一发的确读到了（只在 IDB 的配图被补回本地这一份）', dom.hasCard && dom.photos.length === 1, { mainImgs: br(pre.mainImgs), dom });
  check('M1 两侧按同格并集：本地剥空的那一格从权威补回载荷，本地后贴的 emoji 那格不被权威整组盖掉', dom.stkTotal === 2 && dom.stkImg === 1 && dom.stkEmoji === 1, { dom, mainStk: br(pre.mainStk) });
  check('Z4 合并链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

await browser.close();
server.close();
const fails = results.filter((r) => !r.ok).length;
console.log(fails ? 'FAIL ' + fails + '/' + results.length : 'ALL PASS ' + results.length + '/' + results.length);
process.exit(fails ? 1 : 0);
