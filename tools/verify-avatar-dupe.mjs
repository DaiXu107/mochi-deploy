// ===== 验证脚本：#882 头像/昵称互动「同一次到点被投递两遍」（用户实报「联系人给我换头像同时间
//        触发了给我换一模一样的两次，两条挨在一起」）=====
// 用法：node tools/verify-avatar-dupe.mjs            —— 直接对 src 桩环境跑，无需构建
//       SERVE_ROOT=../mochi-882red node tools/verify-avatar-dupe.mjs  —— 红基线（无修复副本）
//
// 两条重复通道（本脚本 B 组逐条钉死）：
// ① 双上下文认领：四个 60s 轮询的计时键在 localStorage，但每个上下文各有一份 memoryCache
//   （xyStore.get 优先读它）＋各自独立的 setInterval。同一浏览器双开（PWA + 浏览器标签）时
//   两侧在同一分钟都判「到点了」，各自往自己的 msgs 里加一条一模一样的系统消息——
//   chat.js #796 的 800ms 短闩只扫本侧 msgs、#776 按 ts 认亲（两侧 ts 不同），两道闸全漏。
//   修复＝推进周期之后裸读 localStorage 复核本周期是否被自己认领（avClaimCycle）。
// ② cur-hash 漏写：随机「直接换」分支从不写 *-cur-hash（只有手动点图/邀请同意两处写），
//   而「随机到当前头像就跳过」的判据比的是池内原图字节，头像被 normalizeAvSize 压缩落盘后
//   再也不等于池内那条＝判据永久失效，同一张池图在后续周期被重抽中时原样再换一次、再发一条。
//   修复＝触发同步点（异步压缩之前）记 cur-hash。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const PROJECT_ROOT = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const src = readFileSync(join(PROJECT_ROOT, 'src/js/avatar-lib.js'), 'utf8');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
const lineCount = (s, sub) => (s.split('\n').filter(l => l.indexOf(sub) >= 0).length);

