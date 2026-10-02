// ===== 回归脚本 #1314：表情包面板「每次打开图片都闪和重新加载」＋「点选换头像后图片闪和重新加载」
// ⚠️ 批号：本批原定 #1313，与并行会话先入库的「聊天渲染泵停摆」那一批撞号（他们占 #1313a~i、只碰
//   js/chat.js），按台账「先入库者留号」整体改为 #1314a~l，脚本文件名一并改（WORKLOG 2026-09-27 有约）。
//   两批在 chat.js 有交集（他们改整窗构建的泵、本批改表情面板落图那五处），重放后 5 个 hunk 一律
//   offset +95 行、逐行增删与基点轮同为 32＝HUNK-PAYLOAD-IDENTICAL。
// 背景（用户报障，红米 K80/Chrome 实报，用户明说其他设备型号也有、要求不要覆盖式修补，且强调
//   「问题一直没有解决」）：同族已收十一轮（#457/#508/#509/#547/#617/#662/#692/#704/#716/#907/
//   #1011），判据一路是「节点有没有被重建」「位图有没有被回收」「可见那一帧就绪没有」——都对，但
//   都没问过「同一个节点被交了几次图」。本脚本无头真跑产物、按节点身份逐笔记每次 src 赋值，量出
//   两条机制：
//   ① 表情面板首屏 10 格＝20 次 src 赋值：第 1 次写的是 @@m:<hash> 那 44 个字符本身（旧写法要让
//      媒体池按 img[src^="@@m:"] 把节点捞回来），内核把它当**相对 URL** 真发一次请求（必 404，
//      #1011 台账自己写着「7 次请求＋7 次 404」），第 2 次才是池写回的真载荷＝每一格先坏一次、再
//      从零解一次；#1011 的 opacity:0 只把坏帧藏起来，那发多余请求与第二次解码一直留着。
//      修法＝池自己记下「哪些节点在等哪个哈希」（mochiMediaPaint/paintWait/paintDeliver），载荷到手
//      一次写成载荷；只有池确实回答没有才把令牌交回 src＝观察器＋#397 缺数据那一路语义一字不改。
//      面板里落 src 的四处入口（首屏 kick、懒加载泵、无 IO 的即时补、后台预热）共用
//      emojiPaintSrc/avPaintSrc 一把尺子；在飞标记 __moPaint 由池摆/由池收（#662 回收池会带着旧
//      标记复活节点，只靠调用方回调清不够）。
//   ② 头像互动点一张头像换联系人头像：写入面是整个已渲染窗口——300 条历史实测同一次点击任务里 104
//      次 src 写／103 次图片载入（无头 390×844 复核：#chat-body 里 100 个 .msg-in .msg-av img 全部
//      在点按那一拍被写完），而屏上只有 6~7 个气泡头像看得见＝用户看得见的那几个被排在九十几个看
//      不见节点的载入／解码之后。#617 收掉了拆节点、#662 预热了位图，写入面没人管。修法＝按「这一格
//      现在画不画得出来」分档：可见的（含 80px 余量）立刻落，屏外的分片在后续帧里补齐（每片 24，
//      几帧内一定落地，不留旧头像）；拿不到视口或没有 rAF 一律照旧一次写完＝最坏等于今天。
//   零机型／零 UA 分支：全部判据只取「写入的是令牌还是载荷」「这一格画不画得出来」两个事实。
// 夹具三条硬约束（踩过才写在这儿）：
//   · 令牌化 pass（#377/#455）只改**内存池视图**（ownPoolCache），原始库键一字节不动 ⇒ 判「库里
//     是不是令牌」必须问 getScopedGroups(...) 的池视图，问 store.get('cc-groups') 永远是内联串＝
//     尺子读空、整组断言全成假绿。
//   · 冷开＝整页重载（同会话里 map 热缓存已经暖了，量不到「每次打开」那一拍）；#907 的空闲预热会把
//     缺陷盖住 ⇒ P/A/V 组一律关掉 chat-panel-prewarm（与 #1011 同一隔离口径），预热那一腿单独用
//     P7 页量（开关默认开、只等不点面板）。那颗开关是**全局根键**（chat.js 读 xyStore('xy-home-v2')，
//     contacts.js 把它列进 EXCLUDE 不随桌面命名空间迁移）——写进 per-cid 作用域等于没写，实测同一
//     条 P1 一次读到 10 次写入、一次只读到 2 次（预热先把 8 格画好＝假绿的反向形态）。
//   · 写入面的尺子只认「同一批写入里的先后」：可见的那几个必须写在任何一个屏外节点之前（V1）＋
//     屏外那一批必须落在之后的帧里（V2b）。两个反面都踩过：取「点按后 sleep 250ms 数总数」＝假绿
//     （分片几十毫秒就补完，修好与没修的累计数一模一样）；取「点按那一次同步任务里写了几个」＝空心
//     （真点那一路的落笔在压缩回执之后的一次任务里，点按当场一个都没写＝判据永远读 0）。
//   · 新页面与 A 同一个 context＝同一份存储：那边一写 store 就把 A 的聊天窗口打回重渲染，而 A 处在
//     后台页时 rAF 停摆 ⇒ 窗口停在 0 个节点。V 组先 bringToFront 并等窗口排好，否则 nodes:0 全组假绿。
//   · V 组的靶格按**值**挑（第一格「内联且末 24 字符 ≠ 现头像」），不按固定序号：#617 的守卫是「值没变
//     ＝DOM 一律不碰」，而种进去的现头像本身就是库里的一格——按固定序号点中那一格时整窗一次都不写，
//     实测读出 writes:14／offDone:0／nodes:7（14 笔摊在 7 个可见节点上、屏外一档一笔都没有），V1/V2b
//     当场红＝夹具没构成写入面，不是修复没生效。分档判据同时改按**写入当时**的几何量（见探针 visAt），
//     不再拿点按那一刻的节点身份快照当筛子。读数里带 pre.pick／pre.sameAsCell／pre.flagged 供复现。
//   · 探针一律用 ctx.addInitScript 装在 **document-start**，不许等页面暖好再 page.evaluate 装：
//     #907 的空闲预热排在 load+4s，而「等存储就绪→种库→重载→装探针」那一路本身要跑 3~6s，晚装的
//     那一截写入与 404 回执全看不见。实测代价就是本脚本第一轮把 P7 读成「零写入＋10 次解码失败」
//     并误判成 HEAD 侧没症状——装早一帧后 HEAD 如实读出 tokWritesAll:10 / req:10 / errs:10，栈顶
//     就写着 mochiPrewarmEmojiPanel。凡是「量的是页面生命周期里某一拍」的断言都吃这条。
//   · V 组只判「写入面真被尺子数到的那一轮」：点按恰好赶上整窗重渲染时（换头像补发系统消息），新节点
//     是 innerHTML 带着 src 落地的＝赋值探针看不见 ⇒ 该轮如实读成 writes:12／offDone:0／uniqNodes:6 而
//     V2 的 stale:0 照旧绿。拿这种轮次判 V1/V2b 就是把夹具时序报成修复没生效（落库轮实测踩过一次）。
//     收口＝V0b 显式数前置＋整轮重来（最多三轮，三轮都不构成写入面就照最后一次判红），两侧同一把尺子。
// 判别力（同一把尺子对照纯 tip 副本，实测读数写在括号里）：S 组锚点＋P1(每格 hist {"2":10})／P2(令牌写
//   10，栈顶 emojiKickFirstScreen)／P3(令牌相对 URL 404 10 发)／P4b(内核为令牌报错 10 次)＋P7(预热那一
//   腿同样 10/10/10)＋V1(可见的排最后, writes:100 lastVis:99 > firstOff:0)／V2b(span:0＝一次任务写完)
//   ＋A3(头像侧漏点 avKickFirstScreen 写令牌 1/1/1)＝tip 侧 14 绿/20 红、修复侧 34 绿/0 红；修复侧同一条
//   V 组如实读出 writes:98／visDone:5 先落（maxVisFr:2044）／offDone:93 落在后续帧（minOffFr:2045，
//   span:4）／firstOff:5 > lastVis:4。S0/P4/P5/A1/A2/A4/V0/V1b/V2/V3/V4/P6/P7b/Z1 两侧同绿＝夹具真实且
//   旧契约（#1011/#547/#457/#617/#662/#907/#397）没被顺手改坏。
// 用法：node tools/verify-1314-panel-single-paint.mjs [被测根目录]   （缺省＝当前仓库产物）
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(process.argv[2] || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('被测根目录: ' + root);
if (!existsSync(join(root, 'index.html'))) { console.error('没有产物 index.html，先 node build.mjs'); process.exit(2); }
let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ' ' + JSON.stringify(detail === undefined ? '' : detail)); }
}

