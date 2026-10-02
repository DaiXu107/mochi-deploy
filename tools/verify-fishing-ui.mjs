// ===== 专项验证：双人钓鱼 UI 补全（样式层 + 浮层登记 + 互斥 + 视觉元素） =====
// 背景：fishing.js 与 template 锚点此前已落地，但整套 .fish-* 视觉样式缺失（UI 为裸 div）、
//   mobile-adapt 两处浮层列表未登记 #chat-fish-panel（背景滚动锁/键盘停靠不生效）、
//   无兄弟浮层互斥（与 pong/snake/c4 等半框叠加）、无鱼漂视觉元素。
// 本轮补齐：chat-pages.css 追加完整钓鱼样式段（含 [data-theme=dark] 兜底 + reduced-motion）、
//   fishing.js 注入鱼漂元素 + FISH_SIBLING_IDS 互斥 + __fishDebug 驯化钩子、
//   mobile-adapt.js FLOAT_PANEL_SELECTORS/FLOAT_SELECTORS 登记 '#chat-fish-panel'。
// 用法：node tools/verify-fishing-ui.mjs（自组装 src 页面，不依赖构建产物）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- A 组：静态断言 ----------------
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail && !ok ? '  [' + String(detail).slice(0, 300) + ']' : '')); }
function read(p) { return readFileSync(join(root, p), 'utf8'); }

const cpCss = read('src/css/chat-pages.css');
const maSrc = read('src/js/mobile-adapt.js');
const fishSrc = read('src/js/fishing.js');
const tplSrc = read('src/template.html');

check('A1 样式段覆盖场景/时机条/列表/图鉴关键类',
  ['.fish-scene', '.fish-water', '.fish-persons', '.fish-rod', '.fish-bobber', '.fish-timing-bar', '.fish-timing-cursor', '.fish-btn', '.fish-tab.sel', '.fish-row', '.fish-sellbar', '.fish-dex-grid', '.fish-dex-check', '.fish-exch', '.fish-splash'].every(c => cpCss.includes(c)));
check('A2 容器高度与滚动调整（对齐四子棋同款）',
  cpCss.includes('#chat-fish-panel { height:auto; max-height:86%; }') &&
  cpCss.includes('#chat-fish-panel .poke-card-scroll { min-height:0; max-height:none; }'));
