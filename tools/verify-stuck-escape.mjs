// ===== verify-stuck-escape.mjs：#257 整页「点不动」死点击逃生门 行为断言 =====
// 用法：node tools/verify-stuck-escape.mjs（无浏览器依赖，抽取壳跑 mobile-adapt.js 真实逻辑）
// 抽取范围：scroll-lock IIFE 尾段（FLOAT_SELECTORS 起至文件尾，含 #209/#236 看门狗与
// #257 逃生门），外层依赖（FLOAT_PANEL_SELECTORS/_aSchedCe/isIOS/DOM/storage/timers）全部
// 以可控桩注入。断言红绿对照：git show HEAD:src/js/mobile-adapt.js 切同段=无逃生门 → 行为
// 断言全红恰为修复点。
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { normalize, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

// ---- 从源码切出可执行段（const FLOAT_SELECTORS 行起至文件尾） ----
function sliceOf(src) {
  const m = src.indexOf('const FLOAT_SELECTORS = [');
  if (m < 0) throw new Error('FLOAT_SELECTORS 未找到');
  return src.slice(m);
}

// ---- 桩环境：可控时钟/定时器/DOM/storage，touchstart/touchend/click 监听可手动派发 ----
function makeEnv() {
  const listeners = {};           // type -> [fn]
  const store = new Map();        // localStorage
  let now = 1_000_000;
  const timeouts = [];            // {at, fn}
  const toasts = [];
  const classes = new Set();      // body classList
  const styleProps = {};          // .phone 内联样式
  let activeEl = null;
  const doc = {
    visibilityState: 'visible',
    body: {
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c)
      }
    },
    documentElement: {},
    activeElement: null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    createElement() { return { id: '', className: '', textContent: '', style: {} }; },
    getElementById(id) {
      if (id === 'cc-toast') { const t = { id: 'cc-toast', className: '', textContent: '', style: {}, _escT: 0 }; doc.appendChildTarget = t; return null; } // 首次未创建路径
      return null;
    },
    querySelector(sel) {
      if (sel === '.phone') {
        return { style: {
          get height() { return styleProps.height || ''; }, set height(v) { styleProps.height = v; },
          get alignSelf() { return styleProps.alignSelf || ''; }, set alignSelf(v) { styleProps.alignSelf = v; },
          get top() { return styleProps.top || ''; }, set top(v) { styleProps.top = v; },
          removeProperty(p) { delete styleProps[p]; }
        } };
      }
      return null; // 其余选择器（浮层）按不存在处理：floatIsOpen=false
    }
  };
  function fire(type, ev) { (listeners[type] || []).forEach((fn) => fn(ev)); }
  function tick(ms) {
    now += ms;
    for (let i = timeouts.length - 1; i >= 0; i--) {
      if (timeouts[i].at <= now) { const t = timeouts.splice(i, 1)[0]; t.fn(); }
    }
  }
  const env = {
    doc, fire, tick, store, toasts, classes, styleProps,
    getNow: () => now,
    setActive(el) { doc.activeElement = el; activeEl = el; },
    blurSpy: { called: 0 }
  };
  env.sandbox = {
    isIOS: false,
    FLOAT_PANEL_SELECTORS: ['.poke-card'],
    document: doc,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v))
    },
    window: {
      __mochiAndroidKb: () => env.androidKb,
      __mochiIosKb: () => env.iosKb,
      __escToasts: toasts
    },
    MutationObserver: function () { this.observe = () => {}; },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn, ms) => { timeouts.push({ at: now + (ms || 0), fn }); return timeouts.length; },
    clearTimeout: () => {},
    Date: { now: () => now }
  };
  env.androidKb = { kbActive: false, prov: false };
  env.iosKb = { kbActive: false };
  env.toastPush = (msg) => toasts.push(msg);
  // #257 块里的 _escToast 走 document.getElementById('cc-toast')——桩里返回 null 时
  // 会 createElement 并 appendChild（doc 无 appendChild → try 吞掉）。为断言可见，
  // 这里覆盖 getElementById：cc-toast 恒返回一个可复用对象并把 className 变化记进 toasts。
  let toastEl = null;
  doc.getElementById = (id) => {
    if (id === 'cc-toast') {
      if (!toastEl) {
        toastEl = {
          _cls: '',
          set className(v) { if (v.indexOf('show') >= 0 && this._cls.indexOf('show') < 0) toasts.push(this.textContent); this._cls = v; },
          get className() { return this._cls; },
          textContent: '', style: {}, offsetWidth: 0, _escT: 0
        };
      }
      return toastEl;
    }
    return null;
  };
  env.blurEl = { blur() { env.blurSpy.called++; }, blur2: true };
  return env;
}

