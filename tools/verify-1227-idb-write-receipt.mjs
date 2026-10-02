// ===== 回归脚本：#1227 idbSet「超时≠失败」回执裁决 + open() settled 闸（iPhone 15 Pro Max Safari 实报）=====
// 用法：node tools/verify-1227-idb-write-receipt.mjs
//   纯 Node 行为断言（桩 IndexedDB，不开无头浏览器）。NEW＝工作树 src/js/idb.js；
//   OLD＝git show HEAD:src/js/idb.js（红侧对照；收口后两侧同源，退化为全绿防手滑）。
//   可用 MOCHI_GIT_DIR=<主仓路径> 指定 OLD 的 git 仓库（在仓外副本里跑时必传）。
// 背景（诊断实证：default:chat-msgs 单键 32.8MB、iOS 18.7、每次打开弹「存储异常」）：
//   旧实现把「本地超时」直接当「写失败」：事务其实还活着并最终写成功，却盲排 2 次重试
//   （每次重试 = 又一次整包 structured clone + 排队事务），调用方回退再追一轮 → 一次逻辑
//   保存最多 6 个全量写事务；5 连败弹「存储异常」＝假警报＋主线程卡顿双杀。
//   另 open() 的 8s 挂起兜底计时器无条件清 dbPromise：open 早已成功它照样拆缓存 →
//   每 8s 换一条新连接、旧连接无人 close（泄漏），iOS 冷启动逼近 8s 时更甚。
//   T0 静态锚点（新源码四处特征串）
//   T1 慢内核单写：超时后事务最终 oncomplete → 新：put 只 1 次且返回 true；旧：put 3 次且返回 false
//   T2 五连慢写：新：全部 true、零弹窗；旧：全部 false、弹「存储异常」（用户实报现场复刻）
//   T3 超时后迟到 onabort(QuotaExceededError)：新：回执为实锤失败 → 照常重开新事务写成功（防丢语义不变）
//   T4 open() settled 闸：新：8.5s 后连接缓存不被拆（open 计数不涨）；旧：涨到 2
//   T5 迟到 open：新：孤儿连接当场 close；旧：close 计数 0（对照）
//   T6 挂起内核（回执永不到达）：新：等满上限仍返回 false（Edge 挂起形态不回归、告警链保留）
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const gitDir = process.env.MOCHI_GIT_DIR || root;
const read = (p) => readFileSync(join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' —— ' + extra : '')); }
}

let NEW = '', OLD = '';
try {
  NEW = read('src/js/idb.js');
  OLD = execFileSync('git', ['-C', gitDir, 'show', 'HEAD:src/js/idb.js'], { maxBuffer: 1 << 26 }).toString('utf8');
} catch (e) { console.log('环境不满足：读不到 src 或 HEAD 版 idb.js（' + e.message + '）'); process.exit(2); }

