// #1250 更新后「存储修复引导」一次性弹窗的行为回归（纯 Node vm 桩，无头浏览器不需要）
// 断言对象＝src/js/storage-guide.js 的六条契约：
//  ① 去重：LS 标记命中＝永不弹；② 双复核：LS 空但 IDB 标记在＝不弹＋回写 LS；
//  ③ 没送达＝数据就绪后 4s 弹一次（同会话第二次 gate 不再弹）；
//  ④ 弹即落盘标记（LS＋idbSet 双写）；⑤ 确定按钮＝直连 window.mochiMediaRebuild，
//     结果/异常都有回执弹窗；环境无 rebuild 时按钮降级「知道了」且点击零副作用；
//  ⑥ idbGet 挂/拒＝fail-open 照弹（宁可多弹一次也不错过受灾用户）。
// 零机型分支自检：源码不得出现 navigator.userAgent／具体机型字面。
// B1（基线对照，可选）：设 MOCHI_BASE_INDEX＝纯 HEAD 副本的 index.html，断言其 JS 清单
// 不含 storage-guide（红侧＝HEAD 根本没有这个功能）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src', 'js', 'storage-guide.js');
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } };

const GUIDE_ID = '1250';
const FLAG_KEY = 'xy-home-v2:storage-guide-shown';

function makeEnv({ lsSeed = {}, idbVal, idbMode = 'resolve' } = {}) {
  const timers = [];
  const lsMap = new Map(Object.entries(lsSeed));
  const modals = [];
  const toasts = [];
  const rebuildCalls = [];
  let rebuildImpl = null;
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => { lsMap.set(k, v); },
    removeItem: (k) => { lsMap.delete(k); },
  };
  // #1263 环境建模：让路闸到点会读 document.getElementById('modal-mask') 的可见态——
  // 本文件测的是「无其它弹窗占用」这一常规环境 ⇒ 桩返回 null（=没有弹窗开着），引导照旧弹；
  // 「弹窗被占用时让路重试」的行为由 verify-1263 在真无头浏览器里独立断言，不在此文件重复。
  const document = { addEventListener: () => {}, getElementById: () => null };
  const window = {
    localStorage,
    toast: (m) => { toasts.push(m); },
    openModal: (t, v, cb, opts) => {
      const rec = { title: t, cb, opts: opts || {}, okBtnText: '确定' };
      modals.push(rec);
      return { okText: (s) => { rec.okBtnText = s; } };
    },
    idbGet: () => (idbMode === 'reject' ? Promise.reject(new Error('hang'))
      : idbMode === 'throw' ? (() => { throw new Error('boom'); })()
      : Promise.resolve(idbVal)),
    idbSet: () => Promise.resolve(true),
    mochiOnDataReady: null,
  };
  window.mochiMediaRebuild = function (prog) { rebuildCalls.push(prog); return rebuildImpl(); };
  const listeners = [];
  window.mochiOnDataReady = (fn) => { listeners.push(fn); };
  const ctx = vm.createContext({
    window, document, localStorage,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    Date, Promise, JSON, console,
  });
  const src = readFileSync(SRC, 'utf8');
  vm.runInContext(src, ctx, { filename: 'storage-guide.js' });
  async function settle(rounds = 6) { for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r)); }
  function runAllTimers() { const q = timers.splice(0); q.forEach((t) => t.fn()); return q.length; }
  function lastModal() { return modals[modals.length - 1] || null; }
  return {
    window, modals, toasts, rebuildCalls, listeners, lsMap,
    gate: () => listeners.forEach((f) => f()),
    settle, runAllTimers, lastModal,
    setRebuild: (fn) => { rebuildImpl = fn; },
    disableRebuild: () => { delete window.mochiMediaRebuild; },
  };
}

const okRep = { ok: true, poolN: 10, validN: 6, brokenN: 4, foundN: 8, bytes: 1000, alreadyOk: 5, written: 3, writeFail: 0 };

