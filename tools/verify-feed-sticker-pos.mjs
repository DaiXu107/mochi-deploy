// ===== 专项脚本：朋友圈贴纸——我贴的位置可自定义（点照片选位置），TA 回贴仍随机（v3.36.x） =====
// 用法：node build.mjs && node tools/verify-feed-sticker-pos.mjs
// 背景（用户需求）：原版 #302 我贴的贴纸一律 feedRandStickerPos 随机落位，无法指定位置。
//   修复=选完贴纸进入「点照片选位置」模式：配图区盖提示条+十字光罩，点哪里贴哪里（可取消）；
//   找不到配图时退回随机；TA 回贴逻辑不动（feedRandStickerPos）。
// #593 修用户报障「提示条挡住使用」（多机型）：提示条原为绝对定位压在照片顶部（照片高约 104px 时占 33px
//   ≈顶部 1/3，系统字号越大压得越多），点那一带被提示条接走＝被当「取消」，一张都贴不上。
//   修法=提示条移出照片区（配图区前面独立一行）+ 选位期间看门狗收尾。
// 验证（无头 Chrome，种子=TA 图文动态 + 我的表情包一张）：
//   S0 环境闸门：开屏收起后 .phone 可命中（不成立则后面全是假红）；
//   A 点「贴纸」→ 选表情 → 不立即落位，配图区出现 .feed-sticker-picking + 提示条（A2：提示条不在照片区内）；
//   B 点击配图区指定点 → 贴纸落位 x/y ≈ 点击点百分比（±6%），提示条消失、DOM/存储一致；
//   C 取消路径：再次进入选位模式点「取消」→ 无贴纸写入、模式退出；
//   E1/E2 照片**顶部那一条**不再被提示条占住，点下去照常落位（#593 主诉，旧实现必红）；
//   E4 选位期间配图区被换掉 → 模式自行收尾（不留提示条）；
//   D TA 回贴仍随机：fd-comment-prob=100 强制回贴 → 新贴纸 x/y 不等于我的（随机池内必异于定点）。
const root = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const { spawn } = await import('node:child_process');
const { createServer } = await import('node:http');
const { readFileSync, statSync } = await import('node:fs');
const { join, normalize, dirname, extname } = await import('node:path');
const { fileURLToPath } = await import('node:url');

const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-feedstkpos-' + Date.now()),
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 500)); return null; }
  return r && r.result ? r.result.value : null;
}
async function gotoApp(reload) {
  if (reload) await cdp('Page.reload', { ignoreCache: false });
  else await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// 1x1 PNG dataURL（贴纸来源 + 动态配图同一张即可）
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const boot = `
(function () {
  var T = Date.now();
  var P_ID = 'f_1700000000099_default';
  var post = { id: P_ID, role: 'ta', owner: 'default', authorName: '小桃', authorAv: '', taName: '小桃', taAv: '', content: '今天的天空', imgs: ['${PNG}'], ts: T - 8000, likes: [], comments: [] };
  var idbSeed = {};
  idbSeed['xy-home-v2:feed-posts'] = JSON.stringify([post]);
  window.__stkCaptured = {};
  var gStub = function (k) { return Promise.resolve(idbSeed[k] !== undefined ? idbSeed[k] : null); };
  var sStub = function (k, v) { window.__stkCaptured[k] = v; return Promise.resolve(true); };
  var dStub = function () { return Promise.resolve(true); };
  Object.defineProperty(window, 'idbGet', { configurable: false, get: function () { return gStub; }, set: function () {} });
  Object.defineProperty(window, 'idbSet', { configurable: false, get: function () { return sStub; }, set: function () {} });
  Object.defineProperty(window, 'idbDelete', { configurable: false, get: function () { return dStub; }, set: function () {} });
  try { localStorage.removeItem('xy-home-v2:feed-posts'); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:default:feed-posts-snap'); } catch (e) {}
  localStorage.setItem('xy-home-v2:default:feed-posts-snap', JSON.stringify([post]));
  // 我的表情包一张（贴纸面板数据源）
  localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['我的', ['${PNG}']]]));
  // TA 不主动回贴（D 段再单独开）、不点赞回赞，避免干扰
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

await gotoApp();
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
await gotoApp(true);

// ---- 关掉开屏层：**必须给 .splash 加 .hide**（v3.26.x 环境修正）----
// base.css：`.splash:not(.hide) ~ .phone { visibility:hidden; }`——只 display:none 掉 .splash
//   并不解除这条兄弟规则，整个 .phone 仍不可命中：elementFromPoint 恒返回 BODY、所有点击落不到
//   照片上，B/C/D 会以「点不动」的假红出现（脚本自身环境缺陷，不是产品回归）。
await evalJs(`(function(){
  document.querySelectorAll('.splash, .splash-notice, .splash-box').forEach(function (n) {
    n.classList.add('hide'); n.style.display = 'none';
  });
  return true;
})()`);
await sleep(300);

// ---- 打开朋友圈 ----
await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
await sleep(900);

// ---- S0 环境闸门：照片必须可命中（否则后面全是假红，先报环境不成立）----
const s0 = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  if (!box) return { ok: false, why: 'no-imgs' };
  var r = box.getBoundingClientRect();
  var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    ok: !!el && el !== document.body,
    hit: el ? el.tagName + '.' + String(el.className || '').slice(0, 30) : null,
    vis: getComputedStyle(document.querySelector('.phone') || document.body).visibility
  };
})()`);
check('S0 环境：照片可命中（开屏已收起、.phone 不再 visibility:hidden）', !!s0.ok, JSON.stringify(s0));

