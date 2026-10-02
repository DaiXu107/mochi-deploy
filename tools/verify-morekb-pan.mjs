// ===== 专项验证：键盘期「浏览器把页面平移走」自愈（红米 K80 Chrome 报修复现） =====
// 用户报修（红米 K80 Chrome）：聊天「更多功能」里的小功能页面打开后，输入框一聚焦
// 键盘升起，整个页面位置飞掉、下方全灰；帮我决定里打字，输入位置不弹到屏幕上方。
// 根因：安卓分支没有 iOS 分支的「防浏览器平移」自愈。K80 Chrome（resizes-visual）
// 聚焦底部半框内输入框时，Chrome 先把视觉视口往下平移（vv.offsetTop>0，必要时还滚
// 文档）让焦点可见；随后本模块才把 .phone 收缩到可视高度——平移残留不归零：
// .phone（普通流）整体被推出屏幕上方，其下露出 body 底色=大面积灰色。
// 修复：syncAndroidKb / _aProvDock 收缩后 + _aWatch 轮询里做 _aPinPan()——
//   键盘开启期间检测到 vv.offsetTop / window 滚动偏移，且焦点已在可视区内
//   （或偏移大到必然露灰）就归零（对齐 iOS pinScrollTop/healKbScroll）；
//   另加 kbDockEnsureVisible()：fixed 停靠后若面板整体仍在可视区下沿之外
//   （该内核 fixed 不随可视区上移、仍锚定布局视口），摘回 absolute 锚定收缩后的
//   .phone 底部——两种内核行为下面板都必然停在输入栏上方。
// 方法：无头 Chrome + 安卓 UA + 进入「更多功能→帮我决定」→ 触摸聚焦面板输入框 →
//       按 K80 真实时序模拟 vv 平移(offsetTop) + vv 收缩(height) → 断言自愈。
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

