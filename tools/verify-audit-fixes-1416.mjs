// ===== 回归脚本 #1416：当日体检查出的四条缺陷（逐条真跑量，不靠 grep 存在感）=====
// 用法：node tools/verify-audit-fixes-1416.mjs [--root <目录>]
//
// 四条（作者逐条点名「都要做」）：
//  H1 抓包记录删除的身份：那张表是 unshift 头插，原来按渲染时的数组下标 splice ⇒ 确认框停留期间
//     来一条新抓包就删错行（＝丢用户数据）。现在按内容指纹（ts+type）在写回那一刻再认一次，
//     认不到就什么都不删并如实说。参照同批 memo-arc.js 的 delHist 口径。
//  H2 通话设置按「归属桌面」读：default 桌面必须走 defaultStore()（先新命名空间、再回退旧顶层键），
//     而 storeFor('default') 没有那层回退 ⇒ 未迁移的老「禁止对方挂断」被判成没设过、回落 2%。
//  H3 缺 ts 的老记录不许印成 1970 年：feed／mail 两处分桶现在都问「带没带 ts」，没带的归「更早」。
//  H4 折叠开合态活过一次整栏重画：mochiHistFold 把状态收进模块级 map（同 mail.js），toggle 用捕获
//     阶段委托一次；9 个调用方各自给 key 前缀（不共用一份状态）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const argv = process.argv.slice(2);
const rIdx = argv.indexOf('--root');
const root = rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : 'C:/Users/Administrator/Desktop/mochi';
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };
let pass = 0, fail = 0;
const ok = (n, c, r) => { if (c) { pass++; console.log('PASS  ' + n + (r ? '   ' + JSON.stringify(r) : '')); } else { fail++; console.log('FAIL  ' + n + (r ? '   ' + JSON.stringify(r) : '')); } };

function sliceBalanced(text, fromIdx) { // 从 fromIdx 起括号配平到收尾（含结尾的 ;）
  const open = text.indexOf('{', fromIdx);
  if (open < 0) return null;
  let depth = 0, q = null, esc = false, inC = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inC === 'line') { if (c === '\n') inC = null; continue; }
    if (inC === 'block') { if (c === '*' && text[i + 1] === '/') { inC = null; i++; } continue; }
    if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) q = null; continue; }
    if (c === '/' && text[i + 1] === '/') { inC = 'line'; continue; }
    if (c === '/' && text[i + 1] === '*') { inC = 'block'; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { let j = i + 1; while (j < text.length && /[^\n;]/.test(text[j]) && text[j] !== '\n') j++; return text.slice(fromIdx, Math.min(j + 1, text.length)); } }
  }
  return null;
}
// 取 window.X = function …… 这种匿名赋值（站内不少暴露是这一型，fnBody 抓不到）
function assignBody(text, lhs) { const at = text.indexOf(lhs + ' = function'); return at < 0 ? null : sliceBalanced(text, at); }
// 具名函数：同样交给上面的括号配平器（站内函数体里有注释/字符串里的花括号，正则数不来）
function fnBody(text, name) {
  const at = text.indexOf('function ' + name);
  if (at < 0) return null;
  return sliceBalanced(text, at);
}

const REC = rd('src/js/records.js') || '', CALL = rd('src/js/call.js') || '', CON = rd('src/js/contacts.js') || '',
  RS = rd('src/js/reply-settings.js') || '', FEED = rd('src/js/feed.js') || '', MAIL = rd('src/js/mail.js') || '',
  IDB = rd('src/js/idb.js') || '';
const files = { REC, CON, RS, FEED, MAIL, IDB };
for (const [k, v] of Object.entries(files)) if (!v) { console.log('FAIL  读不到 ' + k + '（--root 给对了吗）'); process.exit(1); }