async function main() {
  console.log('#1250 storage-guide 行为回归');

  // S1 注册：走 mochiOnDataReady 双层契约
  {
    const env = makeEnv();
    ok(env.listeners.length === 1, 'S1 gate 经 mochiOnDataReady 注册（1 个监听）');
  }
  // S2 LS 标记命中＝不弹、不查 IDB
  {
    const env = makeEnv({ lsSeed: { [FLAG_KEY]: GUIDE_ID } });
    env.gate();
    await env.settle();
    env.runAllTimers();
    ok(env.modals.length === 0, 'S2 已送达标记在 LS＝永不弹');
  }
  // S3 全空＝就绪后 4s 弹一次；弹即双写标记；重复 gate 不再弹
  {
    const env = makeEnv({ idbMode: 'resolve', idbVal: undefined });
    env.setRebuild(() => Promise.resolve(okRep));
    env.gate();
    await env.settle();
    const fired = env.runAllTimers();
    await env.settle();
    ok(fired >= 1 && env.modals.length === 1, 'S3a 未送达＝弹一次（延迟定时器放行后）');
    const m = env.lastModal();
    ok(m && m.okBtnText === '立即自愈图片', 'S3b 有 rebuild 时确定按钮＝立即自愈图片');
    ok(env.lsMap.get(FLAG_KEY) === GUIDE_ID, 'S3c 弹即写 LS 标记');
    env.gate();
    await env.settle();
    env.runAllTimers();
    await env.settle();
    ok(env.modals.length === 1, 'S3d 同会话重复 gate 不再弹');
    // 确定＝直连重建
    m.cb(null);
    await env.settle();
    ok(env.rebuildCalls.length === 1, 'S4a 点确定触发 mochiMediaRebuild');
    ok(env.modals.length === 2 && env.lastModal().title === '图片自愈结果' && /补回 3/.test(env.lastModal().opts.staticText || ''), 'S4b 重建成功回执弹窗写明补回条数');
  }
  // S5 LS 空但 IDB 标记在＝不弹＋回写 LS
  {
    const env = makeEnv({ idbMode: 'resolve', idbVal: GUIDE_ID });
    env.gate();
    await env.settle();
    env.runAllTimers();
    await env.settle();
    ok(env.modals.length === 0, 'S5a IDB 已送达＝不弹');
    ok(env.lsMap.get(FLAG_KEY) === GUIDE_ID, 'S5b IDB 标记回写 LS（下次免异步复核）');
  }
  // S6 重建异常＝异常回执，不静默
  {
    const env = makeEnv({ idbVal: undefined });
    env.setRebuild(() => Promise.reject(new Error('kill')));
    env.gate();
    await env.settle();
    env.runAllTimers();
    await env.settle();
    env.lastModal().cb(null);
    await env.settle();
    ok(env.lastModal().title === '重建异常', 'S6 重建抛错＝异常回执弹窗');
  }
  // S6b rep.ok=false（扫描未完成）＝如实转述原因
  {
    const env = makeEnv({ idbVal: undefined });
    env.setRebuild(() => Promise.resolve({ ok: false, reason: '存储繁忙' }));
    env.gate();
    await env.settle();
    env.runAllTimers();
    await env.settle();
    env.lastModal().cb(null);
    await env.settle();
    const t = env.lastModal();
    ok(t.title === '图片自愈结果' && /存储繁忙/.test(t.opts.staticText || ''), 'S6b rep.ok=false＝转述原因＋不谎称已修');
  }
  // S7 环境无 rebuild＝按钮降级「知道了」，点击零副作用
  {
    const env = makeEnv({ idbVal: undefined });
    env.disableRebuild();
    env.gate();
    await env.settle();
    env.runAllTimers();
    await env.settle();
    const m = env.lastModal();
    ok(m && m.okBtnText === '知道了', 'S7a 无 rebuild 符号＝按钮降级知道了');
    m.cb(null);
    await env.settle();
    ok(env.rebuildCalls.length === 0 && env.modals.length === 1, 'S7b 降级后点确定零副作用');
  }
  // S8 idbGet 挂/拒/抛＝fail-open 照弹（错过受灾用户的代价大于多弹一次）
  {
    for (const mode of ['reject', 'throw']) {
      const env = makeEnv({ idbMode: mode, idbVal: undefined });
      env.setRebuild(() => Promise.resolve(okRep));
      env.gate();
      await env.settle();
      env.runAllTimers();
      await env.settle();
      ok(env.modals.length === 1, 'S8 idbGet ' + mode + '＝fail-open 照弹');
    }
  }
  // Z1 零机型分支
  {
    const src = readFileSync(SRC, 'utf8');
    ok(!/userAgent/i.test(src), 'Z1a 源码不含 navigator.userAgent');
    // 机型/浏览器字面允许出现在「给用户指路」的文案里（如 iPhone 设置→Safari→网站数据），
    // 禁的是拿它们当判定分支——探测类调用一概不许出现。
    ok(!/navigator\.(platform|maxTouchPoints|hardwareConcurrency)|window\.(ApplePaySession|MSStream)|MicroMessenger|\bisIOS\b|\biPhone\s*=|criOS/i.test(src), 'Z1b 零设备探测分支（判定只取代码事实）');
  }
  // B1 基线对照（可选）：纯 HEAD 副本产物不含本功能
  {
    const base = process.env.MOCHI_BASE_INDEX;
    if (base) {
      const html = readFileSync(base, 'utf8');
      ok(!html.includes('storage-guide.js'), 'B1 基线产物 JS 清单不含 storage-guide（红侧＝HEAD 无此功能）');
    } else {
      console.log('  - B1 SKIP（未设 MOCHI_BASE_INDEX）');
    }
  }
  const r = readFileSync(SRC, 'utf8');
  ok(r.includes("const GUIDE_ID = '" + GUIDE_ID + "';"), 'C1 GUIDE_ID 常量在位');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('harness error:', e); process.exit(1); });
