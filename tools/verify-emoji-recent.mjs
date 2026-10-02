// ===== 功能验证脚本：表情面板「⏱最近使用」区（#558） =====
// 用法：node tools/verify-emoji-recent.mjs（需 node 21+ 与本机 Chrome/Edge）
// 功能（用户从小功能清单点选，2026-09-16）：点击表情（发送/插入信纸）即记录，
//   分组条最前出现「⏱最近使用」chip，点开按最近优先展示最近点用的表情（≤EMOJI_RECENT_MAX 张，2026-09-21 由 8 调为 24）。
// 关键口径：
//   · 存「令牌稳定身份」（ccMediaCardIdent，#547：原始大图卡与 @@m: 令牌卡同一短指纹），
//     不存原文——令牌化翻转后身份不变、不复制大 dataURL（防库体积回涨）；
//   · 渲染时按身份回查三池（TA 专属/公用/我的）还原真实 src，解析不到的自动跳过；
//   · 全局根键 emoji-recent（contacts.js EXCLUDE 登记，防 migrateLegacy 误迁 default 删根键）。
// 验证（无头 Chrome 384×752 真实产物）：S 层源码断言 + B 层行为断言——
//   B1 首开无「最近使用」chip；B2 点表情即记录进 emoji-recent（小 JSON）；
//   B3 重开出现 chip（排最前）；B4 点 chip 出最近区且内容=刚点那张；
//   B5 再点第三张后最近区两张、最新在最前；B6 无新增页面错误。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const chk = (name, ok, detail) => { if (ok) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); } };

// ---------- S 层：源码断言 ----------
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const ctSrc = readFileSync(join(root, 'src/js/contacts.js'), 'utf8');
console.log('S 层（源码作用域）');
chk('S1 点击即记录（emojiRecordRecent 进点击链）', chatSrc.includes("try { emojiRecordRecent(src); } catch (e0) {} // #558 最近使用：点击即记录（发送/插入都算）"));
chk('S2 身份回查三池（emojiRecentResolved）', chatSrc.includes('function emojiRecentResolved() {'));
chk('S3 最近 chip 渲染入口（⏱最近使用排最前）', chatSrc.includes("[['__recent__', '⏱最近使用']]"));
chk('S4 最近分组直发路径（不进批量勾选）', chatSrc.includes("renderEmojiGroup('__recent__', rec.srcs, 'ta')"));
chk('S5 emoji-recent 全局根键免迁（contacts.js EXCLUDE）', ctSrc.includes("'emoji-recent',"));
// S6 顺序守卫：my 模式下最近分支必须在「暂无我的表情包」早返回之前，否则我的库为空时
// 点最近 chip 只会看到空态（最近区本可解析 TA 专属/公用池的卡）
const iRecentMine = chatSrc.indexOf("if (myCurGroup === '__recent__' && !myBatchMode) {");
const iEmptyMine = chatSrc.indexOf('暂无我的表情包<br>点击上方「添加」上传');
chk('S6 my 模式最近分支在空态早返回之前（顺序守卫）', iRecentMine > 0 && iEmptyMine > 0 && iRecentMine < iEmptyMine, 'recent@' + iRecentMine + ' empty@' + iEmptyMine);
// #842：颜文字/emoji 两分类各自的最近使用（各存一份全局根键、身份＝原文）
chk('S7 文字分类点击即记录（emojiRecordRecentText 进点击链）', chatSrc.includes('try { emojiRecordRecentText(t); } catch (e0) {}'));
chk('S8 按分类各解析一份（sticker/文字两条身份路径）', chatSrc.includes("emojiCat === 'sticker' ? emojiRecentResolved() : textRecentResolved()") && chatSrc.includes('function textRecentResolved() {'));
chk('S9 两新键全局根键免迁（contacts.js EXCLUDE）', ctSrc.includes("'emoji-recent-kaomoji', 'emoji-recent-emoji',"));

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
const profDir = join(process.env.TEMP || '/tmp', 'mochi-prof-' + Date.now());
const cdpPort = 9750 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profDir,
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

