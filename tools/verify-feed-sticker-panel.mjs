// ===== 回归脚本：#669 朋友圈贴纸面板「不能像表情包面板那样打开分类」＋「没有联系人用的 emoji 贴纸」
//       ＋「点桌面朋友圈图标进页有点卡顿」=====
// 用法：node build.mjs && node tools/verify-feed-sticker-panel.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-feed-sticker-panel.mjs   （测临时构建副本，红绿对照）
// 背景（用户报障，红米K80 Chrome，明说「其他设备型号也有出现」，并要求不要覆盖修改引发跨机型反复）：
//   ①贴纸面板是一块平铺网格（feedAllStickers 把 TA/我的分组拍平），没有分组可点、看不到分组名；
//   ②面板只列图片贴纸，而 TA 回贴时 30% 贴 emoji（feedTaPickSticker 里那组硬编码 emoji）＝
//     「里面没有联系人用的 emoji 贴纸」；
//   ③桌面图标每次点击都走 openFeedPage → render() 整包重建列表（实测 200 条动态＝4.0MB 标记，
//     CPU 节流 4× 下冷开 281ms、再开 368ms，Profiler 里 set innerHTML 占绝对多数）。
// 修复：分组胶囊栏（默认「全部」＝原平铺行为）+ emoji 贴纸分组（与 TA 回贴共用 FEED_STICKER_EMOJI）
//   + 渲染签名（内容未变跳过整包重建，数据一变签名即变、绝不显示旧数据）。
// FIX 2026-09-19 #798 用户再报「【emoji贴纸】组贴纸不全，没有联系人默认可以使用的全部 emoji 贴纸」——
//   #669 那组常量只有 10 个，而联系人聊天/朋友圈里贴的 emoji 出自「emoji 字卡」池（自建优先，否则系统
//   预设 emoji 分类 7 组）。改为 feedStickerEmojiPool() 与回复池同源，常量退为兜底；TA 回贴走同一函数。
//   新增 C 组断言验这条同源链：C1 有自建 emoji 字卡 → 面板只剩自建那几张（预设不混入）；
//   C2 关掉默认字卡「朋友圈使用」且无自建 → 回落常量 10 个（不越权列预设）。
// 断言面：A 源码锚 / B 面板分类与 emoji 贴纸全流程（真实 UI 点击）/ P 渲染签名行为（留存与失效）/
//   C emoji 池来源 / E 零 JS 异常。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const feedSrc = (() => { try { return readFileSync(join(root, 'src', 'js', 'feed.js'), 'utf8'); } catch (e) { return ''; } })();

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-669-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; return; }
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
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 种子：一条带配图的 TA 动态；TA 的字卡库「表情包」两组（搞怪 2 张 / 可爱 1 张）；
//       我的表情包一组（我的 1 张）——三种来源都能在面板里分辨出来。
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJgggA=';
const boot = `
(function () {
  var T = Date.now();
  var P_ID = 'f_1700000000077_default';
  var post = { id: P_ID, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '', content: '今天的天空', imgs: ['${PNG}'], ts: T - 8000, likes: [], comments: [] };
  var idbSeed = {};
  idbSeed['xy-home-v2:feed-posts'] = JSON.stringify([post]);
  window.__cap = {};
  var gStub = function (k) { return Promise.resolve(idbSeed[k] !== undefined ? idbSeed[k] : null); };
  var sStub = function (k, v) { window.__cap[k] = v; return Promise.resolve(true); };
  var dStub = function () { return Promise.resolve(true); };
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbDelete', { configurable: false, get: function () { return dStub; }, set: function () {} });
  try { localStorage.removeItem('xy-home-v2:feed-posts'); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:default:feed-posts-snap'); } catch (e) {}
  localStorage.setItem('xy-home-v2:default:feed-posts-snap', JSON.stringify([post]));
  // TA 的字卡库「表情包」两组（getMediaGroups('sticker') 数据源）
  localStorage.setItem('xy-home-v2:default:cc-groups', JSON.stringify({
    text: [], kaomoji: [], emoji: [], image: [], poke: [], voice: [],
    sticker: [['搞怪', ['${PNG}', '${PNG2}']], ['可爱', ['${PNG}']]]
  }));
  // 我的表情包一组
  localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['我的', ['${PNG2}']]]));
  // #319 系统预设字卡默认全锁（getDefaultCardGroups 一律返回 []）——真实用户已解锁才谈得上
  // 「预设 emoji 全量入池」，夹具不解锁就永远只测到常量兜底那条路。
  localStorage.setItem('xy-home-v2:cardlock-state', 'open');
  ['xy-home-v2:', 'xy-home-v2:default:'].forEach(function (pre) {
    localStorage.setItem(pre + 'reply-fd-comment-prob', '0');
    localStorage.setItem(pre + 'reply-fd-likeback-prob', '0');
    localStorage.setItem(pre + 'reply-fd-reply-prob', '0');
  });
})();
`;
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE || 4) });