// ---------- S 组：本批十二针的静态锚（与 build.mjs 的 FIX_SENTINELS #1314a~l 同一批字符串）----------
const ANCHORS = [
  ['S1 = #1314a 池侧唯一入口 mochiMediaPaint 在场', 'js/media-pool.js', 'window.mochiMediaPaint = function (el, val, done) {'],
  ['S2 = #1314b 在飞标记由池摆（各写入方同尺）', 'js/media-pool.js', 'try { el.__moPaint = 1; } catch (eF) {}'],
  ['S3 = #1314c 落笔前复核「src 仍是空的」（旧回执不许偷走新数据）', 'js/media-pool.js', 'if (cur) { paintFinish(el, it.done, false); continue; }'],
  ['S4 = #1314d 等待有上限、到点按旧语义交回令牌', 'js/media-pool.js', 'setTimeout(function () { paintDeliver(h, map.get(h) || null); }, PAINT_WAIT_MS);'],
  ['S5 = #1314e 表情首屏那一格当场落笔（交回池）', 'js/chat.js', 'emojiPaintSrc(im, ds);'],
  ['S6 = #1314f 懒加载泵同尺（滚到哪都不许把令牌上屏）', 'js/chat.js', 'emojiPaintSrc(img, img.__emojiLazySrc || img.dataset.src);'],
  ['S7 = #1314g 「等图 ready」闸认得「还在读」这一态', 'js/chat.js', 'if (im.__moPaint) return;'],
  ['S8 = #1314h 预热那一腿同尺（表情侧）', 'js/chat.js', "emojiPaintSrc(im, im.dataset.src, function (ok)"],
  ['S9 = #1314i 头像侧同尺', 'js/avatar-lib.js', 'avPaintSrc(im, ds);'],
  ['S10 = #1314j 头像预热那一腿同尺', 'js/avatar-lib.js', "avPaintSrc(im, im.dataset.src, function (ok)"],
  ['S11 = #1314k 换头像写入面按可见性分档', 'js/avatar-lib.js', 'if (!r || (r.bottom > -80 && r.top < vh + 80)) applyTo(av);'],
  ['S12 = #1314l 屏外分片带轮次号作废', 'js/avatar-lib.js', 'const avGen = ++avApplyGen;'],
];
for (const [name, file, needle] of ANCHORS) {
  let text = '';
  try { text = readFileSync(join(root, file), 'utf8'); } catch (e) { text = ''; }
  chk('S ' + name + '（产物 ' + file + ' 内恰命中 1 次）', text.split(needle).length - 1 === 1, { hits: text.split(needle).length - 1 });
}

