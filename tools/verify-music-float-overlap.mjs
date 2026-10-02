// ===== 功能验证脚本：#587 悬浮播放小框压住音乐控件（桌面音乐「按钮很多失效」） =====
// 用法：node tools/verify-music-float-overlap.mjs（需 node 21+ 与本机 Chrome/Edge）
//   RED=1 node tools/verify-music-float-overlap.mjs   ← RED 基线：只把产物里的让位判据剪掉再跑同一批
//                                                      断言，应见 B3/B6 红（＝脚本有判别力，用户现象可复现）
// 用户报障（2026-09-16，明说「其他设备型号也有出现」）：「桌面音乐功能里的按钮很多失效了」。
// 根因（机型无关、纯几何）：全局悬浮小框 #sm-float 默认 left:12px;top:80px、宽 230px、高随
//   系统字体浮动，正好压在音乐页上半部与桌面音乐小组件上——音乐页「我的音乐库 / 歌单 /
//   我的收藏」三颗 tab 与桌面小组件进度条 #mw-bar 被它覆盖，elementFromPoint 命中 sm-float，
//   点上去毫无反应（系统字号越大压得越多＝多机型同现象）。
// 修复：悬浮小框在「音乐页可见」或「桌面音乐小组件在位」时让位（两处各有完整播放控件），
//   并观察 #page-phone/#page-music 的 hidden 做切页即时重算；其余页面显示逻辑不变。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const RED = !!process.env.RED;
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const chk = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? ' —— ' + detail : '')); } };

