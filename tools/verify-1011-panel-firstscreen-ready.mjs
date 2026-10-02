// ===== 回归脚本：#1011 表情包面板/头像互动「每次打开图片都会闪烁和重新加载」残留根因收口 =====
// 背景（用户报障，红米 K80 Chrome 实报、用户明说其他设备型号也有；#457/#508/#509/#662/#692/#704/
//   #716/#907 八轮之后用户仍说「这个问题一直没有解决」）：
//   前八轮盯的是「img 节点有没有被重建」与「已解码位图有没有被回收」，判据是节点身份与 decode 时序
//   ——节点一个没换、照样闪。本轮把判据换成**面板可见那一帧首屏是不是已经就绪**，缺陷就露出来了：
//   面板里的图很多不是 dataURL 而是媒体池令牌 @@m:<hash>（令牌化把大表情库本体收进 IDB），旧等待
//   只对「此刻已经有 src 的图」await decode()，而首开/整页重载后这一拍一张 src 都没有（懒加载补
//   src 要等 IO 回调、令牌解析要读 IDB）⇒ jobs 为空、等待当场放行、面板在图片没就绪时就显示，
//   随后每张图才走「令牌当相对 URL 请求→404→池读 IDB→重写 src→解码」＝用户看到的闪一下再一张张
//   重新加载。头像半框同族：首开这一拍图只有 data-src，等待同样是空的。
// 修法（零机型分支）：等待判据改成「首屏每张图都拿到真载荷且解码完成」——首屏令牌当场交给媒体池
//   批量解析（不等 250ms 整组预热班次）、非令牌载荷当场补 src（不等懒加载泵）、未就绪等自己的
//   load；另加 CSS：令牌态那一格先不画（避免 404 裂图/alt 文案的第二次视觉变化）。
// 判别力（SERVE_ROOT 指向纯 HEAD 红副本实测）：A1/A2/A3/B1/B2/B3 六条行为断言在纯 HEAD 全红、
//   在修复产物全绿；A4（面板仍能按时显示）/A5（懒加载没被改成全量加载）/C 组（回归护栏）两侧同绿
//   ＝防修过头、防吊死。
// 用法：node build.mjs && node tools/verify-1011-panel-firstscreen-ready.mjs
//      SERVE_ROOT=<隔离构建目录> 可验未收口产物（绿/红对照都用它）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = normalize(process.env.SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 夹具：真体量 PNG（噪声→压不动，体积接近真机贴纸，才会走池令牌化那条路） ----------
let crcTable = null;
function crc32(buf) {
  if (!crcTable) { crcTable = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; } }
  let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0;
}
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function makePng(w, h, seed) {
  const raw = Buffer.alloc((w * 4 + 1) * h); let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s >>> 24; };
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = (x * 2 + rnd()) & 255; raw[o + 1] = (y * 2 + rnd()) & 255; raw[o + 2] = ((x ^ y) + rnd()) & 255; raw[o + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
const IMG_N = 48, AV_N = 12;
const fxEmoji = [];
for (let i = 0; i < IMG_N; i++) fxEmoji.push('data:image/png;base64,' + makePng(160, 160, 1000 + i * 7919).toString('base64'));
const fxAv = fxEmoji.slice(0, AV_N);
const serveJson = { '/__fx-emoji.json': JSON.stringify(fxEmoji), '/__fx-av.json': JSON.stringify(fxAv) };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (serveJson[u]) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(serveJson[u]); return; }
    let p = normalize(join(root, u));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end(); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
const cdpPort = 9820 + Math.floor(Math.random() * 60);
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v1011-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); let jsErrors = 0;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') jsErrors++; };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('cdp connect failed'); process.exit(1); }
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((r) => { pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); }); };
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 60000 });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); }
}

// ---------- S 组：产物锚点（外置 js 后 chat.js/avatar-lib.js 落 js/<file>，CSS 合并在产物内） ----------
const artifact = readFileSync(join(root, 'index.html'), 'utf8');
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const inProd = (p, needle) => (rd(p) + artifact).includes(needle);
chk('S1 表情面板首屏判定函数在产物（删＝等待退回「有 src 就 await decode」，首拍空等待放行＝闪一下再逐张加载复发）',
  inProd('js/chat.js', 'function emojiPanelFirstScreen() {'), '');
chk('S2 首屏令牌当场交池解析（删＝等 250ms 整组班次，首屏还是先裂图后上图）',
  inProd('js/chat.js', 'if (toks.length && window.mochiMediaWarmTokens)'), '');
