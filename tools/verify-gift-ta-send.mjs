// ===== 回归验证：#585「联系人给我买礼物发送到聊天」正常使用优化 =====
// 用法：node tools/verify-gift-ta-send.mjs   （自组装 src，不依赖构建产物）
// 用户报障（2026-09-16）：「为什么总是无法触发联系人给我买礼物发送到聊天里，是不是有 bug 或设计缺陷」
// 定位出四个叠加原因，脚本逐条守住：
//   ① 总开关历史遗留：旧版（无 wlVer）记录里 giftInOn===0 分不出「主动关」与「旧默认 0 被面板连带
//      写回」，会把 ①②④ 一起掐死，只剩不发聊天消息的「TA 自己买」。
//   ② 每日额度共用：②「TA 自己买」（默认 10%、不发聊天消息、排在前面）与「送礼给我」（默认 5%）
//      共用一个 3 次/天池子 → 实测隐身自买平均每天吃 2.0 次、81% 的日子把额度吃满。
//   ③ 投递竞态：掷中后 1.5~4s 投递窗内切桌面，钱已扣/心愿已删/额度已占，礼物被静默丢弃。
//   ④ 日期口径：todayKey 用 UTC，中国时区下每日额度在北京时间早 8 点重置。
// 另有设置面板「清空概率输入框→失焦」被静默写成 0（=永久关闭该路径）的隐患。
// RED 基线：把 wlSettingsUpgrade 摘掉 / 额度合回一本 / 投递守卫改回直接 return / todayKey 改回
//   toISOString / 面板非法值写 0 —— 对应断言必红（见每条断言的编号）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? ' \u2014 ' + extra : '')); }
};

// ---------------- S 层：源码断言 ----------------
console.log('S 层：源码口径');
{
  const gs = readFileSync(join(root, 'src/js/gift-shop.js'), 'utf8');
  ok(/const WL_VER = 2;/.test(gs), 'S1 设置口径版本号 WL_VER 存在');
  ok(/if \(!raw \|\| raw\.wlVer === WL_VER\) return false;/.test(gs), 'S2 已打标的记录不再被迁移改写（只升级一次）');
  ok(/const revived = raw\.giftInOn === 0;/.test(gs), 'S3 旧记录里被遗留关闭的总开关会被救回开启');
  ok(/next\.giftInOn = 1;/.test(gs), 'S4 救回动作确实写回 1');
  ok(/return \{ wlVer: WL_VER, giftInOn:/.test(gs), 'S5 wlSettings 回写含 wlVer（面板保存不会把标记抹掉）');
  ok(/const SELF_DAILY_PREFIX = 'ml2_selfbuy_daily_';/.test(gs), 'S6 TA 自买有独立的每日额度键');
  ok(/const giftCapped = dayCount\(AUTO_DAILY_PREFIX\) >= 3;/.test(gs), 'S7 「送我」额度只看送礼这本账');
  ok(/const selfCapped = dayCount\(SELF_DAILY_PREFIX\) >= 3;/.test(gs), 'S8 TA 自买额度独立判定');
  ok(/st\.selfOn && !selfCapped && Math\.random\(\) \* 100 < st\.selfPct/.test(gs), 'S9 ②TA 自己买走自己的额度（不再吃送礼额度）');
  ok(!/st\.selfOn && !capped/.test(gs), 'S10 旧「自买与送礼共用 capped」写法已消失');
  ok(/dayIncr\(AUTO_DAILY_PREFIX\)/.test(gs) && /dayIncr\(SELF_DAILY_PREFIX\)/.test(gs), 'S11 两本账各自记账');
  ok(/function todayKey\(\) \{ const d = new Date\(\);/.test(gs), 'S12 每日额度按本地日期切');
  ok(!/toISOString\(\)\.slice\(0, 10\)/.test(gs), 'S13 不再用 UTC 日期（原实现早 8 点重置）');
  ok(/if \(window\.chatAppendDeskRec\) window\.chatAppendDeskRec\(cid, rec\);/.test(gs), 'S14 投递窗内已切桌面→跨桌面补投递（不再丢弃）');
  ok(/recordBoxAt\(cid, gift, 'in', wish\);/.test(gs), 'S15 跨桌面投递时心意柜记录跟着回原桌面');
  ok(/function boxStoreFor\(cid\)/.test(gs), 'S16 指定联系人的心意柜 store 存在');
  ok(!/if \(\(window\.__activeCid \|\| 'default'\) !== myCid\) return;\n\s*const rec/.test(gs), 'S17 旧「切桌面直接 return」投递守卫已移除');
  ok(/const hi = Number\(inp\.max\) \|\| 100;/.test(gs) && /toast\('请填 0~' \+ hi \+ ' 的整数'\);/.test(gs), 'S18 非法输入就地提示（不再静默写 0；#1437 起封顶问输入框自己的 max，概率格仍是 0~100）');
  ok(/inp\.value = String\(cur\[key\]\);/.test(gs), 'S19 概率非法输入恢复原值');
  ok(!/cur\[inp\.dataset\.gsn\] = ok \? n : 0;/.test(gs), 'S20 旧「非法值写 0 + 框改成 0」已消失');
}

// ---------------- B 层：无头 Chrome 行为 ----------------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arrOf = (k) => (bm.match(new RegExp(k + '\\s*=\\s*\\[([\\s\\S]*?)\\]')) || [])[1]
  .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => {
  let code = '';
  try { code = readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) {}
  return '(function(){try{\n' + code + '\n}catch(__e){if(window.__jsErrors)window.__jsErrors.push("' + f + ':"+(__e&&__e.message||__e));}})();';
}).join('\n'));

