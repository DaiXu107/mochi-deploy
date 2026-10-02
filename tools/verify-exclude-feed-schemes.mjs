// ===== 回归脚本：#231~#233 全局根键漏 EXCLUDE / feedRootRescue 误删朋友圈身份键 / __ 系统键被迁移 =====
// 用法：node tools/verify-exclude-feed-schemes.mjs
// 纯 Node 行为断言（桩 IndexedDB，不开无头浏览器）：跑真实 src/js/idb.js + src/js/contacts.js
// （migrateLegacy 端到端）+ 真实 feed.js 的 feedRootRescue IIFE（源码切片注入）。
// 背景（红米 Note12 Turbo Chrome 报「空白气泡+完整外观方案/聊天美化方案/朋友圈头像昵称保存后
// 刷新回退」，用户明说多机型同发；诊断 ts=1788704933135）：
//   #231 full-beauty-schemes / beauty-undo-stack / ver-update-ack-ts / ver-update-notify 是
//        全局根键但不在 contacts.js EXCLUDE——每次刷新被 migrateLegacy 当旧顶层业务键迁进
//        default 并删根键 → 完整外观方案列表/撤销栈刷新清空、同版本更新条每刷新重弹；
//   #232 feed.js feedRootRescue 对身份/封面键「根键有值就删 default 副本」——v3.8 朋友圈好友
//        列表起这些键已按桌面独立（per-cid 优先），于是每次启动把用户编辑删回旧全局值；
//   #233 无冒号 __ 系统键（__wr-journal/__ls-dirty/__big-idx）同样被迁——写日志自愈第一道
//        防线每刷新清空，LS 回滚家族（#82/#88/#226/#229）被持续削弱。
// 场景：
//   V0 静态锚点 / V6 device.js 探针键位静态断言
//   V1a 完整外观方案：根键不再被迁（IDB 新值回填后仍在）+ default 滞留副本回收
//   V1b 完整外观方案：IDB 根键缺失时从 default 滞留副本找回（存量用户数据救援）
//   V1c __ 系统键：根键不再被迁 + default 滞留副本 LS/IDB 双删
//   V1d 真旧顶层键迁移不被误伤（avatar-legacy 照常迁进 default）
//   V2 朋友圈身份键：根键有旧值时 default 现行值绝不被删（#232 核心，旧代码必红）
//   V3 收养：per-cid 为空且 IDB 确认没有 → 旧全局值收养进 default（旧代码必红）
//   V4 收养守卫：IDB 有大值只是 def.get 看不到 → 保守不收养不覆盖（守卫删了必红）
//   V5 全局键旧行为保留：feed-app-unread 滞留副本照旧回收上根键
// 需要：Node 20+。脚本末尾显式 process.exit（idb.js 兜底计时器会拖住事件循环，属预期）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' —— ' + extra : '')); }
}

// —— 桩 IndexedDB：Map 后端（与 verify-wrj-merge-retry 同款，去注入器）——
function makeIdbStub(store) {
  const mkReq = () => ({ onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: undefined, error: null });
  return {
    open(_name, _version) {
      const req = mkReq();
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: () => true },
          transaction(_name, _mode) {
            const tx = { oncomplete: null, onerror: null, onabort: null };
            const os = {
              put(value, key) { store.set(key, value); return {}; },
              delete(key) { store.delete(key); return {}; },
              clear() { store.clear(); return {}; },
              count(key) { const r = mkReq(); setTimeout(() => { r.result = store.has(key) ? 1 : 0; r.onsuccess && r.onsuccess(); }, 0); return r; },
              get(key) { const r = mkReq(); setTimeout(() => { r.result = store.has(key) ? store.get(key) : undefined; r.onsuccess && r.onsuccess(); }, 0); return r; },
              getAllKeys() { const r = mkReq(); setTimeout(() => { r.result = Array.from(store.keys()); r.onsuccess && r.onsuccess(); }, 0); return r; },
            };
            tx.objectStore = () => os;
            setTimeout(() => { tx.oncomplete && tx.oncomplete(); }, 1);
            return tx;
          },
        };
        req.result = db;
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
  };
}

