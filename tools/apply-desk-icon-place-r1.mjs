// #351 桌面装修图标摆放修复——幂等重放脚本（防并行 stash/回写卷走在途改动，先例 apply-match3-anim-r2.mjs）。
// 再被卷走时跑一遍即恢复：git merge-file 三方合并——
//   base   = tools/.desk-icon-place-r1/personalize.base.js（打补丁前的 HEAD 版）
//   theirs = tools/.desk-icon-place-r1/personalize.fixed.js（#351 修复完整版）
//   ours   = 当前工作区 src/js/personalize.js（被卷回 HEAD 或带他人小改动均可合）
// 覆盖：src/js/personalize.js 全部 13 处 #351 修复 + build.mjs 哨兵 3 条。
// 已应用判定：文件含 #351 标记即整体跳过。
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const MARK = 'FIX 2026-09-12 #351';
const SRC = 'src/js/personalize.js';
const DIR = 'tools/.desk-icon-place-r1';

// 1) personalize.js 三方合并重放
const cur = readFileSync(SRC, 'utf8');
if (cur.includes(MARK)) {
  console.log('· personalize.js 已应用，跳过');
} else {
  const td = mkdtempSync(join(tmpdir(), 'desk351-'));
  const fOurs = join(td, 'ours.js'), fBase = join(td, 'base.js'), fTheirs = join(td, 'theirs.js');
  writeFileSync(fOurs, cur);
  copyFileSync(join(DIR, 'personalize.base.js'), fBase);
  copyFileSync(join(DIR, 'personalize.fixed.js'), fTheirs);
  let code = 0;
  try { execSync(`git merge-file -p --diff3 "${fOurs}" "${fBase}" "${fTheirs}" > "${join(td, 'merged.js')}"`, { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  if (code !== 0) {
    console.log('✗ 三方合并冲突——personalize.js 被改成了未知形态，人工核对后从 personalize.fixed.js 摘取 #351 段恢复');
    rmSync(td, { recursive: true, force: true });
    process.exit(1);
  }
  writeFileSync(SRC, readFileSync(join(td, 'merged.js'), 'utf8'));
  rmSync(td, { recursive: true, force: true });
  console.log('✓ personalize.js 已重放（13 处 #351 修复，三方合并保留并行改动）');
}

// 2) build.mjs 哨兵 3 条（逐条检查，缺则从补丁段落摘回——哨兵行独立、逐行插入安全）
const b = readFileSync('build.mjs', 'utf8');
const sentinels = [
  ["#351 跨页图标启动归位", "{ name: '#351 跨页图标启动归位（删则退出重进图标回原位——顺序数组跨网格认领+非默认页裁决）', file: 'js/personalize.js', needle: 'owner[k] === ICON_HOME_GRID[k] && gid !== ICON_HOME_GRID[k]' },"],
  ["#351 跨页拖动清源页顺序数组", "{ name: '#351 跨页拖动清源页顺序数组（删则源页脏条目残留→启动认领回原位）', file: 'js/personalize.js', needle: \"store.set('app-icon-order-' + srcGrid.dataset.app\" },"],
  ["#351 新页自带图标网格", "{ name: '#351 新页自带图标网格（删则新页图标只能独立竖排、无排版不可调位）', file: 'js/personalize.js', needle: \"pgGrid.setAttribute('data-desk-widget', 'pg' + i)\" },"],
];
let added = 0;
for (const [mark, line] of sentinels) {
  if (b.includes(mark)) continue;
  const anchor = "{ name: '#340 消消乐死锁洗牌滑动动画";
  const at = b.indexOf(anchor);
  if (at < 0) { console.log('✗ build.mjs 哨兵锚点缺失（#340 行），人工插入'); process.exit(1); }
  const eol = b.indexOf('\n', at);
  writeFileSync('build.mjs', b.slice(0, eol + 1) + '  ' + line + '\n' + b.slice(eol + 1));
  added++;
  console.log('✓ build.mjs 哨兵已补：' + mark);
}
if (!added) console.log('· build.mjs 哨兵已在，跳过');
