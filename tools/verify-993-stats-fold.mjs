// ===== 回归验证 #993：聊天统计「申请心意币记录 / 小游戏记录」默认折叠（用户直派） =====
// 用户原话：「聊天统计的联系人申请心意币记录，这个功能没有折叠导致页面会变得很长很长，
//           而且没有默认折叠起来。」
// 背景/根因：这两个区块是「全量流水」——申请卡每触发一次落一条、小游戏每局一条，行数随使用无上限累计
//   （原实现注释假设「流水本身低频（红包≤5/日、申请≤2/日）」，但流水只增不减，攒几个月就是几十上百行），
//   默认全展把「聊天记录」tab 拉得很长。
// 修复：两个区块改走同一折叠渲染件（statsFoldSection），默认收起；头部保留「N 笔 / N 条」徽标 + ▾；
//   开关态收在模块级 map（进统计页每次重设 innerHTML，DOM 上的折叠态活不过一次渲染）。
// 断言：S 组＝产物/源码静态（默认值、单一实现、折叠 CSS 真的藏得住）；A 组＝无头行为（默认收起、
//   点击展开/收起、展开后点列表行不误收、小游戏区块同款、折叠态跨重渲染保留、空态无开关、
//   折叠前后内容高度差实证）；Z 组＝零异常。
// 用法：node build.mjs && node tools/verify-993-stats-fold.mjs
//       隔离副本：MOCHI_ROOT=<副本目录> node tools/verify-993-stats-fold.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

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

const cdpPort = 9700 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-fold993-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
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
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return 'EX:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'ERR:' + e.message; }
}
const J = (s) => { try { return JSON.parse(String(s)); } catch (e) { return null; } };

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html?x=' + Date.now() });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(700);

// =====================================================================
// S 组：产物 / 源码静态断言
// =====================================================================
const prodJs = readFileSync(join(root, 'js/p2-features.js'), 'utf8');
const prodHtml = readFileSync(join(root, 'index.html'), 'utf8');

ok(/const statsFoldOpen = \{ askcoin: false, games: false \};/.test(prodJs),
  'S1 两个流水区块的默认态都是「收起」（statsFoldOpen 两键 false）', prodJs.indexOf('statsFoldOpen') >= 0 ? 'has statsFoldOpen' : 'no statsFoldOpen');
ok(prodJs.indexOf("return statsFoldSection('🎮', '小游戏记录', '条', uniq,") >= 0 &&
  prodJs.indexOf("'<span class=\"stats-sec-count\">' + uniq.length + ' 条</span>") < 0,
  'S2 小游戏记录走同一折叠渲染件（旧的手写区块头已不存在＝不再两份实现）');
ok(prodJs.indexOf('function coinRecordSection(') < 0,
  'S3 删除型：旧的无折叠渲染件 coinRecordSection 不得回流');
ok(prodHtml.indexOf('.stats-fold:not(.open) > .stats-fold-body { display:none; }') >= 0,
  'S4 折叠态真的把流水藏起来（CSS：非 open 的区块体 display:none）');
ok(prodHtml.indexOf('.stats-fold.open .stats-fold-caret { transform:rotate(180deg); }') >= 0 &&
  prodHtml.indexOf('.stats-fold-caret') >= 0,
  'S5 头部 ▾ 随展开翻转（可展开的信号）');
ok(prodJs.indexOf('data-stats-fold=') >= 0 && prodJs.indexOf('class="stats-fold-right"') >= 0,
  'S6 产物含折叠头结构（data-stats-fold 挂钩 + 右侧徽标区）');

