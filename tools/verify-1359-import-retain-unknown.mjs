// ===== 常驻回归脚本 #1359：完整备份导入时，retain 那一发「读不出」绝不再当「库里没有」 =====
// 用法：node tools/verify-1359-import-retain-unknown.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-28 直派：「我的机型是小米MIX 4，用的是 edge 浏览器。一直在丢失字卡，表情包那些，
//   然后我最近存的表情包都没了，我直接导出一个聊天记录，然后导入数据后会自己消失。总是会丢失数据，高频丢失」；
//   随附 mochi-diag-2026-09-28-07-12-55…docx：Edge 153／standalone／LS 健康（849 键 ≈2.4MB、写探针正常、
//   非本项目 0 键）⇒ 这台机不是 #1358 那台「LS 整域被同源兄弟站点吃死」的机器；诊断里的关键三行＝
//   「大键读回：切后台放过 0 格 · 启动挂起未读回 31 格」＋「IDB 152 键 67.26MB（cc-groups-public 67.26MB）」
//   ＋「IndexedDB 大键明细：default:chat-msgs=292.2MB」＋「数据导入回执：(无——本机还没记录过数据导入动作)」）
//
// 根因（零机型／零 UA 分支＝只取「这一发内核回执了没有」）：
//   完整备份导入用 idbReplaceAll（单事务 clear + 批量 put）＝「备份里没有的键」会被删掉。#118 为此加了
//   retain 防线：列出当前库里有、备份里没有的键，读出值塞回写入对。#440 收的是「清单读不到＝未知→中止」。
//   但【值】那一发仍旧把「没读到」当「不需要保留」：idbGetMany 超时 resolve 的是「已回执的那部分」——
//   没答上来的键根本不在 map 里（源码自证：`const miss = list.filter(k => !(k in out))`），而
//   map[k]===undefined 才是「读到了、库里确实没这个键」。旧写法两样一律用 `map[k]` 判：
//     const v = map[k]; if (v !== undefined && v !== null) kept.push(...)
//   ⇒ 在这台「启动挂起 31 格、单键 67MB/292MB」的大库慢机上，几十 MB 的表情包／字卡／媒体池整批没回执
//   ＝按「无需保留」放行＝clear 把它们永久删掉。备份越不完整、库越大越必中＝用户口径
//   「导入数据后会自己消失」且「高频丢失」；而回执环里连一行 retain 都没有（＝红侧读数）。
//
// 收口（一件共用层，逐页零改动）：readRetainKeys 分批（8 键／趟）读回＋三态分类——
//   有回执且有力值＝保留；有回执但值空＝库里确实没有；不在 map 里＝单键补问一趟 idbGet(k, info)，
//   等待窗按 __big-idx 那份体积尺放大（idbBigSize 免读值，公式同 #716）；仍问不出＝未知，整次导入中止，
//   走 #440 既有回滚（原数据一字不动），并在回执环记 retain:unknown／retain:kept、把文案换成如实那一版。
//   「连问句都没有的口子」（无 idbListKeys/idbGetMany）同口径改判未知，不再按「无需保留」清库。
//
// 断言（45 条）：
//   A 组 本批新契约（红侧＝纯底本读数）：A0 真入口走到了导入确认／A0b 这一发跑到了终态（没跑到＝不算绿）／
//     A1 表情包库还在／A2 公用字卡库还在／A3 媒体池键还在／A4 中止那一发不许写 LS（不许「LS 新＋IDB 旧」混合态）／
//     A5 连备份自带键也没落（真·一字未动）／A6 文案如实说「没能读出来…原有数据一字未动」／
//     A7 回执环记下 retain:unknown（红侧逐字＝这一行根本没有）／A8 idbReplaceAll 调用数＝0（红侧逐字 calls=1）
//   B 组 别把闸变成「存不进去」＋旧契约不许动（每段都先钉「跑到终态」才读数）：B1 批量全回执＝导入照常完成且旧键保留／
//     B2 批量没回执但单键补问答得出来＝导入完成且那一格被保留（红侧逐字 emoji=false·clear次数=1）／
//     B2b 补问得到不许误报「已中止」／B3 读到了且库里真没有＝不算未知，照常放行（两侧皆绿＝没修过头）／
//     B4 清单读不到仍走 #440 那一格中止（两侧皆绿）／B5 备份自带键照常落地／B5b 完成那一发也有账
//   C 组 取证面：C1 聊天记录导入在回执环里留下一行 chat:go／C2·C2b 各桌面那一型（singleMsgs=null）记账且不抛（红侧＝用户明说导入过而【数据导入回执】全是「无」）
//   F 组 夹具诚实（两侧皆绿）：F1 idbGetMany 超时确实只回「已回执的部分」／F2 idbGet 超时确实置 info.ambiguous／
//     F3 数据层已有免读值的体积尺（本批放大等待窗用它，不新造判据）
//   B6 组 附议在飞那一发（#1360 第七型口径）：B6a 跑到终态／B6b 那一格被保留·其余照常（红侧被 clear）／
//     B6c 该格的 idbGet 次数＝0（不另起一整包重读；探针键用应用不认的键名，计数才归本批那一路）
//   S 组 产物静态锚 S1~S14　Z 组 三段各自零未捕获异常
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = resolve(normalize(process.argv[2] || process.env.SERVE_ROOT || here));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 被测产物（S 组锚点按被测根目录读，红侧自然缺）
const backup = readFileSync(join(root, 'js/data-backup.js'), 'utf8');
const idbSrc = readFileSync(join(root, 'js/idb.js'), 'utf8');

