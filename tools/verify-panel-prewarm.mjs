// ===== 回归脚本：#907 表情包面板/头像互动「每次打开图片闪一下重新加载」残留根因收口＋可选提前加载 =====
// 背景（用户报障 #907，红米 K80 Chrome 实报、用户明说其他设备型号也有；同族已修七轮
// #457/#508/#509/#662/#692/#704/#716 仍复发）：残留根因有两条——
// ① 面板平时 display:none 挂着，浏览器对 display:none 子树的已解码位图主动回收，
//   重开时整格 img 从零重新解码（节点一个没换照样闪，#662 已实证「节点身份测不出」）；
// ② 首开前位图从未就绪，openEmojiPanel/openAvlib 只能「等解码再显示」，大图慢机型兜底放行后
//   逐张冒出＝用户看到的「闪＋重新加载」。
// 修法：①chat-main.css 把 #emoji-panel[hidden]/#avlib-card[hidden] 改 keep-alive
//   （display:flex + visibility:hidden + pointer-events:none＝行为等价 display:none，
//   但不再触发 display:none 的位图整批回收；仅限这两枚报障面，.poke-card 其余家族不动）；
// ②chat.js 空闲预热调度（load+4s / 进聊天页+2.5s / contact-switched+3s / mochi-restore-done+6s，
//   requestIdleCallback 让位）把当前分组渲染进面板＋首屏 24 张补 src/预解码（#457 指纹随之登记，
//   打开时短路命中零重建），avatar-lib.js 暴露 window.mochiPrewarmAvlib 同口径预热四个池；
// ③chat-settings.js 注入「打开面板前提前加载图片」开关行（全局根键 chat-panel-prewarm，
//   contacts.js EXCLUDE 已登记，默认开）。
// 判别力（SERVE_ROOT 指向纯 HEAD 红副本实测）：红的正是缺陷面（S1~S5 产物锚 + B2/B4/B5 行为），
//   B1/B3 两侧同绿＝防修过头闸（预热不碰开着的面板、开关关掉后零预热）。
// 用法：node build.mjs && node tools/verify-panel-prewarm.mjs
//      SERVE_ROOT=<隔离构建目录> 可验未收口产物（绿/红对照都用它）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end(); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9870 + Math.floor(Math.random() * 100);
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-panel-prewarm-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profileDir, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') jsErrors++; };
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

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// —— S 组：产物锚点（core 全外置后 chat.js/avatar-lib.js/chat-settings.js/contacts.js 落 js/<file>，
//    旧产物曾内联进 index.html——两侧并集查找，语义不变，只兼容落点迁移；css 合并仍在产物内）——
const artifact = readFileSync(join(root, 'index.html'), 'utf8');
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const inProd = (p, needle) => (rd(p) + artifact).includes(needle);
chk('S1 面板 hidden 态 keep-alive 规则在产物 CSS（display:none 回流＝位图整批回收复发）',
  artifact.includes('#emoji-panel[hidden], #avlib-card[hidden]'), '');
chk('S2 表情面板空闲预热调度在产物（删＝进桌面后不再提前加载）',
  inProd('js/chat.js', 'if (!chatPanelPrewarmOn()) return;'), '');
chk('S3 头像互动空闲预热入口在产物（删＝头像库首开前位图从未就绪）',
  inProd('js/avatar-lib.js', 'window.mochiPrewarmAvlib = function ()'), '');
chk('S4 「提前加载」设置行在产物（删＝用户失去开关）',
  inProd('js/chat-settings.js', 'cs-chat-panel-prewarm-row'), '');
chk('S5 chat-panel-prewarm 根键 EXCLUDE 在产物（删＝开关被迁进 default 后丢）',
  inProd('js/contacts.js', "'chat-panel-prewarm',"), '');

