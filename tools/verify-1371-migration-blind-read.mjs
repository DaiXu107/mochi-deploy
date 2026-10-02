// ===== 常驻回归脚本 #1371：一句话两把尺——「这一发没读到」不许当成「库里没有」
//        （自定义字卡／表情包消失，iPhone 14 Plus／Safari 实报；同案第二条是外置包自愈乱序）
// 用法：node tools/verify-1371-migration-blind-read.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录）
//
// 现场（用户 2026-09-28 直派「自定义字卡表情包什么的都没了，总是丢失数据」＋「手机型号是苹果14plus
// 浏览器是Safari」＋「不要覆盖修改导致不同型号设备浏览器的 bug 反复出现，这个问题其他设备型号也有出现」；
// 诊断 mochi-diag-2026-09-28-09-03-37…：iOS 18.7／Safari 26.6 标签页态、【保活现场】「本页被系统回收过
// 100 次」、【回复字卡池】sticker=0／image=0／自定义字卡=0、default:cc-groups 只剩 576B，而媒体池 256 条
// 照旧在＝引用没了、图还在＝「写坏」不是「读崩」；同场 00:06 另有四条 window.activeStore is not a function）
//
// 机制 A（真丢了）：两处「一生只跑一次」的存量迁移把整批发读不回折叠成「库里没有」——
//   chat.js 表情包全局化、chatcard.js 字卡作用域化，两边都是 reads 用 .catch(() => null)，merged 为空
//   照样 storeFor(cid).remove(源键)（数据层的 remove＝memoryCache＋localStorage＋idbDelete 三处一起删）
//   再盖 migrated 戳＝永不重跑。quote-cards.js 更是整本「同步读数→改→store.set(整包)」一道闸都没有
//   （#1361 当时写「这是最后两本」，实测漏了这本）。
// 机制 B（屏上没了）：pwa.js 自愈重注入用 s.async=true＝执行序退回到达序，把 <script defer> 那份
//   「依赖先于调用方」的保证整张丢掉；activeStore 要到 contacts.js 跑到它那一行才挂上，而调用方在
//   IIFE 第一行就调它 ⇒ 抛错那一发整段中止＝字卡库/表情包/收藏这一场全空（库里一字未动）。
//
// 夹具口径（F 组逐条自证）：被测的是**产品自己做的决定**，不是本脚本的账本。做法＝把数据层那一发的
//   答复换成可判定的对象（idbGet／idbSet／idbDelete／idbHydrateKey 四扇门），于是「这一发挂起」「这一发
//   没落地」「这一发确认库里没有」三种现场都是当场事实而不是机器运气（#1360 E 组把等待窗压成 0 同一思路）；
//   同步层（localStorage）走产品原路，本脚本只在文档脚本之前种一次。读数只问「还剩几条／有没有回话」。
//
// 断言（两侧同一把尺串行跑：落库副本应全绿；纯底本副本红的恰是 A/B/C/D/E 这些新契约）：
//   F 组 夹具诚实（两条都是被实测教出来的，别再退回弱版）：
//     · 现场必须是「本地只剩残缺尾巴／库里那本更全」两档不同条数——只造「两边都空」的话旧写法照样写空包，
//       A1/A3 两侧同绿＝尺子什么都拦不住；条数差（60 对 90、12 对 20）才能把「净丢几条」量出来。
//     · 这份现场要在**迁移动手之前**快照（INIT 里的 __snap0）；事后从库里扒读数＝红侧正因为已经把源键吃了
//       才读成 -1，断言成了自我循环（取证的是现场，不是后果）。
//     · 数据层那四扇门确实装在产品的调用路上（F1a/F1b/F1）／同步层读空是当场事实（F2）／迁移条件在场（F4）
//   A 组 表情包迁移·库里那一发挂起：A1 不许拆源／A2 不许盖永不重跑的戳／A3 不许写全局那一本／
//     A4 让路登记成证人／A5 下一场（库里答得出来）自愈＝并集落地→拆源→盖章 这个序
//   B 组 表情包迁移·写库没有提交回执：B1 不拆源／B2 不盖章／B3 有回执那一趟三步齐全（闸不是「永远存不进去」）
//   C 组 字卡作用域迁移·两条轴同形：C1 挂起那一趟不拆专属键／C2 不盖章／C3 证人在册／
//     C4 写库没回执也不拆／C5 有回执那一趟公用键=整本→拆专属→盖章
//   D 组 今日情话自定义卡·整包写回：D1 读空那一发点「批量添加」不许把 5 句顶成 1 句／
//     D2 取回落地后作用在真读到的那一本上（并集）／D3 删除那一发不把补回来的旧条目塞回／
//     D4 库里确认没有＝照写不误（新用户）／D5 读数在场时照常 +1（旧契约零变化）
//   E 组 外置包自愈：E1 首拉全灭后重跑那一趟不许出现「window.activeStore is not a function」
//     （红侧＝报障件那四条逐字复现）／E2 重注入按开机求值序／E3 动态插入的脚本 async=false
//   S 组 逻辑锚（产物静态，防「名字留着逻辑被改」）＝本批九针 ＋ Z 组零未捕获异常
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
console.log('serve root = ' + root);
if (!existsSync(join(root, 'index.html'))) { console.error('✗ 被测根目录没有 index.html（喂错目录了：所有断言会一起红）'); process.exit(2); }

