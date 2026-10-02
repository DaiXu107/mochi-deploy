// ===== 回归脚本：#166 存储优化包（媒体池孤儿 GC + 写日志标记合并 + 查看存储页接线） =====
// 用法：node tools/verify-storage-opt.mjs
// 纯 Node 行为断言（桩 IDB，不开无头浏览器——#162 收口时实测 verify 泄漏无头 Chrome
// 涨盘 32GB，本脚本刻意零浏览器依赖）：
//   T1 GC 基础：池 3 条、聊天+收藏引用 2 条 → 孤儿只报第 3 条且报体积/池数/引用数
//   T2 GCApply：只删孤儿条目，被引用的池条目原样保留
//   T3 引用键读不到（idbGet 超时形态=undefined）→ 整次放弃 ok:false，一个都不删
//   T4 结构化数组形态的 chat-msgs（persistMsgsToIdb 直存数组路径）引用同样被认账
//   T5 键清单读失败（idbListKeys→null）→ 放弃不删
//   T6 静态锚点：idb.js 标记合并+离页冲刷 / media-pool 放弃规则 / personalize 面板接线 / template 卡片 / build.mjs 哨兵
// 需要：Node 21+（globalThis.crypto.subtle）
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex32 = (c) => c.repeat(32);

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' —— ' + extra : '')); }
}

// —— 桩 IndexedDB（Map 后端，微延迟模拟异步） ——
function makeIdb() {
  const m = new Map();
  return {
    map: m,
    idbGet: async (k) => { await sleep(1); return m.has(k) ? m.get(k) : undefined; },
    idbGetMany: async (ks) => { await sleep(1); const o = {}; ks.forEach((k) => { if (m.has(k)) o[k] = m.get(k); }); return o; },
    idbSetAll: async (pairs) => { await sleep(1); pairs.forEach((p) => m.set(p.k, p.v)); return true; },
    idbDelete: async (k) => { await sleep(1); return m.delete(k); },
  };
}

