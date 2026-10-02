// ===== 常驻回归脚本 #1349：切后台放掉大键内存副本后，同步读空被当成「池子空的」⇒ 一次上传整包顶掉库里旧值
// 用法：node tools/verify-1349-bgdrop-pool-blind-write.mjs [被测根目录]（或 SERVE_ROOT=…；首行打印被测根目录，防喂错产物）
//
// 现场（用户 2026-09-27 直派：荣耀畅玩40Plus(RKY-AN00)／Android 12／夸克 10.18.6「后面添加的头像，头像库里
// 不知道为什么直接清空」；明说「这个问题其他设备型号也有出现」「不要覆盖修改导致不同型号设备浏览器的 bug
// 反复出现」。诊断 mochi-diag-2026-09-26-12-14-46…：内存驻留 default:avatar-lib 766KB / cmtph4yxm5hc:avatar-lib
// 491KB（＝整池 >256KB），整份诊断里没有任何一条 JS 异常＝写坏不是读崩）：
//   同一张单【文件选择取证】与【环境变化】逐发对齐——
//     20:05:18 avlib-upload/surf:hit → 20:05:19 切到后台 → 20:06:29 回到前台 → 20:06:29 avlib-upload/surf:files=36
//     20:07:28 avlib-upload/surf:hit → 20:07:29 切到后台 → 20:08:46 回到前台 → 20:08:47 surf:files=54
//   ＝**打开相册选文件这一动作本身就是一发切后台**，每一发上传都必然踩中它。
//
// 机制（纯 7d314c5 产物无头实测，判据零机型／零 UA，只取「这一格在不在内存里」一个事实）：
//   头像池是 >200KB 的 IDB-only 大键（xyStore.set 的大键分支主动把 localStorage 那份 removeItem 掉了），
//   而 #1195e 每次切后台按体积放掉 ≥256KB 大键的 memoryCache 副本。它那批注承诺「回前台后首次读自动
//   回填」——只对 idbGet 成立：`xyStore.get` 只认内存缓存与 localStorage，永不回退 IDB。于是：
//     ① 切一次后台 → avatar-lib 的内存副本没了（实测 resident 360921→-1，LS 本来就没有 ⇒ store.get 读 NULL，
//        且 3 秒后仍 NULL＝整场不自愈，直到重开）；
//     ② 页面 avatar-lib.js 拿这一发 NULL 做 `JSON.parse(v || '[]')`＝「池子是空的」；
//     ③ 选完文件 finish() 把「只有新选的那几张」整包写回 → 库里 30 条被 1 条顶掉＝永久丢失（实测写后库里 1 条）。
//   同一格在读侧还拆过两次票：#1270l/#1300c 给桌面壁纸、#172/#281/#434 给表情包各自上了闸；一条通路
//   （同步读口对 IDB-only 大键谎报「没有」）喂坏所有大键消费者＝逐页补闸正是用户说的「覆盖式修补」。
//
// 收口（两处，都用站内现成尺子，不另起第二套口径）：
//   A 数据层（idb.js #1349a）：#1195e 真放掉过内存副本的那几键记进名册；xyStore.get 撞上「内存＋LS
//     双读空 且 这一格在册」＝不是「没有」而是「没读到」⇒ 当场补踢一趟按需取回（同键一次不叠发，
//     且与 #1218 的问库共用 bigHydAsk 同一格合流＝#1349c），下一读即库里权威值。释放动作与体积口径
//     一字未动（那是 iOS 内存压力下的正解，#1197d 那根针钉着）；启动预算挂起那一格刻意不在册——那条
//     路上各消费方本按「每命名空间每会话只踢一趟」在问库（#1258d 的不变量），数据层再补一脚＝同一个
//     MB 级原图被读两遍、邻居当场报红；那一格由 B 的证人闸门兜住（idbBigIdxSize 对两格都成立）。
//   B 消费方（avatar-lib.js #1349b）：两个头像池的整包写回（上传追加／删一条）落笔前过闸门——读数可信
//     才写；不可信（库里那份的证人 idbBigIdxSize 说「该有一份 ≥200KB 的副本」而这里读空）先走 #1218 三态
//     idbEnsureBigKey 取回再重读；问不出结果（'unknown'）一律不写、也不许对用户说「已清空」。
//     取回回来的那一读可能比渲染那一刻长 ⇒ 删条目改按值不按旧序号。清空按钮不依赖读数，不过闸（B4 钉住）。
//
// 断言：
//   F 组 夹具诚实（红＝下面全组读数无意义）：F0 库里真灌了 ≥30 条且整值够得着 #1195e 那道闸／
//     F1 启动回填真把这一大键读进了内存（同步口先读到 N 条）／F2 造完现场后屏上读数仍足额（＝起点没坏）
//   S 组 本批新契约（全部走真上传管线：setInputFiles → mochiImgIngest → finish → commitPool → 落库）：
//     S1 症状本体＝切后台后真上传 1 张，库里必须 N+1 条而不是 1 条／S2 落笔那一刻拿到的池子长度就是权威
//     读数（≥N）／S3 库里那条老数据真在（上传前后各读一次库，旧条目一个不许少）／S4 删一条走同一条通路，
//     不许把库里抹空／S5 同步读口对「被放掉」的大键当场自愈（#1349a 兑现 #1195e 那句承诺）
//   B 组 旧契约不许动：B1 #1195e 的释放本身照旧发生（不许用「不再释放」来修 bug＝iOS 卡顿那一批的回归）／
//     B2 大键尺寸证人（#1258 idbBigIdxSize）在释放后仍说「库里该有一份」／B3 没切后台时的普通上传照旧
//     正好 +1（相对判据，闸门不许把正常路径带偏）／B4 用户亲手「清空」照旧当场清空（新闸不许挡）
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
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + String(x).slice(0, 320) + ']' : '')); } };

