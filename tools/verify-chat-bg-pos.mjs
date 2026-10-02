// ===== 专项验证：聊天壁纸「打字时换一个比例」根治（#781）+ 位置/缩放滑杆（#782）+ 抽屉里换壁纸（#783）=====
// 需求（用户原话）：
//   「之前说这个图片上传比例有问题的问题，这问题也依旧没有修复」
//   「在我没有输入栏输入文字和在输入栏输入文字是两个比例」
//   「根本不是正常的背景图片比例，也不是正常的图片位置」（机型：全部手机；档位：完整显示）
// 根因两半（真 WebKit + Chromium 实测，见 probe 数据）：
//   ① #762 的键盘下限 `min-height:100lvh` 只挂在 .cs-bg-fill 上 ⇒「完整显示」档键盘期整图从
//      390x740 缩到 245x464（用户看到的就是这个）。
//   ② 下限本身指望视口单位是常量；iOS 装成 PWA（standalone，viewport meta 写死
//      resizes-content）与走 resizes-content 的内核会把布局视口整个压矮，
//      vh/lvh/dvh/svh 一起缩（视口 844→470 时四个单位全读到 470）⇒ 连铺满裁剪档也换比例。
//   改法：JS 记住「确实没有键盘时」的页面高写成 --cs-bg-h，CSS 取 max(视口单位, --cs-bg-h)，
//   四档一律；键盘期（.phone 有内联高 / 有文本框聚焦）不采样、且失焦后 700ms 余温内不回落，
//   其余时候跟随当前盒（否则就是 #751「莫名其妙放大」）。
// #783 需求（用户原话）：「边看边调里不能上传背景图片啊」
//   两半：①抽屉里只有档位/位置/缩放，换图入口留在聊天设置页（抽屉开着时那页是隐藏的）；
//   ②抽屉是 z-index:95 的固定层，而它点开的浮层全在它下面（openModal 90 / 图库面板 89）＝
//   即便有入口，弹层也藏在抽屉背后＝「点了没反应」。改法见 chat-settings.js 的 #783 注释。
// 用例组：
//   S 静态：#781 CSS 三条声明在位、产物已接入、#762 原规则未被改动（同特异性写在后面）、#783 接线
//   A 缺省零改动：三个新键没设时，四档的 background-size/position 与线上包逐字节同形
//   B 键盘不变性（三档 × 两种键盘模型）：绘制尺寸/图层高度逐字节不变（用户主诉本体）
//   C 真·窗口缩小（无聚焦）必须回落：#751「涨上去不回落」不得回流
//   D #782 抽屉滑杆：三条在位、当场写存储 + 计算值跟随、重进聊天仍在
//   E #782 设置页行 + 面板：注入位置、回显文案、重置删键回默认
//   G #783 抽屉里换壁纸：两个入口在位、上传走统一文件选择、图库面板浮到抽屉之上（让位）、
//     收起后层级回正、壁纸身份变化不必关开抽屉就重渲染
//   F 全程零 JS 异常
// 用法：
//   MOCHI_ROOT=<构建产物目录> node tools/verify-chat-bg-pos.mjs       # 默认用仓库根
//   node tools/verify-chat-bg-pos.mjs --red   # 抠掉本批四处接入（#781 CSS / #782 position /
//                                             #   #783 让位 / #783 重渲染），证明判别力（必须红）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || join(normalize(dirname(fileURLToPath(import.meta.url))), '..'));
const SRC = join(root, 'src');
const RED = process.argv.includes('--red');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const ADJ_CSS = '#page-chat.cs-bg-on > #cs-bg-layer { min-height:100vh; min-height:max(100vh, var(--cs-bg-h, 0px)); min-height:max(100lvh, var(--cs-bg-h, 0px)); }';
const ADJ_JS = "const psWanted = adj.x + '% ' + adj.y + '%';";
// #783 的两条逻辑锚点（src 与产物同形，各 1 处）：抽屉给浮层让位 / 壁纸身份变了重渲染分区
// #1120 把这条轮询泛化成「两个抽屉共用」（聊天美化 + 输入栏按钮位置）：回正值改从元素自身
// zIndex 读回（csBaseZ 是聊天美化抽屉专属值，直接复用会把 io 抽屉压到 1 层再也回不来）。
// 让位口径（最低浮层减一）没动，锚点跟着换成新那一行——仍是逻辑锚：去掉让位即断。
const YIELD_JS = "const want = low ? String(Math.max(1, low - 1)) : (d.dataset.csBaseZ || csDrawerBaseZ || '95');";
const RESIG_JS = "if (s !== csLastBgSig) { csLastBgSig = s; try { renderSec(csDrawerSec); } catch (e) {} }";
// 离开聊天页就地收起（G7 的靶心：短路它＝抽屉留在 body 上盖住目标页与底部导航）
const AUTOHIDE_JS = 'if (chat && chat.hidden) {';

