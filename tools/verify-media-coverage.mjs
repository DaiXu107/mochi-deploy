// #419 媒体池覆盖度核对——纯 Node 抽源码真函数行为断言（防回归，零浏览器依赖）
// 抽取 media-pool.js 的 window.mochiMediaCoverage，stub idbListKeys/idbGet/idbGetMany/localStorage，
// 覆盖：数据链完好 / 部分缺失 / 池全空 / 接口不可用 / 键清单异常 / LS 引用面 / 非聊天键不计数 /
//       池值非法计缺失 / 令牌去重 / 群聊与尾巴键名匹配。
// 用法：node tools/verify-media-coverage.mjs
import { readFileSync } from 'node:fs';

const SRC = new URL('../src/js/media-pool.js', import.meta.url);
const src = readFileSync(SRC, 'utf8');
const startMark = 'window.mochiMediaCoverage = function () {';
const si = src.indexOf(startMark);
if (si < 0) { console.error('FATAL: 找不到 mochiMediaCoverage 定义'); process.exit(1); }
// 从函数体起始做花括号配对，取到赋值语句末尾的 };（函数是顶层 IIFE 里最后一个赋值）
let depth = 0, ei = -1;
for (let i = src.indexOf('{', si); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { ei = i + 1; break; } }
}
if (ei < 0) { console.error('FATAL: mochiMediaCoverage 花括号未闭合'); process.exit(1); }
const fnSrc = src.slice(si, ei);

const FULL = 'xy-home-v2:media:';
// 工厂函数：把 win/ls 作为运行时参数传入（mochiMediaCoverage 内部引用 window/localStorage 是
// 词法闭包，必须让工厂函数接收它们，返回的函数才能拿到传入的 stub 环境）。
const makeCoverage = new Function('FULL', 'window', 'localStorage',
  fnSrc + '\nreturn window.mochiMediaCoverage;');
const coverageFor = (win, ls) => makeCoverage(FULL, win, ls);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('ok   ' + name); }
  else { fail++; console.error('FAIL ' + name + '\n  got:  ' + g + '\n  want: ' + w); }
};

// ---- stub 环境：idb 键表 / idb 值表 / localStorage 值表 ----
function makeEnv(o) {
  const idbKeys = o.idbKeys || [];
  const idbData = o.idbData || {};
  const lsData = o.lsData || {};
  const win = {};
  if (!o.noInterfaces) {
    win.idbListKeys = o.listKeysThrows
      ? async () => { throw new Error('idb 挂了'); }
      : async () => ('keysResult' in o ? o.keysResult : idbKeys);
    win.idbGet = async (k) => idbData[k];
    win.idbGetMany = async (ks) => { const out = {}; for (const k of ks) if (k in idbData) out[k] = idbData[k]; return out; };
  }
  const lsKeys = Object.keys(lsData);
  const ls = {
    length: lsKeys.length,
    key: (i) => lsKeys[i],
    getItem: (k) => (k in lsData ? lsData[k] : null)
  };
  return coverageFor(win, ls)();
}

const H1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const H2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const H3 = 'cccccccccccccccccccccccccccccccc';
const DATA = 'data:image/png;base64,AAAA';
const CHAT_IDB = 'xy-home-v2:chat-msgs';
const CHAT_LS = 'xy-home-v2:chat-msgs';

