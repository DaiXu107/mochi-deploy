// ===== 常驻回归：#1218「大键读空被当成数据已丢失」族（桌面/聊天壁纸原图只在 IndexedDB）=====
// 根因（零机型／零 UA 分支——判据只有内核回执的三态，任何存储吃紧或回填挂起的设备都会踩）：
//  MB 级原图（phone-bg / phone-bg-item-* / cs-bg / cs-bg-item-*）>200KB 时只存 IndexedDB，
//  而 xyStore.get 只查内存缓存 + localStorage、**永不回退 IDB**；启动回填按内存预算
//  （≤4GB 取 12MB，否则 24MB）逐键流式补，用的又是定死 4s+4s、不按体积放大的 idbGetMany
//  ⇒ 刚「清库→整包导入」的那一轮，或启动期被秒级长任务占住主线程时（OPPO 诊断实测：
//  chat-msgs 单键 107.7MB 远超整轮预算、启动长任务 1432ms、JS 堆 1020MB），排在几十个已入库
//  大键后面的 MB 级原图常常读不完就被判「挂起」。挂起／超时都不等于数据没了，可此前每条读空
//  路径都直接当成永久丢失：拆掉已铺好的图层（红米 K80「从通知点开进聊天页背景莫名消失、刷新
//  又回来」＝这一刀）、删掉 active-id 指针、宣布「原图已丢失请重新上传」（小米15+Edge 原话），
//  chat-settings 还把 >6MB 的 cs-bg 三处齐删＝真的把用户背景清掉了（「设置成功、重启后没了」）。
// 修法：数据层唯一一份 window.idbEnsureBigKey 三态按需取回（ok/absent/unknown，同 #193 字卡库、
//  #1208 音乐库口径）；消费方只在拿到 'absent'（健康连接把每个候选键都确认没有）时才说「已丢失」；
//  取回落地/导入完成（mochi-restore-done）后自己重铺；破坏性删除前先取回，让 5 秒撤销有底。
// 桩的口径（为什么这样模拟算诚实）：gate 只把「回填那一轮」的读路（idbGet/idbGetMany）拦成空，
//  IDB 里的值一个字节都不动 ⇒ 这正是真机上「挂起但数据还在」的形态；红侧够不着它，因为它压根
//  没有第二条读路。hyd='fail' 模拟的是内核读失败（idbHydrateKey 回 false），此时任何一侧都不得
//  下「丢失」结论。写侧的桩同理：refuse 让 window.idbSet 像真失败那样 resolve(false)（值哪儿也没
//  去，但 xyStore.set 不看结果），hold 只推迟提交不改变结果，keyFail 让 count(键) 问不出结果。
// 断言（判别器＝同 tip 纯 HEAD 副本红侧；实测修复副本 20/20 绿、纯 HEAD 恰红 A0~A6/B1~B2/C1~C2/D0~D2/E1）：
//   A0 三态出口在位；A1 键真在库里→'ok' 且 store 读得到；A2 库里真没有→'absent'（不许一律含糊）
//   A3 读取失败→'unknown'，绝不许说成 absent；A4 'absent' 留底生效且 idbResetBigKeyProbe 能翻案
//   A5 同键并发合流（一次 MB 级读只发一遍）；A6 default 桌面的旧顶层键也取得回（与 defaultStore 同口径）
//   B1 图在库里、回填那一轮没送到 → 启动后聊天背景自己回来（红＝白板到重启为止）
//   B2 同上：聊天壁纸层真的铺上去了（background-image 有值）
//   B3 对照：没确认丢失前不许删 active-id 指针（两侧都该绿）
//   D0 前置：导入那一步真把原图写进了 IDB（否则 D2 是空转）
//   D1 读失败那一轮不许删指针（红＝一次超时被当成永久丢失）
//   D2 「清库 → 导入 → 打开」之后不必重启就把背景补回来（红＝restore-done 这条腿没人接）
//   C1 桌面壁纸同款：不重启就该读到（红＝「背景被清理，要重启才显示」）
//   C2 桌面壁纸层真的画出来了（#page-phone.has-bg）
//   E1 7MB 的聊天背景只跳过渲染、不三处齐删（红＝>6MB 直接 remove，图物理没了）
//   E2 对照：>12MB 的毒数据仍被清除自愈（两侧都该绿＝没把「一律不动」当修复）
//   E3 对照：常规尺寸照常留住（两侧都该绿）
//   F1/F2 对照：正常设备（回填没挂起）两侧都读得到并铺上壁纸（红＝闸门把正常路径卡死）
//   G0 写侧验真出口在位；G1 图真在库里→'landed' 且只问一次；G2 库里真没有→'missing' 且问满两次
//   G3 内核拒收（配额满）＝内存里成功、库里没有 → 必须报 missing（红＝上传永远假成功）
//   G4 问不出结果→'unknown'（不许吓正常设备）；G5 ≤200KB 走 LS 的键＝落盘证据，零次问库
//   G6 慢写入（事务 400ms 后提交）→ 第二轮确认翻案成 landed（只问一遍＝假报警）
//   G7 空键/非字符串 → unknown
// 用法：node build.mjs && node tools/verify-1218-bigkey-not-lost.mjs
//       红绿对照：MOCHI_SERVE_ROOT=<纯 HEAD 产物目录> node tools/verify-1218-bigkey-not-lost.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || process.env.SERVE_ROOT || here);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
console.log('serve root = ' + root);

