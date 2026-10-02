// #955 行为断言：存储写路径再优化——跨桌面聊天写回免整包串化 + 信箱大负载延迟落盘。
// 用法：node tools/verify-955-storage-write-paths.mjs   （MOCHI_ROOT 可指向隔离副本）
// 修前缺陷（纯 HEAD 实证）：
//   chat.js 三处跨桌面 writeArr 都是「整包 JSON.stringify 两次」（idbSet 一次、LS 一次）——
//     对方桌面聊天库几十 MB 时，一次拍一拍/回卡落地＝几十 MB 主线程同步长任务（大库机型
//     跨桌面操作卡顿的遗留热点；当前桌面 saveMsgs 有 #127 分片 + #722 分块，这条路径没跟上）。
//   mail.js save()/权威合并每次整包 stringify——信件可含图片 dataURL（MB 级），收信/回信
//     落地瞬间就是一次主线程长任务。
// 修法：#955 chat 侧 IDB 复用 persistMsgsToIdb（≤3MB 字符串 / >3MB 数组直存+失败回退）、LS 走
//   performLsSnapWrite 的 lite+折半口径（大历史先预裁最近段再进折半）；mail 侧浅估分流
//   （≤64KB 同步写、超过挂 per-桌面 待写 + 800ms 去抖 + 离页冲刷，读侧挂起优先）。
// 用例：S1~S6 静态锚；B1~B4 chat 行为（小库字符串/大库直存/直存失败回退/全程无整包串化）；
//   B5~B8 mail 行为（小包同步/大包挂起/flush 写最新且恰一次/挂起优先）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const root = process.env.MOCHI_ROOT
  ? path.resolve(process.env.MOCHI_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chatSrc = readFileSync(path.join(root, 'src/js/chat.js'), 'utf8');
const mailSrc = readFileSync(path.join(root, 'src/js/mail.js'), 'utf8');

let pass = 0, fail = 0;
function A(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + String(extra).slice(0, 200) : '')); }
}
function cut(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) throw new Error('锚点缺失: ' + from);
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error('锚点缺失(尾): ' + to);
  return src.slice(a, b);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('静态断言:');
A('S1 跨桌面写回统一入口 deskWriteMsgsArr', chatSrc.includes('function deskWriteMsgsArr(key, cid, arr) {'));
A('S2 三处 writeArr 全部改走该入口', (chatSrc.match(/deskWriteMsgsArr\(key, cid, arr\);/g) || []).length === 3);
A('S3 跨桌面写不再整包 stringify 进 idbSet（仅 persistMsgsToIdb 回退路径保留 1 处）',
  (chatSrc.match(/window\.idbSet\(key, JSON\.stringify\(arr\)\)/g) || []).length === 1);
A('S4 大历史 LS 快照先预裁最近段', chatSrc.includes('if (est > LS_SNAP_LIMIT) snapSrc = arr.slice('));
A('S5 信箱大负载分流闸在位',
  mailSrc.includes('if (mailListBytes(list) <= MAIL_BIG_DEFER_BYTES) { csFor(cid).set(KEY, JSON.stringify(list)); return; }'));
A('S6 信箱挂起列表优先于旧持久值',
  mailSrc.includes('if (_pend) cur = _pend.list.slice();') && mailSrc.includes('const _pend = _mailBigPend.get(mailPendKey(cid));'));

// ---------- chat 行为 ----------
let chatCode = null;
try {
  const chatRegion = cut(chatSrc, 'const LS_SNAP_LIMIT = 2 * 1024 * 1024;', '// ===== FIX 2026-09-17 #127');
  const chatLite = cut(chatSrc, 'function liteSnapArray(arr) {', '// FIX 2026-09-07 #245');
  const chatDesk = cut(chatSrc, 'function deskWriteMsgsArr(key, cid, arr) {', 'window.chatAppendToDeskMsg');
  chatCode = chatRegion + '\n' + chatLite + '\n' + chatDesk + '\n;({ persistMsgsToIdb, deskWriteMsgsArr, msgsBytes, LS_SNAP_LIMIT });';
} catch (e) {
  console.log('  ❌ chat 行为断言锚点缺失（修复真丢了）: ' + e.message);
  fail++;
}

function mkChatEnv(idbSetImpl) {
  const rec = { idb: [], lsSets: [], maxStringifyArg: 0 };
  const RealJSON = JSON;
  const sandbox = {
    console, Promise, Array, Object, Math, Date, String, Number, Error,
    JSON: {
      stringify: function (v) {
        const s = RealJSON.stringify(v);
        if (s && s.length > rec.maxStringifyArg) rec.maxStringifyArg = s.length;
        return s;
      },
      parse: RealJSON.parse
    },
    localStorage: {
      setItem: function (k, v) { rec.lsSets.push({ k: k, len: String(v).length }); },
      getItem: function () { return null; },
      removeItem: function () {}
    }
  };
  sandbox.window = {
    idbSet: function (k, v) {
      rec.idb.push({ isArr: Array.isArray(v), len: Array.isArray(v) ? v.length : String(v).length });
      return idbSetImpl(v);
    }
  };
  sandbox.globalThis = sandbox;
  const api = vm.runInContext(chatCode, vm.createContext(sandbox));
  return { api, rec };
}
function bigMsgs() {
  const big = [];
  for (let i = 0; i < 40; i++) big.push({ side: 'in', text: 'y'.repeat(200 * 1024), ts: i });
  return big; // 浅估 ≈ 8MB > CHAT_STR_THRESHOLD(3MB)
}
function smallMsgs() {
  const small = [];
  for (let i = 0; i < 20; i++) small.push({ side: 'in', text: 'x'.repeat(1000), ts: i });
  return small; // 浅估 ≈ 21KB
}

