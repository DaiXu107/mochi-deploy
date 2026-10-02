// ===== 常驻回归：#1258「聊天背景图卡住没显示、退出重进就没了」（壁纸判据从一条 LS 小键换成三条独立证据）=====
// 报障：OPPO A5 Pro + Edge「聊天界面背景图一直卡没，退出重进背景图就没了」，用户明说其他机型同现。
// 根因（零机型／零 UA 分支——判据只有本机存储事实与内核回执三态）：#1218 的闸门 csBgExpectBg 只认
// active-id 这一条 localStorage 小键，而指针、图库清单、大键尺寸索引**全都落在 LS**；Edge/安卓的
// 「杀进程回滚 LS 提交」是已登记病灶（荣耀 200 Pro + Edge 同族），本机又实测 LS 撑到 542 键 ≈5.9MB
// （早越过 5MB 配额线）⇒ ①整批小键被回滚 ②配额满那次 setItem 根本没落进去 ③#1218 之前把「暂时读空」
// 当永久丢失时顺手删过指针——三种现场都「指针读空」。旧判据一读空就判「用户没设壁纸」：当场拆掉铺好的
// 壁纸层＋从此没人再去库里取回＝**图真没了，重开也没有**（原图一直好好在 IndexedDB，库里那份不受 LS
// 回滚影响）。改法＝S1 指针仍在清单里（原口径不动）｜S2 大键尺寸索引还记着 cs-bg（新增同步口
// window.idbBigIdxSize，零 IDB 往返）｜S3 两条都读空时不认死，按桌面各踢一趟按需取回，只有健康连接
// 确认 absent／用户亲手删除才允许拆层（旧写法每会话封顶两次＝第三次回到拆层那条路）。
// 桩的口径（为什么这样模拟算诚实）：gate 只把「回填那一轮」的读路（idbGet/idbGetMany）拦成空，IDB 里
// 一个字节都不动 ⇒ 真机上「挂起但数据还在」的形态；hyd='fail' 模拟内核读失败（问不出结果），此时任何
// 一侧都不得下「丢失」结论；LS 夹具直接写真实键名，__big-idx 的手工夹具另配一条「产品自己写的账同形」
// 对照（A2），保证旁证不是脚本一厢情愿。
// 断言（判别器＝同 tip 纯 HEAD 副本红侧）：
//   A0~A3 同步旁证出口在位；索引里记着那一行 → 零 IDB 往返读得出字节数；那本账与产品自己记的同形
//   B1~B5 图在库里、指针与索引都被回滚（清单/镜像还在）→ 自己读回来 + 铺层 + 指针就地重建 + 只踢一趟
//   C1~C4 只剩大键索引一条旁证（指针与清单双双读空）也认回来并铺层
//   D1~D4 对照：全新设备（库里真没有）不写假指针、层保持隐藏、只问一轮不空转
//   E1 判别器：问不出结果（内核读失败）也要恰好好奇一趟（红＝0 趟＝没人再去库里找；绿＝1 趟且六轮不连环空读）
//   E2~E3 对照：未裁决期间不动指针、零 JS 异常（谁都不许把「问不出」说成「丢了」）
//   F0~F3 对照：指针在位时按 #1218 老路径照常取回；用户亲手清除后保持隐藏、指针不重建（不把已删的图抢回来）
//   G1~G4 对照：正常设备（回填没挂起）壁纸照常铺上、一次库都不必多问——没把「按需取回」修成新的拆层
//   H1~H3 产物侧锚点：诊断大键候选清单补了 cs-bg／判据本体进了产物
// 用法：node build.mjs && node tools/verify-1258-chat-bg-witness.mjs
//       红绿对照：MOCHI_SERVE_ROOT=<纯 HEAD 产物目录> node tools/verify-1258-chat-bg-witness.mjs
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || process.env.SERVE_ROOT || here);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(root, normalize(p).replace(/^([/\\])+/, ''));
  try {
    if (!statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
console.log('serve root = ' + root);

const browser = await chromium.launch({ headless: true });
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}

const NS = 'xy-home-v2:default';
const CS_BG_FULL = 'data:image/jpeg;base64,' + 'B'.repeat(300000);
const IDX_KEY = 'xy-home-v2:__big-idx';

// 产物侧锚点：外置文件读 js/<f>，否则读 index.html
function artifactNeedle(needle, rel) {
  const cands = rel ? [join(root, 'js', rel), join(root, 'index.html')] : [join(root, 'index.html')];
  for (const f of cands) {
    try { if (readFileSync(f, 'utf8').includes(needle)) return true; } catch (e) {}
  }
  return false;
}

//  · gate  —— 把「回填那一轮」模拟成没送到（值仍在 IDB）
//  · hyd   —— 按需取回的内核回执：'real' 真读／'fail' 读失败（问不出结果）
//  · seeds —— 种进 IDB 的原图；桩等它落地才放行真读，避免「启动比写入快」的假绿
function install(opts) {
  const o = opts || {};
  window.__1258 = { gate: !!o.gate, hyd: o.hyd || 'real', t: {}, calls: {}, seed: Promise.resolve(true), seedDone: false };
  (o.targets || []).forEach(function (k) { window.__1258.t[String(k)] = true; });
  const isT = function (k) { return !!window.__1258.t[String(k)]; };
  const idbPut = function (k, v) {
    return new Promise((res, rej) => {
      let req; try { req = indexedDB.open('mochi-db', 1); } catch (e) { rej(e); return; }
      req.onupgradeneeded = function () {
        const db2 = req.result;
        if (!db2.objectStoreNames.contains('kv')) db2.createObjectStore('kv');
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(v, k);
          tx.oncomplete = () => { db.close(); res(true); };
          tx.onerror = () => { db.close(); rej(tx.error); };
        } catch (e) { db.close(); rej(e); }
      };
      req.onerror = () => rej(req.error);
    });
  };
  window.__1258.seed = Promise.all((o.seeds || []).map((s) => idbPut(s.k, s.v)))
    .then(() => { window.__1258.seedDone = true; return true; })
    .catch(() => { window.__1258.seedDone = true; return false; });
  (o.ls || []).forEach((p) => { try { localStorage.setItem(p.k, p.v); } catch (e) {} });
  const trap = function (name, make) {
    let real;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get() { return real ? make(real) : undefined; },
        set(v) { real = v; }
      });
    } catch (e) {}
  };
  const waitSeed = function (run) { return window.__1258.seedDone ? run() : window.__1258.seed.then(run); };
  trap('idbGet', function (real) {
    return function (k) {
      if (window.__1258.gate && isT(k)) return Promise.resolve(null); // 这一轮没送到（值还在库里）
      return real ? real.apply(null, arguments) : Promise.resolve(null);
    };
  });
  trap('idbGetMany', function (real) {
    return function (keys) {
      const args = arguments; // 内层回调的 arguments 是空的——不接住就把键名整包丢掉
      return waitSeed(function () {
        return Promise.resolve(real ? real.apply(null, args) : {}).then(function (map) {
          if (window.__1258.gate && map) (keys || []).forEach(function (k) { if (isT(k)) delete map[k]; });
          return map;
        });
      });
    };
  });
  trap('idbHydrateKey', function (real) {
    return function (k) {
      const args = arguments;
      return waitSeed(function () {
        if (isT(k)) {
          window.__1258.calls[k] = (window.__1258.calls[k] || 0) + 1;
          if (window.__1258.hyd === 'fail') return Promise.resolve(false); // 内核问不出结果
        }
        return real ? real.apply(null, args) : Promise.resolve(undefined);
      });
    };
  });
}

