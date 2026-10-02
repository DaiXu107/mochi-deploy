// ===== 回归验证：#406 后台来电 LS 配额满 → 挂起丢失，回前台无弹窗也无来电系统消息 =====
// 背景（FIX-REGRESSION #406）：OPPO Reno14 Edge 报障：浏览器后台显示「联系人拨打了电话」，
// 点进页面切回前台却既没有电话弹窗、聊天里也没有来电系统消息，什么也没有（明说其他设备
// 型号也有）。诊断实锤：LS 写探针 QuotaExceededError（同域他方键占满配额）——旧版
// holdIncomingCall 把 localStorage.setItem 与 idbSet 放同一个 try：LS 一抛整块中止、
// IDB 也不写＝后台只有通知、挂起没落库，回前台 resumeHeldCall 读 LS 无值 → 无弹窗也无未接。
// 修复（call.js，零机型分支）：
//   ① holdIncomingCall 挂起双写拆开（LS 配额满只丢 LS 快照，IDB 照写）；
//   ② resumeHeldCall 先读 LS、读不到回读 IDB 兜底（holdBusy 防 visibilitychange 重响
//      与 20s 兜底定时器并发双处理，挂起消费恰好一次）；
//   ③ incomingCall 增加 msgWritten 参数：后台触发重响（isReplay && !msgWritten）补发
//      「给你打来了语音通话」系统消息，前台已写（msg=true）不重复。
// 本脚本把 localStorage.setItem 全量 stub 成抛 QuotaExceededError（getItem/removeItem
// 正常，模拟配额满持久状态），走真实挂起 → 回前台恢复链断言；再跑无 stub 正常路径回归。
// 用例：
//   A. LS 配额满：挂起双写拆开——LS 没落、IDB 兜底落库（核心修复）
//      → 回前台重响（来电弹窗出现、mask 可见）→ 补发来电系统消息
//   B. 正常路径回归：双写都落库，回前台从 LS 恢复弹窗；msg=true 不重复补发系统消息
// 用法：node tools/verify-call-hold.mjs
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

// 模拟 LS 配额满：setItem 一律抛 QuotaExceededError（getItem/removeItem 正常，跨 reload 持续）
const QUOTA_STUB = `(function(){
  try {
    const ls = window.localStorage;
    Object.defineProperty(ls, 'setItem', { configurable: true, writable: false, value: function(k, v) {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    }});
  } catch (e) {}
})();`;

const HOLD_KEY = 'xy-home-v2:call-hold';

const { chromium } = await import('playwright');
const browser = await chromium.launch(process.env.BROWSER === 'chrome' ? { channel: 'chrome' } : undefined);
const ctxOpts = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function boot(page) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate('!!window.__mochiDataReady')) break;
    await sleep(300);
  }
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(800);
  await sleep(1500);
}

