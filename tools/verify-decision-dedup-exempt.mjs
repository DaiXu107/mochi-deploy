// ===== #544 帮我决定/多人决定答案发到聊天，被收件侧去重静默吞掉（吞几条） =====
// 用户报障（2026-09-15，红米 K80 Chrome，明说其他设备型号也有、要求不要覆盖修改引发跨机型回归）：
//   「【帮我决定】和【多人决定】答案发送至聊天，聊天里联系人发送的消息被吞了几条」
// 根因（零机型分支、纯逻辑）：决策答案经 chatAddIn 以 side:'in' 纯文本落聊天，撞进 addRec
//   收件侧去重的 2500ms 文本窗（dupGapMs=DUP_GAP_TEXT）且 in 侧命中无 toast（#437 只给了
//   out 侧反馈）＝用户视角「联系人消息被吞了几条」；且扫描只看最近 5 条的时间差——第 1 条
//   被吞后窗口不闭合，紧随的同文答案连锁被吞（快速重跑同一问题＝连吞多条）。答案是否落地
//   与设备/机型无关，纯时间窗判定。
// 修复：chatAddIn 新 opts.dedupExempt（决定答案专用标记）——addRec 实时去重扫描跳过带标记
//   消息；normCollapseRange 刷新归一化同口径豁免（#256 屏上所见即刷新后所见）。TA 批次去重
//   （#256 防同款两张/表情包 60s 窗）与 out 侧 #437 反馈零改动。
// FIX 2026-09-19 #814 契约改版（G1 场景反转）：收件侧内容窗已被证明是「消息被吞」本体的另一半
//   ——副本通道全收口到身份级（重投副本必同 ts）后，跨毫秒内容窗能命中的只剩「真发的合法第二
//   条」。addRec 正文窗现只拦 out 侧 800ms，in 侧同文两条照常全落（G1 断言 1→2）；out 侧 #437
//   反馈与身份级闸门（#744/#776/#796/#814b 同 ts 收敛）零改动。A1~A3（exempt 豁免）语义不变。
// 场景（修前产物 A1/A2/A3 红＝症状复现；G1 绿＝#256 契约守卫不回退）：
//   G1 无标记同文两条 1.2s 内 → 两条都落聊天（#814 后收件侧不按内容吞；修前 1 条＝被吞）
//   A1 带标记同文答案两条 1.2s 内 → 两条都落聊天（修前 1 条＝被吞）
//   A2 带标记同文答案三条连锁（1.2s/2.4s 间隔）→ 三条全落（修前连锁吞＝「吞了几条」）
//   A3 刷新重进 → 答案全部仍在（normCollapseRange 不回吞；修前本就只剩 1 条）
// 用法：node tools/verify-decision-dedup-exempt.mjs（需先 node build.mjs）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9940 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dde-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
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
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(600);
}
async function gotoChat() {
  await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return true;})()");
  await sleep(700);
}
async function storeTexts() {
  return JSON.parse(await evalJs(`(function(){
    var arr = [];
    try { arr = JSON.parse(window.activeStore().get('chat-msgs') || '[]') || []; } catch(e){}
    return JSON.stringify(arr.map(function(m){ return String((m&&m.text)||''); }));
  })()`) || '[]');
}
async function domTexts() {
  return JSON.parse(await evalJs(`(function(){
    return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('#chat-body [data-idx]'), function(m){
      return String(m.textContent||'').replace(/\\s+/g,' ').trim();
    }));
  })()`) || '[]');
}
const normWs = (s) => String(s).replace(/\s+/g, ' ').trim();
const countIn = (arr, t) => arr.filter(x => normWs(x).indexOf(normWs(t)) >= 0).length;
// 与 decision.js/group-decision.js 产出的答案同构（【帮我决定】问题 + 结果；【多人决定】逐成员行）
const ANS_A = '【帮我决定】周末去哪里玩 → 游乐园';
const ANS_B = '【多人决定】中午吃什么\n【成员A】是\n【成员B】否';
// 走产品真实发送链路 chatAddIn（decision.js 同参），exempt=是否带 #544 豁免标记
async function sendAnswer(text, exempt) {
  return evalJs(`(function(){
    window.chatAddIn(${JSON.stringify(text)}, { enter: true, silent: true, follow: true${exempt ? ', dedupExempt: true' : ''} });
    return true;
  })()`);
}
async function settlePersist() { await sleep(3000); await evalJs("window.chatFlushSave && window.chatFlushSave(); true"); await sleep(400); } // 越过低频落盘最小间隔后强制 flush（idle 回调上限 4s，纯等待会抖）