// ===== 夹具：库里三格「备份里没有、这一发读不出」的大键（表情包／公用字卡／媒体池） =====
const K_EMOJI = 'xy-home-v2:my-emoji-groups';        // chat.js #172/#281 那本表情包库的全局根键
const K_PUBCARD = 'xy-home-v2:cc-groups-public';      // 诊断里 67.26MB 那一格
const K_MEDIA = 'xy-home-v2:media:deadbeef01234567';  // 表情包图片本体（池键只认 IDB）
const BIG_VAL = (tag) => 'MOCHI1359SEEDED:' + tag + ':' + 'x'.repeat(300 * 1024); // >LS_BIG_LIMIT 200KB＝IDB-only
const SEEDED = [[K_EMOJI, 'emoji'], [K_PUBCARD, 'pubcard'], [K_MEDIA, 'media']];
// 一份「不含这三格」的完整备份（＝用户那份「只备份文字／旧机器」备份的形状：idb 段有键 ⇒ retain 必跑）
const BACKUP_JSON = JSON.stringify({
  version: '1.0', app: 'mochi-zika', exportTime: Date.now(),
  ls: { 'xy-home-v2:theme-mode': 'dark', 'xy-home-v2:1359-from-backup': 'from-backup' },
  idb: { 'xy-home-v2:default:chat-meta': JSON.stringify({ n: 1, t: Date.now(), b: 10 }) }
});
const K_PROBE = 'xy-home-v2:mochi1359-probe-key';   // 应用不认这把键——B6c 的 idbGet 计数才只归本批那一路
const CHAT_FILE_JSON = JSON.stringify({ app: 'mochi-zika-chat', version: '1.0', exportTime: 'x', msgs: [{ from: 'me', text: '1359 取证行', ts: Date.now() }] });
// C2 那一型＝「标准备份文件里带各桌面 chat-msgs」（singleMsgs 恒 null）：本批那行记账不兜 null 会把整个回调打死
const CHAT_DESK_JSON = JSON.stringify({ version: '1.0', app: 'mochi-zika', exportTime: Date.now(), ls: { 'xy-home-v2:theme-mode': 'light', 'xy-home-v2:default:chat-msgs': JSON.stringify([{ from: 'me', text: 'C2 各桌面那一型', ts: Date.now() }]) }, idb: {} });