const gotoApp = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
};
await gotoApp();
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await gotoApp();
// 收起开屏层（base.css：.splash:not(.hide) ~ .phone { visibility:hidden }——必须加 .hide 才可命中）
await evalJs(`(function(){ document.querySelectorAll('.splash, .splash-notice, .splash-box').forEach(function(n){ n.classList.add('hide'); n.style.display='none'; }); return true; })()`);
await sleep(300);

// ================= A. 源码锚 =================
check('A1 贴纸分组函数在（含 emoji 组）', /function feedStickerGroups\(\)/.test(feedSrc) && /key: 'em', label: 'emoji \\u8d34\\u7eb8'/.test(feedSrc));
check('A2 面板与 TA 回贴共用同源 emoji 池（不再各写一份常量）', /function feedStickerEmojiPool\(\)/.test(feedSrc) && /items: feedStickerEmojiPool\(\)/.test(feedSrc) && /const em = feedStickerEmojiPool\(\);/.test(feedSrc) && !/return \{ emoji: FEED_STICKER_EMOJI\[/.test(feedSrc));
check('A2b emoji 池来源＝自建 emoji 字卡优先、系统预设兜底', /window\.getScopedGroups\('emoji', sc\)/.test(feedSrc) && /window\.getDefaultCardGroups\('emoji'\)/.test(feedSrc) && /if \(!out\.length\) FEED_STICKER_EMOJI\.forEach\(add\);/.test(feedSrc));
check('A3 贴纸落位支持 emoji（feedPickStickerPos 第三参 + 传给 addFeedSticker）', /function feedPickStickerPos\(pid, src, emoji\)/.test(feedSrc) && /addFeedSticker\(pid, \{ src: src, emoji: emoji, x: x, y: y \}\)/.test(feedSrc));
check('A4 渲染签名覆盖窗口内动态身份/赞/评论/贴纸/配图', /function feedRenderSignature\(posts, shown, name, memId, rangeKey\)/.test(feedSrc) && /\(p\.likes \|\| \[\]\)\.join\('\/'\)/.test(feedSrc) && /if \(sig === feedRenderSig && listEl\.firstChild\) return;/.test(feedSrc));

// ================= B. 打开贴纸面板：分类 + emoji 贴纸 =================
await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
await sleep(900);
const openPanel = await evalJs(`(function(){
  var b = document.querySelector('#feed-list .feed-act[data-sticker]');
  if (b) b.click();
  return !!b;
})()`);
await sleep(400);
const b1 = await evalJs(`(function(){
  var card = document.getElementById('feed-sticker-card');
  if (!card) return { ok: false };
  var bar = document.getElementById('feed-sticker-groups');
  var chips = bar ? [].slice.call(bar.querySelectorAll('.emoji-g-chip')).map(function(c){ return c.textContent; }) : [];
  var items = [].slice.call(document.querySelectorAll('#feed-sticker-list .emoji-item'));
  var ems = items.filter(function(d){ return !!d.querySelector('.feed-sticker-emoji'); }).length;
  var imgs = items.filter(function(d){ return !!d.querySelector('img'); }).length;
  return { ok: true, hidden: card.hidden, barHidden: bar ? bar.hidden : null, chips: chips, n: items.length, ems: ems, imgs: imgs };
})()`);
check('B0 贴纸按钮能打开面板', !!openPanel && !!b1 && b1.ok && b1.hidden === false, JSON.stringify(b1));
check('B1 面板出现分组胶囊栏（全部 + TA 两组 + 我的一组 + emoji 贴纸）', !!b1 && b1.chips.length === 5, b1 ? JSON.stringify(b1.chips) : '');
check('B2 emoji 贴纸组计数＝联系人可用全量（预设 108，不再只有旧的 10 个）', !!b1 && b1.chips.some(c => c.indexOf('emoji 贴纸') === 0 && Number((c.match(/\d+/) || [0])[0]) > 100), b1 ? JSON.stringify(b1.chips) : '');
const b2n = b1 ? Number(((b1.chips.find(c => c.indexOf('emoji 贴纸') === 0) || '').match(/\d+/) || [0])[0]) : 0;
check('B3 默认「全部」＝原平铺行为：图片贴纸 4 张 + emoji 与胶囊计数一致', !!b1 && b1.imgs === 4 && b1.ems === b2n && b2n > 10 && b1.n === 4 + b2n, b1 ? JSON.stringify({ n: b1.n, imgs: b1.imgs, ems: b1.ems, chip: b2n }) : '');

const b4 = await evalJs(`(function(){
  var bar = document.getElementById('feed-sticker-groups');
  var chip = [].slice.call(bar.querySelectorAll('.emoji-g-chip')).filter(function(c){ return c.textContent.indexOf('搞怪') === 0; })[0];
  if (!chip) return { ok: false };
  chip.click();
  var items = [].slice.call(document.querySelectorAll('#feed-sticker-list .emoji-item'));
  var sel = [].slice.call(bar.querySelectorAll('.emoji-g-chip')).filter(function(c){ return c.classList.contains('sel'); }).map(function(c){ return c.textContent; });
  return { ok: true, n: items.length, imgs: items.filter(function(d){ return !!d.querySelector('img'); }).length, sel: sel };
})()`);
check('B4 点分组胶囊 → 只显示该组（搞怪 2 张）且胶囊高亮', !!b4 && b4.ok && b4.n === 2 && b4.imgs === 2 && b4.sel.length === 1 && b4.sel[0].indexOf('搞怪') === 0, JSON.stringify(b4));

const b5 = await evalJs(`(function(){
  var bar = document.getElementById('feed-sticker-groups');
  var chip = [].slice.call(bar.querySelectorAll('.emoji-g-chip')).filter(function(c){ return c.textContent.indexOf('emoji 贴纸') === 0; })[0];
  if (!chip) return { ok: false };
  chip.click();
  var items = [].slice.call(document.querySelectorAll('#feed-sticker-list .emoji-item'));
  return { ok: true, n: items.length, allEmoji: items.every(function(d){ return !!d.querySelector('.feed-sticker-emoji'); }) };
})()`);
check('B5 点「emoji 贴纸」组 → 全量渲染且都是 emoji（＝联系人真能贴的那批）', !!b5 && b5.ok && b5.n === b2n && b5.n > 10 && b5.allEmoji === true, JSON.stringify({ n: b5 && b5.n, chip: b2n, allEmoji: b5 && b5.allEmoji }));

const b6 = await evalJs(`(function(){
  document.querySelectorAll('#feed-sticker-list .emoji-item')[0].click();
  var card = document.getElementById('feed-sticker-card');
  var box = document.querySelector('#feed-list .feed-imgs');
  return { panelClosed: card.hidden === true, picking: box.classList.contains('feed-sticker-picking'), hint: !!document.querySelector('.feed-pick-hint') };
})()`);
check('B6 选 emoji 贴纸 → 关闭面板并进入「点照片选位置」', !!b6 && b6.panelClosed && b6.picking && b6.hint, JSON.stringify(b6));

const b7 = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  var r = box.getBoundingClientRect();
  var ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width * 0.35), clientY: Math.round(r.top + r.height * 0.4) });
  box.dispatchEvent(ev);
  var ems = box.querySelectorAll('.feed-sticker-emoji').length;
  var pics = box.querySelectorAll('.feed-sticker img').length;
  var st = box.querySelector('.feed-sticker');
  return { ems: ems, pics: pics, del: st ? st.hasAttribute('data-sticker-del') : null, x: st ? st.style.left : null, picking: box.classList.contains('feed-sticker-picking'), hint: !!document.querySelector('.feed-pick-hint') };
})()`);
await sleep(300);
const b7b = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  var st = box.querySelector('.feed-sticker');
  return { ems: box.querySelectorAll('.feed-sticker-emoji').length, pics: box.querySelectorAll('.feed-sticker img').length,
    picking: box.classList.contains('feed-sticker-picking'), hint: !!document.querySelector('.feed-pick-hint'),
    del: st ? st.hasAttribute('data-sticker-del') : null };
})()`);
check('B7 点照片 → 落一张 emoji 贴纸（不是图片贴纸）', !!b7b && b7b.ems === 1 && b7b.pics === 0, JSON.stringify(b7b));
check('B8 落位后退出选位态、提示条收起、贴纸可撤回（带 data-sticker-del）', !!b7b && b7b.picking === false && b7b.hint === false && b7b.del === true, JSON.stringify(b7b));

