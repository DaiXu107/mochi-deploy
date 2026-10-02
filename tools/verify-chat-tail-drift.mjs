// 复现：尾巴日志（chat-tail）在「正文被归一化改写」后签名漂移 → 每次权威读库都回放一份
// → 同一条消息随每次「退出聊天页再进入 / 刷新」不断翻倍。
// 用户报障（iQOO Neo9 + Chrome，多机型同族）：聊天里同一条消息（我方与联系人两侧都有）
// 重复成多条；退出聊天页再进去重复出现（＝每次走权威读库 + chatTailMerge 再回放一次）。
// 本脚本抽取真实函数源码注入桩环境，重现「回放 → 正文改写 → 再回放」的累积链。
// 用法：node tools/verify-chat-tail-drift.mjs
//      MOCHI_SRC=<chat.js 路径> node tools/verify-chat-tail-drift.mjs   # 跑 RED 基线（HEAD 版源）
import { readFileSync } from 'node:fs';

const srcPath = process.env.MOCHI_SRC || new URL('../src/js/chat.js', import.meta.url);
const text = readFileSync(srcPath, 'utf8');

// 只盯「运行时日志内容」的裁剪锚点：既便于定位，也不因编号改号而失效。
function cut(start, end) {
  const s = text.indexOf(start);
  const e = text.indexOf(end, s + 1);
  if (s < 0 || e < 0 || e <= s) throw new Error('抽取失败：找不到 ' + JSON.stringify(start) + ' 或收尾锚点 ' + JSON.stringify(end));
  return text.slice(s, e);
}
// 可选裁剪：缺失时返回 ''（用于 RED 基线跑 HEAD 老源——那时 #749 的函数还不存在）
function cutOpt(start, end) {
  try { return cut(start, end); } catch (e) { return ''; }
}
// 必填裁剪：失败即退出（避免拿半截源码跑出假绿）
function cutReq(start, end) {
  try { return cut(start, end); } catch (e) { console.error(e.message); process.exit(2); }
}
const srcSig = cutReq('function chatTailSig', 'function chatTailRead');
// #749 之前没有 chatTailId——RED 基线（老源）跑时缺失属预期，注入桩还原旧口径。
const srcId = cutOpt('function chatTailId', 'function chatTailRead');
const srcRead = cutReq('function chatTailRead', 'function chatTailClear');
const srcClear = cutReq('function chatTailClear', '// 只收纯文本/轻消息');
const srcAppend = cutReq('function chatTailAppend', '// 撤回后日志里的原文不得回放');
const srcDrop = cutReq('function chatTailDrop', '// 权威读库成功后调用');
const srcMerge = cutReq('function chatTailMerge', '// v3.14.x：防「权威读取失败被当空历史」');
// chatTailAppend 依赖模块级常量（不在其上方的切片区里，漏抽＝被 try/catch 静默吞掉）
const srcFields = cutReq('const CHAT_TAIL_INTERACT_FIELDS', 'function chatTailAppend');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

function makeEnv(initialMsgs) {
  const ls = new Map();
  const saved = [];
  const store = {
    get(k) { return ls.has(k) ? ls.get(k) : null; },
    set(k, v) { ls.set(k, String(v)); },
    remove(k) { ls.delete(k); }
  };
  let msgs = initialMsgs || [];
  const env = {
    store, ls, saved,
    get msgs() { return msgs; },
    set msgs(v) { msgs = v; },
    saveMsgs() { saved.push(msgs.slice()); },
    CHAT_TAIL_MAX: 60,
    CHAT_TAIL_TEXT_MAX: 1000,
    Date, JSON, Set, Array, String, Math, console
  };
  const srcAll = [srcSig, srcId, srcRead, srcClear, srcFields, srcAppend, srcDrop, srcMerge].join('\n');
  // chatTailId 缺失（RED 基线）时给个与旧行为等价的桩：恒返回空串 ⇒ haveId 永远搜集不到东西
  // ⇒ 判重完全退回旧的 sig 口径，正是要复现的缺陷形态。
  const idShim = /function chatTailId/.test(srcAll) ? '' : 'function chatTailId(m){ return ""; }';
  const names = ['chatTailSig', 'chatTailId', 'chatTailRead', 'chatTailClear', 'chatTailAppend', 'chatTailDrop', 'chatTailMerge'];
  const fns = new Function('env', 'with (env) { ' + idShim + srcAll + ' return { ' + names.join(', ') + ' }; }')(env);
  return { env, fns, saved, lsHas: (k) => ls.has(k) };
}

