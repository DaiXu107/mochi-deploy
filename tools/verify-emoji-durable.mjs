// verify-emoji-durable.mjs — #434 表情包落盘确认回归（加完退出浏览器重进丢失族）
// 提取 chat.js / chatcard.js 真实函数体，桩化 idbSet/toast/定时器，断言：
//   T1 直接保存路径：xyStore.set 落笔后立即发起 idbSet 落盘确认
//   T2 idbSet 失败 → 退避重发且每次取当前内存快照（不覆盖新数据）
//   T3 连续失败穷尽 → 明确提示一次、pending 保持
//   T5 闸门路径取回失败(ok=false) → 不写回（防小包顶掉 IDB 全量）但调度重试整条保存链
//   T6 闸门路径取回 null（新用户空库）→ 放行落笔+发起确认
//   T7 离页/回前台补写闸：pending 时 visibilitychange 再发一次写
//   T8 字卡库 ccEnsureDurable 同族行为（失败重发取当前库快照、成功清 pending）
//   T9 闸门重试有上限（myeGateRetry 封顶，不会无限重试）
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } }

function makeTimers() {
  let seq = 0; const q = new Map();
  return {
    setTimeout(fn, d) { const id = ++seq; q.set(id, { fn, d: d || 0 }); return id; },
    clearTimeout(id) { if (id) q.delete(id); },
    pending() { return q.size; },
    drain(n) { for (let i = 0; i < n && q.size; i++) { const [id, t] = [...q.entries()].sort((a, b) => a[1].d - b[1].d)[0]; q.delete(id); t.fn(); } }
  };
}
const flushMicro = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
// 重试定时器在 idbSet promise resolve 后才调度：drain 与微任务必须交替执行
const pump = async (T, n) => { for (let i = 0; i < n; i++) { T.drain(1); await flushMicro(); } };

console.log('verify-emoji-durable（#434 表情包落盘确认）');
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const start = chatSrc.indexOf('function myeSaveJson()');
const endMark = "window.addEventListener('pagehide', myeDurableFlush);";
const end = chatSrc.indexOf(endMark, start);
const iifeEnd = end < 0 ? -1 : chatSrc.indexOf('})();', end);
if (start < 0 || end < 0 || iifeEnd < 0) { console.error('chat.js 提取失败：#434 代码块不在位'); process.exit(1); }
// myEmojiSave 本体在补写闸 IIFE 之后，一并纳入（chat.js 无缩进，用括号计数找函数真实结尾）
const msStart = chatSrc.indexOf('function myEmojiSave()', iifeEnd);
if (msStart < 0) { console.error('chat.js 提取失败：myEmojiSave 不在位'); process.exit(1); }
function fnEnd(src, from) {
  let depth = 0, i = src.indexOf('{', from);
  const b0 = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return i; }
  }
  return -1;
}
const msEnd = fnEnd(chatSrc, msStart);
if (msEnd < 0) { console.error('chat.js 提取失败：myEmojiSave 结束边界'); process.exit(1); }
const myeBlock = chatSrc.slice(start, iifeEnd + '})();'.length) + '\n' + chatSrc.slice(msStart, msEnd + 1);

