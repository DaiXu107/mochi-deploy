// ===== 专项验证：更多功能面板内小功能输入框聚焦→键盘弹出，面板不被挤出视口/露灰 =====
// 用户报修（手机端）：聊天「更多功能」里的小功能（帮我决定/占卜/问问TA等）点输入栏，
// 键盘弹出后面板被错误挤压到输入栏一行下方、中间出现大面积无用灰色。
// 根因：面板 absolute 锚定 .phone 底部（bottom:96px），键盘弹出时 .phone 被收缩到
//       可视高度（syncAndroidKb / 推定停靠），面板 bottom 锚点退出视口 → 面板整体被
//       推出可视区下方（输入框消失、输入栏下露 .phone 底色=大面积灰色）。
// 修复：键盘弹起（.phone 收缩）时 mobile-adapt.js 把可见的底部半框改 fixed 停靠在
//       可视区底部=输入栏上方（kbDockPanels），键盘收起/面板关闭时还原（kbUndockPanels）。
// 方法：无头 Chrome + 安卓 UA + 触摸流进入「更多功能→帮我决定」→ 触摸面板输入框 →
//       模拟 vv 收缩（键盘弹出）→ 断言面板与输入框完整落在可视区内。
import { spawn } from 'node:child_process';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const tmpDir = mkdtempSync(join(tmpdir(), 'mochi-verify-morekb-'));
writeFileSync(join(tmpDir, 'index.html'), readFileSync(join(root, 'index.html'), 'utf8'));
const baseUrl = 'file:///' + normalize(tmpDir).split(sep).join('/') + '/index.html';
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9400 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-audio-output', '--disable-component-extensions-with-background-pages', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-morekb-' + Date.now()),
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
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { const ed = r.exceptionDetails; const edes = (ed.exception && ed.exception.description) || ed.text || ''; console.error('JS 异常:', String(edes).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
async function touchAt(x, y) {
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// 直接对元素派发 touchstart（target=元素本身，确保 kbTouchArmed 命中保底停靠武装）
async function touchEl(id) {
  await evalJs(`(function(){var el=document.getElementById('${id}');if(!el)return false;var b=el.getBoundingClientRect();var ev=new TouchEvent('touchstart',{bubbles:true,cancelable:true,composed:true,clientX:b.x+b.width/2,clientY:b.y+b.height/2});try{Object.defineProperty(ev,'target',{value:el});}catch(e){}el.dispatchEvent(ev);window.__lastTouchTarget=el;return true;})()`);
}
async function snap() {
  const s = await evalJs(`(function(){
    var p=document.querySelector('.phone');var pr=p.getBoundingClientRect();
    var panel=document.getElementById('chat-decision-panel');
    var panelR=panel&&!panel.hidden?panel.getBoundingClientRect():null;
    var qa=document.getElementById('dec-q-a');var qaEl=qa?(qa.__ceBox||qa):null;
    var qaR=qaEl?qaEl.getBoundingClientRect():null;
    var vv=window.visualViewport;
    return JSON.stringify({phoneH:p.style.height||'(none)',phoneRectH:Math.round(pr.height),
      phoneTop:Math.round(pr.top),phoneBottom:Math.round(pr.bottom),
      vvH:Math.round(vv?vv.height:0),
      panelPos:panel?getComputedStyle(panel).position:null,
      panel:panelR?{top:Math.round(panelR.top),bottom:Math.round(panelR.bottom)}:null,
      qa:qaR?{top:Math.round(qaR.top),bottom:Math.round(qaR.bottom)}:null});
  })()`);
  return JSON.parse(s);
}
function check(name, cond, detail) { console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (detail !== undefined ? '  实际=' + JSON.stringify(detail) : '')); return cond; }

let pass = 0, fail = 0;
try {
  await cdpConnect();
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1000);
  await evalJs(`(function(){var b=document.querySelector('.splash-confirm-btn')||document.getElementById('splash-confirm-ok');if(b){b.click();}var s=document.getElementById('splash');if(s)s.hidden=true;return true;})()`);
  await sleep(300);

  // 直接进入聊天页（file:// 无首页点进流程）
  await evalJs(`(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()`);
  await sleep(400);
  // 打开更多功能面板
  console.error('bodyFirst? ' + await evalJs(`(function(){var b=document.body.firstElementChild;return b?b.tagName+'#'+(b.id||'')+'.'+String(b.className).slice(0,20):'none';})()`));
  console.error('htmlLen? ' + await evalJs(`document.documentElement.outerHTML.length`));
  console.error('moreBtn存在? ' + await evalJs(`!!document.getElementById('chat-more-btn')`));
  console.error('page-chat visible? ' + await evalJs(`(function(){var p=document.getElementById('page-chat');return p?{hidden:p.hidden,display:getComputedStyle(p).display}:'no';})()`));
  console.error('splash? ' + await evalJs(`(function(){var s=document.getElementById('splash');return s?{hidden:s.hidden,display:getComputedStyle(s).display}:'no';})()`));
  await evalJs(`(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()`);
  await sleep(400);
  // 帮我决定
  await evalJs(`(function(){var b=document.getElementById('more-decide');b.click();return true;})()`);
  await sleep(400);

  // 触摸面板内输入框 + 聚焦（保底停靠武装 + 正常键盘路径的 focus）
  await touchEl('dec-q-a');
  await sleep(60);
  await evalJs(`(function(){var i=document.getElementById('dec-q-a');if(i){i.focus();i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));}return true;})()`);
  await sleep(300);

  let s = await snap();
  // 基线：面板/输入框在 .phone 底部 96px 上方（bottom:748），无键盘不收缩
  let ok = s.phoneH === '(none)' && s.panel && s.panel.bottom <= s.phoneBottom - 80;
  check('无键盘：.phone 不收缩且面板完整在底部', ok, s);
  if (ok) pass++; else fail++;

  // 等 _aProvCheck 复查窗口（悬浮键盘推定停靠路径：vv 纹丝不动也应保底停靠）
  await sleep(1900);
  s = await snap();
  const inView = (s.panel && s.panel.bottom <= s.vvH + 2 && s.panel.top >= -2 && s.qa && s.qa.bottom <= s.vvH + 2 && s.qa.top >= -2);
  ok = s.phoneH !== '(none)' && inView;
  check('悬浮键盘推定停靠后：面板/输入框仍在可视区内（不被挤出视口）', ok, s);
  if (ok) pass++; else fail++;

  // 模拟真实键盘弹出（vv 收缩 480）→ 正常机制接管
  await evalJs(`(function(){var vv=window.visualViewport;if(!vv.__patched){var h=vv.height;Object.defineProperty(vv,'height',{get:function(){return h;},configurable:true});window.__setVvHeight=function(v){h=v;vv.dispatchEvent(new Event('resize'));};vv.__patched=1;}return true;})()`);
  await evalJs('window.__setVvHeight(480)');
  await sleep(700);
  s = await snap();
  // v3.15.x：断言用户可见结果而非内部机制——键盘弹出后 .phone 收缩、面板/输入框
  // 完整落在可视区内（fixed 随可视区上移的内核保持 fixed；不随的内核由
  // kbDockEnsureVisible 摘回 absolute 锚定收缩后的 .phone，两种路径面板都可见）。
  ok = s.phoneH === '480px' && s.panel && s.panel.bottom <= s.vvH + 2 && s.panel.top >= -2 &&
    s.qa && s.qa.bottom <= s.vvH + 2 && s.qa.top >= -2;
  check('真实键盘 vv=480：面板/输入框完整落在可视区内', ok, s);
  if (ok) pass++; else fail++;

  // 键盘收起 → 面板还原 absolute 锚定 .phone 底部
  await evalJs('window.__setVvHeight(844)');
  await sleep(900);
  s = await snap();
  ok = s.phoneH === '(none)' && s.panel && s.panel.bottom <= s.phoneBottom - 80;
  check('键盘收起：.phone 与面板复原到无键盘状态', ok, s);
  if (ok) pass++; else fail++;

  // 键盘期间新打开另一个功能面板（占卜）也应自动停靠
  await evalJs('window.__setVvHeight(480)');
  await sleep(600);
  await evalJs(`(function(){var b=document.getElementById('more-divine');b.click();return true;})()`);
  await sleep(400);
  s = await evalJs(`(function(){
    var panel=document.getElementById('chat-divine-panel');
    if(!panel||panel.hidden)return JSON.stringify({hidden:true});
    var r=panel.getBoundingClientRect();
    var pos=getComputedStyle(panel).position;
    return JSON.stringify({pos:pos,top:Math.round(r.top),bottom:Math.round(r.bottom)});
  })()`);
  const ds = JSON.parse(s);
  // 键盘期间新开面板走 absolute 锚定收缩后的 .phone（bottom:96px → 480-96=384），
  // 面板完整落在可视区内即可（修复前旧版在 vv 收缩后也会如此，此处防回归）
  ok = ds.bottom <= 480 + 2 && ds.top >= -2;
  check('键盘期间新开面板：完整落在可视区内', ok, ds);
  if (ok) pass++; else fail++;
} finally {
  try { chrome.kill(); } catch (e) {}
  try { } catch (e) {}
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
