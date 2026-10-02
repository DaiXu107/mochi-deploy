// verify-chat-bg-fill.mjs —— #762 聊天壁纸「铺满方式」四档行为断言（无头 Chrome · CDP）。
//
// 用户报障（2026-09-18，多机型同现）：「聊天设置里的【壁纸铺满方式】全部有问题，
// 也没有之前那样正常的全部铺满的了。」
//
// 被测机制（#762 起）：壁纸画在 #page-chat 的常驻子层 #cs-bg-layer 上（z-index:-1，
// .page 自身 z-index:2 ＝ 独立层叠上下文，故该层恰好压在页面底色之上、气泡与栏位之下），
// background-size 交回 CSS 关键字；手机端「铺满裁剪」档另加 `min-height:100lvh` 下限，
// 使「壁纸的盒」与「会变的页面盒」脱钩——键盘压矮 .phone（#750 症状）与地址栏涨落 dvh
// （#751 症状）都改不动它 ⇒ 缩放比恒定、永不露底。
//
// 本脚本刻意只断言「用户看得见的几何与像素」，不断言任何内部变量
// （#750/#751 那套 csBgStableBox/__csBgNat/双读 settle 全部不再被引用——它们被删掉才是对的）。
//
// 口径：
//   S 组 静态：图层实现与 CSS 下限在 src 与产物里都在位；四档映射全是合法 CSS。
//   B1 图层在位且层叠正确（#page-chat 是层叠上下文、图层 z-index:-1、首个子节点）。
//   B2 壁纸画在图层上，页面自身不再有内联背景（#750 时代的写法不留残影）。
//   B3 【核心】铺满裁剪档全程不露底：每个阶段绘制尺寸 ≥ 当前页面盒（含键盘期）。
//   B4 键盘期不重算：页面盒确实变矮（前置，防假绿）且图层高/绘制尺寸与基线逐字节相同。
//   B5 地址栏涨落（视口变高再回落）后绘制尺寸回到基线值（#751「莫名其妙放大」不得残留）。
//   B6 反复涨落三次仍等于基线（不累积漂移）。
//   B7 旋转（真改宽）后仍不露底（宽度必须跟着新盒重算）。
//   B8 四档语义可分：cover 盖满 / contain 整图可见 / tile 真重复 / stretch 铺满变形。
//   B9 像素取证：栏位透明时页面上下边缘采到的是壁纸色（真铺到边、且压在页面底色之上）；
//      栏位不透明时顶栏行采到的是栏位白底（壁纸不得盖住栏位内容）。
//   B10 清壁纸后图层收起、无残留。
//   B11 全程零 JS 异常。
//
// RED 基线（实测）：
//   HEAD 产物（#750/#751 冻结像素版）→ B3/B4/B5/B9 红：进聊天即 painted=379x718 而盒 390x844
//   （上下各露一条底色），键盘期锚到 390x740，地址栏涨落时 painted 在 445x844/475x900 间跳。
//   把 min-height 下限删掉（只留 height:100%）→ B4/B5 红（回到「键盘期重算缩放比」）。
//   把 tile 档退回 'auto' → B8 红。
// 用法：MOCHI_ROOT=<构建产物目录> node tools/verify-chat-bg-fill.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, normalize, extname } from 'node:path';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_ROOT || process.cwd());
const SRC = join(root, 'src');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (p.endsWith('\\') || p.endsWith('/')) p += 'index.html';
    try { statSync(p); } catch (e) { p = join(root, 'index.html'); }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('x'); }
});
const port = 8800 + Math.floor(Math.random() * 900);
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + port;

const chromePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => { try { statSync(p); return true; } catch (e) { return false; } });
if (!chromePath) { console.log('FATAL 找不到 Chrome/Edge'); process.exit(1); }

const udd = join(tmpdir(), 'mochi-bg-fill-' + Date.now());
const ch = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + udd,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cdpPort = 0;
ch.stderr.on('data', (d) => { const m = String(d).match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) cdpPort = +m[1]; });
for (let i = 0; i < 80 && !cdpPort; i++) await sleep(150);
if (!cdpPort) { console.log('FATAL 无 CDP 端口'); ch.kill(); server.close(); process.exit(1); }

let ws = null, msgId = 0;
const pend = new Map();
const jsErrs = [];
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const p = l.find((t) => t.type === 'page');
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.log('FATAL 无法连接 CDP'); process.exit(1); }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') jsErrs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') jsErrs.push('console:' + String(m.params.args?.[0]?.value || '').slice(0, 160));
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
};
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'ERR:' + String(r.exceptionDetails.exception?.description || '').slice(0, 300);
  return r && r.result ? r.result.value : null;
};
await cdp('Runtime.enable');
await cdp('Page.enable');

