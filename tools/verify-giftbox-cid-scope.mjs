// ===== 回归验证：#539 心意集市「TA 送我礼物」默认开启 + 概率可调；#540 心意市集/心意柜跨桌面串名 =====
// 用法：node tools/verify-giftbox-cid-scope.mjs   （自组装 src，不依赖构建产物）
// 用户报障（2026-09-15，两条同批）：
//   ①「心意集市和心意柜里，联系人送我礼物要默认开启，并且缺少联系人送我礼物的概率」
//      —— giftInOn 默认 0（#312 用户要求禁用留下的口径），设置页无「TA 送我礼物概率」项，
//         随机送礼概率硬编码 0.05 无处可调。
//   ②「不同联系人的数据串了：我在 A 桌面联系人的心意集市和心意柜里，看到 B 桌面联系人的名字」
//      —— 页面静态文案在 init/构建时把当时的 partnerName() 写死（giftbox-tawish / gift-wish-ta），
//         切联系人后无人重写，renderBox 只重写 tab 文字、不重写这两个按钮。
// 断言分两层：
//   S 层（源码，快）：默认值口径 + 概率读设置 + 设置页有该项 + syncGiftNames 存在且被切桌面链路调用。
//   B 层（无头 Chrome 行为）：冷启动在 B 桌面 → 切回 A → 心意柜里的名字必须全部是 A 的；
//         顺带验数据列表本身仍是各桌面独立（物品名不串）。
// RED 基线：把 giftInOn 默认改回 ===1、把 giftInPct 分支改回 0.05、删掉 syncGiftNames 调用后必红。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
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
  ok(/giftInOn:\s*s\.giftInOn === 0 \? 0 : 1/.test(gs), 'S1 giftInOn 默认开启（未设置→1；显式 0 保持关闭）');
  ok(/giftInPct:\s*clampPct\(s\.giftInPct, 5\)/.test(gs), 'S2 giftInPct 默认 5，接入 clampPct 0~100 校验');
  ok(/Math\.random\(\) \* 100 >= st\.giftInPct/.test(gs), 'S3 随机送礼按设置概率判定');
  ok(!/Math\.random\(\) >= 0\.05/.test(gs), 'S4 随机送礼不再硬编码 0.05');
  ok(/data-gsn="giftInPct"/.test(gs), 'S5 设置页有「TA 送我礼物概率」输入行');
  ok(/function syncGiftNames\(\)/.test(gs), 'S6 syncGiftNames 定义存在');
  ok(/document\.addEventListener\('contact-switched'/.test(gs), 'S7 gift-shop 监听 contact-switched');
  ok(/if \(giftboxPage && !giftboxPage\.hidden\) renderBox\(\)/.test(gs), 'S8 切桌面时若心意柜页开着则重渲');
  // renderBox / renderMarket 都要先同步名字，否则打开页面仍是旧名字
  ok(/function renderBox\(\) \{\s*\n\s*syncGiftNames\(\)/.test(gs), 'S9 renderBox 入口先 syncGiftNames');
  ok(/function renderMarket\(\) \{\s*\n\s*syncGiftNames\(\)/.test(gs), 'S10 renderMarket 入口先 syncGiftNames');
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

const site = join(tmpdir(), 'mochi-gscidscope-' + Date.now());
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(tmpdir(), 'mochi-gscidscope-prof-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
};
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
const namesOnBox = () => evalJs(`(function(){
  return JSON.stringify({
    cid: window.__activeCid,
    partnerName: window.chatPartnerName(),
    boxTawish: (document.getElementById('giftbox-tawish')||{}).textContent,
    giftWishTa: (document.getElementById('gift-wish-ta')||{}).textContent,
    gbTabs: Array.prototype.map.call(document.querySelectorAll('.gb-tab'), function(t){ return t.textContent; })
  });
})()`);

await cdp('Page.enable');
await cdp('Runtime.enable');
await evalJs('window.__jsErrors=[]');
if (!(await goto())) { console.error('应用未就绪'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
await sleep(600);

// B1：默认设置口径
{
  const r = JSON.parse(await evalJs(`(function(){
    var s = null;
    try { s = JSON.parse((window.xyStore('xy-home-v2').get('market-wl-settings'))||''); } catch(e) {}
    return JSON.stringify({ raw: s });
  })()`));
  ok(r.raw === null || r.raw.giftInOn !== 0, 'B1 全新用户未写入过设置 = 默认开启（无残留 0）', JSON.stringify(r.raw));
}

// B2：A/B 两桌面设不同昵称，持久化 active-contact=B 后冷启动
await evalJs(`(function(){
  window.activeStore().set('cs-lbl-partner','阿A');
  var id = window.createContact('B桌面');
  window.__bid = id;
  window.setActiveContact(id);
  window.activeStore().set('cs-lbl-partner','阿B');
  return 1;
})()`);
await sleep(300);
await evalJs(`(function(){ window.setActiveContact(window.__bid); return 1; })()`);
await sleep(400);
if (!(await goto())) { console.error('冷启动未就绪'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
await sleep(1000);

{
  const o = JSON.parse(await namesOnBox());
  ok(o.partnerName === '阿B', 'B2 冷启动落在 B 桌面（基线：此时页面名字=B 属正确）', o.partnerName);
  ok(/阿B/.test(o.boxTawish || ''), 'B3 冷启动 B 桌面心意柜按钮显示 B', o.boxTawish);
}

// B4：切回 A 桌面（不重开页面）——名字必须立刻变回 A
// 注意：页面上面 reload 过一次，window.__bid 会丢，必须从联系人名册重新取（否则 setActiveContact(undefined)
// 会退化成 default，把 B 的礼物写进 A 桌面 —— 那是测试脚本自身的坑，不是产品 bug）
await evalJs(`(function(){
  var list = window.getContacts() || [];
  window.__bid = (list.find(function(c){ return c && c.id !== 'default'; }) || {}).id;
  return window.__bid || '';
})()`);
const bidProbe = await evalJs('window.__bid');
ok(!!bidProbe, 'B3b 联系人 B 的 cid 已重新取到', String(bidProbe));
await evalJs("(function(){ window.setActiveContact('default'); return 1; })()");
await sleep(500);
{
  const o = JSON.parse(await namesOnBox());
  ok(o.cid === 'default' && o.partnerName === '阿A', 'B4 已切回 A 桌面', o.cid + '/' + o.partnerName);
  ok(!/阿B/.test(o.boxTawish || ''), 'B5 心意柜「看看TA的心愿单」不再残留 B 的名字', o.boxTawish);
  ok(/阿A/.test(o.boxTawish || ''), 'B6 心意柜按钮已重写为 A 的名字', o.boxTawish);
  ok(!/阿B/.test(o.giftWishTa || ''), 'B7 送礼面板心愿单入口不残留 B 的名字', o.giftWishTa);
  ok(o.gbTabs.join('|').indexOf('阿B') < 0, 'B8 心意柜 tab 文案不残留 B 的名字', (o.gbTabs || []).join('|'));
}

// B9：数据列表本身仍按桌面隔离（A 只看到 A 的礼物）
await evalJs(`(function(){
  window.setActiveContact('default');
  window.recordGiftBox({id:'g_aonly',name:'A专属礼物',emoji:'🎈',price:1,cat:'其他'},'in','给A');
  window.setActiveContact(window.__bid);
  window.recordGiftBox({id:'g_bonly',name:'B专属礼物',emoji:'🎁',price:1,cat:'其他'},'in','给B');
  window.setActiveContact('default');
  return 1;
})()`);
await sleep(400);
await evalJs("(function(){ var e=document.querySelector('[data-app=\"giftbox\"]'); if(e) e.click(); return !!e; })()");
await sleep(400);
{
  const r = JSON.parse(await evalJs(`(function(){
    var cards = Array.prototype.map.call(document.querySelectorAll('.giftbox-card'), function(c){ return c.textContent; });
    return JSON.stringify({ cid: window.__activeCid, cards: cards });
  })()`));
  ok(r.cards.some((c) => /A专属礼物/.test(c)), 'B9 A 桌面心意柜能看到 A 的礼物', JSON.stringify(r.cards));
  ok(!r.cards.some((c) => /B专属礼物/.test(c)), 'B10 A 桌面心意柜看不到 B 的礼物（数据不串桌面）', JSON.stringify(r.cards));
  ok(!r.cards.some((c) => /阿B|B桌面/.test(c)), 'B11 A 桌面心意柜卡片文案不出现 B 的名字', JSON.stringify(r.cards));
}

// B12：概率项真的可存（设置面板写入 → 读回）
{
  await evalJs("(function(){ var b=document.getElementById('market-settings'); if(b) b.click(); return !!b; })()");
  await sleep(250);
  const r2 = JSON.parse(await evalJs(`(function(){
    var inp = document.querySelector('[data-gsn="giftInPct"]');
    if (!inp) return JSON.stringify({ found:false });
    var before = inp.value;
    inp.value = '37';
    inp.dispatchEvent(new Event('change'));
    var saved = null;
    try { saved = JSON.parse((window.xyStore('xy-home-v2').get('market-wl-settings'))||''); } catch(e) {}
    return JSON.stringify({ found:true, def:before, savedPct: saved && saved.giftInPct });
  })()`));
  ok(r2.found === true, 'B12 设置面板存在「TA 送我礼物概率」输入项');
  ok(r2.savedPct === 37, 'B13 概率改动真实存盘（37 回读一致）', JSON.stringify(r2));
  // 复位，避免污染后续断言/同机复用
  await evalJs("(function(){ var inp=document.querySelector('[data-gsn=\"giftInPct\"]'); if(inp){ inp.value='5'; inp.dispatchEvent(new Event('change')); } return 1; })()");
  const sw = JSON.parse(await evalJs(`(function(){
    var s=null; try{ s=JSON.parse((window.xyStore('xy-home-v2').get('market-wl-settings'))||''); }catch(e){}
    return JSON.stringify({ giftInOn: s && s.giftInOn, giftInPct: s && s.giftInPct });
  })()`));
  ok(sw.giftInOn !== 0, 'B14 总开关改动后仍为「开」口径（未被概率写入误关）', JSON.stringify(sw));
}

console.log('\n== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