// ---------- 夹具：可解码的真体量 BMP（>64KB 才会被 #377/#455 大库 pass 令牌化进媒体池） ----------
function bmp(side) {
  const row = side * 3, pad = (4 - (row % 4)) % 4, px = row + pad, size = 54 + px * side;
  const b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(side, 18); b.writeInt32LE(side, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(px * side, 34);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const o = 54 + y * px + x * 3; b[o] = (x * 11 + y * 5) & 255; b[o + 1] = (x * 3 + y * 13) & 255; b[o + 2] = (x * 17 + y) & 255;
  }
  return 'data:image/bmp;base64,' + b.toString('base64');
}
const ST = Array.from({ length: 10 }, (_, i) => bmp(360 + i));   // 每张 ~390KB
const AV = Array.from({ length: 8 }, (_, i) => bmp(240 + i));    // 头像：正常量级，本身不令牌化
const FAKE_TOK = '@@m:' + '0123456789abcdef0123456789abcdef';    // 池里确实没有这一哈希

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(root, u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });

// 页内探针：按节点身份记每一笔 src 赋值（属性／属性描述符两条通道都盖），并记 load／error 归属
const PROBE = `(function(){
  if (window.__v1314) return true;
  window.__v1314 = { w: [], ev: [], seq: 0, ids: new WeakMap(), frame: 0 };
  // 帧号：只用来分「这一笔写入是在点按那一拍的同一次任务里、还是在后面的帧里」——屏外分片的判据
  (function tick() { window.__v1314.frame++; try { requestAnimationFrame(tick); } catch (e) {} })();
  function idOf(n){ var m=window.__v1314.ids; if(!m.has(n)) m.set(n, ++window.__v1314.seq); return m.get(n); }
  window.__v1314.idOf = idOf;
  function kind(n){
    if (document.getElementById('emoji-list') && document.getElementById('emoji-list').contains(n)) return 'emoji';
    if (document.getElementById('avlib-grid') && document.getElementById('avlib-grid').contains(n)) return 'avlib';
    if (n.closest && n.closest('.msg-av')) return 'bubble';
    return 'other';
  }
  // 「这一笔写入落下去的那一刻，这个节点画不画得出来」——写入面分档的判据按**写入当时**的几何量，
  //   不靠点按那一刻的节点身份快照：换头像那一路会顺带发一条系统消息，整窗消息可能因此重渲染，
  //   .msg-av 里的 img 被换成新节点（新 id）。拿旧快照的 id 集合去分类＝屏外那一档的写入全被当成
  //   「不认识的人」筛掉，实测读出 writes:14/offDone:0 而 V2 的 stale:0 照旧绿——那是尺子的盲区，
  //   不是修复没生效。未挂载（isConnected=false）算屏外： detached 节点根本画不出来。
  function visAt(n){
    if (!n.isConnected) return 0;
    var vh = window.innerHeight || 0; if (!vh) return 0;
    var r = null; try { r = n.getBoundingClientRect(); } catch (e) { return 0; }
    if (!r) return 0;
    return (r.bottom > -80 && r.top < vh + 80) ? 1 : 0;
  }
  var dp = Object.getOwnPropertyDescriptor(Element.prototype, 'setAttribute');
  Element.prototype.setAttribute = function(k,v){
    if (this.tagName==='IMG' && k==='src'){ var kk=kind(this); window.__v1314.w.push({ id: idOf(this), kind: kk, bv: kk==='bubble'?visAt(this):-1, tok: String(v).slice(0,4)==='@@m:', pay: String(v).slice(0,5)==='data:', fr: window.__v1314.frame, st: (new Error().stack||'').split('\\n').slice(1,4).map(function(s){return s.trim().replace(/https?:[^)]*\\//,'');}).join(' <- ') }); }
    return dp.value.call(this,k,v);
  };
  var dpp = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable:true, get: dpp.get, set: function(v){
    var kk=kind(this); window.__v1314.w.push({ id: idOf(this), kind: kk, bv: kk==='bubble'?visAt(this):-1, tok: String(v).slice(0,4)==='@@m:', pay: String(v).slice(0,5)==='data:', prop:1, fr: window.__v1314.frame, st: (new Error().stack||'').split('\\n').slice(1,4).map(function(s){return s.trim().replace(/https?:[^)]*\\//,'');}).join(' <- ') });
    dpp.set.call(this,v);
  }});
  // 每次「答不上来」都留下当时那一格的 src／data-src 形态（十几字符就够认形态）：
  //   光记 error 次数只能证「有格子坏过」，说不出坏之前写进去的是什么——两侧红条要能自证机制。
  ['load','error'].forEach(function(e){ document.addEventListener(e, function(x){ var t=x.target; if(!t||t.tagName!=='IMG') return; window.__v1314.ev.push({ ev:e, id:idOf(t), kind:kind(t), s:String(t.getAttribute('src')||'').slice(0,16), d:String((t.dataset && t.dataset.src) || '').slice(0,16) }); }, true); });
  window.__v1314.clr = function(){ window.__v1314.w.length = 0; window.__v1314.ev.length = 0; };
  // 按格子汇总：写入次数分布＋有没有哪一次写的是令牌＋当前 src 形态＋内核报过错的格子数
  window.__v1314.per = function(sel, kindWanted){
    var g = {}, hist = {}, tokWrites = 0, tokStacks = {};
    for (var j=0;j<window.__v1314.w.length;j++){ var x=window.__v1314.w[j]; if (kindWanted && x.kind!==kindWanted) continue; (g[x.id]=g[x.id]||[]).push(x); }
    for (var k in g){ hist[g[k].length]=(hist[g[k].length]||0)+1; for (var m=0;m<g[k].length;m++) if (g[k][m].tok) { tokWrites++; tokStacks[g[k][m].st]=(tokStacks[g[k][m].st]||0)+1; } }
    var imgs=[].slice.call(document.querySelectorAll(sel)), ready=0, tokNow=0, payNow=0, missNow=0;
    for (var i=0;i<imgs.length;i++){ var im=imgs[i]; var s=im.getAttribute('src')||'';
      if (s.indexOf('@@m:')===0) tokNow++;
      else if (s.indexOf('data:image/svg')===0 || (im.classList && im.classList.contains('media-tok-missing'))) missNow++; // #397 缺图占位
      else if (s.indexOf('data:')===0) payNow++;
      if (im.complete && im.naturalWidth>0) ready++; }
    var tokAll=0, tokPathAll={}; for (var a=0;a<window.__v1314.w.length;a++){ var wa=window.__v1314.w[a]; if(!wa.tok) continue; tokAll++; var kk=(wa.kind||'?'); tokPathAll[kk]=(tokPathAll[kk]||0)+1; }
    var errs=0, seen={}, bad={}; for (var e2=0;e2<window.__v1314.ev.length;e2++){ var x2=window.__v1314.ev[e2]; if (x2.ev!=='error'||(kindWanted&&x2.kind!==kindWanted)) continue; if (seen[x2.id]) continue; seen[x2.id]=1; errs++; var bk=(x2.s||'(空)')+' | ds:'+(x2.d||'(空)'); bad[bk]=(bad[bk]||0)+1; }
    return { nodes: Object.keys(g).length, hist: hist, tokWrites: tokWrites, tokWritesAll: tokAll, tokKind: tokPathAll, dom: imgs.length, ready: ready, tokNow: tokNow, payNow: payNow, missNow: missNow, errs: errs, bad: bad, tokStacks: tokStacks };
  };
  return true;})()`;
