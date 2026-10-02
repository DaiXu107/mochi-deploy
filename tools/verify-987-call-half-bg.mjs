// ===== 常驻回归：#987 「通话半框背景图片」上传落点修正 ＋ 通话中「打开来电弹窗」＝展开真实通话面板 =====
// 用户 2026-09-21 直派（原话）：「聊天里打开更多功能的通话功能，页面里点击上传通话半框背景图片。上传图片的位置
//   上传错了。这个应该是上传在联系人给我打电话或我给联系人打电话的那个方形的框框里。然后通话界面的这个
//   打开来电弹窗应该打开是这个框框。现在点击这个只会显示我已经打开了通话小框的提示。」
// 现状（无头实测，零机型分支）：call-half-bg 原来涂的是聊天页设置用的半屏面板 #chat-call-panel，用户在通话
//   功能页点上传后「图涂在自己脚下的设置面板上」；来电/去电那个方形通话弹窗（.call-panel，也就是「打开来电弹窗」
//   预览的框）拿不到这张图。且通话进行中点「打开来电弹窗」被 currentCall 门拦下，只弹一句「当前正在通话中」。
// 断言：
//  S 组＝源码/产物锚（红侧必红）：涂装落点（弹窗卡片＝半框背景优先、回落通话背景）／通话小框只认通话背景／
//       半框背景不得再涂设置面板（删除型）／通话中点击＝展开真实面板／设置页与功能页文案口径／哨兵登记与唯一性
//  B 组＝行为面（真浏览器 390×844）：半框背景只涂来电/去电弹窗卡片、设置面板保持干净／两处行回显／
//       「打开来电弹窗」预览的正是那个框且框上有图／通话中点它＝展开真实面板且通话状态不变／
//       只设通话背景时弹窗回落显示（老用户不丢背景）／两张都设时弹窗优先半框、小框仍是通话背景（不串图）／
//       移除后回落与清空
//  Z 组＝全程零未捕获 JS 异常
// 用法：node tools/verify-987-call-half-bg.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-987-call-half-bg.mjs   （红绿对照务必显式传）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (d, ok, detail) => {
  if (ok) { pass++; console.log('  PASS  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); }
};

// ---------- S 组：源码 / 哨兵 ----------
console.log('[S] 源码锚与哨兵');
const readSrc = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };
const callSrc = readSrc('js/call.js');
const tplSrc = readSrc('template.html');
const buildSrc = (() => { try { return readFileSync(join(root, 'build.mjs'), 'utf8'); } catch (e) { return ''; } })();

check('S1 两处涂装收进同一实现（applyCallBg / applyCallHalfBg 都指向 applyCallBgs）',
  callSrc.includes('function applyCallBgs()') && callSrc.includes('function applyCallBg() { applyCallBgs(); }') &&
  callSrc.includes('function applyCallHalfBg() { applyCallBgs(); }'));
check('S2 弹窗卡片落点＝半框背景优先、没设回落通话背景',
  callSrc.includes("paintCallBg(document.querySelector('.call-panel'), hbg || cbg);"));
check('S3 通话小框只认通话背景（半框图不串到小框上）',
  callSrc.includes("paintCallBg(document.getElementById('call-mini'), cbg);"));
check('S4 半框背景不得再涂设置用的半屏面板（删除型判据：涂装代码已不存在）',
  !callSrc.includes('half.style.backgroundImage'));
check('S5 通话中点「打开来电弹窗」＝展开真实通话面板并收起悬浮小框',
  callSrc.includes('if (currentCall) {') && callSrc.includes("toast('通话中·已展开通话面板');") &&
  callSrc.includes('if (mini) mini.hidden = true;') && !callSrc.includes("toast('当前正在通话中')"));
check('S6 设置页口径指向方形通话弹窗（不再写「作用于通话小框」）',
  tplSrc.includes('作用于「联系人打给你 / 你打给联系人」时弹出的那个方形通话弹窗') &&
  !tplSrc.includes('作用于联系人来电/通话时的半弹框'));
check('S7 功能页三行仍在位、行说明含通话中行为',
  tplSrc.includes('id="call-half-bg-edit-row"') && tplSrc.includes('id="call-half-bg-edit-remove"') &&
  tplSrc.includes('id="call-view-row"') && tplSrc.includes('通话中点击＝展开通话面板'));
