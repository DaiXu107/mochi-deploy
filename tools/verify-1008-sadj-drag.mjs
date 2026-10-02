// ===== 常驻回归：#1008 边看边调三处抽屉「拖标题行上移」补齐 ＋ 写清 ＋ 切页落位不再瞬移
// 用户直派（2026-09-21）三句原话：
//   ①「桌面美化的边看边调功能。不能托标题行可上移移动功能位置。需要新增并写清楚。」
//   ②「聊天设置的边看边调功能。托标题行可上移移动功能位置，也需要写清楚，用户并不知道有这个功能。」
//   ③「边看边调功能里切换设置和设置美化，页面还是会闪屏，还能怎么优化动画？」
// 根因（无头 390×844 实测，零机型分支）：
//   · 桌面抽屉：#562 当年只留下 `let beautyDockTop = null;` 这个声明、拖动实现从未落地——grip 一直是
//     纯装饰的误导 affordance（聊天侧 #760 的注释里已记过这笔），用户按标题行拖不动；群聊抽屉更彻底，
//     连声明都没有（同族只改了单聊一半）。且默认位 bottom:0 ⇒ z-index:95 的抽屉压住 z-index:2 的
//     底部导航，开着它根本切不了页（实测 drawerRect.bottom=844、tabbar.top=762）。
//   · 「写清楚」：三处抽屉标题行都只有「边看边调（即时生效）」，一个字都没提可以拖。
//   · 闪屏/动画：屏幕适配面板落位由 applyAdjPos() 直接写 bottom、无过渡——切页时留白从「底部导航
//     留白 90px」跳到「无导航 14px」（实测 90px → 14px 一跳、transition all 0s），76px 的瞬移就是
//     用户看到的「闪」。另外重复点同一分区会白写 3×N 个 style（实测桌面抽屉 30 次）。
// 断言分组：
//   S 组＝产物源锚（红侧必红）；B 组＝真浏览器行为面（红侧必红，但标了「前置 / 不回归」的几条
//   是两侧同过的闸：它们守的是既有能力，不参与判别）；C 组＝防修过头（两侧同过）；
//   Z1 全程零未捕获 JS 异常。
// 用法：node tools/verify-992-sadj-drag.mjs
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
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-992-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            const desc = (d && ((d.exception && d.exception.description) || d.text)) || 'err';
            jsExcepts.push(String(desc).split('\n').slice(0, 2).join(' | ').slice(0, 180));
          }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
const check = (d, ok, detail) => { if (ok) { pass++; console.log('  PASS  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } else { fail++; console.log('  FAIL  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } };
const readSrc = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };
const readProd = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };

