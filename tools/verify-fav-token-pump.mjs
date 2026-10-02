// ===== 验证脚本：#450 收藏页令牌图 miss 读上限饿死=静态页永久裂图（重试泵+单飞结算+看门狗） =====
// 背景：iPhone 15 Pro Max Chrome 等多机型报「收藏大量内容加载失败，只出现问号黑块，图片显示
// 异常」——MISS_READ_MAX=8 并发上限下，一屏令牌图超上限的部分当年拿不到读也不再被扫，src
// 保持 @@m: 令牌＝浏览器当相对 URL 404＝iOS 裂图问号黑块；原实现只在 DOM 再变更时才重扫，
// 收藏列表翻到底不再动的静态页饿死图永久裂。另 idbGet 迟回不回＝inflight 槽位永久占满。
// 修复=#450 每次结算防抖补扫（missRetryPump）+ 槽位释放与结果处理解耦的单飞结算（__tokSettle）
// + 看门狗（TOK_WATCH_MS）。本脚本从 src 提取真实 resolveImg 做行为断言（桩 DOM/IDB/计时器）。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const pool = readFileSync(join(root, 'src/js/media-pool.js'), 'utf8');
const build = readFileSync(join(root, 'build.mjs'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }
const tick = () => new Promise(r => setTimeout(r, 0)); // 让 promise 链微任务跑完再断言

function extractFn(src, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\) \\{');
  const m = re.exec(src);
  if (!m) throw new Error('源码中找不到 ' + name);
  let i = m.index + m[0].length, depth = 1, out = m[0];
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    out += ch;
    i++;
  }
  return out;
}

const H1 = 'a'.repeat(32), H2 = 'b'.repeat(32), H3 = 'c'.repeat(32);
const IMG = 'data:image/png;base64,iVBORw0KGgo=';

