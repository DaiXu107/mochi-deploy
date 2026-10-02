// #1524 行为尺（重写：三类内核模型显式化，零时间赛跑）
// ① overlay 内核（GT7/K80 Edge）：瞬时收缩（同一拍）后全高 → 会话 <400ms 不判诚实 → B 型顶住 → vk 实测接管
// ②诚实内核（Chrome/华为）：持续收缩 ≥400ms 后全高 → 全高＝真收口 → 秒回位
// ③零信号内核（OPPO/荣耀）：无任何收缩 → 会话不开 → 保底救援（另由 #1512 尺覆盖）
// 用法：node tools/verify-1521-kb-converge.mjs（量当前产物）；MOCHI_ROOT=<副本> 量别版
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail).slice(0, 140) + ']' : ''));
}
function rd(p) { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } }
const jsMA = rd('js/mobile-adapt.js');
check('S1 三类内核一条规则·主链（删＝800/650/300ms 时间引信＝打字间隔＞窗口必拆会话＝两态横跳引擎）', jsMA.includes('if (_focNow && _aHoldNow()) { if (!_aVkHonest)'));
check('S2 三类内核一条规则·轮询腿', jsMA.includes('if (_focNow && _aHoldNow()) return;'));
check('S3 诚实内核判位（删＝单拍瞬时收缩也被当成诚实内核＝overlay 内核被误拆会话；跨度 120ms＝#1526：400ms 会漏掉互动卡短会话）', jsMA.includes('if (_aLowRuns >= 2 && _aLowSince && (Date.now() - _aLowSince) > 120) _aHonestSession = 1;'));
check('S9 实测尺监听器必须摘除（删＝旧会话的 geometrychange 监听留在下一会话里，拿陈旧实测把输入栏钉在半高＝真机「键盘一关输入栏停在半高」）', jsMA.includes("navigator.virtualKeyboard.removeEventListener('geometrychange', _aVkListener)") && jsMA.includes('_aVkListener = _applyVk;'));
check('S10 残差账必须在收口体内清零（删＝_aDockFix 跨会话残留，上一轮对账差值直接叠加到下一轮钉高）', /function _aKbCloseNow[\s\S]{0,1400}_aDockFix = 0;/.test(jsMA));
check('S11 收口恢复块不得挂在 return 之后（删＝基线钳/清账/现场快照整段变死代码，哨兵在而逻辑不在）', !/_aKbCloseNow\('gate'\);[^}]*\n\s*return;\s*\n\s*_aPhone\.style\.height = '';/.test(jsMA));
check('S4 残差只在读数/轴值变化后记一次（删＝每拍残差自反馈振荡＝GT7 实报闪屏抖动）', jsMA.includes("if (_sig === _aLastDockSig) return '';"));
check('S5 高度出口取整＋2px 死区（删＝逐拍写 637.333px＝OPPO reno16 实报抖动源）', jsMA.includes("if (want > 0 && Math.abs(want - _cur) > 2) _aPhone.style.height = want + 'px';"));
check('S6 收口抑制窗 1.2s（删＝收口后保底救援同拍踢回＝点一下回位又跳）', jsMA.includes('_aHoldSuppressUntil = Date.now() + 1200;'));

