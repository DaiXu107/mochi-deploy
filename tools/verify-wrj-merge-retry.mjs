// ===== 回归脚本：#229 wrjMergeFromIdb 合并失败必须重试（自愈第二道防线不许一次失败全会话放弃） =====
// 用法：node tools/verify-wrj-merge-retry.mjs
// 纯 Node 行为断言（桩 IndexedDB，不开无头浏览器）：跑真实 src/js/idb.js。
// 背景：原实现入口即置 _wrjMerged=true，且走 idbGetAllKeys——它把「清单读取失败(null)」
// 折叠成「空数组」，与「库里确实没有标记」不可区分。真我/荣耀/小米 Edge 等挂起内核上，
// 合并恰逢 IDB 挂起窗口时空转一次后整个会话永久放弃 → LS 被杀进程回滚的美化/设置/近期
// 小数据在本会话再无自愈（用户视角＝刷新后部分数据丢失，#82/#88/#226 同家族多机型复发）。
// 场景基线（还原真实回滚世界）：IDB 里有新值+新标记（幸存），LS 残留回滚旧值。
//   U0 静态锚点：合并走严格三态 idbListKeys / 读失败重试行 / 重试上限 / 修复标记在位
//   U1 健康内核（无注入）：启动合并直接自愈——LS 旧值被 IDB 新值修正 + 派发 mochi-wrj-heal
//   U2 清单读失败（回归现场）：合并首轮 getAllKeys 失败 → 旧代码当场放弃 LS 永远旧值；
//      修复后 10s 重试读到清单 → 自愈完成
//   U3 标记时间戳读失败（回归现场）：idbGetMany 折叠 undefined → cand 空 → 修复后判
//      「没读到」重试并自愈；旧代码当「真没有」放弃
// 需要：Node 20+。脚本末尾显式 process.exit（idb.js open() 8s 兜底/15s 合并兜底计时器会
// 拖住事件循环，属预期，不是泄漏）。
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

const VAL_KEY = 'xy-home-v2:beauty';
const MARK_KEY = 'xy-home-v2:__wr-j:xy-home-v2:beauty';
const LS_OLD = 'ls-old';
const IDB_NEW = 'idb-new';

// —— 桩 IndexedDB：Map 后端；注入器模拟挂起内核的「读失败折叠」形态 ——
// inject.failGetAllKeys：前 N 次 getAllKeys 走 req.onerror（idbProbe → IDB_LIST_FAILED=null）
// inject.failGetKeys：{ key, remain } 前 N 次 get(key) 返回 undefined（idbGetMany 折叠形态）
function makeIdbStub(store, inject, counters) {
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
              get(key) {
                const r = mkReq();
                setTimeout(() => {
                  const inj = inject.failGetKeys;
                  if (inj && inj.key === key && inj.remain > 0) { inj.remain--; r.result = undefined; }
                  else r.result = store.has(key) ? store.get(key) : undefined;
                  r.onsuccess && r.onsuccess();
                }, 0);
                return r;
              },
              getAllKeys() {
                counters.listCalls++;
                const r = mkReq();
                setTimeout(() => {
                  if (inject.failGetAllKeys > 0) { inject.failGetAllKeys--; r.error = new Error('inject-list-fail'); r.onerror && r.onerror(); return; }
                  r.result = Array.from(store.keys()); r.onsuccess && r.onsuccess();
                }, 0);
                return r;
              },
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

// —— 沙箱：document 捕获监听器（restore-done 需手动可派发、wrj-heal 需可观测）——
function makeSandbox(inject) {
  const store = new Map();
  const listeners = {};
  const counters = { listCalls: 0, healed: 0 };
  const mkLs = (seed) => {
    const m = new Map(Object.entries(seed || {}));
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
      get length() { return m.size; },
      key: (i) => Array.from(m.keys())[i] ?? null,
    };
  };
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder,
    crypto: globalThis.crypto,
    Event: class { constructor(t) { this.type = t; } },
    navigator: { userAgent: 'verify-node', maxTouchPoints: 0, deviceMemory: 8 },
    localStorage: mkLs({ [VAL_KEY]: LS_OLD }), // 回滚世界：LS 残留旧值
    sessionStorage: mkLs(),
    MutationObserver: class { observe() {} },
    document: {
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      removeEventListener() {},
      dispatchEvent(ev) { if (ev && ev.type === 'mochi-wrj-heal') counters.healed++; (listeners[ev && ev.type] || []).forEach((fn) => { try { fn(ev); } catch (e) {} }); return true; },
      visibilityState: 'visible', querySelectorAll: () => [],
    },
    indexedDB: makeIdbStub(store, inject, counters),
  };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.window = sandbox;
  return { sandbox, store, listeners, counters };
}