const MYE_SRC = 'xy-home-v2:default:my-emoji-groups';
const MYE_PUB = 'xy-home-v2:my-emoji-groups';
const CC_SRC = 'xy-home-v2:default:cc-groups';
const CC_PUB = 'xy-home-v2:cc-groups-public';
const QC_KEY = 'xy-home-v2:default:quote-cards';
const ST_MYE = 'xy-home-v2:mye-global-migrated';
const ST_CC = 'xy-home-v2:cc-scope-migrated';

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 300) + ']' : '')); } };

// —— 夹具载荷（小包装：本尺子量的是「有没有回话」与「动没动源键」，不是体积）——
// 载荷：tag 决定组名，n 决定条数——尾巴与全量共用组名才能验「并集」而不只是「条数」
const mkMyG = (groups) => JSON.stringify(groups.map(([tag, n]) => [tag, Array.from({ length: n }, (_, i) => 'data:image/png;base64,' + 'A'.repeat(60) + '#' + tag + i)]));
const mkCcG = (groups) => JSON.stringify({ text: groups.map(([g, n]) => [g, Array.from({ length: n }, (_, i) => '卡' + g + i + '|' + 'x'.repeat(300))]), kaomoji: [], emoji: [], sticker: [], image: [], voice: [], poke: [] });
const mkQc = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ t: '情话' + i })));
const countMy = (raw) => { try { const a = JSON.parse(raw); let n = 0; (a || []).forEach((g) => { n += Array.isArray(g[1]) ? g[1].length : 0; }); return n; } catch (e) { return -1; } };
const countCc = (raw) => { try { const d = JSON.parse(raw); let n = 0; Object.keys(d || {}).forEach((t) => (d[t] || []).forEach((g) => { n += Array.isArray(g[1]) ? g[1].length : 0; })); return n; } catch (e) { return -1; } };
const countQc = (raw) => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.length : -1; } catch (e) { return -1; } };

