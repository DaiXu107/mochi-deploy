// ===== 常驻回归脚本 #1361：整包读-改-写的两本账（收藏 fav-msgs／字卡库 cc-groups(-public)）
//        在「同步口读空」那一发被程序自己写回＝用户口径的「莫名其妙被清空」
// 用法：node tools/verify-1361-package-write-blind-read.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-28 直派：荣耀 X70(MTN-AN80)／MagicOS 10／Android 16／Edge 153 桌面 PWA
// 「收藏数据和自定义专属字卡数据会莫名其妙消失（但更新之后，有时会出现一个弹窗…点击确认之后，专属
// 字卡又会复现）」；明说「这个问题其他设备型号也有出现」「不要覆盖修改导致不同型号设备浏览器的 bug
// 反复出现」。诊断 mochi-diag-2026-09-28-04-19-…：【保活现场】「本页被系统回收过 200 次」＝每次进来
// 都是一发冷启动；【数据】段同一个 default:cc-groups 出现两个读数 284B／228B（LS 与库里已经不一致），
// 而此刻两样都只剩一个空壳＝一整本字卡库被写成了骨架。用户说的「点确认又复现」＝重载后 chatcard 的
// attempt() 见「库里条目更多」把权威库灌回来那条自愈路（chatcard.js:498）——它只在那一发 IDB 写没
// 落地时才救得回来；落地了就是永久丢失，所以用户看到的是「有时回来、有时不回来」。）
//
// 机制（纯 HEAD 产物无头实测；判据零机型／零 UA，只取「这一格读到了没有」＋「库里那份的证人在不在册」）：
//   fav-msgs 与 cc-groups 都是 `JSON.parse(同步读数 || 空) → 改 → store.set(整包)` 的账。收藏包／字卡库
//   一旦跨过 200KB 就是 IDB-only（xyStore.set 的大键分支主动把 LS 那份 removeItem），而同步口
//   xyStore.get 只认 memoryCache 与 localStorage，两样都没有 ⇒ 返回 null，与「用户真没有这些数据」同形。
//   触发它不需要任何用户动作（＝「莫名其妙」）：
//     · 专属字卡＝梦角自由造句每次自动回复后调 window.ccAppendCards（dream-free.js:327）。#455 只挡
//       「groups=null 别拿空编辑树」，没挡「同步读数本身是读空」——页外直写那条分支拿
//       buildGroupsFrom(null) 画一棵空树、追加一张、整包写回。实测红侧：库里 1600 张 → 冷启动
//       store.get('cc-groups')=NULL → ccAppendCards(...) 返回 true → 库里 1 张（其余永久没了）。
//     · 收藏＝各桌面 TA 自动收藏我的动态／卡片。chat.js 侧走 saveFav，feed.js 那条更是跨模块直接
//       s.set('fav-msgs') 不过任何闸。实测红侧（切一次后台放掉内存副本后）：库里 70 条 →
//       addMyFavItem 一发 → 库最小 1、终 1。
//   数据层早有闸门（#1342d awaitingBigKey／#1349a 被放掉名册／#1258 证人 idbBigIdxSize），但两处都
//   够不着这两本账：
//     ① **句柄转发缺口**：window.activeStore() 只转发 get/set/remove ⇒ 凡从它取句柄的账（chat.js 的
//        收藏、chatcard.js 的字卡库＝按联系人命名空间存的绝大部分账）调 store.awaitingBigKey 得到
//        undefined，那道闸对这些账永远判「不拦」。实测：同一份夹具、同一把尺，xyStore(前缀) 句柄上
//        awaiting=true 拦得住，activeStore() 句柄上静默失效。
//     ② **冷启动失明**：#1342d 那句只认两本活在内存里的账（切后台名册、启动挂起名单），而一页被回收
//        200 次的机器每次冷启动这两本账都从零开始 ⇒ 读空那一格照样放行写回。
//
// 收口（六处，全部走数据层同一句判断，不逐页补名字、零机型／零 UA 分支）：
//   A idb.js #1361a：bigReadUnconfirmed 认第三格证人——躺在 localStorage 的 __big-idx（页面回收杀不
//     掉、#1195e 释放刻意不清、remove/小值写回才同步销账）说这一格本该有一份 >200KB 的副本而这里读空
//     ＝「没读到」不是「没有」；只有健康连接确认库里真没这一键（bigHydAbsent）才作废这个证人，否则一次
//     IDB 挂起会把闸永久焊死在「不许写」上（#1342「不把这道闸变成新的存不进去」的约束照旧管着）。
//   B idb.js #1361b：同一句判断的**静默**版 xyBigWriteHold——自动通路没有「请用户再点一次」可说，
//     弹提示＝凭空冒话，硬写＝清库；只拦不下＋顺手请一次库（复用 #1349 那只单次飞行闸）。
//   C contacts.js #1361g：activeStore()/defaultStore() 转发 awaitingBigKey/requestBigKey，口径与本
//     工厂自己的 get 逐字对齐（命名空间键＋旧顶层键两格候选都读空才谈「读不到」）。
//   D chatcard.js #1361c/d：编辑树落盘前过 #1342 那句（ccDirty 保持置位＝离页/回前台的 flushCcSave
//     会拿取回后的权威库重来）；营救路径改认三态（idbHasKey 的 null＝这一发没读到，旧写法 !exists 把它
//     当「库里没有」＝#1309/#1330 那一族在字卡库这一格的尾巴）；ccAppendCards 两条页外直写分支（公用／
//     专属懒加载）读数不可信时静默让路＋请库，并把「下一班」交给库里那份读回来这件事本身
//     （idbEnsureBigKey 与 #1218／#1349 共用同一格合流；问不出结果才按有界定时器自重放兜底）。
//   E chat.js #1361e：saveFav 不新造暂存——退回本模块已有的 favPending 那一路（权威回话后 favDrain 按
//     favItemKey 并集落盘＝既不等用户再点一次，也不复活他删过的），并补发一次权威问话把闸重新打开。
//   F feed.js #1361f：那条跨模块直写静默让路。
//
// 断言（两侧同一把尺子串行跑：落库副本应全绿，纯 HEAD 副本红的恰是 A2/A1/B1/A4b 这几条新契约）：
//   F 组 夹具诚实：F0 库里灌好 N 条／F1 跨过 200KB＝LS 那份被剥掉（IDB-only）／F2 证人 __big-idx 在册／
//     F3 冷启动那一发 cc 确实读空（读不到这个事实＝A 组读数才有意义）／F4 切后台那一发 fav 确实读空
//   A 组 专属字卡（真链路 window.ccAppendCards）：A1 冷启动读空那一发不许把整本库写成 1 张／
//     A2 落笔那一刻生产句柄（activeStore）上这把尺说「不许整包写回」（红侧＝这个口根本不存在）／
//     A2b 证人单独在册（没名册、没挂起名单）就足以说不许——本批数据层那一格／
//     A3 让路之后造句仍落地／A4 公用作用域同一条（切后台放掉那一发）／
//     A5 健康连接确认库里没有＝照写不误（修过头防护）
//   B 组 收藏（真链路 window.addMyFavItem）：B1 读空那一发不许把 70 条写成 1 条／B2 走已有的
//     favPending 暂存路（取证环 fav-blind-hold）并重新问权威／B3 并集落盘后收藏一条没少、这发也落地
//   C 组 旧契约不许动：C1 读数正常时两条通路各照旧正好 +1／C2 读数在场时整包写空（用户亲手清空那一类）
//     照旧放行／C3 小键（LS 有副本）永远不拦／C4 切后台照旧按体积放掉大键内存副本＋登记名册（不许用
//     「不再释放」来修这个 bug＝iOS 卡顿那一批的回归）／C5 被放掉那一格当场问库、下一读自愈
//     （#1349a 语义不动）／C6 #1342 那几本方案账的闸照旧接在原句柄上
//   S 组 逻辑锚（产物静态，防「名字留着逻辑被改」）：证人分支／xyBigWriteHold／activeStore＋defaultStore
//     转发／ccAppendCards 两处接线／rescueCcOverwrite 认三态／saveGroups 过闸且不清 ccDirty／saveFav 让路
//     ＋重新问权威／feed 让路
//   Z1 全程零未捕获 JS 异常
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
console.log('serve root = ' + root);
if (!existsSync(join(root, 'index.html'))) {
  console.error('✗ 被测根目录没有 index.html（喂错目录了：所有断言会一起红，看起来像"修复没生效"）');
  process.exit(2);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 300) + ']' : '')); } };

