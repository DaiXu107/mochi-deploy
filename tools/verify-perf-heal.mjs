// #411 卡顿自检 · 一键优化 行为验证（纯 Node，零浏览器依赖）
// 立项：iPhone 15 Pro Max + Chrome 等多机型报「卡顿」——诊断实锤主因是公用/专属字卡库
// 单键可达 44MB（#377/#387/#398 已做内存内令牌化瘦身，但大库解析/按需取回仍是间歇冻结点）。
// 修复=data 层纯逻辑：mochiPerfLevel 分级 / mochiPerfAgg 聚合 / mochiPerfHeal 非破坏预热
// （取回挂起大键 + 预热令牌化回复池，只优化不删除，不碰不删任何用户数据）。
// 本脚本从 src/js/storage-slim.js 整文件注入桩环境跑行为断言——分级/聚合/预热被改坏这里立刻红。
// 用法：node tools/verify-perf-heal.mjs
import { readFileSync } from 'node:fs';

const srcPath = new URL('../src/js/storage-slim.js', import.meta.url);
const text = readFileSync(srcPath, 'utf8');

let pass = 0, failcnt = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { failcnt++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
}

// 桩环境：storage-slim.js 顶 IIFE 只在被调用时用 window.*，加载期仅挂 window.* 方法
const win = {};
new Function('window', text)(win);

// —— A 组：分级判定器（纯函数）——
(function () {
  console.log('A. mochiPerfLevel 分级判定');
  ok(typeof win.mochiPerfLevel === 'function', 'mochiPerfLevel 已暴露');
  ok(win.mochiPerfLevel(1 * 1048576, 0) === '轻', '总占用 1MB/无大组 → 轻');
  ok(win.mochiPerfLevel(8 * 1048576, 0) === '中', '总占用 8MB → 中');
  ok(win.mochiPerfLevel(30 * 1048576, 0) === '重', '总占用 30MB → 重（44MB 公用库场景）');
  ok(win.mochiPerfLevel(0, 3) === '中', '大分组 3 个 → 中');
  ok(win.mochiPerfLevel(0, 7) === '重', '大分组 7 个 → 重');
  ok(win.mochiPerfLevel(-5, -1) === '轻', '脏值（负数）不 panic → 轻');
})();

// —— B 组：聚合器——
(function () {
  console.log('B. mochiPerfAgg 聚合');
  ok(typeof win.mochiPerfAgg === 'function', 'mochiPerfAgg 已暴露');
  const rep = {
    ok: true,
    libs: [{ label: '公用字卡库', bytes: 44 * 1048576 }, { label: 'default · 专属', bytes: 12 * 1048576 }],
    groups: [
      { cat: 'sticker', name: '大表情', bytes: 20 * 1048576 },
      { cat: 'image', name: '珍藏图', bytes: 3 * 1048576 }
    ]
  };
  const agg = win.mochiPerfAgg(rep);
  ok(agg.totalBytes === 56 * 1048576, '总占用正确 = ' + agg.totalBytes);
  ok(agg.bigGroups === 2, '>1MB 大分组计数 = ' + agg.bigGroups);
  ok(agg.biggestBytes === 20 * 1048576, '最大单组 = ' + agg.biggestBytes);
  ok(agg.level === '重', '56MB/2 大组 → 重，实际=' + agg.level);
  ok(agg.ok === true, 'ok 透传');
  // 失败分支
  const bad = win.mochiPerfAgg({ ok: false, reason: '扫描失败' });
  ok(bad.level === '轻' && bad.totalBytes === 0 && bad.reason === '扫描失败', '失败对象聚合不 panic，reason 透传');
})();

// —— C 组：非破坏预热（异步，await）——
console.log('C. mochiPerfHeal 非破坏预热');
let hydArgs = null, warmArgs = 0;
win.hydrateLibScopes = function (scopes) { hydArgs = scopes; return Promise.resolve(); };
win.getCustomCards = function () { warmArgs++; return ['a', 'b', 'c']; };
try {
  const res = await win.mochiPerfHeal();
  ok(res && res.ok === true, 'heal 正常返回 ok');
  ok(Array.isArray(hydArgs) && hydArgs.indexOf('public') >= 0 && hydArgs.indexOf('own') >= 0, 'hydrateLibScopes 收到 [public, own]');
  ok(warmArgs === 1, 'getCustomCards 预热被调用恰好一次');
  ok(res.warmed === 3, '预热字卡数 = 3');
} catch (e) {
  ok(false, 'heal 抛错不 panic', (e && e.message) || String(e));
}

console.log('\n结果: ' + pass + ' 通过 / ' + failcnt + ' 失败');
process.exit(failcnt ? 1 : 0);