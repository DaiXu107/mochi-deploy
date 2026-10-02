// ===== 验证「连发的每一条算一轮」（nova 口径搬进 mochi）：同一把尺子量两份副本 =====
// 用户直派：「mochi 那边总是会因为我发消息，然后联系人发一堆消息，应该也按 nova 的优化」。
// 根因不在「回复条数」上限，在 scheduleReply 是**每发一条各排一批**：发 5 条＝5 套定时器树，
// 每套再抽 1~reply-max 条 → 实测（本脚本 b 侧、纯 HEAD）5 条发完落 8~9 条，再叠逐卡连发／撤回补发。
// 改法＝一轮只排一次队、骰子只掷一次（已读不回／拍一拍／回几条／引用全掷在轮上），
// 条数只跟 TA 这一轮有几句话要说有关，不再按你发了几条放大。
// 计数口径（两次踩坑换来的）：clearChatHistory 之后有一拍异步重读会整包换掉 msgs（#1180 原话），
// 所以① 只在开头清一次库，之后按「累计去重seen」数，边跑边采样——被换掉的那批已经在册；
// ② 每例设完设定当场读回比对，写不下去的设定会让九例全跑在默认值上（拼错一个括号就发生过）。
// 用法：node verify-turn-reply.mjs --root=<副本目录>
//   b＝纯 HEAD（旧行为，本批新契约应当红），w＝HEAD＋并轮补丁（应当全绿）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve((process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1] || '.'); // 必须绝对化：否则守卫里的 startsWith 会把每个请求 403 掉
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

// ---- S 静态锚（本批新契约本体：b 侧红＝判别力，不是坏）----
const ck = read('src/js/chat.js');
ok(ck.includes('const TURN_HOLD = 1500, TURN_HOLD_MAX = 8000;'), 'S1 「一轮」的推后步长与封顶在位');
ok(ck.includes('function runReplyTurn(myCid) {'), 'S2 到点结算独立成 runReplyTurn（骰子掷在轮上，不在每一句上）');
ok(ck.includes('const replyTurns = {}; /* cid -> { due, cap, timer } */') && ck.includes('replyTurns[myCid] = { due:'), 'S3 轮按联系人 cid 各存一份（单槽会让 A 的轮被 B 的话顶掉＝永远不回）');
ok(ck.includes('if (Number(cfg()[\'turn-en\']) === 1) return scheduleReplyTurn();') && ck.includes('return scheduleReplyMochi();'), 'S3b 两条机制由开关分流，默认走 mochi 原机制');
ok(ck.includes('t.silent = 1;'), 'S3c 判「已读不回」后占住这一轮（补的话不再各掷一次＝5 枚回执那种）');
ok(ck.includes('t.due = Math.min(t.cap, Math.max(t.due, nowT + TURN_HOLD));'), 'S4 延长：不早于原计划、不晚于这一轮的封顶');
ok(ck.includes('window.__replyWaitT0 = Date.now();'), 'S5 #571 延迟遥测起点原文仍在（那是登记在册的哨兵 needle）');
ok(ck.includes("const sameCid = () => (window.__activeCid || 'default') === myCid;"), 'S6 #517 换桌面守卫未被动（verify-auto-cid-guard 认这句原文）');
ok(ck.includes("window.replyGuideHint('py')"), 'S7 #218 连发多条引导提示仍在');
ok(ck.includes("const count = (c['py-en'] === 1) ? randInt(rpMin, rpMax) : 1;"), 'S8 #167 多字卡总开关语义未动（关掉＝恒一条）');
ok(ck.includes('if (i < count - 1) showTyping();'), 'S9 条间「正在输入」的原节奏未动');

