// ===== #800 专项回归：后台通知「一条内容弹两条一模一样的系统通知」根治 =====
// 用户实报（红米 K80 Chrome；用户点名其他消息可能同病、其他设备型号也有）：
//   「联系人更换昵称的系统消息」在后台弹出两条完全一模一样的通知（连秒级时间前缀都相同），
//   实际只发生过一次换昵称。
// 根因（#744/#766/#776/#796「一条变多条」同族新通道，零机型分支）：
//   同一条消息在**同一同步任务**里被投两次 bgNotifyCheck——
//   ① addRec → showDeskMsg → showDeskPopup(isHidden) → bgNotifyCheck（chat.js 通用投递路）；
//   ② 机制自己的显式补发路（avatar-lib.js 昵称池定时更换 checkNickLibRefresh /
//      头像池定时更换 / ta-ask.js 五处 / ck-question.js / incoming-requests.js 查岗卡）。
//   而已发指纹 markNotified 原本在 showSysNotification().then(ok) **异步回调**里才落账，
//   发送链前段还有头像裁剪（Image onload，#673 起最长 1200ms 截止）——第二发到达时
//   notifiedDup/seenDup 查空，recentChatDup 又有「刚入库 2.5s 内条目自排除」（v3.14.x 防吞
//   新消息的设计，恰好放行同任务第二发）⇒ 双弹。修复＝决定发送的同步点记账
//   （gateStats.sent++; markNotified(nkey);）＋发送失败回调里回滚（v3.12.x「失败可重试」不变）。
// 用例（提取真实 bgNotifyCheck/msgFingerprint/notifiedDup/markNotified 等函数体＋stub 浏览器边界）：
//   A1 同一同步任务两条同内容 → 只弹 1 条、sent=1、dup≥1（HEAD 双弹＝红）
//   A2 决定点已记账 → 两发后 notifiedDup(指纹) 已为 true（HEAD 记账在 ok 回调＝红）
//   A3 发送失败(ok=false)回滚 → 排空微任务后同内容重调放行（「失败可重试」语义保持，两侧同绿）
//   A4 发送成功(ok=true) → 排空微任务后同内容重调仍被 2 分钟窗拦（提前记账不破坏成功路径，两侧同绿）
//   A5 不同内容不受累 → 正常弹出（防「经常收不到」误伤，两侧同绿）
//   S1/S2 源码锚点在位（与 build.mjs #800a/#800b 同文）
// 用法：
//   node tools/verify-notify-dup-gate.mjs                          （绿基线，期望全绿）
//   MOCHI_BK_FILE=<HEAD 版 bg-keep.js> MOCHI_EXPECT=red node …     （红对照，期望恰 RED_IDS 红）
// 纯 node 单元验证，不依赖不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(process.env.MOCHI_BK_FILE || join(root, 'src/js/bg-keep.js'), 'utf8');
const RED_IDS = ['A1', 'A2', 'S1', 'S2'];

// ---- 提取函数体（花括号配平），失败=锚点没了 ----
function extractFn(prefix) {
  const at = src.indexOf(prefix);
  if (at < 0) throw new Error('找不到 ' + prefix);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(prefix + ' 花括号不配平');
}

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };
const drain = () => new Promise((r) => setImmediate(r)); // 排空微任务（.then 回调）