// ---- A. 点贴纸按钮 → 选表情 → 进入选位模式（不立即落位） ----
const a1 = await evalJs(`(function(){
  var btn = document.querySelector('#feed-list .feed-act[data-sticker]');
  if (!btn) return { ok: false, why: 'no-sticker-btn' };
  btn.click(); return { ok: true };
})()`);
await sleep(500);
const a2 = await evalJs(`(function(){
  var card = document.getElementById('feed-sticker-card');
  if (!card || card.hidden) return { ok: false, why: 'panel-hidden' };
  var item = card.querySelector('.emoji-item');
  if (!item) return { ok: false, why: 'no-sticker-item' };
  item.click();
  return { ok: true };
})()`);
await sleep(500);
const a3 = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  if (!box) return { ok: false, why: 'no-imgs' };
  var post = box.closest('.feed-post');
  return {
    picking: box.classList.contains('feed-sticker-picking'),
    hint: !!(post && post.querySelector('.feed-pick-hint')),
    hintInPhoto: !!box.querySelector('.feed-pick-hint'),
    stickers: box.querySelectorAll('.feed-sticker').length
  };
})()`);
check('A 选贴纸后进入选位模式且尚未落位', !!a1.ok && !!a2.ok && !!a3.picking && !!a3.hint && a3.stickers === 0, JSON.stringify([a1, a2, a3]));
// A2（#593 契约）：提示条不得落在配图区内＝不得覆盖照片——压在上面就是「点顶部被提示条接走」的复发形态
check('A2 提示条不在照片区内（不覆盖照片）', !!a3.hint && a3.hintInPhoto === false, JSON.stringify(a3));

// ---- B. 点击配图区指定点 → 贴纸落在该位置 ----
// 点击配图区内 (30%, 40%) 处
const b1 = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  var r = box.getBoundingClientRect();
  var x = r.left + r.width * 0.30, y = r.top + r.height * 0.40;
  var el = document.elementFromPoint(x, y);
  var ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  el.dispatchEvent(ev);
  return { w: r.width, h: r.height };
})()`);
await sleep(600);
const b2 = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  var s = box.querySelector('.feed-sticker');
  if (!s) return { ok: false, why: 'no-sticker' };
  return {
    ok: true,
    x: parseFloat(s.style.left), y: parseFloat(s.style.top),
    pickingGone: !box.classList.contains('feed-sticker-picking'),
    hintGone: !document.querySelector('#feed-list .feed-pick-hint')
  };
})()`);
check('B1 点击点 30%,40% → 贴纸落位误差 ≤6%', !!b2.ok && Math.abs(b2.x - 30) <= 6 && Math.abs(b2.y - 40) <= 6, JSON.stringify([b1, b2]));
check('B2 落位后选位模式退出（罩层+提示条消失）', !!b2.ok && b2.pickingGone && b2.hintGone);
// #496 起主键落盘改「空闲窗口 + 2.5s 尾随合并」：DOM 先变、存储晚到，故轮询等待（上限 5s）
let b3 = null;
for (let i = 0; i < 20; i++) {
  b3 = await evalJs(`(function(){
    var w = window.__stkCaptured || {};
    var raw = w['xy-home-v2:feed-posts'] || localStorage.getItem('xy-home-v2:feed-posts') || '';
    try {
      var p = JSON.parse(raw)[0];
      var st = p.stickers || [];
      var s = st[st.length - 1];
      return { n: st.length, role: s && s.role, x: s && s.x, y: s && s.y };
    } catch (e) { return { err: String(e) }; }
  })()`);
  if (b3 && b3.role === 'me') break;
  await sleep(250);
}
check('B3 存储写入我贴的贴纸且 x/y 与 DOM 一致', !!b3 && b3.role === 'me' && b3.x === b2.x && b3.y === b2.y, JSON.stringify(b3));

// ---- C. 取消路径：再贴一张 → 点「取消」→ 不写入 ----
await evalJs(`(function(){ document.querySelector('#feed-list .feed-act[data-sticker]').click(); return true; })()`);
await sleep(400);
await evalJs(`(function(){ document.querySelector('#feed-sticker-card .emoji-item').click(); return true; })()`);
await sleep(400);
const c1 = await evalJs(`(function(){
  var btn = document.querySelector('#feed-list .feed-pick-hint button');
  if (!btn) return { ok: false };
  btn.click(); return { ok: true };
})()`);
await sleep(500);
const c2 = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  return { n: box.querySelectorAll('.feed-sticker').length, picking: box.classList.contains('feed-sticker-picking') };
})()`);
check('C 取消选位：无新贴纸写入且模式退出', !!c1.ok && c2.n === 1 && !c2.picking, JSON.stringify([c1, c2]));

