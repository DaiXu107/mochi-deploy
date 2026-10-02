// verify-wrj-replay-no-stomp.mjs —— #339 LS 回滚家族第五层行为断言（纯 node vm，无浏览器）
// 跑法：node tools/verify-wrj-replay-no-stomp.mjs
//
// 症状（用户 2026-09-11）：改「默认字卡概率/回复速度/emoji 概率」等设置后退浏览器/挂后台，
// 再进去变回默认值，多机型同发（#82/#88/#226/#229/#233/#265 同家族第五次以上复发）。
//
// 根因（idb.js wrjReplay）：写路径顺序＝LS 日志→LS 值→IDB 值→(≤150ms 微批)IDB 标记。
// 杀进程回滚 localStorage 后，LS 值与 LS 日志【同批】退回上次磁盘提交（日志条目=旧值），
// 而 IDB 值+标记早已落库（更新）。旧实现启动回放把日志旧值 idbSet 回写 IDB——踩掉新值；
// 随后 wrjMergeFromIdb 按「标记比已知新→取 IDB 值自愈」读到的恰是被踩掉的旧值，
// 自愈被自己的回放废掉 = 「改完就退」的最近一次设置改动 100% 丢失。
//
// 断言：
//  A 源码锚：WRJ_REPLAY_NO_IDB 守卫在位（=true）且回放内 idbSet 走守卫
//  B 绿（修复态）：回滚日志回放【不回写 IDB】（仿真 IDB 收不到对业务键的 put），
//    且 merge 按 IDB 标记把 内存+LS 自愈回新值 'NEW'
//  C 红（回归态）：守卫翻转 = false 时，回放把旧值 put 进 IDB（踩踏复现），
//    最终读取=旧值 'OLD'（用户症状复现）
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/js/idb.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? ' —— ' + extra : '')); }
};

// —— A 源码锚 ——
ok(/var WRJ_REPLAY_NO_IDB = true;/.test(src), 'A1 修复锚：WRJ_REPLAY_NO_IDB = true 在位');
ok(/if \(!WRJ_REPLAY_NO_IDB\) \{ try \{ if \(window\.idbSet\) window\.idbSet\(e\.k, e\.v\); \} catch \(e2\) \{\} \}/.test(src),
  'A2 修复锚：回放内 idbSet 已包进守卫（无条件回写不存在）');

// —— 仿真环境 ——
const KEY = 'xy-home-v2:K';
const MARK = 'xy-home-v2:__wr-j:' + KEY;