// INIT＝在文档任何脚本之前，把数据层那四扇门**只对本案点名的键**换成可判定答复，其余一律交回真实现
// （全量代答会连别的模块启动一起打断＝尺子自己制造异常，红在夹具而不是红在缺陷）
const INIT = (o) => `(function () {
  var o = ${JSON.stringify(o || {})};
  var db = o.db || {};                       // 模拟库：{键: 值}
  var hang = o.hang || [];                   // 这些键的每一发＝挂起（回 undefined＋置 ambiguous）
  var setFail = o.setFail || [];             // 这些键的写库＝没有提交回执
  var hydrate = o.hydrate || {};             // 键 → 'unread' | 'absent' | 'ok'（其余交回真实现）
  var L = window.localStorage;
  var my = { calls: [], sets: [], dels: [], readsWithInfo: 0 };
  window.__fx = my;
  window.__fxdb = db; // 只读取证用：F 组要当场比出「库里那本比本地全」
  var isHit = function (k, arr) { return arr.some(function (p) { return String(k || '').indexOf(p) >= 0; }); };
  var inDb = function (k) { return Object.prototype.hasOwnProperty.call(db, k); };
  var gReal, sReal, dReal, hReal, kReal;
  Object.defineProperty(window, 'idbGet', { configurable: true, set: function (v) { gReal = v; }, get: function () { return function (k, info) {
    my.calls.push('get:' + k); if (info) my.readsWithInfo++;
    if (isHit(k, hang)) { if (info) info.ambiguous = true; return Promise.resolve(undefined); }
    if (inDb(k)) return Promise.resolve(db[k]);
    return gReal ? gReal.apply(window, arguments) : Promise.resolve(undefined);
  }; } });
  Object.defineProperty(window, 'idbSet', { configurable: true, set: function (v) { sReal = v; }, get: function () { return function (k, v) {
    my.calls.push('set:' + k); my.sets.push('set:' + k);
    if (isHit(k, setFail)) return Promise.resolve(false);
    if (inDb(k)) { db[k] = (typeof v === 'string') ? v : JSON.stringify(v); return Promise.resolve(true); }
    return sReal ? sReal.apply(window, arguments) : Promise.resolve(false);
  }; } });
  Object.defineProperty(window, 'idbDelete', { configurable: true, set: function (v) { dReal = v; }, get: function () { return function (k) {
    my.calls.push('del:' + k); my.dels.push('del:' + k);
    if (inDb(k)) { delete db[k]; return Promise.resolve(true); }
    return dReal ? dReal.apply(window, arguments) : Promise.resolve(false);
  }; } });
  Object.defineProperty(window, 'idbHydrateKey', { configurable: true, set: function (v) { hReal = v; }, get: function () { return function (k) {
    my.calls.push('hyd:' + k);
    var mode = hydrate[k];
    if (mode === undefined) return hReal ? hReal.apply(window, arguments) : Promise.resolve(false);
    if (mode === 'unread') return Promise.resolve(false);
    if (mode === 'absent') return Promise.resolve(null);
    try { if (inDb(k)) L.setItem(k, db[k]); } catch (e) {}
    return Promise.resolve(true);
  }; } });
  Object.defineProperty(window, 'idbHasKey', { configurable: true, set: function (v) { kReal = v; }, get: function () { return function (k) {
    my.calls.push('has:' + k);
    if (isHit(k, hang)) return Promise.resolve(null);
    return kReal ? kReal.apply(window, arguments) : Promise.resolve(null);
  }; } });
  // 同步层：文档脚本之前种一次（xyStore.get 读不到内存副本时就是读这里）
  try { for (var s in (o.ls || {})) L.setItem(s, o.ls[s]); for (var d in (o.lsDel || {})) L.removeItem(d); } catch (e) {}
  // 迁移前快照：F 组那句「本地是残缺尾巴、库里那本更全」必须在任何动作之前定下来，否则红侧正因为
  // 它把源键吃了才读成 -1，断言就成了自我循环（取证的是现场，不是后果）
  window.__snap0 = { ls: Object.assign({}, o.ls || {}), db: Object.assign({}, db) };
})();`;

// RECORDER＝只记注入序与 async 标志，完全不碰数据层（E 组要的就是真启动那一趟的序）
// 同时按住 #921h 那条「缺模块就整页重载一次」：重载会把 __jsErrors 与注入台账一起清零，
// 两侧读到的就不是同一场（实测红侧因此假绿）。守卫写在 sessionStorage 里＝不碰产品逻辑。
const RECORDER = `(function () {
  try { sessionStorage.setItem('mochi-boot-heal', String(Date.now())); } catch (e) {}
  window.__appendOrder = [];
  var ap = Element.prototype.appendChild;
  Element.prototype.appendChild = function (n) {
    try { if (n && n.tagName === 'SCRIPT' && n.src) window.__appendOrder.push(n.src.split('/').pop() + '|' + (n.async ? 'async' : 'ordered')); } catch (e) {}
    return ap.apply(this, arguments);
  };
})();`;