// —— 桩 IndexedDB：ctl.auto=false 时 readwrite 事务不自动完成（慢/挂起内核形态），
//    由测试经 ctl.fireCompleteAll()/fireAbortAll(name) 手动投递最终回执 ——
function makeCtl() {
  return { auto: true, openDelay: 0, openCount: 0, closeCount: 0, puts: [], txns: [],
    fireCompleteAll() { this.txns.forEach(tx => { if (tx.oncomplete) { try { tx.oncomplete(); } catch (e) {} } }); },
    // 只投递前 n 个写事务的回执：旧版重试会再排新事务，全量投递会把旧版 attempt2 也救活，
    // 对照就失真——旧版必须复刻「本地判定窗已过、只有最早那笔迟到成功」的真实慢内核形态。
    fireCompleteUpTo(n) { this.txns.slice(0, n).forEach(tx => { if (tx.oncomplete) { try { tx.oncomplete(); } catch (e) {} } }); },
    fireAbortAll(name) { this.txns.forEach(tx => { tx.error = { name: name || 'UnknownError' }; if (tx.onabort) { try { tx.onabort(); } catch (e) {} } }); },
  };
}
function makeIdbStub(store, ctl) {
  const mkReq = () => ({ onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: undefined, error: null });
  return {
    open() {
      ctl.openCount++;
      const req = mkReq();
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: () => true },
          close() { ctl.closeCount++; },
          transaction(_name, mode) {
            const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
            const os = {
              put(value, key) {
                store.set(key, value);
                ctl.puts.push(key);
                ctl.txns.push(tx);
                if (ctl.auto && mode === 'readwrite') setTimeout(() => { tx.oncomplete && tx.oncomplete(); }, 1);
                return {};
              },
              delete(key) { store.delete(key); return {}; },
              clear() { store.clear(); return {}; },
              count(key) { const r = mkReq(); setTimeout(() => { r.result = store.has(key) ? 1 : 0; r.onsuccess && r.onsuccess(); }, 0); return r; },
              get(key) { const r = mkReq(); setTimeout(() => { r.result = store.has(key) ? store.get(key) : undefined; r.onsuccess && r.onsuccess(); }, 0); return r; },
              getAllKeys() { const r = mkReq(); setTimeout(() => { r.result = Array.from(store.keys()); r.onsuccess && r.onsuccess(); }, 0); return r; },
            };
            tx.objectStore = () => os;
            return tx;
          },
        };
        req.result = db;
        req.onsuccess && req.onsuccess();
      }, ctl.openDelay);
      return req;
    },
  };
}
function makeSandbox(ctl) {
  const store = new Map();
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
    indexedDB: makeIdbStub(store, ctl),
    __modals: [],
  };
  sandbox.openModal = (title) => { sandbox.__modals.push(title); return {}; };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.window = sandbox;
  return { sandbox, store };
}
async function load(src, ctl) {
  const { sandbox, store } = makeSandbox(ctl);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'idb-variant.js' });
  await sleep(60);
  return { w: sandbox, store };
}

console.log('T0 静态锚点：#1227 特征串在位');
{
  ok(NEW.includes('if (settled) return;'), 'open() settled 闸在位');
  ok(NEW.includes('if (hangFired) { try { req.result.close(); } catch (e0) {} return; }'), '迟到 open 孤儿连接当场 close 在位');
  ok(NEW.includes('if (lateOk === true) return true;'), 'idbSet 重试先等上一事务回执（不重复排队）在位');
  ok(NEW.includes('if (v) _idbFailCnt = 0;'), '迟到 oncomplete 清零连续失败计数在位');
  ok(NEW.includes('最后一次内核回执'), '弹窗文案带最后一次内核回执');
  ok(!OLD.includes('if (lateOk === true) return true;'), 'OLD 侧确为修复前形态（对照组有效）');
}

console.log('T1 慢内核单写：超时后事务最终成功 → 新只写 1 次且返回 true');
{
  const ctl = makeCtl(); ctl.auto = false;
  const { w } = await load(NEW, ctl);
  const p = w.idbSet('xy-home-v2:t1', 'v1');
  await sleep(4300); // attempt1 的 4s 判定窗到期，attempt2 正在等回执
  ctl.fireCompleteAll();
  const r = await p;
  ok(r === true, '新：返回 true（迟到回执＝其实写成功）', 'r=' + r);
  ok(ctl.puts.filter(k => k === 'xy-home-v2:t1').length === 1, '新：整包写只排队 1 次（旧版=3 次克隆风暴）', 'puts=' + ctl.puts.length);
  const ctl2 = makeCtl(); ctl2.auto = false;
  const o = await load(OLD, ctl2);
  const p2 = o.w.idbSet('xy-home-v2:t1', 'v1');
  await sleep(4300); ctl2.fireCompleteUpTo(1); // 只有 attempt1 的事务迟到成功
  const r2 = await p2;
  ok(r2 === false, '旧：同场景返回 false（假警报根源）', 'r=' + r2);
  ok(ctl2.puts.filter(k => k === 'xy-home-v2:t1').length >= 3, '旧：同场景排队 ≥3 次全量写', 'puts=' + ctl2.puts.length);
}

