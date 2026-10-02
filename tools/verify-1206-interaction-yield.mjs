// ===== 常驻回归：#1206 重活让出手势窗口（iPhone 17 / iOS 26.6 实报「切页面、滑动时最卡」）=====
// 判据只有一条「最近一次手势/滚动/键盘输入的时间戳」，零机型、零 UA 分支——所以在任何内核上都可测。
// 断言钉在**落盘时机**上而不是函数名上：名字留着、把让路改成无条件立即写（滑动期长任务回流）、
// 或改成无限期让路（日志静默不落盘＝#943c 防丢语义破口），本电池都转红。
//   S 组＝逻辑锚（src 直读，不需要构建）
//   B 组＝真浏览器（直接挂 src/js/idb.js ＋ src/js/mobile-adapt.js，绕开产物，改 src 即可跑）
//     B1 空闲：写小键 → 日志在 200ms 防抖档到达（没被顺手改回每次同步写）
//     B2 手势中途到期：排程之后手指才落下 → 不在滑动里落，停手后补上
//     B3 硬上限：手指一直不停 → 最迟 ~1200ms 必落一次（不会无限押后）
//     B4 离页闸：后台那一下当场落盘（#943c 防丢语义零破口）
//     B5 值事务不让路：xyStore.set 当次同步发出的 idbSet 一次不少（只押后标记批量）
//   E 组＝__mochiInteracting() 自身语义（刚手势/静默/holdMs/hidden）
//   G 组＝注册位置：桌面 UA（mobile-adapt 走 isMobile/isTablet 早退）下信号依然存在
//   Z 组＝零未捕获 JS 异常 ＋ 全程确有落盘（不是空转到全绿）
// 用法：node tools/verify-1206-interaction-yield.mjs      （无需先构建）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = process.env.MOCHI_SERVE_ROOT || process.env.SERVE_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
  + '<script src="/src/js/idb.js"></script>'
  + '<script src="/src/js/mobile-adapt.js"></script>'
  + '</body></html>';

let pass = 0, fail = 0;
const ok = (cond, label, extra) => { pass += cond ? 1 : 0; fail += cond ? 0 : 1; console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (cond || extra === undefined ? '' : '  → ' + JSON.stringify(extra))); };

// ---------------- S 组：逻辑锚 ----------------
console.log('S. 逻辑锚（src 直读）');
const srcIdb = fs.readFileSync(path.join(ROOT, 'src/js/idb.js'), 'utf8');
const srcMa = fs.readFileSync(path.join(ROOT, 'src/js/mobile-adapt.js'), 'utf8');
ok(srcMa.includes('return Date.now() - __actLast() < (holdMs > 0 ? holdMs : 380);'), 'S1 交互判据＝时间戳差，不读任何机型/UA 特有 API');
ok(srcMa.includes("if (typeof document !== 'undefined' && document.hidden) return false;"), 'S2 后台期恒判「没在交互」');
ok(srcIdb.includes('if (wrjBusy() && now < _wrjCap) { _wrjPersistT = setTimeout(wrjPersistAt, 150); return; }'), 'S3 日志落盘到期裁决按手势让路');
ok(srcIdb.includes('if (wrjBusy() && now < _wrjMarkCap) { _wrjMarkT = setTimeout(wrjMarkAt, 150); return; }'), 'S4 标记批量到期裁决按手势让路');
ok(srcIdb.includes('const WRJ_FLUSH_MS = 200, WRJ_BUSY_CAP = 1200;'), 'S5 让路有硬上限常量（改成 Infinity 即失配）');
ok(srcIdb.includes('_wrjPersistT = setTimeout(wrjPersistAt, Math.max(0, Math.min(_wrjDue, _wrjCap) - now));'), 'S6 #943c 防抖排程行仍在（本批重锚）');
ok(srcIdb.includes('_wrjMarkT = setTimeout(wrjMarkAt, Math.max(0, Math.min(_wrjMarkDue, _wrjMarkCap) - now));'), 'S7 #166 批量落库排程行仍在（本批重锚）');
ok(srcIdb.includes("if (document.visibilityState === 'hidden') { wrjMarkFlush(); wrjPersistFlush(); }") && srcIdb.includes("addEventListener('pagehide'"), 'S8 离页两条当场冲刷接线未被改动');

