// ===== 验证脚本：syncVvFit env 探针缓存「矛盾自愈」必须真的在逻辑链上 =====
// 用法：node tools/verify-env-reprobe.mjs [mobile-adapt.js 副本路径]
//   不带参数 = 检查 src/js/mobile-adapt.js + 仓库根产物 index.html（产物接入）
//   带参数   = 第 1 参数替换被检的 mobile-adapt.js 源（可喂 git show HEAD:… 导出的旧副本做红对照）
//
// 背景（#277，iPhone 17 + Safari/WebKit26.6 standalone，用户「未知 bug」附诊断）：
//   错误环反复采集「[屏幕适配] --mochi-ios-h、底部导航栏悬空、底部少填｜env=62 var=0
//   diff=62 inner=894 phone底=894」，全部在「回到前台」后。根因：env(safe-area-inset-top)
//   探针缓存只在旋转时失效——standalone 冷启动早帧探到 0 被永久缓存，稳定后实为覆盖
//   形态 env=62；stale envTop=0 令 expBase 少算 env 段，切后台回来 inner 短报 894 时
//   --mochi-ios-h 卡 894＝.phone 底部 62px 白带/tabbar 悬空，且 1s 常驻自愈每次用同一
//   中毒缓存算出同值、「确认」坏态永不自愈。修复＝矛盾信号（screen−inner≥20 而缓存=0
//   或与缺口差>8）节流 5s 重探。本脚本锁：矛盾判定/节流/时刻入账在源码成套存在、
//   #148 旋转失效与 #189 迟滞写两条既有防线未被顺手破坏、产物已接入。
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const argv = process.argv.slice(2);
const maPath = argv[0] || 'src/js/mobile-adapt.js';
let ma = '';
try { ma = readFileSync(normalize(join(root, maPath)), 'utf8'); } catch (e) { ma = ''; }
check('S0 被检源可读（' + maPath + '）', !!ma, ma.length + 'B');

// ---- S 组：#277 修复接线（矛盾判定 → 节流 → 重探 → 时刻入账，成套缺一即断）----
const cond = ma.includes('(_envTopCache === 0 || Math.abs(_envTopCache - _diff0) > 8)');
check('S1 矛盾判定表达式在位（缓存=0 或与顶部缺口差>8）', cond);
const gated = cond && /_sig0\.standalone && _diff0 >= 20 && _envTopCache >= 0[\s\S]{0,120}Math\.abs\(_envTopCache - _diff0\) > 8/.test(ma);
check('S2 判定门完整（standalone + 顶部确实缺段 diff≥20 + 缓存已测）', !!gated);
const throttle = ma.includes('Date.now() - _envTopCacheAt > 5000');
check('S3 重探 5s 节流在位（防 1s 自愈循环频繁建探针 DOM）', throttle);
const stamp = /_envTopCache = parseFloat\(getComputedStyle\(_probe\)\.paddingTop[\s\S]{0,200}_envTopCacheAt = Date\.now\(\)/.test(ma.replace(/\n/g, ' '));
check('S4 探回值时刻入账（节流基准随重探推进）', stamp);
const inv = ma.includes('_envTopCache = -1; _envTopCacheAt = Date.now();');
check('S5 矛盾时缓存置未测并同时记时刻', inv);

// ---- R 组：既有防线未被顺手破坏（家族回归）----
const rot = ma.includes("addEventListener('orientationchange', function () { try { _envTopCache = -1; }");
check('R1 #148 旋转失效路径保留', rot);
const hysFs = ma.includes('Math.abs(_nPxFs - _curFs) >= 6');
check('R2 #189 全屏分支 ≥6px 迟滞写保留', hysFs);
const hysVv = ma.includes('Math.abs(vh - _curN) >= 6');
check('R3 #189 非全屏分支 ≥6px 迟滞写保留', hysVv);
const expFs = ma.includes('Math.round(_f.expBase)');
check('R4 #179/#209 全屏高度仍按判定器 expBase 写', expFs);
const formSrc = readFileSync(normalize(join(root, 'src/js/device.js')), 'utf8');
check('R5 共享判定器 mochiViewportForm 仍在（#210 单一事实源）', formSrc.includes('window.mochiViewportForm = function (sig) {'));

// ---- P 组：产物接入（仓库根 index.html 为构建产物；源码有而产物无＝漏接入）----
const artPath = join(root, 'index.html');
if (existsSync(artPath) && !argv[0]) {
  const art = readFileSync(artPath, 'utf8');
  check('P1 产物 index.html 含 #277 矛盾判定锚', art.includes('(_envTopCache === 0 || Math.abs(_envTopCache - _diff0) > 8)'));
  check('P2 产物 index.html 含重探节流锚', art.includes('Date.now() - _envTopCacheAt > 5000'));
} else {
  console.log('SKIP  P 组（未传副本参数但根产物不存在，或处于红对照模式——跳过产物断言）');
}

const fails = results.filter(r => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
