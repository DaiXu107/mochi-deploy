// ===== 回归脚本：#651 通话功能页「打开来电弹窗预览」＋「通话半框背景」半框内上传/移除入口 =====
// 用法：node tools/verify-call-view.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-call-view.mjs   （测临时构建副本）
// 用户需求（2026-09-17）：聊天「更多功能→通话」功能页里，①能直接打开「联系人来电」时的大弹窗
// （.call-mask/.call-panel，非迷你小框 #call-mini）查看效果；②能直接上传/移除通话半框专属背景
// （与设置页同键 call-half-bg，#641 引入，此前只在设置页有入口）。
// 断言：
//   A 轴（源码锚）：三行在 template.html；预览/让位/绑定在 call.js；功能大全文案接入两行。
//   B 轴（真实产物）：预览打开＝来电画面（标题带·预览、状态对方来电、接听/拒绝在位）；
//                     点任意处退出且标题复原；预览中真实去电立即让位（拦截层被拆、
//                     标题复原、去电画面正常）；半框背景经 xyStore 写入后重载，
//                     设置页与功能页两处行同步「已设置」+半框涂背景；功能页移除行点击后
//                     两处回「默认」+背景清除+存储键删除。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚 ----------
let tplSrc = '', callSrc = '', hubSrc = '';
try { tplSrc = readFileSync(join(root, 'src/template.html'), 'utf8'); } catch (e) {}
try { callSrc = readFileSync(join(root, 'src/js/call.js'), 'utf8'); } catch (e) {}
try { hubSrc = readFileSync(join(root, 'src/js/feature-hub.js'), 'utf8'); } catch (e) {}
check('A1 通话功能页三行在模板（半框背景上传/移除＋打开来电弹窗）',
  tplSrc.includes('id="call-half-bg-edit-row"') && tplSrc.includes('id="call-half-bg-edit-remove"') && tplSrc.includes('id="call-view-row"'));
check('A2 预览核心在位（预览开/关函数＋拦截层退出绑定）',
  callSrc.includes('function previewCallPopup()') && callSrc.includes('function closeCallPreview()') &&
  callSrc.includes("catcher.addEventListener('click', closeCallPreview);"));
check('A3 预览让位真实来电（incomingCall 拆拦截层＋placeCall 先拆预览）',
  callSrc.includes('closeCallPreview();\n    closeImageOverlay();') && callSrc.includes('#651：预览中手动拨打'));
check('A4 预览不碰真实通话（#987 起：有真实通话时展开真实面板，不构造预览、不触发接听/拒绝）',
  callSrc.includes('if (currentCall) {') && callSrc.includes("toast('通话中·已展开通话面板');") &&
  !callSrc.includes("toast('当前正在通话中')"));
check('A5 半框背景行绑定同键 call-half-bg＋applyCallHalfBg 同步功能页行回显',
  callSrc.includes("callHalfBgEditRow.addEventListener('click'") && callSrc.includes("document.getElementById('call-half-bg-edit-val')"));
check('A6 功能大全文案接入两行（预览＋半框内入口）',
  hubSrc.includes("'#call-view-row'") && hubSrc.includes("'#call-half-bg-edit-row'"));
if (results.some(r => !r.ok)) {
  console.log('----');
  console.log('A 轴有 FAIL：源码锚缺失（修复被覆盖或未接入），B 轴跳过');
  process.exit(1);
}

