// verify-tablet-desktop：#861 平板桌面「重排＋放大」行为断言（也兼手机端零回归对照）
// 背景：base.css 的 html.tablet 只把 .phone 改成 100vw 铺满，桌面轴仍是手机像素——
// 图标盒 58→64 而盒内字形恒 28px、组件高度/字号一条未改，1fr 网格把单格拉宽到
// 183~322px（图标盒只占 20~35%，手机端 74%），用户读成「小组件和图标特别小、平板很空」。
// 修法＝src/css/home.css + src/css/tabbar.css 的 html.tablet 区块：图标 6/8 列、
// 盒/字形 88/40（≥1250 宽 104/46）、组件两栏网格（音乐卡整宽、week 与 weekend 配对、
// 双卡行竖排、打卡横条与图标组整宽）、尺寸档按屏高分两档（min-height:950 升档）。
// 用法：node tools/verify-tablet-desktop.mjs [被测根目录]（默认仓库根）
// 断言：
//   S 组·源码锚——两栏网格/字形放大/双卡行竖排（含压 .third 的前缀）/音乐卡整宽/
//               高屏档/tabbar 兜底六针在位；weekend-box 不在整宽清单（配对语义）
//   B1 组·手机零回归（390×844）——无 .tablet、4 列、图标 58/28、组件 190/92/66、
//               三页内容高 604（改前实测值）、page-slide 仍 block/flex、tab 图标 23px
//   B2 组·竖屏 810×1080——.tablet 在、图标 88/40、6 列、两栏网格、第一页双卡行竖排、
//               三页全部不溢出、图标名 14px
//   B3 组·横屏 1080×810——8 列、第一页 8 个图标同一行、三页不溢出
//   B4 组·窄竖屏 768×1024——三页不溢出（改前此档填充率 104%＝内容被桌面区裁掉）
//   B5 组·mini 竖屏 744×1133——三页不溢出
//   B6 组·底部导航——平板 30px / 手机 23px（用户个性化写内联变量时不被本兜底覆盖）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? resolve(process.argv[2]) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' —— ' + detail : '')); }
};
const read = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
const home = read('src/css/home.css');
const tabbar = read('src/css/tabbar.css');

console.log('[S] 源码锚');
ok('S1 平板桌面两栏网格在位', home.includes('html.tablet .page-slide, html.tablet .page-slide.desk-page {')
  && home.includes('display:grid; grid-template-columns:1fr 1fr;'));
ok('S2 图标字形放大在位（恒 28px 被 --tb-glyph 取代）', home.includes('html.tablet .app .app-ico svg { width:var(--tb-glyph); height:var(--tb-glyph); }'));
ok('S3 双卡行竖排带 .page-slide 前缀（压第三页 .third 横排）', home.includes('html.tablet .page-slide .mini-row { flex-direction:column; gap:16px; }'));
ok('S4 音乐卡整宽、weekend-box 保持半宽（与本周日常配对）',
  home.includes('html.tablet .page-slide > .music-widget,') && !home.includes('html.tablet .page-slide > .weekend-box,'));
ok('S5 高屏尺寸档在位', home.includes('@media (min-height:950px) {'));
ok('S6 tabbar 平板兜底在位', tabbar.includes('html.tablet { --tabbar-ico-size:30px; }'));

// ---- 无头浏览器 ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.log('[B] 跳过：找不到 Chrome/Edge（设 CHROME_PATH）'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('[B] 跳过：需要 Node 21+（WebSocket）'); process.exit(0); }

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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9100 + Math.floor(Math.random() * 500));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-tabdesk-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (e) => { try { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true }); return r && r.result ? r.result.value : null; } catch (x) { return null; } };

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const M = `(function(){
  var q=function(s){return document.querySelector(s)};
  var out={cls:document.documentElement.className,vw:innerWidth,vh:innerHeight};
  var pages=q('#desktop-pages');
  if(pages){var pr2=pages.getBoundingClientRect(); out.areaBottom=+pr2.bottom.toFixed(1);}
  var tb=q('.tabbar .tab svg'); if(tb){out.tabIco=+tb.getBoundingClientRect().width.toFixed(1);}
  var g=q('.app-grid');
  if(g){var gc=getComputedStyle(g);
    out.cols=gc.gridTemplateColumns.split(' ').length;
    var ico=g.querySelector('.app-ico'), ir=ico.getBoundingClientRect();
    out.ico=[+ir.width.toFixed(1),+ir.height.toFixed(1)];
    var sv=ico.querySelector('svg'); out.glyph=sv?+sv.getBoundingClientRect().width.toFixed(1):0;
    var nm=g.querySelector('.app-name'); out.nameFont=nm?getComputedStyle(nm).fontSize:'';
    var ap=g.querySelector('.app');
    out.cellW=ap?+ap.getBoundingClientRect().width.toFixed(1):0;}
  out.slides=[];
  if(pages){pages.querySelectorAll('.page-slide').forEach(function(sl,i){
    var scs=getComputedStyle(sl);
    var mr=sl.querySelector('.mini-row');
    var kids=[];Array.prototype.forEach.call(sl.children,function(el){
      var c=getComputedStyle(el); if(c.display==='none')return;
      var r=el.getBoundingClientRect(); kids.push([+r.top.toFixed(1),+r.bottom.toFixed(1)]);});
    var top=kids.length?Math.min.apply(null,kids.map(function(k){return k[0]})):0;
    var bot=kids.length?Math.max.apply(null,kids.map(function(k){return k[1]})):0;
    var icoTops=[].map.call(sl.querySelectorAll('.app'),function(a){return Math.round(a.getBoundingClientRect().top);});
    out.slides.push({display:scs.display,gCols:scs.gridTemplateColumns.split(' ').length,
      mrDir:mr?getComputedStyle(mr).flexDirection:'',
      contentH:+(bot-top).toFixed(1),contentBottom:+bot.toFixed(1),
      icoRowCount:[].filter.call(icoTops,function(v,i,a){return a.indexOf(v)===i;}).length,
      scrollable:sl.scrollHeight>sl.clientHeight+1});
  });}
  var mc=q('.mini-card'); if(mc){out.miniH=+mc.getBoundingClientRect().height.toFixed(1);}
  var dw=q('.deco-widget'); if(dw){out.decoH=+dw.getBoundingClientRect().height.toFixed(1);}
  var ck=q('.checkin'); if(ck){out.ckH=+ck.getBoundingClientRect().height.toFixed(1);}
  return JSON.stringify(out);
})()`;

