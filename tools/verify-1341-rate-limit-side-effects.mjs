// ===== 验证 #1341：复核 #1180 总量限流的四处口径（豁免位拆键／保底回应／入账前拦／文案如实）=====
// 用户 2026-09-27：「帮我检查这个功能有没有用，会不会导致无法正常聊天？帮我检查有没有错误？」→「同意，按建议修复这四个问题」。
// 本批四处收口（判据一律零机型／零 UA 分支）：
// ① 限流不再共用 #1015 夜间闸那把 nightAllow 钥匙（旧写法＝带 nightAllow 的 TA 自发内容——经期关心、
//    音乐互动系统台词——既不占额度也拦不住，与设置页文案「只有已读回执与你当刻操作引发的记录豁免」不符）；
// ② 额度满时「你刚说过的那句话」仍保底换来 1 条回应（旧行为＝已读回执照豁免⇒用户视角「TA 只已读不回」，
//    最长静音一整个窗口）；
// ③ 扣款/记账发生在投递之前的三类 TA 自发机制（自动红包／自动申请心意币／自动送礼）在**源头**先看额度，
//    钱已动的卡片带 rateAllow 必落（红包卡是唯一领取入口）；心愿卡投递结果如实回报；
// ④ 设置页／两份公告源／功能大全的说明补上「保底一条」「只管当前打开的联系人」「经期与音乐台词计入额度」。
// 用法：node tools/verify-1341-rate-limit-side-effects.mjs [--root=<已构建副本目录>]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize((process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1] || (dirname(fileURLToPath(import.meta.url)) + '/..'));
console.log('被测根目录 = ' + root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

// ---- S 静态（判据本体，不认名字）----
const ck = read('src/js/chat.js');
const gs = read('src/js/gift-shop.js');
const tpl = read('src/template.html');
const nz = read('src/pwa/notice.json');
const fh = read('src/js/feature-hub.js');
// 取函数体：从声明起往后截一段（够覆盖整个函数，多行 needle 也一并核到）
const bodyOf = (src, sig, len) => { const i = src.indexOf(sig); return i < 0 ? '' : src.slice(i, i + len); };
const rlFull = bodyOf(ck, 'function rateLimitFull()', 900);
ok(ck.includes("function rlExempt(p) { return !!p && (p.rateAllow === true || p.special === 'read'); }"),
  'S1 限流有自己的豁免位（rateAllow＋已读回执），不再共用 #1015 的 nightAllow');
ok(ck.includes("if (!p || (p.side || '') !== 'in' || rlExempt(p)) continue;"),
  'S2 计数循环按这把尺子豁免（退回 p.nightAllow＝拆位在计数侧失效，豁免面又变大）');
ok(rlFull.length > 0 && !rlFull.includes('nightAllow'),
  'S3 rateLimitFull 函数体内已无 nightAllow（残留＝两把钥匙又并成一把）');
ok(ck.includes('return !!rlUserSpokeAt && rlReserveFor !== rlUserSpokeAt && Date.now() - rlUserSpokeAt <= RL_REPLY_GRACE_MS;'),
  'S4 保底判据＝「你刚说过话」且「这一发还没用过保底」（删掉＝额度满时 TA 对你彻底静音）');
ok(ck.includes('if (rec.rlReserveUsed) rlReserveFor = rlUserSpokeAt;'),
  'S5 保底只在真落进 msgs 那一刻烧（写成立即烧＝被去重闸退回也烧＝整窗再没有保底）');
ok(ck.includes("if ((rec.side || '') === 'out') rlUserSpokeAt = Date.now();"),
  'S6 你自己发消息那一刻盖章（out 侧唯一收口＝addRec；删掉＝保底永不自用，回到「已读不回」）');
const rpAuto = bodyOf(ck, 'function trySystemAutoSend()', 1400);
ok(rpAuto.includes('if (rateLimitFull()) return;') && rpAuto.indexOf('if (rateLimitFull()) return;') < rpAuto.indexOf('rpWalletSet(wallet)'),
  'S7 TA 自动红包在扣款之前先看额度（顺序颠倒＝钱扣了卡片被拦，#1015「须在入账前拦」同一条口径）');
const askAuto = bodyOf(ck, 'function trySystemAskMochi()', 1200);
ok(askAuto.includes('if (rateLimitFull()) return;') && askAuto.indexOf('if (rateLimitFull()) return;') < askAuto.indexOf('rpWalletSet(wallet)'),
  'S8 TA 自动申请心意币在入账之前先看额度（删＝askDailyIncr 与余额都动了而卡片没上屏）');
const autoGift = bodyOf(gs, 'window.maybeAutoGift = function', 2600);
ok(autoGift.includes('if (window.chatRateLimitFull && window.chatRateLimitFull()) return;')
  && autoGift.indexOf('chatRateLimitFull') < autoGift.indexOf('walletSet(')
  && autoGift.indexOf('chatRateLimitFull') < autoGift.indexOf('wishSave(WL_MY_KEY'),
  'S9 自动送礼整轮在扣款／消费心愿之前先看额度（①②④ 与加心愿同链，#585 量过的「钱花了、心愿空了、礼物哪都没进」不再复发）');
ok(gs.includes('if (window.chatRateLimitFull && window.chatRateLimitFull()) return false;'),
  'S10 心愿卡投递如实回报成败（旧写法无论成败都 return true＝卡片被拦时那份回落提示也被吞）');
ok(gs.includes("special: 'gift', rateAllow: true, giftId: gift.id,") && gs.includes("special: 'gift', rateAllow: true, giftId: gift0.id,"),
  'S11 钱已扣／已写心意柜的礼物卡带限流豁免（兜住源头判定之后那段 1.5~4s 投递窗）');
ok(ck.includes('window.chatRateLimitFull = rateLimitFull;'),
  'S12 限流探针只读导出（跨文件那一半的接线；删＝gift-shop 只能照旧盲发）');
ok(ck.includes('opts.rateAllow = opts.rateAllow === true;') && ck.includes('nightAllow: opts.nightAllow, rateAllow: opts.rateAllow,'),
  'S13 chatAddSystem / addIn 两道白名单都透传 rateAllow（#673/#1015 同族教训：漏一处＝调用方写的豁免被就地吞掉）');
ok(ck.includes('addIn(\'\', { special: \'redpacket\', rateAllow: true,') && ck.includes("addRec({ side: 'in', special: 'askcoin', rateAllow: true,"),
  'S14 已扣款的红包卡／已入账的申请卡必落（与 S7/S8 成对：源头不生成，生成了就不再拦）');
ok(tpl.includes('③<b>你刚说过话</b>') && tpl.includes('限流只管你当前打开的这个联系人') && tpl.includes('计入额度、也会被拦'),
  'S15 设置页说明补上三条例外口径（删＝用户按旧文案「谁也不豁免」理解，反而把保底回应与跨桌面补投当功能失灵）');
ok(nz.includes('保底换来 1 条回应') && nz.includes('限流只管你当前打开的这个联系人'),
  'S16 在线权威源同口径（两份公告源必须同改，#1180h/i 同族）');
ok(tpl.includes('新增「总量限流」') || tpl.includes('「总量限流」（同面板下方，默认关闭）'),
  'S17 开屏离线兜底那一章仍在位（#1180h 的语义未被本批改文案时顺手抹掉）');
ok(fh.includes('你刚说过话时还保底换来 1 条回应') && fh.includes('限流只管你当前打开的这个联系人') && fh.includes('照常计入额度'),
  'S18 功能大全条目同步（用户搜「限流」看到的解释与代码一致：保底一条／只管当前联系人／经期与音乐台词照占额度）');
// 穷举尺子（本批的一把尺子）：src 里凡带 nightAllow 的发消息行都必须同时带 rateAllow；
// 唯一允许只剩 nightAllow 的，就是本批刻意收回豁免权的那两类（经期关心／音乐互动的氛围台词）。
// 少补一处＝那条「你当刻操作引发的记录」被本批悄悄从豁免改成可拦（用户视角：点了按钮没反应）。
const SCANNED = ['period.js', 'music-player.js', 'chat.js', 'decision.js', 'group-decision.js', 'gift-shop.js', 'avatar-lib.js', 'ta-ask.js', 'ta-mood.js', 'feed.js', 'mail.js', 'records.js', 'p2-features.js', 'calendar.js', 'divination.js', 'memo-app.js'];
const offenders = [];
for (const f of SCANNED) {
  read('src/js/' + f).split('\n').forEach((ln, i) => {
    if (!/nightAllow:\s*true/.test(ln)) return;
    if (!/addIn|addRec|chatAddIn|chatAddSystem|taMusicSys/.test(ln)) return;
    if (/rateAllow/.test(ln)) return;
    offenders.push(f + ':' + (i + 1) + ' ' + ln.trim().slice(0, 46));
  });
}
const intended = offenders.filter((o) => /^(period\.js|music-player\.js)/.test(o));
ok(offenders.length === intended.length && intended.length >= 1,
  'S19 穷举：「当刻操作」站点无一处掉豁免（剩下的只应是经期关心／音乐氛围台词＝本批刻意收回的两类）',
  '漏网=' + JSON.stringify(offenders));
// #1180 旧契约的三把尺子一字未动
ok(read('src/js/reply-settings.js').includes("'rl-en': 0, 'rl-win': 5, 'rl-max': 15,") && tpl.includes('id="rl-en"') && nz.includes('"h": "关于 TA 发消息太多'),
  'S20 #1180 的默认值行／设置页开关行／公告章标题一字未动（本批只换实现与文案，没缩邻居的尺子）');

// ---- B 行为（无头真跑产物，直驱产品函数）----
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
const port = 13900 + Math.floor(Math.random() * 90);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(tmpdir(), 'mochi-1323-' + Date.now()), '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 200); return r && r.result ? r.result.value : null; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:applock-qaskip','1');}catch(e){}" });
await cdp('Page.navigate', { url: origin });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var b=document.getElementById('splash-enter')||document.getElementById('splash-btn');if(b)b.click();return 1;})()");
await sleep(600);
const hasDiag = await ev("(function(){return typeof window.__rlDiag==='function';})()");
const D = async () => { const v = await ev('(window.__rlDiag?JSON.stringify(window.__rlDiag()):"null")'); try { return JSON.parse(v); } catch (e) { return null; } };
ok(hasDiag === true, 'B0 诊断钩子在产物里可用（__rlDiag：窗口内数到几条／msgs 条数／这一发的保底还在不在）');
// ⚠️ 夹具纪律（本支前四版各假红一次，四条都写死在这里，下一批别再踩）：
//   ① clearChatHistory() 之后有一拍**异步重读**会整包换掉 msgs：清完立刻连发，那条迟到的重读把刚 push
//      的记录抹掉（屏上气泡还留着而 msgs 里已经没有＝「额度已满」的前提凭空失效）。→ 「已满」这个前提
//      绝不沿用上一步的读数，每次都在断言前的**同一次同步 evaluate** 里现补现用（下面每把尺子自带补满）。
//   ② 尺子只用产品可观测的事实：「已满」＝一条普通收件被拒。不另建一份计数实现当尺子（复刻＝测不到真身），
//      所以 t0（纯 HEAD，没有本批新增的导出）同一把尺子照样能量——A/B 才是一把尺子而不是两份脚本。
//   ③ 保底按「你最后一次发消息那一刻」计 60 秒，而整支脚本跑不完这么久：任何跨 evaluate 的「先说话、再看
//      有没有放行」都会串味（说话后 TA 的回复链排在 0.8~2.4s，它在两次 evaluate 之间落地就把保底花掉）。
//      → 凡测保底，补满＋说话＋取样全在同一次同步 evaluate 里做完。
//   ④ 断言「该被拦」之前先烧掉这一次的保底（blocked() 自带这一步），否则读到的「放行」是保底的功劳。
const setRl = async (en, win, max) => { const r = await ev("(function(){window.saveReplyCfg('rl-en'," + en + ");window.saveReplyCfg('rl-win'," + win + ");window.saveReplyCfg('rl-max'," + max + ");var c=window.replyCfg();return JSON.stringify([c['rl-en'],c['rl-win'],c['rl-max']]);})()"); return r === 1 || typeof r !== 'string' ? null : r; };
const domIn = () => ev("document.querySelectorAll('#chat-body .msg-in').length");
const drain = async () => {
  await ev('window.clearChatHistory(); 1;');
  for (let k = 0; k < 45; k++) {
    if (Number(await domIn()) === 0) { await sleep(400); if (Number(await domIn()) === 0) return true; }
    await sleep(200);
  }
  return false;
};
const FILL = "for(var t=0;t<16;t++){if(!window.chatAddIn('1323-前提'+t+'-'+Date.now(),{}))break;}";
// admitted：现补满额度 → 投这一条，返回 1＝放行（量豁免位在不在的尺子）
const admitted = (tag, optsJs) => ev("(function(){" + FILL + "return window.chatAddIn('1323-" + tag + "-'+Date.now()," + (optsJs || '{}') + ")?1:0;})()");
// blocked：现补满额度 → 先烧掉这一次的保底 → 再投这一条，返回 0＝真被限流拦下
const blocked = (tag, optsJs) => ev("(function(){" + FILL + "window.chatSendMsg('1323-夹具烧-'+Date.now());window.chatAddIn('1323-烧这一口-'+Date.now(),{});" +
  "return window.chatAddIn('1323-" + tag + "-'+Date.now()," + (optsJs || '{}') + ")?1:0;})()");