// 探针必须装在 document-start（addInitScript），不能等页面暖好再 evaluate 装：#907 的空闲预热排在
// load+4s，而「装探针」那一路本身要跑 3~6s——晚装的那一截写入与内核回执全都看不见。实测就是这个
// 盲区让 HEAD 侧的 P7 读出「零令牌写入＋10 次解码失败」（写在探针之前、错在之后），尺子量成
// 夹具的时序而不是被测量。探针自身幂等（window.__v1314 已在就直接返回），reload 每程重新装。
await ctx.addInitScript({ content: PROBE });

const SPLASH_STEP = `(function(){
  var mm=document.getElementById('splash-mandatory');
  if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll'); if(sc)sc.scrollTop=sc.scrollHeight;
    var m=document.getElementById('splash-mandatory-enter'); if(m&&!m.classList.contains('is-disabled')){m.click();return 'mc';} return 'mw';}
  var sp=document.getElementById('splash'); if(!sp||sp.classList.contains('hide')) return 'closed';
  var sb=document.getElementById('splash-box'); if(sb)sb.scrollTop=sb.scrollHeight;
  var se=document.getElementById('splash-enter'); if(se&&!se.disabled){se.click();return 'c';} return 'w';})()`;

async function dismissSplash(page) {
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(SPLASH_STEP);
    if (s === 'closed') break;
    await sleep(300);
  }
  await page.evaluate(() => {
    ['splash-mandatory', 'qa-mask', 'backup-remind-bar', 'modal-mask'].forEach((id) => { const e = document.getElementById(id); if (e) e.hidden = true; });
    const sp = document.getElementById('splash'); if (sp) { sp.classList.add('hide'); sp.hidden = true; }
    document.querySelectorAll('.modal-mask').forEach((m) => { m.hidden = true; });
    return true;
  });
  await sleep(400);
}
// 池视图（ownPoolCache）里是不是已经全是令牌——原始库键永远是内联串，别拿它当尺子
async function poolView(page) {
  return page.evaluate(() => {
    const gs = (window.getScopedGroups && window.getScopedGroups('sticker', 'own')) || [];
    const cards = (gs[0] && gs[0][1]) || [];
    let tok = 0;
    for (const c of cards) if (String(c).indexOf('@@m:') >= 0) tok++;
    const body = String(cards[0] || '').split('|||').pop();
    return { n: cards.length, tok, first: body.slice(0, 6), rawInline: (window.xyStore(window.activePrefix()).get('cc-groups') || '').indexOf('@@m:') < 0 };
  });
}
async function waitPoolTokenized(page, tries = 30) {
  let v = { n: 0, tok: 0 };
  for (let i = 0; i < tries; i++) {
    v = await poolView(page);
    if (v.n > 3 && v.tok === v.n) return v;
    await sleep(1500);
  }
  return v;
}
// prewarm＝#907 空闲预热开关；关掉才量得到「用户点开这一拍」（同 #1011 的隔离口径）
async function seedPage({ prewarm = false, fakeCell = -1, avatarWithTok = false } = {}) {
  const page = await ctx.newPage();
  const tokReq = [];
  page.on('request', (r) => { if ((r.url() || '').indexOf('@@m') >= 0) tokReq.push(r.url()); });
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.xyStore && !!window.activePrefix, null, { timeout: 40000 });
  await dismissSplash(page);
  const seed = await page.evaluate(({ st, av, pw, fake, preTok }) => {
    const s = window.xyStore(window.activePrefix());
    const cards = st.slice();
    if (fake >= 0) cards[fake] = preTok || '@@m:0123456789abcdef0123456789abcdef'; // 池里确缺的那一格（原始键直接落令牌）
    s.set('cc-groups', JSON.stringify({ text: [], kaomoji: [], emoji: [], sticker: [['G1', cards]], image: [], poke: [], voice: [] }));
    s.set('emoji-last', JSON.stringify({ mode: 'ta', ta: 'G1', mine: 'G1', pub: '' }));
    s.set('avatar-lib', JSON.stringify(av));
    s.set('cs-avatar-partner', av[0]); // 真实稳态：聊天头像已在用库里第 1 张＝气泡头像节点已带 img
    const msgs = [];
    for (let i = 0; i < 300; i++) msgs.push({ side: i % 2 ? 'in' : 'out', text: '历史消息 ' + i, ts: Date.now() - (300 - i) * 60000 });
    s.set('chat-msgs', JSON.stringify(msgs));
    // #907 那颗开关是**全局根键**（chat.js 读 xyStore('xy-home-v2')，contacts.js 把它列进 EXCLUDE
    // 不随桌面命名空间迁移）——写到 per-cid 作用域里等于没写，空闲预热照跑，「每次打开」那一拍
    // 就被预热盖住＝P1 假绿（实测：同一断言一次读到 10 次写入、一次只读到 2 次）。
    window.xyStore('xy-home-v2').set('chat-panel-prewarm', pw ? '1' : '0');
    if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite();
    return { scoped: ((window.getScopedGroups && window.getScopedGroups('sticker', 'own')) || []).map((g) => g[0] + ':' + g[1].length) };
  }, { st: ST, av: AV, pw: prewarm, fake: fakeCell, preTok: '' });
  await page.evaluate(() => { try { window.enterChat(); } catch (e) {} return true; });
  const v1 = await waitPoolTokenized(page); // 让令牌化 pass 真跑完（池视图全令牌）
  let tokForAvatar = '';
  if (avatarWithTok) tokForAvatar = await page.evaluate(() => {
    const gs = (window.getScopedGroups && window.getScopedGroups('sticker', 'own')) || [];
    const cards = (gs[0] && gs[0][1]) || [];
    return String(cards[0] || '').split('|||').pop();
  });
  if (avatarWithTok && tokForAvatar.indexOf('@@m:') === 0) {
    // 头像库里出现一枚真令牌（池里就有这张图）＝头像侧必须走同一把尺子，不是只有表情侧修了
    await page.evaluate(({ tok }) => {
      const s = window.xyStore(window.activePrefix());
      const lib = JSON.parse(s.get('avatar-lib') || '[]');
      lib[1] = tok;
      s.set('avatar-lib', JSON.stringify(lib));
      return true;
    }, { tok: tokForAvatar });
  }
  // 冷开＝整页重载（同会话里池 map 已暖，量不到「每次打开」那一拍）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.xyStore && !!window.activePrefix, null, { timeout: 40000 });
  await dismissSplash(page);
  await page.evaluate(() => { try { window.enterChat(); } catch (e) {} return true; });
  await sleep(2500);
  const v2 = await waitPoolTokenized(page);
  await page.evaluate(PROBE);
  // 令牌请求的计数窗只从「探针装好」起算：重载之前的那一程（种库＋首轮令牌化 pass）两侧都同样会留下
  // 请求，把它算进「每次打开那一拍」的账上＝尺子量的是夹具的时序而不是被测量。
  tokReq.length = 0;
  // 写入面的尺子要的是「整窗气泡头像已经在屏上排好」，历史消息是分批渲染的，没等齐就量＝nodes:0 假绿
  let avatars = 0;
  for (let i = 0; i < 30; i++) {
    avatars = await page.evaluate(() => document.querySelectorAll('#chat-body .msg-in .msg-av img').length);
    if (avatars > 10) break;
    await sleep(1500);
  }
  return { page, tokReq, seed, v1, v2, tokForAvatar, avatars };
}
async function openEmoji(page, ms = 4500) {
  await page.evaluate(async (t) => {
    document.getElementById('chat-emoji-btn').click();
    await new Promise((r) => setTimeout(r, t));
  }, ms);
}
async function closeEmoji(page, ms = 800) {
  await page.evaluate(async (t) => {
    if (window.closeEmojiPanelForInsert) window.closeEmojiPanelForInsert();
    await new Promise((r) => setTimeout(r, t));
  }, ms);
}
async function openAv(page, ms = 3500) {
  await page.evaluate(async (t) => {
    window.openAvlib();
    await new Promise((r) => setTimeout(r, t));
  }, ms);
}
async function closeAv(page, ms = 800) {
  await page.evaluate(async (t) => {
    window.closeAvlib();
    await new Promise((r) => setTimeout(r, t));
  }, ms);
}
// ================= 冷开（＝手机上每次重进 App）：表情面板首屏 =================
const A = await seedPage();
console.log('池视图（种完后 / 重载后）', JSON.stringify({ v1: A.v1, v2: A.v2 }));
chk('S0 夹具真实：表情库的大贴纸在**池视图**里确实全是令牌（原始库键保持内联＝#377/#455 的口径）；重载后仍是稳态',
  A.v1.n > 3 && A.v1.tok === A.v1.n && A.v2.n > 3 && A.v2.tok === A.v2.n && A.v1.rawInline === true, { v1: A.v1, v2: A.v2 });
