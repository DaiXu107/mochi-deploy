// ===== 验证「几分钟不回」这一族静默：三只副本同尺 =====
// 用户复报：「做了这个后，mochi 会出现几分钟联系人不回消息的情况」。
// 我把造成静默的路径逐个钉成断言，三份副本各跑一遍：
//   b ＝纯 HEAD（v1 之前的旧行为）  w ＝HEAD＋v2（本轮要交付的）  v1 ＝早先那一版单槽并轮（预期红）
// 用例：P1 已读不回是否即时（不是等满「回复速度最长」才报）
//       P2 切到别的联系人发一句，会不会把上一个联系人那一轮的定时器撤掉（v1 的抢位 bug）
//       P3 连发 5 句是否只结一次账（并轮契约本身）
//       P4 最长静默是否有界（≤「回复速度最长」＋封顶推后＋条间隔）
// 用法：node verify-turn-silence.mjs --root=<副本目录>
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve((process.argv.find((a) => a.startsWith('--root=')) || '').split('=')[1] || '.'); // 必须绝对化：否则守卫里的 startsWith 会把每个请求 403 掉
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? ' | ' + x : '')); } };

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
const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const port = 13600 + Math.floor(Math.random() * 200);
const udd = join(tmpdir(), 'mochi-sil-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + udd, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map(); const uncaught = [];
for (let i = 0; i < 80; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find((t) => t.type === 'page');
    if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') uncaught.push(String((m.params && m.params.exceptionDetails && ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text)) || '').slice(0, 140)); }; break; }
  } catch (e) {} await sleep(150);
}
if (!ws) { console.error('CDP 连不上'); chrome.kill(); process.exit(1); }
const cdp = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return '__EXC__' + JSON.stringify(r.exceptionDetails).slice(0, 180); return r && r.result ? r.result.value : null; };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:applock-qaskip','1');}catch(e){}" });
await cdp('Page.navigate', { url: origin });
// 开机要等到「数据好了 且 发送钩子真在」——中途可能自己重导一次页，所以要复轮询；
// 起不来就硬失败（以前只打一行 DBG 就往下跑，结果整段用例被 if 跳过、报成「0 红」＝假绿）
const bootedRaw = async () => String(await ev("(function(){return JSON.stringify({r:!!window.__mochiDataReady,s:typeof window.chatSendMsg,rs:document.readyState,splash:!!document.getElementById('splash-enter')})})()"));
const booted = async () => (await bootedRaw()).includes('"r":true,"s":"function"');
// 顺序照单独开机探针验过的那条：导航 → 等 3 秒 → 轮询就绪 → 只点一次开屏 → 再轮询
// （先前那版每拍都去点一次开屏，页面起不来时分不清是应用坏还是量具自己踩坏了它）
let up = false;
await sleep(3000);
for (let i = 0; i < 60 && !(up = await booted()); i++) await sleep(400);
if (!up) console.log('  DBG 点开屏前 ' + await bootedRaw());
await ev("(function(){var b=document.getElementById('splash-enter')||document.getElementById('splash-btn');if(b)b.click();return 1;})()");
await sleep(900);
for (let i = 0; i < 60 && !(up = await booted()); i++) await sleep(400);
if (!up) console.log('  DBG 点开屏后 ' + await bootedRaw());
console.log('  DBG ' + String(await ev("(function(){return JSON.stringify({ready:!!window.__mochiDataReady,send:typeof window.chatSendMsg,csw:typeof window.createContact,act:typeof window.setActiveContact,keys:typeof window.__replyTurnKeys,extFail:(window.__mochiExtFail||[]).join(',')})})()")));
ok(up, 'P0 页面起得来且发送钩子在（起不来＝后面所有用例都不作数）');
if (!up) { console.error('  页面没起来，终止'); chrome.kill(); server.close(); process.exit(1); }

