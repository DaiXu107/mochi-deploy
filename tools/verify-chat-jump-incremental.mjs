// ===== 验证 #241：打开聊天「快照缺尾部」不再整窗清空重画（小米15Pro/Chrome 报障跳动残留） =====
// #220 原地补丁只覆盖「重开同窗同貌」；快照与权威条数不同（快照缺上次会话尾条/对端
// 新消息只在 IDB）时整窗清空重画=肉眼跳动（无头实录 rm3+add8 复现）。
// 修复：inplacePatchIfSameWindow 放宽为前缀判定 + loadNewerIncremental(len) 尾部增量。
// 用法：node tools/verify-chat-jump-incremental.mjs（需先 node build.mjs）
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
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
const base = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(desc, ok, detail) { results.push(ok); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });

// 种 3 条消息并等低频落盘（LS 快照 + IDB 权威同构）
await page.evaluate(() => document.querySelector('.app[data-app="chat"]').click());
await page.waitForTimeout(2000);
for (const t of ['验证消息甲', '验证消息乙', '验证消息丙']) {
  await page.evaluate((txt) => window.chatAddIn(txt), t);
  await page.waitForTimeout(1100);
}
await page.waitForTimeout(4000);
const seeded = await page.evaluate(() => {
  const raw = localStorage.getItem('xy-home-v2:default:chat-msgs');
  return { ls: raw ? JSON.parse(raw).length : -1 };
});
check('S1 种3条消息并落盘(LS快照=3+尾部)', seeded.ls >= 3, JSON.stringify(seeded));

// 回滚 LS 快照到 1 条（模拟快照缺上次会话尾条，权威 IDB 仍全量），并把 chat-meta
// 账本 b 字节吹到懒读门槛之上——模拟大历史桌面：冷启动跳过预读（chatPrefetchIfLight），
// 打开聊天时内存只有 LS 快照。这正是报障人群（#120 #131 大历史 3.4MB）的形态；
// 小历史会被预读提前把权威并进内存，enterChat 首渲即全量、测不到该路径。
const seedLen = await page.evaluate(async () => {
  const K = 'xy-home-v2:default:chat-msgs';
  const arr = JSON.parse(localStorage.getItem(K));
  localStorage.setItem(K, JSON.stringify(arr.slice(0, 1)));
  await window.idbSet('xy-home-v2:default:chat-meta', JSON.stringify({ n: arr.length, b: 9 * 1024 * 1024 }));
  // 权威条数以 IDB 为准（LS 快照可能含低频调度未落 IDB 的尾部）
  const idb = await window.idbGet(K);
  return Array.isArray(idb) ? idb.length : arr.length;
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
const lazyOn = await page.evaluate(() => window.__xyChatLazyLoad === true);
check('S2 懒读生效(冷启动跳过预读=大历史形态)', lazyOn);

// 打开聊天：observer 监听消息区 childList——整窗重画=出现 rm>0 批；增量=纯 add
await page.evaluate(() => {
  window.__obs = [];
  const body = document.getElementById('chat-body');
  new MutationObserver((muts) => {
    muts.forEach(m => window.__obs.push({ rm: m.removedNodes.length, add: m.addedNodes.length }));
  }).observe(body, { childList: true });
  document.querySelector('.app[data-app="chat"]').click();
});
await page.waitForTimeout(3500);
const j1 = await page.evaluate(() => ({
  obs: window.__obs,
  rmTotal: window.__obs.reduce((a, m) => a + m.rm, 0),
  addTotal: window.__obs.reduce((a, m) => a + m.add, 0),
  bubbles: document.querySelectorAll('#chat-body .msg').length
}));
// J1 判据：首个 add（首渲/增量起点）之后不允许再出现 rm 批——首渲可能清理 template
// 静态占位（加载提示等，属正常），报障的跳动是「已渲染消息后被整窗 rm+全量 add」
const firstAddIdx = j1.obs.findIndex(m => m.add > 0);
const rmAfterFirstAdd = firstAddIdx >= 0 ? j1.obs.slice(firstAddIdx + 1).reduce((a, m) => a + m.rm, 0) : j1.rmTotal;
check('J1 首渲后零整窗清空(权威收尾纯增量=不跳动)', rmAfterFirstAdd === 0, JSON.stringify(j1.obs));
check('J2 尾部增量补齐到权威条数(气泡=' + seedLen + ')', j1.bubbles === seedLen && j1.addTotal >= seedLen - 1, JSON.stringify({ bubbles: j1.bubbles, add: j1.addTotal }));

// J3 重开聊天零重建（#220 同窗路径不回归）
await page.evaluate(() => { window.__obs = []; document.getElementById('chat-back').click(); });
await page.waitForTimeout(500);
await page.evaluate(() => { document.querySelector('.app[data-app="chat"]').click(); });
await page.waitForTimeout(1500);
const j3 = await page.evaluate(() => ({
  rmTotal: window.__obs.reduce((a, m) => a + m.rm, 0),
  bubbles: document.querySelectorAll('#chat-body .msg').length
}));
check('J3 重开聊天零重建(#220不回归)', j3.rmTotal === 0 && j3.bubbles === seedLen, JSON.stringify(j3));

// J4 静态锚：放宽判定+增量循环
const js = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
check('J4 静态锚：grown 前缀判定+增量循环在源', js.indexOf('const grown = len - windowRenderedN;') >= 0 && js.indexOf('loadNewerIncremental(len);') >= 0 && js.indexOf('if (grown < 0) return false;') >= 0);

await browser.close();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