await A.page.evaluate(() => window.__v1314.clr());
await openEmoji(A.page);
const e1 = await A.page.evaluate(() => window.__v1314.per('#emoji-list img', 'emoji'));
console.log('冷开表情面板', JSON.stringify(e1));
chk('P1 表情面板首屏：每个格子只被交一次图（写入次数分布全为 1；HEAD＝每格 2 次＝先坏再解）',
  e1.nodes > 3 && Object.keys(e1.hist).every((k) => Number(k) === 1), { hist: e1.hist, nodes: e1.nodes });
chk('P2 全程没有任何一次「把令牌当 src 写」的赋值（HEAD＝每格一次，正是那发多余请求的源头）',
  e1.tokWrites === 0, { tokWrites: e1.tokWrites, tokStacks: e1.tokStacks });
chk('P3 内核一次都没有为令牌发请求（相对 URL 必 404 那一发；HEAD≥1）',
  A.tokReq.length === 0, A.tokReq.slice(0, 3));
chk('P4 首屏格子亮着的是真载荷、没有停在令牌态（面板显示的必须是图）',
  e1.payNow > 3 && e1.tokNow === 0, { payNow: e1.payNow, tokNow: e1.tokNow, ready: e1.ready });
chk('P4b 表情格子零内核解码失败（HEAD＝每格先对令牌报一次错＝用户所见那一下闪；这条就是症状本体）',
  e1.errs === 0, { errs: e1.errs, dom: e1.dom });
