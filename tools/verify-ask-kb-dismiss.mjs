// ===== 验证（#512）：问问TA / 邀请TA 半框关闭前必须显式收起输入法 =====
// 症状（用户报，红米 K80 Chrome，明说其他机型也有）：聊天【问问TA】发送卡片后手机输入法
// 弹窗收起很慢，输入法位置那半边灰屏一直露着。
// 根因：半框输入框（转 .ce-box 后）此刻持焦，旧实现直接 `chatAskPanel.hidden = true`
//   ＝ 把「聚焦中的可编辑元素」从布局里摘掉，键盘被「元素移除」带走而不是「失焦收起」；
//   一批内核/输入法不为这种移除派 focusout、也不派（或迟很多才派）visualViewport.resize
//   → 移动适配的收起链（focusout 置 _aClosing → 动画期只写 .phone 高度 → vv 回基准复原）
//   与 250ms 轮询全不动作 → .phone 内联收缩高停在键盘期数值 = 输入法位置一直露 body 灰底。
// 修复契约（断言口径）：关面板【前】先 blur（focusout 必须先于面板 hidden 的 mutation），
//   且卡片照常发出、面板照常关闭、键盘会话结束后 .phone 恢复满高（内联清空）。
// 手法：真实 visualViewport 实例上盖可写 height（对象身份不变），改值后 dispatch resize
//   驱动真实键盘链路；发送用程序化 click（最坏情形：焦点不会因点击被内核带走）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
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
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
// RED 基线用：MOCHI_ARTIFACT=<其它 index.html 路径> 时改服务该产物（其余文件仍走工作区），
// 便于「对 HEAD 产物跑红、对修复产物跑绿」的判别力实证（不动工作区产物）。
const ARTIFACT = process.env.MOCHI_ARTIFACT || '';
const server = createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (ARTIFACT && (urlPath === '/' || urlPath === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(ARTIFACT));
      return;
    }
    let p = normalize(join(root, urlPath));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-askdismiss-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('PASS  ' + name + (extra ? '  [' + extra + ']' : '')); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } }

await cdp('Page.enable'); await cdp('Runtime.enable');
// 无头 Chrome 默认「窗口无焦点」，blur() 不会派发 blur/focusout（实测空事件序列）——
// 焦点仿真打开后事件链与真机一致，本脚本的「focusout 先于 hidden」断言才成立。
try { await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) {}
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await sleep(1000);
await evalJs(`(function(){var b=document.getElementById('splash-confirm-ok')||document.getElementById('splash-enter');if(b)b.click();return !!b;})()`);
await sleep(400);
for (let i = 0; i < 20; i++) {
  const r = await evalJs(`(function(){
    var m=document.getElementById('splash-mandatory'); if(!m||m.hidden) return 'none';
    var sc=document.getElementById('splash-mandatory-scroll'); if(sc) sc.scrollTop=sc.scrollHeight;
    var en=document.getElementById('splash-mandatory-enter');
    if(en&&!en.classList.contains('is-disabled')){en.click();return 'entered';} return 'wait';})()`);
  if (r === 'entered' || r === 'none') break;
  await sleep(250);
}
await evalJs(`(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}return true;})()`);
await evalJs(`(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()`);
await sleep(300);
// 页面级零异常计数
await evalJs(`(function(){ window.__errs=[]; window.addEventListener('error',function(e){window.__errs.push(String(e.message||e));}); return true;})()`);
// vv 补丁（键盘模拟）
await evalJs(`(function(){var vv=window.visualViewport;if(!vv.__patched){var h=vv.height;Object.defineProperty(vv,'height',{get:function(){return h;},configurable:true});window.__setVvHeight=function(v){h=v;vv.dispatchEvent(new Event('resize'));};vv.__patched=1;}return true;})()`);
// 事件顺序记录器：focusout 必须先于 #chat-ask-panel hidden 的 mutation
await evalJs(`(function(){
  window.__order=[];
  document.addEventListener('focusout',function(){ window.__order.push('focusout'); },true);
  var panel=document.getElementById('chat-ask-panel');
  if(panel) new MutationObserver(function(){ if(panel.hidden) window.__order.push('hide'); }).observe(panel,{attributes:true,attributeFilter:['hidden']});
  window.__ordReset=function(){ window.__order=[]; };
  return true;})()`);

