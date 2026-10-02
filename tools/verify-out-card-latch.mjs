// ===== #796 专项回归：聊天「发送的卡片族消息变多条」残余通道——special 卡跨毫秒双派发闩 =====
// 用户反馈（跨机型复发，#744/#766/#776 之后仍现）：发送的礼物卡/互动卡/红包/文字/图片，
// 点发送那一刻就变两条，不同手机都出现。
// 残余通道：#776 出生号闸门只在同一毫秒命中（chatRecIdKey=ts|side），#256 正文窗整条跳过
// special 卡——内核补发合成 click、低端机长任务把第二次派发压后 150~606ms（#359/#401 实测），
// 晚 1ms 即漏。修复=addRec 补【跨毫秒同内容短闩】：out 侧 special 卡与拍一拍在 800ms 内出现
// 同侧同 special＋指纹（chatRecLooseSig＋chatRecCardExtra）相同的第二份＝同一手势双派发，丢弃
// 并 toast（#437 同窗口：面板发出即关，人为重发须重开面板 ≥1s）。零机型分支。
// 用例（真实 addRec＋同族助手抽取，stub 全部外依赖，不落盘不渲染）：
//   B1  礼物卡双派发（ts+50ms，新对象新 uid）→ 只落 1 条，__mochiDupAdd 记 'lk:'，toast 1 条
//   B2  红包同金额双派发（ts+150ms）→ 只落 1 条（无正文卡靠 rpAmount 指纹认亲）
//   B3  红包不同金额 150ms 内 → 2 条（指纹不同＝两张不同的卡，放行）
//   B4  拍一拍（in 侧）同动作 50ms 内 → 只落 1 条
//   B5  礼物卡 1200ms 后再发同款 → 2 条（>800ms＝人为重发，放行）
//   B6  同毫秒互动卡克隆（uid 不同同文）→ 只落 1 条（#776 上层闸门仍在）
//   B7  纯文本 out 同文 50ms → 只落 1 条（#256 800ms 层照旧，不经本闩）
//   B8  dedupExempt out 卡 50ms 克隆 → 2 条（#544 豁免口径不变）
//   B9  in 侧 TA 礼物 50ms 克隆 → 2 条（in 侧不碰＝宁漏不误删）
//   B10 互动卡（out ask）+300ms 同文克隆 → 只落 1 条（本闩覆盖）
//   S1  源锚：#796 三条 needle 在 src/js/chat.js 各 1 处（与 build.mjs 哨兵同口径）
// 红对照：MOCHI_CHAT_FILE=<HEAD 版 chat.js> MOCHI_EXPECT=red node tools/verify-out-card-latch.mjs
//   ——旧 addRec 无闩：B1/B2/B4/B10 红（双派发各落 2 条）；B3/B5/B6/B7/B8/B9 两侧同绿（既有
//   行为不变）；S1 红（HEAD 无锚）。
// 纯 node 单元验证，不依赖不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(process.env.MOCHI_CHAT_FILE || join(root, 'src/js/chat.js'), 'utf8');

function extractFn(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error('找不到 ' + sig);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(sig + ' 花括号不配平');
}
function extractLine(src, needle) {
  const at = src.indexOf(needle);
  if (at < 0) throw new Error('找不到声明行 ' + needle);
  return src.slice(at, src.indexOf('\n', at));
}
// 红对照（HEAD 无 #796）时缺新函数给空 stub——旧 addRec 不会调用它，红判据在行为层
function extractFnOr(src, sig, fallback) {
  return src.indexOf(sig) >= 0 ? extractFn(src, sig) : fallback;
}

// ---- 组装可执行源：媒体签名助手 + 出生号 + 副本键族 + 闩指纹 + addRec 本体 ----
const prelude = 'const DUP_GAP_TEXT = 2500, DUP_GAP_MEDIA = 60000;\n';
const parts = [
  prelude,
  'function mediaFormText(v) { return (v == null) ? "" : String(v); }\n', // 令牌展开 stub（场景全用短原文）
  extractFn(src, 'function mediaSigPart('),
  extractFn(src, 'function mediaTxtEq('),
  extractFn(src, 'function dupGapMs('),
  extractLine(src, 'const _recUidSalt'),
  extractLine(src, 'let _recUidSeq'),
  extractFn(src, 'function chatRecStampUid('),
  extractFn(src, 'function chatRecIdKey('),
  extractFn(src, 'function chatRecKindKey('),
  extractFn(src, 'function chatRecLooseSig('),
  extractFn(src, 'function chatRecCopyKeys('),
  extractFn(src, 'function chatRecKeysShare('),
  extractFnOr(src, 'function chatRecCardExtra(', 'function chatRecCardExtra(m) { return ""; }\n'),
  'function chatMsgCutMark() {}\n', // #814d 探针桩（红对照 HEAD 无此调用，本桩闲置无害）
  extractFn(src, 'function addRec('),
].join('\n');

