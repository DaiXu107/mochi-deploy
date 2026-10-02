// ===== 专项回归：朋友圈贴纸去「每条动态最多 5 张」上限（#1479，v8.56） =====
// 用法：node tools/verify-1479-feed-sticker-unlimited.mjs [被测根目录]
//   首行打印被测根目录；同尺 A/B 分别指向「含本批的副本」与「纯 HEAD 副本」。
// 作者直派：「朋友圈要去掉每条朋友圈最多5张贴纸的限制，无限制」。
// 旧实现两道顶帽（都在 addFeedSticker 一条链上）：
//   · 我贴侧：第 6 张弹 toast「这条动态上贴纸够多啦（最多 5 张）」静默拒贴；
//   · TA 回贴侧：评论概率命中的回贴在动态已有 5 张时静默 return（连 toast 都没有）。
// 帽失去存在依据的机制面：#1219 后图片贴纸写入接媒体池令牌化（44 字符引用，池里只存一份），
//   emoji 贴纸本就零载荷——多张不再把权威键 feed-posts 顶过 LS 大键线。
// 断言分三类：S＝逻辑锚（产物侧）；B＝我贴侧连贴 7 张（真点面板）；T＝TA 回贴越 5（钉
//   Math.random=0 把评论概率支拉满、延迟收成 commentSpeedMin=1s）；Z＝链路零未捕获异常。
// 纯 HEAD 侧预期：S1~S3、B1~B3、T2~T3 恰全本批新契约＝判别力实证；S4/B0/T0/T1/Z 两侧皆绿。
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
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');

// 一张真能解码的 BMP 贴纸（面板 items 与贴纸载荷都从这里来，量级随 #1219 同款）
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
const SMALL = stickerDataUrl(5, 8, 8);
// #1434：种子动态必须落在默认那一页（本自然周）里，否则断言会被月度折叠页吃掉
const T = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() + 60000; })();
const POST_ID = 'f_1479_probe';
const LS_MAIN = 'xy-home-v2:feed-posts';
const LS_BIG = 204800;

const mkPost = (o) => Object.assign({
  id: POST_ID, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '',
  content: '今天的天空很好看', imgs: [PHOTO], stickers: [], ts: T, likes: [], comments: []
}, o);
const stk = (src, x, y, ts, role) => ({ src: src, emoji: '', x: x, y: y, ts: ts, role: role || 'me', owner: role === 'ta' ? 'default' : 'me', authorName: role === 'ta' ? '小桃' : '我' });

