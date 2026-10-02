// ===== 回归脚本：#1257 wrj 标记改挂「值事务提交回执」（自愈反噬＝收藏/设置回退旧值的根治）=====
// 用法：node tools/verify-1257-wrj-mark-on-commit.mjs [被检 idb.js 路径]
// 背景（OPPO Reno16 Chrome 实报「桌面【收藏】数据丢失」，诊断单 fav-msgs LS 4.0KB vs IDB 3.9KB，
// 多机型同现）：旧 xyStore.set 里 wrjRecord 同步 wrjMark——值事务提交失败（挂起内核/页面被回收
// 杀事务，idbSet 3 试后 resolve false，见 #1227 回执语义）标记照落 150ms 微批，库里留下
// 【旧值+新标记】；下次启动 wrjMergeFromIdb 见「标记比已知写入新」即信 IDB，把 LS 里更新的
// 真值整键覆写回旧值＝自愈通道反噬成数据回退。改：标记只在值回执 true 后补记。
//   T0 静态锚点：wrjRecord 只报时间戳、xyStore.set 持回执补记两针在场，旧「无条件标记」写法清除
//   T1 写失败（回执 false）→ 无新标记；LS/内存里的新值保住（红侧＝修复前恰在此反噬）
//   T2 提交回执 true → 标记照常经 150ms 微批落库（#166/#226 自愈通道一字未动）
//   T3 迟到回执（挂 400ms 才 true，#1227 场景）→ 标记仍落，且带本次时间戳
//   T4 LS 写日志条目不受回执门影响（回放防线 #82/#88/#229/#339 语义不变）
//   T5 大值（>64KB）仍走 wrjForget：撤日志条目＋撤旧标记，且不给新标记
//   Z1 改动块零机型／零 UA 分支
// 纯 Node vm 桩 IndexedDB（沙箱骨架同 verify-idb-setall-timeout），不开浏览器。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalize, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ? normalize(process.argv[2]) : normalize(join(here, '../src/js/idb.js'));
const src = readFileSync(target, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' —— ' + extra : '')); }
}
console.log('#1257 wrj 标记落值回执 — 被测：' + target);

// —— 桩 IndexedDB（Map 后端，事务即时完成）——
function makeIdbStub(store) {
  const mkReq = () => ({ onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: undefined, error: null });
  return {
    open() {
      const req = mkReq();
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: () => true },
          transaction() {
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
function mkLs() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] ?? null,
  };
}
async function load() {
  const store = new Map();
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder,
    crypto: globalThis.crypto,
    Event: class { constructor(t) { this.type = t; } },
    navigator: { userAgent: 'verify-node', maxTouchPoints: 0, deviceMemory: 8 },
    localStorage: mkLs(), sessionStorage: mkLs(),
    MutationObserver: class { observe() {} },
    document: { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, visibilityState: 'visible', querySelectorAll: () => [], getElementById: () => null },
    indexedDB: makeIdbStub(store),
  };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'idb.js' });
  await sleep(60); // 开屏 idbRestore（空库）链落地
  return { w: sandbox, store };
}

const MARK = 'xy-home-v2:__wr-j:xy-home-v2:';

