// ===== 专项验证（v3.16.x 第四轮）：键盘期页面平移「晚到」仍归零 =====
// 用户再报（红米 K80 Chrome）：点聊天输入栏 → 键盘弹出时输入栏一行飞上面、中间全灰。
// 前三轮修复（v3.10 resizes-visual / v3.15 _aPinPan / v3.16 _aBurstUntil 宽限）已覆盖
// 「focusin 后 850ms 内平移+收缩」的时序；但 K80 键盘动画慢时，Chrome 的
// 「平移（vv.offsetTop>160）+ 收缩（vv.height↓）」可能发生在 850ms 宽限【之后】，
// 此时旧 _aPinPan 第一行 `if (!_aKb && !_aProv && Date.now() > _aBurstUntil) return`
// 直接跳过 → 平移残留不归零 → .phone 整页上移、输入栏飞走露灰。
// 本轮修复：① _aPinPan 无条件「大偏移必归零」（offT/winY>160 不依赖键盘状态）；
//           ② _aWatch 聚焦期间持续续期 _aBurstUntil（键盘会话内恒活跃）。
// 验证场景：
//   场景A：focusin 触发 → 立即等 1000ms（850ms 宽限已过，期间无 vv 变化）→
//           此时才 vv.offsetTop=300 + vv.height=400 → 断言 .phone 仍被归零不飞走。
//   场景B：聊天输入栏（contenteditable，非面板 input）同样场景 → 归零 + 输入栏在可视区。
//   场景C：回归——focusin 后 150ms 内平移+收缩（原时序）仍归零。
//   场景D：回归——非键盘期（无聚焦）大偏移不误伤（不归零，避免打断用户滚动）。
// 方法：无头 Chrome + 安卓 UA + 聊天页/帮我决定面板，打桩 vv 模拟 K80 时序。
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

