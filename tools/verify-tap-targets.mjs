// ===== 回归验证 #725：iPad/平板「没适配、很多按钮点不到」（用户直派）=====
// 用法：node build.mjs && node tools/verify-tap-targets.mjs（测真实产物 index.html；
//       隔离副本可加 --root=<目录>，脚本按 <root>/index.html 起服务）
// 背景：#714 宽屏锚定 4 个 CSS 文件的 10 条选择器漏排除 html.tablet——平板 .phone=100vw
//       全宽铺满（#186 用户决策、无 390 外壳），≥901px 视口（iPad 横屏 1024-1366 /
//       iPad Pro 竖屏 1024）全被锚到「幽灵外壳」＝提醒条/安装钮/管理条/位置面板/音乐批量
//       条/悬浮小框/群设置整页/@面板全挤到屏幕中央一条 390 窄带（1180×820 实测 vub 落
//       395..785、群设置整页仅 390 宽）。修复=:not 链补 :not(.tablet)。
// 检查项：A 形态判定（iPad 含 Macintosh 伪装同款 /iPad/ 分支 → html.tablet 手机路径不误挂）；
//         B ≥901 平板浮层=视口贴边/全宽（RED 判别面：修复前=幽灵外壳 390 值）；
//         C 全页面 elementFromPoint 命中测试（每形态 44 页全部可点元素，命中物非自身/子孙
//           =被别的层盖住即 FAIL；白名单仅两类设计内行为：tabbar 半透明叠加可滚出 /
//           每日问候浮层自动消散）。原第三类「纪念日原生 date input 覆盖假按钮」随 #978
//           撤除——恋爱纪念日改站内月历弹层（#mem-date-mask），那个覆盖层已不存在。
//         D 开屏问答门在自动化环境必须保持关（它弹开=全屏遮罩盖死一切，仪器失真即报）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argRoot = (process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1];
const root = argRoot ? normalize(argRoot) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const profileDir = join(process.env.TEMP || '/tmp', 'mochi-vtap-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || 9500 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profileDir,
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
const px = (s) => parseFloat(String(s).replace('px', '')) || 0;

// iPad 无头可达入口：/iPad/ 关键字分支（Macintosh 伪装分支需要 ontouchstart，新版无头
// UA 不含 Headless 且 webdriver=false，IS_AUTOMATION 判不出 → 必须显式存 qa-en=0 关问答门）
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const CONFIGS = [
  { id: 'ipad-land', name: 'iPad 横屏 1180×820', w: 1180, h: 820, dsf: 2, ua: IPAD_UA },
  { id: 'ipad-pro-l', name: 'iPad Pro 横屏 1366×1024', w: 1366, h: 1024, dsf: 2, ua: IPAD_UA },
  { id: 'ipad-mini-p', name: 'iPad mini 竖屏 768×1024', w: 768, h: 1024, dsf: 2, ua: IPAD_UA },
  { id: 'iphone', name: 'iPhone 390×844（手机基线）', w: 390, h: 844, dsf: 3, ua: IPHONE_UA }
];

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){
  try {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('xy-home-v2:applock-qa-en', '0');
    localStorage.setItem('xy-home-v2:applock-en', '0');
  } catch(e){}
  window.__clickEls = [];
  var seen = new Set();
  function reg(el){ try { if (!el || el.nodeType !== 1 || seen.has(el)) return; seen.add(el); if (window.__clickEls.length < 4000) window.__clickEls.push(el); } catch(e){} }
  var oAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(t, f, o){ if (t === 'click') reg(this); return oAEL.call(this, t, f, o); };
  var od = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onclick');
  Object.defineProperty(HTMLElement.prototype, 'onclick', { get: od.get, set: function(v){ reg(this); return od.set.call(this, v); }, configurable: true });
})();
` });

async function loadApp(cfg) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: cfg.w, height: cfg.h, deviceScaleFactor: cfg.dsf, mobile: false });
  await cdp('Emulation.setUserAgentOverride', { userAgent: cfg.ua });
  await cdp('Emulation.setTouchEmulationEnabled', { maxTouchPoints: 5 });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(1900);
  for (let i = 0; i < 30; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(250); }
  await evalJs("(function(){try{localStorage.setItem('xy-home-v2:__last-backup-ok',String(Date.now()));localStorage.setItem('xy-home-v2:__last-backup-remind',String(Date.now()));}catch(e){}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return 1;})()");
  await sleep(600);
  for (let i = 0; i < 10; i++) {
    const st = await evalJs("(function(){var m=document.getElementById('modal-mask');if(!m||m.hidden||getComputedStyle(m).display==='none')return 'closed';var bs=m.querySelectorAll('.modal-btns button');if(bs.length){bs[bs.length-1].click();return 'clicked';}m.hidden=true;return 'forced';})()");
    if (st === 'closed') break;
    await sleep(300);
  }
  await evalJs("(function(){try{document.body.classList.remove('scroll-lock');}catch(e){}var dg=document.getElementById('daily-greet');if(dg){dg.hidden=true;dg.style.display='none';}return 1;})()");
  await sleep(300);
}

// ---- A/B 组：形态判定 + 平板浮层贴边（#725 修复面，stub 元素吃同一条媒体查询） ----
for (const cfg of CONFIGS.filter((c) => c.id !== 'iphone')) {
  await loadApp(cfg);
  const head = JSON.parse(await evalJs("(function(){var d=window.mochiDevice||{};return JSON.stringify({rule:d.mobileRule,t:d.isTablet,ios:d.isIOS,cls:document.documentElement.className});})()") || '{}');
  check('A1 ' + cfg.name + ' 判定=平板', head.rule === 'tablet' && head.t === true && /tablet/.test(head.cls || ''), JSON.stringify(head));
  check('A2 ' + cfg.name + ' iOS 信号在位（安全区/全屏适配照走）', head.ios === true, 'ios=' + head.ios);
  const fl = JSON.parse(await evalJs(`(function(){
    var pg=document.getElementById('page-group-chat'); if(pg) pg.hidden=false;
    function probe(sel,cls){var el=document.querySelector(sel);if(!el){el=document.createElement('div');document.body.appendChild(el);}el.className=cls;el.hidden=false;el.style.display='flex';el.style.animation='none';var b=el.getBoundingClientRect();return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:Math.round(b.width)};}
    var o={}; o.vub=probe('#ver-update-bar','ver-update-bar'); o.pwa=probe('#pwa-install','pwa-install'); o.loc=probe('#loc-panel','loc-panel'); o.mus=probe('#music-batch-bar','music-batch-bar'); o.gcs=probe('#gc-settings-panel','gc-settings-panel'); o.smf=probe('#sm-float','sm-float');
    return JSON.stringify(o);})()`) || '{}');
  const W = cfg.w;
  check('B1 ' + cfg.name + ' 提醒条全宽贴边（非 390 幽灵居中）', fl.vub.l === 0 && fl.vub.r === W && fl.vub.w === W, 'vub=' + JSON.stringify(fl.vub));
  check('B2 ' + cfg.name + ' 安装钮贴壳右下（right=16/bottom=16）', fl.pwa.r === W - 16 && fl.pwa.b === cfg.h - 16, 'pwa=' + JSON.stringify(fl.pwa));
  check('B3 ' + cfg.name + ' 位置/音乐批量条全宽贴底', fl.loc.l === 0 && fl.loc.r === W && fl.mus.b === cfg.h, 'loc=' + JSON.stringify(fl.loc) + ' mus=' + JSON.stringify(fl.mus));
  check('B4 ' + cfg.name + ' 群设置整页全屏（非 390 窄带）', fl.gcs.l === 0 && fl.gcs.r === W && fl.gcs.w === W, 'gcs=' + JSON.stringify(fl.gcs));
  check('B5 ' + cfg.name + ' 音乐悬浮小框贴壳左上（l=12/t=80）', fl.smf.l === 12 && fl.smf.t === 80, 'smf=' + JSON.stringify(fl.smf));
}

// ---- C/D 组：全页面命中测试（浮层 stub 清场后逐页 unhide） ----
const PAGE_HIT_FN = `(function(){
  var out = {fails:[]};
  var vw = innerWidth, vh = innerHeight;
  function pathOf(el){var s='',n=el;for(var i=0;n&&n.nodeType===1&&i<4;i++,n=n.parentElement){var seg=String(n.tagName||'').toLowerCase();if(n.id)seg+='#'+n.id;else if(typeof n.className==='string'&&n.className)seg+='.'+n.className.trim().split(/\\s+/).slice(0,2).join('.');s=s?seg+'>'+s:seg;}return s.slice(0,110);}
  function visible(el){var r=el.getBoundingClientRect();if(r.width<1||r.height<1)return null;var cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0')return null;return r;}
  try{
    document.querySelectorAll('.page,.phone,body,html').forEach(function(n){n.scrollTop=0;});
    document.querySelectorAll('.page *').forEach(function(n){if(n.scrollHeight>n.clientHeight+4){try{n.scrollTop=0;}catch(e){}}});
    window.scrollTo(0,0);
  }catch(e){}
  // 清掉 A/B 组的 stub（class 相同会参与命中）
  try{document.querySelectorAll('body>.ver-update-bar,body>.pwa-install,body>.loc-panel,body>.music-batch-bar,body>.gc-settings-panel,body>.sm-float').forEach(function(n){if(!n.id||['ver-update-bar','pwa-install','loc-panel','music-batch-bar','gc-settings-panel','sm-float'].indexOf(n.id)>=0&&n.getAttribute('style')==='display: flex')n.parentNode.removeChild(n);});}catch(e){}
  var page = document.getElementById("__PID__");
  if (!page) return JSON.stringify(out);
  var cand = new Set();
  var rec = window.__clickEls || [];
  for (var i=0;i<rec.length;i++){var el=rec[i];try{if(!el||!el.isConnected)continue;if(!page.contains(el))continue;cand.add(el);}catch(e){}}
  try{page.querySelectorAll('button,a[href],[role="button"],.app,.tab,.set-row,[data-page],input[type="button"],input[type="submit"]').forEach(function(n){cand.add(n);});}catch(e){}
  cand.forEach(function(el){
    try{
      if(el===document||el===document.body||el===document.documentElement)return;
      var r=visible(el);if(!r)return;
      var cs=getComputedStyle(el);
      if(el.clientWidth>=vw*0.9&&el.clientHeight>=vh*0.8)return; // 委托根
      var cx=r.left+r.width/2, cy=r.top+r.height/2;
      if(cx<0||cy<0||cx>vw||cy>vh)return; // 视口外=滚动可见，非缺陷
      var hit=document.elementFromPoint(cx,cy);
      var ok=hit&&(hit===el||el.contains(hit)||hit.contains(el));
      if(!ok)out.fails.push({el:pathOf(el),hit:hit?pathOf(hit):'(null)'});
    }catch(e){}
  });
  return JSON.stringify(out);
})`;

// 设计内白名单：命中物是这两类＝非缺陷（半透明 tabbar 叠加可滚动露出 / 每日问候自动消散）
const HIT_ALLOW = [/tabbar/, /#daily-greet/];

for (const cfg of CONFIGS) {
  await loadApp(cfg);
  const pages = JSON.parse(await evalJs("(function(){return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.page'),function(p){return p.id;}));})()") || '[]');
  const unexpected = [];
  for (const pid of pages) {
    if (await evalJs("(function(){var ps=document.querySelectorAll('.page');for(var i=0;i<ps.length;i++)ps[i].hidden=true;var p=document.getElementById('" + pid + "');if(!p)return 'no';p.hidden=false;return 'ok';})()") !== 'ok') continue;
    await sleep(260);
    const r = JSON.parse(await evalJs('(' + PAGE_HIT_FN.replace('__PID__', pid) + ')()') || '{"fails":[]}');
    for (const f of (r.fails || [])) {
      if (!HIT_ALLOW.some((re) => re.test(f.hit))) unexpected.push(pid + ' | ' + f.el + ' ← ' + f.hit);
    }
  }
  check('C1 ' + cfg.name + ' 全页面命中测试无意外遮盖（' + pages.length + ' 页）', unexpected.length === 0, unexpected.slice(0, 4).join(' ; ') || 'clean');
  const lock = await evalJs("(function(){var m=document.getElementById('applock-mask');return JSON.stringify({open:!!(m&&!m.hidden),n:(window.__applockStacks||[]).length});})()");
  check('D1 ' + cfg.name + ' 开屏问答门/应用锁未弹（自动化保持关）', lock && JSON.parse(lock).open === false, lock || '');
}

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