check('S8 通话背景行口径同步（作用于通话小框＋弹窗回落）',
  tplSrc.includes('作用于接通后的「通话小框」'));

const sentIds = ['#987a', '#987b', '#987c', '#987d', '#987e', '#987f'];
const missing = sentIds.filter((id) => buildSrc.indexOf("name: '" + id + ' ') < 0);
check('S9 六条哨兵 #987a~f 全部登记', missing.length === 0, missing.join(','));
// 哑哨兵体检：needle 必须在各自登记 file 内唯一（多一条/零条都是「删掉修复仍报绿」）
const needles = [
  ['js/call.js', "paintCallBg(document.querySelector('.call-panel'), hbg || cbg);"],
  ['js/call.js', "paintCallBg(document.getElementById('call-mini'), cbg);"],
  ['js/call.js', "toast('通话中·已展开通话面板');"],
  ['template.html', '作用于「联系人打给你 / 你打给联系人」时弹出的那个方形通话弹窗'],
  ['template.html', '通话中点击＝展开通话面板']
];
const uniqBad = needles.filter(([f, n]) => readSrc(f).split(n).length - 1 !== 1).map(([f, n]) => f + ':' + n.slice(0, 24));
check('S10 哨兵 needle 各自在登记 file 内唯一（哑哨兵体检）', uniqBad.length === 0, uniqBad.join(' | '));
check('S11 删除型哨兵 needle 在半框涂装旧代码上已消失（absent 锚成立）',
  buildSrc.includes("absent: true, needle: 'half.style.backgroundImage'") && !callSrc.includes('half.style.backgroundImage'));

// ---------- 浏览器 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9930 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-987-' + Date.now()),
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
            jsExcepts.push(String((d && ((d.exception && d.exception.description) || d.text)) || 'err').split('\n')[0].slice(0, 160));
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

const GIF_A = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // 1x1 透明
const GIF_B = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // 1x1 白
const setKey = (k, v) => evalJs(`(function(){var s=window.xyStore&&window.xyStore('xy-home-v2:'+(window.__activeCid||'default'));if(!s)return 'no-store';${v === null ? `s.remove(${JSON.stringify(k)});` : `s.set(${JSON.stringify(k)},${JSON.stringify(v)});`}return 'ok';})()`);
const boot = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(700);
  // 开屏整块拆掉（.splash:not(.hide) ~ .phone{visibility:hidden} 会让后续命中测试全假）
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);['modal-mask','pc-sheet-mask','backup-remind-bar','backup-modal','modal-static'].forEach(function(id){var e=document.getElementById(id);if(e)e.hidden=true;});return true;})()");
  await sleep(500);
};
const openCallPanel = async () => {
  await evalJs("(function(){try{window.enterChat();}catch(e){}return true;})()");
  await sleep(800);
  await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(b)b.click();return true;})()");
  await sleep(300);
  await evalJs("(function(){var b=document.getElementById('more-call');if(b)b.click();return true;})()");
  await sleep(500);
};
// 一次读全「谁被涂了」——卡片/小框/设置面板 + 两处行回显 + 存储
const paintState = () => evalJs(`(function(){
  var card=document.querySelector('.call-panel'), mini=document.getElementById('call-mini'), panel=document.getElementById('chat-call-panel');
  var s=window.xyStore&&window.xyStore('xy-home-v2:'+(window.__activeCid||'default'));
  return JSON.stringify({
    card: card?(card.style.backgroundImage||''):null,
    mini: mini?(mini.style.backgroundImage||''):null,
    panel: panel?(panel.style.backgroundImage||''):null,
    cardHasBg: !!(card&&card.classList.contains('has-bg')),
    hEdit:(document.getElementById('call-half-bg-edit-val')||{}).textContent,
    hSet:(document.getElementById('call-half-bg-val')||{}).textContent,
    hEditRm: document.getElementById('call-half-bg-edit-remove')?!document.getElementById('call-half-bg-edit-remove').hidden:null,
    bEdit:(document.getElementById('call-bg-edit-val')||{}).textContent,
    bSet:(document.getElementById('call-bg-val')||{}).textContent,
    key: s?s.get('call-half-bg'):'no-store'
  });
})()`);
const callState = () => evalJs(`(function(){
  var s=null;try{s=window.getCallState&&window.getCallState();}catch(e){}
  var m=document.getElementById('call-mask'),mi=document.getElementById('call-mini');
  var t=document.getElementById('cc-toast');
  return JSON.stringify({st:s?s.status:null,dur:s?s.durationSec:null,mask:m?!m.hidden:null,mini:mi?!mi.hidden:null,toast:t?t.textContent:''});
})()`);
const has = (hay, needle) => String(hay || '').indexOf(needle) >= 0;

