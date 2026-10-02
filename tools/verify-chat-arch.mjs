// ===== 专项验证 #127：聊天记录分片（新消息写增量日志，基准包低频重写） =====
// 背景（TASKS.md #127）：chat-msgs 单键可达 155~214MB，发 1KB 文字也整包 JSON/结构化克隆
//   + 落盘（写放大数百倍），是 iOS OOM / 读写超时 / 开屏恢复慢的共同上游。
// 修复：<prefix>:chat-msgs 作基准包，<prefix>:chat-arch 作增量日志；平时只写小日志键，
//   读侧（loadMsgs）拼接；安全闸＝逐条对象身份 + 字段指纹校验基准段未被改动，否则整包重写。
//   为避免影响小历史与其它直接读 chat-msgs 的地方，仅当基准包 ≥1MB 时才启用分片。
// 用法：node tools/verify-chat-arch.mjs
//   RED 对照：MOCHI_CHAT_SRC=<修复前 chat.js> node tools/verify-chat-arch.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const readSrc = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const chatSrc = process.env.MOCHI_CHAT_SRC
  ? readFileSync(process.env.MOCHI_CHAT_SRC, 'utf8').replace(/\r\n/g, '\n')
  : readSrc(join(root, 'src/js/chat.js'));
const poolSrc = readSrc(join(root, 'src/js/media-pool.js'));
const idbSrc = readSrc(join(root, 'src/js/idb.js'));
const backupSrc = readSrc(join(root, 'src/js/data-backup.js'));
const buildSrc = readSrc(join(root, 'build.mjs'));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + String(detail).slice(0, 240) + ']' : ''));
}
function sliceBetween(src, startMark, endMark) {
  const i = src.indexOf(startMark);
  if (i < 0) return '';
  const j = src.indexOf(endMark, i);
  return j < 0 ? src.slice(i) : src.slice(i, j);
}

// ============ A 轴：源码级 ============
check('A1 增量日志键与阈值常量在位（CHAT_ARCH_KEY / MAX / BYTES / MIN_CKPT）',
  /const CHAT_ARCH_KEY = 'chat-arch';/.test(chatSrc) &&
  /const CHAT_ARCH_MAX = \d+;/.test(chatSrc) &&
  /const CHAT_ARCH_BYTES = \d+ \* 1024 \* 1024;/.test(chatSrc) &&
  /const CHAT_ARCH_MIN_CKPT = \d+ \* 1024;/.test(chatSrc));