// —— 夹具 ——
// 字卡库：1600 张 ≈6.7MB＝跨过 200KB（IDB-only）但**没超启动预算**（headless navigator.deviceMemory=8
// ⇒ 预算 24MB）⇒ 启动回填既不会把它挂进 __xyIdbDeferredKeys、也不会「确认库里没有」，本会话两本内存
// 账全是空的：这一格读空时唯一的证人就是 localStorage 里那份 __big-idx（＝#1361a 那一格的判据）。
// 收藏包：70 条 ≈294KB＝跨过 200KB（IDB-only）且 ≥256KB（够得着 #1195e 那道释放闸）。
const NCC = 800, NFAV = 70;
// own 与 pub 的卡串各带自己的前缀：#139 那把去重体检（chatcard.js ddCount）在「专属整本被公用
// 覆盖」时会合法删掉专属键，夹具若两边同名就成了自己跟自己撞车（读数会凭空变 -9＝库里没了）
const mkCc = (n, grp, tag) => JSON.stringify({ text: [[grp || '取证组', Array.from({ length: n }, (_, i) => (tag || 'own') + '卡' + i + '|'.padEnd(4200, 'x'))]], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] });
const mkFav = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ by: 'me', kind: 'msg', side: 'in', ts: 1700000000000 + i, text: '收藏' + i + '|'.padEnd(4200, 'x') })));
const CCC = 'xy-home-v2:default:cc-groups', FFF = 'xy-home-v2:default:fav-msgs', PUBCC = 'xy-home-v2:cc-groups-public';

