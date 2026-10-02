// ===== 常驻回归：#1285 桌面壁纸「缩放」露底 ＋ #1292 抽屉里的图标区轴 ＋ #1293 适配轴根键被迁移吃掉 =====
// 【#1285】用户实报「ios桌面壁纸无法铺满」，追问确认症状＝**图片本身四周留边**（不是 .phone 与屏幕之间那条带）。
// 根因与机型/内核/UA 全无关，是我方语义错：旧实现把档位数字原样写进 background-size（'150%'），CSS 规范里
// 那是「宽=150%、高按原图比例自动」——横构图壁纸（4:3 插画/截图）在竖屏盒里一过 100% 就上下各留一条底色，
// 竖构图则左右留。任何内核照规范算都会留白，所以「换个型号还有」＝同一把尺子，修法也不许碰机型。
// 修法：background-size 恒为 cover，放大由**图层盒等比外扩**承担（盒=k×.phone，top/left 按 (1−k)/2 回中心，
// 多出去的由 .phone 的 overflow:clip 裁掉）＝裁切式放大；零量原图、零量盒高（#762 已清算过那条路线，勿重走）。
// 【#1292】用户「全屏后桌面图标整体偏上，能自己调吗」——那根轴早就存在（mobile-adapt.js #707 的 desk 轴
// → --mochi-desk-adj → home.css #desktop-pages padding-top），只是埋在 设置→屏幕适配微调，用户找不到。
// 本批把它挪进「边看边调」抽屉的 背景 分区（同一份数据、同一个写入口，不复制第二套实现）。
// 【#1293】接线时实测出来的真 bug：screen-adj-* 七个根键既不在 contacts.js 的 EXCLUDE、也没有前缀守卫 →
// migrateLegacy 每次启动把根键当旧顶层业务键迁进 default 桌面并删根键，而读取方 loadAdj 只认根键。
// 探针读数（纯 HEAD 产物，同一 profile 连刷三次）：T2 desk=12 / padding-top:12px → **T3 desk=0 / 0px**，
// default 副本无人读＝用户调的偏移（含「屏幕适配诊断→一键修正」写进去的）在下一次冷启静默归零。
//
// 断言（红侧＝纯 HEAD 产物；每组开头的「场景落地」是对照项，用来证明夹具真到位、不是空跑）：
//  S  产物源锚  S1~S5 personalize.js／S6~S7 contacts.js／S8 index.html 内联 CSS 消费者
//  B  横构图壁纸 @150%  B1 尺寸恒 cover（红＝150%）B2 盒覆盖 .phone B3 盒=1.5×.phone 且同心
//     B4 按 background-size 折算出的图像高 ≥ 盒高（红侧＝图像 547 < 盒 750，上下各留 101px＝症状本体）
//     B5 外扩由 .phone overflow 裁掉（放大＝裁切，不是溢出可见）
//  C  默认档（无 size 键）C1 盒==.phone C2 内联几何回到 100%/0（把外扩让还给 CSS）——两侧皆绿＝没修过头
//  D  背景模糊＋放大      D1 盒=1.5×.phone 再叠 #240 的 24px 外扩（红＝只有 .phone 那么大）
//     D2 模糊壁纸仍走 #1161 烘焙纹理（控制项＝本批没踩坏烘焙路径）
//  E  预设渐变壁纸        E1 上一张图留下的放大盒收回（==.phone）
//  F  真 UI 拖滑杆（不刷新）F1 面板文案写明「铺满」F2 拖到 200＝2×.phone 且不露底 F3 拖回 100＝交还 CSS 且键回 cover
//  G  抽屉＋轴存活        G0 根键扛得住第二次冷启（#1293）G1 抽屉里有这根滑杆 G2 回显既存值 G3 拖动即时生效
//     G4 松手才落库 G5 归零撤属性 G6 抽屉直达壁纸放大面板
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-1285-desk-bg-and-adj-axis.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port + '/';
const origin = 'http://127.0.0.1:' + port;
console.log('被测产物根目录 = ' + root);
// 防喂错产物：MOCHI_SERVE_ROOT 指歪（并行循环里变量没展开成路径）时，页面是 404 空白，
// 场景永远落不下来——B0 读不到图层会在 .tex.slice 上抛穿，日志只剩 Node 版本行、看不到任何读数。
try {
  statSync(join(root, 'index.html'));
} catch (e) {
  console.error('SKIP: 被测根目录下没有 index.html（' + root + '）——A/B 对照前务必把 MOCHI_SERVE_ROOT 指到真正构建出的产物目录');
  try { server.close(); } catch (e2) {}
  process.exit(2);
}