// T0 静态锚点
{
  ok(/return t; \/\/ FIX 2026-09-25 #1257b/.test(src), 'T0a wrjRecord 只报时间戳（return t 交接针在位）');
  ok(src.includes('if (_wrjT && _p && _p.then) _p.then(function (ok) { if (ok) wrjMark(key, _wrjT); }, function () {});'), 'T0b xyStore.set 值回执补记针在位');
  ok(!/wrjPersist\(\);\s*\r?\n\s*wrjMark\(key, t\);/.test(src), 'T0c 旧「wrjRecord 尾部无条件标记」写法已清除');
}

// T1 值写失败（回执 false）→ 不留标记；LS/内存新值保住
{
  const { w, store } = await load();
  const realSet = w.idbSet;
  w.idbSet = (k, v) => { if (String(k).indexOf('__wr-j:') >= 0) return realSet(k, v); return Promise.resolve(false); };
  const st = w.xyStore('xy-home-v2');
  st.set('fav-test', '[{"text":"新收藏"}]');
  await sleep(600); // 越过 150ms 标记微批 + 200ms 日志防抖
  ok(!store.has(MARK + 'fav-test'), 'T1 写失败→无新标记（旧版此针恰红＝反噬源头）', 'store 里有标记=' + store.has(MARK + 'fav-test'));
  ok(st.get('fav-test') === '[{"text":"新收藏"}]' && w.localStorage.getItem('xy-home-v2:fav-test') === '[{"text":"新收藏"}]', 'T1b 内存+LS 新值不受影响');
}

// T2 提交回执 true → 标记经微批正常落库（自愈通道保留）
{
  const { w, store } = await load();
  const st = w.xyStore('xy-home-v2');
  st.set('sett-ok', 'v1');
  await sleep(600);
  const mt = store.get(MARK + 'sett-ok');
  ok(typeof mt === 'number' && mt > 0, 'T2 回执 true→标记落库且为时间戳', 't=' + JSON.stringify(mt));
}

// T3 迟到回执（挂起 400ms 后 true，#1227 场景）→ 标记仍落
{
  const { w, store } = await load();
  const realSet = w.idbSet;
  w.idbSet = (k, v) => { if (String(k).indexOf('__wr-j:') >= 0) return realSet(k, v); return sleep(400).then(() => realSet(k, v)); };
  const st = w.xyStore('xy-home-v2');
  st.set('late-rec', 'v2');
  await sleep(200);
  const early = store.has(MARK + 'late-rec');
  await sleep(800);
  ok(!early && typeof store.get(MARK + 'late-rec') === 'number', 'T3 迟到回执：回执前不落、落地后补记', 'early=' + early);
}

// T4 LS 写日志条目与回执无关（#82/#229/#339 回放防线语义不变）
{
  const { w } = await load();
  const realSet = w.idbSet;
  w.idbSet = (k, v) => { if (String(k).indexOf('__wr-j:') >= 0) return realSet(k, v); return Promise.resolve(false); };
  const st = w.xyStore('xy-home-v2');
  st.set('journal-x', 'v3');
  await sleep(600);
  let j = [];
  try { j = JSON.parse(w.localStorage.getItem('xy-home-v2:__wr-journal') || '[]'); } catch (e) {}
  ok(j.some((e) => e.k === 'xy-home-v2:journal-x' && e.v === 'v3'), 'T4 值写失败时 LS 日志条目照记（回放防线不动）');
}

// T5 大值（>64KB）→ wrjForget：旧日志条目与旧标记一并撤销，且不落新标记
{
  const { w, store } = await load();
  const st = w.xyStore('xy-home-v2');
  st.set('big-x', 'small');
  await sleep(600);
  const hadMark = store.has(MARK + 'big-x');
  st.set('big-x', 'x'.repeat(70 * 1024));
  await sleep(600);
  let j = [];
  try { j = JSON.parse(w.localStorage.getItem('xy-home-v2:__wr-journal') || '[]'); } catch (e) {}
  ok(hadMark && !store.has(MARK + 'big-x') && !j.some((e) => e.k === 'xy-home-v2:big-x'), 'T5 大值仍走 wrjForget 撤条目撤标记（#628 语义不变）', 'had=' + hadMark);
}

// Z1 零机型／零 UA：xyStore.set 函数块（剥注释后）不含机型判定
{
  const i = src.indexOf('set(k, v) {');
  let d = 0, seg = '';
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) { seg = src.slice(i, k + 1); break; } } }
  const code = seg.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!!seg && !/userAgent|iPhone|iPad|Android|Chrome|Edge|HarmonyOS|XiaoMi|Redmi|OPPO|vivo/i.test(code), 'Z1 写路径判定只取内核回执三态（零机型分支）');
}

console.log('结果 ' + pass + '/' + fail);
process.exit(fail ? 1 : 0);
