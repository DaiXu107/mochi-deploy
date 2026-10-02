// ===== #790 专项回归：TA在身边「换位提醒」三开关（弹窗可关 / 自动换位可关 / 换位是否发进聊天） =====
// 用户反馈：TA 自动换位置时顶部黑色轻提示弹窗，希望①设置里能关掉弹窗；②弹窗（换位事件）能设置是否发到聊天里。
// 实现（p2-features.js，全部只管 doLocAuto 这条「TA 自动」路，手动发卡/问TA一声不受限）：
//   #790a showLocChangeBubble 入口闸门   store.get('loc-bubble')==='0' → 直接 return（不建/不弹 #loc-change-bubble）
//   #790b doLocAuto 发聊天闸门           store.get('loc-chat')==='0' → 不调 chatAddIn，但仍写 loc-current/loc-history（时间线保留）
//   #790c doLocAuto 自动总开关           store.get('loc-auto')==='0' → 到点直接 return（拦设置后仍残留的当次定时器）
//   #790d 位置面板设置组                  loc-auto-tg / loc-bubble-tg / loc-chat-tg 三行 toggle，写入 per-cid 键
// 用例（对提取出的真实函数体做单元级行为断言，stub 掉 store/DOM/window）：
//   B1 默认（无键）自动换位：chatAddIn 落聊天 + 时间线写入 + 弹窗链路走到（现状行为不变）
//   B2 loc-chat='0'：chatAddIn 不调，时间线仍写、光点仍放、弹窗仍走、面板仍重画
//   B3 loc-auto='0'：整条路静默——chatAddIn/时间线/光点/弹窗/重画全不碰
//   B4 loc-bubble='0'：真实 showLocChangeBubble 早退，不建 #loc-change-bubble；loc-chat='0' 组合下聊天也不落
//   B5 loc-bubble 开：真实 showLocChangeBubble 建元素、文案含「换了位置」
//   #1436（作者现场「开着【换位发到聊天】却只有弹窗：没发到聊天、也没记进位置时间线」）——
//   换位那一发从 doLocAuto 抽成 emitLocChange(avoidText)，供方位感知【感知一下】复用同一条路：
//   B6 换位落地必重画：renderLocPanel 与 window.refreshSense 各叫到一次（旧写法＝库写进去了屏不重画）
//   B7 落聊天那一发带限流豁免位 {rateAllow:true}（旧写法不带＝「TA 消息限流」满时静默吞掉）
//   B8 关「换位发到聊天」不许把重画一起关掉
//   B9 抽卡次数口径：自动那条（avoidText=null）一次就收（恰好 2 发 Math.random）；主动那条撞回上一张就重抽
//   B10 词源全关（陪伴句整组停用＋字卡库位置卡全关）＝这一发整条静默，一个字都不写
//   S1 源码含三开关渲染 id（loc-auto-tg/loc-bubble-tg/loc-chat-tg）＋ change 写回对应键
//   S2 #1436 续批＝按钮即开关：前置开关已退役（三标识符归零）＋感知一下无条件催换位＋对外出口 window.locShiftNow
// 红对照：MOCHI_P2_FILE=<HEAD 版 p2-features.js> MOCHI_EXPECT=red node tools/verify-loc-change-setting.mjs
//   ——旧代码无三道闸门与设置组，B2/B3/B4/S1 必红；#1436 之后 B6~B10/S2 也在旧代码上必红
//   （旧 doLocAuto 不重画、不带 rateAllow、没有 emitLocChange 可抠——extractFn 直接抛＝归进 B* 的「执行失败」）。
// 纯 node 单元验证（vm 提取函数体＋stub），不依赖不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const p2Path = process.env.MOCHI_P2_FILE || join(root, 'src/js/p2-features.js');
const src = readFileSync(p2Path, 'utf8');

