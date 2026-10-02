// ===== 回归脚本：红包半框「设置」区溢出面板（#923）=====
// 背景（用户报障 #923）：「红包的设置里有字超出这个页面了」，并明确「手机端的问题、其他设备型号也有出现」
//   ⇒ 零机型分支：判据全部取几何/计算样式，不做任何 UA 分支。
// 根因：#rp-settings 不是 .poke-card 的滚动子项——它挂在 .poke-card-scroll 之外，而打开设置时
//   chat.js 恰好把 .poke-card-scroll 隐藏（rpScrollEl.hidden=true），于是整块内容（实测 810~860px 高：
//   三组标题＋7 行 set-row＋「完成」）落在一个 overflow:visible、受 .poke-card max-height:48%
//   （273~439px）封顶的面板里＝从第三组起的行整块画到面板外，「完成」按钮离屏幕底边 -278~-544px
//   ＝看不见也点不到，用户所见就是「字超出这个页面」。
// 修法：src/css/chat-main.css `.rp-settings:not([hidden])` 改为弹性滚动子项
//   （flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain；滚动条隐藏），
//   面板封顶不变、内容在面板内部滚；不动 template.html 结构与 chat.js 逻辑。
// 判别力：红基线（纯 HEAD 产物）恰红 B1/B2/B4/B5/B6/B7（＝溢出本身与「完成」不可点），
//   B3 防修过头（面板本身不得顶出屏幕）、B8 防回归到主界面、B9 防水平溢出、S 组产物锚、Z 零异常。
// 用法：node build.mjs && node tools/verify-rp-settings-scroll.mjs
//      SERVE_ROOT=<隔离构建目录> 可验未收口产物（绿/红对照都用它）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.SERVE_ROOT || __root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end(); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9870 + Math.floor(Math.random() * 100);
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-rp-scroll-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profileDir, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
let jsErrors = 0;
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') jsErrors++; };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}

// —— S 组：产物锚（CSS 走 minifyCss，注释与缩进被剥；needle 取产物形态的单行片段。
//    落点兼容 index.html 内联与 css/ 外置两种结构，与 #906 批同口径）——
const artifact = readFileSync(join(root, 'index.html'), 'utf8');
const cssText = (() => { try { return artifact + readFileSync(join(root, 'css', 'base.css'), 'utf8'); } catch (e) { return artifact; } })();
chk('S1 设置区为滚动容器', /rp-settings:not\(\[hidden\]\)\{[^}]*overflow-y:auto/.test(cssText.replace(/\s+/g, '')), '');
chk('S2 滚动子项可收缩（min-height:0）', /rp-settings:not\(\[hidden\]\)\{[^}]*min-height:0/.test(cssText.replace(/\s+/g, '')), '');
chk('S3 滚到边界不穿透下层页面', /rp-settings:not\(\[hidden\]\)\{[^}]*overscroll-behavior:contain/.test(cssText.replace(/\s+/g, '')), '');

// —— 前置：进聊天页、打开红包半框并点「设置」 ——
async function openRpSettings(w, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2600);
  for (let i = 0; i < 25; i++) {
    const s = await evalJs(`(function(){
      var mm=document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) { var men=document.getElementById('splash-mandatory-enter'); if (men) men.click(); mm.hidden=true; return 'wait'; }
      var sp=document.getElementById('splash');
      if (sp && !sp.classList.contains('hide')) { sp.classList.add('hide'); sp.hidden=true; return 'wait'; }
      return 'closed';})()`);
    if (s === 'closed') break;
    await sleep(250);
  }
  await evalJs("(function(){document.querySelectorAll('.modal-mask').forEach(function(m){m.hidden=true;});var q=document.getElementById('qa-mask');if(q)q.hidden=true;var b=document.getElementById('backup-remind-bar');if(b)b.hidden=true;return true;})()");
  await evalJs('window.enterChat && window.enterChat(); true');
  await sleep(900);
  await evalJs("(function(){var P=document.getElementById('chat-rp-panel');if(P)P.hidden=false;var b=document.getElementById('rp-settings-btn');if(b)b.click();return true;})()");
  await sleep(400);
  // 逐档复位滚动位置，保证每档都是从头量
  await evalJs("(function(){var S=document.getElementById('rp-settings');if(S)S.scrollTop=0;return true;})()");
  await sleep(150);
}

