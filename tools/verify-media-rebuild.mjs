// #423 媒体池一键重建（图片自愈）——纯 Node 抽源码真函数行为断言（防回归，零浏览器依赖）
// 抽取 media-pool.js 的 window.mochiMediaRebuild，stub idb*/localStorage/document/crypto，
// 覆盖：池空补回 / 空串池条目修复（#275 文字备份传播链）/ 有效池值绝不覆盖 / 聊天数组浅层扫描 /
//       music-file 跳过 / LS 与 IDB 同图去重 / 接口缺失 / 键清单失败 / 写失败如实计数 /
//       整批失败退回逐键 / 短载荷不进池 / 补回后清负缓存入渲染热缓存。
// 用法：node tools/verify-media-rebuild.mjs
import { readFileSync } from 'node:fs';

const SRC = new URL('../src/js/media-pool.js', import.meta.url);
const src = readFileSync(SRC, 'utf8');
const startMark = 'window.mochiMediaRebuild = function () {';
const si = src.indexOf(startMark);
if (si < 0) { console.error('FATAL: 找不到 mochiMediaRebuild 定义'); process.exit(1); }
let depth = 0, ei = -1;
for (let i = src.indexOf('{', si); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { ei = i + 1; break; } }
}
if (ei < 0) { console.error('FATAL: mochiMediaRebuild 花括号未闭合'); process.exit(1); }
const fnSrc = src.slice(si, ei);

const FULL = 'xy-home-v2:media:';
const TOK = '@@m:';
const TOKEN_RE = /^@@m:([0-9a-f]{32})$/;
// 与模块内 sha256Hex 同实现（Node 22 自带 webcrypto）
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  const arr = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, '0');
  return out.slice(0, 32);
}
const makeRebuild = new Function('window', 'localStorage', 'document', 'map', 'missing', 'sha256Hex', 'FULL', 'TOK', 'TOKEN_RE',
  fnSrc + '\nreturn window.mochiMediaRebuild;');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('ok   ' + name); }
  else { fail++; console.error('FAIL ' + name + '\n  got:  ' + g + '\n  want: ' + w); }
};

// ---- stub 环境 ----
function makeEnv(o) {
  const idbData = o.idbData || {};
  const win = {};
  if (!o.noInterfaces) {
    win.idbListKeys = o.listThrows
      ? async () => { throw new Error('idb 挂了'); }
      : async () => ('keysResult' in o ? o.keysResult : Object.keys(idbData));
    win.idbGet = async (k) => idbData[k];
    win.idbGetMany = async (ks) => { const out = {}; for (const k of ks) if (k in idbData) out[k] = idbData[k]; return out; };
    win.idbSetAll = o.setAllFalse
      ? async () => false
      : async (pairs) => { for (const p of pairs) idbData[p.k] = p.v; return true; };
    win.idbSet = o.setFalse
      ? async () => false
      : async (k, v) => { idbData[k] = v; return true; };
    win.mochiMediaFlush = async () => true;
  }
  const lsData = o.lsData || {};
  const lsKeys = Object.keys(lsData);
  const ls = { length: lsKeys.length, key: (i) => lsKeys[i], getItem: (k) => (k in lsData ? lsData[k] : null) };
  const map = new Map(), missing = new Set();
  if (o.preMissing) o.preMissing.forEach((h) => missing.add(h));
  const rebuild = makeRebuild(win, ls, { querySelectorAll: () => [] }, map, missing, sha256Hex, FULL, TOK, TOKEN_RE);
  return rebuild().then((r) => ({ r, idbData, map, missing }));
}

const IMG_A = 'data:image/png;base64,' + 'A'.repeat(2048);
const IMG_B = 'data:image/jpeg;base64,' + 'B'.repeat(2048);
const IMG_C = 'data:image/webp;base64,' + 'C'.repeat(2048);
const HA = await sha256Hex(IMG_A);
const HB = await sha256Hex(IMG_B);
const HC = await sha256Hex(IMG_C);
const CHAT = 'xy-home-v2:cmt37eved7if:chat-msgs';
const CC = 'xy-home-v2:cmt37eved7if:cc-groups';

