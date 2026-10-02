// ===== 回归脚本：此间【去找TA】切桌面进聊天「正在加载聊天记录」反复挂起/整窗清空重建/长时间卡顿（#952） =====
// 用法：node tools/verify-952-cjgo-single-chain.mjs   （MOCHI_ROOT 可指向隔离副本）
// 症状：此间点别的桌面梦角的【去找TA】，切桌面进聊天后「正在加载聊天记录」反复出现、
//   消息区反复清空重建（0→400→0→200→400）、长时间卡顿，低端机/大历史上像永久卡死。
// 根因：一次点击内先 setActiveContact（contact-switched 预读）再 enterChat（进页 loadMsgs），
//   对刚激活的同一命名空间并发跑两条完整权威读库链：分块热片（2MB×N）读+解析+合并+整窗重建
//   全部 ×2，各自失败还各挂一套 5s 重试与 2MB LS 快照重写；主线程被打满后 IDB 回调/定时器被
//   饿死→读取超时 undefined→再触发重试＝恶性循环（无头 20× 节流 + 8.5MB 分块历史实证，
//   chatScrollMax 强制回流占 CPU 采样 ~10s/20s）。普通进聊天只有一条链不受影响。
// 修复：loadMsgs 读库段加同桌面在飞去重（_lmChainBusy，12s 墙）；scheduleIdbRetry 改走
//   loadMsgs(true)（重试绕过去重＝真失败照样重读）；成功/空库/非数组三个收尾点提前清标记。
// 用例：
//   S1 去重闸在位；S2 成功收尾清标记；S3 重试走 forceIdb；S4 空库收尾清标记
//   B1 跨桌面【去找TA】落在聊天页且显示目标桌面记录（功能零回归）
//   B2 【判别力核心】点击后同一命名空间的 chat-blk-idx 读库链只起一条（修复前恒为 2）
//   B3 权威到达后不再整窗清空：消息区一旦有内容就不再归零（修复前 15s 窗内必见 0）
//   B4 加载条收敛：40s 窗内进度条消失且内容在屏（修复前反复亮起）
//   B5 同桌面进聊天照常（skipRead/常规路径零回归）
//   Z1 零 JS 异常
// RED 基线（纯 HEAD）：B2 红（blk-idx 链×2）、B3 红（整窗清空重建）、S1~S4 红（锚缺失）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
function A(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

// ---- 静态断言 S1~S4 ----
console.log('静态断言:');
const cj = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
A('S1 同桌面读库链在飞去重闸', cj.includes('if (!forceIdb && _lmChainBusy === myPrefix && Date.now() < _lmChainBusyUntil) return;'));
A('S2 读库链成功收尾清标记', (cj.match(/_lmChainBusy = null; \/\/ #952/g) || []).length >= 2);
A('S3 重试走 forceIdb 绕过去重', cj.includes('try { loadMsgs(true); } catch (e) {} // #952'));
A('S4 去重闸有墙（12s，防链真死永久吞调用）', /_lmChainBusyUntil = Date\.now\(\) \+ 12000;/.test(cj));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9820 + Math.floor(Math.random() * 60);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v-952-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : null;
}
async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
}
// idbGet 计数探针（安装器轮询等 idb.js 就位；记录 call 时刻与键名）
const PROBE = `(function(){
  window.__idbCalls = [];
  const iv = setInterval(function () {
    if (typeof window.idbGet === 'function' && !window.idbGet.__logged) {
      clearInterval(iv);
      const origGet = window.idbGet;
      const w = function (k, o) { window.__idbCalls.push({ t: Math.round(performance.now()), k: String(k) }); return origGet.call(window, k, o); };
      w.__logged = true; window.idbGet = w;
    }
  }, 5);
})();`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
try { await cdp('Emulation.setCPUThrottlingRate', { rate: 20 }); } catch (e) {}

// ---- 第 1 次加载：种两个桌面，目标桌面＝8.5MB 分块格式大历史 ----
await gotoApp();
const seeded = await evalJs(`(async () => {
  const cid2 = window.createContact('验证二号');
  const G = 'xy-home-v2';
  const pairs = [];
  const mkMsg = (say, i) => ({ role: i % 2 ? 'ta' : 'me', text: say + i + '，一段中等长度的聊天文本内容，再加一些填充让它接近真实体量。'.repeat(120), tm: Date.now() - i * 60e3 });
  const big = []; const TOTAL = 2400;
  for (let i = 0; i < TOTAL; i++) big.push(mkMsg('一号桌面消息', i));
  const blocks = []; let cur = [], bytes = 0;
  for (const m of big) { cur.push(m); bytes += 96 + m.text.length; if (bytes >= 2 * 1024 * 1024) { blocks.push(cur); cur = []; bytes = 0; } }
  if (cur.length) blocks.push(cur);
  const idx = { v: 1, blocks: blocks.map((b, i) => ({ k: 'chat-blk-' + i, bytes: b.reduce((s, m) => s + 96 + m.text.length, 0), n: b.length })), total: TOTAL, nextSeq: blocks.length };
  for (let i = 0; i < blocks.length; i++) pairs.push({ k: G + ':default:chat-blk-' + i, v: JSON.stringify(blocks[i]) });
  pairs.push({ k: G + ':default:chat-blk-idx', v: JSON.stringify(idx) });
  pairs.push({ k: G + ':default:chat-meta', v: JSON.stringify({ n: TOTAL, t: Date.now(), b: idx.blocks.reduce((s, b) => s + b.bytes, 0) }) });
  const small = []; for (let i = 0; i < 400; i++) small.push(mkMsg('二号桌面消息', i));
  pairs.push({ k: G + ':' + cid2 + ':chat-msgs', v: JSON.stringify(small) });
  pairs.push({ k: G + ':' + cid2 + ':chat-meta', v: JSON.stringify({ n: 400, t: Date.now(), b: small.reduce((s, m) => s + 96 + m.text.length, 0) }) });
  await window.idbSetAll(pairs);
  const roster = (tag) => [{ id: tag + 'a', name: tag + '小A' }];
  try { window.xyStore(G + ':default').set('cjian-roster', JSON.stringify(roster('一号'))); } catch (e) {}
  try { window.xyStore(G + ':' + cid2).set('cjian-roster', JSON.stringify(roster('二号'))); } catch (e) {}
  try { window.xyStore(G).set('active-contact', cid2); } catch (e) {}
  return { cid2: cid2, blocks: blocks.length };
})()`);
console.log('种子完成: ' + JSON.stringify(seeded));

// ---- 第 2 次加载：冷启动回填稳定 ----
await gotoApp();
await sleep(4500);

// 进此间「全部」总览，点跨桌面梦角的【去找TA】，随后逐秒观察 40s
const opened = await evalJs(`(function () {
  try { if (window.setActiveContact) window.setActiveContact(${JSON.stringify(seeded.cid2)}); } catch (e) {}
  window.openCjian();
  const chips = document.querySelectorAll('#cj-groups .cj-gchip');
  for (const c of chips) { if (c.textContent === '全部') c.click(); }
  return { visible: !document.getElementById('page-cjian').hidden, cards: document.querySelectorAll('#cj-list .cj-card').length };
})()`);
console.log('进此间: ' + JSON.stringify(opened));

const clickAt = await evalJs(`window.__idbCalls.length`);
await evalJs(`(function () {
  const cards = Array.from(document.querySelectorAll('#cj-list .cj-card'));
  for (const c of cards) { const b = c.querySelector('.cj-go'); if (b) { b.click(); return true; } }
  return false;
})()`);

let sawZeroAfterContent = false, barSeenCount = 0, loaded = false, lastState = null;
let contentShownAt = -1;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const s = await evalJs(`(function () {
    const bar = document.getElementById('chat-loading');
    return {
      barShown: !!(bar && !bar.hidden),
      bodyKids: (document.getElementById('chat-body') || { children: [] }).children.length,
      hasTarget: ((document.getElementById('chat-body') || { textContent: '' }).textContent || '').indexOf('一号桌面消息') >= 0,
      visible: !(document.getElementById('page-chat') || {}).hidden
    };
  })()`);
  lastState = s;
  if (s.barShown) barSeenCount++;
  if (s.hasTarget && contentShownAt < 0) contentShownAt = i;
  if (contentShownAt >= 0 && i > contentShownAt + 2 && s.bodyKids === 0) sawZeroAfterContent = true;
  if (s.hasTarget && !s.barShown && i > 3) { loaded = true; break; }
}
console.log('行为断言:');
A('B1 跨桌面【去找TA】落在聊天页且显示目标桌面的聊天记录', loaded && lastState && lastState.visible && lastState.hasTarget, lastState);
const chainCalls = await evalJs(`(function () {
  const after = window.__idbCalls.slice(${clickAt});
  return { blkIdx: after.filter(x => x.k.indexOf(':chat-blk-idx') >= 0).length, msgs: after.filter(x => x.k.indexOf(':chat-msgs') >= 0).length };
})()`);
A('B2 点击后同一命名空间的 chat-blk-idx 读库链只起一条（判别力核心，修复前恒为 2）',
  chainCalls && chainCalls.blkIdx === 1, Object.assign({ clickAt: clickAt }, chainCalls));
A('B3 权威到达后不再整窗清空：消息区一旦有内容就不再归零', loaded && !sawZeroAfterContent, { sawZero: sawZeroAfterContent, loaded: loaded });
A('B4 加载条收敛：末态进度条消失且内容在屏', loaded && lastState && !lastState.barShown, { barSeconds: barSeenCount, loaded: loaded });

// ---- B5：同桌面进聊天照常（切回二号桌面→直接 enterChat） ----
const same = await evalJs(`(async () => {
  window.setActiveContact(${JSON.stringify(seeded.cid2)});
  await new Promise(r => setTimeout(r, 300));
  if (!window.enterChat) return { err: 'enterChat 缺失' };
  window.enterChat();
  await new Promise(r => setTimeout(r, 2500));
  const chatText = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
  return { chatUp: !document.getElementById('page-chat').hidden, hasMsgs: chatText.indexOf('二号桌面消息') >= 0, active: window.__activeCid };
})()`);
A('B5 同桌面进聊天照常（常规路径零回归）', same && same.chatUp === true && same.hasMsgs === true, same);

// ---- Z1：零 JS 异常 ----
const errs = await evalJs(`(window.__jsErrors || []).slice(0, 5)`);
A('Z1 零 JS 异常', !errs || errs.length === 0, errs);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