// 桩环境：missReads/MISS_READ_MAX 在闭包内重建（真源同款语义）；idbGet/计时器手工控制
function makeSandbox() {
  const resolveImgSrc = extractFn(pool, 'resolveImg');
  const pending = [];
  const documentMock = { querySelectorAll() { return this._nodes || []; }, _nodes: [] };
  let pumpCalls = 0;
  const missing = new Set();
  const markMissingCalls = [];
  const map = new Map();
  const inflight = {};
  const timers = [];
  const windowMock = {};
  const api = new Function(
    'TOKEN_RE', 'TOK', 'FULL', 'map', 'inflight', 'missing', 'markMissing', 'markMissingCalls',
    'window', 'document', 'setTimeout', 'clearTimeout', 'missRetryPump', 'documentMock',
    'MISS_READ_MAX', 'TOK_WATCH_MS',
    'let missReads = 0;\n' +
    resolveImgSrc + '\n' +
    'return { call: (img) => resolveImg(img), reads: () => missReads, map, inflight, missing, markMissingCalls, documentMock };'
  )(
    /^@@m:([0-9a-f]{32})$/, '@@m:', '__media:', map, inflight, missing,
    (h) => markMissingCalls.push(h), markMissingCalls,
    windowMock, documentMock,
    (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    (t) => { if (t) t.cleared = true; },
    () => { pumpCalls++; },
    documentMock,
    8, 20
  );
  windowMock.idbGet = function (key) {
    return new Promise((resolve, reject) => { pending.push({ resolve, reject, h: String(key).slice('__media:'.length) }); });
  };
  api._windowMock = windowMock;
  api._pending = pending;
  api._timers = timers;
  api._pump = () => pumpCalls;
  api._fireTimers = function () { const ts = this._timers.splice(0); ts.forEach(t => { if (!t.cleared) t.fn(); }); };
  return api;
}

function imgOf(h) {
  return { getAttribute: () => '@@m:' + h, dataset: {}, src: 'token-src' };
}

// --- T1 上限饿死：读槽占满时超限图不发读、不设 tokTried（可被泵重试）、登记补扫 ---
{
  const api = makeSandbox();
  const imgs = [];
  for (let i = 0; i < 10; i++) imgs.push(imgOf(H1.slice(0, 31) + i)); // 10 个真异构 hash（31a+数字，32 位十六进制合法）
  imgs.forEach(im => api.call(im));
  ok('T1b 上限内 8 张发起 miss 读', api._pending.length === 8 && api.reads() === 8);
  ok('T1c 超限 2 张饿死：不发读且未设 tokTried（泵可重试）',
    imgs[8].src === 'token-src' && imgs[8].dataset.tokTried === undefined && imgs[9].dataset.tokTried === undefined);
  ok('T1d 饿死路径登记补扫（missRetryPump 被调）', api._pump() >= 1);
}

// --- T2 结算触发补扫+结果处理：读完成 → 槽位释放、map 落、同哈希 img 重写、泵被调 ---
{
  const api = makeSandbox();
  const im1 = imgOf(H1), im2 = imgOf(H1);
  api.documentMock._nodes = [im1, im2];
  api.call(im1); api.call(im2);
  api._pending[0].resolve(IMG);
  await tick();
  ok('T2a 读完成槽位释放', api.reads() === 0 && !api.inflight[H1]);
  ok('T2b 有效值进 map', api.map.get(H1) === IMG);
  ok('T2c 同哈希 img 全部重写为真图', im1.src === IMG && im2.src === IMG);
  ok('T2d 结算触发补扫', api._pump() >= 1);
  ok('T2e 看门狗被清理', api._timers.every(t => t.cleared));
}

// --- T3 看门狗：idbGet 挂死，TOK_WATCH_MS 到期释放槽位（后续新哈希照常发读） ---
{
  const api = makeSandbox();
  api._windowMock.idbGet = () => new Promise(() => {});
  api.call(imgOf(H1));
  ok('T3a 挂起期槽位占用', api.reads() === 1 && api.inflight[H1] === true);
  api._fireTimers();
  ok('T3b 看门狗到期槽位释放（inflight 清空+missReads 归零）', api.reads() === 0 && api.inflight[H1] === undefined);
  api._windowMock.idbGet = function (key) { api._pending.push({ h: key }); return Promise.resolve(IMG); };
  const im3 = imgOf(H2);
  api.documentMock._nodes = [im3];
  api.call(im3);
  await tick();
  ok('T3c 槽位释放后新读放行', api._pending.some(p => p.h === '__media:' + H2) && im3.src === IMG);
}

// --- T4 单飞结算：迟到的 idbGet 结果不再双扣 missReads，且值处理照常（不丢图） ---
{
  const api = makeSandbox();
  let lateResolve;
  api._windowMock.idbGet = () => new Promise((res) => { lateResolve = res; });
  const im = imgOf(H1);
  api.documentMock._nodes = [im];
  api.call(im);
  ok('T4a 读前槽位=1', api.reads() === 1);
  api._fireTimers(); // 看门狗先释放
  ok('T4b 看门狗释放后槽位=0', api.reads() === 0);
  lateResolve(IMG); // 迟到结果
  await tick();
  ok('T4c 迟到结果不双扣（槽位仍=0）', api.reads() === 0);
  ok('T4d 迟到有效值照常落 map+重写 img', api.map.get(H1) === IMG && im.src === IMG);
}

// --- T5 脏值路径：非 data:image → missing 登记+markMissing 占位，不进 map ---
{
  const api = makeSandbox();
  api.call(imgOf(H3));
  api._pending[0].resolve(''); // #275 口径：空串=脏值
  await tick();
  ok('T5 脏值走 missing/markMissing 不进 map', api.missing.has(H3) && api.markMissingCalls.length === 1 && !api.map.has(H3));
}

// --- S 源码/哨兵锚点 ---
ok('S1 看门狗时长 15000（真源与沙箱口径分离但真源必须 15s）', pool.includes('const TOK_WATCH_MS = 15000;'));
ok('S2 泵防抖 300ms 且上限满让位', /missPumpT = setTimeout\(function \(\) \{\s*\n\s*missPumpT = null;\s*\n\s*if \(missReads >= MISS_READ_MAX\) return;/.test(pool));
ok('S3 哨兵两条登记 build.mjs（#450）', build.includes("needle: 'function missRetryPump() {'") && build.includes("needle: 'const __tokSettle = function () {'"));

console.log(pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