const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (p.endsWith('\\') || p.endsWith('/')) p += 'index.html';
    try { statSync(p); } catch (e) { p = join(root, 'index.html'); }
    let body = readFileSync(p);
    if (p.endsWith('index.html') && RED) {
      let t = body.toString('utf8');
      const n1 = t.split(ADJ_CSS).length - 1;
      t = t.split(ADJ_CSS).join('#page-chat.cs-bg-on > #cs-bg-layer { min-height:100vh; min-height:100lvh; }');
      const n2 = t.includes(ADJ_JS) ? 1 : 0;
      t = t.replace(ADJ_JS, "const psWanted = 'center';");
      const n3 = t.includes(YIELD_JS) ? 1 : 0;
      t = t.replace(YIELD_JS, "const want = '';");
      const n4 = t.includes(RESIG_JS) ? 1 : 0;
      t = t.replace(RESIG_JS, "if (false) { csLastBgSig = s; try { renderSec(csDrawerSec); } catch (e) {} }");
      const n5 = t.includes(AUTOHIDE_JS) ? 1 : 0;
      t = t.replace(AUTOHIDE_JS, 'if (false) {');
      console.log('[RED] 已抠掉 CSS 接入 ' + n1 + ' 处 / JS 接入 ' + n2 + ' 处 / 抽屉让位 ' + n3 + ' 处 / 换图重渲染 ' + n4 + ' 处 / 离页收起 ' + n5 + ' 处');
      body = Buffer.from(t, 'utf8');
    }
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
if (!chromePath) { console.log('FATAL 找不到 Chrome/Edge'); server.close(); process.exit(1); }

const profDir = join(process.env.TEMP || '/tmp', 'mochi-bg-pos-' + Date.now());
const ch = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profDir,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });
let cdpPort = 0;
ch.stderr.on('data', (d) => { const m = String(d).match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) cdpPort = +m[1]; });
for (let i = 0; i < 80 && !cdpPort; i++) await sleep(150);
if (!cdpPort) { console.log('FATAL 无 CDP 端口'); ch.kill(); rmSync(profDir, { recursive: true, force: true }); server.close(); process.exit(1); }

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
if (!ws) { console.log('FATAL 无法连接 CDP'); ch.kill(); rmSync(profDir, { recursive: true, force: true }); server.close(); process.exit(1); }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') jsErrs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
};
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'ERR:' + String(r.exceptionDetails.exception?.description || '').slice(0, 200);
  return r && r.result ? r.result.value : null;
};
await cdp('Runtime.enable');
await cdp('Page.enable');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
};