// ================= P. 渲染签名：反复进出不重建、数据一变必重建 =================
// 先走一次「切走→回来」让签名与数据对齐（B7 刚加过贴纸，这一步本来就会重建），再验跳过。
await evalJs(`(function(){ document.querySelector('.app[data-app="chat"]').click(); document.querySelector('.app[data-app="feed"]').click(); return true; })()`);
await sleep(500);
const p1 = await evalJs(`(function(){
  var list = document.getElementById('feed-list');
  var card = list.querySelector('.feed-post');
  if (!card) return { ok: false };
  card.__sigProbe = 'KEEP';
  var t0 = performance.now();
  document.querySelector('.app[data-app="chat"]').click();      // 切走
  var t1 = performance.now();
  document.querySelector('.app[data-app="feed"]').click();      // 再进朋友圈（旧实现这里整包重建）
  var t2 = performance.now();
  var again = document.getElementById('feed-list').querySelector('.feed-post');
  return { ok: true, kept: !!again && again.__sigProbe === 'KEEP', awayMs: Math.round(t1 - t0), backMs: Math.round(t2 - t1), cards: document.querySelectorAll('#feed-list .feed-post').length };
})()`);
check('P1 内容未变时再进朋友圈不重建列表（DOM 身份保留）', !!p1 && p1.ok && p1.kept === true, JSON.stringify(p1));
console.log('   · 再进耗时 ' + (p1 ? p1.backMs : '?') + 'ms（旧实现同场景整包重建；参考：200 条动态 4.0MB 标记约 300ms+）');