// 一次性取全部几何/计算样式（同一次评估＝同一帧，避免分次往返被中间状态污染）
const MEASURE = `(function(){
  var P=document.getElementById('chat-rp-panel'), S=document.getElementById('rp-settings');
  if(!P||!S) return {err:'no panel/settings'};
  if(P.hidden||S.hidden) return {err:'not open'};
  var cs=getComputedStyle(S), pr=P.getBoundingClientRect(), sr=S.getBoundingClientRect();
  var rows=[].slice.call(S.querySelectorAll('.set-row'));
  var done=S.querySelector('.rp-settings-done');
  var dr=done?done.getBoundingClientRect():null;
  var kids=[].slice.call(S.querySelectorAll('.set-row,.rp-settings-title,.rp-settings-done'));
  var maxRight=0; kids.forEach(function(e){var r=e.getBoundingClientRect(); if(r.right>maxRight)maxRight=r.right;});
  var hit=null;
  if(dr){var cx=Math.round(dr.left+dr.width/2), cy=Math.round(dr.top+dr.height/2);
    if(cy>0&&cy<window.innerHeight){var el=document.elementFromPoint(cx,cy); hit=el?!!el.closest('.rp-settings-done'):false;}}
  return {
    ovfY:cs.overflowY, sb:Math.round(S.scrollHeight), ch:Math.round(S.clientHeight),
    st:Math.round(S.scrollTop), osc:cs.overscrollBehaviorY,
    cardTop:Math.round(pr.top), cardBottom:Math.round(pr.bottom),
    setTop:Math.round(sr.top), setBottom:Math.round(sr.bottom), setRight:Math.round(sr.right),
    innerH:window.innerHeight, innerW:window.innerWidth,
    rowCount:rows.length,
    firstTop:Math.round(rows[0].getBoundingClientRect().top),
    lastBottom:Math.round(rows[rows.length-1].getBoundingClientRect().bottom),
    doneBottom:dr?Math.round(dr.bottom):null, doneTop:dr?Math.round(dr.top):null,
    maxRight:Math.round(maxRight), hit:hit,
    fSetTop:sr.top, fSetBottom:sr.bottom, fCardTop:pr.top, fCardBottom:pr.bottom,
    fDoneTop:dr?dr.top:null, fDoneBottom:dr?dr.bottom:null, fFirstTop:rows[0].getBoundingClientRect().top,
    scrollBody:getComputedStyle(document.body).overflow
  };})()`;

// 清场：#900 每日备份提醒等首启弹窗会在全屏遮罩里弹出（.modal-mask z-90），
// 既吃掉 elementFromPoint 命中、也可能把面板顶掉＝假红，故每次测量前扫一遍
const sweepMasks = () => evalJs(`(function(){
  document.querySelectorAll('.modal-mask').forEach(function(m){m.hidden=true;});
  var q=document.getElementById('qa-mask'); if(q)q.hidden=true;
  return true;})()`);
// 把某个元素滚进容器可视区（只动容器 scrollTop，不用 scrollIntoView 以免连带滚别的祖先）
async function revealInSettings(sel) {
  await sweepMasks();
  return evalJs(`(function(){
    var S=document.getElementById('rp-settings'); var el=S.querySelector(${JSON.stringify(sel)});
    var sr=S.getBoundingClientRect(), er=el.getBoundingClientRect();
    S.scrollTop += (er.bottom - sr.bottom) + 6;
    return true;})()`);
}