// ================= S 组 静态实现 =================
console.log('== S 组 静态实现 ==');
const readSrc = (f) => { try { return readFileSync(join(SRC, f), 'utf8'); } catch (e) { return ''; } };
const cj = readSrc('js/chat-settings.js');
const cm = readSrc('css/chat-main.css');
// #860（PERF-PLAN 阶段 1b）：core 全外置后聊天美化 JS 在 js/personalize.js / js/chat.js——
// 产物判据改走全产物池（index.html + js/*.js），否则 S7/S10 假红。
const prod = (() => { try {
  let pool = readFileSync(join(root, 'index.html'), 'utf8');
  const jd = join(root, 'js');
  for (const f of readdirSync(jd)) if (f.endsWith('.js')) pool += `\n${readFileSync(join(jd,f),'utf8')}`;
  return pool;
} catch (e) { return ''; } })();
ok('S1 #781 CSS 三条声明分写且在 .cs-bg-on 上（删＝键盘期换比例回流）',
  (cm.match(/#page-chat\.cs-bg-on > #cs-bg-layer \{ min-height:100vh; min-height:max\(100vh, var\(--cs-bg-h, 0px\)\); min-height:max\(100lvh, var\(--cs-bg-h, 0px\)\); \}/g) || []).length === 2, String((cm.match(/cs-bg-on > #cs-bg-layer \{/g) || []).length));
ok('S2 #762 原下限规则原样在位（本批写在后面，不改动它＝哨兵 #762c/#762e 仍绿）',
  /#page-chat\.cs-bg-fill #cs-bg-layer \{ min-height:100vh; min-height:100lvh; \}/.test(cm));
ok('S3 .cs-bg-on 由 applySettings 挂/摘（有壁纸才挂，无壁纸不认领下限）',
  /classList\.toggle\('cs-bg-on', true\)/.test(cj) && /classList\.remove\('cs-bg-on'\)/.test(cj));
ok('S4 稳定盒采样器在位（三个跳过判据 + 余温期不回落 + 宽度换桶）',
  /function csBgStableSample\(\)/.test(cj) && /csBgKbWarm\(\)/.test(cj) && /csBgStable\.kbUntil/.test(cj) && /if \(w !== csBgStable\.w\)/.test(cj));
ok('S5 #782 三个键 + 单一写入点在位（默认值删键，不留噪音）',
  /CS_BG_ADJ_KEYS = \['cs-bg-pos-x', 'cs-bg-pos-y', 'cs-bg-size'\]/.test(cj) && /const setCsBgAdj = \(patch\)/.test(cj) && /store\.remove\('cs-bg-pos-x'\)/.test(cj));
ok('S6 #782 三键已进聊天美化导出/导入清单', /'cs-bg-pos-x', 'cs-bg-pos-y', 'cs-bg-size'/.test(cj.match(/const CHAT_BEAUTY_KEYS = \[[\s\S]*?\]/)?.[0] || ''));
ok('S7 产物已接入（CSS 与 JS 两处都在 index.html）', prod.includes(ADJ_CSS) && prod.includes(ADJ_JS), prod.length + ' 字节');
ok('S8 #783 抽屉层级让位在位（候选浮层清单 + 取最低者减一 + 关抽屉拆监听）',
  /CS_DRAWER_OVERLAYS = \['\.modal-mask'/.test(cj) && cj.includes(YIELD_JS) && /clearInterval\(csDrawerWatchTimer\); csDrawerWatchTimer = 0;/.test(cj));
ok('S9 #783 抽屉里有换壁纸的两个入口，且设置页与抽屉共用同一图库入口（不分叉出第二条上传链）',
  /try \{ csBgPickFiles\(\); \} catch/.test(cj) && /mkAct\('图库 · 换一张'/.test(cj)
  && /function csBgOpenGallery\(\)/.test(cj) && /try \{ csBgOpenGallery\(\); \} catch/.test(cj)
  && /csBg\.addEventListener\('click', csBgOpenGallery\)/.test(cj));
ok('S10 产物已接入 #783（让位与重渲染两条逻辑锚点各 1 处）',
  (prod.split(YIELD_JS).length - 1) === 1 && (prod.split(RESIG_JS).length - 1) === 1, prod.length + ' 字节');

// ================= 载入 =================
const VW = 390, VH = 844;
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator,'userAgent',{get:function(){return 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36 EdgA/151.0.0.0';}});" });
// 浮层清扫器（仅测试环境）：ta-ask 会按随机时钟弹「TA 询问」（#qa-mask），实测会把 A0 的命中点与
// B3 的输入框聚焦一起抢走（同一偶发红在 verify-chat-window-sync 也留过记录）。与壁纸链路无关，
// 每 300ms 压掉这几个浮层；modal-mask 不在内——它仍走下面的 closeModals()（点取消＝真实链路）。
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){var ids=['qa-mask','tc-mask','call-mask','applock-mask','img-view-mask'];var sweep=function(){for(var i=0;i<ids.length;i++){var e=document.getElementById(ids[i]);if(e&&!e.hidden)e.hidden=true;}};setInterval(sweep,300);document.addEventListener('DOMContentLoaded',sweep);})()" });
// 种子：2160x4096 竖幅（与 390x844 比例不同 ⇒ contain 必然两边留边，四档绘制尺寸互不相同）
const SEED_IMG = '<svg xmlns="http://www.w3.org/2000/svg" width="2160" height="4096"><rect width="2160" height="4096" fill="#cce6ff"/><rect width="2160" height="60" fill="#ff0000"/></svg>';
const seedDoc = (fit) => `(function(){try{
  var d=new Date(),p=function(n){return n<10?'0'+n:''+n;};
  localStorage.setItem('xy-home-v2:age-confirmed','1');
  localStorage.setItem('xy-home-v2:splash-seen:'+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()),'1');
  localStorage.setItem('xy-home-v2:applock-qa-en','0');
  localStorage.setItem('xy-home-v2:default:cs-bg','data:image/svg+xml;base64,'+btoa(${JSON.stringify(SEED_IMG)}));
  localStorage.setItem('xy-home-v2:default:cs-bg-fit',${JSON.stringify(fit || 'fill')});
  localStorage.setItem('xy-home-v2:default:cs-bg-fullbars','1');
}catch(e){}})();`;
const closeModals = async () => {
  for (let i = 0; i < 8; i++) {
    const open = await evalJs("(function(){var m=document.getElementById('modal-mask');return m&&!m.hidden;})()");
    if (!open) return;
    await evalJs("(function(){var b=document.getElementById('modal-cancel');if(b)b.click();return 1;})()");
    await sleep(200);
  }
};
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: seedDoc('contain') });
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(2500);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
const splashTrace = [];
for (let i = 0; i < 40; i++) {
  const st = String(await evalJs("(function(){var s=document.getElementById('splash');if(!s||s.classList.contains('hide'))return 'gone';var m=document.getElementById('splash-mandatory');if(m&&!m.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var e=document.getElementById('splash-mandatory-enter');return 'mand:'+(e?(e.classList.contains('is-disabled')?'wait':'ready'):'noel');}var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var c=document.getElementById('splash-age-check');if(c&&!c.checked){c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));}var e2=document.getElementById('splash-enter');return 'main:'+(e2&&e2.classList.contains('is-disabled')?'wait':'ready');})()"));
  splashTrace.push(st);
  if (st === 'gone') break;
  if (st === 'main:ready') await evalJs("document.getElementById('splash-enter').click()");
  else if (st === 'mand:ready') await evalJs("document.getElementById('splash-mandatory-enter').click()");
  await sleep(300);
}
console.log('  [boot] dataReady=' + await evalJs('!!window.__mochiDataReady') + ' splash 状态序列=' + [...new Set(splashTrace)].join(',') + '（共 ' + splashTrace.length + ' 次）');
await closeModals();
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(1500);
await closeModals();
const entryProbe = async () => JSON.parse(String(await evalJs(`(function(){var sp=document.getElementById('splash');var pc=document.getElementById('page-chat');
  return JSON.stringify({splash: sp?getComputedStyle(sp).display:'gone', vis: !!pc && !pc.hidden && pc.getBoundingClientRect().height>100,
    top: (function(){var r=pc.getBoundingClientRect();var e=document.elementFromPoint(r.x+r.width/2, r.bottom-30);return e?(e.id||e.className||e.tagName):'';})()});})()`)));
let entry = await entryProbe();
for (let i = 0; i < 6 && !(/chat-input/.test(entry.top)); i++) {
  await closeModals();
  await sleep(400);
  entry = await entryProbe();
}
ok('A0 前置：开屏已收起、聊天页可见且输入区没被浮层盖住（否则后面全是假红）',
  (entry.splash === 'none' || entry.splash === 'gone') && entry.vis === true && /chat-input/.test(entry.top), JSON.stringify(entry));

const probe = `(function(){
  var pc=document.getElementById('page-chat'), L=document.getElementById('cs-bg-layer');
  if(!pc||!L) return JSON.stringify({err:'no-layer'});
  var cs=getComputedStyle(L), lw=L.clientWidth, lh=L.clientHeight, size=cs.backgroundSize||'';
  var nw=2160, nh=4096, pw=NaN, ph=NaN;
  if(size==='cover'){var s=Math.max(lw/nw,lh/nh); pw=nw*s; ph=nh*s;}
  else if(size==='contain'){var s2=Math.min(lw/nw,lh/nh); pw=nw*s2; ph=nh*s2;}
  else if(/^([\\d.]+)% ([\\d.]+)%$/.test(size)){pw=+RegExp.$1/100*lw; ph=+RegExp.$2/100*lh;}
  else if(/^([\\d.]+)%$/.test(size)){pw=+RegExp.$1/100*lw; ph=pw*nh/nw;}
  var ae=document.activeElement;
  return JSON.stringify({
    box: lw? pc.clientWidth+'x'+pc.clientHeight : '', bw: pc.clientWidth, bh: pc.clientHeight,
    lw: lw, lh: lh, size: size, pos: cs.backgroundPosition, repeat: cs.backgroundRepeat,
    painted: isNaN(pw)?'NaN':(Math.round(pw)+'x'+Math.round(ph)), pw: pw, ph: ph,
    csBgH: pc.style.getPropertyValue('--cs-bg-h') || '',
    phoneH: (document.querySelector('.phone')||{style:{}}).style.height || '',
    focused: !!(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.isContentEditable)) && (ae.id||ae.tagName),
    store: ['cs-bg-pos-x','cs-bg-pos-y','cs-bg-size'].map(function(k){return localStorage.getItem('xy-home-v2:default:'+k);}).join('|')
  });
})()`;
const P = async () => JSON.parse(String(await evalJs(probe)));
const setFit = async (v) => {
  await evalJs(`(function(){try{localStorage.setItem('xy-home-v2:default:cs-bg-fit',${JSON.stringify(v)});window.applyChatSettings();}catch(e){}return 1;})()`);
  await sleep(450);
};
// 键盘模型一：iOS overlay——mobile-adapt 给 .phone 写内联高（窗口不动、视口单位不变）
const kbPin = () => evalJs("(function(){var ph=document.querySelector('.phone');ph.style.height=Math.round(innerHeight*0.55)+'px';window.dispatchEvent(new Event('resize'));if(window.visualViewport)window.visualViewport.dispatchEvent(new Event('resize'));return ph.style.height;})()");
const kbUnpin = async () => { await evalJs("(function(){var ph=document.querySelector('.phone');ph.style.height='';window.dispatchEvent(new Event('resize'));return 1;})()"); await sleep(800); };
// 键盘模型二：resizes-content——布局视口整个压矮，四个视口单位一起缩（真机＝iOS 装桌面 / 部分安卓）
const kbResize = async (h) => { await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: h, deviceScaleFactor: 1, mobile: true }); await sleep(800); };
const focusInput = () => evalJs("(function(){var i=document.getElementById('chat-input');if(i)i.focus();return document.activeElement&&document.activeElement.id||'';})()");
const blurInput = async () => { await evalJs("(function(){var i=document.getElementById('chat-input');if(i)i.blur();return 1;})()"); await sleep(900); };

// ================= A 组 缺省零改动（与线上包同形）=================
console.log('== A 组 三键缺省＝线上形态 ==');
const A_EXPECT = { fill: 'cover', contain: 'contain', stretch: '100% 100%', tile: '33.333%' };
const baseByFit = {};
for (const f of ['fill', 'contain', 'stretch', 'tile']) {
  await setFit(f);
  const s = await P();
  baseByFit[f] = s;
  ok('A/' + f + ' 缺省 background-size＝档位关键字、position 居中、无存储键',
    !s.err && s.size.indexOf(A_EXPECT[f]) === 0 && s.pos === '50% 50%' && s.store === '||', JSON.stringify({ size: s.size, pos: s.pos, store: s.store }));
}
const a2 = await evalJs(`(function(){
  var r=document.getElementById('cs-bg-adjust'), f=document.getElementById('cs-bg-fit');
  return { row: !!r, afterFit: !!(r&&f&&r.previousElementSibling===f),
    sub: r?(r.textContent||''):'', val:(document.getElementById('cs-bg-adjust-val')||{}).textContent||'' }; })()`);
ok('A5 设置页「壁纸位置与缩放」行注入在「壁纸铺满方式」之后', !!(a2 && a2.row && a2.afterFit), JSON.stringify(a2));
ok('A6 回显文案＝居中 · 默认（未调过时不显示数字）', !!(a2 && a2.val.indexOf('居中') >= 0), a2 && a2.val);

// ================= B 组 键盘不变性（用户主诉本体）=================
console.log('== B 组 打字时不得换比例（三档 × 两种键盘模型）==');
for (const f of ['fill', 'contain', 'stretch']) {
  await setFit(f);
  const b0 = await P();
  // B1 overlay 模型
  let s = null;
  for (let i = 0; i < 8; i++) { await kbPin(); s = await P(); if (s.bh < b0.bh - 40) break; await sleep(25); }
  ok('B1/' + f + ' 键盘（.phone 内联高）页面盒真的变矮了（前置）', !!s && s.bh < b0.bh - 40, b0.box + ' → ' + (s && s.box));
  ok('B2/' + f + ' 键盘（内联高）图层高与绘制尺寸逐字节不变', !!s && s.lh === b0.lh && s.size === b0.size && s.painted === b0.painted, b0.lw + 'x' + b0.lh + '/' + b0.painted + ' → ' + (s && (s.lw + 'x' + s.lh + '/' + s.painted)));
  await kbUnpin();
  // B2 resizes-content 模型（视口单位整体缩水）
  await focusInput();
  await kbResize(470);
  const k = await P();
  ok('B3/' + f + ' 键盘（布局视口缩 844→470）盒变矮且聚焦在输入框（前置）', k.bh < b0.bh - 90 && k.focused === 'chat-input', JSON.stringify({ box: k.box, focused: k.focused }));
  ok('B4/' + f + ' 键盘（视口缩）绘制尺寸不变＝「打字时两个比例」已根治', k.size === b0.size && k.painted === b0.painted, b0.size + '/' + b0.painted + ' → ' + k.size + '/' + k.painted);
  ok('B5/' + f + ' 键盘（视口缩）稳定盒仍在（--cs-bg-h 非 0 且 ≥ 基线盒高）', parseInt(k.csBgH, 10) >= b0.bh, '--cs-bg-h=' + k.csBgH + ' box=' + b0.box);
  await kbResize(VH);
  await blurInput();
  const r = await P();
  ok('B6/' + f + ' 收起键盘后回到基线尺寸', r.size === b0.size && r.painted === b0.painted, b0.painted + ' → ' + r.painted);
}

// ================= C 组 真·窗口缩小必须回落（#751 不回流）=================
console.log('== C 组 无键盘的真窗口变化必须跟随（不残留放大）==');
await setFit('contain');
const c0 = await P();
const grow = async (dh) => { await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH + dh, deviceScaleFactor: 1, mobile: true }); await sleep(750); };
await grow(56);
const up = await P();
ok('C1 视口长高后稳定盒跟着变（不留旧值）', up.csBgH === '900px' && up.lh >= c0.lh, c0.csBgH + '/' + c0.lh + ' → ' + up.csBgH + '/' + up.lh);
await grow(0);
const down = await P();
ok('C2 视口回落后绘制尺寸回到基线（#751「莫名其妙放大」不得残留）', down.painted === c0.painted && down.csBgH === c0.csBgH, c0.csBgH + '/' + c0.painted + ' → ' + down.csBgH + '/' + down.painted);
for (let i = 0; i < 3; i++) { await grow(56); await grow(0); }
const jit = await P();
ok('C3 反复涨落三次后仍等于基线（不累积漂移）', jit.csBgH === c0.csBgH && jit.painted === c0.painted, c0.csBgH + '/' + c0.painted + ' → ' + jit.csBgH + '/' + jit.painted);
await setFit('fill');
await grow(56);
const fUp = await P();
ok('C1b 铺满裁剪档长高后仍盖满（不露底＝下限的本职）', fUp.pw >= fUp.bw - 1 && fUp.ph >= fUp.bh - 1, JSON.stringify({ box: fUp.box, painted: fUp.painted }));
await grow(0);
await setFit('contain');
await cdp('Emulation.setDeviceMetricsOverride', { width: VH, height: VW, deviceScaleFactor: 1, mobile: true });
await sleep(900);
const rot = await P();
ok('C4 旋转（换宽）后整桶作废重记（稳定盒跟新盒高，不留竖屏大值）', rot.bw > 500 && rot.csBgH === rot.bh + 'px', JSON.stringify({ box: rot.box, csBgH: rot.csBgH }));
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: true });
await sleep(900);