/* ---------- H1 抓包记录：内容指纹 ---------- */
const hk = fnBody(REC, 'histKey');
let h1run = {};
try {
  h1run = runInNewContext(hk + `
    var arr = [];
    arr.unshift({ type: 'ta', ts: 100, text: 'A' });          // 用户看到的那条
    var keyForThatRow = histKey({ type: 'ta', ts: 100, text: 'A' });
    arr.unshift({ type: 'me', ts: 200, text: 'B' });          // 确认框停留期间 TA 反向抓包落一条（头插）
    var p = String(keyForThatRow).split('|');
    var ts = Number(p[1]) || 0, ty = p[2] || '';
    var i = arr.findIndex(function (x) { return x && (Number(x.ts) || 0) === ts && String(x.type || '') === ty; });
    var byIndex = 0;                                          // 老写法：渲染时记下标 0
    OUT = { found: i, deleted: i >= 0 ? arr[i] : null, oldWayWouldDelete: arr[byIndex] };`, { __proto__: null });
} catch (e) { h1run = { err: String(e.message).slice(0, 90) }; }
ok('H1a histKey 能抽出来跑（指纹＝k|ts|type）', typeof h1run.found === 'number' && h1run.found === 1 && h1run.deleted && h1run.deleted.ts === 100 && h1run.deleted.type === 'ta', { 找到下标: h1run.found, 删掉: h1run.deleted && h1run.deleted.text, 报错: h1run.err });
ok('H1b 反向对照：老的下标写法这一枪会删错行（删到刚插入那条）', h1run.oldWayWouldDelete && h1run.oldWayWouldDelete.text === 'B', { 老写法删到: h1run.oldWayWouldDelete && h1run.oldWayWhere });
ok('H1c 渲染侧不再出现按 ' + String.fromCharCode(39) + 'i' + String.fromCharCode(39) + '+下标 的删除身份', REC.indexOf("'i' + n") < 0 && /window\.mochiHistDel\(histKey\(x\)/.test(REC), {});
ok('H1d 认不到就什么都不删并如实说（宁可删不掉，不可删错）', /if \(i < 0\)/.test(REC) && REC.indexOf('没有删掉任何内容') >= 0, {});

/* ---------- H2 default 桌面的旧顶层键回退 ---------- */
const ds = fnBody(CON, 'defaultStore');
const sfc = assignBody(CON, 'window.storeForCid');
let h2 = {};
try {
  h2 = runInNewContext(`
    var G = 'xy-home-v2';
    var NS = {};            // 命名空间存储：'xy-home-v2:default' / 'xy-home-v2:cid1'
    var BARE = {};          // 旧顶层键（迁移前的历史包袱）
    window = { xyStore: function (ns) {
      var bag = ns === G ? BARE : (NS[ns] || (NS[ns] = {}));
      return { get: function (k) { return (k in bag) ? bag[k] : null; }, set: function (k, v) { bag[k] = String(v); }, remove: function (k) { delete bag[k]; } };
    } };
    ${ds}
    ${sfc}
    // 场景一：老用户只写过旧顶层键（迁移后从未再动过）
    BARE['reply-call-hangup'] = '0';
    var dflt = window.storeForCid('default').get('reply-call-hangup');
    var viaOldStoreFor = window.xyStore(G + ':default').get('reply-call-hangup');   // 升级前的读法
    // 场景二：别的联系人桌面必须仍然隔离（不许因为加了回退就串桌面）
    NS['xy-home-v2:cid1'] = { 'reply-call-hangup': '9' };
    var other = window.storeForCid('cid1').get('reply-call-hangup');
    var otherSeesDefaultLegacy = window.storeForCid('cid1').get('reply-call-hangup') === '0';
    OUT = { dflt: dflt, viaOldStoreFor: viaOldStoreFor, other: other, leak: otherSeesDefaultLegacy };`, { __proto__: null });
} catch (e) { h2 = { err: String(e.message).slice(0, 120) }; }
ok('H2a storeForCid(default) 够得着旧顶层键（未迁移的老「禁止挂断」不再被判成没设过）', h2.dflt === '0', { 新读法: h2.dflt, 老读法: h2.viaOldStoreFor, 报错: h2.err });
ok('H2b 反向对照：旧的 storeFor(default) 确实读不到＝这就是 #1394 剩下那一半', h2.viaOldStoreFor === null, { 老读法拿到: h2.viaOldStoreFor });
ok('H2c 别的联系人桌面仍隔离（没把回退扩散成串桌面）', h2.other === '9' && h2.leak === false, { cid1: h2.other });
ok('H2d replyCfgFor 已改用 storeForCid（通话那条路接得上）', RS.indexOf('window.storeForCid(cid)') >= 0, {});

/* ---------- H3 缺 ts 归「更早」 ---------- */
const mlbl = fnBody(MAIL, 'monthLabelOf');
let h3mail = {};
try { h3mail = runInNewContext(mlbl + `
  OUT = { none: monthLabelOf('none'), normal: monthLabelOf('2026-08') };`); } catch (e) { h3mail = { err: String(e.message).slice(0, 80) }; }
ok('H3a mail：没有 tm 的那一封组标题写「更早」而不是 1970 年', h3mail.none === '更早' && /年.+月/.test(String(h3mail.normal)), h3mail);
ok('H3b mail：分桶只在真有 tm 时才换算月份，且「更早」永远排最后', /const k = tm \? monthKeyOf\(tm\) : 'none';/.test(MAIL) && /a === 'none' \? 1 : b === 'none' \? -1/.test(MAIL), {});
const fbk = fnBody(FEED, 'feedBucketKeyFor'), fms = fnBody(FEED, 'feedMonthKeyOf'), fws = fnBody(FEED, 'feedWeekStart');
let h3feed = {};
try { h3feed = runInNewContext(`var FEED_WEEK_LABEL='本周';` + fws + fms + fbk + `
  OUT = { none: feedBucketKeyFor(0), noneUndef: feedBucketKeyFor(undefined), thisWeek: feedBucketKeyFor(Date.now()), old: feedBucketKeyFor(Date.now() - 400 * 864e5) };`); } catch (e) { h3feed = { err: String(e.message).slice(0, 80) }; }
ok('H3c feed：缺 ts 的动态不再落进 1970-01 那一页（返回 none）', h3feed.none === 'none' && h3feed.noneUndef === 'none', { 读数: h3feed });
ok('H3d feed：有 ts 的照常分页（本周／按年月），标签里不再可能出现 1970', /b\.unknown \? '更早'/.test(FEED) && typeof h3feed.thisWeek === 'string' && h3feed.thisWeek === 'week' && /^\d{4}-\d{1,2}$/.test(String(h3feed.old)), { 本周: h3feed.thisWeek, 旧的: h3feed.old });

/* ---------- H4 折叠态活过重画 ---------- */
const sliceStart = IDB.indexOf('const HIST_FOLD_OPEN');
const sliceEnd = IDB.indexOf('window.mochiHistFold = function');
const labelFn = fnBody(IDB, 'mochiHistDayLabel');
const foldFn = assignBody(IDB, 'window.mochiHistFold');
let h4 = {};
try {
  h4 = runInNewContext(`
    var toggles = [];
    window = { __mochiHistFoldBound: 0, __mochiScreenAdj: { bottom: 0 } };
    document = { addEventListener: function (t, fn, cap) { if (t === 'toggle') { toggles.push({ cap: cap, fn: fn }); } } };
    ${IDB.slice(sliceStart, sliceEnd)}
    ${foldFn}
    ${labelFn}
    var items = [
      { ts: Date.now(), html: 'TODAY' },
      { ts: Date.now() - 400 * 864e5, html: 'OLD-A' },
      { ts: Date.now() - 800 * 864e5, html: 'OLD-B' }
    ];
    var first = window.mochiHistFold(items, { key: 'unit' });
    // 用户点开第一个月块：真实浏览器会在这个 details 上派发 toggle（不冒泡，靠捕获阶段收）
    var fk = (first.match(/data-hist-fold="([^"]+)"/) || [])[1];
    var el = { tagName: 'DETAILS', open: true, getAttribute: function (k) { return k === 'data-hist-fold' ? fk : null; } };
    toggles[0].fn({ target: el });
    var second = window.mochiHistFold(items, { key: 'unit' });        // 一次整栏重画
    var otherKey = window.mochiHistFold(items, { key: 'other-list' }); // 另一张列表不该被带上
    OUT = { firstOpen: /<details class="dc-h-more" open/.test(first), boundOnce: toggles.length, capture: toggles[0] && toggles[0].cap === true,
      secondOpen: second.indexOf('<details class="dc-h-more" open data-hist-fold="' + fk + '"') >= 0,
      otherClean: !/ open/.test(otherKey), both: (second.match(/data-hist-fold=/g) || []).length };`, { __proto__: null });
} catch (e) { h4 = { err: String(e.message).slice(0, 140) }; }
ok('H4a 首屏默认全折起（不预设 open）', h4.firstOpen === false, h4);
ok('H4b toggle 委托只挂一次且用捕获阶段（toggle 不冒泡）', h4.boundOnce === 1 && h4.capture === true, { 挂了几次: h4.boundOnce, 捕获: h4.capture });
ok('H4c 展开过的那一格，整栏重画后仍是展开的（这就是修的那件事）', h4.secondOpen === true, { 重画后块数: h4.both });
ok('H4d 另一张列表不受影响（key 前缀各自独立，没共用一份状态）', h4.otherClean === true, {});
const callSites = (rd('src/js/records.js') + rd('src/js/ta-ask.js') + rd('src/js/gift-shop.js') + rd('src/js/memo-arc.js') + rd('src/js/p2-features.js')).match(/mochiHistFold\(/g) || [];
const keyed = (rd('src/js/records.js') + rd('src/js/ta-ask.js') + rd('src/js/gift-shop.js') + rd('src/js/memo-arc.js') + rd('src/js/p2-features.js')).match(/key: (key,|'records-|'gift-|'memo-|'checkin-hist')/g) || [];
ok('H4e 全部调用方都给了 key 前缀（' + callSites.length + ' 处）', callSites.length === 9 && keyed.length >= 9, { 调用: callSites.length, 带key: keyed.length });

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过   （被测：' + root + '）');
process.exit(fail ? 1 : 0);