// ---- 1x1 PNG 解码（B9 像素取证用；CDP 截图 clip 1x1 ⇒ 解码成本恒定）----
function pngPixel(b64) {
  const buf = Buffer.from(b64, 'base64');
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 0 ? 1 : ctype === 4 ? 2 : 0;
  if (!ch || depth !== 8) return null;
  const stride = w * ch;
  // 只需首行首像素；filter 逐行还原（1x1 时上一行为零）
  let prev = Buffer.alloc(stride), line = Buffer.alloc(stride), out = null;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : pb <= pc ? b : c; }
      line[x] = v & 255;
    }
    if (y === 0) out = [line[0], line[ch > 1 ? 1 : 0], line[ch > 2 ? 2 : line[0]]];
    prev = line; line = Buffer.alloc(stride);
  }
  return { w, h, rgb: out };
}
async function shotPixel(cssX, cssY) {
  const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: cssX, y: cssY, width: 1, height: 1, scale: 1 } });
  return pngPixel(r && r.data ? r.data : '');
}

// ---- 页面探针：只读「用户看得见的几何」----
const NAT_W = 2160, NAT_H = 4096; // 种子壁纸原图尺寸
const probe = `(function(){
  var pc=document.getElementById('page-chat');
  if(!pc) return JSON.stringify({err:'no-page'});
  // RED 基线支持：#762 之前壁纸直接画在 #page-chat 上，没有图层 ⇒ 量页面自身。
  var L=document.getElementById('cs-bg-layer');
  var onLayer = !!L;
  if(!L) L=pc;
  var cs=getComputedStyle(L), pcs=getComputedStyle(pc);
  var lw=L.clientWidth, lh=L.clientHeight;
  var size=cs.backgroundSize||'';
  var nw=${NAT_W}, nh=${NAT_H}, pw=NaN, ph=NaN;
  var mPx=size.match(/^([\\d.]+)px\\s+([\\d.]+)px$/), mPc=size.match(/^([\\d.]+)%\\s+([\\d.]+)%$/);
  var mOne=size.match(/^([\\d.]+)px\\s+auto$/) || (function(){var q=size.match(/^([\\d.]+)%\\s+auto$/); if(q) return [q[0], (q[1]/100*lw)+'px', q[2]]; return null;})();
  if(size==='cover'){var s=Math.max(lw/nw,lh/nh); pw=nw*s; ph=nh*s;}
  else if(size==='contain'){var s2=Math.min(lw/nw,lh/nh); pw=nw*s2; ph=nh*s2;}
  else if(size==='auto'){pw=nw; ph=nh;}
  else if(mPx){pw=+mPx[1]; ph=+mPx[2];}
  else if(mPc){pw=mPc[1]/100*lw; ph=mPc[2]/100*lh;}
  else if(mOne){pw=+mOne[1]; ph=pw*nh/nw;}
  // 单值形式：Chrome 把 '33.333% auto' 序列化成 '33.333%'（auto 是初值被省略）
  else if(/^([\\d.]+)%$/.test(size)){pw=+RegExp.$1/100*lw; ph=pw*nh/nw;}
  else if(/^([\\d.]+)px$/.test(size)){pw=+RegExp.$1; ph=pw*nh/nw;}
  return JSON.stringify({
    box: pc.clientWidth+'x'+pc.clientHeight, bw: pc.clientWidth, bh: pc.clientHeight,
    layer: lw+'x'+lh, lw: lw, lh: lh,
    size: size, repeat: cs.backgroundRepeat, pos: cs.backgroundPosition,
    painted: isNaN(pw)?'NaN':(Math.round(pw)+'x'+Math.round(ph)), pw: pw, ph: ph,
    disp: cs.display, z: cs.zIndex, first: pc.firstElementChild===L, onLayer: onLayer,
    pcPos: pcs.position, pcZ: pcs.zIndex, pcInlineBg: (pc.style.backgroundImage||'').slice(0,20),
    phoneH: (document.querySelector('.phone')||{style:{}}).style.height||'',
    lvh: (function(){var d=document.createElement('div');d.style.cssText='position:absolute;height:100lvh;visibility:hidden';document.body.appendChild(d);var v=d.clientHeight;d.remove();return v;})()
  });
})()`;
const P = async () => JSON.parse(String(await evalJs(probe)));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  [' + detail + ']' : '')); }
};

