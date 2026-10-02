// ===== 常驻回归：#1375「切后台再回来壁纸空白、点一下标签页才恢复」＝常驻合成壁纸层的绘制没人重新要求过 =====
// 病灶（无头真跑 HEAD 产物量的，见 tools/diag-1375-wp-paint-arm.mjs 读数）：
//   手机端壁纸只由 #phone-bg-layer／#cs-bg-layer 这一层画（applyBodyBg 在非宽屏形态不往 body 写图），而这两层
//   各自被 CSS 常驻提成独立合成层（home.css:51 #765d、chat-main.css:618 #765a 的 transform:translateZ(0)）。
//   系统挂起页面会作废合成层纹理，回前台只重栅格「脏了」的东西；#1270/#1300 把「数据」那一半修好了（读空不拆层
//   ＋按需取回），可那套重铺和所有别的重铺一样全是「值变才写」⇒ 实测整段回前台窗口里这一层的 style 被写过 0 次
//  （内联图 307,229 字符一字未动、opacity 恒 1），而用户的恢复动作恰好写 2 次（opacity 0→1）。
// 修法：回前台那一发把这一层的常驻提升临时收回（写 transform:none），下一帧再交还给 CSS——合成层销毁重建＝纹理
//   必然按当前 DOM 重新生成；两次写入跨帧（同帧写两次会被并成「没变化」）；全程不重赋 backgroundImage（#147/#1295
//   明令不许把整幅解码加回回场这一帧）。判据只有「刚从后台回来／这一屏此刻在屏上／这一层此刻挂着背景载荷」
//   三个当场事实，零机型、零 UA 分支。
// 断言（判别力＝纯 HEAD 副本必红标 (R) 的那些；其余两侧同绿＝对照组，证邻居一件没被改坏）：
//   S 组＝逻辑锚（产物＋src 双查）：transform 收回 (R)、交还 CSS (R)、跨帧兜底 (R)、证人闸 (R)、双通道接线 (R)、
//         回前台只重铺一轮的在途去重 (R)；邻居锚：#1270 的 applyBgVisibility 双通道、#1300 的证人闸、#765d/#765a
//         两条常驻提升规则；零机型自检＝从产物里切出本批那段函数，体内不许出现 UA／机型字样。
//   B 组＝真浏览器（428×926 DPR3，真实覆写 document.hidden／visibilityState 让 #1195e 释放与回场裁决都落地）：
//     B0 夹具真（壁纸画上、内联挂图、opacity 1、计算 transform≠none）
//     B1 切后台真放掉大键内存副本（#1195e 语义没被动）
//     B2 后台期不动手（hidden 那一段里两层写入均为 0）
//     B3 (R) 回前台什么都不点，桌面壁纸层被写过 ≥1 次＝本批契约本体（红侧实测 0）
//     B4 (R) 那一次改的是 transform，且 backgroundImage 一次都没被重赋（没把整幅解码加回回场帧）
//     B5 (R) 双通道连发只重铺一轮（写入 ≤2＝一轮 none＋一次交还）
//     B6 稳态成本没被削：重铺后计算 transform 回到 matrix（#765d 常驻语义原样）
//     B7 #1270 那半没被动：回前台后大键自己读回来
//     B8 (R) 停在聊天页回前台，聊天壁纸层也被重铺（同一条闸覆盖两层；红侧 0）
//     B9 证人闸：没设壁纸的设备回前台一个字节都不写
//     B10 停在桌面时不去动聊天那一屏的层
//     B11 用户旧恢复路径一字未动：点进聊天再退出仍写 opacity
//     Z1  全程零未捕获异常
// 用法：node tools/verify-1375-held-bg-paint-arm.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
//       MOCHI_CDP_PORT=<端口> 每支电池给不同端口（固定端口撞车＝整支静默挂死）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chromePath = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9975 + Math.floor(Math.random() * 30));
const profile = join(process.env.TEMP || tmpdir(), 'mochi-1375-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let pass = 0, fail = 0, skip = 0;
function check(name, ok, detail) {
  if (ok === 'skip') { skip++; console.log('  SKIP ' + name + (detail !== undefined ? '  ← ' + JSON.stringify(detail) : '')); return; }
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  ← 读数 ' + JSON.stringify(detail) : '')); }
}

function mkClient(wsUrl) {
  const c = { pend: new Map(), id: 0, errors: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl); c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String(m.params.exceptionDetails.text || '').slice(0, 160)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  c.cdp = (method, params = {}) => { const id = ++c.id; return new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }); };
  c.evalJs = async (expr) => {
    try {
      const r = await Promise.race([
        c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
        new Promise((res) => setTimeout(() => res({ __tmo: 1 }), 15000)),
      ]);
      if (r && r.__tmo) { console.error('  [eval timeout] ' + expr.slice(0, 70)); return null; }
      if (r && r.exceptionDetails) { console.error('  [eval err]', String((r.exceptionDetails.exception || {}).description || '').slice(0, 200)); return null; }
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  return c;
}

// ---------- 静态锚 ----------
const persSrc = readFileSync(join(root, 'js/personalize.js'), 'utf8');
const persIn = readFileSync(join(root, 'src/js/personalize.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const both = (needle) => persSrc.indexOf(needle) >= 0 && persIn.indexOf(needle) >= 0;

console.log('\n===== verify-1375-held-bg-paint-arm｜被测根目录 = ' + root + ' =====');
console.log('S 组（逻辑锚，产物＋src 双查）:');
check('S1 回前台把常驻提升收回那一发本体（样式写入＝让引擎重新要求这一层的绘制）', both("l.style.transform = 'none';"));
check('S2 另一半：下一帧把提升交还给 CSS（缺它＝#765d/#765a 常驻语义被整段削掉）', both("l.style.transform = '';"));
check('S3 跨帧兜底（rAF 迟到时 setTimeout 仍把提升送回去；同帧两次写入会被并成「没变化」）', both('setTimeout(back, 120);'));
check('S4 证人闸：这一屏真在屏上＋这一层真挂着背景载荷才动手', both('if (!l || !pg || pg.hidden || !l.style.backgroundImage) continue;'));
check('S4b 证人闸另一半：这一层此刻真被画在屏上（#1270 读空不拆层＝旧纹理会留在 opacity 0 的隐藏层上，只看「挂着图」会给根本不是画布的那层白重建一次）', both("if (l.style.opacity === '0' || l.style.display === 'none') continue;"));
check('S5 回前台双通道接线（#1270 同款＝部分内核只发 focus/pageshow）', both("document.addEventListener('mochi-fg-resume', armHeldBgPaint);"));
check('S6 一轮只重铺一次的在途去重', both('if (heldBgArmed[lid]) continue;'));
check('S7 邻居锚：#1270 那条「读空不拆层＋按需取回」的通道一字未动', both("document.addEventListener('mochi-fg-resume', applyBgVisibility);"));
check('S8 邻居锚：#1300 桌面背景证人闸仍在', both('if (!el || !el.style.backgroundImage) return false;'));
check('S9 邻居锚：#765d 桌面壁纸常驻提升规则仍在（产物）', html.indexOf('#phone-bg-layer{transform:translateZ(0)}') >= 0 || html.indexOf('#phone-bg-layer { transform:translateZ(0); }') >= 0,
  html.indexOf('phone-bg-layer') >= 0 ? '产物内联形态未匹配' : '无 phone-bg-layer');
check('S10 邻居锚：#765a 聊天壁纸常驻提升规则仍在（产物）', html.indexOf('#cs-bg-layer{transform:translateZ(0)}') >= 0 || html.indexOf('#cs-bg-layer { transform:translateZ(0); }') >= 0);
// 零机型自检：把本批那段函数从产物里切出来，体内不许出现任何机型／UA 字样
(function s11() {
  const i = persSrc.indexOf('function armHeldBgPaint');
  if (i < 0) { check('S11 零机型自检（本批那段函数体内无 UA／机型分支）', 'skip', '函数未在场＝红侧'); return; }
  const body = persSrc.slice(i, i + 1400);
  const bad = /userAgent|isIOS|iPhone|iPad|Android|navigator\.platform|MicroMessenger|uaMatch/i.exec(body);
  check('S11 零机型自检（本批那段函数体内无 UA／机型分支）', !bad, bad ? bad[0] : undefined);
})();

// ---------- 运行时夹具 ----------
const HIDE = `(function(){
  try {
    window.__1375fix = { d: Object.getOwnPropertyDescriptor(Document.prototype,'hidden'), v: Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState') };
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'hidden';}});
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { return String(e && e.message || e); }
  return document.body.classList.contains('mochi-bg-pause') ? 'pause-on' : 'pause-missing';
})()`;
const SHOW = `(function(){
  try {
    if (window.__1375fix && window.__1375fix.d) Object.defineProperty(document,'hidden',window.__1375fix.d);
    if (window.__1375fix && window.__1375fix.v) Object.defineProperty(document,'visibilityState',window.__1375fix.v);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('mochi-fg-resume'));
  } catch (e) { return String(e && e.message || e); }
  return 'shown';
})()`;
// 现场＋「自上次归零以来这一层的 style 被写过几次、改过哪些属性、backgroundImage 有没有被重赋」
const WIT = `(function(){
  window.__1375w = window.__1375w || {};
  function props(s){ var m={}; String(s||'').split(';').forEach(function(kv){ var i=kv.indexOf(':'); if(i>0) m[kv.slice(0,i).trim()]=kv.slice(i+1).trim(); }); return m; }
  ['phone-bg-layer','cs-bg-layer'].forEach(function(id){
    var l=document.getElementById(id); if(!l) return;
    if (!window.__1375w[id]) {
      var w = window.__1375w[id] = { n:0, changed:{}, bgRewrites:0, opWrites:0 };
      try { new MutationObserver(function(mo){ mo.forEach(function(m){
        w.n++;
        var a=props(m.oldValue), b=props(l.getAttribute('style'));
        Object.keys(a).concat(Object.keys(b)).forEach(function(k){ if (a[k]!==b[k]) { w.changed[k]=(w.changed[k]||0)+1; if(k==='backgroundImage') w.bgRewrites++; if(k==='opacity') w.opWrites++; } });
      }); }).observe(l,{attributes:true,attributeFilter:['style'],attributeOldValue:true}); } catch (e) { w.err = String(e && e.message || e); }
    }
  });
  function one(id){ var l=document.getElementById(id); if(!l) return { absent:1 };
    var w=window.__1375w[id]||{n:0,changed:{},bgRewrites:0,opWrites:0}; var cs=getComputedStyle(l);
    return { n:w.n, changed:w.changed, bgRewrites:w.bgRewrites, opWrites:w.opWrites,
      inlUrl:String(l.style.backgroundImage).indexOf('url(')>=0, inlBgLen:String(l.style.backgroundImage).length,
      opacityInl:String(l.style.opacity), transformInl:String(l.style.transform), transformCalc:cs.transform }; }
  var st=window.activeStore?window.activeStore():null, mem={phone:0,cs:0};
  try { mem.phone=(st.get('phone-bg')||'').length; mem.cs=(st.get('cs-bg')||'').length; } catch(e){}
  var pg1=document.getElementById('page-phone'), pg2=document.getElementById('page-chat');
  return JSON.stringify({ desk:one('phone-bg-layer'), chat:one('cs-bg-layer'), mem:mem,
    deskShown:!!pg1&&!pg1.hidden, chatShown:!!pg2&&!pg2.hidden });
})()`;
const ZERO = "(function(){ var w=window.__1375w||{}; Object.keys(w).forEach(function(k){ w[k].n=0; w[k].changed={}; w[k].bgRewrites=0; w[k].opWrites=0; }); return 1; })()";
const GO_HOME = "(function(){var t=document.querySelector('.tab[data-page=\"page-phone\"]');if(t)t.click();return !!t;})()";
const GO_CHAT = "(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()";
// 大键壁纸（>256KB＝#1195e 放得掉；>200KB＝LS 那份本就被剥掉；<6MB＝渲染防护允许画）
const BG1 = 'data:image/png;base64,' + 'A'.repeat(300 * 1024);
const BG2 = 'data:image/png;base64,' + 'B'.repeat(300 * 1024);
const SEED = `(function(){ try { var st=window.activeStore();
  st.set('phone-bg', ${JSON.stringify(BG1)}); st.set('phone-bg-glist', JSON.stringify(['g1375']));
  st.set('phone-bg-active-id','g1375'); st.set('phone-bg-item-g1375', ${JSON.stringify(BG1)});
  st.set('cs-bg', ${JSON.stringify(BG2)}); st.set('cs-bg-glist', JSON.stringify(['c1375']));
  st.set('cs-bg-active-id','c1375'); st.set('cs-bg-item-c1375', ${JSON.stringify(BG2)});
  return [(st.get('phone-bg')||'').length,(st.get('cs-bg')||'').length]; } catch(e){ return 'ERR:'+e.message; } })()`;
const UNSEED = "(function(){ try { var st=window.activeStore(); ['phone-bg','phone-bg-glist','phone-bg-active-id','phone-bg-item-g1375'].forEach(function(k){ st.remove(k); }); return 1; } catch(e){ return 'ERR:'+e.message; } })()";
const W = (s) => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };

let C = null;
try {
  let targets = [];
  for (let i = 0; i < 80; i++) { try { targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); if (targets.length) break; } catch (e) {} await sleep(200); }
  C = mkClient(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await C.connect();
  await C.cdp('Page.enable'); await C.cdp('Runtime.enable');
  await C.cdp('Emulation.setDeviceMetricsOverride', { width: 428, height: 926, deviceScaleFactor: 3, mobile: true });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await C.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await C.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(700);
  await C.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));st.set('cs-rp-auto-prob','0');}catch(e){}return true;})()");

  console.log('\nB 组（无头真跑产物：真实前后台翻转＋壁纸图层样式写入流水）:');
  await C.evalJs(GO_HOME); await sleep(400);
  const seeded = await C.evalJs(SEED);
  // 桌面壁纸走两侧都存在的既有通路画上（contact-switched → #695 whenDeskVisible）
  await C.evalJs("(function(){document.dispatchEvent(new Event('contact-switched'));return 1;})()"); await sleep(1600);
  await C.evalJs(GO_CHAT); await sleep(1200);   // 聊天壁纸由 applySettings 画上（#716 观察器盯 chatPage.hidden）
  await C.evalJs(GO_HOME); await sleep(900);
  const pre = W(await C.evalJs(WIT));
  check('B0 夹具真：桌面壁纸已画上（内联挂图＋opacity 1＋计算 transform≠none＝它就是这一屏的常驻合成壁纸层）',
    pre.desk && pre.desk.inlUrl && pre.desk.opacityInl === '1' && String(pre.desk.transformCalc).indexOf('matrix') === 0,
    pre.desk);
  check('B0b 夹具真：聊天壁纸那一层也已画上（内联挂着同一张图）',
    pre.chat && pre.chat.inlUrl && pre.chat.inlBgLen > 100000, pre.chat);

  await C.evalJs(ZERO);
  const hide = await C.evalJs(HIDE); await sleep(900);
  const mid = W(await C.evalJs(WIT));
  check('B1 切后台真放掉大键内存副本（#1195e 语义没被动＝壁纸大键在回场前读空）', hide === 'pause-on' && mid.mem && mid.mem.phone === 0, { hide: hide, mem: mid.mem });
  check('B2 后台期不动手：hidden 那一段里两层写入均为 0（本批不许把成本压进后台）',
    (mid.desk.n || 0) === 0 && (mid.chat.absent ? true : (mid.chat.n || 0) === 0), { desk: mid.desk.n, chat: mid.chat.n });

  await C.evalJs(ZERO);
  await C.evalJs(SHOW); await sleep(2600);
  const fg = W(await C.evalJs(WIT));
  check('B3 (R 本批契约) 回前台什么都不点，桌面壁纸层被重新要求过绘制（红侧实测写 0 次＝纹理没人管）',
    (fg.desk.n || 0) >= 1, fg.desk);
  check('B4 (R 本批契约) 那一次改的是 transform，且 backgroundImage 一次都没被重赋（没把 #147 的整幅解码加回回场帧）',
    (fg.desk.changed || {}).transform >= 1 && fg.desk.bgRewrites === 0 && fg.desk.inlBgLen === pre.desk.inlBgLen,
    { changed: fg.desk.changed, bgRewrites: fg.desk.bgRewrites, len: [pre.desk.inlBgLen, fg.desk.inlBgLen] });
  check('B5 (R 本批契约) 双通道连发只重铺一轮（visibilitychange＋mochi-fg-resume 合计 ≤2 次写入＝一次收回＋一次交还）',
    (fg.desk.n || 0) >= 1 && fg.desk.n <= 2, fg.desk.n);
  check('B6 稳态成本没被削：重铺之后计算 transform 又回到 matrix（#765d 常驻语义原样回来）',
    String(fg.desk.transformCalc).indexOf('matrix') === 0, fg.desk.transformCalc);
  check('B7 #1270 那半没被动：回前台后壁纸大键自己读回来（内存副本恢复＝数据层仍会重铺）', (fg.mem || {}).phone > 100000, fg.mem);

  // 停在聊天页回前台＝聊天壁纸那一层
  await C.evalJs(GO_CHAT); await sleep(900);
  await C.evalJs(ZERO);
  await C.evalJs(HIDE); await sleep(800);
  await C.evalJs(SHOW); await sleep(2600);
  const fg2 = W(await C.evalJs(WIT));
  check('B8 (R 本批契约) 停在聊天页回前台，聊天壁纸层同样被重铺（一条闸覆盖两层＝不逐入口补）',
    fg2.chatShown && (fg2.chat.n || 0) >= 1 && fg2.chat.bgRewrites === 0, { chat: fg2.chat, shown: fg2.chatShown });
  check('B10 停在聊天页时不去动桌面那一屏的层（证人闸按屏裁，零浪费）', (fg2.desk.n || 0) === 0, fg2.desk.n);

  // 用户旧恢复路径：点进聊天再退出仍该写 opacity（#147 显隐语义一字未动）
  await C.evalJs(GO_HOME); await sleep(700);
  await C.evalJs(ZERO);
  await C.evalJs(GO_CHAT); await sleep(700);
  await C.evalJs(GO_HOME); await sleep(900);
  const rt = W(await C.evalJs(WIT));
  check('B11 旧恢复路径没被动：点进聊天再退出对桌面层仍写 opacity（＝用户说的那一下，语义原样）',
    (rt.desk.changed || {}).opacity >= 1, rt.desk.changed);

  // 没设壁纸的设备：一个字节都不该写
  await C.evalJs(UNSEED); await sleep(600);
  await C.evalJs("(function(){document.dispatchEvent(new Event('contact-switched'));return 1;})()"); await sleep(1200);
  await C.evalJs(ZERO);
  await C.evalJs(HIDE); await sleep(700);
  await C.evalJs(SHOW); await sleep(1600);
  const bare = W(await C.evalJs(WIT));
  check('B9b 夹具诚实：撤掉壁纸键后 #1270 的「读空不拆层」照旧把旧纹理留在这一层上（内联还挂着图、但 opacity=0＝这一层此刻根本不是画布）',
    bare.desk && bare.desk.inlUrl === true && bare.desk.opacityInl === '0', bare.desk);
  check('B9 证人闸：这一层此刻不是壁纸的画布时，回前台一个字节都不写（不给没设壁纸／正被藏着的设备白重建一次合成层）',
    (bare.desk.absent ? true : (bare.desk.n || 0) === 0) && (bare.chat.absent ? true : (bare.chat.n || 0) === 0), bare.desk);

  check('Z1 全程零未捕获 JS 异常', C.errors.length === 0, C.errors.slice(0, 3));
} catch (e) {
  console.error('脚本崩溃（无读数＝不算绿）:', e && e.stack || e);
  fail++;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
console.log('\n===== verify-1375-held-bg-paint-arm 结果：' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过 =====');
process.exit(fail ? 1 : 0);
