// verify-fs-nav-hide.mjs — #212 挖孔屏全屏「顶端留白」行为断言（纯 Node，零浏览器依赖）
// 立项：iQOO12+Chrome 报「聊天全屏下顶端有留白」（诊断页面内全绿），用户明说其他设备型号也有。
// 根因：Chromium issue 40723205——挖孔屏上 Fullscreen API 默认 navigationUI:'auto' 不把
// 全屏面铺到挖孔/摄像头区，页面外系统层 letterbox 顶端露一条空白（页面内任何测量都全 ✓，
// 判定器结构性盲区）。官方 workaround = requestFullscreen({navigationUI:'hide'})。
// 本项目安卓路径 enterFs 原为无参 requestFullscreen()（iOS 路径 iosTryNativeFs 早已带参）。
// 本脚本锁定：任何平台路径进入原生全屏都必须带 navigationUI:'hide'，且 iOS 既有路径不被回改。
// 用法：node tools/verify-fs-nav-hide.mjs（退出码 0=全过 1=有断言失败）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/js/fullscreen.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
};

// ===== A. 安卓路径（enterFs）：必须经 fsOpts 携带 navigationUI:'hide' =====
console.log('[A] enterFs 安卓路径 navigationUI 选项');
{
  const s = src.indexOf('function enterFs()');
  const e = src.indexOf('function exitFs()');
  ok(s > 0 && e > s, 'enterFs 函数体可定位');
  const body = s > 0 && e > s ? src.slice(s, e) : '';
  ok(/const fsOpts = \{ navigationUI: 'hide' \};/.test(body), 'fsOpts 声明携带 navigationUI:\'hide\'（逻辑锚点=哨兵同源）');
  ok(/el\.requestFullscreen\(fsOpts\)/.test(body), '安卓 requestFullscreen 走 fsOpts 选项');
  ok(!/el\.requestFullscreen\(\)/.test(body), '安卓路径无参调用已清零（回归即复发）');
  ok(/el\.webkitRequestFullscreen\(\)/.test(body), 'webkit 前缀兜底保留（老内核不收参数，行为不变）');
}

// ===== B. iOS 路径（iosTryNativeFs）：既有 navigationUI:'hide' 不得被回改 =====
console.log('[B] iOS 路径防回归');
{
  const s = src.indexOf('function iosTryNativeFs()');
  const e = src.indexOf('function applyIosFs(');
  const body = s > 0 && e > s ? src.slice(s, e) : '';
  ok(/el\.requestFullscreen\(\{ navigationUI: 'hide' \}\)/.test(body), 'iOS 原生全屏仍带 navigationUI:\'hide\'（#212 之前既有行为，不动）');
}

// ===== C. 全文件：不存在任何不带选项的原生 requestFullscreen 调用 =====
console.log('[C] 全站无参调用清零');
{
  const bare = src.match(/requestFullscreen\(\)/g) || [];
  ok(bare.length === 0, '全文件无 requestFullscreen() 无参调用（实际 ' + bare.length + ' 处）');
}

// ===== D. 整文件可编译（IIFE 语法完整性） =====
console.log('[D] 语法完整性');
try { new Function(src); ok(true, 'fullscreen.js 整文件 Function 编译通过'); }
catch (e) { ok(false, 'fullscreen.js 编译失败：' + e.message); }

console.log('\n结果：' + pass + '/' + (pass + fail) + ' 项通过');
process.exit(fail ? 1 : 0);
