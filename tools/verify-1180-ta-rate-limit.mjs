// ===== 验证 #1180：TA 消息总量限流（默认关闭）=====
// 用户直派：「回复条数最少 1 / 最多 2，因为还有撤回补发消息、其他功能发送的消息和卡片互动，
//   再加上『回复条数最多 2』会导致聊天里联系人发送的消息非常多，怎么限制和优化」。
// 「回复条数」只管被动回复的基础条数，逐卡连发/撤回补发/心情分享/红包捎话/邀请/主动发送全都
//   绕过它——所以本批另加一道「总量闸」：任意 rl-win 分钟内 TA 最多发 rl-max 条，超出的不再投递。
//   默认关闭＝行为一字不变。
// 断言：S 静态锚（闸在位＋三处接线＋默认值行＋设置行＋两份公告源＋功能介绍条目）；
//   B 行为（真实构建页直驱 window.chatAddIn / window.chatAddGift）：
//     默认态连发 20 条全落；打开 rl-en（rl-max=3）后恰 3 条、音效与气泡同步、不再演「正在输入」；
//     已读回执与 nightAllow 记录不占额度也不被拦；窗口滑过后恢复；关掉开关恢复原行为。
// 用法：node tools/verify-1180-ta-rate-limit.mjs [--root=<已构建副本目录>]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize((process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1] || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

// ---- S 静态（判据本体，不认名字）----
const ck = read('src/js/chat.js');
const rs = read('src/js/reply-settings.js');
const tpl = read('src/template.html');
const nz = read('src/pwa/notice.json');
const fh = read('src/js/feature-hub.js');
ok(ck.includes('if (++n >= max) return true;'), 'S1 窗口内按 msgs 的 in 侧收件计数判额（return true 被删＝限流永不触发）');
// #1341 换锚：判据从「三个散装参数」收成「整份记录」（豁免位与夜间闸分开、保底记在记录上）——语义不变，旧 needle 在新形态下必然消失
ok(ck.includes('if (rateBlocksIn(rec)) return null;'), 'S2 限流闸接在 addRec（覆盖 chatAddGift 等不过 addIn 的通道）');
// #1341 换锚：同上，addIn 侧改判一份探针对象（音效仍在闸之后播）
ok(ck.includes("if (rateBlocksIn({ side: 'in', special: opts.special, rateAllow: opts.rateAllow })) return null;"), 'S3 限流闸同样接在 addIn 的音效之前（否则超额「响一声没气泡」）');
ok(ck.includes('if (rateLimitFull() && !rlReserveAvailable()) return;') || ck.includes('if (rateLimitFull()) return;'), 'S4 额度满时不再演「对方正在输入」（#1341 起还要求「这一次保底确实已用掉」）');
ok(rs.includes("'rl-en': 0, 'rl-win': 5, 'rl-max': 15,"), 'S5 三个键进 DEFAULTS 且总开关默认 0（不登记＝开关初值恒空、读不到兜底）');
ok((rs.match(/'rc-en', 'rl-en', 'fish-en'/g) || []).length === 3, 'S6 rl-en 同步进三处通用开关列表（回显/绑定/回填）', '实数=' + (rs.match(/'rc-en', 'rl-en', 'fish-en'/g) || []).length);
ok(tpl.includes('id="rl-en"') && tpl.includes('data-k="rl-win"') && tpl.includes('data-k="rl-max"'), 'S7 设置页「总量限流」组三行在位');
ok(tpl.includes('想让上面这些一起被管住，打开本面板下方「总量限流」'), 'S8「为什么比设的还多」那条说明指向限流出口（#869 同族）');
ok(tpl.includes('关于 TA 发消息太多（「回复条数」为什么管不住，以及新增的总量限流）</p>'), 'S9 开屏公告（离线兜底源）新增该章（#1502 起目录统一编号，判据去前导「>」＝对「N、」前缀不敏感）');
ok(nz.includes('关于 TA 发消息太多（「回复条数」为什么管不住，以及新增的总量限流）"'), 'S10 在线权威源 notice.json 同口径一份（两份必须同改；#1502 起同前）');
ok(fh.includes("n: 'TA 消息限流（总量限流）'") && fh.includes("n: '为什么 TA 发的比「回复条数」还多'"), 'S11 功能大全两条目（功能＋解释都能被搜到）');

// ---- B 行为 ----
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port + '/index.html';