async function openApp(injectOpts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript('(' + install.toString() + ')(' + JSON.stringify(injectOpts || {}) + ');');
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String((e && e.message) || e).slice(0, 160)));
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  }).catch(() => {});
  await page.waitForFunction(() => !!window.__1258 && !!window.__1258.seedDone, null, { timeout: 15000 }).catch(() => {});
  return { ctx, page, jsErrors };
}
// 轮询到条件成立为止（红侧永远等不到，绿侧不该被慢机器误判）
async function until(page, fn, ms) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > (ms || 12000)) return null;
    await page.waitForTimeout(250);
  }
}
const nCalls = (page) => page.evaluate(() => {
  const c = (window.__1258 && window.__1258.calls) || {};
  return c['xy-home-v2:default:cs-bg'] || 0;
}).catch(() => -1);
const ptrOf = (page) => page.evaluate(() => {
  try { return localStorage.getItem('xy-home-v2:default:cs-bg-active-id') || ''; } catch (e) { return 'ERR'; }
});
const painted = (page) => page.evaluate(() => {
  try {
    const l = document.getElementById('cs-bg-layer');
    return !!(l && l.style.backgroundImage && l.style.backgroundImage.indexOf('url(') === 0 && l.style.display !== 'none');
  } catch (e) { return false; }
});
const storeLen = (page) => page.evaluate(() => {
  try { return String(window.xyStore('xy-home-v2:default').get('cs-bg') || '').length; } catch (e) { return -1; }
});