// ---------- B 轴：真实浏览器行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----');
  console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  process.exit(2);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9980 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-651-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsErrors.push((d && d.exception && d.exception.description || d && d.text || 'js error').slice(0, 200));
          }
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
    if (r && r.exceptionDetails) {
      jsErrors.push((r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval err').slice(0, 200));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    const ok = await evalJs(`!!(document.getElementById('more-call') && document.getElementById('call-view-row') && window.openChatCallPanel)`);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}
async function openCallPanel() {
  // 进聊天页（优先 enterChat，兜底点桌面 chat 图标）→ 点「更多功能→通话」展开半框
  await evalJs(`(function(){ if (window.enterChat) { window.enterChat(); return 'enter'; } var el = document.querySelector('.app[data-app="chat"]'); if (el) { el.click(); return 'click'; } return 'none'; })()`);
  await sleep(250);
  await evalJs(`(function(){ var b = document.getElementById('more-call'); if (b) { b.click(); return 'ok'; } return 'no-btn'; })()`);
  await sleep(250);
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!await waitReady()) throw new Error('应用未就绪（#more-call/#call-view-row 未挂载）');

  // B1 通话功能页展开：三行在位、半框背景两处行默认「默认」、移除行隐藏
  await openCallPanel();
  const b1 = await evalJs(`(function(){
    var panel = document.getElementById('chat-call-panel');
    var v1 = document.getElementById('call-half-bg-edit-val'), rm = document.getElementById('call-half-bg-edit-remove');
    var vr = document.getElementById('call-view-row');
    return JSON.stringify({ open: panel && !panel.hidden, editVal: v1 && v1.textContent, rmHidden: rm ? rm.hidden : null, hasView: !!vr });
  })()`);
  let o = null; try { o = JSON.parse(b1); } catch (e) {}
  check('B1 半框展开·三行在位·背景默认「默认」·移除行隐藏', o && o.open === true && o.editVal === '默认' && o.rmHidden === true && o.hasView === true, b1);

  // B2 点「打开来电弹窗」→ 来电画面：标题带·预览、状态对方来电、接听/拒绝在位、拦截层在
  await evalJs(`document.getElementById('call-view-row').click()`);
  await sleep(150);
  const b2 = await evalJs(`(function(){
    var m = document.getElementById('call-mask');
    var title = m && m.querySelector('.call-title');
    return JSON.stringify({
      shown: m && !m.hidden,
      title: title && title.textContent,
      status: (document.getElementById('call-status') || {}).textContent,
      answer: !(document.getElementById('call-answer-btn') || {}).hidden,
      reject: !(document.getElementById('call-reject-btn') || {}).hidden,
      catcher: !!document.getElementById('call-preview-catcher')
    });
  })()`);
  o = null; try { o = JSON.parse(b2); } catch (e) {}
  check('B2 预览＝来电画面（·预览标题/对方来电/接听+拒绝/拦截层）',
    o && o.shown === true && (o.title || '').indexOf('预览') >= 0 && o.status === '对方来电...' && o.answer === true && o.reject === true && o.catcher === true, b2);

  // B3 点拦截层（任意处）退出：弹层收起、拦截层拆除、标题复原、按钮归位
  await evalJs(`document.getElementById('call-preview-catcher').click()`);
  await sleep(150);
  const b3 = await evalJs(`(function(){
    var m = document.getElementById('call-mask');
    var title = m && m.querySelector('.call-title');
    return JSON.stringify({
      hidden: m && m.hidden,
      title: title && title.textContent,
      catcherGone: !document.getElementById('call-preview-catcher'),
      answerHidden: (document.getElementById('call-answer-btn') || {}).hidden
    });
  })()`);
  o = null; try { o = JSON.parse(b3); } catch (e) {}
  check('B3 点任意处退出·标题复原「语音通话」·拦截层拆除', o && o.hidden === true && o.title === '语音通话' && o.catcherGone === true && o.answerHidden === true, b3);

  // B4 预览中真实去电：预览立即让位（拦截层拆除/标题复原），去电画面正常，挂断后收起
  await evalJs(`document.getElementById('call-view-row').click()`);
  await sleep(150);
  await evalJs(`window.placeCall && window.placeCall()`);
  await sleep(400);
  const b4 = await evalJs(`(function(){
    var m = document.getElementById('call-mask');
    var title = m && m.querySelector('.call-title');
    var st = { shown: m && !m.hidden, title: title && title.textContent,
      status: (document.getElementById('call-status') || {}).textContent,
      catcherGone: !document.getElementById('call-preview-catcher') };
    try { window.hangupCall && window.hangupCall(); } catch (e) {}
    return JSON.stringify(st);
  })()`);
  o = null; try { o = JSON.parse(b4); } catch (e) {}
  check('B4 预览中真实去电立即让位（标题复原·拦截层拆除·「正在呼叫...」）',
    o && o.shown === true && o.title === '语音通话' && o.status === '正在呼叫...' && o.catcherGone === true, b4);
  await sleep(200);
  const b4b = await evalJs(`JSON.stringify({ hidden: document.getElementById('call-mask').hidden })`);
  o = null; try { o = JSON.parse(b4b); } catch (e) {}
  check('B4b 挂断后弹层收起（预览未复活化）', o && o.hidden === true, b4b);

  // B5 半框背景：走 xyStore 写 call-half-bg（与上传同一落点）→ 重载后设置页与功能页两处行同步
  const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  await evalJs(`(function(){ var s = window.xyStore && window.xyStore('xy-home-v2:' + (window.__activeCid || 'default')); if (!s) return 'no-store'; s.set('call-half-bg', ${JSON.stringify(GIF)}); return 'ok'; })()`);
  await sleep(150);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!await waitReady()) throw new Error('重载后应用未就绪');
  await sleep(300);
  const b5 = await evalJs(`(function(){
    var panel = document.getElementById('chat-call-panel');
    var card = document.querySelector('.call-panel');
    return JSON.stringify({
      editVal: (document.getElementById('call-half-bg-edit-val') || {}).textContent,
      editRmShown: document.getElementById('call-half-bg-edit-remove') && !document.getElementById('call-half-bg-edit-remove').hidden,
      setVal: (document.getElementById('call-half-bg-val') || {}).textContent,
      setRmShown: document.getElementById('call-half-bg-remove') && !document.getElementById('call-half-bg-remove').hidden,
      cardPainted: !!(card && (card.style.backgroundImage || '').indexOf('data:image') >= 0),
      panelPainted: !!(panel && panel.style.backgroundImage)
    });
  })()`);
  o = null; try { o = JSON.parse(b5); } catch (e) {}
  check('B5 半框背景设置后重载：两处行同步「已设置」＋来电/去电弹窗卡片涂上背景（#987 起不再涂设置用的半屏面板）',
    o && o.editVal === '已设置' && o.editRmShown === true && o.setVal === '已设置' && o.setRmShown === true && o.cardPainted === true && o.panelPainted === false, b5);

  // B6 功能页移除行点击：两处行回「默认」、背景清除、存储键删除
  await openCallPanel();
  await evalJs(`document.getElementById('call-half-bg-edit-remove').click()`);
  await sleep(200);
  const b6 = await evalJs(`(function(){
    var panel = document.getElementById('chat-call-panel');
    var card = document.querySelector('.call-panel');
    var s = window.xyStore && window.xyStore('xy-home-v2:' + (window.__activeCid || 'default'));
    return JSON.stringify({
      editVal: (document.getElementById('call-half-bg-edit-val') || {}).textContent,
      editRmHidden: document.getElementById('call-half-bg-edit-remove') ? document.getElementById('call-half-bg-edit-remove').hidden : null,
      setVal: (document.getElementById('call-half-bg-val') || {}).textContent,
      cardPainted: card ? (card.style.backgroundImage || '') : null,
      panelPainted: panel ? (panel.style.backgroundImage || '') : null,
      keyGone: s ? (s.get('call-half-bg') == null) : null
    });
  })()`);
  o = null; try { o = JSON.parse(b6); } catch (e) {}
  check('B6 功能页移除半框背景：两处行回「默认」·弹窗卡片背景清除（没设通话背景时回空白）·存储键删除',
    o && o.editVal === '默认' && o.editRmHidden === true && o.setVal === '默认' && (o.cardPainted || '') === '' && (o.panelPainted || '') === '' && o.keyGone === true, b6);

  check('全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const fails = results.filter(r => !r.ok);
console.log('----');
console.log('verify-call-view: ' + (results.length - fails.length) + '/' + results.length + ' 通过' + (fails.length ? '（存在 FAIL）' : ''));
process.exit(fails.length ? 1 : 0);