// ---- addRec 外依赖 stub：渲染/落盘/通知全部空转，只保留计数 ----
function mkWorld() {
  const w = {
    msgs: [],
    dupLog: [],
    toasts: [],
    saves: 0,
    window: null,
    document: { visibilityState: 'visible' },
    toast: function (m) { w.toasts.push(m); },
    saveMsgs: function () { w.saves++; },
    chatTailAppend: function () {},
    chatVisible: function () { return true; },
    incChatUnread: function () {},
    showDeskMsg: function () {},
    renderStart: 0,
    WINDOW_MAX: 400,
    renderWindow: function () {},
    chatNearBottom: function () { return true; },
    scrollChatBottom: function () {},
    body: { lastElementChild: null },
    maybeInsertDivider: function () {},
    renderMsg: function () { return { dataset: { idx: w.msgs.length - 1 } }; },
    renderEnd: 0,
    batchRendering: false,
    windowRenderedN: 0,
    windowStale: false
  };
  w.window = { __mochiDupAdd: w.dupLog };
  return w;
}
function runAddRec(world) {
  const fn = new Function('msgs', 'window', 'document', 'toast', 'saveMsgs', 'chatTailAppend',
    'chatVisible', 'incChatUnread', 'showDeskMsg', 'renderStart', 'WINDOW_MAX', 'renderWindow',
    'chatNearBottom', 'scrollChatBottom', 'body', 'maybeInsertDivider', 'renderMsg', 'renderEnd',
    'batchRendering', 'windowRenderedN', 'windowStale', '__rec',
    '"use strict";\n' + parts + '\nreturn addRec(__rec);');
  return function (rec) {
    return fn(world.msgs, world.window, world.document, world.toast, world.saveMsgs, world.chatTailAppend,
      world.chatVisible, world.incChatUnread, world.showDeskMsg, world.renderStart, world.WINDOW_MAX,
      world.renderWindow, world.chatNearBottom, world.scrollChatBottom, world.body, world.maybeInsertDivider,
      world.renderMsg, world.renderEnd, world.batchRendering, world.windowRenderedN, world.windowStale, rec);
  };
}

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

function scenario(id, wantCount, buildRecs, opts) {
  const o = opts || {};
  const w = mkWorld();
  const add = runAddRec(w);
  const recs = buildRecs();
  let last = null;
  for (const r of recs) last = add(r);
  const n = w.msgs.length;
  note(id, n === wantCount, '期望 msgs=' + wantCount + ' 条，实得 ' + n + ' 条');
  if (o.wantNull === true) note(id + 'r', last === null, '第二份应被拒（返回 null），实得 ' + (last === null ? 'null' : '节点'));
  if (o.wantNull === false) note(id + 'r', last !== null, '第二份应放行（返回节点），实得 ' + (last === null ? 'null' : '节点'));
  if (o.wantToast) note(id + 't', w.toasts.length === 1, '期望 toast 恰 1 条，实得 ' + w.toasts.length);
  if (o.wantLkLog) note(id + 'l', w.dupLog.some(s => String(s).indexOf('lk:') === 0), '__mochiDupAdd 应记 lk: 前缀，实得 ' + JSON.stringify(w.dupLog));
  if (o.wantNoLkLog) note(id + 'l', !w.dupLog.some(s => String(s).indexOf('lk:') === 0), '不应记 lk:（不走本闩），实得 ' + JSON.stringify(w.dupLog));
  return w;
}

// ---- B1 礼物卡双派发：同款礼物 50ms 后被再投一次（新对象/新 uid＝#744/#776 都认不出）----
scenario('B1', 1, () => {
  const t = 1758000000000;
  return [
    { side: 'out', special: 'gift', giftId: 'g1', giftName: '玫瑰花', giftPrice: 520, ts: t },
    { side: 'out', special: 'gift', giftId: 'g1', giftName: '玫瑰花', giftPrice: 520, ts: t + 50 }
  ];
}, { wantNull: true, wantToast: true, wantLkLog: true });

// ---- B2 红包同金额双派发（红包无 text，全靠卡片字段指纹）----
scenario('B2', 1, () => {
  const t = 1758000001000;
  return [
    { side: 'out', special: 'redpacket', rpAmount: 52, rpWish: '心意', rpStatus: 'pending', ts: t },
    { side: 'out', special: 'redpacket', rpAmount: 52, rpWish: '心意', rpStatus: 'pending', ts: t + 150 }
  ];
}, { wantNull: true, wantToast: true, wantLkLog: true });

// ---- B3 红包不同金额 150ms 内＝两张不同的卡，必须放行 ----
scenario('B3', 2, () => {
  const t = 1758000002000;
  return [
    { side: 'out', special: 'redpacket', rpAmount: 52, rpWish: '心意', rpStatus: 'pending', ts: t },
    { side: 'out', special: 'redpacket', rpAmount: 5.2, rpWish: '心意', rpStatus: 'pending', ts: t + 150 }
  ];
}, { wantNull: false, wantNoLkLog: true });