// 进聊天页 → 更多 → 目标半框
await evalJs(`(function(){var a=document.querySelector('.app[data-app="chat"]');if(a)a.click();return true;})()`);
await sleep(900);

async function openPanel(btn) {
  await evalJs(`['chat-ask-panel','chat-search','chat-decision-panel','poke-card','emoji-panel','chat-more-panel','chat-call-panel'].forEach(function(id){var el=document.getElementById(id);if(el)el.hidden=true;}); window.__setVvHeight && window.__setVvHeight(844);`);
  await sleep(400);
  await evalJs(`document.getElementById('${btn}').click()`);
  await sleep(500);
  // 面板自己在打开后 80ms 的 setTimeout 里给输入框焦点，机器负载高时会更晚——轮询等焦点再断言，
  // 否则前置项（A0/C0/D0）会随机假红（实测 C0 偶发 focused:false，两次复跑又全绿）。
  for (let i = 0; i < 12; i++) {
    const ok = await evalJs(`(function(){var i=document.getElementById('chat-ask-input');var box=i?(i.__ceBox||i):null;return !!box&&document.activeElement===box;})()`);
    if (ok) break;
    await evalJs(`(function(){var i=document.getElementById('chat-ask-input');if(i){var box=i.__ceBox||i;try{box.focus();}catch(e){}}return true;})()`);
    await sleep(100);
  }
  return await evalJs(`(function(){var i=document.getElementById('chat-ask-input');var box=i?(i.__ceBox||i):null;return JSON.stringify({focused:!!box&&document.activeElement===box, hasCe:!!(i&&i.__ceBox), panelHidden:!!document.getElementById('chat-ask-panel').hidden});})()`);
}

// ---------- A) 问问TA 发送 ----------
let st = JSON.parse(await openPanel('more-ask'));
check('A0 前置：问问TA 半框打开且输入框（ce-box）持有焦点', st.focused, JSON.stringify(st));
await evalJs(`(function(){var i=document.getElementById('chat-ask-input');i.value='验证#512问题文本';return true;})()`);
await evalJs('window.__ordReset()');
await evalJs(`document.getElementById('chat-ask-ok').click()`);
await sleep(400);
let order = await evalJs('JSON.stringify(window.__order)');
let ord = JSON.parse(order || '[]');
check('A1 关面板前先收输入法：focusout 先于面板 hidden', ord.indexOf('focusout') >= 0 && ord.indexOf('hide') >= 0 && ord.indexOf('focusout') < ord.indexOf('hide'), order);
check('A2 发送后没有任何文本元素持有焦点（键盘确已开始收起）', await evalJs(`(function(){var a=document.activeElement;if(!a)return true;if(a===document.body)return true;return !(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable);})()`), await evalJs(`(function(){var a=document.activeElement;return a?a.tagName:'none';})()`));
check('A3 卡片照常发出（问问TA 卡进聊天）', await evalJs(`document.body.innerText.indexOf('验证#512问题文本') >= 0`));
check('A4 面板已关闭', await evalJs(`!!document.getElementById('chat-ask-panel').hidden`));

// ---------- B) 键盘会话：发送 → 收起动画 → .phone 恢复满高 ----------
await openPanel('more-ask');
await evalJs(`(function(){var i=document.getElementById('chat-ask-input');i.value='验证#512键盘路径';return true;})()`);
await evalJs('window.__setVvHeight(430)');
await sleep(600);
const shrunk = await evalJs(`document.querySelector('.phone').style.height||'(none)'`);
check('B1 键盘弹出（vv 收缩）时 .phone 收缩到可视高度（原机制接管）', shrunk === '430px', String(shrunk));
await evalJs(`document.getElementById('chat-ask-ok').click()`);
for (const f of [480, 560, 650, 730, 790, 830, 844]) { await evalJs('window.__setVvHeight(' + f + ')'); await sleep(45); }
await sleep(700);
const after = JSON.parse(await evalJs(`(function(){var p=document.querySelector('.phone');return JSON.stringify({h:p.style.height||'(none)',align:p.style.alignSelf||'(none)',top:p.style.top||'(none)'});})()`));
check('B2 键盘收起后 .phone 恢复满高（内联 height/alignSelf/top 全清，无灰底残留）', after.h === '(none)' && after.align === '(none)' && after.top === '(none)', JSON.stringify(after));

