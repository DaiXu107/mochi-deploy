// ===== 回归脚本：表情包面板「每次打开都重新加载」复发（#547，#457 短路被令牌化翻转账废掉） =====
// 用法：node tools/verify-emoji-panel-reopen.mjs（需 node 21+ 与本机 Chrome/Edge）
// 背景（用户反馈：小米15Pro Chrome，明说其他设备型号也有）：
//   池视图卡被 chatcard.js ccTokenizeGiantMedia 异步令牌化（dataURL→@@m:token）后，卡原文变了、
//   显示内容没变；chat.js 面板签名按原文算 → 翻转后签名失配 → 开面板整面板 innerHTML 重建 +
//   全部图走媒体池重新解析＝「每次打开表情包都重新加载一遍」。大库令牌化 pass 跑数秒，期间每次
//   开面板都撞上。
// 修复：签名改走「令牌稳定身份」chatcard.js ccMediaCardIdent（原始大图卡与令牌卡同一短指纹，
//   ccTokMemoRev 登记 token→指纹）；另加「我的表情包」开门闸（__myeIdbApplied 且内存非空不再
//   每次开面板 idbGet+JSON.parse 整包重读）。
// 验证（无头 Chrome 384×752 真实产物）：S 层源码断言 + B 层行为断言——
//   B1 首开渲染正常；B2 等令牌化翻转完成后重开：DOM 不重建（innerHTML 0 次写入、节点戳存活）；
//   B3 再开仍不重建；B4 我的表情包第二次开门不再读 my-emoji-groups（idbGet 计数不增）且渲染正常。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const chk = (name, ok, detail) => { if (ok) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); } };

// ---------- S 层：源码断言 ----------
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const ccSrc = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8');
const mpSrc = readFileSync(join(root, 'src/js/media-pool.js'), 'utf8');
console.log('S 层（源码作用域）');
chk('S1 面板签名走令牌稳定身份（chat.js _ident）', chatSrc.includes("var _ident = (typeof window.ccMediaCardIdent === 'function') ? window.ccMediaCardIdent : null;"));
chk('S2 ccMediaCardIdent 暴露（chatcard.js）', ccSrc.includes('window.ccMediaCardIdent = function (card)'));
chk('S3 令牌→短指纹反查登记（ccTokMemoRev.set）', ccSrc.includes('ccTokMemoRev.set(tok, ccMediaFrag(j.body));'));
chk('S4 我的表情包开门闸（__myeIdbApplied 非空跳过）', chatSrc.includes('if (window.__myeIdbApplied === true && Array.isArray(myGroups) && myGroups.length) return;'));
chk('S5 落池竞态不标缺失（media-pool pending 检查）', mpSrc.includes('if (writeBuf[wi] && writeBuf[wi].k === FULL + h) { pending = true; break; }'));

// ---------- B 层：真实产物行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = 9750 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v547-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 384, height: 752, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);

const seed = await evalJs(`(async () => {
  try { localStorage.setItem('xy-home-v2:cc-scope-migrated', '1'); } catch (e) {} // 排除单联系人迁移干扰
  const mkBig = (n) => 'data:image/png;base64,' + ('A'.repeat(90000)).slice(0, 90000) + String(n).padEnd(3, 'B'); // >64KB 触发令牌化
  const g1 = Array.from({ length: 6 }, (_, i) => mkBig(i));
  const json = JSON.stringify({ text: [], kaomoji: [], emoji: [], sticker: [['G1', g1]], image: [], poke: [], voice: [] });
  window.xyStore(window.activePrefix()).set('cc-groups', json);
  if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite();
  window.xyStore('xy-home-v2').set('emoji-last', JSON.stringify({ mode: 'ta', ta: 'G1', mine: 'G1', pub: '' }));
  const myG = [['G1', [mkBig(1), mkBig(2)]]];
  await window.idbSet('xy-home-v2:my-emoji-groups', JSON.stringify(myG));
  return 'seeded';
})()`);
chk('B0 种子就绪（专属库 6 张 >64KB 大图 + mine 库）', seed === 'seeded', String(seed));
await sleep(400);

// 间谍：innerHTML 写入计数 + 媒体池读计数 + my-emoji-groups 读计数
await evalJs(`(() => {
  window.__m = { sets: 0, poolReads: 0, myeReads: 0 };
  const list = document.getElementById('emoji-list');
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(list, 'innerHTML', { get: d.get, set(v) { window.__m.sets++; d.set.call(this, v); }, configurable: true });
  const og = window.idbGet;
  window.idbGet = function (k) {
    const s = String(k);
    if (s.indexOf('media:') >= 0) window.__m.poolReads++;
    if (s.indexOf('my-emoji-groups') >= 0) window.__m.myeReads++;
    return og.apply(this, arguments);
  };
  return 'spied';
})()`);