check('A3 深色模式兜底段存在', /\[data-theme="dark"\] \.fish-scene/.test(cpCss) && /\[data-theme="dark"\] \.fish-row/.test(cpCss));
check('A4 弱动效偏好关动画', /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.fish-water::before \{ animation:none/.test(cpCss));
check('A5 mobile-adapt FLOAT_PANEL_SELECTORS 登记钓鱼半框', /FLOAT_PANEL_SELECTORS = \[[^\]]*'#chat-fish-panel'/.test(maSrc));
check('A6 mobile-adapt FLOAT_SELECTORS 登记钓鱼半框', /FLOAT_SELECTORS = \[[^\]]*'#chat-fish-panel'/.test(maSrc));
check('A7 fishing.js 注入鱼漂视觉元素', fishSrc.includes("fish-bobber fish-bobber-mine") && fishSrc.includes("fish-bobber fish-bobber-ta"));
check('A8 fishing.js 兄弟浮层互斥（含 c4/more-panel）',
  fishSrc.includes('FISH_SIBLING_IDS') && fishSrc.includes("'chat-c4-panel'") && fishSrc.includes("'chat-more-panel'") && fishSrc.includes('MutationObserver'));
check('A9 fishing.js 测试驯化钩子导出', fishSrc.includes('window.__fishDebug') && fishSrc.includes('forceBite') && fishSrc.includes('reelAt'));
check('A10 template 面板锚点齐全（场景/时机条/双按钮/三页签）',
  tplSrc.includes('id="chat-fish-panel"') && tplSrc.includes('id="fish-scene"') && tplSrc.includes('id="fish-timing-cursor"') &&
  tplSrc.includes('id="fish-cast"') && tplSrc.includes('id="fish-reel"') && tplSrc.includes('data-ftab="gifts"'));
check('A11 时机条蓝区与 JS perfect 区间一致（38%~68%）且文案指向蓝区',
  cpCss.includes('#4a9fe8 50%') && /\.fish-timing-good \{\r?\n  position:absolute; left:38%; width:30%;/.test(cpCss) &&
  tplSrc.includes('光标进蓝区收竿最佳') && /p >= 0\.38 && p <= 0\.68/.test(fishSrc));

if (!results.every(r => r.ok)) { console.log('\n静态断言未全绿，停止运行时验证'); process.exit(1); }

// ---------------- 自组装 src 页面（顺序见 build.mjs） ----------------
function arrOf(name) {
  const m = read('build.mjs').match(new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
  return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
}
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let css = '', js = '';
for (const f of cssFiles) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of jsFiles) { try { js += read('src/js/' + f) + '\n'; } catch (e) {} }
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' +
  tplSrc.replace(/__APP_VERSION__/g, 'test') +
  '<scr' + 'ipt>window.__APP_VERSION__="test";</scr' + 'ipt>' +
  '<scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    if (req.url.split('?')[0] === '/blank.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>blank</body></html>'); return; }
    if (req.url.split('?')[0] === '/test.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page); return; }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const tmpDir = join(os.tmpdir(), 'mochi-fish-ui-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmpDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

let ws = null, msgId = 0;
const pend = new Map();
const excs = [];
async function cdpConnect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const t = list.find((x) => x.type === 'page');
      if (t) {
        ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
          if (m.method === 'Runtime.exceptionThrown') excs.push(m.params.exceptionDetails.text);
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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 加载页面（干净档案）
await cdp('Page.navigate', { url: baseUrl + '/test.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(600);

// ---- T1 打开面板：可见 + 场景渐变背景生效 + 高度正常 ----
await evalJs("(function(){try{localStorage.clear();}catch(e){}document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});window.openFishPanel();return true;})()");
await sleep(400);
const t1 = J(await evalJs(`(function(){
  var p=document.getElementById('chat-fish-panel'), sc=document.getElementById('fish-scene');
  if(!p||!sc) return JSON.stringify({open:false});
  var cs=getComputedStyle(sc);
  return JSON.stringify({open:!p.hidden,h:sc.offsetHeight,grad:(cs.backgroundImage||'').indexOf('linear-gradient')>=0,radius:cs.borderTopLeftRadius});
})()`));
check('T1 打开钓鱼面板且场景样式生效（高度148/圆角/渐变）', t1.open && t1.h >= 140 && t1.grad, JSON.stringify(t1));

// ---- T2 场景元素齐全（天空/双方人物/水面/双鱼漂） ----
const t2 = J(await evalJs(`(function(){
  var sc=document.getElementById('fish-scene');
  return JSON.stringify({
    sky:!!sc.querySelector('.fish-sky'), water:!!sc.querySelector('.fish-water'),
    me:!!sc.querySelector('.fish-me'), ta:!!sc.querySelector('.fish-ta'),
    bm:!!sc.querySelector('.fish-bobber-mine'), bt:!!sc.querySelector('.fish-bobber-ta'),
    waterH:sc.querySelector('.fish-water')?sc.querySelector('.fish-water').offsetHeight:0
  });
})()`));
check('T2 天空/水面/双方/双鱼漂元素齐全', t2.sky && t2.water && t2.me && t2.ta && t2.bm && t2.bt && t2.waterH > 40, JSON.stringify(t2));

// ---- T3 抛竿 → waiting 状态 + 鱼漂显示 + 时机条保持隐藏（display:flex 压过 [hidden] 的回归哨兵）+ 禁用态等待按钮 ----
await evalJs("(function(){document.getElementById('fish-cast').click();return true;})()");
await sleep(300);
const t3 = J(await evalJs(`(function(){
  var sc=document.getElementById('fish-scene');
  var bm=sc.querySelector('.fish-bobber-mine');
  var cast=document.getElementById('fish-cast'), tw=document.getElementById('fish-timing-wrap');
  return JSON.stringify({mine:sc.getAttribute('data-mine'),bobberShow:bm&&getComputedStyle(bm).display!=='none',
    timingHidden:tw.hidden&&getComputedStyle(tw).display==='none',
    castDisabled:cast.disabled,castTxt:cast.textContent});
})()`));
check('T3 抛竿进入等待：鱼漂出水/时机条隐藏/按钮禁用态', t3.mine === 'waiting' && t3.bobberShow && t3.timingHidden && t3.castDisabled && t3.castTxt.indexOf('等待') >= 0, JSON.stringify(t3));

// ---- T4 强制咬钩 → biting + 时机条出现 + 光标存在 ----
await evalJs('(function(){window.__fishDebug.forceBite();return true;})()');
await sleep(250);
const t4 = J(await evalJs(`(function(){
  var sc=document.getElementById('fish-scene'), w=document.getElementById('fish-timing-wrap');
  var cur=document.getElementById('fish-timing-cursor');
  return JSON.stringify({mine:sc.getAttribute('data-mine'),
    wrap:w?!w.hidden:false, cursor:cur?getComputedStyle(cur).position:'', barGrad:true});
})()`));
check('T4 咬钩时机条弹出且光标就位', t4.mine === 'biting' && t4.wrap && t4.cursor === 'absolute', JSON.stringify(t4));

// ---- T5 完美进度强制收竿 → 今日收获出现条目 + 图鉴计数 ----
await evalJs('(function(){window.__fishDebug.reelAt(0.5,true);return true;})()');
await sleep(350);
const t5 = J(await evalJs(`(function(){
  var st=window.__fishDebug.state();
  var rows=document.querySelectorAll('#fish-page .fish-row').length;
  var price=document.querySelector('#fish-page .fish-price');
  return JSON.stringify({mineCount:Object.keys(st.today.mine).length,dexCount:Object.keys(st.dex).length,rows:rows,priceTxt:price?price.textContent:''});
})()`));
check('T5 收竿入账：今日收获行 + 图鉴发现 + 价格列', t5.mineCount >= 1 && t5.dexCount >= 1 && t5.rows >= 1 && (t5.priceTxt || '').indexOf('+') === 0, JSON.stringify(t5));

// ---- T6 出售全部 → 心意币到账 + 收获清空 + 空态出售按钮禁用 ----
const balBefore = J(await evalJs('JSON.stringify(window.__fishDebug.state().wallet)')).myBalance;
await evalJs("(function(){document.getElementById('fish-sell-btn').click();return true;})()");
await sleep(400);
const t6 = J(await evalJs(`(function(){
  var st=window.__fishDebug.state();
  var empties=document.querySelectorAll('#fish-page .fish-empty').length;
  var sellBtn=document.getElementById('fish-sell-btn');
  return JSON.stringify({balAfter:st.wallet.myBalance,mineLeft:Object.keys(st.today.mine).length,taLeft:Object.keys(st.today.ta).length,emptyRows:empties,sellDisabled:sellBtn?sellBtn.disabled:null});
})()`));
check('T6 出售全部入账 gift-wallet 且两侧收获清空、空态按钮禁用',
  t6.balAfter > balBefore && t6.mineLeft === 0 && t6.taLeft === 0 && t6.emptyRows >= 1 && t6.sellDisabled === true,
  'before=' + balBefore + ' ' + JSON.stringify(t6));

// ---- T7 图鉴 tab：网格渲染 + 已发现高亮 ----
await evalJs("(function(){document.querySelector('.fish-tab[data-ftab=\"dex\"]').click();return true;})()");
await sleep(300);
const t7 = J(await evalJs(`(function(){
  var g=document.querySelector('#fish-page .fish-dex-grid');
  return JSON.stringify({grid:!!g,items:g?g.querySelectorAll('.fish-dex-item').length:0,got:g?g.querySelectorAll('.fish-dex-item.got').length:0,checks:g?g.querySelectorAll('.fish-dex-check').length:0});
})()`));
// 格数从源 ITEMS 动态数（#548 批扩充到 17 档后硬编码 14 恒红，改跟随源码）
const dexN = ((fishSrc.match(/const ITEMS = \[[\s\S]*?\n  \];/) || [''])[0].match(/\{ id:/g) || []).length;
check('T7 图鉴全格渲染（格数=源 ITEMS 档数）且新发现项带 ✓', t7.grid && dexN > 0 && t7.items === dexN && t7.got >= 1 && t7.checks === t7.got, JSON.stringify(t7) + ' dexN=' + dexN);

// ---- T8 TA 送礼 tab：空态 + 种礼物后渲染 + 兑换到账（v3.16.x 二调价 ¥5.2=520分） ----
await evalJs("(function(){document.querySelector('.fish-tab[data-ftab=\"gifts\"]').click();return true;})()");
await sleep(300);
const t8a = J(await evalJs(`(function(){var el=document.getElementById('fish-page');return JSON.stringify({empty:el.textContent.indexOf('还没送你东西')>=0});})()`));
await evalJs('(function(){window.__fishDebug.addTaGift("gift_shell");return true;})()');
await sleep(300);
const t8b = J(await evalJs(`(function(){
  var row=document.querySelector('#fish-page .fish-row');
  var exch=document.querySelector('#fish-page .fish-exch');
  return JSON.stringify({row:!!row,hadBtn:!!exch,balBefore:window.__fishDebug.state().wallet.myBalance});
})()`));
const t8c = J(await evalJs(`(function(){
  var exch=document.querySelector('#fish-page .fish-exch'); if(exch)exch.click();
  return JSON.stringify({balAfter:window.__fishDebug.state().wallet.myBalance,left:window.__fishDebug.state().gifts.length});
})()`));
check('T8 TA送礼：空态→收藏行→兑换 +¥5.2 入账并移除',
  t8a.empty && t8b.row && t8b.hadBtn && t8c.balAfter === t8b.balBefore + 520 && t8c.left === 0,
  JSON.stringify(t8a) + ' ' + JSON.stringify(t8b) + ' ' + JSON.stringify(t8c));

// ---- T9 TA 状态机运转：数秒内出现非 idle 行为状态 ----
let taSeen = '';
for (let i = 0; i < 24; i++) {
  const s = await evalJs("document.getElementById('fish-scene').getAttribute('data-ta')");
  if (s && s !== 'idle') { taSeen = s; break; }
  await sleep(500);
}
check('T9 TA 状态机自动运转（抛竿/等待/发呆/休息等）', !!taSeen && taSeen !== 'idle', taSeen);

// ---- T10 深色模式兜底：场景背景切换 ----
const lightBg = await evalJs("getComputedStyle(document.getElementById('fish-scene')).backgroundImage");
await evalJs("(function(){document.documentElement.setAttribute('data-theme','dark');return true;})()");
await sleep(250);
const darkBg = await evalJs("getComputedStyle(document.getElementById('fish-scene')).backgroundImage");
await evalJs("(function(){document.documentElement.removeAttribute('data-theme');return true;})()");
check('T10 深色模式场景背景切换', !!lightBg && !!darkBg && lightBg !== darkBg && darkBg.indexOf('35, 50, 70') >= 0, '');

// ---- T11 兄弟浮层互斥：打开 pong 半框 → 钓鱼自动收起 ----
await evalJs("(function(){window.openFishPanel();return true;})()");
await sleep(250);
await evalJs("(function(){var el=document.getElementById('chat-pong-panel');if(el)el.hidden=false;return true;})()");
await sleep(450);
const t11 = J(await evalJs(`(function(){return JSON.stringify({fishHidden:document.getElementById('chat-fish-panel').hidden});})()`));
check('T11 打开兄弟半框时钓鱼自动收起', t11.fishHidden === true, JSON.stringify(t11));

// ---- T12 弱动效偏好：波纹动画关闭 ----
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(250);
const t12 = await evalJs("getComputedStyle(document.querySelector('.fish-water'),'::before').animationName");
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
check('T12 prefers-reduced-motion 下波纹动画关闭', t12 === 'none', String(t12));

// ---- T14 #763 日封顶用量提示：出过收入后今日页出现 .fish-capnote 且金额与 fishing-coin-day 一致 ----
await evalJs("(function(){window.openFishPanel();document.querySelector('.fish-tab[data-ftab=\"today\"]').click();return true;})()");
await sleep(300);
const t14 = J(await evalJs(`(function(){
  var n=document.querySelector('#fish-page .fish-capnote');
  var k=Object.keys(localStorage).find(function(x){return x.indexOf('fishing-coin-day')>=0;});
  var day=k?JSON.parse(localStorage.getItem(k)):null;
  var y=day&&typeof day.used==='number'?day.used/100:null;
  return JSON.stringify({note:n?n.textContent:null,used:day?day.used:null,amt:y==null?null:y.toFixed(y>=100?0:2)});
})()`));
check('T14 日封顶提示在位且金额=fishing-coin-day 用量（fenToStr 同式）',
  !!t14.note && t14.used > 0 && t14.note.indexOf('上限 ¥104') >= 0 && t14.note.indexOf('¥' + t14.amt) >= 0, JSON.stringify(t14));

// ---- T15 #763 静音偏好持久化：点灭 → 落盘 → 重开面板仍静音（原重开即丢） ----
await evalJs("(function(){document.getElementById('fish-sound').click();return true;})()");
await sleep(150);
const t15a = J(await evalJs(`(function(){
  var b=document.getElementById('fish-sound');
  var k=Object.keys(localStorage).find(function(x){return x.indexOf('fishing-sound')>=0;});
  return JSON.stringify({btn:b.textContent,off:b.classList.contains('off'),raw:k?localStorage.getItem(k):null});
})()`));
await evalJs("(function(){window.closeFishPanel();window.openFishPanel();return true;})()");
await sleep(250);
const t15b = await evalJs("document.getElementById('fish-sound').textContent");
await evalJs("(function(){document.getElementById('fish-sound').click();return true;})()"); /* 复位开声，不污染后续用例 */
check('T15 静音偏好落盘 fishing-sound 且重开面板回读仍静音',
  t15a.btn === '🔇' && t15a.off === true && /"on":false/.test(t15a.raw || '') && t15b === '🔇', JSON.stringify(t15a) + ' 重开=' + t15b);

// ---- T13 全程无 JS 异常 ----
check('T13 全程无 JS 异常', excs.length === 0, excs.join(' | '));

chrome.kill();
server.close();
const fails = results.filter(r => !r.ok);
console.log('\n===== 结果：' + (results.length - fails.length) + '/' + results.length + ' 通过 =====');
process.exit(fails.length ? 1 : 0);