// =====================================================================
// A 组：无头行为
// =====================================================================
const openStats = `(function(){
  var app=document.querySelector('.app[data-app="stats"]');
  if(app)app.click();
  var tab=document.querySelector('#page-stats .fav-tab[data-stab="chat"]');
  if(tab)tab.click();
  return true;
})()`;
const PROBE = (key) => `(function(){
  var sec=document.querySelector('.stats-sec[data-stats-fold="${key}"]');
  if(!sec)return JSON.stringify({sec:false, anyFold:document.querySelectorAll('#st-chat-content [data-stats-fold]').length});
  var head=sec.querySelector('.stats-fold-head');
  var body=sec.querySelector('.stats-fold-body');
  var caret=sec.querySelector('.stats-fold-caret');
  var pill=sec.querySelector('.stats-sec-count');
  return JSON.stringify({
    sec:true,
    open:sec.classList.contains('open'),
    aria:head?head.getAttribute('aria-expanded'):null,
    role:head?head.getAttribute('role'):null,
    bodyRects:body?body.getClientRects().length:-1,
    caret:!!caret,
    pill:pill?pill.textContent:'',
    items:sec.querySelectorAll('.stats-item').length,
    firstItem:(sec.querySelector('.stats-item-name')||{}).textContent||'',
    lastItem:(function(){var a=sec.querySelectorAll('.stats-item-name');return a.length?a[a.length-1].textContent:'';})()
  });
})()`;
// 折叠题点：把头滚到视口中央、等短暂浮层（toast）消散、关掉挡在上面的弹窗（备份提醒 / TA 的小问题
// 这类与本批无关的自动弹层——真实用户会先关掉），再按真实命中物派发点击。
// hitInHead＝「这一行真的点得到」的证据；浮层恰在点击瞬间冒出来就清场重试（最多 5 次），
// 重试穷尽仍被盖住才判红，并把盖住它的元素记进失败行。
const dismissOverlays = () => evalJs(`(function(){
  var out=[];
  var mk=document.getElementById('modal-mask');
  if(mk&&!mk.hidden){var b=document.getElementById('modal-ok');if(b)b.click();mk.hidden=true;out.push('modal');}
  var tc=document.getElementById('tc-mask');
  if(tc&&!tc.hidden){var c=document.getElementById('tc-mask-close');if(c)c.click();tc.hidden=true;out.push('tc');}
  return out.join(',');
})()`);
const clickHead = async (key, viaHit) => {
  await evalJs(`(function(){
    var sec=document.querySelector('.stats-sec[data-stats-fold="${key}"]');
    var head=sec?sec.querySelector('.stats-fold-head'):null;
    if(head&&head.scrollIntoView)head.scrollIntoView({block:'center'});
    return true;
  })()`);
  let last = {}, notes = [];
  for (let i = 0; i < 5; i++) {
    await sleep(i === 0 ? 2400 : 700); // 首次等 cc-toast 之类 2s 浮层消散，否则 elementFromPoint 命中的是浮层
    const d = await dismissOverlays();
    if (d) notes.push(String(d) + '@' + i);
    await sleep(i === 0 ? 500 : 300);
    const res = await evalJs(`(function(){
      var sec=document.querySelector('.stats-sec[data-stats-fold="${key}"]');
      var head=sec?sec.querySelector('.stats-fold-head'):null;
      if(!head)return JSON.stringify({no:true});
      var r=head.getBoundingClientRect();
      var cx=r.left+r.width/2, cy=r.top+r.height/2;
      var hit=document.elementFromPoint(cx,cy);
      var inHead=!!(hit&&head.contains(hit));
      if(!inHead)return JSON.stringify({hitInHead:false, hit: hit?(hit.className||hit.tagName):'(null)', y:Math.round(r.top), h:Math.round(r.height)});
      hit.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:cx,clientY:cy}));
      return JSON.stringify({hitInHead:true, hit: hit?(hit.className||hit.tagName):'(null)', y:Math.round(r.top), h:Math.round(r.height)});
    })()`);
    last = J(res) || {};
    if (last.hitInHead) { last.tries = i + 1; break; }
    if (!viaHit) { // 直接派发：命中物不参与（头行可能落在视口外），本轮点完收工
      await evalJs(`(function(){
        var sec=document.querySelector('.stats-sec[data-stats-fold="${key}"]');
        var head=sec?sec.querySelector('.stats-fold-head'):null;
        if(head)head.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        return true;
      })()`);
      last = { hitInHead: true, tries: i + 1, direct: true };
      break;
    }
  }
  if (notes.length) last.dismissed = notes.join(' ');
  await sleep(400);
  return last;
};