// ================= S0：数据层同步旁证出口 =================
{
  const { ctx, page, jsErrors } = await openApp({
    targets: [NS + ':cs-bg'],
    seeds: [{ k: NS + ':cs-bg', v: CS_BG_FULL }],
    ls: [{ k: IDX_KEY, v: JSON.stringify({ 'xy-home-v2:default:cs-bg': CS_BG_FULL.length }) }]
  });
  const R = await page.evaluate(async () => {
    const out = {};
    out.has = typeof window.idbBigIdxSize === 'function';
    if (!out.has) return out;
    out.wit = window.idbBigIdxSize('cs-bg');
    // 对照：产品自己记的账必须与夹具同形（set 记 → 读得到；remove 销 → undefined）
    const BIG = 'C'.repeat(300000);
    const st = window.xyStore('xy-home-v2:default');
    st.set('v1258-witness', BIG);
    out.wit2 = window.idbBigIdxSize('v1258-witness');
    st.remove('v1258-witness');
    out.wit3 = window.idbBigIdxSize('v1258-witness');
    out.wit4 = window.idbBigIdxSize('');
    return out;
  });
  ok(R.has === true, 'A0 大键尺寸索引同步查询口 window.idbBigIdxSize 在位（红＝判据只剩一条 LS 小键）', 'typeof=' + typeof R.has);
  ok(R.wit === CS_BG_FULL.length, 'A1 索引里记着 cs-bg → 零 IDB 往返读得出字节数（旁证的消费路口）', JSON.stringify({ wit: R.wit }));
  ok(R.wit2 === 300000 && R.wit3 === undefined, 'A2 旁证的账必须是产品自己那本（set 记账／remove 销账，与手工夹具同形；红＝出口没有，无从谈起）', JSON.stringify({ set: R.wit2, rm: R.wit3 }));
  ok(R.wit4 === undefined, 'A3 空键名不许读出一个数（守卫）', String(R.wit4));
  if (jsErrors.length) console.log('    （S0 环境噪声：页面异常 ' + jsErrors.length + ' 条，样例 ' + jsErrors[0] + '）');
  await ctx.close();
}

// ================= S1：核心症状——指针被 LS 回滚整批带走，清单与镜像还在，索引也没有 =================
{
  const { ctx, page, jsErrors } = await openApp({
    gate: true,
    targets: [NS + ':cs-bg'],
    seeds: [{ k: NS + ':cs-bg', v: CS_BG_FULL }],
    ls: [{ k: NS + ':cs-bg-glist', v: JSON.stringify(['z1']) }, { k: NS + ':cs-bg-item-z1', v: CS_BG_FULL }]
  });
  const back = await until(page, () => (window.xyStore ? String(window.xyStore('xy-home-v2:default').get('cs-bg') || '').length > 1000 : false), 14000);
  ok(!!back, 'B1 图在库里、指针与索引全读空 → 启动后自己把原图取回来（红＝白板到重开为止）', String(back));
  const paint = await until(page, async () => {
    try { if (window.applyChatSettings) window.applyChatSettings(); } catch (e) {}
    const l = document.getElementById('cs-bg-layer');
    return !!(l && l.style.backgroundImage && l.style.backgroundImage.indexOf('url(') === 0 && l.style.display !== 'none');
  }, 8000);
  ok(paint === true, 'B2 聊天壁纸层真的铺回去了（红＝「没设壁纸」那一刀仍在拆层）', String(paint));
  const ptr = await until(page, () => {
    try { return localStorage.getItem('xy-home-v2:default:cs-bg-active-id') || ''; } catch (e) { return ''; }
  }, 6000);
  ok(ptr === 'z1', 'B3 指针就地重建，且认出图库里内容相同的那张（红＝永远走空判，面板高亮/删除判定同时找不到）', JSON.stringify({ got: ptr }));
  const c = await nCalls(page);
  ok(c === 1, 'B4 这个桌面只踢一趟按需取回（红＝0 趟＝根本没人再去库里找）', 'calls=' + c);
  const len = await storeLen(page);
  ok(len > 1000, 'B5 取回来的正是库里那份原图（长度一致；红＝压根没读）', 'len=' + len);
  ok(jsErrors.length === 0, 'B6 对照：全程零 JS 异常', jsErrors[0] || '');
  await ctx.close();
}