// —— 把 media-pool.js 装进桩环境 ——
function loadPool(idb, listKeysImpl, getImpl) {
  const sandbox = {
    console,
    crypto: globalThis.crypto,
    TextEncoder,
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class { observe() {} },
    document: {
      addEventListener() {},
      readyState: 'complete',
      documentElement: {},
      querySelectorAll: () => [],
    },
    idbListKeys: listKeysImpl || (async () => Array.from(idb.map.keys())),
    idbGet: getImpl || idb.idbGet,
    idbGetMany: idb.idbGetMany,
    idbSetAll: idb.idbSetAll,
    idbDelete: idb.idbDelete,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/js/media-pool.js'), sandbox, { filename: 'media-pool.js' });
  return sandbox;
}

const FULL = 'xy-home-v2:media:';
const img = (n) => 'data:image/gif;base64,' + 'A'.repeat(n);
const K = (c) => FULL + hex32(c);

console.log('T1 GC 基础：池 3 条 / 聊天+收藏引用 2 条');
{
  const idb = makeIdb();
  idb.map.set(K('a'), img(1000));
  idb.map.set(K('b'), img(2000));
  idb.map.set(K('c'), img(3000)); // 孤儿
  idb.map.set('xy-home-v2:default:chat-msgs', JSON.stringify([{ t: 1, text: '@@m:' + hex32('a') }]));
  idb.map.set('xy-home-v2:cmtest2:fav-msgs', JSON.stringify([{ text: '@@m:' + hex32('b') }]));
  const w = loadPool(idb);
  const rep = await w.mochiMediaGC();
  ok(rep.ok === true, 'GC 完成 ok=true', JSON.stringify(rep));
  ok(rep.poolN === 3 && rep.refN === 2, '池数/引用数统计正确', 'poolN=' + rep.poolN + ' refN=' + rep.refN);
  ok(rep.orphans.length === 1 && rep.orphans[0] === K('c'), '孤儿只报 c（a/b 被聊天与收藏引用）', JSON.stringify(rep.orphans));
  ok(rep.bytes === img(3000).length * 2, '孤儿体积按字符×2 估算', 'bytes=' + rep.bytes);
  await sleep(50); // flush 定时器兜底走完
}

console.log('T2 GCApply：只删孤儿，被引用条目保留');
{
  const idb = makeIdb();
  idb.map.set(K('a'), img(1000));
  idb.map.set(K('c'), img(3000));
  idb.map.set('xy-home-v2:default:chat-msgs', JSON.stringify([{ text: '@@m:' + hex32('a') }]));
  const w = loadPool(idb);
  const rep = await w.mochiMediaGC();
  const n = await w.mochiMediaGCApply(rep.orphans);
  ok(n === 1, '删除条数=1', 'n=' + n);
  ok(idb.map.has(K('a')) && !idb.map.has(K('c')), '引用中的 a 保留、孤儿 c 已删');
  ok(idb.map.has('xy-home-v2:default:chat-msgs'), '聊天记录本身未被触碰');
}

console.log('T3 引用键读不到 → 整次放弃不删（宁可漏删不误删）');
{
  const idb = makeIdb();
  idb.map.set(K('a'), img(1000));
  idb.map.set(K('c'), img(3000));
  idb.map.set('xy-home-v2:default:chat-msgs', JSON.stringify([{ text: '@@m:' + hex32('a') }]));
  idb.map.set('xy-home-v2:cmtest2:fav-msgs', JSON.stringify([{ text: '@@m:' + hex32('a') }]));
  // 模拟 idbGet 超时形态：fav-msgs 返回 undefined
  const w = loadPool(idb, null, async (k) => {
    if (k === 'xy-home-v2:cmtest2:fav-msgs') return undefined;
    return idb.idbGet(k);
  });
  const rep = await w.mochiMediaGC();
  ok(rep.ok === false && /没读到/.test(rep.reason), 'GC 放弃且说明原因', JSON.stringify(rep));
  ok(idb.map.has(K('a')) && idb.map.has(K('c')), '一个池条目都没删');
}

console.log('T4 结构化数组形态的 chat-msgs 引用被认账');
{
  const idb = makeIdb();
  idb.map.set(K('a'), img(1000));
  idb.map.set(K('c'), img(3000));
  idb.map.set('xy-home-v2:default:chat-msgs', [{ text: '@@m:' + hex32('a') }]); // 直存数组（非 JSON 串）
  const w = loadPool(idb);
  const rep = await w.mochiMediaGC();
  ok(rep.ok === true && rep.orphans.length === 1 && rep.orphans[0] === K('c'), '数组形态引用生效，孤儿仍只报 c', JSON.stringify(rep.orphans));
}

console.log('T5 键清单读失败 → 放弃不删');
{
  const idb = makeIdb();
  idb.map.set(K('a'), img(1000));
  idb.map.set(K('c'), img(3000));
  const w = loadPool(idb, async () => null);
  const rep = await w.mochiMediaGC();
  ok(rep.ok === false && /清单/.test(rep.reason), 'GC 放弃且说明清单失败', JSON.stringify(rep));
  ok(idb.map.has(K('a')) && idb.map.has(K('c')), '一个池条目都没删');
}

console.log('T6 静态锚点：标记合并 / 面板接线 / 哨兵登记');
{
  const idbSrc = read('src/js/idb.js');
  ok(idbSrc.includes('setTimeout(wrjMarkFlush, WRJ_MARK_FLUSH_MS)'), 'idb.js：标记 150ms 批量冲刷');
  ok(idbSrc.includes("addEventListener('pagehide', wrjMarkFlush)") && idbSrc.includes("document.visibilityState === 'hidden') wrjMarkFlush()"), 'idb.js：离页即时冲刷');
  ok(idbSrc.includes('idbSetAll(pairs)') && idbSrc.includes('_wrjMarkBuf.delete(WRJ_MARK + key)'), 'idb.js：批量落库 + 未落库标记撤销');
  const mpSrc = read('src/js/media-pool.js');
  ok(mpSrc.includes('有聊天记录/收藏没读到') && mpSrc.includes('mochiMediaGCApply'), 'media-pool.js：放弃规则与 GCApply 在位');
  const pzSrc = read('src/js/personalize.js');
  ok(pzSrc.includes("getElementById('st-media-gc')") && pzSrc.includes('mochiMediaGCApply'), 'personalize.js：孤儿清理按钮接线');
  ok(pzSrc.includes('媒体池（图片去重）') && pzSrc.includes('navigator.storage.persisted'), 'personalize.js：媒体池分类 + 持久存储状态');
  const tpl = read('src/template.html');
  ok(tpl.includes('id="st-media-gc"') && tpl.includes('id="st-persist-btn"'), 'template.html：媒体池/持久存储卡片');
  ok(tpl.includes('id="st-cc-scan"') && tpl.includes('id="st-cc-list"'), 'template.html：字卡库瘦身卡片');
  const bm = read('build.mjs');
  ok(bm.includes("'/(?:^|:)(?:chat-msgs|fav-msgs)$/'") && bm.includes('setTimeout(wrjMarkFlush, WRJ_MARK_FLUSH_MS)') && bm.includes("getElementById('st-media-gc')"), 'build.mjs：#166 哨兵 3 条登记');
  ok(bm.includes("'storage-slim.js'"), 'build.mjs：storage-slim.js 已接入 jsFiles');
  ok(bm.includes('if (g[cat].length === before) return false;') && bm.includes("getElementById('st-cc-scan')"), 'build.mjs：#170 哨兵 2 条登记');
}

console.log('T7 字卡库瘦身：分组扫描 / 整组删除 / 删除前重读防覆盖');
{
  const idb = makeIdb();
  const bigImg = 'data:image/gif;base64,' + 'B'.repeat(5000);
  idb.map.set('xy-home-v2:cc-groups-public', JSON.stringify({
    text: [['小组', [{ text: 'hi' }]], ['大贴纸组', [{ text: 'x', img: bigImg }, { text: 'y' }]]],
    sticker: [['表情A', [{ img: 'data:image/png;base64,' + 'C'.repeat(800) }]]],
  }));
  idb.map.set('xy-home-v2:cmc1:cc-groups', JSON.stringify({ text: [['专属组', [{ text: 'z' }]]] }));
  const writes = [];
  const storeStub = (prefix) => ({
    set(k, v) { writes.push(prefix + k); idb.map.set(prefix + k, v); },
    get(k) { const v = idb.map.get(prefix + k); return v === undefined ? null : v; },
  });
  const sandbox = { console, setTimeout, clearTimeout, idbListKeys: async () => Array.from(idb.map.keys()), idbGet: idb.idbGet, xyStore: storeStub, getContacts: () => [{ id: 'cmc1', name: '测试桌面' }] };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/js/storage-slim.js'), sandbox, { filename: 'storage-slim.js' });
  const rep = await sandbox.mochiCcSlimScan();
  ok(rep.ok === true && rep.libs.length === 2, '扫到公用+专属两个库（无键的旧版顶层条目自动跳过）', JSON.stringify(rep.libs));
  ok(rep.groups.length === 4, '四个分组都列出', 'groups=' + rep.groups.length);
  ok(rep.groups[0].name === '大贴纸组' && rep.groups[0].cat === 'text', '体积降序：大贴纸组排第一', JSON.stringify(rep.groups[0]));
  ok(rep.groups[0].cards === 2 && rep.groups[0].bytes >= bigImg.length * 2, '卡数与字节（×2）统计正确');
  // 删除前有人改库（同库新增组）——删除必须落在最新值上，不能拿扫描快照盲写
  const cur = JSON.parse(idb.map.get('xy-home-v2:cc-groups-public'));
  cur.text.push(['新增组', [{ text: 'new' }]]);
  idb.map.set('xy-home-v2:cc-groups-public', JSON.stringify(cur));
  const done = await sandbox.mochiCcSlimDeleteGroup('xy-home-v2:', 'cc-groups-public', 'text', '小组');
  ok(done === true, '删除返回 true');
  const names = JSON.parse(idb.map.get('xy-home-v2:cc-groups-public')).text.map((t) => t[0]);
  ok(!names.includes('小组') && names.includes('大贴纸组') && names.includes('新增组'), '在当前值上删组：目标没了，其他组与扫描后新增的组都在', JSON.stringify(names));
  ok(writes.indexOf('xy-home-v2:cc-groups-public') >= 0, '写回走 xyStore（内存缓存+LS+IDB 三路同拍）');
  const gone = await sandbox.mochiCcSlimDeleteGroup('xy-home-v2:', 'cc-groups-public', 'text', '不存在的组');
  ok(gone === false, '组名匹配不到 → false 且不动库');
}

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