const tmpDir = mkdtempSync(join(tmpdir(), 'mochi-verify-morekbpan-'));
writeFileSync(join(tmpDir, 'index.html'), readFileSync(join(root, 'index.html'), 'utf8'));
const baseUrl = 'file:///' + normalize(tmpDir).split(sep).join('/') + '/index.html';
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-audio-output', '--disable-component-extensions-with-background-pages', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-morekbpan-' + Date.now()),
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
async function touchEl(id) {
  await evalJs(`(function(){var el=document.getElementById('${id}');if(!el)return false;var b=el.getBoundingClientRect();var ev=new TouchEvent('touchstart',{bubbles:true,cancelable:true,composed:true,clientX:b.x+b.width/2,clientY:b.y+b.height/2});try{Object.defineProperty(ev,'target',{value:el});}catch(e){}el.dispatchEvent(ev);window.__lastTouchTarget=el;return true;})()`);
}
// 几何快照：全部换算成【屏幕坐标】（布局坐标 - vv.offsetTop），offT/winY 单列便于断言
async function snap() {
  const s = await evalJs(`(function(){
    var vv=window.visualViewport;
    var offT=vv?Math.round(vv.offsetTop||0):0;
    var vh=vv?Math.round(vv.height):0;
    function scr(r){return r?{top:Math.round(r.top)-offT,bottom:Math.round(r.bottom)-offT}:null;}
    var p=document.querySelector('.phone');var pr=p?p.getBoundingClientRect():null;
    var panel=document.getElementById('chat-decision-panel');
    var panelR=panel&&!panel.hidden?panel.getBoundingClientRect():null;
    var qa=document.getElementById('dec-q-a');var qaEl=qa?(qa.__ceBox||qa):null;
    var winY=0;try{winY=window.scrollY||document.documentElement.scrollTop||document.body.scrollTop||0;}catch(e){}
    var pos=panel?getComputedStyle(panel).position:null;
    return JSON.stringify({vh:vh,offT:offT,winY:Math.round(winY),
      phoneH:p.style.height||'(none)',pos:pos,
      phone:scr(pr),panel:scr(panelR),qa:scr(qaEl?qaEl.getBoundingClientRect():null)});
  })()`);
  return JSON.parse(s);
}
function check(name, cond, detail) { console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (detail !== undefined ? '  实际=' + JSON.stringify(detail) : '')); return cond; }
function inView(o, vh, margin) { margin = margin || 2; return o && o.top >= -margin && o.bottom <= vh + margin; }

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
  await evalJs(`(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()`);
  await sleep(400);

  // 打桩 visualViewport：height/offsetTop 可写 + scrollTo 真实生效 + 派发 resize/scroll
  // （模拟 K80 内核行为：浏览器自行平移 offsetTop；页面调 vv.scrollTo 能复位——
  //   与 iOS 分支 pinScrollTop 在 iOS Edge 上已验证的机制一致）
  await evalJs(`(function(){
    var vv=window.visualViewport;if(vv.__patched)return true;
    var h=vv.height,offT=0;
    Object.defineProperty(vv,'height',{get:function(){return h;},configurable:true});
    Object.defineProperty(vv,'offsetTop',{get:function(){return offT;},configurable:true});
    window.__setVvHeight=function(v){h=v;vv.dispatchEvent(new Event('resize'));};
    window.__setVvOff=function(v){offT=v;vv.dispatchEvent(new Event('scroll'));};
    vv.scrollTo=function(x,y){if(offT!==(y||0)){offT=y||0;try{vv.dispatchEvent(new Event('scroll'));}catch(e){}}};
    vv.__patched=1;return true;})()`);

  // 打开更多功能 → 帮我决定
  await evalJs(`(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()`);
  await sleep(400);
  await evalJs(`(function(){var b=document.getElementById('more-decide');b.click();return true;})()`);
  await sleep(400);

  // ===== 场景1：K80 真实时序——聚焦后 Chrome 先平移(offsetTop=300)再收缩(vv=400) =====
  await touchEl('dec-q-a');
  await sleep(60);
  await evalJs(`(function(){var i=document.getElementById('dec-q-a');if(i){i.focus();i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));}return true;})()`);
  await sleep(150);
  await evalJs('window.__setVvOff(300)');
  await evalJs('window.__setVvHeight(400)');
  await sleep(1600); // 等 _aWatch 轮询自愈

  let s = await snap();
  let ok = s.offT <= 1 && s.winY <= 1;
  check('场景1 平移归零：vv.offsetTop/window.scrollY 复位（修复前残留 300=整页飞走）', ok, s);
  if (ok) pass++; else fail++;
  ok = s.phoneH === '400px' && inView(s.phone, s.vh);
  check('场景1 .phone 已收缩且完整落在可视区内（不飞走、下方不露灰）', ok, s);
  if (ok) pass++; else fail++;
  ok = inView(s.qa, s.vh) && s.qa && s.qa.top >= 0;
  check('场景1 帮我决定输入框完整可见（弹到键盘上方）', ok, s);
  if (ok) pass++; else fail++;
  ok = inView(s.panel, s.vh);
  check('场景1 面板整体落在可视区内', ok, s);
  if (ok) pass++; else fail++;

  // ===== 场景2：打字稳态期浏览器再次平移(offsetTop=140) → 轮询自愈 =====
  await evalJs('window.__setVvOff(140)');
  await sleep(900);
  s = await snap();
  ok = s.offT <= 1 && inView(s.phone, s.vh) && inView(s.qa, s.vh);
  check('场景2 打字中再次平移也能归零且布局不破', ok, s);
  if (ok) pass++; else fail++;

  // ===== 场景3：键盘收起 → 全部复原 =====
  await evalJs('window.__setVvOff(0)');
  await evalJs('window.__setVvHeight(844)');
  await sleep(900);
  s = await snap();
  ok = s.phoneH === '(none)' && s.pos !== 'fixed' && inView(s.phone, s.vh) && s.panel && s.panel.bottom <= s.phone.bottom - 80;
  check('场景3 键盘收起：.phone 与面板复原到无键盘状态', ok, s);
  if (ok) pass++; else fail++;

  // ===== 场景4：悬浮内核路径（vv 不变，58% 推定停靠）同样要归零平移 =====
  await touchEl('dec-q-a');
  await sleep(60);
  await evalJs(`(function(){var i=document.getElementById('dec-q-a');if(i){i.focus();i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));}return true;})()`);
  // 等推定停靠生效（focus 后 950ms 复查；触摸须在 1.5s 武装窗内）
  let provOk = false;
  for (let i = 0; i < 24; i++) {
    await sleep(150);
    const t = await snap();
    if (t.phoneH !== '(none)' && t.phoneH !== String(t.vh) + 'px') { provOk = true; break; }
  }
  await evalJs('window.__setVvOff(260)');
  // 续期活动基线（防「2200ms 无活动=键盘已收」自愈清推顶干扰断言）
  await touchEl('dec-q-a');
  await sleep(800);
  s = await snap();
  ok = s.offT <= 1 && provOk && s.phoneH !== '(none)' && inView(s.phone, s.vh) && inView(s.qa, s.vh);
  check('场景4 悬浮内核推定停靠路径：平移同样归零、面板可见', ok, s);
  if (ok) pass++; else fail++;

  // 收尾复原
  await evalJs(`(function(){var a=document.activeElement;if(a&&a.blur)a.blur();return true;})()`);
  await evalJs('window.__setVvOff(0)');
  await sleep(600);
} finally {
  try { chrome.kill(); } catch (e) {}
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