(async () => {
  // 1 数据链完好：引用 1 令牌，池里 1 条有效
  let r = await makeEnv({
    idbKeys: ['xy-home-v2:media:' + H1, CHAT_IDB],
    idbData: { [CHAT_IDB]: JSON.stringify({ msgs: [{ img: '@@m:' + H1 }] }), ['xy-home-v2:media:' + H1]: DATA }
  });
  eq('数据链完好：引用=池内=1，缺 0', { ok: r.ok, referenced: r.referenced, inPool: r.inPool, missing: r.missing }, { ok: true, referenced: 1, inPool: 1, missing: 0 });

  // 2 部分缺失：引用 2 令牌，池里只有 1 条
  r = await makeEnv({
    idbKeys: ['xy-home-v2:media:' + H1, CHAT_IDB],
    idbData: { [CHAT_IDB]: '@@m:' + H1 + ' 与 @@m:' + H2, ['xy-home-v2:media:' + H1]: DATA }
  });
  eq('部分缺失：引用 2 池内 1 缺 1，样本含 H2', { ok: r.ok, referenced: r.referenced, inPool: r.inPool, missing: r.missing, s0: r.missingSamples[0] }, { ok: true, referenced: 2, inPool: 1, missing: 1, s0: H2 });

  // 3 池全空：引用令牌但池无任何键
  r = await makeEnv({
    idbKeys: [CHAT_IDB],
    idbData: { [CHAT_IDB]: '@@m:' + H1 + '@@m:' + H2 }
  });
  eq('池全空：引用 2 池内 0 缺 2', { ok: r.ok, referenced: r.referenced, inPool: r.inPool, missing: r.missing }, { ok: true, referenced: 2, inPool: 0, missing: 2 });

  // 4 接口不可用：无 idb 接口 → ok=false
  r = await makeEnv({ noInterfaces: true, idbData: { [CHAT_IDB]: '@@m:' + H1 } });
  eq('接口不可用：ok=false 带原因', { ok: r.ok, bad: r.reason.indexOf('接口不可用') >= 0 }, { ok: false, bad: true });

  // 5 键清单读取失败
  r = await makeEnv({ listKeysThrows: true, idbData: {} });
  eq('键清单读取失败：ok=false 带原因', { ok: r.ok, bad: r.reason === '键清单读取失败' }, { ok: false, bad: true });

  // 6 键清单非法（非数组）
  r = await makeEnv({ keysResult: 'not-an-array' });
  eq('键清单非法：ok=false', { ok: r.ok, bad: r.reason === '键清单非法' }, { ok: false, bad: true });

  // 7 仅 localStorage 有聊天引用面（#186 LS 快照/尾巴）→ 照常统计
  r = await makeEnv({
    idbKeys: ['xy-home-v2:media:' + H1],
    idbData: { ['xy-home-v2:media:' + H1]: DATA },
    lsData: { [CHAT_LS]: '@@m:' + H1 }
  });
  eq('LS 引用面：localStorage 里的聊天键令牌照常计入', { ok: r.ok, referenced: r.referenced, inPool: r.inPool, missing: r.missing }, { ok: true, referenced: 1, inPool: 1, missing: 0 });

  // 8 引用面口径（#506 起）：聊天/收藏/群聊/尾巴 + 字卡库 cc-groups(-public) 都算引用——
  //   库内令牌指向的池条目若不进 keep，会被存储清理误删＝字卡库图片（含导出还原源）永久丢失；
  //   其余键（settings 等业务键）里的令牌仍不计入
  r = await makeEnv({
    idbKeys: ['xy-home-v2:media:' + H1, 'xy-home-v2:media:' + H2, CHAT_IDB, 'xy-home-v2:cc-groups-public', 'xy-home-v2:settings'],
    idbData: { [CHAT_IDB]: '@@m:' + H1, 'xy-home-v2:cc-groups-public': '@@m:' + H2, 'xy-home-v2:settings': '{"a":"@@m:' + H3 + '"}', ['xy-home-v2:media:' + H1]: DATA, ['xy-home-v2:media:' + H2]: DATA }
  });
  eq('引用面：字卡库令牌计入（#506）、settings 等其余键不计入', { referenced: r.referenced, inPool: r.inPool, missing: r.missing }, { referenced: 2, inPool: 2, missing: 0 });

  // 9 池值非法（空串/非 data:）→ 计缺失
  r = await makeEnv({
    idbKeys: ['xy-home-v2:media:' + H1, 'xy-home-v2:media:' + H2, CHAT_IDB],
    idbData: { [CHAT_IDB]: '@@m:' + H1 + '@@m:' + H2, ['xy-home-v2:media:' + H1]: '', ['xy-home-v2:media:' + H2]: 'http://example.invalid/x.png' }
  });
  eq('池值非法：空串与 http 直链都计缺失', { inPool: r.inPool, missing: r.missing }, { inPool: 0, missing: 2 });

  // 10 令牌去重：同一哈希被多次引用只计 1 次
  r = await makeEnv({
    idbKeys: ['xy-home-v2:media:' + H1, CHAT_IDB],
    idbData: { [CHAT_IDB]: '@@m:' + H1 + '@@m:' + H1 + '@@m:' + H1, ['xy-home-v2:media:' + H1]: DATA }
  });
  eq('令牌去重：重复引用只计 1', { referenced: r.referenced, missing: r.missing }, { referenced: 1, missing: 0 });

  // 11 群聊/尾巴/收藏键名全部匹配（含 per-cid 前缀与 gc-msgs-xxx）
  r = await makeEnv({
    idbKeys: [
      'xy-home-v2:group-chat-msgs', 'xy-home-v2:abc:gc-msgs-g1', 'xy-home-v2:chat-tail',
      'xy-home-v2:abc:fav-msgs', 'xy-home-v2:abc:chat-msgs'
    ],
    idbData: {
      'xy-home-v2:group-chat-msgs': '@@m:' + H1,
      'xy-home-v2:abc:gc-msgs-g1': '@@m:' + H2,
      'xy-home-v2:chat-tail': '@@m:' + H3,
      'xy-home-v2:abc:fav-msgs': '@@m:' + H1,
      'xy-home-v2:abc:chat-msgs': '@@m:' + H1
    }
  });
  eq('引用键名覆盖：群聊/gc-msgs/尾巴/收藏/per-cid 聊天全命中，跨键去重', { referenced: r.referenced }, { referenced: 3 });

  // 12 idbGetMany 抛错时按缺处理不炸（try 兜底）
  const win = {};
  win.idbListKeys = async () => [CHAT_IDB];
  win.idbGet = async () => '@@m:' + H1;
  win.idbGetMany = async () => { throw new Error('getMany 挂了'); };
  r = await coverageFor(win, { length: 0, key: () => undefined, getItem: () => null })();
  eq('idbGetMany 抛错：整体仍 ok 且按全缺统计', { ok: r.ok, referenced: r.referenced, missing: r.missing }, { ok: true, referenced: 1, missing: 1 });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常：', e); process.exit(1); });