console.log('T2 五连慢写（用户实报现场）：新零弹窗；旧弹「存储异常」');
{
  const ctl = makeCtl(); ctl.auto = false;
  const { w } = await load(NEW, ctl);
  const ps = [];
  for (let i = 0; i < 5; i++) ps.push(w.idbSet('xy-home-v2:t2-' + i, 'v' + i));
  await sleep(4300); ctl.fireCompleteAll();
  const rs = await Promise.all(ps);
  ok(rs.every(v => v === true), '新：5 个写全部按成功收场', JSON.stringify(rs));
  ok(w.__modals.length === 0, '新：不弹「存储异常」（迟到回执清零）', 'modals=' + JSON.stringify(w.__modals));
  const ctl2 = makeCtl(); ctl2.auto = false;
  const o = await load(OLD, ctl2);
  const ps2 = [];
  for (let i = 0; i < 5; i++) ps2.push(o.w.idbSet('xy-home-v2:t2-' + i, 'v' + i));
  await sleep(4300); ctl2.fireCompleteUpTo(5); // 只有 5 笔 attempt1 迟到成功
  const rs2 = await Promise.all(ps2);
  ok(rs2.every(v => v === false), '旧：5 个写全部误判失败', JSON.stringify(rs2));
  ok(o.w.__modals.includes('存储异常'), '旧：复刻出用户看到的弹窗（对照成立）', 'modals=' + JSON.stringify(o.w.__modals));
}

console.log('T3 超时后迟到 onabort(QuotaExceededError)：回执为实锤 → 照常重试新事务');
{
  const ctl = makeCtl(); ctl.auto = false;
  const { w, store } = await load(NEW, ctl);
  const p = w.idbSet('xy-home-v2:t3', 'v3');
  await sleep(4300);
  ctl.fireAbortAll('QuotaExceededError'); // 上一事务实锤失败
  ctl.auto = true; // 恢复健康内核：新排队的 attempt2 正常完成
  const r = await p;
  ok(r === true, '新：实锤失败后仍走重试并写成功', 'r=' + r);
  ok(ctl.puts.filter(k => k === 'xy-home-v2:t3').length === 2, '新：共 2 次排队（超时 1 + 重试 1）', 'puts=' + ctl.puts.length);
  ok(store.get('xy-home-v2:t3') === 'v3', '值真正落库');
}

console.log('T4 open() settled 闸：8.5s 后健康连接缓存不被拆');
{
  const ctl = makeCtl();
  const { w } = await load(NEW, ctl);
  await w.idbSet('xy-home-v2:t4a', 'x');
  const n1 = ctl.openCount;
  await sleep(8500);
  await w.idbSet('xy-home-v2:t4b', 'x');
  ok(ctl.openCount === n1, '新：计时器不再无条件重开连接（open 计数不涨）', 'before=' + n1 + ' after=' + ctl.openCount);
  const ctl2 = makeCtl();
  const o = await load(OLD, ctl2);
  await o.w.idbSet('xy-home-v2:t4a', 'x');
  await sleep(8500);
  await o.w.idbSet('xy-home-v2:t4b', 'x');
  ok(ctl2.openCount >= 2, '旧：每 8s 必换一条连接（泄漏对照组成立）', 'opens=' + ctl2.openCount);
}

console.log('T5 迟到 open（8s 判挂起后连接才到）：新当场 close 孤儿连接');
{
  const ctl = makeCtl(); ctl.openDelay = 9000;
  const { w } = await load(NEW, ctl);
  const r1 = await w.idbGet('xy-home-v2:t5').then(v => v, () => undefined);
  ok(r1 === undefined, '新：挂起期读取按失败落地（不卡调用方）');
  await sleep(1500);
  ok(ctl.closeCount === 1, '新：迟到的孤儿连接被 close（不再泄漏）', 'closes=' + ctl.closeCount);
  const r2 = await w.idbGet('xy-home-v2:t5');
  ok(r2 === undefined, '新：随后重建连接照常可用');
  const ctl2 = makeCtl(); ctl2.openDelay = 9000;
  const o = await load(OLD, ctl2);
  await o.w.idbGet('xy-home-v2:t5');
  await sleep(1500);
  ok(ctl2.closeCount === 0, '旧：同场景连接被晾着不 close（对照成立）', 'closes=' + ctl2.closeCount);
}

console.log('T6 真挂起内核（回执永不到达）：等满上限仍返回 false，告警链保留');
{
  const ctl = makeCtl(); ctl.auto = false;
  const { w } = await load(NEW, ctl);
  const t0 = Date.now();
  const r = await w.idbSet('xy-home-v2:t6', 'v6');
  ok(r === false, '新：挂起写仍判失败（防丢语义与旧版一致）', 'r=' + r);
  ok(Date.now() - t0 >= 12000, '新：每 attempt 各等满 lim+回执上限（有界，非永久挂起）', 'ms=' + (Date.now() - t0));
}

console.log('');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
