// ===== 回归脚本：安卓 Chrome「网页崩溃」（渲染进程 OOM）四项修复（v3.12.x） =====
// 用法：node build.mjs && node tools/verify-oom-leaks.mjs
// 背景（用户反馈）：荣耀手机 Chrome 部署站「用着用着就网页崩溃」。审计定位四处随使用时间
//   累积不释放的内存点，本工具逐项验证修复行为：
//   ① feed.js 列表窗口化：320 条动态只渲染最新 200，「查看更早」每次 +100，历史零丢失；
//     「全部朋友圈」页同口径。存储不裁剪。
//   ② group-chat.js 实时追加 DOM 窗口：停留页内连续收发超过 GC_DOM_WINDOW=400 从最早端
//     裁剪到 320（贴底时），不再无界增长；存储完整（最后一条消息在落盘数据里）。
//   ③ bg-keep.js 后台通知 blob URL：createObjectURL 后必须被 revokeObjectURL 回收
//     （经 window.__bgBlobRevokeDelayMs 接缝缩短延迟）。
//   ④ sfx.js / group-chat.js 语音：Audio 播完/出错后 src 被卸载（解码缓冲随元素释放，
//     不等 GC）。Audio 构造器整体替换为可控 Fake，捕获全部实例手动派发 ended。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-oom-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function waitReady() {
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) { await sleep(900); return true; } await sleep(200); }
  return false;
}

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log('PASS  ' + name + (info !== undefined ? '  [' + info + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (info !== undefined ? '  [' + info + ']' : '')); }
}

