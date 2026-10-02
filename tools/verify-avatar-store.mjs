// ===== 验证脚本：头像换不上 / 聊天页读旧头像（localStorage 写失败遮蔽 + 渲染缓存残留） =====
// 用户场景：红米 Note 11T Pro + Edge，「头像互动」换头像后聊天里没反应。
// 根因（v3.16.x 修复）：
//  ① xyStore.get 原优先读 localStorage——配额满/写失败时 setItem 静默失败，localStorage 残留
//     旧值永久遮蔽 memoryCache/IDB 里的新值（刷新/回前台重刷都不恢复）。修复：get 改内存缓存优先。
//  ② 双开上下文（PWA+标签页）另一侧写入 localStorage 的新值会被本侧 memoryCache 旧值遮蔽。
//     修复：storage 事件到达时删除对应内存缓存键。
//  ③ 批量渲染缓存 avatarBatchCache 异常残留会让 refreshChatAvatars 读旧缓存。修复：刷新前清缓存。
// 用法：node tools/verify-avatar-store.mjs（需 node build.mjs 已生成最新 index.html）
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const { chromium } = await import('playwright');
let browser = null;
try {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const fs = await import('node:fs');
  const exe = fs.existsSync(edgePath) ? edgePath : (fs.existsSync(chromePath) ? chromePath : null);
  // 用本机 Edge/Chrome 内核（与用户设备同 Blink 引擎）；无则退回 Playwright 自带
  browser = exe
    ? await chromium.launch({ executablePath: exe, headless: true })
    : await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mochiDataReady === true, null, { timeout: 30000 }).catch(() => {});
  await sleep(500);

  // ===== 场景 A：localStorage 配额满 → 换头像 → 读与渲染都必须取到新值 =====
  const a = await page.evaluate(() => {
    const out = {};
    try {
      const S = window.activeStore();
      const prefix = window.activePrefix();
      out.prefix = prefix;
      // 0) 先写一个「旧头像」并确认同步进 localStorage
      S.set('cs-avatar-partner', 'OLD_AV');
      out.lsBefore = localStorage.getItem(prefix + ':cs-avatar-partner');
      // 1) 填满 localStorage，模拟重度数据用户配额耗尽
      const junk = 'x'.repeat(1024);
      let filled = 0;
      try { for (;;) { localStorage.setItem('__fill_' + (filled++), junk); } } catch (e) {}
      out.filledKeys = filled;
      // 2) 写入「新头像」（比旧值大得多）——配额满时 setItem 抛 QuotaExceededError 被吞，
      //    只进内存缓存 + IndexedDB，localStorage 残留旧值
      const newAv = 'NEW_AV_' + 'x'.repeat(4096);
      S.set('cs-avatar-partner', newAv);
      out.lsAfter = localStorage.getItem(prefix + ':cs-avatar-partner'); // 应仍为旧值（写失败）
      out.got = S.get('cs-avatar-partner'); // 修复后必须返回新值
      out.newAvLen = newAv.length;
      // 3) 聊天页渲染：refreshChatAvatars 后顶部头像必须是新图
      window.refreshChatAvatars();
      const avEl = document.getElementById('chat-partner-av');
      const img = avEl && avEl.querySelector('img');
      out.avRendered = img ? img.getAttribute('src') : null;
      // 4) 清理填充键（还原现场）
      for (let i = 0; i < filled; i++) { try { localStorage.removeItem('__fill_' + i); } catch (e) {} }
      out.cleaned = true;
    } catch (e) { out.error = String(e); }
    return out;
  });
  check('A1 旧头像已写入 localStorage', a.lsBefore === 'OLD_AV', JSON.stringify(a.lsBefore));
  check('A2 配额已被填满(写失败路径真实存在)', a.filledKeys > 100, a.filledKeys + ' keys');
  check('A3 localStorage 仍残留旧值(证明写失败)', a.lsAfter === 'OLD_AV', JSON.stringify(a.lsAfter));
  check('A4 读接口返回新头像(内存缓存优先)', a.got === 'NEW_AV_' + 'x'.repeat(4096), 'len=' + a.newAvLen);
  check('A5 聊天页顶部头像渲染新图', a.avRendered === 'NEW_AV_' + 'x'.repeat(4096), 'len=' + (a.avRendered || '').length);

  // ===== 场景 B：storage 事件(另一上下文写入)必须清除内存缓存旧值 =====
  const b = await page.evaluate(() => {
    const out = {};
    try {
      const S = window.activeStore();
      const prefix = window.activePrefix();
      S.set('cs-avatar-user', 'USER_A');
      out.before = S.get('cs-avatar-user');
      // 模拟另一上下文（PWA + 标签页双开）写入了新值到 localStorage
      localStorage.setItem(prefix + ':cs-avatar-user', 'USER_B');
      // 触发 storage 事件（同上下文不自动触发，手动派发模拟）
      window.dispatchEvent(new StorageEvent('storage', { key: prefix + ':cs-avatar-user' }));
      out.after = S.get('cs-avatar-user');
    } catch (e) { out.error = String(e); }
    return out;
  });
  check('B1 另一上下文新值写入后读回新值(缓存已失效)', b.after === 'USER_B', JSON.stringify({ before: b.before, after: b.after }));

  // ===== 场景 C：聊天页真实头像链路冒烟（正常路径不回归） =====
  const c = await page.evaluate(() => {
    const out = {};
    try {
      const S = window.activeStore();
      const prefix = window.activePrefix();
      const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      S.set('cs-avatar-partner', tinyPng);
      out.lsSynced = localStorage.getItem(prefix + ':cs-avatar-partner') === tinyPng;
      window.refreshChatAvatars();
      const img = document.querySelector('#chat-partner-av img');
      out.avOk = !!(img && img.getAttribute('src') === tinyPng);
      // 消息气泡头像也跟随
      S.set('cs-avatar-user', tinyPng);
      window.refreshChatAvatars();
      out.msgOutOk = !!(document.querySelector('.msg-out .msg-av img'));
    } catch (e) { out.error = String(e); }
    return out;
  });
  check('C1 正常路径小头像同步 localStorage', c.lsSynced === true, JSON.stringify(c.lsSynced));
  check('C2 刷新后聊天页渲染新头像', c.avOk === true, JSON.stringify(c.avOk));
  check('C3 无页面级 JS 异常', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
} catch (e) {
  console.error('脚本异常：', e);
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
} finally {
  server.close();
}

const fails = results.filter((r) => !r.ok);
console.log('\n=== avatar-store 验证 ' + (fails.length ? fails.length + ' 项失败' : results.length + '/' + results.length + ' 全绿') + ' ===');
if (fails.length) process.exit(1);
