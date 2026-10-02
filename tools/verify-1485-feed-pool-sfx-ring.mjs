// ===== 专项回归：多联系人下 TA 朋友圈/评论读空池（#1485a~e）＋ 通话自定义铃声大键空窗不响（#1485f~h，v8.56） =====
// 用法：node tools/verify-1485-feed-pool-sfx-ring.mjs [被测根目录]
//   首行打印被测根目录；同尺 A/B 分别指向「含本批的副本」与「纯 HEAD 副本」。
// 作者报障（一加 Ace3／Edge，明说其他机型也有）：①「存在多个联系人时，与其中一位对话，
//   另一方发的朋友圈会反复发送颜文字只有颜文字，没有使用正常聊天该使用的字卡」；
//   ②「语音通话时自定义铃声有时候会不响」。
// 根因一（feed）：非当前桌面的 cc-groups 是 IDB-only 大键（>200KB 从不落 LS），启动回填
//   不轮到非活跃桌面、切后台又被 #1195e 放掉内存副本；cardPool(cid) 同步读池交出空库，
//   而 getCustomCardsFor 里 hydrateLibForCid 是 fire-and-forget——「先发起取回、立刻读池」
//   把「没读到」当成「这个桌面没字卡」：文字桶全靠兜底句，点缀段只剩默认/自带颜文字。
//   修＝生成前 poolReadyFor(cid) 等取回落定（发动态 / TA 评论回应 / 回应我的回复 / 各桌面
//   TA 首评四条生成链全接）。
// 根因二（sfx）：sfx-ring 同为 IDB-only 大键，空窗期 playSfx('ring') 同步读空＝旧代码落内置
//   段，而上传自定义时内置选择已被清掉（handleUpload remove BKEYS）⇒ 内置段同样无声。
//   修＝先问数据层证人（awaitingBigKey），本该有数据就 whenBigKeyBack 异步回读、回来走同一
//   条自定义播放链；确无此键/问不出结果才按内置段收场（「没设过=静音」设计不变），代次闸
//   防接听/挂断后迟响双响。
// 断言分四类：S＝逻辑锚（产物侧八针）；F＝feed 行为（种第二个联系人 + B 桌面字卡大键，
//   制造空窗后让 B 的 TA 评论，断言评文出自 B 池文字卡而非兜底句）；R＝sfx 行为（种
//   sfx-ring 大键并制造空窗，断言补读后自定义链真的构造了 Audio；不种时两侧都保持静音）；
//   Z＝链路零未捕获异常。
// 纯 HEAD 侧预期：S1~S8、F1、R2 恰全本批新契约＝判别力实证；F0/R0/R1/R3/R4/Z 两侧皆绿。
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
const feedArtifact = readFileSync(join(ROOT, 'js', 'feed.js'), 'utf8');
const sfxArtifact = readFileSync(join(ROOT, 'js', 'sfx.js'), 'utf8');

const CID_B = 'cidB1484';
const B_CARD = 'M1484B池文字卡·甲';
// B 桌面字卡库：text 一张可读卡＋sticker 垫料（非 data: 会被媒体守卫滤出池，只负责把
// 整键顶过 256KB 释放线，让 idbMemoReleaseBig 能在切后台口径下放掉它）
const PAD = '垫'.repeat(300000); // 字符串 length 30 万 > 256KB 释放线（idbMemoReleaseBig 按 length 口径）
// 垫料放 fish（功能字卡分类）：getCustomCardsFor 展平通用池时明确排除功能分类 ⇒ 它只负责把整键顶过 256KB 释放线、绝不会被抽进文字池
const B_GROUPS = JSON.stringify({ text: [['B组', [B_CARD]]], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [], fish: [['垫', [PAD]]] });
// 本自然周内的种子时间（动态别被月度折叠吃掉）
const T = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() + 60000; })();
const POST_ID = 'f_1484_probe';
const LS_MAIN = 'xy-home-v2:feed-posts';
const mkPost = () => ({ id: POST_ID, role: 'ta', owner: CID_B, authorName: '乙', authorAv: '', taName: '乙', taAv: '', content: 'B 桌面的种子动态', imgs: [], ts: T, likes: [], comments: [] });