// ---- E. 照片顶部那一条必须能点（#593：提示条不得压住照片） ----
// 用户报障：提示条盖在照片顶部，点那一带贴不上去——实测旧实现点顶部 8px 处=被提示条接走当「取消」，
//   一张都不贴、模式直接退出；照片区高约 104px 时提示条占掉顶部 33px（≈1/3），系统字号越大压得越多。
await evalJs(`(function(){ document.querySelector('#feed-list .feed-act[data-sticker]').click(); return true; })()`);
await sleep(400);
await evalJs(`(function(){ document.querySelector('#feed-sticker-card .emoji-item').click(); return true; })()`);
await sleep(400);
const e1 = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  if (!box) return { ok: false, why: 'no-imgs' };
  var r = box.getBoundingClientRect();
  var x = r.left + r.width * 0.5, y = r.top + 3;   // 照片最顶部 3px＝旧版被提示条盖住的那一带
  var el = document.elementFromPoint(x, y);
  return {
    hit: el ? el.tagName + '.' + String(el.className || '').slice(0, 30) : null,
    inHint: !!(el && el.closest && el.closest('.feed-pick-hint')),
    inBox: !!(el && el.closest && el.closest('.feed-imgs') === box),
    boxH: Math.round(r.height)
  };
})()`);
check('E1 照片顶部那条不再被提示条占住（命中照片本身，不是 .feed-pick-hint）', !!e1 && e1.inHint === false && e1.inBox === true, JSON.stringify(e1));
await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  var r = box.getBoundingClientRect();
  var x = r.left + r.width * 0.5, y = r.top + 3;
  document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  return true;
})()`);
await sleep(700);
const e2 = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  return {
    n: box.querySelectorAll('.feed-sticker').length,
    picking: box.classList.contains('feed-sticker-picking'),
    hint: !!document.querySelector('#feed-list .feed-pick-hint')
  };
})()`);
check('E2 点照片顶部那条 → 照常落位（旧实现＝被当「取消」，一张不贴）', !!e2 && e2.n === 2 && !e2.picking && !e2.hint, JSON.stringify(e2));

// ---- D. TA 回贴仍随机：开 fd-comment-prob=100 → 我再贴一张，TA 回贴位置 ≠ 我的定点 ----
await evalJs(`(function(){
  ['xy-home-v2:', 'xy-home-v2:default:'].forEach(function (pre) {
    localStorage.setItem(pre + 'reply-fd-comment-prob', '100');
    localStorage.setItem(pre + 'reply-fd-comment-speed-min', '0.05');
    localStorage.setItem(pre + 'reply-fd-comment-speed-max', '0.3');
  });
  return true;
})()`);
await evalJs(`(function(){ document.querySelector('#feed-list .feed-act[data-sticker]').click(); return true; })()`);
await sleep(400);
await evalJs(`(function(){ document.querySelector('#feed-sticker-card .emoji-item').click(); return true; })()`);
await sleep(400);
// 我点在 (30%,40%) 同一位置
await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  var r = box.getBoundingClientRect();
  var x = r.left + r.width * 0.30, y = r.top + r.height * 0.40;
  document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  return true;
})()`);
await sleep(1200);
// #496 起 TA 回贴的落盘同样走「空闲窗口 + 2.5s 尾随合并」——等存储里出现 role=ta 的那张再判（上限 5s），
// 否则读到的是上一拍快照（幂等重试，不是宽容判据：等不到 ta 那张照样红）
let d1 = null;
for (let i = 0; i < 20; i++) {
  d1 = await evalJs(`(function(){
    var box = document.querySelector('#feed-list .feed-imgs');
    var ss = box.querySelectorAll('.feed-sticker');
    if (ss.length < 2) return { ok: false, n: ss.length };
    var mine = ss[ss.length - 2], ta = ss[ss.length - 1];
    var raw = (window.__stkCaptured || {})['xy-home-v2:feed-posts'] || localStorage.getItem('xy-home-v2:feed-posts') || '';
    var p = JSON.parse(raw)[0];
    var taS = (p.stickers || [])[p.stickers.length - 1] || {};
    return {
      ok: true, n: ss.length,
      taRole: taS.role,
      taXY: [taS.x, taS.y], mineXY: [parseFloat(mine.style.left), parseFloat(mine.style.top)],
      differs: !(Math.abs(parseFloat(ta.style.left) - parseFloat(mine.style.left)) < 1 && Math.abs(parseFloat(ta.style.top) - parseFloat(mine.style.top)) < 1)
    };
  })()`);
  if (d1 && d1.ok && d1.taRole === 'ta') break;
  await sleep(250);
}
check('D TA 回贴照常发生且落位随机（≠我的定点 30%,40%）', !!d1.ok && d1.taRole === 'ta' && d1.differs, JSON.stringify(d1));