// —— 沙箱：document 捕获监听器 + getElementById 恒 null（ contacts.js 校正/入口安全跳过）——
function makeSandbox(seedLs) {
  const store = new Map();
  const listeners = {};
  const mkLs = () => {
    const m = new Map(Object.entries(seedLs || {}));
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
      get length() { return m.size; },
      key: (i) => Array.from(m.keys())[i] ?? null,
      _m: m,
    };
  };
  const ls = mkLs();
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder,
    crypto: globalThis.crypto,
    Event: class { constructor(t) { this.type = t; } },
    CustomEvent: class { constructor(t) { this.type = t; } },
    navigator: { userAgent: 'verify-node', maxTouchPoints: 0, deviceMemory: 8 },
    localStorage: ls,
    sessionStorage: mkLs(),
    MutationObserver: class { observe() {} },
    document: {
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      removeEventListener() {},
      dispatchEvent(ev) { (listeners[ev && ev.type] || []).forEach((fn) => { try { fn(ev); } catch (e) {} }); return true; },
      getElementById: () => null,
      querySelectorAll: () => [],
      visibilityState: 'visible',
      head: { appendChild() {} },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, contains: () => false } }),
      body: { appendChild() {} },
    },
    indexedDB: makeIdbStub(store),
  };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.window = sandbox;
  return { sandbox, store, listeners, ls };
}

// feedRootRescue 是 feed.js 顶部自包含 IIFE，切片注入（feedToday/renderNoticeBadge 是
// feed.js 顶层自由变量，喂桩）；__mochiDataReady=true 时 run() 同步执行。
function runFeedRescue(ctx) {
  const src = read('src/js/feed.js');
  const a = src.indexOf('(function feedRootRescue() {');
  const b = src.indexOf("const KEY = 'feed-posts';");
  if (a < 0 || b < 0 || b <= a) throw new Error('feedRootRescue 切片定位失败');
  const slice = src.slice(a, b);
  ctx.sandbox.feedToday = () => '2026-09-07';
  ctx.sandbox.renderNoticeBadge = () => {};
  ctx.sandbox.__mochiDataReady = true;
  vm.runInContext(slice, ctx.sandbox, { filename: 'feed.js#feedRootRescue' });
}

async function loadBase(seedLs, seedIdb) {
  const ctx = makeSandbox(seedLs);
  if (seedIdb) Object.entries(seedIdb).forEach(([k, v]) => ctx.store.set(k, v));
  vm.createContext(ctx.sandbox);
  vm.runInContext(read('src/js/idb.js'), ctx.sandbox, { filename: 'idb.js' });
  await sleep(250); // 开屏 idbRestore 链落地
  return ctx;
}
function loadContacts(ctx) {
  vm.runInContext(read('src/js/contacts.js'), ctx.sandbox, { filename: 'contacts.js' });
}

const SCHEMES = JSON.stringify([{ name: '自用', time: 1788700000000, data: { desk: {}, chat: {} } }]);

console.log('V0 静态锚点');
{
  const ct = read('src/js/contacts.js');
  ok(ct.includes("'full-beauty-schemes', 'beauty-undo-stack', 'ver-update-ack-ts', 'ver-update-notify',"), '#231 四个全局根键已在 EXCLUDE');
  ok(ct.includes("if (r.indexOf('__') === 0) return true;"), '#233 __ 系统键兜底规则在 isExcluded');
  // #527 契约更新：美化撤销栈改 per-cid 写入后，若仍留在本条回收清单，启动时会把
  // 「default 副本写回根键并删副本」，新的按桌面隔离存储每次开机被搬空（跨桌面串美化回归）。
  // 断言拆成两条：回收清单仍须含 full-beauty-schemes，且【不得】含 beauty-undo-stack。
  // 清单尾部不钉死（#937 起又并入 fhub-freq / fhub-seen）：只按数组字面量本身判定成员，
  // 身份锚＝以 pomo-cfg 开头的那条 .forEach 回收数组。
  const reclaimArr = (ct.match(/\[[^\[\]]*'pomo-cfg'[^\[\]]*\]\.forEach/) || [''])[0];
  ok(reclaimArr.includes("'full-beauty-schemes'"), '#231 存量滞留副本回收清单已并入（#527 后仍含 full-beauty-schemes，尾部随新全局键增长）');
  ok(!ct.includes("'full-beauty-schemes', 'beauty-undo-stack']"), '#527 撤销栈已自回收清单移除（留在清单会搬空 per-cid 撤销栈）');
  ok(ct.includes("k.indexOf(G + ':default:__') === 0"), '#233 default:__ 滞留副本清扫在位');
  const fd = read('src/js/feed.js');
  ok(fd.includes("const DESK_KEYS = ['feed-cover-bg', 'feed-ta-cover', 'feed-ta-name', 'feed-ta-avatar', 'feed-user-name', 'feed-user-avatar'];"), '#232 身份/封面六键拆到 DESK_KEYS（不再「根键有值就删 default 副本」）');
  ok(fd.includes("window.idbHasKey('xy-home-v2:default:' + k)"), '#232 收养前三态确认守卫在位');
}