async function loadScenario(inject, seedStore) {
  const ctx = makeSandbox(inject);
  if (seedStore) {
    ctx.store.set(VAL_KEY, IDB_NEW);                       // 幸存的新值
    ctx.store.set(MARK_KEY, Date.now());                  // 幸存的新标记（_wrjTimes 空 → 必然更新）
  }
  vm.createContext(ctx.sandbox);
  vm.runInContext(read('src/js/idb.js'), ctx.sandbox, { filename: 'idb.js' });
  await sleep(120); // 开屏 idbRestore 链 + 启动合并首轮落地
  return ctx;
}

console.log('U0 静态锚点：合并走严格三态 + 失败重试骨架');
{
  const src = read('src/js/idb.js');
  ok(src.includes('window.idbListKeys().then(function (keys)'), '合并改走严格三态 idbListKeys（null=读失败不再折叠成空数组）');
  ok(src.includes('if (!keys) { wrjMergeRetry(); return; }'), '清单读失败 → 重试（删除即回归一次性放弃）');
  ok(src.includes('if (!anyTs) { wrjMergeRetry(); return; }'), '标记全读不到数值 → 重试（防 idbGetMany 折叠误判「真没有」）');
  ok(src.includes('_wrjMergeTries >= 5'), '重试有界（×5，防 IDB 永久坏机无限循环）');
  ok(src.includes('FIX 2026-09-07 #229'), '修复标记注释在位');
  const mergeBody = src.slice(src.indexOf('function wrjMergeFromIdb'), src.indexOf("document.addEventListener('mochi-restore-done', wrjMergeFromIdb)"));
  ok(!mergeBody.includes('idbGetAllKeys'), '合并函数内不再用折叠版 idbGetAllKeys');
}

console.log('U1 健康内核（无注入）：启动合并直接自愈，LS 旧值被 IDB 新值修正');
{
  const ctx = await loadScenario({ failGetAllKeys: 0 }, true);
  ok(ctx.sandbox.localStorage.getItem(VAL_KEY) === IDB_NEW, 'LS 回滚旧值被合并自愈为 IDB 新值', String(ctx.sandbox.localStorage.getItem(VAL_KEY)));
  ok(ctx.sandbox.xyStore('xy-home-v2').get('beauty') === IDB_NEW, 'store.get（memoryCache 优先）读到新值');
  ok(ctx.counters.healed > 0, '派发 mochi-wrj-heal 让已渲染 UI 重同步');
  ok(ctx.store.get(MARK_KEY) > 0 && ctx.store.get(VAL_KEY) === IDB_NEW, 'IDB 值/标记原样保留（合并不回写）');
}

console.log('U2 清单读失败（回归现场）：首轮合并失败 → 10s 重试后自愈（旧代码永久放弃）');
{
  const ctx = await loadScenario({ failGetAllKeys: 2 }, true); // 毒前两次：restore 首轮 + 合并首轮；重试第 3 次成功
  ok(ctx.sandbox.localStorage.getItem(VAL_KEY) === LS_OLD, '首轮失败后尚未自愈（LS 仍旧值）');
  await sleep(11500); // 10s 重试间隔 + 读链落地（15s 会话兜底未到，不抢功）
  ok(ctx.counters.listCalls >= 3, '发生了重试（清单读取 ≥3 次：restore+失败首轮+重试）', 'calls=' + ctx.counters.listCalls);
  ok(ctx.sandbox.localStorage.getItem(VAL_KEY) === IDB_NEW, '重试合并后 LS 旧值被修正（修复前永远停留在旧值）', String(ctx.sandbox.localStorage.getItem(VAL_KEY)));
  ok(ctx.counters.healed > 0, '自愈广播 mochi-wrj-heal');
}

console.log('U3 标记时间戳读失败（回归现场）：折叠 undefined → 重试后自愈（旧代码当「真没有」）');
{
  const ctx = await loadScenario({ failGetAllKeys: 0, failGetKeys: { key: MARK_KEY, remain: 1 } }, true);
  ok(ctx.sandbox.localStorage.getItem(VAL_KEY) === LS_OLD, '首轮标记读失败后尚未自愈（LS 仍旧值）');
  await sleep(11500);
  ok(ctx.sandbox.localStorage.getItem(VAL_KEY) === IDB_NEW, '重试合并后 LS 旧值被修正', String(ctx.sandbox.localStorage.getItem(VAL_KEY)));
  ok(ctx.counters.healed > 0, '自愈广播 mochi-wrj-heal');
}

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