// ---------------- 起服务 + 浏览器 ----------------
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/harness.html') { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.end(HARNESS); return; }
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': path.extname(fp) === '.js' ? 'text/javascript;charset=utf-8' : 'text/plain' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const browser = await chromium.launch();
// 桌面 UA：mobile-adapt 会走 isMobile/isTablet 早退分支，顺带证 G 组（注册位确在早退之前）
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const pageErrs = [];
page.on('pageerror', e => pageErrs.push(String(e && e.message)));
await page.addInitScript(() => {
  window.__wrjWrites = [];   // 日志落盘时刻（localStorage 写 __wr-journal）
  window.__idbSetN = 0;      // 值事务次数
  window.__idbAllN = 0;      // 标记批量事务次数
  const oSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === 'xy-home-v2:__wr-journal') window.__wrjWrites.push(Date.now()); return oSet.apply(this, arguments); };
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__forceHidden ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__forceHidden });
});
await page.goto('http://127.0.0.1:' + port + '/harness.html', { waitUntil: 'load' });
const boot = await page.evaluate(() => ({ store: typeof window.xyStore, sig: typeof window.__mochiInteracting, init: !!window.idbSetAll }));
ok(boot.store === 'function' && boot.init, 'S9 harness 装载成功（xyStore / idbSetAll 可用）', boot);
ok(boot.sig === 'function', 'G1 桌面 UA（mobile-adapt 已早退）下 __mochiInteracting 仍然注册', boot);

await page.evaluate(() => {
  const S = (ms) => new Promise(r => setTimeout(r, ms));
  window.__sleep = S;
  window.__st = window.xyStore('xy-home-v2:v1206probe');
  const ois = window.idbSet; window.idbSet = function () { window.__idbSetN++; try { return ois.apply(this, arguments); } catch (e) { return Promise.resolve(false); } };
  const oall = window.idbSetAll; window.idbSetAll = function () { window.__idbAllN++; try { return oall.apply(this, arguments); } catch (e) { return Promise.resolve(false); } };
  window.__g = () => { window.dispatchEvent(new Event('touchmove')); window.dispatchEvent(new Event('scroll')); };
  // 连续「不停手」：每 stepMs 打一次手势，共 ms
  window.__busy = async (ms, stepMs) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { window.__g(); await S(stepMs || 90); } };
  // 等静默：启动期回填自己会写日志，1s 内没有新落盘才算静默（避免把别人的落盘算进本档）
  window.__quiet = async () => { for (let i = 0; i < 40; i++) { const n = window.__wrjWrites.length; await S(100); if (window.__wrjWrites.length === n) { await S(900); if (window.__wrjWrites.length === n) return true; } } return false; };
  // 一档＝等静默 → 写一个小键 → 跑 drive() → 量出「本次触发后第一次日志落盘的延迟」等指标
  window.__arm = async (tag, drive) => {
    await window.__quiet();
    const f = { at: Date.now(), w: window.__wrjWrites.length, s: window.__idbSetN, a: window.__idbAllN };
    window.__st.set('probe-' + tag, JSON.stringify({ t: f.at, tag: tag }));
    const syncSet = window.__idbSetN - f.s;      // set() 返回时的值事务数＝同步发出的那一下
    const r = (await drive()) || {};
    await S(60);
    const first = window.__wrjWrites.slice(f.w)[0] || 0;
    r.first = first ? first - f.at : -1;
    r.nWrites = window.__wrjWrites.length - f.w;
    r.dSet = window.__idbSetN - f.s; r.syncSet = syncSet;
    r.dSetAll = window.__idbAllN - f.a;
    r.quiet = true;
    return r;
  };
});

