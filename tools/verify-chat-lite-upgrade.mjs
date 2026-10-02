// ===== 验证 #245：打开聊天「大历史 LS 精简快照」不再整窗清空重画（真机闪屏+弹一下复发） =====
// 形态：大历史桌面 LS 兜底快照被 liteSnapArray 剥负载（img/voice→'' + _lsLite），打开聊天
// 先渲精简快照 → IDB 权威读回 → 旧逻辑 lite 残留扫描直接 return false=整窗清空重画=肉眼
// 闪+弹（#241 只覆盖「快照缺尾部、无残留」形态）。修复：残留原位换节点（rm1+add1/条）。
// 用法：node tools/verify-chat-lite-upgrade.mjs（需先 node build.mjs）
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

// 种 4 条文本 + 1 条图片消息（权威 IDB 全量；图片用 1x1 dataURL）
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const seeded = await page.evaluate(async (img) => {
  const K = 'xy-home-v2:default:chat-msgs';
  const now = Date.now();
  const full = [
    { ts: now - 500000, side: 'in', text: '残留验证甲' },
    { ts: now - 400000, side: 'out', text: '残留验证乙' },
    { ts: now - 300000, side: 'in', type: 'image', text: img },
    { ts: now - 200000, side: 'out', text: '残留验证丙' },
    { ts: now - 100000, side: 'in', text: '残留验证丁' },
  ];
  // LS 兜底快照＝liteSnapArray 同构：图片负载剥空 + _lsLite 标记
  const lite = full.map((m) => (m.type === 'image' ? Object.assign({}, m, { text: '', _lsLite: 1 }) : m));
  localStorage.setItem(K, JSON.stringify(lite));
  await window.idbSet(K, full);
  // 账本 b 吹到懒读门槛上：冷启动跳过预读，首渲只可能是 LS 精简快照
  await window.idbSet('xy-home-v2:default:chat-meta', JSON.stringify({ n: full.length, b: 9 * 1024 * 1024 }));
  return full.length;
}, IMG);
check('S1 种4文本+1图片(权威IDB全量)+LS精简快照+懒读形态', seeded === 5, 'n=' + seeded);

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
const lazyOn = await page.evaluate(() => window.__xyChatLazyLoad === true);
check('S2 懒读生效(冷启动跳过预读=大历史形态)', lazyOn);

// S3 启动期新增（签到/TA 主动消息同型：权威读回前 chatAddIn 已进 msgs）——
// 旧逻辑此形态下 LS 快照解析被 !msgs.length 门跳过=首渲缺历史+权威合并后屏上重复
await page.evaluate(() => { window.chatAddIn('启动期新增甲'); window.chatAddIn('启动期新增乙'); });
// S3b 等 IDB 探测层就绪（存量 #90 冷启动误判形态：早期 idbGet/HasKey 均不可信——
// 该层问题登记在 TASKS 由数据层口收口；本脚本剥离它以确定性验证 #245 修复逻辑）
await page.waitForFunction(async () => {
  const K = 'xy-home-v2:default:chat-msgs';
  if (window.idbHydrateKey) { try { await window.idbHydrateKey(K); } catch (e) {} }
  try { return (await window.idbHasKey(K)) === true; } catch (e) { return false; }
}, { timeout: 15000, polling: 500 });
await page.waitForTimeout(600);