const browser = await chromium.launch({ headless: true });
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}

const NS = 'xy-home-v2:default';

// 页面脚本之前注入的公共桩：
//  · gate  —— 把「回填那一轮」模拟成没送到：idbGet / idbGetMany 对被盯的键交空（值仍在 IDB）。
//  · hyd   —— 按需取回的内核回执：'real' 真读 / 'fail' 读失败 / 'absent' 确认没有。
//  · seeds —— 种进 IDB 的原图；桩会等它落地才放行真读，避免「启动比写入快」造成的假绿/假红。
function install(opts) {
  const o = opts || {};
  window.__1218 = { gate: !!o.gate, hyd: o.hyd || 'real', t: {}, s: {}, calls: {}, keyCalls: {}, seed: Promise.resolve(true), seedDone: false, refuse: !!o.refuse, hold: o.hold || 0, keyFail: !!o.keyFail };
  (o.targets || []).forEach(function (k) { window.__1218.t[String(k)] = true; });
  (o.setT || []).forEach(function (k) { window.__1218.s[String(k)] = true; });
  const isT = function (k) { return !!window.__1218.t[String(k)]; };
  const isS = function (k) { return !!window.__1218.s[String(k)]; };
  const idbPut = function (k, v) {
    return new Promise((res, rej) => {
      let req; try { req = indexedDB.open('mochi-db', 1); } catch (e) { rej(e); return; }
      // 建库这件事必须抢在产品脚本之前做完：产品那边 onupgradeneeded 才建 'kv'，
      // 这里若只 open 不建，等于把库停在「有库无 store」的半成品状态，之后所有读都失败
      req.onupgradeneeded = function () {
        const db2 = req.result;
        if (!db2.objectStoreNames.contains('kv')) db2.createObjectStore('kv');
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(v, k);
          tx.oncomplete = () => { db.close(); res(true); };
          tx.onerror = () => { db.close(); rej(tx.error); };
        } catch (e) { db.close(); rej(e); }
      };
      req.onerror = () => rej(req.error);
    });
  };
  window.__1218.seed = Promise.all((o.seeds || []).map((s) => idbPut(s.k, s.v)))
    .then(() => { window.__1218.seedDone = true; return true; })
    .catch(() => { window.__1218.seedDone = true; return false; });
  (o.ls || []).forEach((p) => { try { localStorage.setItem(p.k, p.v); } catch (e) {} });
  const trap = function (name, make) {
    let real;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get() { return real ? make(real) : undefined; },
        set(v) { real = v; }
      });
    } catch (e) {}
  };
  const waitSeed = function (run) { return window.__1218.seedDone ? run() : window.__1218.seed.then(run); };
  trap('idbGet', function (real) {
    return function (k) {
      if (window.__1218.gate && isT(k)) return Promise.resolve(null); // 这一轮没送到（值还在库里）
      return real ? real.apply(null, arguments) : Promise.resolve(null);
    };
  });
  trap('idbGetMany', function (real) {
    return function (keys) {
      const args = arguments; // 内层回调的 arguments 是空的——不接住就把键名整包丢掉（实测假红一整轮）
      return waitSeed(function () {
        return Promise.resolve(real ? real.apply(null, args) : {}).then(function (map) {
          if (window.__1218.gate && map) (keys || []).forEach(function (k) { if (isT(k)) delete map[k]; });
          return map;
        });
      });
    };
  });
  trap('idbHydrateKey', function (real) {
    return function (k) {
      const args = arguments;
      return waitSeed(function () {
        if (isT(k)) {
          window.__1218.calls[k] = (window.__1218.calls[k] || 0) + 1;
          if (window.__1218.hyd === 'fail') return Promise.resolve(false);
          if (window.__1218.hyd === 'absent') return Promise.resolve(null);
        }
        return real ? real.apply(null, args) : Promise.resolve(undefined);
      });
    };
  });
  // 写侧桩：refuse ＝ 配额满内核拒收（真 idbSet 失败也是这样 resolve(false)，值哪儿也没去）；
  // hold ＝ 事务排队（MB 级写入在真机上就是几百毫秒），用来证「第一次问库里没有 ≠ 没写进去」。
  trap('idbSet', function (real) {
    return function (k) {
      const args = arguments;
      if (isS(k) && window.__1218.refuse) return Promise.resolve(false);
      if (isS(k) && window.__1218.hold) {
        return new Promise((res) => setTimeout(() => res(real.apply(null, args)), window.__1218.hold));
      }
      return real ? real.apply(null, args) : Promise.resolve(false);
    };
  });
  // count(键) 的内核回执桩：keyFail ＝ 这次问不出结果（隐私模式/事务挂起）→ 一律 null
  trap('idbHasKey', function (real) {
    return function (k) {
      const args = arguments;
      window.__1218.keyCalls[String(k)] = (window.__1218.keyCalls[String(k)] || 0) + 1;
      if (window.__1218.keyFail) return Promise.resolve(null);
      return real ? real.apply(null, args) : Promise.resolve(null);
    };
  });
}