// ---------- S 组：源锚 ----------
console.log('[S] 源锚与哨兵');
const srcPers = readSrc('js/personalize.js'), srcCs = readSrc('js/chat-settings.js');
const srcGc = readSrc('js/group-chat.js'), srcTpl = readSrc('template.html');
const srcHelp = readSrc('js/settings-help.js'), srcBuild = readFileSync(join(root, 'build.mjs'), 'utf8');
const sNeed = [
  ['S1 桌面抽屉标题行可拖动（位移逻辑；删＝退回「grip 纯装饰、拖不动」）', srcPers.includes('beautyDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));')],
  ['S2 桌面抽屉默认位停在底部导航之上（删＝bottom:0 压住底部导航，开着它切不了页）', srcPers.includes('beautyDrawerReserve()') && srcPers.includes("d.style.bottom = (beautyDockBot == null ? beautyDrawerReserve() : beautyDockBot) + 'px';")],
  ['S3 桌面抽屉标题行接线（标题行才是主把手；删＝只剩 4px 的 grip 能拖）', srcPers.includes('bindDrawerDrag(hd);')],
  ['S4 屏幕适配面板落位带过渡（删＝切页时 90px→14px 硬切瞬移）', srcPers.includes('gap:6px;transition:bottom .16s ease')],
  ['S5 拖动期间关掉过渡（删＝面板跟不上手指）', srcPers.includes("panel.style.transition = 'none';")],
  ['S6 桌面抽屉点亮态只在真变化时写（删＝重复点同分区白写 3×N 个 style）', srcPers.includes('const paintChips = (key) => {')],
  ['S7 聊天抽屉标题行写明可拖动（用户「并不知道有这个功能」的直派面）', srcCs.includes("hdHint.textContent = '按住标题行上下拖 · 让开看聊天';")],
  ['S8 聊天抽屉落位带过渡（删＝拖动松手吸附/键盘抬升硬切）', srcCs.includes("d.style.transition = 'bottom .16s ease';")],
  ['S9 聊天抽屉点亮态只在真变化时写', srcCs.includes('const paintCsChips = (key) => {')],
  ['S10 群聊抽屉补拖动（删＝同族只改一半：单聊能拖、群聊拖不动）', srcGc.includes('gcDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));')],
  ['S11 群聊抽屉标题行接线 + 写明可拖动', srcGc.includes('bindGcDockDrag(hd);') && srcGc.includes("hdHint.textContent = '按住标题行上下拖 · 让开看群聊';")],
  ['S12 桌面美化页入口副标题写明标题行可拖（开面板前就看得见）', srcTpl.includes('桌面在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位')],
  ['S13 聊天美化入口副标题写明标题行可拖', srcCs.includes('聊天在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位')],
  ['S14 群聊美化入口副标题写明标题行可拖', srcGc.includes('群聊在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位')],
  ['S15 设置页「功能说明」写明抽屉与拖动（删＝说明里查不到这个能力）', srcHelp.includes('抽屉的标题行可以按住往上拖')]
];
sNeed.forEach(([n, ok]) => check(n, ok));
const sids = ['#1008a', '#1008b', '#1008c', '#1008d', '#1008e', '#1008f', '#1008g', '#1008h', '#1008i', '#1008j', '#1008k', '#1008l', '#1008m', '#1008n', '#1008o', '#1008p', '#1008q'];
const missS = sids.filter((id) => srcBuild.indexOf("name: '" + id + ' ') < 0);
check('S16 十七条哨兵（#1008a~q）全部登记', missS.length === 0, missS.join(','));
const needles = [
  ['js/personalize.js', 'beautyDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));'],
  ['js/personalize.js', "d.style.bottom = (beautyDockBot == null ? beautyDrawerReserve() : beautyDockBot) + 'px';"],
  ['js/personalize.js', 'bindDrawerDrag(hd);'],
  ['js/personalize.js', 'gap:6px;transition:bottom .16s ease'],
  ['js/personalize.js', 'const paintChips = (key) => {'],
  ['js/personalize.js', "hdHint.textContent = '按住标题行上下拖 · 让开看桌面';"],
  ['js/chat-settings.js', "hdHint.textContent = '按住标题行上下拖 · 让开看聊天';"],
  ['js/chat-settings.js', "d.style.transition = 'bottom .16s ease';"],
  ['js/chat-settings.js', 'const paintCsChips = (key) => {'],
  ['js/chat-settings.js', '聊天在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位'],
  ['js/group-chat.js', 'gcDockBot = Math.max(0, Math.min(Math.round(window.innerHeight * 0.6), Math.round(sb + sy - e.clientY)));'],
  ['js/group-chat.js', 'bindGcDockDrag(hd);'],
  ['js/group-chat.js', 'const paintGcChips = (key) => {'],
  ['js/group-chat.js', "hdHint.textContent = '按住标题行上下拖 · 让开看群聊';"],
  ['js/group-chat.js', '群聊在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位'],
  ['template.html', '桌面在上、控件在下，改哪看哪、即时生效；标题行可按住往上拖让位'],
  ['js/settings-help.js', '抽屉的标题行可以按住往上拖']
];
const uniqBad = needles.filter(([f, n]) => readSrc(f).split(n).length - 1 !== 1).map(([f, n]) => f + ':' + n.slice(0, 24));
check('S17 每条 needle 在登记文件内唯一（哑哨兵体检）', uniqBad.length === 0, uniqBad.join(' | '));