function buildMye(idbSetSeq, idbHydrateSeq) {
  const T = makeTimers();
  const SETS = []; const TOASTS = []; const HYDR = []; const IDB = []; const LISTENERS = {};
  const body = `
    let myGroups = GROUPS_REF;
    const myEmojiStore = function () { return { get: function () { return null; }, set: function (k, v) { SETS.push([k, v]); } }; };
    const MYE_KEY = function () { return 'xy-home-v2:my-emoji-groups'; };
    const toast = function (m) { TOASTS.push(m); };
    myeBlockSrc
    return {
      myEmojiSave: myEmojiSave, myeDurableFlush: myeDurableFlush,
      state: function () { return { pending: myeDurablePending, gateRetry: myeGateRetry, warned: myeDurableWarned }; },
      setGroups: function (g) { myGroups = g; }
    };
  `.replace('myeBlockSrc', myeBlock).replace(/`(?!)/g, '\\`');
  const fn = new Function('GROUPS_REF', 'SETS', 'TOASTS', 'W', 'DOC', 'setTimeout', 'clearTimeout',
    [['window.idbSet', 'W.idbSet'], ['window.idbHydrateKey', 'W.idbHydrateKey'], ['window.__myeIdbApplied', 'W.__myeIdbApplied'], ['window.__xyIdbDeferredKeys', 'W.__xyIdbDeferredKeys'], ['window.addEventListener', 'W.addEventListener'], ['document.addEventListener', 'DOC.addEventListener']]
      .reduce((acc, p) => acc.split(p[0]).join(p[1]), body));
  const windowStub = {
    idbSet(key, val) { IDB.push([key, val]); const r = idbSetSeq.shift(); return Promise.resolve(r === undefined ? true : r); },
    idbHydrateKey(key) { HYDR.push(key); const r = idbHydrateSeq.shift(); return Promise.resolve(r === undefined ? null : r); },
    __xyIdbDeferredKeys: [], __myeIdbApplied: undefined
  };
  const docStub = { addEventListener(t, fnn) { (LISTENERS[t] = LISTENERS[t] || []).push(fnn); } };
  const api = fn([['默认', ['data:image/png;base64,AAAA']]], SETS, TOASTS, windowStub, docStub, T.setTimeout, T.clearTimeout);
  return { api, T, sets: SETS, toasts: TOASTS, hydr: HYDR, idbSets: IDB, listeners: LISTENERS, state: api.state, windowStub };
}

// T1 直接保存（闸门关闭＝旧环境无 idbHydrateKey）
{
  const s = buildMye([true], []);
  s.api.state; // noop
  s.windowStub.idbHydrateKey = undefined;
  s.api.myEmojiSave();
  await flushMicro();
  ok(s.sets.length === 1, 'T1 xyStore.set 落笔一次');
  ok(s.idbSets.length === 1 && s.idbSets[0][0] === 'xy-home-v2:my-emoji-groups', 'T1 保存后立即发起 idbSet 落盘确认');
  ok(!s.state().pending && s.T.pending() === 0, 'T1 确认成功后 pending/定时器清零');
}
// T2 失败退避重发取当前快照
{
  const s = buildMye([false, false, true], []);
  s.windowStub.idbHydrateKey = undefined;
  s.api.myEmojiSave();
  await flushMicro();
  ok(s.T.pending() === 1, 'T2 首次失败后调度重试');
  s.api.setGroups([['新分组', ['data:image/png;base64,BBBB']]]);
  await pump(s.T, 8);
  ok(s.idbSets.length === 3, 'T2 失败重试链共发起 3 次写（1+2）');
  ok(s.idbSets[2][1].indexOf('BBBB') >= 0, 'T2 重发取当前内存快照（含新数据，不用旧包覆盖）');
  ok(!s.state().pending && s.T.pending() === 0, 'T2 成功后 pending/定时器清零');
}
// T3 穷尽失败 → 提示一次
{
  const s = buildMye([false, false, false, false, false, false, false], []);
  s.windowStub.idbHydrateKey = undefined;
  s.api.myEmojiSave();
  await pump(s.T, 20);
  ok(s.idbSets.length === 6, 'T3 最多 1+5 次写后停止（实际 ' + s.idbSets.length + '）');
  ok(s.state().pending && s.toasts.length === 1 && s.toasts[0].indexOf('补写') >= 0, 'T3 穷尽后 pending 保持且只提示一次（文案含补写）');
}
// T5 闸门路径取回失败 → 不写回但调度重试
{
  const s = buildMye([], [false, false]);
  const r = s.api.myEmojiSave();
  await flushMicro();
  ok(r === true, 'T5 myEmojiSave 返回 true（用户动作被受理）');
  ok(s.sets.length === 0, 'T5 取回失败不盲写（防小包顶掉 IDB 全量）');
  ok(s.T.pending() === 1, 'T5 调度重试整条保存链');
  await pump(s.T, 1);
  ok(s.hydr.length === 2, 'T5 重试重走闸门取回（共 2 次 idbHydrateKey，实际 ' + s.hydr.length + '）');
  ok(s.state().gateRetry === 2, 'T5 闸门重试计数生效（实际 ' + s.state().gateRetry + '）');
}
// T6 闸门路径 null（新用户空库）→ 放行落笔+确认
{
  const s = buildMye([true], [null]);
  s.api.myEmojiSave();
  await flushMicro();
  ok(s.sets.length === 1, 'T6 null=健康确认无键，放行落笔');
  ok(s.idbSets.length === 1, 'T6 落笔后发起落盘确认');
}
// T9 闸门重试封顶
{
  const s = buildMye([], [false, false, false, false, false, false, false, false]);
  s.api.myEmojiSave();
  await pump(s.T, 30);
  ok(s.state().gateRetry <= 4, 'T9 闸门重试封顶 ≤4 次（实际 ' + s.state().gateRetry + '）');
}
// T7 离页补写闸
{
  const s = buildMye([false, true], []);
  s.windowStub.idbHydrateKey = undefined;
  s.api.myEmojiSave();
  await flushMicro();
  ok(s.state().pending, 'T7 首写失败 pending 置位');
  const vish = s.listeners.visibilitychange || [];
  ok(vish.length === 1, 'T7 visibilitychange 监听在位');
  vish[0]();
  await flushMicro();
  ok(s.idbSets.length === 2, 'T7 pending 时离页/回前台事件再发一次写');
}
// T8 chatcard ccEnsureDurable 同族
{
  const ccSrc = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8');
  const cs = ccSrc.indexOf('let ccDurableTimer = null;');
  const ce = ccSrc.indexOf('function saveGroupsNow(groups)');
  if (cs < 0 || ce < 0 || ce < cs) { console.error('chatcard.js 提取失败'); process.exit(1); }
  const ccBlock = ccSrc.slice(cs, ce);
  const T = makeTimers(); const IDB = []; const TOASTSCC = [];
  let groups = { text: [['g', ['x']]], sticker: [['默认', ['data:image/png;base64,CCC']]] };
  const fn2 = new Function('GROUPS_REF', 'SETSCC', 'W', 'setTimeout', 'clearTimeout', [['window.idbSet', 'W.idbSet']].reduce((a, p) => a.split(p[0]).join(p[1]), `
    let groups = GROUPS_REF;
    const curFullKey = function () { return 'xy-home-v2:default:cc-groups'; };
    const toast = function (m) { SETSCC.push(m); };
    ccBlockSrc
    return { ccEnsureDurable: ccEnsureDurable, setGroups: function (g) { groups = g; }, state: function () { return { pending: ccDurablePending }; } };
  `.replace('ccBlockSrc', ccBlock)));
  const api2 = fn2(groups, TOASTSCC, { idbSet(k, v) { IDB.push([k, v]); return Promise.resolve(IDB.length >= 3); } }, T.setTimeout, T.clearTimeout);
  api2.ccEnsureDurable(0);
  await flushMicro();
  ok(IDB.length === 1 && IDB[0][0] === 'xy-home-v2:default:cc-groups', 'T8 字卡库确认写发起且键正确');
  api2.setGroups({ text: [['g', ['x', 'y']]], sticker: [['默认', ['data:image/png;base64,CCC']]] });
  await pump(T, 8);
  ok(IDB.length === 3 && IDB[2][1].indexOf('"y"') >= 0, 'T8 失败重发取当前库快照（含新卡）');
  ok(!api2.state().pending && T.pending() === 0, 'T8 成功后 pending/定时器清零');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