// ================= D 组 抽屉「边看边调」三滑杆 =================
console.log('== D 组 边看边调抽屉的壁纸三滑杆 ==');
const SET_SLIDER = (label, val) => `(function(){ var d=document.getElementById('chat-beauty-drawer'); if(!d) return null;
  var rs=d.querySelectorAll('input[type=range]');
  for (var i=0;i<rs.length;i++){ var lb=rs[i].parentNode.querySelector('span');
    if(lb && lb.textContent===${JSON.stringify(label)}){ rs[i].value='${val}'; rs[i].dispatchEvent(new Event('input',{bubbles:true})); return rs[i].value; } }
  return null; })()`;
await evalJs("(function(){var b=document.getElementById('cs-live-adjust');if(b)b.click();return 1;})()");
await sleep(400);
await evalJs("(function(){var d=document.getElementById('chat-beauty-drawer');var c=d&&d.querySelector('button[data-sec=\"bar\"]');if(c)c.click();return 1;})()");
await sleep(300);
const d0 = await evalJs(`(function(){var d=document.getElementById('chat-beauty-drawer');if(!d)return '';
  return Array.prototype.map.call(d.querySelectorAll('input[type=range]'),function(r){var s=r.parentNode.querySelector('span');return s?s.textContent:'?';}).join('/');})()`);