// 回前台重响触发：与真实用户「点通知/切回应用」同路径——visibilitychange → visible → resumeHeldCall
async function triggerForeground(page) {
  return page.evaluate(`(function(){
    try { Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return 'visible'; } }); } catch (e) {}
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
}

async function idbGetRaw(page, k) {
  return page.evaluate(`(async function(){
    try { return (window.idbGet) ? await window.idbGet(${JSON.stringify(k)}) : '(no idbGet)'; } catch (e) { return '(err)' + e.message; }
  })()`);
}

// 等待聊天模块权威就绪：空库桌面的 enterConfirmedEmpty（双复核 2.5s 后）会落账本键
// <prefix>:chat-meta——chatDbReady + authLoadedPrefix=当前桌面 就位前，saveMsgs 只进
// pendingLocal 不落 IDB（#88 守卫），系统消息断言会假红。以账本键出现为就绪信号。
async function waitChatAuth(page) {
  for (let i = 0; i < 50; i++) {
    const v = await idbGetRaw(page, 'xy-home-v2:default:chat-meta');
    if (v !== undefined && v !== null && v !== '(no idbGet)' && v !== '(err)undefined') return true;
    await sleep(300);
  }
  return false;
}

async function getHold(page, via) {
  // via: 'ls' | 'idb' → 返回挂起对象（ts>0）或 null
  return page.evaluate(`(async function(){
    try {
      let h = null;
      if (${JSON.stringify(via)} === 'ls') {
        try { h = JSON.parse(localStorage.getItem(${JSON.stringify(HOLD_KEY)}) || 'null'); } catch (e) { h = null; }
      } else {
        h = (window.idbGet) ? await window.idbGet(${JSON.stringify(HOLD_KEY)}) : null;
      }
      return (h && h.ts) ? { ts: h.ts, cid: h.cid || null, msg: !!h.msg, name: h.name || null } : null;
    } catch (e) { return null; }
  })()`);
}

// 轮询等来电弹窗出现（resumeHeldCall 的 IDB 回读是异步的）
async function waitRinging(page) {
  for (let i = 0; i < 25; i++) {
    const st = await page.evaluate(`(function(){ const s = window.getCallState ? window.getCallState() : null; return s ? { status: s.status, direction: s.direction } : null; })()`);
    if (st && st.status === 'ringing' && st.direction === 'in') return st;
    await sleep(200);
  }
  return null;
}

// 统计聊天记录里「给你打来了语音通话」系统消息条数（轮询等 IDB 落盘）
async function countCallSysMsg(page) {
  for (let i = 0; i < 35; i++) {
    const n = await page.evaluate(`(async function(){
      try {
        const v = await window.idbGet(window.activePrefix() + ':chat-msgs');
        const arr = (typeof v === 'string') ? JSON.parse(v) : (Array.isArray(v) ? v : []);
        return arr.filter(function(m){ return m && String(m.text || '').indexOf('打来了语音通话') >= 0; }).length;
      } catch (e) { return -1; }
    })()`);
    if (n >= 0) return n;
    await sleep(200);
  }
  return -1;
}

// ================= 会话 A：LS 配额满（#406 核心场景） =================
const ctxA = await browser.newContext(ctxOpts);
await ctxA.addInitScript(QUOTA_STUB);
const pageA = await ctxA.newPage();
const errsA = [];
pageA.on('pageerror', (e) => errsA.push(e.message));
await boot(pageA);

check('A0 LS setItem 已被配额满拦截', (await pageA.evaluate("(function(){ try { localStorage.setItem('xy-probe','1'); return 'write-ok'; } catch (e) { return e.name; } })()")) === 'QuotaExceededError');
check('A0.5 聊天权威就绪（chat-meta 账本已落，saveMsgs 可落 IDB）', await waitChatAuth(pageA));
check('A1 挂起接口已挂载', (await pageA.evaluate('typeof window.callHoldIncoming === "function"')));
check('A1.1 初始无进行中通话', (await pageA.evaluate('window.getCallState ? window.getCallState() : "no"')) === null);

// 后台触发来电（msgWritten=false：后台路径从未写过系统消息）
await pageA.evaluate(`window.callHoldIncoming('测试TA', 'default', undefined, false); true;`);

const lsHoldA = await getHold(pageA, 'ls');
check('A2 LS 未落挂起（配额满，setItem 抛错）', lsHoldA === null, JSON.stringify(lsHoldA));
let idbHoldA = null;
for (let i = 0; i < 15; i++) {
  idbHoldA = await getHold(pageA, 'idb');
  if (idbHoldA) break;
  await sleep(200);
}
check('A3 IDB 兜底落库挂起（双写拆开的修复生效）', !!idbHoldA && idbHoldA.cid === 'default' && idbHoldA.msg === false, JSON.stringify(idbHoldA));

// 回前台（模拟点通知/切回应用）→ resumeHeldCall → 读 LS 无值 → 回读 IDB → 重响
await triggerForeground(pageA);
const ringA = await waitRinging(pageA);
check('A4 回前台重新响铃（来电弹窗出现）', !!ringA, JSON.stringify(ringA));
check('A5 来电面板可见（call-mask 非隐藏）', (await pageA.evaluate("(function(){ const m = document.getElementById('call-mask'); return m ? m.hidden === false : null; })()")) === true);
const cntA = await countCallSysMsg(pageA);
check('A6 补发来电系统消息（后台触发重响聊天里有记录）', cntA === 1, 'count=' + cntA);
check('A7 会话 A 无 JS 错误', errsA.length === 0, errsA[0] || '');

// ================= 会话 B：正常路径回归（无 stub，双写都落库） =================
const ctxB = await browser.newContext(ctxOpts);
const pageB = await ctxB.newPage();
const errsB = [];
pageB.on('pageerror', (e) => errsB.push(e.message));
await boot(pageB);

check('B0 LS 写入正常（无 stub）', (await pageB.evaluate("(function(){ try { localStorage.setItem('xy-probe','1'); return 'write-ok'; } catch (e) { return e.name; } })()")) === 'write-ok');
check('B0.5 聊天权威就绪（chat-meta 账本已落）', await waitChatAuth(pageB));

// 前台已响铃后切后台（msgWritten=true：系统消息已写过，重响不应重复补发）
await pageB.evaluate(`window.callHoldIncoming('测试TA', 'default', undefined, true); true;`);
const lsHoldB = await getHold(pageB, 'ls');
check('B1 LS 双写落库（正常路径）', !!lsHoldB && lsHoldB.cid === 'default' && lsHoldB.msg === true, JSON.stringify(lsHoldB));
const idbHoldB = await getHold(pageB, 'idb');
check('B2 IDB 同步落库', !!idbHoldB && idbHoldB.msg === true, JSON.stringify(idbHoldB));

await triggerForeground(pageB);
const ringB = await waitRinging(pageB);
check('B3 正常路径回前台弹窗', !!ringB, JSON.stringify(ringB));
const cntB = await countCallSysMsg(pageB);
check('B4 msg=true 不重复补发系统消息', cntB === 0, 'count=' + cntB);
check('B5 会话 B 无 JS 错误', errsB.length === 0, errsB[0] || '');

const pass = results.filter(r => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
browser.close().catch(() => {});
process.exit(pass === results.length ? 0 : 1);