// B1 首开
const open1 = await evalJs(`(async () => {
  window.openEmojiPanelForInsert(function(){});
  await new Promise(r => setTimeout(r, 1000));
  const grid = document.querySelector('#emoji-list .emoji-grid');
  if (grid) grid.__v547 = 'S1';
  const imgs = document.querySelectorAll('#emoji-list img');
  return { grid: !!grid, imgs: imgs.length, sets: window.__m.sets };
})()`);
chk('B1 首开渲染出 6 张图（TA 的表情包·G1）', open1 && open1.grid && open1.imgs === 6, JSON.stringify(open1));

// 等令牌化翻转：池视图首卡变 @@m:（大库 pass 数秒，上限 20s）
let flipped = false;
for (let i = 0; i < 50; i++) {
  await sleep(400);
  const first = await evalJs(`(() => { const g = (window.getScopedGroups && window.getScopedGroups('sticker','own')) || []; return g.length && g[0][1].length ? String(g[0][1][0]).slice(0, 4) : ''; })()`);
  if (first === '@@m:') { flipped = true; break; }
}
chk('B1.5 令牌化翻转已发生（首卡变 @@m: 令牌）', flipped);

// B2 翻转后重开：不重建
await evalJs(`(function(){ window.closeEmojiPanelForInsert(); window.__m.sets = 0; window.__m.poolReads = 0; return 1; })()`);
await sleep(400);
const open2 = await evalJs(`(async () => {
  window.openEmojiPanelForInsert(function(){});
  await new Promise(r => setTimeout(r, 1000));
  const grid = document.querySelector('#emoji-list .emoji-grid');
  const imgs = document.querySelectorAll('#emoji-list img');
  return { sets: window.__m.sets, poolReads: window.__m.poolReads, stamp: !!(grid && grid.__v547 === 'S1'), imgs: imgs.length };
})()`);
chk('B2 令牌化翻转后重开不重建 DOM（innerHTML 零写入）', open2 && open2.sets === 0, JSON.stringify(open2));
chk('B2.1 面板节点存活（首开的 grid 节点未被替换）', open2 && open2.stamp, JSON.stringify(open2 && open2.stamp));
chk('B2.2 图片全数在位且未重新走媒体池解析', open2 && open2.imgs === 6 && open2.poolReads === 0, JSON.stringify(open2));

// B3 再开（稳定态）
await evalJs(`(function(){ window.closeEmojiPanelForInsert(); window.__m.sets = 0; window.__m.poolReads = 0; return 1; })()`);
await sleep(400);
const open3 = await evalJs(`(async () => {
  window.openEmojiPanelForInsert(function(){});
  await new Promise(r => setTimeout(r, 800));
  const grid = document.querySelector('#emoji-list .emoji-grid');
  return { sets: window.__m.sets, stamp: !!(grid && grid.__v547 === 'S1') };
})()`);
chk('B3 第三次打开仍不重建', open3 && open3.sets === 0 && open3.stamp, JSON.stringify(open3));

// B4 我的表情包开门闸：切 mine 模式。启动链路（#281 bootRestore，restore-done+4s）可能已把
// my-emoji-groups 应用进内存（__myeIdbApplied=true）——闸门恰好在「已应用」时跳过重读。
// 无论 boot 是否先行应用过：开面板都不得再触发整包 idbGet（旧实现每次 open 必读一次＝18MB 级库白付）。
await evalJs(`(function(){ window.closeEmojiPanelForInsert(); window.__m.myeReads = 0; return 1; })()`);
await evalJs(`(function(){ window.xyStore('xy-home-v2').set('emoji-last', JSON.stringify({ mode: 'mine', ta: '', mine: 'G1', pub: '' })); return 1; })()`);
await sleep(4500); // 等 bootRestore（restore-done+4s）窗口走完，口径稳定
const mine1 = await evalJs(`(async () => {
  window.openEmojiPanelForInsert(function(){});
  await new Promise(r => setTimeout(r, 1500));
  const imgs = document.querySelectorAll('#emoji-list img');
  return { myeReads: window.__m.myeReads, imgs: imgs.length };
})()`);
chk('B4.1 mine 模式开面板零整包重读（闸门/boot 链路生效）', mine1 && mine1.myeReads === 0 && mine1.imgs === 2, JSON.stringify(mine1));
await evalJs(`(function(){ window.closeEmojiPanelForInsert(); window.__m.myeReads = 0; return 1; })()`);
await sleep(300);
const mine2 = await evalJs(`(async () => {
  window.openEmojiPanelForInsert(function(){});
  await new Promise(r => setTimeout(r, 1200));
  const imgs = document.querySelectorAll('#emoji-list img');
  return { myeReads: window.__m.myeReads, imgs: imgs.length };
})()`);
chk('B4.2 mine 模式二开仍零重读（idbGet 计数不增、图仍在）', mine2 && mine2.myeReads === 0 && mine2.imgs === 2, JSON.stringify(mine2));

const errs0 = (await evalJs(`(window.__jsErrors || []).length`)) || 0;
const errs = await evalJs(`(window.__jsErrors || []).length`);
chk('B5 无新增页面错误', errs - errs0 === 0, 'before=' + errs0 + ' after=' + errs);

chrome.kill();
server.close();
console.log('\\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