// ---- 起页 ----
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
const udd = join(tmpdir(), 'mochi-turn-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + udd, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map(); const uncaught = [];
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    const pg = l.find((t) => t.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') uncaught.push(String((m.params && m.params.exceptionDetails && ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text)) || '').slice(0, 140)); }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('CDP 连不上'); chrome.kill(); process.exit(1); }
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 200); return r && r.result ? r.result.value : null; };

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:applock-qaskip','1');}catch(e){}" });
await cdp('Page.navigate', { url: origin });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
await ev("(function(){var b=document.getElementById('splash-enter')||document.getElementById('splash-btn');if(b){b.click();return 1;}var s=document.getElementById('splash');if(s)s.style.display='none';return 0;})()");
await sleep(800);
const boot = String(await ev("(function(){return JSON.stringify({ready:!!window.__mochiDataReady,send:typeof window.chatSendMsg,cfg:typeof window.saveReplyCfg,exp:typeof window.chatExportMsgs})})()"));
console.log('  DBG boot=' + boot);
if (!/"send":"function"/.test(boot)) { console.error('页面没起来或发送钩子不在，终止'); chrome.kill(); server.close(); process.exit(1); }

// ---- 量具 ----
// 一切「不是由你发消息引起的」入口先归零，免得主动投递混进计数（本尺只测被动回复这一路）
const OFF = { 'as-en': 0, 'mjf-en': 0, 'ckq-en': 0, 'ai-rps-en': 0, 'ai-game-en': 0, 'ai-cuddle-en': 0, 'ai-cc-en': 0, 'rp-thx-en': 0, 'fish-en': 0, 'work-en': 0, 'fish-grab-en': 0, 'ml-write-en': 0, 'ml-fish-week-en': 0, 'fd-post-en': 0, 'rc-en': 0, 'rl-en': 0, 'rn-prob': 0, 'touch-prob': 0, 'quote-prob': 0, 'qs-en': 0, 'turn-en': 1 };
const setCfg = (o) => ev('(function(){var o=' + JSON.stringify(o) + ';for(var k in o)window.saveReplyCfg(k,o[k]);try{window.__probeCfg=1}catch(e){}return 1})()');
const cfgRead = (keys) => ev('(function(){var c=window.replyCfg()||{};var ks=' + JSON.stringify(keys) + ';var o={};for(var i=0;i<ks.length;i++)o[ks[i]]=c[ks[i]];return JSON.stringify(o)})()');
const MSGS_JS = "JSON.stringify((window.chatExportMsgs()||[]).map(function(m){return [(m.side||''),(m.special||''),String(m.text||'').slice(0,40),String(m.ts||0),m.quote==null?'':(typeof m.quote==='object'?String(m.quote.t||''):String(m.quote))]}))";
const snap = async () => { const s = String(await ev(MSGS_JS)); if (s.charAt(0) !== '[') return []; try { return JSON.parse(s); } catch (e) { return []; } };
const keyOf = (r) => r[0] + '|' + r[1] + '|' + r[2] + '|' + r[3];
const isPlain = (r) => r[0] === 'in' && r[1] === '';
const isRead = (r) => r[0] === 'in' && r[1] === 'read';
const isPoke = (r) => r[0] === 'in' && r[1] === 'poke';
const isQuoted = (r) => r[0] === 'in' && r[4] && r[4] !== '';
// 上一例的迟到件（replyOnce 里 await 字卡库可能让末条晚于「3 秒不动」）先落完再起手，
// 不然它会串进下一例的窗口里＝多出一条不属于本例的收件
const drain = async () => {
  const cnt = () => ev("(window.chatExportMsgs()||[]).filter(function(m){return m.side==='in'}).length");
  let last = Number(await cnt()), stable = Date.now(), t0 = Date.now();
  while (Date.now() - stable < 4000 && Date.now() - t0 < 16000) { await sleep(500); const n = Number(await cnt()); if (n !== last) { last = n; stable = Date.now(); } }
};
const sample = async (st) => { for (const r of await snap()) { if (Number(r[3]) < st.from) continue; const k = keyOf(r); if (st.seen.has(k)) continue; st.seen.add(k); if (isPlain(r)) st.plain.add(k); if (isRead(r)) st.read.add(k); if (isPoke(r)) st.poke.add(k); if (isQuoted(r)) st.quote.add(String(r[4])); } };
const newRun = () => ({ from: 0, seen: new Set(), plain: new Set(), read: new Set(), poke: new Set(), quote: new Set() });
// 每例：设值→当场读回比对→（上一段的迟到件先落完）→ 边发边采到地平线
const runCase = async (cfgObj, tag, burstTexts, gapMs, floorExtraMs, probeMidMs) => {
  const want = Object.assign({}, OFF, cfgObj);
  await setCfg(want);
  let back = {};
  try { back = JSON.parse(String(await cfgRead(Object.keys(want)))); } catch (e) {}
  const bad = Object.keys(want).filter((k) => Number(back[k]) !== Number(k in cfgObj ? cfgObj[k] : want[k]));
  ok(bad.length === 0, tag + ' 设定全部生效（写下去当场读得到）', bad.map((k) => k + ':要' + (k in cfgObj ? cfgObj[k] : want[k]) + '/得' + back[k]).join(' '));
  await drain();
  const st = newRun(); const diag0 = Number(await ev('window.__replyDiag||0')); const exp0 = Number(await ev('window.__chatTypingExpiredN||0'));
  const t0 = Date.now(); st.from = t0 - 30; let mid = null;
  for (const tx of burstTexts) { await ev('window.chatSendMsg(' + JSON.stringify(tx) + ');1;'); await sleep(gapMs); if (probeMidMs && !mid && Date.now() - t0 >= probeMidMs) { await sample(st); mid = st.plain.size; } }
  const burstMs = Date.now() - t0;
  const floor = burstMs + floorExtraMs;
  const until = Date.now() + floor;
  while (Date.now() < until) { await sample(st); await sleep(400); }
  let last = st.plain.size, sameSince = Date.now();
  while (Date.now() - sameSince < 3000 && Date.now() - t0 < floor + 20000) { await sample(st); await sleep(400); if (st.plain.size !== last) { last = st.plain.size; sameSince = Date.now(); } }
  st.diag = Number(await ev('window.__replyDiag||0')) - diag0;
  st.expired = Number(await ev('window.__chatTypingExpiredN||0')) - exp0;
  st.midPlain = mid; st.ms = Date.now() - t0;
  console.log('  -- ' + tag + ' 内容=' + st.plain.size + ' 回执=' + st.read.size + ' 拍一拍=' + st.poke.size + ' 引用=' + st.quote.size + ' 批次=' + st.diag + ' 用了' + (st.ms / 1000).toFixed(1) + 's' + (mid === null ? '' : ' 中途=' + mid));
  return st;
};
const mk = (n, tag) => Array.from({ length: n }, (_, i) => tag + i);