// —— 夹具 ——
const N_OLD = 30;                     // ≥256KB 才够得着 #1195e 那道闸（每条 ≈12KB ⇒ 整池 ≈360KB）
const PAD = 'A'.repeat(12000);
const mkPool = (n, tag) => JSON.stringify(Array.from({ length: n }, (_, i) => 'data:image/jpeg;base64,' + tag + i + PAD));
// 一张真 JPEG（1x1 起，走 canvas 缩放后仍然合法）——上传管线要过 mochiImgIngest 的真解码，不能塞字符串
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const REL_KEY = 'avatar-lib';

const browser = await chromium.launch({ headless: true });
const errs = [];
let NS = 'xy-home-v2:default';
const FULL = () => NS + ':' + REL_KEY;

async function enter(p) {
  await p.waitForTimeout(2600);
  await p.evaluate(() => {
    const s = document.querySelector('.splash'); if (s) s.remove();
    document.querySelectorAll('.backup-remind-bar, .ver-update-bar').forEach((n) => n.remove());
    const mm = document.getElementById('modal-mask'); if (mm) mm.hidden = true;
  });
  await p.waitForTimeout(400);
}
async function waitReady(p) {
  await p.waitForFunction(() => window.mochiDataState && window.mochiDataState() === 'ready', null, { timeout: 45000 }).catch(() => {});
  await p.waitForTimeout(7000);
}
const rawIdb = (page, key) => page.evaluate((k) => new Promise((res) => {
  let rq; try { rq = indexedDB.open('mochi-db', 1); } catch (e) { return res('ERR'); }
  rq.onsuccess = () => {
    try {
      const g = rq.result.transaction('kv', 'readonly').objectStore('kv').get(k);
      g.onsuccess = () => res(g.result === undefined ? null : g.result);
      g.onerror = () => res('ERR');
    } catch (e) { res('ERR'); }
  };
  rq.onerror = () => res('OPENERR');
}), key);
const nOf = (raw) => {
  if (raw === null || raw === 'ERR' || raw === 'OPENERR') return -9;
  try { const a = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(a) ? a.length : -2; } catch (e) { return -3; }
};
// 屏上同步读数（＝消费方实际拿到的那一份），只回条数不回整包（360KB 回传会撑爆通道）
const memoLen = (page) => page.evaluate((k) => {
  try {
    const v = window.xyStore(window.activePrefix()).get(k);
    if (v === null || v === undefined) return -1;
    const a = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(a) ? a.length : -2;
  } catch (e) { return -3; }
}, REL_KEY);
const memoBytes = (page) => page.evaluate((k) => {
  const st = window.idbMemoStats ? window.idbMemoStats(500) : { top: [] };
  const hit = (st.top || []).filter((t) => t.k === window.activePrefix() + ':' + k);
  return hit.length ? hit[0].len : -1;
}, REL_KEY);
const witness = (page) => page.evaluate((k) => { try { const n = window.idbBigIdxSize ? window.idbBigIdxSize(k) : undefined; return n === undefined ? -1 : n; } catch (e) { return -1; } }, REL_KEY);
// 一发真切后台（真事件＝走 #1195e 那条 visibilitychange 监听，不直接调 idbMemoReleaseBig）
async function toBackground(page) {
  await page.evaluate(() => new Promise((res) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    setTimeout(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      res(true);
    }, 150);
  }));
  await page.waitForTimeout(350);
}
// 走真上传管线：给常驻池选择器喂一张真图，等 commitPool 落库（返回落笔后库里的条数）
async function upload(page, count) {
  const before = nOf(await rawIdb(page, FULL()));
  await page.setInputFiles('#avlib-upload-file-pick', Array.from({ length: count }, (_, i) => ({
    name: 'a1349-' + Date.now() + '-' + i + '.png', mimeType: 'image/png', buffer: PNG_1PX,
  })));
  // 等这一次落笔真的进库：轮询库里条数（闸门取回要一趟 IDB 往返，慢机器上以秒计）
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const n = nOf(await rawIdb(page, FULL()));
    if (n !== before) return { before, n, waited: i + 1 };
  }
  return { before, n: -9, waited: 30 };
}

