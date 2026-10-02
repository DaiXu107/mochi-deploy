// ===== 常驻回归脚本 #1309：小米 14U + Edge 实报「信箱里的信都没了、朋友圈没了、收藏没了，一直会丢数据」
// 用法：node tools/verify-1309-ls-dead-single-copy.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-26 直派 + 同一台机 12:18 导出的诊断单）：
//   · localStorage 整域 192 键 ≈10.0MB，其中【非本项目】191 键 ≈10.0MB（最大一条 ml2_lf_ml2_global_cards=5.6MB）
//     ＝同源（GitHub Pages 同账号各项目共用一份 localStorage）另一个站点把配额吃满；
//   · 「localStorage 状态：写入失败(QuotaExceededError)」＋「LS 写探针：写入失败」＋「LS 内 chat-msgs 快照：无」
//     ⇒ 站内每一次 localStorage 写入都抛＝**LS 这一层在本机永久不存在**（剥图快照/兜底快照一份都没留下）；
//   · 于是全应用只剩 IndexedDB 一份拷贝，而 `xyStore.get` 的三路回落（内存 → LS → null）只剩内存一路：
//     回填没覆盖到的那一个键＝「读不到」＝「没有」，而页面对「没有」的处理是**照常整包写回**＝真丢。
//
// 「把没读到当成没有」这条判据数据层自己立过法（idbListKeys 注释：null 只能当未知、安排重试、
// 绝不落盘覆盖；#229 在 wrjMerge 同族上就是这么修的）。本脚本用同一把尺子量三件事：
//   ① 启动回填的清单那一发读失败 → 旧实现走 idbGetAllKeys()（兼容版：失败折叠成空数组）→
//     当成「库里没数据」→ 派发「数据已就绪」→ 全站空态文案从「还在读取」翻成「还没有」（说谎）；
//   ② 某一键的权威读失败 → mail 的 mailDbReady 在「读到 undefined」时也照样置真 → 空列表 →
//     用户随后一次再正常不过的寄信把 IDB 里全部旧信整包抹掉（＝报障本体，永久救不回）；
//   ③ 反过来不许修过头：LS 正常／健康无故障／用户真清空／全新空库 四种健康场景读数必须与旧版一致。
//
// 判据零机型／零 UA 分支：夹具真把 LS 填到连 8 字节都写不进（复现那台机的整域读数），再真让 IDB
// 那一发读【报错】（复现 Edge/小米系内核事务被中止：idbGet 走 onerror → undefined，与「键不存在」
// 不可分）。断言只取「库里还剩几条」「空态说了什么」「就绪信号翻没翻」三个事实，不取耗时。
//
// 断言：
//   A 组 信箱：A0 夹具真灌 5 封进 IDB／A0b 本机 LS 真死、站内一条不剩／A0c 被掐掉那一发真的发生了／
//     A1【症状本体】一次正常寄信不许把 IDB 里 5 封旧信整包抹掉／A1b 旧信第一封还在／
//     A2 权威未证实前空态不许陈述「还没有收到信」／A3 那一发过后旧信要真的可见（不止保住）／
//     A4 新寄的这一封自己必须落盘（拒覆盖 ≠ 拒保存）
//   B 组 回填总闸：B0 清单那一发真报错了／B1 读失败＝不许宣称「数据已就绪」／
//     B2 这期间空态尺子要指「还在读取」／B3 有界重试真把数据补齐／B3b 补齐后必须翻成就绪
//   D 组 收藏（**一次读故障都没有**，只是回填还没轮到这一键＝那台机每次开站的真实窗口）：
//     D0 夹具真把连接延后到 fav-msgs 还没 hydrate／D1【症状本体】一次收藏不许把库里 2 条旧收藏
//     整包抹掉／D2 新收藏自己必须落盘／D3 页面上读到的条数＝旧＋新（保住不等于看得见）
//   C 组 健康对照：C0 LS 死但 IDB 健康 → 回填照旧成功、旧信可见、寄信正常合并／
//     C1 LS 正常时清单读失败 → 数据照旧读得到（回落那一读路不变）／C2 主动清空必须真落空／
//     C3 全新空库第一封信直接落盘
//   Z1 全程零未捕获 JS 异常
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