console.log('V1a 完整外观方案：根键不被迁 + default 滞留副本回收（IDB 新值幸存世界）');
{
  const ctx = await loadBase(
    { 'xy-home-v2:default:full-beauty-schemes': SCHEMES, 'xy-home-v2:migrated-v1': '1' },
    { 'xy-home-v2:full-beauty-schemes': SCHEMES }
  );
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:full-beauty-schemes') === SCHEMES, 'idbRestore 回填后根键有值（刷新起点）');
  loadContacts(ctx);
  await sleep(450);
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:full-beauty-schemes') === SCHEMES, 'migrateLegacy 后根键仍在（修复前被迁走删根键=方案列表清空）', String(ctx.sandbox.localStorage.getItem('xy-home-v2:full-beauty-schemes')));
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:default:full-beauty-schemes') === null, 'default 滞留副本已回收');
  ok(ctx.sandbox.window.xyStore('xy-home-v2').get('full-beauty-schemes') === SCHEMES, '方案列表读取接口拿到完整数据');
}

console.log('V1b 完整外观方案：IDB 根键缺失时从 default 滞留副本找回（存量用户救援）');
{
  const ctx = await loadBase({ 'xy-home-v2:default:full-beauty-schemes': SCHEMES, 'xy-home-v2:migrated-v1': '1' });
  loadContacts(ctx);
  await sleep(450);
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:full-beauty-schemes') === SCHEMES, '滞留副本写回根键（「自用」方案找回）', String(ctx.sandbox.localStorage.getItem('xy-home-v2:full-beauty-schemes')));
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:default:full-beauty-schemes') === null, 'default 副本已清');
}

console.log('V1c __ 系统键：根键不被迁 + default 滞留副本 LS/IDB 双删');
{
  const ctx = await loadBase({
    'xy-home-v2:__wr-journal': '[]',
    'xy-home-v2:__big-idx': '{}',
    'xy-home-v2:default:__wr-journal': '[{"k":"dead","v":"x","t":1}]',
    'xy-home-v2:default:__big-idx': '{"dead":1}',
    'xy-home-v2:migrated-v1': '1',
  }, { 'xy-home-v2:default:__wr-journal': '[{"k":"dead-idb"}]' });
  loadContacts(ctx);
  await sleep(450);
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:__wr-journal') !== null, '根 __wr-journal（写日志自愈第一道防线）仍在', String(ctx.sandbox.localStorage.getItem('xy-home-v2:__wr-journal')));
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:__big-idx') !== null, '根 __big-idx（大键索引）仍在');
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:default:__wr-journal') === null, 'default:__wr-journal 滞留副本 LS 已删');
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:default:__big-idx') === null, 'default:__big-idx 滞留副本 LS 已删');
  ok(!ctx.store.has('xy-home-v2:default:__wr-journal'), 'default:__wr-journal IDB 已删（防 idbRestore 回填复活）');
}

console.log('V1d 真旧顶层键迁移不被误伤（防 __/EXCLUDE 兜底规则过度拦截）');
{
  const ctx = await loadBase({ 'xy-home-v2:avatar-legacy': 'data:image/png;base64,OLD', 'xy-home-v2:migrated-v1': '1' });
  loadContacts(ctx);
  await sleep(450);
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:default:avatar-legacy') === 'data:image/png;base64,OLD', '旧顶层键照常迁进 default');
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:avatar-legacy') === null, '旧顶层键迁移后删根键（原行为保留）');
}