// 打开聊天：observer 监听消息区 childList。旧逻辑整窗重画=rm≈全部气泡(先5条精简再全量5条,rm5+add5)；
// 修复后=首渲 add7（精简历史+启动期新增）+ 原位升级 rm1+add1（只有图片那条换节点）
await page.evaluate(() => {
  window.__obs = [];
  const body = document.getElementById('chat-body');
  new MutationObserver((muts) => {
    muts.forEach(m => window.__obs.push({ rm: m.removedNodes.length, add: m.addedNodes.length }));
  }).observe(body, { childList: true });
  document.querySelector('.app[data-app="chat"]').click();
});
await page.waitForTimeout(8000); // 覆盖 #90 误判→scheduleIdbRetry(5s)→真读回的完整链
const j1 = await page.evaluate(() => ({
  obs: window.__obs,
  rmTotal: window.__obs.reduce((a, m) => a + m.rm, 0),
  bubbles: document.querySelectorAll('#chat-body .msg').length
}));
// J1 判据：首渲（首个 add 批，含清掉打开前启动消息的预挂节点）之后不允许再出现
// rm≥5 的整窗清空批；原位升级只产生 rm1+add1（图片那条），启动期消息追加只 add 不 rm
const firstAddIdx = j1.obs.findIndex(m => m.add > 0);
const afterFirst = firstAddIdx >= 0 ? j1.obs.slice(firstAddIdx + 1) : [];
const bigRm = afterFirst.filter(m => m.rm >= 5);
check('J1 首渲后无整窗清空重画(旧路径权威收尾 rm≥5 批,修复后零批)', bigRm.length === 0, JSON.stringify(j1.obs));
check('J2 残留图片原位升级(rm 批恰为 rm1+add1)', j1.obs.some(m => m.rm === 1 && m.add === 1), JSON.stringify(j1.obs));

const imgOk = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-body .msg');
  let ok = false;
  msgs.forEach(el => { const im = el.querySelector('img.msg-img'); if (im && (im.getAttribute('src') || '').indexOf('data:image/png') === 0) ok = true; });
  return ok;
});
check('J3 残留图片原位升级为真实图片(dataURL 在位)', imgOk);

// J3b 种子消息零重复（旧逻辑「同一消息在屏上出现两份」不复发——按种子文本计数）
const dupCnt = await page.evaluate(() => {
  const cnt = { '残留验证丁': 0, '启动期新增甲': 0, '启动期新增乙': 0 };
  document.querySelectorAll('#chat-body .msg').forEach(el => {
    const t = el.textContent || '';
    Object.keys(cnt).forEach(k => { if (t.indexOf(k) >= 0) cnt[k]++; });
  });
  return cnt;
});
check('J3b 屏上种子消息零重复(权威合并不双写)', Object.values(dupCnt).every(v => v <= 1), JSON.stringify(dupCnt));

// J4 滚动贴底（原位升级后未弹离底部）
const atBottom = await page.evaluate(() => {
  const b = document.getElementById('chat-body');
  return b.scrollHeight - b.scrollTop - b.clientHeight < 120;
});
check('J4 升级后仍贴底(不弹)', atBottom);

// J5 重开聊天零重建（#220/#241 不回归）
await page.evaluate(() => { window.__obs = []; document.getElementById('chat-back').click(); });
await page.waitForTimeout(500);
await page.evaluate(() => { document.querySelector('.app[data-app="chat"]').click(); });
await page.waitForTimeout(1500);
const j5 = await page.evaluate(() => ({
  rmTotal: window.__obs.reduce((a, m) => a + m.rm, 0),
  bubbles: document.querySelectorAll('#chat-body .msg').length
}));
check('J5 重开聊天零重建(#220/#241不回归)', j5.rmTotal === 0 && j5.bubbles >= 7, JSON.stringify(j5));

// J6 静态锚：渲染期残留登记+原位 replaceChild+账本矛盾守卫在源
const js = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
check('J6 静态锚：windowRenderedLite 登记+原位 replaceChild+账本守卫在源',
  js.indexOf('if (_liteIdx.length) windowRenderedLite = _liteIdx;') >= 0 &&
  js.indexOf('old.parentNode.replaceChild(nu, old);') >= 0 &&
  js.indexOf('const liteUpgrade = (Array.isArray(windowRenderedLite) ? windowRenderedLite : [])') >= 0 &&
  js.indexOf('账本矛盾守卫') >= 0);

await browser.close();
server.close();
const pass = results.filter(Boolean).length;
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