// ---------- C) 取消（✕）路同样先收输入法 ----------
st = JSON.parse(await openPanel('more-ask'));
check('C0 前置：再次打开半框且输入框持焦', st.focused, JSON.stringify(st));
await evalJs('window.__ordReset()');
await evalJs(`document.getElementById('chat-ask-cancel').click()`);
await sleep(350);
ord = JSON.parse((await evalJs('JSON.stringify(window.__order)')) || '[]');
check('C1 取消关闭同样先 focusout 再 hidden', ord.indexOf('focusout') >= 0 && ord.indexOf('hide') >= 0 && ord.indexOf('focusout') < ord.indexOf('hide'), JSON.stringify(ord));

// ---------- D) 邀请TA 模式（sendInviteContent 路） ----------
st = JSON.parse(await openPanel('more-invite'));
check('D0 前置：邀请TA 半框打开且输入框持焦', st.focused, JSON.stringify(st));
await evalJs(`(function(){var i=document.getElementById('chat-ask-input');i.value='验证#512邀请文本';return true;})()`);
await evalJs('window.__ordReset()');
await evalJs(`document.getElementById('chat-ask-ok').click()`);
await sleep(500);
ord = JSON.parse((await evalJs('JSON.stringify(window.__order)')) || '[]');
check('D1 邀请发送同样先 focusout 再 hidden', ord.indexOf('focusout') >= 0 && ord.indexOf('hide') >= 0 && ord.indexOf('focusout') < ord.indexOf('hide'), JSON.stringify(ord));
check('D2 邀请卡片照常发出', await evalJs(`document.body.innerText.indexOf('验证#512邀请文本') >= 0`));

// ---------- F) 第二道·有界兜底网（针对「连 focusout / vv.resize 都不派」的内核残留形态） ----------
// 场景构造：真键盘高度残留（vv 停在 430px 且此后不回基准）＋输入框已不持焦。此时主链路四条
// 复原路全拿不到证据（都要「vv 回基准」或「2.2s 无任何活动」），只剩这道网能把 .phone 收回来。
// RED/GREEN 对照在页内完成，不需要第二份产物：把 window.mochiKbDismiss 临时换成空实现＝模拟
// 「没有这道网」，同一条路径走一遍；再换回真实现走一遍。两次都在 2.2s 看门狗窗口内断言。
check('F0 兜底网已装配（window.mochiKbDismiss 是函数）', await evalJs('typeof window.mochiKbDismiss === "function"'));
await evalJs('window.__realKbDismiss = window.mochiKbDismiss; true');

async function stuckGrayRound(stub) {
  await evalJs(`window.mochiKbDismiss = ${stub ? 'function () {}' : 'window.__realKbDismiss'};`);
  await openPanel('more-ask');
  await evalJs(`(function(){var i=document.getElementById('chat-ask-input');i.value='验证#512兜底';return true;})()`);
  await evalJs('window.__setVvHeight(430)');
  await sleep(650); // 键盘期读数先稳住（兜底要求 vv 500ms 内无变化）
  await evalJs(`document.getElementById('chat-ask-cancel').click()`); // 失焦 + 关面板 + 向移动层报备
  await sleep(1400); // 越过 800ms 判定点 + 一次 400ms 复查，仍在 2.2s 看门狗窗口内
  return JSON.parse(await evalJs(`(function(){var p=document.querySelector('.phone');return JSON.stringify({h:p.style.height||'(none)',healAt:window.__mochiKbDismissHealAt||0});})()`));
}

const fRed = await stuckGrayRound(true);
check('F1 无兜底网时灰底残留（对照）：vv 不回基准则 .phone 收缩高卡住不回收', fRed.h !== '(none)', JSON.stringify(fRed));
const fGreen = await stuckGrayRound(false);
check('F2 有兜底网时同样形态被收回（.phone 内联高清空）', fGreen.h === '(none)', JSON.stringify(fGreen));
check('F3 兜底网确实动作过（__mochiKbDismissHealAt 留痕）', fGreen.healAt > 0, String(fGreen.healAt));

// ---------- E) 零异常 ----------
const errs = JSON.parse((await evalJs('JSON.stringify(window.__errs)')) || '[]');
check('E1 全流程零脚本异常', errs.length === 0, JSON.stringify(errs).slice(0, 200));

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(fail ? 1 : 0);
