// ===== #826 专项回归：TA 心愿单的「新愿望」看得见（提示说加了心愿、点进面板却看不见）=====
// 用户 2026-09-19：「联系人加礼物加入心愿单，黑色弹窗提示了，但是我点进去看心愿单没有看到
//                 黑色弹窗提示的联系人添加的礼物」
// 根因：提示（maybeAutoGift ③）写的是【TA 的心愿单】那一栏，而市集底部「☆ 心愿单」入口硬写
//   wishTab='my'＝永远停在【我的心愿单】；两栏同名不同物、入口与提示之间零指引。
// 修法（src/js/gift-shop.js + src/css/market.css）：
//   ① taWishUnread()/taWishMarkSeen()——per-cid 键 gift-wishlist-ta-seen 记上次看的时间，
//     未读按快照自带 tm 推导（不另存计数器，条目被买掉/移除都不会错位）；首次无键把当时的
//     最新一条记成已读＝老用户升级不会一屏红点；
//   ② 市集入口 #market-wish 挂未读角标（renderMarket → syncWishBadge）；
//   ③ 入口点击：有未读直接落「TA 的心愿单」标签，否则落「我的心愿单」；
//   ④ 面板 TA 标签挂角标、渲染即标记已读；「我的心愿单」标签在有未读时提示语指向 TA 那一栏；
//   ⑤ toast 文案补一行「市集下方「☆ 心愿单」可查看」。
// 用例：A1~A6 未读判定/记账行为（真实函数体＋桩）、B1~B2 入口角标、S1~S6 源码与样式锚点
// 用法：
//   node tools/verify-wish-unread.mjs                                  （绿基线，期望全绿）
//   MOCHI_GS=<HEAD 版 gift-shop.js> MOCHI_CSS=<HEAD 版 market.css> MOCHI_EXPECT=red node …
// 纯 node 静态＋单元验证，不依赖也不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(process.env.MOCHI_GS || join(root, 'src/js/gift-shop.js'), 'utf8');
const css = readFileSync(process.env.MOCHI_CSS || join(root, 'src/css/market.css'), 'utf8');

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
// 在隔离作用域里跑真实函数体：wishLoad / store / 常量全部由桩注入
// 锚点被整块删掉（红基线＝HEAD 还没这两个函数）时 extractFn 抛错 → 记失败、返回 undefined，
// 让用例照常判红而不是把脚本打崩。
function run(id, sig, params, args, tail) {
  try {
    return new Function(...params, '"use strict";' + extractFn(sig) + '; return (function(){' + tail + '})();')(...args);
  } catch (e) { note(id, false, '提取/执行失败：' + e.message); return undefined; }
}

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

// ---- 存储桩：LS 语义（get 缺键返回 null）----
function mkStore(seed, boom) {
  const m = Object.assign({}, seed || {});
  return {
    data: m,
    get(k) { if (boom) throw new Error('ls busy'); return m[k] === undefined ? null : m[k]; },
    set(k, v) { if (boom) throw new Error('ls busy'); m[k] = v; },
  };
}
const KEY_TA = 'gift-wishlist-ta', KEY_SEEN = 'gift-wishlist-ta-seen';