console.log('--- G1 无标记同文两条（收件侧内容窗 #814 已停用）→ 两条都落聊天 ---');
await openPage();
await gotoChat();
{
  await sendAnswer('G1普通来消息测试重复', false);
  await sleep(1200);
  await sendAnswer('G1普通来消息测试重复', false);
  await settlePersist();
  const st = await storeTexts();
  // #814：两条合法同文消息（不同 ts）不再被内容窗静默吞——修前此场景只剩 1 条＝用户报的「被吞」
  check('G1 无标记同文 1.2s 两条全落（#814 收件侧不按内容吞；修前 1 条＝吞）', countIn(st, 'G1普通来消息测试重复') === 2, 'storeN=' + countIn(st, 'G1普通来消息测试重复'));
}

console.log('--- A1 带标记同文答案两条 1.2s 内 → 两条都落聊天 ---');
{
  await sendAnswer(ANS_A, true);
  await sleep(1200);
  await sendAnswer(ANS_A, true);
  await settlePersist();
  const st = await storeTexts(); const dm = await domTexts();
  // 主断言＝屏上 DOM（吞不改正是屏上现象）；LS 快照写与 idle/最小间隔赛跑、读数会滞后，精确存储计数留给 A3 重载后断言
  check('A1 同文答案两条都落（修前 1 条＝静默吞）', countIn(dm, ANS_A) === 2, 'domN=' + countIn(dm, ANS_A) + ' storeN(可能滞后)=' + countIn(st, ANS_A));
}

console.log('--- A2 三条同文答案连锁（1.2s / 再 1.2s，累计窗内）→ 三条全落 ---');
{
  await sendAnswer(ANS_B, true);
  await sleep(1200);
  await sendAnswer(ANS_B, true);
  await sleep(1200);
  await sendAnswer(ANS_B, true);
  await settlePersist();
  const st = await storeTexts(); const dm = await domTexts();
  check('A2 连锁场景三条全落（修前第 2/3 条连锁被吞＝「吞了几条」）', countIn(dm, '【成员B】否') === 3, 'domN(成员B行)=' + countIn(dm, '【成员B】否') + ' storeN(可能滞后)=' + countIn(st, ANS_B));
}

console.log('--- A3 刷新重进 → 答案全部仍在（normCollapseRange 不回吞） ---');
{
  await openPage();
  await gotoChat();
  await settlePersist();
  const st = await storeTexts(); const dm = await domTexts();
  check('A3 刷新后 A1 两条答案仍在', countIn(st, ANS_A) === 2 && countIn(dm, ANS_A) === 2, 'storeN=' + countIn(st, ANS_A) + ' domN=' + countIn(dm, ANS_A));
  // 多行气泡 DOM textContent 行间无空白拼接，全文比对不可靠——DOM 侧按每条答案必含的单行特征子串计数，存储侧仍按全文精确计数
  check('A3 刷新后 A2 三条答案仍在', countIn(st, ANS_B) === 3 && countIn(dm, '【成员B】否') === 3, 'storeN=' + countIn(st, ANS_B) + ' domN(成员B行)=' + countIn(dm, '【成员B】否'));
}

const pass = results.filter(r => r.ok).length;
console.log('');
console.log('=== verify-decision-dedup-exempt: ' + pass + '/' + results.length + ' ===');
results.forEach(r => { if (!r.ok) console.log('  FAIL: ' + r.desc); });
chrome.kill();
server.close();
process.exit(pass === results.length ? 0 : 1);