// —— A1 空态：有聊天记录但没有流水 → 区块不给开关、照常显示空文案 ——
await evalJs(`(async function(){ window.chatAddIn('在吗？今天忙完了没', {silent:true}); await new Promise(r=>setTimeout(r,30)); window.chatAddIn('刚忙完～', {silent:true}); return true; })()`);
await sleep(600);
await evalJs(openStats);
await sleep(700);
const oe = J(await evalJs(`(function(){
  var t=document.getElementById('st-chat-content');
  if(!t)return JSON.stringify({no:true});
  return JSON.stringify({folds:t.querySelectorAll('[data-stats-fold]').length, caret:t.querySelectorAll('.stats-fold-caret').length,
    askEmpty:t.textContent.indexOf('还没有向 Mochi 申请过')>=0,
    gameEmpty:t.textContent.indexOf('还没有小游戏记录')>=0});
})()`)) || {};
ok(oe.folds === 0 && oe.caret === 0, 'A1 没有流水时不出现折叠开关（不给空区块一个点了没反应的三角）', JSON.stringify(oe));
ok(oe.askEmpty === true && oe.gameEmpty === true, 'A1b 两个空区块照常显示空态文案', JSON.stringify(oe));

// —— A2 注入 30 条申请卡 + 6 条小游戏（逐条隔开＝躲开同毫秒出生号闸门，否则只剩 1 条）——
const inj = await evalJs(`(async function(){
  for(var i=0;i<30;i++){ window.chatAddIn('', { special:'askcoin', askFen: 1314+i*10, askTs: Date.now()-(30-i)*60000, silent:true }); await new Promise(r=>setTimeout(r,25)); }
  var g=[['双人打砖块 · 120 分 · 最高连击 ×8 · 完成第 3 层','brick'],['Pong · 你 5 : 3 TA · 你赢','pong'],['记忆翻牌 · 你 4 对 · TA 3 对 · 默契 76','memory'],['四子棋 · 你赢','c4'],['合作扫雷 · 完成 普通','ms'],['贪吃蛇 · 你 42 分 · TA 31 分','snake']];
  for(var j=0;j<g.length;j++){ window.chatAddIn(g[j][0], { special:g[j][1], silent:true }); await new Promise(r=>setTimeout(r,25)); }
  var ms=window.getChatMsgs()||[];
  return JSON.stringify({ask:ms.filter(function(m){return m&&m.special==='askcoin'}).length});
})()`);
ok((J(inj) || {}).ask === 30, 'A2 30 条申请卡落进聊天记录（注入前置：隔条写入）', String(inj));
await evalJs(openStats);
await sleep(900);
const a2raw = await evalJs(PROBE('askcoin'));
const a2 = J(a2raw) || {};
ok(a2.sec === true, 'A3 注入流水后「申请心意币记录」区块渲染出来', String(a2raw));
ok(a2.pill === '30 笔', 'A3b 头部徽标显示笔数（收起时也知道被藏了多少）', a2.pill);
ok(a2.caret === true && a2.role === 'button', 'A3c 头部带 ▾ 与 role=button（是开关而不是静态标题）', JSON.stringify({ caret: a2.caret, role: a2.role }));

// —— A4 默认收起 ——
ok(a2.open === false && a2.aria === 'false', 'A4 进页面就是收起的（默认折叠，无需用户操作）', JSON.stringify({ open: a2.open, aria: a2.aria }));
ok(a2.items === 30 && a2.bodyRects === 0, 'A4b 列表项都在 DOM 里但不可见（收起＝没铺开，不是删数据）', JSON.stringify({ items: a2.items, bodyRects: a2.bodyRects }));

// —— A5 点头部整行展开（按真实命中物派发，顺带证明头行没有被别层盖住）——
const hit5 = await clickHead('askcoin', true);
const a5 = J(await evalJs(PROBE('askcoin'))) || {};
ok(hit5.hitInHead === true, 'A5 收起态点头行：命中物就是头行自己（没有被浮层盖住）', JSON.stringify(hit5));
ok(a5.open === true && a5.aria === 'true' && a5.bodyRects > 0, 'A5b 点一下即展开', JSON.stringify({ open: a5.open, rects: a5.bodyRects }));
ok(a5.items === 30 && a5.firstItem === '+¥16.04' && a5.lastItem === '+¥13.14',
  'A5c 展开后列表按时间倒序（最新在上），30 条全在', JSON.stringify({ first: a5.firstItem, last: a5.lastItem, n: a5.items }));