// ---- 装载：切片 + 沙箱求值 ----
// 切片起于 scroll-lock IIFE 体内（其 opening 在切片之前）、尾部自带该 IIFE 的 `})();`，
// 故只在头部补一个 `(function () {`，尾部不再追加。
function load(srcText, env) {
  const slice = sliceOf(srcText);
  const wrapped = '(function () {' + slice;
  const names = Object.keys(env.sandbox);
  const fn = new Function(...names, wrapped);
  fn(...names.map((k) => env.sandbox[k]));
  return env.sandbox.window;
}

// ---- 合成触摸事件 ----
function touch(env, x, y, t0, tEnd, endX, endY, target) {
  env.doc.visibilityState = 'visible';
  const tgt = target || { tagName: 'DIV', className: 'chat-body', id: '' };
  env.fire('touchstart', { touches: [{ clientX: x, clientY: y }], target: tgt });
  env.tick(tEnd - t0);
  env.fire('touchend', { changedTouches: [{ clientX: endX != null ? endX : x, clientY: endY != null ? endY : y }], target: tgt });
}

async function main() {
  const srcPath = join(root, 'src', 'js', 'mobile-adapt.js');
  const src = readFileSync(srcPath, 'utf8');
  let headSrc = '';
  try { headSrc = execSync('git show HEAD:src/js/mobile-adapt.js', { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); } catch (e) {}

  // ===== 静态接线断言 =====
  check('S1 源码含 #257 逃生门标记', src.indexOf('#257：整页「点不动」死点击逃生门') >= 0);
  check('S2 死点击判定锚在位（click 活性复核）', src.indexOf('if (_escLastClickAt >= tapEndAt)') >= 0);
  check('S3 现场落盘键在位（__diag-stuck）', src.indexOf("localStorage.getItem('xy-home-v2:__diag-stuck'") >= 0 && src.indexOf("localStorage.setItem('xy-home-v2:__diag-stuck'") >= 0);
  check('S4 证据门控：浮层打开期不计数', src.indexOf('_escAnyFloatOpen()) { _escState.streak = 0; return; }') >= 0);
  check('S5 证据门控：键盘会话期不计数', src.indexOf('_escKbOpen()) { _escState.streak = 0; return; }') >= 0);
  check('S6 证据门控：长按/滑动不算轻点', src.indexOf('>= 350') >= 0 && src.indexOf('> 144') >= 0);
  check('S7 只读探针暴露', src.indexOf('window.__mochiStuckProbe = function') >= 0);
  const devSrc = readFileSync(join(root, 'src', 'js', 'device.js'), 'utf8');
  check('S8 device.js 触摸轨迹采集在位', devSrc.indexOf("document.addEventListener('touchstart', function (ev)") >= 0 && devSrc.indexOf("'xy-home-v2:__diag-touch'") >= 0);
  check('S9 device.js 诊断输出触摸轨迹+逃生记录', devSrc.indexOf("'触摸轨迹 '") >= 0 && devSrc.indexOf("'卡死逃生记录 '") >= 0);
  check('S10 device.js 键盘/锁残留行输出浮层开清单', devSrc.indexOf("浮层开=' + (vg.lock") >= 0);

  // ===== 行为断言（真实逻辑） =====
  // B1 健康路径：3 击每击都有 click 跟随 → 永不触发
  {
    const env = makeEnv(); load(src, env);
    for (let i = 0; i < 3; i++) {
      const t0 = env.getNow();
      touch(env, 100, 200, t0, t0 + 80);
      env.fire('click', { target: { tagName: 'BUTTON' } }); // 页面活着：click 正常派发
      env.tick(120);
    }
    env.tick(1500);
    check('B1 健康点击（每击有 click）不触发逃生门', env.sandbox.window.__escToasts.length === 0, 'toasts=' + env.sandbox.window.__escToasts.length);
  }
  // B2 死点击：同点 3 快击、零 click → 触发：toast + LS 落盘 + streak 清零
  {
    const env = makeEnv(); load(src, env);
    for (let i = 0; i < 3; i++) {
      const t0 = env.getNow();
      touch(env, 100, 200, t0, t0 + 80);
      env.tick(100);
    }
    env.tick(900);
    env.tick(200); // toast 在判定后 +60ms 二段 timeout 里，再走一拍
    check('B2 死点击 3 连触发 toast 播报', env.sandbox.window.__escToasts.length === 1, 'toasts=' + env.sandbox.window.__escToasts.length);
    const rec = JSON.parse(env.store.get('xy-home-v2:__diag-stuck') || '[]');
    check('B2b 逃生记录落盘（n=3）', Array.isArray(rec) && rec.length === 1 && rec[0].n === 3, JSON.stringify(rec));
    check('B2c 落盘标注无残留可清（指向合成层/输入管线）', rec.length === 1 && rec[0].tag.indexOf('无残留') >= 0, rec[0] && rec[0].tag);
  }
  // B3 残留滚动锁 + .phone 内联残留 + 失焦 → 复位并记入 tag
  {
    const env = makeEnv(); load(src, env);
    env.classes.add('scroll-lock');
    env.styleProps.height = '652px'; env.styleProps.alignSelf = 'flex-start'; env.styleProps.top = '120px';
    env.setActive(env.blurEl);
    for (let i = 0; i < 3; i++) { const t0 = env.getNow(); touch(env, 50, 60, t0, t0 + 60); env.tick(100); }
    env.tick(900);
    const rec = JSON.parse(env.store.get('xy-home-v2:__diag-stuck') || '[]');
    const tag = rec.length ? rec[0].tag : '';
    check('B3 残留锁被清', !env.classes.has('scroll-lock'), 'classList=' + [...env.classes].join(','));
    check('B3b .phone 内联 height/alignSelf/top 被清', !env.styleProps.height && !env.styleProps.alignSelf && !env.styleProps.top, JSON.stringify(env.styleProps));
    check('B3c 失焦执行', env.blurSpy.called === 1, 'blur=' + env.blurSpy.called);
    check('B3d 记录含复位明细', tag.indexOf('scroll-lock') >= 0 && tag.indexOf('phone.height') >= 0 && tag.indexOf('blur') >= 0, tag);
  }
  // B4 长按（≥350ms）不算轻点 → 不触发
  {
    const env = makeEnv(); load(src, env);
    for (let i = 0; i < 3; i++) { const t0 = env.getNow(); touch(env, 100, 200, t0, t0 + 520); env.tick(100); }
    env.tick(900);
    check('B4 长按 3 次不触发（气泡菜单路径豁免）', env.sandbox.window.__escToasts.length === 0);
  }
  // B5 滑动（位移>12px）不算轻点 → 不触发
  {
    const env = makeEnv(); load(src, env);
    for (let i = 0; i < 3; i++) { const t0 = env.getNow(); touch(env, 100, 200, t0, t0 + 60, 100, 320); env.tick(100); }
    env.tick(900);
    check('B5 滑动手势 3 次不触发', env.sandbox.window.__escToasts.length === 0);
  }
  // B6 浮层打开期不计数 → 不触发
  {
    const env = makeEnv();
    // 注入一个「视觉可见」的浮层：querySelector 对 #qa-mask 返回带 getClientRects 的元素
    env.doc.querySelector = (sel) => {
      if (sel === '.phone') return { style: { height: '', alignSelf: '', top: '', removeProperty() {} } };
      if (sel === '#qa-mask') return { hidden: false, getClientRects: () => [1] };
      return null;
    };
    load(src, env);
    for (let i = 0; i < 3; i++) { const t0 = env.getNow(); touch(env, 100, 200, t0, t0 + 60); env.tick(100); }
    env.tick(900);
    check('B6 浮层打开期不计数（正在操作弹层）', env.sandbox.window.__escToasts.length === 0);
  }
  // B7 键盘会话期不计数 → 不触发
  {
    const env = makeEnv(); load(src, env);
    env.androidKb.kbActive = true;
    for (let i = 0; i < 3; i++) { const t0 = env.getNow(); touch(env, 100, 200, t0, t0 + 60); env.tick(100); }
    env.tick(900);
    check('B7 键盘会话期不计数（打字/候选期）', env.sandbox.window.__escToasts.length === 0);
  }
  // B8 第 3 击后 click 迟到（>700ms 才派发前已判定则放过；本桩 click 在判定窗口内到达）→ 不触发
  {
    const env = makeEnv(); load(src, env);
    for (let i = 0; i < 3; i++) { const t0 = env.getNow(); touch(env, 100, 200, t0, t0 + 60); env.tick(100); }
    env.fire('click', { target: { tagName: 'BUTTON' } }); // 第 3 击其实点动了（慢设备晚到）
    env.tick(900);
    check('B8 第 3 击有 click 跟随=误报退出，不触发', env.sandbox.window.__escToasts.length === 0);
  }
  // B9 相邻间隔 >650ms（非连续急点）→ 不触发
  {
    const env = makeEnv(); load(src, env);
    for (let i = 0; i < 3; i++) { const t0 = env.getNow(); touch(env, 100, 200, t0, t0 + 60); env.tick(900); }
    env.tick(900);
    check('B9 间隔 >650ms 的零星点击不触发', env.sandbox.window.__escToasts.length === 0);
  }
  // B10 探针可用
  {
    const env = makeEnv(); load(src, env);
    const p = env.sandbox.window.__mochiStuckProbe();
    check('B10 __mochiStuckProbe 返回现场字段', !!p && 'streak' in p && Array.isArray(p.openFloats) && 'lock' in p, JSON.stringify(p && Object.keys(p)));
  }
  // B11 iOS 分支：安卓 .phone 内联清理跳过（isIOS=true 时不清 phone 但仍清锁）
  {
    const env = makeEnv();
    env.sandbox.isIOS = true;
    load(src, env);
    env.classes.add('scroll-lock');
    env.styleProps.height = '652px';
    for (let i = 0; i < 3; i++) { const t0 = env.getNow(); touch(env, 50, 60, t0, t0 + 60); env.tick(100); }
    env.tick(900);
    check('B11 iOS 不清 .phone 内联（healViewport 自治域不越界）', env.styleProps.height === '652px', 'height=' + env.styleProps.height);
    check('B11b iOS 仍清残留滚动锁', !env.classes.has('scroll-lock'));
  }

  // ===== HEAD 红绿对照：旧源无 #257 块 → B2/B2b 行为断言在旧源必假（判定力证明） =====
  if (headSrc) {
    const hasBlock = headSrc.indexOf('#257：整页「点不动」死点击逃生门') >= 0;
    if (!hasBlock) {
      const env = makeEnv();
      let fired = false, loadErr = '';
      try { load(headSrc, env); } catch (e) { loadErr = String(e).slice(0, 80); }
      try {
        for (let i = 0; i < 3; i++) { const t0 = env.getNow(); touch(env, 100, 200, t0, t0 + 80); env.tick(100); }
        env.tick(900);
        env.tick(200);
        fired = env.sandbox.window.__escToasts.length > 0 || !!env.store.get('xy-home-v2:__diag-stuck');
      } catch (e) { loadErr = String(e).slice(0, 80); }
      check('R-HEAD 旧源无逃生门且死点击零响应（证明 B2 判定力来自新块）',
        !hasBlock && !fired, '旧源触发=' + fired + (loadErr ? ' 装载=' + loadErr : ''));
    } else {
      check('R-HEAD HEAD 已含 #257（红绿对照完成态，跳过）', true);
    }
  }

  const fails = results.filter((r) => !r.ok).length;
  console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