const rec = (ts, side, txt, extra) => Object.assign({ ts, side, text: txt }, extra || {});

// ===== 场景 1：poke 正文被归一化改写（✉️ → ICON_ENV）=====
// 序列：发消息 → 同步写尾巴日志 → 归一化改写正文 → 下一次权威读库回放
console.log('场景 1：poke 正文归一化改写导致回放翻倍');
{
  const { env, fns } = makeEnv([]);
  const { chatTailAppend, chatTailMerge } = fns;
  const ORIG = '\u2709\uFE0F 拍了拍你';
  const NEWT = '<svg class="st-ico">env</svg> 拍了拍你'; // normCell 改写后的正文
  chatTailAppend(rec(1000, 'in', ORIG, { special: 'poke' }));
  env.msgs = [rec(1000, 'in', ORIG, { special: 'poke' })];
  // 归一化把正文改写（与真实 normCell 的 ICON_BELL/✉️ 替换同效）
  env.msgs[0].text = NEWT;
  // 第一次权威读库回放
  const n1 = chatTailMerge();
  console.log('    第 1 次读库回放条数 =', n1, '，msgs 总数 =', env.msgs.length);
  // 第二次（再次退出聊天页再进入 → 又一次权威读库）
  const n2 = chatTailMerge();
  console.log('    第 2 次读库回放条数 =', n2, '，msgs 总数 =', env.msgs.length);
  const n3 = chatTailMerge();
  console.log('    第 3 次读库回放条数 =', n3, '，msgs 总数 =', env.msgs.length);
  ok(n1 === 0, 'DR1 正文被归一化改写后不得回放（当前回放 ' + n1 + ' 条）');
  ok(env.msgs.length === 1, 'DR2 三次读库后 msgs 仍为 1 条（当前 ' + env.msgs.length + ' 条）');
}

// ===== 场景 2：普通文本消息正文被编辑/改写后回放 =====
console.log('场景 2：普通文本正文变化后回放');
{
  const { env, fns } = makeEnv([]);
  const { chatTailAppend, chatTailMerge } = fns;
  chatTailAppend(rec(2000, 'out', '原始正文'));
  env.msgs = [rec(2000, 'out', '原始正文')];
  env.msgs[0].text = '编辑后的正文';
  const n1 = chatTailMerge();
  ok(n1 === 0, 'DR3 正文变化（编辑/改写）后不得回放（当前回放 ' + n1 + ' 条）');
  ok(env.msgs.length === 1, 'DR4 msgs 仍为 1 条（当前 ' + env.msgs.length + ' 条）');
}

// ===== 场景 3：日志条目未被清理时应被「已落盘」事实吸收 =====
console.log('场景 3：日志回放后必须收敛（同一逻辑消息不得反复回放）');
{
  const { env, fns } = makeEnv([]);
  const { chatTailAppend, chatTailMerge, chatTailRead } = fns;
  chatTailAppend(rec(3000, 'in', 'hello'));
  env.msgs = [];
  const n1 = chatTailMerge();
  ok(n1 === 1, 'DR5 未落盘消息应回放（1 条，当前 ' + n1 + '）');
  const n2 = chatTailMerge();
  ok(n2 === 0, 'DR6 已回放的条目不得再回放（当前第 2 次 ' + n2 + ' 条）');
  ok(env.msgs.length === 1, 'DR7 回放后 msgs 恒为 1 条（当前 ' + env.msgs.length + ' 条）');
  console.log('    日志剩余条数 =', chatTailRead().length);
}

console.log('----');
console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail === 0 ? 0 : 1);