// ---------- 浏览器 ----------
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: "try{localStorage.setItem('xy-home-v2:__guide-done','1');localStorage.setItem('xy-home-v2:__onboard-done','1');localStorage.setItem('xy-home-v2:backup-last','" + Date.now() + "');}catch(e){}"
});
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(700);
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}['modal-mask','pc-sheet-mask'].forEach(function(id){var m=document.getElementById(id);if(m)m.hidden=true;});return true;})()");
await sleep(700);

// 拖动工具：在元素上合成 pointerdown/move/up（handler 直接绑在元素上；setPointerCapture 失败被 try 吞掉）
const DRAG = (sel, dy, opts) => `(function(){
  var el=document.querySelector(${JSON.stringify(sel)}); if(!el) return 'no-el';
  var r=el.getBoundingClientRect(); var x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
  function ev(t,cy){ return new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:cy,pointerId:7,pointerType:'touch',isPrimary:true,buttons:1}); }
  var seen={};
  el.dispatchEvent(ev('pointerdown', y));
  var d=document.getElementById(${JSON.stringify(opts && opts.drawer || 'beauty-drawer')});
  seen.afterDown = d ? d.style.transition : null;
  el.dispatchEvent(ev('pointermove', y - ${Math.round(dy / 2)}));
  el.dispatchEvent(ev('pointermove', y - ${dy}));
  var mid = d ? d.style.bottom : null;
  el.dispatchEvent(ev('pointerup', y - ${dy}));
  return JSON.stringify({ mid: mid, afterUp: d ? d.style.bottom : null, trans: d ? d.style.transition : null, seen: seen });
})()`;
const snapDrawer = (id) => evalJs(`(function(){var d=document.getElementById(${JSON.stringify(id)});if(!d)return null;var r=d.getBoundingClientRect();var tb=document.querySelector('.tabbar');var tr=tb&&!tb.hidden?tb.getBoundingClientRect():null;
  return JSON.stringify({shown:getComputedStyle(d).display!=='none',bottom:d.style.bottom,rectBottom:Math.round(r.bottom),h:Math.round(r.height),transition:getComputedStyle(d).transitionProperty+' '+getComputedStyle(d).transitionDuration,tabbarTop:tr?Math.round(tr.top):null});})()`);
const hitAt = (sel) => evalJs(`(function(){var t=document.querySelector(${JSON.stringify(sel)});if(!t)return 'no-el';var r=t.getBoundingClientRect();var el=document.elementFromPoint(Math.round(r.x+r.width/2),Math.round(r.y+r.height/2));if(!el)return 'none';return (el===t||t.contains(el)?'IN':'OUT')+':'+(el.id||el.className||el.tagName);})()`);
// 命中测试前先静场：开屏/引导/备份提醒等整屏遮罩会盖住底部导航，命中的是遮罩而不是「抽屉有没有挡」
const clearOverlays = () => evalJs("(function(){['splash','modal-mask','pc-sheet-mask','qa-mask','backup-remind-bar','tc-mask'].forEach(function(id){var e=document.getElementById(id);if(e){e.hidden=true;e.style.display='none';}});return true;})()");
const jparse = (s) => { try { return JSON.parse(String(s)); } catch (e) { return null; } };

console.log('[B] 行为面（真浏览器 390×844）');