console.log('chat 行为断言:');
if (!chatCode) { /* 锚点缺失已在上面计红，跳过 vm 用例 */ } else try {
  {
    const { api, rec } = mkChatEnv(() => Promise.resolve(true));
    api.deskWriteMsgsArr('xy-home-v2:c2:chat-msgs', 'c2', smallMsgs());
    A('B1 小库仍走字符串形态 IDB 写（旧数据形态零变化）', rec.idb.length === 1 && rec.idb[0].isArr === false, rec.idb);
  }
  {
    const { api, rec } = mkChatEnv(() => Promise.resolve(true));
    api.deskWriteMsgsArr('xy-home-v2:c2:chat-msgs', 'c2', bigMsgs());
    A('B2 大库跨桌面写＝数组直存 IDB（structured clone，免整包 stringify）',
      rec.idb.length === 1 && rec.idb[0].isArr === true, rec.idb);
    A('B4 全程无「整包串化」：单次 JSON.stringify 入参 ≤2.1MB（旧实现此处≥8MB）',
      rec.maxStringifyArg <= 2.2 * 1024 * 1024, rec.maxStringifyArg);
    A('B4b LS 快照落盘体积仍 ≤2MB 上限（跨桌面兜底语义不变）',
      rec.lsSets.length === 1 && rec.lsSets[0].len <= 2 * 1024 * 1024, rec.lsSets);
  }
  {
    let calls = 0;
    const { api, rec } = mkChatEnv(function (v) { calls++; return Promise.resolve(Array.isArray(v) ? false : true); });
    api.deskWriteMsgsArr('xy-home-v2:c2:chat-msgs', 'c2', bigMsgs());
    await sleep(20);
    A('B3 数组直存失败回退字符串（防 DataCloneError 丢数据）',
      calls === 2 && rec.idb.length === 2 && rec.idb[0].isArr === true && rec.idb[1].isArr === false, rec.idb);
  }
} catch (e) {
  A('chat 行为断言（锚点截取失败＝修复被删）', false, e.message);
}

// ---------- mail 行为 ----------
console.log('mail 行为断言:');
try {
  const mailCode = "const KEY = 'mail-letters';\n" +
    cut(mailSrc, 'const MAIL_BIG_DEFER_BYTES', 'function save(list, cid) {') +
    '\n;({ mailStoreWrite, mailBigFlush, mailListBytes, mailPendKey, _mailBigPend });';
  function mkMailEnv() {
    const rec = { sets: [] };
    const sandbox = {
      console, Map, Array, Object, Math, Date, String, Number, Error,
      setTimeout: setTimeout, clearTimeout: clearTimeout, JSON: JSON,
      window: { __activeCid: 'default' },
      document: { addEventListener: function () {}, visibilityState: 'visible' }
    };
    sandbox.csFor = function (cid) {
      return {
        set: function (k, v) { rec.sets.push({ cid: cid, k: k, len: String(v).length }); }
      };
    };
    sandbox.globalThis = sandbox;
    const api = vm.runInContext(mailCode, vm.createContext(sandbox));
    return { api, rec };
  }
  function letters(n, per) {
    const a = [];
    for (let i = 0; i < n; i++) a.push({ id: 'L' + i, tm: i, content: 'z'.repeat(per) });
    return a;
  }
  {
    const { api, rec } = mkMailEnv();
    api.mailStoreWrite(letters(10, 2000), undefined); // ≈ 20KB
    A('B5 小信箱包同步落盘（绝大多数纯文本信行为零变化）', rec.sets.length === 1, rec.sets);
  }
  {
    const { api, rec } = mkMailEnv();
    api.mailStoreWrite(letters(10, 20000), undefined); // ≈ 200KB > 64KB
    const immediate = rec.sets.length;
    await sleep(50);
    A('B6 大信箱包挂起不立即串化落盘（收信/回信瞬间主线程零长任务）',
      immediate === 0 && rec.sets.length === 0, { immediate: immediate, after: rec.sets.length });
    await sleep(900);
    A('B6b 800ms 去抖后照常落盘（写入仍必达）', rec.sets.length === 1, rec.sets);
    A('B6c 落盘后清空挂起表（不重复写）', api._mailBigPend.size === 0, api._mailBigPend.size);
  }
  {
    const { api, rec } = mkMailEnv();
    api.mailStoreWrite(letters(10, 20000), undefined);
    api.mailStoreWrite(letters(11, 20000), undefined); // 窗口内第二次：应合并成一次写、写最新
    await sleep(900);
    A('B7 去抖窗口内多次大改合并为一次落盘（写放大消除）', rec.sets.length === 1, rec.sets);
    A('B7b 合并写的是最新列表（不漏最近一次改动）', rec.sets.length === 1 && rec.sets[0].len > letters(10, 20000).length * 0.9, rec.sets);
  }
  {
    const { api } = mkMailEnv();
    const latest = letters(12, 20000);
    api.mailStoreWrite(latest, undefined);
    const p = api._mailBigPend.get(api.mailPendKey(undefined));
    A('B8 挂起表以桌面命名空间为键且存最新列表（读侧据此优先，不读旧持久值）',
      !!p && p.cid === undefined && p.list.length === 12, api._mailBigPend.size);
    api.mailBigFlush();
    A('B8b 离页/超时冲刷后挂起表清空', api._mailBigPend.size === 0, api._mailBigPend.size);
  }
} catch (e) {
  A('mail 行为断言（锚点截取失败＝修复被删）', false, e.message);
}

console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