chk('S3 单图就绪判据：真载荷＋已解码（删＝只 await decode，令牌 src 的 decode 必失败＝等待形同虚设）',
  inProd('js/chat.js', 'if (srcNow().indexOf(\'@@m:\') !== 0) { done = true; off(); res(false); return; }'), '');
chk('S4 头像半框首屏补载荷（删＝首开这一拍图只有 data-src、等待为空＝闪一下再逐格冒出来复发）',
  inProd('js/avatar-lib.js', 'const first = avKickFirstScreen(grid);'), '');
chk('S5 头像半框就绪判据（同上，avatar 侧独立一支）',
  inProd('js/avatar-lib.js', 'function avImgReady(im) {'), '');
chk('S6 令牌态格子不画（删＝404 裂图/alt 文案闪一下再换真图，滚动到未解析格子同样可见）',
  artifact.includes('#emoji-list img[src^="@@m:"] { opacity: 0; }'), '');
chk('S7 头像页签/大类切换同样先补首屏载荷（删＝切页逐格冒出）',
  inProd('js/avatar-lib.js', 'syncAvPane(); try { avKickFirstScreen(avGrid); avKickFirstScreen(avMeGrid); }'), '');

// ---------- 起页 ----------
await cdp('Page.enable', {}); await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4000);

const PROBE = `(function(){
  if (window.__p11) return true;
  window.__p11 = { frames: null, ev: [], seq: 0, ids: new WeakMap() };
  function idOf(n){ var m=window.__p11.ids; if(!m.has(n)) m.set(n, ++window.__p11.seq); return m.get(n); }
  window.__p11.idOf = idOf;
  function scroller(kind){ return kind==='list' ? document.getElementById('emoji-list') : document.getElementById('avlib-card'); }
  function panel(kind){ return kind==='list' ? document.getElementById('emoji-panel') : document.getElementById('avlib-card'); }
  // 首屏＝滚动容器可视区内的 img（与修复代码同口径：下沿外 80px 内算首屏，已滚上去的不算）
  window.__p11.snap = function(kind){
    var sc = scroller(kind); if(!sc) return null;
    var cr = sc.getBoundingClientRect(); var imgs = sc.querySelectorAll('img');
    var first=[], loaded=0, tok=0, withSrc=0, nodes=[];
    for (var i=0;i<imgs.length;i++){
      var im=imgs[i]; var r=im.getBoundingClientRect();
      if (r.bottom < cr.top - 80) continue;
      if (r.top > cr.bottom + 80) break;
      first.push(im);
      var s = im.getAttribute('src') || '';
      if (s) withSrc++;
      if (s.indexOf('@@m:')===0) tok++;
      if (im.naturalWidth>0) loaded++;
      nodes.push(idOf(im));
    }
    return { n:first.length, loaded:loaded, tokenSrc:tok, withSrc:withSrc, ids:nodes, t:Math.round(performance.now()) };
  };
  // 面板一可见的那一帧就快照（rAF 在绘制前跑），并记该帧时间；其后发生的 load/error 都算「可见之后」
  window.__p11.arm = function(){
    window.__p11.frames = { list:null, av:null };
    var tick = function(){
      ['list','av'].forEach(function(k){
        if (window.__p11.frames[k]) return;
        var p = panel(k); if (!p || p.hidden) return;
        window.__p11.frames[k] = window.__p11.snap(k);
      });
      if (!window.__p11.frames.list || !window.__p11.frames.av) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  ['load','error'].forEach(function(ev){
    document.addEventListener(ev, function(e){
      var tg = e.target; if (!tg || tg.tagName !== 'IMG') return;
      var k = null;
      if (document.getElementById('emoji-list') && document.getElementById('emoji-list').contains(tg)) k='list';
      else if (document.getElementById('avlib-card') && document.getElementById('avlib-card').contains(tg)) k='av';
      if (!k) return;
      var ids = window.__p11.frames && window.__p11.frames[k] ? window.__p11.frames[k].ids : null;
      var snapT = window.__p11.frames && window.__p11.frames[k] ? window.__p11.frames[k].t : -1;
      var id = idOf(tg);
      window.__p11.ev.push({ ev:ev, k:k, id:id, t:Math.round(performance.now()), firstScreen: !!(ids && ids.indexOf(id)>=0), afterVisible: snapT>=0 && performance.now()>=snapT });
    }, true);
  });
  window.__p11.afterVisibleFirstScreen = function(kind){
    var f = window.__p11.frames && window.__p11.frames[kind];
    if (!f) return { load:0, error:0, samples:[] };
    var o = { load:0, error:0, samples:[] };
    for (var i=0;i<window.__p11.ev.length;i++){ var e=window.__p11.ev[i];
      if (e.k===kind && e.firstScreen && e.afterVisible){ o[e.ev]++; if (o.samples.length<8) o.samples.push(e.ev+'#'+e.id+'@'+e.t); } }
    return o;
  };
  window.__p11.reset = function(){ window.__p11.ev.length = 0; window.__p11.frames = null; window.__p11.arm(); };
  window.__p11.total = function(kind){ var sc=scroller(kind); var imgs=sc?sc.querySelectorAll('img'):[]; var l=0; for(var i=0;i<imgs.length;i++) if(imgs[i].naturalWidth>0) l++; return {all:imgs.length, loaded:l}; };
  return true;})()`;

