// verify-msg-swallow.mjs — #814「我发的/联系人发的消息莫名被吞」修复回归（行为断言，纯 src 提取，构建前后均可跑）
// 根因（荣耀畅玩40 Plus + 夸克实报，多机型同现）：副本通道已全部收口到身份级（#744 同对象/
// #776 出生号/#796 卡片短闩；重投副本必同 ts）之后，仍按「内容相同＋相邻＋时间窗」判定的两层
// 去重能命中的只剩【真发的合法第二条】：
//   ①addRec 实时窗 in 侧文本 2500ms/媒体 60000ms 静默吞（收件侧无 toast）；
//   ②normCollapseRange 刷新归一化把实时层跳过的 special 卡与历史里的跨毫秒同文从库里删掉并
//     落盘固化＝「之前发出来的消息被吞」。
// 修复契约：
//   S1~S5 normCollapseRange 只回并【同 ts】副本（跨毫秒内容窗停用）；
//   S6~S8 addRec 实时正文窗只拦 out 侧（#437 800ms 机械双派发＋toast 原样），身份闸门零改动；
//   S9~S11 genOneReply 源头重掷防「同款两张」（替代事后吞）；
//   S12~S13 #814d 探针与诊断体检行在位。
// 跑法：node tools/verify-msg-swallow.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
const devSrc = readFileSync(join(root, 'src', 'js', 'device.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name + (detail !== undefined ? ' [' + detail + ']' : '')); } };

function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数 ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('花括号不配平：' + name);
}

const pool = new Map();
const TOK = (h) => '@@m:' + h;
const constLine = (src.match(/const DUP_GAP_TEXT = 2500, DUP_GAP_MEDIA = 60000;/) || [])[0];
if (!constLine) throw new Error('未找到 DUP_GAP 窗口常量声明');

// ===== 沙箱：normCollapseRange（#814b 行为）=====
const cuts = [];
function mkNorm(msgList) {
  const f = new Function('__POOL__', '__CUTS__', '__MSGS__', `
    const window = {
      mochiMediaIsToken: (s) => typeof s === 'string' && /^@@m:[0-9a-f]{32}$/.test(s),
      mochiMediaExpand: (s) => { const m = /^@@m:([0-9a-f]{32})$/.exec(s || ''); return m ? (pool.get(m[1]) || null) : null; },
      __mochiMsgCut: __CUTS__
    };
    const pool = __POOL__;
    let msgs = __MSGS__;
    let normRemovedRecs = null;
    function chatMsgCutMark(tag, m) { __CUTS__.push(tag); }
    ${constLine}
    ${extractFn('mediaFormText')}
    ${extractFn('mediaTxtEq')}
    ${extractFn('dupGapMs')}
    ${extractFn('dupSig')}
    ${extractFn('normCollapseRange')}
    return { run: () => normCollapseRange(0, msgs.length), msgs };
  `);
  return f(pool, cuts, msgList);
}
const imgA = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(120) + 'ENDa';
pool.set('a'.repeat(32), imgA);

const t0 = 1780000000000;
// S1 in 侧同文不同 ts（TA 真发的合法第二条）→ 不删
{
  const m = mkNorm([{ side: 'in', text: '嗯', ts: t0 }, { side: 'in', text: '嗯', ts: t0 + 1500 }]);
  ok('S1 in 侧同文 1.5s 两条 → 刷新归一化不回吞（修前删 1＝被吞）', m.run() === 0 && m.msgs.length === 2);
}
// S2 同 ts 跨形式副本（重投本体形态）→ 收敛 1
{
  const m = mkNorm([{ side: 'in', text: imgA, ts: t0 }, { side: 'in', text: TOK('a'.repeat(32)), ts: t0 }]);
  ok('S2 同 ts 跨形式副本 → 仍收敛为 1（身份级防重零回退）', m.run() === 1 && m.msgs.length === 1);
}
// S3 special 拍一拍卡同文不同 ts（30s 内两次触发）→ 不删（旧 60000ms 窗专吃 special）
{
  const m = mkNorm([{ side: 'in', special: 'poke', text: '拍了拍对方', ts: t0 }, { side: 'in', special: 'poke', text: '拍了拍对方', ts: t0 + 30000 }]);
  ok('S3 special 卡同文 30s 两条 → 不删（修前 60s 窗回吞并固化）', m.run() === 0 && m.msgs.length === 2);
}
// S4 out 侧历史同文不同 ts → 刷新层不追溯删（发送时 800ms 实时层才管机械双击）
{
  const m = mkNorm([{ side: 'out', text: '好', ts: t0 }, { side: 'out', text: '好', ts: t0 + 600 }]);
  ok('S4 out 侧 600ms 同文两条 → 刷新归一化不追溯删（发出去的不得消失）', m.run() === 0 && m.msgs.length === 2);
}
// S5 dedupExempt 豁免契约不变（#544b needle 行为面）
{
  const m = mkNorm([{ side: 'in', text: '【帮我决定】A → B', ts: t0, dedupExempt: true }, { side: 'in', text: '【帮我决定】A → B', ts: t0 }]);
  ok('S5 dedupExempt 同 ts 副本也不删（#544 豁免语义不变）', m.run() === 0 && m.msgs.length === 2);
}
// S6 探针在收敛时留痕
ok('S6 normCollapseRange 收敛调用 chatMsgCutMark（g814ts）', cuts.indexOf('g814ts') === 0, 'cuts=' + JSON.stringify(cuts));

// ===== 沙箱：genOneReply 源头重掷（#814c 行为）=====
// 抽卡内核 genOneReplyDraw 打桩（按脚本序列出卡），外壳与签名函数从 src 原样提取求值。
function mkGen2(seq) {
  const f = new Function('seq', `
    let n = 0;
    const window = { __activeCid: 'c1' };
    let __genLastCid = null, __genLastSig = '';
    function genOneReplyDraw() { const r = seq[n]; n++; return r; }
    ${extractFn('chatGenRepSig')}
    ${extractFn('genOneReply')}
    return genOneReply;
  `);
  return f(seq);
}
try {
  const g = mkGen2([{ text: 'x', type: 'text' }, { text: 'x', type: 'text' }, { text: 'y', type: 'text' }]);
  const r1 = g(null), r2 = g(null);
  ok('S7 连抽同卡 → 当场重掷换第二张（源头防，不靠事后吞）', r1.text === 'x' && r2.text === 'y', r1.text + '/' + r2.text);
} catch (e) { ok('S7 连抽同卡 → 当场重掷换第二张（源头防，不靠事后吞）', false, e.message); }
try {
  const g = mkGen2([{ text: 'x', type: 'text' }, { text: 'x', type: 'text' }, { text: 'x', type: 'text' }]);
  const r1 = g(null), r2 = g(null);
  ok('S8 池小重掷仍同 → 照常返回同款两张（宁重复不吞）', r1.text === 'x' && r2.text === 'x');
} catch (e) { ok('S8 池小重掷仍同 → 照常返回同款两张（宁重复不吞）', false, e.message); }

// ===== addRec 接线静态锚（源码级）=====
ok('T1 addRec 实时正文窗只拦发件侧（#814 收件侧停吞）', /&& !rec\.dedupExempt && \(rec\.side \|\| ''\) === 'out'; i--/.test(src));
ok('T2 #544a 豁免闸 needle 原样在位', src.includes('i >= Math.max(0, len - 5) && !rec.dedupExempt'));
ok('T3 发件侧命中 toast 原样（#437 反馈）', src.includes("toast('同样的内容刚发送过，未重复发送')"));
ok('T4 身份闸门零改动（#744 同对象／#776 keysShare；#796 卡片短闩不在本批收口面、由 verify-out-card-latch.mjs 自守）',
  src.includes('if (len && msgs[len - 1] === rec) {')
  && src.includes('if (!chatRecKeysShare(p, rec)) continue;'));
ok('T5 #544b 刷新侧豁免 needle 原样', src.includes('if (a.dedupExempt || b.dedupExempt) continue; // FIX 2026-09-15 #544'));
ok('T6 genOneReply 抽卡内核更名且各调用点走外壳', src.includes('function genOneReplyDraw(c) {') && (src.match(/genOneReplyDraw\(/g) || []).length >= 3);
ok('T7 探针本体在位（环形 40）', src.includes('window.__mochiMsgCut = window.__mochiMsgCut || [];') && src.includes('if (a.length > 40) a.shift();'));
ok('T8 device.js 消息被吞体检行在位', devSrc.includes('消息被吞体检：本会话防重层共切'));
ok('T9 决策答案豁免发送链零改动', (() => {
  const dec = readFileSync(join(root, 'src', 'js', 'decision.js'), 'utf8');
  const gdec = readFileSync(join(root, 'src', 'js', 'group-decision.js'), 'utf8');
  return dec.includes('dedupExempt: true') && gdec.includes('dedupExempt: true');
})());

// ===== 探针行为（chatMsgCutMark）=====
try {
  // chatMsgCutMark 读 window.__mochiMsgCut——初始化行在文件顶层，沙箱里手工预置
  const g = new Function(`
    const window = { __mochiMsgCut: [] };
    ${extractFn('chatMsgCutMark')}
    for (let i = 0; i < 45; i++) chatMsgCutMark('t' + i, { side: 'in', text: 'x' });
    return window.__mochiMsgCut;
  `);
  const ring = g();
  ok('P1 探针环形封顶 40 条、含 tag 与侧向', ring.length === 40 && ring[39].indexOf(':t44:in:') > 0, 'len=' + ring.length);
} catch (e) { ok('P1 探针环形封顶 40 条、含 tag 与侧向', false, e.message); }

// ===== 持久化半边行为：runPersist 节流等待期不得丢写手（#814 收口会话补充定位）=====
// 旧缺陷：runPersist 先取走 persistRun 再判 PERSIST_MIN_GAP，命中等待分支时挂出的
// setTimeout(runPersist) 重跑读到的是已清空的槽＝这次整包写静默丢弃且永不重试
// （G1 浏览器级复现：第二条消息只进尾巴日志，chat-msgs 基准包/备份导出永远看不到它）。
try {
  let savedCalls = 0;
  const g = new Function(`
    const PERSIST_MIN_GAP = 2500;
    let lastPersistAt = 0, persistTimer = null, persistRun = null;
    let NOW = 1000, parked = null;
    const performance = { now: () => NOW };
    const setTimeout = (fn) => { parked = fn; return 1; };
    ${extractFn('runPersist')}
    return {
      put(fn) { persistRun = fn; },
      peek() { return persistRun; },
      setNow(v) { NOW = v; },
      fire() { const f = parked; parked = null; if (f) f(); runPersist(); },
      runNow() { runPersist(); }
    };
  `);
  const box = g();
  const w = () => { savedCalls++; };
  box.put(w);
  box.runNow(); // 距上次落盘 1000ms < 2500ms ＝ 命中节流等待分支
  ok('P2a 节流等待期待写槽保留（旧实现此处已清空＝整包写静默蒸发）', box.peek() === w);
  box.setNow(4000);
  box.fire(); // 等待期满，推迟回调重跑
  ok('P2b 推迟回调按期执行写手（旧实现槽已空＝永不落盘）', savedCalls === 1 && box.peek() === null);
} catch (e) { ok('P2a 节流等待期待写槽保留', false, e.message); ok('P2b 推迟回调按期执行写手', false, e.message); }

console.log(`verify-msg-swallow: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
