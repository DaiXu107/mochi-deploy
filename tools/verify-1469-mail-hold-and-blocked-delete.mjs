// ===== 常驻回归脚本 #1469：信箱「读不全窗口」里新写的信要落得了盘，删除/清空要当场按住 =====
// 用法：node tools/verify-1469-mail-hold-and-blocked-delete.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 来龙（#1442 的第二批，作者 2026-09-30 选定口径＝「只保新写的信，删除/清空按住并提示」）
//   #1442 把「读不全就不许整包写回」立住之后，剩两条尾巴：
//   ① 被挡下的那一发只活在内存 mailPending——快照是剥图文本版、且只在主键读空那一读才被兜，而报障机
//     （小米 14U／Edge 153，LS 整域被同账号兄弟站点吃满：192 键≈10.0 MB、本项目只剩 1 键）上一次页面
//     被系统回收，那一封信就又没了＝用户口径「写了，回头又不见了」。
//   ② 删除与清空在那一窗口里照旧执行：拿一页残缺列表整包写回＝把库里那些没读到的信「删」没了；反过来
//     只把这一封从暂存里摘掉，又会在库里那本读回来后复活。两种都不是用户想要的「删掉了」。
//   收口口径（作者选定）＝**只保新写的信**：暂存单独一本旁路账（每联系人一份，走 xyStore 句柄＝内存＋LS＋
//   IndexedDB），任何一次权威整包落盘即销账；删除单封／清空信箱在读数残缺时当场按住，说站内那句
//   「这次没读全（存储正忙）：等几秒再点一次即可，不需要重新设置」（#1342i 那一句，判据与文案都只留一份，
//   为此给数据层那句加可选 forced 位把信箱自己那枚「读到写失败留下的旧账」残缺位递进去）。
//   零机型／零 UA 分支：只问「这一格此刻交不交得出权威读数」。
//
// 断言（两侧同一把尺串行跑；纯 HEAD 侧应当红的＝A1/A2/A3/A4/C1/C2 与 S1~S7，D5/D6 属搬迁来的回归网＝两侧同绿）：
//   A 组 暂存活过页面回收：A0 读空这一发成立／A1【症状本体】那一封进旁路账（键真在库里）／
//     A2 重开之后屏上仍看得见那一封／A3 权威并回后库里＝旧 20＋新 1 且旁路账已销账／A4 再重开一次仍在
//   B 组 不膨胀不串桌面：B1 三条后台通路让路那一班不写旁路账／B2 切到别的桌面看不到本桌面的暂存，
//     切回来那一封还在
//   C 组 删除/清空按住：C1 读空窗口点「删除这封信」→ 屏上有那句提示、库里那一本一封不少、确认框没弹／
//     C2 读空窗口点「清空信箱」同一条／C3 整包读回来后删除照旧当场生效（不许永久删不掉）
//   D 组 旧契约不许动：D1 健康读数下寄信合并／D2 健康读数下寄信不产生旁路账（不留残渣）／D3 删除照旧当场落库／
//     D4 用户删掉的信重开不复活（销账真生效）／D5 健康读数下「清空信箱」真落空＋D5b 旁路账一并销账＋
//     D6 重开仍空态（这三条是 #1442 尺子丁6 的复活闸搬过来的：那一场的现场从 #1469 起属于「读不全⇒本就该
//     按住」，清空不许落地，复活闸只能在这里这种读数完整的现场量）
//   S 组 产物逻辑锚（含数据层那句的 forced 位与「文案只有一份」）；Z 全程零未捕获 JS 异常
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || process.env.MOCHI_SERVE_ROOT || here));
console.log('serve root = ' + root);
if (!existsSync(join(root, 'index.html'))) { console.error('✗ 被测根目录没有 index.html（喂错产物＝所有断言一起红）'); process.exit(2); }
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

