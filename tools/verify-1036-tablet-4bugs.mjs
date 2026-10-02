// ===== 回归脚本：#1036 OPPO Pad 4 Pro 四报障根因修复（零机型分支） =====
// 用法：node build.mjs && node tools/verify-1036-tablet-4bugs.mjs
// 覆盖四件事：
//  F 朋友圈改昵称回扫存量快照（旧名写死的动态/评论/点赞改完即换新名且重绘）
//  M 音乐库 http 直链启动自愈 https ＋ 本地文件丢失持久打标出徽标
//  C 通话小框拖拽：拖拽期 touchmove 被 preventDefault（手势不被内核抢走）＋
//    pointer 监听在 document（capture 失败/事件不在 mini 上也跟手）
//  看门狗类修复（头像/背景解码挂起）由哨兵 #1036b/f/g/i/k/l 静态兜底，不在此测。
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
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

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
const cdpPort = 9860 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1036-' + Date.now()),
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}
async function closeSplash() {
  let closed = false;
  for (let i = 0; i < 30 && !closed; i++) {
    const s = await evalJs(`(function(){
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll');
        if (sc) sc.scrollTop = sc.scrollHeight;
        var men = document.getElementById('splash-mandatory-enter');
        if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
        return 'mwait';
      }
      var sp = document.getElementById('splash');
      if (!sp || sp.classList.contains('hide')) return 'closed';
      var sb = document.getElementById('splash-box');
      if (sb) sb.scrollTop = sb.scrollHeight;
      var se = document.getElementById('splash-enter');
      if (se && !se.disabled) { se.click(); return 'clicked'; }
      return 'wait';
    })()`);
    closed = s === 'closed';
    if (!closed) await sleep(300);
  }
  const diag = await evalJs(`(function(){ var sp=document.getElementById('splash'); return sp ? { hide: sp.classList.contains('hide'), hidden: sp.hidden, disp: getComputedStyle(sp).display } : { gone: true }; })()`);
  return closed || diag.disp === 'none' || diag.hidden === true || diag.gone === true;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
chk('A0 开屏已关闭（同族三条件口径）', await closeSplash());

// ---------- C 组：通话小框拖拽（无需真通话，小框常驻 DOM） ----------
const cSetup = await evalJs(`(function(){
  var mini = document.getElementById('call-mini');
  if (!mini) return 'no-el';
  mini.hidden = false;
  mini.style.right = 'auto'; mini.style.bottom = 'auto'; mini.style.transform = 'none';
  mini.style.left = '20px'; mini.style.top = '200px';
  var r = mini.getBoundingClientRect();
  return JSON.stringify({ x: r.left, y: r.top, w: r.width });
})()`);
chk('C0 通话小框可显形（模板锚点在位）', cSetup !== 'no-el' && !!cSetup, String(cSetup));
const c0x = JSON.parse(cSetup).x;
const c1 = JSON.parse(await evalJs(`(function(){
  var mini = document.getElementById('call-mini');
  var out = { movedByBody: null, touchPrevented: null, err: '' };
  try {
    var r = mini.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    mini.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    // 拖拽中途：document 上的触摸滚动事件应被 preventDefault（手势不被内核抢走＝#1012 口径）
    var tm = new TouchEvent('touchmove', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(tm);
    out.touchPrevented = tm.defaultPrevented;
    // pointermove 落在 body（不是 mini）上：监听在 document 才跟手（capture 被抢后的续命腿）
    mini.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: cx + 3, clientY: cy + 3, bubbles: true })); // 先给 mini 一下让 moved 置位
    document.body.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: cx + 60, clientY: cy + 60, bubbles: true }));
    out.movedByBody = mini.getBoundingClientRect().left;
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: cx + 60, clientY: cy + 60, bubbles: true }));
  } catch (e) { out.err = String(e); }
  return JSON.stringify(out);
})()`));
await sleep(300);
chk('C1 拖拽期 document touchmove 被 preventDefault（平板内核抢手势根治）', c1 && c1.touchPrevented === true, JSON.stringify(c1));
chk('C2 pointermove 打在 body 上也跟手（监听已从 mini 迁到 document）', c1 && typeof c1.movedByBody === 'number' && c1.movedByBody > c0x + 40, JSON.stringify(c1) + ' init=' + c0x);
const c3 = await evalJs(`(function(){
  try {
    var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
    var v = null;
    try { v = window.xyStore(pre).get('call-mini-pos'); } catch (e) {}
    if (!v) v = localStorage.getItem('xy-home-v2:call-mini-pos') || localStorage.getItem('xy-home-v2:default:call-mini-pos');
    return v || '';
  } catch (e) { return ''; }
})()`);
chk('C3 松手后小框位置落库（存盘链未回归）', !!c3 && /left/.test(String(c3)), String(c3));
await evalJs(`(function(){ var mini = document.getElementById('call-mini'); if (mini) { mini.hidden = true; mini.style.left = ''; mini.style.top = ''; } return 1; })()`);

// ---------- F 组：朋友圈改昵称回扫存量快照 ----------
const OLD = '旧名测试', NEW = '新名测试';
await evalJs(`(function(){
  var posts = [{ id: 'f_t1036', role: 'me', owner: 'default', authorName: ${JSON.stringify(OLD)}, content: '快照回扫测试动态', ts: Date.now(), likes: [${JSON.stringify(OLD)}], comments: [{ id: 'c1036', role: 'me', owner: 'default', authorName: ${JSON.stringify(OLD)}, text: '旧评论' }], imgs: [] }];
  try { window.xyStore('xy-home-v2').set('feed-posts', JSON.stringify(posts)); } catch (e) {}
  localStorage.setItem('xy-home-v2:feed-posts', JSON.stringify(posts));
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2:default';
  try { window.xyStore(pre).set('feed-user-name', ${JSON.stringify(OLD)}); } catch (e) {}
  return 1;
})()`);
await evalJs(`(function(){ var a = document.querySelector('.app[data-app="feed"]'); if (a) a.click(); return 1; })()`);
await sleep(1200);
const fPre = JSON.parse(await evalJs(`(function(){
  var el = document.getElementById('feed-my-name');
  var page = document.getElementById('page-feed');
  return JSON.stringify({ cover: el ? el.textContent : '', bodyHasOld: page ? String(page.textContent).indexOf(${JSON.stringify(OLD)}) >= 0 : false });
})()`));
chk('F0 种子生效：旧昵称在封面与列表快照里可见', fPre.cover === OLD && fPre.bodyHasOld === true, JSON.stringify(fPre));
await evalJs(`(function(){ var el = document.getElementById('feed-my-name'); if (el) el.click(); return 1; })()`);
await sleep(400);
await evalJs(`(function(){ var i = document.getElementById('modal-input'); if (i) { i.value = ${JSON.stringify(NEW)}; i.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()`);
await sleep(120);
await evalJs(`(function(){ var b = document.getElementById('modal-ok'); if (b) b.click(); return 1; })()`);
await sleep(800);
const f1 = JSON.parse(await evalJs(`(function(){
  var out = { stored: '', cover: '', bodyHasNew: false, bodyHasOld: true };
  try {
    var raw = localStorage.getItem('xy-home-v2:feed-posts') || (window.xyStore('xy-home-v2').get('feed-posts')) || '[]';
    out.stored = raw;
  } catch (e) { out.stored = 'ERR'; }
  var el = document.getElementById('feed-my-name'); out.cover = el ? el.textContent : '';
  var page = document.getElementById('page-feed');
  var t = page ? String(page.textContent) : '';
  out.bodyHasNew = t.indexOf(${JSON.stringify(NEW)}) >= 0; out.bodyHasOld = t.indexOf(${JSON.stringify(OLD)}) >= 0;
  return JSON.stringify(out);
})()`));
let postsArr = [];
try { postsArr = JSON.parse(f1.stored); } catch (e) {}
const p0 = postsArr[0] || {};
chk('F1 存量快照回扫落库（动态/评论/点赞 authorName 全部换新）', p0.authorName === NEW && Array.isArray(p0.likes) && p0.likes[0] === NEW && p0.comments && p0.comments[0].authorName === NEW, JSON.stringify(p0).slice(0, 200));
chk('F2 改完即重绘：页面显示新名、不再残留旧名', f1.cover === NEW && f1.bodyHasNew === true && f1.bodyHasOld === false, JSON.stringify(f1).slice(0, 200));

// ---------- M 组：音乐库 http→https 启动自愈＋本地文件丢失打标 ----------
await evalJs(`(function(){
  var lib = [
    { id: 'sm_t1036a', neteaseId: '', name: 'http直链测试', artist: '', url: 'http://q4.v2i.cc:8080/audio/download?time=1', source: 'url', duration: 0, playlistId: 'spl_default', addedAt: Date.now() },
    { id: 'sm_t1036b', neteaseId: '', name: '丢失文件测试', artist: '', url: '', source: 'local', duration: 0, playlistId: 'spl_default', addedAt: Date.now() }
  ];
  var s = JSON.stringify(lib);
  try { window.xyStore('xy-home-v2:default').set('music-library', s); } catch (e) {}
  localStorage.setItem('xy-home-v2:default:music-library', s);
  return 1;
})()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
await closeSplash();
const m1raw = await evalJs(`(function(){
  var raw = '';
  try { raw = localStorage.getItem('xy-home-v2:default:music-library') || window.xyStore('xy-home-v2:default').get('music-library') || ''; } catch (e) { raw = 'ERR'; }
  return raw;
})()`);
let mlib = [];
try { mlib = JSON.parse(m1raw); } catch (e) {}
const httpTrack = mlib.find((x) => x && x.id === 'sm_t1036a') || {};
chk('M1 http 直链启动自愈为 https（混合内容「自己失效」根治）', String(httpTrack.url || '').indexOf('https://') === 0, JSON.stringify(httpTrack).slice(0, 160));
// 进音乐页点播「本地无文件」的歌 → fileLost 落库＋徽标
await evalJs(`(function(){ var a = document.querySelector('.app[data-app="music"]'); if (a) a.click(); return 1; })()`);
await sleep(1200);
await evalJs(`(function(){ var row = document.querySelector('.sm-song[data-id="sm_t1036b"]'); if (row) row.click(); return !!row; })()`);
await sleep(6000);
const m2 = JSON.parse(await evalJs(`(function(){
  var out = { lost: -1, badge: '', row: false };
  try {
    var raw = localStorage.getItem('xy-home-v2:default:music-library') || window.xyStore('xy-home-v2:default').get('music-library') || '[]';
    var a = JSON.parse(raw); var t = a.find(function (x) { return x && x.id === 'sm_t1036b'; });
    out.lost = t ? (t.fileLost || 0) : -1;
  } catch (e) {}
  var row = document.querySelector('.sm-song[data-id="sm_t1036b"]');
  out.row = !!row;
  out.badge = row ? String(row.textContent) : '';
  return JSON.stringify(out);
})()`));
chk('M2 本地文件丢失点播后持久打标 fileLost', m2.lost === 1, JSON.stringify(m2));
chk('M3 列表出「文件丢失」徽标（不再是刷完仍显示「本地」）', m2.badge.indexOf('文件丢失') >= 0, m2.badge.slice(0, 120));

console.log(`\nverify-1036-tablet-4bugs: ${pass} PASS / ${fail} FAIL`);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