// ---- 提取 IIFE 内指定函数体（花括号配平），失败=锚点没了 ----
function extractFn(name, sig) {
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
function extractStr(needle) {
  if (src.indexOf(needle) < 0) throw new Error('源码缺锚点：' + needle);
  return needle;
}

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

// ---- stub 工厂 ----
function mkStore(init) { const m = Object.assign({}, init || {}); return { get: (k) => (k in m ? m[k] : ''), set: (k, v) => { m[k] = v; } }; }
function mkDoc() {
  const doc = {
    hidden: false,
    created: [],
    appended: [],
    getElementById: () => null,
    createElement: (tag) => { const el = { tag, id: '', className: '', textContent: '', _t: 0, classList: { add() {}, remove() {} } }; doc.created.push(el); return el; },
    body: { appendChild: (el) => { doc.appended.push(el); } },
    addEventListener: () => {}
  };
  return doc;
}
const NOOP_TIMER = (fn) => 0; // 不真排程，防挂起

// 跑真实 showLocChangeBubble：返回 {created, appended}
function runBubble(store, keyVal) {
  const s = mkStore(keyVal ? { 'loc-bubble': keyVal } : {});
  const doc = mkDoc();
  const fn = new Function('store', 'window', 'document', 'setTimeout', 'clearTimeout',
    '"use strict";' + extractFn('showLocChangeBubble', 'function showLocChangeBubble(text)') +
    '; showLocChangeBubble("再近一点"); return { created: document.created, appended: document.appended };');
  return fn(s, {}, doc, NOOP_TIMER, () => {});
}

// 跑真实 doLocAuto：bubbleImpl 可注入（默认 spy），返回各 spy 计数
// #1436 随动：换位那一发已从 doLocAuto 抽成 emitLocChange(avoidText)（给方位感知的【感知一下】
// 复用同一条路），所以这里必须把两段函数体一起塞进沙箱，并补 renderLocPanel/dayStr/locViewDate
// 三个新依赖——只抠 doLocAuto 的旧写法会 ReferenceError（＝B 组整组红，属尺子没跟着走，不是实现坏了）。
function runAuto(store, opts) {
  const o = opts || {};
  const doc = mkDoc();
  const spy = { chat: 0, chatOpts: null, saveCur: 0, curArg: null, saveHist: 0, histArg: null, fx: 0, bubble: 0, bubbleEl: 0, bubbleText: '', render: 0, refreshSense: 0, shifted: null };
  let bubbleImpl;
  if (o.realBubble) {
    const bdoc = mkDoc();
    const bfn = new Function('store', 'window', 'document', 'setTimeout', 'clearTimeout',
      '"use strict";' + extractFn('showLocChangeBubble', 'function showLocChangeBubble(text)') +
      '; showLocChangeBubble("再近一点"); return { created: document.created, appended: document.appended };');
    bubbleImpl = (text) => {
      spy.bubble++;
      const r = bfn(store, {}, bdoc, NOOP_TIMER, () => {});
      spy.bubbleEl += r.appended.length;
      if (r.appended[0]) spy.bubbleText = r.appended[0].textContent;
    };
  } else {
    bubbleImpl = () => { spy.bubble++; };
  }
  const win = {
    __mochiDataReady: true,
    chatAddIn: (text, o2) => { spy.chat++; spy.chatOpts = o2 || null; },
    locLibAllEnabled: () => (o.allCards === undefined ? ['靠在你左边', '在你右边站会儿'] : o.allCards),
    locLibTextOff: () => !!o.killCompanion,
    refreshSense: () => { spy.refreshSense++; }
  };
  const fn = new Function('store', 'window', 'document', 'locWakeAt', 'locTypeOf', 'loadCur', 'saveCur',
    'loadHist', 'saveHist', 'playLocFx', 'showLocChangeBubble', 'renderLocPanel', 'dayStr', 'locViewDate',
    '"use strict";' + extractFn('doLocAuto', 'function doLocAuto()') + '\n' +
    extractFn('emitLocChange', 'function emitLocChange(avoidText)') + '\n' + (o.harness || 'doLocAuto();'));
  // o.rand＝按死的抽卡序列（测「自动那条一次就收／主动那条避开上一张」必须钉住 Math.random）
  const origRandom = Math.random;
  let used = 0;
  const seq = o.rand || null;
  Math.random = seq ? () => { const v = seq[Math.min(used, seq.length - 1)]; used++; return v; }
    : () => { used++; return origRandom(); };
  try {
    spy.ret = fn(store, win, doc, 0,
      () => 'custom',
      () => (o.oldCur === undefined ? { text: '旧位置', ts: 1 } : o.oldCur),
      (v) => { spy.saveCur++; spy.curArg = v; },
      () => [],
      (list) => { spy.saveHist++; spy.histArg = list; },
      () => { spy.fx++; },
      bubbleImpl,
      () => { spy.render++; },
      (d) => d.getFullYear() + '-x',
      '');
  } finally { Math.random = origRandom; }
  spy.randUsed = used;
  return spy;
}

// ---- B 组行为断言 ----
try {
  // B1 默认（现状不变）：落聊天 + 时间线 + 弹窗链
  const b1 = runAuto(mkStore());
  note('B1', b1.chat === 1 && b1.saveCur === 1 && b1.saveHist === 1 && b1.fx === 1 && b1.bubble === 1,
    '默认自动换位应 聊天1/时间线2写/光点1/弹窗1，实得 ' + JSON.stringify(b1));

  // B2 关「换位发到聊天」：不落聊天，时间线/光点/弹窗照旧
  const b2 = runAuto(mkStore({ 'loc-chat': '0' }));
  note('B2', b2.chat === 0 && b2.saveCur === 1 && b2.saveHist === 1 && b2.fx === 1 && b2.bubble === 1,
    'loc-chat=0 应不落聊天但时间线/光点/弹窗照旧，实得 ' + JSON.stringify(b2));

  // B3 关「TA 自动换位」：整条路静默（拦残留定时器到点那次）
  const b3 = runAuto(mkStore({ 'loc-auto': '0' }));
  note('B3', b3.chat === 0 && b3.saveCur === 0 && b3.saveHist === 0 && b3.fx === 0 && b3.bubble === 0,
    'loc-auto=0 应全部静默，实得 ' + JSON.stringify(b3));

  // B4/B5 真实弹窗函数：关=不建元素；开=建元素且文案带「换了位置」
  const b4 = runAuto(mkStore({ 'loc-bubble': '0', 'loc-chat': '0' }), { realBubble: true });
  note('B4', b4.bubbleEl === 0 && b4.chat === 0,
    'loc-bubble=0 应不建弹窗元素（组合 loc-chat=0 也不落聊天），实得 ' + JSON.stringify(b4));
  const b5 = runAuto(mkStore(), { realBubble: true });
  note('B5', b5.bubbleEl === 1 && b5.bubbleText.indexOf('换了位置') >= 0,
    '弹窗开应建 #loc-change-bubble 且文案含「换了位置」，实得 ' + JSON.stringify(b5));

  // ---- #1436 两条新口径（作者现场：开着【换位发到聊天】却「只有弹窗，没发到聊天，也没记时间线」）----
  // B6 换位落地必须重画面板：renderLocPanel 与 refreshSense 各叫到一次
  //   （此前只有顶部那枚轻提示会动，库写进去了屏不重画＝「位置时间线没记录」）
  const b6 = runAuto(mkStore());
  note('B6', b6.render === 1 && b6.refreshSense === 1,
    '换位落地应重画位置面板＋刷新方位感知（各 1 次），实得 render=' + b6.render + ' refreshSense=' + b6.refreshSense);

  // B7 发进聊天那一发带限流豁免位 rateAllow:true
  //   （此前它与 TA 普通消息一起被「TA 消息限流」计数：额度满时 rateBlocksIn 静默 return null，
  //     于是气泡照弹、时间线照记、聊天一条不加——无头实测 rl-en=1/rl-max=1 时 chatTotal 4→4）
  const b7 = runAuto(mkStore());
  note('B7', b7.chat === 1 && !!(b7.chatOpts && b7.chatOpts.rateAllow === true),
    '换位进聊天须带 {rateAllow:true}，实得 chat=' + b7.chat + ' opts=' + JSON.stringify(b7.chatOpts));

  // B8 「换位发到聊天」关时不该顺手把重画也关掉（时间线仍要当场看得见）
  const b8 = runAuto(mkStore({ 'loc-chat': '0' }));
  note('B8', b8.chat === 0 && b8.render === 1 && b8.refreshSense === 1,
    '关「换位发到聊天」仍须重画面板，实得 ' + JSON.stringify({ chat: b8.chat, render: b8.render, refreshSense: b8.refreshSense }));

  // B9 抽卡次数口径（#1436 把那一发抽成 emitLocChange(avoidText) 后的回归闸）：
  //   定时器那条（avoidText=null）＝照旧只抽一次（Math.random 恰好两次：0.7 分流＋取下标）；
  //   主动那条（带上一张）＝上一张是什么就重抽，最多三发。
  const b9a = runAuto(mkStore(), { harness: 'emitLocChange(null);', rand: [0.1, 0.0] });
  note('B9a', b9a.curArg && b9a.curArg.text === '在你身边' && b9a.randUsed === 2,
    '自动那条应「一次就收」且抽到 seq 给的那张，实得 text=' + JSON.stringify(b9a.curArg && b9a.curArg.text) + ' 抽数=' + b9a.randUsed);
  const b9b = runAuto(mkStore(), { harness: 'emitLocChange("在你身边");', rand: [0.1, 0.0, 0.1, 0.2] });
  note('B9b', b9b.curArg && b9b.curArg.text === '一直没走远' && b9b.randUsed === 4,
    '主动那条应避开上一张（第一发撞回「在你身边」→ 重抽第二发），实得 text=' + JSON.stringify(b9b.curArg && b9b.curArg.text) + ' 抽数=' + b9b.randUsed);
  const b9c = runAuto(mkStore(), { harness: 'return emitLocChange("在你身边");', rand: [0.1, 0.0], oldCur: { text: '在你身边', ts: 1 } });
  note('B9c', b9c.ret === true && b9c.saveCur === 1 && b9c.bubble === 0,
    '三发都用完仍撞回同一张时：照发（换位是真换了卡），但内容与上一次相同＝不弹提醒。实得 ret=' + b9c.ret + ' bubble=' + b9c.bubble);

  // B10 词源全关（陪伴句整组停用＋字卡库位置卡全关）＝这一发不发，且一个字都不写（#1315 口径在抽成 emitLocChange 之后仍成立）
  const b10 = runAuto(mkStore(), { allCards: [], killCompanion: true });
  note('B10', b10.chat === 0 && b10.saveCur === 0 && b10.saveHist === 0 && b10.fx === 0 && b10.render === 0 && b10.bubble === 0,
    '词源关空应整条静默（不写库、不重画、不弹窗），实得 ' + JSON.stringify(b10));
} catch (e) {
  failures.push('B*：行为断言执行失败——' + e.message);
}

// ---- S 组源码锚点（设置组 UI） ----
try {
  extractStr('id="loc-auto-tg"');
  extractStr('id="loc-bubble-tg"');
  extractStr('id="loc-chat-tg"');
  extractStr("bindLocTg('loc-auto-tg', 'loc-auto')");
  extractStr("bindLocTg('loc-bubble-tg', 'loc-bubble')");
  extractStr("bindLocTg('loc-chat-tg', 'loc-chat')");
} catch (e) {
  failures.push('S1：' + e.message);
}
try {
  // S2 #1436 续批：开关退役（loc-shift-tg／loc-sense-shift／shiftNow 一处不剩）＋无条件催换位＋出口仍在
  if (src.indexOf('loc-shift-tg') >= 0 || src.indexOf('loc-sense-shift') >= 0 || src.indexOf('shiftNow') >= 0) throw new Error('前置开关没删干净');
  extractStr('if (window.locShiftNow) window.locShiftNow();');
  extractStr('window.locShiftNow = function ()');
} catch (e) {
  failures.push('S2：' + e.message);
}

// ---- 全文件语法自检（编译不执行） ----
try { new Function(src); } catch (e) { failures.push('SYN：整文件编译失败——' + e.message); }

// ---- 汇总（red 对照：旧代码应至少违反一条新闸门断言） ----
if (EXPECT === 'red') {
  if (failures.length) { console.log('RED-OK（旧代码如预期红 ' + failures.length + ' 条：' + failures.join('；') + '）'); process.exit(0); }
  console.error('红对照失败：旧代码竟全绿，断言没咬合'); process.exit(1);
}
if (failures.length) { console.error('FAIL ' + failures.length + ' 条：\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('OK #790 换位三开关 + #1436 豁免限流/落地重画/按钮即开关：B1~B10 行为 + S1/S2 锚点 + 语法 全过');
process.exit(0);
