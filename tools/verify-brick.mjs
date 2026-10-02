// ===== 专项验证：双人打砖块（更多功能 → 打砖块） =====
// A 组静态：build.mjs 注册 / template 锚点 / 产物接线 / mobile-adapt 浮层清单
// B 组运行时（无头 Chrome 390×844）：入口打开 → 开始 → 发球 → 触摸拖动 → 掉命 →
//   清层升级 → 游戏结束（聊天记录 + TA 回应 stub）→ 再来一局重置 → 关闭面板，全程无 JS 异常。
import { spawn } from 'node:child_process';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, detail) { console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (detail !== undefined ? '  实际=' + JSON.stringify(detail) : '')); if (cond) pass++; else fail++; }

// ---------- A 组静态 ----------
const buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8');
check('A1 breakout.js 已登记 build.mjs jsFiles', /'breakout\.js'/.test(buildSrc));
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
check('A2 template 锚点齐全', ['chat-brick-panel', 'more-brick', 'brick-canvas', 'brick-overlay-btn', 'brick-diff'].every(k => tpl.includes(k)));
const ma = readFileSync(join(root, 'src/js/mobile-adapt.js'), 'utf8');
check('A3 mobile-adapt 浮层双清单已登记 #chat-brick-panel', (ma.match(/'#chat-brick-panel'/g) || []).length >= 2);
let built = '';
try { built = readFileSync(join(root, 'index.html'), 'utf8'); } catch (e) {}
check('A4 构建产物含 openBrickPanel/more-brick 接线', built.includes('openBrickPanel') && built.includes("getElementById('more-brick')"));
const bo = readFileSync(join(root, 'src/js/breakout.js'), 'utf8');
check('A5 真全屏实现齐全（元素级 Fullscreen API + 系统退出同步 + 全局开关状态还原 + 竖屏锁）', bo.includes('requestFullscreen') && bo.includes("fullscreenchange") && bo.includes('restoreAppFs') && bo.includes("orientation.lock"));
check('A6 球数量设置（1~3）控件与逻辑齐备', tpl.includes('brick-balls') && bo.includes('targetBallCount') && bo.includes('respawns'));