// 跨设备形态（用户明说「这个问题其他设备型号也有出现」＝同一句判据必须在别的内核／别的内存档位上
// 也成立，所以本尺子可换引擎跑）：
//   USE_WEBKIT=1 → WebKit（iOS Safari／PWA 那一族的引擎；#1195e 那把「切后台放掉大键内存副本」
//     的闸本来就是为 iOS 内存压力装的，本批这一格在 iOS 上同样成立才算没白修）
//   LOWMEM=1     → navigator.deviceMemory=4（启动回填大键预算从 24MB 降到 12MB＝低内存安卓机那一档，
//     被测那一格更容易被挂起；挂起与证人两条证据路都同判「不许整包写回」）
const ENGINE = process.env.USE_WEBKIT === '1' ? 'webkit' : 'chromium';
const LOWMEM = process.env.LOWMEM === '1';
console.log('引擎 = ' + ENGINE + ' · deviceMemory 档 = ' + (LOWMEM ? '4GB（预算 12MB）' : '默认'));

const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 369, height: 774 }, userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36 EdgA/153.0.0.0' });
if (LOWMEM) await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 }); } catch (e) {} });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

// 库里条数只在页内数（MB 级串回传会把通道撑爆），且必须分得清「读到了」「键真没了」「这轮没读出来」
// ——把「读不出」和「没有」混成一个 -9，就是 #1309/#1330 那一条错误在尺子上的翻版
const libCount = (key) => p.evaluate((k) => new Promise((res) => {
  let tries = 0;
  const once = () => {
    let rq; try { rq = indexedDB.open('mochi-db', 1); } catch (e) { return done('err'); }
    const done = (state, n) => {
      if (state !== 'err' || tries >= 3) return res({ state, n: n === undefined ? -1 : n });
      tries++; setTimeout(once, 400);
    };
    rq.onsuccess = () => {
      let g;
      try { g = rq.result.transaction('kv', 'readonly').objectStore('kv').get(k); } catch (e) { try { rq.result.close(); } catch (e2) {} return done('err'); }
      g.onsuccess = () => {
        const v = g.result;
        try { rq.result.close(); } catch (e2) {}
        if (v === undefined) return done('missing');
        try {
          const a = typeof v === 'string' ? JSON.parse(v) : v;
          if (Array.isArray(a)) return done('ok', a.length);
          let n = 0; Object.keys(a).forEach((t) => (a[t] || []).forEach((x) => { n += (Array.isArray(x[1]) ? x[1].length : 0); }));
          done('ok', n);
        } catch (e) { done('err'); }
      };
      g.onerror = () => { try { rq.result.close(); } catch (e2) {} done('err'); };
      g.onabort = () => { try { rq.result.close(); } catch (e2) {} done('err'); };
    };
    rq.onerror = () => done('err');
    rq.onblocked = () => done('err');
  };
  once();
}), key);
const delIdb = (key) => p.evaluate((k) => new Promise((res) => {
  const rq = indexedDB.open('mochi-db', 1);
  rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(1); tx.onerror = () => res(0); };
  rq.onerror = () => res(0);
}), key);
const putIdb = (key, val) => p.evaluate(({ k, v }) => new Promise((res) => {
  const rq = indexedDB.open('mochi-db', 1);
  rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(1); tx.onerror = () => res(0); };
  rq.onerror = () => res(0);
}), { k: key, v: val });
const toBg = () => p.evaluate(() => new Promise((res) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  setTimeout(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    res(1);
  }, 200);
}));
const libN = async (k) => { const r = await libCount(k); return r.state === 'ok' ? r.n : (r.state === 'missing' ? 0 : -9); };
// MB 级整包落库要时间（idbSet 的超时按体积放大），F0 必须等到「库里真是这一本」再开枪，
// 否则后面所有读数量的都是自己的写入延迟
async function waitLib(key, want, ms) {
  const t0 = Date.now();
  let last = -9;
  while (Date.now() - t0 < (ms || 10000)) {
    last = await libN(key);
    if (last === want) return last;
    await p.waitForTimeout(400);
  }
  return last;
}
const dismiss = () => p.evaluate(() => { const s = document.querySelector('.splash'); if (s) s.remove(); document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove()); const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true; });
async function boot() {
  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  await dismiss();
  // 关掉 v3.11.x 那次性的「单桌面用户专属字卡整体迁到公用并清掉专属键」迁移：它会在开机 +0.7s
  // 把本批夹具那份合成专属库整键搬走（st.remove('cc-groups')＋gRoot.remove），与本批要量的
  // 「读空那一发不许整包写回」无关，留着只会让读数变成迁自己的库。标记是幂等的一次性开关。
  await p.evaluate(() => { try { window.xyStore('xy-home-v2').set('cc-scope-migrated', '1'); } catch (e) {} });
  await p.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1200);
}
// 自然写入＝走 xyStore.set（大键分支剥 LS、__big-idx 记证人、内存副本在场）
// 顺带灌 4 根「排在被测键前面」的公用根键填充（'xy-home-v2:aafill-*' 按 IDB 键序确实排在
// 'xy-home-v2:cc-groups-public' 与 'xy-home-v2:default:cc-groups' 之前）：启动回填是逐单元
// 流式读＋setTimeout 让路的队列，被测键因此天然排在几秒之后＝冷启动「读空」那一发测得稳，
// 不靠运气抢（真机上这一发就是常态：报障件写着本页被系统回收 200 次）。
async function seedViaStore(items) {
  await p.evaluate((its) => {
    for (let i = 0; i < 4; i++) window.xyStore('xy-home-v2').set('aafill-' + i, 'F' + i + '|'.padEnd(2 * 1024 * 1024, 'y'));
    its.forEach(({ prefix, key, val }) => window.xyStore(prefix).set(key, val));
  }, items);
  for (let i = 0; i < 60; i++) {
    const w = await p.evaluate((keys) => keys.map((k) => (window.idbBigIdxSize && window.idbBigIdxSize(k)) || 0), items.map((x) => x.key));
    if (w.every((n) => n > 200 * 1024)) break;
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(1500);
}
// 冷启动开枪：reload 后一路等到全局口出现就开枪（报障件写着本页被回收 200 次＝这一发是日常）。
// 库里那份 MB 级取回还在路上 ⇒ 同步读数 NULL、名册空、挂起名单空、只有证人在册。
async function coldShot(which) {
  for (let t = 0; t < 8; t++) {
    await p.reload({ waitUntil: 'domcontentloaded' });
    const r = await p.evaluate((w) => new Promise((res) => {
      let ticks = 0;
      const timer = setInterval(() => {
        ticks++;
        if (typeof window.ccAppendCards !== 'function' || typeof window.activeStore !== 'function' || typeof window.idbBigIdxSize !== 'function') {
          if (ticks > 1200) { clearInterval(timer); res({ at: -1, read: 'no-api' }); }
          return;
        }
        clearInterval(timer);
        const st = w === 'pub' ? window.xyStore('xy-home-v2') : window.activeStore();
        const rel = w === 'pub' ? 'cc-groups-public' : 'cc-groups';
        if (w === 'fav') {
          const rawF = window.activeStore().get('fav-msgs');
          const outF = {
            at: ticks * 10,
            read: rawF === null ? 'NULL' : 'HIT',
            api: typeof st.awaitingBigKey,
            await: typeof st.awaitingBigKey === 'function' ? st.awaitingBigKey('fav-msgs') : 'no-api',
            witness: window.idbBigIdxSize('fav-msgs') || 0,
            dataState: window.mochiDataState ? window.mochiDataState() : 'no-api'
          };
          outF.added = window.addMyFavItem({ kind: 'msg', side: 'in', text: '取证小键收藏', ts: Date.now() });
          res(outF);
          return;
        }
        const raw = st.get(rel);
        const out = {
          at: ticks * 10,
          read: raw === null ? 'NULL' : 'HIT',
          api: typeof st.awaitingBigKey,
          await: typeof st.awaitingBigKey === 'function' ? st.awaitingBigKey(rel) : 'no-api',
          witness: window.idbBigIdxSize(rel) || 0,
          blind: window.__xyBigReadDiag ? window.__xyBigReadDiag() : null
        };
        if (out.read === 'NULL') out.added = window.ccAppendCards('mjfree', '梦角自由造句', [w === 'pub' ? '取证公用一句' : '取证冷启一句'], w);
        res(out);
      }, 10);
    }), which);
    if (r.read === 'NULL') return r;
    console.log('    （第 ' + (t + 1) + ' 次冷启动被回填抢先：read=' + r.read + '，重来）');
  }
  return { at: -1, read: 'NULL-never' };
}
// 等库里落定，同时记最小值（＝这一场最坏那一刻库里还剩几条）；「一轮都没读到」不许算绿
async function settle(key, need, rounds) {
  let min = 9e9, last = -9, valid = 0, miss = 0, err = 0;
  for (let i = 0; i < (rounds || 40); i++) {
    const r = await libCount(key);
    if (r.state === 'ok') { valid++; min = Math.min(min, r.n); last = r.n; }
    else if (r.state === 'missing') { valid++; miss++; last = 0; }
    else err++;
    if (i > 5 && last >= need) break;
    await p.waitForTimeout(500);
  }
  return { min: valid ? min : -9, last, valid, miss, err };
}

console.log('\n[F 夹具诚实]');
await boot();
await seedViaStore([{ prefix: 'xy-home-v2:default', key: 'cc-groups', val: mkCc(NCC) }, { prefix: 'xy-home-v2:default', key: 'fav-msgs', val: mkFav(NFAV) }]);
const f0 = { cc: await waitLib(CCC, NCC, 20000), fav: await waitLib(FFF, NFAV, 20000) };
ok(f0.cc === NCC && f0.fav === NFAV, 'F0 库里灌好：cc=' + NCC + ' 张 / fav=' + NFAV + ' 条', JSON.stringify(f0));
const fShape = await p.evaluate((ks) => { const o = {}; ks.forEach((k) => { o[k] = localStorage.getItem(k) === null; }); return o; }, [CCC, FFF]);
ok(fShape[CCC] === true && fShape[FFF] === true, 'F1 跨过 200KB＝LS 那份被大键分支剥掉（IDB-only，同步口天生读不到）', JSON.stringify(fShape));
const fWit = await p.evaluate((ks) => {
  let o = {};
  try { o = JSON.parse(localStorage.getItem('xy-home-v2:__big-idx') || '{}') || {}; } catch (e) {}
  return ks.map((k) => o[k] || 0);
}, [CCC, FFF]);
ok(fWit[0] > 200 * 1024 && fWit[1] > 200 * 1024, 'F2 证人躺在 localStorage 的 __big-idx 里（页面回收杀不掉＝冷启动唯一还活着的旁证）', JSON.stringify(fWit));

console.log('\n[A 专属字卡：冷启动读空那一发（真链路 window.ccAppendCards）]');
const shotA = await coldShot('own');
console.log('    开枪读数：' + JSON.stringify(shotA));
ok(shotA.read === 'NULL', 'F3 冷启动那一发同步读数确实读空（读不到＝A 组读数才有意义）', shotA.read);
ok(shotA.api === 'function' && shotA.await === true, 'A2 生产句柄（activeStore）上这把尺说「不许整包写回」（红侧＝这个口不存在，闸对 per-cid 账够不着）', JSON.stringify({ api: shotA.api, await: shotA.await }));
ok(shotA.blind && shotA.blind.blind === 0 && shotA.blind.deferred === 0 && shotA.witness > 200 * 1024, 'A2b 名册空、挂起名单空、只有证人在册——这一格读空照样算「没读到」（#1361a 那一格）', JSON.stringify(shotA));
const stA = await settle(CCC, NCC + 1, 60);
console.log('    等待落定：库里 cc 最小 ' + stA.min + ' → 终 ' + stA.last);
ok(stA.valid > 0 && stA.min >= NCC, 'A1 冷启动读空那一发没把 ' + NCC + ' 张字卡写成 1 张（红侧实测最小=1＝用户所见「专属字卡消失」）', 'min=' + stA.min);
ok(stA.last >= NCC + 1, 'A3 让路之后造句仍落地（库里 ' + stA.last + ' 张＝闸门不是「存不进去」）', 'last=' + stA.last);

console.log('\n[A4 公用作用域同一条（同一发冷启动，公用库这一格）]');
await boot();
await seedViaStore([{ prefix: 'xy-home-v2', key: 'cc-groups-public', val: mkCc(400, '公用取证组', 'pub') }]);
const shotA4 = await coldShot('pub');
const stA4 = await settle(PUBCC, 401, 44);
console.log('    开枪：' + JSON.stringify(shotA4) + ' → 公用库 cc 最小 ' + stA4.min + ' 终 ' + stA4.last);
ok(shotA4.read === 'NULL' && shotA4.await === true, 'A4 公用库读空那一发同一把尺说不许写（公用这一格走 xyStore 句柄，本批之前也没接）', JSON.stringify(shotA4));
ok(stA4.valid > 0 && stA4.min >= 400, 'A4b 公用库没被这一发顶成 1 张（红侧实测最小=1＝整本公用字卡被一张造句顶掉）', 'min=' + stA4.min);
ok(stA4.last >= 400, 'A4c 让路之后公用这一格最终读回来了（闸门不许永久挂在「不许写」＝存不进去；库里那本一条没少）', 'last=' + stA4.last);
const pubState = await p.evaluate(() => { const ps = window.xyStore('xy-home-v2'); return { read: ps.get('cc-groups-public') === null ? 'NULL' : 'HIT', await: ps.awaitingBigKey('cc-groups-public') }; });
ok(pubState.read === 'HIT' && pubState.await === false, 'A4d 观察窗结束时公用这一格已不再挂着闸（这一句自动造句最坏是少一条，库不许丢）', JSON.stringify(pubState));

console.log('\n[A5 确认库里真没有＝照写不误（修过头防护）]');
await delIdb(CCC);
await p.evaluate((k) => { try { localStorage.removeItem(k); } catch (e) {} }, CCC);
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
await dismiss();
await p.waitForTimeout(2500);
const a5 = await p.evaluate(async () => {
  const st = window.activeStore();
  const before = st.get('cc-groups');
  const ensure = window.idbEnsureBigKey ? await window.idbEnsureBigKey('cc-groups') : 'no-api';
  const blockedAfter = typeof st.awaitingBigKey === 'function' ? st.awaitingBigKey('cc-groups') : 'no-api';
  const added = window.ccAppendCards('mjfree', '梦角自由造句', ['取证空库一句'], 'own');
  return { before: before === null ? 'NULL' : 'HIT', ensure, blockedAfter, added };
});
await p.waitForTimeout(1500);
const a5lib = await libN(CCC);
console.log('    A5：' + JSON.stringify(a5) + ' → 库里 ' + a5lib + ' 张');
ok((a5.ensure === 'absent') && (a5.blockedAfter === false || a5.blockedAfter === 'no-api') && a5lib >= 1, 'A5 健康连接确认库里没有＝空库是权威，这一发照写（新闸不许变成「存不进去」）', JSON.stringify(a5) + ' lib=' + a5lib);

console.log('\n[B 收藏：切后台放掉那一发（真链路 window.addMyFavItem）]');
await boot();
await seedViaStore([{ prefix: 'xy-home-v2:default', key: 'fav-msgs', val: mkFav(NFAV) }]);
await toBg();
await p.waitForTimeout(500);
const shotB = await p.evaluate(() => {
  const st = window.activeStore();
  const raw = st.get('fav-msgs');
  return { read: raw === null ? 'NULL' : 'HIT', await: typeof st.awaitingBigKey === 'function' ? st.awaitingBigKey('fav-msgs') : 'no-api', addOk: window.addMyFavItem({ kind: 'msg', side: 'in', text: '取证放掉收藏', ts: Date.now() }) };
});
ok(shotB.read === 'NULL', 'F4 切后台放掉那一发 fav 确实读空（#1195e 放掉内存副本＋LS 本就没有）', JSON.stringify(shotB));
const stB = await settle(FFF, NFAV + 1, 44);
console.log('    开枪：' + JSON.stringify(shotB) + ' → 库里 fav 最小 ' + stB.min + ' 终 ' + stB.last);
ok(stB.valid > 0 && stB.min >= NFAV, 'B1 读空那一发没把 ' + NFAV + ' 条收藏写成 1 条（红侧实测最小=1 终=1＝用户所见「收藏莫名其妙消失」）', 'min=' + stB.min);
const b2 = await p.evaluate(() => (window.__mochiPhaseLog || []).map((x) => x.tag).filter((t) => /^fav-(blind-hold|hold|adopt|auth-retry)/.test(t)));
ok(b2.some((t) => t.indexOf('fav-blind-hold') === 0), 'B2 让路那一发进的是已有的 favPending 暂存路（取证环看得见 fav-blind-hold；落盘由 B3 的并集读数证）', JSON.stringify(b2));
ok(stB.last >= NFAV + 1, 'B3 权威回话后按并集落盘：收藏一条没少、这一发也真落地（fav=' + stB.last + '）', 'last=' + stB.last);

console.log('\n[E 小键那一型＝这台报障机的现状（两本库都在 200KB 以下 ⇒ 大键那三格证据全为 0）]');
// 现场构造（确定性，不抢时序）：库里有一份、LS 两格候选都不在、内存副本按 #975 现成的口放掉、而且启动
// 回填已落定（dataState=ready）＝「回填整轮 bail out／键在 restore 之后才出现」这两型的可观测等价状态。
// 这一型是 #1342/#1349 那把大键闸的盲区：名册、挂起名单、__big-idx 证人这里全为零，于是空读被当成
// 「没有」＝照样清库。收藏包被 #139/#142 压缩与令牌化压回 200KB 以下之后正是这一型（报障件里
// default:cc-groups 只剩 228B、公用 21.6KB，两本都在这一档）。
await boot();
await putIdb(FFF, mkFav(6));
await putIdb(CCC, mkCc(6));
const shotE = await p.evaluate((ks) => {
  const st = window.activeStore();
  ks.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
  ks.forEach((k) => { try { if (window.idbMemoDrop) window.idbMemoDrop(k); } catch (e) {} });
  const out = {
    favRead: st.get('fav-msgs') === null ? 'NULL' : 'HIT', ccRead: st.get('cc-groups') === null ? 'NULL' : 'HIT',
    favWitness: window.idbBigIdxSize('fav-msgs') || 0, ccWitness: window.idbBigIdxSize('cc-groups') || 0,
    dataState: window.mochiDataState ? window.mochiDataState() : 'no-api',
    emptyApi: typeof window.xyPackageEmptyRead,
    emptyRead: typeof window.xyPackageEmptyRead === 'function' ? window.xyPackageEmptyRead(st, 'fav-msgs') : 'no-api'
  };
  out.favAdded = window.addMyFavItem({ kind: 'msg', side: 'in', text: '取证小键收藏', ts: Date.now() });
  out.ccAdded = window.ccAppendCards('mjfree', '梦角自由造句', ['取证小键一句'], 'own');
  return out;
}, [FFF, 'xy-home-v2:fav-msgs', CCC, 'xy-home-v2:cc-groups']);
console.log('    开枪：' + JSON.stringify(shotE));
const stE = await settle(FFF, 7, 40);
const stE2 = await settle(CCC, 7, 40);
console.log('    落定：fav 最小 ' + stE.min + ' 终 ' + stE.last + ' · cc 最小 ' + stE2.min + ' 终 ' + stE2.last);
ok(shotE.favRead === 'NULL' && shotE.ccRead === 'NULL' && shotE.favWitness === 0 && shotE.ccWitness === 0 && shotE.dataState === 'ready', 'E0 现场成立：两格读空、大键证人为 0、而回填已落定（没任何证据说库里没有）', JSON.stringify(shotE));
ok(stE.valid > 0 && stE.min >= 6, 'E1 小收藏包的空读那一发没把库里 6 条顶成 1 条（红侧实测最小=1＝大键闸看不见的那一型）', 'min=' + stE.min);
ok(stE.last >= 7, 'E2 先去库里问一趟之后这一发仍落地（fav=' + stE.last + '；favPending→权威并集）', 'last=' + stE.last);
ok(stE2.valid > 0 && stE2.min >= 6, 'E3 小字卡库同一型：空读那一发没把库里 6 张顶成 1 张（红侧实测最小=1）', 'min=' + stE2.min);
ok(stE2.last >= 7, 'E4 问过库之后造句仍落地（cc=' + stE2.last + '）', 'last=' + stE2.last);

console.log('\n[C 旧契约不许动]');
await boot();
await seedViaStore([{ prefix: 'xy-home-v2:default', key: 'cc-groups', val: mkCc(300) }, { prefix: 'xy-home-v2:default', key: 'fav-msgs', val: mkFav(NFAV) }]);
const c1 = await p.evaluate(() => {
  const st = window.activeStore();
  const before = { cc: st.get('cc-groups') === null ? 'NULL' : 'HIT', fav: st.get('fav-msgs') === null ? 'NULL' : 'HIT' };
  const a = window.ccAppendCards('mjfree', '梦角自由造句', ['取证正常一句'], 'own');
  const b = window.addMyFavItem({ kind: 'msg', side: 'out', text: '取证正常收藏', ts: Date.now() + 7 });
  return { before, a, b };
});
await p.waitForTimeout(2500);
const c1lib = { cc: await libN(CCC), fav: await libN(FFF) };
ok(c1.before.cc === 'HIT' && c1.before.fav === 'HIT' && c1lib.cc === 301 && c1lib.fav === NFAV + 1, 'C1 读数正常时两条通路各照旧正好 +1（闸门不许把正常路径带偏）', JSON.stringify(c1) + ' lib=' + JSON.stringify(c1lib));
const c2 = await p.evaluate(() => {
  const st = window.activeStore();
  // 用户在看得见的列表上整包写空（批量管理「清空」那一发）＝合法语义，新闸不许挡
  const blocked = window.xyBigWriteHold ? window.xyBigWriteHold(st, 'fav-msgs') === true : false;
  if (!blocked) st.set('fav-msgs', '[]');
  return { blocked };
});
await p.waitForTimeout(1500);
ok(c2.blocked === false && (await libN(FFF)) === 0, 'C2 读数在场时整包写空照旧放行（两侧皆绿＝新闸不许挡用户亲手删）', JSON.stringify(c2) + ' lib=' + await libN(FFF));
const c3 = await p.evaluate(() => {
  const st = window.activeStore();
  st.set('cc-groups-off', '{}');
  return { read: st.get('cc-groups-off'), await: typeof st.awaitingBigKey === 'function' ? st.awaitingBigKey('cc-groups-off') : 'no-api' };
});
ok(c3.read !== null && (c3.await === false || c3.await === 'no-api'), 'C3 小键（LS 有副本）永远不拦', JSON.stringify(c3));
// C4/C5：一次真切后台——释放本身照旧发生（不许用「不再释放」修 bug），被放掉那一格当场问库、下一读自愈
await boot();
await seedViaStore([{ prefix: 'xy-home-v2:default', key: 'fav-msgs', val: mkFav(NFAV) }]);
await toBg();
const c4 = await p.evaluate(() => ({
  top: window.idbMemoStats ? window.idbMemoStats(400).top.filter((t) => /:fav-msgs$/.test(t.k)).map((t) => t.k.split(':').pop()) : [],
  diag: window.__xyBigReadDiag ? window.__xyBigReadDiag() : null,
  read0: (function () { const st = window.activeStore(); const v = st.get('fav-msgs'); return v === null ? 'NULL' : 'HIT'; })()
}));
await p.waitForTimeout(2500);
const c5 = await p.evaluate(() => { const st = window.activeStore(); return { healed: st.get('fav-msgs') !== null }; });
console.log('    C4/C5：' + JSON.stringify(c4) + ' → 自愈 ' + JSON.stringify(c5));
ok(c4.top.length === 0 && (c4.diag.blind + c4.diag.asked) >= 1, 'C4 切后台照旧按体积放掉大键内存副本＋登记进名册（#1195e/#1349a 一字未动＝iOS 卡顿那一批的回归防护）', JSON.stringify(c4));
ok(c4.read0 === 'NULL' && c5.healed === true, 'C5 被放掉那一格：读空当场问库、下一读自愈（#1349a 语义不动）', JSON.stringify(c4) + JSON.stringify(c5));
const c6 = ['js/personalize.js', 'js/chat-settings.js', 'js/group-chat.js'].reduce((s, f) => { try { return s + (readFileSync(join(root, f), 'utf8').split('xyBigWriteBlocked').length - 1); } catch (e) { return s; } }, 0);
ok(c6 >= 4, 'C6 #1342 那几本方案账的闸照旧接在原句柄上（本批没动它们）', 'hits=' + c6);

console.log('\n[S 逻辑锚（产物静态）]');
const srcOf = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch (e) { return ''; } };
const idbJs = srcOf('js/idb.js'), ccJs = srcOf('js/chatcard.js'), chatJs = srcOf('js/chat.js'), feedJs = srcOf('js/feed.js'), ctJs = srcOf('js/contacts.js');
const has = (s, n) => s.split(n).length - 1;
ok(has(idbJs, '_bigIdx[key] > LS_BIG_LIMIT && !bigHydAbsent[key]') === 1, 'S1 证人分支在产物里且唯一', has(idbJs, '_bigIdx[key] > LS_BIG_LIMIT && !bigHydAbsent[key]'));
ok(has(idbJs, 'window.xyBigWriteHold = function (store, key) {') === 1, 'S2 静默让路口在产物里且唯一', has(idbJs, 'window.xyBigWriteHold = function (store, key) {'));
ok(has(ctJs, 'awaitingBigKey(k) {') >= 1 && has(ctJs, 'awaitingBigKey') >= 3, 'S3 门面把数据层那句问话转出来（这一格由并行批 #1358 先落库，本批沿用＝旧契约在场，两侧皆绿）', JSON.stringify({ ns: has(ctJs, 'awaitingBigKey(k) {'), all: has(ctJs, 'awaitingBigKey') }));
ok(has(ccJs, "if (ccHold(store, 'cc-groups', window.activePrefix() + ':cc-groups')) return false;") === 1, 'S4 专属库页外直写接线', has(ccJs, "if (ccHold(store, 'cc-groups'"));
ok(has(ccJs, "if (ccHold(pubStore(), PUB_KEY, PUB_PREFIX + ':' + PUB_KEY)) return false;") === 1, 'S5 公用库页外直写接线', has(ccJs, 'if (ccHold(pubStore()'));
ok(has(ccJs, 'if (exists === false) { ccAuthMark(); saveGroupsNow(groups); return null; }') === 1, 'S6 营救路径认三态（null 不再当「库里没有」）', has(ccJs, 'if (exists === false) {'));
ok(has(ccJs, "if (window.xyBigWriteBlocked(curStore(), curKey(), '字卡库')) { ccDirty = true; return; }") === 1, 'S7 编辑树落盘过闸且保留重试（ccDirty 不许清掉）', has(ccJs, 'xyBigWriteBlocked(curStore()'));
ok(has(chatJs, "if (store.get('fav-msgs') === null || window.xyBigWriteHold(store, 'fav-msgs')) {") === 1, 'S8 saveFav 让路接线（认「这一发读空了没有」，不止「是不是大键」）', has(chatJs, "xyBigWriteHold(store, 'fav-msgs')"));
ok(has(idbJs, 'window.xyPackageEmptyRead = function (store, key) {') === 1, 'S11 空读问库那一句在产物里且唯一（小键型的总开关）', has(idbJs, 'window.xyPackageEmptyRead = function'));
ok(has(chatJs, 'setTimeout(favAskAuth, 1500);') === 1 && has(chatJs, "favPending[cid] = (list || []).slice(); } catch (e0) {}") === 1, 'S9 让路走已有 favPending 暂存并重新问权威', has(chatJs, 'setTimeout(favAskAuth, 1500);'));
ok(has(feedJs, "if (window.xyBigWriteHold(s, 'fav-msgs')) return;") === 1, 'S10 feed 那条跨模块直写静默让路', has(feedJs, "if (window.xyBigWriteHold(s, 'fav-msgs')) return;"));

console.log('\n[Z 全局]');
ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', errs.slice(0, 3).join(' | '));
console.log('\n结果：' + pass + ' 绿 / ' + fail + ' 红');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