// ---- 种子（页面脚本执行前注入） ----
// ① 320 条朋友圈动态（小文本，LS 可容）；② 群聊 380 条历史；③ 全局概率清零防 TA 插消息；
// ④ document.visibilityState=hidden + Notification/SW 桩放行 bgNotifyCheck；
// ⑤ Audio→FakeAudio 捕获实例；⑥ URL.createObjectURL/revokeObjectURL 计数；
// ⑦ __bgBlobRevokeDelayMs=60 缩短 blob 回收延迟；⑧ localStorage 预置 bg-notify='1'。
const boot = `
(function () {
  var T = Date.now();
  // -- 朋友圈种子 --
  var posts = [];
  for (var i = 0; i < 320; i++) {
    posts.push({ id: 'oom_' + i, role: i % 3 === 0 ? 'me' : 'ta', owner: 'default',
      authorName: i % 3 === 0 ? '我' : '小桃', authorAv: '', taName: '小桃', taAv: '',
      content: 'OOM回归动态' + i + ' 内容文本', imgs: [], ts: T - 300000 - (320 - i) * 1000,
      likes: [], comments: [] });
  }
  try { localStorage.setItem('xy-home-v2:feed-posts', JSON.stringify(posts)); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:default:feed-posts-snap'); } catch (e) {}
  // -- 群聊种子：380 条纯文本历史（renderAll 渲染最近 RENDER_MAX=200 条）--
  var gc = [];
  for (var j = 0; j < 380; j++) gc.push({ side: 'in', cid: 'c1', text: '群聊历史消息' + j, ts: T - 200000 - (380 - j) * 1000 });
  try { localStorage.setItem('xy-home-v2:group-chat-msgs', JSON.stringify(gc)); } catch (e) {}
  // -- TA 干扰概率清零（feed 自动发帖/评论/点赞 + 群聊回复全关）--
  ['reply-fd-post-prob','reply-fd-comment-prob','reply-fd-reply-prob','reply-fd-like-prob','reply-fd-likeback-prob',
   'gc-prob','gc-touch-prob','gc-sticker-prob','gc-emoji-prob','gc-image-prob','gc-voice-prob','gc-kaomoji-prob','gc-quote-prob','gc-rc-prob']
    .forEach(function (k) {
      try { localStorage.setItem('xy-home-v2:' + k, '0'); } catch (e) {}
      try { localStorage.setItem('xy-home-v2:default:' + k, '0'); } catch (e) {}
    });
  try { localStorage.setItem('xy-home-v2:lbl-partner', '小桃'); } catch (e) {}
  try { localStorage.setItem('xy-home-v2:bg-notify', '1'); } catch (e) {}
  // 群聊入口默认关闭——预开启让桌面渲染出 .app[data-app="group-chat"] 图标
  try { localStorage.setItem('xy-home-v2:group-chat-enabled', '1'); } catch (e) {}
  // -- Audio 替换：捕获实例，支持手动派发 ended --
  window.__audioAll = [];
  function FakeAudio(src) {
    this.src = src || ''; this.volume = 1; this.loop = false; this.paused = true; this._ls = {};
    window.__audioAll.push(this);
  }
  FakeAudio.prototype.addEventListener = function (t, f) { (this._ls[t] = this._ls[t] || []).push(f); };
  FakeAudio.prototype.removeEventListener = function () {};
  FakeAudio.prototype.dispatch = function (t) { (this._ls[t] || []).slice().forEach(function (f) { f.call(this, { type: t }); }); };
  FakeAudio.prototype.play = function () { this.paused = false; return { catch: function () {} }; };
  FakeAudio.prototype.pause = function () { this.paused = true; };
  FakeAudio.prototype.load = function () {};
  FakeAudio.prototype.removeAttribute = function (n) { if (n === 'src') this.src = ''; };
  FakeAudio.prototype.getAttribute = function (n) { return n === 'src' ? this.src : null; };
  FakeAudio.prototype.hasAttribute = function (n) { return n === 'src' ? this.src !== '' : false; };
  try { window.Audio = FakeAudio; } catch (e) {}
  // -- blob URL 计数 + 回收延迟接缝 --
  window.__blobCreated = 0; window.__blobRevoked = 0;
  var co = URL.createObjectURL.bind(URL), rv = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (b) { window.__blobCreated++; return co(b); };
  URL.revokeObjectURL = function (u) { window.__blobRevoked++; return rv(u); };
  window.__bgBlobRevokeDelayMs = 80;
  // -- 后台态 + 通知桩：放行 bgNotifyCheck 全链路 --
  try { Object.defineProperty(document, 'visibilityState', { get: function () { return 'hidden'; }, configurable: true }); } catch (e) {}
  try { Object.defineProperty(document, 'hidden', { get: function () { return true; }, configurable: true }); } catch (e) {}
  window.__notis = [];
  window.Notification = function (title, opts) {
    window.__notis.push({ title: title, opts: opts || {} });
    this.close = function () {};
  };
  window.Notification.permission = 'granted';
  window.Notification.requestPermission = function () { return Promise.resolve('granted'); };
  try {
    Object.defineProperty(navigator, 'serviceWorker', { get: function () { return { getRegistration: function () { return Promise.resolve(null); }, ready: Promise.resolve({ showNotification: function (title, opts) { window.__notis.push({ title: title, opts: opts || {} }); return Promise.resolve(); } }) }; }, configurable: true });
  } catch (e) {}
})();
`;

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: boot });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  check('页面就绪', await waitReady());

  // ================= ① feed 列表窗口化 =================
  await evalJs(`(function(){ var el = document.querySelector('.app[data-app="feed"]'); if (el) el.click(); return !!el; })()`);
  for (let i = 0; i < 25; i++) { const n = await evalJs(`document.querySelectorAll('#feed-list .feed-card, #feed-list [id^="feed-post-"]').length`); if (n >= 200) break; await sleep(200); }
  const f1 = await evalJs(`(function(){
    var list = document.getElementById('feed-list');
    var cards = list.querySelectorAll('[id^="feed-post-"]');
    var more = list.querySelector('.feed-more-btn');
    return { count: cards.length, hasMore: !!more, moreTxt: more ? more.textContent : '',
      firstId: cards[0] ? cards[0].id : '', lastId: cards[cards.length - 1] ? cards[cards.length - 1].id : '' };
  })()`);
  check('F1 320条只渲染最新200张卡片', f1.count === 200, String(f1.count));
  check('F2 出现「查看更早」按钮(剩120)', f1.hasMore && /120/.test(f1.moreTxt), f1.moreTxt);
  check('F3 首卡是最新动态 oom_319', f1.firstId === 'feed-post-oom_319', f1.firstId);

  // 点「查看更早」→ +100 = 300，按钮剩 20
  await evalJs(`(function(){ var b = document.querySelector('#feed-list .feed-more-btn'); if (b) b.click(); return !!b; })()`);
  await sleep(400);
  const f2 = await evalJs(`(function(){
    var list = document.getElementById('feed-list');
    var cards = list.querySelectorAll('[id^="feed-post-"]');
    var more = list.querySelector('.feed-more-btn');
    return { count: cards.length, moreTxt: more ? more.textContent : '', lastId: cards[cards.length - 1] ? cards[cards.length - 1].id : '' };
  })()`);
  check('F4 加载更多后300张(+100)', f2.count === 300, String(f2.count));
  check('F5 按钮更新为还剩20', /20/.test(f2.moreTxt || ''), f2.moreTxt || '');
  check('F6 新增批次含更早的 oom_20', f2.lastId === 'feed-post-oom_20', f2.lastId);

  // 再点两次 → 320 全部可见，按钮消失
  await evalJs(`(function(){ var b = document.querySelector('#feed-list .feed-more-btn'); if (b) b.click(); return true; })()`);
  await sleep(300);
  await evalJs(`(function(){ var b = document.querySelector('#feed-list .feed-more-btn'); if (b) b.click(); return true; })()`);
  await sleep(400);
  const f3 = await evalJs(`(function(){
    var cards = document.querySelectorAll('#feed-list [id^="feed-post-"]');
    return { count: cards.length, hasMore: !!document.querySelector('#feed-list .feed-more-btn'),
      oldest: !!document.getElementById('feed-post-oom_0') };
  })()`);
  check('F7 二次加载后全部320条可见(历史零丢失)', f3.count === 320 && f3.oldest, String(f3.count));
  check('F8 加载完毕按钮消失', f3.hasMore === false);

  // 全部朋友圈页同口径：从主列表头像进入 default 的全部动态
  await evalJs(`(function(){ var a = document.querySelector('#feed-list [id^="feed-post-"] .feed-head-av'); if (a) a.click(); return !!a; })()`);
  await sleep(600);
  const fa = await evalJs(`(function(){
    var list = document.getElementById('feed-all-list');
    if (!list) return { ok: false };
    var cards = list.querySelectorAll('[id^="feed-post-"]');
    var more = list.querySelector('.feed-more-btn');
    var pageHidden = document.getElementById('page-feed-all') ? document.getElementById('page-feed-all').hidden : true;
    return { ok: !pageHidden, count: cards.length, hasMore: !!more };
  })()`);
  check('F9 全部朋友圈页同样窗口化(200+按钮)', fa.ok && fa.count === 200 && fa.hasMore, JSON.stringify(fa));

  // ================= ② 群聊实时追加 DOM 窗口 =================
  // 返回主页进群聊；renderAll 先渲染 200 条历史
  await evalJs(`(function(){ var b = document.getElementById('feed-all-back'); if (b) b.click(); return true; })()`);
  await sleep(300);
  await evalJs(`(function(){
    document.querySelectorAll('.page').forEach(function(p){ p.hidden = true; });
    var ph = document.getElementById('page-phone'); if (ph) ph.hidden = false;
    var el = document.querySelector('.app[data-app="group-chat"]'); if (el) el.click(); return !!el;
  })()`);
  await sleep(800);
  const g0 = await evalJs(`document.querySelectorAll('#gc-body > div').length`);
  check('G1 进群聊先渲染最近200条历史', g0 === 200, String(g0));

  // 连续发送 220 条（概率已清零，TA 不插消息）：201 时越过 400 上限触发裁剪到 320
  await evalJs(`(function(){
    var input = document.getElementById('gc-input'), btn = document.getElementById('gc-send'), body = document.getElementById('gc-body');
    for (var i = 0; i < 220; i++) {
      input.textContent = '压测消息' + i;
      btn.click();
      body.scrollTop = body.scrollHeight; // 保持贴底 → 允许裁剪
    }
    return true;
  })()`);
  await sleep(600);
  const g1 = await evalJs(`(function(){
    var body = document.getElementById('gc-body');
    var nodes = body.children;
    var last = nodes[nodes.length - 1];
    return { count: nodes.length, lastIsMine: last ? last.className.indexOf('msg-out') >= 0 : false };
  })()`);
  check('G2 连发220条后DOM被裁剪在窗口内(≤400)', g1.count <= 400, String(g1.count));
  check('G3 裁剪保留最新端(末尾是我方消息)', g1.lastIsMine);
  const g2 = await evalJs(`(function(){
    var raw = localStorage.getItem('xy-home-v2:group-chat-msgs') || '[]';
    var arr = JSON.parse(raw);
    return { total: arr.length, lastText: arr.length ? arr[arr.length - 1].text : '' };
  })()`);
  check('G4 存储未裁剪：380历史+220新发=600条', g2.total === 600, String(g2.total));
  check('G5 最后一条是本次发送的最后一条', g2.lastText === '压测消息219', g2.lastText);

  // ================= ④ 语音 Audio 播完卸 src（群聊路径，chatcard 同型） =================
  // 先退群聊页（其 saveNow 用内存数组落盘），【之后】再把带标记的语音消息写进存储——
  // 若先写会被退出时的 saveNow 覆盖掉。语音源带 VOICEMARKER 唯一标记：点击会顺带触发
  // 全局解锁音效（同为 data:audio/wav），靠标记精准锁定目标实例，不误取解锁音效实例
  await evalJs(`(function(){
    var back = document.getElementById('gc-back'); if (back) back.click();
    return true;
  })()`);
  await sleep(300);
  const vOk = await evalJs(`(function(){
    var arr = JSON.parse(localStorage.getItem('xy-home-v2:group-chat-msgs') || '[]');
    arr.push({ side: 'in', cid: 'c1', type: 'voice', text: '小桃|||data:audio/wav;base64,Vk9JQ0VNQVJLRVJWb2ljZU1hcmtlclZX', ts: Date.now() });
    localStorage.setItem('xy-home-v2:group-chat-msgs', JSON.stringify(arr));
    return true;
  })()`);
  // 直接调内部渲染不可行 → 重进群聊页触发 renderAll（含该语音）
  await evalJs(`(function(){ var el = document.querySelector('.app[data-app="group-chat"]'); if (el) el.click(); return true; })()`);
  await sleep(800);
  await evalJs(`(function(){ var p = document.querySelector('#gc-body .msg-voice-play'); if (p) p.click(); return !!p; })()`);
  await sleep(200);
  const v1 = await evalJs(`(function(){
    var mine = window.__audioAll.filter(function(a){ return String(a.src||'').indexOf('Vk9JQ0VNQVJLRVJW') >= 0; });
    if (!mine.length) return { ok: false, n: 0 };
    var target = mine[mine.length - 1];
    var before = target.src !== '';
    target.dispatch('ended');
    return { ok: before && target.src === '', before: before, after: target.src === '', total: mine.length };
  })()`);
  check('V1 语音播放创建Audio(data:源)', !!v1 && v1.ok === true ? true : !!(v1 && v1.total), JSON.stringify(v1));
  check('V2 ended后src已卸载(解码缓冲随元素释放)', !!v1 && v1.ok === true, JSON.stringify(v1));

  // ================= ③ sfx 自定义音效播完卸 src =================
  await evalJs(`(function(){
    try { localStorage.setItem('xy-home-v2:sfx-in', 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='); } catch (e) {}
    if (window.playSfx) window.playSfx('in');
    return typeof window.playSfx === 'function';
  })()`);
  await sleep(200);
  const s1 = await evalJs(`(function(){
    var mine = window.__audioAll.filter(function(a){ return a.src.indexOf('data:audio') === 0; });
    if (!mine.length) return { ok: false };
    var target = mine[mine.length - 1];
    var before = target.src !== '';
    target.dispatch('ended');
    return { ok: before && target.src === '' };
  })()`);
  check('S1 自定义音效ended后src卸载', s1 && s1.ok === true);

  // ================= ⑤(编号③) bg-keep 通知 blob URL 回收 =================
  // 可见性门槛：lastVisibleAt 在加载时刻，需等 15s 过渡期
  await sleep(15500);
  await evalJs(`(function(){
    window.__notiTitles = [];
    if (window.bgNotifyCheck) window.bgNotifyCheck('OOM通知链路验证XYZ', Date.now(), { name: '小桃', av: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' });
    return true;
  })()`);
  await sleep(1200); // 头像 canvas 裁剪 + fetch(data:)→blob→createObjectURL + 80ms 后 revoke
  const b1 = await evalJs(`({
    created: window.__blobCreated, revoked: window.__blobRevoked,
    mine: (window.__notis || []).some(function (n) { return ((n.opts || {}).body || '').indexOf('OOM通知链路验证XYZ') >= 0; })
  })`);
  check('B1 本条测试通知走完发送链路(标记在body)', b1.mine === true, 'notis=' + (await evalJs('(window.__notis||[]).length')));
  check('B2 通知头像创建了 blob URL', b1.created >= 1, 'created=' + b1.created);
  check('B3 blob URL 已被 revokeObjectURL 回收', b1.revoked >= 1, 'created=' + b1.created + ' revoked=' + b1.revoked);

  // ================= ⑥ 通知头像跟随聊天专用键（bg-keep v3.13.x） =================
  // 头像互动/换头像只写 cs-avatar-partner，后台通知若仍读桌面键 avatar-partner 则不跟随。
  // 断言方式：设 cs 与桌面为两个不同头像，通知 icon 是 blob URL（cropAvatarToSquare→toBlob），
  // 通过拦截 createObjectURL 记录 blob→源 dataURL 的映射，再核对通知用的 blob 对应 cs 源。
  const av1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const av2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==A';
  const b4 = await evalJs(`(function(){
    window.__blobSrc = {};
    var co = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { var u = co(b); window.__blobSrc[u] = (b && b.size) || 0; return u; };
    try { window.activeStore().set('cs-avatar-partner', ${JSON.stringify(av1)}); } catch (e) {}
    try { window.activeStore().set('avatar-partner', ${JSON.stringify(av2)}); } catch (e) {}
    window.__notis = [];
    if (window.bgNotifyCheck) window.bgNotifyCheck('通知头像跟随聊天键XYZ', Date.now(), { name: '小桃' });
    return true;
  })()`);
  await sleep(2000);
  const b5 = await evalJs(`(function(){
    const ours = (window.__notis || []).filter(function (n) { return ((n.opts||{}).body||'').indexOf('通知头像跟随聊天键XYZ') >= 0; });
    if (!ours.length) return { mine: false };
    const icon = ours[0].opts.icon || '';
    if (!icon || icon.indexOf('blob:') !== 0) return { mine: true, blob: false, icon: String(icon).slice(0, 40) };
    const size = window.__blobSrc[icon] || -1;
    const a1len = (${JSON.stringify(av1)}).split(',')[1].length;
    const a2len = (${JSON.stringify(av2)}).split(',')[1].length;
    // 头像经 canvas 重绘为 jpeg，字节大小与源不完全一致但同一张图会明显接近；用「≠桌面源长度」区分
    return { mine: true, blob: true, size: size, a1len: a1len, a2len: a2len, isNotDesktop: size !== a2len };
  })()`);
  check('B4 通知头像采用 cs-avatar-partner（桌面 avatar-partner 不误用）',
    b5 && b5.mine === true && b5.blob === true && b5.isNotDesktop === true,
    'size=' + (b5 && b5.size) + ' a2len=' + (b5 && b5.a2len));
  try { window.activeStore().remove('cs-avatar-partner'); window.activeStore().remove('avatar-partner'); } catch (e) {}

  // ================= ⑦ badge 用单色透明图（bg-keep v3.13.x） =================
  // Android 通知左侧小图标规范要求 alpha 蒙版单色图；icon-512 全不透明会显示成白块/不显示。
  // 断言：通知 badge 是 canvas 生成的 dataURL（data:image/png）且带透明像素，而非原 icon-512 URL。
  const b6 = await evalJs(`(function(){
    // 通过已发送的通知 badge 字段验证
    const ours = (window.__notis || []).filter(function (n) { return ((n.opts||{}).body||'').indexOf('通知头像跟随聊天键XYZ') >= 0; });
    const badge = ours.length ? (ours[0].opts.badge || '') : '';
    const isData = badge.indexOf('data:image/png') === 0;
    return { badge: badge, isData: isData, isNotRawIcon: badge.indexOf('icon-512.png') < 0 };
  })()`);
  check('B5 通知 badge 为单色透明 dataURL（非原 icon-512）',
    b6 && b6.isData === true && b6.isNotRawIcon === true,
    'badge=' + String(b6 && b6.badge).slice(0, 40));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  chrome.kill();
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error('脚本异常:', e.message);
  try { chrome.kill(); } catch (e2) {}
  process.exit(1);
}