const ls = (page, k) => page.evaluate((x) => { try { const v = localStorage.getItem(x); return v === null ? '(absent)' : v; } catch (e) { return '(err)'; } }, k);
const lsLen = (page, k) => page.evaluate((x) => { try { const v = localStorage.getItem(x); return v === null ? -1 : v.length; } catch (e) { return -2; } }, k);
const delOf = (f, k) => f.dels.filter((c) => c === 'del:' + k).length;
const setOf = (f, k) => f.sets.filter((c) => c === 'set:' + k).length;
const fx = (page) => page.evaluate(() => ({ calls: window.__fx.calls.slice(), sets: window.__fx.sets.slice(), dels: window.__fx.dels.slice(), readsWithInfo: window.__fx.readsWithInfo }));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const server = createServer((rq, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(rq.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });

async function open(opt, waitMs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.addInitScript(INIT(opt));
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.storeFor && !!window.idbSet, null, { timeout: 40000 });
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(waitMs === undefined ? 5000 : waitMs);
  return { page, ctx, errs };
}

// ═══════ 场景 A：表情包迁移·库里那一发挂起（本地只剩尾巴）═══════════
// 真实形状＝报障件那种：同步层读得出 60 条（default:cc-groups 只剩 576B 那一型），库里那本 90 条更全，
// 而这一发挂起答不上来。旧写法的后果可以量化：把 60 条尾巴当全部写进目标键，再把源键连库里那本一起拆＝净丢 30 条。
{
  const TAIL = mkMyG([['甲组', 60]]);
  const FULL = mkMyG([['甲组', 60], ['乙组', 30]]);
  const s = await open({ ls: { [MYE_SRC]: TAIL }, db: { [MYE_SRC]: FULL }, hang: ['my-emoji-groups'], lsDel: { [MYE_PUB]: 1 } });
  const f = await fx(s.page);
  const shape = await s.page.evaluate(() => {
    const cnt = (raw) => { try { let n = 0; JSON.parse(raw).forEach((g) => { n += g[1].length; }); return n; } catch (e) { return -1; } };
    return {
      ls: cnt(window.__snap0.ls['xy-home-v2:default:my-emoji-groups']),
      db: cnt(window.__snap0.db['xy-home-v2:default:my-emoji-groups']),
      hang: window.__fx.calls.filter((c) => c === 'get:xy-home-v2:default:my-emoji-groups').length,
    };
  });
  ok(shape.ls === 60 && shape.db === 90 && shape.hang >= 1, 'F1a 现场成立：本地只有 60 条尾巴、库里有 90 条更全的那本、而这一发确实问过库且没答上来（本地=' + shape.ls + '·库里=' + shape.db + '·问过 ' + shape.hang + ' 次）', shape);
  const stamp = await ls(s.page, ST_MYE);
  const hold = await s.page.evaluate(() => window.__myeMigHold || 0);
  const pubLen = await lsLen(s.page, MYE_PUB);
  ok(delOf(f, MYE_SRC) === 0, 'A1 每一发都没读到那一趟，一个源键都没拆（红侧＝尾巴当全部迁完就拆源，库里那 90 条一起没了）', f.dels.join(','));
  ok(stamp !== '1', 'A2 不盖「永不重跑」的戳（红侧＝盖了＝下次照样看不见）', stamp);
  ok(pubLen === -1, 'A3 全局那一本也没被这一发写成残缺包（读数非空才许落笔；红侧＝写成 60 条尾巴）', pubLen);
  ok(hold >= 1, 'A4 让路登记成证人 __myeMigHold=' + hold, hold);
  ok(s.errs.length === 0, 'Z1 A 场零未捕获 JS 异常', s.errs.slice(0, 2).join(' | '));
  await s.page.close(); await s.ctx.close();
  // 下一场：库里答得出来了 ⇒ 合并应当是并集 90 条，拆源与盖章排其后
  const q = await open({ ls: { [MYE_SRC]: TAIL }, db: { [MYE_SRC]: FULL }, lsDel: { [MYE_PUB]: 1 } });
  const f2 = await fx(q.page);
  const pubContent = await q.page.evaluate((k) => { try { const a = JSON.parse(localStorage.getItem(k)); let n = 0; a.forEach((g) => { n += g[1].length; }); return n; } catch (e) { return -1; } }, MYE_PUB);
  ok(pubContent === 90, 'A5a 库里答得出来那一趟并集落地＝90 条（实读=' + pubContent + '；红侧只写得出 60 条尾巴）', pubContent);
  ok(delOf(f2, MYE_SRC) === 1 && (await ls(q.page, ST_MYE)) === '1', 'A5b 并集落地之后才拆源＋盖章（顺序不可反）', f2.dels.join(','));
  await q.page.close(); await q.ctx.close();
}