const p2 = await evalJs(`(function(){
  var b = document.querySelector('#feed-list .feed-act[data-like]');
  if (b) b.click();
  var list = document.getElementById('feed-list');
  list.querySelectorAll('.feed-post').forEach(function(el){ el.__sigProbe2 = 'KEEP'; });
  document.querySelector('.app[data-app="chat"]').click();
  document.querySelector('.app[data-app="feed"]').click();
  var after = list.querySelectorAll('.feed-post');
  var kept = after.length ? !!after[0].__sigProbe2 : null;
  var likesShown = (document.querySelector('#feed-list .feed-likes') || {}).textContent || '';
  return { kept: kept, like: likesShown.trim().slice(0, 24), n: after.length };
})()`);
check('P2 数据一变（点赞）必重建＝不会拿旧 DOM 当新数据', !!p2 && p2.kept === false, JSON.stringify(p2));
check('P3 重建后点赞状态可见（DOM 与数据一致）', !!p2 && p2.like.indexOf('觉得很赞') > 0, p2 ? p2.like : '');

// ================= C. emoji 池来源（#798）：自建优先 / 预设关掉则回落常量 =================
// 场景脚本在 boot 之后注册（同一次导航里 boot 先写种子、本脚本再改写），换场景=换脚本+重载页面。
let boot2Id = null;
const readPanel = async () => {
  await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
  await sleep(900);
  await evalJs(`(function(){ var b = document.querySelector('#feed-list .feed-act[data-sticker]'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  const chip = await evalJs(`(function(){
    var c = [].slice.call(document.querySelectorAll('#feed-sticker-groups .emoji-g-chip')).filter(function(x){ return x.textContent.indexOf('emoji 贴纸') === 0; })[0];
    return c ? c.textContent : null;
  })()`);
  const got = await evalJs(`(function(){
    var c = [].slice.call(document.querySelectorAll('#feed-sticker-groups .emoji-g-chip')).filter(function(x){ return x.textContent.indexOf('emoji 贴纸') === 0; })[0];
    if (!c) return null;
    c.click();
    return [].slice.call(document.querySelectorAll('#feed-sticker-list .emoji-item')).map(function(d){ var e = d.querySelector('.feed-sticker-emoji'); return e ? e.textContent : ''; });
  })()`);
  return { chip, got: got || [] };
};
const setScenario = async (source) => {
  if (boot2Id) { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: boot2Id }); boot2Id = null; }
  if (source) boot2Id = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
  await gotoApp();
  await evalJs(`(function(){ document.querySelectorAll('.splash, .splash-notice, .splash-box').forEach(function(n){ n.classList.add('hide'); n.style.display='none'; }); return true; })()`);
  await sleep(300);
  return readPanel();
};
const c1 = await setScenario(`(function(){
  var g = JSON.parse(localStorage.getItem('xy-home-v2:default:cc-groups') || '{}');
  g.emoji = [['\\u5e38\\u7528', ['\\ud83d\\ude00', '\\ud83d\\ude0d', '\\ud83e\\udd73']]];
  localStorage.setItem('xy-home-v2:default:cc-groups', JSON.stringify(g));
})();`);
check('C1 联系人有自建 emoji 字卡 → 面板只列自建那 3 张（预设不混入，与回复池同口径）',
  c1.chip === 'emoji 贴纸3' && c1.got.join('|') === '\ud83d\ude00|\ud83d\ude0d|\ud83e\udd73', JSON.stringify(c1));
const c2 = await setScenario(`(function(){
  var g = JSON.parse(localStorage.getItem('xy-home-v2:default:cc-groups') || '{}');
  g.emoji = [];
  localStorage.setItem('xy-home-v2:default:cc-groups', JSON.stringify(g));
  ['xy-home-v2:', 'xy-home-v2:default:'].forEach(function (pre) { localStorage.setItem(pre + 'dc-use-feed', '0'); });
})();`);
check('C2 无自建且默认字卡「朋友圈使用」关闭 → 回落内置 10 个（不越权列预设）',
  c2.chip === 'emoji 贴纸10' && c2.got.length === 10, JSON.stringify(c2));
const c3 = await setScenario(`(function(){
  ['xy-home-v2:', 'xy-home-v2:default:'].forEach(function (pre) { localStorage.removeItem(pre + 'dc-use-feed'); });
  var g = JSON.parse(localStorage.getItem('xy-home-v2:default:cc-groups') || '{}');
  g.emoji = [];
  localStorage.setItem('xy-home-v2:default:cc-groups', JSON.stringify(g));
})();`);
check('C3 撤掉改写（开关回到默认、无自建）→ 全量池实时回来（池每次开面板现算）',
  !!c3.chip && Number(((c3.chip.match(/\d+/) || [0])[0])) > 100 && c3.got.length === Number((c3.chip.match(/\d+/) || [0])[0]), JSON.stringify({ chip: c3.chip, n: c3.got.length }));

const err = await evalJs(`(window.__jsErrors || []).length`);
check('E1 零 JS 异常', !err, '错误 ' + err);

const pass = results.every(r => r.ok);
console.log('\n' + (pass ? '✅ 全部通过 ' : '❌ 有失败 ') + results.filter(r => r.ok).length + '/' + results.length);
chrome.kill(); server.close();
process.exit(pass ? 0 : 1);