// ---- B1/B2 连发 5 条：整段最多回「一轮回几条」的上限，且只结一次账 ----
let s = await runCase({ 'rs-min': 1, 'rs-max': 2, 'reply-min': 1, 'reply-max': 3, 'py-en': 1 }, 'B1', mk(5, 'b1'), 250, 2000 + 8000 + 3 * 2800 + 1500);
// 正文计数留 4 条容差：mochi 里有一堆「不占回复条数名额」的独立正文来源（查岗提问卡／TA 更新日常／
// 寻踪提醒／心愿／红包退回），它们在记录里与回复链气泡同形（都无 special），按记录分不开。
// 「条数本身有没有被放大」由 __replyDiag（批次）与 __replyOnceDiag（链内投递次数）精确钉住，见 B2。
const TOL = 4;
ok(s.plain.size <= 3 + TOL, 'B1 连发 5 条 → 整段只回 ≤3 条（旧写法＝5 批、至少 5 条起）', '实收=' + s.plain.size);
ok(s.diag === 1, 'B2 连发 5 条只结一次账（__replyDiag 自增次数＝批次数）', '批次=' + s.diag);

// ---- B3 条数与「你发了几条」无关 ----
s = await runCase({ 'rs-min': 1, 'rs-max': 2, 'reply-min': 3, 'reply-max': 3, 'py-en': 1 }, 'B3a', ['onlyone'], 0, 2000 + 8000 + 3 * 2800 + 1500);
const oneN = s.plain.size;
s = await runCase({ 'rs-min': 1, 'rs-max': 2, 'reply-min': 3, 'reply-max': 3, 'py-en': 1 }, 'B3b', mk(5, 'b3'), 250, 2000 + 8000 + 3 * 2800 + 1500);
ok(oneN >= 1 && oneN <= 3 + TOL && s.plain.size >= 1 && s.plain.size <= 3 + TOL, 'B3 回几条只认「回复条数」，不随你发了几条放大', '发1条=' + oneN + ' 发5条=' + s.plain.size);