// ---- E4 选位期间卡片被换掉（局部/全量重渲染、TA 回贴刷新）→ 模式必须自行收尾 ----
// 旧实现只在「下一次点击」时才发现配图区节点已失效，提示条会一直挂在页面上直到用户再点一下；
// 新实现按 400ms 看门狗主动收尾（任何机型都不会卡在选位态）。
await evalJs(`(function(){ document.querySelector('#feed-list .feed-act[data-sticker]').click(); return true; })()`);
await sleep(400);
await evalJs(`(function(){ document.querySelector('#feed-sticker-card .emoji-item').click(); return true; })()`);
await sleep(400);
const e4a = await evalJs(`(function(){
  var box = document.querySelector('#feed-list .feed-imgs');
  if (!box) return { ok: false };
  box.remove();   // 模拟卡片被替换（refreshPostCard / renderVisible 都是换节点）
  return { ok: true };
})()`);
await sleep(1000);
const e4 = await evalJs(`(function(){
  return {
    hintLeft: document.querySelectorAll('.feed-pick-hint').length,
    pickingLeft: document.querySelectorAll('.feed-sticker-picking').length
  };
})()`);
check('E4 选位期间配图区被换掉 → 模式自行收尾（不留提示条/罩层）', !!e4a.ok && !!e4 && e4.hintLeft === 0 && e4.pickingLeft === 0, JSON.stringify(e4));

await chrome.kill();
const fails = results.filter((r) => !r.ok).length;
console.log(fails ? 'FAIL ' + fails + '/' + results.length : 'ALL PASS ' + results.length + '/' + results.length);
process.exit(fails ? 1 : 0);