const setCfg = (o) => ev('(function(){var o=' + JSON.stringify(o) + ';for(var k in o)window.saveReplyCfg(k,o[k]);return 1})()');
const MSGS = "JSON.stringify((window.chatExportMsgs()||[]).map(function(m){return [(m.side||''),(m.special||''),String(m.ts||0)]}))";
const inRows = async () => { try { return JSON.parse(String(await ev(MSGS))).filter((r) => r[0] === 'in'); } catch (e) { return []; } };
const plainOf = (rows, cid) => rows.filter((r) => r[1] === '' && r[3] !== cid);
// 只数「这一轮之后新出现的收件」：以发送时刻为界
const sendAt = () => Date.now();
const waitIn = async (since, want, capMs) => { // want: 'plain' | 'read'
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    const rows = await inRows();
    const hit = rows.find((r) => Number(r[2]) >= since && (want === 'read' ? r[1] === 'read' : r[1] === ''));
    if (hit) return Number(hit[2]) - since;
    await sleep(300);
  }
  return -1;
};
const OFF = { 'as-en': 0, 'mjf-en': 0, 'ckq-en': 0, 'ai-rps-en': 0, 'ai-game-en': 0, 'ai-cuddle-en': 0, 'ai-cc-en': 0, 'rp-thx-en': 0, 'fish-en': 0, 'work-en': 0, 'fish-grab-en': 0, 'ml-write-en': 0, 'ml-fish-week-en': 0, 'fd-post-en': 0, 'qs-en': 0, 'rc-en': 0, 'rl-en': 0, 'touch-prob': 0, 'quote-prob': 0, 'rn-prob': 0 };
const cidOf = async () => String(await ev("String(window.__activeCid||'default')"));

// 建/取第二位联系人，拿两个 cid
const cids = async () => {
  const list = await ev("(function(){try{var a=(window.getContacts&&window.getContacts())||[];if(a.length<2&&window.createContact)window.createContact('静默测试');a=(window.getContacts&&window.getContacts())||[];return JSON.stringify(a.map(function(c){return c.id}))}catch(e){return '[]'}})()");
  try { return JSON.parse(String(list)); } catch (e) { return []; }
};
const use = (id) => ev('window.setActiveContact(' + JSON.stringify(id) + ');1');
let all = [];
for (let i = 0; i < 30; i++) { all = await cids(); if (all.length >= 2) break; await sleep(500); }
console.log('  联系人 ' + all.length + ' 位：' + all.slice(0, 3).join(','));
ok(all.length >= 1, 'P0b 拿得到联系人（拿不到＝下面所有用例都不作数，不许当通过）', '实数=' + all.length);
if (all.length < 1) { console.error('  没有联系人，终止'); chrome.kill(); server.close(); process.exit(1); }

// ---- P1 已读不回即时（1~4 秒内那枚小字就要出现，而不是等满「回复速度最长」）----
if (all[0]) {
  await use(all[0]); await sleep(600);
  await setCfg(Object.assign({}, OFF, { 'rs-min': 30, 'rs-max': 30, 'rn-prob': 100 }));
  const t = sendAt();
  await ev("window.chatSendMsg('p1_');1");
  const ms = await waitIn(t, 'read', 46000);
  ok(ms >= 0 && ms <= 8000, 'P1 已读不回在 8 秒内就报出来（不是等满 30 秒才补一枚已读）', ms < 0 ? '46 秒内没等到' : (ms / 1000).toFixed(1) + 's');
}

// ---- P2 切到别的联系人发一句，不能撤掉上一个联系人排着的那一轮 ----
if (all.length >= 2) {
  await use(all[0]); await sleep(600);
  await setCfg(Object.assign({}, OFF, { 'rs-min': 30, 'rs-max': 30, 'rn-prob': 0 }));
  const tA = sendAt();
  await ev("window.chatSendMsg('p2_A');1");
  await sleep(2000);
  await use(all[1]); await sleep(900);
  const tB = sendAt();
  await ev("window.chatSendMsg('p2_B');1");
  await sleep(4000);
  await use(all[0]); await sleep(900);
  const gapA = await waitIn(tA, 'plain', 40000);
  const gapB = await waitIn(tB, 'plain', 12000);
  ok(gapA >= 0, 'P2 切走又切回来，A 那一轮照旧回（v1 的单槽会把它撤掉＝永远不回）', gapA < 0 ? '切回 A 后 40 秒无回复' : (gapA / 1000).toFixed(1) + 's 后落地');
  ok(gapB >= 0 || true, 'P2b B 那一轮也在排（信息项）', gapB < 0 ? 'B 未在 12 秒内落地（正常：B 的到点在切回 A 之后）' : (gapB / 1000).toFixed(1) + 's');
  const keys = String(await ev("typeof window.__replyTurnKeys==='function'?JSON.stringify(window.__replyTurnKeys()):'(v1 无此钩子)'"));
  console.log('  -- P2 此刻在册的轮=' + keys);
} else {
  console.log('  ⚠ P2 未覆盖：环境里只有一位联系人，切人不抢位这条量不到（不是通过）');
}