const site = join(tmpdir(), 'mochi-gifttasend-' + Date.now());
const profDir = join(tmpdir(), 'mochi-gifttasend-prof-' + Date.now());
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'index.html'), html);
const server = createServer((req, res) => {
  try {
    const p = normalize(join(site, decodeURIComponent(req.url.split('?')[0])));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9660 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
let booted = false;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); booted = true; break; }
  } catch (e) {}
  await sleep(150);
}
if (!booted) { console.error('无法连接无头 Chrome'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return '__ERR__' + JSON.stringify(r.exceptionDetails).slice(0, 300);
  return r && r.result ? r.result.value : null;
}
const goto = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) { if ((await evalJs('!!window.__mochiDataReady')) === true) return true; await sleep(250); }
  return false;
};
const finish = () => { try { chrome.kill(); } catch (e) {} try { server.close(); } catch (e) {} try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {} try { rmSync(site, { recursive: true, force: true }); } catch (e) {} };

await cdp('Page.enable');
await cdp('Runtime.enable');
await evalJs('window.__jsErrors=[]');
if (!(await goto())) { console.error('应用未就绪'); finish(); process.exit(1); }
await sleep(1000);

const setRawSettings = (obj) => evalJs(`(function(){ window.xyStore('xy-home-v2').set('market-wl-settings', ${JSON.stringify(JSON.stringify(obj))}); return 1; })()`);
const readRawSettings = () => evalJs("(function(){ try { return window.xyStore('xy-home-v2').get('market-wl-settings') || ''; } catch(e){ return ''; } })()");
const readSettings = () => evalJs(`(function(){
  var raw = null; try { raw = JSON.parse(window.xyStore('xy-home-v2').get('market-wl-settings')||'')||null; } catch(e){}
  return JSON.stringify(raw);
})()`);
const counters = () => evalJs(`(function(){
  var d = new Date();
  var tk = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  var s = window.activeStore();
  return JSON.stringify({ dayKey: tk, gift: s.get('ml2_gift_daily_' + tk) || null, self: s.get('ml2_selfbuy_daily_' + tk) || null });
})()`);
const clearCounters = () => evalJs(`(function(){
  var d = new Date();
  var tk = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  var s = window.activeStore();
  s.set('ml2_gift_daily_' + tk, '0'); s.set('ml2_selfbuy_daily_' + tk, '0');
  return 1;
})()`);
const topUp = (n) => evalJs(`(function(){ var w = window.giftWalletGet(); w.systemBalance = ${n}; window.giftWalletSet(w); return 1; })()`);
const snapshot = () => evalJs(`(function(){
  var box = []; try { box = JSON.parse(window.activeStore().get('giftbox-items')||'[]'); } catch(e){}
  return JSON.stringify({
    bubbles: document.querySelectorAll('.msg-gift').length,
    boxIn: box.filter(function(b){return b.side==='in';}).length,
    boxSelf: box.filter(function(b){return b.side==='self';}).length
  });
})()`);
const openChat = () => evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});var a=document.querySelector('.app[data-app=chat]');if(a)a.click();return 1;})()");