// speakTry：现补满 → 说一句话 → 连投 cnt 条（测保底全程同步）
const speakTry = (cnt) => ev("(function(){" + FILL + "window.chatSendMsg('1323-说一句-'+Date.now());var ok=0;" +
  "for(var k=0;k<" + cnt + ";k++){if(window.chatAddIn('1323-回应'+k+'-'+Date.now(),{}))ok++;}return ok;})()");
// speakTryNoFill：不补满（前提＝此刻未满）→ 说一句话 → 连投 cnt 条
const speakTryNoFill = (cnt) => ev("(function(){window.chatSendMsg('1323-说一句-'+Date.now());var ok=0;" +
  "for(var k=0;k<" + cnt + ";k++){if(window.chatAddIn('1323-未满回应'+k+'-'+Date.now(),{}))ok++;}return ok;})()");
const tryAll = (cnt, tag) => ev("(function(){var ok=0;for(var k=0;k<" + cnt + ";k++){if(window.chatAddIn('1323-" + tag + "'+k+'-'+Date.now(),{}))ok++;}return ok;})()");
// plain：就投一条普通收件，不预先补满（量「这一格到底占没占额度」用）
const plain = (tag) => ev("(function(){return window.chatAddIn('1323-" + tag + "-'+Date.now(),{})?1:0;})()");

