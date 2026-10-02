// ===== 回归验证：表情包/图片/语音撤回（v3.16.x 修复） =====
// 背景：renderMsg 里 rec.retracted 分支排在 sticker/image/voice/parts 类型分支之后，
// 撤回表情包后任何全量重渲染（renderWindow/loadMsgs/切会话/reload）都会命中类型分支，
// 把表情包 img 重新渲染出来 → 撤回失效（红米 K80 Chrome 反馈）。
// 本脚本走真实链路：存储注入 → reload 真实加载渲染 → UI 点击撤回 → reload 重渲染
// → 断言仍显示「撤回了一条消息」且无 img；再验证展开查看原文、TA 撤回。
// 用法：node tools/verify-sticker-retract.mjs   （BROWSER=webkit 可选）
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// VERIFY_ROOT：可选，指向隔离构建目录（用于「修复前 RED / 隔离副本 GREEN」对照）
const root = process.env.VERIFY_ROOT ? normalize(process.env.VERIFY_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
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

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const engine = process.env.BROWSER || 'chromium';
const channel = process.env.CHANNEL || undefined; // 例如 msedge / chrome（用系统浏览器）
const { chromium, webkit } = await import('playwright');
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch(channel ? { channel } : undefined);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function boot() {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate('!!window.__mochiDataReady')) break;
    await sleep(300);
  }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(700);
  await page.evaluate("(function(){if(window.enterChat) window.enterChat();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
  await sleep(500);
}

// 写入测试聊天记录（双写 IDB + LS）
async function seedChat(arr) {
  await page.evaluate(`(async function(){
    const key = window.activePrefix() + ':chat-msgs';
    const raw = JSON.stringify(${JSON.stringify(arr)});
    if (window.idbSet) await window.idbSet(key, raw);
    try { localStorage.setItem(key, raw); } catch (e) {}
    return true;
  })()`);
  await sleep(600); // 等 saveMsgs 防抖窗口过去，避免内存数据覆盖
}

const msgsArr = [
  { side: 'out', text: PNG, type: 'sticker', ts: Date.now() - 5000 },          // 0 用户表情包
  { side: 'in', text: PNG, type: 'sticker', initiative: true, ts: Date.now() - 3000 } // 1 TA 表情包
];
const msgsArrTaRetracted = [
  { side: 'out', text: PNG, type: 'sticker', ts: Date.now() - 5000 },
  { side: 'in', text: PNG, type: 'sticker', initiative: true, ts: Date.now() - 3000, retracted: true, orig: '<img class="msg-img msg-img-sm" src="' + PNG + '">' }
];