// ---------- 第 0 拍：把「用户早前上传好的头像池」灌进库里（不经 xyStore.set ⇒ 只在 IDB，正是大键真实形态） ----------
// ⚠ 同一个 browserContext 才共享 IndexedDB／localStorage（新开 context＝干净存储，种子会整个看不见）
const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
const p0 = await ctx.newPage();
p0.on('pageerror', (e) => errs.push('F0 ' + String(e.message).slice(0, 110)));
await p0.goto(baseUrl + '/index.html', { waitUntil: 'load' });
await enter(p0); await waitReady(p0);
NS = await p0.evaluate(() => window.activePrefix());
await p0.evaluate(([k, v]) => { return window.idbSet(k, v).then(() => new Promise(r => setTimeout(r, 1500))); }, [FULL(), mkPool(N_OLD, 'old')]);
const seededDb = nOf(await rawIdb(p0, FULL()));
const seededLen = (mkPool(N_OLD, 'old')).length;
ok(seededDb === N_OLD && seededLen > 256 * 1024,
  'F0 夹具真把 ' + N_OLD + ' 条老头像灌进了库里、整值 ' + Math.round(seededLen / 1024) + 'KB 够得着 #1195e 那道闸',
  '库里=' + seededDb + ' 条');
await p0.close();

// ---------- 主场景：重开（＝真机「下次进入应用」）→ 切一次后台 → 真上传 ----------
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('S1 ' + String(e.message).slice(0, 110)));
await p.goto(baseUrl + '/index.html', { waitUntil: 'load' });
await enter(p); await waitReady(p);

const booted = await memoLen(p);
ok(booted === N_OLD, 'F1 启动回填真把这一大键读进了内存（同步口读到 ' + booted + ' 条）', booted);
ok(await witness(p) > 256 * 1024, 'F2 大键尺寸证人在册（idbBigIdxSize 认这一格 ≥256KB＝本批判据的立足点）');