// —— 关闭态＝一切照旧（#1180 旧契约）
ok((await drain()) === true, 'B1 夹具：清档能等到屏上 in 侧归零（后面每段读数的地基）');
const w0 = await setRl(0, 5, 1);
ok(w0 === '[0,5,1]', 'B1b 设置写入生效（写盘立刻能被 replyCfg 读回——写不进去则整段读数无意义）', String(w0));
ok(Number(await tryAll(20, '关闸')) === 20, 'B2 关掉开关连发 20 条全部落地＝本批没动「关闭时一切照旧」');

// —— ① 拆钥匙：夜间闸与限流各认一把（前提「已满」由产品自己的拒绝行为数到）
await drain(); await setRl(1, 60, 1);
console.log('  DBG 阶段①起点=' + JSON.stringify(await D()) + ' drain=' + JSON.stringify(await drain()));
ok(Number(await blocked('普通')) === 0, 'B3 额度满时普通收件被拦（前提「已满」＝连投时被拒那一条，尺子可观测）');
ok(Number(await blocked('夜豁免', '{nightAllow:true}')) === 0,
  'B4 只带 nightAllow 的收件同样被拦＝两把钥匙已分开（旧代码在此放行＝经期关心／音乐互动的台词既不占额度也永远拦不住，与设置页文案不符）');
