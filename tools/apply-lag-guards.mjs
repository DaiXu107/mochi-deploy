// ===== #338 手机端卡顿成分治理：一键幂等落地脚本 =====
// 背景：本批改动在开发中被并行会话的旧缓冲回写多次覆盖（tabs.js 两次、
// contacts/group-chat/fullscreen 各一次）。为防再被覆盖/漏带，全部改动收拢到本脚本：
// 树面安静时（无并行会话）执行一次即可完整落地，重复执行安全（每步先查前态）。
//
// 用法：node tools/apply-lag-guards.mjs
// 落地后收口三步（构建者执行）：
//   1. node --check src/js/tabs.js 等五个文件（脚本已内置自检）
//   2. build.mjs FIX_SENTINELS 追加 4 条哨兵（见 WORKLOG 对应条目 / 本文件末尾注释）
//   3. node build.mjs → node tools/verify-lag-guards.mjs（A7+B4 全过）
import { readFileSync, writeFileSync } from 'node:fs';

let changed = 0, unchanged = 0;
function patch(file, from, to, expect) {
  let t = readFileSync(file, 'utf8');
  const n = t.split(from).length - 1;
  if (n === 0 && t.includes(to.split('\n')[0].slice(0, 40))) { unchanged++; console.log('  = ' + file + ' 已在位，跳过'); return; }
  if (expect !== undefined && n !== expect) { console.log('  ✗ ' + file + ' 期望 ' + expect + ' 处，实际 ' + n + ' 处，放弃该步'); fail++; return; }
  t = t.split(from).join(to);
  writeFileSync(file, t);
  changed++;
  console.log('  + ' + file + ' 替换 ' + n + ' 处');
}
let fail = 0;

const GUARD = 'if (!p.hidden) p.hidden = true;'; // #338 同值守卫
const GUARD_CMT = ' // FIX #338 同值写也发 mutation（Blink 实测同值 3 连写=3 条记录），44 页全扫=唤醒全部页面观察器';
const RAW_SWEEP = 'forEach(p => p.hidden = true);';
const GUARDED_SWEEP = 'forEach(p => { ' + GUARD + ' });' + GUARD_CMT;

console.log('== ① tabs.js syncChrome 缓存+签名早退 ==');
{
  const f = 'src/js/tabs.js';
  let t = readFileSync(f, 'utf8');
  if (t.includes('_scLastSig')) { unchanged++; console.log('  = 已在位，跳过'); }
  else {
    const from = `  function syncChrome() {
    const phone = document.querySelector('.phone');
    const tabbar = document.querySelector('.tabbar');
    const visible = Array.from(document.querySelectorAll('.page')).find(p => !p.hidden);
    const isFull = visible ? FULL_PAGES.indexOf(visible.id) >= 0 : false;
    if (tabbar) tabbar.hidden = isFull;
    if (phone) phone.classList.toggle('no-statusbar', isFull);
    if (visible) visible.classList.toggle('full', isFull);`;
    const to = `  // FIX 2026-09-11 #338：静态锚点缓存（.phone/.tabbar）+ syncChrome 签名早退（见下方注释）
  let _scPhone = null, _scTabbar = null, _scLastSig = null;
  function syncChrome() {
    // FIX 2026-09-11 #338 手机端卡顿成分（多机型「经常卡、按不动」同族）：syncChrome 挂在
    // 44 个 .page 的 hidden 观察器上，切桌面/进出聊天一次会触发几十次回调，旧实现每次都
    // querySelector('.phone') + querySelector('.tabbar') + querySelectorAll('.page') 全量扫描
    // （4× CPU 降频实测：连切 4 次桌面仅此一处 ≈420ms 主线程）。页面/tabbar/phone 都是
    // template.html 静态锚点（本文件顶部 pages 常量同款假设），缓存后按「可见页+全屏态」
    // 签名早退：签名没变（没有发生真正的切页）就不重复写、不 blur；外部 rAF 舞步
    // （p2-features/memo-app 自定义全屏页）依赖的恢复语义不变——它们开页时签名必然变化。
    let visible = null;
    for (let i = 0; i < pages.length; i++) { if (!pages[i].hidden) { visible = pages[i]; break; } }
    const isFull = visible ? FULL_PAGES.indexOf(visible.id) >= 0 : false;
    const sig = (visible ? visible.id : '') + '|' + (isFull ? '1' : '0');
    if (sig === _scLastSig) return;
    _scLastSig = sig;
    const phone = _scPhone || (_scPhone = document.querySelector('.phone'));
    const tabbar = _scTabbar || (_scTabbar = document.querySelector('.tabbar'));
    if (tabbar) tabbar.hidden = isFull;
    if (phone) phone.classList.toggle('no-statusbar', isFull);
    if (visible) visible.classList.toggle('full', isFull);`;
    if (!t.includes(from)) { console.log('  ✗ tabs.js syncChrome 原文不匹配（可能已被其他批改写），人工核对'); fail++; }
    else { t = t.split(from).join(to); writeFileSync(f, t); changed++; console.log('  + tabs.js syncChrome 已改造'); }
  }
}