await toBackground(p);
const afterBgMemo = await memoBytes(p);
ok(afterBgMemo === -1, 'B1 旧契约：#1195e 的释放照旧发生（不许拿「不再释放」修 bug＝iOS 卡顿那一批的回退）', 'resident=' + afterBgMemo);
const witnessAfter = await witness(p);
ok(witnessAfter > 256 * 1024, 'B2 旧契约：释放之后证人仍在册（库里那份没动＝"读空"绝不是"没有"）', 'w=' + witnessAfter);
// ⚠ 上面两问刻意不碰 store.get：同步读一次就会触发 #1349a 的补踢，那样 S1 量的就不再是「盲写」那一格。
//    真机是同一形状——选完文件回来的第一读本来就是 finish() 里那一发。

// S1 症状本体：放掉状态下直接走真上传管线（＝用户「在头像库里添加头像」那一下）
const up = await upload(p, 1);
ok(up.n === N_OLD + 1, 'S1【症状本体】切后台后真上传 1 张 ⇒ 库里 ' + (up.n === -9 ? '一直没变' : up.n + ' 条') + '（应为 ' + (N_OLD + 1) + '，纯底本＝1 条＝旧 ' + N_OLD + ' 张被整包顶掉）', JSON.stringify(up));
const onScreen = await memoLen(p);
ok(onScreen === N_OLD + 1, 'S2 落笔那一刻屏上读数就是权威池（' + onScreen + ' 条，不是「只有新的一张」）', onScreen);

// S3 老数据一条不许少：库里那份的前 30 条仍是当初灌进去的那 30 条
const dbNow = await rawIdb(p, FULL());
const oldKept = (() => { try { const a = typeof dbNow === 'string' ? JSON.parse(dbNow) : (dbNow || []); return a.slice(0, N_OLD).every((x, i) => String(x).indexOf('old' + i) === 'data:image/jpeg;base64,'.length); } catch (e) { return false; } })();
ok(oldKept === true, 'S3 库里那 ' + N_OLD + ' 张老头像逐条还在（不是"条数对上了但内容被换掉"）');

// S4 删一条走同一条通路
const delRaw = await p.evaluate((k) => {
  const cells = document.querySelectorAll('#avlib-grid .avlib-del');
  if (!cells.length) return 'NOCELL';
  cells[cells.length - 1].click();
  return 'CLICK';
});
let afterDel = await rawIdb(p, FULL());
for (let i = 0; i < 12 && nOf(afterDel) !== N_OLD; i++) {
  await p.waitForTimeout(1000);
  afterDel = await rawIdb(p, FULL());
}
ok(delRaw === 'CLICK' && nOf(afterDel) === N_OLD, 'S4 删一条同样过闸门：库里 ' + nOf(afterDel) + ' 条（应 ' + N_OLD + '，且绝不是空池）', delRaw + '/' + nOf(afterDel));

// B3 没切后台的普通上传照旧「正好 +1」（＝闸门不许把正常路径带偏）。
//    相对判据：红侧走到这里库里已被 S1/S4 折腾过，拿绝对条数问就把对照组测成假红（本批实测踩过）。
const plain = await upload(p, 1);
ok(plain.n === plain.before + 1, 'B3 健康路径没被闸门带偏：未放掉状态再传 1 张 ⇒ 库里 ' + plain.before + '→' + plain.n + ' 条', JSON.stringify(plain));

// B4 用户亲手清空必须照做（新闸不许挡）
const cleared = await p.evaluate((k) => new Promise((res) => {
  try { window.xyStore(window.activePrefix()).set(k, JSON.stringify([])); } catch (e) { return res('ERR'); }
  setTimeout(() => res(true), 1500);
}), REL_KEY);
const nCleared = nOf(await rawIdb(p, FULL()));
ok(cleared === true && nCleared === 0, 'B4 旧契约：「清空」这条直写路径照旧落库（本批只拦"拿空读数整包顶"，不拦用户亲手清空）', '库里=' + nCleared);

ok(errs.length === 0, 'Z1 全程零未捕获 JS 异常', errs.slice(0, 3).join(' | '));

console.log('\n#1349 大键切后台放掉后头像池盲写：' + pass + ' 绿 / ' + fail + ' 红');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