const K_MAIL = 'xy-home-v2:default:mail-letters';
const K_FAV = 'xy-home-v2:default:fav-msgs';
const K_PROBE = 'xy-home-v2:default:zz1309-probe';
const PROBE = JSON.stringify({ v: 1309 });
const LETTERS = JSON.stringify([1, 2, 3, 4, 5].map((i) => ({ id: 'seed_' + i, type: 'received', tt: '旧信' + i, content: '正文' + i, tm: 1700000000000 + i * 1000, read: false })));

// ---- 故障注入（document_start；返回 {content} 字符串形态＝值在 Node 侧烘好）----
// lsDead：先删掉站内自己的 LS 键，再用【非本项目键名】把整域填到连 8 字节都写不进＝复现诊断单那一台机
// errGet：这些键的 IDB 单值读前 N 次直接报错（idbGet/idbGetMany/idbHydrateKey 都走 objectStore.get）
// errList：前 N 次 getAllKeys 报错（复现启动那一发清单读失败）
//   （计数器按「调用次数」掐＝夹具自己的 rawGet 探针会把预算吃掉：库里明明完好却报 -2 封，
//    红成"修复没生效"的假象。故注入认 __f1309.off＝夹具探针一律放行，掐的只是页面自己的读）
function fault(o) {
  const content = `(function(){
  var ERRG = ${JSON.stringify(o.errGet || {})};
  var LIST = ${o.errList || 0};
  window.__f1309 = { err: {}, listErr: 0, lsFilled: 0, lsProbe: 'ok', lsN: 0, off: false };
  function failReq() {
    var r = { result: undefined, error: null };
    Object.defineProperty(r, 'onsuccess', { value: null, writable: true });
    Object.defineProperty(r, 'onerror', { value: null, writable: true });
    setTimeout(function () { try { if (r.onerror) r.onerror({ target: r }); } catch (e) {} }, 0);
    return r;
  }
  var oGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (q) {
    if (!window.__f1309.off && typeof q === 'string' && ERRG[q] > 0) { ERRG[q]--; window.__f1309.err[q] = (window.__f1309.err[q] || 0) + 1; return failReq(); }
    return oGet.apply(this, arguments);
  };
  var oAll = IDBObjectStore.prototype.getAllKeys;
  IDBObjectStore.prototype.getAllKeys = function () {
    if (!window.__f1309.off && window.__f1309.listErr < LIST) { window.__f1309.listErr++; return failReq(); }
    return oAll.apply(this, arguments);
  };
  ${o.delayOpen ? `// delayOpen：第一次连 mochi-db 的 open 迟到 DELAY 毫秒才回话＝复现那台机的真实时序
  // （库里 chat-msgs 77MB、回填要跑好几秒才轮到 fav-msgs/mail-letters 这一键）＝【一次读故障都没有】
  // 也照样有「本地读空、权威还没到」这段窗口。只延第一次、且认库名（别误伤夹具自己的探针 open）。
  var DELAY = ${o.delayOpen};
  var oOpen = IDBFactory.prototype.open;
  window.__f1309.openDelayed = 0;
  IDBFactory.prototype.open = function () {
    var r = oOpen.apply(this, arguments);
    if (window.__f1309.openDelayed || arguments[0] !== 'mochi-db') { window.__f1309.openDelayed = 2; return r; }
    window.__f1309.openDelayed = 1;
    var w = {};
    ['error', 'result', 'readyState', 'transaction'].forEach(function (p) { Object.defineProperty(w, p, { get: function () { return r[p]; } }); });
    ['onerror', 'onupgradeneeded', 'onblocked'].forEach(function (p) { Object.defineProperty(w, p, { set: function (fn) { r[p] = fn; }, get: function () { return r[p]; } }); });
    Object.defineProperty(w, 'onsuccess', { set: function (fn) { setTimeout(function () { try { fn({ target: r }); } catch (e) { throw e; } }, DELAY); }, get: function () { return null; } });
    return w;
  };` : ''}
  ${o.lsDead ? `try {
    var del = function () { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('xy-home-v2') === 0) { try { localStorage.removeItem(k); } catch (e) {} } }); };
    del();
    var fill = function (size, tag) { for (var i = 0; i < 4000; i++) { try { localStorage.setItem('ml2_lf_' + tag + '_' + i, 'x'.repeat(size)); window.__f1309.lsFilled++; } catch (e) { return; } } };
    fill(200 * 1024, 'a'); fill(8 * 1024, 'b'); fill(256, 'c'); fill(8, 'd');
    del();
    fill(64, 'e');
    try { localStorage.setItem('__probe1309', '1'); } catch (e) { window.__f1309.lsProbe = (e && e.name) || 'throw'; }
    del();
    window.__f1309.lsN = localStorage.length;
  } catch (e) { window.__f1309.lsProbe = 'fill-failed:' + e; }` : ''}
})();`;
  return { content };
}