// —— 关开屏 + 压制干扰层（同 verify-sheet-outside-close 口径）——
for (let i = 0; i < 30; i++) {
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
  if (s === 'closed') break;
  await sleep(300);
}
await evalJs(`(function(){
  var mm=document.getElementById('splash-mandatory'); if(mm&&!mm.hidden){mm.hidden=true;}
  var sp=document.getElementById('splash'); if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}
  var qm=document.getElementById('qa-mask'); if(qm)qm.hidden=true;
  var bk=document.getElementById('backup-remind-bar'); if(bk)bk.hidden=true;
  var md=document.getElementById('modal-mask'); if(md){md.hidden=true;}
  document.querySelectorAll('.modal-mask').forEach(function(m){m.hidden=true;});
  return true;})()`);
await sleep(600);

// —— B 组：行为 ——
// B1 keep-alive 行为形态：hidden 面板 computed display 不是 none、visibility 是 hidden（等价不可见）
const ka = await evalJs(`(function(){
  var ep=document.getElementById('emoji-panel'); var av=document.getElementById('avlib-card');
  if(!ep||!av) return null;
  ep.hidden=true; av.hidden=true;
  var e1=getComputedStyle(ep), e2=getComputedStyle(av);
  return {epD:e1.display,epV:e1.visibility,avD:e2.display,avV:e2.visibility,
    epPE:e1.pointerEvents,
    hit:(function(){var r=ep.getBoundingClientRect();var el=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+8));return el?(el.closest('#emoji-panel')?'panel':'other'):'none';})()};
})()`);
chk('B1a hidden 表情面板 keep-alive 形态（display:flex + visibility:hidden）',
  !!ka && ka.epD === 'flex' && ka.epV === 'hidden', JSON.stringify(ka));
chk('B1b hidden 头像半框 keep-alive 形态',
  !!ka && ka.avD === 'flex' && ka.avV === 'hidden', JSON.stringify(ka));
chk('B1c hidden 面板不可误触（点面板几何中心命不中面板内元素）',
  !!ka && ka.hit !== 'panel', JSON.stringify(ka && ka.hit));

// B2 预热落地：种专属表情包分组须同时写 memoryCache（xyStore）与 IDB 权威键（enterChat 的
// hydrateLibScopes 会用 IDB 权威值回填覆盖单侧写入）；随后走真实流：开面板选分组→关面板→
// 排预热班次；面板保持 hidden 后列表应已渲染出已赋 src 的图（纯 HEAD＝面板从未渲染，必然红）
const seedCg = await evalJs(`(function(){
  try {
    var url='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#7aa"/></svg>');
    var g={text:[],kaomoji:[],emoji:[],sticker:[['预热测试组',[url,url,url,url,url,url]]],image:[],poke:[],voice:[]};
    var j=JSON.stringify(g);
    window.xyStore('xy-home-v2:default').set('cc-groups', j);
    if (window.idbSet) window.idbSet('xy-home-v2:default:cc-groups', j);
    if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite(); // 失效池视图缓存（官方外部写回口径）
    var pf=JSON.stringify({mode:'ta', ta:'预热测试组', cat:'sticker'});
    window.xyStore('xy-home-v2:default').set('emoji-last', pf);
    if (window.idbSet) window.idbSet('xy-home-v2:default:emoji-last', pf);
    return 6;
  } catch(e) { return 'err:'+e.message; }
})()`);
await sleep(700); // 等 idbSet 落库
// contact-switched＝真实切桌面语义：chat.js 监听会先 loadEmojiPref 读回偏好、再排预热班次
await evalJs(`(function(){ document.dispatchEvent(new Event('contact-switched')); return true; })()`);
await sleep(300);
await evalJs('window.enterChat(); true');
await sleep(5500); // 班次 2.5~3s + idle(≤4s) 让位 + 渲染余量
// B2 断言：全程没碰过面板，预热班次自己把当前分组渲染进 hidden 面板并补 src
//（纯 HEAD＝没有调度器、面板从未渲染＝必红；也不受「开面板 #704 补 src」蹭检）
const pre = await evalJs(`(function(){
  var ep=document.getElementById('emoji-panel'); if(!ep) return null;
  var imgs=ep.querySelectorAll('img');
  var withSrc=0; for(var i=0;i<imgs.length;i++){ if(imgs[i].getAttribute('src')) withSrc++; }
  return {hidden:ep.hidden, imgs:imgs.length, withSrc:withSrc};
})()`);
chk('B2 未开面板时预热已把当前分组渲染进面板并补 src（提前加载本体）',
  seedCg === 6 && !!pre && pre.hidden === true && pre.imgs > 0 && pre.withSrc > 0, JSON.stringify({ seedCg, pre }));