// 二次开＝#457/#547 指纹短路，本批不许把它弄坏（写了才是真「每次打开都重载」）
await closeEmoji(A.page);
await A.page.evaluate(() => window.__v1314.clr());
await openEmoji(A.page, 2500);
const e2 = await A.page.evaluate(() => window.__v1314.per('#emoji-list img', 'emoji'));
chk('P5 二次开面板零 src 写入（#457/#547 短路没被本批改坏）', Object.keys(e2.hist).length === 0, e2.hist);
// ================= 头像互动半框 =================
await closeEmoji(A.page, 400);
await openAv(A.page);
const a1 = await A.page.evaluate(() => window.__v1314.per('#avlib-grid img', 'avlib'));
chk('A1 头像半框首开：每格至多一次写入（不许从 1 变成 2）',
  a1.tokWrites === 0 && Object.keys(a1.hist).every((k) => Number(k) <= 1), { hist: a1.hist, tokWrites: a1.tokWrites });
await closeAv(A.page);
await A.page.evaluate(() => window.__v1314.clr());
await openAv(A.page, 2500);
const a2 = await A.page.evaluate(() => window.__v1314.per('#avlib-grid img', 'avlib'));
chk('A2 头像半框二次开零写入（#907 keep-alive＋#508/#509 复用短路都在位）', Object.keys(a2.hist).length === 0, a2.hist);
// ================= V 组：点选换头像的写入面 =================
// 判据取「同一批写入里的先后」：可见的那几个必须写在任何一个屏外节点之前（V1），屏外那一批必须落在
// 之后的帧里（V2b）。不取「点按后 sleep 250ms 再数总数」＝假绿（分片几十毫秒就补完，修好的和没修的
// 累计数一模一样，本脚本第一版就栽在这儿）；也不取「同一次同步任务里写了几个」＝空心（真点那一路的
// 落笔发生在压缩回执之后的一次任务里，点按当场一个都没写，见 tools 里记下的取证栈）。
// 另一条夹具课：新页面与 A 同一个 context＝同一份存储，那边一写 store 就把 A 的聊天窗口打回重渲染，
// 而 A 处在后台页（rAF 停摆）时那一轮分批渲染会停在 0 个节点上 ⇒ V 组先把 A 带回前台、等窗口排好，
// 否则 nodes:0 会让整组断言假绿。
await A.page.bringToFront();
// ⚠️ 「可用轮」判据（2026-09-27 落库轮实测）：点按那一路可能正好赶上**整窗重渲染**（换头像要补发一条
//   系统消息），重渲染出来的气泡节点是 innerHTML 里带着 src 落地的＝任何 src 赋值探针都看不见那一档，
//   于是那一轮如实读成 {"writes":12,"visDone":12,"offDone":0,"nodes":6} 而 V2 的 stale:0 照旧绿。拿这种
//   轮次去判 V1/V2b＝把夹具的时序问题报成「修复没生效」。收口＝整轮重来（最多三轮），只有「这一批写入
//   里既数到可见的、也数到屏外的（去重节点数 ≥10）」那一轮才拿去判；三轮都不构成写入面就照最后一次
//   读数判红（不许悄悄挑一轮好看的）。两侧同一把尺子，纯 tip 侧的整窗一次写完形态天然满足前置。
let V0 = { nodes: 0, visible: 0, pre: null };
let V1 = { writes: 0, visDone: 0, offDone: 0, nodes: 0 };
const vAttempts = [];
for (let attempt = 0; attempt < 3; attempt++) {
  let winReady = 0;
  for (let i = 0; i < 20; i++) {
    winReady = await A.page.evaluate(() => document.querySelectorAll('#chat-body .msg-in .msg-av img').length);
    if (winReady > 10) break;
    await sleep(1500);
  }
  console.log('V 组前置·第 ' + (attempt + 1) + ' 轮：整窗气泡头像', winReady);
  await closeAv(A.page);
  await openAv(A.page, 2500);
  V0 = await A.page.evaluate(() => {
  const box = document.getElementById('chat-body');
  const all = [].slice.call(box.querySelectorAll('.msg-in .msg-av img'));
  const vh = window.innerHeight;
  const vis = all.filter((im) => { const r = im.getBoundingClientRect(); return r.bottom > -80 && r.top < vh + 80; });
  window.__v1314.clr();
  // 靶格按**值**挑，不按固定序号：#617 的守卫是「值没变＝DOM 一律不碰」，现用头像恰好与库里某一格
  //   同值时点它＝整窗一次都不写（实测读出 writes:14／offDone:0 而 V2 照旧绿），那是夹具没构成
  //   写入面这一事实，不是修复没生效。取第一格「内联且末 24 字符与现头像不同」的（避开 V3 那一格，
  //   好让 V3 的「连着再换一张」真是一次换值）。
  const cur = (all[0] && all[0].getAttribute('src')) || '';
  const tailOf = (s) => (s.indexOf('data:') === 0 ? s.slice(-24) : '');
  const cells = [].slice.call(document.querySelectorAll('#avlib-grid .avlib-cell img'));
  let idx = -1;
  for (let i = 0; i < cells.length; i++) {
    if (i === 5) continue;
    const s = cells[i].getAttribute('src') || '';
    if (tailOf(s) && tailOf(s) !== tailOf(cur)) { idx = i; break; }
  }
  if (idx < 0) idx = 3;
  const cell = cells[idx];
  const cellSrc = cell.getAttribute('src') || '';
  const dist = {}; let sameAsCell = 0, flagged = 0;
  for (const im of all) { const s = (im.getAttribute('src') || '').slice(0, 18); dist[s] = (dist[s] || 0) + 1; if ((im.getAttribute('src') || '') === cellSrc) sameAsCell++; }
  for (const x of box.querySelectorAll('.msg-in .msg-av')) if (x.__avApplied !== undefined) flagged++;
  const pre = { pick: idx, cells: cells.length, cellLen: cellSrc.length, cellForm: cellSrc.slice(0, 6), sameAsCell, flagged, dist: Object.entries(dist).slice(0, 3) };
  cell.click(); // 真点：换成这一格
  return { nodes: all.length, visible: vis.length, pre };
});
console.log('点选换头像·屏上/整窗', JSON.stringify(V0));
if (process.env.V1314DIAG) {
  await sleep(2500);
  console.log('DIAG 写入面', JSON.stringify(await A.page.evaluate(() => {
    const w = window.__v1314.w;
    const byKind = {}; for (const x of w) byKind[x.kind] = (byKind[x.kind] || 0) + 1;
    const b = w.filter((x) => x.kind === 'bubble');
    return { byKind, first: b.slice(0, 6).map((x) => [x.id, x.bv, x.fr, x.pay ? 'pay' : x.tok ? 'tok' : '?', x.st]), last: b.slice(-4).map((x) => [x.id, x.bv, x.fr, x.prop ? 'prop' : 'attr']) };
  })));
}
V1 = { writes: 0 };
for (let i = 0; i < 25; i++) {
  await sleep(600);
  V1 = await A.page.evaluate(() => {
    const seq = window.__v1314.w.filter((x) => x.kind === 'bubble');
    let lastVis = -1, firstOff = -1, maxVisFr = -1, minOffFr = -1, visDone = 0, offDone = 0, fmin = 1e9, fmax = -1;
    seq.forEach((x, i) => {
      if (x.fr < fmin) fmin = x.fr;
      if (x.fr > fmax) fmax = x.fr;
      if (x.bv === 1) { visDone++; lastVis = i; if (x.fr > maxVisFr) maxVisFr = x.fr; }
      else { offDone++; if (firstOff < 0) firstOff = i; if (minOffFr < 0 || x.fr < minOffFr) minOffFr = x.fr; }
    });
    return { writes: seq.length, visDone, offDone, lastVis, firstOff, maxVisFr, minOffFr, span: fmax - fmin, nodes: new Set(seq.map((x) => x.id)).size };
  });
  if (V1.offDone > 0 && V1.visDone > 0 && i > 1) {
    const again = await A.page.evaluate(() => window.__v1314.w.filter((x) => x.kind === 'bubble').length);
    if (again === V1.writes) break; // 这批写入已结算
  }
}
console.log('点选换头像·这一批写入的先后', JSON.stringify(V1));
  vAttempts.push({ round: attempt + 1, nodes: V0.nodes, visible: V0.visible, writes: V1.writes, visDone: V1.visDone, offDone: V1.offDone, uniqNodes: V1.nodes });
  if (V1.nodes >= 10 && V1.visDone > 0 && V1.offDone > 0) break; // 这一轮真的数到了两档写入
}
console.log('V 组各轮读数', JSON.stringify(vAttempts));
chk('V0 夹具真实：整窗气泡头像已排好，且屏外格子确实存在（否则「写入面」无从谈起）',
  V0.nodes > 10 && V0.visible > 0 && V0.visible < V0.nodes / 2, V0);