async function boot() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const st = { jsErrors: [] };
  page.on('pageerror', (e) => st.jsErrors.push(String(e.message).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem('xy-home-v2:__last-backup-remind', String(Date.now())); } catch (e) {}
    try { localStorage.setItem('xy-home-v2:storage-guide-shown', '1250'); } catch (e) {}
    // #1250「存储修复引导」常驻弹窗会盖住「选择导入范围」（实测吃掉点按）——LS 旗标＋撕罩定时器，IDB 那份在页面就绪后补
    setInterval(function () {
      try {
        const t = String((document.getElementById('modal-title') || {}).textContent || '');
        if (t.indexOf('存储修复引导') > -1) {
          const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
          const c = document.getElementById('modal-cancel'); if (c && !c.hidden) c.click();
        }
      } catch (e) {}
    }, 400);
  });
  await page.goto(baseUrl + '/index.html');
  await page.waitForFunction(() => !!window.__mochiDataReady, null, { timeout: 25000 }).catch(() => {});
  await page.evaluate(() => {
    // #1250 引导弹层的门是「LS 初筛＋IDB 复核」两把尺子：init 脚本里 window.idbSet 还不存在（idb.js
    // 比它晚），那一层必须落在页面就绪之后——补不上时那张带输入框的「更新完成·存储修复引导」会
    // 盖住确认弹窗、吃掉点按（实测吃掉 toast/回执读数，别把它当成产品缺陷）
    try { if (window.idbSet) window.idbSet('xy-home-v2:storage-guide-shown', '1250'); } catch (e) {}
    const e = document.getElementById('splash-enter'); if (e && !e.hidden) e.click();
    const s = document.getElementById('splash'); if (s) { s.classList.add('hide'); s.hidden = true; s.style.display = 'none'; }
    const q = document.getElementById('qa-mask'); if (q) { q.style.setProperty('display', 'none', 'important'); q.hidden = true; }
  });
  await page.waitForTimeout(700);
  return { browser, page, st };
}
// 原生库直读直写（绕开被测页的任何缓存与仿真＝「库里到底还有没有」由内核说了算）
const rawSeed = (page, pairs) => page.evaluate((ps) => new Promise((res) => {
  const db = indexedDB.open('mochi-db');
  db.onupgradeneeded = () => {};
  db.onsuccess = () => {
    const tx = db.result.transaction('kv', 'readwrite');
    ps.forEach(([k, v]) => tx.objectStore('kv').put(v, k));
    tx.oncomplete = () => { db.result.close(); res(true); };
    tx.onerror = () => { db.result.close(); res(false); };
  };
  db.onerror = () => res(false);
}), pairs);
const rawHas = (page, key) => page.evaluate((k) => new Promise((res) => {
  const db = indexedDB.open('mochi-db');
  db.onsuccess = () => {
    const tx = db.result.transaction('kv', 'readonly');
    const rq = tx.objectStore('kv').get(k);
    rq.onsuccess = () => { const hit = rq.result !== undefined; db.result.close(); res(hit); };
    rq.onerror = () => { db.result.close(); res(false); };
  };
  db.onerror = () => res(false);
}), key);
// 内核回执仿真：批量那一发「没回执」＝慢键压根不进 map（与 idbGetMany 超时 resolve 部分结果同形）；
// 单键那一发由 failSingle 决定是「问不出」（info.ambiguous＋undefined，与 idbGet 超时同形）还是「答得出来」
const installSim = (page, slowKeys, failSingle) => page.evaluate(([ks, fs]) => {
  window.__simSlow = {}; ks.forEach((k) => { window.__simSlow[k] = true; });
  window.__simFailSingle = !!fs;
  try { localStorage.removeItem('mochi1359-spy-replace'); } catch (e) {}
  if (!window.__simInstalled) {
    const realMany = window.idbGetMany, realGet = window.idbGet, realReplace = window.idbReplaceAll;
    window.idbGetMany = function (keys) {
      const ask = (keys || []).filter((k) => !window.__simSlow[k]);
      return realMany.call(window, ask); // 慢键从不进 out ⇒ 调用方拿到的 map 里没有它
    };
    window.idbGet = function (key, info) {
      try { window.__simGetCalls = window.__simGetCalls || {}; window.__simGetCalls[key] = (window.__simGetCalls[key] || 0) + 1; } catch (e) {}
      if (window.__simSlow[key] && window.__simFailSingle) {
        if (info && typeof info === 'object') info.ambiguous = true;
        return Promise.resolve(undefined);
      }
      return realGet.apply(window, arguments);
    };
    // clear 那一发到底踩没踩——计数写进非 xy-home-v2: 前缀的键，扛得住导入自己刷页面
    window.idbReplaceAll = function (entries) {
      try {
        const n = (parseInt(localStorage.getItem('mochi1359-spy-replace') || '0', 10) || 0) + 1;
        localStorage.setItem('mochi1359-spy-replace', String(n));
      } catch (e) {}
      return realReplace.apply(window, arguments);
    };
    window.__simInstalled = true;
  }
}, [slowKeys, failSingle]);
const setFailSingle = (page, v) => page.evaluate((x) => { window.__simFailSingle = !!x; }, v);
// 走真入口：设置页「导入数据」→ 选择范围（完整备份）→ 投递夹具文件 → 覆盖确认点确定
async function runImport(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = (p.id !== 'page-setting'); });
    const g = document.getElementById('daily-greet'); if (g) { g.hidden = true; clearTimeout(g._timer); }
    try { document.querySelector('#set-tabs .them-tab[data-tab="basic"]').click(); } catch (e) {}
    const t = document.getElementById('cc-toast'); if (t) t.textContent = '';
  });
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const el = document.getElementById('row-import');
    if (!el) return null;
    let n = el; while (n && n !== document.body) { if (n.hidden) n.hidden = false; n = n.parentElement; }
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (!geo) return { err: 'no-row-import' };
  await page.mouse.click(geo.cx, geo.cy);
  // 范围弹窗是真入口的第一道闸：等它把标题画出来再定点，别按 600ms 赌时序（实测红侧就抖在这）
  await page.waitForFunction(() => String((document.getElementById('modal-title') || {}).textContent || '').indexOf('选择导入范围') === 0, null, { timeout: 12000 })
    .catch(() => {});
  const pick = await page.evaluate(() => {
    const s = document.getElementById('mochi-modal-pick');
    const b = s || document.getElementById('modal-ok');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (!pick) return { err: 'no-range-modal' };
  // 挂着的层如果不是范围弹窗（#1250 引导那张带输入框的常驻层会插进来吃掉点按）——撤掉再来一发，
  // 别把这一发的点按喂给错的层（红/绿都得是同一只手在按同一个钮）
  for (let t = 0; t < 2; t++) {
    const title = await page.evaluate(() => String((document.getElementById('modal-title') || {}).textContent || ''));
    if (title.indexOf('选择导入范围') === 0) break;
    await page.evaluate(() => {
      const c = document.getElementById('modal-cancel'); if (c && !c.hidden) c.click();
      const m = document.getElementById('modal-mask'); if (m) m.hidden = true;
    });
    await sleep(400);
    await page.mouse.click(geo.cx, geo.cy);
    await page.waitForFunction(() => String((document.getElementById('modal-title') || {}).textContent || '').indexOf('选择导入范围') === 0, null, { timeout: 9000 }).catch(() => {});
  }
  // 选图门那一族的补装有时赶不上第一发点按（#1323/#1348 同一条事实）——重投这一发而不放宽判据
  let chooser = null;
  for (let t = 0; t < 3 && !chooser; t++) {
    const spot = await page.evaluate(() => {
      const s = document.getElementById('mochi-modal-pick');
      const b = s || document.getElementById('modal-ok');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
    if (!spot) break;
    const fc = page.waitForEvent('filechooser', { timeout: 9000 }).catch(() => null);
    await page.mouse.click(spot.cx, spot.cy);
    chooser = await fc;
    if (!chooser) await sleep(500);
  }
  if (!chooser) {
    const why = await page.evaluate(() => String((document.getElementById('modal-title') || {}).textContent || '(无弹窗)').slice(0, 20));
    return { err: 'no-chooser@' + why };
  }
  await chooser.setFiles({ name: 'mochi数据备份_1359.json', mimeType: 'application/json', buffer: Buffer.from(BACKUP_JSON, 'utf8') });
  await page.waitForTimeout(1800);
  const preview = await page.evaluate(() => ({
    title: String((document.getElementById('modal-title') || {}).textContent || ''),
    hidden: !!(document.getElementById('modal-mask') || {}).hidden
  }));
  if (preview.title.indexOf('确定导入数据') !== 0) return { err: 'no-preview:' + preview.title };
  const o = await page.evaluate(() => {
    const b = document.getElementById('modal-ok');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  await page.mouse.click(o.cx, o.cy);
  return { ok: true };
}
const readToast = (page) => page.evaluate(() => String((document.getElementById('cc-toast') || {}).textContent || ''));
const readLog = (page) => page.evaluate(() => {
  try { return JSON.stringify(JSON.parse(localStorage.getItem('xy-home-v2:__import-log') || '[]').map((x) => x.w)); } catch (e) { return '[]'; }
});
// 终态信号：绿侧＝中止那一格的 retain:unknown/write:idb=fail（#1359h 之后环不再被导入自己抹掉）；
// 红侧＝clear 踩了（spy≥1）或备份自带键落地（flag）。读到这些之前不许判任何东西——
// 大键补问那一发的等待窗是按体积放大的，按固定 sleep 读数会把「还没判」读成「判对了」（假绿）
async function waitTerminal(page, budgetMs) {
  const t0 = Date.now();
  let last = {};
  while (Date.now() - t0 < (budgetMs || 60000)) {
    last = await page.evaluate(() => {
      const out = { log: '', spy: '0', flag: 'null' };
      try { out.log = String(localStorage.getItem('xy-home-v2:__import-log') || ''); } catch (e) {}
      try { out.spy = String(localStorage.getItem('mochi1359-spy-replace') || '0'); } catch (e) {}
      try { out.flag = String(localStorage.getItem('xy-home-v2:1359-from-backup')); } catch (e) {}
      return out;
    }).catch(() => ({ log: '', spy: '0', flag: 'null' }));
    if (/retain:unknown/.test(last.log) || /write:idb=fail/.test(last.log) || (parseInt(last.spy, 10) || 0) > 0 || last.flag === 'from-backup') {
      return { terminal: true, waited: Date.now() - t0, raw: last };
    }
    await sleep(400);
  }
  return { terminal: false, waited: Date.now() - t0, raw: last };
}

// ================= F 组：夹具诚实（内核契约由产物源码自证，两侧皆绿） =================
{
  ok(idbSrc.includes('const miss = list.filter(k => !(k in out));'),
    'F1 idbGetMany 超时确实只回「已回执的那部分」（没答上来的键压根不在 map 里）——红侧这就是 retain 的输入');
  ok(/timer = setTimeout\(function \(\) \{[\s\S]{0,200}?amb\(\);[\s\S]{0,80}?finish\(undefined\);[\s\S]{0,40}\}, minWait\);/.test(idbSrc) || idbSrc.includes('amb(); finish(undefined);'),
    'F2 idbGet 超时那一发＝info.ambiguous 置位＋回 undefined（本尺的单键仿真与它同形）');
  ok(idbSrc.includes("if (lsVal !== null && !(_lsDirtyKeys && _lsDirtyKeys.has(key)))") || idbSrc.includes('window.idbBigSize = function'),
    'F3 数据层已有「免读值的体积尺」（idbBigSize 读 __big-idx）——本批放大等待窗用它，不新造判据');
}

// ================= S 组：本批新代码真在产物里 =================
{
  ok(backup.includes('async function readRetainKeys(retain) {'), 'S1 retain 读回收成一份三态函数（删＝又回到一发 map[k] 定生死）');
  ok(backup.includes('const RETAIN_BATCH = 8;'), 'S2 分批读（一整库残留键挤同一趟事务＝几十 MB 必超 4s+4s）');
  ok(backup.includes('if (k in map) {'), 'S3 判据取「这一格有没有回执」（!(k in map)＝没答上来，不是库里没有）');
  ok(backup.includes("if (one.unknown) return { abort: true, unknownKey: k };"), 'S4 问不出＝未知，整次导入中止（绝不清掉）');
  ok(backup.includes("return info.ambiguous ? { unknown: true } : { none: true };"), 'S5 三态收口：值／库里确认没有／这一发问不出');
  ok(/minWaitMs: 4000 \+ Math\.min\(28000, Math\.ceil\(Math\.max\(size, 1\) \/ 1048576\) \* 2000\)/.test(backup),
    'S6 单键补问的等待窗按体积放大（公式同 #716；不放大等于没补问）');
  ok(backup.includes("impLog('retain:unknown '"), 'S7 问不出那一格进回执环（红侧＝整场一行都没有）');
  ok(backup.includes("impLog('retain:kept='"), 'S8 保留了几格／共几格也记账（下一份诊断单不至于靠猜）');
  ok(backup.includes("if (kept && kept.abort) { resolve(false); return; }"), 'S9 #440 那一行一字未动（针保的那行只读）');
  ok(backup.indexOf('one.unknown') >= 0 && backup.indexOf('one.unknown') < backup.indexOf('idbReplaceAll(allPairs)'),
    'S10 未知判定先于 clear（放行即清库的口子关着；红侧＝本批那段压根不在产物里，不作数）');
  ok(/if \(!havePorts\) \{ retainUnknownKey = '\(no-port\)'; \}/.test(backup) && backup.includes(': Promise.resolve({ abort: true });'),
    'S11 连问句都没有＝未知即中止，不再按「无需保留」清库');
  ok(backup.includes('window.idbLateRead && window.idbLateRead(key)'), 'S14 单键补问先附议「还在飞的那一发」（#1360 第七型口径：别为同一格另起一整包重读）');
  ok(backup.includes("impLog('chat:go"), 'S12 聊天记录导入通路开始记账');
  ok(backup.includes(".filter(k => k.indexOf('xy-home-v2:') === 0 && k !== IMPORT_LOG_KEY)"),
    'S13 导入清 LS 那一步跳过回执环（红侧＝每次成功导入都把「本机导入过」这条证据自己抹掉）');
}

// ================= A 组：本批新契约（大库慢机上导入不许清掉读不出的键） =================
const A = { r: {} };
{
  const { browser, page, st } = await boot();
  await rawSeed(page, SEEDED.map(([k, t]) => [k, BIG_VAL(t)]));
  await page.evaluate(() => { try { localStorage.setItem('xy-home-v2:theme-mode', 'light'); } catch (e) {} });
  await installSim(page, SEEDED.map(([k]) => k), true); // 批量没回执＋单键也问不出＝这台机的现场
  const res = await runImport(page);
  const termA = await waitTerminal(page, 70000);
  A.err = res.err || '';
  A.waited = termA.waited;
  A.toast = await readToast(page).catch(() => '');
  A.log = await readLog(page).catch(() => '[]');
  A.emoji = await rawHas(page, K_EMOJI).catch(() => false);
  A.pub = await rawHas(page, K_PUBCARD).catch(() => false);
  A.media = await rawHas(page, K_MEDIA).catch(() => false);
  A.lsTheme = await page.evaluate(() => { try { return String(localStorage.getItem('xy-home-v2:theme-mode')); } catch (e) { return 'ERR'; } }).catch(() => 'ERR');
  A.backupFlag = await page.evaluate(() => { try { return String(localStorage.getItem('xy-home-v2:1359-from-backup')); } catch (e) { return 'ERR'; } }).catch(() => 'ERR');
  ok(A.err === '', 'A0 真入口走到了导入确认那一步（点不到＝整组 A 读数无从判真假）', A.err);
  ok(termA.terminal, 'A0b 这一发跑到了终态（没跑到＝下面读的是「还没判」的账，不算绿）', JSON.stringify(termA.raw).slice(0, 110));
  ok(A.emoji, 'A1 表情包库（my-emoji-groups）在这一发导入之后还在库里（红侧逐字＝被 clear 掉，＝用户「最近存的表情包都没了」）', 'emoji=' + A.emoji + ' err=' + A.err);
  ok(A.pub, 'A2 公用字卡库（cc-groups-public，诊断里 67.26MB 那一格）还在库里（红侧＝没了）', 'pub=' + A.pub);
  ok(A.media, 'A3 媒体池键还在（图片本体，只认 IDB）（红侧＝没了）', 'media=' + A.media);
  ok(A.lsTheme === 'light', 'A4 中止那一发不写 LS（不许出现「LS 是备份的、库是旧的」混合态）', 'theme-mode=' + A.lsTheme);
  ok(A.backupFlag === 'null', 'A5 中止那一发连备份自带键也没落（真·一字未动）', 'from-backup=' + A.backupFlag);
  ok(A.toast.indexOf('没能读出来') > -1, 'A6 文案如实说「本机有一项大文件这次没能读出来…原有数据一字未动」（红侧＝压根没中止／或谎报「写入未成功」）', JSON.stringify(A.toast.slice(0, 60)));
  ok(A.log.indexOf('retain:unknown') > -1, 'A7 回执环记下是哪一格问不出（红侧逐字＝retain:* 一行都没有）', A.log.slice(0, 160));
  A.replaceCalls = await page.evaluate(() => { try { return parseInt(localStorage.getItem('mochi1359-spy-replace') || '0', 10) || 0; } catch (e) { return -1; } }).catch(() => -1);
  ok(A.replaceCalls === 0, 'A8 中止那一发压根没踩 clear（idbReplaceAll 调用数＝0；红侧≥1＝表情包／字卡正是在这一刻被删掉的）', 'calls=' + A.replaceCalls);
  A.r = res;
  ok(st.jsErrors.length === 0, 'Z1 A 段全程零未捕获异常', st.jsErrors.join(' | ').slice(0, 200));
  await browser.close();
}

// ================= B 组：别把闸变成「存不进去」＋旧契约不许动 =================
{
  // B1/B5 健康机（批量全回执）：导入照常完成，备份里没有的旧键仍被 #118 保留
  const { browser, page, st } = await boot();
  await rawSeed(page, SEEDED.map(([k, t]) => [k, BIG_VAL(t)]));
  await installSim(page, [], false);
  const res = await runImport(page);
  const termB1 = await waitTerminal(page, 70000);
  ok(termB1.terminal, 'B0 这一发跑到了终态（健康机对照组）', JSON.stringify(termB1.raw).slice(0, 90));
  const keptAll = [await rawHas(page, K_EMOJI), await rawHas(page, K_PUBCARD), await rawHas(page, K_MEDIA)];
  const flag = await page.evaluate(() => { try { return String(localStorage.getItem('xy-home-v2:1359-from-backup')); } catch (e) { return 'ERR'; } });
  const log = await readLog(page);
  ok(res.ok && keptAll.every(Boolean), 'B1 批量全回执＝导入照常完成，且备份未含的旧键照 #118 保留（闸门没被改成「什么都存不进去」）', (res.err || '') + ' kept=' + JSON.stringify(keptAll));
  ok(flag === 'from-backup', 'B5 备份自带键照常落地（两侧皆绿＝没把导入整条路堵死）', 'flag=' + flag);
  ok(log.indexOf('retain:kept=') > -1 || log.indexOf('write:idb=ok') > -1, 'B5b 完成那一发也有账（kept 计数或 write:idb=ok）', log.slice(0, 160));
  ok(st.jsErrors.length === 0, 'Z1 B1 段零未捕获异常', st.jsErrors.join(' | ').slice(0, 200));
  await browser.close();
}
{
  // B2 批量没回执，但单键补问答得出来＝这一格该被保留、导入该走完（红侧＝直接被清掉）
  const { browser, page } = await boot();
  await rawSeed(page, [[K_EMOJI, BIG_VAL('emoji')]]);
  await installSim(page, [K_EMOJI], false);
  const res = await runImport(page);
  const termB2 = await waitTerminal(page, 70000);
  ok(termB2.terminal, 'B2a 这一发跑到了终态（补问拿到＝该走完）', JSON.stringify(termB2.raw).slice(0, 90));
  const still = await rawHas(page, K_EMOJI);
  const toast = await readToast(page).catch(() => '');
  const b2calls = await page.evaluate(() => { try { return localStorage.getItem('mochi1359-spy-replace') || '0'; } catch (e) { return '?'; } });
  ok(still && res.ok, 'B2 批量读不出但单键补问拿得到的键＝保留＋导入走完（红侧逐字＝这一格被 clear 掉）', 'emoji=' + still + ' clear次数=' + b2calls + ' err=' + (res.err || ''));
  ok(toast.indexOf('没能读出来') === -1, 'B2b 补问得到就不算未知，不许误报「已中止」', JSON.stringify(toast.slice(0, 40)));
  await browser.close();
}
{
  // B3 单键读到了、库里真没有＝不是未知，照常放行（两侧皆绿＝没修过头）
  const { browser, page } = await boot();
  await rawSeed(page, [[K_EMOJI, BIG_VAL('emoji')]]);
  await installSim(page, [K_EMOJI], false);
  await page.evaluate((k) => {
    // 只让这一格在单键那一发「读到且确实没有」（＝内核答了、值为空），其余照常
    const realGet = window.idbGet;
    window.idbGet = function (key, info) {
      if (key === k) { if (info && typeof info === 'object') info.ambiguous = false; return Promise.resolve(undefined); }
      return realGet.apply(window, arguments);
    };
  }, K_EMOJI);
  const res = await runImport(page);
  const termB3 = await waitTerminal(page, 70000);
  ok(termB3.terminal, 'B3a 这一发跑到了终态（确认没有＝该放行）', JSON.stringify(termB3.raw).slice(0, 90));
  const flag = await page.evaluate(() => { try { return String(localStorage.getItem('xy-home-v2:1359-from-backup')); } catch (e) { return 'ERR'; } });
  ok(flag === 'from-backup', 'B3 「读到了、库里确实没有」不算未知＝导入照常放行（两侧皆绿＝没修过头）', 'flag=' + flag + ' err=' + (res.err || ''));
  await browser.close();
}
{
  // B4 清单读不到＝#440 那一格中止（旧契约一字不动，两侧皆绿）
  const { browser, page } = await boot();
  await rawSeed(page, [[K_PUBCARD, BIG_VAL('pubcard')]]);
  await page.evaluate(() => { window.idbListKeys = function () { return Promise.resolve(null); }; });
  const res = await runImport(page);
  const termB4 = await waitTerminal(page, 70000);
  ok(termB4.terminal, 'B4a 这一发跑到了终态（清单未知＝该中止）', JSON.stringify(termB4.raw).slice(0, 90));
  const still = await rawHas(page, K_PUBCARD);
  ok(still, 'B4 清单读不到（null＝未知）仍按 #440 中止、旧键不动（两侧皆绿）', 'pub=' + still + ' err=' + (res.err || ''));
  await browser.close();
}

// ================= B6：那一格有「还在飞的整包读」时附议它，不另起一发 =================
{
  const { browser, page } = await boot();
  await rawSeed(page, [[K_PROBE, BIG_VAL('probe')], [K_PUBCARD, BIG_VAL('pubcard')]]);
  await installSim(page, [K_PROBE], false); // 探针键：批量那一发不给回执，但库里真有这一格
  await page.evaluate(([k, v]) => {
    // #1360 第七型那张口子：这一发的读请求还挂在内核里，后来的人附议它，而不是再读一整包
    // 应用侧那格 window.idbLateRead 会在数据就绪之后再被赋一次（实测把桩顶掉）——用 50ms 保活重申，
    // 让「补问那一刻取到的就是我的桩」；读数的「现在这层是我的」仍如实报出，桩没活过就不算绿
    window.__lateCalls = 0;
    function mine(fn) { return !!fn && String(fn).indexOf('__lateCalls') > -1; }
    function armLate() {
      if (mine(window.idbLateRead)) return;
      const prev = window.idbLateRead;
      window.idbLateRead = function (key) {
        if (key === k) { window.__lateCalls++; return Promise.resolve(v); }
        return prev ? prev.apply(this, arguments) : undefined;
      };
    }
    armLate();
    window.__lateKeepTimer = setInterval(armLate, 50);
    window.__lateMine = mine(window.idbLateRead);
  }, [K_PROBE, BIG_VAL('probe')]);
  const res = await runImport(page);
  const termB6 = await waitTerminal(page, 70000);
  ok(termB6.terminal, 'B6a 这一发跑到了终态（附议拿到＝该走完）', JSON.stringify(termB6.raw).slice(0, 90));
  const probe = await rawHas(page, K_PROBE);
  const pub = await rawHas(page, K_PUBCARD);
  ok(probe && pub, 'B6b 附议拿得到的那一格被保留、其余照常（红侧＝没有这一发，两格都被 clear 掉）', 'probe=' + probe + ' pub=' + pub + ' err=' + (res.err || ''));
  const calls = await page.evaluate((k) => { try { return { get: ((window.__simGetCalls || {})[k] || 0), late: (window.__lateCalls || 0), mine: String(window.idbLateRead).indexOf('__lateCalls') > -1 }; } catch (e) { return { get: -1, late: -1, mine: false }; } }, K_PROBE);
  ok(calls.get === 0 && calls.late >= 1, 'B6c 不许为同一格另起一整包重读，且必须真的附议到在飞那一发（late>=1 就是桩在场那一刻被调过）', JSON.stringify(calls));
  await browser.close();
}

// ================= C 组：聊天记录导入通路在回执环里得留一行 =================
{
  const { browser, page, st } = await boot();
  await page.evaluate((body) => {
    const f = new File([body], 'mochi聊天记录_1359.json', { type: 'application/json' });
    window.runChatAllImport(f); // 设置页「导入全部桌面聊天记录」调的就是这个口
  }, CHAT_FILE_JSON);
  await page.waitForTimeout(1200);
  const o = await page.evaluate(() => {
    const b = document.getElementById('modal-ok');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (o) await page.mouse.click(o.cx, o.cy);
  await sleep(1500);
  const log = await readLog(page);
  ok(log.indexOf('chat:go') > -1, 'C1 聊天记录导入这一发在回执环留下一行（红侧逐字＝用户明说导入过而【数据导入回执】全是「无」）', log.slice(0, 200));
  ok(st.jsErrors.length === 0, 'Z1 C 段零未捕获异常', st.jsErrors.join(' | ').slice(0, 200));
  await browser.close();
}

{
  // C2 各桌面那一型（singleMsgs=null）：回执要记得到、且一发都不许抛
  const { browser, page, st } = await boot();
  await page.evaluate((body) => {
    const f = new File([body], 'mochi数据备份_chatdesk.json', { type: 'application/json' });
    window.runChatAllImport(f);
  }, CHAT_DESK_JSON);
  await page.waitForTimeout(1400);
  const o = await page.evaluate(() => {
    const b = document.getElementById('modal-ok');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (o) await page.mouse.click(o.cx, o.cy);
  await sleep(1500);
  const log2 = await readLog(page);
  ok(log2.indexOf('chat:go') > -1 && /桌=1/.test(log2) && /单桌=0/.test(log2), 'C2 「标准备份带各桌面 chat-msgs」那一型也记账（单桌=0＝singleMsgs 为 null 那一格兜住了）', log2.slice(0, 200));
  ok(st.jsErrors.length === 0, 'C2b 这一型不许抛（本批第一版没兜 null＝整个导入回调静默死掉，邻批 verify-1360 的 Z1 抓到过）', st.jsErrors.join(' | ').slice(0, 200));
  await browser.close();
}

console.log('\n#1359 导入 retain 三态：通过 ' + pass + ' / 失败 ' + fail + '（被测：' + root + '）');
server.close();
process.exit(fail ? 1 : 0);