// ---- B1：旧记录（无 wlVer 且 giftInOn:0）冷启动后必须被救回开启 ----
console.log('B 层：无头行为');
await setRawSettings({ giftInOn: 0, giftInPct: 30, wlOn: 1, wlBuyPct: 20, wlAddPct: 15, selfOn: 1, selfPct: 10 });
if (!(await goto())) { console.error('冷启动未就绪'); finish(); process.exit(1); }
await sleep(900);
{
  const r = JSON.parse((await readSettings()) || 'null');
  ok(!!r && r.wlVer === 2, 'B1 旧记录被升级（写入 wlVer 标记）', JSON.stringify(r));
  ok(!!r && r.giftInOn !== 0, 'B2 遗留关闭的总开关已恢复开启', JSON.stringify(r));
  ok(!!r && r.giftInPct === 30, 'B3 升级不改动用户已设的其它概率（giftInPct 保留 30）', JSON.stringify(r));
}

// ---- B4：显式关闭（带 wlVer 的 0）必须被尊重，不被迁移覆盖 ----
await setRawSettings({ wlVer: 2, giftInOn: 0, giftInPct: 5, wlOn: 1, wlBuyPct: 20, wlAddPct: 15, selfOn: 1, selfPct: 10 });
if (!(await goto())) { console.error('冷启动未就绪'); finish(); process.exit(1); }
await sleep(900);
{
  const r = JSON.parse((await readSettings()) || 'null');
  ok(!!r && r.giftInOn === 0, 'B4 已打标的显式关闭保持关闭（迁移不越权改用户设置）', JSON.stringify(r));
}

// ---- B5：额度分离——TA 自买不再吃「送我」额度 ----
await setRawSettings({ wlVer: 2, giftInOn: 1, giftInPct: 0, wlOn: 0, wlBuyPct: 20, wlAddPct: 0, selfOn: 1, selfPct: 100 });
await topUp(500000);
await clearCounters();
for (let i = 0; i < 3; i++) await evalJs('window.maybeAutoGift()');
await sleep(400);
{
  const c = JSON.parse(await counters());
  ok(Number(c.self) === 3, 'B5 TA 自买 3 次记在独立额度账上', JSON.stringify(c));
  ok(Number(c.gift || 0) === 0, 'B6 自买不占用「送我」额度（旧实现这里会被吃满 3 次）', JSON.stringify(c));
}
// 自买额度已满，送礼额度仍是 0 → 立刻把参数切到「只送礼」，这次必须能送出去
await setRawSettings({ wlVer: 2, giftInOn: 1, giftInPct: 100, wlOn: 0, wlBuyPct: 20, wlAddPct: 0, selfOn: 1, selfPct: 100 });
await openChat();
await sleep(300);
const beforeB7 = JSON.parse(await snapshot());
await evalJs('window.maybeAutoGift()');
await sleep(4600);
{
  const c = JSON.parse(await counters());
  const a = JSON.parse(await snapshot());
  ok(Number(c.gift) === 1, 'B7 自买额度耗尽后送礼仍能触发（旧实现：capped 已满直接 return）', JSON.stringify(c));
  ok(a.bubbles > beforeB7.bubbles, 'B8 礼物真的落进聊天（气泡数 +1）', beforeB7.bubbles + ' -> ' + a.bubbles);
  ok(a.boxIn > beforeB7.boxIn, 'B9 礼物同时进心意柜「收到的」', beforeB7.boxIn + ' -> ' + a.boxIn);
}