function makeFakeIdb() {
  const puts = []; // [k, v] 全部落库记录
  const store = new Map();
  const api = {
    puts, store,
    open() {
      const req = {};
      setTimeout(() => {
        const db = {
          transaction() {
            const ops = [];
            const tx = {
              oncomplete: null, onerror: null, onabort: null,
              objectStore() {
                return {
                  put(v, k) { ops.push([k, v]); },
                  get(k) {
                    const r = { result: undefined, onsuccess: null, onerror: null };
                    setTimeout(() => { r.result = store.get(k); if (r.onsuccess) r.onsuccess({ target: r }); }, 0);
                    return r;
                  },
                  getAllKeys() {
                    const r = { result: undefined, onsuccess: null, onerror: null };
                    setTimeout(() => { r.result = Array.from(store.keys()); if (r.onsuccess) r.onsuccess({ target: r }); }, 0);
                    return r;
                  }
                };
              }
            };
            setTimeout(() => {
              ops.forEach(([k, v]) => { store.set(k, v); puts.push([k, v]); });
              if (tx.oncomplete) tx.oncomplete();
            }, 0);
            return tx;
          }
        };
        req.result = db;
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    }
  };
  // IDB 权威态：业务键=新值 'NEW'，每键时间戳标记=200（比回滚日志的 t=100 新）
  store.set(KEY, 'NEW');
  store.set(MARK, 200);
  return api;
}

function makeSandbox(idb) {
  const lsMap = new Map();
  const ssMap = new Map();
  const listeners = {};
  const documentStub = {
    visibilityState: 'visible',
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach(fn => { try { fn(); } catch (e) {} }); return true; }
  };
  const w = {
    console,
    setTimeout: (fn, ms) => setTimeout(fn, (ms || 0) > 100 ? 30 : (ms || 0)), // 压短挂起守卫/15s 兜底
    clearTimeout, Promise, Event,
    indexedDB: idb,
    document: documentStub,
    navigator: { deviceMemory: 8 },
    addEventListener() {}, removeEventListener() {},
    sessionStorage: {
      getItem: k => (ssMap.has(k) ? ssMap.get(k) : null),
      setItem: (k, v) => { ssMap.set(k, String(v)); },
      removeItem: k => { ssMap.delete(k); }
    },
    __fire: (t) => { (listeners[t] || []).forEach(fn => fn()); }
  };
  w.window = w;
  w.globalThis = w;
  w.localStorage = {
    getItem: k => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => { lsMap.set(k, String(v)); },
    removeItem: k => { lsMap.delete(k); },
    key: i => Array.from(lsMap.keys())[i] || null,
    get length() { return lsMap.size; }
  };
  // LS 回滚后的磁盘态：日志幸存但条目=旧值（t=100），业务键本身已被回滚（缺失）
  lsMap.set('xy-home-v2:__wr-journal', JSON.stringify([{ k: KEY, v: 'OLD', t: 100 }]));
  return { w, lsMap };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runScenario(sourceLabel, sourceText) {
  const idb = makeFakeIdb();
  const { w, lsMap } = makeSandbox(idb);
  vm.runInNewContext(sourceText, w, { filename: sourceLabel });
  // 开屏回放（模块加载时同步跑）后，等异步链：restore → merge → heal
  w.__fire('mochi-restore-done');
  await sleep(400);
  await sleep(400);
  return {
    idb, lsMap, w,
    getVal: () => { try { return w.xyStore('xy-home-v2').get('K'); } catch (e) { return 'ERR:' + e.message; } },
    getLs: () => (lsMap.has(KEY) ? lsMap.get(KEY) : null)
  };
}

// —— B 绿（修复态）——
const g = await runScenario('idb.js', src);
ok(!g.idb.puts.some(([k, v]) => k === KEY && v === 'OLD'),
  'B1 回放不回写 IDB：仿真 IDB 未收到对业务键的旧值 put（踩踏不发生）',
  JSON.stringify(g.idb.puts.slice(0, 5)));
ok(g.getVal() === 'NEW', 'B2 wrjMergeFromIdb 自愈生效：内存读回新值 NEW', String(g.getVal()));
ok(g.getLs() === 'NEW', 'B3 自愈同步写回 LS：localStorage=NEW', String(g.getLs()));
ok(g.idb.store.get(KEY) === 'NEW', 'B4 IDB 权威值未被踩掉：仍为 NEW', String(g.idb.store.get(KEY)));

// —— C 红（回归态：守卫翻转=旧实现无条件回写）——
const redSrc = src.replace('var WRJ_REPLAY_NO_IDB = true;', 'var WRJ_REPLAY_NO_IDB = false;');
if (redSrc === src) {
  ok(false, 'C0 守卫翻转补丁未命中（源码结构变了，先修 A 组锚再跑）');
} else {
  const r = await runScenario('idb-red.js', redSrc);
  ok(r.idb.puts.some(([k, v]) => k === KEY && v === 'OLD'),
    'C1 守卫翻转后踩踏复现：回放把旧值 put 进 IDB（证明 B1 断言真的拦得住）',
    JSON.stringify(r.idb.puts.slice(0, 5)));
  ok(r.getVal() === 'OLD' || r.idb.store.get(KEY) === 'OLD',
    'C2 红态用户症状复现：读到/落库的是被踩掉的旧值 OLD',
    'get=' + String(r.getVal()) + ' idb=' + String(r.idb.store.get(KEY)));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