// ---------- B 组运行时 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const tmpDir = mkdtempSync(join(tmpdir(), 'mochi-verify-brick-'));
writeFileSync(join(tmpDir, 'index.html'), built || readFileSync(join(root, 'index.html'), 'utf8'));
const baseUrl = 'file:///' + normalize(tmpDir).split(sep).join('/') + '/index.html';
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-audio-output', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-brick-' + Date.now()),
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
  if (r && r.exceptionDetails) { const ed = r.exceptionDetails; console.error('JS 异常:', String((ed.exception && ed.exception.description) || ed.text).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}
const J = (expr) => evalJs(`JSON.stringify((function(){${expr}})())`).then(s => JSON.parse(s));

try {
  await cdpConnect();
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(900);
  // 装聊天 stub（统计打砖块写入）+ 过开屏 + 进聊天页
  await evalJs(`(function(){
    window.__brickSys=[];window.__brickReply=[];
    var oS=window.chatAddSystem,oI=window.chatAddIn;
    window.chatAddSystem=function(t,o){window.__brickSys.push(t);return oS.call(window,t,o||{});};
    window.chatAddIn=function(t,o){window.__brickReply.push(t);return oI.call(window,t,o||{});};
    var b=document.querySelector('.splash-confirm-btn')||document.getElementById('splash-enter')||document.getElementById('splash-confirm-ok');if(b)b.click();
    document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});
    return true;
  })()`);
  await sleep(500);
  // #384 强制公告：滑到底 + 确认（clock.js 关闭后会把 splash 从 DOM 移除）
  for (let i = 0; i < 30; i++) {
    const r = await evalJs(`(function(){
      var sp = document.getElementById('splash');
      if (!sp || sp.classList.contains('hide')) return 'closed';
      var m = document.getElementById('splash-mandatory');
      if (m && !m.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll');
        if (sc) sc.scrollTop = sc.scrollHeight;
        var en = document.getElementById('splash-mandatory-enter');
        if (en && !en.classList.contains('is-disabled')) { en.click(); return 'entered'; }
        return 'wait';
      }
      var sb = document.getElementById('splash-box');
      if (sb) sb.scrollTop = sb.scrollHeight; // 开屏整页必须滑到底，进入按钮才解禁
      var se = document.getElementById('splash-enter');
      if (se && !se.disabled) { se.click(); return 'clicked'; }
      return 'wait';
    })()`);
    if (r === 'closed') break;
    await sleep(300);
  }
  const splashDiagBrick = await evalJs(`(function(){var sp=document.getElementById('splash');return {splash:!!sp,hide:sp?sp.classList.contains('hide'):null,mand:(function(){var m=document.getElementById('splash-mandatory');return m?!m.hidden:null;})()};})()`);
  console.log('  splash 收口诊断: ' + JSON.stringify(splashDiagBrick));
  await sleep(300);

  // T1 入口：更多功能 → 打砖块
  await evalJs(`document.getElementById('chat-more-btn').click()`);
  await sleep(300);
  await evalJs(`(function(){var b=document.getElementById('more-brick');if(!b)return 0;b.click();return 1;})()`);
  await sleep(400);
  const t1 = await J(`var p=document.getElementById('chat-brick-panel');var ov=document.getElementById('brick-overlay');
    return {open:p&&!p.hidden,ovShown:!!ov&&ov.hidden===false,title:(document.getElementById('brick-overlay-title')||{}).textContent||'',btn:(document.getElementById('brick-overlay-btn')||{}).textContent||''};`);
  check('T1 更多面板点「打砖块」→ 半框打开且显示开始覆盖层', t1.open && t1.ovShown && /打砖块/.test(t1.title) && t1.btn === '开始', t1);

  // T2 开始 → 发球运行
  await evalJs(`document.getElementById('brick-overlay-btn').click()`);
  await sleep(600);
  const t2 = await J(`var s=window.__brickDebug.state;return{status:s.status,lives:s.lives,level:s.level,nb:s.bricks.length,diff:s.diff};`);
  check('T2 点开始 → serve/rally、3 命、第 1 层、砖块≥26', ['serve', 'rally'].includes(t2.status) && t2.lives === 3 && t2.level === 1 && t2.nb >= 26 && t2.diff === 'easy', t2);
  await sleep(2200);
  const t3 = await J(`var s=window.__brickDebug.state;return{status:s.status,px:s.player.x,dx:s.dream.x,run:window.__brickDebug.running};`);
  check('T3 发球后进入 rally、双方挡板各守半场（玩家右/梦角左）', t3.run && t3.status === 'rally' && t3.px >= 200 && t3.px <= 400 && t3.dx > 20 && t3.dx < 200, t3);

  // T4 触摸拖动控制玩家挡板（玩家在右半场：从画布 62% 拖到 90%）
  const rect = await J(`var r=document.getElementById('brick-canvas').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};`);
  const txBefore = await evalJs(`window.__brickDebug.state.player.targetX`);
  // 清场：TA 互动卡可能随机弹出 #qa-mask 抢坐标触摸（T7c 的 TA 回应链路），先关掉
  await evalJs(`(function(){var q=document.getElementById('qa-mask');if(q&&!q.hidden){var c=document.getElementById('qa-mask-close');if(c)c.click();q.hidden=true;}return 1;})()`);
  // 同类残留：开屏确认按个别形态下没点掉（hit=DIV#.splash-footcard 实测抢走过 T4 触摸），补一次确认＋末路摘除
  await evalJs(`(function(){var sp=document.getElementById('splash');if(sp){var b=sp.querySelector('.splash-confirm-btn')||document.getElementById('splash-enter');if(b)b.click();}return 1;})()`);
  await sleep(250);
  await evalJs(`(function(){var sp=document.getElementById('splash');if(sp&&sp.parentNode)sp.parentNode.removeChild(sp);return 1;})()`);
  await sleep(150);
  // 同类残留③：开屏后有自动弹窗（openModal 大框 .modal--big，如卡片锁提醒/备份提醒）盖住画布抢 T4 触摸；点遮罩走其正常 close()
  await evalJs(`(function(){var m=document.getElementById('modal-mask');if(m&&!m.hidden)m.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 1;})()`);
  await sleep(150);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.left + rect.width * 0.62, y: rect.top + rect.height * 0.85 }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.left + rect.width * 0.9, y: rect.top + rect.height * 0.85 }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
  const txAfter = await evalJs(`window.__brickDebug.state.player.targetX`);
  const hitDiag = await evalJs(`(function(){var r=document.getElementById('brick-canvas').getBoundingClientRect();var el=document.elementFromPoint(Math.round(r.left+r.width*0.9),Math.round(r.top+r.height*0.85));return el?(el.tagName+'#'+(el.id||'')+'.'+(typeof el.className==='string'?el.className:'')):'none';})()`);
  check('T4 手指拖动 → 玩家挡板目标位向右移动', txAfter > txBefore, { before: txBefore, after: txAfter, hit: hitDiag });

  // T5 球掉出底部（左半场=梦角侧）→ 生命-1 → 自动重新发球（先记当前生命，防测试期自然掉球干扰）
  const lv0 = await evalJs(`window.__brickDebug.state.lives`);
  await evalJs(`(function(){var s=window.__brickDebug.state;s.status='rally';s.player.x=340;s.player.targetX=340;s.dream.x=180;s.dream.targetX=180;Object.assign(s.ball,{x:10,y:330,vx:0,vy:6});return 1;})()`);
  await sleep(500);
  const t5 = await J(`var s=window.__brickDebug.state;return{lives:s.lives,status:s.status,combo:s.combo};`);
  check('T5 掉球 → 生命-1、连击清零、等待重发', t5.lives === lv0 - 1 && t5.combo === 0 && ['serve', 'rally'].includes(t5.status), { before: lv0, ...t5 });

  // T5b 防死循环：球正中梦角挡板反弹（hit≈0）→ 必有水平分量，不再纯垂直上下循环
  await evalJs(`(function(){var s=window.__brickDebug.state;s.status='rally';s.dream.x=100;s.dream.targetX=100;s.player.x=300;s.player.targetX=300;Object.assign(s.ball,{x:100,y:290,vx:0,vy:3});return 1;})()`);
  await sleep(800);
  const vxAfter = await evalJs(`window.__brickDebug.state.ball.vx`);
  check('T5b 正中挡板反弹 → 强制水平分量（竖直通道无法维持循环）', Math.abs(vxAfter) > 0.4, { vx: vxAfter });

  // T6 清光砖块 → 这一层完成 → 升到第 2 层
  await sleep(1700);
  await evalJs(`(function(){var s=window.__brickDebug.state;if(s.status!=='rally'){s.status='rally';}s.bricks.forEach(function(b){b.hp=0;});Object.assign(s.ball,{vx:0,vy:0,x:200,y:120});s.prevVy=0;return 1;})()`);
  await sleep(300);
  const clearing = await evalJs(`window.__brickDebug.state.status`);
  await sleep(2600);
  const t6 = await J(`var s=window.__brickDebug.state;return{level:s.level,status:s.status,nb:s.bricks.length};`);
  check('T6 清层 → 「这一层完成」→ 第 2 层生成新砖', clearing === 'clearing' && t6.level === 2 && t6.nb > 0 && t6.status !== 'over', { clearing, ...t6 });

  // T7 生命归零 → 游戏结束 + 结算 + 聊天记录 + TA 回应
  await evalJs(`(function(){var s=window.__brickDebug.state;if(s.status==='serve'){s.status='rally';}s.lives=1;Object.assign(s.ball,{x:30,y:430,vx:0,vy:6});return 1;})()`);
  await sleep(700);
  const t7 = await J(`var ov=document.getElementById('brick-overlay');
    return {status:window.__brickDebug.state.status,ovShown:!!ov&&ov.hidden===false,title:(document.getElementById('brick-overlay-title')||{}).textContent||'',body:(document.getElementById('brick-overlay-body')||{}).textContent||'',btn:(document.getElementById('brick-overlay-btn')||{}).textContent||'',closeBtnHidden:document.getElementById('brick-overlay-close').hidden};`);
  check('T7 生命耗尽 → 【游戏结束】结算层（再来一局/返回小游戏）', t7.status === 'over' && t7.ovShown && /游戏结束/.test(t7.title) && t7.btn === '再来一局' && t7.closeBtnHidden === false, { status: t7.status, title: t7.title, btn: t7.btn, closeBtnHidden: t7.closeBtnHidden });
  check('T7b 得分/砖块/层数写进结算文案', /分/.test(t7.body) && /清除砖块/.test(t7.body) && /完成层数/.test(t7.body), t7.body);
  await sleep(1100);
  const chat = await J(`return {sys:window.__brickSys,reply:window.__brickReply};`);
  const lastReply = chat.reply[chat.reply.length - 1];
  const brickSys = chat.sys.find(t => /双人打砖块/.test(t));
  check('T7c 写入聊天记录卡 + TA 回应（还玩吗？/再来一局？）', !!brickSys && chat.reply.length >= 1 && ['还玩吗？', '再来一局？'].includes(lastReply), { sys: brickSys, reply: lastReply });

  // T8 再来一局 → 全重置、难度保持
  await evalJs(`(function(){document.getElementById('brick-diff').value='normal';document.getElementById('brick-overlay-btn').click();return 1;})()`);
  await sleep(400);
  const t8 = await J(`var s=window.__brickDebug.state;return{score:s.score,lives:s.lives,level:s.level,combo:s.combo,diff:s.diff,perf:!!(s.perf&&s.perf.kind)};`);
  check('T8 再来一局 → 分数/生命/连击/层数全重置，难度保持普通', t8.score === 0 && t8.lives === 3 && t8.level === 1 && t8.combo === 0 && t8.diff === 'normal' && t8.perf, t8);

  // ===== 多球设置（1~3）：发球数量 / 掉球续战 / 自动补发 / 改回单球 =====
  // T-B1 结束当前局 → 选择器设 3 → 再来一局应同时 3 颗球、出生点横向展开
  await evalJs(`(function(){var s=window.__brickDebug.state;s.lives=1;if(s.status==='serve'){s.status='rally';}Object.assign(s.ball,{x:30,y:430,vx:0,vy:6});return 1;})()`);
  await sleep(700);
  await evalJs(`(function(){var el=document.getElementById('brick-balls');el.value='3';el.dispatchEvent(new Event('change'));return 1;})()`);
  await evalJs(`document.getElementById('brick-overlay-btn').click()`);
  await sleep(1600);   // 等 serve(900ms) 完成进入 rally
  const tb1 = await J(`var s=window.__brickDebug.state;var xs=s.balls.map(function(b){return Math.round(b.x);});return{n:s.balls.length,xs:xs,status:s.status,mainEq:s.ball===s.balls[0]};`);
  check('T-B1 设 3 球再开局 → 场上 3 颗球、出生点横向展开、主球引用稳定', tb1.status === 'rally' && tb1.n === 3 && (Math.max.apply(null, tb1.xs) - Math.min.apply(null, tb1.xs)) >= 60 && tb1.mainEq, tb1);

  // T-B2 多球局掉一颗 → 生命-1、其余球继续（rally）、约 1.2s 后自动补回 3 颗
  const lvB = await evalJs(`window.__brickDebug.state.lives`);
  await evalJs(`(function(){var s=window.__brickDebug.state;s.dream.x=180;s.dream.targetX=180;s.player.x=340;s.player.targetX=340;var b=s.balls[s.balls.length-1];Object.assign(b,{x:10,y:330,vx:0,vy:6});for(var i=0;i<s.balls.length;i++){if(s.balls[i]!==b){s.balls[i].vx=0;s.balls[i].vy=0;s.balls[i].x=200;s.balls[i].y=150;}}return 1;})()`);
  await sleep(500);
  const tb2 = await J(`var s=window.__brickDebug.state;return{lives:s.lives,n:s.balls.length,status:s.status,combo:s.combo,mainEq:s.ball===s.balls[0]};`);
  check('T-B2 掉一颗球 → 生命-1、余球续战（rally）、主球引用稳定', tb2.lives === lvB - 1 && tb2.n === 2 && tb2.status === 'rally' && tb2.combo === 0 && tb2.mainEq, { before: lvB, ...tb2 });
  // T-B2b 掉球后自动补发回 3 颗（先冻结剩余球避免自然掉球干扰，验证到点补足）
  await evalJs(`(function(){var s=window.__brickDebug.state;for(var i=0;i<s.balls.length;i++){var b=s.balls[i];b.vx=0;b.vy=0;b.x=200;b.y=150;}return 1;})()`);
  await sleep(1600);
  const tb2b = await J(`var s=window.__brickDebug.state;return{n:s.balls.length,status:s.status,respawns:s.respawns.length};`);
  check('T-B2b 掉球后自动补发回 3 颗', tb2b.n === 3 && tb2b.status === 'rally', tb2b);

  // T-B3 改回 1 球 → 下次发球生效（清层重发后仅 1 颗球）
  await evalJs(`(function(){var el=document.getElementById('brick-balls');el.value='1';el.dispatchEvent(new Event('change'));var s=window.__brickDebug.state;if(s.status!=='rally'){s.status='rally';}s.bricks.forEach(function(b){b.hp=0;});Object.assign(s.ball,{vx:0,vy:0,x:200,y:120});return 1;})()`);
  await sleep(3000);   // 清层动画 1300 + 发球等待 900 + 发球
  const tb3 = await J(`var s=window.__brickDebug.state;return{n:s.balls.length,level:s.level,status:s.status};`);
  check('T-B3 改回 1 球 → 下次发球生效（新层仅 1 颗球）', tb3.n === 1 && tb3.level === 2 && tb3.status === 'rally', tb3);

  // T-B4/T-B5 进行中切换球数 → 立即生效（不打断对局、主球引用稳定、aiBall 无悬空引用）
  // T-B4 冻结当前球后切回 1 球确认单球，再切 2 球应立刻补发第 2 颗
  await evalJs(`(function(){var s=window.__brickDebug.state;if(s.status!=='rally'){s.status='rally';}for(var i=0;i<s.balls.length;i++){var b=s.balls[i];b.vx=0;b.vy=0;b.x=180+i*30;b.y=120;}var el=document.getElementById('brick-balls');el.value='1';el.dispatchEvent(new Event('change'));return 1;})()`);
  await sleep(150);
  const tb4a = await J(`var s=window.__brickDebug.state;return{n:s.balls.length,status:s.status,mainEq:s.ball===s.balls[0]};`);
  check('T-B4a 进行中切回 1 球 → 立即剪到 1 颗、对局不中断', tb4a.n === 1 && tb4a.status === 'rally' && tb4a.mainEq, tb4a);
  await evalJs(`(function(){var el=document.getElementById('brick-balls');el.value='2';el.dispatchEvent(new Event('change'));return 1;})()`);
  await sleep(150);
  const tb4b = await J(`var s=window.__brickDebug.state;var xs=s.balls.map(function(b){return Math.round(b.x);});return{n:s.balls.length,status:s.status,mainEq:s.ball===s.balls[0],xs:xs};`);
  check('T-B4b 进行中切 2 球 → 立即补发第 2 颗（出生点展开、对局不中断）', tb4b.n === 2 && tb4b.status === 'rally' && tb4b.mainEq && Math.abs(tb4b.xs[0] - tb4b.xs[1]) >= 10, tb4b);
  // T-B5 切 3 球补足、再切回 1 球剪除（含梦角锁定目标悬空引用清理）
  await evalJs(`(function(){var el=document.getElementById('brick-balls');el.value='3';el.dispatchEvent(new Event('change'));return 1;})()`);
  await sleep(150);
  const tb5a = await J(`var s=window.__brickDebug.state;return{n:s.balls.length,status:s.status,mainEq:s.ball===s.balls[0]};`);
  check('T-B5a 进行中切 3 球 → 立即补足 3 颗、对局不中断', tb5a.n === 3 && tb5a.status === 'rally' && tb5a.mainEq, tb5a);
  await evalJs(`(function(){var el=document.getElementById('brick-balls');el.value='1';el.dispatchEvent(new Event('change'));return 1;})()`);
  await sleep(150);
  const tb5b = await J(`var s=window.__brickDebug.state;return{n:s.balls.length,status:s.status,mainEq:s.ball===s.balls[0],aiBallIn:s.aiBall===null||s.balls.indexOf(s.aiBall)>=0};`);
  check('T-B5b 进行中切回 1 球 → 立即剪除多余球（主球稳定、aiBall 无悬空引用）', tb5b.n === 1 && tb5b.status === 'rally' && tb5b.mainEq && tb5b.aiBallIn, tb5b);

  // T-B6 进行中重开面板 → 副按钮「新开局」可放弃旧局、按当前球数立即开局
  await evalJs(`(function(){var el=document.getElementById('brick-balls');el.value='2';el.dispatchEvent(new Event('change'));return 1;})()`);
  await evalJs(`window.closeBrickPanel()`);
  await sleep(200);
  await evalJs(`(function(){var b=document.getElementById('more-brick');if(!b)return 0;b.click();return 1;})()`);
  await sleep(300);
  const tb6a = await J(`var ov=document.getElementById('brick-overlay');var oc=document.getElementById('brick-overlay-close');return{ovShown:!!ov&&ov.hidden===false,btn:document.getElementById('brick-overlay-btn').textContent,closeTxt:oc.textContent,closeHidden:oc.hidden};`);
  check('T-B6a 进行中重开面板 → 主按钮「继续」+ 副按钮「新开局」', tb6a.ovShown && tb6a.btn === '继续' && tb6a.closeTxt === '新开局' && !tb6a.closeHidden, tb6a);
  await evalJs(`document.getElementById('brick-overlay-close').click()`);
  await sleep(1400);   // 等新局 serve(900ms) 完成进入 rally
  const tb6b = await J(`var s=window.__brickDebug.state;return{score:s.score,status:s.status,n:s.balls.length,level:s.level};`);
  check('T-B6b 点「新开局」→ 放弃旧局重置并按当前球数（2）开局', tb6b.score === 0 && tb6b.status === 'rally' && tb6b.n === 2 && tb6b.level === 1, tb6b);

  // T-FS 真全屏：元素级 Fullscreen API 进入（stub 打在面板实例上，游戏请求的是 panel）→ UI 切换；系统侧退出 → 回半框
  const brickPreFsH = await J(`var c=document.getElementById('brick-canvas');return Math.round(c.getBoundingClientRect().height);`);
  await evalJs(`(function(){
    window.__fsReqCount=0;
    var p=document.getElementById('chat-brick-panel');
    p.__origRF=p.requestFullscreen;
    p.requestFullscreen=function(o){window.__fsReqCount++;return Promise.resolve();};
    return 1;
  })()`);
  const fsKeyPre = await evalJs(`localStorage.getItem((window.activePrefix&&window.activePrefix()||'xy-home-v2')+':fullscreen-enabled')`);
  await evalJs(`document.getElementById('brick-fs').click()`);
  await sleep(250);
  const tfs1 = await J(`var p=document.getElementById('chat-brick-panel');return{fs:p.classList.contains('brick-fs'),req:window.__fsReqCount,btn:document.getElementById('brick-fs').textContent};`);
  check('T-FS1 点⛶ → 请求元素级真全屏并切换全屏 UI', tfs1.fs && tfs1.req === 1 && tfs1.btn === '⤢', tfs1);
  // T-FS4 真·满屏：画布铺满可视区（上下左右零空隙）+ 场地逻辑高度随屏幕拉高
  await sleep(500);   // 等 fitCanvas 二次适配（420ms）跑完
  const tf4 = await J(`var c=document.getElementById('brick-canvas');var sc=document.querySelector('#chat-brick-panel .poke-card-scroll');var r=c.getBoundingClientRect();
    var hd=document.querySelector('#chat-brick-panel .poke-card-head'),inf=document.querySelector('#chat-brick-panel .brick-info'),ft=document.querySelector('#chat-brick-panel .pong-foot');
    return{cw:Math.round(r.width),ch:Math.round(r.height),sw:sc.clientWidth,sh:sc.clientHeight,gapL:Math.round(r.left-sc.getBoundingClientRect().left),gapT:Math.round(r.top-sc.getBoundingClientRect().top),gw:window.__brickDebug.W,gh:window.__brickDebug.H,
      ih:window.innerHeight,iw:window.innerWidth,hH:hd?hd.offsetHeight:-1,iH:inf?inf.offsetHeight:-1,fH:ft?ft.offsetHeight:-1};`);
  // T-FS4 全屏放大（双人横版契约：场地逻辑尺寸 400×340 恒定；竖屏下宽度受限，
  // 画布高 = 宽 × 340/400，且比半框显著放大——fitCanvas 扣头部/信息/底注后按视口适配）
  check('T-FS4 全屏画布保持场地纵横比且较半框放大', tf4.ch > brickPreFsH && Math.abs(tf4.ch - Math.round(tf4.cw * tf4.gh / tf4.gw)) <= 2 && tf4.cw <= tf4.sw && tf4.gw === 400 && tf4.gh === 340, { preFsH: brickPreFsH, ...tf4 });
  // 头部为文档流内 flex-shrink:0（当前设计非悬浮；底注竖屏保留、横屏才隐藏）
  const tf4b = await J(`var h=document.querySelector('#chat-brick-panel .poke-card-head');var f=document.querySelector('#chat-brick-panel .pong-foot');
    return{pos:getComputedStyle(h).position,shrink:getComputedStyle(h).flexShrink,footH:f?f.offsetHeight:-1};`);
  check('T-FS4b 全屏头部文档流保留（不悬浮不遮画布）', tf4b.pos === 'static' && tf4b.shrink === '0' && tf4b.footH >= 0, tf4b);
  // 模拟系统侧退出（返回手势）：清 fullscreenElement + 派发事件
  await evalJs(`(function(){
    var d=document;
    try{Object.defineProperty(d,'fullscreenElement',{configurable:true,get:function(){return null;}});}catch(e){}
    d.dispatchEvent(new Event('fullscreenchange'));
    return 1;
  })()`);
  await sleep(150);
  const tfs2 = await J(`var p=document.getElementById('chat-brick-panel');return {fs:p.classList.contains('brick-fs'),btn:document.getElementById('brick-fs').textContent,native:(function(){try{return !!document.fullscreenElement;}catch(e){return false;}})()};`);
  check('T-FS2 系统退出真全屏 → 自动回普通半框、按钮复位', !tfs2.fs && tfs2.btn === '⛶' && !tfs2.native, tfs2);
  // T-FS5 退出全屏 → 场地恢复 400×340 半框基准（setFieldSize 等比还原）
  const tf5 = await J(`return{gw:window.__brickDebug.W,gh:window.__brickDebug.H};`);
  check('T-FS5 退出全屏 → 场地恢复 400×340 半框基准', tf5.gw === 400 && tf5.gh === 340, tf5);
  await evalJs(`(function(){try{delete document.fullscreenElement;}catch(e){}return 1;})()`);
  await sleep(1250);   // 等 restoreAppFs 的 1100ms 延时还原跑完
  const fsKeyPost = await evalJs(`localStorage.getItem((window.activePrefix&&window.activePrefix()||'xy-home-v2')+':fullscreen-enabled')`);
  check('T-FS3 全局「全屏模式」设置不被游戏全屏污染（键值还原）', fsKeyPost === fsKeyPre, { pre: fsKeyPre, post: fsKeyPost });

  // T9 关闭面板
  await evalJs(`window.closeBrickPanel()`);
  await sleep(200);
  const closed = await evalJs(`document.getElementById('chat-brick-panel').hidden`);
  const running = await evalJs(`window.__brickDebug.running`);
  check('T9 返回小游戏 → 面板关闭并停止循环', closed === true && running === false);

  // 全程无 JS 异常
  const errs = await evalJs(`JSON.stringify(window.__jsErrors||[])`);
  check('T10 全程无 JS 运行时异常', errs === '[]', errs);
} finally {
  try { chrome.kill(); } catch (e) {}
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
