// ===== 常驻回归脚本 #1181：浏览器切后台再切回，聊天里记录「闪屏弹跳一下才恢复正常」=====
// 用法：node tools/verify-1181-bg-resume-anim-pop.mjs [被测根目录]
// 症状（用户实报 2026-09-24）：「把浏览器切到后台，再从后台切回来，聊天里聊天消息会闪屏弹跳一下
//   然后恢复正常，没有加载动画缓冲」＋「聊天里加载数据，出现加载弹窗的时候，聊天记录还是会闪屏」。
// 根因（零机型分支，本脚本 P0/A1/A2/A4 逐帧取证）：#913「切后台全站暂停 CSS 动画」在 document.hidden
//   时给所有元素挂 animation-play-state:paused。站内切页那条路 #1151 已封（a/b/c：播完摘类＋
//   chatVisible() 可见闸＋回场落终态总闸），但**浏览器整页进后台不改 chatPage 的 hidden 属性**，
//   三条闸一条都不落地：后台期照常到达的消息（后台保活在跑、TA 的自主回复/互动卡到点就发）
//   逐个挂上 .msg-enter，动画被冻在第 0 帧（fill:both＝那一瞬气泡其实是透明的）、animationend 永不
//   触发＝类也永不摘除；回前台摘掉暂停类的同一瞬，攒下的一整批一起从淡入上浮起跑＝「闪屏弹跳一下」。
// 修法：①#1181a 入场闸从「页面没被切走」补成「用户真的看得见」＝appendMsg 追加 !document.hidden，
//   后台期到达的气泡当场定格、不欠动画；②#1181b/c 把 #1151c 的落终态总闸补挂到真·回前台
//   （visibilitychange→visible ＋ bg-keep 的 mochi-fg-resume ＋ pageshow persisted，注册早于
//   mobile-adapt.js 摘类＝同一任务、绘制之前），且**只收仍处 paused 的一次性动画**——
//   从别的窗口点回来时用户看得见的正常播放一律不动；无限循环者（波形/打字点/加载圈）由既有守卫跳过。
// 断言（同一 tab、真实覆写 document.hidden 让 #913 落地；1× CPU 即可，判据全取动画状态）：
//   S1~S6 静态锚（src 与产物各三处）
//   P0 前提：切后台后 body.mochi-bg-pause 确在（暂停类没挂上＝夹具假绿）
//   A1 后台期到达的气泡不挂 .msg-enter（#1181a）
//   A2 该气泡当场定格为不透明（冻结期 opacity 恒 1＝不再欠一个 from 帧）
//   A3 回前台后暂停类确已摘除
//   A4 【判别核心】回前台后聊天窗口内没有 running 的一次性动画＝零集体补播
//   A5 该气泡内容仍在屏上（修行动画不等于丢消息）
//   B1 前台期到达的消息照常播入场（观感零回退）
//   B2 入场播完后 .msg-enter 被摘除（#1151a 不回归）
//   C1 切走瞬间仍在播的那次入场，回前台被直接落到终态（#1181b/c）
//   Z1 全程零未捕获 JS 异常
// RED 基线（不含本批改动的产物）：A1/A2/A4/C1 红（＝用户症状本体），其余全绿。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ? normalize(resolve(process.argv[2])) : normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, budgetMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    let v = false; try { v = await fn(); } catch (e) { v = false; }
    if (v) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 >= budgetMs) return { ok: false, ms: Date.now() - t0 };
    await sleep(stepMs || 200);
  }
}
const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
const A_ = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 300) : '')); } };

console.log('静态断言:');
let srcTxt = '', prodTxt = '';
try { srcTxt = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8'); } catch (e) {}
try { prodTxt = readFileSync(join(root, 'js', 'chat.js'), 'utf8'); } catch (e) {}
const NEEDLES = [
  ['S1', 'S2', '后台期到达不挂入场动画（appendMsg 的 !document.hidden 闸）', 'chatVisible() && !document.hidden) enterMsgOnce(m);'],
  ['S3', 'S4', '回前台只收「被暂停类冻住」的一次性动画', "if (onlyPaused && a.playState !== 'paused') continue;"],
  ['S5', 'S6', '回前台接线 visibilitychange→visible', "if (document.visibilityState === 'visible') chatResumeSettleAnim();"],
];
for (const [tagSrc, tagProd, label, needle] of NEEDLES) {
  A_(tagSrc + ' ' + label + '（源）', srcTxt.includes(needle));
  A_(tagProd + ' ' + label + '（产物）', prodTxt.includes(needle));
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9901 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-1181-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

function mkClient(wsUrl, tag) {
  const c = { tag, pend: new Map(), id: 0, errors: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(wsUrl); c.ws.onopen = res; c.ws.onerror = rej;
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { try { c.errors.push(String(m.params.exceptionDetails.text || '').slice(0, 160)); } catch (e) {} }
      if (m.id && c.pend.has(m.id)) { c.pend.get(m.id)(m.result); c.pend.delete(m.id); }
    };
  });
  c.cdp = (method, params = {}) => { const id = ++c.id; return new Promise((res) => { c.pend.set(id, res); c.ws.send(JSON.stringify({ id, method, params })); }); };
  c.evalJs = async (expr) => {
    try {
      const r = await c.cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) { console.error('  [eval err]', String((r.exceptionDetails.exception || {}).description || '').slice(0, 200)); return null; }
      return r && r.result ? r.result.value : null;
    } catch (e) { return null; }
  };
  return c;
}

