// ===== 常驻回归 #983：聊天里送礼不再叠「已送出」黑色提示浮层（用户 2026-09-21 直派）=====
// 需求（用户原话）：「当我在聊天里送联系人礼物，和联系人发送卡片要求我送礼物，我点了送礼物，
//   出现的我已送礼物的黑色提醒弹窗删掉。我已经在聊天里发送了卡片，不需要这个黑色的弹窗。」
// 两条链路都汇到 gift-shop.js 的 openBuyDialog → 成交回调里的 #cc-toast（黑底白字浮层）：
//   ① 聊天页「更多 → 心意集市」半框挑一件（giftPanelPick → openBuyDialog）
//   ② 聊天里「TA 的心愿」卡片点【送 TA】（giftBuyFromWishCard → openBuyDialog，成交就地转「已送出」）
// 修复=按「此刻聊天页是否在眼前」条件化：在聊天里（礼物卡与卡片状态本身就是回执）不再弹；
// 市集页/心意柜页面（openPage 隐藏全部 .page，看不到那张卡）照旧保留「已送出」提示。
// 断言组：
//   S  源码口径（条件化在位、无条件形态消失）
//   B1 聊天送礼面板送出 → 零黑色浮层 + 礼物卡进聊天        （修复面）
//   B2 TA 心愿卡【送 TA】送出 → 零黑色浮层 + 卡片转已送出   （修复面）
//   B3 市集页面送出 → 「已送出」提示仍在                    （防修过头，市集页面上没有回执）
//   Z1 全程零未捕获 JS 异常
// 红基线（纯 HEAD 副本）预期：S1/S3/S4 + B1/B2 红，S2 绿、B3 绿。
// 用法：node tools/verify-983-gift-toast.mjs            （自组装 src，不依赖构建产物）
//       MOCHI_ROOT=<仓外副本> node tools/verify-983-gift-toast.mjs   （红/绿对照必传）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
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
  ok(/if \(!chatOnScreen\(\)\) toast\('已送出'\);/.test(gs), 'S1 成交提示按「聊天页是否在眼前」条件化');
  ok(!/closeTc\(\); toast\('已送出'\);/.test(gs), 'S2 无条件弹浮层的旧形态已消失');
  ok(/function chatOnScreen\(\) \{[\s\S]{0,140}document\.getElementById\('page-chat'\)[\s\S]{0,60}\.hidden/.test(gs),
    'S3 判据落在聊天页显隐（page-chat.hidden），不是别的开关');
  ok(/toast\('已送出'\)/.test(gs), 'S4 市集/心意柜路径的「已送出」提示仍在（不是把文案整块删掉）');
  // 两条链路共用一个成交回调：任意一条漏走 openBuyDialog ⇒ 卡片与提示都落不了地
  ok(/function giftPanelPick\(g\) \{ closeGiftPanel\(\); openBuyDialog\(g\); \}/.test(gs), 'S5 聊天送礼面板链路仍在（giftPanelPick → openBuyDialog）');
  ok(/window\.giftBuyFromWishCard = function \(rec, done\) \{/.test(gs), 'S6 心愿卡【送 TA】链路仍在（giftBuyFromWishCard）');
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

const site = join(tmpdir(), 'mochi-g983-' + Date.now());
const profDir = join(tmpdir(), 'mochi-g983-prof-' + Date.now());
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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9450 + Math.floor(Math.random() * 60));
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
const finish = () => {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
  try { rmSync(site, { recursive: true, force: true }); } catch (e) {}
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await evalJs('window.__jsErrors=[]');
if (!(await goto())) { console.error('应用未就绪'); finish(); process.exit(1); }
await sleep(1000);

// 只留「③ TA 加自己心愿单 + 发卡」这条可掷中的路径（其余自动行为概率归 0），保证断言确定性
const BASE = { wlVer: 2, giftInOn: 0, giftInPct: 0, wlOn: 1, wlBuyPct: 0, wlAddPct: 100, wishChatOn: 1, wishChatPct: 100, selfOn: 0, selfPct: 0 };
const setRawSettings = (extra) => evalJs(`(function(){ window.xyStore('xy-home-v2').set('market-wl-settings', ${JSON.stringify(JSON.stringify(Object.assign({}, BASE, extra || {})))}); return 1; })()`);
const openChat = () => evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');}); var a=document.querySelector('.app[data-app=chat]'); if(a)a.click(); return 1; })()");
const chatHidden = () => evalJs("(function(){ var p=document.getElementById('page-chat'); return !p || !!p.hidden; })()");
// 黑色浮层探针：#cc-toast 挂 show 类＝正在显示（chat-pages.css 黑底白字，2s 后自动摘类）
const toastState = () => evalJs(`(function(){
  var t = document.getElementById('cc-toast');
  if (!t) return JSON.stringify({ exists: false, shown: false, text: '' });
  return JSON.stringify({ exists: true, shown: String(t.className||'').indexOf('show') >= 0, text: String(t.textContent||'') });
})()`);
const noToast = async () => { const st = JSON.parse(await toastState()); return !(st.shown); };
const sentToast = async () => { const st = JSON.parse(await toastState()); return st.shown && st.text === '已送出'; };
const giftCount = () => evalJs(`(function(){
  var s = window.storeFor('default');
  var msgs = []; try { msgs = JSON.parse(s.get('chat-msgs')||'[]'); } catch(e){}
  return msgs.filter(function(m){ return m && m.special === 'gift'; }).length;
})()`);
const wishDom = () => evalJs(`(function(){
  var els = document.querySelectorAll('#chat-body .msg-wish');
  var el = els.length ? els[els.length-1] : null;
  return JSON.stringify({ cards: els.length, hasBuy: !!(el && el.querySelector('.msg-wish-buy')), done: !!(el && el.querySelector('.msg-wish-done')) });
})()`);
// 聊天落盘是防抖写：刚点完「送给 TA」时存储里可能还没这一条。浮层探针必须留在 2s 窗口内
// （#cc-toast 到点自动摘 show 类），礼物卡计数则轮询等到落库，避免把「写得慢」误判成「没写」。
const waitGiftCount = async (min, ms) => {
  const t0 = Date.now();
  let v = await giftCount();
  while (v < min && Date.now() - t0 < (ms || 3000)) { await sleep(200); v = await giftCount(); }
  return v;
};

console.log('B 层：无头行为');

await setRawSettings({});
if (!(await goto())) { console.error('冷启动未就绪'); finish(); process.exit(1); }
await sleep(900);

// ---- B1/B2：聊天送礼面板送出（修复面之一）----
{
  await openChat();
  await sleep(300);
  await evalJs("(function(){ var m=document.getElementById('tc-mask'); if(m) m.hidden=true; var b=document.getElementById('more-gift'); if(b) b.click(); return !!b; })()");
  await sleep(600);
  const before = await giftCount();
  const picked = await evalJs("(function(){ var b=document.querySelector('#gift-grid .gift-item'); if(b){ b.click(); return 1; } return 0; })()");
  await sleep(500);
  const okClicked = await evalJs("(function(){ var b=document.getElementById('gb-ok'); if(b){ b.click(); return 1; } return 0; })()");
  await sleep(250);                                   // 浮层 2s 后自动摘类：窗口内取态
  const quiet = await noToast();
  const after = await waitGiftCount(before + 1);
  ok(Number(picked) === 1 && Number(okClicked) === 1, 'B1 前置：聊天面板挑一件 → 「送给 TA」点成了', JSON.stringify({ picked, okClicked }));
  ok(quiet, 'B2 聊天里送礼物不再弹黑色提示浮层（#cc-toast 未显示）', await toastState());
  ok(after === before + 1, 'B2b 礼物卡照旧飞进聊天（回执留在卡片上）', before + ' -> ' + after);
}

// ---- B3/B4：TA 心愿卡【送 TA】送出（修复面之二，与用户第二条描述同源）----
{
  await openChat();
  await sleep(300);
  let ready = false;
  for (let i = 0; i < 6 && !ready; i++) {
    ready = (await evalJs("(function(){ return !!document.querySelector('#chat-body .msg-wish-buy'); })()")) === true;
    if (!ready) { await evalJs('window.maybeAutoGift()'); await sleep(600); }
  }
  const beforeDom = JSON.parse(await wishDom());
  const before = await giftCount();
  await evalJs("(function(){ var b=document.querySelectorAll('#chat-body .msg-wish-buy'); if(b.length) b[b.length-1].click(); return b.length; })()");
  await sleep(500);
  const okClicked = await evalJs("(function(){ var b=document.getElementById('gb-ok'); if(b){ b.click(); return 1; } return 0; })()");
  await sleep(250);
  const quiet = await noToast();
  const after = await waitGiftCount(before + 1);
  const afterDom = JSON.parse(await wishDom());
  ok(ready && beforeDom.hasBuy === true, 'B3 前置：聊天里有一张带【送 TA】的 TA 心愿卡', JSON.stringify(beforeDom));
  ok(Number(okClicked) === 1, 'B3b 前置：点【送 TA】→ 购买弹窗 → 送给 TA 点成了', String(okClicked));
  ok(quiet, 'B4 心愿卡送礼不再弹黑色提示浮层（卡片就地转「已送出」即回执）', await toastState());
  ok(after === before + 1, 'B4b 礼物卡照旧飞进聊天', before + ' -> ' + after);
  ok(afterDom.hasBuy === false && afterDom.done === true, 'B4c 卡片就地转「已送出」，不再显示【送 TA】', JSON.stringify(afterDom));
}

// ---- B5/B6：市集页面送出 → 提示仍在（防修过头：市集页面上看不到礼物卡）----
{
  await evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=true;}); var a=document.querySelector('.app[data-app=market]'); if(a)a.click(); return 1; })()");
  await sleep(700);
  const hidden = await chatHidden();
  await evalJs("(function(){ var m=document.getElementById('tc-mask'); if(m) m.hidden=true; return 1; })()");
  const before = await giftCount();
  const picked = await evalJs("(function(){ var b=document.querySelector('#market-grid .gift-item'); if(b){ b.click(); return 1; } return 0; })()");
  await sleep(500);
  const okClicked = await evalJs("(function(){ var b=document.getElementById('gb-ok'); if(b){ b.click(); return 1; } return 0; })()");
  await sleep(250);
  const shown = await sentToast();
  const after = await waitGiftCount(before + 1);
  ok(hidden === true, 'B5 前置：市集页面上聊天页确实被隐藏（看不到礼物卡，判据成立）', String(hidden));
  ok(Number(picked) === 1 && Number(okClicked) === 1, 'B5b 前置：市集挑一件 → 送出点成了', JSON.stringify({ picked, okClicked }));
  ok(shown, 'B6 市集页面送出仍显示「已送出」提示（不是把提示一刀切掉）', await toastState());
  ok(after === before + 1, 'B6b 礼物卡照旧飞进聊天', before + ' -> ' + after);
}

{
  const errs = await evalJs('JSON.stringify((window.__jsErrors||[]).slice(0,5))');
  ok(errs === '[]', 'Z1 全程零 JS 错误', String(errs));
}

console.log('\n通过 ' + pass + ' / 断言失败 ' + fail);
finish();
process.exit(fail ? 1 : 0);