const P1 = 'xy-home-v2:default';
const K1 = P1 + ':mail-letters';
const HOLD1 = P1 + ':mail-letters-hold';
const SNAP1 = P1 + ':mail-letters-snap';
const P2 = 'xy-home-v2:cprobe2';
const K2 = P2 + ':mail-letters';
const HOLD2 = P2 + ':mail-letters-hold';
// 20 封 ≈400KB：跨过 LS_BIG_LIMIT(200KB＝LS 不留副本) 与 MEMO_BG_DROP_BYTES(256KB＝切后台按体积放掉)
const mkLetters = (n, tag) => JSON.stringify(Array.from({ length: n }, (_, i) => ({
  id: tag + '_' + i, type: 'received', tt: '旧信' + i, read: true,
  content: '正文' + i + '|'.padEnd(20000, 'x'), tm: 1700000000000 + i * 1000
})));
function fault(o) {
  return { content: `(function(){
  window.__f1469 = { lsProbe: 'ok', filled: 0, err: {}, arm: false, off: false };
  ${o.errMainKey ? `var ERRG = ${JSON.stringify(o.errMainKey)};
  var oGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (q) {
    if (window.__f1469.arm && !window.__f1469.off && typeof q === 'string' && ERRG[q] > 0) { ERRG[q]--; window.__f1469.err[q] = (window.__f1469.err[q] || 0) + 1;
      var r = { result: undefined, error: null };
      Object.defineProperty(r, 'onsuccess', { value: null, writable: true });
      Object.defineProperty(r, 'onerror', { value: null, writable: true });
      setTimeout(function () { try { if (r.onerror) r.onerror({ target: r }); } catch (e) {} }, 0);
      return r; }
    return oGet.apply(this, arguments);
  };` : ''}
  ${o.lsDead ? `try {
    var del = function () { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('xy-home-v2') === 0) { try { localStorage.removeItem(k); } catch (e) {} } }); };
    del();
    var fill = function (size, tag) { for (var i = 0; i < 3000; i++) { try { localStorage.setItem('ml2_lf_' + tag + '_' + i, 'x'.repeat(size)); window.__f1469.filled++; } catch (e) { return; } } };
    fill(1024 * 1024, 'a'); fill(200 * 1024, 'b'); fill(16 * 1024, 'c'); fill(1024, 'd'); fill(64, 'e'); fill(8, 'f');
    del();
    try { localStorage.setItem('__probe1469', 'x'.repeat(1024)); } catch (e) { window.__f1469.lsProbe = (e && e.name) || 'throw'; }
    try { localStorage.removeItem('__probe1469'); } catch (e) {}
  } catch (e) { window.__f1469.lsProbe = 'fill-failed:' + e; }` : ''}
})();` };
}
const browser = await chromium.launch({ headless: true });
let page, ctx;
const enter = async () => {
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const s = document.querySelector('.splash'); if (s) s.remove();
    document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
  });
  await page.waitForTimeout(400);
};
async function newCtx(o) {
  ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  page.__errs = [];
  page.on('pageerror', (e) => page.__errs.push(String(e.message).slice(0, 160)));
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter();
  await page.addInitScript(fault(Object.assign({ lsDead: true }, o || {})));
  return page;
}
// 尺子自己的库读要放行（注入的故障认 __f1469.off）——否则量具探针会把故障预算吃光，
// 把「库里明明完好」读成「读不出」＝自造假红（verify-1309 同条教训）
const rawGet = (k) => page.evaluate((key) => new Promise((res) => {
  if (window.__f1469) window.__f1469.off = true;
  const fin = (v) => { if (window.__f1469) window.__f1469.off = false; res(v); };
  const rq = indexedDB.open('mochi-db', 1);
  rq.onsuccess = () => {
    const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get(key);
    g.onsuccess = () => { try { rq.result.close(); } catch (e) {} fin(g.result === undefined ? null : String(g.result)); };
    g.onerror = () => { try { rq.result.close(); } catch (e) {} fin('ERR'); };
  };
  rq.onerror = () => fin('ERR');
}), k);
const idsOf = (raw) => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map((x) => x && x.id) : []; } catch (e) { return ['(坏值)']; } };
const nOf = (raw) => (raw === null ? 0 : raw === 'ERR' ? -9 : idsOf(raw).length);
const keep = (arr, pre, n) => arr.filter((x) => String(x).indexOf(pre + '_') === 0).length >= n;
const waitLib = async (k, want, ms) => {
  const t0 = Date.now(); let last = -9;
  while (Date.now() - t0 < (ms || 30000)) { last = nOf(await rawGet(k)); if (last === want) return last; await page.waitForTimeout(400); }
  return last;
};
const goHidden = () => page.evaluate(() => new Promise((res) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  setTimeout(() => res(1), 700);
}));
const waitReady = async (extra) => {
  await page.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(extra === undefined ? 4000 : extra);
};
// 读空读数：只问 awaitingBigKey——它只读四格证据不踢取回；xyStore.get 与 xyBigWriteHold 都会当场
// 请一次库（#1349a／#1361b），量具用了它们＝下一动作落在健康读数上＝C 组会红成「修好了却没按住」的假象（踩过）
const blind1 = () => page.evaluate(() => ({
  await1: window.activeStore().awaitingBigKey('mail-letters'),
  f: (window.__f1469 || {}).lsProbe, filled: (window.__f1469 || {}).filled
}));
const screenIds = () => page.evaluate(() => {
  const el = document.getElementById('mail-in-list');
  return el ? Array.from(el.querySelectorAll('.mail-item')).map((n) => n.dataset.id) : ['(无 #mail-in-list)'];
});
const toastNow = () => page.evaluate(() => { const t = document.getElementById('cc-toast'); return t ? String(t.textContent || '') : '(无 #cc-toast)'; });
const clearToast = () => page.evaluate(() => { const t = document.getElementById('cc-toast'); if (t) { t.textContent = ''; t.className = 'cc-toast'; } });
// 弹窗可见性只看 hidden 属性不可靠（#modal-mask 常态是 hidden=false 而靠 CSS 收放）——
// 判「确认框弹没弹」认计算样式＋框里那句确认文案在不在
const confirmUp = (src) => page.evaluate((s) => {
  const m = document.getElementById('modal-mask');
  if (!m) return false;
  const cs = getComputedStyle(m);
  if (m.hidden === true || cs.display === 'none' || cs.visibility === 'hidden') return false;
  return s ? new RegExp(s).test(String(m.textContent || '')) : true;
}, src || '');
const modalOk = () => page.evaluate(() => { const b = document.getElementById('modal-ok'); if (!b) return 0; b.click(); return 1; });
// 寄信：不先 openMailPage（那一发 render→load→get 会把被测量踢回来）——写信页节点本就在 DOM 里
const sendCold = (text) => page.evaluate((t) => {
  const i = document.getElementById('mail-input'); if (!i) return 'no-input';
  i.value = t; if (i.__ceBox) i.__ceBox.textContent = t;
  const b = document.getElementById('mail-send'); if (!b) return 'no-send';
  b.click(); return 'ok';
}, text);
const seedAll = async (opts) => {
  await page.evaluate((o) => {
    window.xyStore('xy-home-v2').set('contacts', o.contacts);
    window.xyStore('xy-home-v2').set('active-contact', 'default');
    for (let i = 0; i < 6; i++) window.xyStore('xy-home-v2').set('aafill-' + i, 'F' + i + '|'.padEnd(2 * 1024 * 1024, 'y'));
    o.mail.forEach((m) => window.xyStore(m.p).set('mail-letters', m.r));
    (o.cfg || []).forEach((c) => {
      const s = window.xyStore(c.p);
      s.set('reply-ml-write-en', c.en ? '1' : '0'); s.set('reply-ml-write-prob', '100');
      s.set('reply-ml-write-min', '1'); s.set('reply-ml-write-max', '2'); s.set('reply-ml-write-daily-max', '9');
      s.set('mail-letter-last', '0'); s.set('mail-letter-next', '0');
      s.set('reply-ml-fish-week-en', '0'); // 关掉每周摸鱼小结：它由 fishWeekEn 管，与 writeEn 无关，不关就会自己往库里加一封把计数搅浑
    });
  }, opts);
  await page.waitForTimeout(3500);
};
const CT2 = JSON.stringify([{ id: 'default', name: '煜' }, { id: 'cprobe2', name: '二探' }]);