try {
  await cdpConnect();
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('xy-home-v2:__guide-done','1');localStorage.setItem('xy-home-v2:__onboard-done','1');}catch(e){}"
  });

  console.log('[B] 行为面（真浏览器 390×844）');
  await boot();
  await setKey('call-bg', null); await setKey('call-half-bg', null);
  await boot();
  await openCallPanel();
  let st = JSON.parse(await paintState() || '{}');
  check('B0 起点干净：卡片/小框/设置面板都没有背景图',
    st.card === '' && st.mini === '' && st.panel === '', JSON.stringify({ card: st.card, mini: st.mini, panel: st.panel }));

  // 只设「半框背景」→ 重载
  await setKey('call-half-bg', GIF_A);
  await boot();
  await openCallPanel();
  st = JSON.parse(await paintState() || '{}');
  check('B1 半框背景涂在来电/去电弹窗卡片上（用户报的「上传错地方」）', has(st.card, GIF_A), String(st.card).slice(0, 40));
  check('B2 设置用的半屏面板保持干净（旧落点已撤）', st.panel === '', String(st.panel).slice(0, 40));
  check('B3 通话小框不被半框背景涂到', st.mini === '', String(st.mini).slice(0, 40));
  check('B4 两处入口行同步「已设置」＋移除行出现',
    st.hEdit === '已设置' && st.hSet === '已设置' && st.hEditRm === true,
    JSON.stringify({ edit: st.hEdit, set: st.hSet, rm: st.hEditRm }));

  // 「打开来电弹窗」（空闲）＝预览那个框，且框上正是这张图
  await evalJs("document.getElementById('call-view-row').click(); true");
  await sleep(700);
  const pv = await evalJs(`(function(){
    var m=document.getElementById('call-mask'),title=m&&m.querySelector('.call-title'),card=document.querySelector('.call-panel');
    return JSON.stringify({shown:m&&!m.hidden,title:title&&title.textContent,status:(document.getElementById('call-status')||{}).textContent,
      answer:!(document.getElementById('call-answer-btn')||{}).hidden,catcher:!!document.getElementById('call-preview-catcher'),
      card:card?(card.style.backgroundImage||''):null});
  })()`);
  let o = null; try { o = JSON.parse(pv); } catch (e) {}
  check('B5 「打开来电弹窗」预览的就是那个框（·预览标题/对方来电/接听拒绝/拦截层）',
    o && o.shown === true && has(o.title, '预览') && o.status === '对方来电...' && o.answer === true && o.catcher === true, pv);
  check('B6 预览出来的框上就是刚设的那张半框背景（用户「应该打开是这个框框」）', o && has(o.card, GIF_A), o && String(o.card).slice(0, 40));
  await evalJs("document.getElementById('call-preview-catcher').click(); true");
  await sleep(300);
  const pvOff = await evalJs("(function(){var m=document.getElementById('call-mask');var t=m&&m.querySelector('.call-title');return JSON.stringify({hidden:m&&m.hidden,title:t&&t.textContent,catcher:!!document.getElementById('call-preview-catcher')});})()");
  o = null; try { o = JSON.parse(pvOff); } catch (e) {}
  check('B7 点任意处退出预览（标题复原·拦截层拆除）', o && o.hidden === true && o.title === '语音通话' && o.catcher === false, pvOff);

  // 两张都设 → 弹窗优先半框、小框仍是通话背景（不串图）
  await setKey('call-bg', GIF_B);
  await boot();
  st = JSON.parse(await paintState() || '{}');
  check('B8 两张都设：弹窗显示半框那张', has(st.card, GIF_A) && !has(st.card, GIF_B), String(st.card).slice(0, 40));
  check('B9 两张都设：通话小框仍是通话背景那张', has(st.mini, GIF_B) && !has(st.mini, GIF_A), String(st.mini).slice(0, 40));
  check('B10 两处行各自回显「已设置」（通话背景行与半框行互不干扰）',
    st.bEdit === '已设置' && st.bSet === '已设置' && st.hEdit === '已设置', JSON.stringify({ b: st.bEdit, h: st.hEdit }));

  // 只设通话背景（清掉半框）→ 弹窗回落显示通话背景（老用户不丢背景）
  await setKey('call-half-bg', null);
  await boot();
  st = JSON.parse(await paintState() || '{}');
  check('B11 只设通话背景时弹窗回落显示通话背景（老用户已设的背景不丢）',
    has(st.card, GIF_B) && has(st.mini, GIF_B), JSON.stringify({ card: String(st.card).slice(0, 24), mini: String(st.mini).slice(0, 24) }));
  check('B12 半框行回「默认」＋移除行收起',
    st.hEdit === '默认' && st.hSet === '默认' && st.hEditRm === false, JSON.stringify({ edit: st.hEdit, set: st.hSet, rm: st.hEditRm }));

  // 通话中：点「打开来电弹窗」＝展开真实通话面板（不再只弹「当前正在通话中」）
  await openCallPanel();
  await evalJs("(function(){if(window.triggerIncomingCall)window.triggerIncomingCall();return true;})()");
  await sleep(1100);
  await evalJs("(function(){var b=document.getElementById('call-answer-btn');if(b&&!b.hidden)b.click();return true;})()");
  await sleep(1200);
  await evalJs("(function(){var b=document.getElementById('call-minimize-btn');if(b&&!b.hidden)b.click();return true;})()");
  await sleep(1000);
  const beforeCall = JSON.parse(await callState() || '{}');
  check('B13 通话中·已缩成小框（前置状态成立）', beforeCall.st === 'connected' && beforeCall.mini === true && beforeCall.mask === false, JSON.stringify(beforeCall));
  await evalJs("document.getElementById('call-view-row').click(); true");
  await sleep(700);
  const afterCall = JSON.parse(await callState() || '{}');
  const cardNow = await evalJs("(function(){var c=document.querySelector('.call-panel');return c?(c.style.backgroundImage||''):null;})()");
  check('B14 通话中点「打开来电弹窗」＝展开真实通话面板（不再只弹一句提示）',
    afterCall.mask === true && afterCall.mini === false && afterCall.st === 'connected', JSON.stringify(afterCall));
  check('B15 提示写明「已展开通话面板」', has(afterCall.toast, '已展开通话面板'), afterCall.toast);
  check('B16 展开的是真实通话（不构造预览拦截层·通话没被打断）',
    (await evalJs("!!document.getElementById('call-preview-catcher')")) === false && afterCall.st === 'connected' && afterCall.dur !== null, JSON.stringify({ dur: afterCall.dur }));
  check('B17 展开出来的通话面板上仍是那张通话背景图', has(cardNow, GIF_B), String(cardNow).slice(0, 40));
  await evalJs("(function(){try{window.hangupCall&&window.hangupCall();}catch(e){}})(); true");
  await sleep(500);

  // 移除半框背景（功能页移除行）：键删除、弹窗回落到通话背景
  await setKey('call-half-bg', GIF_A);
  await boot();
  await openCallPanel();
  await evalJs("document.getElementById('call-half-bg-edit-remove').click(); true");
  await sleep(400);
  st = JSON.parse(await paintState() || '{}');
  check('B18 移除半框背景：键删除·两处行回「默认」·弹窗回落到通话背景',
    st.key === null && st.hEdit === '默认' && st.hSet === '默认' && has(st.card, GIF_B) && !has(st.card, GIF_A),
    JSON.stringify({ key: st.key, edit: st.hEdit, card: String(st.card).slice(0, 24) }));

  check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' | '));
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

console.log('----');
console.log('verify-987-call-half-bg: ' + pass + '/' + (pass + fail) + ' 通过' + (fail ? '（存在 FAIL）' : ''));
process.exit(fail ? 1 : 0);