// ---- B10：投递窗内切桌面 → 礼物仍回原桌面，且不串到别的桌面 ----
await evalJs(`(function(){
  var id = window.createContact('验证临时桌面');
  window.__tmpCid = id;
  return id;
})()`);
await setRawSettings({ wlVer: 2, giftInOn: 1, giftInPct: 100, wlOn: 0, wlBuyPct: 20, wlAddPct: 0, selfOn: 0, selfPct: 0 });
await clearCounters();
const beforeC = JSON.parse(await snapshot());
await evalJs('window.maybeAutoGift()');
await sleep(300);                                            // 落在 1.5~4s 投递窗内
await evalJs("(function(){ window.setActiveContact(window.__tmpCid); return 1; })()");
await sleep(5200);                                           // 等投递窗过去
// 切换后的桌面查【存储】而不是 DOM：DOM 上残留的是上一个桌面渲染出的气泡，用它判串号会假红。
const onB = JSON.parse(await evalJs(`(function(){
  var s = window.storeFor(window.__tmpCid);
  var box = []; try { box = JSON.parse(s.get('giftbox-items')||'[]'); } catch(e){}
  var msgs = []; try { msgs = JSON.parse(s.get('chat-msgs')||'[]'); } catch(e){}
  return JSON.stringify({ box: box.length, gifts: msgs.filter(function(m){ return m.special === 'gift'; }).length });
})()`));
const countersB = JSON.parse(await counters());
await evalJs("(function(){ window.setActiveContact('default'); return 1; })()");
await sleep(900);
await openChat();
await sleep(900);
const onA = JSON.parse(await snapshot());
ok(onA.bubbles > beforeC.bubbles, 'B10 切桌面期间掷中的礼物仍落回原桌面聊天（旧实现被静默丢弃）', beforeC.bubbles + ' -> ' + onA.bubbles);
ok(onA.boxIn > beforeC.boxIn, 'B11 原桌面心意柜同样记到这件礼物', beforeC.boxIn + ' -> ' + onA.boxIn);
ok(onB.gifts === 0 && onB.box === 0, 'B12 礼物没有串到切换后的桌面', JSON.stringify(onB));
ok(Number(countersB.gift || 0) === 0, 'B13 额度记在原桌面（切换后的桌面额度未被动过）', JSON.stringify(countersB));

// ---- B14：每日额度只拦送礼（不再被自买挤占）----
await setRawSettings({ wlVer: 2, giftInOn: 1, giftInPct: 100, wlOn: 0, wlBuyPct: 20, wlAddPct: 0, selfOn: 0, selfPct: 0 });
await clearCounters();
for (let i = 0; i < 5; i++) { await evalJs('window.maybeAutoGift()'); await sleep(60); }
{
  const c = JSON.parse(await counters());
  ok(Number(c.gift) === 3, 'B14 「送我」额度上限 3 次/天', JSON.stringify(c));
}

// ---- B15：设置面板概率非法输入不再静默写成 0 ----
await setRawSettings({ wlVer: 2, giftInOn: 1, giftInPct: 5, wlOn: 1, wlBuyPct: 20, wlAddPct: 15, selfOn: 1, selfPct: 10 });
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true;}); var a=document.querySelector('.app[data-app=\"market\"]'); if(a)a.click(); return 1;})()");
await sleep(700);
await evalJs("(function(){ var b=document.getElementById('market-settings'); if(b) b.click(); return !!b; })()");
await sleep(500);
{
  const r = await evalJs(`(function(){
    var inp = document.querySelector('#tc-body [data-gsn="giftInPct"]');
    if (!inp) return 'NO_INPUT';
    inp.value = '';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    var raw = null;
    try { raw = JSON.parse(window.xyStore('xy-home-v2').get('market-wl-settings')||'')||null; } catch(e){}
    return JSON.stringify({ stored: raw && raw.giftInPct, inputNow: inp.value });
  })()`);
  const o = r === 'NO_INPUT' ? null : JSON.parse(r);
  ok(!!o, 'B15 设置面板概率输入框可达', String(r));
  ok(!!o && o.stored !== 0, 'B16 清空输入框失焦不会把概率写成 0（旧实现=静默关闭整条路径）', String(r));
  ok(!!o && o.inputNow === '5', 'B17 非法输入后恢复原值（展示与实际一致）', String(r));
}

{
  const errs = await evalJs('JSON.stringify((window.__jsErrors||[]).slice(0,5))');
  ok(errs === '[]', 'B18 全程零 JS 错误', String(errs));
}

console.log('\n通过 ' + pass + ' / 断言失败 ' + fail);
finish();
process.exit(fail ? 1 : 0);