console.log('== ② 五文件整页批量 hidden 写同值守卫 ==');
patch('src/js/tabs.js', RAW_SWEEP, GUARDED_SWEEP, 3);
patch('src/js/contacts.js', "document.querySelectorAll('.page')." + RAW_SWEEP, "document.querySelectorAll('.page')." + GUARDED_SWEEP, 1);
patch('src/js/chat.js', "document.querySelectorAll('.page')." + RAW_SWEEP, "document.querySelectorAll('.page')." + GUARDED_SWEEP);
patch('src/js/group-chat.js', "document.querySelectorAll('.page')." + RAW_SWEEP, "document.querySelectorAll('.page')." + GUARDED_SWEEP, 3);

console.log('== ③ fullscreen.js gameFsHasActive 活集合 ==');
patch('src/js/fullscreen.js',
  "var nodes = document.querySelectorAll('.poke-card.game-fs');",
  "// FIX 2026-09-11 #338 手机端卡顿成分：本检查挂在 document.body 整树观察器上，\n    // 每个 DOM 变动批都做一次类并集选择器全文档扫描（4× 降频实测：切桌面一个阶段\n    // 扫 74 次 ≈260ms 主线程）。改用 getElementsByClassName 活集合（C++ 直索引，\n    // 双类匹配语义与 '.poke-card.game-fs' 完全等价，无选择器引擎/无快照分配）。\n    var nodes = document.getElementsByClassName('poke-card game-fs');",
  1);

console.log('== 自检 ==');
const { execSync } = await import('node:child_process');
for (const f of ['tabs', 'contacts', 'chat', 'group-chat', 'fullscreen']) {
  try { execSync('node --check src/js/' + f + '.js', { stdio: 'pipe' }); console.log('  ✓ ' + f + '.js 语法过'); }
  catch (e) { console.log('  ✗ ' + f + '.js 语法错误'); fail++; }
}

console.log('\n落地完成: 新改 ' + changed + ' 步 / 已在位 ' + unchanged + ' 步 / 失败 ' + fail + ' 步');
if (fail) { console.log('存在失败步骤：人工核对后重跑'); process.exit(1); }
console.log('\n收口哨兵（构建者追加到 build.mjs FIX_SENTINELS，4 条）：\n' + [
  `  { name: '#338 syncChrome 签名早退（44 个 .page 观察器回调不再每次全文档扫描）', file: 'js/tabs.js', needle: 'if (sig === _scLastSig) return;' },`,
  `  { name: '#338 contacts.js 回桌面扫同值守卫', file: 'js/contacts.js', needle: 'if (!p.hidden) p.hidden = true;' },`,
  `  { name: '#338 gameFsHasActive 改活集合（.poke-card.game-fs 不再选择器引擎全扫）', file: 'js/fullscreen.js', needle: "getElementsByClassName('poke-card game-fs')" },`,
  `  { name: '#338 整页批量 hidden 写裸扫绝迹（缺席哨兵：再出现裸 forEach hidden 写即红）', file: 'js/group-chat.js', needle: "querySelectorAll('.page').forEach(p => p.hidden = true);", absent: true },`
].join('\n'));