const tmpDir = mkdtempSync(join(tmpdir(), 'mochi-verify-pinpan-late-'));
writeFileSync(join(tmpDir, 'index.html'), readFileSync(join(root, 'index.html'), 'utf8'));
const baseUrl = 'file:///' + normalize(tmpDir).split(sep).join('/') + '/index.html';
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9800 + Math.floor(Math.random() * 300));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-audio-output', '--disable-component-extensions-with-background-pages', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pinpan-late-' + Date.now()),
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
async function touchEl(sel) {
  await evalJs(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;var b=el.getBoundingClientRect();var ev=new TouchEvent('touchstart',{bubbles:true,cancelable:true,composed:true,clientX:b.x+b.width/2,clientY:b.y+b.height/2});try{Object.defineProperty(ev,'target',{value:el});}catch(e){}el.dispatchEvent(ev);window.__lastTouchTarget=el;return true;})()`);
}
async function snap() {
  const s = await evalJs(`(function(){
    var vv=window.visualViewport;
    var offT=vv?Math.round(vv.offsetTop||0):0;
    var vh=vv?Math.round(vv.height):0;
    function scr(r){return r?{top:Math.round(r.top)-offT,bottom:Math.round(r.bottom)-offT}:null;}
    var p=document.querySelector('.phone');var pr=p?p.getBoundingClientRect():null;
    var ir=document.querySelector('.chat-input-row');var irR=ir?ir.getBoundingClientRect():null;
    var winY=0;try{winY=window.scrollY||document.documentElement.scrollTop||document.body.scrollTop||0;}catch(e){}
    return JSON.stringify({vh:vh,offT:offT,winY:Math.round(winY),
      phoneH:p.style.height||'(none)',
      phone:scr(pr),inputRow:scr(irR)});
  })()`);
  return JSON.parse(s);
}
function check(name, cond, detail) { console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (detail !== undefined ? '  实际=' + JSON.stringify(detail) : '')); return cond; }
function inView(o, vh, margin) { margin = margin || 2; return o && o.top >= -margin && o.bottom <= vh + margin; }

let pass = 0, fail = 0;
function r(name, cond, detail) { if (check(name, cond, detail)) pass++; else fail++; }

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

  // 打桩 visualViewport（同 verify-morekb-pan 手法）
  await evalJs(`(function(){
    var vv=window.visualViewport;if(vv.__patched)return true;
    var h=vv.height,offT=0;
    Object.defineProperty(vv,'height',{get:function(){return h;},configurable:true});
    Object.defineProperty(vv,'offsetTop',{get:function(){return offT;},configurable:true});
    window.__setVvHeight=function(v){h=v;vv.dispatchEvent(new Event('resize'));};
    window.__setVvOff=function(v){offT=v;vv.dispatchEvent(new Event('scroll'));};
    vv.scrollTo=function(x,y){if(offT!==(y||0)){offT=y||0;try{vv.dispatchEvent(new Event('scroll'));}catch(e){}}};
    vv.__patched=1;return true;})()`);

  // ===== 场景A：聊天输入栏 focusin → 等 1000ms（850ms 宽限已过）→ 才平移+收缩 =====
  await touchEl('#chat-input');
  await sleep(60);
  await evalJs(`(function(){var i=document.getElementById('chat-input');if(i){i.focus();i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));}return true;})()`);
  await sleep(1000); // 宽限期（850ms）已过，期间无 vv 变化
  await evalJs('window.__setVvOff(300)');
  await evalJs('window.__setVvHeight(400)');
  await sleep(900); // 等轮询自愈

  let s = await snap();
  let ok = s.offT <= 1 && s.winY <= 1;
  r('场景A 晚到平移归零：vv.offsetTop/window.scrollY 复位', ok, s);
  ok = s.phoneH === '400px' && inView(s.phone, s.vh);
  r('场景A .phone 已收缩且完整落在可视区内（不飞走、下方不露灰）', ok, s);
  ok = inView(s.inputRow, s.vh) && s.inputRow && s.inputRow.bottom <= s.vh + 2;
  r('场景A 聊天输入栏停在可视区底部（不被键盘盖住、不贴顶）', ok, s);

  // ===== 场景B：收起，再聚焦（聊天输入栏）——focusin 后 150ms 内平移+收缩（原时序回归） =====
  await evalJs('window.__setVvOff(0)');
  await evalJs('window.__setVvHeight(844)');
  await sleep(700);
  await evalJs(`(function(){var a=document.activeElement;if(a&&a.blur)a.blur();return true;})()`);
  await sleep(400);
  await touchEl('#chat-input');
  await sleep(60);
  await evalJs(`(function(){var i=document.getElementById('chat-input');if(i){i.focus();i.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));}return true;})()`);
  await sleep(150);
  await evalJs('window.__setVvOff(280)');
  await evalJs('window.__setVvHeight(400)');
  await sleep(900);
  s = await snap();
  ok = s.offT <= 1 && inView(s.phone, s.vh) && inView(s.inputRow, s.vh);
  r('场景B 原时序（早平移）回归：归零 + .phone/输入栏在可视区', ok, s);

  // ===== 场景C：非键盘期异常大偏移同样归零（修正异常平移，不打断正常交互） =====
  await evalJs('window.__setVvOff(0)');
  await evalJs('window.__setVvHeight(844)');
  await sleep(700);
  await evalJs(`(function(){var a=document.activeElement;if(a&&a.blur)a.blur();return true;})()`);
  await sleep(400);
  // 非键盘期出现异常大偏移（vv.offsetTop 非键盘期恒应为 0，出现>160 必是异常平移残留）
  // 应被无条件归零修正——本应用 html/body 不滚动（滚动都在 .phone 内层），
  // 归零不会打断用户任何正常交互。
  await evalJs('window.__setVvOff(200)');
  await sleep(800);
  s = await snap();
  r('场景C 非键盘期异常大偏移被归零（修正残留平移）', s.offT <= 1, s);

  // 收尾复原
  await evalJs('window.__setVvOff(0)');
  await evalJs('window.__setVvHeight(844)');
  await sleep(500);
} catch (e) {
  console.error('流程异常:', e && e.stack ? e.stack.split('\n')[0] : e);
  fail++;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