const browser = await chromium.launch({ headless: true });
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
  page.__errs = errs;
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await enter(page);
  return { ctx, page };
}
async function enter(page) {
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const s = document.querySelector('.splash'); if (s) s.remove();
    document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
  });
  await page.waitForTimeout(400);
}
const rawGet = (page, key) => page.evaluate((k) => new Promise((res) => {
  const f = window.__f1309; if (f) f.off = true;
  const done = (v) => { if (f) f.off = false; res(v); };
  const rq = indexedDB.open('mochi-db', 1);
  rq.onsuccess = () => {
    try {
      const t = rq.result.transaction('kv', 'readonly');
      const g = t.objectStore('kv').get(k);
      g.onsuccess = () => done(g.result === undefined ? null : g.result);
      g.onerror = () => done('ERR');
    } catch (e) { done('ERR'); }
  };
  rq.onerror = () => done('ERR');
}), key);
const parseLen = (raw) => { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.length : -1; } catch (e) { return -2; } };
const hasId = (raw, id) => { try { return JSON.parse(raw).some((x) => x && x.id === id); } catch (e) { return false; } };
const hasText = (raw, s) => typeof raw === 'string' && raw.indexOf(s) >= 0;
const seed = (page, k, raw) => page.evaluate(async (v) => { await window.idbSet(v.k, v.raw); }, { k, raw });
async function sendLetter(page, text) {
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = document.getElementById('mail-open-write'); if (b) b.click(); });
  await page.waitForTimeout(400);
  await page.evaluate((t) => {
    const i = document.getElementById('mail-input');
    if (!i) return;
    i.value = t;
    if (i.__ceBox) i.__ceBox.textContent = t;
  }, text);
  await page.evaluate(() => { const b = document.getElementById('mail-send'); if (b) b.click(); });
  await page.waitForTimeout(1500);
}
// 列表尺子按 data-id 取（信件行渲染的是 content 预览＋「来自 TA」标题，tt 字段根本不上屏；
// 用正文文案匹配＝永远红，红成"修复没生效"）
const mailList = (page) => page.evaluate(() => {
  const el = document.getElementById('mail-in-list');
  if (!el) return { ids: [], text: '(无 #mail-in-list 节点)'};
  return {
    ids: Array.from(el.querySelectorAll('.mail-item')).map((n) => n.dataset.id),
    text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 60),
  };
});
const openMail = async (page) => {
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(700);
};
const readState = (page, key) => page.evaluate((k) => {
  let probe = 'ok';
  try { localStorage.setItem('__t1309', '1'); localStorage.removeItem('__t1309'); } catch (e) { probe = (e && e.name) || 'throw'; }
  let mine = 0, all = 0;
  try { Object.keys(localStorage).forEach((x) => { all++; if (x.indexOf('xy-home-v2') === 0) mine++; }); } catch (e) {}
  return {
    probe, all, mine, f1309: window.__f1309 || null,
    ready: window.__mochiDataReady === true,
    pending: !!(window.mochiDataPending && window.mochiDataPending()),
    state: window.mochiDataState ? window.mochiDataState() : '(无)',
    mem: window.xyStore ? window.xyStore('xy-home-v2:default').get('mail-letters') : null,
    // B3 的尺子：只有启动回填会碰这条探针键（mail 自己有权威读＋store.set，用它测补齐＝自读自写，假绿）
    pk: window.xyStore ? window.xyStore('xy-home-v2:default').get('zz1309-probe') : null,
    deferred: (window.__xyIdbDeferredKeys || []).indexOf(k) >= 0,
  };
}, key);