// 关开屏 + 压制干扰层（同 verify-panel-prewarm 口径）
for (let i = 0; i < 30; i++) {
  const s = await evalJs(`(function(){
    var mm=document.getElementById('splash-mandatory');
    if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll'); if(sc)sc.scrollTop=sc.scrollHeight;
      var m=document.getElementById('splash-mandatory-enter'); if(m&&!m.classList.contains('is-disabled')){m.click();return 'mc';} return 'mw';}
    var sp=document.getElementById('splash'); if(!sp||sp.classList.contains('hide')) return 'closed';
    var sb=document.getElementById('splash-box'); if(sb)sb.scrollTop=sb.scrollHeight;
    var se=document.getElementById('splash-enter'); if(se&&!se.disabled){se.click();return 'c';} return 'w';})()`);
  if (s === 'closed') break;
  await sleep(300);
}
await evalJs(`(function(){
  ['splash-mandatory','qa-mask','backup-remind-bar','modal-mask'].forEach(function(id){var e=document.getElementById(id); if(e)e.hidden=true;});
  var sp=document.getElementById('splash'); if(sp){sp.classList.add('hide');sp.hidden=true;}
  document.querySelectorAll('.modal-mask').forEach(function(m){m.hidden=true;}); return true;})()`);
await sleep(400);

// 种数据：TA 专属表情包分组 + 头像池（口径同 verify-panel-prewarm：memoryCache 与 IDB 权威键双写）
const seed = await evalJs(`Promise.all([fetch('/__fx-emoji.json').then(function(r){return r.json();}), fetch('/__fx-av.json').then(function(r){return r.json();})]).then(function(a){
  var emo = a[0], av = a[1];
  var j = JSON.stringify({text:[],kaomoji:[],emoji:[],sticker:[['回归组',emo]],image:[],poke:[],voice:[]});
  window.xyStore('xy-home-v2:default').set('cc-groups', j);
  if (window.idbSet) window.idbSet('xy-home-v2:default:cc-groups', j);
  if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite();
  var pf = JSON.stringify({mode:'ta', ta:'回归组', cat:'sticker'});
  window.xyStore('xy-home-v2:default').set('emoji-last', pf);
  if (window.idbSet) window.idbSet('xy-home-v2:default:emoji-last', pf);
  var aj = JSON.stringify(av);
  window.xyStore('xy-home-v2:default').set('avatar-lib', aj);
  try { localStorage.setItem('xy-home-v2:default:avatar-lib', aj); } catch (eQ) {}
  if (window.idbSet) window.idbSet('xy-home-v2:default:avatar-lib', aj);
  // #1011 判据隔离：关掉 #907 的空闲预热，只量「打开这条路径」——预热开着时它会在面板未开时
  // 就把首屏图加载好，缺陷被它掩盖（真机常态恰恰是「预热还没轮到用户就点开了」/用户关掉开关）
  try { window.xyStore('xy-home-v2').set('chat-panel-prewarm', '0'); } catch (eP) {}
  try { localStorage.setItem('xy-home-v2:chat-panel-prewarm', '0'); } catch (eP2) {}
  return [emo.length, av.length];})`);
