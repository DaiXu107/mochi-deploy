// ===== 回归：#1421 房间页补单根滚动轴 ＋ 首访提示条不再把内层窗口挤窄 =====
// 立项（作者 2026-09-29「总是有功能页面的翻动设计有问题，总有页面跟随屏幕一起固定，而没有真的滑动屏幕，
//   比如字卡库，其他可能也有这种问题」）。全站 70 页逐 y 真触摸扫描后剩两处「吃掉大半屏＝那一块划不动」：
//  ① 房间页：`#page-room{overflow:hidden}` 而 `.room-stage` 不滚＝全站唯一一根轴都没有的页
//     （实测 360×640／390×844 两档，从 y=12 到屏底每一格划下去都不动；内容一高过可视区就被静默裁掉）。
//     修法＝滚动只由 stage 承担（照漂流瓶那一族），并用 overscroll-behavior:auto 而非 contain（#612）。
//  ② 回复设置页：页自己不滚，滚动权在内层 `.gs-scroll`；而「使用提示」条 `.pc-bar`（page-coach.js）
//     挂在页首＝变成第二层常驻头部。实测 360×640 下窗口只剩 419px、顶部 372px（＝58% 屏）划下去毫无反应。
//     修法＝挂载点按现算的两个事实选：页有滚动区间→挂页首（整页滚的页照旧）；页零滚动区间且子树里
//     有真在裁剪内容的窗口→挂进那扇窗口内部，跟着内容一起滚。零机型／零 UA 分支。
//
// 用例（判据一律取几何与真触摸，不读代码猜）：
//   R1 房间页：给 stage 撑高后，页内确实出现一根可滚的轴（注入后 ovf>0）
//   R2 房间页：真触摸在屏幕中段划一下，那一根轴真的动了（scrollTop>0）——红侧＝划不动
//   R3 家具拖拽不被新轴抢走：`.r-furn` 的 touch-action 仍是 none（幂等，两侧同绿＝本批没动它）
//   C1 回复设置：提示条挂进了内层滚动窗口（父元素不是 .page），且窗口顶部仍在它之上
//   C2 回复设置：划窗口上方那条带（提示条所在）现在跟手＝红侧那条带是死区
//   C3 防修过头：整页滚的字卡库页（page-chatcard）提示条照旧挂页首＝没被错塞进子容器
//   Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1421-scroll-axis-room-coach.mjs
//       MOCHI_SERVE_ROOT=<隔离构建目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('SKIP 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.log('SKIP 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const chk = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  ' + detail : '')); } };

