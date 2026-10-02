// verify-tablet-detect：#555 安卓平板判定行为断言
// 背景：device.js isTablet 此前只认 iPad/Macintosh 触摸屏，安卓平板（荣耀平板10Pro、
// EC-PAD01 等用户真实设备）竖屏（CSS 视口<900px）被当手机全屏拉宽、横屏掉进桌面
// 390px 外壳。修复 = 安卓 UA 无 Mobile 关键字（安卓手机 UA 恒带）+ 短边 ≥600 CSS px。
// 断言方式：抽 device.js 真实判定块求值（不是复刻逻辑），覆盖 iPad 双分支不回归 +
// 安卓平板命中 + 手机/桌面不误判。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'js', 'device.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' —— ' + detail : '')); }
};

const mBlock = src.match(/let isTablet = false;\n  try \{[\s\S]*?\n  \} catch \(e\) \{\}/);
ok('isTablet 判定块可定位（含 #555 分支）', !!mBlock && /Mobile/i.test(mBlock[0]));

const evalDetect = (ua, platform, maxTouchPoints, touch, sw, sh) => {
  const fn = new Function('navigator', 'screen', 'window', 'ua',
    mBlock[0] + '\nreturn isTablet;');
  const win = touch ? { ontouchstart: null } : {};
  return fn({ userAgent: ua, platform, maxTouchPoints }, { width: sw, height: sh }, win, ua);
};

console.log('[A] 安卓平板命中（此前双症状）');
// 荣耀平板10Pro + Edge：UA 无 Mobile，竖屏 CSS 800×1274 → 应进平板布局（旧版竖屏当手机拉宽）
ok('荣耀平板 Edge 竖屏 UA → tablet=true', evalDetect(
  'Mozilla/5.0 (Linux; Android 14; AGS5-W09) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 EdgA/126.0.0.0',
  'Linux armv8l', 5, true, 800, 1274) === true);
// EC-PAD01 安卓平板 + Chrome 横屏 CSS 1280×800 → 应进平板布局（旧版掉 390px 外壳）
ok('EC-PAD01 Chrome 横屏 UA → tablet=true', evalDetect(
  'Mozilla/5.0 (Linux; Android 12; EC-PAD01) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Linux armv8l', 5, true, 1280, 800) === true);

console.log('[B] 手机/桌面不误判');
// 安卓手机：UA 带 Mobile → 不得判平板（继续走手机规则表）
ok('安卓手机 UA（带 Mobile）→ tablet=false', evalDetect(
  'Mozilla/5.0 (Linux; Android 14; 2210132C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
  'Linux armv8l', 5, true, 360, 800) === false);
// 个别手机 UA 缺 Mobile：短边 <600 双保险拦下（不得进平板布局）
ok('手机 UA 缺 Mobile（短边<600）→ tablet=false', evalDetect(
  'Mozilla/5.0 (Linux; Android 14; 2210132C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Linux armv8l', 5, true, 384, 864) === false);
// 真桌面 Windows：无触摸 → false（走电脑外壳）
ok('桌面 Windows UA → tablet=false', evalDetect(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Win32', 0, false, 1920, 1080) === false);
// 真桌面 Mac：maxTouchPoints=0 → false（防 Macintosh 触摸分支误扩）
ok('真桌面 Mac → tablet=false', evalDetect(
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  'MacIntel', 0, false, 1728, 1117) === false);
// 安卓平板浏览器「桌面版网站」模式：UA 仿真成 Windows → 按桌面外壳（既有语义，
// 自救通道=设置「手机布局（强制）」/?mobile=1，锁住不被误改）
ok('安卓平板桌面模式 UA → tablet=false（既有语义，勿误改）', evalDetect(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Win32', 0, false, 1280, 800) === false);

console.log('[C] iPad 双分支不回归（#144/#555 同块共存）');
ok('iPadOS 13+ 伪装 Macintosh UA → tablet=true', evalDetect(
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'MacIntel', 5, true, 820, 1180) === true);
ok('老系统 iPad UA → tablet=true', evalDetect(
  'Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  'iPad', 5, true, 810, 1080) === true);

console.log('');
console.log(fail === 0 ? `✅ verify-tablet-detect ${pass}/${pass + fail} PASS` : `❌ ${fail} FAIL / ${pass + fail}`);
process.exitCode = fail === 0 ? 0 : 1;