await boot();
await seedChat(msgsArr);
await page.reload({ waitUntil: 'load', timeout: 25000 });
for (let i = 0; i < 40; i++) {
  if (await page.evaluate('!!window.__mochiDataReady')) break;
  await sleep(300);
}
await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(700);
await page.evaluate("(function(){if(window.enterChat) window.enterChat();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(600);

// ---- T1：未撤回前，表情包正常显示 ----
const t1 = JSON.parse(await page.evaluate(`(function(){
  const m0 = document.querySelector('#page-chat .msg[data-idx="0"] .msg-bubble');
  const m1 = document.querySelector('#page-chat .msg[data-idx="1"] .msg-bubble');
  return JSON.stringify({ m0img: !!m0.querySelector('img.msg-img-sm'), m1img: !!m1.querySelector('img.msg-img-sm') });
})()`));
check('T1 未撤回：用户表情包正常显示', t1.m0img === true);
check('T1 未撤回：TA 表情包正常显示', t1.m1img === true);

// ---- T2：UI 点击用户表情包 → 操作面板 → 撤回（实时路径） ----
const t2 = await page.evaluate(`(function(){
  const b = document.querySelector('#page-chat .msg[data-idx="0"] .msg-bubble');
  if (!b) return 'no-bubble';
  b.click(); // 打开操作面板
  return true;
})()`);
await sleep(300);
const panelVisible = await page.evaluate("(function(){var m=document.getElementById('msg-actions');return !!m && !m.hidden;})()");
check('T2 点击表情包后操作面板出现', t2 === true && panelVisible === true);
if (t2 === true && panelVisible === true) {
  const retractBtn = await page.evaluate("(function(){var b=document.querySelector('#msg-actions .ma-btn[data-act=\"retract\"]');return !!b && !b.hidden;})()");
  check('T2 撤回按钮可见（.ma-mine，out 侧）', retractBtn === true);
  if (retractBtn) {
    await page.evaluate("(function(){var b=document.querySelector('#msg-actions .ma-btn[data-act=\"retract\"]');b.click();return true;})()");
    await sleep(300);
  }
}
const t2b = JSON.parse(await page.evaluate(`(function(){
  const m0 = document.querySelector('#page-chat .msg[data-idx="0"] .msg-bubble');
  return JSON.stringify({ hasImg: !!m0.querySelector('img'), txt: m0.textContent, clickable: typeof m0.onclick === 'function' });
})()`));
check('T2 实时撤回：bubble 立即变为「我撤回了一条消息」且无 img', t2b.hasImg === false && t2b.txt.indexOf('我撤回了一条消息') >= 0, t2b.txt);

// ---- T3：点击撤回文案展开原文（查看撤回的消息），再点击收回 ----
// 注意 bindToggle 是 toggle：先确保从收起态（showing!=="1"）出发再断言
const t3 = await page.evaluate(`(function(){
  const m0 = document.querySelector('#page-chat .msg[data-idx="0"] .msg-bubble');
  if (m0.dataset.showing === '1') m0.click(); // 重置为收起态
  const startCollapsed = !m0.querySelector('img') && m0.textContent.indexOf('我撤回了一条消息') >= 0;
  m0.click(); // 第一次点击：展开查看原文
  const expanded = m0.dataset.showing === '1' && !!m0.querySelector('img.msg-img-sm');
  m0.click(); // 第二次点击：收回
  const collapsed = m0.dataset.showing !== '1' && !m0.querySelector('img') && m0.textContent.indexOf('我撤回了一条消息') >= 0;
  return JSON.stringify({ startCollapsed, expanded, collapsed });
})()`);
const j3 = JSON.parse(t3);
check('T3 撤回态初始为收起（无 img）', j3.startCollapsed === true);
check('T3 点击展开可查看原文表情包', j3.expanded === true);
check('T3 再点击收回恢复撤回态', j3.collapsed === true);

// ---- T4：【核心回归】撤回后 reload（全量重加载渲染）→ 表情包不得复活 ----
await sleep(900); // 等 saveMsgs 防抖把 retracted 落盘 IDB
await page.reload({ waitUntil: 'load', timeout: 25000 });
for (let i = 0; i < 40; i++) {
  if (await page.evaluate('!!window.__mochiDataReady')) break;
  await sleep(300);
}
await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(700);
await page.evaluate("(function(){if(window.enterChat) window.enterChat();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(600);
const t4 = JSON.parse(await page.evaluate(`(function(){
  const m0 = document.querySelector('#page-chat .msg[data-idx="0"] .msg-bubble');
  const m1 = document.querySelector('#page-chat .msg[data-idx="1"] .msg-bubble');
  return JSON.stringify({ m0img: !!m0.querySelector('img'), m0txt: m0.textContent, m1img: !!m1.querySelector('img'), m1txt: m1.textContent });
})()`));
check('T4 【核心】reload 重渲染后撤回消息仍无 img、显示撤回文案', t4.m0img === false && t4.m0txt.indexOf('我撤回了一条消息') >= 0, t4.m0txt);
check('T4 对照组：TA 未撤回表情包仍正常显示', t4.m1img === true && t4.m1txt.indexOf('撤回了一条消息') < 0);

// ---- T5：TA 撤回的表情包（存储即带 retracted）→ reload 后显示「对方撤回了一条消息」 ----
await seedChat(msgsArrTaRetracted);
await page.reload({ waitUntil: 'load', timeout: 25000 });
for (let i = 0; i < 40; i++) {
  if (await page.evaluate('!!window.__mochiDataReady')) break;
  await sleep(300);
}
await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(700);
await page.evaluate("(function(){if(window.enterChat) window.enterChat();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(600);
const t5 = JSON.parse(await page.evaluate(`(function(){
  const m0 = document.querySelector('#page-chat .msg[data-idx="0"] .msg-bubble');
  const m1 = document.querySelector('#page-chat .msg[data-idx="1"] .msg-bubble');
  return JSON.stringify({ m0img: !!m0.querySelector('img'), m1img: !!m1.querySelector('img'), m1txt: m1.textContent });
})()`));
check('T5 TA 撤回表情包：reload 后无 img、显示「对方撤回了一条消息」', t5.m1img === false && t5.m1txt.indexOf('对方撤回了一条消息') >= 0, t5.m1txt);
check('T5 对照：用户未撤回表情包仍正常', t5.m0img === true);

await browser.close();
server.close();
const fails = results.filter(r => !r.ok);
console.log('\n===== 汇总：' + (results.length - fails.length) + '/' + results.length + ' 通过 =====');
if (pageErrors.length) console.log('  [pageerror] ' + pageErrors.join(' | ').slice(0, 500));
process.exit(fails.length ? 1 : 0);