// ---- B4 已读不回掷在轮上 ----
s = await runCase({ 'rs-min': 1, 'rs-max': 2, 'rn-prob': 100 }, 'B4', mk(5, 'b4'), 250, 2000 + 8000 + 4000);
ok(s.read.size === 1 && s.plain.size === 0, 'B4 已读不回一轮只掷一次（旧写法每条各掷＝最多 5 枚回执）', '回执=' + s.read.size + ' 内容=' + s.plain.size);

// ---- B5 拍一拍同样掷在轮上 ----
s = await runCase({ 'rs-min': 1, 'rs-max': 2, 'touch-prob': 100 }, 'B5', mk(5, 'b5'), 250, 2000 + 8000 + 4000);
ok(s.poke.size <= 1 && s.plain.size === 0, 'B5 拍一拍一轮至多一次且不另发内容', '拍一拍=' + s.poke.size + ' 内容=' + s.plain.size);

// ---- B6 你没说完 TA 不插话；延长不叠加批次 ----
s = await runCase({ 'rs-min': 6, 'rs-max': 6, 'reply-min': 1, 'reply-max': 3 }, 'B6', mk(10, 'b6'), 1000, 6000 + 8000 + 3 * 2800 + 1500, 9500);
ok(s.midPlain === 0, 'B6 你连说 9.5 秒期间 TA 一条都不插（旧写法第 6 秒起逐批落）', '9.5s 时已落=' + s.midPlain);
ok(s.plain.size <= 3 + TOL, 'B6 说完之后整段仍只回 ≤3 条（延长只推到点、不加批次）', '实收=' + s.plain.size);

// ---- B7 打字行的承诺不被撑破（#1326 看门狗不把延长误判成迟到），且照常落地 ----
s = await runCase({ 'rs-min': 8, 'rs-max': 8, 'reply-min': 1, 'reply-max': 2 }, 'B7', mk(8, 'b7'), 1000, 8000 + 8000 + 2 * 2800 + 1500);
ok(s.expired === 0 && s.plain.size > 0 && s.plain.size <= 2 + TOL, 'B7 延长这一轮没被看门狗判成迟到，回复照常落地（不谎报也不吞）', '超时=' + s.expired + ' 内容=' + s.plain.size);

// ---- B8 与总量限流：用户口径「开着 nova 并轮就不受它管」（两条机制各管各的，不叠加）----
s = await runCase({ 'rs-min': 1, 'rs-max': 2, 'reply-min': 3, 'reply-max': 3, 'rl-en': 1, 'rl-win': 5, 'rl-max': 2 }, 'B8', mk(5, 'b8'), 250, 2000 + 8000 + 3 * 2800 + 1500);
// __replyOnceDiag 每次 addMsg 归零，所以它＝这一段（这一轮）回复链真的投递了几条——比屏上正文总数精确
const chain8 = Number(await ev('window.__replyOnceDiag||0'));
ok(chain8 >= 3, 'B8 开着并轮时限流（窗口内最多 2 条）不再拦：回复链仍投满 3 条', '链内投递=' + chain8 + ' 正文=' + s.plain.size);
ok(s.diag === 1, 'B8b 开着限流时这一路仍然只结一次账', '批次=' + s.diag);

// ---- B9 引用掷一次、且引的是这一轮末尾那句 ----
s = await runCase({ 'rs-min': 1, 'rs-max': 2, 'reply-min': 1, 'reply-max': 1, 'quote-prob': 100 }, 'B9', mk(10, 'q'), 250, 2000 + 8000 + 2800 + 1500);
ok(s.quote.size === 1 && String([...s.quote][0]).indexOf('q9') >= 0, 'B9 一整轮只引用一次，且引的是你最后那句（旧写法每批各引各的）', '带引用=' + s.quote.size + ' 内容=' + ([...s.quote][0] || '(无)'));

// ---- Z 零未捕获异常 ----
ok(uncaught.length === 0, 'Z 全程零未捕获异常', uncaught.slice(0, 2).join(' / '));

console.log('\n读数：' + pass + ' 绿 / ' + fail + ' 红   root=' + root);
chrome.kill();
server.close();
try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