// 种子：专属库 G1 三张小 dataURL 表情（>120 触发定长截断身份、<64KB 不触发令牌化＝测试稳定快速）
const mkSrc = (n) => 'data:image/png;base64,' + 'S' + n + 'A'.repeat(200); // >120 字符＝身份走定长截断，三张首 60 字符互异
const SRC = [mkSrc(1), mkSrc(2), mkSrc(3)];
const seed = await evalJs(`(async () => {
  try { localStorage.setItem('xy-home-v2:cc-scope-migrated', '1'); } catch (e) {} // 排除单联系人迁移干扰
  const g1 = ${JSON.stringify(SRC)};
  window.__v558src = g1;
  const json = JSON.stringify({ text: [], kaomoji: [], emoji: [], sticker: [['G1', g1]], image: [], poke: [], voice: [] });
  window.xyStore(window.activePrefix()).set('cc-groups', json);
  if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite();
  window.xyStore('xy-home-v2').set('emoji-last', JSON.stringify({ mode: 'ta', ta: 'G1', mine: 'G1', pub: '' }));
  try { window.xyStore('xy-home-v2').remove('emoji-recent'); } catch (e) {}
  window.__v558last = '';
  return 'seeded';
})()`);
chk('B0 种子就绪（专属库 G1 三张表情 + 清空最近记录）', seed === 'seeded', String(seed));
await sleep(400);

const openPanel = `window.openEmojiPanelForInsert(function (s) { window.__v558last = s; });`;
const chipsInfo = `(function () {
  return Array.prototype.map.call(document.querySelectorAll('#emoji-panel .emoji-g-chip'), function (c) { return c.textContent; });
})()`;

// B1 首开：G1 三张、无最近 chip
const open1 = await evalJs(`(async () => {
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  const imgs = document.querySelectorAll('#emoji-list img');
  return { imgs: imgs.length, chips: ${chipsInfo} };
})()`);
chk('B1 首开渲染 G1 三张图', open1 && open1.imgs === 3, JSON.stringify(open1));
chk('B1.1 首开无「⏱最近使用」chip（还没点过）', open1 && open1.chips.length && open1.chips[0].indexOf('最近使用') < 0, JSON.stringify(open1 && open1.chips));

// B2 点第 1 张：记录 + 关面板
const click1 = await evalJs(`(async () => {
  const item = document.querySelectorAll('#emoji-list .emoji-item')[0];
  item.click();
  await new Promise(r => setTimeout(r, 300));
  const panel = document.getElementById('emoji-panel');
  const raw = window.xyStore('xy-home-v2').get('emoji-recent') || '';
  let ids = [];
  try { ids = JSON.parse(raw); } catch (e) {}
  return { closed: !!panel.hidden, inserted: window.__v558last === window.__v558src[0], n: Array.isArray(ids) ? ids.length : -1, size: raw.length, id0: Array.isArray(ids) ? String(ids[0]).slice(0, 60) : '' };
})()`);
chk('B2 点表情后面板关闭且信纸收到插入回调', click1 && click1.closed && click1.inserted, JSON.stringify(click1));
chk('B2.1 emoji-recent 已记录 1 条且为小 JSON（<2KB）', click1 && click1.n === 1 && click1.size < 2000, JSON.stringify(click1));
chk('B2.2 记录的是「稳定身份」不是原文（长度远小于 dataURL）', click1 && click1.n === 1 && String(click1.id0).length < 120, JSON.stringify(click1 && click1.id0));
const SRC0 = SRC[0], SRC2 = SRC[2];

// B3 重开：chip 出现且排最前
const open2 = await evalJs(`(async () => {
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  return { chips: ${chipsInfo}, imgs: document.querySelectorAll('#emoji-list img').length };
})()`);
chk('B3 重开分组条最前出现「⏱最近使用」chip', open2 && open2.chips.length && open2.chips[0].indexOf('最近使用') >= 0, JSON.stringify(open2 && open2.chips));
chk('B3.1 仍停在 G1 分组（三张图在位）', open2 && open2.imgs === 3, JSON.stringify(open2 && open2.imgs));

// B4 点最近 chip：最近区渲染且内容=刚点那张
const rec1 = await evalJs(`(async () => {
  const chip = document.querySelectorAll('#emoji-panel .emoji-g-chip')[0];
  chip.click();
  await new Promise(r => setTimeout(r, 900));
  const imgs = document.querySelectorAll('#emoji-list img');
  return { n: imgs.length, first: imgs.length ? (imgs[0].dataset.src || imgs[0].getAttribute('src') || '') : '' };
})()`);
chk('B4 最近区渲染 1 张且就是刚点的那张', rec1 && rec1.n === 1 && rec1.first === SRC0, JSON.stringify({ n: rec1 && rec1.n, hit: rec1 && rec1.first === SRC0 }));