// —— 真实前后台夹具：覆写 document.hidden / visibilityState 后派发事件（#913 读的正是 document.hidden）——
const HIDE = `(function(){
  try {
    window.__1181 = { d: Object.getOwnPropertyDescriptor(Document.prototype,'hidden'), v: Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState') };
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'hidden';}});
    document.dispatchEvent(new Event('visibilitychange'));
  } catch (e) { return String(e && e.message || e); }
  return document.body.classList.contains('mochi-bg-pause') ? 'pause-on' : 'pause-missing';
})()`;
const SHOW = `(function(){
  try {
    if (window.__1181 && window.__1181.d) Object.defineProperty(document,'hidden',window.__1181.d);
    if (window.__1181 && window.__1181.v) Object.defineProperty(document,'visibilityState',window.__1181.v);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('mochi-fg-resume'));
  } catch (e) { return String(e && e.message || e); }
  return document.body.classList.contains('mochi-bg-pause') ? 'pause-stuck' : 'pause-off';
})()`;
// 聊天窗口内「一次性 CSS 动画」清单（无限循环者＝波形/打点/加载圈排除）
const SCAN = `(function(mark){
  var b=document.getElementById('chat-body'); if(!b) return JSON.stringify({err:1});
  var oneShot=function(tgOnly){ var out=[]; if(!document.getAnimations) return out;
    var all=document.getAnimations();
    for(var i=0;i<all.length;i++){ var a=all[i], ef=a.effect, tg=ef&&ef.target;
      if(typeof a.animationName!=='string') continue;
      if(!tg||(tg!==b&&!b.contains(tg))) continue;
      if(tgOnly&&!(tg===tgOnly||tgOnly.contains(tg))) continue; // 只看这一条气泡自己身上（含子节点）
      var it=Infinity; try{ it=ef.getComputedTiming().iterations; }catch(e){}
      if(it===Infinity) continue;
      var desc='?'; try { desc=String(tg.tagName)+'.'+String(tg.className||'').slice(0,36)+'|'+(tg.textContent||'').slice(0,12); }catch(e){}
      out.push([a.animationName,a.playState,Math.round(a.currentTime==null?-1:a.currentTime),desc]);
    } return out; };
  var kids=b.children, n=null;
  for(var k=kids.length-1;k>=0;k--){ if((kids[k].textContent||'').indexOf(mark)>=0){ n=kids[k]; break; } }
  var mine=n?oneShot(n):[], all2=oneShot();
  var cnt=function(list,st){ return list.filter(function(x){return x[1]===st;}).length; };
  return JSON.stringify({
    enter: n?String(n.classList.contains('msg-enter')):'no-node',
    op: n?getComputedStyle(n).opacity:'no-node',
    txt: n?((n.textContent||'').indexOf(mark)>=0):false,
    nodeRunning: cnt(mine,'running'), nodePaused: cnt(mine,'paused'), anims: mine.slice(0,4),
    running: cnt(all2,'running'), paused: cnt(all2,'paused'),
    runningWhat: all2.filter(function(x){return x[1]==='running';}).slice(0,4),
    pausedWhat: all2.filter(function(x){return x[1]==='paused';}).slice(0,4)
  });
})`;
let C = null;
try {
  let targets = [];
  for (let i = 0; i < 80; i++) { try { targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json(); if (targets.length) break; } catch (e) {} await sleep(200); }
  C = mkClient(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, 'C'); await C.connect();
  await C.cdp('Page.enable'); await C.cdp('Runtime.enable');
  await C.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 772, deviceScaleFactor: 2, mobile: true });
  await C.cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(3000);
  for (let i = 0; i < 60; i++) { if (await C.evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await C.evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()");
  await sleep(700);
  await C.evalJs("(function(){try{var st=window.activeStore();st.set('__last-backup-remind',String(Date.now()));st.set('__last-backup',String(Date.now()));st.set('cs-rp-auto-prob','0');}catch(e){}try{localStorage.setItem('xy-home-v2:ver-update-notify',String(Date.now()));}catch(e){}return true;})()");
  await C.evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(2500);

  console.log('行为断言:');
  const seed = await C.evalJs(`(function(){ try { var now=Date.now(), arr=[]; for (var i=0;i<30;i++) arr.push({side:'out',text:'底'+i,ts:now-(30-i)*60000}); return window.chatImportMsgs(arr)?'true':'false'; } catch(e){ return 'ERR:'+e.message; } })()`);
  await sleep(2000);
  A_('P0 前提：历史种子写入成功', seed === 'true', seed);

  // ---------- A 组：后台期到达（用户症状本体）----------
  const hide = String(await C.evalJs(HIDE));
  A_('P0 前提：切后台后 #913 暂停类确在（夹具真生效）', hide === 'pause-on', hide);
  const MARK_A = '__1181A__后台到达';
  const addA = await C.evalJs(`(function(){ try { return window.chatAddIn(${JSON.stringify(MARK_A)},{})?'ok':'null'; } catch(e){ return 'ERR:'+e.message; } })()`);
  await sleep(300);
  const inBg = JSON.parse(await C.evalJs(SCAN + '(' + JSON.stringify(MARK_A) + ')') || '{}');
  A_('A0 前提：后台期确有一条消息落进聊天（产品后台保活会照常收信）', addA === 'ok' && inBg.txt === true, { addA, inBg });
  A_('A1 后台期到达的气泡不挂 .msg-enter（#1181a）', inBg.enter === 'false', inBg);
  A_('A2 该气泡当场定格为不透明（不再欠一个 opacity:0 的 from 帧）', inBg.op === '1', inBg);
  const show = String(await C.evalJs(SHOW));
  A_('A3 回前台后暂停类确已摘除', show === 'pause-off', show);
  const afterA = JSON.parse(await C.evalJs(SCAN + '(' + JSON.stringify(MARK_A) + ')') || '{}');
  A_('A4 【判别核心】回前台后这条气泡没有被补播（自身零 running 一次性动画）且窗口内零遗留冻帧', afterA.nodeRunning === 0 && afterA.paused === 0, afterA);
  await sleep(250);
  const afterA2 = JSON.parse(await C.evalJs(SCAN + '(' + JSON.stringify(MARK_A) + ')') || '{}');
  A_('A4b 再等一拍仍无补播（排除「稍后才起跑」）', afterA2.nodeRunning === 0 && afterA2.nodePaused === 0 && afterA2.paused === 0, afterA2);
  A_('A5 该气泡内容仍在屏上（修的是动画不是丢消息）', afterA2.txt === true, afterA2);

  // ---------- B 组：前台观感零回退 ----------
  const MARK_B = '__1181B__前台到达';
  await C.evalJs(`(function(){ try { window.chatAddIn(${JSON.stringify(MARK_B)},{}); return 'ok'; } catch(e){ return 'ERR:'+e.message; } })()`);
  const inFg = JSON.parse(await C.evalJs(SCAN + '(' + JSON.stringify(MARK_B) + ')') || '{}');
  A_('B1 前台期到达的消息照常播入场（.msg-enter＋自身 running＝观感不回退）', inFg.enter === 'true' && inFg.nodeRunning >= 1, inFg);
  const ended = await waitFor(async () => {
    const s = JSON.parse(await C.evalJs(SCAN + '(' + JSON.stringify(MARK_B) + ')') || '{}');
    return s.enter === 'false' ? s : false;
  }, 4000, 200);
  A_('B2 入场播完摘类（#1151a 不回归）', ended.ok, ended.ms);

  // ---------- C 组：切走瞬间仍在播的那一次 ----------
  const MARK_C = '__1181C__切走时仍在播';
  await C.evalJs(`(function(){ try { window.chatAddIn(${JSON.stringify(MARK_C)},{}); return 'ok'; } catch(e){ return 'ERR:'+e.message; } })()`);
  const justStarted = JSON.parse(await C.evalJs(SCAN + '(' + JSON.stringify(MARK_C) + ')') || '{}');
  A_('C0 前提：这条正在播（enter=true＋自身 running）', justStarted.enter === 'true' && justStarted.nodeRunning >= 1, justStarted);
  const hide2 = String(await C.evalJs(HIDE));
  await sleep(400);
  const frozen = JSON.parse(await C.evalJs(SCAN + '(' + JSON.stringify(MARK_C) + ')') || '{}');
  A_('C1 后台期它被冻住（自身 paused≥1＝#913 行为面）', hide2 === 'pause-on' && frozen.nodePaused >= 1, frozen);
  await C.evalJs(SHOW);
  const thawed = JSON.parse(await C.evalJs(SCAN + '(' + JSON.stringify(MARK_C) + ')') || '{}');
  A_('C2 【判别核心】回前台把它直接落到终态（自身既无 running 也无 paused＝不补播）', thawed.nodeRunning === 0 && thawed.nodePaused === 0, thawed);
  A_('C3 落终态后内容仍可见（不是被藏起来）', thawed.op === '1' && thawed.txt === true, thawed);

  A_('Z1 全程零未捕获 JS 异常', C.errors.length === 0, C.errors.slice(0, 3));
} finally {
  try { chrome.kill(); } catch (e) {}
  server.close();
}
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