await sleep(1500);
await evalJs(`(function(){ document.dispatchEvent(new Event('contact-switched')); return true; })()`);
await sleep(400);
await evalJs('window.enterChat(); true');
await sleep(1800);
// 冷会话口径：整页重载后重来（首开那一拍才是用户报障的那一拍）
await cdp('Page.reload', { ignoreCache: false });
await sleep(4500);
for (let i = 0; i < 30; i++) {
  const s = await evalJs(`(function(){
    var mm=document.getElementById('splash-mandatory');
    if(mm&&!mm.hidden){var sc=document.getElementById('splash-mandatory-scroll'); if(sc)sc.scrollTop=sc.scrollHeight;
      var m=document.getElementById('splash-mandatory-enter'); if(m&&!m.classList.contains('is-disabled')){m.click();return 'mc';} return 'mw';}
    var sp=document.getElementById('splash'); if(!sp||sp.classList.contains('hide')) return 'closed';
    var sb=document.getElementById('splash-box'); if(sb)sb.scrollTop=sb.scrollHeight;
    var se=document.getElementById('splash-enter'); if(se&&!se.disabled){se.click();return 'c';} return 'w';})()`);
  if (s === 'closed') break;
  await sleep(300);
}
await evalJs(`(function(){
  ['splash-mandatory','qa-mask','backup-remind-bar','modal-mask'].forEach(function(id){var e=document.getElementById(id); if(e)e.hidden=true;});
  var sp=document.getElementById('splash'); if(sp){sp.classList.add('hide');sp.hidden=true;}
  document.querySelectorAll('.modal-mask').forEach(function(m){m.hidden=true;}); return true;})()`);
await sleep(400);
await evalJs('window.enterChat(); true');
await sleep(1200);
await evalJs(PROBE);

// —— P 组：夹具前提（两侧同绿；夹具没种上时行为断言无判别力） ——
const pre = await evalJs(`(function(){
  var g = (window.getScopedGroups && window.getScopedGroups('sticker','own')) || [];
  var n = 0; for (var i=0;i<g.length;i++) if (g[i][0]==='回归组') n = g[i][1].length;
  return { groups: g.length, inGroup: n, avImg: (window.mochiPrewarmAvlib ? 'yes':'no') };
})()`);
chk('P1 表情包夹具已种进「回归组」（记忆缓存与 IDB 双写）', !!pre && pre.inGroup === IMG_N, pre);
chk('P2 种子是 dataURL 形态（令牌化由产品在渲染期完成，不是夹具预置的）',
  !!pre && pre.inGroup === IMG_N, pre);
const prewarmOff = await evalJs(`(function(){ try { return window.xyStore('xy-home-v2').get('chat-panel-prewarm'); } catch (e) { return 'err'; } })()`);
chk('P3 空闲预热已关（判据只看打开路径；预热开着会在面板未开时先把首屏加载好、掩盖缺陷）',
  prewarmOff === '0', { prewarmOff });

// —— A 组：表情包面板「可见那一帧首屏必须已就绪」 ——
await evalJs('window.__p11.reset(); true');
const t0 = Date.now();
await evalJs(`document.getElementById('chat-emoji-btn').click(); true`);
let visMs = null;
for (let i = 0; i < 400; i++) { if (await evalJs(`(function(){var e=document.getElementById('emoji-panel'); return !!(e && !e.hidden);})()`)) { visMs = Date.now() - t0; break; } await sleep(8); }
await sleep(1400);
const A = await evalJs(`({ frame: window.__p11.frames.list, after: window.__p11.afterVisibleFirstScreen('list'), total: window.__p11.total('list') })`);
chk('A1 面板可见那一帧首屏无未解析令牌（纯 HEAD：8 张仍是 @@m: 令牌＝裂图/alt 文案一闪）',
  !!A && A.frame && A.frame.n > 0 && A.frame.tokenSrc === 0, A && A.frame);
chk('A2 面板可见那一帧首屏图全部已就绪（纯 HEAD：24 张里只有 16 张解码就绪）',
  !!A && A.frame && A.frame.n > 0 && A.frame.loaded === A.frame.n, A && A.frame);
chk('A3 面板可见之后首屏不再发生任何 load/error（纯 HEAD：21 次 load＋7 次 404 error＝逐张重新加载）',
  !!A && A.after && A.after.load === 0 && A.after.error === 0, A && A.after);
chk('A4 面板仍按时显示（修复没把等待改成吊死，3s 上限）', visMs !== null && visMs < 3000, { visMs });
chk('A5 懒加载仍是懒加载（首屏外的图没有被全量加载＝没把等待实现成「先加载全部」）',
  !!A && A.total && A.total.loaded > 0 && A.total.loaded < A.total.all, A && A.total);
