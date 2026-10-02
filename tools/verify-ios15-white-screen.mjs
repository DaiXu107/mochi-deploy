// ===== verify-ios15-white-screen.mjs：iOS 15 开屏无限刷新白屏修复专项验证 =====
// 用户反馈：iOS 15 Pro Max 所有浏览器打开 GitHub Pages 链接，开屏一直自己刷新然后白屏，
// 完全打不开无法使用。
// 根因（2026-08-29 定位）：
//   ① 产物主脚本单块达 2.85MB——iOS 15 WebKit(615)/JavaScriptCore 对超大单块内联 script
//      解析触发内存限制 → WebContent 进程崩溃 → Safari「此页面出现问题」自动重新加载 →
//      每加载必崩 → 无限刷新循环 → 白屏（iOS 上所有浏览器都是 WebKit 内核，故「所有浏览器」一致）；
//   ② 慢网络（GitHub Pages 国内 ~30KB/s）下 sw.js 网络优先 3.5s 必超时，若预缓存失败/
//      旧缓存被清，导航回退命中空缓存 → Response.error() → 白屏。
// 修复：
//   ① build.mjs 把主 bundle 按 ≤600KB 拆成多个 <script> 块（块间保持 jsFiles 顺序）；
//   ② sw.js 导航回退缓存为空时改发不带超时的 fetch(req)，不再直接 Response.error()。
// 验证：产物 script 块数 ≥3 且每块 <700KB；sw.js 兜底 fetch 在位；拆块产物 WebKit 可加载。

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf-8');
const sw = readFileSync(join(root, 'sw.js'), 'utf-8');
// #860（PERF-PLAN 阶段 1b）：core 全外置后，功能代码多数在 js/<file> 产物里——
// 「关键功能仍在产物中」的判据改为全产物池（index.html + js/*.js），否则全部假红。
let pool = html;
try {
  const jsDir = join(root, 'js');
  readdirSync(jsDir).filter(f => f.endsWith('.js')).forEach(f => { pool += '\n' + readFileSync(join(jsDir, f), 'utf-8'); });
} catch (e) { /* 未构建时池里只有 index.html */ }
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  [PASS] ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')); }
}

// 1) 内联段不再可能有超大单块：每块 <700KB（iOS 15 单块安全阈值，原「≥3 块」口径已被
//    #860 外置化取代——内联只剩 3 件系统件，块数下降是预期，红线是「单块体积」不是「块数」）
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.length > 100);
const maxChunk = scripts.length ? Math.max(...scripts.map(s => s.length)) : 0;
check('最大内联 script 块 <700KB', maxChunk < 700 * 1024, Math.round(maxChunk / 1024) + 'KB（' + scripts.length + ' 块）');
// #860 新红线：外置 defer 链必须在位（≥30 条；少于此数＝外置化被回退，2.9MB 内联塞回 HTML）
const deferTags = (html.match(/<script defer src="js\//g) || []).length;
check('#860 外置 defer 链在位（≥30 条；回退＝内联塞回、iOS 解析期整段同步编译）', deferTags >= 30, deferTags + ' 条');

// 2) 关键功能仍在产物中（拆块/外置都不能丢代码）——全产物池判据
const keys = ['idbRestore', 'function renderMsg', 'chatAddIn', 'mobile-adapt', 'pwa-install'];
keys.forEach(k => check('产物含 ' + k, pool.includes(k)));

// 3) sw.js 导航兜底：缓存空时 fetch(req) 而不是 Response.error()
check('sw.js 含缓存空兜底 fetch(req)', sw.includes('return fetch(req)'));
check('sw.js 已移除直接 Response.error 导航白屏', !/fallback\.then\(\(m\) => m \|\| Response\.error\(\)\)/.test(sw));
check('sw.js 含版本注释（v3.27.x）', sw.includes('v3.27.x'));

// 4) 主 bundle 语法自检（node --check 已由构建前置检查，这里只做数量/包含断言）
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