// ---------- S 层：源码断言 ----------
const readSrc = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
const mp = readSrc('src/js/music-player.js');
const bm = readSrc('build.mjs');
const cpcss = readSrc('src/css/chat-pages.css');
console.log('S 层（源码作用域）');
chk('S1 让位判据函数在位', mp.includes('function floatOwnSurfaceShown() {'));
chk('S2 renderFloat 的 hidden 表达式接入让位判据', mp.includes('|| floatHideByWidget || floatOwnSurfaceShown();'));
chk('S3 音乐页可见 → 让位', mp.includes('if (musicPage && !musicPage.hidden) return true;'));
chk('S4 桌面小组件在位 → 让位', mp.includes('return !!(w && w.offsetParent !== null);'));
chk('S5 切页重算接线（#page-phone/#page-music hidden 观察）', mp.includes('new MutationObserver(function () { renderFloat(); })') && mp.includes("['page-phone', 'page-music'].forEach("));
chk('S6 build.mjs 登记哨兵 #587a~#587f 六条', (bm.match(/name: '#587[a-f]/g) || []).length === 6);
chk('S7 悬浮小框默认定位仍是左上（压住的几何前提；若挪走默认位置本脚本 B 层仍成立）', cpcss.includes('position:fixed; left:12px; top:80px; z-index:9999;'));

// ---------- B 层：真实产物行为 ----------
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

function makeWav(s) { // 30 秒静音 WAV，dataURL 可播（无外部网络依赖）
  const rate = 8000, n = rate * s, dl = n * 2; const b = Buffer.alloc(44 + dl);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dl, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(dl, 40);
  return 'data:audio/wav;base64,' + b.toString('base64');
}
const WAV = makeWav(30);
const SEED = JSON.stringify([
  { id: 'vf1', name: '验证歌一', artist: 'A', url: WAV, source: 'url', duration: 30, playlistId: 'default', addedAt: 1 },
  { id: 'vf2', name: '验证歌二', artist: 'B', url: WAV, source: 'url', duration: 30, playlistId: 'default', addedAt: 2 },
]);
const PLS = JSON.stringify([{ id: 'spl_default', name: '默认歌单', createdAt: 1 }, { id: 'vf_pl', name: '验证歌单', createdAt: 2 }]);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    let body = readFileSync(p);
    // RED 基线：只把产物里的让位判据剪掉（不改 src、不写盘），其余与线上逐字节一致
    if (RED && p === join(root, 'index.html')) {
      body = Buffer.from(body.toString('utf8')
        .replace(/ \|\| floatOwnSurfaceShown\(\)/g, '')
        .replace('if (phonePageEl.hidden) hideGreetBanner();', 'if (false) hideGreetBanner();'), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const profDir = join(process.env.TEMP || '/tmp', 'mochi-v581-' + Date.now());
const cdpPort = 14550 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + profDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map(); const errors = [];
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
          if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text)); }
        };
        return;
      }
    } catch (e) {}
    await SLEEP(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { errors.push('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 200)); return null; }
  return r && r.result ? r.result.value : null;
}
async function clickAt(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function clickSel(sel) {
  const p = await evalJs(`(function(){ var n=document.querySelector(${JSON.stringify(sel)}); if(!n) return null; var r=n.getBoundingClientRect(); if(!r.width||!r.height) return null; return [Math.round(r.left+r.width/2), Math.round(r.top+r.height/2)]; })()`);
  if (!p) return false;
  await clickAt(p[0], p[1]);
  return true;
}
// 命中体检：中心点 elementFromPoint 是否落在目标自身/其后代（区分「不在这一页」与「被别的东西压住」）
const HIT = (sels) => evalJs(`(function(){ return ${JSON.stringify(sels)}.map(function(sel){
  var n = document.querySelector(sel); if (!n) return { sel: sel, why: '元素不存在' };
  var r = n.getBoundingClientRect(); if (!r.width || !r.height) return { sel: sel, why: '尺寸为 0（不在显示的页 / display:none）' };
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  var inView = cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight;
  var h = inView ? document.elementFromPoint(cx, cy) : null;
  var ok = !!(h && (h === n || n.contains(h)));
  var blocker = ok ? '' : (inView && h ? String((h.closest('[id]') && h.closest('[id]').id) || h.className || h.tagName) : '');
  return { sel: sel, ok: ok, blockedBy: blocker, why: ok ? '' : (inView ? '被 ' + (blocker || '?') + ' 压住' : '中心点不在视口内') };
}); })()`);
const fmtBad = (arr) => (arr || []).filter((x) => !x.ok).map((x) => x.sel + '（' + x.why + '）').join(' , ');
// 现场：当前显示哪个页、悬浮小框在不在
const pagesAt = () => evalJs(`(function(){ return {
  active: Array.prototype.filter.call(document.querySelectorAll('.page'), function(p){ return !p.hidden; }).map(function(p){ return p.id; }).join(','),
  float: (function(){ var f=document.getElementById('sm-float'); return f ? (f.hidden ? 'hidden' : 'shown') : 'missing'; })() }; })()`);

await cdpConnect();
await cdp('Page.enable', {}); await cdp('Runtime.enable', {});
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `try{
  localStorage.setItem('xy-home-v2:default:music-library', ${JSON.stringify(SEED)});
  localStorage.setItem('xy-home-v2:default:music-playlists', ${JSON.stringify(PLS)});
  localStorage.setItem('xy-home-v2:default:music-default-done','1');
  localStorage.setItem('xy-home-v2:age-confirmed','1');
}catch(e){}` });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await SLEEP(5200);
await evalJs(`(function(){ var s=document.getElementById('splash'); if(s){ s.classList.add('hide'); setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s); },500); } return 1; })()`);
await SLEEP(1000);
await evalJs(`(function(){ var m=document.getElementById('modal-mask'); if(m && !m.hidden){ var o=document.getElementById('modal-ok'); if(o) o.click(); } return 1; })()`);
await SLEEP(600);

console.log('\nB 层（真实产物行为' + (RED ? '，RED 基线＝剪掉让位判据' : '') + '）');
chk('B0 就绪（音乐图标在）', await evalJs(`!!document.querySelector('.app[data-app="music"]')`) === true);

// 从音乐页列表播歌（用户最常见入口）→ 悬浮小框按原设计会冒出来
await evalJs(`(function(){ var el=document.querySelector('.app[data-app="music"]'); if(el) el.click(); return 1; })()`);
await SLEEP(1300);
chk('B1 音乐页打开（#page-music 可见）', await evalJs(`!document.getElementById('page-music').hidden`) === true);
await clickSel('#music-lib-list .sm-song');
await SLEEP(2500);
const cur = await evalJs(`(function(){ var s=document.getElementById('mw-song'); return s?s.textContent:null; })()`);
chk('B2 音乐页列表点歌生效（有当前曲目）', !!cur && cur !== '未在播放', String(cur));
console.log('   [现场] ' + JSON.stringify(await pagesAt()) + ' 当前曲=' + cur);

// —— 音乐页：三颗 tab + 工具栏 + 返回/设置必须点得动 ——
const musicPageHits = await HIT(['#page-music .fav-tab[data-mtab="lib"]', '#page-music .fav-tab[data-mtab="pl"]', '#page-music .fav-tab[data-mtab="fav"]',
  '#music-upload', '#music-add-url', '#music-batch', '#music-vip-clean', '#music-set', '#music-back']);
// #587 的两个元凶：悬浮播放小框 + 今日留言横幅
const B581 = ['sm-float', 'daily-greet'];
const hitBy581 = (musicPageHits || []).filter((x) => !x.ok && B581.indexOf(x.blockedBy) >= 0);
const hitOther = (musicPageHits || []).filter((x) => !x.ok && B581.indexOf(x.blockedBy) < 0);
chk('B3 音乐页控件不被悬浮小框 / 今日留言横幅压住（tab / 工具栏 / 返回 / 设置逐个命中）', hitBy581.length === 0, fmtBad(hitBy581));
if (hitOther.length) console.log('   [旁注] 另有非 #587 浮层压住：' + fmtBad(hitOther) + '（TA 新消息/版本更新/备份提醒等通知横幅族，属既有设计，本批不动）');
const floatOnMusicPage = await evalJs(`(function(){ var f=document.getElementById('sm-float'); if(!f) return 'missing'; var r=f.getBoundingClientRect(); return { hidden: f.hidden, rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)] }; })()`);
chk('B4 音乐页上悬浮小框让位（收起而非遮挡）', floatOnMusicPage && floatOnMusicPage.hidden === true, JSON.stringify(floatOnMusicPage));
const tabClicked = await clickSel('#page-music .fav-tab[data-mtab="pl"]');
await SLEEP(700);
const selTabs = await evalJs(`Array.prototype.filter.call(document.querySelectorAll('#page-music .fav-tab'), function(t){ return t.classList.contains('sel'); }).map(function(t){ return t.dataset.mtab; }).join(',')`);
chk('B5 实测点「歌单」tab 能切过去', tabClicked && selTabs === 'pl', String(selTabs));

// —— 桌面：音乐小组件与其进度条必须点得动 ——
await evalJs(`(function(){ var t=document.querySelector('.tab[data-page="page-phone"]'); if(t) t.click(); if(window.deskGo) window.deskGo(1); return 1; })()`);
await SLEEP(1000);
const deskHits = await HIT(['#mw-mode', '#mw-queue', '#mw-prev', '#mw-play', '#mw-next', '#mw-heart', '#mw-bar']);
chk('B6 桌面音乐小组件按钮 / 进度条点得动', (deskHits || []).every((x) => x.ok), fmtBad(deskHits));
const floatOnDesk = await evalJs(`(function(){ var f=document.getElementById('sm-float'); return f ? f.hidden : 'missing'; })()`);
chk('B7 桌面（小组件在位）上悬浮小框让位', floatOnDesk === true, String(floatOnDesk));

// —— 其它页面（聊天）：悬浮小框照旧要在，别把功能整体砍掉 ——
await evalJs(`(function(){ var t=document.querySelector('.tab[data-page="page-chat"]'); if(t){ t.click(); return 1; }
  document.querySelectorAll('.page').forEach(function(p){ p.hidden = true; }); var c=document.getElementById('page-chat'); if(c) c.hidden=false; return 1; })()`);
await SLEEP(900);
const floatOnChat = await evalJs(`(function(){ var f=document.getElementById('sm-float'); if(!f) return 'missing'; var r=f.getBoundingClientRect(); return { hidden: f.hidden, rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)] }; })()`);
chk('B8 聊天页悬浮小框照旧显示（本次修复不砍功能）', floatOnChat && floatOnChat.hidden === false, JSON.stringify(floatOnChat));
const floatBtnHits = await HIT(['#sm-f-play', '#sm-f-next']);
chk('B9 聊天页悬浮小框自身按钮点得动', (floatBtnHits || []).every((x) => x.ok), fmtBad(floatBtnHits));

chk('B10 全程零 JS 异常', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n' + (RED ? 'RED 基线（预期 B3/B6 遮挡项红＝用户现象复现、脚本有判别力）' : '结果') + '：' + pass + ' / ' + (pass + fail));
ws.close(); chrome.kill(); await SLEEP(300);
try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
