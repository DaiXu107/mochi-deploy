// ===== #796 专项回归：喝水 / 吃什么「TA 提醒记录」页 ＋ 延迟投递按桌面归属 =====
// 用户反馈：①第三页喝水里没有「TA 提醒我喝水」的历史记录页；②吃什么同样缺吃饭提醒的历史页；
//         ③不同桌面的聊天记录／提醒数据不要串。
// 实现（src/js/p2-features.js ＋ src/css/chat-pages.css）：
//   #796a remindLogRead(tag)     记录源＝当前桌面聊天记录里带来源 chip（mood[].tag）的气泡；
//                                chat-msgs 本就是 per-cid 键 ⇒ 不另建第二份账本，也就没有串台载体
//   #796b makeRemindLogPage(o)   喝水/吃什么共用子页工厂：返回所属功能页，每次打开现读现渲
//   #796c chatAddInOnDesk(cid…)  延迟发进聊天的 TA 消息只认触发时刻的桌面，切换了则放弃
//   #796d eatRemindFire 补发的「追问关心」走 #796c（1400ms 期间可能已换联系人）
// 用例（对提取出的真实函数体做单元级行为断言，stub 掉 store/DOM/window，不依赖构建产物）：
//   A1 按 tag 过滤＋最新在前；A2 各 tag 互不混；A3/A4 换桌面只见该桌面自己的（不合并、不残留）
//   A5 脏数据（null/无 mood/空 mood）不炸；A6 正文转义；A7 记录页只读不写
//   B1 同桌面：立即 1 条＋补发 1 条；B2 补发前切桌面：补发那条不落进新桌面
//   S1/S2/S3 入口按钮·回跳·chip 串·CSS 锚点；SYN 整文件编译
// 红对照（旧代码应红）：
//   MOCHI_P2_FILE=<HEAD 版 p2-features.js> MOCHI_EXPECT=red node tools/verify-remind-log.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(process.env.MOCHI_P2_FILE || join(root, 'src/js/p2-features.js'), 'utf8');
const css = readFileSync(process.env.MOCHI_CSS_FILE || join(root, 'src/css/chat-pages.css'), 'utf8');

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

// ---- 从 sig 处起做花括号配平截取（失败抛错，由各组 try 记为失败） ----
function extractFn(sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error('源码缺锚点：' + sig);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + (src[i + 1] === ';' ? 2 : 1)); }
  }
  throw new Error(sig + ' 花括号不配平');
}
function mkStore(init) { const m = Object.assign({}, init || {}); return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; } }; }