// B5 回 G1 点第 3 张 → 最近区两张、最新在最前
await evalJs(`(function () {
  window.closeEmojiPanelForInsert();
  window.openEmojiPanelForInsert(function (s) { window.__v558last = s; });
  return 1;
})()`);
await sleep(900);
const click3 = await evalJs(`(async () => {
  // 上次停在最近区（chip 点击已写进分组偏好），重开后先切回 G1 分组再点第三张
  const gchip = Array.prototype.filter.call(document.querySelectorAll('#emoji-panel .emoji-g-chip'), function (c) { return c.textContent.indexOf('G1') === 0; })[0];
  if (gchip) gchip.click();
  await new Promise(r => setTimeout(r, 700));
  const items = document.querySelectorAll('#emoji-list .emoji-item');
  if (items.length < 3) return { err: 'items=' + items.length };
  items[2].click();
  await new Promise(r => setTimeout(r, 300));
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  const chip = document.querySelectorAll('#emoji-panel .emoji-g-chip')[0];
  chip.click();
  await new Promise(r => setTimeout(r, 900));
  const imgs = document.querySelectorAll('#emoji-list img');
  return {
    n: imgs.length,
    first: imgs.length ? (imgs[0].dataset.src || imgs[0].getAttribute('src') || '') : '',
    second: imgs.length > 1 ? (imgs[1].dataset.src || imgs[1].getAttribute('src') || '') : ''
  };
})()`);
chk('B5 再点第 3 张后最近区两张', click3 && click3.n === 2, JSON.stringify(click3 && { n: click3.n }));
chk('B5.1 最新点用的排最前（第 3 张在首位）', click3 && click3.first === SRC2, JSON.stringify({ first: click3 && String(click3.first).slice(0, 40) }));
chk('B5.2 次序正确（第 1 张在第二位）', click3 && click3.second === SRC0, JSON.stringify({ second: click3 && String(click3.second).slice(0, 40) }));

// B7 真实大库路径：>64KB 大图卡会被令牌化（dataURL→@@m:token），记录的身份必须跨翻转仍能回查
//（若身份按原文算：翻转后最近区解析不到该卡＝张数掉一张，功能在大库设备上等于半失效）
const seedBig = await evalJs(`(async () => {
  const big = 'data:image/png;base64,' + ('B'.repeat(90000)); // >64KB 触发 ccTokenizeGiantMedia
  window.__v558big = big;
  const json = JSON.stringify({ text: [], kaomoji: [], emoji: [], sticker: [['G1', ${JSON.stringify(SRC)}], ['G2', [big]]], image: [], poke: [], voice: [] });
  window.xyStore(window.activePrefix()).set('cc-groups', json);
  if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite();
  return 'seeded';
})()`);
chk('B7 大图组种子就绪（G2 一张 >64KB）', seedBig === 'seeded', String(seedBig));
await sleep(600);

// 外部写入不保证面板自动重绘：先关再开按新池渲染，再取 G2 chip 点大图
//（注意：插信纸模式对「非 data: 源」按既有规则拒绝，故这里断言的是「点击被记录」而非插入回调——
//  令牌化后池视图首卡是 @@m: 令牌，点它走的是聊天发送路径）
const openG2 = await evalJs(`(async () => {
  window.closeEmojiPanelForInsert();
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  const c = Array.prototype.filter.call(document.querySelectorAll('#emoji-panel .emoji-g-chip'), function (x) { return x.textContent.indexOf('G2') === 0; })[0];
  if (!c) return { err: 'no-g2-chip' };
  c.click();
  await new Promise(r => setTimeout(r, 800));
  const items = document.querySelectorAll('#emoji-list .emoji-item');
  if (!items.length) return { err: 'no-item' };
  items[0].click();
  await new Promise(r => setTimeout(r, 500));
  let ids = [];
  try { ids = JSON.parse(window.xyStore('xy-home-v2').get('emoji-recent') || '[]'); } catch (e) {}
  return { n: Array.isArray(ids) ? ids.length : -1, id0: String(ids[0] || '').slice(0, 20) };
})()`);
chk('B7.1 点大图即记录（身份为内容短指纹 M 前缀，非原文）', openG2 && openG2.n === 3 && openG2.id0.indexOf('M') === 0, JSON.stringify(openG2));

let flipped = false;
for (let i = 0; i < 40; i++) {
  await sleep(400);
  const first = await evalJs(`(() => { const g = (window.getScopedGroups && window.getScopedGroups('sticker','own')) || []; const hit = g.filter(function (x) { return x[0] === 'G2'; })[0]; return hit && hit[1].length ? String(hit[1][0]).slice(0, 4) : ''; })()`);
  if (first === '@@m:') { flipped = true; break; }
}
chk('B7.2 令牌化翻转已发生（G2 首卡变 @@m: 令牌）', flipped);