// ---- 真实指纹/记账链（与产品同源，stub 只到浏览器边界） ----
const NOTIFY_SENT_DUP_MS = 2 * 60000;
const NOTIFY_SEEN_DUP_MS = 3 * 60000;
const NOTIFY_HIDDEN_MIN_MS = 15000;
const NOTIFY_FRESH_CHAT_DUP_MS = 30 * 60000;
const NOTIFY_ICON = 'data:image/png;base64,x';
function makeFn(sig, params, args) {
  return new Function(...params, '"use strict";' + extractFn(sig) + '; return ' + sig.replace(/^function\s+/, '').replace(/\s*\(.*/, '') + ';')(...args);
}
const normNotifyKey = makeFn('function normNotifyKey(', [], []);
const sampleDataUrl = makeFn('function sampleDataUrl(', [], []);
const msgFingerprint = makeFn('function msgFingerprint(', ['normNotifyKey', 'sampleDataUrl'], [normNotifyKey, sampleDataUrl]);
const seenRecentlyMap = new Map();
const markSeen = makeFn('function markSeen(', ['seenRecently'], [seenRecentlyMap]);
const seenDup = makeFn('function seenDup(', ['seenRecently', 'NOTIFY_SEEN_DUP_MS'], [seenRecentlyMap, NOTIFY_SEEN_DUP_MS]);

// ---- bgNotifyCheck 跑法（stub：visibilityState/通知受理/头像裁剪/聊天查重） ----
function makeRunner(opts) {
  const o = opts || {};
  const notifiedRecently = new Map();
  const markNotified = makeFn('function markNotified(', ['notifiedRecently'], [notifiedRecently]);
  const notifiedDup = makeFn('function notifiedDup(', ['notifiedRecently', 'NOTIFY_SENT_DUP_MS'], [notifiedRecently, NOTIFY_SENT_DUP_MS]);
  const gateStats = { total: 0, tooFresh: 0, dup: 0, replay: 0, sent: 0 };
  const sysLog = []; // showSysNotification 受理台账（浏览器通知本体的替身）
  const windowStub = { Notification: function () {} };
  windowStub.Notification.permission = 'granted';
  const bgNotifyCheck = new Function(
    'notifyEnabled', 'msgFingerprint', 'document', 'Notification', 'markSeen', 'gateStats', 'lastHiddenAt',
    'recentChatDup', 'NOTIFY_HIDDEN_MIN_MS', 'NOTIFY_FRESH_CHAT_DUP_MS', 'notifiedDup', 'seenDup',
    'hiddenSentCount', 'hiddenSentName', 'store', 'markNotified', 'notifiedRecently', 'makeAvatarThumb',
    'NOTIFY_ICON', 'showSysNotification', 'window',
    '"use strict";' + extractFn('window.bgNotifyCheck = function') + '; return window.bgNotifyCheck;'
  )(
    true,                       // notifyEnabled：用户已开后台通知（实报场景）
    msgFingerprint,
    { visibilityState: 'hidden' }, // 页面在后台（定时器到点时屏幕关闭/已切走）
    windowStub.Notification,
    markSeen, gateStats,
    Date.now() - 60000,         // lastHiddenAt：切后台已 60s（>15s 过渡期，与实报同态）
    () => false,                // recentChatDup：真实实现有「刚入库 2.5s 内条目自排除」，同任务第二发放行——stub 取其放行侧
    NOTIFY_HIDDEN_MIN_MS, NOTIFY_FRESH_CHAT_DUP_MS,
    notifiedDup, seenDup,
    0, '',                      // hiddenSentCount / hiddenSentName（函数体内自增）
    { get: () => null },        // store：无 lbl-partner，走 taWord 兜底
    markNotified, notifiedRecently,
    (d, cb) => cb(''),          // makeAvatarThumb：头像裁剪同步完成（真实是异步，只会拉大竞态窗口）
    NOTIFY_ICON,
    (title, o2) => { sysLog.push({ title, body: (o2 && o2.body) || '' }); return Promise.resolve(o.ok !== false); },
    windowStub
  );
  return {
    run: (text, ts, extra) => bgNotifyCheck(text, ts, extra),
    sysLog, gateStats, notifiedRecently, notifiedDup
  };
}

// ---- A1/A2：同一同步任务两条同内容（实报本体：addRec 通用路 + 机制显式补发路） ----
{
  const r = makeRunner({ ok: true });
  const text = 'TA 把聊天昵称换成了「小满」';
  const ts = Date.now();
  r.run(text, ts, { name: '小满' });  // ① addRec→showDeskMsg 一路
  r.run(text, ts, { name: '小满' });  // ② avatar-lib 显式补发一路（同一同步任务，微任务尚未跑）
  note('A1', r.sysLog.length === 1, '同任务两条同内容弹了 ' + r.sysLog.length + ' 条通知（应为 1）');
  note('A1', r.gateStats.sent === 1, 'gateStats.sent=' + r.gateStats.sent + '（应为 1）');
  note('A1', r.gateStats.dup >= 1, 'gateStats.dup=' + r.gateStats.dup + '（第二发应记入 dup 拦截）');
  const fp = msgFingerprint(text, '');
  note('A2', r.notifiedDup(fp) === true, '决定发送后已发指纹未在位（HEAD 在 ok 回调才记账＝同任务第二发查空放行）');
}

// ---- A3：发送失败 → 回滚 → 同内容可重试（v3.12.x「失败可重试」语义保持） ----
{
  const r = makeRunner({ ok: false });
  const text = 'TA 把聊天昵称换成了「阿柴」';
  const ts = Date.now();
  r.run(text, ts, {});
  await drain(); // 失败回调（回滚早记账）跑完
  const n0 = r.sysLog.length;
  r.run(text, ts + 5, {});
  note('A3', r.sysLog.length === n0 + 1, '发送失败回滚后同内容重试被拦（应为放行重发，「经常收不到」家族回归）');
}

// ---- A4：发送成功 → 2 分钟窗内同内容不再弹（提前记账不破坏成功路径） ----
{
  const r = makeRunner({ ok: true });
  const text = 'TA 把聊天昵称换成了「团团」';
  const ts = Date.now();
  r.run(text, ts, {});
  await drain(); // 成功回调跑完
  const n0 = r.sysLog.length;
  r.run(text, ts + 5, {});
  note('A4', r.sysLog.length === n0, '成功后 2 分钟窗内同内容又弹了一条（内容去重被破坏）');
}

// ---- A5：不同内容不受累（正常新通知照弹） ----
{
  const r = makeRunner({ ok: true });
  r.run('第一条：TA 想你了', Date.now(), {});
  r.run('第二条：TA 给你发了红包', Date.now(), {});
  note('A5', r.sysLog.length === 2, '两条不同内容只弹了 ' + r.sysLog.length + ' 条（应为 2，去重不得误伤新内容）');
}

// ---- S1/S2：源码锚点（与 build.mjs #800a/#800b 同文） ----
note('S1', src.includes('gateStats.sent++; markNotified(nkey);'), '源码缺 #800a 决定点同步记账锚点');
note('S2', src.includes('notifiedRecently.delete(nkey);'), '源码缺 #800b 发送失败回滚锚点');

// ---- 判定 ----
if (EXPECT === 'red') {
  const red = failures.filter((f) => RED_IDS.some((id) => f.indexOf(id + '：') === 0));
  const greenSide = failures.filter((f) => !RED_IDS.some((id) => f.indexOf(id + '：') === 0));
  if (red.length === 0) { console.log('RED 基线无红＝修复判据失去判别力'); process.exit(1); }
  if (greenSide.length) { console.log('RED 基线出现预期外红：\n' + greenSide.join('\n')); process.exit(1); }
  console.log('RED 对照 ' + red.length + '/' + RED_IDS.length + ' 恰红（' + red.map((f) => f.split('：')[0]).join(',') + '）＝缺陷本体复现');
  process.exit(0);
}
if (failures.length) {
  console.log('FAIL ' + failures.length + '：\n' + failures.join('\n'));
  process.exit(1);
}
console.log('PASS ' + '（A1~A5 + S1~S2 全过：同任务双发只弹一条、失败回滚可重试、成功窗内不重弹、新内容不误伤）');