const hOpen = (J(await evalJs("(function(){return JSON.stringify({h:document.getElementById('st-chat-content').scrollHeight});})()")) || {}).h;

// —— A6 展开后点列表行不误收 ——
await evalJs(`(function(){
  var it=document.querySelector('.stats-sec[data-stats-fold="askcoin"] .stats-item');
  if(it)it.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  return true;
})()`);
await sleep(300);
const a6 = J(await evalJs(PROBE('askcoin'))) || {};
ok(a6.open === true, 'A6 展开后点列表行不会把它收回去（只有头行是开关）', JSON.stringify({ open: a6.open }));

// —— A7 再点头部收起 + 高度差实证 ——
await clickHead('askcoin', false);
const a7 = J(await evalJs(PROBE('askcoin'))) || {};
const hClosed = (J(await evalJs("(function(){return JSON.stringify({h:document.getElementById('st-chat-content').scrollHeight});})()")) || {}).h;
ok(a7.open === false && a7.bodyRects === 0, 'A7 再点头部收起', JSON.stringify({ open: a7.open }));
ok((hOpen || 0) - (hClosed || 0) > 300,
  'A7b 收起把 tab 真正压短（30 条申请卡：展开 ' + hOpen + 'px → 收起 ' + hClosed + 'px）',
  JSON.stringify({ open: hOpen, closed: hClosed }));

// —— A8 小游戏记录同款 ——
const a8 = J(await evalJs(PROBE('games'))) || {};
ok(a8.sec === true && a8.open === false && a8.bodyRects === 0, 'A8 小游戏记录同样默认收起', JSON.stringify(a8));
ok(a8.pill === '6 条' && a8.items === 6, 'A8b 小游戏徽标条数与列表齐（去重后 6 条）', JSON.stringify({ pill: a8.pill, items: a8.items }));
await clickHead('games', false);
const a8c = J(await evalJs(PROBE('games'))) || {};
ok(a8c.open === true && a8c.bodyRects > 0 && a8c.firstItem.indexOf('贪吃蛇') >= 0,
  'A8c 小游戏记录点开也正常展开，最新一局在上', JSON.stringify({ open: a8c.open, first: a8c.firstItem }));

// —— A9 开关态跨重渲染保留（返回桌面再进统计页＝renderStats 重设 innerHTML）——
await evalJs("(function(){var b=document.getElementById('stats-back');if(b)b.click();return true;})()");
await sleep(400);
await evalJs(openStats);
await sleep(900);
const a9 = J(await evalJs(PROBE('games'))) || {};
const a9b = J(await evalJs(PROBE('askcoin'))) || {};
ok(a9.open === true && a9.bodyRects > 0 && a9b.open === false,
  'A9 重进统计页后开关态按用户上次的来（展开的仍展开、收起的仍收起）',
  JSON.stringify({ games: a9.open, askcoin: a9b.open }));

// —— A10 键盘可达（role=button + Enter）——
await evalJs(`(function(){
  var head=document.querySelector('.stats-sec[data-stats-fold="askcoin"] .stats-fold-head');
  if(head)head.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  return true;
})()`);
await sleep(300);
const a10 = J(await evalJs(PROBE('askcoin'))) || {};
ok(a10.open === true, 'A10 键盘 Enter 也能开合（role=button/tabindex 不是摆设）', JSON.stringify({ open: a10.open }));

// —— Z 组：零异常 ——
const z = await evalJs("(function(){var a=window.__jsErrors||[];return JSON.stringify({n:a.length,list:a.slice(0,3)});})()");
ok((J(z) || {}).n === 0, 'Z1 全程无 JS 异常', String(z));

console.log(fail ? ('FAIL ' + pass + '/' + (pass + fail)) : ('ALL PASS ' + pass + '/' + (pass + fail)));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