ok('D1 「栏位」分区里有壁纸 水平/垂直/缩放 三条（有壁纸才出现）',
  /壁纸 水平位置/.test(String(d0)) && /壁纸 垂直位置/.test(String(d0)) && /壁纸 缩放/.test(String(d0)), d0);
const d1 = await evalJs(SET_SLIDER('壁纸 水平位置', 20));
await sleep(250);
let ds = await P();
ok('D2 拨水平=20 → 当场写 per-cid 存储 + background-position 第一段变 20%',
  d1 === '20' && ds.store.indexOf('20|') === 0 && ds.pos.indexOf('20%') === 0, JSON.stringify({ store: ds.store, pos: ds.pos }));
const d2 = await evalJs(SET_SLIDER('壁纸 垂直位置', 80));
await sleep(250);
ds = await P();
ok('D3 拨垂直=80 → position 第二段变 80%', d2 === '80' && / 80%$/.test(ds.pos), JSON.stringify({ pos: ds.pos }));
const d3 = await evalJs(SET_SLIDER('壁纸 缩放', 150));
await sleep(250);
ds = await P();
ok('D4 拨缩放=150 → background-size 接管为 150%（按层宽放大，高度按原比例）',
  d3 === '150' && /^150%/.test(ds.size) && ds.painted !== 'NaN' && Math.abs(ds.pw - 1.5 * ds.lw) < 2, JSON.stringify({ size: ds.size, painted: ds.painted }));