chk('V0b 写入面被尺子数到：拿去判的那一轮里可见与屏外两档都有写入（去重节点 ≥10）——点按赶上整窗重渲染时这一轮作废、重来',
  V1.nodes >= 10 && V1.visDone > 0 && V1.offDone > 0, { attempts: vAttempts, V1 });
chk('V1 可见的那几个排在整批写入最前面：第一个屏外写入的序号晚于最后一个可见写入（HEAD＝按 DOM 序整窗一次写完，聊天停在底部＝看得见的那几个恰恰排在最后）',
  V1.offDone > 0 && V1.firstOff > V1.lastVis, V1);
chk('V1b 可见的气泡头像一个都不许漏（分片不许把用户看得见的那几个推后到结算窗之外）',
  V1.visDone >= V0.visible, V1);
chk('V2b 屏外那一批确实落在可见那一档之后的帧里（把主线程从「一次 100 个」拆开；HEAD＝同一次任务写完，帧号不可能更大）',
  V1.minOffFr > V1.maxVisFr && V1.span >= 1, V1);
const V2 = await A.page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 1500)); // 分片补齐窗口
  const all = [].slice.call(document.querySelectorAll('#chat-body .msg-in .msg-av img'));
  const want = all.length ? (all[0].getAttribute('src') || '') : '';
  let same = 0, stale = 0;
  for (const im of all) { const s = im.getAttribute('src') || ''; if (s === want) same++; else stale++; }
  return { nodes: all.length, same, stale };
});
chk('V2 屏外节点在补齐窗口内全部落到新头像（不留旧头像＝分片不是「干脆不画」）',
  V2.stale === 0 && V2.nodes > 10, V2);
const V3 = await A.page.evaluate(async () => {
  window.openAvlib(); await new Promise((r) => setTimeout(r, 1800));
  document.querySelectorAll('#avlib-grid .avlib-cell img')[5].click(); // 连着再换一张：第 6 张
  await new Promise((r) => setTimeout(r, 1600));                         // 旧一轮的剩余分片不许盖掉新值
  const all = [].slice.call(document.querySelectorAll('#chat-body .msg-in .msg-av img'));
  const srcs = {};
  for (const im of all) { const s = (im.getAttribute('src') || '').slice(-8); srcs[s] = (srcs[s] || 0) + 1; }
  window.closeAvlib();
  await new Promise((r) => setTimeout(r, 400));
  return { nodes: all.length, kinds: Object.keys(srcs).length };
});
chk('V3 连续两次换头像：最终整窗只剩「最后一次」那一个值（旧轮次分片不许偷走新数据）',
  V3.kinds === 1, V3);