// ---- P3 连发 5 句只结一次账（并轮契约本身，在新 HEAD 上重验）----
if (all[0]) {
  await use(all[0]); await sleep(600);
  await setCfg(Object.assign({}, OFF, { 'turn-en': 1, 'rs-min': 1, 'rs-max': 2, 'reply-min': 1, 'reply-max': 3, 'py-en': 1 }));
  const d0 = Number(await ev('window.__replyDiag||0'));
  const t = sendAt();
  for (let i = 0; i < 5; i++) { await ev('window.chatSendMsg("p3_' + i + '");1'); await sleep(250); }
  await sleep(12000);
  const rows = (await inRows()).filter((r) => Number(r[2]) >= t);
  const diag = Number(await ev('window.__replyDiag||0')) - d0;
  // 回复链真的调用了几次 replyOnce（一条气泡一次）＝「条数没被放大」的精确尺；正文总数只作粗筛：
  // mochi 另有一堆不占回复名额的正文来源（查岗提问卡／TA 更新日常／寻踪提醒／心愿／红包退回），
  // 它们在记录里与回复链气泡形状相同（都无 special），按记录分不开——用链内计数才钉得住。
  const chain = Number(await ev('window.__replyOnceDiag||0'));
  const plain = rows.filter((r) => r[1] === '').length;
  ok(diag === 1, 'P3 连发 5 句只结一次账（旧写法 5 批）', '批次=' + diag + ' 链内投递=' + chain);
  ok(chain >= 1 && chain <= 3, 'P3b 回复链本身投了几条＝设定那条区间，与你发几句无关', '链内投递=' + chain);
  ok(plain <= 3 + 4, 'P3c 整段正文不失控（上限 3 ＋ 4 条容给不占名额的独立来源）', '正文=' + plain + ' 链内=' + chain);
}

// ---- P4 最长静默有界：≤「回复速度最长」＋8 秒封顶推后＋条间隔 ----
if (all[0]) {
  await use(all[0]); await sleep(600);
  await setCfg(Object.assign({}, OFF, { 'rs-min': 20, 'rs-max': 20, 'reply-min': 1, 'reply-max': 2 }));
  const t = sendAt();
  for (let i = 0; i < 4; i++) { await ev('window.chatSendMsg("p4_' + i + '");1'); await sleep(1500); }
  const gap = await waitIn(t, 'plain', 40000);
  ok(gap >= 0 && gap <= 32000, 'P4 首条回复不超过「最长 20 秒＋连发推后 8 秒＋余量」', gap < 0 ? '40 秒无回复' : (gap / 1000).toFixed(1) + 's');
}

// ---- T1 开关关着＝mochi 原机制一字不变（默认值不许被我改掉）----
if (all[0]) {
  await use(all[0]); await sleep(600);
  await setCfg(Object.assign({}, OFF, { 'turn-en': 0, 'rs-min': 1, 'rs-max': 2, 'reply-min': 1, 'reply-max': 3, 'py-en': 1 }));
  const dOff = Number(await ev('window.__replyDiag||0'));
  for (let i = 0; i < 5; i++) { await ev('window.chatSendMsg("t1_' + i + '");1'); await sleep(250); }
  await sleep(11000);
  const nOff = Number(await ev('window.__replyDiag||0')) - dOff;
  ok(nOff >= 4, 'T1 开关关着＝还是老机制（连发 5 句各排一批）', '批次=' + nOff);
}

// ---- T2 开关打开＝并轮，且「总量限流」不再拦 ----
if (all[0]) {
  await use(all[0]); await sleep(600);
  await setCfg(Object.assign({}, OFF, { 'turn-en': 1, 'rl-en': 1, 'rl-win': 5, 'rl-max': 2, 'rs-min': 1, 'rs-max': 2, 'reply-min': 3, 'reply-max': 3, 'py-en': 1 }));
  const cfgBack = String(await ev("(function(){var c=window.replyCfg()||{};return JSON.stringify([c['turn-en'],c['rl-en'],c['rl-max'],c['reply-max']])})()"));
  const tT = sendAt();
  for (let i = 0; i < 3; i++) { await ev('window.chatSendMsg("t2_' + i + '");1'); await sleep(250); }
  await sleep(11000);
  const nT = (await inRows()).filter((r) => Number(r[2]) >= tT && r[1] === '').length;
  ok(cfgBack === '[1,1,2,3]', 'T2a 开关写下去读得回（turn-en=1 且限流开着上限 2）', cfgBack);
  ok(nT >= 3, 'T2 开着并轮时总量限流（窗口内最多 2 条）不再拦＝一轮仍能回满 3 条', '实收=' + nT);
}

ok(uncaught.length === 0, 'Z 零未捕获异常', uncaught.slice(0, 2).join(' / '));
console.log('\n静默读数：' + pass + ' 绿 / ' + fail + ' 红   root=' + root);
chrome.kill(); server.close();
try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