const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge（CHROME_PATH）'); process.exit(1); }
const port = 13600 + Math.floor(Math.random() * 200);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(tmpdir(), 'mochi-1180-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 200); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// 种开屏跳过＋免打扰无关键；统计 playSfx('in') 与「正在输入」行的显示次数
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (function () {
      try { localStorage.setItem('xy-home-v2:applock-qaskip', '1'); } catch (e) {}
      window.__sfxIn = 0;
      var t = null;
      Object.defineProperty(window, '__sfxWatch', { value: true });
      var iv = setInterval(function () {
        if (!window.playSfx || window.__sfxWrapped) return;
        window.__sfxWrapped = true; clearInterval(iv);
        var orig = window.playSfx;
        window.playSfx = function (n) { if (n === 'in') window.__sfxIn++; return orig.apply(this, arguments); };
      }, 50);
      window.__typingShown = 0;
      var iv2 = setInterval(function () {
        var el = document.getElementById('chat-typing');
        if (!el || window.__typingWatched) return;
        window.__typingWatched = true; clearInterval(iv2);
        new MutationObserver(function () { if (!el.hidden) window.__typingShown++; })
          .observe(el, { attributes: true, attributeFilter: ['hidden'] });
      }, 50);
    })();
  `
});
await cdp('Page.navigate', { url: origin });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
console.log('  DBG boot=' + JSON.stringify(await ev("(function(){return JSON.stringify({ready:!!window.__mochiDataReady,rl:typeof window.saveReplyCfg,addIn:typeof window.chatAddIn,gift:typeof window.chatAddGift})})()")));
// 开屏遮罩必须点掉，否则后续读聊天页会拿到假态（历次教训）
await ev("(function(){var b=document.getElementById('splash-enter')||document.getElementById('splash-btn');if(b){b.click();return 'clicked';}var s=document.getElementById('splash');if(s){s.style.display='none';}return 'noenter';})()");
await sleep(600);

const bubbleN = async () => Number(await ev("document.querySelectorAll('#chat-body .msg').length"));
// 直驱产品函数发 N 条收件，返回「落地条数」（addRec 被闸拦下时返回 null）
const sendIn = async (n, optsJs, tag) => ev(`(function(){var ok=0;for(var i=0;i<${n};i++){var r=window.chatAddIn('1180-${tag}'+i, ${optsJs || '{}'});if(r)ok++;}return ok;})()`);

// 阶段0：默认态（一个键都不写）
const d0 = await ev("(function(){var c=(window.replyCfg&&window.replyCfg())||{};return JSON.stringify([c['rl-en'],c['rl-win'],c['rl-max']]);})()");
ok(d0 === '[0,5,15]', 'B0 默认配置 rl-en=0 / rl-win=5 / rl-max=15', d0);
const ui0 = await ev("(function(){var e=document.getElementById('rl-en');var w=document.getElementById('rl-win-val');var m=document.getElementById('rl-max-val');return JSON.stringify([e?e.checked:null,w?w.value:null,m?m.value:null]);})()");
ok(ui0 === '[false,"5","15"]', 'B1 设置页按默认值回显（开关关、窗口 5、上限 15）', ui0);
const n0b = await bubbleN();
const s0 = await sendIn(20, null, 'default');
ok(Number(s0) === 20, 'B2 默认（关闭）态：连发 20 条全部落地＝行为与改造前一字不变', '落地=' + s0);
ok((await bubbleN()) - n0b === 20, 'B3 默认态气泡数与落地数一致');
// 阶段0 的 20 条真收件会落库、重载后仍在（且都落在窗口内），不清掉会把阶段1 的额度占满
await ev('window.clearChatHistory(); 1;');
await sleep(400);

// 阶段1：打开限流（rl-max=3）——开关走真实 DOM 勾选＋change，证通用绑定接得上
await ev("(function(){var e=document.getElementById('rl-en');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));window.saveReplyCfg('rl-win',5);window.saveReplyCfg('rl-max',3);return 1;})()");
const ui1 = await ev("(function(){var e=document.getElementById('rl-en');return JSON.stringify([e?e.checked:null,(window.replyCfg()||{})['rl-en'],(window.replyCfg()||{})['rl-max']]);})()");
ok(ui1 === '[true,1,3]', 'B4 勾选开关即存即读（写盘走当前联系人命名空间，rl-win/rl-max 同键族）', ui1);
await ev('window.__sfxIn = 0; window.__typingShown = 0;');
const n1b = await bubbleN();
const s1 = await sendIn(8, null, 'limited');
ok(Number(s1) === 3, 'B5 打开限流（窗口 5 分钟／上限 3 条）：连发 8 条只落 3 条', '落地=' + s1);
ok((await bubbleN()) - n1b === 3, 'B6 聊天里也只多出 3 个气泡（拦下的不留痕）');
const sfx1 = await ev('window.__sfxIn');
ok(sfx1 === 3, 'B7 音效只响 3 次（闸在 playSfx 之前＝不会「响一声没消息」）', '响=' + sfx1);
const typ1 = await ev('window.__typingShown');
ok(typ1 === 0, 'B8 额度已满期间不再显示「对方正在输入」（不会打了字又没发出来）', '显示=' + typ1);

// 阶段2：豁免口径（此刻窗口额度已满＝3/3）
const readOk = await ev("(function(){var ok=0;for(var i=0;i<5;i++){if(window.chatAddIn('1180-read'+i, {special:'read'}))ok++;}return ok;})()");
ok(Number(readOk) === 5, 'B9 已读回执额度已满时照落、不被拦（5 条全落）', '落地=' + readOk);
// #1341 翻案并新增：旧写法里 nightAllow 这一把钥匙同时豁免了夜间闸与限流（＝带它的 TA 自发内容既不占额度也拦不住，
// 与设置页文案「只有已读回执与你当刻操作引发的记录豁免」不符）。现在两把钥匙分开：当刻操作记录认 rateAllow。
const onlyNa = await ev("(function(){var ok=0;for(var i=0;i<3;i++){if(window.chatAddIn('只有夜间豁免'+i, {nightAllow:true}))ok++;}return ok;})()");
ok(Number(onlyNa) === 0, 'B10b 只带 nightAllow（TA 自发内容：经期关心／音乐互动台词）此刻占额度并被拦＝两把钥匙已分开（#1341 翻案）', '落地=' + onlyNa);
const naOk = await ev("(function(){var ok=0;for(var i=0;i<3;i++){if(window.chatAddIn('当刻操作'+i, {nightAllow:true,rateAllow:true}))ok++;}return ok;})()");
ok(Number(naOk) === 3, 'B10 rateAllow（用户当刻操作引发的记录：决定结果/战绩/存钱罐）不占额度也不被拦（#1341 换这把钥匙）', '落地=' + naOk);
// B11：窗口外的旧收件不占额度——先关闸灌 10 条「10 分钟前」的历史收件（模拟 TA 过去聊过），
// 再开闸连发 3 条新鲜收件：3 条必须全落（旧消息被 ts 挡在窗口外），第 4 条才被拦。
await ev("(function(){window.clearChatHistory();window.saveReplyCfg('rl-en',0);return 1;})()");
await sleep(300);
const seeded = await ev("(function(){var ok=0;for(var i=0;i<10;i++){if(window.chatAddGift({side:'in',text:'1180-old'+i,ts:Date.now()-10*60000}))ok++;}return ok;})()");
await ev("(function(){window.saveReplyCfg('rl-en',1);return 1;})()");
const fresh3 = await ev("(function(){var ok=0;for(var i=0;i<3;i++){if(window.chatAddIn('1180-fresh'+i))ok++;}return ok;})()");
ok(Number(seeded) === 10 && Number(fresh3) === 3, 'B11 关闸时历史照投（addRec 侧入口不受影响）；开闸后窗口外旧收件不占额度，10 分钟前的 10 条＋新 3 条全部落地', '历史=' + seeded + ' 新=' + fresh3);
const blocked4 = await ev("(function(){return window.chatAddIn('1180-窗口内第4条普通收件')?1:0;})()");
ok(Number(blocked4) === 0, 'B12 额度用满后普通收件被拦（＝拦的是「本窗口新增」，与历史条数无关）', '落地=' + blocked4);

// 阶段3：额度实时按 msgs 现算（＝窗口真滑过去后自动恢复，没有累计计数器）
const raised = await ev("(function(){window.saveReplyCfg('rl-max',99);var ok=0;for(var i=0;i<5;i++){if(window.chatAddIn('1180-抬额后'+i))ok++;}return ok;})()");
ok(Number(raised) === 5, 'B13 抬高上限后立刻放行（同一条链路上一次刚被拦）＝额度按 msgs 现算、无累计计数器（窗口滑过同理恢复）', '落地=' + raised);

// 阶段4：关掉开关＝恢复原行为（重载后按存储回显）
await ev("(function(){window.saveReplyCfg('rl-en',0);window.saveReplyCfg('rl-max',2);return 1;})()");
await cdp('Page.navigate', { url: origin });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var b=document.getElementById('splash-enter')||document.getElementById('splash-btn');if(b){b.click();}return 1;})()");
await sleep(500);
const ui4 = await ev("(function(){var e=document.getElementById('rl-en');return JSON.stringify([e?e.checked:null,(window.replyCfg()||{})['rl-en'],(window.replyCfg()||{})['rl-max']]);})()");
ok(ui4 === '[false,0,2]', 'B14 重载后开关回显为「关」（per-联系人独立存储，不残留）', ui4);
const n4b = await bubbleN();
const s4 = await sendIn(10, null, 'off-again');
ok(Number(s4) === 10 && (await bubbleN()) - n4b === 10, 'B15 关闭开关后连发 10 条全落（即便 rl-max=2）＝限流真的只在开启时生效', '落地=' + s4);

// 阶段5：公告章在两处源都渲染得到
const chap = await ev("(function(){var s=document.getElementById('splash');return s&&/关于 TA 发消息太多/.test(s.innerText)?1:0;})()");
ok(Number(chap) === 1, 'B16 开屏公告渲染出「关于 TA 发消息太多」一章（用户能看懂回复条数管不住哪些）');

ok(Number(await ev('(window.__jsErrors||[]).length')) === 0, 'Z1 全程零 JS 异常');

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== #1180 TA 消息总量限流验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
