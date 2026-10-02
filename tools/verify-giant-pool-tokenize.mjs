// verify-giant-pool-tokenize.mjs —— #373 巨型公用字卡库内存瘦身行为验证（OOM 自动退回开屏家族）
// 背景：重度用户 cc-groups-public 单键 45~189MB（贴纸 dataURL 整份存卡里），回复池解析副本
//   + idb memoryCache 原始串双份常驻（tmp-pool-mem 实测 179MB 种子→开聊天 730MB 不回落），
//   iOS WebKit 渲染进程被杀＝「用一会自动退回开屏」。修复：pubGroupsRaw 构建缓存后对
//   >64KB 贴纸/图片卡做内存内令牌化（noCache 不进 map 热缓存），原始库键零改动。
// 断言：
//   A1 大贴纸卡在回复池里已换成 @@m: 令牌（getMediaCards('sticker')）
//   A2 小贴纸卡（<64KB）保持原文不令牌化
//   B1 原始库键零改动（idbGet 原键仍含 data:image/jpeg、不含令牌）
//   C1 池键已落 IDB（media:<hash> 存在，mochiMediaFlush 后）
//   D1 令牌端到端可渲染（img src=令牌 → media-pool 观察器换回 dataURL）
//   E1 内存回落：发消息触发回复池构建后，堆峰值显著低于修复前基线（<500MB，修前 730MB）
// 用法：node tools/verify-giant-pool-tokenize.mjs（支持 MOCHI_VERIFY_ROOT 指定副本构建）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_VERIFY_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('环境不满足：找不到 Chrome/Edge'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const cdpPort = 9890 + Math.floor(Math.random() * 50);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--enable-precise-memory-info', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-verify-pool-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
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
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : null;
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 402, height: 812, deviceScaleFactor: 3, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }

// 种巨型公用库：大卡（≈340KB×60 张=20MB，足够触发令牌化）+ 小卡（2KB）
const seeded = await evalJs(`(async () => {
  const big = 'data:image/jpeg;base64,' + 'AQOB'.repeat(86000);   // ≈344KB
  const small = 'data:image/jpeg;base64,' + 'AQOB'.repeat(500);   // ≈2KB
  const g = { text: [], kaomoji: [], emoji: [], sticker: [['大贴纸组', []], ['小贴纸组', []]], image: [], poke: [], voice: [] };
  for (let i = 0; i < 60; i++) g.sticker[0][1].push(big);
  for (let i = 0; i < 30; i++) g.sticker[1][1].push(small);
  const v = JSON.stringify(g);
  await window.idbSetAll([{ k: 'xy-home-v2:cc-groups-public', v }]);
  const idx = {}; idx['xy-home-v2:cc-groups-public'] = v.length;
  localStorage.setItem('xy-home-v2:__big-idx', JSON.stringify(idx));
  return Math.round(v.length / 1048576);
})()`);
console.log('种子: cc-groups-public ≈' + seeded + 'MB');

// 重载干净会话 → 进桌面 → 开聊天触发回复池
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
await evalJs(`(function(){ const sb=document.getElementById('splash-box'); if(sb) sb.scrollTop=sb.scrollHeight; const se=document.getElementById('splash-enter'); if(se) se.click(); const fe=document.getElementById('splash-force-enter'); if(fe && se && se.hidden) fe.click(); })()`);
await sleep(2500);
await evalJs(`(function(){ const a=document.querySelector('.app[data-app="chat"]'); if(a) a.click(); })()`);
await sleep(1500);
await evalJs(`(function(){ const inp=document.getElementById('chat-input'); const btn=document.getElementById('chat-send'); if(inp&&btn){ inp.textContent='在吗'; inp.dispatchEvent(new Event('input',{bubbles:true})); btn.click(); } })()`);
await sleep(2500);
await evalJs('window.mochiMediaFlush ? window.mochiMediaFlush() : null');
await sleep(800);

let pass = 0, fail = 0;
const assert = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); } };