// ---- A1~A5 taWishUnread 行为 ----
function unread(items, seed, boom) { /* 注入 wishLoad/store/两个键名 */
  const s = mkStore(seed, boom);
  const n = run('A-extract', 'function taWishUnread(', ['wishLoad', 'store', 'WL_TA_KEY', 'WL_TA_SEEN_KEY'], [
    (k) => (k === KEY_TA ? items.map((x) => Object.assign({}, x)) : []), () => s, KEY_TA, KEY_SEEN,
  ], 'return taWishUnread();');
  return { n, s };
}
{
  const r = unread([{ giftId: 'g1', tm: 1000 }, { giftId: 'g2', tm: 2000 }], undefined);
  note('A1', r.n === 0, '存量首次应记为已读＝0，得 ' + r.n);
  note('A1b', r.s.data[KEY_SEEN] === '2000', '首次要把最新一条的 tm 记成已读，得 ' + r.s.data[KEY_SEEN]);
}
{
  const r = unread([{ giftId: 'g1', tm: 1000 }, { giftId: 'g2', tm: 3000 }], { [KEY_SEEN]: '2000' });
  note('A2', r.n === 1, 'seen=2000 时 tm=3000 一条未读，得 ' + r.n);
}
{
  const r = unread([{ giftId: 'g1', tm: 1000 }, { giftId: 'g2', tm: 3000 }, { giftId: 'g3', tm: 4000 }], { [KEY_SEEN]: '2000' });
  note('A3', r.n === 2, '两条新愿＝2，得 ' + r.n);
}
{
  // 买掉/移除后不残留虚高：只剩旧的未读那条被删，剩 tm<=seen
  const r = unread([{ giftId: 'g1', tm: 1000 }], { [KEY_SEEN]: '2000' });
  note('A4', r.n === 0, '条目减少后不该计数，得 ' + r.n);
  const r2 = unread([{ giftId: 'g1' }], { [KEY_SEEN]: '2000' });
  note('A4b', r2.n === 0, '无 tm 的异常条目按已读处理，得 ' + r2.n);
}
{
  const r = unread([{ giftId: 'g1', tm: 3000 }], undefined, true);
  note('A5', r.n === 0, '存储抛错要兜底 0（不能挡住送礼主流程），得 ' + r.n);
}
{
  const r = unread([], { [KEY_SEEN]: '0' });
  note('A6', r.n === 0, '空清单＝0，得 ' + r.n);
}

// ---- B1~B2 syncWishBadge（真实函数体＋document 桩）----
function badge(items, seed) {
  const btn = { id: 'market-wish', innerHTML: '☆ 心愿单' };
  const doc = { getElementById: (id) => (id === btn.id ? btn : null) };
  run('B-extract', 'function syncWishBadge(', ['document', 'taWishUnread'], [doc, () => items.length], 'syncWishBadge(); return null;');
  return btn.innerHTML;
}
note('B1', badge([{ tm: 1 }], {}) === '☆ 心愿单<i class="wish-badge">1</i>', '有未读应挂角标数字，得 ' + badge([{ tm: 1 }], {}));
note('B2', badge([], {}) === '☆ 心愿单', '无未读应只剩原文字，得 ' + badge([], {}));

// ---- S1~S6 源码/样式锚点 ----
note('S1', src.includes("wishTab = taWishUnread() ? 'ta' : 'my'"), '市集入口未按未读写落标签（HEAD＝硬写 my＝报障本体）');
note('S2', src.includes("if (wishTab === 'ta') { taWishMarkSeen();"), '面板切到 TA 标签未标记已读');
note('S3', src.includes('syncWishBadge();\n  }'), 'renderMarket 未刷新入口角标');
note('S4', src.includes("市集下方「☆ 心愿单」可查看'"), 'toast 未补去处指引');
note('S5', src.includes('这一栏看。\\n'), '「我的心愿单」提示语未指向 TA 那一栏');
note('S6', css.includes('.wish-badge {') && css.includes('.wish-hint { white-space: pre-line; }'), '角标/分行提示样式缺失');
note('S7', src.includes("const WL_TA_SEEN_KEY = 'gift-wishlist-ta-seen';"), '未读键名锚点缺失');

if (failures.length) {
  console.log('❌ verify-wish-unread ' + (EXPECT === 'red' ? '(红对照)' : '') + ' 失败 ' + failures.length + ' 条：');
  failures.forEach((f) => console.log('   · ' + f));
  process.exit(EXPECT === 'red' ? 0 : 1);
}
console.log('✅ verify-wish-unread 全过（A1~A6 行为 8 项 + B1~B2 角标 2 项 + S1~S7 锚点 7 项）');
if (EXPECT === 'red') { console.log('⚠️ 红对照不该全绿——说明断言没落在修复面上'); process.exit(1); }
