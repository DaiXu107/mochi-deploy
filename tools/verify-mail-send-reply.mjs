// ===== 回归脚本：寄出的信也能收到 TA 回信（v3.9.x 补全） =====
// 用法：node build.mjs && node tools/verify-mail-send-reply.mjs
// 复现路径（用户反馈「信箱里我给联系人写信，无法收到回信；设置了联系人回信概率，没有触发」）：
//   1. 根因：回信机制只在「提笔回信」(submitReply) 里按 ml-reply-prob 安排回信计划，
//      寄信(sendLetter) 从不安排 → 寄出的信永远收不到 TA 回信（概率设置完全未参与）。
//   2. 修复：sendLetter 落信后按同一 ml-reply-prob 概率写入 mail-reply-pending 计划，
//      由 checkPendingReplyFor 到期落地为 partnerReply（刷新/重开不丢）。
// 验证路径：
//   A. 概率 100% + 最短/最长回信时间 0 → 寄信 → mail-reply-pending 出现 1 条计划
//      （id 指向刚寄出的信、回信内容非空）——修复前 pending 恒为空。
//   B. 重载页面 → 启动 checkPendingReply（20s 后）把计划落地 → 寄出的信带 partnerReply
//      + 信箱「寄出」列表显示「对方已回信」标签；计划清空。
// 需要：Node 21+ + 本机 Chrome/Edge（CHROME_PATH 可指定）
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mail-send-reply-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
// 固定 Math.random=0：①启动 checkPendingReply 定时器延迟固定为 20s（(20+0*40)s）；
// ②回信概率判断 0<100 必命中；③回信延迟 (0 + 0*max(1,..))*60000=0 → 到期时间=当前
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'Math.random = function(){ return 0; };' });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function openApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(900);
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await openApp();

// ---- 前置：回信概率 100%、最短/最长回信时间 0（让计划立即到期） ----
const setup = JSON.parse(await evalJs(`(function(){
  try {
    const st = window.storeFor('default');
    st.set('reply-ml-reply-prob', '100');
    st.set('reply-ml-reply-min', '0');
    st.set('reply-ml-reply-max', '0');
    return JSON.stringify({ ok: true });
  } catch(e) { return JSON.stringify({ ok: false, err: e.message }); }
})()`) || '{}');
check('前置：设置回信概率 100% / 回信时间 0', setup.ok === true, JSON.stringify(setup));

// ---- A. 寄信 → 应生成 TA 回信计划 ----
const sent = JSON.parse(await evalJs(`(function(){
  try {
    const input = document.getElementById('mail-input');
    if (!input) return JSON.stringify({ ok: false, err: 'no mail-input' });
    input.value = '这是一封寄出的测试信';
    const btn = document.getElementById('mail-send');
    if (!btn) return JSON.stringify({ ok: false, err: 'no mail-send' });
    btn.click();
    const list = JSON.parse(window.storeFor('default').get('mail-letters') || '[]');
    const pending = JSON.parse(window.storeFor('default').get('mail-reply-pending') || '[]');
    return JSON.stringify({
      ok: true,
      letters: list.length,
      sentId: list[0] ? list[0].id : null,
      sentType: list[0] ? list[0].type : null,
      pendingCount: pending.length,
      pendingId: pending[0] ? pending[0].id : null,
      pendingDue: pending[0] ? pending[0].due : null,
      pendingHasContent: !!(pending[0] && pending[0].content)
    });
  } catch(e) { return JSON.stringify({ ok: false, err: e.message }); }
})()`) || '{}');
console.log('  [寄信结果]', JSON.stringify(sent));
check('寄信后信箱有 1 封寄出的信', sent.ok === true && sent.letters === 1 && sent.sentType === 'sent', 'count=' + sent.letters + ' type=' + sent.sentType);
check('回信计划已生成（修复前恒为空）', sent.pendingCount === 1 && sent.pendingId === sent.sentId, 'pending=' + sent.pendingCount + ' idMatch=' + (sent.pendingId === sent.sentId));
check('计划回信内容非空且到期时间合理', sent.pendingHasContent === true && typeof sent.pendingDue === 'number' && sent.pendingDue <= Date.now() + 1000, 'due=' + sent.pendingDue);

// ---- B. 同一页面等启动定时器（Math.random=0 → 固定 20s）把计划落地为 TA 回信 ----
await sleep(22000); // 等启动补查（Math.random=0 → 固定 20s）