(async () => {
  // 1 池空 + LS 字卡库存留原图 + 聊天引用同图令牌 → 按哈希补回，负缓存清空、入渲染热缓存
  let e = await makeEnv({
    idbData: { [CHAT]: '@@m:' + HA },
    lsData: { [CC]: '{"g":[{"body":"' + IMG_A + '"}]}' },
    preMissing: [HA]
  });
  eq('池空补回：written=1 池值落位', { ok: e.r.ok, written: e.r.written, foundN: e.r.foundN, pool: e.idbData[FULL + HA] === IMG_A }, { ok: true, written: 1, foundN: 1, pool: true });
  eq('池空补回：负缓存清空+热缓存入图', { missing: e.missing.size, cached: e.map.get(HA) === IMG_A }, { missing: 0, cached: true });

  // 2 #275 空串池条目（旧文字备份剥值留键）→ 覆盖补回
  e = await makeEnv({
    idbData: { [FULL + HA]: '', [CHAT]: '@@m:' + HA, ['xy-home-v2:cmt:fav-msgs']: IMG_A }
  });
  eq('空串池条目：poolN=1 brokenN=1 补回 1', { ok: e.r.ok, poolN: e.r.poolN, validN: e.r.validN, brokenN: e.r.brokenN, written: e.r.written, fixed: e.idbData[FULL + HA] === IMG_A }, { ok: true, poolN: 1, validN: 0, brokenN: 1, written: 1, fixed: true });

  // 3 有效池值绝不覆盖：来源图与池内有效条目同图 → alreadyOk，不重写
  e = await makeEnv({
    idbData: { [FULL + HA]: IMG_A, [CHAT]: '@@m:' + HA },
    lsData: { [CC]: IMG_A }
  });
  eq('有效池值不覆盖：alreadyOk=1 written=0', { ok: e.r.ok, alreadyOk: e.r.alreadyOk, written: e.r.written, intact: e.idbData[FULL + HA] === IMG_A }, { ok: true, alreadyOk: 1, written: 0, intact: true });

  // 4 聊天记录 IDB 直存数组 → 浅层字段扫（parts[].v / img / text）也能找到
  e = await makeEnv({
    idbData: { [CHAT]: [{ side: 'me', text: '看图', img: '@@m:' + HB, parts: [{ v: IMG_B }] }] }
  });
  eq('聊天数组浅扫：parts/img 里的原图找到并补回', { ok: e.r.ok, foundN: e.r.foundN, written: e.r.written, pool: e.idbData[FULL + HB] === IMG_B }, { ok: true, foundN: 1, written: 1, pool: true });

  // 5 music-file / __wr-j 键跳过（音频体不读不扫）
  e = await makeEnv({
    idbData: {
      'xy-home-v2:music-file:sm_1': 'data:audio/mp3;base64,' + 'C'.repeat(2048),
      'xy-home-v2:__wr-j:xy-home-v2:foo': IMG_C,
      [CHAT]: '@@m:' + HC
    }
  });
  eq('music-file/wr-j 跳过：音频与标记不进扫描面', { ok: e.r.ok, foundN: e.r.foundN, written: e.r.written }, { ok: true, foundN: 0, written: 0 });

  // 6 LS 与 IDB 同图去重：只算一张、只写一次
  e = await makeEnv({
    idbData: { ['xy-home-v2:cmt:fav-msgs']: IMG_A },
    lsData: { [CC]: IMG_A, ['xy-home-v2:other']: IMG_A }
  });
  eq('同图去重：foundN=1 written=1', { foundN: e.r.foundN, written: e.r.written }, { foundN: 1, written: 1 });

  // 7 接口缺失 → ok=false
  e = await makeEnv({ noInterfaces: true, idbData: { [CHAT]: '@@m:' + HA } });
  eq('接口缺失：ok=false 带原因', { ok: e.r.ok, bad: e.r.reason.indexOf('接口不可用') >= 0 }, { ok: false, bad: true });

  // 8 键清单读取失败 → ok=false
  e = await makeEnv({ listThrows: true, idbData: {} });
  eq('键清单失败：ok=false 带原因', { ok: e.r.ok, bad: e.r.reason === '键清单读取失败' }, { ok: false, bad: true });

  // 9 写全失败 → writeFail 如实计数、ok 仍 true、池值不动
  e = await makeEnv({
    setAllFalse: true, setFalse: true,
    idbData: { [FULL + HA]: '', [CHAT]: '@@m:' + HA },
    lsData: { [CC]: IMG_A }
  });
  eq('写全失败：writeFail=1 池值未被破坏', { ok: e.r.ok, writeFail: e.r.writeFail, written: e.r.written, intact: e.idbData[FULL + HA] === '' }, { ok: true, writeFail: 1, written: 0, intact: true });

  // 10 整批失败退回逐键：idbSetAll false + idbSet true → 照常补回
  e = await makeEnv({
    setAllFalse: true,
    idbData: { [CHAT]: '@@m:' + HA },
    lsData: { [CC]: IMG_A }
  });
  eq('整批失败退回逐键：written=1 补回成功', { ok: e.r.ok, written: e.r.written, writeFail: e.r.writeFail, pool: e.idbData[FULL + HA] === IMG_A }, { ok: true, written: 1, writeFail: 0, pool: true });

  // 11 短载荷（<1024 base64）不进池——与 tokenize 入口同门槛
  e = await makeEnv({
    idbData: { [CHAT]: '@@m:' + HA },
    lsData: { ['xy-home-v2:tiny']: 'data:image/png;base64,' + 'D'.repeat(600) }
  });
  eq('短载荷不进池：foundN=0', { foundN: e.r.foundN, written: e.r.written }, { foundN: 0, written: 0 });

  // 12 批量混扫：多来源多图各归各位，有效池值跳过（IMG_A 也在来源里但池内已有效 → 跳过不重写）
  e = await makeEnv({
    idbData: {
      [FULL + HA]: IMG_A, // 有效 → 跳过
      [FULL + HB]: '',    // 空串 → 补
      [CHAT]: '@@m:' + HA + '@@m:' + HB + '@@m:' + HC
    },
    lsData: { [CC]: '{"a":"' + IMG_A + '","b":"' + IMG_B + '","x":"' + IMG_C + '"}' }
  });
  eq('混合场景：补 2 跳 1，三池齐', { ok: e.r.ok, written: e.r.written, alreadyOk: e.r.alreadyOk, a: e.idbData[FULL + HA] === IMG_A, b: e.idbData[FULL + HB] === IMG_B, c: e.idbData[FULL + HC] === IMG_C }, { ok: true, written: 2, alreadyOk: 1, a: true, b: true, c: true });

  // ===== #424 mochiMediaAutoShouldRun（自动体检节流纯函数）=====
  const ssi = src.indexOf('window.mochiMediaAutoShouldRun = function');
  if (ssi < 0) { console.error('FATAL: 找不到 mochiMediaAutoShouldRun 定义'); process.exit(1); }
  let d2 = 0, sei = -1;
  for (let i = src.indexOf('{', ssi); i < src.length; i++) {
    if (src[i] === '{') d2++;
    else if (src[i] === '}') { d2--; if (d2 === 0) { sei = i + 1; break; } }
  }
  if (sei < 0) { console.error('FATAL: mochiMediaAutoShouldRun 花括号未闭合'); process.exit(1); }
  const shouldRun = new Function('return (' + src.slice(src.indexOf('function', ssi), sei) + ');')();
  const DAY = 86400000, H72 = 72 * 3600000;
  const now = 1_800_000_000_000;
  eq('#424 无状态（首次）→ 跑', shouldRun(null, now), true);
  eq('#424 无记录对象 → 跑', shouldRun(undefined, now), true);
  eq('#424 检查于 23h 前 → 不跑（24h 节流）', shouldRun({ t: now - 23 * 3600000, missing: 0 }, now), false);
  eq('#424 检查于 25h 前 → 跑', shouldRun({ t: now - 25 * 3600000, missing: 3 }, now), true);
  eq('#424 snooze 未到期（哪怕超 24h）→ 不跑', shouldRun({ t: now - 3 * DAY, snooze: now + 1000, missing: 2 }, now), false);
  eq('#424 snooze 已过期 → 跑（72h 免打扰结束）', shouldRun({ t: now - 3 * DAY, snooze: now - 1000, missing: 2 }, now), true);
  eq('#424 snooze 为 0/缺失 → 只看 24h 节流', shouldRun({ t: now - 2 * DAY, snooze: 0 }, now), true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常：', e); process.exit(1); });