// V4＝#617 的「不拆节点」契约。刻意不写成「点已在用的那张＝零写入」：那一路每次都过一次重压缩
//   （BMP 库图 → 256px JPEG），第二次的值与第一次并不逐字相同，所以「有写入」是正当的；正当的契约
//   是「值变了也只改现有 img 的 src，不许拆掉节点」（拆节点＝该位置空一帧＋从零解码＝用户所见闪）。
const V4 = await A.page.evaluate(async () => {
  window.openAvlib(); await new Promise((r) => setTimeout(r, 1800));
  const before = [].slice.call(document.querySelectorAll('#chat-body .msg-in .msg-av img'));
  window.__v1314.clr();
  document.querySelectorAll('#avlib-grid .avlib-cell img')[5].click(); // 再点同一张（已在用）
  await new Promise((r) => setTimeout(r, 1600));
  const now = [].slice.call(document.querySelectorAll('#chat-body .msg-in .msg-av img'));
  let replaced = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== now[i]) replaced++;
  const srcs = {};
  for (const im of now) { const s = (im.getAttribute('src') || '').slice(-8); srcs[s] = (srcs[s] || 0) + 1; }
  window.closeAvlib();
  return { nodes: before.length, replaced, kinds: Object.keys(srcs).length, writes: window.__v1314.w.length };
});
console.log('再点一次·节点身份', JSON.stringify(V4));
chk('V4 再点一次也不拆气泡节点（#617「只改现有 img 的 src」还在位；拆节点＝空一帧＋从零解码）',
  V4.nodes > 10 && V4.replaced === 0 && V4.kinds === 1, V4);
// ================= A3/A4：头像库里出现池令牌＝头像侧同尺 =================
const B = await seedPage({ avatarWithTok: true });
const hasTokAv = B.tokForAvatar.indexOf('@@m:') === 0;
await B.page.evaluate(() => window.__v1314.clr());
await openAv(B.page, 3500);
const b1 = await B.page.evaluate(() => window.__v1314.per('#avlib-grid img', 'avlib'));
const bPanel = await B.page.evaluate(() => { const p = document.getElementById('avlib-card'); return { hidden: p ? p.hidden : null }; });
console.log('头像侧令牌格', JSON.stringify({ hasTokAv, b1, bPanel, req: B.tokReq.length }));
chk('A3 头像侧同尺：库里出现池令牌时没有任何一格把令牌当 src 写过、内核也没为它发请求（表情侧修了、头像侧漏了＝覆盖式修补）',
  hasTokAv && b1.tokWrites === 0 && B.tokReq.length === 0, { hasTokAv, tokWrites: b1.tokWrites, req: B.tokReq.length, tokStacks: b1.tokStacks });
chk('A4 面板照常亮着，且那一格最终拿到的是真载荷（修「少一次写入」不许把格子挂空）',
  bPanel.hidden === false && b1.ready > 3 && b1.payNow > 3, { hidden: bPanel.hidden, ready: b1.ready, payNow: b1.payNow });
await B.page.close();
// ================= P6 池确实缺失：旧语义仍在（交回令牌／#397 占位接手、面板不挂死） =================
const C = await seedPage({ fakeCell: 2 });
await C.page.evaluate(() => window.__v1314.clr());
await openEmoji(C.page, 5000);
const p6 = await C.page.evaluate(() => {
  const r = window.__v1314.per('#emoji-list img', 'emoji');
  const p = document.getElementById('emoji-panel');
  return { ...r, hidden: p ? p.hidden : null };
});
console.log('池确缺那一格', JSON.stringify(p6));
chk('P6 池确实没有的格子：令牌照旧交回 src／#397 占位接手，其余格子照常出图、面板照常显示（修「少一次写入」不许修掉缺数据自愈）',
  p6.hidden === false && p6.payNow >= p6.dom - 1 && (p6.tokNow + p6.missNow) >= 1,
  { hidden: p6.hidden, dom: p6.dom, payNow: p6.payNow, tokNow: p6.tokNow, missNow: p6.missNow });
await C.page.close();
// ================= P7 空闲预热那一腿（#907 开关默认开＝用户常态） =================
const D = await seedPage({ prewarm: true });
const p7 = await D.page.evaluate(async () => {
  window.closeEmojiPanelForInsert && window.closeEmojiPanelForInsert();
  await new Promise((r) => setTimeout(r, 12000)); // 让空闲预热自己跑完（load+4s 起）——全程不点面板
  const r = window.__v1314.per('#emoji-list img', 'emoji');
  const p = document.getElementById('emoji-panel');
  return { ...r, hidden: p ? p.hidden : null };
});
console.log('空闲预热（没点面板）', JSON.stringify(p7));
chk('P7 空闲预热那一腿同尺：整页零「把令牌当 src 写」的赋值、零令牌请求、零内核解码失败（面板里落 src 的入口漏一处＝用户从那一路照样闪；HEAD≥1）',
  p7.tokWritesAll === 0 && D.tokReq.length === 0 && p7.errs === 0, { tokWritesAll: p7.tokWritesAll, tokKind: p7.tokKind, req: D.tokReq.length, errs: p7.errs, bad: p7.bad });
chk('P7b 预热确实把面板画好了（不是「干脆不预热」换来的零请求）', p7.dom > 3 && p7.payNow > 3 && p7.hidden === true, { dom: p7.dom, payNow: p7.payNow, hidden: p7.hidden });
await D.page.close();

const jsErr = await A.page.evaluate(() => (window.__jsErrors || []).length);
chk('Z1 全程零未捕获异常', jsErr === 0, jsErr);
await A.page.close();
await browser.close();
server.close();
console.log('结果: 绿 ' + pass + ' / 红 ' + fail);
process.exit(fail ? 1 : 0);