// ---- A 组：记录读取（真实 remindLogEsc ＋ 真实 remindLogRead） ----
const A_MSGS = [
  { text: '去喝口水吧', ts: 100, mood: [{ tag: '喝水提醒', label: '去喝口水吧' }] },
  { text: '到饭点啦', ts: 200, mood: [{ tag: '吃饭提醒', label: '到饭点啦' }] },
  { text: '该喝水了', ts: 300, mood: [{ tag: '喝水提醒', label: '该喝水了' }] },
  { text: '我自己打的字', ts: 400 },
  { text: '别的气泡', ts: 500, mood: [{ tag: '经期关心', label: '别的气泡' }] },
  null,
  { text: '空 mood', ts: 600, mood: [] },
];
function makeReader(msgs) {
  const store = mkStore();
  const win = { getChatMsgs: () => msgs, __activeCid: 'deskA', contactNameFor: () => '', taWord: () => 'TA' };
  const body = extractFn('function remindLogEsc(s)') + '\n' + extractFn('function remindLogRead(tag)');
  return new Function('window', 'curStore', '"use strict";' + body + '; return remindLogRead;')(win, () => store);
}
try {
  const read = makeReader(A_MSGS);
  const w = read('喝水提醒');
  note('A1', w.length === 2 && w[0].text === '该喝水了' && w[0].ts === 300 && w[1].text === '去喝口水吧' && w[1].ts === 100,
    '喝水记录应为 2 条且最新在前，实得 ' + JSON.stringify(w));
  const e = read('吃饭提醒');
  note('A2', e.length === 1 && e[0].text === '到饭点啦', '吃饭记录应只有 1 条、不混入喝水/经期/裸消息，实得 ' + JSON.stringify(e));
  const readB = makeReader([{ text: 'B 桌面的催水', ts: 900, mood: [{ tag: '喝水提醒', label: 'x' }] }]);
  const wb = readB('喝水提醒');
  note('A3', wb.length === 1 && wb[0].text === 'B 桌面的催水',
    '换到 B 桌面后应只见 B 自己那 1 条（A 的记录不得残留/合并），实得 ' + JSON.stringify(wb));
  note('A4', read('喝水提醒').length === 2, '再回 A 桌面仍应是 A 自己的 2 条（两次读取互不污染），实得 ' + JSON.stringify(read('喝水提醒')));
  note('A5', w.every(r => typeof r.text === 'string' && typeof r.ts === 'number'), '脏数据（null/无 mood/空 mood）应被跳过而不抛错');
  const escSrc = extractFn('function remindLogEsc(s)');
  const esc = new Function('"use strict";' + escSrc + '; return remindLogEsc("<img src=x onerror=alert(1)>");')();
  note('A6', esc.indexOf('<') < 0 && esc.indexOf('&lt;') >= 0, '正文需 HTML 转义（字卡里的尖括号不得打断列表），实得 ' + esc);
} catch (err) { failures.push('A*：记录读取断言执行失败——' + err.message); }
try {
  note('A7', !/\.set\(/.test(extractFn('function remindLogRead(tag)')), '记录页只读聊天记录、不再写第二份账本（多一个键＝多一处串台载体）');
} catch (err) { /* 已由 A* 记 */ }

// ---- B 组：吃饭提醒的延迟补发按桌面归属（真实 chatAddInOnDesk ＋ 真实 eatRemindFire） ----
function runEatFire(switchBeforeDeferred) {
  const win = { __activeCid: 'deskA', chatAddIn: null, chatAddInOnDesk: null };
  const sent = [];
  win.chatAddIn = (text, opts) => { sent.push({ to: win.__activeCid || 'default', tag: (opts && opts.tag) || '' }); };
  const stores = { deskA: mkStore(), deskB: mkStore() };
  let deferred = null;
  const body = extractFn('window.chatAddInOnDesk = function (cid, text, opts)') + '\n' + extractFn('function eatRemindFire(code)');
  const fn = new Function('window', 'curStore', 'eatDishes', 'libPool', 'dcfP', 'eatRenderRemind',
    'DEF_EAT_REMIND', 'DEF_EAT_REMIND_CARE', 'DEF_EAT_REMIND_NIGHT', 'DEF_EAT_REMIND_NIGHT_CARE', 'setTimeout', 'navigator',
    '"use strict";' + body + '; eatRemindFire("lunch");');
  fn(win, () => stores[win.__activeCid || 'default'], () => ['番茄炒蛋'], () => ['今天吃 {d} 怎么样？'],
    () => 100, () => {}, ['兜底'], ['吃了什么呀'], ['夜深了'], ['吃饱了吗'],
    (cb) => { deferred = cb; return 0; }, { vibrate: null });
  note('B0', typeof win.chatAddInOnDesk === 'function', '真实 chatAddInOnDesk 未挂到 window（抽取失败，B1/B2 不可信）');
  if (deferred) {
    if (switchBeforeDeferred) win.__activeCid = 'deskB';
    deferred();
  }
  return { sent, deferred: !!deferred };
}
try {
  const same = runEatFire(false);
  note('B1', same.deferred && same.sent.length === 2 && same.sent.every(x => x.to === 'deskA' && x.tag === '吃饭提醒'),
    '同桌面：立即 1 条＋补发 1 条，两条都落 deskA 且带吃饭 chip，实得 ' + JSON.stringify(same.sent));
  const sw = runEatFire(true);
  note('B2', sw.deferred && sw.sent.length === 1 && sw.sent[0].to === 'deskA',
    '补发前切了联系人 → 那条应放弃、不得落进 deskB（＝串台），实得 ' + JSON.stringify(sw.sent));
} catch (err) { failures.push('B*：延迟投递断言执行失败——' + err.message); }

// ---- S 组源码/CSS 锚点 ----
try {
  ['id="water-log-btn"', 'id="eat-log-btn"', "tag: '喝水提醒'", "tag: '吃饭提醒'",
    'openPage(o.parent())', 'openPage(waterLogPage); waterLogPage.renderLog()', 'openPage(eatLogPage); eatLogPage.renderLog()',
    'function makeRemindLogPage(o)'].forEach((needle) => {
    note('S1', src.indexOf(needle) >= 0, '源码缺锚点：' + needle);
  });
  note('S2', /\.remind-log \{/.test(css) && /\.remind-log-sum \{/.test(css), 'chat-pages.css 缺 .remind-log 记录页样式');
  note('S3', /tc-listitem/.test(extractFn('function makeRemindLogPage(o)')), '记录页列表项应复用 .tc-listitem（暗色主题已适配）');
} catch (err) { failures.push('S*：' + err.message); }

try { new Function(src); } catch (e) { failures.push('SYN：整文件编译失败——' + e.message); }

const real = failures.filter(f => !f.startsWith('B0：'));
if (EXPECT === 'red') {
  if (real.length) { console.log('RED-OK（旧代码如预期红 ' + real.length + ' 条，首条：' + real[0] + '）'); process.exit(0); }
  console.error('红对照失败：旧代码竟全绿，断言没咬合'); process.exit(1);
}
if (real.length) { console.error('FAIL ' + real.length + ' 条：\n- ' + real.join('\n- ')); process.exit(1); }
console.log('OK #796 提醒记录页：A1~A7 读取/桌面隔离 + B1~B2 归属投递 + S1~S3 锚点 + 语法 全过（B0 探针亦绿）');
process.exit(0);