// ================= S 组：静态实现 =================
console.log('== S 组 静态实现 ==');
const readSrc = (f) => { try { return readFileSync(join(SRC, f), 'utf8'); } catch (e) { return ''; } };
const cj = readSrc('js/chat-settings.js');
const cm = readSrc('css/chat-main.css');
const prod = readFileSync(join(root, 'index.html'), 'utf8');
const hasLayerImpl = /id = 'cs-bg-layer'/.test(cj) || /id\s*=\s*'cs-bg-layer'/.test(cj);
ok('S1 图层实现（创建 #cs-bg-layer 并插进 #page-chat）', hasLayerImpl && /insertBefore\(l, chatPage\.firstChild\)/.test(cj));
ok('S2 图层内联兜底（z-index:-1 + 四长手，老内核 inset 被丢也不塌 0x0）', /z-index:-1/.test(cj) && /top:0;left:0;right:0;bottom:0/.test(cj));
ok('S3 铺满档类开关（cs-bg-fill 按档位挂/摘）', /classList\.toggle\('cs-bg-fill', fit === 'fill'\)/.test(cj));
ok('S4 CSS lvh 下限在 ≤900px 通栏形态内（删＝键盘期重算缩放比、#750 症状回流）', /#page-chat\.cs-bg-fill #cs-bg-layer \{ min-height:100vh; min-height:100lvh; \}/.test(cm));
ok('S5 CSS 下限同覆盖 force-mobile / tablet（三处通栏形态同口径）', /html\.force-mobile #page-chat\.cs-bg-fill #cs-bg-layer,\s*html\.tablet #page-chat\.cs-bg-fill #cs-bg-layer \{ min-height:100vh; min-height:100lvh; \}/.test(cm));
ok('S6 四档映射全为合法 CSS（无裸 fill / 无 tile=auto）', /function csBgFitCss\(fit\) \{[\s\S]*?\n  \}/.test(cj) && !/'auto';/.test((cj.match(/function csBgFitCss\(fit\) \{[\s\S]*?\n  \}/) || [''])[0]));
ok('S7 冻结盒那套已彻底移除（csBgStableBox/csBgPaintSize/csBgMeasure/__csBgNat 不再被引用）',
  !/csBgStableBox\(/.test(cj) && !/csBgPaintSize\(/.test(cj) && !/csBgMeasure\(/.test(cj) && !/__csBgNat/.test(cj));
ok('S8 产物已接入（图层 id 与下限规则都在 index.html 里）', prod.includes('cs-bg-layer') && /min-height:100lvh/.test(prod));

// ================= 载入 =================
const VW = 390, VH = 844;
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator,'userAgent',{get:function(){return 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36 EdgA/151.0.0.0';}});" });
// 种子：年龄确认 + 当日开屏已读 + 2160x4096 纯蓝壁纸（#cce6ff，与页面灰底色差明显）+ 栏位透明
const SEED_IMG = '<svg xmlns="http://www.w3.org/2000/svg" width="2160" height="4096"><rect width="2160" height="4096" fill="#cce6ff"/></svg>';
const seedDoc = (fit) => `(function(){try{
  var d=new Date(),p=function(n){return n<10?'0'+n:''+n;};
  localStorage.setItem('xy-home-v2:age-confirmed','1');
  localStorage.setItem('xy-home-v2:splash-seen:'+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()),'1');
  var u='data:image/svg+xml;base64,'+btoa(${JSON.stringify(SEED_IMG)});
  localStorage.setItem('xy-home-v2:default:cs-bg',u);
  localStorage.setItem('xy-home-v2:default:cs-bg-fit',${JSON.stringify(fit || 'fill')});
  localStorage.setItem('xy-home-v2:default:cs-bg-fullbars','1');
  localStorage.setItem('xy-home-v2:applock-qa-en','0');
}catch(e){}})();`;
const closeModals = async () => {
  for (let i = 0; i < 8; i++) {
    const open = await evalJs("(function(){var m=document.getElementById('modal-mask');return m&&!m.hidden;})()");
    if (!open) return;
    await evalJs("(function(){var b=document.getElementById('modal-cancel');if(b)b.click();return 1;})()");
    await sleep(200);
  }
};
const enterChat = async () => {
  for (let i = 0; i < 40; i++) {
    const st = String(await evalJs("(function(){var s=document.getElementById('splash');if(!s||s.classList.contains('hide'))return 'gone';var m=document.getElementById('splash-mandatory');if(m&&!m.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var e=document.getElementById('splash-mandatory-enter');return 'mand:'+(e?(e.classList.contains('is-disabled')?'wait':'ready'):'noel');}var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var c=document.getElementById('splash-age-check');if(c&&!c.checked){c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));}var e2=document.getElementById('splash-enter');return 'main:'+(!e2?'noel':(e2.hidden?'hidden':(e2.classList.contains('is-disabled')?'wait':'ready')));})()"));
    if (st === 'gone') break;
    if (st === 'main:ready') await evalJs("document.getElementById('splash-enter').click()");
    else if (st === 'mand:ready') await evalJs("document.getElementById('splash-mandatory-enter').click()");
    await sleep(300);
  }
  await closeModals();
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
  await sleep(1200);
  await closeModals();
};
const setFit = async (v) => {
  await evalJs(`(function(){try{localStorage.setItem('xy-home-v2:default:cs-bg-fit',${JSON.stringify(v)});}catch(e){}return 1;})()`);
  await evalJs("(function(){try{return window.applyChatSettings?1:0;}catch(e){return 0;}})()");
  await evalJs("(function(){try{window.applyChatSettings();}catch(e){}return 1;})()");
  await sleep(200);
};

await cdp('Page.addScriptToEvaluateOnNewDocument', { source: seedDoc('fill') });
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(2500);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await enterChat();

console.log('== B1~B7 铺满裁剪档几何行为 ==');
const b0 = await P();
ok('B1 图层在位且层叠正确（#cs-bg-layer 存在 / 首个子节点 / z-index:-1 / #page-chat 是层叠上下文）',
  !b0.err && b0.onLayer === true && b0.first === true && b0.z === '-1' && b0.pcPos === 'relative' && Number(b0.pcZ) > 0,
  b0.err || JSON.stringify({ onLayer: b0.onLayer, first: b0.first, z: b0.z, pcPos: b0.pcPos, pcZ: b0.pcZ }));
ok('B2 壁纸画在图层上、页面自身无内联背景', !b0.err && b0.onLayer === true && b0.pcInlineBg === '' && b0.disp === 'block' && b0.size === 'cover', b0.err || JSON.stringify({ onLayer: b0.onLayer, pcInlineBg: b0.pcInlineBg, disp: b0.disp, size: b0.size }));

const gapOf = (s) => s.pw >= s.bw - 1 && s.ph >= s.bh - 1;
ok('B3a 基线不露底（绘制尺寸 ≥ 页面盒）', gapOf(b0), JSON.stringify(b0).slice(0, 200));

// B4 键盘期：mobile-adapt 的真实做法＝给 .phone 写内联高（不改窗口 ⇒ lvh 恒定）
// 注意：mobile-adapt 的「残留自愈」会在数百毫秒内清掉手工内联高 ⇒ 必须钉完立刻取样，
// 盒没变矮就重钉再取（最多几次），而不是靠固定 sleep 赌时机。
const kbPin = () => evalJs("(function(){var ph=document.querySelector('.phone');ph.style.height=Math.round(innerHeight*0.55)+'px';window.dispatchEvent(new Event('resize'));if(window.visualViewport)window.visualViewport.dispatchEvent(new Event('resize'));return ph.style.height;})()");
const kbUnpin = async () => { await evalJs("(function(){var ph=document.querySelector('.phone');ph.style.height='';window.dispatchEvent(new Event('resize'));if(window.visualViewport)window.visualViewport.dispatchEvent(new Event('resize'));return 1;})()"); await sleep(700); };
const kbProbe = async (refBox) => {
  let s = null;
  for (let i = 0; i < 8; i++) {
    await kbPin();
    s = await P();
    if (s.bh < refBox - 40) return s;
    await sleep(25);
  }
  return s;
};
const kb = await kbProbe(b0.bh);
ok('B4a 键盘模拟真的生效了（页面盒变矮）', kb.bh < b0.bh - 40, 'box ' + b0.box + ' → ' + kb.box);
ok('B4b 键盘期图层高度不变（壁纸的盒与页面盒脱钩＝#762 的机制本体）', kb.lh === b0.lh, b0.layer + ' → ' + kb.layer);
ok('B4c 键盘期绘制尺寸逐字节不变（#750「打字时图变小」不得回流）', kb.size === b0.size && kb.painted === b0.painted, b0.size + '/' + b0.painted + ' → ' + kb.size + '/' + kb.painted);
ok('B4d 键盘期仍不露底', gapOf(kb), JSON.stringify({ box: kb.box, painted: kb.painted }));
await kbUnpin();
const un = await P();
ok('B4e 键盘收起后回到基线尺寸', un.size === b0.size && un.painted === b0.painted, b0.painted + ' → ' + un.painted);

// B5/B6 地址栏涨落：真机是 innerHeight 涨落（dvh 变），这里按同样方式改视口高
const grow = async (dh) => { await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH + dh, deviceScaleFactor: 1, mobile: true }); await sleep(700); };
await grow(56);
const up = await P();
ok('B5a 视口变高后不露底（盒变大也要盖住）', gapOf(up), JSON.stringify({ box: up.box, painted: up.painted, layer: up.layer }));
await grow(0);
const down = await P();
ok('B5b 视口回落后绘制尺寸回到基线（#751「莫名其妙放大」不得残留）', down.painted === b0.painted, b0.painted + ' → ' + down.painted);
for (let k = 0; k < 3; k++) { await grow(56); await grow(0); }
const jit = await P();
ok('B6 反复涨落三次后仍等于基线（不累积漂移）', jit.painted === b0.painted && gapOf(jit), b0.painted + ' → ' + jit.painted);

// B7 旋转＝真改宽，必须跟着重算
await cdp('Emulation.setDeviceMetricsOverride', { width: VH, height: VW, deviceScaleFactor: 1, mobile: true });
await sleep(900);
const rot = await P();
ok('B7 旋转后按新盒重算且不露底', gapOf(rot) && rot.bw > 500, JSON.stringify({ box: rot.box, painted: rot.painted }));
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: true });
await sleep(900);

console.log('== B8 四档语义 ==');
const modes = {};
for (const f of ['fill', 'contain', 'tile', 'stretch']) {
  await setFit(f);
  modes[f] = await P();
}
const mfill = modes.fill, mcont = modes.contain, mtile = modes.tile, mstr = modes.stretch;
ok('B8a 铺满裁剪＝cover 且盖满', mfill.size === 'cover' && gapOf(mfill), JSON.stringify({ size: mfill.size, painted: mfill.painted, box: mfill.box }));
ok('B8b 完整显示＝contain 且整图在层内（两边留边、不裁图）',
  mcont.size === 'contain' && mcont.pw <= mcont.lw + 1 && mcont.ph <= mcont.lh + 1 &&
  Math.abs(mcont.pw / mcont.ph - NAT_W / NAT_H) < 0.01, JSON.stringify({ size: mcont.size, painted: mcont.painted, layer: mcont.layer }));
ok('B8c 平铺＝repeat 且单块尺寸在层宽一半以内（真看得出在重复，不是「放大的一张图」）',
  mtile.repeat === 'repeat' && mtile.pw > 20 && mtile.pw <= mtile.lw * 0.5 &&
  Math.abs(mtile.pw / mtile.ph - NAT_W / NAT_H) < 0.02, JSON.stringify({ size: mtile.size, repeat: mtile.repeat, painted: mtile.painted, layer: mtile.layer }));
ok('B8d 拉伸填满＝铺满且比例被拉成层盒（100% 100%）',
  mstr.size === '100% 100%' && Math.abs(mstr.pw - mstr.lw) <= 2 && Math.abs(mstr.ph - mstr.lh) <= 2,
  JSON.stringify({ size: mstr.size, painted: mstr.painted, layer: mstr.layer }));
ok('B8e 四档计算值互不相同（改了确实有反应）', new Set([mfill.size, mcont.size, mtile.size, mstr.size]).size === 4,
  [mfill.size, mcont.size, mtile.size, mstr.size].join(' | '));

console.log('== B9 像素取证 ==');
await setFit('fill');
const boxNow = await P();
const pageTop = await evalJs("(function(){var r=document.getElementById('page-chat').getBoundingClientRect();return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height});})()");
const rect = JSON.parse(String(pageTop));
const pxTop = await shotPixel(Math.round(rect.x + rect.w / 2), Math.round(rect.y + 2));
const pxBot = await shotPixel(Math.round(rect.x + rect.w / 2), Math.round(rect.y + rect.h - 2));
const isWall = (p) => !!p && p.rgb[2] > 200 && p.rgb[2] - p.rgb[0] > 20; // #cce6ff：蓝明显高于红；灰白底色差极小
ok('B9a 栏位透明时页面顶边缘采到壁纸（真铺到边＋压在页面底色之上）', isWall(pxTop), JSON.stringify(pxTop && pxTop.rgb));
ok('B9b 栏位透明时页面底边缘采到壁纸', isWall(pxBot), JSON.stringify(pxBot && pxBot.rgb));
await evalJs("(function(){try{localStorage.setItem('xy-home-v2:default:cs-bg-fullbars','0');window.applyChatSettings();}catch(e){}return 1;})()");
await sleep(400);
const pxBar = await shotPixel(Math.round(rect.x + rect.w / 2), Math.round(rect.y + 2));
ok('B9c 栏位不透明时顶栏行采到栏位白底（壁纸不得盖住栏位）', !!pxBar && pxBar.rgb[0] > 235 && pxBar.rgb[2] > 235 && pxBar.rgb[2] - pxBar.rgb[0] < 12, JSON.stringify(pxBar && pxBar.rgb));
await evalJs("(function(){try{localStorage.setItem('xy-home-v2:default:cs-bg-fullbars','1');window.applyChatSettings();}catch(e){}return 1;})()");
await sleep(300);

console.log('== B12 老内核退化（100lvh 不被认识时 100vh 兜底必须顶住）==');
// 老内核（Chromium<87 / Safari<14.1）把不认识的属性整条丢弃、不报错 ⇒ 只留 min-height:100vh。
// 本组＝用户要求的「修一个机型不能把另一个机型弄坏」的硬断言。
await evalJs("(function(){window.__lvhBak=[];document.querySelectorAll('style').forEach(function(st,i){var t=st.textContent||'';if(t.indexOf('100lvh')>=0)window.__lvhBak.push([i,t]);});document.querySelectorAll('style').forEach(function(st){st.textContent=(st.textContent||'').replace(/min-height:100lvh/g,'');});return window.__lvhBak.length;})()");
const old = await kbProbe(b0.bh);
ok('B12a 老内核下键盘期图层仍不塌（100vh 兜底生效，盒仍按大视口算）',
  old.lh >= b0.lh - 1 && old.bh < b0.bh - 40, JSON.stringify({ layer: old.layer, base: b0.layer, box: old.box }));
ok('B12b 老内核下绘制尺寸与基线一致且不露底', old.size === b0.size && gapOf(old), b0.painted + ' → ' + old.painted);
await kbUnpin();
await evalJs("(function(){(window.__lvhBak||[]).forEach(function(p){var st=document.querySelectorAll('style')[+p[0]];if(st)st.textContent=p[1];});window.__lvhBak=[];return 1;})()");
await sleep(300);

console.log('== B10/B11 收尾 ==');
await evalJs("(function(){try{localStorage.removeItem('xy-home-v2:default:cs-bg');}catch(e){}try{window.applyChatSettings();}catch(e){}return 1;})()");
// #1258 改了这一项的口径：值读空的那一轮**不许**当场判「用户没设壁纸」（指针/大键索引任一还在、或尚未裁决
// 时先留层并踢一趟按需取回——真机上「退出重进背景图就没了」正是这一刀）。断言因此改成「结算后必须收起、
// 无残留」：库里确认没有（本夹具只写过 LS，IDB 里根本没有这一行 → absent）图层就得下来，不许变成永久留层。
let cc = { disp: 'block', img: 'pending', pcImg: '' };
for (let t = 0; t < 20; t++) {
  await sleep(300);
  cc = JSON.parse(String(await evalJs("(function(){var L=document.getElementById('cs-bg-layer'),pc=document.getElementById('page-chat');return JSON.stringify({disp:L?getComputedStyle(L).display:'none-el',img:L?(L.style.backgroundImage||''):'',pcImg:pc.style.backgroundImage||''});})()")));
  if (cc.disp !== 'block' && cc.img === '' && cc.pcImg === '') break;
}
ok('B10 清壁纸后图层收起、无残留（裁决结算后 ≤6s；#1258 允许读空当轮先留层，不许留成永久）', cc.disp !== 'block' && cc.img === '' && cc.pcImg === '', JSON.stringify(cc));
ok('B11 全程零 JS 异常', jsErrs.length === 0, jsErrs.slice(0, 3).join(' || '));

console.log('---- ' + (fail ? '❌' : '✅') + ' verify-chat-bg-fill: ' + pass + ' 通过 / ' + fail + ' 失败（基线盒 ' + b0.box + ' 绘制 ' + b0.painted + ' 层 ' + b0.layer + ' lvh ' + b0.lvh + '）----');
ch.kill(); server.close();
process.exit(fail ? 1 : 0);