// ═══════ 场景 B：表情包迁移·写库没有提交回执 ═══════
{
  const TAIL = mkMyG([['甲组', 30]]);
  const s = await open({ ls: { [MYE_SRC]: TAIL }, db: { [MYE_SRC]: mkMyG([['甲组', 30], ['乙组', 20]]) }, setFail: ['my-emoji-groups'], lsDel: { [MYE_PUB]: 1 } });
  const f = await fx(s.page);
  const srcLen = await lsLen(s.page, MYE_SRC);
  ok(delOf(f, MYE_SRC) === 0, 'B1 写库没回执＝不拆源（红侧＝remove 会连库里那本一起删掉）', f.dels.join(','));
  ok((await ls(s.page, ST_MYE)) !== '1', 'B2 写库没回执＝不盖章（红侧＝删完盖完＝50 条彻底没了）');
  ok(srcLen > 0, 'B3 源键在同步层一字未动（长度 ' + srcLen + '）');
  await s.page.close(); await s.ctx.close();
  const q = await open({ ls: { [MYE_SRC]: TAIL }, db: { [MYE_SRC]: mkMyG([['甲组', 30], ['乙组', 20]]) }, lsDel: { [MYE_PUB]: 1 } });
  const f2 = await fx(q.page);
  ok(delOf(f2, MYE_SRC) === 1 && (await ls(q.page, ST_MYE)) === '1', 'B4 有回执那一趟三步齐全＝闸没把这条路焊死（sets=' + f2.sets.length + ' dels=' + f2.dels.length + '）');
  await q.page.close(); await q.ctx.close();
}