// ================= S2：只剩大键索引一条旁证（指针与清单双双读空）=================
{
  const { ctx, page, jsErrors } = await openApp({
    gate: true,
    targets: [NS + ':cs-bg'],
    seeds: [{ k: NS + ':cs-bg', v: CS_BG_FULL }],
    ls: [{ k: IDX_KEY, v: JSON.stringify({ 'xy-home-v2:default:cs-bg': CS_BG_FULL.length }) }]
  });
  const paint = await until(page, async () => {
    try { if (window.applyChatSettings) window.applyChatSettings(); } catch (e) {}
    const l = document.getElementById('cs-bg-layer');
    return !!(l && l.style.backgroundImage && l.style.backgroundImage.indexOf('url(') === 0 && l.style.display !== 'none');
  }, 14000);
  ok(paint === true, 'C1 指针/清单都被回滚，只剩 __big-idx 那一行 → 照样认回壁纸并铺层（红＝一条小键读空就当用户没设）', String(paint));
  const c = await nCalls(page);
  ok(c === 1, 'C2 靠索引旁证的这一趟确实发生了（红＝0）', 'calls=' + c);
  const ptr = await ptrOf(page);
  ok(ptr.length > 0, 'C3 认不出图库对应张时也重建一个库侧锚点，别让下一轮又走空判', String(ptr));
  ok(jsErrors.length === 0, 'C4 对照：零 JS 异常', jsErrors[0] || '');
  await ctx.close();
}

// ================= S3：全新设备（库里真没有）——不许无中生有 =================
{
  const { ctx, page, jsErrors } = await openApp({ gate: true, targets: [NS + ':cs-bg'], seeds: [], ls: [] });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) { try { window.applyChatSettings(); } catch (e) {} } });
  await page.waitForTimeout(1200);
  const c = await nCalls(page);
  ok(c <= 1, 'D1 库里确认没有 → 只问一轮，之后 N 次 applySettings 不再空转（不拿「留层」当无限重试）', 'calls=' + c);
  const ptr = await ptrOf(page);
  ok(ptr === '', 'D2 全新设备不许写假指针（红＝留个锚点吓用户／绿＝absent 后不建）', String(ptr));
  const p = await painted(page);
  ok(p === false, 'D3 对照：没壁纸就没有壁纸层，页面照常（红绿都该绿＝闸门没把正常路径卡死）', String(p));
  ok(jsErrors.length === 0, 'D4 对照：零 JS 异常', jsErrors[0] || '');
  await ctx.close();
}