async function openApp(injectOpts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // 桩要早于页面任何脚本落地 → 用字符串形态注入（函数形态在 addInitScript 里拿不到实参）
  await ctx.addInitScript('(' + install.toString() + ')(' + JSON.stringify(injectOpts || {}) + ');');
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String((e && e.message) || e).slice(0, 160)));
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  }).catch(() => {});
  await page.waitForFunction(() => !!window.__1218 && !!window.__1218.seedDone, null, { timeout: 15000 }).catch(() => {});
  return { ctx, page, jsErrors };
}
// 轮询到条件成立为止（不给固定时长：红侧永远等不到，绿侧不该被慢机器误判）
async function until(page, fn, ms) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > (ms || 12000)) return null;
    await page.waitForTimeout(250);
  }
}

// ================= S1：数据层三态出口 =================
{
  const { ctx, page, jsErrors } = await openApp({
    targets: [NS + ':k1218-fail', NS + ':k1218-dup'],
    seeds: [{ k: NS + ':k1218-dup', v: 'D'.repeat(300000) }]
  });
  const R = await page.evaluate(async () => {
    const out = {};
    const NSP = 'xy-home-v2:default';
    out.has = typeof window.idbEnsureBigKey === 'function';
    if (!out.has) return out;
    const BIG = 'A'.repeat(300000);
    // A1：值确实在库里（直写 IDB、不经 xyStore ⇒ 内存/LS 都没有，正是「被挂起」的形态）
    await window.idbSet(NSP + ':k1218-big', BIG);
    out.a1 = await window.idbEnsureBigKey('k1218-big');
    out.a1mem = String(window.xyStore(NSP).get('k1218-big') || '').length;
    // A2：库里真没有 ⇒ 必须敢说是 absent（不许退成含糊）
    out.a2 = await window.idbEnsureBigKey('k1218-never');
    // A3：读失败（内核问不出结果）⇒ 绝不能报 absent
    window.__1218.hyd = 'fail';
    out.a3 = await window.idbEnsureBigKey('k1218-fail');
    window.__1218.hyd = 'real';
    // A4：先探出 absent → 之后数据进库了仍照旧说 absent（留底生效）→ reset 必须能翻案
    out.a4a = await window.idbEnsureBigKey('k1218-later');
    await window.idbSet(NSP + ':k1218-later', BIG);
    out.a4b = await window.idbEnsureBigKey('k1218-later');
    out.a4c = 'no-reset-api';
    if (typeof window.idbResetBigKeyProbe === 'function') {
      window.idbResetBigKeyProbe();
      out.a4c = await window.idbEnsureBigKey('k1218-later');
    }
    // A5：同键并发合流（一次 MB 级读只发一遍）
    const before = window.__1218.calls[NSP + ':k1218-dup'] || 0;
    const pair = await Promise.all([window.idbEnsureBigKey('k1218-dup'), window.idbEnsureBigKey('k1218-dup')]);
    out.a5 = (window.__1218.calls[NSP + ':k1218-dup'] || 0) - before;
    out.a5r = pair.join(',');
    // A6：default 桌面的旧顶层键（未迁移老数据）也取得回
    await window.idbSet('xy-home-v2:k1218-legacy', BIG);
    out.a6 = await window.idbEnsureBigKey('k1218-legacy');
    return out;
  });
  ok(R.has === true, 'A0 数据层三态出口 window.idbEnsureBigKey 在位（红＝各消费方各自把读空当丢失）', 'typeof=' + typeof R.has);
  ok(R.a1 === 'ok' && R.a1mem > 200000, "A1 图在库里 → 'ok' 且 store 读得到（红＝取不回）", JSON.stringify({ a1: R.a1, mem: R.a1mem }));
  ok(R.a2 === 'absent', "A2 库里真没有 → 'absent'（真丢失仍要说真话）", String(R.a2));
  ok(R.a3 === 'unknown', "A3 读失败 → 'unknown'，绝不许报 absent（红＝把一次超时讲成数据没了）", String(R.a3));
  ok(R.a4a === 'absent' && R.a4b === 'absent', 'A4 确认过没有就留底，不反复空读 MB 级值', JSON.stringify({ a: R.a4a, b: R.a4b }));
  ok(R.a4c === 'ok', "A4b 导入/恢复 reset 后必须能翻案（红＝假证缓存一整轮＝「清库导入后仍说已丢失」）", String(R.a4c));
  ok(R.a5 === 1 && R.a5r === 'ok,ok', 'A5 同键并发合流：一次 MB 级读只发一遍', JSON.stringify({ calls: R.a5, r: R.a5r }));
  ok(R.a6 === 'ok', 'A6 default 桌面的旧顶层键也取得回（与 defaultStore 回退同口径）', String(R.a6));
  if (jsErrors.length) console.log('    （S1 环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}

// ================= S2：聊天背景——图在库里，回填那一轮没送到 =================
const CS_BG_FULL = 'data:image/jpeg;base64,' + 'B'.repeat(300000);
{
  const { ctx, page, jsErrors } = await openApp({
    gate: true,
    targets: [NS + ':cs-bg'],
    seeds: [{ k: NS + ':cs-bg', v: CS_BG_FULL }],
    ls: [{ k: NS + ':cs-bg-glist', v: JSON.stringify(['z1']) }, { k: NS + ':cs-bg-active-id', v: 'z1' }]
  });
  const back = await until(page, () => {
    try { return String(window.xyStore('xy-home-v2:default').get('cs-bg') || '').length > 1000 ? 'yes' : ''; } catch (e) { return ''; }
  }, 14000);
  ok(back === 'yes', 'B1 聊天背景在库里、回填没送到 → 启动后自己读回来（红＝白板到重启为止）', String(back));
  const paint = await until(page, () => {
    try {
      if (window.applyChatSettings) window.applyChatSettings();
      const l = document.getElementById('cs-bg-layer');
      return !!(l && l.style.backgroundImage && l.style.backgroundImage.indexOf('url(') === 0 && l.style.display !== 'none');
    } catch (e) { return false; }
  }, 6000);
  ok(paint === true, 'B2 聊天壁纸层真的铺上去了（红＝「背景被清除」那一刀还在拆层）', String(paint));
  const ptr = await page.evaluate(() => { try { return localStorage.getItem('xy-home-v2:default:cs-bg-active-id') || ''; } catch (e) { return 'ERR'; } });
  ok(ptr === 'z1', 'B3 对照：没拿到「库里确实没有」的回执前不许删 active-id 指针', String(ptr));
  if (jsErrors.length) console.log('    （S2 环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}

// ================= S4：清库 → 导入 → 打开（不必重启就该补回来）=================
{
  const { ctx, page, jsErrors } = await openApp({
    gate: true,
    hyd: 'fail', // 启动这一轮什么都问不出来（unknown），任何一侧都不许下「丢失」结论
    targets: [NS + ':cs-bg'],
    seeds: [],
    ls: [{ k: NS + ':cs-bg-glist', v: JSON.stringify(['z1']) }, { k: NS + ':cs-bg-active-id', v: 'z1' }]
  });
  await page.evaluate(() => { try { window.applyChatSettings(); } catch (e) {} });
  await page.waitForTimeout(1200);
  const afterFail = await page.evaluate(() => ({
    ptr: (() => { try { return localStorage.getItem('xy-home-v2:default:cs-bg-active-id') || ''; } catch (e) { return 'ERR'; } })(),
    len: (() => { try { return String(window.xyStore('xy-home-v2:default').get('cs-bg') || '').length; } catch (e) { return -1; } })()
  }));
  const imported = await page.evaluate(async (full) => {
    window.__1218.hyd = 'real'; // 导入完成，读得动了
    const w = await window.idbSet('xy-home-v2:default:cs-bg', full);
    document.dispatchEvent(new CustomEvent('mochi-restore-done')); // 备份导入收尾的既有事件
    return !!w;
  }, CS_BG_FULL);
  const back2 = await until(page, () => {
    try {
      const l = document.getElementById('cs-bg-layer');
      return String(window.xyStore('xy-home-v2:default').get('cs-bg') || '').length > 1000
        && !!(l && l.style.backgroundImage && l.style.backgroundImage.indexOf('url(') === 0);
    } catch (e) { return false; }
  }, 12000);
  ok(imported === true, 'D0 前置：导入这一步真把原图写进了 IDB（否则 D2 是空转）', String(imported));
  ok(afterFail.ptr === 'z1', 'D1 读失败（unknown）那一轮不许删指针（红＝一次超时被当成永久丢失）', JSON.stringify(afterFail));
  ok(back2 === true, 'D2 「清库 → 导入 → 打开」后不必重启就把背景补回来（红＝restore-done 这条腿没人接）', String(back2));
  if (jsErrors.length) console.log('    （S4 环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}

// ================= S5：桌面壁纸（「背景被清理，要重启才显示」）=================
{
  const DESK_FULL = 'data:image/jpeg;base64,' + 'C'.repeat(300000);
  const { ctx, page, jsErrors } = await openApp({
    gate: true,
    targets: [NS + ':phone-bg'],
    seeds: [{ k: NS + ':phone-bg', v: DESK_FULL }],
    ls: [{ k: NS + ':phone-bg-glist', v: JSON.stringify(['w1']) }, { k: NS + ':phone-bg-active-id', v: 'w1' }]
  });
  const got = await until(page, () => {
    try { return String(window.xyStore('xy-home-v2:default').get('phone-bg') || '').length > 1000 ? 'yes' : ''; } catch (e) { return ''; }
  }, 14000);
  ok(got === 'yes', 'C1 桌面壁纸在库里、回填没送到 → 不重启也该读到（红＝「背景被清理，要重启才显示」）', String(got));
  const painted = await until(page, () => {
    const p = document.getElementById('page-phone');
    if (p) p.hidden = false; // 回桌面：MutationObserver 会重跑 applyBgVisibility
    const q = document.getElementById('page-phone');
    return !!(q && q.classList.contains('has-bg'));
  }, 6000);
  ok(painted === true, 'C2 桌面壁纸层真的画出来了（红＝只补数据不重铺，用户仍看着白板）', String(painted));
  if (jsErrors.length) console.log('    （S5 环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}

// ================= S6：超限图的处置（只跳过渲染 ≠ 三处齐删）=================
{
  const { ctx, page, jsErrors } = await openApp({ targets: [] });
  const res = await page.evaluate(async () => {
    const NSP = 'xy-home-v2:default';
    const KEY = NSP + ':cs-bg';
    const mem = () => { try { return String(window.xyStore(NSP).get('cs-bg') || '').length; } catch (e) { return -2; } };
    const put = async (v) => {
      await window.idbSet(KEY, v);
      try { window.idbMemoSet(KEY, v); } catch (e) {}
      try { window.applyChatSettings(); } catch (e) {}
      await new Promise((r) => setTimeout(r, 1200));
      const m = mem();
      let has = await window.idbHasKey(KEY);
      if (has !== false) {
        // 「还在」要顶得住时间：绿侧压根不删，红侧删得慢也总得露馅
        for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 300)); has = await window.idbHasKey(KEY); }
      }
      return { mem: m, idb: has === false ? 'gone' : String(has) };
    };
    const out = {};
    out.p7 = await put('D'.repeat(7 * 1024 * 1024));   // 正常压缩产物偶尔略超 6MB
    out.p13 = await put('E'.repeat(13 * 1024 * 1024)); // 旧版绕过压缩塞进来的毒数据
    out.small = await put('F'.repeat(60000));          // 常规尺寸
    return out;
  });
  ok(res.p7.mem > 0 && res.p7.idb !== 'gone', 'E1 7MB 的聊天背景只跳过渲染、不三处齐删（红＝>6MB 直接 remove，图物理消失＝「重启后背景被清掉」）', JSON.stringify(res.p7));
  ok(res.p13.mem === 0 && res.p13.idb === 'gone', 'E2 对照：>12MB 的毒数据仍被清除自愈（两侧都该绿＝没把「一律不动」当修复）', JSON.stringify(res.p13));
  ok(res.small.mem > 0, 'E3 对照：常规尺寸照常留住（两侧都该绿）', JSON.stringify(res.small));
  if (jsErrors.length) console.log('    （S6 环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}

// ================= S7：对照——正常设备（回填没挂起）=================
{
  const OK_FULL = 'data:image/jpeg;base64,' + 'G'.repeat(300000);
  const { ctx, page, jsErrors } = await openApp({
    gate: false,
    targets: [NS + ':cs-bg'],
    seeds: [{ k: NS + ':cs-bg', v: OK_FULL }],
    ls: [{ k: NS + ':cs-bg-glist', v: JSON.stringify(['z1']) }, { k: NS + ':cs-bg-active-id', v: 'z1' }]
  });
  const okNormal = await until(page, () => {
    try { return String(window.xyStore('xy-home-v2:default').get('cs-bg') || '').length > 1000 ? 'yes' : ''; } catch (e) { return ''; }
  }, 12000);
  ok(okNormal === 'yes', 'F1 对照：正常设备（回填正常）启动后两侧都读得到原图（红＝闸门把正常路径卡死）', String(okNormal));
  const noLeak = await page.evaluate(() => {
    try {
      if (window.applyChatSettings) window.applyChatSettings();
      const l = document.getElementById('cs-bg-layer');
      return !!(l && l.style.backgroundImage && l.style.backgroundImage.indexOf('url(') === 0);
    } catch (e) { return false; }
  });
  ok(noLeak === true, 'F2 对照：正常路径照常铺壁纸（两侧都该绿）', String(noLeak));
  if (jsErrors.length) console.log('    （S7 环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}

// ================= S8：写侧「落盘验真」（用户补报「有的手机重新上传图片也不行」）=================
// 读侧收口只解决「库里有图却被说没了」，这一组是镜像问题：图**根本没进库**。xyStore.set 对 >200KB
// 的值只写内存缓存 + 发一个不管结果的 window.idbSet（LS 那份还被大键分支当场 removeItem）⇒ 配额满
// 时写失败零回执，上传「当场成功、重开就没」；而新键库里不存在 ⇒ 重开被读侧判成 absent＝「原图已
// 丢失，请重新上传」，用户照做、再传、再丢。判据一份来自数据层 window.idbBigKeyLanded：只有内核
// count(键) 两次确认库里没有才叫 missing，问不出结果是 unknown，≤200KB 走 LS 的那份副本本身就是
// 落盘证据（隐私模式 IDB 全挂时不许误报「存储已满」）。
{
  const { ctx, page, jsErrors } = await openApp({ targets: [], setT: [NS + ':k1218-refuse', NS + ':k1218-hold'] });
  const R = await page.evaluate(async () => {
    const out = {};
    const NSP = 'xy-home-v2:default';
    const store = window.xyStore(NSP);
    const BIG = 'I'.repeat(300000); // >200KB ⇒ 走大键分支（只进 IDB + 内存）
    const kc = (k) => window.__1218.keyCalls[NSP + ':' + k] || 0;
    out.has = typeof window.idbBigKeyLanded === 'function';
    if (!out.has) return out;
    // G1 真在库里 → landed，且一次问出结果就该收口（不许白等）
    await window.idbSet(NSP + ':k1218-ok', BIG);
    let b = kc('k1218-ok');
    out.g1 = await window.idbBigKeyLanded('k1218-ok');
    out.g1calls = kc('k1218-ok') - b;
    // G2 库里真没有 → missing，但必须问满两次
    b = kc('k1218-never');
    out.g2 = await window.idbBigKeyLanded('k1218-never', 250);
    out.g2calls = kc('k1218-never') - b;
    // G3 配额满（内核拒收）：内存里看着「上传成功」，库里查无此键＝正是要报警的那一幕
    window.__1218.refuse = true;
    store.set('k1218-refuse', BIG);
    await new Promise((r) => setTimeout(r, 150));
    out.g3mem = String(store.get('k1218-refuse') || '').length;
    out.g3 = await window.idbBigKeyLanded('k1218-refuse', 250);
    window.__1218.refuse = false;
    // G4 问不出结果 → unknown（正常设备不许被吓）
    window.__1218.keyFail = true;
    out.g4 = await window.idbBigKeyLanded('k1218-never', 200);
    // G5 ≤200KB 的键由 set 同步写进 LS＝副本本身就是落盘证据，一次都不该去问库
    store.set('k1218-small', 'H'.repeat(1000));
    b = kc('k1218-small');
    out.g5 = await window.idbBigKeyLanded('k1218-small', 200);
    out.g5calls = kc('k1218-small') - b;
    window.__1218.keyFail = false;
    // G6 慢写入（事务 400ms 后才提交）→ 第二轮确认必须翻案成 landed（只问一遍的实现会误报）
    window.__1218.hold = 400;
    store.set('k1218-hold', BIG);
    out.g6 = await window.idbBigKeyLanded('k1218-hold', 900);
    window.__1218.hold = 0;
    // G7 空键/非字符串 → unknown（不许抛，也不许当成「没落盘」）
    out.g7 = await window.idbBigKeyLanded('');
    out.g7b = await window.idbBigKeyLanded(12345);
    return out;
  });
  ok(R.has === true, 'G0 数据层落盘验真出口 window.idbBigKeyLanded 在位（红＝写侧仍零回执，上传永远假成功）', 'typeof=' + typeof R.has);
  ok(R.g1 === 'landed' && R.g1calls === 1, "G1 图真在库里 → 'landed'，且一次问出结果就收口", JSON.stringify({ g1: R.g1, calls: R.g1calls }));
  ok(R.g2 === 'missing' && R.g2calls === 2, "G2 库里真没有 → 'missing'，且必须连续两次确认（删两次＝慢机器每次上传都误报存储已满）", JSON.stringify({ g2: R.g2, calls: R.g2calls }));
  ok(R.g3mem > 100000 && R.g3 === 'missing', 'G3 内核拒收时：内存里仍「上传成功」而库里查无此键 → 必须报 missing（红＝配额满的机器照旧假成功＝「重新上传也不行」）', JSON.stringify({ mem: R.g3mem, g3: R.g3 }));
  ok(R.g4 === 'unknown', "G4 问不出结果 → 'unknown'，绝不许报 missing（红/回流＝把隐私模式当成存储满，正常设备被吓）", String(R.g4));
  ok(R.g5 === 'landed' && R.g5calls === 0, "G5 ≤200KB 的键 LS 副本即落盘证据 → 'landed' 且零次问库（红＝IDB 不可用时误报）", JSON.stringify({ g5: R.g5, calls: R.g5calls }));
  ok(R.g6 === 'landed', "G6 慢写入 400ms 后落地 → 第二轮确认翻案成 'landed'（只问一遍的实现这里报 missing＝假报警）", String(R.g6));
  ok(R.g7 === 'unknown' && R.g7b === 'unknown', 'G7 空键／非字符串 → unknown（不许抛、不许判死）', JSON.stringify({ a: R.g7, b: R.g7b }));
  if (jsErrors.length) console.log('    （S8 环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' #1218 大键三态取回：' + pass + ' 通过 / ' + fail + ' 断言失败');process.exit(fail === 0 ? 0 : 1);