const R = { pass: 0, fail: 0, lines: [] };
const ok = (n, c, d) => { c ? R.pass++ : R.fail++; R.lines.push((c ? '  ✅ ' : '  ❌ ') + n + (d ? ' — ' + d : '')); };

// ---------- S 组：产物源锚（外置 js/ 与 index.html 内联 CSS，按产物实际形态写） ----------
{
  const rd = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
  const pz = rd('js/personalize.js'), ct = rd('js/contacts.js'), html = rd('index.html');
  ok('S1 放大由图层盒承担（换算 k 后交给 bgLayerGeom）', pz.includes('bgLayerGeom(l, zoomed > 100 ? zoomed / 100 : 1);'));
  ok('S2 尺寸恒交 CSS 关键字（旧的 pos.s + \'%\' 那条已没）', pz.includes("const szWanted = 'cover';") && !pz.includes("(pos.s + '%')"));
  ok('S3 预设/清档时收回上一张图留下的外扩盒', pz.includes('bgLayerGeom(l, 1);'));
  ok('S4 抽屉里的图标区轴（复用 mochiScreenAdj 的 desk 轴，±60）', pz.includes("mkAdjRow('图标区上下', 'desk', '--mochi-desk-adj', -60, 60"));
  ok('S5 抽屉直达壁纸放大面板（唤起既有那一行，不另实现一份）', pz.includes("d.style.display = 'none'; row.click();"));
  ok('S6 适配七轴根键挡在迁移之外（前缀守卫，同 #642 口径）', ct.includes("if (r.indexOf('screen-adj-') === 0) return true;"));
  ok('S7 存量被误迁进 default 的七轴副本写回根键找回', ct.includes("'screen-adj-shift', 'screen-adj-text', 'screen-adj-side'].forEach(function (k) {"));
  ok('S8 桌面图标区 CSS 消费者在位（index.html 内联形态）', html.includes('#desktop-pages { padding-top: var(--mochi-desk-adj, 0px); }'));
}