const recAfterTok = await evalJs(`(async () => {
  window.closeEmojiPanelForInsert();
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  const chips = document.querySelectorAll('#emoji-panel .emoji-g-chip');
  if (!chips.length) return { err: 'no-chips' };
  const chip0 = chips[0].textContent;
  chips[0].click();
  await new Promise(r => setTimeout(r, 900));
  const imgs = document.querySelectorAll('#emoji-list img');
  const raw = window.xyStore('xy-home-v2').get('emoji-recent') || '';
  let ids = [];
  try { ids = JSON.parse(raw); } catch (e) {}
  return { n: imgs.length, chip0: chip0, ids: Array.isArray(ids) ? ids.length : -1, size: raw.length };
})()`);
chk('B7.2b 最近 chip 仍排最前（可解析）', recAfterTok && String(recAfterTok.chip0 || '').indexOf('最近使用') >= 0, JSON.stringify(recAfterTok && recAfterTok.chip0));
chk('B7.3 翻转后最近区仍解析到 3 张（令牌卡身份回查成功）', recAfterTok && recAfterTok.n === 3 && String(recAfterTok.chip0 || '').indexOf('最近使用') >= 0, JSON.stringify(recAfterTok));
chk('B7.4 记录仍为 3 条小身份串（未因大图存原文而膨胀）', recAfterTok && recAfterTok.ids === 3 && recAfterTok.size < 2000, JSON.stringify(recAfterTok));

// ================= T 组（#842）：颜文字 / emoji 各自的「最近使用」 =================
// 补种子：专属库加 kaomoji/emoji 两类文字分组
await evalJs(`(async () => {
  const json = JSON.stringify({ text: [], sticker: [['G1', ${JSON.stringify(SRC)}], ['G2', ['data:image/png;base64,' + 'B'.repeat(90000)]]], image: [], poke: [], voice: [],
    kaomoji: [['开颜', ['(＝^ω^＝)', '(￣▽￣)~*']]], emoji: [['常用E', ['😂', '🥰']]] });
  window.xyStore(window.activePrefix()).set('cc-groups', json);
  if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite();
  try { window.xyStore('xy-home-v2').remove('emoji-recent-kaomoji'); } catch (e) {}
  try { window.xyStore('xy-home-v2').remove('emoji-recent-emoji'); } catch (e) {}
  return 'seeded';
})()`);
await sleep(700);
const catChips = `(Array.prototype.map.call(document.querySelectorAll('#emoji-panel .emoji-g-chip'), function (c) { return c.textContent; }))`;

const t1 = await evalJs(`(async () => {
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  const cat = document.querySelector('.emoji-cats .emoji-cat-chip[data-ecat="kaomoji"]');
  cat.click();
  await new Promise(r => setTimeout(r, 700));
  const chips0 = ${catChips};
  const items = document.querySelectorAll('#emoji-list .emoji-text-item');
  if (!items.length) return { err: 'no-text-item', chips0 };
  items[0].click();
  await new Promise(r => setTimeout(r, 400));
  return { chips0, ids: JSON.parse(window.xyStore('xy-home-v2').get('emoji-recent-kaomoji') || '[]'), first: (items[0].textContent || '').trim() };
})()`);
chk('T1 颜文字分类首开无「最近使用」chip', t1 && String((t1.chips0 || [])[0] || '').indexOf('最近使用') < 0, JSON.stringify(t1 && t1.chips0));
chk('T2 点颜文字即记录进 emoji-recent-kaomoji（身份＝原文）', !!(t1 && t1.ids && t1.ids.length === 1 && t1.ids[0] === t1.first), JSON.stringify(t1 && { ids: t1.ids, first: t1.first }));

const t2 = await evalJs(`(async () => {
  window.closeEmojiPanelForInsert();
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  const cat = document.querySelector('.emoji-cats .emoji-cat-chip[data-ecat="kaomoji"]');
  cat.click();
  await new Promise(r => setTimeout(r, 700));
  const chips = ${catChips};
  const chip = document.querySelectorAll('#emoji-panel .emoji-g-chip')[0];
  chip.click();
  await new Promise(r => setTimeout(r, 700));
  const items = Array.prototype.map.call(document.querySelectorAll('#emoji-list .emoji-text-item'), function (d) { return (d.textContent || '').trim(); });
  return { chip0: chips[0], items: items };
})()`);
chk('T3 重开颜文字分类：最近 chip 排最前', t2 && String(t2.chip0 || '').indexOf('最近使用') >= 0, JSON.stringify(t2 && t2.chip0));
chk('T4 点最近 chip＝文字网格只渲染刚点那张', !!(t2 && t2.items.length === 1 && t2.items[0] === '(＝^ω^＝)'), JSON.stringify(t2));