// —— S 组：源码级（只看这一批的两处落点还在不在，防被整块回流）——
const srcRoom = (() => { try { return readFileSync(join(root, 'src/css/room.css'), 'utf8'); } catch (e) { return ''; } })();
const srcCoach = (() => { try { return readFileSync(join(root, 'src/js/page-coach.js'), 'utf8'); } catch (e) { return ''; } })();
const stageBlock = (srcRoom.match(/\.room-stage\s*\{[^}]*\}/) || [''])[0];
chk('S1 src/css/room.css 的 .room-stage 有滚动轴（缺＝房间页回到无轴）', /overflow-y:\s*auto/.test(stageBlock), stageBlock.replace(/\s+/g, ' ').slice(0, 120));
chk('S2 该轴用 overscroll-behavior:auto 而非 contain（contain＝滚到底接不上外层，#612 那一型）', /overscroll-behavior:\s*auto/.test(stageBlock) && !/overscroll-behavior:\s*contain/.test(stageBlock));
chk('S3 page-coach.js 的挂载点走 mountBar（拿掉＝提示条又常驻页首挤窄窗口）', /function mountBar\s*\(/.test(srcCoach) && /mountBar\(page, buildBar\(cfg\)\)/.test(srcCoach));
chk('S4 mountBar 先问「页自己滚不滚」再决定挂哪儿（缺判据＝整页滚的页被错塞进子容器）', /page\.scrollHeight\s*-\s*page\.clientHeight\s*>\s*0/.test(srcCoach));

// —— 浏览器侧夹具 ——
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9620 + Math.floor(Math.random() * 60));
const profile = join(process.env.TEMP || '/tmp', 'mochi-1421-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); let jsErr = 0;
for (let i = 0; i < 120; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const pg = l.find((t) => t.type === 'page');
    if (pg) {
      ws = new WebSocket(pg.webSocketDebuggerUrl);
      await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id).res(m.result); pend.get(m.id).done(); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') jsErr++; };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.log('FAIL CDP 连接'); try { chrome.kill(); } catch (e) {} process.exit(1); }
const cdp = (mth, prm = {}) => { const id = ++msgId; return new Promise((res) => { const tm = setTimeout(() => { if (pend.has(id)) { pend.delete(id); res({ __t: mth }); } }, 15000); pend.set(id, { res, done: () => clearTimeout(tm) }); ws.send(JSON.stringify({ id, method: mth, params: prm })); }); };
const ev = async (x) => { const r = await cdp('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r && r.__t) return 'TIMEOUT'; return r && r.result ? r.result.value : null; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(5200);
for (let i = 0; i < 40; i++) {
  const s = await ev(`(function(){var ac=document.getElementById('splash-age-check');if(ac&&!ac.checked){ac.checked=true;ac.dispatchEvent(new Event('change',{bubbles:true}));}
    var sb=document.getElementById('splash-box');if(sb)sb.scrollTop=sb.scrollHeight;
    var mm=document.getElementById('splash-mandatory');
    if(mm&&!mm.hidden){var ms=document.getElementById('splash-mandatory-scroll');if(ms)ms.scrollTop=ms.scrollHeight;var me=document.getElementById('splash-mandatory-enter');if(me)me.click();return 'mand';}
    var sp=document.getElementById('splash');if(!sp||sp.classList.contains('hide')||sp.hidden)return 'in';
    var se=document.getElementById('splash-enter');if(se&&!se.hidden){se.click();return 'enter';}return 'wait';})()`);
  if (s === 'in') break;
  await sleep(300);
}
// 一次性弹层在时 body.scroll-lock 会合法锁住全站（＝假红源），先按掉再量
for (let i = 0; i < 12; i++) {
  const c = await ev(`(function(){var out=[];var ms=document.querySelectorAll('.modal-mask,.pc-sh-mask,[id$="-mask"]');
    for(var i=0;i<ms.length;i++){var x=ms[i];if(!x.hidden&&x.getClientRects().length&&x.getBoundingClientRect().height>window.innerHeight*0.3){out.push(x.id||x.className);x.hidden=true;try{x.style.display='none';}catch(e){}}}
    var b=document.getElementById('backup-remind-bar');if(b&&!b.hidden){b.hidden=true;out.push('bar');}return out.join(',');})()`);
  if (!c) break;
  await sleep(250);
}
const show = (id) => ev(`(function(){var ps=document.querySelectorAll('.page');for(var i=0;i<ps.length;i++)ps[i].hidden=true;
  var el=document.getElementById(${JSON.stringify(id)});if(el)el.hidden=false;return 1;})()`);
const swipe = async (x, y, dy) => {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 6; i++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 6, id: 1 }] }); await sleep(14); }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(160);
};

console.log('（夹具：360×640，' + root + '）');

// —— R 组：房间页 ——
await show('page-room');
await sleep(300);
await ev(`(function(){var st=document.querySelector('#page-room .room-stage');if(!st)return 0;
  var old=document.getElementById('r1421-spacer');if(old)old.remove();
  var d=document.createElement('div');d.id='r1421-spacer';d.style.cssText='height:900px;flex:0 0 900px;min-height:900px;background:#8cf';st.appendChild(d);return 1;})()`);
await sleep(220);
const room = JSON.parse(String(await ev(`(function(){var st=document.querySelector('#page-room .room-stage');
  if(!st)return JSON.stringify({err:'no-stage'});
  return JSON.stringify({ovf:st.scrollHeight-st.clientHeight,clientH:st.clientHeight,scrollTop:st.scrollTop,
    ovY:getComputedStyle(st).overflowY,furn:(function(){var f=document.querySelector('#page-room .r-furn');return f?getComputedStyle(f).touchAction:'no-furn';})()});})()`)));