const browser = await chromium.launch();
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// —— 页内脚手架（带 __v1479seed 幂等守卫）——
function initSrc(probs) {
  const pairs = [['reply-fd-comment-prob', probs.comment], ['reply-fd-likeback-prob', 0], ['reply-fd-reply-prob', 0], ['reply-fd-post-prob', 0],
    ['reply-fd-comment-speed-min', 1], ['reply-fd-comment-speed-max', 2]];
  return `(function(){
    var hv = false;
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return hv ? 'hidden' : 'visible'; } });
      Object.defineProperty(document, 'hidden', { configurable: true, get: function(){ return hv; } });
      window.__bg = function (v) { hv = !!v; document.dispatchEvent(new Event('visibilitychange')); };
    } catch (e) { window.__bg = function () {}; }
    if (localStorage.getItem('__v1479seed') === '1') return;
    try { localStorage.clear(); } catch (e) {}
    localStorage.setItem('__v1479seed', '1');
    ${pairs.map(([k, v]) => `localStorage.setItem('xy-home-v2:default:${k}', '${v}');`).join('\n    ')}
    localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['贴纸组', [${JSON.stringify(STK1)}, ${JSON.stringify(STK2)}, ${JSON.stringify(STK3)}]]]));
  })()`;
}
async function session(seedPosts, probs, pinRandom) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await ctx.addInitScript(initSrc(probs || { comment: 0 }));
  await enter(page);
  if (pinRandom) await page.evaluate('Math.random = function(){ return 0; }');
  if (seedPosts) {
    await page.evaluate(`(function(){ window.xyStore('xy-home-v2').set('feed-posts', ${JSON.stringify(seedPosts)}); })()`);
    await sleep(600);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enter(page);
    if (pinRandom) await page.evaluate('Math.random = function(){ return 0; }');
  }
  return { ctx, page, errs };
}
async function enter(page) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__mochiDataReady', null, { timeout: 30000 }).catch(() => {});
  await sleep(2200);
  await page.evaluate(`(function(){ document.querySelectorAll('.splash,.splash-notice,.splash-box').forEach(function(n){ n.classList.add('hide'); n.style.display='none'; }); var el=document.querySelector('.app[data-app="feed"]'); if(el) el.click(); })()`);
  await sleep(1200);
}
// 真点：贴纸按钮 → 面板选第 n 项 → 点照片选位落下（与 verify-1219 同一款夹具）
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
  return { hasCard: !!c, hasBox: !!box,
    stkTotal: box ? box.querySelectorAll('.feed-sticker').length : 0,
    stkMine: box ? box.querySelectorAll('.feed-sticker[data-sticker-del]').length : 0,
    stkTa: box ? box.querySelectorAll('.feed-sticker:not([data-sticker-del])').length : 0 };
})()`);
const toastRead = (page) => page.evaluate(`(function(){ var t=document.getElementById('cc-toast'); return t ? String(t.textContent||'') : ''; })()`);
const dataRead = (page) => page.evaluate(`(function(){
  var out = {};
  var mk = localStorage.getItem(${JSON.stringify(LS_MAIN)});
  out.mainLen = mk === null ? null : mk.length;
  try { var arr = JSON.parse(mk); var p = arr[0]; out.mainStk = (p.stickers||[]).length; } catch (e) { out.mainErr = String(e); }
  return out;
})()`);

// ================= S 组：逻辑锚（产物侧） =================
check('S1 我贴/TA 回贴两路顶帽都从产物里消失（回流＝贴第 6 张被静默拒）', artifact.indexOf('stickers.length >= 5') < 0);
check('S2 「最多 5 张」toast 文案从产物里消失', artifact.indexOf('最多 5 张') < 0);
check('S3 功能介绍文案随批改口径（张数不限制）', indexHtml.indexOf('选表情包贴到照片上（张数不限制，自己贴的可点撤回）') >= 0 && indexHtml.indexOf('每张照片最多 5 张') < 0);
check('S4 旧契约不动：贴纸写入与令牌升级链仍在（去帽不是把 #1219 的瘦身拆了）', artifact.includes('function feedStickerTokUpgrade(pid, rec) {') && artifact.includes('p.stickers.push(rec)'));

// ================= B 组：我贴侧连贴 7 张（旧帽 5 ⇒ 第 6 发就是分水岭） =================
{
  const { ctx, page, errs } = await session(JSON.stringify([mkPost({})]), { comment: 0 });
  const items = await page.evaluate(`(function(){ document.querySelector('.feed-post .feed-act[data-sticker]').click(); return [].slice.call(document.querySelectorAll('#feed-sticker-list .emoji-item')).length; })()`);
  await sleep(400);   // 面板幂等重开（openFeedStickerPanel 非 toggle），后续 paste 直接复用
  check('B0 夹具真实：面板 items ≥ 5（3 图片贴纸＋emoji 组），够连贴 7 发', items >= 5, { items });
  if (items >= 5) {
    const seq = [0, 1, 2, 3, 3, 0, 1];
    const toasts = [];
    for (let i = 0; i < seq.length; i++) { await paste(page, seq[i]); toasts.push(await toastRead(page)); }
    await sleep(2600);   // 池确认落盘 → 引用换令牌；#496 合并写窗口 ≥2.5s
    const dom = await domRead(page);
    const d = await dataRead(page);
    check('B1 连贴 7 张全部上屏（旧帽第 6 发就拒＝纯 HEAD 此处 5/7）', dom.stkTotal === 7, { dom });
    check('B2 全程没有弹过「最多 5 张」toast（拒贴提示随帽一起退役）', toasts.every((t) => t.indexOf('最多 5') < 0), { toasts: toasts.filter((t) => t) });
    check('B3 权威键里 7 格俱在、键体仍远在大键线内（令牌化兜住无上限的量级）', d.mainStk === 7 && d.mainLen !== null && d.mainLen < LS_BIG, d);
  }
  check('Z1 连贴链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

// ================= T 组：TA 回贴侧越 5（把用户侧固定在两版都放行的 4+1，隔离出 TA 帽） =================
{
  const seeded = mkPost({ stickers: [stk(SMALL, 20, 20, T + 1), stk(SMALL, 30, 30, T + 2), stk(SMALL, 40, 40, T + 3), stk(SMALL, 50, 50, T + 4)] });
  const { ctx, page, errs } = await session(JSON.stringify([seeded]), { comment: 100 }, true);
  const p1 = await paste(page, 0);
  const afterUser = await domRead(page);
  check('T0 前提：第 5 张（用户侧）两版都放行（TA 到达时机与评论延迟相关，这里只认用户自己的 5 格）', afterUser.stkMine === 5, { p1, afterUser });
  // 评论概率拉满＋Math.random 钉 0＋速度键钉 1~2s ⇒ TA 分支必走、延迟有界；再等 #496 空闲窗把落盘收敛
  let dom = afterUser;
  for (let i = 0; i < 15 && dom.stkTa === 0; i++) { await sleep(1000); dom = await domRead(page); }
  let d = await dataRead(page);
  for (let i = 0; i < 12 && d.mainStk !== 6; i++) { await sleep(1000); d = await dataRead(page); }
  check('T2 已有 5 张时 TA 回贴不被顶帽拦（纯 HEAD 静默 return＝此处 0）', dom.stkTa === 1 && dom.stkTotal === 6, { dom });
  check('T3 权威键 6 格俱在（我 5＋TA 1，等落盘收敛后再认）', d.mainStk === 6, d);
  check('Z2 TA 回贴链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

await browser.close();
server.close();
const fails = results.filter((r) => !r.ok).length;
console.log(fails ? 'FAIL ' + fails + '/' + results.length : 'ALL PASS ' + results.length + '/' + results.length);
process.exit(fails ? 1 : 0);