console.log('B. 让路行为（真浏览器 · 落盘时机）');
const b1 = await page.evaluate(() => window.__arm('idle', async () => { await window.__sleep(700); }));
ok(b1.first >= 150 && b1.first <= 600, 'B1 空闲期：日志在 200ms 防抖档落盘（既没退回每次同步写，也没被押后）', b1);

const b2 = await page.evaluate(() => window.__arm('defer', async () => {
  await window.__g();                              // 排程之后手指才落下
  await window.__busy(600, 90);
  await window.__sleep(1200);                      // 停手，等它补上
}));
ok(b2.first > 300 && b2.first <= 1900, 'B2 滑动中途到期也认（不在手势里落，停手后补落）', b2);

const b3 = await page.evaluate(() => window.__arm('cap', async () => { await window.__busy(2100, 90); }));
ok(b3.first >= 1000 && b3.first <= 1500, 'B3 手指一直不停：最迟 ~1200ms 硬上限必落一次（无限押后＝日志静默丢＝红灯）', b3);

const b4 = await page.evaluate(async () => {
  // 同一个任务里：刚打手势（否则会被押后）＋切后台＋派发 visibilitychange
  // ⇒ 红侧＝离页接线被改成走排程（wrjPersist）而不是当场落盘（wrjPersistFlush）
  const r = await window.__arm('hidden', async () => {
    window.__g();
    window.__forceHidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await window.__sleep(150);
    window.__forceHidden = false;
  });
  return r;
});
ok(b4.first >= 0 && b4.first <= 50, 'B4 后台那一下当场落盘（#943c 防丢语义零破口，让路不碰离页）', b4);

ok(b1.syncSet >= 1 && b2.syncSet >= 1, 'B5 值事务照旧同步发出（让路只押后标记批量，不碰持久化主链路）', { b1: b1.syncSet, b2: b2.syncSet });

console.log('E. __mochiInteracting() 自身语义');
const e1 = await page.evaluate(async () => {
  const o = {};
  // 红侧（修复前的树）里这个全局压根不存在：照实返回缺签名，让 E1~E3 各记一条失败，
  // 而不是抛出去把后面的 Z 组一起带走（红侧必须报满整套断言，否则「红了几条」没有分母）。
  if (typeof window.__mochiInteracting !== 'function') { o.missing = 1; return o; }
  window.__g(); o.justNow = window.__mochiInteracting();
  await window.__sleep(500);
  o.after500 = window.__mochiInteracting();
  o.after500Wide = window.__mochiInteracting(2000);
  window.__forceHidden = true; window.__g();
  o.hiddenWhileGesture = window.__mochiInteracting();
  window.__forceHidden = false;
  return o;
});
ok(e1.justNow === true && e1.after500 === false, 'E1 刚手势=true，静默 500ms（>380 窗口）=false', e1);
ok(e1.after500Wide === true, 'E2 holdMs 由调用方定窗口（放宽到 2000ms 仍判 true）', e1);
ok(e1.hiddenWhileGesture === false, 'E3 后台期即使刚打手势也判 false（离页落盘绝不被押后）', e1);

const z = await page.evaluate(() => ({ all: window.__idbAllN, writes: window.__wrjWrites.length, ls: localStorage.getItem('xy-home-v2:v1206probe:probe-cap') !== null }));
console.log('Z. 收尾');
ok(z.all >= 1 && z.writes >= 4 && z.ls, 'Z1 全程确有落盘/批量标记/值落库（不是空转到全绿）', z);
ok(pageErrs.length === 0, 'Z2 全程零未捕获 JS 异常', pageErrs.slice(0, 3));

console.log('\n==== #1206 交互让路：通过 ' + pass + ' / 失败 ' + fail + ' ====');
await browser.close();
srv.close();
process.exit(fail ? 1 : 0);
