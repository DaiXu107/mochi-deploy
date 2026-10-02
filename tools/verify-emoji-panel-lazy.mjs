// ===== 验证脚本：#435 表情包面板图片懒加载泵式分批 + 令牌批量预热 行为级回归 =====
// 背景：多机型报「聊天里打开表情包页面加载图片很慢，会因为加载慢没有显示图片」——
// v3.42.x 首轮懒加载（vivoX200S 报障）后仍现。根因①rootMargin 300px 按字卡库近全屏列表
// 定、面板滚动区仅 max-height:40vh——触发窗口≈3 屏＝打开分组瞬间 40+ 张图同时补 src 进
// 解码管线，主线程长任务接连，图反而迟迟画不出；面板 img 还漏了 decoding=async。
// ②TA/公用大库令牌卡 @@m:hash 走观察器逐图 miss 读 IDB（8 并发排队）→重写→再解码五段
// 异步串行＝冷启动慢上加慢。修复=窗口收窄 120px + IO 触发改 50ms 泵式每批 4 张补 src +
// img 统一创建补 decoding=async + 组内令牌渲染后交 media-pool.mochiMediaWarmTokens 批量预热。
// 本脚本从 src 真实实现提取函数体（非复刻）在 stub 环境里跑行为断言。
// #1314 补桩（不松旧断言）：泵体改问 `emojiPaintSrc`（令牌交池、内联值＝逐字同旧的一次赋值），切片
//   环境必须把这一层一起提进来，否则整支脚本在新 tip 上 ReferenceError 崩掉；提取写成可选（纯 HEAD 的
//   chat.js 没有这个函数＝那一侧照旧跑泵自己的直接赋值），并新增 T7（令牌走池、src 落载荷＝HEAD 侧如实
//   红）＋T7b（内联值仍当场一次落 src＝两侧皆绿，守住「别把老路径改慢/改两趟」）。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const poolSrc = readFileSync(join(root, 'src/js/media-pool.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// --- 按名字提取函数体（括号配平），支持 `function NAME(...) {` 与 `X.Y = function (...) {` 两种形态 ---
function extractFn(src, name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{|[\\w.$]*(?:' + name + ')[\\w.$]*\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{');
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

// ============ A. chat.js：懒加载泵行为 ============
function makeImg(isConnected) {
  const img = {
    dataset: { src: 'data:image/png;base64,AAAA' + Math.random() },
    isConnected: !!isConnected,
    _src: null,
    getAttribute(k) { return k === 'src' ? img._src : null; },
    setAttribute(k, v) { if (k === 'src') img._src = v; },
    removeAttribute(k) { if (k === 'data-src') delete img.dataset['data-src']; },
  };
  return img;
}
function makePumpEnv() {
  const timers = [];
  // #1314 桩随之补尺（不松任何一条旧断言）：泵体不再自己 `img.setAttribute('src', …)`，而是问一句
  //   `emojiPaintSrc`（令牌交池、内联值＝逐字同旧的一次赋值）。切片测试必须把这一层一起提进来，
  //   否则整支脚本在新 tip 上直接 ReferenceError 崩掉（本支实测崩过一次：emojiPaintSrc is not defined）。
  //   提取写成**可选**——纯 HEAD 的 chat.js 没有这个函数，那一侧照旧跑泵自己的直接赋值＝同一把尺子
  //   量到的还是它自己的旧行为（新增的 T7 在 HEAD 侧如实红）。
  let paintSrc = '';
  try { paintSrc = extractFn(chatSrc, 'emojiPaintSrc'); } catch (eP) {}
  const env = new Function('__timers', `
    const emojiLazyQueue = [];
    let emojiLazyT = null;
    const emojiImgObserver = { unobserve() {} };
    const window = {};
    function setTimeout(fn, ms) { __timers.push([fn, ms]); return 1; }
    function clearTimeout() {}
    ${extractFn(chatSrc, 'emojiLazyEnqueue')}
    ${paintSrc}
    ${extractFn(chatSrc, 'emojiLazyPump')}
    return {
      queue: emojiLazyQueue,
      enqueue: emojiLazyEnqueue,
      pump: emojiLazyPump,
      window,
      timers: __timers,
      disarm: () => { emojiLazyT = null; },
    };
  `);
  return env(timers);
}
{
  const env = makePumpEnv();
  // T1 enqueue 去重：同一 img 两次入队只占一位，且首个入队即起 50ms 定时器、重复入队不再起
  const a = makeImg(true);
  env.enqueue(a); env.enqueue(a);
  ok('T1 enqueue 去重且首入队起 50ms 泵', env.queue.length === 1 && env.timers.length === 1 && env.timers[0][1] === 50);
  // T2 泵每批最多补 4 张：6 张入队跑一轮只补前 4 个 src，队列剩 2
  env.queue.length = 0;
  const imgs = [makeImg(true), makeImg(true), makeImg(true), makeImg(true), makeImg(true), makeImg(true)];
  imgs.forEach(im => env.queue.push(im));
  env.timers.length = 0;
  env.disarm();
  env.pump();
  ok('T2 泵一轮只补 4 张（分批让出主线程）', imgs.slice(0, 4).every(im => im._src && im._src.indexOf('data:image/') === 0)
    && imgs.slice(4).every(im => im._src === null) && env.queue.length === 2);
  ok('T3 队列未清空时泵尾续起 50ms 定时器', env.timers.length === 1 && env.timers[0][1] === 50);
  // T4 已补 img 再入队：src 已在不再重复设置（懒加载单飞）；enqueue 起泵的定时器是合法一条
  env.timers.length = 0;
  env.disarm();
  env.queue.length = 0;
  const keepSrc = imgs[0]._src;
  env.enqueue(imgs[0]);
  env.pump();
  ok('T4 已补 img 再入队不重复设置 src', imgs[0]._src === keepSrc && env.queue.length === 0 && env.timers.length === 1);
  // T5 游离节点（重渲染丢弃）被跳过不给 src
  const env2 = makePumpEnv();
  const dead = makeImg(false);
  const alive = makeImg(true);
  env2.queue.push(dead, alive);
  env2.timers.length = 0;
  env2.disarm();
  env2.pump();
  ok('T5 游离节点跳过（重绘后不补旧图）', dead._src === null && alive._src && env2.queue.length === 0);
  // T6 队列清空后泵不再续定时器
  ok('T6 队列清空泵自然停', env2.timers.length === 0);
}
{
  // T7（#1314 新契约）滚进来的那一格是池令牌时，泵把令牌**交给池**、src 上落的是载荷——旧写法直接把
  //   `@@m:<hash>` 那 44 个字符写进 src，只为让池观察器按 `img[src^="@@m:"]` 捞到节点，于是内核把它当
  //   相对 URL 真发一次必 404 的请求＋池写回第二次＝每格先坏一次再从零解一次＝用户实报的「闪一下重新加载」。
  const env3 = makePumpEnv();
  const asked = [];
  env3.window.mochiMediaPaint = (el, val, done) => {
    asked.push(val);
    el.setAttribute('src', 'data:image/png;base64,RESOLVED'); // 池的语义：载荷到手一次写成载荷
    if (done) done(true);
  };
  const t = makeImg(true);
  t.dataset.src = '@@m:' + 'a'.repeat(32);
  env3.queue.push(t);
  env3.timers.length = 0;
  env3.disarm();
  env3.pump();
  ok('T7 令牌走池、src 上落的是载荷（纯 HEAD 无 emojiPaintSrc 这一层＝这一条照旧红）',
    asked.length === 1 && asked[0].indexOf('@@m:') === 0 && t._src === 'data:image/png;base64,RESOLVED');
  // T7b 内联值（非令牌）仍是一次直接赋值＝本批把判据统一，不许顺手把老路径改慢或改成两趟
  const env4 = makePumpEnv();
  env4.window.mochiMediaPaint = (el, val, done) => { el.setAttribute('src', val); if (done) done(true); };
  const p = makeImg(true);
  p.dataset.src = 'data:image/png;base64,DDDD';
  env4.queue.push(p);
  env4.timers.length = 0;
  env4.disarm();
  env4.pump();
  ok('T7b 内联 dataURL 仍当场一次落 src（两侧皆绿＝老路径没被本批改坏）', p._src === 'data:image/png;base64,DDDD');
}

// ============ B. chat.js：emojiNewImg 统一创建 ============
{
  const env = new Function(`
    const document = { createElement() { return { dataset: {} }; } };
    ${extractFn(chatSrc, 'emojiNewImg')}
    return emojiNewImg;
  `)();
  const img = env('data:image/png;base64,BBBB');
  ok('N1 img 补 decoding=async（解码不阻塞渲染帧）', img.decoding === 'async');
  ok('N2 img 走 data-src 懒加载通道', img.dataset.src === 'data:image/png;base64,BBBB');
  ok('N3 alt 保底（无障碍/占位）', img.alt === '表情');
}

// ============ C. chat.js：组内令牌收集 ============
{
  const scheduled = [];
  const env = new Function('__sched', `
    const window = { mochiMediaWarmTokens(hashes) { __sched.push(hashes); } };
    function setTimeout(fn) { fn(); return 1; }
    ${extractFn(chatSrc, 'emojiWarmGroupTokens')}
    return emojiWarmGroupTokens;
  `)(scheduled);
  env(['@@m:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'data:image/png;base64,CCCC', '@@m:nothex', 42, '@@m:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
  ok('G1 @@m: 前缀整卡收集（脏 hash 交池端二次过滤）、dataURL/非字符串剔除', scheduled.length === 1
    && scheduled[0].length === 3
    && scheduled[0][0] === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    && scheduled[0][2] === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  const env2 = new Function(`
    const window = {};
    function setTimeout(fn) { return 1; }
    ${extractFn(chatSrc, 'emojiWarmGroupTokens')}
    return emojiWarmGroupTokens;
  `)();
  let noCrash = true;
  try { env2(['@@m:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']); } catch (e) { noCrash = false; }
  ok('G2 接口缺失时静默跳过（旧包/禁用态不崩）', noCrash);
}

// ============ D. media-pool.js：mochiMediaWarmTokens 批量预热行为 ============
async function main() {
  const H1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const H2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const H3 = 'cccccccccccccccccccccccccccccccc';
  const H4 = 'dddddddddddddddddddddddddddddddd';
  const state = { map: new Map(), missing: new Set(), inflight: {}, idbCalls: [] };
  const imgsForH2 = [{ _src: null, set src(v) { this._src = v; }, get src() { return this._src; } }];
  const doc = {
    querySelectorAll(sel) {
      return sel === 'img[src="' + '@@m:' + H2 + '"]' ? imgsForH2 : [];
    },
  };
  const win = {
    idbGetMany(keys) {
      state.idbCalls.push(keys.slice());
      const out = {};
      out['xy-home-v2:media:' + H2] = 'data:image/png;base64,E2E2';
      // H3 缺失（返回对象里没有该键），H4 脏值
      out['xy-home-v2:media:' + H4] = 'not-a-dataurl';
      return Promise.resolve(out);
    },
  };
  const env = new Function('window', 'document', 'map', 'missing', 'inflight', `
    const FULL = 'xy-home-v2:media:';
    const TOK = '@@m:';
    const warmSeen = new Set();
    const warmQueue = [];
    let warmT = null;
    function setTimeout(fn) { return 1; }
    function clearTimeout() {}
    ${extractFn(poolSrc, 'warmPump')}
    ${extractFn(poolSrc, 'mochiMediaWarmTokens')}
    return { warm: window.mochiMediaWarmTokens, pump: warmPump, queue: warmQueue };
  `)(win, doc, state.map, state.missing, state.inflight);

  // W1 非法 hash 过滤：带 @@m: 前缀/短串/空/非字符串全挡（调用方约定传裸 hash），合法裸 hash 入队
  env.warm(['@@m:' + H1, H2, 'short', null, 42, H3, H4]);
  ok('W1 非法/带前缀 hash 过滤（调用方传裸 hash）', env.queue.length === 3
    && env.queue.indexOf(H1) < 0 && env.queue.indexOf(H2) >= 0 && env.queue.indexOf(H3) >= 0 && env.queue.indexOf(H4) >= 0);
  ok('W2 预热在飞占 inflight 与观察器互斥（同 hash 不双读）', !!state.inflight[H2] && !!state.inflight[H3] && !!state.inflight[H4]);
  env.pump();
  await Promise.resolve(); await Promise.resolve(); // 放微任务：idbGetMany.then 链跑完
  ok('W3 单事务批量读（idbGetMany 一次拿全组）', state.idbCalls.length === 1 && state.idbCalls[0].length === 3);
  ok('W4 有效值进 map 热缓存', state.map.get(H2) === 'data:image/png;base64,E2E2');
  ok('W5 页面上匹配令牌的 img 被同步重写', imgsForH2[0]._src === 'data:image/png;base64,E2E2');
  ok('W6 缺失/脏值不进 map（不污染热缓存）', !state.map.has(H1) && !state.map.has(H3) && !state.map.has(H4));
  ok('W7 在飞标记全部释放', !state.inflight[H2] && !state.inflight[H3] && !state.inflight[H4]);
  // W8 会话内去重：同一批再 warm 不再入队（整组重渲染零重复读）
  env.warm([H2, H3, H4]);
  ok('W8 warmSeen 会话内去重（重渲染零重复读）', env.queue.length === 0);
  // W9 map 已有的 hash 直接跳过，不再打 IDB
  env.warm([H2]);
  ok('W9 map 已有的 hash 直接跳过', env.queue.length === 0);
}
// ============ E. 源码接线断言 ============
ok('C1 renderEmojiGroup 渲染即预热组内令牌', /grid\.className = 'emoji-grid';\s*emojiWarmGroupTokens\(arr\)/.test(chatSrc));
// #662（2026-09-17）：面板 img 由「无条件 emojiNewImg 新建」改为 emojiAdoptImg（先取回收池里同
// 身份的旧节点＝已解码的零重解码，取不到才新建）——本项断言随之改口径：两分支仍必须走同一个统一
// 入口，且入口内部仍以 emojiNewImg 造新节点（decoding=async + 懒加载能力不丢）。
ok('C2 mine/非 mine 两分支 img 都走统一入口（#662 回收池，新建仍落到 emojiNewImg）',
  (chatSrc.match(/const img = emojiAdoptImg\(src\);/g) || []).length === 2
  && /function emojiAdoptImg\(src\)[\s\S]{0,400}?const img = emojiNewImg\(src\);/.test(chatSrc));
ok('C3 懒加载窗口按面板 40vh 容器收窄 120px（300px 是字卡库全屏列表口径，面板照搬＝3 屏全触发）', chatSrc.indexOf("rootMargin: '120px 0px'") >= 0 && chatSrc.indexOf("rootMargin: '300px 0px'") < 0);
// C4 重锚（#1314）：无 IO 兜底那一支的落笔改交 `emojiPaintSrc`（令牌交池、内联值逐字同旧的一次赋值）。
// 断言语义不变＝「旧内核没有 IntersectionObserver 也必须全量补 src，不许把能力删掉」；两种写法都算过，
// 整支被删则两种都不在＝照样红（ needle 认形态不认行号，删掉一定拦得住）。
ok('C4 无 IntersectionObserver 兜底保留（旧内核全量补 src，能力不删零分支）',
  /else \{ emojiPaintSrc\(img, img\.dataset\.src \|\| ''\)/.test(chatSrc)
  || /else \{ img\.setAttribute\('src', img\.dataset\.src \|\| ''\)/.test(chatSrc));
ok('C5 重绘前清泵队列与定时器（防补到游离节点）', /emojiLazyQueue\.length = 0;[^]*?clearTimeout\(emojiLazyT\)/.test(chatSrc));
ok('C6 媒体池侧批量预热接口在位', poolSrc.indexOf('window.mochiMediaWarmTokens = function (hashes) {') >= 0);
ok('C7 预热读走 idbGetMany 批量（每批 8 个单事务，非逐图 idbGet 排队）', /warmQueue\.splice\(0, 8\)/.test(poolSrc) && /window\.idbGetMany\(batch\.map/.test(poolSrc));

main().then(() => {
  console.log(`verify-emoji-panel-lazy: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}).catch(e => { console.error('脚本异常:', e && e.message); process.exit(2); });
