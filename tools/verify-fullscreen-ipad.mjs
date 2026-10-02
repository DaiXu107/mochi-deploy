// verify-fullscreen-ipad.mjs — #189 全屏滑动闪烁 + iPad 全屏开关无效果 行为断言
// 用法：node tools/verify-fullscreen-ipad.mjs（退出码 0=全过 1=有断言失败）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(root, p), 'utf8');
const device = src('src/js/device.js');
const fsJs = src('src/js/fullscreen.js');
const ma = src('src/js/mobile-adapt.js');
const baseCss = src('src/css/base.css');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// ===== A. device.js isIOS：iPadOS 伪装 UA（Macintosh+触摸屏）必须判为 iOS（#144 基座）=====
console.log('[A] device.js isIOS 五场景');
{
  const m = device.match(/const isIOS = [\s\S]*?'ontouchstart' in window\);/);
  ok(!!m, 'isIOS 表达式可定位（含 Macintosh 伪装分支）');
  if (m) {
    // 提取表达式（跨行），在受控沙箱里按场景求值（表达式引用裸 ua/navigator/window）
    let expr = m[0].replace(/^const isIOS = /, '').replace(/;\s*$/, '');
    const evaluate = (ua, platform, maxTouchPoints, ontouchstart, MSStream) => {
      const navigator = { userAgent: ua, platform, maxTouchPoints };
      const window = { MSStream };
      Object.defineProperty(window, 'ontouchstart', { value: ontouchstart });
      try { return Function('navigator', 'window', 'ua', `'use strict'; return (${expr});`)(navigator, window, ua); }
      catch (e) { return 'ERR:' + e.message; }
    };
    const iPadDisguised = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';
    ok(evaluate(iPadDisguised, 'MacIntel', 5, {}, undefined) === true, 'iPadOS 伪装 UA（MacIntel+触摸）→ true');
    ok(evaluate(iPadDisguised, 'MacIntel', 0, undefined, undefined) === false, '桌面 Mac（无触摸）→ false');
    ok(evaluate('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 'iPhone', 5, {}, undefined) === true, 'iPhone UA → true');
    ok(evaluate('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile', 'Linux armv8l', 5, {}, undefined) === false, 'Android UA → false');
    ok(evaluate('Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15', 'iPad', 5, {}, undefined) === true, '老 iPad UA → true');
  }
}

// ===== B. fullscreen.js：iOS 不再启动方向监视/横屏兜底（iPad 全屏误杀根因）=====
console.log('[B] fullscreen.js iOS 守卫四处');
ok(/function startFsMonitorSafe\(\) \{ if \(isIOS\) return; startFsMonitor\(\); \}/.test(fsJs),
  'startFsMonitorSafe 存在且 iOS 直接返回');
{
  // 两个 fullscreenchange 监听都必须走 Safe 入口（不得再直呼 startFsMonitor）
  const listeners = fsJs.match(/document\.addEventListener\('(webkit)?fullscreenchange', \(\) => \{[\s\S]*?\}\);/g) || [];
  ok(listeners.length === 2, 'fullscreenchange 监听器共 2 处（实际 ' + listeners.length + '）');
  ok(listeners.length === 2 && listeners.every(l => l.includes('startFsMonitorSafe()')), '两个监听器都走 startFsMonitorSafe');
  // 进入全屏的 tryLock 亦然
  ok(/const tryLock = \(\) => \{ lockFsOrient\(\); startFsMonitorSafe\(\); \};/.test(fsJs), 'enterFs/iosTryNativeFs tryLock 走 Safe 入口');
  // orientationchange：iOS 整段跳过
  ok(/document\.addEventListener\('orientationchange', \(\) => \{\s*\n\s*if \(isIOS\) return;/.test(fsJs),
    'orientationchange 监听 iOS 出口在位');
  // 1500ms 复核：iOS 不得走「全屏+横屏=被强制转横」杀全屏分支
  ok(/if \(!isIOS && isFullscreen\(\) && viewportLandscape\(\)\)/.test(fsJs),
    '开关 1500ms 复核的横屏杀全屏分支带 !isIOS 守卫');
}
// 安卓路径不受影响：enterFs 的 setTimeout(tryLock, 300) 与 startFsMonitor 本体仍在
ok(/function startFsMonitor\(\) \{/.test(fsJs), '安卓方向监视器本体未被删除');

// ===== C. mobile-adapt.js：自愈层复活 + 手势安全化（闪烁根因）=====
console.log('[C] mobile-adapt.js 自愈层与迟滞');
{
  const hv = ma.match(/function healViewport\(\) \{[\s\S]*?\n      \}/);
  ok(!!hv, 'healViewport 函数体可定位');
  if (hv) {
    const body = hv[0];
    const dDecl = body.indexOf('var d = document.documentElement; // FIX 2026-09-05 #189');
    const dUse = body.indexOf("d.classList.contains('ios-pwa-standalone')");
    ok(dDecl >= 0, 'healViewport 内补了 d 声明（#189 标记）');
    ok(dDecl >= 0 && dUse > dDecl, 'd 声明在首次使用之前（自愈层不再每次 TypeError 中断）');
    ok(/if \(_cleanedResidue \|\| winScrollY\(\) > KB_SCROLL_HEAL\) pinScrollTop\(\);/.test(body),
      '稳态 pin 条件式（清残留或大偏移才归零）');
    ok(/window\.innerHeight\) \+ _stT \+ 24;/.test(body), '底边容差计入 --mochi-safe-top（#179 覆盖形态）');
    ok(/!_fsLike\(\) && _vv && \(Math\.abs\(_vv\.offsetTop\) > KB_SCROLL_HEAL/.test(body),
      '全屏态跳过 vv offset 残留判定（弹性回弹不掐断）');
  }
  ok(/function _fsLike\(\) \{[\s\S]*?fs-active[\s\S]*?fs-css-active[\s\S]*?ios-fs-active[\s\S]*?ios-native-fs[\s\S]*?\}/.test(ma),
    '_fsLike 全屏形态判定在位');
  ok(/if \(isNaN\(_curFs\) \|\| Math\.abs\(_nPxFs - _curFs\) >= 6\)/.test(ma), '全屏分支 --mochi-ios-h ≥6px 迟滞');
  ok(/if \(isNaN\(_curN\) \|\| Math\.abs\(vh - _curN\) >= 6\)/.test(ma), '非全屏分支 --mochi-ios-h ≥6px 迟滞');
}

// ===== D. base.css：iPad 全屏可见效果 + #111 手机行为不变 =====
console.log('[D] base.css 状态栏规则');
ok(baseCss.includes('html.tablet.ios-pwa-standalone.ios-fs-active .phone .statusbar { display:none; }'),
  'tablet standalone 全屏隐藏模拟状态栏规则在位');
ok(!baseCss.includes('.ios-fs-active .phone .statusbar { display: none'),
  '#111 absent 哨兵语义保持（无作用域整类隐藏不得出现）');
ok(baseCss.includes('html.ios-fs-active .phone .statusbar { padding-top:14px; }'),
  '#111 手机全屏态保留状态栏规则未被回滚');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