// ---- S 组：源码逻辑锚点 ----
check('S1 认领复核助手在位（裸读 localStorage 复核、绕开 memoryCache）',
  /function avClaimCycle\(key, now\) \{/.test(src) && /localStorage\.getItem\(p \+ ':' \+ key\)/.test(src));
check('S2 四个轮询都在推进周期之后认领（头像两池＋昵称两池同口径）',
  lineCount(src, "avClaimCycle('avatar-me-lib-last', now)") === 1 &&
  lineCount(src, "avClaimCycle('avatar-lib-last', now)") === 1 &&
  lineCount(src, "avClaimCycle('nick-me-lib-last', now)") === 1 &&
  lineCount(src, "avClaimCycle('nick-lib-last', now)") === 1);
check('S3 我的头像池随机直换在触发点记 cur-hash',
  lineCount(src, "store.set('avatar-me-lib-cur-hash', trigHash);") === 1);
check('S4 联系人头像池随机直换在触发点记 cur-hash',
  lineCount(src, "store.set('avatar-lib-cur-hash', trigHash);") === 1);

// ---- B 组：vm 桩环境加载 avatar-lib.js 真实源码 ----
const PREFIX = 'xy-home-v2:default';
function boot(opts) {
  opts = opts || {};
  const mem = new Map(Object.entries(opts.mem || {}));       // 本上下文 memoryCache
  const LS = new Map(Object.entries(opts.ls || {}));         // 共享 localStorage（双上下文都读这里）
  const rand = { v: 0.9 };
  const el = () => ({
    hidden: false, checked: false, value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, insertBefore() {}, removeChild() {},
    setAttribute() {}, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getAttribute: () => null, focus() {}, click() {}, offsetWidth: 0
  });
  const document = {
    visibilityState: 'visible',
    body: el(),
    getElementById: () => el(),
    createElement: () => el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}
  };
  const st = {
    get: (k) => (mem.has(PREFIX + ':' + k) ? mem.get(PREFIX + ':' + k) : (opts.lsBacked ? (LS.has(PREFIX + ':' + k) ? LS.get(PREFIX + ':' + k) : null) : null)),
    set: (k, v) => { mem.set(PREFIX + ':' + k, String(v)); if (!opts.lsDown && !opts.lsForeign) LS.set(PREFIX + ':' + k, String(v)); },
    remove: (k) => { mem.delete(PREFIX + ':' + k); LS.delete(PREFIX + ':' + k); }
  };
  const sysMsgs = [];
  const sandbox = {
    console, JSON, Math: Object.create(Math, { random: { get: () => () => rand.v } }),
    Date, parseInt, parseFloat, isNaN, Number, String, Object, Array, RegExp, Error, Promise, encodeURIComponent, decodeURIComponent,
    document,
    localStorage: {
      getItem: (k) => (opts.lsDown ? null : (LS.has(k) ? LS.get(k) : null)),
      setItem: (k, v) => { if (!opts.lsDown) LS.set(k, String(v)); },
      removeItem: (k) => { LS.delete(k); }
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
    ResizeObserver: function () { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; },
    IntersectionObserver: function () { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    setInterval: (fn) => { sandbox.__timers.push(fn); return 1; },
    setTimeout: () => 1, clearTimeout() {},
    Image: function () { this.decode = () => Promise.resolve(); },
    navigator: { serviceWorker: undefined },
    alert() {}, prompt: () => null, confirm: () => true
  };
  sandbox.__timers = [];
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.activePrefix = () => PREFIX;
  sandbox.window.activeStore = () => st;
  sandbox.window.xyStore = () => st;
  sandbox.window.chatAddSystem = (t) => { sysMsgs.push(String(t)); return {}; };
  sandbox.window.toast = () => {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'avatar-lib.js' });
  // 四个轮询按 jsFiles 内注册顺序：联系人头像池 / 我的头像池 / 联系人昵称池 / 我的昵称池
  const timers = sandbox.__timers.slice();
  return {
    sysMsgs, mem, LS, rand, timers,
    pollPartnerAvatar: () => timers[0](),
    pollMeAvatar: () => timers[1](),
    pollPartnerNick: () => timers[2](),
    pollMeNick: () => timers[3]()
  };
}
const ONE = 'data:image/png;base64,AAAA';       // <180KB → normalizeAvSize 同步回调
const TWO = 'data:image/png;base64,BBBB';

// B1 首次到点：换头像 + 恰好一条系统消息（并记下 cur-hash）
try {
  const h = boot({ mem: { [PREFIX + ':avatar-me-lib']: JSON.stringify([ONE]), [PREFIX + ':avatar-me-lib-last']: '0', [PREFIX + ':avatar-me-lib-next']: '0' }, lsBacked: true });
  h.rand.v = 0.9; // invite 掷骰 90% > 50% → 直接换
  h.pollMeAvatar();
  const msg = h.sysMsgs.filter(t => t.indexOf('更换了你的头像') >= 0).length;
  check('B1 首次到点直换＝一条消息 + cur-hash 落库', msg === 1 && !!h.mem.get(PREFIX + ':avatar-me-lib-cur-hash'), 'msg=' + msg);
} catch (e) { check('B1 首次到点直换', false, e.message); }

// B2 下一周期又抽中同一张池图（头像已被压缩落盘、与池内字节不等的等价形态：cs 键值不同）
try {
  const h = boot({ mem: { [PREFIX + ':avatar-me-lib']: JSON.stringify([ONE]), [PREFIX + ':avatar-me-lib-last']: '0', [PREFIX + ':avatar-me-lib-next']: '0' }, lsBacked: true });
  h.rand.v = 0.9;
  h.pollMeAvatar();
  // 模拟压缩落盘后的现场：聊天键里是压缩字节（与池内原图不等），cur-hash 指向这张池图
  h.mem.set(PREFIX + ':cs-avatar-user', 'data:image/jpeg;base64,COMPRESSED');
  h.LS.set(PREFIX + ':cs-avatar-user', 'data:image/jpeg;base64,COMPRESSED');
  h.mem.set(PREFIX + ':avatar-me-lib-last', '0');  // 下一周期到点
  h.mem.set(PREFIX + ':avatar-me-lib-next', '0');
  h.LS.set(PREFIX + ':avatar-me-lib-last', '0');
  h.pollMeAvatar();
  const msg = h.sysMsgs.filter(t => t.indexOf('更换了你的头像') >= 0).length;
  check('B2 同一张池图再被抽中＝不再发第二条（cur-hash 判据）', msg === 1, 'msg=' + msg);
} catch (e) { check('B2 同一张池图不再发第二条', false, e.message); }

// B3 双上下文：本侧 memoryCache 仍是旧的「没到点前」值，另一上下文已把 last 推进并写进共享 LS
try {
  const now = Date.now();
  const h = boot({
    mem: { [PREFIX + ':avatar-me-lib']: JSON.stringify([ONE]), [PREFIX + ':avatar-me-lib-last']: '0', [PREFIX + ':avatar-me-lib-next']: '0' },
    ls: { [PREFIX + ':avatar-me-lib-last']: String(now - 500) }, // 对侧刚认领本周期
    lsBacked: false, lsForeign: true // 本侧写入不覆盖共享盘＝读回时看到的是对侧的时间戳
  });
  h.rand.v = 0.9;
  h.pollMeAvatar();
  const msg = h.sysMsgs.filter(t => t.indexOf('更换了你的头像') >= 0).length;
  check('B3 双上下文：本周期已被对侧认领＝本侧静默不重复发', msg === 0, 'msg=' + msg);
} catch (e) { check('B3 双上下文认领', false, e.message); }

// B4 单上下文（LS 与 memoryCache 同源）＝认领放行，行为与改前一致
try {
  const h = boot({ mem: { [PREFIX + ':avatar-me-lib']: JSON.stringify([ONE]), [PREFIX + ':avatar-me-lib-last']: '0', [PREFIX + ':avatar-me-lib-next']: '0' }, lsBacked: true });
  h.rand.v = 0.9;
  h.pollMeAvatar();
  const msg = h.sysMsgs.filter(t => t.indexOf('更换了你的头像') >= 0).length;
  check('B4 单上下文照常触发（认领闸不误伤）', msg === 1, 'msg=' + msg);
} catch (e) { check('B4 单上下文不误伤', false, e.message); }

// B5 localStorage 整体不可用（隐私模式/配额满，值只进 memoryCache）＝无从判定则放行，不比改前更差
try {
  const h = boot({ mem: { [PREFIX + ':avatar-me-lib']: JSON.stringify([ONE]), [PREFIX + ':avatar-me-lib-last']: '0', [PREFIX + ':avatar-me-lib-next']: '0' }, lsDown: true });
  h.rand.v = 0.9;
  h.pollMeAvatar();
  const msg = h.sysMsgs.filter(t => t.indexOf('更换了你的头像') >= 0).length;
  check('B5 LS 不可用时不误杀触发（读回 null 按放行）', msg === 1, 'msg=' + msg);
} catch (e) { check('B5 LS 不可用放行', false, e.message); }

// B6 联系人头像池：二次到点抽中同一张（压缩落盘形态）不再发第二条
try {
  const h = boot({ mem: { [PREFIX + ':avatar-lib']: JSON.stringify([TWO]), [PREFIX + ':avatar-lib-last']: '0', [PREFIX + ':avatar-lib-next']: '0' }, lsBacked: true });
  h.rand.v = 0.9;
  h.pollPartnerAvatar();
  h.mem.set(PREFIX + ':cs-avatar-partner', 'data:image/jpeg;base64,COMPRESSED2');
  h.LS.set(PREFIX + ':cs-avatar-partner', 'data:image/jpeg;base64,COMPRESSED2');
  h.mem.set(PREFIX + ':avatar-lib-last', '0');
  h.mem.set(PREFIX + ':avatar-lib-next', '0');
  h.LS.set(PREFIX + ':avatar-lib-last', '0');
  h.pollPartnerAvatar();
  const msg = h.sysMsgs.filter(t => t.indexOf('更换了头像') >= 0).length;
  check('B6 联系人池同一张图＝不再发第二条', msg === 1, 'msg=' + msg);
} catch (e) { check('B6 联系人池 cur-hash', false, e.message); }

// B7 联系人昵称池：双上下文对侧已认领＝本侧静默（同一条「TA 把聊天昵称换成了」不重复）
try {
  const now = Date.now();
  const h = boot({
    mem: { [PREFIX + ':nick-lib']: JSON.stringify(['小宝贝']), [PREFIX + ':nick-lib-last']: '0', [PREFIX + ':nick-lib-next']: '0' },
    ls: { [PREFIX + ':nick-lib-last']: String(now - 500) },
    lsBacked: false, lsForeign: true
  });
  h.rand.v = 0.9;
  h.pollPartnerNick();
  const msg = h.sysMsgs.filter(t => t.indexOf('把聊天昵称换成了') >= 0).length;
  check('B7 昵称池双上下文认领（同口径覆盖换昵称消息）', msg === 0, 'msg=' + msg);
} catch (e) { check('B7 昵称池认领', false, e.message); }

// B8 单侧轮询注册数＝四个池各一条 60s 计时器（认领闸挂在同一批函数上，不是新开的第五条链）
try {
  const h = boot({});
  check('B8 四个轮询各自注册（认领闸覆盖全部四条链）', h.timers.length >= 4, 'timers=' + h.timers.length);
} catch (e) { check('B8 轮询注册', false, e.message); }

const fails = results.filter(r => !r.ok);
console.log('\n' + (results.length - fails.length) + '/' + results.length + ' passed');
process.exit(fails.length ? 1 : 0);