// --- 桌面抽屉 ---
await evalJs("document.querySelector('.tab[data-page=\"page-setting\"]').click(); true"); await sleep(350);
await evalJs("document.getElementById('row-appearance').click(); true"); await sleep(400);
await evalJs("document.getElementById('dq-drawer').click(); true"); await sleep(600);
await clearOverlays(); await sleep(150);
let d0 = jparse(await snapDrawer('beauty-drawer'));
check('B1 桌面抽屉已打开', !!(d0 && d0.shown), JSON.stringify(d0));
check('B2 默认位停在底部导航之上（不再压住切页入口；实测 tabbar.top=' + (d0 && d0.tabbarTop) + '）', !!(d0 && d0.tabbarTop && d0.rectBottom <= d0.tabbarTop + 2), JSON.stringify(d0));
const hitTab = await hitAt('.tabbar .tab');
check('B3 底部导航仍可点（命中测试落在 tabbar 内，不是抽屉）', String(hitTab).indexOf('IN:') === 0, String(hitTab));
check('B4 落位带过渡（bottom / 非 0s）', !!(d0 && /bottom/.test(d0.transition) && !/ 0s$/.test(d0.transition)), d0 && d0.transition);
const hdSel = '#beauty-drawer > div:nth-of-type(2)';
const hintTxt = await evalJs("(function(){var d=document.getElementById('beauty-drawer');return d?d.textContent.indexOf('按住标题行上下拖')>=0:false;})()");
check('B5 标题行写明可拖动（DOM 里有这句提示）', hintTxt === true, String(hintTxt));
const drag1 = jparse(await evalJs(DRAG(hdSel, 120)));
check('B6 拖标题行上移 → 抽屉位置上移（bottom 变大）', !!(drag1 && parseFloat(drag1.afterUp) > parseFloat(d0.bottom) + 100), JSON.stringify(drag1));
check('B7 拖动期间过渡被关掉（跟手）', !!(drag1 && drag1.seen && drag1.seen.afterDown === 'none'), JSON.stringify(drag1 && drag1.seen));
check('B8 松手恢复过渡（吸附/回位是动画）', !!(drag1 && /bottom/.test(String(drag1.trans))), drag1 && drag1.trans);
await sleep(300);
let d1 = jparse(await snapDrawer('beauty-drawer'));
check('B9 拖到的位置会话内保持（重开抽屉仍在原位）', !!(drag1 && parseFloat(drag1.afterUp) > 100 && d1 && Math.abs(parseFloat(d1.bottom) - parseFloat(drag1.afterUp)) < 2), JSON.stringify({ drag1: drag1, d1: d1 }));
await evalJs("(function(){var d=document.getElementById('beauty-drawer');d.style.display='none';return true;})()");
await sleep(200);
await evalJs("document.getElementById('dq-drawer').click(); true"); await sleep(500);
let d2 = jparse(await snapDrawer('beauty-drawer'));
check('B10 重开后仍在拖到的位置（会话内记忆，不落盘）', !!(drag1 && parseFloat(drag1.afterUp) > 100 && d2 && Math.abs(parseFloat(d2.bottom) - parseFloat(drag1.afterUp)) < 2), JSON.stringify(d2));
// 一路拖回底部附近 → 必须吸附回自动位（null＝导航之上），而不是停在贴底
const backDy = -(parseFloat(d2.bottom) - parseFloat(d0.bottom) + 40);
const drag2 = jparse(await evalJs(DRAG(hdSel, backDy)));
await sleep(450);
let d3 = jparse(await snapDrawer('beauty-drawer'));
check('B11 拖回底部附近 → 吸附回自动位（bottom 回到导航之上 ' + (d0 && d0.bottom) + '，不是停在贴底）', !!(d3 && d3.bottom === d0.bottom && d3.rectBottom <= d3.tabbarTop + 2), JSON.stringify({ drag2: drag2, d3: d3 }));
// 重复点当前分区：点亮态不再白写
const churn = await evalJs(`(function(){
  var d=document.getElementById('beauty-drawer'); if(!d) return 'no-drawer';
  var chips=null;
  [].forEach.call(d.querySelectorAll('div'),function(x){ if(x.children.length>=3 && x.children[0].dataset && x.children[0].dataset.sec) chips=chips||x; });
  if(!chips) return 'no-chips';
  var n=0; var mo=new MutationObserver(function(rs){ rs.forEach(function(r){ if(r.type==='attributes') n++; }); });
  mo.observe(d,{attributes:true,subtree:true});
  var cur=chips.querySelector('button[data-sec]');
  chips.children[0].click(); chips.children[0].click();
  return new Promise(function(res){ setTimeout(function(){ mo.disconnect(); res(JSON.stringify({writes:n})); }, 400); });
})()`);
const churnN = (() => { const o = jparse(churn); return o ? o.writes : -1; })();
check('B12 重复点当前分区不再白写一串 style（实测本批 3 次 / 修复前 30 次）', churnN >= 0 && churnN <= 8, 'writes=' + churnN + ' raw=' + String(churn).slice(0, 60));