ok(Number(await admitted('限豁免', '{nightAllow:true,rateAllow:true}')) === 1,
  'B5 带 rateAllow（你当刻操作引发的记录）照落＝拆位没把该豁免的一并拆掉（红包领取退回／游戏战绩／存钱罐结算／决定结果同此）');
ok(Number(await admitted('回执', "{special:'read'}")) === 1, 'B6 已读回执仍豁免（不占额度也不被拦）');
ok(Number(await admitted('红包卡', "{special:'redpacket',rateAllow:true,rpAmount:1,rpWish:'w',rpStatus:'pending',rpTs:Date.now()}")) === 1,
  'B7 钱已扣的红包卡在额度满时必落（那张卡是唯一领取入口，拦掉＝心意币凭空消失）');

// —— ② 保底回应：旧行为＝额度满时你只收到一个「已读」
await drain(); await setRl(1, 60, 2);
ok(Number(await speakTry(3)) === 1, 'B8 额度已满时你刚说的那句话仍保底换来 1 条回应（三条里只落一条＝既消掉「已读不回」又没敞口；旧代码＝0 条）');
ok(Number(await blocked('安静期')) === 0, 'B9 保底烧掉之后这一窗内一条不放＝限流没被保底架空');
ok(Number(await ev("(function(){var n0=document.querySelectorAll('#chat-body .msg-out').length;window.chatSendMsg('1323-再说一句');window.chatSendMsg('1323-又说一句');return document.querySelectorAll('#chat-body .msg-out').length-n0;})()")) === 2,
  'B10 你自己的消息永远不受限（额度满时连发两条全部上屏＝「会不会导致无法正常聊天」＝不会）');