const t3 = await evalJs(`(async () => {
  window.closeEmojiPanelForInsert();
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  document.querySelector('.emoji-cats .emoji-cat-chip[data-ecat="emoji"]').click();
  await new Promise(r => setTimeout(r, 700));
  const chips0 = ${catChips};
  const items = document.querySelectorAll('#emoji-list .emoji-text-item');
  if (!items.length) return { err: 'no-item', chips0 };
  items[1].click();
  await new Promise(r => setTimeout(r, 400));
  return { chips0, eIds: JSON.parse(window.xyStore('xy-home-v2').get('emoji-recent-emoji') || '[]'), kIds: JSON.parse(window.xyStore('xy-home-v2').get('emoji-recent-kaomoji') || '[]'), sIds: JSON.parse(window.xyStore('xy-home-v2').get('emoji-recent') || '[]') };
})()`);
chk('T5 emoji 分类独立：切过去时还没有自己的最近 chip', t3 && String((t3.chips0 || [])[0] || '').indexOf('最近使用') < 0, JSON.stringify(t3 && t3.chips0));
chk('T5.1 点 emoji 记录进 emoji-recent-emoji（🥰）', !!(t3 && t3.eIds && t3.eIds.length === 1 && t3.eIds[0] === '🥰'), JSON.stringify(t3 && t3.eIds));
chk('T5.2 两分类互不串（kaomoji 键仍是那 1 条）', !!(t3 && t3.kIds && t3.kIds.length === 1 && t3.kIds[0] === '(＝^ω^＝)'), JSON.stringify(t3 && t3.kIds));
chk('T5.3 文字条目不混进表情包根键 emoji-recent', !!(t3 && Array.isArray(t3.sIds) && t3.sIds.filter(x => x === '🥰' || x === '(＝^ω^＝)').length === 0), JSON.stringify(t3 && t3.sIds));

// T6 次序与去重（文字分类同 #558 图片口径）：点第二张 → 再点同一张一次 → 最近区两张、最新在最前
//（插信纸模式点一张会关面板，故每次点击之间重开；分类靠 emojiCat 模块态留在颜文字）
const t6pick = `
  window.closeEmojiPanelForInsert();
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  document.querySelector('.emoji-cats .emoji-cat-chip[data-ecat="kaomoji"]').click();
  await new Promise(r => setTimeout(r, 600));
  const g = Array.prototype.filter.call(document.querySelectorAll('#emoji-panel .emoji-g-chip'), function (c) { return c.textContent.indexOf('开颜') === 0; })[0];
  if (!g) return { err: 'no-group-chip' };
  g.click();
  await new Promise(r => setTimeout(r, 600));
  const items = document.querySelectorAll('#emoji-list .emoji-text-item');
  if (items.length < 2) return { err: 'items=' + items.length };
  items[1].click();`;
await evalJs(`(async () => {${t6pick} return 1; })()`);
await sleep(400);
await evalJs(`(async () => {${t6pick} return 1; })()`); // 再点同一张：只前移，不重复占位
await sleep(400);
const t6 = await evalJs(`(async () => {
  window.closeEmojiPanelForInsert();
  ${openPanel}
  await new Promise(r => setTimeout(r, 900));
  document.querySelector('.emoji-cats .emoji-cat-chip[data-ecat="kaomoji"]').click();
  await new Promise(r => setTimeout(r, 600));
  const chip = document.querySelectorAll('#emoji-panel .emoji-g-chip')[0];
  if (!chip || chip.textContent.indexOf('最近使用') < 0) return { err: 'chip0=' + (chip ? chip.textContent : 'none') };
  chip.click();
  await new Promise(r => setTimeout(r, 700));
  return { rec: Array.prototype.map.call(document.querySelectorAll('#emoji-list .emoji-text-item'), function (d) { return (d.textContent || '').trim(); }) };
})()`);
chk('T6 颜文字最近区两张、最新点的前移且重复点不占两位', !!(t6 && t6.rec && t6.rec.length === 2 && t6.rec[0] === '(￣▽￣)~*' && t6.rec[1] === '(＝^ω^＝)'), JSON.stringify(t6));

const errs0 = (await evalJs(`(window.__jsErrors || []).length`)) || 0;
const errs = await evalJs(`(window.__jsErrors || []).length`);
chk('B6 无新增页面错误', errs - errs0 === 0, 'before=' + errs0 + ' after=' + errs);

try { chrome.kill(); } catch (e) {}
await sleep(900);
try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {} // 退出即清 profile：单次约 40~50MB，累积会把盘写满（2026-09-16 实测 ENOSPC）
server.close();
console.log('');
console.log('==== verify-emoji-recent（#558）：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail ? 1 : 0);
