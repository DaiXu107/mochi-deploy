// ===== #809 专项回归：问问TA 发单题「思考时间（秒）」可自定义（同帮我决定/多人决定 stepper） =====
// 用户直派：「打开这功能页面只发送一个题目时，需要新增和帮我决定群来决定一样的自定义思考时间，秒。
//           默认就是现在的秒，但是优化用户可以自己设置。」
// 实现（src/js/chat.js，零机型分支）：
//   ① askThinkSecsLoad()——per-cid 键 ask-think-secs（store=当前桌面命名空间），1~10 之外/脏值/缺键一律回落 3 秒
//     （3 秒＝原随机 1500+rand*2500 的常用档，即「默认就是现在的秒」）；
//   ② ensureChatAskThinkRow()——半框注入 .gs-row stepper（同 decision.js 形态，1~10 步进 1，点击即持久化），
//     只在 ask（问问TA）模式显示、invite（邀请TA）模式隐藏（.gs-row[hidden] 已有 #727 兜底）；
//   ③ submitChatAsk ask 分支延迟改 askThinkSecsLoad()*1000（invite 分支 1500+rand*2500 保持不变）。
// 用例：
//   A1 缺键 → 3；A2 '7' → 7；A3 '0'/'11'/'abc'/'' → 3（越界/脏值收敛）；A4 store.get 抛错 → 3
//   S1 延迟行走设置（HEAD 仍是 1500+rand*2500＝红）；S2 stepper 行 id 在位；S3 点击持久化在位；
//   S4 openChatAskPanel 接线在位；S5 invite 模式隐藏行在位；S6 全文件随机延迟恰剩 1 处（invite 专用，
//   HEAD＝2 处＝红）
// 用法：
//   node tools/verify-ask-think-time.mjs                        （绿基线，期望全绿）
//   MOCHI_ASK_FILE=<HEAD 版 chat.js> MOCHI_EXPECT=red node …    （红对照，期望全部恰红）
// 纯 node 静态＋单元验证，不依赖不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(process.env.MOCHI_ASK_FILE || join(root, 'src/js/chat.js'), 'utf8');

// ---- 提取函数体（花括号配平），失败＝锚点没了 ----
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
function makeFn(sig, params, args) {
  return new Function(...params, '"use strict";' + extractFn(sig) + '; return ' + sig.replace(/^function\s+/, '').replace(/\s*\(.*/, '') + ';')(...args);
}

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

// ---- A1~A4 askThinkSecsLoad 行为（真实函数体＋store 桩，桩按用例注入） ----
let extractionDead = false;
const loadWith = (storeStub) => {
  try { return makeFn('function askThinkSecsLoad(', ['store'], [storeStub])(); }
  catch (e) { extractionDead = true; failures.push('X：' + e.message); return null; }
};
if (!loadWith({ get: () => null })) extractionDead = true;
if (!extractionDead) {
  const mkStore = (v, boom) => ({ get: (k) => { if (boom) throw new Error('ls busy'); return v; }, set: () => {} });
  note('A1', loadWith(mkStore(null)) === 3, '缺键应回落 3，得 ' + loadWith(mkStore(null)));
  note('A2', loadWith(mkStore('7')) === 7, "设 7 应读 7，得 " + loadWith(mkStore('7')));
  for (const bad of ['0', '11', 'abc', '', '-2']) {
    note('A3', loadWith(mkStore(bad)) === 3, '脏值 ' + JSON.stringify(bad) + ' 应收敛 3，得 ' + loadWith(mkStore(bad)));
  }
  note('A4', loadWith(mkStore(null, true)) === 3, 'store 抛错应兜底 3');
}

// ---- S1~S6 源码锚点（与 build.mjs #809a~c 同源＋接线两处） ----
note('S1', src.includes('}, askThinkSecsLoad() * 1000);'), 'ask 延迟未走 askThinkSecsLoad()*1000');
note('S2', src.includes('id="chat-ask-think"'), '思考时间 stepper 行不在位');
note('S3', src.includes("store.set('ask-think-secs', String(n));"), 'stepper 点击持久化不在位');
note('S4', src.includes('ensureChatAskThinkRow();'), 'openChatAskPanel 未接线思考时间行');
note('S5', src.includes("row.hidden = chatAskMode !== 'ask';"), 'invite 模式隐藏闸不在位');
const randDelayN = src.split('1500 + Math.random() * 2500').length - 1;
note('S6', randDelayN === 1, '随机延迟应恰剩 1 处（invite 专用），实际 ' + randDelayN);

// ---- 汇总（红对照模式：期望列出的用例全红、不许有意外绿；提取失败＝A 组整组按红计） ----
const ids = failures.map(f => f.split('：')[0]);
if (EXPECT === 'red') {
  const isRed = (id) => extractionDead || ids.includes(id);
  const green = [];
  for (const id of ['A1', 'A2', 'A3', 'A4', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']) {
    if (!isRed(id)) green.push(id);
  }
  if (green.length) { console.error('RED-FAIL（红对照却绿）: ' + green.join(',')); process.exit(1); }
  console.log('RED-OK 10/10 恰红（HEAD＝无自定义思考时间）');
  process.exit(0);
}
if (failures.length) {
  console.error('FAIL ' + failures.length + ':\n' + failures.join('\n'));
  process.exit(1);
}
console.log('PASS 10/10（A1~A4 行为 ＋ S1~S6 锚点）——#809 问问TA 思考时间可自定义');