// ============ A 组：LS 本机永久失效 × 信箱权威那一发读失败 ============
console.log('\n== A 组：信箱（报障头条）==');
{
  const { ctx, page } = await newPage();
  await seed(page, K_MAIL, LETTERS);
  ok(parseLen(await rawGet(page, K_MAIL)) === 5, 'A0 夹具真把 5 封旧信灌进 IndexedDB（红＝夹具坏，不是产品的锅）');
  await page.addInitScript(fault({ lsDead: true, errGet: { [K_MAIL]: 4 } }));
  await page.reload({ waitUntil: 'load' });
  await enter(page);
  const st = await readState(page, K_MAIL);
  ok(st.probe === 'QuotaExceededError' && st.mine === 0 && st.f1309 && st.f1309.lsFilled > 20,
    'A0b 本机 LS 真死、站内一条都没留下（复现诊断单：整域 192 键≈10MB 全是别的站点）', JSON.stringify({ p: st.probe, all: st.all, mine: st.mine, filled: st.f1309 && st.f1309.lsFilled }));
  ok((st.f1309.err[K_MAIL] || 0) >= 1, 'A0c 被掐掉的那一发权威读真的发生了（红＝A1 是空跑）', 'err=' + (st.f1309.err[K_MAIL] || 0));
  await openMail(page);
  const before = await mailList(page);
  ok(before.text.indexOf('还没有收到信') < 0, 'A2 权威未证实前空态不许陈述「还没有收到信」', JSON.stringify(before));
  await sendLetter(page, '这是新寄的一封');
  const after = await rawGet(page, K_MAIL);
  ok(parseLen(after) >= 5, 'A1【症状本体】一次正常寄信不许把 IDB 里 5 封旧信整包抹掉', '现在库里 ' + parseLen(after) + ' 封；原始值 ' + String(after).slice(0, 60));
  ok(hasId(after, 'seed_1'), 'A1b 旧信第一封确实还在库里（丢了就永久救不回来）');
  await page.waitForTimeout(10000);
  const l2 = await mailList(page);
  ok(l2.ids.filter((x) => x.indexOf('seed_') === 0).length === 5, 'A3 那一发过后旧信要真的可见（只保住不丢还不够）', JSON.stringify(l2));
  const fin = await rawGet(page, K_MAIL);
  ok(hasId(fin, 'seed_1') && parseLen(fin) >= 6, 'A4 重试取回之后，新寄的那一封与 5 封旧信必须都在库里（拒覆盖≠拒保存）', '库里 ' + parseLen(fin) + ' 封；原始值 ' + String(fin).slice(0, 60));
  ok(page.__errs.length === 0, 'Z1a 全程零未捕获异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ B 组：启动回填的清单那一发读失败 ============
console.log('\n== B 组：回填的「就绪」信号（全站空态文案唯一的尺子）==');
{
  const { ctx, page } = await newPage();
  await seed(page, K_MAIL, LETTERS);
  await seed(page, K_FAV, JSON.stringify([{ id: 'f1', by: 'me', text: '旧收藏1', ts: 1700000000001 }]));
  await seed(page, K_PROBE, PROBE);
  await page.addInitScript(fault({ lsDead: true, errList: 1 }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const b1 = await readState(page, K_MAIL);
  ok(b1.f1309.listErr >= 1, 'B0 清单那一发真的报错了（红＝夹具坏）', JSON.stringify(b1).slice(0, 100));
  // 只打印不断言：报错若被别人的 getAllKeys 吃掉，B3 在旧版就会一起变绿（假绿自证在这条链上）
  console.log('  · B0b 现场：探针键 pk=' + String(b1.pk).slice(0, 24) + ' ready=' + b1.ready + ' state=' + b1.state);
  ok(b1.ready === false, 'B1 清单读失败＝不许宣称「数据已就绪」（旧版折叠成空数组→当成库里没数据）', JSON.stringify({ ready: b1.ready, state: b1.state, mem: parseLen(b1.mem) }));
  ok(b1.pending === true, 'B2 这期间全站空态尺子要指「还在读取」而不是「还没有」', JSON.stringify({ state: b1.state }));
  await page.waitForTimeout(14000);
  const b3 = await readState(page, K_MAIL);
  ok(b3.pk === PROBE, 'B3 有界重试真把数据补齐（只有回填会碰的探针键读得回）', 'pk=' + String(b3.pk).slice(0, 40));
  ok(b3.ready === true, 'B3b 补齐之后就绪必须翻真（不许永久卡在读取中）', JSON.stringify({ ready: b3.ready, state: b3.state }));
  ok(page.__errs.length === 0, 'Z1b 全程零未捕获异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ D 组：一次读故障都没有，只是回填还没轮到这一键 ============
console.log('\n== D 组：收藏（LS 死＋回填在途＝那台机每次开站的真实窗口）==');
{
  const { ctx, page } = await newPage();
  const FAVS = JSON.stringify([
    { side: 'in', text: '旧收藏1', type: 'text', ts: 1700000000001, by: 'ta' },
    { side: 'out', text: '旧收藏2', type: 'text', ts: 1700000000002, by: 'me' },
  ]);
  await seed(page, K_FAV, FAVS);
  ok(hasText(await rawGet(page, K_FAV), '旧收藏2'), 'D0a 夹具真把 2 条旧收藏灌进 IndexedDB');
  await page.addInitScript(fault({ lsDead: true, delayOpen: 7000 }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const d0 = await page.evaluate(() => ({
    delayed: (window.__f1309 && window.__f1309.openDelayed) || 0,
    ready: window.__mochiDataReady === true,
    cur: window.xyStore ? window.xyStore('xy-home-v2:default').get('fav-msgs') : '(无 xyStore)',
    addFav: typeof window.addMyFavItem,
  }));
  ok(d0.delayed === 1 && d0.ready === false && d0.cur === null && d0.addFav === 'function',
    'D0 写这一笔的时刻：连接还堵着、回填没轮到 fav-msgs、本地读空（红＝窗口没造出来，D1 是空跑）', JSON.stringify(d0));
  // 走产品自己的收藏入口（chat.js 每个文件被 build 包成 IIFE，saveFav 不是全局）
  let dWriteErr = '';
  try { await page.evaluate(() => { window.addMyFavItem({ side: 'out', text: '新收藏一条', type: 'text', ts: Date.now() }); }); } catch (e) { dWriteErr = String(e.message).slice(0, 70); }
  ok(!dWriteErr, 'D0c 真收藏入口跑得起来（红＝这一组没写到数据，D1 不算数）', dWriteErr);
  await page.waitForTimeout(13000);
  const after = await rawGet(page, K_FAV);
  ok(hasText(after, '旧收藏1') && hasText(after, '旧收藏2'), 'D1【症状本体】回填没轮到时的一次收藏，不许把库里 2 条旧收藏整包抹掉', '库里 ' + parseLen(after) + ' 条；' + String(after).slice(0, 70));
  ok(hasText(after, '新收藏一条'), 'D2 新收藏自己必须落盘（拒覆盖≠拒保存）', String(after).slice(0, 70));
  const mem = await page.evaluate(() => { try { return JSON.parse(window.xyStore('xy-home-v2:default').get('fav-msgs') || '[]').length; } catch (e) { return -1; } });
  ok(mem === 3, 'D3 页面上读到的收藏数＝2 旧＋1 新（保住不等于看得见）', 'mem=' + mem);
  ok(page.__errs.length === 0, 'Z1d 全程零未捕获异常', page.__errs.join(' | '));
  await ctx.close();
}

// ============ C 组：健康场景不许修过头 ============
console.log('\n== C 组：健康对照 ==');
{
  // C0 LS 死透但 IDB 健康（不注入任何读故障）：回填照旧成功、旧信可见、寄信正常合并
  const { ctx, page } = await newPage();
  await seed(page, K_MAIL, LETTERS);
  await page.addInitScript(fault({ lsDead: true }));
  await page.reload({ waitUntil: 'load' });
  await enter(page);
  await page.waitForTimeout(3000);
  const c0 = await readState(page, K_MAIL);
  ok(parseLen(c0.mem) === 5 && c0.ready === true, 'C0 LS 死透＋IDB 健康 → 回填照旧成功（本批不许把它弄红）', JSON.stringify({ mem: parseLen(c0.mem), ready: c0.ready }));
  await openMail(page);
  const h0 = await mailList(page);
  ok(h0.ids.filter((x) => x.indexOf('seed_') === 0).length === 5, 'C0b 同一把尺子下旧信本来就该看得见（对照组：LS 死＋IDB 健康＝5 行都在）', JSON.stringify(h0));
  await sendLetter(page, '健康场景的新信');
  ok(parseLen(await rawGet(page, K_MAIL)) === 6, 'C0c 健康场景寄信＝正常的 5+1 合并');
  await ctx.close();
}
{
  // C1 LS 正常（这台机没用满）时同一发清单报错：老语义＝从 LS 读到值、页面照常
  const { ctx, page } = await newPage();
  await page.evaluate((v) => { window.xyStore('xy-home-v2:default').set('mail-letters', v.raw); }, { raw: LETTERS });
  await page.addInitScript(fault({ lsDead: false, errList: 1 }));
  await page.reload({ waitUntil: 'load' });
  await enter(page);
  const c1 = await readState(page, K_MAIL);
  ok(parseLen(c1.mem) === 5, 'C1 LS 正常时一次清单读失败不许把数据弄丢（LS 回落那一读路不变）', JSON.stringify({ mem: parseLen(c1.mem), ready: c1.ready }));
  await ctx.close();
}
{
  // C2 用户真清空信箱：清空必须落库（写闸不许挡成「删不掉」）
  const { ctx, page } = await newPage();
  await seed(page, K_MAIL, LETTERS);
  await page.addInitScript(fault({ lsDead: true }));
  await page.reload({ waitUntil: 'load' });
  await enter(page);
  await page.waitForTimeout(4000);
  const before = parseLen(await rawGet(page, K_MAIL));
  await page.evaluate(() => { if (window.openMailPage) window.openMailPage(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = document.getElementById('mail-clear'); if (b) b.click(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const b = document.getElementById('modal-ok'); if (b) b.click(); });
  await page.waitForTimeout(3000);
  const after = await rawGet(page, K_MAIL);
  ok(before === 5, 'C2a 清空前库里是 5 封', 'before=' + before);
  ok(parseLen(after) === 0, 'C2 用户主动清空必须真落空（写闸不许把删除挡成「删不掉」）', 'after=' + String(after).slice(0, 30));
  await ctx.close();
}
{
  // C3 全新空库（IDB 确无此键）：第一封信直接落盘，不等权威
  const { ctx, page } = await newPage();
  await page.addInitScript(fault({ lsDead: true }));
  await page.reload({ waitUntil: 'load' });
  await enter(page);
  await page.waitForTimeout(3000);
  const none = await rawGet(page, K_MAIL);
  await sendLetter(page, '新装的第一封');
  ok(none === null, 'C3a 这是全新空库（IDB 确无此键）', 'none=' + String(none).slice(0, 30));
  ok(parseLen(await rawGet(page, K_MAIL)) >= 1, 'C3 全新空库第一封信直接落盘（库里确无＝放行，别把新装用户挡在门外）');
  ok(page.__errs.length === 0, 'Z1c 全程零未捕获异常', page.__errs.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n结果：' + pass + ' 绿 / ' + fail + ' 红');
process.exit(0);
