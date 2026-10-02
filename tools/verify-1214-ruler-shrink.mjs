// ===== 常驻回归：#1214「缩尺体检」——修复登记表（尺子）被一次提交剪短时，防线自己必须报警 =====
// 为什么需要（#1213 自己留下的洞，实测背书）：构建前打回体检拿 `git show HEAD:build.mjs` 的
// FIX_SENTINELS 当尺子比对工作树 src。可如果提交的正是那份**旧底 build.mjs**，登记表本身变短——
// 那批针从此不再被任何检查看见（`--check-sentinels` 与 pre-commit 钩子用本地那份＝更短），构建照报成功。
// 实测（2026-09-25 主树）：工作树 build.mjs 相对 HEAD 丢掉 **154 条已入库登记名字**，而正常收口
// 那一跳（HEAD~1 → HEAD）丢 0 条 ⇒「名字集合只增不减」是可实现、且此刻正被违反的硬约束。
// 判据零机型／零环境猜测：只比登记表里的条目名字与 needle，不比时间戳、不看任何设备。
// 断言（判别器＝同 tip 纯 HEAD 副本 r 跑同一套：g 侧全绿，r 侧恰红 S1b/S2/S2b/S2c/S4b/S6/S7＝
// 只红「缩尺」这一条新契约；S1/S2d/S3/S3b/S4/S4c/S5/S6b/S7b/S8 两侧皆绿＝对照组，证 #1213 原有能力没被改坏）：
//   S1 干净工作树 → 放行，且报出「只增不减成立」
//   S2 只删登记行（代码全在）→ 拦下并点名 [缩尺]；**不得**报「打回」（本轮真的没打回任何针）
//   S3 只删代码行（登记全在）→ 拦下并报「打回」；不得误报 [缩尺]（＝#1213 原能力对照）
//   S4 同名换 needle（＝重锚，合法）→ 放行并数出「同名重锚 1 条」（防误伤下一位改锚的人）
//   S5 闸门调用本身被删 → 报 #1213（#1213 自查对照）
//   S6 缩尺＋打回并存 → 两段都出现（旧底草稿的真实形态）
//   S7 本地登记表解析不出（数组改名）→ 警告「缩尺体检未执行」但**不**误伤构建
//   S8 非 git 目录 → exit 2 显式跳过
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = normalize(dirname(fileURLToPath(import.meta.url)));
const TOOL = join(here, 'verify-worktree-revert.mjs');
const ENTRIES = 120, FILES = ['a.js', 'b.js', 'c.js'];
let pass = 0, fail = 0;
const ok = (cond, name, note) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (note ? '   [' + String(note).slice(0, 180) + ']' : ''));
  cond ? pass++ : fail++;
};
const sh = (args, cwd) => execFileSync('git', args, { encoding: 'utf8', cwd: cwd, stdio: ['ignore', 'pipe', 'pipe'] });
// 跑被测脚本：返回 {code, out}（stdout+stderr 合并——哨兵/报警走 stderr，只读 stdout 会假绿）
function run(root) {
  try {
    const o = execFileSync(process.execPath, [TOOL, '--root=' + root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: String(o || '') };
  } catch (e) {
    return { code: e && e.status != null ? e.status : -1, out: String((e && e.stdout) || '') + String((e && e.stderr) || '') };
  }
}
// needle 必须等宽零填充：'CODE5' 是 'CODE55' 的子串，实测会让「删掉 CODE5」判成还在（假绿）
const nd = (i) => 'CODE' + String(i).padStart(3, '0');
const regEntry = (i) => "  { name: '#9000p" + i + " 针" + i + "', file: '" + FILES[i % 3] + "', needle: '" + nd(i) + "' },\n";
const buildTxt = (drop, renamed) => (renamed ? 'const SENTINEL_TABLE = [' : 'const FIX_SENTINELS = [') + '\n' +
  Array.from({ length: ENTRIES }, (_, i) => regEntry(i)).filter((_, i) => !drop.includes(i)).join('') +
  '\n];\n// 构建前调用 node tools/verify-worktree-revert.mjs（打回体检硬闸）\nexport default 1;\n';
function srcs(missing) {
  const out = { 'a.js': '', 'b.js': '', 'c.js': '' };
  for (let i = 0; i < ENTRIES; i++) out[FILES[i % 3]] += 'function ' + nd(i) + '(){/*' + i + '*/}\n';
  for (const i of missing) out[FILES[i % 3]] = out[FILES[i % 3]].replace('function ' + nd(i) + '(){/*' + i + '*/}\n', '');
  return out;
}
function writeLab(lab, opts) {
  const o = opts || {};
  writeFileSync(join(lab, 'build.mjs'), buildTxt(o.drop || [], !!o.renamed));
  mkdirSync(join(lab, 'src'), { recursive: true });
  const s = srcs(o.missing || []);
  for (const f of FILES) writeFileSync(join(lab, 'src', f), s[f]);
  if (o.reanchor != null) {
    // 合法重锚：登记行换 needle，源件里旧串换新串（＝旧针在 HEAD、新针在工作树，两边都不算丢）
    const i = o.reanchor, nf = FILES[i % 3];
    let b = readFileSync(join(lab, 'build.mjs'), 'utf8');
    b = b.replace("needle: '" + nd(i) + "'", "needle: 'NEWR" + i + "'");
    writeFileSync(join(lab, 'build.mjs'), b);
    let t = readFileSync(join(lab, 'src', nf), 'utf8');
    t = t.replace('function ' + nd(i) + '(){/*' + i + '*/}\n', 'function NEWR' + i + '(){/*r*/}\n');
    writeFileSync(join(lab, 'src', nf), t);
  }
  if (o.dropGateCall) {
    let b = readFileSync(join(lab, 'build.mjs'), 'utf8');
    writeFileSync(join(lab, 'build.mjs'), b.replace('// 构建前调用 node tools/verify-worktree-revert.mjs（打回体检硬闸）', '// 构建前什么都不查'));
  }
}

const lab = mkdtempSync(join(tmpdir(), 'mochi-ruler-lab-'));
const nogit = mkdtempSync(join(tmpdir(), 'mochi-ruler-nogit-'));
console.log('实验室（临时 git 仓）：' + lab + '\n被测脚本：' + TOOL);
try {
  sh(['init', '-q', lab]);
  sh(['-C', lab, 'config', 'user.email', 'lab@lab'], undefined);
  sh(['-C', lab, 'config', 'user.name', 'lab'], undefined);
  sh(['-C', lab, 'config', 'core.autocrlf', 'false'], undefined);
  writeLab(lab, {});
  sh(['-C', lab, 'add', '-A']);
  sh(['-C', lab, 'commit', '-q', '-m', 'base: 120 条登记']);
  const restore = () => { sh(['-C', lab, 'checkout', '--', '.']); sh(['-C', lab, 'clean', '-qfd']); };

  // S1 控制组：干净工作树
  let r1 = run(lab);
  ok(r1.code === 0, 'S1 干净树放行（exit 0）', 'code=' + r1.code + ' ' + r1.out.split('\n')[0]);
  ok(r1.out.indexOf('只增不减成立') > -1, 'S1b 放行时把「尺子没被剪短」也报出来（红＝缩尺体检根本没跑）', r1.out.split('\n')[0]);

  // S2 只删登记行（代码全在）＝纯缩尺：这是 #1213 单独的盲区
  restore();
  writeLab(lab, { drop: [7, 8, 9] });
  let r2 = run(lab);
  ok(r2.code === 1, 'S2 纯缩尺被拦下（exit 1；红＝旧底 build.mjs 提交后闸门从此看不见这 3 条针）', 'code=' + r2.code);
  ok(r2.out.indexOf('[缩尺]') > -1, 'S2b 报警点名「[缩尺]」并给出名字差', r2.out.split('\n').find(l => l.indexOf('缩尺') > -1));
  ok(r2.out.indexOf('9000p7') > -1 && r2.out.indexOf('9000p9') > -1, 'S2c 丢掉的名字被逐条列出（不是只报个数）', '');
  ok(r2.out.indexOf('❌ [打回体检]') === -1, 'S2d 本轮没有真打回 ⇒ 不许误报「修复锚点缺失」（红＝两个判据混成一锅）', r2.out.split('\n')[0]);
  restore();

  // S3 只删代码行（登记全在）＝#1213 原能力
  writeLab(lab, { missing: [11, 12] });
  let r3 = run(lab);
  ok(r3.code === 1 && r3.out.indexOf('❌ [打回体检]') > -1, 'S3 纯打回仍被拦下（对照组，两侧都该绿）', 'code=' + r3.code);
  ok(r3.out.indexOf('[缩尺]') === -1, 'S3b 纯打回不许顺口报缩尺（红＝判据串了）', '');
  restore();

  // S4 合法重锚（同名换 needle）＝不许被算进缩尺；#1213 那边照旧会报「旧针没了」（严格语义，见下）
  writeLab(lab, { reanchor: 5 });
  let r4 = run(lab);
  ok(r4.out.indexOf('[缩尺]') === -1, 'S4 重锚不算缩尺（红＝下次谁改锚都被误判成剪尺，防线会被集体绕过）', r4.out.split('\n').find(l => l.indexOf('缩尺') > -1));
  ok(r4.out.indexOf('同名改 needle 1 条＝重锚') > -1, 'S4b 重锚被单独点名说明（不是沉默、也不是混进打回清单）', r4.out.split('\n').find(l => l.indexOf('重锚') > -1));
  ok(r4.code === 1 && r4.out.indexOf('❌ [打回体检]') > -1, 'S4c 严格语义保留：HEAD 登记的旧针在工作树 src 里确实没了 → 仍拦（红＝闸门对旧底心软）', 'code=' + r4.code);
  restore();

  // S5 闸门调用本身被删（#1213 自查）
  writeLab(lab, { dropGateCall: true });
  let r5 = run(lab);
  ok(r5.code === 1 && r5.out.indexOf('#1213') > -1, 'S5 闸门自身被打回时自查报出（对照组，两侧都该绿）', 'code=' + r5.code);
  restore();

  // S6 缩尺＋打回并存＝旧底草稿真实形态
  writeLab(lab, { drop: [3], missing: [4, 5] });
  let r6 = run(lab);
  ok(r6.code === 1 && r6.out.indexOf('❌ [打回体检]') > -1 && r6.out.indexOf('[缩尺]') > -1,
    'S6 两种问题同时存在时两段都报（红＝只报一条，收口方按错清单重放）', 'code=' + r6.code);
  ok(r6.out.indexOf('--allow-revert') > -1, 'S6b 中止时给出口令与处置说明（防被当成误伤直接绕过）', '');
  restore();

  // S7 本地登记表解析坏 → 警告但不误伤
  writeLab(lab, { renamed: true });
  let r7 = run(lab);
  ok(r7.out.indexOf('缩尺体检未执行') > -1, 'S7 本地登记表解析不出时明确说「未执行」（红＝静默跳过＝防线形同虚设）', r7.out.split('\n').find(l => l.indexOf('缩尺') > -1));
  ok(r7.code === 0, 'S7b 解析坏＝警告放行，不阻断构建（红＝把同事的正常构建拦死）', 'code=' + r7.code);
  restore();

  // S8 非 git 目录 → 显式跳过
  let r8 = run(nogit);
  ok(r8.code === 2 && r8.out.indexOf('跳过') > -1, 'S8 无 HEAD 可比时 exit 2 并打印原因（对照，两侧都该绿）', 'code=' + r8.code + ' ' + r8.out.split('\n')[0]);
} finally {
  for (const d of [lab, nogit]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {} }
}
console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail > 0 ? 1 : 0);