const cands = [process.env.CHROME_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'];
const browserPath = cands.filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!browserPath) { process.stderr.write('no browser\n'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const port = 30900 + Math.floor(Math.random() * 300);
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=390,844', '--user-data-dir=' + join(process.env.TEMP, 'm1521-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const ERRS = [];
for (let i = 0; i < 60; i++) {
  try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; }); break; } } catch (e) {}
  await sleep(150);
}
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const cdp = (me, pa = {}) => { const i = ++msgId; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: me, params: pa })); }); };
const ev = async (ex) => { const r = await cdp('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) { ERRS.push(1); } return r && r.result ? r.result.value : null; };
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1.5, mobile: true, screenWidth: 390, screenHeight: 844 });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "(function(){var vv={height:844,width:390,scale:1,offsetTop:0,offsetLeft:0,_ls:{},addEventListener:function(t,f){(vv._ls[t]=vv._ls[t]||[]).push(f);},removeEventListener:function(){},scrollTo:function(){},dispatch:function(t){(vv._ls[t]||[]).slice().forEach(function(f){try{f();}catch(e){}});}};Object.defineProperty(window,'visualViewport',{configurable:true,get:function(){return vv;}});window.__fakeVV=vv;var vk={overlaysContent:false,boundingRect:{x:0,y:488,width:390,height:356},_ls:{},addEventListener:function(t,f){(vk._ls[t]=vk._ls[t]||[]).push(f);},removeEventListener:function(){},dispatch:function(){(vk._ls.geometrychange||[]).slice().forEach(function(f){try{f({});}catch(e){}});}};try{Object.defineProperty(navigator,'virtualKeyboard',{configurable:true,get:function(){return vk;}});}catch(e){}window.__fakeVK=vk;return 1;})()" });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev("typeof window.mochiScreenAdj==='object'&&!!document.querySelector('.phone')")) break; await sleep(300); }
await cdp('Page.bringToFront'); await sleep(300);
await ev("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');if(s.parentNode)s.parentNode.removeChild(s);}var ph=document.querySelector('.phone');var d=document.createElement('div');d.id='ed';d.contentEditable='true';d.style.cssText='position:absolute;left:10px;bottom:0;width:200px;height:40px;background:#fff';ph.appendChild(d);window.__arm=setInterval(function(){var t=document.getElementById('ed');if(!t)return;try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}if(document.activeElement!==t){try{t.focus();}catch(e2){}}},600);return 1;})()");
const H = "(function(){var p=document.querySelector('.phone');return p?p.style.height:null;})()";
async function pollH(exp, to) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < (to || 5000)) { last = await ev(H); if (last === exp) return true; await sleep(120); }
  console.log('  [timeout] 期望 ' + exp + ' 实际 ' + last);
  return false;
}
async function resetAll() {
  await ev("(function(){window.mochiScreenAdj.set('kbgap',0);var d=document.getElementById('ed');if(d&&d.blur)d.blur();window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
  await sleep(1500);
}

// ① overlay 内核：瞬时收缩同拍→全高，vk 接管
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(400);
await ev("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
const o1 = await pollH('488px', 5000);
check('O1 overlay 内核：瞬时收缩后全高不误收，vk 实测接管停靠 488px', o1, await ev(H));

// ② overlay 内核：vk 归零＝立即收口
await ev("(function(){window.__fakeVK.boundingRect.height=0;window.__fakeVK.dispatch();return 1;})()");
const o2 = await pollH('', 2000);
check('O2 overlay 内核：vk 归零 ≤2s 收口（红侧必红＝vk 快收路径）', o2, await ev(H));

// ③ overlay 内核：点消息区＝收口（红侧无监听＝必红）
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(400);
await ev("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
await pollH('488px', 4000);
await ev("(function(){var cb=document.getElementById('chat-body');var t=document.getElementById('ed');var tgt=(cb&&cb.firstElementChild)?cb.firstElementChild:cb;if(tgt)tgt.dispatchEvent(new Event('touchstart',{bubbles:true}));return 1;})()");
const o3 = await pollH('', 2000);
check('O3 overlay 内核：点消息区当场收口（红侧无监听＝必红）', o3, await ev(H));

// ④ 诚实内核：持续收缩 ≥400ms 后全高＝真收口，秒回
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const h1 = await pollH('360px', 5000);
await sleep(700); // 诚实判位（>400ms 持续收缩）
await ev("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
const t4 = Date.now();
const h2 = await pollH('', 2000);
check('H1 诚实内核（持续收缩≥400ms）：全高读数＝真收口，≤2s 回位（红侧无诚实判位＝必红）', h1 && h2, { open: h1, ms: Date.now() - t4 });

// ⑤ 诚实内核：快速打字后立刻收起也秒收（400ms 门槛不误伤）
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const h3 = await pollH('360px', 5000);
await sleep(460); // 刚过 400ms 门槛（最紧用例）
await ev("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
const h4 = await pollH('', 2000);
check('H2 诚实内核快用例：停手 460ms 收起仍秒回（400ms 门槛设计意图）', h3 && h4, { open: h3, closed: h4 });

// ⑥ 抖动契约：读数不变时高度纹丝不动
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(400);
await ev("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
await pollH('488px', 4000);
const s1 = await ev(H);
await sleep(2000);
const s2 = await ev(H);
check('D1 止抖：读数不变 2s 内高度纹丝不动（红侧逐拍改写＝必红）', s1 === '488px' && s2 === '488px', { t0: s1, t2: s2 });

// ⑦ 高度出口全整数（无 637.333 这类小数）
check('D2 高度出口取整：实测会话内不存在小数高度', typeof s1 === 'string' && s1 === '488px', { h: s1 });

// ⑧c/⑧d（红米 K80 形态）：无头夹具造不出「会话开着且尺子答 0」的持续态（尺子需 3 拍全高才武装，
//    而武装前后会话又被诚实判位收掉）——该场景的验证只能靠真机复测（K80 Edge 重测后看诊断单 prov 是否从 0 变 1）。

// ⑧ 跨会话污染守卫：overlay 会话（实测 356 → 488）收口后，紧接着开一个诚实会话（360 持续 600ms），
//    高度必须走它自己的 360 再回底，绝不能停在上一轮的 488（残差账/监听器任一泄漏都会在这里现形）
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(400);
await ev("(function(){window.__fakeVK.boundingRect.height=356;window.__fakeVK.dispatch();return 1;})()");
const xPrev = await pollH('488px', 4000);
if (!xPrev) console.log('  [X1 前置未达 488px：跨会话污染守卫本轮不成立]');
await resetAll();
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=360;window.__fakeVV.dispatch('resize');return 1;})()");
const x1 = await pollH('360px', 6000);
await sleep(600);
await ev("(function(){window.__fakeVV.height=844;window.__fakeVV.dispatch('resize');return 1;})()");
const x2 = await pollH('', 2500);
check('X1 跨会话不污染：overlay 实测过的会话收口后，新会话走自己的高度并秒回（红侧＝停在上一轮 488px）', xPrev && x1 && x2, { prev: xPrev, opened: x1, closed: x2, h: await ev(H) });

// ⑨ 键盘间隙轴量程：±240 必须端到端能存能取（#1527：面板/RANGE/消费钳原为 ±80，
//    对「键盘完全不报信号、只能按固定比例猜高度」的机型够不着实测空隙）
await resetAll();
const gapCheck = await ev("(function(){var o={};try{o.set150=window.mochiScreenAdj.set('kbgap',150);}catch(e){o.err1=String(e);}try{o.v150=window.mochiScreenAdj.all().kbgap;}catch(e){o.err2=String(e);}try{o.set300=window.mochiScreenAdj.set('kbgap',300);}catch(e){o.err3=String(e);}try{o.v300=window.mochiScreenAdj.all().kbgap;}catch(e){o.err4=String(e);}window.mochiScreenAdj.set('kbgap',0);return JSON.stringify(o);})()");
// ⑨b #1531 基线钳：先让基线抓在「地址栏隐」的高读数上，再让地址栏显示（vv 回落）——
//    页面不得把这次回落当成键盘弹出（红侧＝会话开启、.phone 被钉成全高 690px＝与保底停靠互抢＝弹跳闪屏）
await resetAll();
await ev("(function(){try{Object.defineProperty(window,'innerHeight',{configurable:true,get:function(){return 690;}});}catch(e){}return 1;})()"); // #1531：真机几何＝innerHeight 恒 690
await ev("(function(){window.__fakeVV.height=816;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(1200); // 基线抓在 816（地址栏隐）
await ev("(function(){var t=document.getElementById('ed');if(t){try{t.dispatchEvent(new Event('touchstart',{bubbles:true}));}catch(e){}try{t.focus();}catch(e2){}}window.__fakeVV.height=690;window.__fakeVV.dispatch('resize');return 1;})()");
await sleep(900);
const z3 = await ev(H);
await ev("(function(){try{delete window.innerHeight;}catch(e){}return 1;})()"); // 恢复
check('Z3 基线卡高：地址栏显隐回落不得被当成键盘弹出（红侧＝会话开启钉全高 690px＝与保底停靠互抢＝弹跳闪屏）', z3 !== '690px', { h: z3 });

check('Y1 键盘间隙轴：150 可设置可读回（红侧＝面板/RANGE 只到 80，set 被钳成 80＝大空隙补不动）', (gapCheck || '').indexOf('"v150":150') >= 0, gapCheck);
check('Y2 键盘间隙轴：超量程 300 被拒且原值不变（set 返回 false，不静默改写用户值）', (gapCheck || '').indexOf('"set300":false') >= 0 && (gapCheck || '').indexOf('"v300":150') >= 0, gapCheck);
check('Y3 面板条目量程 ±240（红侧＝滑块还停在 ±80，补不动大空隙）', rd('js/personalize.js').indexOf("name: '键盘间隙', min: -240, max: 240") >= 0);

check('Z1 零 JS 异常', ERRS.length === 0, ERRS.length);
const pass = results.filter((x) => x.ok).length;
console.log('\n#1524 共/g ' + results.length + ' 断言：通过 ' + pass + ' / 失败 ' + (results.length - pass));
browser.kill(); server.close();
process.exit(results.length - pass === 0 ? 0 : 1);