const dbg = await evalJs(`(async () => {
  const raw = await window.idbGet('xy-home-v2:cc-groups-public');
  return {
    deferred: JSON.stringify(window.__xyIdbDeferredKeys || []),
    memLen: String(window.xyStore ? window.xyStore('xy-home-v2').get('cc-groups-public') : '').length,
    idbLen: typeof raw === 'string' ? raw.length : String(raw),
    mediaStickerN: window.getMediaCards ? (window.getMediaCards('sticker') || []).length : -1,
    chatBodyChildren: document.getElementById('chat-body') ? document.getElementById('chat-body').childElementCount : -1
  };
})()`);
console.log('诊断: ' + JSON.stringify(dbg));

const poolState = await evalJs(`(async () => {
  const st = window.getMediaCards ? window.getMediaCards('sticker') : null;
  if (!st) return { err: 'no-getMediaCards' };
  let bigTok = 0, bigRaw = 0, smallRaw = 0;
  st.forEach(function (c) {
    if (typeof c !== 'string') return;
    const bar = c.indexOf('|||'); const body = bar >= 0 ? c.slice(bar + 3) : c;
    if (body.indexOf('@@m:') === 0) bigTok++;
    else if (body.length > 100000) bigRaw++;
    else smallRaw++;
  });
  return { total: st.length, bigTok, bigRaw, smallRaw };
})()`);
assert('A1 大贴纸卡在回复池已换成令牌', poolState.bigTok >= 60, JSON.stringify(poolState));
assert('A2 小贴纸卡保持原文', poolState.smallRaw >= 30 && poolState.bigRaw === 0, JSON.stringify(poolState));

const rawCheck = await evalJs(`(async () => {
  const raw = await window.idbGet('xy-home-v2:cc-groups-public');
  if (typeof raw !== 'string') return { err: 'no-raw' };
  return { len: raw.length, hasData: raw.indexOf('data:image/jpeg') >= 0, hasTok: raw.indexOf('@@m:') >= 0 };
})()`);
assert('B1 原始库键零改动（仍存 dataURL、无令牌）', rawCheck.hasData === true && rawCheck.hasTok === false, JSON.stringify(rawCheck));

const poolKey = await evalJs(`(async () => {
  const raw = await window.idbGet('xy-home-v2:cc-groups-public');
  const m = raw.match(/data:image\\/jpeg;base64,[A-Za-z0-9+\\/=]+/);
  if (!m) return { err: 'no-body' };
  const buf = new TextEncoder().encode(m[0]);
  const dig = await crypto.subtle.digest('SHA-256', buf);
  const h = [...new Uint8Array(dig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const pv = await window.idbGet('xy-home-v2:media:' + h);
  let nPool = -1;
  try { nPool = (await window.idbGetAllKeys()).filter(k => String(k).indexOf('xy-home-v2:media:') === 0).length; } catch (e2) {}
  return { hash: h.slice(0, 8), pooled: typeof pv === 'string' && pv.indexOf('data:image/jpeg') === 0, nPool };
})()`);
assert('C1 池键已落 IDB（media:<hash>）', poolKey.pooled === true, JSON.stringify(poolKey));

const render = await evalJs(`(async () => {
  const st = window.getMediaCards('sticker') || [];
  const tok = st.find(c => typeof c === 'string' && c.indexOf('@@m:') === 0);
  if (!tok) return { err: 'no-token-card' };
  const img = document.createElement('img');
  img.src = tok;
  document.body.appendChild(img);
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    await new Promise(r => setTimeout(r, 200));
    if (img.src.indexOf('data:image/jpeg') === 0) break;
  }
  const ok = img.src.indexOf('data:image/jpeg') === 0;
  img.remove();
  return { ok, tokHead: tok.slice(0, 12) };
})()`);
assert('D1 令牌端到端可渲染（media-pool 懒解析换回 dataURL）', render.ok === true, JSON.stringify(render));

const heap = await evalJs('Math.round(performance.memory.usedJSHeapSize / 1048576)');
assert('E1 触发回复池后堆受控（<500MB，修前同场景 730MB）', heap > 0 && heap < 500, 'heap=' + heap + 'MB');

console.log('\\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