ok(Number(await speakTry(2)) === 1, 'B11 新说的这一发又拿到一次保底＝保底按「发」计数，不是一次性额度');

// —— ③ 按 ts 现算：窗口外的历史不占额度，也没有累计计数器
await drain(); await setRl(1, 5, 1);
ok(Number(await ev("(function(){var ok=0;for(var k=0;k<3;k++){if(window.chatAddGift({side:'in',text:'1323-旧'+k+'-'+Date.now(),ts:Date.now()-11*60000}))ok++;}return ok;})()")) === 3,
  'B12 11 分钟前的 3 条历史收件全照投（rl-max=1 也照落）');
ok(Number(await plain('窗口内第一条')) === 1, 'B13 窗口内第一条照落＝那 3 条历史确实一格都没占（按 ts 落回窗口，没有累计计数器）');
ok(Number(await blocked('窗口内第二条')) === 0, 'B14 窗口内第二条被拦（同一次同步内现补前提、先烧保底，剩下的读数才是限流本身）');
await drain(); await setRl(1, 60, 4);
ok(Number(await tryAll(3, '未满')) === 3, 'B15 前提：rl-max=4 时连投三条全落＝此刻未满');
ok(Number(await speakTryNoFill(2)) === 2,
  'B16 额度未满时落地的不烧保底：说话后一条补满额度、另一条仍值那一次保底（写成立即烧的此处只落 1 条）');
ok(Number(await blocked('烧尽后')) === 0, 'B17 那次保底用掉之后，同一发不再值第二条');
await setRl(0, 5, 1);
ok(Number(await tryAll(6, '再关')) === 6, 'B18 关掉开关后连发 6 条全落（窗口内已有收件也一样）＝限流只在开启时生效');
if (hasDiag === true) {
  const d = await D();
  ok(!!d && typeof d.n === 'number' && typeof d.total === 'number' && typeof d.reserve === 'number',
    'B19 诊断钩子读数自洽（n/total/reserve 三项齐全＝下一批按它设前提，不必再靠猜时序）', JSON.stringify(d));
}

ok(Number(await ev('(window.__jsErrors||[]).length')) === 0, 'Z1 全程零未捕获异常', await ev('JSON.stringify((window.__jsErrors||[]).slice(0,2))'));

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== #1341 总量限流四处口径复核: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