const d4 = await evalJs(SET_SLIDER('壁纸 缩放', 100));
await sleep(250);
ds = await P();
ok('D5 缩放拨回 100 → 删键交还给「铺满方式」（此处 contain）', d4 === '100' && ds.size === 'contain' && ds.store === '20|80|', JSON.stringify({ size: ds.size, store: ds.store }));
// 真·重进：整页刷新（走 store/idb 回读那条链路，不是内存里改一下）
const reopen = async () => {
  await cdp('Page.navigate', { url: base + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  for (let i = 0; i < 12; i++) {
    const st = String(await evalJs("(function(){var s=document.getElementById('splash');if(!s||s.classList.contains('hide'))return 'gone';var m=document.getElementById('splash-mandatory');if(m&&!m.hidden){var sc=document.getElementById('splash-mandatory-scroll');if(sc)sc.scrollTop=sc.scrollHeight;var b0=document.getElementById('splash-box');if(b0)b0.scrollTop=b0.scrollHeight;var e=document.getElementById('splash-mandatory-enter');return 'mand:'+(e?(e.classList.contains('is-disabled')?'wait':'ready'):'noel');}var b=document.getElementById('splash-box');if(b)b.scrollTop=b.scrollHeight;var c=document.getElementById('splash-age-check');if(c&&!c.checked){c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));}var e2=document.getElementById('splash-enter');return 'main:'+(e2&&e2.classList.contains('is-disabled')?'wait':'ready');})()"));
    if (st === 'gone') break;
    if (st === 'main:ready') await evalJs("document.getElementById('splash-enter').click()");
    else if (st === 'mand:ready') await evalJs("document.getElementById('splash-mandatory-enter').click()");
    await sleep(300);
  }
  await closeModals();
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
  await sleep(1400);
  await closeModals();
};
await reopen();
ds = await P();
ok('D6 整页刷新重进聊天后位置/缩放仍按存储读回（不是只活在内存里）',
  ds.pos === '20% 80%' && ds.size === 'contain' && ds.store === '20|80|', JSON.stringify({ pos: ds.pos, size: ds.size, store: ds.store }));

// ================= E 组 设置页面板与重置 =================
console.log('== E 组 设置页面板 ==');
await evalJs("(function(){var g=document.getElementById('chat-settings-btn');if(g)g.click();return 1;})()");
await sleep(400);
await evalJs("(function(){var t=document.querySelectorAll('#cs-tabs .them-tab');for(var i=0;i<t.length;i++){if(t[i].textContent.indexOf('美化')>=0){t[i].click();break;}}return 1;})()");
await sleep(300);
await evalJs("(function(){var r=document.getElementById('cs-bg-adjust');if(r)r.click();return 1;})()");
await sleep(300);
const e0 = await evalJs(`(function(){var m=document.getElementById('cs-bg-adj-panel');
  if(!m) return null; var rs=m.querySelectorAll('input[type=range]');
  return { disp: getComputedStyle(m).display, n: rs.length, vals: Array.prototype.map.call(rs,function(r){return r.value;}), labels: Array.prototype.map.call(m.querySelectorAll('div'),function(d){return d.textContent;}).join('|').indexOf('壁纸位置与缩放')>=0 };})()`);
ok('E1 点设置页那行 → 面板浮出（三条滑杆，值与存储同步）',
  !!(e0 && e0.disp === 'flex' && e0.n === 3 && e0.labels && e0.vals[0] === '20' && e0.vals[1] === '80'), JSON.stringify(e0));
ok('E2 面板浮在页面之上（fixed + z-index ≥ 80），点遮罩空白处即收起', !!(await evalJs(`(function(){var m=document.getElementById('cs-bg-adj-panel');var cs=getComputedStyle(m);var before=cs.display;m.click();return JSON.stringify({pos:cs.position,z:Number(cs.zIndex)>=80,after:getComputedStyle(m).display,before:before});})()`).then((r)=>{const o=JSON.parse(r);return o.pos==='fixed'&&o.z&&o.before==='flex'&&o.after==='none';})), await evalJs("(function(){var m=document.getElementById('cs-bg-adj-panel');return m?getComputedStyle(m).display:'gone';})()"));
await evalJs("(function(){var r=document.getElementById('cs-bg-adjust');if(r)r.click();return 1;})()");
await sleep(300);
await evalJs("(function(){var m=document.getElementById('cs-bg-adj-panel');var bs=m.querySelectorAll('button');for(var i=0;i<bs.length;i++){if(bs[i].textContent==='重置'){bs[i].click();return 1;}}return 0;})()");
await sleep(350);
const e2 = await P();
const e2v = await evalJs(`(document.getElementById('cs-bg-adjust-val')||{}).textContent||''`);
ok('E3 「重置」→ 三键删除、计算值回缺省、回显文案回「居中 · 默认」',
  e2.store === '||' && e2.pos === '50% 50%' && e2.size === 'contain' && /居中/.test(String(e2v)), JSON.stringify({ store: e2.store, pos: e2.pos, size: e2.size, val: e2v }));
const e3 = await evalJs(`(function(){var m=document.getElementById('cs-bg-adj-panel');return m?getComputedStyle(m).display:'gone';})()`);
ok('E4 重置后面板自动收起（不打断继续看）', e3 === 'none' || e3 === 'gone', e3);

// ================= G 组 #783 抽屉里就能换壁纸 =================
console.log('== G 组 抽屉里换壁纸（入口 / 层级让位 / 换图后重渲染）==');
// 图库里放一张（与当前壁纸同源），面板才有可点的缩略图
await evalJs(`(function(){try{var p='xy-home-v2:default:';var d=localStorage.getItem(p+'cs-bg')||'';
  localStorage.setItem(p+'cs-bg-glist',JSON.stringify(['gseed']));
  localStorage.setItem(p+'cs-bg-item-gseed',d);
  localStorage.setItem(p+'cs-bg-active-id','gseed');return 1;}catch(e){return 0;}})()`);
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return 1;})()");
await sleep(600);
await evalJs("(function(){var b=document.getElementById('cs-live-adjust');if(b)b.click();return 1;})()");
await sleep(500);
await evalJs("(function(){var d=document.getElementById('chat-beauty-drawer');var c=d&&d.querySelector('button[data-sec=\"bar\"]');if(c)c.click();return 1;})()");
await sleep(400);
const drawerBtnText = () => evalJs(`(function(){var d=document.getElementById('chat-beauty-drawer');if(!d)return JSON.stringify({t:'',up:null,gal:null});
  var out={t:'',up:null,gal:null};
  Array.prototype.forEach.call(d.querySelectorAll('button'),function(b){var tx=(b.textContent||'').trim();var r=b.getBoundingClientRect();
    if(/上传壁纸（可多选）/.test(tx))out.up=Math.round(r.width)+'x'+Math.round(r.height);
    if(/图库 · 换一张/.test(tx))out.gal=Math.round(r.width)+'x'+Math.round(r.height);
    out.t+=tx+'/';});
  return JSON.stringify(out);})()`);