// B3 预热不碰开着的面板：打开面板后立即再排班，面板保持可见且图不被清空重建（防修过头）
const b3 = await evalJs(`(function(){
  var ep=document.getElementById('emoji-panel'); if(!ep) return null;
  var before=ep.querySelectorAll('img').length;
  ep.hidden=false;
  if (typeof window.schedulePanelPrewarm==='function') window.schedulePanelPrewarm(50);
  return {imgs:before};
})()`);
await sleep(1400);
const b3b = await evalJs(`(function(){
  var ep=document.getElementById('emoji-panel');
  return {hidden:ep.hidden, imgs:ep.querySelectorAll('img').length};
})()`);
chk('B3 预热不碰开着的面板（开着＝面板保持可见、图不被清）',
  !!b3 && !!b3b && b3b.hidden === false && b3b.imgs >= b3.imgs, JSON.stringify({ b3, b3b }));
await evalJs(`(function(){var ep=document.getElementById('emoji-panel'); if(ep) ep.hidden=true; return true;})()`);

// B4 头像互动预热：半框未开时四个池已渲染出已赋 src 的图（头像池需先种数据）
const seed = await evalJs(`(function(){
  try {
    var g=window.xyStore('xy-home-v2:default');
    var lib=[JSON.stringify({a:1})];
    var url='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#7aa"/></svg>');
    var urls=[url,url,url];
    g.set('avatar-lib', JSON.stringify(urls));
    localStorage.setItem('xy-home-v2:default:avatar-lib', JSON.stringify(urls));
    return urls.length;
  } catch(e) { return 'err:'+e.message; }
})()`);
await sleep(300);
const b4 = await evalJs('window.mochiPrewarmAvlib ? (window.mochiPrewarmAvlib(), "ran") : "missing"');
await sleep(600);
const b4b = await evalJs(`(function(){
  var av=document.getElementById('avlib-card'); if(!av) return null;
  var g=document.getElementById('avlib-grid');
  var imgs=g?g.querySelectorAll('img'):[];
  var withSrc=0; for(var i=0;i<imgs.length;i++){ if(imgs[i].getAttribute('src')) withSrc++; }
  return {hidden:av.hidden, cells:g?g.querySelectorAll('.avlib-cell').length:-1, withSrc:withSrc};
})()`);
chk('B4 头像池预热：半框未开时网格已渲染且图已赋 src',
  seed === 3 && b4 === 'ran' && !!b4b && b4b.hidden === true && b4b.cells === 3 && b4b.withSrc === 3, JSON.stringify({ seed, b4, b4b }));

// B5 开关关掉＝零预热：chat-panel-prewarm=0 时清空面板后调度班次不再渲染
await evalJs(`(function(){
  try{ window.xyStore('xy-home-v2').set('chat-panel-prewarm','0'); }catch(e){}
  try{ localStorage.setItem('xy-home-v2:chat-panel-prewarm','0'); }catch(e){}
  var ep=document.getElementById('emoji-panel');
  var list=ep.querySelector('.emoji-list')||ep;
  list.innerHTML='';
  if (typeof window.schedulePanelPrewarm==='function') window.schedulePanelPrewarm(50);
  return true;})()`);
await sleep(1400);
const b5 = await evalJs(`(function(){
  var ep=document.getElementById('emoji-panel');
  var list=ep.querySelector('.emoji-list')||ep;
  return {imgs:list.querySelectorAll('img').length};
})()`);
chk('B5 开关关掉＝零预热（关后调度不再把图渲染回面板）',
  !!b5 && b5.imgs === 0, JSON.stringify(b5));

chk('Z 全程零页面 JS 异常', jsErrors === 0, 'jsErrors=' + jsErrors);

console.log('\\n== ' + pass + ' pass / ' + fail + ' fail ==');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