// ---- B4 拍一拍（我方手势存 in 侧）同动作 50ms 双派发 ----
scenario('B4', 1, () => {
  const t = 1758000003000;
  return [
    { side: 'in', special: 'poke', text: '{me} 戳了戳 {ta}', ts: t },
    { side: 'in', special: 'poke', text: '{me} 戳了戳 {ta}', ts: t + 50 }
  ];
}, { wantNull: true, wantLkLog: true });

// ---- B5 礼物卡 1200ms 后同款＝人为重发（须重开面板），放行 ----
scenario('B5', 2, () => {
  const t = 1758000004000;
  return [
    { side: 'out', special: 'gift', giftId: 'g1', giftName: '玫瑰花', giftPrice: 520, ts: t },
    { side: 'out', special: 'gift', giftId: 'g1', giftName: '玫瑰花', giftPrice: 520, ts: t + 1200 }
  ];
}, { wantNull: false, wantNoLkLog: true });

// ---- B6 同毫秒互动卡克隆（uid 不同同文）＝#776 上层闸门职责，仍在 ----
scenario('B6', 1, () => {
  const t = 1758000005000;
  return [
    { side: 'out', text: '问：今晚吃什么', special: 'ask', askQuestion: '今晚吃什么', askStatus: 'pending', ts: t },
    { side: 'out', text: '问：今晚吃什么', special: 'ask', askQuestion: '今晚吃什么', askStatus: 'pending', ts: t }
  ];
}, { wantNull: true });

// ---- B7 纯文本 out 同文 50ms＝#256 800ms 层职责，仍在（不经本闩）----
scenario('B7', 1, () => {
  const t = 1758000006000;
  return [
    { side: 'out', text: '在吗', ts: t },
    { side: 'out', text: '在吗', ts: t + 50 }
  ];
}, { wantNull: true, wantNoLkLog: true });

// ---- B8 dedupExempt（#544 决定答案）50ms 克隆＝豁免口径不变 ----
scenario('B8', 2, () => {
  const t = 1758000007000;
  return [
    { side: 'out', special: 'gift', giftId: 'g1', giftName: '玫瑰花', ts: t, dedupExempt: true },
    { side: 'out', special: 'gift', giftId: 'g1', giftName: '玫瑰花', ts: t + 50, dedupExempt: true }
  ];
}, { wantNull: false, wantNoLkLog: true });

// ---- B9 in 侧 TA 礼物 50ms 克隆＝in 侧不碰（宁漏不误删）----
scenario('B9', 2, () => {
  const t = 1758000008000;
  return [
    { side: 'in', special: 'gift', giftId: 'g2', giftName: '围巾', ts: t },
    { side: 'in', special: 'gift', giftId: 'g2', giftName: '围巾', ts: t + 50 }
  ];
}, { wantNull: false, wantNoLkLog: true });

// ---- B10 互动卡（out ask）+300ms 同文克隆＝本闩主靶 ----
scenario('B10', 1, () => {
  const t = 1758000009000;
  return [
    { side: 'out', text: '问：周末去哪', special: 'ask', askQuestion: '周末去哪', askStatus: 'pending', ts: t },
    { side: 'out', text: '问：周末去哪', special: 'ask', askQuestion: '周末去哪', askStatus: 'pending', ts: t + 300 }
  ];
}, { wantNull: true, wantToast: true, wantLkLog: true });

// ---- S1 源锚（与 build.mjs #796a~c 哨兵同口径）----
const NEEDLES = [
  ['S1a', 'function chatRecCardExtra(m) {'],
  ['S1b', "? (chatRecLooseSig(rec) + chatRecCardExtra(rec)) : '';"],
  ['S1c', 'if (chatRecLooseSig(p) + chatRecCardExtra(p) !== _lk) continue;']
];
for (const [id, nd] of NEEDLES) {
  let c = 0, at = -1;
  while ((at = src.indexOf(nd, at + 1)) >= 0) c++;
  note(id, c === 1, 'needle 应恰 1 处，实得 ' + c + ' 处：' + nd);
}

// ---- 汇总 ----
const isRed = EXPECT === 'red';
const failN = failures.length;
if (isRed) {
  console.log(failN ? 'RED OK（对 HEAD 红根恰红 ' + failN + ' 条）：\n' + failures.join('\n') : 'RED 无效：HEAD 红根全绿＝脚本无判别力');
  process.exit(failN ? 0 : 1);
}
if (failN) { console.error('FAIL ' + failN + ' 条：\n' + failures.join('\n')); process.exit(1); }
console.log('ALL PASS（B1~B10+S1a~c 13 条断言全过）');