// --- 聊天抽屉 ---
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chat\"]');if(t)t.click();return true;})()"); await sleep(400);
await evalJs("(function(){var e=document.getElementById('chat-settings-btn');if(e)e.click();return true;})()"); await sleep(450);
await evalJs("(function(){var b=document.getElementById('cs-live-adjust');if(b)b.click();return true;})()"); await sleep(600);
let c0 = jparse(await snapDrawer('chat-beauty-drawer'));
check('B13（前置）聊天抽屉已打开', !!(c0 && c0.shown), JSON.stringify(c0));
const cHint = await evalJs("(function(){var d=document.getElementById('chat-beauty-drawer');return d?d.textContent.indexOf('按住标题行上下拖')>=0:false;})()");
check('B14 聊天抽屉标题行写明可拖动（#760 有拖动但此前一字未提）', cHint === true, String(cHint));
const cdrag = jparse(await evalJs(DRAG('#chat-beauty-drawer > div:nth-of-type(2)', 120, { drawer: 'chat-beauty-drawer' })));
check('B15（不回归）聊天抽屉拖标题行仍可上移（#760 能力）', !!(cdrag && parseFloat(cdrag.afterUp) > 100), JSON.stringify(cdrag));

// --- 群聊抽屉（群聊默认关闭，先开开关让桌面出现群聊入口；入口按钮注入在群聊设置的「美化」段） ---
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-phone\"]');if(t)t.click();return true;})()"); await sleep(350);
const gcOn = await evalJs("(function(){var r=document.getElementById('sf-group-chat-row');if(!r)return 'no-row';var i=r.querySelector('input[type=checkbox]');if(i&&!i.checked){i.checked=true;i.dispatchEvent(new Event('change',{bubbles:true}));}return i?i.checked:'no-input';})()");
await sleep(500);
const gcEnter = await evalJs("(function(){var a=document.querySelector('.app[data-app=\"group-chat\"]');if(!a)return 'no-app';a.click();var p=document.getElementById('page-group-chat');return p?!p.hidden:'no-page';})()");
await sleep(900);
const gcPanel = await evalJs("(function(){var m=document.getElementById('gc-more-btn');if(m)m.click();var s=document.getElementById('gc-more-settings');if(s)s.click();var p=document.getElementById('gc-settings-panel');if(p){var b=p.querySelector('[data-gt=\"beauty\"]');if(b)b.click();}return p?(p.hidden?'hidden':'shown'):'no-panel';})()");
await sleep(800);
const gcBtn = await evalJs("(function(){var b=document.getElementById('gc-live-adjust');if(b)b.click();return !!b;})()");
await sleep(600);
let g0 = jparse(await snapDrawer('gc-beauty-drawer'));
const gHint = await evalJs("(function(){var d=document.getElementById('gc-beauty-drawer');return d?d.textContent.indexOf('按住标题行上下拖')>=0:'no-drawer';})()");
check('B16 群聊抽屉已打开且写明可拖动', !!(g0 && g0.shown) && gHint === true, JSON.stringify({ gcOn: gcOn, gcEnter: gcEnter, gcPanel: gcPanel, gcBtn: gcBtn, g0: g0, hint: gHint }));
const gdrag = jparse(await evalJs(DRAG('#gc-beauty-drawer > div:nth-of-type(2)', 120, { drawer: 'gc-beauty-drawer' })));
check('B17 群聊抽屉拖标题行可上移（同族补齐，修复前完全拖不动）', !!(gdrag && parseFloat(gdrag.afterUp) > 100), JSON.stringify(gdrag));

