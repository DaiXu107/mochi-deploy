// ===== 引用预览不一致（华为 P50E Edge 报障：引用联系人的消息，输入栏上方预览显示的不是被引的那条） =====
// 排查路径：气泡菜单「引用」→ lastQuote = quoteTextOf(msgs[activeMsgEl.dataset.idx]) → renderDraft。
// 预览内容错误的唯一可能：msgs[idx] ≠ 用户点的那条 → DOM data-idx 与 msgs 数组错位。
// 场景：
//   S1 小历史 happy path：10 条、点倒数第 2 条 in 消息 → 预览文本 == 该条文本
//   S2 大历史（500 条，唯一文案）：首窗 + 上翻扩窗后各点一条 in 消息 → 预览一致
//   S3 全窗不变式：屏上每个 .msg[data-idx] 的文本 == msgs[idx].text（首渲后/上翻后/发送后）
//   S4 权威收尾不重渲形态：渲染后从外部改库（模拟权威与快照差异）再走 loadMsgs 合并，
//      若 finish 未重渲（不贴底时），点消息引用 → 预览是否错位
// 用法：node tools/verify-quote-preview.mjs（需先 node build.mjs）
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9920 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-qp-' + Date.now()),
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
const CFG = {
  'reply-rs-min': 9999, 'reply-rs-max': 9999, 'reply-reply-min': 0, 'reply-reply-max': 0,
  'reply-rn-prob': 0, 'reply-touch-prob': 0, 'reply-rc-prob': 0,
  'reply-sticker-prob': 0, 'reply-emoji-prob': 0, 'reply-image-prob': 0, 'reply-voice-prob': 0,
  'reply-kaomoji-prob': 0, 'reply-cf-prob': 0, 'reply-py-prob': 0, 'reply-as-en': 0,
  'reply-quote-prob': 0
};
async function applyCfg() {
  const kvs = JSON.stringify(CFG);
  await evalJs("(function(){var o=" + kvs + ";Object.keys(o).forEach(function(k){window.activeStore().set(k, String(o[k]));});return true;})()");
}
async function seed(n, prefix) {
  await evalJs(`(function(){
    const now = Date.now();
    const arr = [];
    for (let i = 0; i < ${n}; i++) {
      if (i % 2 === 0) arr.push({ side: 'out', text: '${prefix}我发的' + i, ts: now - (${n} - i) * 60000 });
      else arr.push({ side: 'in', text: '${prefix}对方发的' + i, ts: now - (${n} - i) * 60000 });
    }
    window.activeStore().set('chat-msgs', JSON.stringify(arr));
    return true;
  })()`);
  await sleep(300);
}
// 点指定 data-idx 的 in 消息气泡 → 菜单「引用」→ 返回预览条文本与该 idx 的内存文本
async function quoteViaMenu(idx) {
  return await evalJs(`(function(){
    const item = document.querySelector('#chat-body .msg-in[data-idx="' + ${idx} + '"]');
    if (!item) return JSON.stringify({ err: 'no-el' });
    const b = item.querySelector('.msg-bubble');
    if (!b) return JSON.stringify({ err: 'no-bubble' });
    b.click();
    const menu = document.getElementById('msg-actions');
    if (!menu || menu.hidden) return JSON.stringify({ err: 'no-menu' });
    const btn = menu.querySelector('.ma-btn[data-act="quote"]');
    if (!btn) return JSON.stringify({ err: 'no-btn' });
    btn.click();
    const bar = document.getElementById('chat-draft-quote');
    const txt = bar && !bar.hidden ? (bar.querySelector('.chat-draft-quote-text') || {}).textContent || '' : '(hidden)';
    return JSON.stringify({ preview: txt });
  })()`);
}
// 全窗不变式：屏上 .msg[data-idx] 文本 vs 内存 msgs[idx] 文本
async function invariant() {
  const raw = await evalJs(`(function(){
    const out = [];
    document.querySelectorAll('#chat-body .msg[data-idx]').forEach(function(el){
      const i = Number(el.dataset.idx);
      const m = window.getChatMsgs()[i];
      const expect = m && m.text ? String(m.text).slice(0, 30) : '(null)';
      const bubble = el.querySelector('.msg-bubble');
      const got = bubble ? String(bubble.textContent || '').trim().slice(0, 30) : '(no-bubble)';
      if (expect !== got && !(m && m.type === 'sticker') && !(m && m.type === 'image')) out.push({ i: i, expect: expect, got: got });
    });
    return JSON.stringify({ total: document.querySelectorAll('#chat-body .msg[data-idx]').length, bad: out.slice(0, 6), badN: out.length });
  })()`);
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// ---- S1 小历史 happy path ----
console.log('--- S1 小历史 happy path ---');
await openPage();
await applyCfg();
await evalJs("(function(){window.activeStore().set('chat-msgs','[]');return true;})()");
await sleep(200);
await seed(10, 'S1');
await openPage();
await gotoChat();
await sleep(600);
const s1 = JSON.parse(await quoteViaMenu(7)); // 倒数第 3 条是 in（i=7）
const expect1 = await evalJs("(function(){var m=window.getChatMsgs()[7];return m?m.text:'?';})()");
check('S1 引用 in 消息预览文本一致', !s1.err && s1.preview === expect1, JSON.stringify({ preview: s1, expect: expect1 }));

// ---- S2/S3 大历史 ----
console.log('--- S2/S3 大历史（500 条）首窗/上翻/不变式 ---');
await evalJs("(function(){window.activeStore().set('chat-msgs','[]');return true;})()");
await sleep(200);
await seed(500, 'S2');
await openPage();
await gotoChat();
await sleep(1200);
const invA = await invariant();
check('S3a 首渲后全窗 data-idx 不变式', !!invA && invA.badN === 0, JSON.stringify(invA));
// 点首窗内一条较早的 in 消息（首窗起点附近）
const firstIdx = await evalJs("(function(){var el=document.querySelector('#chat-body .msg-in[data-idx]');return el?Number(el.dataset.idx):-1;})()");
const s2 = JSON.parse(await quoteViaMenu(firstIdx));
const expect2 = await evalJs("(function(){var m=window.getChatMsgs()[" + firstIdx + "];return m?m.text:'?';})()");
check('S2a 首窗起点 in 消息引用预览一致', !s2.err && s2.preview === expect2, JSON.stringify({ idx: firstIdx, preview: s2, expect: expect2 }));
// 上翻加载更旧 → 再验不变式 + 引用旧消息
await evalJs("(function(){var b=document.getElementById('chat-body'); if(b) b.scrollTop=0; return true;})()");
await sleep(800);
await evalJs("(function(){var b=document.getElementById('chat-body'); if(b) b.scrollTop=0; return true;})()");
await sleep(800);
const invB = await invariant();
check('S3b 上翻扩窗后 data-idx 不变式', !!invB && invB.badN === 0, JSON.stringify(invB));
const oldIdx = await evalJs("(function(){var el=document.querySelector('#chat-body .msg-in[data-idx]');return el?Number(el.dataset.idx):-1;})()");
const s2b = JSON.parse(await quoteViaMenu(oldIdx));
const expect2b = await evalJs("(function(){var m=window.getChatMsgs()[" + oldIdx + "];return m?m.text:'?';})()");
check('S2b 上翻后引用更旧消息预览一致', !s2b.err && s2b.preview === expect2b, JSON.stringify({ idx: oldIdx, preview: s2b, expect: expect2b }));

// ---- S4 权威收尾与屏上错位形态：渲染后外部改库（去重删一条）再触发权威重读 ----
console.log('--- S4 外部改库+权威重读后（用户停在历史位置） ---');
// 先滚回底部，再上翻两屏（制造 renderStart>0、不贴底），随后外部改库触发重读
await evalJs("(function(){var b=document.getElementById('chat-body'); if(b) b.scrollTop=b.scrollHeight; return true;})()");
await sleep(400);
await evalJs("(function(){window.activeStore().set('chat-msgs', (function(){var a=JSON.parse(window.activeStore().get('chat-msgs'));a.splice(5,1);return JSON.stringify(a);})());return true;})()");
await sleep(200);
await openPage(); // 重进聊天触发权威读
await gotoChat();
await sleep(1000);
await evalJs("(function(){var b=document.getElementById('chat-body'); if(b) b.scrollTop=0; return true;})()");
await sleep(600);
await evalJs("(function(){window.activeStore().set('chat-msgs', (function(){var a=JSON.parse(window.activeStore().get('chat-msgs'));a.splice(6,1);return JSON.stringify(a);})());return true;})()");
await sleep(200);
const invC = await invariant();
check('S4 外部改库后屏上不变式（若 finish 不重渲则此处暴露错位）', !!invC && invC.badN === 0, JSON.stringify(invC));

// ---- S5 重排竞态：菜单打开后 msgs 中段被删（模拟权威合并/尾巴回放位移），DOM 未重渲 ----
console.log('--- S5 菜单打开→msgs 中段删除→点引用（身份重定位） ---');
await openPage();
await gotoChat();
await sleep(800);
// 找最后一条 in 消息的 idx，先弹菜单（快照身份），再删它前面一条制造位移，再点「引用」
const s5pre = await evalJs(`(function(){
  const items = Array.from(document.querySelectorAll('#chat-body .msg-in[data-idx]'));
  if (!items.length) return 'no-msg';
  const el = items[items.length - 1];
  const idx = Number(el.dataset.idx);
  const rec = window.getChatMsgs()[idx];
  el.querySelector('.msg-bubble').click();
  const menu = document.getElementById('msg-actions');
  if (!menu || menu.hidden) return 'no-menu';
  // 模拟权威合并/尾巴回放：内存数组中段删一条（DOM 不重渲＝下标整体前移）
  window.getChatMsgs().splice(Math.max(0, idx - 3), 1);
  const btn = menu.querySelector('.ma-btn[data-act="quote"]');
  btn.click();
  const bar = document.getElementById('chat-draft-quote');
  const txt = bar && !bar.hidden ? (bar.querySelector('.chat-draft-quote-text') || {}).textContent || '' : '(hidden)';
  return JSON.stringify({ tapped: rec ? rec.text : '?', preview: txt });
})()`);
let s5 = null; try { s5 = JSON.parse(s5pre); } catch (e) {}
check('S5 重排后引用预览仍是被引那条', !!s5 && !s5.err && s5.preview === s5.tapped, s5pre);

// ---- S6 对象换血（权威读库合并换成新解析对象）：签名唯一匹配路径 ----
console.log('--- S6 快照对象被替换→按 ts/side/text 签名重定位 ---');
await openPage();
await gotoChat();
await sleep(800);
const s6pre = await evalJs(`(function(){
  const items = Array.from(document.querySelectorAll('#chat-body .msg-in[data-idx]'));
  if (!items.length) return 'no-msg';
  const el = items[items.length - 1];
  const idx = Number(el.dataset.idx);
  const arr = window.getChatMsgs();
  const rec = arr[idx];
  el.querySelector('.msg-bubble').click();
  const menu = document.getElementById('msg-actions');
  if (!menu || menu.hidden) return 'no-menu';
  // 模拟权威读库合并：整包换成新解析对象（引用全失效），内容不变
  const fresh = arr.map(function(m){ return JSON.parse(JSON.stringify(m)); });
  arr.length = 0; Array.prototype.push.apply(arr, fresh);
  const btn = menu.querySelector('.ma-btn[data-act="quote"]');
  btn.click();
  const bar = document.getElementById('chat-draft-quote');
  const txt = bar && !bar.hidden ? (bar.querySelector('.chat-draft-quote-text') || {}).textContent || '' : '(hidden)';
  return JSON.stringify({ tapped: rec ? rec.text : '?', preview: txt });
})()`);
let s6 = null; try { s6 = JSON.parse(s6pre); } catch (e) {}
check('S6 对象换血后引用预览仍是被引那条', !!s6 && !s6.err && s6.preview === s6.tapped, s6pre);

// ---- S7 开菜单【前】msgs 已中段位移（DOM 未重渲）＝#407 快照被陈旧下标毒化的残留洞 ----
// 真实形态：#220 不贴底时权威读库合并/回放按 ts 中段插删、有意跳过重渲防闪——之后用户点的
// 气泡是「渲染那一刻」画的那条，data-idx 却已指向别的消息，#407 快照开场即取错、四级重定位
// 救不回＝「引用的消息和显示的消息完全不对」（EC-PAD01 SE Chrome 等同报，2026-09-15）。
// #491 修复=渲染期把消息身份写进 data-mk，开菜单按 mk 反查真实那条。
console.log('--- S7 开菜单前 msgs 中段已位移（DOM 未重渲，#491 身份锚） ---');
await evalJs("(function(){window.activeStore().set('chat-msgs','[]');return true;})()");
await sleep(200);
await seed(300, 'S7');
await openPage();
await gotoChat();
await sleep(1000);
const s7pre = await evalJs(`(function(){
  const items = Array.from(document.querySelectorAll('#chat-body .msg-in[data-idx]'));
  if (!items.length) return 'no-msg';
  const el = items[items.length - 1]; // 点窗内最后一条 in 消息（中段删除后其真实下标已 -1）
  const idx = Number(el.dataset.idx);
  if (idx <= 6) return 'idx-too-low';
  const arr = window.getChatMsgs();
  const rec = arr[idx];
  const mk = el.dataset.mk || '';
  // 先模拟权威合并中段删一条（DOM 不重渲＝该气泡真实消息的新下标是 idx-1）
  arr.splice(3, 1);
  // 再点气泡开菜单（修复前：快照按陈旧 idx 取到别条；修复后：按 mk 反查回真实那条）
  el.querySelector('.msg-bubble').click();
  const menu = document.getElementById('msg-actions');
  if (!menu || menu.hidden) return JSON.stringify({ err: 'no-menu', mk: mk });
  const btn = menu.querySelector('.ma-btn[data-act="quote"]');
  if (!btn) return JSON.stringify({ err: 'no-btn', mk: mk });
  btn.click();
  const bar = document.getElementById('chat-draft-quote');
  const txt = bar && !bar.hidden ? (bar.querySelector('.chat-draft-quote-text') || {}).textContent || '' : '(hidden)';
  return JSON.stringify({ tapped: rec ? rec.text : '?', preview: txt, mk: mk });
})()`);
let s7 = null; try { s7 = JSON.parse(s7pre); } catch (e) {}
check('S7 开菜单前已位移仍引用被点那条（#491 身份锚）', !!s7 && !s7.err && !!s7.mk && s7.preview === s7.tapped, s7pre);

// ---- S7b 判别力实证：同一场景剥离 data-mk（=回退到 #491 之前的旧行为）必然串条 ----
// 证明该场景确有判别力：mk 在位=引用被点那条；mk 缺失（旧代码）=按陈旧下标取到别条。
console.log('--- S7b 去锚对照（旧行为必然串条＝场景判别力） ---');
await evalJs("(function(){window.activeStore().set('chat-msgs','[]');return true;})()");
await sleep(200);
await seed(300, 'S7b');
await openPage();
await gotoChat();
await sleep(1000);
const s7bpre = await evalJs(`(function(){
  const items = Array.from(document.querySelectorAll('#chat-body .msg-in[data-idx]'));
  if (!items.length) return 'no-msg';
  const el = items[items.length - 1];
  const idx = Number(el.dataset.idx);
  if (idx <= 6) return 'idx-too-low';
  const arr = window.getChatMsgs();
  const rec = arr[idx];
  arr.splice(3, 1);           // 中段删一条制造位移（DOM 未重渲）
  el.dataset.mk = '';         // 剥离身份锚＝#491 之前的旧行为
  el.querySelector('.msg-bubble').click();
  const menu = document.getElementById('msg-actions');
  if (!menu || menu.hidden) return 'no-menu';
  const btn = menu.querySelector('.ma-btn[data-act="quote"]');
  btn.click();
  const bar = document.getElementById('chat-draft-quote');
  const txt = bar && !bar.hidden ? (bar.querySelector('.chat-draft-quote-text') || {}).textContent || '' : '(hidden)';
  return JSON.stringify({ tapped: rec ? rec.text : '?', preview: txt });
})()`);
let s7b = null; try { s7b = JSON.parse(s7bpre); } catch (e) {}
check('S7b 去锚后串条实证（preview≠tapped＝旧代码确有此洞）', !!s7b && !s7b.err && s7b.preview !== s7b.tapped, s7bpre);

// ---- S8 原消息已被删出数组（mk 查无）→ 回退旧 data-idx 语义，动作不异常 ----
console.log('--- S8 mk 查无回退（原消息被删） ---');
await openPage();
await gotoChat();
await sleep(800);
const s8pre = await evalJs(`(function(){
  const items = Array.from(document.querySelectorAll('#chat-body .msg-in[data-idx]'));
  if (!items.length) return 'no-msg';
  const el = items[items.length - 1];
  const idx = Number(el.dataset.idx);
  el.querySelector('.msg-bubble').click();
  const menu = document.getElementById('msg-actions');
  if (!menu || menu.hidden) return 'no-menu';
  // 删掉被点那条本身（mk 查无形态）→ 引用动作回退 data-idx 行为（旧语义），只需不抛异常
  const arr = window.getChatMsgs();
  arr.splice(idx, 1);
  const btn = menu.querySelector('.ma-btn[data-act="quote"]');
  btn.click();
  const bar = document.getElementById('chat-draft-quote');
  const txt = bar && !bar.hidden ? (bar.querySelector('.chat-draft-quote-text') || {}).textContent || '' : '(hidden)';
  return JSON.stringify({ preview: txt, noThrow: true });
})()`);
let s8 = null; try { s8 = JSON.parse(s8pre); } catch (e) { s8 = { err: String(e) }; }
check('S8 原消息被删时引用不异常（回退旧语义）', !!s8 && !s8.err && s8.noThrow, s8pre);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