const g1 = JSON.parse(String(await drawerBtnText()));
const boxOK = (s) => { const m = /^(\d+)x(\d+)$/.exec(String(s || '')); return !!(m && +m[1] >= 80 && +m[2] >= 24); };
ok('G1 抽屉「栏位」里有换壁纸的两个入口且都排得出尺寸（上传壁纸 + 图库 · 换一张）',
  /上传壁纸（可多选）/.test(g1.t) && /图库 · 换一张/.test(g1.t) && boxOK(g1.up) && boxOK(g1.gal), JSON.stringify({ up: g1.up, gal: g1.gal }));
// G2 上传入口：钩住 file input 的 click（不真弹系统选择器），验它走的是统一入口 mochiFilePick
await evalJs("(function(){window.__pickClicks=0;var o=HTMLInputElement.prototype.click;" +
  "HTMLInputElement.prototype.click=function(){if(this.type==='file'){window.__pickClicks++;return 1;}return o.apply(this,arguments);};return 1;})()");
await evalJs("(function(){var d=document.getElementById('chat-beauty-drawer');var bs=d.querySelectorAll('button');" +
  "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('上传壁纸')>=0){bs[i].click();return 1;}}return 0;})()");
await sleep(800);
const g2 = JSON.parse(String(await evalJs(`(function(){var i=document.getElementById('dev-cs-bg-pick');
  return JSON.stringify({clicks:window.__pickClicks||0,has:!!i,accept:i?i.accept:'',multi:i?!!i.multiple:false,attached:!!(i&&i.parentNode)});})()`)));
ok('G2 点「上传壁纸」→ 走统一文件选择入口（常驻 input 在位、accept=image/* 且多选、click 已派发）',
  g2.has && g2.clicks >= 1 && g2.accept === 'image/*' && g2.multi && g2.attached, JSON.stringify(g2));
// G3 图库面板：抽屉必须让位，否则面板藏在抽屉背后＝用户看到的「点了没反应」（#783 本体）
await evalJs("(function(){var d=document.getElementById('chat-beauty-drawer');var bs=d.querySelectorAll('button');" +
  "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('图库 · 换一张')>=0){bs[i].click();return 1;}}return 0;})()");
