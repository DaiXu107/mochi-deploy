// ===== #1213 构建前「打回体检」：工作树 ↔ HEAD 的修复锚点差集 =====
// 为什么需要：主树工作树是各并行批的公共草稿区，`node build.mjs` 只看工作树里的 src——
// 谁的工作树停在旧底（旧缓冲回写／没重放最新 tip），一次构建就把**已入库**的修复整块抹回
// 产物，而且构建本身照报「成功」。实测 2026-09-24：某次主树构建会同时打回 128 条已登记锚点
// （横跨 42 个批次，含刚入库的 #1210 五针）——现有 `--check-sentinels` 抓不到它，因为它拿
// **本地** build.mjs 的登记表当尺子，而那份 build.mjs 自己就可能正是旧底（同一实测里本地登记
// 比 HEAD 少 127 条）。所以本体检的登记表**强制取 HEAD 的 build.mjs**，与本地那份无关。
// 判据（零机型／零环境猜测）：① 打回＝某条哨兵的 needle 在 `HEAD:src/<file>` 里在、在工作树
// `src/<file>` 里不在（`absent` 型判据反向）⇒ 这次构建会打回它；② 缩尺（#1214）＝登记表自己就是
// 尺子，条目 `name` 在 HEAD 有、工作树的 build.mjs 里没有 ⇒ 这次提交之后，那批针不再被**任何**检查
// 看见（`--check-sentinels` 与 pre-commit 钩子都读本地这份＝更短）。同名改 needle＝重锚，单独点名不算缩尺。
// 实测：主树工作树相对 HEAD 丢 158 条登记名字，而正常收口那一跳（HEAD~1→HEAD）丢 0 条。
// 跳过（exit 2＝环境缺口，不算回归）：非 git 仓库（`git archive` 副本／CI）、构建根不是
// 工作树根、HEAD 取不到、登记表解析不出来（数组写法被改坏时宁可放行也不误伤构建）。
// 用法：node tools/verify-worktree-revert.mjs [--root=<构建根>]（构建根缺省＝本脚本上级目录）
//       退出码 0＝无打回无缩尺 / 1＝有打回或有缩尺（build.mjs 据此拒绝写产物，`--allow-revert` 放行）/ 2＝跳过
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)));
const argRoot = process.argv.find(a => a.indexOf('--root=') === 0);
const root = normalize(argRoot ? argRoot.slice(7) : join(here, '..')).replace(/\\/g, '/');
const TAG = 'const FIX_SENTINELS = [';