// ================= S4：问不出结果（内核读失败）⇒ 不宣布丢失、也不反复空转 =================
{
  const { ctx, page, jsErrors } = await openApp({
    gate: true,
    hyd: 'fail',
    targets: [NS + ':cs-bg'],
    seeds: [{ k: NS + ':cs-bg', v: CS_BG_FULL }],
    ls: []
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { for (let i = 0; i < 6; i++) { try { window.applyChatSettings(); } catch (e) {} } });
  await page.waitForTimeout(1200);
  const c = await nCalls(page);
  ok(c === 1, 'E1 未裁决那一轮只踢一趟按需取回（红＝0 趟＝没人再去库里找；绿＝1 趟且六轮不连环空读）', 'calls=' + c);
  const ptr = await ptrOf(page);
  ok(ptr === '', 'E2 对照：未裁决期间不动指针（既不重建也不销）', String(ptr));
  ok(jsErrors.length === 0, 'E3 对照：零 JS 异常', jsErrors[0] || '');
  await ctx.close();
}

// ================= S5：用户亲手清除＝当场认死，后续轮次不把刚删的图抢回来 =================
{
  const { ctx, page, jsErrors } = await openApp({
    gate: true,
    targets: [NS + ':cs-bg'],
    seeds: [{ k: NS + ':cs-bg', v: CS_BG_FULL }],
    ls: [{ k: NS + ':cs-bg-glist', v: JSON.stringify(['z1']) }, { k: NS + ':cs-bg-active-id', v: 'z1' }]
  });
  // 先让「指针还在」这条老路径把图铺回来（两侧都该成功），再演用户亲手清除
  const before = await until(page, async () => {
    try { if (window.applyChatSettings) window.applyChatSettings(); } catch (e) {}
    const l = document.getElementById('cs-bg-layer');
    return !!(l && l.style.backgroundImage && l.style.backgroundImage.indexOf('url(') === 0 && l.style.display !== 'none');
  }, 14000);
  ok(before === true, 'F0 前置：指针在位时壁纸按 #1218 老路径就该回来（两侧皆绿；不成立则本批断言全失真）', String(before));
  await page.evaluate(() => {
    try { const r = document.getElementById('cs-bg-remove'); if (r) r.click(); } catch (e) {}
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { for (let i = 0; i < 4; i++) { try { window.applyChatSettings(); } catch (e) {} } });
  await page.waitForTimeout(800);
  const p = await painted(page);
  ok(p === false, 'F1 用户亲手清除后壁纸保持隐藏、后续轮次不再问库把它抢回来（判据换成三条证据不许变成「删掉的图复活」）', String(p));
  const ptr = await ptrOf(page);
  ok(ptr === '', 'F2 清除后指针保持清除态（既不销错也不重建）', String(ptr));
  ok(jsErrors.length === 0, 'F3 对照：零 JS 异常', jsErrors[0] || '');
  await ctx.close();
}

// ================= S6：正常设备不受影响（回填没挂起）=================
{
  const { ctx, page, jsErrors } = await openApp({
    gate: false,
    targets: [NS + ':cs-bg'],
    seeds: [{ k: NS + ':cs-bg', v: CS_BG_FULL }],
    ls: [{ k: NS + ':cs-bg-glist', v: JSON.stringify(['z1']) }, { k: NS + ':cs-bg-active-id', v: 'z1' }]
  });
  const len = await until(page, () => String(window.xyStore('xy-home-v2:default').get('cs-bg') || '').length > 1000, 12000);
  ok(!!len, 'G1 对照：正常设备（回填正常送到）读得到壁纸，不需要走取回这条路', String(len));
  const p = await until(page, async () => {
    try { if (window.applyChatSettings) window.applyChatSettings(); } catch (e) {}
    const l = document.getElementById('cs-bg-layer');
    return !!(l && l.style.backgroundImage && l.style.backgroundImage.indexOf('url(') === 0 && l.style.display !== 'none');
  }, 8000);
  ok(p === true, 'G2 对照：正常设备的壁纸层照常铺满（红绿都该绿＝没把「按需取回」修成新的拆层）', String(p));
  const c = await nCalls(page);
  ok(c === 0, 'G3 对照：正常设备一次库都不必多问（零额外 IDB 往返）', 'calls=' + c);
  ok(jsErrors.length === 0, 'G4 对照：零 JS 异常', jsErrors[0] || '');
  await ctx.close();
}

// ================= 产物侧锚点 =================
ok(artifactNeedle('if (/:(cs-bg)$/.test(k)) return true;', null),
  'H1 产物里诊断大键候选清单含聊天背景（删＝下次「背景图没了」的报障单看不见最该看的那一行）');
ok(artifactNeedle('if (csBgIdxWitness()) return true;', 'chat-settings.js'),
  'H2 产物里判据第二条（索引旁证）在位（删回只看指针＝本批症状原样复发）');
ok(artifactNeedle('window.idbBigIdxSize = function (relKey) {', 'idb.js'),
  'H3 产物里同步旁证出口在位（与 H2 同一批代码）');

console.log('\n合计 ' + (pass + fail) + ' 项：通过 ' + pass + '，失败 ' + fail);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