// ═══════ 场景 C：字卡作用域迁移（同两条轴）═══════════
{
  const TAIL = mkCcG([['取证组', 12]]);
  const FULL = mkCcG([['取证组', 12], ['第二批', 8]]);
  const s = await open({ ls: { [CC_SRC]: TAIL }, db: { [CC_SRC]: FULL }, hang: ['cc-groups'], lsDel: { [CC_PUB]: 1 } });
  const f = await fx(s.page);
  const contacts = await s.page.evaluate(() => (window.getContacts ? window.getContacts().length : -1));
  const shape = await s.page.evaluate(() => {
    const cnt = (raw) => { try { const d = JSON.parse(raw); let n = 0; Object.keys(d).forEach((t) => (d[t] || []).forEach((g) => { n += g[1].length; })); return n; } catch (e) { return -1; } };
    return { ls: cnt(window.__snap0.ls['xy-home-v2:default:cc-groups']), db: cnt(window.__snap0.db['xy-home-v2:default:cc-groups']) };
  });
  ok(contacts === 1, 'F4 迁移条件在场：单桌面（getContacts=' + contacts + '）');
  ok(shape.ls === 12 && shape.db === 20, 'F1b 字卡这一格同样是「本地 12 张尾巴／库里 20 张更全」', shape);
  ok(delOf(f, CC_SRC) === 0, 'C1 挂起那一趟不拆专属键（那 20 张是库里唯一的副本，实拆 ' + delOf(f, CC_SRC) + '）', f.dels.join(','));
  ok((await ls(s.page, ST_CC)) !== '1', 'C2 同一趟不盖 cc-scope-migrated');
  ok((await s.page.evaluate(() => window.__ccMigHold || 0)) >= 1, 'C3 让路登记成证人 __ccMigHold');
  await s.page.close(); await s.ctx.close();
  const b = await open({ ls: { [CC_SRC]: TAIL }, db: { [CC_SRC]: FULL }, setFail: ['cc-groups-public'], lsDel: { [CC_PUB]: 1 } });
  const fb = await fx(b.page);
  ok(delOf(fb, CC_SRC) === 0, 'C4 写库没回执也不拆专属键（红侧＝公用那一本没落地而专属键已拆＝两头空）', fb.dels.join(','));
  await b.page.close(); await b.ctx.close();
  const q = await open({ ls: { [CC_SRC]: TAIL }, db: { [CC_SRC]: FULL }, lsDel: { [CC_PUB]: 1 } });
  const fq = await fx(q.page);
  const pubCards = await q.page.evaluate((k) => { try { const d = JSON.parse(localStorage.getItem(k) || 'null'); let n = 0; Object.keys(d || {}).forEach((t) => (d[t] || []).forEach((g) => { n += g[1].length; })); return n; } catch (e) { return -1; } }, CC_PUB);
  ok(pubCards === 20, 'C5 有回执那一趟：公用键=库里那本 20 张（实读=' + pubCards + '；红侧只有本地那 12 张）', pubCards);
  ok(delOf(fq, CC_SRC) === 1 && (await ls(q.page, ST_CC)) === '1', 'C6 整本进库之后才拆专属键＋盖章');
  await q.page.close(); await q.ctx.close();
}

// ═══════ 场景 D：今日情话自定义卡·整包写回（真点按钮）═══════════
{
  // 现场＝报障机上 IDB-only 那一型：同步层读空，而库里有 5 句
  const seed = {}; seed[QC_KEY] = mkQc(5);
  const s = await open({ db: seed, hydrate: { [QC_KEY]: 'unread' } }, 1500);
  const syncEmpty = await s.page.evaluate(() => { try { return window.storeFor('default').get('quote-cards') === null; } catch (e) { return 'err:' + e; } });
  ok(syncEmpty === true, 'F2 同步层读空是当场事实（store.get=null＝#1361n 那把尺要拦的就是这一发）', syncEmpty);
  await s.page.evaluate(() => { const ta = document.getElementById('cq-batch'); if (ta) ta.value = '针甲'; const b = document.getElementById('cq-batch-add'); if (b) b.click(); });
  await s.page.waitForTimeout(3000);
  const f = await fx(s.page);
  const landed = setOf(f, QC_KEY);
  ok(landed === 0, 'D1 读空＋取回没落地那一发点「批量添加」，整本写回被拦下（红侧＝库里那 5 句被这一发顶成 1 句；实写 ' + landed + '）', f.calls.slice(-6).join(' '));
  const hold = await s.page.evaluate(() => window.__qcBlindHold || 0);
  ok(hold >= 1, 'D1b 拦下之后登记成证人并退避重试（__qcBlindHold=' + hold + '＝不是静默丢）');
  await s.page.close(); await s.ctx.close();
  // 取回落地：动作要作用在真读到的那一本上
  const q = await open({ db: seed, hydrate: { [QC_KEY]: 'ok' } }, 1500);
  await q.page.evaluate(() => { const ta = document.getElementById('cq-batch'); if (ta) ta.value = '针甲\n针乙'; const b = document.getElementById('cq-batch-add'); if (b) b.click(); });
  await q.page.waitForTimeout(2500);
  const afterAdd = await ls(q.page, QC_KEY);
  ok(countQc(afterAdd) === 7, 'D2 取回落地后并集落笔（库里 5 句＋这发 2 句＝' + countQc(afterAdd) + '；红侧＝整本只剩 2 句）', (afterAdd || '').slice(0, 60));
  await q.page.evaluate(() => { const b = document.querySelector('#cq-mine-panel .ta-del') || document.querySelector('.ta-del'); if (b) b.click(); });
  await q.page.waitForTimeout(2500);
  const afterDel = await ls(q.page, QC_KEY);
  ok(countQc(afterDel) === 6, 'D3 删除那一发作用在真读到的那一本上（7→' + countQc(afterDel) + '＝少一条，既不清库也不把补回来的旧条目塞回）', countQc(afterDel));
  await q.page.close(); await q.ctx.close();
  // 新用户那一型：库里确认没有 ⇒ 照写不误
  const r = await open({ db: {}, hydrate: { [QC_KEY]: 'absent' } }, 1500);
  await r.page.evaluate(() => { const ta = document.getElementById('cq-batch'); if (ta) ta.value = '新用户的一句'; const b = document.getElementById('cq-batch-add'); if (b) b.click(); });
  await r.page.waitForTimeout(2500);
  const fr = await ls(r.page, QC_KEY);
  ok(countQc(fr) === 1, 'D4 库里确认没有＝照写不误（新用户没被闸挡住，实读=' + countQc(fr) + '）', (fr || '').slice(0, 60));
  await r.page.evaluate(() => { const ta = document.getElementById('cq-batch'); if (ta) ta.value = '又加的一句'; const b = document.getElementById('cq-batch-add'); if (b) b.click(); });
  await r.page.waitForTimeout(2500);
  const fr2 = await ls(r.page, QC_KEY);
  ok(countQc(fr2) === 2, 'D5 读数在场时照常 +1（1→' + countQc(fr2) + '＝旧行为零变化）', countQc(fr2));
  ok(r.errs.length === 0, 'Z1b D 组三场零未捕获 JS 异常', r.errs.slice(0, 2).join(' | '));
  await r.page.close(); await r.ctx.close();
}