async function run(w, h, ua, label) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setUserAgentOverride', { userAgent: ua });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(600);
  await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-phone');});return true;})()");
  await sleep(500);
  const d = JSON.parse(await evalJs(M) || '{}');
  console.log('\n[' + label + ' ' + w + '×' + h + '] html=' + d.cls);
  return d;
}
const noOverflow = (d) => (d.slides || []).length === 3 && d.slides.every(s => s.contentBottom <= (d.areaBottom || 1e9) + 0.5 && !s.scrollable);

await cdp('Page.enable'); await cdp('Runtime.enable');

console.log('\n[B1] 手机端零回归（390×844）');
const ph = await run(390, 844, IPHONE_UA, '手机');
ok('B1.1 无 .tablet 类（本批规则零命中）', !/tablet/.test(ph.cls || ''));
ok('B1.2 图标网格仍 4 列、图标盒 58、字形 28', ph.cols === 4 && ph.ico && ph.ico[0] === 58 && ph.glyph === 28,
  'cols=' + ph.cols + ' ico=' + JSON.stringify(ph.ico) + ' glyph=' + ph.glyph);
ok('B1.3 组件高度仍手机档（deco 190 / mini 92 / checkin 66）', ph.decoH === 190 && ph.miniH === 92 && ph.ckH === 66,
  'deco=' + ph.decoH + ' mini=' + ph.miniH + ' ck=' + ph.ckH);
ok('B1.4 page-slide 仍 block/flex（未进两栏网格）', (ph.slides || []).length === 3 && ph.slides[0].display === 'block' && ph.slides[2].display === 'flex',
  JSON.stringify((ph.slides || []).map(s => s.display)));
ok('B1.5 三页内容高 604（改前实测值，±3）', (ph.slides || []).every(s => Math.abs(s.contentH - 604) <= 3),
  JSON.stringify((ph.slides || []).map(s => s.contentH)));
ok('B1.6 三页不溢出', noOverflow(ph));
ok('B1.7 底部导航仍 23px', ph.tabIco === 23, 'tabIco=' + ph.tabIco);

console.log('\n[B2] 竖屏平板（810×1080）');
const pt = await run(810, 1080, IPAD_UA, 'iPad竖');
ok('B2.1 .tablet 在、图标盒 88、字形 40', /tablet/.test(pt.cls || '') && pt.ico && pt.ico[0] === 88 && pt.glyph === 40,
  'ico=' + JSON.stringify(pt.ico) + ' glyph=' + pt.glyph);
ok('B2.2 图标网格 6 列', pt.cols === 6, 'cols=' + pt.cols);
ok('B2.3 page-slide 进两栏网格', (pt.slides || []).every(s => s.display === 'grid' && s.gCols === 2),
  JSON.stringify((pt.slides || []).map(s => s.display + '/' + s.gCols)));
ok('B2.4 第一页双卡行竖排（column）', pt.slides && pt.slides[0].mrDir === 'column', 'mrDir=' + (pt.slides && pt.slides[0].mrDir));
ok('B2.5 三页全部不溢出', noOverflow(pt));
ok('B2.6 图标名 14px', pt.nameFont === '14px', 'nameFont=' + pt.nameFont);

console.log('\n[B3] 横屏平板（1080×810）');
const ls = await run(1080, 810, IPAD_UA, 'iPad横');
ok('B3.1 图标网格 8 列', ls.cols === 8, 'cols=' + ls.cols);
ok('B3.2 第一页 8 个图标同一行', ls.slides && ls.slides[0].icoRowCount === 1, 'rows=' + (ls.slides && ls.slides[0].icoRowCount));
ok('B3.3 三页全部不溢出', noOverflow(ls));

console.log('\n[B4] 窄竖屏平板（768×1024，改前填充率 104%）');
const n768 = await run(768, 1024, IPAD_UA, 'iPad97竖');
ok('B4.1 三页全部不溢出', noOverflow(n768));

console.log('\n[B5] mini 竖屏（744×1133）');
const mini = await run(744, 1133, IPAD_UA, 'mini竖');
ok('B5.1 三页全部不溢出', noOverflow(mini));

console.log('\n[B6] 底部导航（平板 30px）');
ok('B6.1 平板 tab 图标 30px', pt.tabIco === 30, 'tabIco=' + pt.tabIco);

finish();

function finish() {
  console.log('');
  console.log(fail === 0 ? `✅ verify-tablet-desktop ${pass}/${pass + fail} PASS` : `❌ ${fail} FAIL / ${pass + fail}`);
  try { ws && ws.close(); } catch (e) {}
  try { chrome && chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exitCode = fail === 0 ? 0 : 1;
}