const browser = await chromium.launch();
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// —— 页内脚手架（__v1484seed 幂等；Audio 包装先于一切业务脚本）——
function initSrc() {
  return `(function(){
    if (localStorage.getItem('__v1484seed') === '1') return;
    try { localStorage.clear(); } catch (e) {}
    localStorage.setItem('__v1484seed', '1');
    // 两个联系人：当前桌面 default ＋ 另一桌面 cidB1484
    localStorage.setItem('xy-home-v2:contacts', JSON.stringify([{ id: 'default', name: '甲' }, { id: '${CID_B}', name: '乙' }]));
    localStorage.setItem('xy-home-v2:active-contact', 'default');
    // B 桌面的朋友圈回应设置：评论概率拉满、点赞关、回应延迟 1~2s
    localStorage.setItem('xy-home-v2:${CID_B}:reply-fd-comment-prob', '100');
    localStorage.setItem('xy-home-v2:${CID_B}:reply-fd-likeback-prob', '0');
    localStorage.setItem('xy-home-v2:${CID_B}:reply-fd-reply-prob', '0');
    localStorage.setItem('xy-home-v2:${CID_B}:reply-fd-comment-speed-min', '1');
    localStorage.setItem('xy-home-v2:${CID_B}:reply-fd-comment-speed-max', '2');
    // 种子动态（B 桌面 TA 发的，朋友圈共享层）
    localStorage.setItem('xy-home-v2:feed-posts', JSON.stringify([${JSON.stringify(mkPost())}]));
  })()`;
}
// Audio 包装：记录每一次 new Audio(src)（红侧空窗期一次都不该发生）
const audioSpy = `(function(){
  var OA = window.Audio;
  window.__audioLog = [];
  window.Audio = function (src) { if (src !== undefined && src !== null) window.__audioLog.push(String(src)); return new OA(src); }; // 只记带 src 的构造：bg-keep 保活音频是无参 new Audio()，别让它污染断言
  window.Audio.prototype = OA.prototype;
})()`;
async function session() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(initSrc());
  await ctx.addInitScript(audioSpy);
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
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
// 把 B 桌面字卡库写进 IDB 并等提交回执，再按切后台口径释放内存副本 ⇒ 复现同步读空窗
async function seedAndDrop(page) {
  return page.evaluate(`(async function(){
    var out = {};
    window.xyStore('xy-home-v2:${CID_B}').set('cc-groups', ${JSON.stringify(B_GROUPS)});
    await new Promise(function (r) { setTimeout(r, 400); });
    var v = await window.idbGet('xy-home-v2:${CID_B}:cc-groups');
    out.idbHas = !!(v && String(v).indexOf(${JSON.stringify(B_CARD)}) >= 0);
    out.dropped = window.idbMemoReleaseBig();
    out.blindRead = window.storeFor('${CID_B}').get('cc-groups') === null;
    return out;
  })()`);
}
async function commentAsMe(page) {
  const a = await page.evaluate(`(function(){ var b=document.querySelector('.feed-act[data-comment="${POST_ID}"]'); if(!b) return 'no-btn'; b.click(); return 'ok'; })()`);
  await sleep(500);
  const b = await page.evaluate(`(function(){ var i=document.getElementById('feed-comment-input'); if(!i) return 'no-input'; i.value='测试评论'; return 'ok'; })()`);
  await sleep(200);
  const c = await page.evaluate(`(function(){ var s=document.getElementById('feed-comment-send'); if(!s) return 'no-send'; s.click(); return 'ok'; })()`);
  await sleep(600);
  return a + '/' + b + '/' + c;
}
async function lastComment(page) {
  return page.evaluate(`(function(){
    try {
      var raw = window.xyStore('xy-home-v2').get('feed-posts') || localStorage.getItem('${LS_MAIN}');
      var arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      var p = arr.find(function (x) { return x.id === '${POST_ID}'; }) || arr[0];
      var cs = (p && p.comments) || [];
      var last = cs[cs.length - 1];
      return { n: cs.length, last: last ? String(last.content).slice(0, 120) : '' };
    } catch (e) { return { err: String(e) }; }
  })()`);
}

// ================= S 组：逻辑锚（产物侧） =================
check('S1 poolReadyFor 原语判据在产物（删＝回到「先发起取回、立刻读空池」）', feedArtifact.includes('if (cid === cur || !window.hydrateLibForCid) { cb(); return; }'));
check('S2 TA 发动态先等池再生成（buildPost 装进 poolReadyFor 回调）', feedArtifact.includes('try { buildPost(); } catch (eB) {}'));
check('S3 TA 回应我的回复：同一条等待', feedArtifact.includes('poolReadyFor(tcOwner, function () { try {'));
check('S4 TA 评论回应：同一条等待', feedArtifact.includes("poolReadyFor(p.owner || 'default', function () { try {"));
check('S5 各桌面 TA 首评：同一条等待', feedArtifact.includes('} catch (eF) {} });'));
check('S6 铃声空窗补读的证人问询（awaitingBigKey）', sfxArtifact.includes('sst.awaitingBigKey && sst.awaitingBigKey(KEYS.ring)'));
check('S7 空窗补读接线 whenBigKeyBack（回来走同一条自定义播放链）', sfxArtifact.includes('sst.whenBigKeyBack(KEYS.ring, tryCustom)'));
check('S8 接听/挂断作废在飞补读（代次闸）', sfxArtifact.includes('ringReadGen++'));
check('S9 旧契约不动：v3.26.x 的 Blob 优先链与失败回落仍在（本批只提级共用，不许退化）', sfxArtifact.includes('先回收旧 URL，再挂新 URL') && sfxArtifact.includes('if (wasLoop) playBuiltin(ringBuiltinFallbackId(), true);'));