// ═══════ 场景 E：外置包首拉全灭之后自愈那一趟的求值序 ═══════
// 现场形状＝报障件那一条「70 个功能包首拉失败（网络波动），自愈重试后已全部到位」——掐的是**全部**
// 外置件的第一发。只掐其中九个不够：其余几十件在 contacts.js 缺席时照常求值、照样抛，那笔账不在本批
// 这一条腿上（红在夹具而不在缺陷，实测踩过一次）。
{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const all = [...new Set([...html.matchAll(/<script[^>]*src="js\/([a-z0-9-]+\.js)"/g)].map((m) => m[1]))];
  const CALLERS = ['quote-cards.js', 'chat.js', 'chatcard.js', 'fav-settings.js', 'records.js', 'loc-lib.js', 'sfx.js', 'feed.js', 'mail.js'];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  // 注入序取证＋把「失败清单」本身打乱：真实弱网里 ExtFail 就是按各发各自失败的时刻拼起来的
  // （#1035 那条腿在 onerror 里 concat），照抄它的顺序注入＝调用方排在依赖之前。不打乱则两侧
  // 恰好都按文档序走，这一条腿谁也红不了（夹具自证过一次的坑）。
  await page.addInitScript(RECORDER + `(function () {
    window.addEventListener('load', function () {
      setTimeout(function () {
        try {
          var f = (window.__mochiExtFail || []).slice();
          var i, j, t;
          for (i = f.length - 1; i > 0; i--) { j = (i * 2654435761) % (i + 1); t = f[i]; f[i] = f[j]; f[j] = t; }
          window.__mochiExtFail = f;
          window.__shuffled = 1;
        } catch (e) {}
      }, 300);
    });
  })();`);
  const failedOnce = {};
  await page.route('**/js/*.js', async (route) => {
    const name = route.request().url().split('/').pop().split('?')[0];
    if (!failedOnce[name]) { failedOnce[name] = 1; return route.abort('failed'); }
    if (name === 'contacts.js') { await new Promise((r) => setTimeout(r, 6000)); return route.continue(); } // 迟到的依赖＝报障机上「重跑那一趟」的真实形状：调用方先到
    return route.continue(); // 其余先到＝到达序与求值序的那个岔口
  });
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(11000); // 自愈第一波在 load+1.5s
  const jsErrs = await page.evaluate(() => (window.__jsErrors || []).filter((e) => /activeStore is not a function/.test(String(e))).length);
  const order = await page.evaluate(() => (window.__appendOrder || []));
  const loaded = await page.evaluate(() => (window.__mochiLoaded || []).length);
  const who = await page.evaluate(() => String((window.__jsErrors || []).slice(0, 3).join(' ;; ')).slice(0, 240));
  ok(all.length >= 60, 'F3 这一场确实是「外置包首拉全灭」的形状（在册外置件=' + all.length + ' 个）', all.length);
  ok(jsErrs === 0, 'E1 自愈重跑那一趟不许出现「window.activeStore is not a function」（命中 ' + jsErrs + ' 条＝报障件 00:06 那四条逐字复现）', who);
  const ci = order.findIndex((x) => x.indexOf('contacts.js|') === 0);
  const cs = CALLERS.map((c) => order.findIndex((x) => x.indexOf(c + '|') === 0)).filter((i) => i >= 0);
  const firstCaller = cs.length ? Math.min(...cs) : -1;
  ok(ci >= 0 && firstCaller > ci, 'E2 重注入按开机求值序：contacts.js 排在第 ' + ci + ' 位、最早的调用方在第 ' + firstCaller + ' 位（共 ' + order.length + ' 发）', order.slice(0, 6).join(' '));
  ok(order.length >= 2 && order.every((x) => /\|ordered$/.test(x)), 'E3 动态插入的脚本 async=false（' + order.length + ' 发全部 ordered）', order.slice(0, 4).join(' '));
  ok(loaded >= all.length - 6, 'E4 自愈之后包确实跑到位（__mochiLoaded=' + loaded + '／外置件=' + all.length + '）', loaded);
  ok(errs.length === 0, 'Z1c E 场零未捕获 JS 异常', errs.slice(0, 2).join(' | '));
  await page.close(); await ctx.close();
}
// ═══════ S 组：本批九针（产物静态锚）═══════
{
  const chat = readFileSync(join(root, 'js/chat.js'), 'utf8');
  const card = readFileSync(join(root, 'js/chatcard.js'), 'utf8');
  const qc = readFileSync(join(root, 'js/quote-cards.js'), 'utf8');
  const idx = readFileSync(join(root, 'index.html'), 'utf8');
  const idb = readFileSync(join(root, 'js/idb.js'), 'utf8');
  ok(chat.includes('finish(merged, unread === 0)'), 'S1 表情包迁移认三态那一发在场');
  ok(chat.includes('if (ok === true) stamp();'), 'S2 拆源盖章排在提交回执之后');
  ok(card.includes('pick(local, unread === 0)'), 'S3 字卡迁移同一条判据');
  ok(!card.includes('idbGet(k).catch(() => null)') && !chat.includes('idbGet(k).catch(() => null)'), 'S4 迁移那批发不许把读不回压成空值（旧形状复活＝本批白修）');
  ok(idb.includes('window.xyPackageEmptyRead = function'), 'S5 数据层那句「这一发读空有没有权威」在场（本批接的是它，不是新造尺子）');
  ok(qc.includes('if (!window.xyPackageEmptyRead || !window.xyPackageEmptyRead(store, KEY) || qcAuth) { qcRun(); return; }'), 'S6 今日情话落笔前过那句判断（读数非空／库里回过话才许落笔）');
  ok(qc.includes('ops.forEach(op => { const r = op(out); if (Array.isArray(r)) out = r; });'), 'S7 暂存的是动作不是算好的那一份表');
  ok(idx.includes('const q = byBootOrder(list);') && idx.includes('s.async = false;'), 'S8 自愈腿按开机求值序＋按插入序执行');
  ok(idx.includes('byBootOrder(list).forEach'), 'S9 换址逃生那条腿同一条序（不留第二个口子）');
  ok(!idx.includes('s.async = true;'), 'S9b 旧的 async=true 不许回到自愈那条腿');
}

console.log('\n#1371 迁移盲写／自愈乱序尺子：' + pass + ' 绿 / ' + fail + ' 红  （被测=' + root + '）');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