// --- 屏幕适配面板：切页落位带过渡 ---
await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-setting\"]');t.click();return true;})()"); await sleep(400);
await evalJs("document.getElementById('row-screen-adj').click(); true"); await sleep(500);
const p0 = await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(!p)return 'no-panel';return p.style.bottom;})()");
check('B18 面板已开且带 bottom 过渡', await evalJs("(function(){var p=document.getElementById('screen-adj-panel');return p?getComputedStyle(p).transitionProperty+' '+getComputedStyle(p).transitionDuration:'no-panel';})()").then((v) => /bottom/.test(String(v)) && !/ 0s$/.test(String(v))), await evalJs("(function(){var p=document.getElementById('screen-adj-panel');return p?getComputedStyle(p).transitionDuration:'no-panel';})()"));
const jump = await evalJs(`(function(){
  var p=document.getElementById('screen-adj-panel'); if(!p) return 'no-panel';
  var mid=[];
  var t=setInterval(function(){ var r=p.getBoundingClientRect(); if(mid[mid.length-1]!==Math.round(r.bottom)) mid.push(Math.round(r.bottom)); },16);
  // 切到聊天页：优先点底部导航（tabbar 上未必有聊天 tab，拿不到就直接切页——面板只认 page hidden 变化）
  var tabs=[].map.call(document.querySelectorAll('.tab'),function(x){return x.dataset.page;}).join(',');
  var tab=document.querySelector('.tab[data-page="page-chat"]');
  var via='tab';
  if(tab) tab.click(); else {
    via='direct';
    [].forEach.call(document.querySelectorAll('.page'),function(x){x.hidden=true;});
    var c=document.getElementById('page-chat'); if(c) c.hidden=false;
  }
  return new Promise(function(res){ setTimeout(function(){ clearInterval(t); res(JSON.stringify({ via:via, tabs:tabs, seq: mid.slice(0,10), bottom: p.style.bottom })); }, 700); });
})()`);
const jumpObj = jparse(jump);
// 有过渡＝中途能采到「非起点也非终点」的中间帧（旧实现 0s 硬切只会有一个值）
const jumpMid = !!(jumpObj && jumpObj.seq && jumpObj.seq.length >= 3);
check('B19 切页落位是动画而非瞬移（采到中间帧；修复前 transition all 0s 只有一跳）', jumpMid, String(jump).slice(0, 150));

console.log('[C] 防修过头（两侧同过）');
const cNeed = [
  ['C1 抽屉仍半透明 72% + 40vh 上限（#562/#940 口径不回退）', srcPers.includes('background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent)') && srcPers.includes('max-height:40vh')],
  ['C2 「收起」仍折叠控件区（#940 口径不回退）', srcPers.includes("foldBtn.textContent = willFold ? '展开' : '收起';")],
  ['C3 分区仍能切内容（点另一个分区会换控件区）', srcPers.includes('SECS.filter(s => s.key === key)[0]')],
  ['C4 屏幕适配面板仍在返回键清单（tabs.js #764h 契约）', readSrc('js/tabs.js').includes("'screen-adj-panel'];")],
  ['C5 面板拖动落位仍在（#962 会话内记忆不回退）', srcPers.includes('adjBottom = Math.max(0, Math.min(Math.round(window.innerHeight * 0.7), Math.round(sb + sy - e.clientY)));')],
  ['C6 桌面抽屉拖动位置只在会话内记（不落盘、不碰数据层键）', !srcPers.includes("store.set('beauty-dock") && (srcPers.includes('let beautyDockBot = null;') || srcPers.includes('let beautyDockTop = null;'))]
];
cNeed.forEach(([n, ok]) => check(n, ok));
const cSwitch = await evalJs(`(function(){
  var d=document.getElementById('beauty-drawer'); if(!d) return 'no-drawer';
  var chips=null;
  [].forEach.call(d.querySelectorAll('div'),function(x){ if(x.children.length>=3 && x.children[0].dataset && x.children[0].dataset.sec) chips=chips||x; });
  if(!chips) return 'no-chips';
  var before=d.textContent.length;
  chips.children[1].click();
  return JSON.stringify({ before: before, after: d.textContent.length, active: chips.children[1].style.background });
})()`);
const csObj = jparse(cSwitch);
check('C7 切分区后控件区真的换了（内容长度变化 或 点亮态转移）', !!(csObj && (/--ink/.test(String(csObj.active)))), String(cSwitch).slice(0, 100));
check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' | '));

console.log('\n— 合计 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）—');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