function git(args) {
  return execSync('git ' + args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
}
// 登记表取 HEAD 版，绝不取工作树版（见文件头）
function parseRegistry(src) {
  const start = src.indexOf(TAG);
  if (start < 0) return { err: '这份 build.mjs 里没有 FIX_SENTINELS 数组' };
  const body = src.slice(start + TAG.length, src.indexOf('\n];', start));
  let arr;
  // 闭合括号前必须换行：登记表末行是裸注释时（v8.56 #1474 那样），直接拼 '] 会被那行注释吃掉＝整道打回体检闸静默断电
  try { arr = new Function('return [' + body + String.fromCharCode(10) + ']')(); } catch (e) { return { err: '登记表解析失败（数组写法变了？）：' + String(e.message).slice(0, 60) }; }
  const list = (arr || []).filter(x => x && typeof x === 'object' && typeof x.needle === 'string' && typeof x.file === 'string');
  // 条数闸门：本仓登记量早已上千，解析出的条目骤减＝解析错位而非「针真的没了」，宁可跳过
  if (list.length < 100) return { err: '登记表只解析出 ' + list.length + ' 条（异常偏少，疑似错位）' };
  return { list: list };
}
function loadRegistry() {
  let src;
  try { src = git('show HEAD:build.mjs'); } catch (e) { return { err: 'HEAD 里没有 build.mjs（' + String(e.message).slice(0, 60) + '）' }; }
  const r = parseRegistry(src);
  if (r.err) return { err: 'HEAD 的 build.mjs：' + r.err };
  return { list: r.list, head: safeHead() };
}
function safeHead() { try { return git('rev-parse HEAD').trim().slice(0, 8); } catch (e) { return '?'; } }
// 「构建根就是这个仓库的工作树根」的判据：不比路径字符串（盘符大小写／正反斜杠／行尾噪音在
// Windows 上比不完，实测被坑过一次），直接问内核——工作树子目录里 --show-prefix 非空，根上为空。
function atWorktreeRoot() {
  try {
    git('rev-parse --is-inside-work-tree');
    return git('rev-parse --show-prefix').replace(/[\r\n]+$/, '') === '';
  } catch (e) { return false; }
}

// ===== 缩尺体检（#1214）：登记表＝尺子本身会不会被这次提交剪短 =====
// 上面的 needle 判定拿 HEAD 的登记表当尺子，于是「谁把登记表里的行删了」它自己检不出来：登记表一少，
// 那些针从此不再被**任何**检查看见（`--check-sentinels` 与 pre-commit 钩子用的都是本地这一份＝更短），
// 构建照报成功——和 #1213 要治的是同一个洞，只是这次洞在尺子上。
// 判据取「名字集合只增不减」：实测正常收口 HEAD~1→HEAD 丢名字数＝0，而工作树那份旧底草稿丢 154 条。
// 允许同名改 needle／改文件（重锚是常态，#1212 就这么改过两条），只禁整条名字消失。
function checkRuler(headList) {
  let txt;
  try { txt = readFileSync(join(root, 'build.mjs'), 'utf8'); } catch (e) { return { err: '读不到工作树的 build.mjs' }; }
  const w = parseRegistry(txt);
  if (w.err) return { err: '工作树的 build.mjs：' + w.err };
  const headKey = new Map(headList.map(x => [String(x.name).trim(), x]));
  const wtByName = new Map();
  for (const x of w.list) { const n = String(x.name).trim(); if (!wtByName.has(n)) wtByName.set(n, x); }
  const lost = [], reanchored = [];
  for (const [n, hx] of headKey) {
    const wx = wtByName.get(n);
    if (!wx) { lost.push(n); continue; }
    if (wx.file !== hx.file || wx.needle !== hx.needle) reanchored.push(n);
  }
  let added = 0;
  for (const n of wtByName.keys()) if (!headKey.has(n)) added++;
  return { lost: lost, reanchored: reanchored, added: added, headTotal: headKey.size, wtTotal: wtByName.size };
}

const headCache = {}, wtCache = {};
// 只认 blob：实测有 `file: 'js/'` 这种「全族禁回流」的目录形态登记（#756z）。对目录 `git show`
// 返回的是 tree 清单文本、readFileSync 直接 EISDIR，两边都判不出真值 → 干净工作树会被误报成
// 「打回 1 条」。build.mjs 自己也是把它归进「死锚点」哑哨兵报警的，这里同口径跳过。
function headFile(rel) {
  if (!(rel in headCache)) {
    headCache[rel] = null;
    try {
      const t = git('cat-file -t ' + JSON.stringify('HEAD:src/' + rel)).replace(/[\r\n]+$/, '');
      if (t === 'blob') headCache[rel] = git('show ' + JSON.stringify('HEAD:src/' + rel));
    } catch (e) { headCache[rel] = null; }
  }
  return headCache[rel];
}
function wtFile(rel) {
  if (!(rel in wtCache)) { try { wtCache[rel] = readFileSync(join(root, 'src', rel), 'utf8'); } catch (e) { wtCache[rel] = null; } }
  return wtCache[rel];
}
// 与 build.mjs 的 srcState 同口径：多行 needle 按「每段都在」判
const hasAll = (txt, needle) => needle.split('\n').every(seg => txt.indexOf(seg) >= 0);

export function checkReverts() {
  if (!atWorktreeRoot()) {
    let top = null;
    try { top = git('rev-parse --show-toplevel').replace(/[\r\n]+$/, ''); } catch (e) { top = null; }
    return { skip: top ? '构建根不是这个仓库的工作树根（工作树根＝' + top + '；本根＝' + root + '）＝副本/子目录构建，无对照意义'
      : '非 git 工作树（archive 副本／CI）＝没有可对照的已入库基线' };
  }
  const reg = loadRegistry();
  if (reg.err) return { skip: reg.err };
  const revert = [], onlyWt = [];
  // 闸门自查：登记表只管 src，build.mjs 自己被打回（旧底草稿回写／合并丢块）时这道防线会**静默消失**，
  // 而没有任何别的检查会发现——所以这里把「HEAD 的 build.mjs 里有对本脚本的调用、工作树里没有」也算一条打回。
  const GATE_NEEDLE = 'verify-worktree-revert.mjs';
  let headBuild = null, wtBuild = null;
  try { headBuild = git('show HEAD:build.mjs'); } catch (e) { headBuild = null; }
  try { wtBuild = readFileSync(join(root, 'build.mjs'), 'utf8'); } catch (e) { wtBuild = null; }
  if (headBuild && headBuild.indexOf(GATE_NEEDLE) >= 0 && (wtBuild === null || wtBuild.indexOf(GATE_NEEDLE) < 0))
    revert.push({ name: '#1213 构建前的打回体检闸门本身（工作树的 build.mjs 里已没有对本脚本的调用＝下次构建再无这道防线）', file: 'build.mjs', needle: GATE_NEEDLE });

  let sameOk = 0, sameBad = 0, skipped = 0;
  for (const s of reg.list) {
    if (s.file === 'index.html' || s.file.indexOf('pwa/') === 0) { skipped++; continue; }
    const h = headFile(s.file);
    if (h === null) { skipped++; continue; } // HEAD 里没有这个源件（改名/下线）＝build.mjs 的「死锚点」体检负责
    const w = wtFile(s.file);
    const headHas = s.absent ? !hasAll(h, s.needle) : hasAll(h, s.needle);
    const wtHas = w === null ? false : (s.absent ? !hasAll(w, s.needle) : hasAll(w, s.needle));
    if (headHas && !wtHas) revert.push(s);
    else if (!headHas && wtHas) onlyWt.push(s);
    else if (headHas) sameOk++; else sameBad++;
  }
  return { head: reg.head, total: reg.list.length, comparable: revert.length + onlyWt.length + sameOk + sameBad,
    revert: revert, onlyWt: onlyWt, sameOk: sameOk, sameBad: sameBad, skipped: skipped, ruler: checkRuler(reg.list) };
}

if (process.argv[1] && normalize(process.argv[1]).replace(/\\/g, '/').indexOf('verify-worktree-revert') >= 0) {
  const r = checkReverts();
  if (r.skip) { console.log('⏭️  [打回体检] 跳过：' + r.skip); process.exit(2); }
  const ruler = r.ruler || {};
  const shrink = ruler.lost || [];
  if (!r.revert.length && !shrink.length) {
    const extra = ruler.err ? '（缩尺体检未执行：' + ruler.err + '）'
      : '；登记表名字 ' + ruler.headTotal + '→' + ruler.wtTotal + ' 只增不减成立' + (ruler.reanchored.length ? '（同名重锚 ' + ruler.reanchored.length + ' 条）' : '');
    console.log('✅ [打回体检] 工作树相对 HEAD(' + r.head + ') 无缺失修复锚点——可比对 ' + r.comparable + '/' + r.total + ' 条，两侧同无 ' + r.sameBad + ' 条（存量哑针，非本批引入）' + extra);
    process.exit(0);
  }
  if (r.revert.length) {
    const byBatch = {};
    r.revert.forEach(s => { const b = (String(s.name).match(/^#?([0-9]{2,4})/) || [, '?'])[1]; (byBatch[b] = byBatch[b] || []).push(s); });
    const batches = Object.keys(byBatch).sort((a, b) => Number(b) - Number(a));
    console.error('❌ [打回体检] 工作树比 HEAD(' + r.head + ') 少 ' + r.revert.length + ' 条**已入库**修复锚点，横跨 ' + batches.length + ' 个批次：' +
      batches.map(b => '#' + b + '×' + byBatch[b].length).join('  '));
    console.error('   登记表取的是 HEAD 的 build.mjs（本地那份可能正是旧底），所以「本地没登记」的针照样会报。');
    r.revert.forEach(s => console.error('   · [' + s.file + '] ' + String(s.name).slice(0, 88)));
    console.error('   现在构建＝上面这些修复从 index.html / js/*.js 里消失（「修了没上线」）。');
  }
  if (shrink.length) {
    console.error('❌ [缩尺] 工作树的 build.mjs 比 HEAD 少 ' + shrink.length + ' 条登记（名字 ' + ruler.headTotal + '→' + ruler.wtTotal + '，另有同名重锚 ' + ruler.reanchored.length + ' 条、未入库新增 ' + ruler.added + ' 条）');
    console.error('   登记表就是上面这套检查的尺子：删一行登记＝那条修复从此不再被**任何**检查看见（`--check-sentinels` 与 pre-commit 钩子用的都是本地这一份，比它更短），而构建照报成功。');
    shrink.slice(0, 15).forEach(n => console.error('   · ' + String(n).slice(0, 88)));
    if (shrink.length > 15) console.error('   …另有 ' + (shrink.length - 15) + ' 条（`node tools/verify-worktree-revert.mjs` 全量可见）');
    console.error('   处置：按批次把登记行补回 build.mjs（**重锚可以、删名字不行**）；确要退役某条 → 在台账写明为什么，再 `node build.mjs --allow-revert` 放行。');
  }
  if (ruler.reanchored && ruler.reanchored.length)
    console.log('ℹ️  登记表同名改 needle ' + ruler.reanchored.length + ' 条＝重锚（不算缩尺）。注意：重锚那一轮上面多半会同时报这些名字「打回」——那是 #1213 的严格语义（HEAD 登记的旧针在工作树 src 里确实没了），放行前确认自己真是在改锚、而不是把修复丢了。');
  if (ruler.err) console.warn('⚠️  缩尺体检未执行（' + ruler.err + '）');
  if (r.onlyWt.length) console.log('ℹ️  另有 ' + r.onlyWt.length + ' 条「工作树有、HEAD 没有」＝在途修复尚未入库（不阻断构建）');
  console.error('   确认这些差异无碍后再放行：`node build.mjs --allow-revert`（或 `MOCHI_BUILD_FORCE=1`）。');
  process.exit(1);
}
