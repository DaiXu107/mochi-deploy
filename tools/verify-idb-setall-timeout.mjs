// ===== 回归脚本：#226 idbSetAll 挂起超时骨架（wrj 标记微批 / 媒体池微批的 false 兜底可达性） =====
// 用法：node tools/verify-idb-setall-timeout.mjs
// 纯 Node 行为断言（桩 IndexedDB，不开无头浏览器）：跑真实 src/js/idb.js（T3 另加 media-pool.js）。
// 背景：#166 把 wrj 标记落库改成 idbSetAll 150ms 微批，而 idbSetAll 无超时骨架——真我/荣耀/
// 小米 Edge 等挂起内核上标记事务永不完成：wrjMarkFlush 的「返回 false 退回逐键 idbSet」兜底
// 永不触发 → 标记静默丢 → 杀进程回滚 LS 后 wrjMergeFromIdb 自愈失效 →「刷新后丢美化/丢数据」；
// media-pool mochiMediaFlush 同样永久挂起（writeBuf 已 splice 却不回队=令牌静默丢）。
//   T0 静态锚点：idbSetAll 超时骨架（lim 表达式 / 超时置空连接 / 修复标记）在位
//   T1 健康内核：xyStore.set 小键 → 标记走 idbSetAll 微批落库（不退回逐键 idbSet，#166 优化保留）
//   T2 挂起内核（#166 回归现场）：readwrite 事务永不完成 → idbSetAll 4s 判 false →
//      wrjMarkFlush 兜底退回逐键 idbSet，标记键最终经 window.idbSet 落库（第二道自愈防线恢复）
//   T3 挂起内核媒体池：mochiMediaFlush 有界返回 false 且回队，写恢复后令牌真正落库
// 需要：Node 20+（globalThis.crypto.subtle）。脚本末尾显式 process.exit（idb.js open() 的
// 8s 兜底计时器会拖住事件循环，属预期，不是泄漏）。
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

// —— 桩 IndexedDB：Map 后端；hangWrite=true 时 readwrite 事务永不完成（挂起内核形态）——
function makeIdbStub(store, hangRef) {
  const mkReq = () => ({ onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: undefined, error: null });
  return {
    open(_name, _version) {
      const req = mkReq();
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: () => true },
          transaction(_name, mode) {
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
            if (!(mode === 'readwrite' && hangRef.v)) {
              setTimeout(() => { tx.oncomplete && tx.oncomplete(); }, 1);
            } // 挂起形态：readwrite 不派 oncomplete/onerror/onabort
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

function makeSandbox(hangRef) {
  const sandboxStore = new Map();
  const mkLs = () => {
    const m = new Map();
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
    localStorage: mkLs(),
    sessionStorage: mkLs(),
    MutationObserver: class { observe() {} },
    document: {
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
      visibilityState: 'visible', querySelectorAll: () => [], getElementById: () => null,
    },
    indexedDB: makeIdbStub(sandboxStore, hangRef),
  };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.window = sandbox;
  return { sandbox, store: sandboxStore };
}

async function loadIdb(hangRef) {
  const { sandbox, store } = makeSandbox(hangRef);
  vm.createContext(sandbox);
  vm.runInContext(read('src/js/idb.js'), sandbox, { filename: 'idb.js' });
  await sleep(60); // 开屏 idbRestore（空库）链落地
  return { w: sandbox, store };
}

console.log('T0 静态锚点：idbSetAll 超时骨架');
{
  const src = read('src/js/idb.js');
  ok(src.includes('const lim = 4000 + (est > 262144'), 'lim 超时表达式在位（删除即哑火）');
  ok(src.includes('dbPromise = null; // 事务疑似挂起'), '超时置空连接重建在位');
  ok(src.includes('FIX 2026-09-07 #226'), '修复标记注释在位');
}

console.log('T1 健康内核：标记走 idbSetAll 微批（#166 优化保留）');
{
  const hang = { v: false };
  const { w, store } = await loadIdb(hang);
  const setAllPairs = [];
  const realSetAll = w.idbSetAll;
  w.idbSetAll = (pairs) => { setAllPairs.push(pairs.map(p => p.k)); return realSetAll(pairs); };
  const idbSetKeys = [];
  const realSet = w.idbSet;
  w.idbSet = (k, v) => { idbSetKeys.push(k); return realSet(k, v); };
  w.xyStore('xy-home-v2').set('wrjok', 'v1');
  await sleep(400); // 150ms 微批窗口 + 事务完成
  const markKey = 'xy-home-v2:__wr-j:xy-home-v2:wrjok';
  ok(setAllPairs.some(ks => ks.includes(markKey)), '标记进 idbSetAll 微批');
  ok(store.has(markKey), '标记经微批落库');
  ok(!idbSetKeys.includes(markKey), '健康路径不退回逐键 idbSet');
  ok(store.has('xy-home-v2:wrjok'), '值本身落库不受影响');
}

console.log('T2 挂起内核：4s 判 false → wrjMarkFlush 兜底逐键 idbSet（#166 回归现场）');
{
  const hang = { v: true };
  const { w } = await loadIdb(hang);
  let setAllResult = null;
  const realSetAll = w.idbSetAll;
  w.idbSetAll = (pairs) => realSetAll(pairs).then(r => { setAllResult = r; return r; });
  const idbSetKeys = [];
  w.idbSet = (k) => { idbSetKeys.push(k); return Promise.resolve(true); };
  w.xyStore('xy-home-v2').set('wrjhang', 'v2');
  const markKey = 'xy-home-v2:__wr-j:xy-home-v2:wrjhang';
  const t0 = Date.now();
  let flushed = false;
  for (let i = 0; i < 90 && !flushed; i++) { await sleep(100); flushed = idbSetKeys.includes(markKey); }
  ok(setAllResult === false, '挂起事务 4s 判 false（修复前永久挂起）', 'result=' + setAllResult);
  ok(flushed, 'wrjMarkFlush 兜底退回逐键 idbSet，标记最终落库', '耗时 ' + Math.round((Date.now() - t0) / 100) / 10 + 's');
  ok(idbSetKeys.includes('xy-home-v2:wrjhang'), '值写入路径不受影响');
}

console.log('T3 挂起内核媒体池：mochiMediaFlush 有界返回 + 写恢复后落库');
{
  const hang = { v: true };
  const { w, store } = await loadIdb(hang);
  vm.runInContext(read('src/js/media-pool.js'), w, { filename: 'media-pool.js' });
  const data = 'data:image/gif;base64,' + 'A'.repeat(3000);
  const token = await w.mochiMediaTokenize(data);
  ok(typeof token === 'string' && token.indexOf('@@m:') === 0, '令牌已生成', String(token).slice(0, 24));
  const tokKey = 'xy-home-v2:media:' + String(token).slice(4);
  const r1 = await Promise.race([w.mochiMediaFlush().then(v => ({ v })), sleep(9000).then(() => ({}))]);
  ok(r1 && r1.v === false, '挂起内核 flush 有界返回 false（修复前 Promise 永不落地）', JSON.stringify(r1));
  hang.v = false;
  await sleep(600); // 回队后的 scheduleFlush(300ms) 自动重试
  const r2 = await w.mochiMediaFlush();
  ok(r2 === true && store.has(tokKey), '写恢复后令牌真正落库（不再静默丢）', 'r2=' + r2);
}

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