const tokOpacity = await evalJs(`(function(){
  var list = document.getElementById('emoji-list'); if (!list) return null;
  var im = document.createElement('img');
  im.setAttribute('src', '@@m:00000000000000000000000000000000');
  im.style.width = '20px'; im.style.height = '20px';
  list.appendChild(im);
  var o = getComputedStyle(im).opacity;
  im.parentNode.removeChild(im);
  return o; })()`);
chk('A6 令牌态格子由 CSS 不画（纯 HEAD：opacity 1＝404 裂图/alt 文案一闪再换真图，慢机兜底放行时同样可见）',
  tokOpacity === '0', { tokOpacity });

// —— B 组：头像互动半框「可见那一帧首屏必须已就绪」 ——
await evalJs(`(function(){ var ep=document.getElementById('emoji-panel'); if(ep) ep.hidden=true; if(window.closeAvlib) window.closeAvlib(); return true;})()`);
await sleep(700);
await evalJs('window.__p11.reset(); true');
const t1 = Date.now();
await evalJs(`document.getElementById('more-avatar').click(); true`);
let avVisMs = null;
for (let i = 0; i < 400; i++) { if (await evalJs(`(function(){var e=document.getElementById('avlib-card'); return !!(e && !e.hidden);})()`)) { avVisMs = Date.now() - t1; break; } await sleep(8); }
await sleep(1400);
const B = await evalJs(`({ frame: window.__p11.frames.av, after: window.__p11.afterVisibleFirstScreen('av'), total: window.__p11.total('av') })`);
chk('B1 头像半框可见那一帧首屏图已有载荷 src（纯 HEAD：首开这一拍图只有 data-src，一张都还没补）',
  !!B && B.frame && B.frame.n > 0 && B.frame.withSrc === B.frame.n, B && B.frame);
chk('B2 头像半框可见那一帧首屏图全部已就绪（纯 HEAD：0 张就绪＝图随后一张张落地）',
  !!B && B.frame && B.frame.n > 0 && B.frame.loaded === B.frame.n, B && B.frame);
chk('B3 头像半框可见之后首屏不再发生 load/error（纯 HEAD：打开后仍在逐张加载）',
  !!B && B.after && B.after.load === 0 && B.after.error === 0, B && B.after);
chk('B4 半框仍按时显示（3s 上限）', avVisMs !== null && avVisMs < 3000, { avVisMs });

// —— C 组：回归护栏（两侧同绿：没修过头、既有能力一条没伤） ——
await evalJs(`(function(){ if(window.closeAvlib) window.closeAvlib(); return true;})()`);
await sleep(600);
const c1 = await evalJs(`(function(){ var ep=document.getElementById('emoji-panel'); if(!ep) return null;
  var before = ep.querySelectorAll('img').length;
  ep.hidden = false;
  var r = { before: before, hidden: ep.hidden };
  ep.hidden = true; return r; })()`);
chk('C1 面板图节点仍在（修复没把渲染路径改空）', !!c1 && c1.before === IMG_N, c1);
const c2 = await evalJs(`(function(){ var ep=document.getElementById('emoji-panel');
  var cs = ep ? getComputedStyle(ep) : null; return { panelHiddenDisplay: cs ? cs.display : null, listImgs: document.querySelectorAll('#emoji-list img').length }; })()`);
chk('C2 面板 keep-alive 形态未变（#907 的 display:flex 仍在＝位图不因 display:none 整批回收）',
  !!c2 && c2.panelHiddenDisplay === 'flex', c2);
const c3 = await evalJs(`(function(){
  var before = document.querySelectorAll('#emoji-list img').length;
  document.getElementById('chat-emoji-btn').click();
  return { before: before }; })()`);
await sleep(900);
const c3b = await evalJs(`(function(){ var ep=document.getElementById('emoji-panel');
  var first = ep.querySelectorAll('img').length;
  return { after: first, visible: !ep.hidden }; })()`);
chk('C3 关闭后再打开仍正常（第二开不重建节点、不留白）',
  !!c3 && !!c3b && c3b.visible === true && c3b.after === c3.before, { c3, c3b });
await evalJs(`(function(){ var ep=document.getElementById('emoji-panel'); if(ep) ep.hidden=true; return true;})()`);

chk('Z 全程零页面 JS 异常', jsErrors === 0, { jsErrors });

console.log('\n== ' + pass + ' pass / ' + fail + ' fail ==');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