check('A2 落盘入口 persistChatHistory 分片判定（大基准包 + 日志在上限内 → 只写日志键）',
  /function persistChatHistory\(prefix, arr, forceFull\) \{/.test(chatSrc) &&
  /chatArchBytes >= CHAT_ARCH_MIN_CKPT && chatArchReusable\(prefix, arr\)/.test(chatSrc) &&
  /if \(log\.length <= CHAT_ARCH_MAX && msgsBytes\(log\) <= CHAT_ARCH_BYTES\) \{/.test(chatSrc) &&
  /persistMsgsToIdb\(prefix \+ ':' \+ CHAT_ARCH_KEY, log\);/.test(chatSrc));
check('A3 安全闸＝对象身份 + 字段指纹逐条校验（删/插/改任一即不复用基准段）',
  /arr\[i\] !== chatArchRef\[i\]/.test(chatSrc) && /chatMsgFp\(arr\[i\]\) !== chatArchFp\[i\]/.test(chatSrc));
check('A4 指纹覆盖文本内容（同长度改字也咬得住，t.length <= CHAT_FP_TEXT 时算滚动校验）',
  /if \(t\.length && t\.length <= CHAT_FP_TEXT\) \{ for \(let i = 0; i < t\.length; i\+\+\) ch = \(ch \* 31 \+ t\.charCodeAt\(i\)\) \| 0; \}/.test(chatSrc));
check('A5 所有整包落盘点已接入 persistChatHistory（saveMsgs / saveMsgsNow / 归一化）',
  (chatSrc.match(/persistChatHistory\(/g) || []).length >= 8, 'count=' + ((chatSrc.match(/persistChatHistory\(/g) || []).length));
check('A6 离页/导出前收口（flushSave 调 chatConsolidate；chatConsolidate 走整包写）',
  /try \{ chatConsolidate\(chatArchPrefix\); \} catch \(e\) \{\}/.test(chatSrc) && /persistChatHistory\(prefix, msgs, true\);/.test(chatSrc));
check('A7 切桌面收口并作废基准段（chatConsolidate + chatArchClearBaseline）',
  /try \{ chatConsolidate\(chatArchPrefix\); \} catch \(e\) \{\}\ntry \{ hideTyping\(\); \} catch \(e\) \{\}\nchatArchClearBaseline\(\);\nmsgs = \[\];/.test(chatSrc));
check('A8 读侧拼接增量日志并去重（ckptSigs 过滤后按 ts 排序拼接）',
  /window\.idbGet\(myPrefix \+ ':chat-arch'\)\.then\(function \(av\) \{/.test(chatSrc) &&
  /archArr = archArr\.filter\(function \(m\) \{ return m && !ckptSigs\.has\(sigOf\(m\)\) && !chatRecKeysHit\(ckptCopies, m\); \}\);/.test(chatSrc) &&
  /idbArr = ckptArr\.concat\(archArr\)\.sort\(/.test(chatSrc));
check('A9 读库成功后设基准段（此后只写增量日志）',
  /try \{ chatArchSetBaseline\(myPrefix, ckptArr\); \} catch \(e\) \{\}/.test(chatSrc));
check('A10 「确认空库」把日志键一起算（首轮 confirmMiss 与 2.5s 复核都查 chat-arch）',
  (chatSrc.match(/idbArchKey/g) || []).length >= 4 && /r\[0\] === false && r\[1\] === false/.test(chatSrc));
check('A11 清空 / 导入 都清日志键并作废基准段',
  /store\.remove\('chat-arch'\); \} catch \(e\) \{\} \/\/ FIX 2026-09-17 #127/.test(chatSrc) &&
  /chatArchClearBaseline\(\); \/\/ FIX 2026-09-17 #127：整包替换/.test(chatSrc));
check('A12 导入写回前清日志键（data-backup clearDeskTail）',
  /window\.xyStore\(ns\)\.remove\('chat-arch'\);/.test(backupSrc));
check('A13 媒体池 GC/Coverage 引用面都含 chat-arch（两处同口径，否则最新消息的图片被当孤儿删）',
  (poolSrc.match(/feed-posts\(\?:-snap\)\?\|chat-arch\)\$\/;/g) || []).length === 2,
  'count=' + ((poolSrc.match(/chat-arch/g) || []).length));
check('A14 idb.js 回填排除日志键（不回填 LS，防白占配额）',
  /if \(tail === 'chat-arch' \|\| \/\^\[\^:\]\+:chat-arch\$\/\.test\(tail\)\) return true;/.test(idbSrc));
check('A15 build.mjs 已登记 #127a~g 逻辑锚点',
  /#127a /.test(buildSrc) && /#127b /.test(buildSrc) && /#127c /.test(buildSrc) &&
  /#127d /.test(buildSrc) && /#127e /.test(buildSrc) && /#127f /.test(buildSrc) && /#127g /.test(buildSrc));

// ============ B 轴：核心函数行为（从源码抽出，沙箱真跑） ============
try {
const msgsBytesSrc = sliceBetween(chatSrc, 'function msgsBytes(arr) {', '// v3.26.x OOM 核心');
const thrSrc = sliceBetween(chatSrc, 'const CHAT_STR_THRESHOLD =', '\n');
const persistSrc = sliceBetween(chatSrc, 'function persistMsgsToIdb(key, arr) {', '// ===== FIX 2026-09-17 #127');
const archSrc = sliceBetween(chatSrc, "const CHAT_ARCH_KEY = 'chat-arch';", '// v3.26.x #90：聊天记录「条数账本」');
const code = [thrSrc, msgsBytesSrc, persistSrc, archSrc].join('\n');

const store = new Map();
const writes = [];
const dels = [];
const win = {
  idbSet: (k, v) => { store.set(k, typeof v === 'string' ? JSON.parse(v) : v); writes.push(k); return Promise.resolve(true); },
  idbDelete: (k) => { store.delete(k); dels.push(k); return Promise.resolve(true); },
};
const lsStub = { removeItem() {}, getItem() { return null; }, setItem() {} };
const makeApi = (msgsRef) => new Function(
  'window', 'localStorage', 'chatLedgerGuard', 'msgs',
  code + '\nreturn { persistChatHistory, chatConsolidate, chatArchSetBaseline, chatArchClearBaseline, chatArchReusable, chatMsgFp, CHAT_ARCH_KEY, CHAT_ARCH_MAX, CHAT_ARCH_MIN_CKPT };'
)(win, lsStub, () => true, msgsRef);

const ckpt = () => store.get('P:chat-msgs');
const arch = () => store.get('P:chat-arch');
const reset = () => { store.clear(); writes.length = 0; dels.length = 0; };
const msgsOf = (n, from) => { const a = []; for (let i = 0; i < n; i++) a.push({ ts: (from || 0) + i, side: i % 2 ? 'in' : 'out', text: 'm' + i }); return a; };
const PAD = 'p'.repeat(1300 * 1024);            // 1.3MB（> CHAT_ARCH_MIN_CKPT＝1MB）
const padMsg = (ts) => ({ ts: ts, side: 'in', text: PAD });

const api = makeApi([]);
api.chatArchClearBaseline();

// B0 小历史（基准包 <1MB）不走分片：追加照旧整包写，不产生日志键
reset(); api.chatArchClearBaseline();
let small = msgsOf(5, 100);
api.persistChatHistory('P', small);
api.chatArchSetBaseline('P', small);
small = small.concat(msgsOf(2, 200));
api.persistChatHistory('P', small);
check('B0 小历史不做分片（保持旧整包写行为，其它读键方零变化）',
  ckpt().length === 7 && arch() === undefined, 'ckpt=' + ckpt().length + ' arch=' + JSON.stringify(arch()));

// B1 首次保存（无基准段）→ 写基准包（含 1.3MB pad），不写日志
reset(); api.chatArchClearBaseline();
let arr = msgsOf(5, 100).concat([padMsg(500)]);
api.persistChatHistory('P', arr);
check('B1 首次保存＝写基准包、无日志键',
  Array.isArray(ckpt()) && ckpt().length === 6 && arch() === undefined, 'ckpt=' + ckpt().length + ' arch=' + JSON.stringify(arch()));

// B2 大基准包 + 追加 → 只写增量日志，基准包一字未动
api.chatArchSetBaseline('P', arr);
const before2 = JSON.stringify(ckpt());
arr = arr.concat(msgsOf(2, 200));
api.persistChatHistory('P', arr);
check('B2 追加消息只写增量日志、基准包一字未动（写放大被消除）',
  JSON.stringify(ckpt()) === before2 && Array.isArray(arch()) && arch().length === 2,
  'ckpt=' + ckpt().length + ' arch=' + (arch() ? arch().length : 'none'));

// B3 原地改基准段某条小消息（同长度改字）→ 指纹破 → 整包重写 + 清日志
const before3 = JSON.stringify(ckpt());
arr[0].text = 'mX';   // 与 'm0' 同长度
api.persistChatHistory('P', arr);
check('B3 基准段被同长度改写 → 整包重写、日志清空（安全闸生效）',
  JSON.stringify(ckpt()) !== before3 && arch() === undefined && dels.includes('P:chat-arch'),
  'dels=' + JSON.stringify(dels));

// B4 从基准段中间删一条 → 整包重写
const cur4 = store.get('P:chat-msgs');
api.chatArchSetBaseline('P', cur4);
const four = cur4.slice();
four.splice(2, 1);
api.persistChatHistory('P', four);
check('B4 基准段被删除一条 → 整包重写（长度缩短不复用）',
  ckpt().length === four.length && arch() === undefined, 'ckpt=' + ckpt().length + ' arr=' + four.length);

// B5 日志超过条数上限 → 压缩进基准包并清日志
reset(); api.chatArchClearBaseline();
let big = msgsOf(5, 1000).concat([padMsg(2000)]);
api.persistChatHistory('P', big);
api.chatArchSetBaseline('P', big);
big = big.concat(msgsOf(api.CHAT_ARCH_MAX + 1, 3000));
api.persistChatHistory('P', big);
check('B5 日志超过 CHAT_ARCH_MAX → 压缩进基准包、日志清空',
  ckpt().length === big.length && arch() === undefined,
  'ckpt=' + ckpt().length + ' expect=' + big.length + ' arch=' + JSON.stringify(arch()));

// B6 与基准段全等（同一数组、无改动）→ 零写
reset(); api.chatArchClearBaseline();
let six = msgsOf(4, 100).concat([padMsg(400)]);
api.persistChatHistory('P', six);
api.chatArchSetBaseline('P', six);
const before6 = JSON.stringify(ckpt());
writes.length = 0;
api.persistChatHistory('P', six);
check('B6 无改动保存为零写（基准包不变、日志清空、无新写）',
  JSON.stringify(ckpt()) === before6 && writes.length === 0 && arch() === undefined, 'writes=' + JSON.stringify(writes));

// B7 chatConsolidate：有小量日志时收口成整包（切桌面/离页/导出用）
reset(); api.chatArchClearBaseline();
const seven = msgsOf(4, 100).concat([padMsg(400)]);
api.persistChatHistory('P', seven);
api.chatArchSetBaseline('P', seven);
const sevenFull = seven.concat(msgsOf(3, 200));
api.persistChatHistory('P', sevenFull);
const hadArch = arch() && arch().length === 3;
const api2 = makeApi(sevenFull);
api2.chatArchSetBaseline('P', seven); // 基准段＝seven（与 sevenFull 前段同引用）
api2.chatConsolidate('P');
check('B7 chatConsolidate 把日志收口进基准包（基准包=全量、日志清空）',
  hadArch && ckpt().length === sevenFull.length && arch() === undefined,
  'hadArch=' + hadArch + ' ckpt=' + ckpt().length + ' expect=' + sevenFull.length);

// B8 指纹灵敏度
const fp = api.chatMsgFp;
check('B8a 指纹咬住同长度文本改写', fp({ ts: 1, text: 'abc' }) !== fp({ ts: 1, text: 'abd' }));
check('B8b 指纹咬住回答状态原地改写', fp({ ts: 1, text: 'a' }) !== fp({ ts: 1, text: 'a', answered: true }));
check('B8c 指纹对未改动消息稳定（幂等）', fp({ ts: 1, side: 'in', text: 'x', parts: [{ k: 'img', v: 'data' }] }) === fp({ ts: 1, side: 'in', text: 'x', parts: [{ k: 'img', v: 'data' }] }));
check('B8d 指纹只比对白名单字段（白名单外的附加字段不参与，靠对象身份兜底）',
  fp({ ts: 1, text: 'x' }) === fp({ ts: 1, text: 'x', someRandomFlag: 1 }));

// B9 读侧去重行行为（从源码抽出表达式真跑）
const dedupLine = /archArr = archArr\.filter\(function \(m\) \{ return m && !ckptSigs\.has\(sigOf\(m\)\)( && !chatRecKeysHit\(ckptCopies, m\))?; \}\);/.exec(chatSrc);
let merged = null;
if (dedupLine) {
  // 副本键一层（#776）在本脚本里以「不命中」桩代入——它的行为断言归 verify-chat-dup-soak R6；
  // 这里只验「按签名去重」这条抽出来的表达式真跑起来确实只留真正的新条目。
  const run = new Function('archArr', 'ckptSigs', 'sigOf', 'ckptCopies', 'chatRecKeysHit', dedupLine[0] + '\nreturn archArr;');
  const sigOf = (m) => m.sig;
  merged = run([{ sig: 'a' }, { sig: 'c' }, { sig: 'b' }], new Set(['a', 'b']), sigOf, new Set(), () => false);
}
check('B9 日志与基准包重叠条目按签名去重（压缩崩溃窗口不翻倍，只留真正的新条目）',
  merged && merged.length === 1 && merged[0].sig === 'c', JSON.stringify(merged));

// B10 单条超大消息触发字节上限压缩（不把 4MB+ 反复写进日志）
reset(); api.chatArchClearBaseline();
let ten = [{ ts: 1, side: 'in', text: 'seed' }, padMsg(2)];
api.persistChatHistory('P', ten);
api.chatArchSetBaseline('P', ten);
ten = ten.concat([{ ts: 3, side: 'in', text: 'x'.repeat(5 * 1024 * 1024) }]);
api.persistChatHistory('P', ten);
await new Promise(function (r) { setTimeout(r, 400); }); // #722：分块写入是异步链，等一拍再断言
// #722 起：>4MB（CHAT_BLK_MIN）不再整包重写，改分块直存（chat-blk-* + blk-idx），两种形态都算「没写日志」
let blkIdxP = null;
try { const raw = store.get('P:chat-blk-idx'); blkIdxP = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) {}
const ckptV = ckpt(), archV = arch();
const blockified = blkIdxP && blkIdxP.total === 3 && Array.isArray(blkIdxP.blocks) && archV === undefined && ckptV === undefined;
check('B10 单条超大消息触发字节上限压缩（不把 4MB+ 反复写进日志；#722 起超 4MB 走分块直存）',
  (ckptV && ckptV.length === 3 && archV === undefined) || blockified, 'ckpt=' + (ckptV ? ckptV.length : 'gone') + ' arch=' + JSON.stringify(archV) + ' blkTotal=' + (blkIdxP && blkIdxP.total));
} catch (e) {
  check('B 核心机制行为（修复前基线：chat.js 无 persistChatHistory / chat-arch 分片机制）', false, String(e && e.message));
}

const pass = results.filter(r => r.ok).length, fail = results.filter(r => !r.ok).length;
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