// 诊断探针：信/回信/计划到底落在哪条存储路径（storeFor(default)/xyStore(default)/旧顶层/snap/IDB）
const dump = JSON.parse(await evalJs(`(function(){
  const brief = function (s) { try { const a = JSON.parse(s); return (a || []).map(x => ({ id: x.id, type: x.type, pr: !!(x.partnerReply && x.partnerReply.content) })); } catch (e) { return null; } };
  const out = {
    storeForDefault: brief(window.storeFor('default').get('mail-letters')),
    xyDefault: brief(window.xyStore('xy-home-v2:default').get('mail-letters')),
    legacy: brief(window.xyStore('xy-home-v2').get('mail-letters')),
    activeStore: brief(window.activeStore().get('mail-letters')),
    snap: brief(localStorage.getItem('xy-home-v2:default:mail-letters-snap')),
    pending: window.storeFor('default').get('mail-reply-pending'),
    activeCid: window.__activeCid
  };
  return JSON.stringify(out);
})()`) || '{}');
console.log('  [数据探针]', JSON.stringify(dump));

// UI 现场：打开信箱页，抓「收信」「寄出」两个列表的真实渲染项
const uiLive = JSON.parse(await evalJs(`(function(){
  try {
    const app = document.querySelector('.app[data-app="mail"]');
    if (app) app.click();
    const inEl = document.getElementById('mail-in-list');
    const outEl = document.getElementById('mail-out-list');
    const ini = inEl ? Array.from(inEl.querySelectorAll('.mail-item')).map(i => (i.querySelector('.mail-item-title') || {}).textContent || '') : [];
    const outi = outEl ? Array.from(outEl.querySelectorAll('.mail-item')).map(i => (i.querySelector('.mail-item-title') || {}).textContent || '') : [];
    return JSON.stringify({ in: ini, out: outi });
  } catch(e) { return JSON.stringify({ err: e.message }); }
})()`) || '{}');
console.log('  [信箱 UI 现场]', JSON.stringify(uiLive));

const landed = JSON.parse(await evalJs(`(function(){
  try {
    const ls = JSON.parse(window.storeFor('default').get('mail-letters') || '[]');
    const lsp = JSON.parse(window.storeFor('default').get('mail-reply-pending') || '[]');
    const l = ls.find(function(x){return x && x.type === 'sent';}) || ls[0] || {};
    return JSON.stringify({
      ok: true,
      lsPartnerReply: !!(l.partnerReply && l.partnerReply.content),
      lsReplyText: l.partnerReply ? String(l.partnerReply.content).slice(0, 40) : '',
      lsPendingLeft: lsp.length
    });
  } catch(e) { return JSON.stringify({ ok: false, err: e.message }); }
})()`) || '{}');
console.log('  [落地结果(LS)]', JSON.stringify(landed));
check('寄出的信已带上 TA 回信（partnerReply）', landed.ok === true && landed.lsPartnerReply === true, 'text=' + landed.lsReplyText);
check('回信计划已消费清空', landed.ok === true && landed.lsPendingLeft === 0, 'left=' + landed.lsPendingLeft);

// ---- C. UI：信箱「寄出」列表显示「对方已回信」标签 ----
const ui = JSON.parse(await evalJs(`(function(){
  try {
    const app = document.querySelector('.app[data-app="mail"]');
    if (app) app.click();
    const out = document.getElementById('mail-out-list');
    const items = out ? Array.from(out.querySelectorAll('.mail-item')) : [];
    const tags = items.map(i => (i.querySelector('.mail-item-title') || {}).textContent || '');
    return JSON.stringify({ count: items.length, titles: tags });
  } catch(e) { return JSON.stringify({ err: e.message }); }
})()`) || '{}');
console.log('  [寄出列表 UI]', JSON.stringify(ui));
check('信箱「寄出」列表显示「对方已回信」标签', Array.isArray(ui.titles) && ui.titles.some(t => t.indexOf('对方已回信') >= 0), 'titles=' + JSON.stringify(ui.titles));

// ---- D. 重载 → 持久化验证（partnerReply 应随数据保存，重开后仍在） ----
await openApp(); // 重载
const persisted = JSON.parse(await evalJs(`(function(){
  try {
    const ls = JSON.parse(window.storeFor('default').get('mail-letters') || '[]');
    const l = ls.find(function(x){return x && x.type === 'sent';}) || ls[0] || {};
    return JSON.stringify({ ok: true, partnerReply: !!(l.partnerReply && l.partnerReply.content) });
  } catch(e) { return JSON.stringify({ ok: false, err: e.message }); }
})()`) || '{}');
console.log('  [重载持久化]', JSON.stringify(persisted));
check('重载后 TA 回信仍在（partnerReply 持久化）', persisted.ok === true && persisted.partnerReply === true, JSON.stringify(persisted));

const failed = results.filter(r => !r.ok);
console.log('\n===== 回归结果：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);