await sleep(800);
const g3 = JSON.parse(String(await evalJs(`(function(){var m=document.getElementById('cs-bg-panel'),d=document.getElementById('chat-beauty-drawer');
  if(!m||!d) return JSON.stringify({err:'no-panel'});
  var box=m.firstElementChild, r=box?box.getBoundingClientRect():null, hit='';
  if(r){var e=document.elementFromPoint(r.left+r.width/2, r.top+14); hit=e?(m.contains(e)?'panel':((e.id||e.className||e.tagName)+'')) :'';}
  return JSON.stringify({disp:getComputedStyle(m).display,mz:+getComputedStyle(m).zIndex,dz:+getComputedStyle(d).zIndex,hit:hit,thumb:m.querySelectorAll('img').length});})()`)));
ok('G3 点「图库」→ 面板浮出且抽屉让位（面板层级压过抽屉、面板头部命中得到＝点在图上而不是隔着一层）',
  g3.disp === 'flex' && g3.mz > g3.dz && g3.hit === 'panel' && g3.thumb >= 1, JSON.stringify(g3));
await evalJs("(function(){var m=document.getElementById('cs-bg-panel');var bs=m.querySelectorAll('button');" +
  "for(var i=0;i<bs.length;i++){if(bs[i].textContent==='关闭'){bs[i].click();return 1;}}m.style.display='none';return 0;})()");
await sleep(800);
const g4 = await evalJs("(function(){return getComputedStyle(document.getElementById('chat-beauty-drawer')).zIndex;})()");
ok('G4 面板收起后抽屉层级回正（临时压低只是让位，不是永久改 CSS 95）', Number(g4) === 95, g4);
// G5/G6 换壁纸后不必关开抽屉：抽屉里的三条壁纸滑杆随壁纸身份出现/收起
const wSliders = () => evalJs(`(function(){var d=document.getElementById('chat-beauty-drawer');if(!d)return JSON.stringify({n:-1,txt:''});
  var rs=d.querySelectorAll('input[type=range]'),n=0;
  for(var i=0;i<rs.length;i++){var s=rs[i].parentNode.querySelector('span');if(s&&/^壁纸 /.test(s.textContent))n++;}
  return JSON.stringify({n:n,txt:d.textContent||''});})()`);
await evalJs("(function(){localStorage.removeItem('xy-home-v2:default:cs-bg');return 1;})()");
await sleep(900);
const g5 = JSON.parse(String(await wSliders()));
ok('G5 抽屉开着时壁纸没了 → 提示改成「还没设置壁纸」，三条壁纸滑杆当场收起',
  g5.n === 0 && /还没设置壁纸/.test(g5.txt), JSON.stringify(g5));
await evalJs("(function(){var p='xy-home-v2:default:';localStorage.setItem(p+'cs-bg',localStorage.getItem(p+'cs-bg-item-gseed'));return 1;})()");
await sleep(900);
const g6 = JSON.parse(String(await wSliders()));
ok('G6 抽屉里刚上传/刚换壁纸 → 不必关开抽屉，三条壁纸滑杆当场出现', g6.n === 3 && !/还没设置壁纸/.test(g6.txt), JSON.stringify(g6));
// G7 离开聊天页：抽屉是挂在 body 上的固定层（z 95 / bottom 0），不收就把目标页连同底部导航一起盖住
const drawerBox = () => evalJs(`(function(){var d=document.getElementById('chat-beauty-drawer');if(!d)return JSON.stringify({disp:null});
  var r=d.getBoundingClientRect();var pg=document.querySelector('.page:not([hidden])');
  return JSON.stringify({disp:getComputedStyle(d).display,z:+getComputedStyle(d).zIndex,page:pg?pg.id:'',h:Math.round(r.height)});})()`);
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"calendar\"]');if(a)a.click();return !!a;})()");
await sleep(1200);
const g7 = JSON.parse(String(await drawerBox()));
ok('G7 离开聊天页 → 抽屉就地收起（不再占屏盖住目标页与底部导航），且不把人拽回聊天设置页',
  g7.disp === 'none' && g7.page === 'page-calendar' && g7.h === 0, JSON.stringify(g7));
// G8 就地收起之后抽屉还能正常再开（收起没把状态/定时器弄坏）
await evalJs("(function(){var b=document.getElementById('cs-live-adjust');if(b)b.click();return !!b;})()");
await sleep(1200);
const g8 = JSON.parse(String(await drawerBox()));
ok('G8 收起后再点入口仍能打开（回到聊天页 + 抽屉复现 + 层级回到基准）',
  g8.disp === 'flex' && g8.page === 'page-chat' && g8.z === 95, JSON.stringify(g8));
await evalJs("(function(){var d=document.getElementById('chat-beauty-drawer');var x=d.querySelector('.cs-drawer-close')||d.querySelector('button[title]');if(x)x.click();return 1;})()");
await sleep(300);

console.log('== F 运行期健康 ==');
ok('F1 全程零 JS 异常', jsErrs.length === 0, jsErrs.slice(0, 3).join(' | '));

console.log('\n' + (RED ? '[RED 基线] ' : '') + (fail ? '---- ❌ verify-chat-bg-pos: ' : '---- ✅ verify-chat-bg-pos: ') + pass + ' 通过 / ' + fail + ' 失败');
try { ch.kill(); } catch (e) {}
try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