console.log('V2 朋友圈身份键：根键有旧全局值时，default 现行值绝不被删（#232 核心）');
{
  const ctx = await loadBase({
    'xy-home-v2:feed-ta-avatar': 'data:image/jpeg;base64,ROOTLEGACY',
    'xy-home-v2:default:feed-ta-avatar': 'data:image/jpeg;base64,USERNEW',
    'xy-home-v2:migrated-v1': '1',
  });
  runFeedRescue(ctx);
  await sleep(250);
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:default:feed-ta-avatar') === 'data:image/jpeg;base64,USERNEW', 'default 现行头像保留（修复前每次启动被删回旧全局值）', String(ctx.sandbox.localStorage.getItem('xy-home-v2:default:feed-ta-avatar')));
  ok(ctx.sandbox.window.xyStore('xy-home-v2:default').get('feed-ta-avatar') === 'data:image/jpeg;base64,USERNEW', '读取接口（好友列表 per-cid 优先路径）拿到用户新头像');
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:feed-ta-avatar') === 'data:image/jpeg;base64,ROOTLEGACY', '根键旧值原样保留作回退');
}

console.log('V3 收养：per-cid 为空且 IDB 确认没有 → 旧全局值收养进 default（旧全局用户升级路径）');
{
  const ctx = await loadBase({
    'xy-home-v2:feed-ta-name': '旧全局昵称',
    'xy-home-v2:migrated-v1': '1',
  });
  runFeedRescue(ctx);
  await sleep(250);
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:default:feed-ta-name') === '旧全局昵称', '旧全局昵称收养进 default（好友列表 per-cid 读取可见）', String(ctx.sandbox.localStorage.getItem('xy-home-v2:default:feed-ta-name')));
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:feed-ta-name') === '旧全局昵称', '根键保留（其他读取方的回退链不变）');
}

console.log('V4 收养守卫：IDB 有大值只是 def.get 看不到 → 保守不收养不覆盖');
{
  const ctx = await loadBase({ 'xy-home-v2:feed-cover-bg': 'small-legacy', 'xy-home-v2:migrated-v1': '1' });
  ctx.store.set('xy-home-v2:default:feed-cover-bg', 'BIGIDBVALUE'); // 模拟 >200KB 大值：只在 IDB，回填被预算搁置
  runFeedRescue(ctx);
  await sleep(250);
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:default:feed-cover-bg') === null, '大值在 IDB（def.get 不可见）时不收养', String(ctx.sandbox.localStorage.getItem('xy-home-v2:default:feed-cover-bg')));
  ok(ctx.store.get('xy-home-v2:default:feed-cover-bg') === 'BIGIDBVALUE', 'IDB 大值原样保留（绝不被旧全局小值覆盖）');
}

console.log('V5 全局键旧行为保留：feed-app-unread 滞留副本照旧回收上根键');
{
  const ctx = await loadBase({ 'xy-home-v2:default:feed-app-unread': '3', 'xy-home-v2:migrated-v1': '1' });
  runFeedRescue(ctx);
  await sleep(250);
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:feed-app-unread') === '3', '全局键副本写回根键（原行为）');
  ok(ctx.sandbox.localStorage.getItem('xy-home-v2:default:feed-app-unread') === null, '全局键 default 副本照旧清理（原行为）');
}

console.log('V6 #234 device.js 探针键位静态断言');
{
  const dv = read('src/js/device.js');
  // #234 复发修正（2026-09-11 小米17Pro+Edge152 诊断实证）：首修把 SP 写成 G+':'+cid，
  // 但本文件 G='xy-home-v2:' 已带尾冒号，仍是 xy-home-v2::<cid>:: 双冒号——「读取」列恒缺失。
  // 正确形态 = G + cid（等价 contacts.js 家族的 GNS + ':' + cid，GNS 不带尾冒号）。
  ok(dv.includes('const SP = G + cid;'), '探针 SP=G+cid（G 已含尾冒号，xyStore 内部再自拼一个）');
  ok(!dv.includes("const SP = G + ':' + cid;"), '双冒号病句 SP=G+\':\'+cid 清零（首修笔误不回流）');
  ok(!/xyStore\(\s*G\s*\+\s*['"]:['"]\s*\+\s*cid/.test(dv), 'device.js 不再有任何 G+\':\'+cid 形态前缀传 xyStore');
  ok(dv.includes('window.xyStore(SP).get(short)'), '「读取」列走 xyStore(SP)（双冒号修复）');
  ok(!dv.includes('window.xyStore(P).get(short)'), '不再把带尾冒号的 P 传给 xyStore（双冒号病句清零）');
  ok(dv.includes('window.idbGet(P + short)'), 'IDB 权威列键位不受影响（仍读 P+short）');
}

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