// ---------- 启动 headless ----------
const userDir = join(process.env.TEMP || '/tmp', 'mochi-v1285-' + Date.now());
const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + userDir,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=390,844', 'about:blank'];
const cp = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('DevTools 端口未就绪')), 20000);
  cp.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  });
  cp.on('exit', () => reject(new Error('Chrome 提前退出')));
});
const dbg = wsUrl.replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
const targets = await (await fetch(dbg + '/json/list')).json();
let page = targets.find((t) => t.type === 'page');
if (!page) page = await (await fetch(dbg + '/json/new?about:blank')).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const waits = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params) => new Promise((res, rej) => { const id = ++mid; waits.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
const evalJs = async (expr, awaitPromise) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
(function(){ try{
  if (sessionStorage.getItem('__p1285-errors') === null) sessionStorage.setItem('__p1285-errors','[]');
  var errs = JSON.parse(sessionStorage.getItem('__p1285-errors') || '[]');
  window.addEventListener('error', function(ev){ errs.push(String(ev.message||ev.error)); sessionStorage.setItem('__p1285-errors', JSON.stringify(errs.slice(0,6))); });
  window.addEventListener('unhandledrejection', function(ev){ errs.push('rej:'+String(ev.reason)); sessionStorage.setItem('__p1285-errors', JSON.stringify(errs.slice(0,6))); });
}catch(e){} })();
` });

const dismiss = () => evalJs("(function(){try{var s=document.getElementById('splash');if(s)s.remove();var q=document.getElementById('qa-mask');if(q)q.remove();}catch(e){}return 1})()");
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2600); await dismiss(); await sleep(900); };

// 每场从干净 origin 起：先离开应用页再清（在被测文档里清会被 IDB 回填串场）
// 本尺各场景显式写入的键（清库走 Storage.clearDataForOrigin，这份名单只为可读性与收尾自查）
const SCENE_KEYS = ['xy-home-v2:default:phone-bg', 'xy-home-v2:default:phone-bg-size', 'xy-home-v2:default:phone-bg-preset', 'xy-home-v2:default:phone-bg-solid', 'xy-home-v2:default:bg-blur', 'xy-home-v2:screen-adj-desk'];
const freshScene = async (setupJs, reloads) => {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,indexeddb' }).catch(() => {});
  await sleep(300);
  await nav(base);
  // 清库万一没生效（某些内核 clearDataForOrigin 静默失败）：再显式摘掉本场景要写的键，LS 与 IDB 双清
  await evalJs(`(function(){var K=${JSON.stringify(SCENE_KEYS)};K.forEach(function(k){try{localStorage.removeItem(k)}catch(e){}});return 1})()`);
  await evalJs(setupJs, true);
  await evalJs(`(function(){var K=${JSON.stringify(SCENE_KEYS)};K.forEach(function(k){try{window.idbDelete&&window.idbDelete(k)}catch(e){}});return 1})()`);
  await sleep(400);
  const n = reloads == null ? 1 : reloads;
  for (let i = 0; i < n; i++) await nav(base);
};

// 横构图（4:3）饱和壁纸：正是「宽度百分比」语义下会在上下留边的构图（用户所见＝图片本身四周留边）
const WALL = `(function(){
  var c=document.createElement('canvas');c.width=800;c.height=600;var g=c.getContext('2d');
  var gr=g.createLinearGradient(0,0,800,600);
  gr.addColorStop(0,'#ff3b30');gr.addColorStop(.35,'#ff9500');gr.addColorStop(.6,'#5e5ce6');gr.addColorStop(1,'#0a84ff');
  g.fillStyle=gr;g.fillRect(0,0,800,600);
  for(var i=0;i<24;i++){g.fillStyle=['#ff2d92','#30d158','#ffd60a'][i%3];g.fillRect((i*97)%760,(i*61)%560,34,34);}
  localStorage.setItem('xy-home-v2:default:phone-bg', c.toDataURL('image/png'));
  return 1;
})()`;

const geom = () => evalJs(`(function(){
  var l=document.getElementById('phone-bg-layer'), ph=document.querySelector('.phone');
  if(!l||!ph) return {no:1,tex:'',du:'',op:'',size:'',pos:'',iw:'',ih:'',itop:'',ileft:'',imp:'',ovf:'',lx:0,ly:0,lw:0,lh:0,px:0,py:0,pw:0,phh:0};
  var lr=l.getBoundingClientRect(), pr=ph.getBoundingClientRect(), cs=getComputedStyle(l);
  var u=String(l.style.backgroundImage||''), i=u.indexOf('data:'), j=u.indexOf('"', i);
  return { lx:lr.x, ly:lr.y, lw:lr.width, lh:lr.height, px:pr.x, py:pr.y, pw:pr.width, phh:pr.height,
    size:String(cs.backgroundSize), pos:String(cs.backgroundPosition),
    iw:String(l.style.width||''), ih:String(l.style.height||''), itop:String(l.style.top||''), ileft:String(l.style.left||''),
    imp:String(l.style.getPropertyPriority('width')||''), op:String(cs.opacity),
    tex: i < 0 ? (u.indexOf('linear-gradient') >= 0 ? 'gradient' : (u || 'empty').slice(0, 12)) : u.slice(i, j > i ? j : i + 22),
    du: i < 0 ? '' : u.slice(i, j > i ? j : u.lastIndexOf(')')),
    ovf:String(getComputedStyle(ph).overflow||'') };
})()`);
const waitLayer = async (ms) => {
  const t0 = Date.now();
  for (;;) {
    const g = await geom().catch(() => null);
    if (g && !g.no && g.op === '1' && g.lw > 0) return g;
    if (Date.now() - t0 > ms) return g;
    await sleep(250);
  }
};
const covers = (g, pad) => {
  const p = pad == null ? 2 : pad;
  return g.lx <= g.px + p && g.ly <= g.py + p && g.lx + g.lw >= g.px + g.pw - p && g.ly + g.lh >= g.py + g.phh - p;
};
const readG = (g) => g && !g.no ? ('盒 ' + g.lw.toFixed(1) + 'x' + g.lh.toFixed(1) + '@' + g.lx.toFixed(1) + ',' + g.ly.toFixed(1) + ' / .phone ' + g.pw.toFixed(1) + 'x' + g.phh.toFixed(1)) : '无图层';
// CSSOM 把 '0' 序列化成 '0px'，两种写法都算「回到基线」
const isZero = (v) => v === '0' || v === '0px' || v === '';
// 按 background-size 折算出图像真高——这一条就是「图片本身四周留边」的算术证明（不需要看像素）
const coverProof = (g) => {
  if (!g || g.no || !g.du) return Promise.resolve(null);
  return evalJs(`new Promise(function(res){var l=document.getElementById('phone-bg-layer');if(!l){res(null);return}
    var u=String(l.style.backgroundImage||'');var i=u.indexOf('data:');var j=u.indexOf('"',i);if(i<0){res(null);return}
    var url=u.slice(i, j>i?j:u.lastIndexOf(')'));
    var im=new Image();im.onload=function(){
      var b=l.getBoundingClientRect(), bw=b.width, bh=b.height, ar=im.naturalWidth/im.naturalHeight, s=String(getComputedStyle(l).backgroundSize);
      var rw=0, rh=0;
      if(s==='cover'){rw=Math.max(bw,bh*ar);rh=rw/ar;}
      else if(s==='contain'){rw=Math.min(bw,bh*ar);rh=rw/ar;}
      else{var pr=s.trim().split(/\\s+/);rw=String(pr[0]).indexOf('%')>=0?bw*parseFloat(pr[0])/100:parseFloat(pr[0]);
        if(pr.length>1&&String(pr[1])!=='auto'){rh=String(pr[1]).indexOf('%')>=0?bh*parseFloat(pr[1])/100:parseFloat(pr[1]);}else{rh=rw/ar;}}
      res({nw:im.naturalWidth,nh:im.naturalHeight,bw:bw,bh:bh,rw:rw,rh:rh,size:s});
    };im.onerror=function(){res(null)};im.src=url;})`, true);
};
const proofRead = (p) => p ? ('图像 ' + p.rw.toFixed(0) + 'x' + p.rh.toFixed(0) + '（原图 ' + p.nw + 'x' + p.nh + '，size=' + p.size + '）/ 盒 ' + p.bw.toFixed(0) + 'x' + p.bh.toFixed(0) + (p.rh < p.bh - 2 ? ' → 上下各留 ' + ((p.bh - p.rh) / 2).toFixed(0) + 'px 底色' : (p.rw < p.bw - 2 ? ' → 左右露底色' : ''))) : '取不到纹理';

// ---------- B 组：横构图壁纸 @150% ----------
await freshScene(WALL + ";localStorage.setItem('xy-home-v2:default:phone-bg-size','150');1");
const g150 = await waitLayer(9000);
ok('B0 场景落地：桌面图层铺的是夹具 PNG 壁纸且可见（对照项，证明夹具真到位）', !!(g150 && !g150.no && /^data:image\/png/.test(g150.tex) && g150.op === '1'), g150 ? ('tex=' + g150.tex.slice(0, 22) + ' opacity=' + g150.op + ' ' + readG(g150)) : '无图层');
ok('B1 background-size 恒为 cover（红侧＝150%，正是「宽度百分比」那条错语义）', !!(g150 && g150.size === 'cover'), g150 ? 'size=' + g150.size + ' pos=' + g150.pos : '-');
ok('B2 图层盒覆盖整个 .phone：任何档位不露底', !!g150 && !g150.no && covers(g150), readG(g150) + ' 内联w=' + (g150 && g150.iw));
{
  const tol = 3, dw = g150 && !g150.no ? g150.lw - g150.pw * 1.5 : 0, dh = g150 && !g150.no ? g150.lh - g150.phh * 1.5 : 0;
  const offx = g150 && !g150.no ? (g150.lx - g150.px) + (g150.lw - g150.pw) / 2 : 0, offy = g150 && !g150.no ? (g150.ly - g150.py) + (g150.lh - g150.phh) / 2 : 0;
  ok('B3 盒=k×.phone（k=1.5）且与 .phone 同心（容差 3px）', !!g150 && !g150.no && Math.abs(dw) <= tol && Math.abs(dh) <= tol && Math.abs(offx) <= tol && Math.abs(offy) <= tol,
    g150 && !g150.no ? ('w差=' + dw.toFixed(1) + ' h差=' + dh.toFixed(1) + ' 偏心=' + offx.toFixed(1) + ',' + offy.toFixed(1) + ' top=' + g150.itop + ' important=' + g150.imp) : '-');
}
{
  const p = await coverProof(g150).catch(() => null);
  ok('B4 折算后的图像本身盖满图层盒（红侧＝图像高 547 < 盒高 750，上下各留一条底色＝用户所见）', !!p && p.rw >= p.bw - 2 && p.rh >= p.bh - 2, proofRead(p));
}
ok('B5 外扩部分由 .phone 裁掉（放大＝裁切，不是靠溢出可见）', !!(g150 && /hidden|clip/.test(g150.ovf)), g150 ? 'overflow=' + g150.ovf : '-');

// ---------- C 组：默认档（无 size 键）＝几何整个交还 CSS ----------
await freshScene(WALL + ";1");
const g100 = await waitLayer(9000);
ok('C0 场景落地：默认档图层铺的是壁纸（对照项）', !!(g100 && !g100.no && /^data:image\/png/.test(g100.tex)), readG(g100));
ok('C1 100% 档：盒==.phone（±2px，两侧皆绿＝没修过头）', !!(g100 && !g100.no) && covers(g100, 2) && Math.abs(g100.lw - g100.pw) <= 2 && Math.abs(g100.lh - g100.phh) <= 2, readG(g100));
ok('C2 100% 档：内联几何回到基线 0/100%（把 #240/#690 的模糊外扩整个让还给 CSS）', !!(g100 && g100.iw === '100%' && isZero(g100.itop) && isZero(g100.ileft) && g100.size === 'cover'), g100 ? ('w=' + g100.iw + ' top=' + g100.itop + ' left=' + g100.ileft + ' size=' + g100.size) : '-');

// ---------- D 组：背景模糊开着（bg-blur=10）＋放大 ----------
await freshScene(WALL + ";localStorage.setItem('xy-home-v2:default:phone-bg-size','150');localStorage.setItem('xy-home-v2:default:bg-blur','10');1");
let gB = await waitLayer(9000);
for (let i = 0; i < 20; i++) { if (gB && !gB.no && gB.lw >= gB.pw * 1.5 + 20) break; await sleep(400); gB = await waitLayer(1500); }
ok('D0 场景落地：模糊＋150% 档（对照项）', !!(gB && !gB.no && gB.op === '1'), readG(gB) + ' tex=' + (gB && gB.tex.slice(0, 20)));
ok('D1 模糊开着＋150%：盒＝1.5×.phone 再加 #240 的 24px 外扩（内联 important 压过 home.css 里的 important）',
  !!(gB && !gB.no) && Math.abs(gB.lw - (gB.pw * 1.5 + 48)) <= 4 && Math.abs(gB.lh - (gB.phh * 1.5 + 48)) <= 4,
  gB ? ('盒 ' + gB.lw.toFixed(0) + 'x' + gB.lh.toFixed(0) + ' 期望 ' + (gB.pw * 1.5 + 48).toFixed(0) + 'x' + (gB.phh * 1.5 + 48).toFixed(0) + ' w=' + gB.iw + ' top=' + gB.itop + ' important=' + gB.imp) : '-');
ok('D2 模糊壁纸仍走 #1161 烘焙纹理（图层铺 JPEG 小图；控制项＝本批没踩坏烘焙路径）', !!(gB && !gB.no && /^data:image\/jpeg/.test(gB.tex)), 'tex=' + (gB && gB.tex.slice(0, 22)));

// ---------- E 组：预设渐变壁纸（没有放大一档）→ 上一张图留下的外扩盒必须收回 ----------
await freshScene("localStorage.setItem('xy-home-v2:default:phone-bg-preset','暖阳');localStorage.setItem('xy-home-v2:default:phone-bg-size','150');1");
const gP = await waitLayer(9000);
ok('E0 场景落地：图层铺的是预设渐变（对照项）', !!(gP && !gP.no && gP.tex === 'gradient'), gP ? 'tex=' + gP.tex : '-');
ok('E1 预设壁纸：盒==.phone（残留 150 档不得把渐变撑大）', !!(gP && !gP.no) && Math.abs(gP.lw - gP.pw) <= 2 && Math.abs(gP.lh - gP.phh) <= 2, readG(gP) + ' w=' + (gP && gP.iw));

// ---------- F 组：真 UI 拖滑杆（不刷新，走面板 → applyBgPos → 重绘） ----------
await freshScene(WALL + ";localStorage.setItem('xy-home-v2:default:phone-bg-size','150');1");
await waitLayer(9000);
{
  const opened = await evalJs("(function(){var r=document.getElementById('row-bg-adjust');if(!r)return{no:'无 #row-bg-adjust'};r.click();return 1})()");
  await sleep(500);
  const panel = await evalJs(`(function(){var m=document.getElementById('bg-adjust-panel');if(!m)return{no:1};
    var rs=[].slice.call(m.querySelectorAll('input[type=range]'));var z=null;rs.forEach(function(i){if(String(i.max)==='300')z=i});
    return {disp:getComputedStyle(m).display, text:String(m.textContent||''), n:rs.length, hasz:!!z};})()`);
  ok('F0 场景落地：壁纸定位与缩放面板打得开（对照项，两侧皆绿）', !!(panel && !panel.no && panel.disp !== 'none' && panel.hasz), typeof opened === 'object' ? JSON.stringify(opened) : JSON.stringify({ disp: panel && panel.disp, n: panel && panel.n, zoom: !!(panel && panel.hasz) }));
  ok('F1 面板文案写明「铺满」（红侧只写「缩放」＝用户读成放大＝露底）', !!(panel && !panel.no && /铺满/.test(panel.text)), '文案=' + String(panel && panel.text || '').replace(/\s+/g, ' ').slice(0, 52));
  const setZoom = (v) => evalJs(`(function(){var rs=[].slice.call(document.querySelectorAll('#bg-adjust-panel input[type=range]'));var z=null;rs.forEach(function(i){if(String(i.max)==='300')z=i});if(!z)return 0;z.value='${v}';z.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  {
    const r = await setZoom(200); await sleep(600);
    const g = await geom(); const p = await coverProof(g).catch(() => null);
    ok('F2 滑杆拖到 200（真 UI 链路，不刷新）：盒=2×.phone、尺寸仍 cover、折算后不露底',
      !!(r === 1 && g && !g.no && g.size === 'cover' && Math.abs(g.lw - g.pw * 2) <= 4 && Math.abs(g.lh - g.phh * 2) <= 4 && covers(g) && p && p.rw >= p.bw - 2 && p.rh >= p.bh - 2),
      readG(g) + ' size=' + (g && g.size) + ' ' + proofRead(p));
  }
  {
    const r = await setZoom(100); await sleep(600);
    const g = await geom();
    const key = await evalJs("(function(){return localStorage.getItem('xy-home-v2:default:phone-bg-size')||''})()");
    ok('F3 拖回 100：盒回到 .phone、内联几何交还 CSS、键回到 cover', !!(r === 1 && g && !g.no && g.iw === '100%' && Math.abs(g.lw - g.pw) <= 2 && key === 'cover'), readG(g) + ' w=' + (g && g.iw) + ' key=' + key);
  }
}

// ---------- G 组：#1293 轴存活 ＋ #1292 抽屉里的「图标区上下」 ----------
await freshScene(WALL + ";localStorage.setItem('xy-home-v2:screen-adj-desk','12');1", 2);
await sleep(600);
{
  const adj = await evalJs(`(function(){var dp=document.getElementById('desktop-pages');
    return { root:localStorage.getItem('xy-home-v2:screen-adj-desk')||'', inDefault:!!localStorage.getItem('xy-home-v2:default:screen-adj-desk'),
      all:(window.mochiScreenAdj&&window.mochiScreenAdj.all)?window.mochiScreenAdj.all().desk:null,
      v:document.documentElement.style.getPropertyValue('--mochi-desk-adj'),
      pt:dp?String(getComputedStyle(dp).paddingTop||''):'-' };})()`);
  ok('G0 图标区偏移扛得住第二次冷启（根键仍在、值仍生效；红侧＝被迁进 default 并删根键→归零）',
    adj.root === '12' && adj.all === 12 && adj.v === '12px' && adj.pt === '12px' && !adj.inDefault, JSON.stringify(adj));
  await evalJs("(function(){var b=document.getElementById('dq-drawer');if(b)b.click();return 1})()");
  await sleep(800);
  await evalJs("(function(){var c=document.querySelector('#beauty-drawer [data-sec=\"bg\"]');if(c)c.click();return 1})()");
  await sleep(700);
  const find = `(function(){var d=document.getElementById('beauty-drawer');if(!d)return{no:'无 #beauty-drawer'};
    var sp=[].slice.call(d.querySelectorAll('span')).filter(function(s){return s.textContent==='图标区上下'});
    var inp=sp.length?sp[0].nextElementSibling:null;
    return {disp:getComputedStyle(d).display, has:!!(inp&&inp.type==='range'), v:inp?String(inp.value):'', min:inp?String(inp.min):'', max:inp?String(inp.max):''};})()`;
  const g1 = await evalJs(find);
  ok('G1 抽屉「背景」分区里有「图标区上下」这根滑杆（±60；红侧无入口＝本批契约）', !!(g1 && !g1.no && g1.disp !== 'none' && g1.has && g1.min === '-60' && g1.max === '60'), JSON.stringify(g1));
  ok('G2 回显既存值（与 设置→屏幕适配微调 同一份数据，不复制第二套）', !!(g1 && g1.has && g1.v === '12'), 'inp.value=' + (g1 && g1.v) + ' rootLS=' + adj.root);
  const drag = (v, evs) => evalJs(`(function(){var d=document.getElementById('beauty-drawer');if(!d)return 0;
    var sp=[].slice.call(d.querySelectorAll('span')).filter(function(s){return s.textContent==='图标区上下'});
    var inp=sp.length?sp[0].nextElementSibling:null;if(!inp)return 0;inp.value='${v}';
    ${JSON.stringify(evs)}.forEach(function(t){inp.dispatchEvent(new Event(t,{bubbles:true}))});return 1})()`);
  const eff = () => evalJs(`(function(){var dp=document.getElementById('desktop-pages');
    return { drag:null, v:document.documentElement.style.getPropertyValue('--mochi-desk-adj'),
      pt:dp?String(getComputedStyle(dp).paddingTop||''):'-',
      ls:localStorage.getItem('xy-home-v2:screen-adj-desk')||'',
      all:(window.mochiScreenAdj&&window.mochiScreenAdj.all)?window.mochiScreenAdj.all().desk:null };})()`);
  {
    const r = await drag('18', ['input']); await sleep(400);
    const e = await eff();
    ok('G3 拖动即时生效（--mochi-desk-adj → #desktop-pages 计算 padding-top=18px）', r === 1 && e.v === '18px' && e.pt === '18px', 'drag=' + r + ' ' + JSON.stringify(e));
    const r2 = await drag('18', ['change']); await sleep(400);
    const e2 = await eff();
    ok('G4 松手才落库（根命名空间 LS + mochiScreenAdj 状态一致＝本机永久、跨桌面共用）', r2 === 1 && e2.ls === '18' && e2.all === 18, 'ev=' + r2 + ' ' + JSON.stringify(e2));
    const r3 = await drag('0', ['input', 'change']); await sleep(400);
    const e3 = await eff();
    ok('G5 归零＝撤属性（0 档回到原布局，不留 0px 死值），LS 键随之删除', r3 === 1 && e3.v === '' && (e3.pt === '0px' || e3.pt === '') && e3.ls === '', 'ev=' + r3 + ' ' + JSON.stringify(e3));
  }
  {
    const btn = await evalJs(`(function(){var d=document.getElementById('beauty-drawer');if(!d)return{no:1};
      var bs=[].slice.call(d.querySelectorAll('button')).filter(function(b){return /壁纸缩放/.test(String(b.textContent||''))});
      if(!bs.length)return {has:false}; bs[0].click(); return {has:true};})()`);
    await sleep(700);
    const after = await evalJs(`(function(){var d=document.getElementById('beauty-drawer'),m=document.getElementById('bg-adjust-panel');
      return {drawer:d?getComputedStyle(d).display:'-', panel:m?getComputedStyle(m).display:'-',
        zoom:m?[].slice.call(m.querySelectorAll('input[type=range]')).some(function(i){return String(i.max)==='300'}):false};})()`);
    ok('G6 抽屉里一点直达「壁纸缩放 / 定位」（红侧无此按钮＝用户够不着入口）', !!(btn && btn.has && after.panel !== 'none' && after.zoom && after.drawer === 'none'), JSON.stringify(btn) + JSON.stringify(after));
  }
}

// ---------- Z ----------
const errs = await evalJs("JSON.parse(sessionStorage.getItem('__p1285-errors')||'[]')").catch(() => []);
ok('Z1 全程零未捕获 JS 异常', (errs || []).length === 0, JSON.stringify(errs));

console.log('===== #1285 壁纸缩放＝铺满后放大 ＋ #1292 抽屉图标区轴 ＋ #1293 适配轴根键存活 =====');
R.lines.forEach((l) => console.log(l));
console.log('结果：通过 ' + R.pass + ' / 失败 ' + R.fail);
try { ws.close(); } catch (e) {}
try { cp.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { console.log('__MOCHI_EOF__'); } catch (e) {}
process.exit(R.fail ? 1 : 0);