// ================= F 组：feed 行为（B 桌面字卡大键空窗 ⇒ TA 评论必须出自 B 池） =================
{
  const { ctx, page, errs } = await session();
  const sd = await seedAndDrop(page);
  check('F0 前提：B 字卡库已进 IDB、释放后内存副本确实不在（idbGetCached 纯缓存口，不触发 #1349a 补踢）', sd.idbHas === true && sd.blindRead === true, sd);
  const cm = await commentAsMe(page);
  await page.evaluate('window.idbMemoReleaseBig()'); await sleep(300); // 压掉同步段死代码预热的库副本（红侧判别面前提）
  // 评论概率 100＋Math.random 钉 0 ⇒ TA 分支必走；延迟 1~2s＋取回时间，轮询 15s 封顶
  let lc = { n: 0, last: '' };
  for (let i = 0; i < 15; i++) { await sleep(1000); lc = await lastComment(page); if (lc.n >= 2) break; }
  check('F1 夹具真实：评论提交与 TA 回应都到达（红绿两侧同读数）', cm.indexOf('no-') < 0 && lc.n >= 2, { cm, lc });
  check('F2 TA 评文出自 B 桌面字卡池（等池生效；纯 HEAD 此处读空池落兜底句）', String(lc.last).indexOf(B_CARD) >= 0, lc);
  check('Z1 feed 链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

// ================= R 组：sfx 行为（sfx-ring 大键空窗 ⇒ 补读后自定义链必须出声路径） =================
{
  const { ctx, page, errs } = await session();
  const sd = await page.evaluate(`(async function(){
    var out = {};
    window.xyStore('xy-home-v2:default').set('sfx-ring', 'data:audio/mpeg;base64,' + 'AA'.repeat(180000));
    await new Promise(function (r) { setTimeout(r, 400); });
    var v = await window.idbGet('xy-home-v2:default:sfx-ring');
    out.idbHas = !!v;
    out.dropped = window.idbMemoReleaseBig();
    out.blindRead = window.idbGetCached('xy-home-v2:default:sfx-ring') === undefined;
    return out;
  })()`);
  check('R0 前提：sfx-ring 已进 IDB、释放后内存副本确实不在（idbGetCached 纯缓存口）', sd.idbHas === true && sd.blindRead === true, sd);
  await page.evaluate('window.playSfx("ring")');
  let log = [];
  for (let i = 0; i < 12; i++) { await sleep(500); log = await page.evaluate('window.__audioLog'); if (log.length) break; }
  check('R1 空窗期来电：补读回库后自定义播放链真的构造了 Audio（纯 HEAD 此处一声不响）', log.some(function (s) { return s.indexOf('blob:') === 0 || s.indexOf('data:') === 0; }), log);
  check('R2 接听即停不再响：stopSfx 后新构造数不增长（代次闸作废在飞补读）', await page.evaluate('(function(){ window.stopSfx("ring"); var n=window.__audioLog.length; return new Promise(function(r){ setTimeout(function(){ r(window.__audioLog.length === n); }, 1800); }); })()'));
  check('Z2 sfx 链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}
// R3 静音不变量：真没设过铃声（无键）两侧都保持静音（「没设过=静音」是 v3.7.x 设计）
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(initSrc());
  await ctx.addInitScript(audioSpy);
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await enter(page);
  await page.evaluate('window.playSfx("ring")');
  await sleep(2500); // 越过 1.6s 超时兜底（确无此键 ⇒ 内置段，bid 空＝静音）
  const log = await page.evaluate('window.__audioLog');
  check('R3 没设过铃声：两侧都静音（不许把「缺省静音」改成乱响）', log.length === 0, log);
  check('Z3 静音链路零未捕获异常', errs.length === 0, errs.slice(0, 3));
  await ctx.close();
}

const pass = results.filter((r) => r.ok).length;
console.log('—— 结果：' + pass + '/' + results.length + ' ——');
if (pass !== results.length) process.exitCode = 1;
await browser.close();
server.close();