// ============ A 组：那一封要活过页面回收 ============
console.log('\n== A 组：读不全窗口里寄出的那一封 ==');
{
  // 注入「主键那一发读不回来」（X5／雨见那批 IDB 事务挂起的真实形态，#1309/#1358 都点名过）：
  // 这样那一封要活下来只剩一条路＝当场落到旁路账；靠「问库把整包并回来」那条路被堵死，
  // 两侧对照才量得出本批到底加了什么（不注入的话纯 HEAD 侧也能在 4 秒内并回去＝假绿）。
  await newCtx({ errMainKey: { 'xy-home-v2:default:mail-letters': 10 } });
  await seedAll({ contacts: CT2, mail: [{ p: P1, r: mkLetters(20, 'seed') }, { p: P2, r: mkLetters(16, 'q2') }], cfg: [{ p: P1, en: false }, { p: P2, en: false }] });
  ok(await waitLib(K1, 20) === 20, 'F0 夹具真把 20 封灌进库里（红＝夹具坏）', '库里 ' + nOf(await rawGet(K1)));
  await page.reload({ waitUntil: 'load' });
  await enter();
  await waitReady();
  await goHidden();
  await page.evaluate(() => { if (window.__f1469) window.__f1469.arm = true; }); // 从这一刻起库那一发读不回来（靠并回活路被堵死）
  const b0 = await blind1();
  ok(b0.await1 === true && b0.f === 'QuotaExceededError', 'A0 这一发落在读空那一格（LS 又整域写不进；不进＝后面全是空跑）', JSON.stringify(b0));
  const sent = await sendCold('甲1取证信这一封');
  // 落得了盘有两种形态：还在旁路账里（等着并回）／已被自救那一趟并进主键并销了账。两种都算活着；
  // 只认其中一种会把「库忙、写入排队里」的正常态读成丢失（本机刚灌了 12MB 填充键，队列要跑几秒）
  let hold = null, libA = null, landed = '';
  for (let i = 0; i < 30; i++) {
    hold = await rawGet(HOLD1); libA = await rawGet(K1);
    if (/甲1取证信这一封/.test(String(hold))) { landed = 'hold'; break; }
    if (/甲1取证信这一封/.test(String(libA))) { landed = 'lib'; break; }
    await page.waitForTimeout(900);
  }
  ok(sent === 'ok' && !!landed, 'A1【症状本体】那一封当场就有一条落得了盘的路（旁路账或已并进主键，不再只躺内存／LS）', 'send=' + sent + ' 形态=' + landed + ' hold=' + String(hold).slice(0, 36) + ' 库里=' + nOf(libA));
  await page.reload({ waitUntil: 'load' });
  await enter();
  await waitReady(2500);
  await page.evaluate(() => {
    if (window.openMailPage) window.openMailPage();
    // 寄出的信进的是「寄出的信」那一栏（type:'sent'），只扫收信栏会把它读成丢了（踩过）
    const t = Array.from(document.querySelectorAll('#page-mail .fav-tab')).find((x) => x.dataset.mtab === 'out');
    if (t) t.click();
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  let hit = false, head = '';
  for (let i = 0; i < 18; i++) {
    const r = await page.evaluate((mark) => {
      const items = Array.from(document.querySelectorAll('#mail-in-list .mail-item, #mail-out-list .mail-item'));
      const all = items.map((n) => String(n.textContent || '').replace(/\s+/g, ' ')).join(' ⏷ ');
      return { n: items.length, has: all.indexOf(mark) >= 0, head: all.slice(0, 160) };
    }, '甲1取证信这一封');
    hit = r.has; head = JSON.stringify({ n: r.n, head: r.head });
    if (hit) break;
    await page.waitForTimeout(1200);
  }
  ok(hit, 'A2【症状本体】主键那一发读不回来的情况下重开，屏上仍看得见那一封（靠的就是旁路账）', head);
  // 让库那一发恢复，看并回与销账
  await page.evaluate(() => { if (window.__f1469) window.__f1469.off = true; });
  await page.waitForFunction(() => { const v = window.xyStore('xy-home-v2:default').get('mail-letters'); try { return JSON.parse(v).length >= 21; } catch (e) { return false; } }, null, { timeout: 40000 }).catch(() => {});
  const lib = await rawGet(K1), holdAfter = await rawGet(HOLD1);
  ok(nOf(lib) >= 21 && /甲1取证信这一封/.test(String(lib)) && keep(idsOf(lib), 'seed', 20), 'A3 权威并回后库里＝旧 20＋新 1（拒覆盖≠拒保存）', '库里 ' + nOf(lib) + ' 封');
  ok(holdAfter === null, 'A3b 并回即销账（旁路账不许长留，否则日后把用户删掉的信并回来）', 'hold=' + String(holdAfter).slice(0, 40));
  await page.reload({ waitUntil: 'load' });
  await enter();
  await waitReady(2500);
  const lib2 = await rawGet(K1);
  ok(/甲1取证信这一封/.test(String(lib2)) && keep(idsOf(lib2), 'seed', 20), 'A4 再重开一次那一封仍在（这一次靠的是库里那本，不是内存）', '库里 ' + nOf(lib2) + ' 封');
  ok(page.__errs.length === 0, 'Z1 A 场零未捕获 JS 异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ B 组：后台通路不写旁路账、暂存不串桌面 ============
console.log('\n== B 组：不膨胀 · 不串桌面 ==');
{
  await newCtx();
  await seedAll({ contacts: CT2, mail: [{ p: P1, r: mkLetters(20, 'seed') }, { p: P2, r: mkLetters(16, 'q2') }], cfg: [{ p: P1, en: true }, { p: P2, en: true }] });
  await page.reload({ waitUntil: 'load' });
  await enter();
  await waitReady();
  await page.waitForTimeout(5300); // 跨过 eagerCheck 的 5s 节流
  await goHidden();
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await page.waitForTimeout(2500);
  const h1 = await rawGet(HOLD1), h2 = await rawGet(HOLD2), l1 = await rawGet(K1), l2 = await rawGet(K2);
  ok(h1 === null && h2 === null, 'B1【症状本体】三条后台通路让路那一班不写旁路账（只拦不生成的那一发不该留残渣）', 'hold1=' + String(h1).slice(0, 30) + ' hold2=' + String(h2).slice(0, 30));
  ok(nOf(l1) >= 20 && keep(idsOf(l1), 'seed', 20) && nOf(l2) >= 16 && keep(idsOf(l2), 'q2', 16), 'B1b #1442 的战果不回归：两个桌面库里都一封不少', JSON.stringify({ l1: nOf(l1), l2: nOf(l2) }));
  const back = await page.evaluate(() => { try { return JSON.parse(window.xyStore('xy-home-v2:default').get('mail-letters')).length; } catch (e) { return -1; } });
  await page.evaluate(() => { window.__activeCid = 'cprobe2'; document.dispatchEvent(new Event('contact-switched')); });
  await page.waitForTimeout(3000);
  const other = await screenIds();
  ok(!String(other.join(',')).includes('甲') && nOf(await rawGet(K2)) >= 16, 'B2 切到另一桌面：看不见本桌面的暂存（账按联系人分键），库里那一本也安然', JSON.stringify(other.slice(0, 3)));
  await page.evaluate(() => { window.__activeCid = 'default'; document.dispatchEvent(new Event('contact-switched')); });
  await page.waitForTimeout(3500);
  const lib = await rawGet(K1);
  ok(nOf(lib) >= 20 && keep(idsOf(lib), 'seed', 20), 'B2b 切回来这一桌面的账还在（换桌面＝换那本暂存账，不许清空）', '库里 ' + nOf(lib) + ' 封，内存 ' + back + ' 封');
  ok(page.__errs.length === 0, 'Z2 B 场零未捕获 JS 异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ C 组：删除/清空在读不全时当场按住 ============
console.log('\n== C 组：读不全窗口的删除与清空 ==');
{
  // 注入点＝「先健康打开信件详情，再让库那一发读不回来」（X5／雨见那类事务挂起的真实形态）。
  // 不这么排的话：任何一次读数都会当场把库里那份要回来（#1349a 按需取回），删除就落在健康读数上
  // ——那本来就该放行，C1/C2 什么也量不到（这一版自己踩过）。举旗 arm 之后失败预算才开始计。
  await newCtx({ errMainKey: { 'xy-home-v2:default:mail-letters': 10 } });
  await seedAll({ contacts: CT2, mail: [{ p: P1, r: mkLetters(20, 'seed') }], cfg: [{ p: P1, en: false }] });
  await page.reload({ waitUntil: 'load' });
  await enter();
  await waitReady();
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(1400);
  const seen = await page.evaluate(() => document.querySelectorAll('#mail-in-list .mail-item').length);
  ok(seen >= 20, 'C0a 健康态下信箱本来就该看得见 20 封（后面「按住」的对照组）', '屏上 ' + seen + ' 条');
  await page.evaluate(() => { const it = document.querySelector('#mail-in-list .mail-item[data-id="seed_3"]'); if (it) it.click(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { if (window.__f1469) window.__f1469.arm = true; });
  await goHidden();
  const b0 = await page.evaluate(() => ({ blind: window.__xyBigReadDiag ? window.__xyBigReadDiag().unconfirmed : -1 }));
  ok((b0.blind || 0) >= 1, 'C0b 这一发落在读空那一格（读数只走 __xyBigReadDiag，不去踢按需取回）', JSON.stringify(b0));
  await clearToast();
  await page.evaluate(() => { const d = document.getElementById('mail-del-btn'); if (d) d.click(); });
  await page.waitForTimeout(1000);
  const t1 = await toastNow(), opened1 = await confirmUp('删除后将无法恢复'), l1 = await rawGet(K1);
  ok(/没读全/.test(t1) && opened1 === false, 'C1【症状本体】读不回来时点「删除这封信」＝当场按住＋那句提示（不弹确认框、不假装删了）', JSON.stringify({ t: t1.slice(0, 46), modal: opened1 }));
  ok(nOf(l1) >= 20 && keep(idsOf(l1), 'seed', 20), 'C1b 那一发没把残缺列表写回库里（20 封一封不少）', '库里 ' + nOf(l1) + ' 封');
  await page.evaluate(() => { const m = document.getElementById('tc-mask'); if (m) m.hidden = true; if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(900);
  await clearToast();
  await page.evaluate(() => { const c = document.getElementById('mail-clear'); if (c) c.click(); });
  await page.waitForTimeout(1000);
  const t2 = await toastNow(), opened2 = await confirmUp('清空所有信件');
  ok(/没读全/.test(t2) && opened2 === false, 'C2【症状本体】读不回来时点「清空信箱」同一条（残缺读数不许当「答案」去清空）', JSON.stringify({ t: t2.slice(0, 46), modal: opened2 }));
  ok(nOf(await rawGet(K1)) >= 20, 'C2b 库里那一本照样一封不少', '库里 ' + nOf(await rawGet(K1)) + ' 封');
  // 内核恢复（撤掉注入）＋回前台：删除照旧当场生效——「按住」是等一下，不是永久删不掉
  await page.evaluate(() => { if (window.__f1469) { window.__f1469.off = true; window.__f1469.arm = false; } });
  await page.evaluate(() => new Promise((res) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    setTimeout(() => res(1), 600);
  }));
  const before = nOf(await rawGet(K1));
  let deleted = false, tries = 0, lastToast = '', modalSeen = false;
  for (let i = 0; i < 6 && !deleted; i++) {
    tries++;
    await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
    await page.waitForTimeout(900);
    await page.evaluate(() => { const it = document.querySelector('#mail-in-list .mail-item[data-id="seed_3"]'); if (it) it.click(); });
    await page.waitForTimeout(900);
    await clearToast();
    await page.evaluate(() => { const d = document.getElementById('mail-del-btn'); if (d) d.click(); });
    await page.waitForTimeout(800);
    modalSeen = await confirmUp('删除后将无法恢复');
    lastToast = await toastNow();
    if (modalSeen) await modalOk();
    for (let j = 0; j < 8; j++) {
      if (nOf(await rawGet(K1)) === before - 1) { deleted = true; break; }
      await page.waitForTimeout(800);
    }
    if (!deleted) await page.waitForTimeout(2500);
  }
  ok(deleted, 'C3【症状本体】读数落定之后删除照旧当场生效（按住是等一下，不是把删除永久挡死）', JSON.stringify({ tries, before, after: nOf(await rawGet(K1)), modalSeen, toast: lastToast.slice(0, 40) }));
  await page.reload({ waitUntil: 'load' });
  await enter();
  await waitReady(3000);
  const after = await rawGet(K1);
  ok(idsOf(after).indexOf('seed_3') < 0 && keep(idsOf(after), 'seed', before - 2), 'C3b 重开之后那一封还是不在（删除真落了盘，不是只画在屏上）', '库里 ' + nOf(after) + ' 封');
  ok(page.__errs.length === 0, 'Z3 C 场零未捕获 JS 异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ D 组：健康读数一切照旧、删掉的不复活 ============
console.log('\n== D 组：旧契约与销账 ==');
{
  await newCtx();
  await seedAll({ contacts: CT2, mail: [{ p: P1, r: mkLetters(20, 'seed') }], cfg: [{ p: P1, en: false }] });
  await page.reload({ waitUntil: 'load' });
  await enter();
  await waitReady();
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(1200);
  await sendCold('丁组健康信');
  await page.waitForTimeout(2200);
  const lib = await rawGet(K1), hold = await rawGet(HOLD1);
  ok(nOf(lib) === 21 && /丁组健康信/.test(String(lib)), 'D1 健康读数下寄信＝正常的 20+1 合并（旁路账不许挡保存）', '库里 ' + nOf(lib) + ' 封');
  ok(hold === null, 'D2 健康读数下不产生旁路账（不留残渣）', 'hold=' + String(hold).slice(0, 40));
  await page.evaluate(() => { const it = document.querySelector('#mail-in-list .mail-item[data-id="seed_3"]'); if (it) it.click(); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { const d = document.getElementById('mail-del-btn'); if (d) d.click(); });
  await page.waitForTimeout(800);
  await modalOk();
  await page.waitForTimeout(2000);
  const del = await rawGet(K1);
  ok(nOf(del) === 20 && idsOf(del).indexOf('seed_3') < 0, 'D3 健康读数下删除照旧当场落库（少一封、那一封确实没了）', '库里 ' + nOf(del) + ' 封');
  await page.reload({ waitUntil: 'load' });
  await enter();
  await waitReady(3000);
  const re = await rawGet(K1);
  ok(idsOf(re).indexOf('seed_3') < 0 && /丁组健康信/.test(String(re)), 'D4【症状本体】重开之后被删的那一封不复活（＝暂存销账真生效，不是「删掉的又回来」）', 'ids 含 seed_3=' + (idsOf(re).indexOf('seed_3') >= 0));
  // D5/D6：读数完整那一型下「清空信箱」必须真落空、并且重开不复活——暂存与旁路账的销账若漏掉清空这一发，
  //   被删的那一本就会从旁路账／快照兜底那一路回来。这道闸原先长在 #1442 尺子丁6，那一场的现场从 #1469
  //   起属于「读不全⇒本来就该按住」，所以把它搬到清空真能落地的那一型上量（两侧都该绿＝回归网，非新契约）。
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(900);
  await clearToast();
  await page.evaluate(() => { const c = document.getElementById('mail-clear'); if (c) c.click(); });
  await page.waitForTimeout(900);
  const upD5 = await confirmUp('清空所有信件');
  if (upD5) await modalOk();
  await page.waitForTimeout(2400);
  const clD5 = await rawGet(K1), snapD5 = await rawGet(SNAP1), holdD5 = await rawGet(HOLD1);
  ok(upD5 === true && nOf(clD5) === 0, 'D5【症状本体】健康读数下点「清空信箱」＝弹确认并当场落库（被按住即红＝写闸挡成「删不掉」）', JSON.stringify({ modal: upD5, 库里: nOf(clD5) }));
  const scrD5 = await page.evaluate(() => document.querySelectorAll('#mail-in-list .mail-item, #mail-out-list .mail-item').length);
  ok(scrD5 === 0 && holdD5 === null, 'D5b 清空后屏上是空态、旁路账一并销账（留着它下一场就靠「手上没暂存而账上有一份」把已删的那本灌回来）', JSON.stringify({ 屏上: scrD5, hold: String(holdD5).slice(0, 30), snap: String(snapD5).slice(0, 20) }));
  await page.reload({ waitUntil: 'load' });
  await enter();
  await waitReady(3000);
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(1500);
  const clD6 = await rawGet(K1), scrD6 = await page.evaluate(() => document.querySelectorAll('#mail-in-list .mail-item, #mail-out-list .mail-item').length);
  ok(nOf(clD6) === 0 && scrD6 === 0, 'D6【用户看得见的那一本】重开之后清空仍是空态（迟到的库读与旁路账都不许把已删的那本带回眼前）', JSON.stringify({ 库里: nOf(clD6), 屏上: scrD6 }));
  ok(page.__errs.length === 0, 'Z4 D 场零未捕获 JS 异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ S 组：产物逻辑锚 ============
console.log('\n== S 组：产物逻辑锚 ==');
{
  const mailSrc = readFileSync(join(root, 'js/mail.js'), 'utf8');
  const idbSrc = readFileSync(join(root, 'js/idb.js'), 'utf8');
  ok(/const HOLD_KEY = 'mail-letters-hold';/.test(mailSrc), 'S1 旁路账有自己的一本键（不复用快照键，快照是剥图版）');
  ok(/mailHoldSave\(mailPending, cid\); \/\/ #1469a/.test(mailSrc) && /mailHoldSave\(mailPending, cid\); \/\/ #1469b/.test(mailSrc), 'S2 两支残缺分支（未就绪／读不全）都当场落账（漏一支＝那一型仍只活在内存）');
  ok(/mailHoldReconcile\(cid, list\); \/\/ #1469c/.test(mailSrc) && /mailHoldReconcile\(cid, merged\)/.test(mailSrc), 'S3 权威整包落盘处「对账后销账」（save 正常路＋库里那份合回来那一发）');
  ok(/if \(!cid && mailPending && mailPending\.length\) \{/.test(mailSrc), 'S4 屏上并入条件＝「手上有暂存」，不再附属于写闸（旧条件在两条放行路上会让暂存从屏上消失）');
  ok(/mailWriteBlockedNow\('这封信'\)/.test(mailSrc) && /mailWriteBlockedNow\('信箱'\)/.test(mailSrc), 'S5 删除与清空两条入口都过同一句判断');
  ok(/blocked = !mailWriteOpen\(\) \|\| mailReadIncomplete\(\) \|\| mailBlindRead\(\)/.test(mailSrc) && /xyBigWriteBlocked\(csFor\(\), KEY, what, true\)/.test(mailSrc), 'S6 挡不挡＝「库对这一格回没回话」为主（没回话才挡），提示与请库仍走数据层那一句；纯用 awaitingBigKey 会在 LS 坏机上把清空永久挡死');
  ok(/function xyBigWriteBlocked|xyBigWriteBlocked = function \(store, key, what, forced\)/.test(idbSrc) && /if \(!forced && \(!store \|\| typeof store\.awaitingBigKey/.test(idbSrc), 'S7 数据层那句收可选 forced 位，老调用方（不传第四参）行为逐位不变');
  const PHRASE = '这次没读全（存储正忙）：等几秒再点一次即可，不需要重新设置';
  const inIdb = idbSrc.split(PHRASE).length - 1, inMail = mailSrc.split(PHRASE).length - 1;
  ok(inIdb === 1 && inMail === 0, 'S8 那句提示全站只有一份（信箱侧只递残缺位、不抄第二份文案；#1417 那条「可能有信没显示出来」的横幅是另一句话，不算抄）', JSON.stringify({ inIdb, inMail }));
}

console.log('\n合计 通过=' + pass + ' 断言失败=' + fail);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