const VIEWPORTS = [[390, 844], [320, 568], [412, 915], [360, 640]];
for (const [w, h] of VIEWPORTS) {
  const tag = w + 'x' + h;
  await openRpSettings(w, h);
  await sweepMasks();
  await sleep(150);
  const m0 = await evalJs(MEASURE);
  if (!m0 || m0.err) { chk('前置 ' + tag + ' 设置区已打开', false, JSON.stringify(m0)); continue; }
  chk('前置 ' + tag + ' 设置区行数>=7（三组内容都在）', m0.rowCount >= 7, JSON.stringify({ rowCount: m0.rowCount }));

  // B1 设置区自身是滚动容器（内容高于可视区时必须能滚，而不是溢出）
  const b1 = m0.sb > m0.ch && (m0.ovfY === 'auto' || m0.ovfY === 'scroll');
  chk('B1 ' + tag + ' 设置区内部可滚（内容 ' + m0.sb + 'px / 可视 ' + m0.ch + 'px）', b1, JSON.stringify({ ovfY: m0.ovfY, sb: m0.sb, ch: m0.ch }));

  // B2 设置区盒子完全落在面板内＝没有任何内容画到面板外
  chk('B2 ' + tag + ' 设置区不溢出面板（含在卡片框内）',
    m0.fSetTop >= m0.fCardTop - 1.5 && m0.fSetBottom <= m0.fCardBottom + 1.5,
    JSON.stringify({ setTop: m0.fSetTop, setBottom: m0.fSetBottom, cardTop: m0.fCardTop, cardBottom: m0.fCardBottom }));

  // B3 面板本身不顶出屏幕（防修过头：靠把面板撑高/挪位来「解决」溢出）
  chk('B3 ' + tag + ' 面板整体在屏幕内', m0.fCardTop >= -1.5 && m0.fCardBottom <= m0.innerH + 1.5,
    JSON.stringify({ cardTop: m0.fCardTop, cardBottom: m0.fCardBottom, innerH: m0.innerH }));

  // B4 首行一开始就看得见（滚动位置没把标题组推出可视区）
  chk('B4 ' + tag + ' 首行落在可视区内', m0.fFirstTop >= m0.fSetTop - 1.5 && m0.fFirstTop < m0.fSetBottom,
    JSON.stringify({ firstTop: m0.fFirstTop, setTop: m0.fSetTop, setBottom: m0.fSetBottom }));

  // B5 滚到底：「完成」按钮可见且真能被点中（elementFromPoint 命中＝用户够得到）
  await revealInSettings('.rp-settings-done');
  await sleep(200);
  await sweepMasks();
  const m1 = await evalJs(MEASURE);
  const b5 = m1.st > 0 && m1.fDoneTop >= m1.fSetTop - 1.5 && m1.fDoneBottom <= m1.fSetBottom + 1.5 && m1.hit === true;
  chk('B5 ' + tag + ' 滚到底「完成」可见且可点', b5, JSON.stringify({ st: m1.st, doneTop: m1.fDoneTop, doneBottom: m1.fDoneBottom, setBottom: m1.fSetBottom, hit: m1.hit }));

  // B6 每一行都能被滚进可视区（用户报「有字超出」＝逐行核对再无一字在框外）
  await sweepMasks();
  const perRow = await evalJs(`(function(){
    var S=document.getElementById('rp-settings'); var sr0=S.getBoundingClientRect();
    var rows=[].slice.call(S.querySelectorAll('.set-row')); var bad=[];
    for(var i=0;i<rows.length;i++){
      var er=rows[i].getBoundingClientRect();
      S.scrollTop += (er.bottom - sr0.bottom) + 4;
      er=rows[i].getBoundingClientRect();
      var txt=rows[i].querySelector('.txt'); var tr=txt?txt.getBoundingClientRect():null;
      if(er.top < sr0.top-1.5 || er.bottom > sr0.bottom+1.5) bad.push(i+':row');
      if(tr && (tr.top < sr0.top-1.5 || tr.bottom > sr0.bottom+1.5)) bad.push(i+':txt');
    }
    return {bad:bad, n:rows.length};})()`);
  chk('B6 ' + tag + ' 逐行滚动作后每行文字都在面板框内', perRow && perRow.bad.length === 0, JSON.stringify(perRow));

  // B7 滚到边界不穿透底层聊天页
  chk('B7 ' + tag + ' overscroll-behavior 收住（不穿透底层页面）', m0.osc === 'contain', 'osc=' + m0.osc);

  // B9 水平方向无溢出（窄屏 320 档尤其要看）
  chk('B9 ' + tag + ' 无横向溢出（文字未越过面板右缘）', m0.maxRight <= m0.setRight + 2,
    JSON.stringify({ maxRight: m0.maxRight, setRight: m0.setRight, cardRight: m0.setRight }));

  // B8 点「完成」回主界面：设置区收起、滚动主体恢复（防修法把 #chat-rp-panel 打开态搞坏）
  await evalJs("(function(){var d=document.querySelector('.rp-settings-done');if(d)d.click();return true;})()");
  await sleep(300);
  const m2 = await evalJs(`(function(){
    var S=document.getElementById('rp-settings'), P=document.getElementById('chat-rp-panel');
    var sc=P.querySelector('.poke-card-scroll'), bal=document.getElementById('rp-balance');
    var pr=P.getBoundingClientRect();
    return {setHidden:S.hidden, setDisp:getComputedStyle(S).display, scrollHidden:sc?sc.hidden:null,
      balHidden:bal?bal.hidden:null, cardBottom:Math.round(pr.bottom), innerH:window.innerHeight};})()`);
  chk('B8 ' + tag + ' 「完成」后设置区收起、红包主体恢复',
    m2 && m2.setHidden === true && m2.setDisp === 'none' && m2.scrollHidden === false && m2.balHidden === false && m2.cardBottom <= m2.innerH,
    JSON.stringify(m2));
}

chk('Z 全程零 JS 异常', jsErrors === 0, 'jsErrors=' + jsErrors);
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + ' 通过 / ' + fail + ' 失败  [root=' + root + ']');
try { ws && ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
try { statSync(profileDir) && (await import('node:fs')).rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
process.exit(fail ? 1 : 0);