console.log('  读数 R1 房间 stage=' + JSON.stringify(room));
chk('R1 房间页撑高后有一根真轴（overflow-y 是 auto/scroll 且可滚区间>0）', /auto|scroll/.test(room.ovY || '') && room.ovf > 200, JSON.stringify(room));
await swipe(180, 420, -260);
const room2 = JSON.parse(String(await ev(`(function(){var st=document.querySelector('#page-room .room-stage');return JSON.stringify({scrollTop:st.scrollTop});})()`)));
chk('R2 房间页真触摸划一下，那根轴真的动了（红侧＝划哪儿都不动）', room2.scrollTop > 40, 'scrollTop=' + room2.scrollTop);
chk('R3 家具的 touch-action 仍是 none（新轴不抢拖拽）', room.furn === 'none' || room.furn === 'no-furn', 'furn=' + room.furn);
await ev(`(function(){var d=document.getElementById('r1421-spacer');if(d)d.remove();var st=document.querySelector('#page-room .room-stage');if(st)st.scrollTop=0;return 1;})()`);

// —— C 组：提示条挂载点 ——
await ev(`(function(){try{localStorage.removeItem('xy-home-v2:__coach-seen');}catch(e){}
  [].slice.call(document.querySelectorAll('.pc-bar')).forEach(function(b){b.remove();});return 1;})()`);
await show('page-reply-settings');
await sleep(1000);
const bar = JSON.parse(String(await ev(`(function(){
  var b=document.querySelector('#page-reply-settings .pc-bar');if(!b)return JSON.stringify({err:'no-bar'});
  var page=document.getElementById('page-reply-settings');
  var pane=null;var all=page.querySelectorAll('*');
  for(var i=0;i<all.length;i++){var n=all[i];if(n.closest('.pc-bar'))continue;if(!/(auto|scroll)/.test(getComputedStyle(n).overflowY))continue;if(n.clientHeight<120)continue;pane=n;break;}
  return JSON.stringify({parentIsPage:b.parentElement===page,parentCls:String(b.parentElement.className),
    inPane:!!(pane&&pane.contains(b)),paneCls:pane?String(pane.className):'',
    pageOvf:page.scrollHeight-page.clientHeight,paneH:pane?pane.clientHeight:-1,paneTop:pane?Math.round(pane.getBoundingClientRect().top):-1,
    barH:Math.round(b.getBoundingClientRect().height)});})()`)));
console.log('  读数 C1 提示条=' + JSON.stringify(bar));
chk('C1 提示条挂进了内层滚动窗口（不是常驻页首当第二层头部）', bar.inPane === true && bar.parentIsPage === false, JSON.stringify(bar));
// 划提示条所在那一带（窗口上方＝旧版死区）现在该动
const before = await ev(`(function(){var p=document.querySelector('#page-reply-settings .gs-scroll')||document.querySelector('#page-reply-settings .pc-bar').parentElement;return p?p.scrollTop:-1;})()`);
const barTop = await ev(`(function(){var b=document.querySelector('#page-reply-settings .pc-bar');return b?Math.round(b.getBoundingClientRect().top+b.clientHeight/2):-1;})()`);
await swipe(180, Math.max(90, Math.min(560, Number(barTop) || 300)), -200);
const after = await ev(`(function(){var p=document.querySelector('#page-reply-settings .gs-scroll')||document.querySelector('#page-reply-settings .pc-bar').parentElement;return p?p.scrollTop:-1;})()`);
chk('C2 在提示条那一带起手划，窗口跟手（红侧＝顶部 372px 全是死区）', Number(after) > Number(before) + 30, 'before=' + before + ' after=' + after + ' 起手y=' + barTop);
await ev(`(function(){try{localStorage.removeItem('xy-home-v2:__coach-seen');}catch(e){}
  [].slice.call(document.querySelectorAll('.pc-bar')).forEach(function(b){b.remove();});return 1;})()`);
await show('page-chatcard');
await sleep(1000);
const bar2 = JSON.parse(String(await ev(`(function(){
  var b=document.querySelector('#page-chatcard .pc-bar');if(!b)return JSON.stringify({err:'no-bar'});
  var page=document.getElementById('page-chatcard');
  return JSON.stringify({parentIsPage:b.parentElement===page,pageOvf:page.scrollHeight-page.clientHeight});})()`)));
chk('C3 整页滚的字卡库页：提示条照旧挂页首（防修过头，两侧应同绿）', bar2.parentIsPage === true || bar2.err === 'no-bar', JSON.stringify(bar2));
await show('page-phone');
chk('Z1 全程零未捕获 JS 异常', jsErr === 0, 'cdp=' + jsErr);

try { ws.close(); } catch (e) {} try { chrome.kill(); } catch (e) {} try { server.close(); } catch (e) {}
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败（夹具根=' + root + '）');
process.exit(fail ? 1 : 0);
